import type { Route } from '../data/routes';
import type { useStore } from '../store';

type Store = ReturnType<typeof useStore>;

export function matchesQuery(r: Route, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [r.peak, r.name, r.region, r.area].some((v) => v.ru.toLowerCase().includes(q) || v.en.toLowerCase().includes(q));
}

export function reviewCount(store: Store, r: Route) {
  return r.reviewsCount + store.reviews.filter((x) => x.routeId === r.id).length;
}

export function formatDate(iso: string, lang: 'ru' | 'en') {
  return new Date(iso).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
