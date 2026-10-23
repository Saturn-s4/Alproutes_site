'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api/browser';
import type { components } from '@/lib/api/schema';
import type { Document, Photo, RightsStatus } from '@/lib/api/types';
import { isModerator as hasModeratorRole } from '@/lib/api/types';
import { currentTopo, type TopoLine } from '@/lib/topo';
import { formatDate, loc, locText, rightsLabel, sourceTypeLabel } from '@/lib/i18n';
import { usePrefs } from '../Prefs';
import { TopoOverlay } from '../TopoOverlay';
import { SignInFirst } from './Fields';

type RevisionSummary = components['schemas']['RouteRevisionSummary'];
type Pending = RevisionSummary & { routeName: string; isNew: boolean };
type PendingTopo = { line: TopoLine; photo: Photo | null; routeName: string; routeSlug: string | null };

const RIGHTS: RightsStatus[] = ['public_domain', 'licensed', 'permission_granted', 'own_work', 'restricted', 'unknown'];
const PUBLISHABLE: RightsStatus[] = ['public_domain', 'licensed', 'permission_granted', 'own_work'];

/** Moderator's desk: route edits and topo lines waiting for review, documents waiting for a rights decision. */
export function ModerationQueue() {
  const { t, lang, session } = usePrefs();
  const [revisions, setRevisions] = useState<Pending[] | null>(null);
  const [documents, setDocuments] = useState<Document[] | null>(null);
  const [topos, setTopos] = useState<PendingTopo[] | null>(null);
  const isModerator = hasModeratorRole(session?.user);

  const load = useCallback(async () => {
    const [revs, docs, lines] = await Promise.all([
      api.GET('/moderation/route-revisions', { params: { query: { limit: 50 } } }),
      api.GET('/moderation/documents', { params: { query: { limit: 50 } } }),
      api.GET('/moderation/topo-lines', { params: { query: { limit: 50 } } }),
    ]);
    setTopos(await Promise.all(
      (lines.data?.items ?? []).map(async (line) => {
        const [photo, route] = await Promise.all([
          api.GET('/photos/{photoId}', { params: { path: { photoId: line.photoId } } }),
          api.GET('/routes/{routeId}', { params: { path: { routeId: line.routeId } } }),
        ]);
        return { line, photo: photo.data ?? null, routeName: route.data ? locText(route.data.name, lang) : line.routeId, routeSlug: route.data?.slug ?? null };
      }),
    ));
    // The queue gives summaries only; names come from each revision (the queue is short).
    const full = await Promise.all(
      (revs.data?.items ?? []).map(async (r) => {
        const rev = await api.GET('/route-revisions/{revisionId}', { params: { path: { revisionId: r.id } } });
        return { ...r, routeName: rev.data ? locText(rev.data.content.name, lang) : r.routeId, isNew: !r.baseRevisionId };
      }),
    );
    setRevisions(full);
    setDocuments(docs.data?.items ?? []);
  }, [lang]);

  useEffect(() => {
    if (isModerator) void load();
  }, [isModerator, load]);

  if (!session) return <SignInFirst />;
  if (!isModerator) return <div className="page"><p className="status-note">{t('ed.moderatorsOnly')}</p></div>;

  return (
    <div className="page">
      <h1 className="h1">{t('mod.title')}</h1>
      <section className="route-section">
        <h2 className="h2">{t('mod.revisions')} · <span className="mono">{revisions?.length ?? '…'}</span></h2>
        {revisions?.length === 0 && <p className="muted">{t('mod.noRevisions')}</p>}
        <div className="list-rows">
          {revisions?.map((r) => (
            <Link key={r.id} href={`/revisions/${r.id}`} className="route-row">
              <span className="badge badge-text">{r.isNew ? t('mod.new') : `#${r.revisionNumber}`}</span>
              <span className="body">
                <span className="peak">{r.routeName}</span>
                <span className="name">{r.changeSummary ?? t('rev.noSummary')}</span>
                <span className="meta"><span>{r.author.displayName}</span><span>{formatDate(r.createdAt, lang)}</span></span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className="route-section">
        <h2 className="h2">{t('mod.topoLines')} · <span className="mono">{topos?.length ?? '…'}</span></h2>
        {topos?.length === 0 && <p className="muted">{t('mod.noTopoLines')}</p>}
        <div className="topo-queue">
          {topos?.map((x) => <TopoReview key={x.line.id} item={x} onDone={() => void load()} />)}
        </div>
      </section>

      <section className="route-section">
        <h2 className="h2">{t('mod.documents')} · <span className="mono">{documents?.length ?? '…'}</span></h2>
        {documents?.length === 0 && <p className="muted">{t('mod.noDocuments')}</p>}
        {documents?.map((d) => <DocumentRights key={d.id} doc={d} onDone={() => void load()} />)}
      </section>
      <p className="muted" style={{ fontSize: '1.2rem' }}>{t('mod.rightsRule')}</p>
    </div>
  );
}

function DocumentRights({ doc, onDone }: { doc: Document; onDone: () => void }) {
  const { t, lang } = usePrefs();
  const [status, setStatus] = useState<RightsStatus>(doc.rightsStatus);
  const [note, setNote] = useState(doc.rightsNote ?? '');
  const [error, setError] = useState<string | null>(null);

  const save = async (visible: boolean) => {
    setError(null);
    const { data, error: problem } = await api.PUT('/documents/{documentId}/rights', {
      params: { path: { documentId: doc.id } },
      body: { rightsStatus: status, rightsNote: note.trim() || null, visibility: visible ? 'visible' : 'hidden' },
    });
    if (data) onDone();
    else setError(problem?.errors?.map((e) => e.message).join('; ') ?? problem?.detail ?? t('ed.saveFailed'));
  };

  return (
    <div className="box">
      <div className="pdf-row">
        <span className="pdf-icon">PDF</span>
        <span className="t">
          <span>{loc(doc.title, lang)?.text}</span>
          <span>
            {sourceTypeLabel(doc.sourceType, lang)}
            {doc.year != null && ` · ${doc.year}`} · {doc.uploadedBy?.displayName} · {formatDate(doc.createdAt, lang)}
          </span>
        </span>
        <a className="btn btn-sm btn-ghost" href={`/api/v1/documents/${doc.id}/download`} target="_blank" rel="noreferrer">{t('doc.open')}</a>
      </div>
      <p className="doc-source">{t('doc.source')}: {doc.sourceDescription}</p>
      <div className="chips">
        {RIGHTS.map((r) => (
          <button key={r} type="button" className="chip chip-lg" aria-pressed={status === r} onClick={() => setStatus(r)}>{rightsLabel(r, lang)}</button>
        ))}
      </div>
      <input className="input" maxLength={2000} placeholder={t('mod.rightsNote')} value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="row-gap" style={{ gap: '1.2rem' }}>
        <button type="button" className="btn btn-primary" disabled={!PUBLISHABLE.includes(status)} onClick={() => void save(true)}>{t('mod.publish')}</button>
        <button type="button" className="btn btn-ghost" onClick={() => void save(false)}>{t('mod.keepHidden')}</button>
      </div>
      {error && <p className="error-text" role="alert">{error}</p>}
    </div>
  );
}

/** A proposed line next to the current one on the same photo. */
function TopoReview({ item, onDone }: { item: PendingTopo; onDone: () => void }) {
  const { t, lang } = usePrefs();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { line, photo } = item;
  const current = photo ? currentTopo(photo, line.routeId) : undefined;

  const decide = async (approve: boolean) => {
    setError(null);
    const path = { params: { path: { topoLineId: line.id } } };
    const res = approve
      ? await api.POST('/topo-lines/{topoLineId}/approve', { ...path, body: { note: note.trim() || undefined } })
      : await api.POST('/topo-lines/{topoLineId}/reject', { ...path, body: { note: note.trim() } });
    if (res.data) onDone();
    else setError(res.error?.type === 'revision-stale' ? t('mod.topoStale') : res.error?.errors?.map((e) => e.message).join('; ') ?? res.error?.detail ?? t('ed.saveFailed'));
  };

  const view = (drawingOf: TopoLine | undefined, label: string) => (
    <figure className="topo-review-photo">
      <div className="topo-wrap">
        {photo?.urls ? <img src={photo.urls.medium} alt="" /> : <div className="ph-pending">{t('ph.processingBadge')}</div>}
        {photo?.widthPx && photo.heightPx && drawingOf && (
          <TopoOverlay drawing={drawingOf.drawing} width={photo.widthPx} height={photo.heightPx} />
        )}
      </div>
      <figcaption className="muted">{label}</figcaption>
    </figure>
  );

  return (
    <div className="box">
      <div>
        {item.routeSlug ? <Link href={`/routes/${item.routeSlug}`}><b>{item.routeName}</b></Link> : <b>{item.routeName}</b>}
        <span className="muted"> · {t('mod.topoVersion')} {line.version} · {line.author.displayName} · {formatDate(line.createdAt, lang)}</span>
      </div>
      <div className="topo-review">
        {view(line, line.drawing.paths.length ? t('mod.topoProposed') : t('mod.topoRemoval'))}
        {current && view(current, `${t('mod.topoCurrent')} (${current.version})`)}
      </div>
      <input className="input" maxLength={2000} placeholder={t('mod.topoNote')} value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="row-gap" style={{ gap: '1.2rem' }}>
        <button type="button" className="btn btn-primary" onClick={() => void decide(true)}>{t('mod.approve')}</button>
        <button type="button" className="btn btn-ghost" disabled={!note.trim()} onClick={() => void decide(false)}>{t('mod.reject')}</button>
      </div>
      {error && <p className="error-text" role="alert">{error}</p>}
    </div>
  );
}
