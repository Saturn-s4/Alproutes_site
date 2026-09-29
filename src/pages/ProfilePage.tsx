import { Link, useNavigate, useParams } from 'react-router-dom';
import { initials } from '../components/Header';
import { UserIcon } from '../components/Icons';
import { loc, type Route } from '../data/routes';
import { useStore, type MapLayer, type ThemeMode } from '../store';
import { formatDate } from './shared';

const TABS = ['routes', 'tracks', 'favorites', 'reviews'] as const;
type Tab = (typeof TABS)[number];

export function ProfilePage() {
  const { tab: tabParam } = useParams();
  const tab: Tab = (TABS as readonly string[]).includes(tabParam || '') ? (tabParam as Tab) : 'routes';
  const store = useStore();
  const { t, lang, user, signOut, ownRoutes, routes, favorites, reviews } = store;
  const navigate = useNavigate();

  const myReviews = reviews.filter((r) => r.mine);
  const favRoutes = favorites.map((id) => routes.find((r) => r.id === id) ?? ownRoutes.find((r) => r.id === id)).filter(Boolean) as Route[];
  const withTracks = ownRoutes.filter((r) => r.track);

  const status = (r: Route) => {
    if (!r.own) return null;
    const key = r.own.draft ? 'draft' : r.own.visibility === 'public' ? 'published' : r.own.visibility;
    return <span className={'pill' + (key === 'published' ? ' pill-blue' : '')}>{t(`profile.status.${key}`)}</span>;
  };

  const row = (r: Route, extra?: React.ReactNode) => (
    <div className="my-row" key={r.id}>
      <div className="thumb" />
      <div className="c">{r.category}</div>
      <div className="t">
        <Link to={`/route/${r.id}`}>{loc(r.peak, lang)} — {loc(r.name, lang)}</Link>
        <span>
          {r.own
            ? t('profile.meta', { d: formatDate(r.own.updated, lang), t: r.tracksCount, r: r.reviewsCount })
            : `${loc(r.area, lang)} · ${loc(r.region, lang)}`}
        </span>
      </div>
      {status(r)}
      {extra}
    </div>
  );

  return (
    <div className="page">
      <div className="profile">
        <aside className="profile-side">
          {user ? (
            <div className="avatar">{initials(user.name)}</div>
          ) : (
            <div className="avatar avatar-guest"><UserIcon size={36} /></div>
          )}
          <div>
            <div className="name">{user?.name ?? t('profile.guest')}</div>
            <div className="muted" style={{ marginTop: '0.4rem' }}>{user?.email ?? t('profile.guestHint')}</div>
          </div>
          <div className="mini-stats">
            <div><div className="v">{ownRoutes.length}</div><div className="k">{t('profile.stats.routes')}</div></div>
            <div><div className="v">{withTracks.length}</div><div className="k">{t('profile.stats.tracks')}</div></div>
            <div><div className="v">{myReviews.length}</div><div className="k">{t('profile.stats.reviews')}</div></div>
          </div>
          {user ? (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                signOut();
                navigate('/');
              }}
            >
              {t('profile.signOut')}
            </button>
          ) : (
            <Link to="/login" className="btn btn-primary">{t('header.signIn')}</Link>
          )}
        </aside>

        <main className="profile-main">
          <div className="tabs" role="tablist">
            {TABS.map((k) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => navigate(k === 'routes' ? '/profile' : `/profile/${k}`)}>
                {t(`profile.tab.${k}`)}
              </button>
            ))}
          </div>
          {tab === 'routes' &&
            (ownRoutes.length ? (
              ownRoutes.map((r) => row(r, <Link to={`/upload?edit=${r.id}`}>{t('profile.change')}</Link>))
            ) : (
              <p className="muted">{t('profile.noRoutes')} <Link to="/upload">{t('header.add')} →</Link></p>
            ))}
          {tab === 'tracks' && (withTracks.length ? withTracks.map((r) => row(r)) : <p className="muted">{t('profile.noTracks')}</p>)}
          {tab === 'favorites' && (favRoutes.length ? favRoutes.map((r) => row(r)) : <p className="muted">{t('profile.noFavorites')}</p>)}
          {tab === 'reviews' &&
            (myReviews.length ? (
              myReviews.map((rv) => {
                const r = routes.find((x) => x.id === rv.routeId) ?? ownRoutes.find((x) => x.id === rv.routeId);
                return (
                  <div className="my-row" key={rv.id} style={{ alignItems: 'flex-start' }}>
                    <div className="t">
                      {r && <Link to={`/route/${r.id}?tab=reviews`}>{loc(r.peak, lang)}</Link>}
                      <span>{formatDate(rv.date, lang)}</span>
                      <span style={{ color: 'var(--text2)', whiteSpace: 'pre-wrap' }}>{rv.text}</span>
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="muted">{t('profile.noReviews')}</p>
            ))}
        </main>

        <Settings />
      </div>
    </div>
  );
}

function Settings() {
  const { t, settings, update } = useStore();
  const seg = <V extends string>(value: V, options: [V, string][], onPick: (v: V) => void, label: string) => (
    <div className="segmented" role="group" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onPick(v)}>{l}</button>
      ))}
    </div>
  );
  const toggle = (checked: boolean, label: string, onChange: (v: boolean) => void) => (
    <div className="toggle-row">
      <span id={label}>{label}</span>
      <button type="button" role="switch" className="switch" aria-checked={checked} aria-labelledby={label} onClick={() => onChange(!checked)} />
    </div>
  );

  return (
    <aside className="card settings">
      <div className="title">{t('settings.title')}</div>
      <div className="group">
        <span className="muted" style={{ fontSize: '1.3rem' }}>{t('settings.theme')}</span>
        {seg<ThemeMode>(settings.theme, [['dark', t('settings.dark')], ['light', t('settings.light')], ['system', t('settings.system')]], (theme) => update({ theme }), t('settings.theme'))}
      </div>
      <div className="group">
        <span className="muted" style={{ fontSize: '1.3rem' }}>{t('settings.lang')}</span>
        {seg(settings.lang, [['ru', 'Русский'], ['en', 'English']], (lang) => update({ lang }), t('settings.lang'))}
      </div>
      <div className="group">
        <span className="muted" style={{ fontSize: '1.3rem' }}>{t('settings.units')}</span>
        {seg(settings.units, [['m', t('settings.meters')], ['ft', t('settings.feet')]], (units) => update({ units }), t('settings.units'))}
      </div>
      <label className="field">
        {t('settings.defaultMap')}
        <select className="select" value={settings.layer} onChange={(e) => update({ layer: e.target.value as MapLayer })}>
          <option value="topo">{t('settings.map.topo')}</option>
          <option value="sat">{t('settings.map.sat')}</option>
          <option value="relief">{t('settings.map.relief')}</option>
        </select>
      </label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem', paddingTop: '0.6rem', borderTop: '1px solid var(--line)' }}>
        {toggle(settings.notifyReviews, t('settings.notifyReviews'), (v) => update({ notifyReviews: v }))}
        {toggle(settings.notifyReplies, t('settings.notifyReplies'), (v) => update({ notifyReplies: v }))}
      </div>
    </aside>
  );
}
