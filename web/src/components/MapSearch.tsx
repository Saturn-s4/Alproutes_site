'use client';

import type { Map as MlMap, Marker } from 'maplibre-gl';
import { useEffect, useId, useRef, useState } from 'react';
import { publicApi } from '@/lib/api/browser';
import type { components } from '@/lib/api/schema';
import type { AreaSummary, RouteSummary } from '@/lib/api/types';
import { formatLatLon, parseCoordinates } from '@/lib/coords';
import { areaTypeLabel, locText, placeCategoryLabel } from '@/lib/i18n';
import { primaryGrade } from './Grades';
import { usePrefs } from './Prefs';

type Place = components['schemas']['Place'];

type Hit =
  | { kind: 'coords'; lonLat: [number, number] }
  | { kind: 'area'; area: AreaSummary }
  | { kind: 'route'; route: RouteSummary }
  | { kind: 'place'; place: Place };

const CATALOG_DELAY = 250;
/** The geocoder allows one request per second for the whole site: wait until typing pauses. */
const PLACES_DELAY = 700;

function bboxOf(map: MlMap): string {
  const b = map.getBounds();
  const c = (v: number, lim: number) => Math.max(-lim, Math.min(lim, v)).toFixed(4);
  return [c(b.getWest(), 180), c(b.getSouth(), 90), c(b.getEast(), 180), c(b.getNorth(), 90)].join(',');
}

/**
 * Search box over a map: our areas and routes first, then places from OpenStreetMap
 * (GET /places), plus typed coordinates. Picking a result moves the map and drops a pin.
 */
