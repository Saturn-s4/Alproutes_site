'use client';

import type { GeoJSONSource, Map as MlMap, Popup } from 'maplibre-gl';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { publicApi } from '@/lib/api/browser';
import type { RouteDetail, RouteMapPoint, RouteSummary } from '@/lib/api/types';
import { formatInt, loc, locText, routeTypeLabel, monthName } from '@/lib/i18n';
import { DEFAULT_VIEW, themeColors } from '@/lib/map-style';
import { Grades, primaryGrade } from './Grades';
import { MapCanvas } from './MapCanvas';
import { usePrefs } from './Prefs';
import { Disclaimer, LText, NoData } from './Text';

const VIEW_KEY = 'alproutes.mapView';
const LIST_PAGE = 50;

type View = { center: [number, number]; zoom: number };

function savedView(): View {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    if (raw) return JSON.parse(raw) as View;
  } catch {
    // Per-viewer convenience only; fall back to the default view.
  }
  return DEFAULT_VIEW;
}

function bboxOf(map: MlMap): string {
  const b = map.getBounds();
  const clamp = (v: number, lim: number) => Math.max(-lim, Math.min(lim, v));
  return [clamp(b.getWest(), 180), clamp(b.getSouth(), 90), clamp(b.getEast(), 180), clamp(b.getNorth(), 90)]
    .map((v) => v.toFixed(5))
    .join(',');
}

