import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Fragment, type ReactNode } from 'react';
import { Ascents } from '@/components/Ascents';
import { Comments } from '@/components/Comments';
import { Crumbs } from '@/components/Crumbs';
import { DescriptionPhotos } from '@/components/DescriptionPhotos';
import { Documents } from '@/components/Documents';
import { RouteEditLinks } from '@/components/edit/EditLinks';
import { Grades } from '@/components/Grades';
import { RouteFeaturesMap } from '@/components/RouteFeaturesMap';
import { Disclaimer, LText, NoData } from '@/components/Text';
import { Tracks } from '@/components/Tracks';
import { UserPhotos } from '@/components/UserPhotos';
import { serverApi } from '@/lib/api/server';
import type { RouteDetail } from '@/lib/api/types';
import { featureKindLabel, formatDate, formatInt, loc, locText, monthName, routeTypeLabel, translator, type Translate } from '@/lib/i18n';
import type { Lang } from '@/lib/prefs';
import { FEATURE_ROLE } from '@/lib/route-features';
import { getPrefs } from '@/lib/prefs-server';

type Props = { params: Promise<{ slug: string }> };

async function loadRoute(slug: string) {
  const { data, response } = await serverApi.GET('/routes/by-slug/{slug}', { params: { path: { slug } } });
  if (response.status === 404) notFound();
  if (!data) throw new Error(`Route request failed: ${response.status}`);
  return data;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang } = await getPrefs();
  const route = await loadRoute((await params).slug);
  const grades = route.grades.map((g) => `${g.system} ${g.value}`).join(', ');
  const title = [locText(route.name, lang), grades].filter(Boolean).join(' · ');
  return { title, description: loc(route.description, lang)?.text.slice(0, 160) ?? locText(route.area.name, lang) };
}

export default async function RoutePage({ params }: Props) {
  const { lang } = await getPrefs();
  const t = translator(lang);
  const route = await loadRoute((await params).slug);
  const description = loc(route.description, lang);
  const [userPhotos, documents, tracks, comments, ascents] = await Promise.all([
    serverApi.GET('/routes/{routeId}/photos', { params: { path: { routeId: route.id }, query: { inDescription: false, limit: 24 } } }),
    serverApi.GET('/routes/{routeId}/documents', { params: { path: { routeId: route.id }, query: { limit: 50 } } }),
    serverApi.GET('/routes/{routeId}/tracks', { params: { path: { routeId: route.id }, query: { limit: 50 } } }),
    serverApi.GET('/routes/{routeId}/comments', { params: { path: { routeId: route.id }, query: { limit: 50 } } }),
    serverApi.GET('/routes/{routeId}/ascents', { params: { path: { routeId: route.id }, query: { limit: 20 } } }),
  ]);
  if (!userPhotos.data || !documents.data || !tracks.data || !comments.data || !ascents.data) throw new Error('Route media request failed');
  const trackIds = tracks.data.items.map((x) => x.id);

  return (
    <div className="page">
      <Crumbs path={route.areaPath} current={locText(route.name, lang)} lang={lang} t={t} />

      <div className="route-head">
        <div className="titles">
          <h1 className="h1"><LText text={route.name} lang={lang} t={t} /></h1>
          <Grades grades={route.grades} emptyLabel={t('route.noGrade')} />
          <p className="route-meta">
            {t('route.revision')} #{route.currentRevision.revisionNumber} · {t('route.updated')} {formatDate(route.updatedAt, lang)}
          </p>
        </div>
        <RouteEditLinks routeId={route.id} slug={route.slug} />
      </div>
      {route.status === 'draft' && <p className="status-note">{t('route.draft')}</p>}
      {route.status === 'hidden' && <p className="status-note">{t('route.hidden')}</p>}

      <div className="route-cols">
        <div className="route-main">
          <section className="prose">
            <h2 className="h2">{t('route.description')}</h2>
            {description ? (
              <p className="pre-wrap">
                {description.text}
                {description.fallback && <span className="fallback-note">[{description.lang}]</span>}
              </p>
            ) : (
              <p className="muted">{t('route.noDescription')}</p>
            )}
          </section>
          <DescriptionPhotos photos={route.descriptionPhotos} refs={route.photos ?? []} routeId={route.id} />

          <section className="route-section">
            <h2 className="h2">{t('trk.title')} · <span className="mono">{tracks.data.items.length}</span></h2>
            <Tracks routeId={route.id} initial={tracks.data.items} />
          </section>

          <section className="route-section">
            <h2 className="h2">{t('route.archive')} · <span className="mono">{documents.data.items.length}</span></h2>
            <Documents routeId={route.id} documents={documents.data.items} />
          </section>

          {/* Required on every route page (CLAUDE.md, section 8): after the route's own material, before climbers' content. */}
          <Disclaimer t={t} />

          <section className="route-section" id="comments">
            <h2 className="h2">{t('cm.title')} · <span className="mono">{route.stats?.commentCount ?? comments.data.items.filter((c) => !c.isDeleted).length}</span></h2>
            <Comments routeId={route.id} initial={comments.data.items} nextCursor={comments.data.nextCursor ?? null} />
          </section>

          <section className="route-section" id="ascents">
            <h2 className="h2">{t('route.ascents')} · <span className="mono">{route.stats?.ascentCount ?? ascents.data.items.length}</span></h2>
            <Ascents routeId={route.id} initial={ascents.data.items} nextCursor={ascents.data.nextCursor ?? null} />
          </section>

          <section className="route-section">
            <h2 className="h2">{t('route.userPhotos')}</h2>
            <UserPhotos routeId={route.id} initial={userPhotos.data.items} nextCursor={userPhotos.data.nextCursor ?? null} />
          </section>
        </div>

        <aside className="route-aside">
          {route.features?.length || trackIds.length ? (
            <div className="route-geo">
              <div className="route-map">
                <RouteFeaturesMap features={route.features ?? []} trackIds={trackIds} />
              </div>
              {route.features && route.features.length > 0 && <FeatureLegend route={route} lang={lang} />}
            </div>
          ) : (
            <p className="muted">{t('route.noGeometry')}</p>
          )}
          <div className="box">
            <Facts route={route} lang={lang} t={t} />
          </div>
        </aside>
      </div>
    </div>
  );
}

