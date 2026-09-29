import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Ridge } from '../components/Icons';
import { CATEGORIES, categoryIndex, loc, type Category } from '../data/routes';
import { plural } from '../i18n';
import { useStore } from '../store';
import { matchesQuery, reviewCount } from './shared';

type Sort = 'popular' | 'height' | 'new';

export function CatalogPage() {
  const store = useStore();
  const { t, lang, routes, query, fmtHeight, settings } = store;
  const [cats, setCats] = useState<Set<Category>>(new Set());
  const [region, setRegion] = useState<string | null>(null);
  const [gpxOnly, setGpxOnly] = useState(false);
  const [pdfOnly, setPdfOnly] = useState(false);
  const [sort, setSort] = useState<Sort>('popular');

  const regions = useMemo(() => {
    const m = new Map<string, number>();
    routes.forEach((r) => m.set(r.region.ru, (m.get(r.region.ru) || 0) + 1));
    return [...m.entries()].map(([ru, n]) => ({ ru, n, label: loc(routes.find((r) => r.region.ru === ru)!.region, lang) }));
  }, [routes, lang]);

  const list = useMemo(() => {
    const out = routes.filter(
      (r) =>
        matchesQuery(r, query) &&
        (cats.size === 0 || cats.has(r.category)) &&
        (!region || r.region.ru === region) &&
        (!gpxOnly || r.track) &&
        (!pdfOnly || r.pdfs.length),
    );
    if (sort === 'height') out.sort((a, b) => b.height - a.height);
    if (sort === 'popular') out.sort((a, b) => b.reviewsCount - a.reviewsCount);
    if (sort === 'new') out.sort((a, b) => Number(!!b.own) - Number(!!a.own));
    return out;
  }, [routes, query, cats, region, gpxOnly, pdfOnly, sort]);

  const catCounts = useMemo(() => {
    const m = new Map<Category, number>();
    routes.forEach((r) => m.set(r.category, (m.get(r.category) || 0) + 1));
    return m;
  }, [routes]);

  const heading = region ? regions.find((r) => r.ru === region)?.label : t('catalog.title');
  const unit = t(settings.units === 'ft' ? 'unit.ft' : 'unit.m');
  const routesWord = plural(lang, list.length, { ru: ['маршрут', 'маршрута', 'маршрутов'], en: ['route', 'routes'] });

  return (
    <div className="catalog">
      <aside className="filters">
        <fieldset>
          <legend>{t('catalog.category')}</legend>
          {CATEGORIES.filter((c) => categoryIndex(c) < 10).map((c) => (
            <label className="check" key={c}>
              <input
                type="checkbox"
                checked={cats.has(c)}
                onChange={() =>
                  setCats((s) => {
                    const n = new Set(s);
                    if (n.has(c)) n.delete(c);
                    else n.add(c);
                    return n;
                  })
                }
              />
              <span className="mono">{c}</span>
              <span className="n">{catCounts.get(c) || 0}</span>
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>{t('catalog.region')}</legend>
          <label className="check">
            <input type="radio" name="region" checked={region === null} onChange={() => setRegion(null)} />
            {t('catalog.allRegions')}
          </label>
          {regions.map((r) => (
            <label className="check" key={r.ru}>
              <input type="radio" name="region" checked={region === r.ru} onChange={() => setRegion(r.ru)} />
              {r.label}
              <span className="n">{r.n}</span>
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>{t('catalog.materials')}</legend>
          <div className="chips">
            <button type="button" className="chip" aria-pressed={gpxOnly} onClick={() => setGpxOnly((v) => !v)}>GPX</button>
            <button type="button" className="chip" aria-pressed={pdfOnly} onClick={() => setPdfOnly((v) => !v)}>PDF</button>
          </div>
        </fieldset>
      </aside>

      <main className="catalog-main">
        <div className="catalog-top">
          <div>
            <h1 className="h1" style={{ fontSize: 'clamp(2.8rem, 3vw, 4rem)' }}>{heading}</h1>
            <div className="muted" style={{ marginTop: '1rem' }}>
              <span className="mono" style={{ color: 'var(--accent)' }}>{list.length}</span> {routesWord}
            </div>
          </div>
          <div className="segmented" role="group" style={{ fontSize: '1.3rem' }}>
            {(['popular', 'height', 'new'] as const).map((s) => (
              <button key={s} type="button" aria-pressed={sort === s} onClick={() => setSort(s)} style={{ height: '3rem', padding: '0 1.2rem', fontSize: '1.3rem' }}>
                {t(`catalog.sort.${s}`)}
              </button>
            ))}
          </div>
        </div>
        {list.length === 0 && <p className="muted">{t('catalog.empty')}</p>}
        <div className="cards">
          {list.map((r, i) => (
            <Link to={`/route/${r.id}`} className="route-card" key={r.id}>
              <div className="photo">
                <Ridge variant={i} />
                <span className="cat">{r.category}</span>
                <span>{t('catalog.photo')}</span>
              </div>
              <div className="info">
                <div className="peak">{loc(r.peak, lang)}</div>
                <div className="muted" style={{ fontSize: '1.3rem' }}>{loc(r.name, lang)}</div>
                <div className="meta">
                  <span>{fmtHeight(r.height)} {unit}</span>
                  <span style={{ color: 'var(--blue-text)' }}>{[r.track && 'GPX', r.pdfs.length && 'PDF'].filter(Boolean).join(' · ')}</span>
                  <span className="rev">
                    {reviewCount(store, r)} {plural(lang, reviewCount(store, r), { ru: ['отзыв', 'отзыва', 'отзывов'], en: ['review', 'reviews'] })}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
