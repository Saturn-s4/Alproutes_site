import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
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
  const [userPhotos, documents, tracks] = await Promise.all([
    serverApi.GET('/routes/{routeId}/photos', { params: { path: { routeId: route.id }, query: { inDescription: false, limit: 24 } } }),
    serverApi.GET('/routes/{routeId}/documents', { params: { path: { routeId: route.id }, query: { limit: 50 } } }),
    serverApi.GET('/routes/{routeId}/tracks', { params: { path: { routeId: route.id }, query: { limit: 50 } } }),
  ]);
  if (!userPhotos.data || !documents.data || !tracks.data) throw new Error('Route media request failed');
  const trackIds = tracks.data.items.map((x) => x.id);

  return (
    <div className="page">
      <Crumbs path={route.areaPath} current={locText(route.name, lang)} lang={lang} t={t} />

      <div className="route-head">
        <div className="titles" style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
          <h1 className="h1"><LText text={route.name} lang={lang} t={t} /></h1>
          <Grades grades={route.grades} emptyLabel={t('route.noGrade')} />
        </div>
        <RouteEditLinks routeId={route.id} slug={route.slug} />
      </div>
      {route.status === 'draft' && <p className="status-note">{t('route.draft')}</p>}
      {route.status === 'hidden' && <p className="status-note">{t('route.hidden')}</p>}

      <div className="route-cols">
        <div className="route-main">
          <Disclaimer t={t} />
          <section className="prose">
            <h2 className="h2">{t('route.description')}</h2>
            {description ? (
              <p style={{ whiteSpace: 'pre-wrap' }}>
                {description.text}
                {description.fallback && <span className="fallback-note">[{description.lang}]</span>}
              </p>
            ) : (
              <p className="muted">{t('route.noDescription')}</p>
            )}
          </section>
          <DescriptionPhotos photos={route.descriptionPhotos} refs={route.photos ?? []} />

          <section className="route-section">
            <h2 className="h2">{t('trk.title')} · <span className="mono">{tracks.data.items.length}</span></h2>
            <Tracks routeId={route.id} initial={tracks.data.items} />
          </section>

          <section className="route-section">
            <h2 className="h2">{t('route.archive')} · <span className="mono">{documents.data.items.length}</span></h2>
            <Documents documents={documents.data.items} />
          </section>

          <section className="route-section">
            <h2 className="h2">{t('route.userPhotos')}</h2>
            <UserPhotos routeId={route.id} initial={userPhotos.data.items} nextCursor={userPhotos.data.nextCursor ?? null} />
          </section>
        </div>

        <aside className="route-aside">
          <div className="route-map">
            {route.features?.length || trackIds.length ? (
              <RouteFeaturesMap features={route.features ?? []} trackIds={trackIds} />
            ) : (
              <p className="empty">{t('route.noGeometry')}</p>
            )}
          </div>
          {route.features && route.features.length > 0 && <FeatureLegend route={route} lang={lang} />}
          <div className="box">
            <Facts route={route} lang={lang} t={t} />
          </div>
          <div className="box">
            <span className="eyebrow">{t('route.stats')}</span>
            <dl className="facts">
              {(
                [
                  ['route.photos', route.stats?.photoCount],
                  ['route.tracks', route.stats?.trackCount],
                  ['route.ascents', route.stats?.ascentCount],
                  ['route.comments', route.stats?.commentCount],
                  ['route.documents', route.stats?.documentCount],
                ] as const
              ).map(([k, v]) => (
                <Fact key={k} label={t(k)}>{formatInt(v ?? 0, lang)}</Fact>
              ))}
            </dl>
          </div>
          <p className="muted" style={{ fontSize: '1.2rem' }}>
            {t('route.revision')} #{route.currentRevision.revisionNumber} · {t('route.updated')} {formatDate(route.updatedAt, lang)}
          </p>
        </aside>
      </div>
    </div>
  );
}

function Fact({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className={mono ? 'mono' : undefined}>{children}</dd>
    </>
  );
}

function Facts({ route, lang, t }: { route: RouteDetail; lang: Lang; t: Translate }) {
  const nd = <NoData t={t} />;
  const m = (v: number | null | undefined) => (v != null ? `${formatInt(v, lang)} ${t('common.m')}` : nd);
  return (
    <dl className="facts">
      <Fact label={t('route.type')}>{route.routeType ? routeTypeLabel(route.routeType, lang) : nd}</Fact>
      <Fact label={t('route.traverse')}>{route.isTraverse == null ? nd : t(route.isTraverse ? 'route.yes' : 'route.no')}</Fact>
      <Fact label={t('route.gain')} mono>{m(route.elevationGainM)}</Fact>
      <Fact label={t('route.length')} mono>{m(route.lengthM)}</Fact>
      <Fact label={t('route.season')}>
        {route.seasonMonths?.length ? route.seasonMonths.map((mm) => monthName(mm, lang)).join(', ') : nd}
      </Fact>
      <Fact label={t('route.firstAscent')}>{route.firstAscentParty ?? nd}</Fact>
      <Fact label={t('route.firstAscentYear')} mono>{route.firstAscentYear ?? nd}</Fact>
      <Fact label={t('route.sources')}>{route.dataSources ? <span style={{ whiteSpace: 'pre-wrap' }}>{route.dataSources}</span> : nd}</Fact>
    </dl>
  );
}

const ROLE_VAR = { accent: 'var(--accent)', blue: 'var(--blue-text)', muted: 'var(--muted)' } as const;

function FeatureLegend({ route, lang }: { route: RouteDetail; lang: Lang }) {
  const t = translator(lang);
  return (
    <div className="box feature-list">
      <ul style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
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
