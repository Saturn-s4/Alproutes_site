'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api/browser';
import type { components } from '@/lib/api/schema';
import { formatDate, formatInt, loc, locText, monthName, routeTypeLabel, type Translate } from '@/lib/i18n';
import type { Lang } from '@/lib/prefs';
import { Grades } from '../Grades';
import { usePrefs } from '../Prefs';
import { RouteFeaturesMap } from '../RouteFeaturesMap';

type RouteRevision = components['schemas']['RouteRevision'];
type RouteContent = components['schemas']['RouteContent'];

/** One revision as a moderator or the author sees it: content, changes against its base, review actions. */
export function RevisionView({ revisionId }: { revisionId: string }) {
  const { t, lang, session } = usePrefs();
  const router = useRouter();
  const [rev, setRev] = useState<RouteRevision | null>(null);
  const [base, setBase] = useState<RouteRevision | null>(null);
  const [areaNames, setAreaNames] = useState<Record<string, string>>({});
  const [slug, setSlug] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading');
  const isModerator = session?.user.role === 'moderator' || session?.user.role === 'admin';

  const load = useCallback(async () => {
    const { data } = await api.GET('/route-revisions/{revisionId}', { params: { path: { revisionId } } });
    if (!data) {
      setState('missing');
      return;
    }
    setRev(data);
    const [b, route] = await Promise.all([
      data.baseRevisionId ? api.GET('/route-revisions/{revisionId}', { params: { path: { revisionId: data.baseRevisionId } } }) : null,
      api.GET('/routes/{routeId}', { params: { path: { routeId: data.routeId } } }),
    ]);
    setBase(b?.data ?? null);
    setSlug(route.data?.slug ?? null);
    const ids = [...new Set([data.content.areaId, b?.data?.content.areaId].filter((x): x is string => !!x))];
    const areas = await Promise.all(ids.map((id) => api.GET('/areas/{areaId}', { params: { path: { areaId: id } } })));
    setAreaNames(Object.fromEntries(areas.flatMap((a) => (a.data ? [[a.data.id, [...a.data.ancestors.map((x) => locText(x.name, lang)), locText(a.data.name, lang)].join(' / ')]] : []))));
    setState('ready');
  }, [revisionId, lang]);

  useEffect(() => {
    if (session !== undefined) void load();
  }, [session, load]);

  if (state === 'loading') return <div className="page"><p className="muted">{t('common.loading')}</p></div>;
  if (state === 'missing' || !rev) return <div className="page"><p className="status-note">{t('rev.missing')}</p></div>;

  const act = async (action: 'approve' | 'reject' | 'revert') => {
    setMessage(null);
    if (action !== 'approve' && !note.trim()) {
      setMessage(t('rev.noteRequired'));
      return;
    }
    const opts = { params: { path: { revisionId: rev.id } } };
    const res =
      action === 'approve'
        ? await api.POST('/route-revisions/{revisionId}/approve', { ...opts, body: { note: note.trim() || undefined } })
        : action === 'reject'
          ? await api.POST('/route-revisions/{revisionId}/reject', { ...opts, body: { note: note.trim() } })
          : await api.POST('/route-revisions/{revisionId}/revert', { ...opts, body: { note: note.trim() } });
    if (res.data) {
      setNote('');
      if (action === 'revert') router.push(`/revisions/${res.data.id}`);
      else await load();
      router.refresh();
      return;
    }
    setMessage(res.error?.type === 'revision-stale' ? t('rev.stale') : (res.error?.detail ?? t('ed.saveFailed')));
  };

  const c = rev.content;
  const changes = base ? diff(base.content, c, lang, t, areaNames) : null;
  const statusText = rev.isCurrent ? t('rev.current') : t(`rev.status.${rev.status}`);

  return (
    <div className="page">
      <nav className="crumbs">
        {slug ? <Link href={`/routes/${slug}`}>{locText(c.name, lang)}</Link> : <span>{locText(c.name, lang)}</span>}
        <span className="sep">/</span>
        {slug && <><Link href={`/routes/${slug}/history`}>{t('rev.history')}</Link><span className="sep">/</span></>}
        <span aria-current="page">{t('route.revision')} #{rev.revisionNumber}</span>
      </nav>
      <div className="route-head">
        <div className="titles" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <h1 className="h1">{locText(c.name, lang)}</h1>
          <div className="row-gap" style={{ gap: '1.2rem', alignItems: 'center' }}>
            <span className={`pill${rev.status === 'pending' ? ' pill-blue' : ''}`}>{statusText}</span>
            <span className="muted">
              {rev.author.displayName} · {formatDate(rev.createdAt, lang)}
              {rev.revertedFromId && ` · ${t('rev.revertCopy')}`}
            </span>
          </div>
          {rev.changeSummary && <p className="prose" style={{ fontSize: '1.5rem' }}>«{rev.changeSummary}»</p>}
          {rev.reviewedBy && (
            <p className="muted">
              {t('rev.reviewedBy')} {rev.reviewedBy.displayName}
              {rev.reviewedAt && ` · ${formatDate(rev.reviewedAt, lang)}`}
              {rev.reviewNote && ` · «${rev.reviewNote}»`}
            </p>
          )}
        </div>
      </div>

      {(isModerator || session) && (
        <section className="form-section">
          {isModerator && rev.status === 'pending' && <p className="muted">{t('rev.moderateHint')}</p>}
          {isModerator && (rev.status === 'pending' || (rev.status === 'approved' && !rev.isCurrent)) && (
            <input className="input" maxLength={2000} placeholder={t('rev.notePlaceholder')} value={note} onChange={(e) => setNote(e.target.value)} />
          )}
          <div className="row-gap" style={{ gap: '1.2rem' }}>
            {isModerator && rev.status === 'pending' && (
              <>
                <button type="button" className="btn btn-primary" onClick={() => void act('approve')}>{t('rev.approve')}</button>
                <button type="button" className="btn btn-ghost" onClick={() => void act('reject')}>{t('rev.reject')}</button>
              </>
            )}
            {isModerator && rev.status === 'approved' && !rev.isCurrent && (
              <button type="button" className="btn btn-outline-blue" onClick={() => void act('revert')}>{t('rev.revert')}</button>
            )}
            {session && (rev.isCurrent || (rev.status === 'pending' && rev.author.id === session.user.id)) && (
              <Link className="btn btn-ghost" href={`/edit/routes/${rev.routeId}?from=${rev.id}`}>{t('rev.editFrom')}</Link>
            )}
          </div>
          {message && <p className="error-text" role="alert">{message}</p>}
        </section>
      )}

      <section className="form-section">
        <h2 className="h2">{t('rev.changes')}</h2>
        {!base ? (
          <p className="muted">{t('rev.firstRevision')}</p>
        ) : changes && changes.length > 0 ? (
          <table className="diff">
            <thead><tr><th>{t('rev.field')}</th><th>{t('rev.before')} (#{base.revisionNumber})</th><th>{t('rev.after')}</th></tr></thead>
            <tbody>
              {changes.map((ch) => (
                <tr key={ch.field}><td>{ch.field}</td><td className="old">{ch.before}</td><td className="new">{ch.after}</td></tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">{t('rev.noChanges')}</p>
        )}
      </section>

      <div className="route-cols">
        <div className="route-main">
          <section className="box">
            <dl className="facts">
              <dt>{t('ed.area')}</dt><dd>{areaNames[c.areaId] ?? c.areaId}</dd>
              <dt>{t('route.grades')}</dt><dd><Grades grades={c.grades} emptyLabel={t('route.noGrade')} /></dd>
              {factRows(c, lang, t).map(([k, v]) => <Row key={k} k={k} v={v} />)}
            </dl>
          </section>
          <section className="prose">
            <h2 className="h2">{t('route.description')}</h2>
            {c.description ? Object.entries(c.description).map(([l, text]) => (
              <p key={l} style={{ whiteSpace: 'pre-wrap' }}><span className="fallback-note">[{l}]</span> {text}</p>
            )) : <p className="muted">{t('route.noDescription')}</p>}
          </section>
        </div>
        <aside className="route-aside">
          <div className="route-map">
            {c.features?.length ? <RouteFeaturesMap features={c.features} /> : <p className="empty">{t('route.noGeometry')}</p>}
          </div>
        </aside>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return <><dt>{k}</dt><dd>{v}</dd></>;
}

function factRows(c: RouteContent, lang: Lang, t: Translate): [string, string][] {
  const nd = t('common.noData');
  const m = (v: number | null | undefined) => (v != null ? `${formatInt(v, lang)} ${t('common.m')}` : nd);
  return [
    [t('route.type'), c.routeType ? routeTypeLabel(c.routeType, lang) : nd],
    [t('route.traverse'), c.isTraverse == null ? nd : t(c.isTraverse ? 'route.yes' : 'route.no')],
    [t('route.gain'), m(c.elevationGainM)],
    [t('route.length'), m(c.lengthM)],
    [t('route.season'), c.seasonMonths?.length ? c.seasonMonths.map((x) => monthName(x, lang)).join(', ') : nd],
    [t('route.firstAscent'), c.firstAscentParty ?? nd],
    [t('route.firstAscentYear'), c.firstAscentYear?.toString() ?? nd],
    [t('route.sources'), c.dataSources ?? nd],
    [t('route.map'), `${c.features?.length ?? 0}`],
    [t('ed.descriptionPhotos'), `${c.photos?.length ?? 0}`],
  ];
}

/** Field-level comparison of two snapshots, in human terms. */
function diff(a: RouteContent, b: RouteContent, lang: Lang, t: Translate, areaNames: Record<string, string>) {
  const out: { field: string; before: string; after: string }[] = [];
  const text = (x: Record<string, string> | undefined) => (x ? Object.entries(x).map(([l, v]) => `[${l}] ${v}`).join('\n') : t('common.noData'));
  const grades = (g: RouteContent['grades']) => (g.length ? g.map((x) => `${x.system} ${x.value}`).join(', ') : t('route.noGrade'));
  const same = (x: unknown, y: unknown) => JSON.stringify(x ?? null) === JSON.stringify(y ?? null);

  if (a.areaId !== b.areaId) out.push({ field: t('ed.area'), before: areaNames[a.areaId] ?? a.areaId, after: areaNames[b.areaId] ?? b.areaId });
  if (!same(a.name, b.name)) out.push({ field: t('ed.name'), before: text(a.name), after: text(b.name) });
  if (!same(a.grades, b.grades)) out.push({ field: t('route.grades'), before: grades(a.grades), after: grades(b.grades) });
  const fa = factRows(a, lang, t);
  const fb = factRows(b, lang, t);
  fa.forEach(([k, v], i) => {
    if (k === t('route.map') || k === t('ed.descriptionPhotos')) return;
    if (v !== fb[i]?.[1]) out.push({ field: k, before: v, after: fb[i]?.[1] ?? '' });
  });
  if (!same(a.description, b.description)) out.push({ field: t('route.description'), before: text(a.description), after: text(b.description) });
  if (!same(a.features, b.features)) {
    out.push({ field: t('route.map'), before: `${a.features?.length ?? 0} ${t('rev.objects')}`, after: `${b.features?.length ?? 0} ${t('rev.objects')} · ${t('rev.geometryChanged')}` });
  }
  if (!same(a.photos, b.photos)) {
    out.push({
      field: t('ed.descriptionPhotos'),
      before: (a.photos ?? []).map((p) => loc(p.caption, lang)?.text ?? p.photoId.slice(0, 8)).join(', ') || t('rev.empty'),
      after: (b.photos ?? []).map((p) => loc(p.caption, lang)?.text ?? p.photoId.slice(0, 8)).join(', ') || t('rev.empty'),
    });
  }
  return out;
}
