'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { logout } from '@/lib/api/browser';
import { LANGS, THEMES } from '@/lib/prefs';
import { usePrefs } from './Prefs';
import { isModerator } from '@/lib/api/types';

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
  const menuRef = useRef<HTMLDetailsElement>(null);

  // A native <details> does not close by itself: close it on an outside click or Escape.
  useEffect(() => {
    const close = (e: Event) => {
      const menu = menuRef.current;
      if (!menu?.open) return;
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !menu.contains(e.target as Node)) menu.open = false;
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, []);

  return (
    <header className="header">
      <Link href="/" className="logo" aria-label="Alproutes">
        <LogoMark />
        <span>ALPROUTES</span>
      </Link>
      <nav className="nav" aria-label={t('nav.main')}>
        <Link href="/" className={navClass(pathname === '/')}>{t('nav.map')}</Link>
        <Link href="/catalog" className={navClass(pathname !== '/' && pathname !== '/login' && pathname !== '/moderation')}>{t('nav.catalog')}</Link>
        {isModerator(session?.user) && (
          <Link href="/moderation" className={navClass(pathname === '/moderation')}>{t('nav.moderation')}</Link>
        )}
      </nav>
      <div className="spacer" />
      <details className="prefs-menu" ref={menuRef}>
        <summary className="prefs-toggle" aria-label={t('header.settings')} title={t('header.settings')}>
          <span className="mono">{lang.toUpperCase()}</span>
          <ThemeIcon />
        </summary>
        <div className="prefs-pop">
          <span className="prefs-label">{t('header.lang')}</span>
          <div className="segmented" role="group" aria-label={t('header.lang')}>
            {LANGS.map((l) => (
              <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)}>
                {l.toUpperCase()}
              </button>
            ))}
          </div>
          <span className="prefs-label">{t('header.theme')}</span>
          <div className="segmented" role="group" aria-label={t('header.theme')}>
            {THEMES.map((th) => (
              <button key={th} type="button" aria-pressed={theme === th} onClick={() => setTheme(th)}>
                {t(`theme.${th}`)}
              </button>
            ))}
          </div>
        </div>
      </details>
      {session ? (
        <div className="user-chip">
          <span className="avatar" title={`${session.user.displayName} · ${session.user.roles?.join(', ')}`}>
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

function ThemeIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 1.5a6.5 6.5 0 0 1 0 13z" fill="currentColor" />
    </svg>
  );
}

function LogoMark() {
  return (
    <svg width={26} height={26} viewBox="0 0 26 26" fill="none" aria-hidden="true">
      <path d="M2 22 L10 8 L14 14 L17 10 L24 22 Z" strokeWidth="2" strokeLinejoin="round" style={{ stroke: 'var(--accent)' }} />
    </svg>
  );
}
