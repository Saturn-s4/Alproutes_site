import type L from 'leaflet';
import { useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ElevationProfile } from '../components/ElevationProfile';
import { BookmarkIcon, DownloadIcon, LayersIcon, Ridge } from '../components/Icons';
import { RouteMap } from '../components/RouteMap';
import { categoryIndex, loc, type Route } from '../data/routes';
import { downloadText, toGpx, trackStats } from '../lib/geo';
import { useStore, type MapLayer } from '../store';
import { matchesQuery, reviewCount } from './shared';

type Filters = { cats: boolean; gpx: boolean; summer: boolean };

export function MapPage() {
  const store = useStore();
  const { t, lang, routes, query, settings, fmtHeight } = store;
  const [params, setParams] = useSearchParams();
  const [layer, setLayer] = useState<MapLayer>(settings.layer);
  const [showOthers, setShowOthers] = useState(true);
  const [filters, setFilters] = useState<Filters>({ cats: false, gpx: false, summer: false });
  const [view, setView] = useState<{ bounds: L.LatLngBounds; center: L.LatLng } | null>(null);
  const [fitKey, setFitKey] = useState(0);
  const mapRef = useRef<L.Map | null>(null);

  const selectedId = params.get('r') ?? routes[0]?.id ?? null;
  const select = (id: string, fit = false) => {
    setParams({ r: id }, { replace: true });
    if (fit) setFitKey((k) => k + 1);
  };

  const filtered = useMemo(
    () =>
      routes.filter((r) => {
        if (!matchesQuery(r, query)) return false;
        if (filters.cats && (categoryIndex(r.category) < 1 || categoryIndex(r.category) > 3)) return false;
        if (filters.gpx && !r.track) return false;
        if (filters.summer && !r.seasons.includes('summer')) return false;
        return true;
      }),
    [routes, query, filters],
  );
  const inView = view ? filtered.filter((r) => view.bounds.contains(r.summit)) : filtered;
  const selected = routes.find((r) => r.id === selectedId) ?? null;
  const anyFilter = filters.cats || filters.gpx || filters.summer;

  const chip = (key: keyof Filters, label: string) => (
    <button type="button" className="chip" aria-pressed={filters[key]} onClick={() => setFilters((f) => ({ ...f, [key]: !f[key] }))}>
      {label}
    </button>
  );

  return (
    <div className="map-layout">
      <aside className="route-list" aria-label={t('map.inView')}>
        <div className="route-list-head">
          <div className="title">
            <span>{t('map.inView')}</span>
            <span className="mono muted" style={{ fontSize: '1.2rem' }}>{inView.length}</span>
          </div>
          <div className="chips">
            {chip('cats', t('map.filter.cats'))}
            {chip('gpx', t('map.filter.gpx'))}
            {chip('summer', t('map.filter.summer'))}
            {anyFilter && (
              <button type="button" className="chip chip-dashed" onClick={() => setFilters({ cats: false, gpx: false, summer: false })}>
                {t('map.filter.reset')}
              </button>
            )}
          </div>
        </div>
        <div className="route-list-items">
          {inView.length === 0 && <p className="empty">{t('map.empty')}</p>}
          {inView.map((r) => (
            <button key={r.id} type="button" className="route-row" aria-current={r.id === selectedId} onClick={() => select(r.id, true)}>
              <span className="badge">{r.category}</span>
              <span className="body">
                <span className="peak">{loc(r.peak, lang)}</span>
                <span className="name">{loc(r.name, lang)}</span>
                <span className="meta">
                  <span>{fmtHeight(r.height)} {t(settings.units === 'ft' ? 'unit.ft' : 'unit.m')}</span>
                  <span>{loc(r.region, lang)}</span>
                  <span className="gpx">{[r.track && 'GPX', r.pdfs.length && 'PDF'].filter(Boolean).join(' · ')}</span>
                </span>
              </span>
            </button>
          ))}
        </div>
      </aside>

      <main className="map-wrap">
        <RouteMap
          routes={filtered}
          selectedId={selectedId}
          onSelect={(id) => select(id)}
          layer={layer}
          showOthers={showOthers}
          onView={(bounds, center) => setView({ bounds, center })}
          onReady={(m) => (mapRef.current = m)}
          fitKey={fitKey}
        />
        <div className="map-overlay map-layers" role="group" aria-label={t('map.layers')}>
          {(['topo', 'sat', 'relief'] as const).map((l) => (
            <button key={l} type="button" aria-pressed={layer === l} onClick={() => setLayer(l)}>
              {t(`map.layer.${l}`)}
            </button>
          ))}
        </div>
        <div className="map-overlay map-zoom">
          <button type="button" aria-label={t('map.zoomIn')} onClick={() => mapRef.current?.zoomIn()}>+</button>
          <button type="button" aria-label={t('map.zoomOut')} onClick={() => mapRef.current?.zoomOut()}>−</button>
          <button type="button" aria-label={t('map.otherTracks')} aria-pressed={showOthers} onClick={() => setShowOthers((v) => !v)}>
            <LayersIcon />
          </button>
        </div>
        <div className="map-overlay map-legend">
          <span><span className="legend-sel" />{t('map.legend.selected')}</span>
          {showOthers && <span><span className="legend-other" />{t('map.legend.other')}</span>}
          {view && (
            <span className="mono">
              {view.center.lat.toFixed(3)}° N · {view.center.lng.toFixed(3)}° E
            </span>
          )}
        </div>
      </main>

      <aside className="panel" aria-label={selected ? loc(selected.peak, lang) : undefined}>
        {selected ? <RoutePanel route={selected} /> : <p className="empty">{t('map.pickRoute')}</p>}
      </aside>

      <aside className="extra-col">{selected && <ExtraColumn route={selected} />}</aside>
    </div>
  );
}

