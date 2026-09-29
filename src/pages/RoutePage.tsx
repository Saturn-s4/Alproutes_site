import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ElevationProfile } from '../components/ElevationProfile';
import { initials } from '../components/Header';
import { BookmarkIcon, DownloadIcon, ExpandIcon, Ridge } from '../components/Icons';
import { RouteMap } from '../components/RouteMap';
import { useToast } from '../components/Toast';
import { loc, type Route } from '../data/routes';
import { downloadText, toGpx, trackStats } from '../lib/geo';
import { useRoute, useStore } from '../store';
import { formatDate, reviewCount } from './shared';

const TABS = ['description', 'legs', 'tracks', 'pdf', 'reviews'] as const;
type Tab = (typeof TABS)[number];
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
const SEASON_MONTHS = { spring: [3, 5], summer: [7, 8], autumn: [9, 10], winter: [12, 2] } as const;

export function RoutePage() {
  const { id } = useParams();
  const route = useRoute(id);
  const { t } = useStore();
  if (!route) {
    return (
      <div className="page">
        <h1 className="h1">{t('route.notFound')}</h1>
        <Link to="/">{t('route.back')}</Link>
      </div>
    );
  }
  return <RouteView route={route} />;
}

function RouteView({ route }: { route: Route }) {
  const store = useStore();
  const { t, lang, settings, fmtHeight, fmtLength, favorites, toggleFavorite, user, reviews, addReview } = store;
  const [params, setParams] = useSearchParams();
  const tab: Tab = (TABS as readonly string[]).includes(params.get('tab') || '') ? (params.get('tab') as Tab) : 'description';
  const [full, setFull] = useState(false);
  const [draft, setDraft] = useState('');
  const [toast, showToast] = useToast();
  const stats = route.track ? trackStats(route.track) : null;
  const fav = favorites.includes(route.id);
  const nReviews = reviewCount(store, route);
  const routeReviews = reviews.filter((r) => r.routeId === route.id);
  const title = `${loc(route.peak, lang)} — ${loc(route.name, lang)}`;
  const gpx = () => route.track && downloadText(`${route.id}.gpx`, toGpx(title, route.track));
  const season = route.seasons
    .map((s) => SEASON_MONTHS[s].map((m) => ROMAN[m - 1]).join('–'))
    .join(', ');

  const tabLabel: Record<Tab, string> = {
    description: t('route.tab.description'),
    legs: t('route.tab.legs'),
    tracks: t('route.tab.tracks', { n: route.tracksCount }),
    pdf: t('route.tab.pdf', { n: route.pdfs.length }),
    reviews: t('route.tab.reviews', { n: nReviews }),
  };

  const legs = (
    <div className="legs">
      <div className="eyebrow">{t('route.legs')}</div>
      {route.legs.map((l, i) => (
        <div className="leg" key={i}>
          <span className="n">{String(i + 1).padStart(2, '0')}</span>
          <span className="name">{loc(l.name, lang)}</span>
          <span className="h">{fmtHeight(l.h)}</span>
        </div>
      ))}
    </div>
  );

  const reviewsBlock = (
    <section style={{ display: 'flex', flexDirection: 'column', gap: '1.4rem' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '1.2rem' }}>
        <h2 className="h2">{t('route.impressions')}</h2>
        <span className="mono muted" style={{ fontSize: '1.3rem' }}>{nReviews}</span>
      </div>
      {user ? (
        <form
          className="review-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.trim()) return;
            addReview(route.id, draft.trim());
            setDraft('');
          }}
        >
          <span className="avatar">{initials(user.name)}</span>
          <label className="sr-only" htmlFor="review">{t('route.impressions')}</label>
          <textarea id="review" placeholder={t('route.reviewPlaceholder')} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <button type="submit" className="btn btn-sm btn-blue" disabled={!draft.trim()}>{t('route.send')}</button>
        </form>
      ) : (
        <Link to="/login" className="panel-link">
          <span>{t('route.signInToReview')}</span>
          <span className="mono">→</span>
        </Link>
      )}
      {routeReviews.map((r) => (
        <div className="review" key={r.id}>
          <span className="avatar">{initials(r.author)}</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            <div className="who"><b>{r.author}</b> <span className="muted">· {formatDate(r.date, lang)}</span></div>
            <div className="text">{r.text}</div>
          </div>
        </div>
      ))}
      <div className="review">
        <span className="avatar avatar-soft">[И]</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          <div className="who">
            <b>[{lang === 'ru' ? 'Имя автора' : 'Author name'}]</b>{' '}
            <span className="muted">· [{lang === 'ru' ? 'дата восхождения' : 'ascent date'}] · 3 {lang === 'ru' ? 'фото' : 'photos'}</span>
          </div>
          <div className="text">{lang === 'ru' ? '[Текст отзыва: условия, снег, время прохождения участков.]' : '[Review text: conditions, snow, section times.]'}</div>
        </div>
      </div>
    </section>
  );

  return (
    <div className="page">
      <nav className="crumbs" aria-label="breadcrumbs">
        <Link to="/catalog">{t('route.crumbs')}</Link> / <span>{loc(route.area, lang)}</span> / <span>{loc(route.region, lang)}</span> /{' '}
        <span aria-current="page">{loc(route.peak, lang)}</span>
      </nav>

      <div className="route-head">
        <div className="titles">
          <div className="kicker">
            <span className="cat" style={{ fontSize: '1.4rem', padding: '0.3rem 1rem' }}>{route.category}</span>
            <span>
              {loc(route.name, lang)} · {t(`char.${route.character}`)} · {season}
            </span>
            {route.own?.draft && <span className="pill">{t('route.draft')}</span>}
          </div>
          <h1 className="h1">{loc(route.peak, lang)}</h1>
        </div>
        <button type="button" className="btn btn-lg btn-primary" onClick={gpx} disabled={!route.track}>
          <DownloadIcon />
          {t('route.gpx')}
        </button>
        <button type="button" className="btn btn-lg btn-outline-blue" onClick={() => showToast(lang === 'ru' ? 'Архив ZIP появится после подключения хранилища.' : 'ZIP download will be available once storage is connected.')}>
          {t('route.allMaterials')}
        </button>
        <button
          type="button"
          className="btn btn-lg btn-ghost btn-icon"
          aria-label={t(fav ? 'route.unfavorite' : 'route.favorite')}
          aria-pressed={fav}
          onClick={() => toggleFavorite(route.id)}
          style={fav ? { color: 'var(--accent-text)', borderColor: 'var(--accent)', width: '4.8rem' } : { width: '4.8rem' }}
        >
          <BookmarkIcon filled={fav} />
        </button>
        {route.own && (
          <Link to={`/upload?edit=${route.id}`} className="btn btn-lg btn-ghost">{t('route.edit')}</Link>
        )}
      </div>

      <div className="route-cols">
        <div className="route-main">
          <div className="gallery">
            <div className="photo main">
              <Ridge variant={1} />
              <span>{t('route.mainPhoto')}</span>
            </div>
            <div className="photo"><Ridge variant={0} /></div>
            <div className="photo"><Ridge variant={2} /></div>
            <div className="photo"><Ridge variant={1} /></div>
            <div className="more">{route.photos > 5 ? t('route.morePhotos', { n: route.photos - 5 }) : t('route.photosLater')}</div>
          </div>

          <div className="tabs" role="tablist">
            {TABS.map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                onClick={() => setParams(k === 'description' ? {} : { tab: k }, { replace: true })}
              >
                {tabLabel[k]}
              </button>
            ))}
          </div>

          <div role="tabpanel" style={{ display: 'flex', flexDirection: 'column', gap: '2.4rem' }}>
            {tab === 'description' && (
              <>
                <div className="route-text">
                  <div className="prose">
                    <h2 className="h2">{t('route.approach')}</h2>
                    {route.description.map((p, i) => (
                      <p key={i} style={{ whiteSpace: 'pre-wrap' }}>{loc(p, lang)}</p>
                    ))}
                  </div>
                  {legs}
                </div>
                {reviewsBlock}
              </>
            )}
            {tab === 'legs' && (
              <div className="route-text">
                {legs}
                {route.track && (
                  <div className="box" style={{ flexGrow: 1 }}>
                    <div className="profile-chart">
                      <div className="head"><span>{t('route.profile')}</span></div>
                      <ElevationProfile track={route.track} height={160} />
                    </div>
                  </div>
                )}
              </div>
            )}
            {tab === 'tracks' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: '72rem' }}>
                {!route.track && <p className="muted">{t('route.noTracks')}</p>}
                {route.track &&
                  Array.from({ length: Math.max(1, route.tracksCount) }, (_, i) => (
                    <button key={i} type="button" className="pdf-row" onClick={gpx} style={{ border: 0, textAlign: 'left' }}>
                      <span className="pdf-icon">GPX</span>
                      <span className="t">
                        <span>{t('route.trackVariant', { n: i + 1 })}</span>
                        <span>{stats && `${fmtLength(stats.lengthKm)} · +${fmtHeight(stats.gainM)}`}</span>
                      </span>
                      <span style={{ color: 'var(--blue-text)' }}>↓</span>
                    </button>
                  ))}
              </div>
            )}
            {tab === 'pdf' && <PdfList route={route} onOpen={() => showToast(lang === 'ru' ? 'Файлы архива появятся после подключения хранилища.' : 'Archive files will be available once storage is connected.')} />}
            {tab === 'reviews' && reviewsBlock}
          </div>
        </div>

        <aside className="route-aside">
          <div className={'route-map' + (full ? ' fullscreen' : '')}>
            <RouteMap routes={[route]} selectedId={route.id} layer={settings.layer} labels="selected" fitKey={full} />
            <div className="map-overlay map-note">
              {route.track ? t('map.trackBy', { n: route.tracksCount }) : t('map.noTrack')}
            </div>
            <button type="button" className="map-overlay map-full-btn btn btn-sm btn-ghost" style={{ background: 'var(--overlay)' }} onClick={() => setFull((v) => !v)}>
              <ExpandIcon />
              {t(full ? 'map.exitFullscreen' : 'map.fullscreen')}
            </button>
          </div>
          <div className="box">
            <div className="profile-chart">
              <div className="head">
                <span>{t('route.profile')}</span>
                <span className="mono">{stats ? `${fmtLength(stats.lengthKm)} · +${fmtHeight(stats.gainM)}` : '—'}</span>
              </div>
              {route.track && <ElevationProfile track={route.track} height={110} />}
            </div>
            <div className="plain-stats">
              <div><div className="k">{t('route.height')}</div><div className="v">{fmtHeight(route.height)}</div></div>
              <div><div className="k">{t('route.start')}</div><div className="v">{stats ? fmtHeight(stats.startM) : '—'}</div></div>
              <div><div className="k">{t('route.time')}</div><div className="v">{loc(route.time, lang)}</div></div>
              <div><div className="k">{t('route.season')}</div><div className="v">{season}</div></div>
            </div>
          </div>
          <div className="box">
            <div className="eyebrow">{t('route.archive')}</div>
            <PdfList route={route} onOpen={() => showToast(lang === 'ru' ? 'Файлы архива появятся после подключения хранилища.' : 'Archive files will be available once storage is connected.')} />
          </div>
        </aside>
      </div>
      {toast}
    </div>
  );
}

function PdfList({ route, onOpen }: { route: Route; onOpen: () => void }) {
  const { t, lang } = useStore();
  if (!route.pdfs.length) return <p className="muted">{t('route.noPdf')}</p>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {route.pdfs.map((p, i) => (
        <button key={i} type="button" className="pdf-row" style={{ border: 0, textAlign: 'left' }} onClick={onOpen}>
          <span className="pdf-icon">PDF</span>
          <span className="t">
            <span>{loc(p.title, lang)}, {p.year}</span>
            <span>{loc(p.meta, lang)}</span>
          </span>
          <span style={{ color: 'var(--blue-text)' }}>↓</span>
        </button>
      ))}
    </div>
  );
}
