/** Viewer preferences kept in cookies so server-rendered pages come out in the right language and theme. */

export const LANGS = ['ru', 'en'] as const;
export type Lang = (typeof LANGS)[number];

export const THEMES = ['system', 'dark', 'light'] as const;
export type ThemePref = (typeof THEMES)[number];

export const LANG_COOKIE = 'lang';
export const THEME_COOKIE = 'theme';

export function parseLang(v: string | undefined): Lang {
  return v === 'en' ? 'en' : 'ru';
}

export function parseTheme(v: string | undefined): ThemePref {
  return v === 'dark' || v === 'light' ? v : 'system';
}

export function writeCookie(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax`;
}
