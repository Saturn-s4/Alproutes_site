import type { Metadata } from 'next';
import Link from 'next/link';
import { AreaEditLinks } from '@/components/edit/EditLinks';
import { RouteCard } from '@/components/RouteCard';
import { serverApi } from '@/lib/api/server';
import { formatInt, loc, locText, routeWord, translator } from '@/lib/i18n';
import { getPrefs } from '@/lib/prefs-server';

export const metadata: Metadata = { title: 'Каталог маршрутов' };

const SORTS = ['name', 'grade', 'elevation_gain', 'updated'] as const;
type Sort = (typeof SORTS)[number];
const PAGE = 24;

type Search = { sys?: string; g?: string; area?: string; track?: string; pdf?: string; sort?: string; cursor?: string };

/** Catalogue state lives in the URL: shareable, works without JS, indexable. */
function hrefWith(current: Search, patch: Partial<Record<keyof Search, string | null>>) {
  const next: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...current, cursor: undefined, ...patch })) if (v) next[k] = v;
  const qs = new URLSearchParams(next).toString();
  return qs ? `/catalog?${qs}` : '/catalog';
}

export default async function CatalogPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { lang } = await getPrefs();
  const t = translator(lang);
  const sp = await searchParams;
  const system = sp.sys || 'RU';
  const values = (sp.g ?? '').split(',').filter(Boolean);
  const sort: Sort = SORTS.includes(sp.sort as Sort) ? (sp.sort as Sort) : 'name';
  const track = sp.track === '1' ? true : undefined;
  const pdf = sp.pdf === '1' ? true : undefined;

  const filter = {
    areaId: sp.area || undefined,
    // The grade system goes to the API only when it filters or sorts: it drops routes without a grade in it.
    gradeSystem: values.length || sort === 'grade' ? system : undefined,
    gradeValues: values.length ? values : undefined,
    hasTrack: track,
    hasDocument: pdf,
  };
  const [systems, facets, routes] = await Promise.all([
    serverApi.GET('/grade-systems', { params: { query: { limit: 100 } } }),
    serverApi.GET('/routes/facets', { params: { query: filter } }),
    serverApi.GET('/routes', { params: { query: { ...filter, sort, limit: PAGE, cursor: sp.cursor } } }),
  ]);
  if (!systems.data || !facets.data || !routes.data) throw new Error('Catalogue request failed');

  const f = facets.data;
  const counts = new Map(f.grades.map((g) => [`${g.system}:${g.value}`, g.count]));
  const sys = systems.data.items.find((s) => s.code === system) ?? systems.data.items[0];
  // Systems worth offering: RU always, others only if some route uses them.
  const usedSystems = systems.data.items.filter((s) => s.code === 'RU' || s.code === system || f.grades.some((g) => g.system === s.code));
  const area = f.areas.find((a) => a.area.id === sp.area)?.area;
  const sortLabel: Record<Sort, string> = {
    name: t('catalog.sort.name'),
    grade: `${t('catalog.sort.grade')} (${system})`,
    elevation_gain: t('catalog.sort.gain'),
    updated: t('catalog.sort.updated'),
  };

  return (
    <div className="catalog">
      <aside className="filters" aria-label={t('catalog.filters')}>
        <fieldset>
          <legend>{t('catalog.category')}</legend>
          <div className="segmented sys-tabs" role="group" aria-label={t('catalog.gradeSystem')}>
            {usedSystems.map((s) => (
              <Link key={s.code} href={hrefWith(sp, { sys: s.code === 'RU' ? null : s.code, g: null })} aria-pressed={s.code === system}
                title={loc(s.name, lang)?.text}>
                {s.code}
              </Link>
            ))}
          </div>
          {sys?.values.map((v) => {
            const on = values.includes(v.value);
            const n = counts.get(`${sys.code}:${v.value}`) ?? 0;
            const next = on ? values.filter((x) => x !== v.value) : [...values, v.value];
            return (
              <Link key={v.value} className="check" role="checkbox" aria-checked={on} rel="nofollow"
                href={hrefWith(sp, { g: next.length ? next.join(',') : null })}>
                <span className="cbox" aria-hidden="true" />
                <span className="mono">{v.value}</span>
                <span className="n">{n}</span>
              </Link>
            );
          })}
          {values.length > 0 && <p className="filter-note">{t('catalog.gradeNote').replace('{system}', system)}</p>}
        </fieldset>

        <fieldset>
          <legend>{t('catalog.region')}</legend>
          <Link className="check radio" role="radio" aria-checked={!sp.area} href={hrefWith(sp, { area: null })}>
            <span className="cbox" aria-hidden="true" />
            {t('catalog.allRegions')}
          </Link>
          {f.areas.map((a) => (
            <Link key={a.area.id} className="check radio" role="radio" aria-checked={sp.area === a.area.id} rel="nofollow"
              href={hrefWith(sp, { area: a.area.id })}>
              <span className="cbox" aria-hidden="true" />
              {locText(a.area.name, lang)}
              <span className="n">{a.count}</span>
            </Link>
          ))}
          {area && <Link className="filter-note" href={`/areas/${area.slug}`}>{t('catalog.openArea')} →</Link>}
        </fieldset>

        <fieldset>
          <legend>{t('catalog.materials')}</legend>
          <div className="chips">
            <Link className="chip" aria-pressed={!!track} rel="nofollow" href={hrefWith(sp, { track: track ? null : '1' })}>
              GPX <span className="n">{f.materials.hasTrack}</span>
            </Link>
            <Link className="chip" aria-pressed={!!pdf} rel="nofollow" href={hrefWith(sp, { pdf: pdf ? null : '1' })}>
              PDF <span className="n">{f.materials.hasDocument}</span>
            </Link>
          </div>
        </fieldset>

        {(values.length > 0 || sp.area || track || pdf) && (
          <Link className="chip chip-dashed" href={hrefWith(sp, { g: null, area: null, track: null, pdf: null })}>{t('catalog.reset')}</Link>
        )}
      </aside>

      <main className="catalog-main">
        <div className="catalog-top">
          <div>
            <h1 className="h1" style={{ fontSize: 'clamp(2.8rem, 3vw, 4rem)' }}>
              {area ? locText(area.name, lang) : t('catalog.routesTitle')}
            </h1>
            <div className="muted" style={{ marginTop: '1rem' }}>
              <span className="mono" style={{ color: 'var(--accent)' }}>{formatInt(f.total, lang)}</span>{' '}
              {routeWord(f.total, lang)}
            </div>
          </div>
          <div className="catalog-actions">
            <AreaEditLinks areaId={sp.area} />
            <div className="segmented" role="group" aria-label={t('catalog.sort')}>
              {SORTS.map((s) => (
                <Link key={s} href={hrefWith(sp, { sort: s === 'name' ? null : s })} aria-pressed={sort === s} rel="nofollow">
                  {sortLabel[s]}
                </Link>
              ))}
            </div>
          </div>
        </div>

        {routes.data.items.length === 0 && <p className="muted">{t('catalog.noRoutes')}</p>}
        <div className="cards">
          {routes.data.items.map((r, i) => (
            <RouteCard key={r.id} route={r} preferSystem={system} variant={i} lang={lang} t={t} />
          ))}
        </div>
        {(sp.cursor || routes.data.nextCursor) && (
          <div className="row-gap" style={{ gap: '1.2rem' }}>
            {sp.cursor && <Link className="btn btn-ghost" href={hrefWith(sp, {})}>{t('catalog.firstPage')}</Link>}
            {routes.data.nextCursor && (
              <Link className="btn btn-ghost" href={`${hrefWith(sp, {})}${hrefWith(sp, {}).includes('?') ? '&' : '?'}cursor=${encodeURIComponent(routes.data.nextCursor)}`}>
                {t('catalog.nextPage')} →
              </Link>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