export function MapSearch({
  map,
  onRoute,
}: {
  map: () => MlMap | null;
  /** Main map: a route is selected, not just shown. Without it, routes lacking geometry are left out. */
  onRoute?: (route: RouteSummary) => void;
}) {
  const { t, lang } = usePrefs();
  const listId = useId();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [areas, setAreas] = useState<AreaSummary[]>([]);
  const [routes, setRoutes] = useState<RouteSummary[]>([]);
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [placesState, setPlacesState] = useState<'idle' | 'loading' | 'unavailable' | 'busy'>('idle');
  const [placesNow, setPlacesNow] = useState(0);
  const markerRef = useRef<Marker | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const text = q.trim();
  const coords = text ? parseCoordinates(text) : null;
  const isCoords = coords?.ok === true;

  // Catalogue: areas and routes by name.
  useEffect(() => {
    setAreas([]);
    setRoutes([]);
    if (text.length < 2 || isCoords) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      void Promise.all([
        publicApi.GET('/areas', { params: { query: { q: text, limit: 5 } }, signal: ctrl.signal }),
        publicApi.GET('/routes', { params: { query: { q: text, limit: 6 } }, signal: ctrl.signal }),
      ])
        .then(([a, r]) => {
          // Only areas with a location can move the map.
          setAreas((a.data?.items ?? []).filter((x) => x.center));
          setRoutes((r.data?.items ?? []).filter((x) => onRoute || x.anchorPoint));
        })
        .catch(() => undefined);
    }, CATALOG_DELAY);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [text, isCoords, onRoute]);

  // OpenStreetMap: after a pause in typing, or at once on Enter (placesNow).
  useEffect(() => {
    setPlaces(null);
    setPlacesState('idle');
    if (text.length < 2 || isCoords) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      const m = map();
      setPlacesState('loading');
      void publicApi
        .GET('/places', { params: { query: { q: text, lang, bbox: m ? bboxOf(m) : undefined } }, signal: ctrl.signal })
        .then(({ data, response }) => {
          if (data) {
            setPlaces(data.items);
            setPlacesState('idle');
          } else {
            setPlacesState(response.status === 429 ? 'busy' : 'unavailable');
          }
        })
        .catch(() => {
          if (!ctrl.signal.aborted) setPlacesState('unavailable');
        });
    }, placesNow ? 0 : PLACES_DELAY);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
    // The map getter is stable for the life of the component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, isCoords, lang, placesNow]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, []);

  useEffect(() => () => void markerRef.current?.remove(), []);

  const hits: Hit[] = [
    ...(coords?.ok ? [{ kind: 'coords' as const, lonLat: coords.lonLat }] : []),
    ...areas.map((area) => ({ kind: 'area' as const, area })),
    ...routes.map((route) => ({ kind: 'route' as const, route })),
    ...(places ?? []).map((place) => ({ kind: 'place' as const, place })),
  ];

  const pin = async (lonLat: [number, number]) => {
    const m = map();
    if (!m) return;
    const ml = await import('maplibre-gl');
    markerRef.current?.remove();
    // MapLibre positions the element with its own transform; the drawn pin is a child.
    const el = document.createElement('div');
    el.className = 'search-pin';
    el.appendChild(document.createElement('span'));
    markerRef.current = new ml.Marker({ element: el, anchor: 'bottom' }).setLngLat(lonLat).addTo(m);
  };

  const go = (hit: Hit) => {
    const m = map();
    if (!m) return;
    const zoomTo = (lonLat: [number, number], zoom: number) => m.flyTo({ center: lonLat, zoom: Math.max(m.getZoom(), zoom), essential: true });
    if (hit.kind === 'coords') {
      zoomTo(hit.lonLat, 14);
      void pin(hit.lonLat);
    } else if (hit.kind === 'area') {
      const c = hit.area.center?.coordinates as [number, number] | undefined;
      if (c) {
        // An area's extent is not in the summary: summits close up, larger areas wider.
        m.flyTo({ center: c, zoom: hit.area.type === 'summit' ? 13 : hit.area.type === 'massif' ? 11 : 9, essential: true });
        void pin(c);
      }
    } else if (hit.kind === 'route') {
      const c = hit.route.anchorPoint?.coordinates as [number, number] | undefined;
      if (c) zoomTo(c, 13);
      markerRef.current?.remove();
      onRoute?.(hit.route);
    } else {
      const c = hit.place.location.coordinates as [number, number];
      const b = hit.place.bbox;
      if (b) m.fitBounds([b[0]!, b[1]!, b[2]!, b[3]!], { padding: 60, maxZoom: 14 });
      else zoomTo(c, 13);
      void pin(c);
    }
    setOpen(false);
  };

  const clear = () => {
    setQ('');
    setActive(-1);
    markerRef.current?.remove();
    markerRef.current = null;
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      if (hits.length) setActive((i) => (e.key === 'ArrowDown' ? (i + 1) % hits.length : (i <= 0 ? hits.length : i) - 1));
    } else if (e.key === 'Enter') {
      // Inside the route form Enter must not submit the whole form.
      e.preventDefault();
      e.stopPropagation();
      const hit = hits[active] ?? (places || isCoords ? hits[0] : undefined);
      if (hit) go(hit);
      else if (text.length >= 2 && !places) setPlacesNow((n) => n + 1);
    } else if (e.key === 'Escape') {
      if (open) setOpen(false);
      else clear();
    }
  };

  let index = -1;
  const row = (hit: Hit, key: string, body: React.ReactNode) => {
    index += 1;
    const i = index;
    return (
      <li key={key} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
        <button type="button" tabIndex={-1} onMouseEnter={() => setActive(i)} onClick={() => go(hit)}>{body}</button>
      </li>
    );
  };
  const showList = open && text.length >= 2;

  return (
    <div className="map-overlay map-search" ref={boxRef}>
      <div className="map-search-box">
        <span aria-hidden="true" className="map-search-icon">⌕</span>
        <input
          className="input"
          type="search"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          aria-label={t('search.label')}
          placeholder={t('search.placeholder')}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(-1);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
        />
        {q && <button type="button" className="map-search-clear" aria-label={t('search.clear')} onClick={clear}>×</button>}
      </div>
      {showList && (
        <ul className="map-search-list" id={listId} role="listbox">
          {coords?.ok && row(hits[0]!, 'coords', <><b>{t('search.goTo')}</b><span>{formatLatLon(coords.lonLat)}</span></>)}
          {areas.length > 0 && <li className="map-search-group" role="presentation">{t('search.areas')}</li>}
          {areas.map((a) => row({ kind: 'area', area: a }, `a-${a.id}`, (
            <><b>{locText(a.name, lang)}</b><span>{areaTypeLabel(a.type, lang)}</span></>
          )))}
          {routes.length > 0 && <li className="map-search-group" role="presentation">{t('search.routes')}</li>}
          {routes.map((r) => row({ kind: 'route', route: r }, `r-${r.id}`, (
            <><b>{locText(r.name, lang)}</b><span>{[primaryGrade(r.grades), locText(r.area.name, lang)].filter(Boolean).join(' · ')}</span></>
          )))}
          {!isCoords && (
            <>
              <li className="map-search-group" role="presentation">{t('search.osm')}</li>
              {placesState === 'idle' && !places && <li className="map-search-note" role="presentation">{t('search.osmWait')}</li>}
              {placesState === 'loading' && <li className="map-search-note" role="presentation">{t('common.loading')}</li>}
              {placesState === 'unavailable' && <li className="map-search-note" role="presentation">{t('search.osmUnavailable')}</li>}
              {placesState === 'busy' && <li className="map-search-note" role="presentation">{t('search.osmBusy')}</li>}
              {places?.length === 0 && <li className="map-search-note" role="presentation">{t('search.nothing')}</li>}
              {places?.map((p) => row({ kind: 'place', place: p }, `p-${p.id}`, (
                <><b>{p.name}</b><span>{[placeCategoryLabel(p.category, lang), p.label.split(', ').slice(1).join(', ')].filter(Boolean).join(' · ')}</span></>
              )))}
              {places && places.length > 0 && (
                <li className="map-search-note map-search-attr" role="presentation">
                  © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors · Nominatim
                </li>
              )}
            </>
          )}
        </ul>
      )}
    </div>
  );
}
