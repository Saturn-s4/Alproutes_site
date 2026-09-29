import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { LogoMark, MoonIcon, PlusIcon, SearchIcon, SunIcon, UserIcon } from './Icons';

export function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join('') || '?'
  );
}

export function Header() {
  const { t, settings, update, theme, toggleTheme, user, query, setQuery } = useStore();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const onSearch = (q: string) => {
    setQuery(q);
    if (pathname !== '/' && pathname !== '/catalog') navigate('/');
  };

  return (
    <header className="header">
      <Link to="/" className="logo" aria-label="Alproutes">
        <LogoMark />
        <span>ALPROUTES</span>
      </Link>
      <nav className="nav" aria-label={t('nav.main')}>
        <NavLink to="/" end>{t('nav.map')}</NavLink>
        <NavLink to="/catalog">{t('nav.catalog')}</NavLink>
        <NavLink to="/profile" end>{t('nav.tracks')}</NavLink>
        <NavLink to="/profile/favorites">{t('nav.favorites')}</NavLink>
      </nav>
      <form className="search" role="search" onSubmit={(e) => e.preventDefault()}>
        <SearchIcon />
        <input
          type="search"
          aria-label={t('header.searchLabel')}
          placeholder={t('header.search')}
          value={query}
          onChange={(e) => onSearch(e.target.value)}
        />
      </form>
      <div className="spacer" />
      <Link to="/upload" className="btn btn-sm btn-primary add-btn">
        <PlusIcon />
        <span className="add-label">{t('header.add')}</span>
      </Link>
      <div className="lang" role="group" aria-label={t('header.lang')}>
        {(['ru', 'en'] as const).map((l) => (
          <button key={l} type="button" aria-pressed={settings.lang === l} onClick={() => update({ lang: l })}>
            {l.toUpperCase()}
          </button>
        ))}
      </div>
      <button type="button" className="icon-btn" aria-label={t('header.theme')} onClick={toggleTheme}>
        {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
      </button>
      {user ? (
        <Link to="/profile" className="avatar" aria-label={t('header.profile')}>
          {initials(user.name)}
        </Link>
      ) : (
        <Link to="/login" className="avatar avatar-guest" aria-label={t('header.signIn')}>
          <UserIcon />
        </Link>
      )}
    </header>
  );
}