function RoutePanel({ route }: { route: Route }) {
  const store = useStore();
  const { t, lang, fmtHeight, fmtLength, favorites, toggleFavorite } = store;
  const stats = route.track ? trackStats(route.track) : null;
  const fav = favorites.includes(route.id);
  const reviews = reviewCount(store, route);

  return (
    <>
      <div className="photo" style={{ height: '20rem', flexShrink: 0 }}>
        <Ridge variant={route.height % 3} />
        <span>{t('route.photo', { n: route.photos })}</span>
      </div>
      <div className="panel-body">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="cat">{route.category}</span>
            <span className="muted" style={{ fontSize: '1.3rem' }}>
              {loc(route.area, lang)} · {loc(route.region, lang)}
            </span>
          </div>
          <h1>{loc(route.peak, lang)}</h1>
          <div className="sub">{loc(route.name, lang)}</div>
        </div>
        <div className="stats">
          <div><div className="k">{t('route.height')}</div><div className="v">{fmtHeight(route.height)}</div></div>
          <div><div className="k">{t('route.gain')}</div><div className="v">{stats ? fmtHeight(stats.gainM) : '—'}</div></div>
          <div><div className="k">{t('route.length')}</div><div className="v">{stats ? fmtLength(stats.lengthKm) : '—'}</div></div>
          <div><div className="k">{t('route.time')}</div><div className="v">{loc(route.time, lang)}</div></div>
        </div>
        {stats && route.track && (
          <div className="profile-chart">
            <div className="head">
              <span>{t('route.profile')}</span>
              <span className="mono">{fmtHeight(stats.startM)} → {fmtHeight(stats.maxM)}</span>
            </div>
            <ElevationProfile track={route.track} />
          </div>
        )}
        {!route.track && <p className="muted">{t('map.noTrack')}</p>}
        <p className="desc">{loc(route.description[0], lang)}</p>
        <div className="panel-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!route.track}
            onClick={() => route.track && downloadText(`${route.id}.gpx`, toGpx(`${loc(route.peak, lang)} — ${loc(route.name, lang)}`, route.track))}
          >
            <DownloadIcon />
            {t('route.gpx')}
          </button>
          <Link to={`/route/${route.id}?tab=pdf`} className="btn btn-outline-blue">
            {t('route.pdfArchive', { n: route.pdfs.length })}
          </Link>
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            aria-label={t(fav ? 'route.unfavorite' : 'route.favorite')}
            aria-pressed={fav}
            onClick={() => toggleFavorite(route.id)}
            style={fav ? { color: 'var(--accent-text)', borderColor: 'var(--accent)' } : undefined}
          >
            <BookmarkIcon filled={fav} />
          </button>
        </div>
        <Link to={`/route/${route.id}`} className="btn btn-ghost">{t('route.open')}</Link>
        <Link to={`/route/${route.id}?tab=reviews`} className="panel-link">
          <span>{t('route.reviews')}</span>
          <span className="mono">{reviews} →</span>
        </Link>
      </div>
    </>
  );
}

/** The fourth column that appears on 4K screens: photos and latest reviews. */
function ExtraColumn({ route }: { route: Route }) {
  const store = useStore();
  const { t, lang, reviews } = store;
  const mine = reviews.filter((r) => r.routeId === route.id).slice(0, 3);
  return (
    <>
      <div className="eyebrow">{t('upload.photos')} · {route.photos}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="photo" style={{ height: '14rem', borderRadius: '1rem' }}>
            <Ridge variant={i} />
          </div>
        ))}
      </div>
      <div className="eyebrow" style={{ marginTop: '1.2rem' }}>{t('route.impressions')} · {reviewCount(store, route)}</div>
      {mine.map((r) => (
        <div key={r.id} className="box">
          <b>{r.author}</b>
          <span style={{ color: 'var(--text2)' }}>{r.text}</span>
        </div>
      ))}
      <div className="box">
        <span className="muted">[{lang === 'ru' ? 'Имя автора' : 'Author'}] · [{lang === 'ru' ? 'дата' : 'date'}]</span>
        <span style={{ color: 'var(--text2)' }}>{lang === 'ru' ? '[Текст отзыва: условия, снег, время прохождения участков.]' : '[Review text: conditions, snow, section times.]'}</span>
      </div>
      <Link to={`/route/${route.id}?tab=reviews`} className="panel-link">
        <span>{t('route.reviews')}</span>
        <span className="mono">→</span>
      </Link>
    </>
  );
}