type FactRow = { label: string; value: ReactNode; mono?: boolean };

/** Known facts as a list; missing ones are named in a single "no data" line rather than a row each. */
function Facts({ route, lang, t }: { route: RouteDetail; lang: Lang; t: Translate }) {
  const m = (v: number | null | undefined) => (v != null ? `${formatInt(v, lang)} ${t('common.m')}` : null);
  const rows: FactRow[] = [
    { label: t('route.type'), value: route.routeType ? routeTypeLabel(route.routeType, lang) : null },
    { label: t('route.traverse'), value: route.isTraverse == null ? null : t(route.isTraverse ? 'route.yes' : 'route.no') },
    { label: t('route.gain'), value: m(route.elevationGainM), mono: true },
    { label: t('route.length'), value: m(route.lengthM), mono: true },
    { label: t('route.season'), value: route.seasonMonths?.length ? route.seasonMonths.map((mm) => monthName(mm, lang)).join(', ') : null },
    { label: t('route.firstAscent'), value: route.firstAscentParty ?? null },
    { label: t('route.firstAscentYear'), value: route.firstAscentYear ?? null, mono: true },
    { label: t('route.sources'), value: route.dataSources ? <span className="pre-wrap">{route.dataSources}</span> : null },
  ];
  const known = rows.filter((r) => r.value != null);
  const missing = rows.filter((r) => r.value == null);
  return (
    <>
      {known.length > 0 && (
        <dl className="facts">
          {known.map((r) => (
            <Fragment key={r.label}>
              <dt>{r.label}</dt>
              <dd className={r.mono ? 'mono' : undefined}>{r.value}</dd>
            </Fragment>
          ))}
        </dl>
      )}
      {missing.length > 0 && (
        <p className="facts-missing">
          <NoData t={t} />: {missing.map((r) => r.label.toLocaleLowerCase(lang)).join(', ')}
        </p>
      )}
    </>
  );
}

const ROLE_VAR = { accent: 'var(--accent)', blue: 'var(--blue-text)', muted: 'var(--muted)' } as const;

function FeatureLegend({ route, lang }: { route: RouteDetail; lang: Lang }) {
  const t = translator(lang);
  return (
    <div className="feature-list">
      <ul>
        {route.features?.map((f, i) => (
          <li key={i}>
            <span className={`swatch${f.point ? ' pt' : ''}`} style={{ background: ROLE_VAR[FEATURE_ROLE[f.kind]] }} />
            <span>
              {featureKindLabel(f.kind, lang)}
              {f.elevationM != null && <span className="mono muted"> · {formatInt(f.elevationM, lang)} {t('common.m')}</span>}
              {f.note && (
                <span className="muted">
                  {' — '}
                  <LText text={f.note} lang={lang} t={t} />
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
