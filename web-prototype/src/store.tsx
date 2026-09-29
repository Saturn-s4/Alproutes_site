import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DEMO_ROUTES, type Lang, type Route } from './data/routes';
import { makeT, type T } from './i18n';

export type ThemeMode = 'dark' | 'light' | 'system';
export type Units = 'm' | 'ft';
export type MapLayer = 'topo' | 'sat' | 'relief';

export interface Settings {
  theme: ThemeMode;
  lang: Lang;
  units: Units;
  layer: MapLayer;
  notifyReviews: boolean;
  notifyReplies: boolean;
}

export interface User {
  name: string;
  email: string;
}

export interface Review {
  id: string;
  routeId: string;
  author: string;
  date: string;
  text: string;
  mine?: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  lang: 'ru',
  units: 'm',
  layer: 'topo',
  notifyReviews: true,
  notifyReplies: false,
};

function usePersistent<V>(key: string, initial: V) {
  const [value, setValue] = useState<V>(() => {
    try {
      const raw = localStorage.getItem('alproutes.' + key);
      if (raw != null) {
        const parsed = JSON.parse(raw);
        return initial && typeof initial === 'object' && !Array.isArray(initial) ? { ...initial, ...parsed } : parsed;
      }
    } catch {
      /* storage unavailable */
    }
    return initial;
  });
  useEffect(() => {
    try {
      localStorage.setItem('alproutes.' + key, JSON.stringify(value));
    } catch {
      /* storage unavailable */
    }
  }, [key, value]);
  return [value, setValue] as const;
}

function useSystemLight() {
  const [light, setLight] = useState(() => window.matchMedia?.('(prefers-color-scheme: light)').matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: light)');
    if (!mq) return;
    const on = (e: MediaQueryListEvent) => setLight(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return light;
}

interface Store {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  theme: 'dark' | 'light';
  toggleTheme: () => void;
  t: T;
  lang: Lang;
  user: User | null;
  signIn: (u: User) => void;
  signOut: () => void;
  routes: Route[];
  /** The user's own routes, including drafts and private ones. */
  ownRoutes: Route[];
  saveRoute: (r: Route) => void;
  favorites: string[];
  toggleFavorite: (id: string) => void;
  reviews: Review[];
  addReview: (routeId: string, text: string) => void;
  query: string;
  setQuery: (q: string) => void;
  fmtHeight: (m: number) => string;
  fmtLength: (km: number) => string;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = usePersistent<Settings>('settings', DEFAULT_SETTINGS);
  const [user, setUser] = usePersistent<User | null>('user', null);
  const [ownRoutes, setOwnRoutes] = usePersistent<Route[]>('routes', []);
  const [favorites, setFavorites] = usePersistent<string[]>('favorites', []);
  const [reviews, setReviews] = usePersistent<Review[]>('reviews', []);
  const [query, setQuery] = useState('');
  const systemLight = useSystemLight();

  const theme: 'dark' | 'light' = settings.theme === 'system' ? (systemLight ? 'light' : 'dark') : settings.theme;
  const lang = settings.lang;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.lang = lang;
  }, [theme, lang]);

  const update = useCallback((patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch })), [setSettings]);

  const store = useMemo<Store>(() => {
    const t = makeT(lang);
    const nf = new Intl.NumberFormat(lang === 'ru' ? 'ru-RU' : 'en-GB', { maximumFractionDigits: 1 });
    const ft = settings.units === 'ft';
    return {
      settings,
      update,
      theme,
      toggleTheme: () => update({ theme: theme === 'dark' ? 'light' : 'dark' }),
      t,
      lang,
      user,
      signIn: (u) => setUser(u),
      signOut: () => setUser(null),
      routes: [...ownRoutes.filter((r) => r.own?.visibility === 'public' && !r.own.draft), ...DEMO_ROUTES],
      ownRoutes,
      saveRoute: (r) => setOwnRoutes((list) => [r, ...list.filter((x) => x.id !== r.id)]),
      favorites,
      toggleFavorite: (id) => setFavorites((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id])),
      reviews,
      addReview: (routeId, text) =>
        setReviews((list) => [
          { id: Date.now().toString(36), routeId, author: user?.name || '', date: new Date().toISOString(), text, mine: true },
          ...list,
        ]),
      query,
      setQuery,
      fmtHeight: (m) => `${Math.round(ft ? m * 3.28084 : m)}`,
      fmtLength: (km) => `${nf.format(ft ? km * 0.621371 : km)} ${t(ft ? 'unit.mi' : 'unit.km')}`,
    };
  }, [settings, update, theme, lang, user, setUser, ownRoutes, setOwnRoutes, favorites, setFavorites, reviews, setReviews, query]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error('StoreProvider missing');
  return s;
}

export function useRoute(id: string | undefined): Route | undefined {
  const { routes, ownRoutes } = useStore();
  return routes.find((r) => r.id === id) ?? ownRoutes.find((r) => r.id === id);
}
