'use client';

import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getSession, onSessionChange } from '@/lib/api/browser';
import type { TokenPair } from '@/lib/api/types';
import { translator, type Translate } from '@/lib/i18n';
import { LANG_COOKIE, THEME_COOKIE, writeCookie, type Lang, type ThemePref } from '@/lib/prefs';

type PrefsValue = {
  lang: Lang;
  t: Translate;
  setLang: (lang: Lang) => void;
  theme: ThemePref;
  setTheme: (theme: ThemePref) => void;
  /** `undefined` until the stored session has been read on the client. */
  session: TokenPair | null | undefined;
};

const PrefsContext = createContext<PrefsValue | null>(null);

export function PrefsProvider({ lang, theme: initialTheme, children }: { lang: Lang; theme: ThemePref; children: ReactNode }) {
  const router = useRouter();
  const [theme, setThemeState] = useState(initialTheme);
  const [session, setSessionState] = useState<TokenPair | null | undefined>(undefined);

  useEffect(() => {
    setSessionState(getSession());
    const off = onSessionChange(setSessionState);
    return () => {
      off();
    };
  }, []);

  const setLang = useCallback(
    (next: Lang) => {
      writeCookie(LANG_COOKIE, next);
      // Server components render texts, so re-render them in the new language.
      router.refresh();
    },
    [router],
  );

  const setTheme = useCallback((next: ThemePref) => {
    writeCookie(THEME_COOKIE, next);
    if (next === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', next);
    setThemeState(next);
  }, []);

  const value = useMemo(
    () => ({ lang, t: translator(lang), setLang, theme, setTheme, session }),
    [lang, setLang, theme, setTheme, session],
  );
  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function usePrefs() {
  const v = useContext(PrefsContext);
  if (!v) throw new Error('usePrefs outside PrefsProvider');
  return v;
}

/** Resolved theme ('system' → OS setting), for code that needs actual colours, e.g. the map. */
export function useResolvedTheme(): 'dark' | 'light' {
  const { theme } = usePrefs();
  const [osDark, setOsDark] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    setOsDark(mq.matches);
    const on = (e: MediaQueryListEvent) => setOsDark(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return theme === 'system' ? (osDark ? 'dark' : 'light') : theme;
}
