import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AreaGrid } from '@/components/AreaGrid';
import { Crumbs } from '@/components/Crumbs';
import { RouteList } from '@/components/RouteList';
import { LText } from '@/components/Text';
import { serverApi } from '@/lib/api/server';
import { areaTypeLabel, formatInt, loc, locText, translator } from '@/lib/i18n';
import { getPrefs } from '@/lib/prefs-server';

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ cursor?: string }> };

async function loadArea(slug: string) {
  const { data, response } = await serverApi.GET('/areas/by-slug/{slug}', { params: { path: { slug } } });
  if (response.status === 404) notFound();
  if (!data) throw new Error(`Area request failed: ${response.status}`);
  return data;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang } = await getPrefs();
  const area = await loadArea((await params).slug);
  return { title: locText(area.name, lang), description: loc(area.description, lang)?.text.slice(0, 160) };
}

export default async function AreaPage({ params, searchParams }: Props) {
  const { lang } = await getPrefs();
  const t = translator(lang);
  const { slug } = await params;
  const { cursor } = await searchParams;
  const area = await loadArea(slug);
  const [children, routes] = await Promise.all([
    serverApi.GET('/areas', { params: { query: { parentId: area.id, limit: 100 } } }),
    serverApi.GET('/routes', { params: { query: { areaId: area.id, includeSubareas: true, limit: 50, cursor } } }),
  ]);
  if (!children.data || !routes.data) throw new Error('Area content request failed');
  const description = loc(area.description, lang);

  return (
    <div className="page">
      <Crumbs path={area.ancestors} current={locText(area.name, lang)} lang={lang} t={t} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
        <span className="eyebrow">{areaTypeLabel(area.type, lang)}</span>
        <h1 className="h1"><LText text={area.name} lang={lang} t={t} /></h1>
        {area.type === 'summit' && (
          <span className="mono muted">
            {t('area.elevation')}: {area.elevationM != null ? `${formatInt(area.elevationM, lang)} ${t('common.m')}` : t('common.noData')}
          </span>
        )}
      </div>
      {description && (
        <p className="prose" style={{ whiteSpace: 'pre-wrap' }}>
          {description.text}
          {description.fallback && <span className="fallback-note">[{description.lang}]</span>}
        </p>
      )}

      {children.data.items.length > 0 && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: '1.4rem' }}>
          <h2 className="h2">{t('area.subareas')}</h2>
          <AreaGrid areas={children.data.items} lang={lang} t={t} />
        </section>
      )}

      <section style={{ display: 'flex', flexDirection: 'column', gap: '1.4rem' }}>
        <h2 className="h2">{t('area.routes')} · <span className="mono">{formatInt(area.routeCount ?? 0, lang)}</span></h2>
        {routes.data.items.length === 0 ? (
          <p className="muted">{t('area.noRoutes')}</p>
        ) : (
          <RouteList routes={routes.data.items} lang={lang} t={t} showArea={children.data.items.length > 0} />
        )}
        {routes.data.nextCursor && (
          <Link href={`/areas/${area.slug}?cursor=${encodeURIComponent(routes.data.nextCursor)}`} className="btn btn-ghost">
            {t('common.more')}
          </Link>
        )}
      </section>
    </div>
  );
}