export function RouteExplorer() {
  const { t, lang } = usePrefs();
  const params = useSearchParams();
  const selectedSlug = params.get('r');

  const mapRef = useRef<MlMap | null>(null);
  const popupRef = useRef<Popup | null>(null);
  const [initialView] = useState<View>(() => (typeof window === 'undefined' ? DEFAULT_VIEW : savedView()));
  const [bbox, setBbox] = useState<string | null>(null);
  const [points, setPoints] = useState<RouteMapPoint[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [list, setList] = useState<{ items: RouteSummary[]; next: string | null; bbox: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const [detail, setDetail] = useState<RouteDetail | null>(null);

  const select = useCallback((slug: string | null) => {
    const url = slug ? `/?r=${encodeURIComponent(slug)}` : '/';
    // Native history keeps the server tree intact; Next syncs useSearchParams with it.
    window.history.replaceState(null, '', url);
  }, []);

  // Points and the list for the visible area.
  useEffect(() => {
    if (!bbox) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setError(false);
      Promise.all([
        publicApi.GET('/routes/map-points', { params: { query: { bbox, limit: 500 } }, signal: ctrl.signal }),
        publicApi.GET('/routes', { params: { query: { bbox, limit: LIST_PAGE } }, signal: ctrl.signal }),
      ])
        .then(([pts, routes]) => {
          if (!pts.data || !routes.data) throw new Error('api');
          setPoints(pts.data.items);
          setTruncated(pts.data.nextCursor != null);
          setList({ items: routes.data.items, next: routes.data.nextCursor ?? null, bbox });
        })
        .catch((e: unknown) => {
          if (!ctrl.signal.aborted) {
            console.error(e);
            setError(true);
          }
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setLoading(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [bbox, reload]);

  const loadMore = async () => {
    if (!list?.next) return;
    const { data } = await publicApi.GET('/routes', { params: { query: { bbox: list.bbox, limit: LIST_PAGE, cursor: list.next } } });
    if (data) setList({ items: [...list.items, ...data.items], next: data.nextCursor ?? null, bbox: list.bbox });
  };

  // Selected route card.
  useEffect(() => {
    if (!selectedSlug) {
      setDetail(null);
      return;
    }
    const ctrl = new AbortController();
    publicApi
      .GET('/routes/by-slug/{slug}', { params: { path: { slug: selectedSlug } }, signal: ctrl.signal })
      .then(({ data }) => setDetail(data ?? null))
      .catch(() => undefined);
    return () => ctrl.abort();
  }, [selectedSlug]);

  // Keep the map source in sync with points, language and selection.
  useEffect(() => {
    const map = mapRef.current;
    const src = map?.getSource<GeoJSONSource>('routes');
    if (!map || !src) return;
    src.setData({
      type: 'FeatureCollection',
      features: points.map((p) => ({
        type: 'Feature',
        geometry: p.anchorPoint,
        properties: { slug: p.slug, name: locText(p.name, lang), grade: primaryGrade(p.grades) ?? '' },
      })),
    });
    map.setFilter('routes-sel', ['==', ['get', 'slug'], selectedSlug ?? '']);
  }, [points, lang, selectedSlug]);

  const onReady = useCallback(
    (map: MlMap) => {
      mapRef.current = map;
      const paint = () => {
        const c = themeColors();
        map.setPaintProperty('routes-pt', 'circle-color', c.blue);
        map.setPaintProperty('routes-pt', 'circle-stroke-color', c.bg);
        map.setPaintProperty('routes-sel', 'circle-color', c.accent);
        map.setPaintProperty('routes-sel', 'circle-stroke-color', c.bg);
      };
      map.addSource('routes', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'routes-pt', type: 'circle', source: 'routes', paint: { 'circle-radius': 7, 'circle-stroke-width': 2 } });
      map.addLayer({
        id: 'routes-sel',
        type: 'circle',
        source: 'routes',
        filter: ['==', ['get', 'slug'], ''],
        paint: { 'circle-radius': 10, 'circle-stroke-width': 3 },
      });
      paint();

      void import('maplibre-gl').then((ml) => {
        popupRef.current = new ml.Popup({ closeButton: false, closeOnClick: false, offset: 12, className: 'route-popup' });
      });
      for (const layer of ['routes-pt', 'routes-sel']) {
        map.on('click', layer, (e) => {
          const slug = e.features?.[0]?.properties?.slug as string | undefined;
          if (slug) select(slug);
        });
        map.on('mouseenter', layer, (e) => {
          map.getCanvas().style.cursor = 'pointer';
          const f = e.features?.[0];
          if (f && popupRef.current && f.geometry.type === 'Point') {
            const { name, grade } = f.properties as { name: string; grade: string };
            popupRef.current
              .setLngLat(f.geometry.coordinates as [number, number])
              .setText(grade ? `${name} · ${grade}` : name)
              .addTo(map);
          }
        });
        map.on('mouseleave', layer, () => {
          map.getCanvas().style.cursor = '';
          popupRef.current?.remove();
        });
      }

      const onMove = () => {
        setBbox(bboxOf(map));
        try {
          const c = map.getCenter();
          localStorage.setItem(VIEW_KEY, JSON.stringify({ center: [c.lng, c.lat], zoom: map.getZoom() }));
        } catch {
          // ignore
        }
      };
      map.on('moveend', onMove);
      onMove();
      return paint;
    },
    [select],
  );

  const flyTo = (r: RouteSummary) => {
    select(r.slug);
    if (r.anchorPoint && mapRef.current) mapRef.current.easeTo({ center: r.anchorPoint.coordinates as [number, number] });
  };

  return (
    <div className="map-layout">
      <aside className="route-list" aria-label={t('map.inView')}>
        <div className="route-list-head">
          <div className="title">
            <span>{t('map.inView')}</span>
            <span className="mono muted" style={{ fontSize: '1.2rem' }}>
              {list ? `${list.items.length}${list.next ? '+' : ''}` : ''}
            </span>
          </div>
        </div>
        <div className="route-list-items">
          {error && (
            <p className="empty">
              {t('common.error')}{' '}
              <button type="button" className="linklike" onClick={() => setReload((n) => n + 1)}>
                {t('common.retry')}
              </button>
            </p>
          )}
          {!error && list?.items.length === 0 && <p className="empty">{t('map.empty')}</p>}
          {list?.items.map((r) => (
            <RouteRow key={r.id} route={r} current={r.slug === selectedSlug} onClick={() => flyTo(r)} />
          ))}
          {list?.next && (
            <div style={{ padding: '1.2rem 1.6rem' }}>
              <button type="button" className="btn btn-ghost btn-block" onClick={() => void loadMore()}>{t('common.more')}</button>
            </div>
          )}
        </div>
      </aside>

      <main className="map-wrap">
        <MapCanvas center={initialView.center} zoom={initialView.zoom} onReady={onReady} />
        <div className="map-overlay map-zoom">
          <button type="button" aria-label={t('map.zoomIn')} onClick={() => mapRef.current?.zoomIn()}>+</button>
          <button type="button" aria-label={t('map.zoomOut')} onClick={() => mapRef.current?.zoomOut()}>−</button>
        </div>
        {truncated && <div className="map-overlay map-notice">{t('map.truncated')}</div>}
        {loading && <div className="map-overlay map-loading">{t('common.loading')}</div>}
      </main>

      <aside className="panel" aria-label={detail ? locText(detail.name, lang) : undefined}>
        {detail ? <RoutePanel route={detail} /> : <p className="empty">{t('map.pickRoute')}</p>}
      </aside>
    </div>
  );
}

function RouteRow({ route, current, onClick }: { route: RouteSummary; current: boolean; onClick: () => void }) {
  const { t, lang } = usePrefs();
  const grade = route.grades[0];
  return (
    <button type="button" className="route-row" aria-current={current} onClick={onClick}>
      <span className="badge badge-text" title={grade ? `${grade.system} ${grade.value}` : t('route.noGrade')}>
        {grade ? grade.value : '?'}
      </span>
      <span className="body">
        <span className="peak"><LText text={route.name} lang={lang} t={t} /></span>
        <span className="name"><LText text={route.area.name} lang={lang} t={t} /></span>
        <span className="meta">
          {grade && <span>{grade.system}</span>}
          {route.elevationGainM != null && <span>↑ {formatInt(route.elevationGainM, lang)} {t('common.m')}</span>}
          {route.lengthM != null && <span>{formatInt(route.lengthM, lang)} {t('common.m')}</span>}
        </span>
      </span>
    </button>
  );
}

function RoutePanel({ route }: { route: RouteDetail }) {
  const { t, lang } = usePrefs();
  const description = loc(route.description, lang);
  const excerpt = description && description.text.length > 600 ? `${description.text.slice(0, 600)}…` : description?.text;
  const cover = route.descriptionPhotos[0]?.urls;
  return (
    <>
    {cover && <img className="panel-cover" src={cover.medium} alt="" />}
    <div className="panel-body">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
        <span className="muted" style={{ fontSize: '1.3rem' }}>
          {route.areaPath.map((a) => locText(a.name, lang)).join(' · ')}
        </span>
        <h1><LText text={route.name} lang={lang} t={t} /></h1>
        <Grades grades={route.grades} emptyLabel={t('route.noGrade')} />
      </div>
      <div className="stats" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        <div>
          <div className="k">{t('route.gain')}</div>
          <div className="v">{route.elevationGainM != null ? `${formatInt(route.elevationGainM, lang)} ${t('common.m')}` : <NoData t={t} />}</div>
        </div>
        <div>
          <div className="k">{t('route.length')}</div>
          <div className="v">{route.lengthM != null ? `${formatInt(route.lengthM, lang)} ${t('common.m')}` : <NoData t={t} />}</div>
        </div>
        <div>
          <div className="k">{t('route.type')}</div>
          <div className="v" style={{ fontSize: '1.3rem' }}>{route.routeType ? routeTypeLabel(route.routeType, lang) : <NoData t={t} />}</div>
        </div>
        <div>
          <div className="k">{t('route.season')}</div>
          <div className="v" style={{ fontSize: '1.3rem' }}>
            {route.seasonMonths?.length ? route.seasonMonths.map((m) => monthName(m, lang)).join(', ') : <NoData t={t} />}
          </div>
        </div>
      </div>
      {excerpt ? <p className="desc" style={{ whiteSpace: 'pre-wrap' }}>{excerpt}</p> : <p className="muted">{t('route.noDescription')}</p>}
      <Disclaimer t={t} />
      <Link href={`/routes/${route.slug}`} className="btn btn-primary">{t('route.open')}</Link>
    </div>
    </>
  );
}
