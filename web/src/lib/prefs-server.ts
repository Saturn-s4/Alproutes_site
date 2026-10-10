import { cookies } from 'next/headers';
import { LANG_COOKIE, THEME_COOKIE, parseLang, parseTheme } from './prefs';

export async function getPrefs() {
  const jar = await cookies();
  return {
    lang: parseLang(jar.get(LANG_COOKIE)?.value),
    theme: parseTheme(jar.get(THEME_COOKIE)?.value),
  };
}
