'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { logout } from '@/lib/api/browser';
import { LANGS, THEMES, type ThemePref } from '@/lib/prefs';
import { usePrefs } from './Prefs';

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('') || '?'
  );
}

export function Header() {
  const { t, lang, setLang, theme, setTheme, session } = usePrefs();
  const pathname = usePathname();
  const navClass = (active: boolean) => (active ? 'active' : undefined);

  return (
    <header className="header">
      <Link href="/" className="logo" aria-label="Alproutes">
        <LogoMark />
        <span>ALPROUTES</span>
      </Link>
      <nav className="nav" aria-label={t('nav.main')}>
        <Link href="/" className={navClass(pathname === '/')}>{t('nav.map')}</Link>
        <Link href="/catalog" className={navClass(pathname !== '/' && pathname !== '/login' && pathname !== '/moderation')}>{t('nav.catalog')}</Link>
        {(session?.user.role === 'moderator' || session?.user.role === 'admin') && (
          <Link href="/moderation" className={navClass(pathname === '/moderation')}>{t('nav.moderation')}</Link>
        )}
      </nav>
      <div className="spacer" />
      <div className="lang" role="group" aria-label={t('header.lang')}>
        {LANGS.map((l) => (
          <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)}>
            {l.toUpperCase()}
          </button>
        ))}
      </div>
      <select
        className="theme-select"
        aria-label={t('header.theme')}
        value={theme}
        onChange={(e) => setTheme(e.target.value as ThemePref)}
      >
        {THEMES.map((th) => (
          <option key={th} value={th}>{t(`theme.${th}`)}</option>
        ))}
      </select>
      {session ? (
        <div className="user-chip">
          <span className="avatar" title={`${session.user.displayName} · ${session.user.role}`}>
            {initials(session.user.displayName)}
          </span>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => void logout()}>
            {t('header.signOut')}
          </button>
        </div>
      ) : (
        session === null && (
          <Link href="/login" className="btn btn-sm btn-ghost">{t('header.signIn')}</Link>
        )
      )}
    </header>
  );
}

function LogoMark() {
  return (
    <svg width={26} height={26} viewBox="0 0 26 26" fill="none" aria-hidden="true">
      <path d="M2 22 L10 8 L14 14 L17 10 L24 22 Z" strokeWidth="2" strokeLinejoin="round" style={{ stroke: 'var(--accent)' }} />
    </svg>
  );
}
