'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '@/lib/api/browser';
import type { Document, LocalizedText, RightsStatus, SourceType } from '@/lib/api/types';
import { cleanText, fieldErrors, intOrNull, type FieldErrors } from '@/lib/edit';
import { loc, rightsLabel, sourceTypeLabel } from '@/lib/i18n';
import { checkFile, UPLOAD_LIMITS, UploadError, uploadFile } from '@/lib/upload';
import { Field, LocalizedInput } from './edit/Fields';
import { usePrefs } from './Prefs';

const SOURCE_TYPES: SourceType[] = ['classifier', 'ascent_report', 'guidebook', 'periodical', 'other'];
const CLAIMABLE: RightsStatus[] = ['unknown', 'public_domain', 'licensed', 'permission_granted', 'own_work'];

/**
 * Archival PDFs. The public only gets documents with a cleared rights status (the API filters);
 * the uploader and moderators also see the ones awaiting review, without the viewer.
 * The browser's own PDF viewer shows the file: the download endpoint redirects to a short-lived link.
 * Uploading ([withUpload]) is part of route editing only, not of the public route page.
 */
export function Documents({
  routeId, documents: initial, withUpload = false,
}: { routeId: string; documents: Document[]; withUpload?: boolean }) {
  const { t, lang, session } = usePrefs();
  const [documents, setDocuments] = useState(initial);
  const [open, setOpen] = useState<string | null>(null);
  const me = session?.user.id;

  // The server render is anonymous: re-read with the token to include own documents under review.
  useEffect(() => {
    if (!me) return;
    void api.GET('/routes/{routeId}/documents', { params: { path: { routeId }, query: { limit: 50 } } })
      .then(({ data }) => data && setDocuments(data.items));
  }, [me, routeId]);

  return (
    <div className="docs">
      {documents.length === 0 && <p className="muted">{t('doc.none')}</p>}
      {documents.map((d) => {
        const href = `/api/v1/documents/${d.id}/download`;
        const title = loc(d.title, lang)?.text;
        const published = d.visibility === 'visible';
        const meta = [
          sourceTypeLabel(d.sourceType, lang),
          d.year != null ? String(d.year) : null,
          d.pageCount != null ? `${d.pageCount} ${t('doc.pages')}` : null,
          rightsLabel(d.rightsStatus, lang),
        ].filter(Boolean);
        return (
          <div key={d.id} className="doc">
            <div className="pdf-row">
              <span className="pdf-icon">PDF</span>
              <span className="t">
                <span>{title}</span>
                <span>{meta.join(' · ')}</span>
              </span>
              {published && (
                <>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-blue"
                    aria-expanded={open === d.id}
                    onClick={() => setOpen(open === d.id ? null : d.id)}
                  >
                    {open === d.id ? t('doc.close') : t('doc.open')}
                  </button>
                  <a className="btn btn-sm btn-ghost" href={href} target="_blank" rel="noreferrer">
                    {t('doc.download')}
                  </a>
                </>
              )}
            </div>
            {!published && (
              <p className="status-note">{d.rightsStatus !== 'unknown' ? t('doc.hiddenBadge') : d.uploadedBy?.id === me ? t('doc.pendingReview') : t('doc.pendingReviewOther')}</p>
            )}
            <p className="doc-source">
              {t('doc.source')}: {d.sourceDescription}
              {d.rightsNote ? ` · ${d.rightsNote}` : null}
            </p>
            {open === d.id && published && <iframe className="pdf-frame" src={href} title={title} />}
          </div>
        );
      })}
      {withUpload && session && (
        <DocumentUpload routeId={routeId} onAdded={(d) => setDocuments((xs) => [d, ...xs.filter((x) => x.id !== d.id)])} />
      )}
    </div>
  );
}

function DocumentUpload({ routeId, onAdded }: { routeId: string; onAdded: (d: Document) => void }) {
  const { t, lang } = usePrefs();
  const fileRef = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState<LocalizedText>({});
  const [sourceType, setSourceType] = useState<SourceType | null>(null);
  const [sourceDescription, setSourceDescription] = useState('');
  const [year, setYear] = useState('');
  const [claimed, setClaimed] = useState<RightsStatus>('unknown');
  const [rightsNote, setRightsNote] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const reset = () => {
    setFile(null); setTitle({}); setSourceType(null); setSourceDescription(''); setYear('');
    setClaimed('unknown'); setRightsNote(''); setErrors({});
    if (fileRef.current) fileRef.current.value = '';
  };

  const pick = (f: File | null) => {
    setError(null);
    setDone(false);
    if (f) {
      const problem = checkFile(f, 'document');
      if (problem) { setError(t(`doc.reject.${problem}`)); setFile(null); if (fileRef.current) fileRef.current.value = ''; return; }
    }
    setFile(f);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file || !sourceType) return;
    const cleanTitle = cleanText(title);
    if (!cleanTitle) { setErrors({ title: t('doc.titleRequired') }); return; }
    setErrors({});
    setError(null);
    setProgress(0);
    try {
      const uploadId = await uploadFile(file, 'document', setProgress);
      const { data, error: problem } = await api.POST('/routes/{routeId}/documents', {
        params: { path: { routeId } },
        body: {
          uploadId,
          title: cleanTitle,
          sourceType,
          sourceDescription: sourceDescription.trim(),
          year: intOrNull(year) ?? undefined,
          claimedRightsStatus: claimed,
          rightsNote: rightsNote.trim() || undefined,
        },
      });
      if (!data) {
        setErrors(fieldErrors(problem));
        if (!problem?.errors?.length) setError(problem?.detail ?? t('doc.failed'));
        return;
      }
      onAdded(data);
      reset();
      setDone(true);
      setExpanded(false);
    } catch (err) {
      setError(err instanceof UploadError && err.message !== 'unsupported' ? err.message : t('doc.failed'));
    } finally {
      setProgress(null);
    }
  };

  if (!expanded) {
    return (
      <div className="row-gap" style={{ gap: '1rem', alignItems: 'center' }}>
        <button type="button" className="btn btn-sm btn-outline-blue" onClick={() => { setExpanded(true); setDone(false); }}>{t('doc.upload')}</button>
        {done && <span className="muted">{t('doc.uploaded')}</span>}
      </div>
    );
  }

  const busy = progress != null;
  return (
    <form className="box doc-upload" onSubmit={(e) => void submit(e)}>
      <div className="row-gap" style={{ gap: '1rem', alignItems: 'center', justifyContent: 'space-between' }}>
        <b>{t('doc.upload')}</b>
        <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => { reset(); setExpanded(false); }}>{t('geo.cancel')}</button>
      </div>
      <label className="file-pick">
        <span className="btn btn-sm btn-outline-blue">{file ? file.name : t('doc.pick')}</span>
        <input ref={fileRef} type="file" accept={UPLOAD_LIMITS.document.accept} disabled={busy}
          onChange={(e) => pick(e.target.files?.[0] ?? null)} />
      </label>
      <Field label={t('doc.title')} hint={t('doc.titleHint')} error={errors.title ? [errors.title] : undefined}>
        <LocalizedInput value={title} onChange={setTitle} maxLength={300} />
      </Field>
      <Field label={t('doc.sourceType')} error={errors.sourceType ? [errors.sourceType] : undefined}>
        <div className="chips">
          {SOURCE_TYPES.map((s) => (
            <button key={s} type="button" className="chip" aria-pressed={sourceType === s} onClick={() => setSourceType(s)}>
              {sourceTypeLabel(s, lang)}
            </button>
          ))}
        </div>
      </Field>
      <Field label={t('doc.sourceDescription')} hint={t('doc.sourceDescriptionHint')}
        error={errors.sourceDescription ? [errors.sourceDescription] : undefined}>
        <textarea className="editor" style={{ height: '6rem', borderRadius: '0.8rem' }} required maxLength={2000}
          value={sourceDescription} onChange={(e) => setSourceDescription(e.target.value)} />
      </Field>
      <Field label={t('doc.year')} error={errors.year ? [errors.year] : undefined}>
        <input className="input" type="number" min={1800} max={2100} style={{ width: '12rem' }} value={year}
          onChange={(e) => setYear(e.target.value)} />
      </Field>
      <Field label={t('doc.claimedRights')} hint={t('doc.claimedRightsHint')}
        error={errors.claimedRightsStatus ? [errors.claimedRightsStatus] : undefined}>
        <div className="chips">
          {CLAIMABLE.map((r) => (
            <button key={r} type="button" className="chip" aria-pressed={claimed === r} onClick={() => setClaimed(r)}>
              {rightsLabel(r, lang)}
            </button>
          ))}
        </div>
      </Field>
      <Field label={t('doc.rightsNote')} hint={t('doc.rightsNoteHint')} error={errors.rightsNote ? [errors.rightsNote] : undefined}>
        <input className="input" maxLength={2000} value={rightsNote} onChange={(e) => setRightsNote(e.target.value)} />
      </Field>
      {busy && <div className="progress"><div style={{ width: `${Math.round(progress * 100)}%` }} /></div>}
      {error && <p className="error-text" role="alert">{error}</p>}
      <button type="submit" className="btn btn-primary" style={{ alignSelf: 'flex-start' }}
        disabled={busy || !file || !sourceType || !sourceDescription.trim()}>
        {busy ? t('trk.uploading') : t('doc.submit')}
      </button>
    </form>
  );
}
