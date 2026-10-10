'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api/browser';
import type { Photo, PhotoKind } from '@/lib/api/types';
import { newId } from '@/lib/edit';
import { photoKindLabel } from '@/lib/i18n';
import { checkFile, UPLOAD_LIMITS, UploadError, untilProcessed, uploadFile } from '@/lib/upload';
import { usePrefs } from './Prefs';

const KINDS: PhotoKind[] = ['overview', 'topo', 'detail'];

type Item = {
  key: string;
  /** Client id of the photo: a retry after a dropped connection does not create a duplicate. */
  id: string;
  file: File;
  preview: string;
  kind: PhotoKind;
  caption: string;
  state: 'queued' | 'uploading' | 'processing' | 'done' | 'error';
  progress: number;
  error?: string;
};

/**
 * Photos of a route: pick several files, set type and caption for each, upload one by one.
 * Without [routeId] (a route being created) the photos are uploaded unattached (`POST /photos`)
 * and the new route takes them through its description.
 * Files go straight to S3 by pre-signed URL; the server makes EXIF-free derivatives.
 * [onAdded] gets every photo as soon as it exists and again once processing has finished.
 */
export function PhotoUpload({
  routeId, onAdded, defaultKind = 'overview', title,
}: { routeId?: string; onAdded: (p: Photo) => void; defaultKind?: PhotoKind; title?: string }) {
  const { t, lang } = usePrefs();
  const [items, setItems] = useState<Item[]>([]);
  const [rejected, setRejected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  // Object URLs of the previews are released when the queue changes or the form goes away.
  const previews = useRef(new Set<string>());
  useEffect(() => () => previews.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const patch = (key: string, p: Partial<Item>) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...p } : x)));
  const drop = (key: string) => setItems((xs) => {
    const it = xs.find((x) => x.key === key);
    if (it) { URL.revokeObjectURL(it.preview); previews.current.delete(it.preview); }
    return xs.filter((x) => x.key !== key);
  });

  const add = (files: FileList | null) => {
    if (!files) return;
    const bad: string[] = [];
    const next: Item[] = [];
    for (const file of Array.from(files)) {
      const problem = checkFile(file, 'photo');
      if (problem) { bad.push(`${file.name}: ${t(`ph.reject.${problem}`)}`); continue; }
      const preview = URL.createObjectURL(file);
      previews.current.add(preview);
      next.push({ key: newId(), id: newId(), file, preview, kind: defaultKind, caption: '', state: 'queued', progress: 0 });
    }
    setRejected(bad);
    setItems((xs) => [...xs, ...next]);
  };

  const uploadOne = async (it: Item) => {
    patch(it.key, { state: 'uploading', progress: 0, error: undefined });
    try {
      const uploadId = await uploadFile(it.file, 'photo', (f) => patch(it.key, { progress: f }));
      const caption = it.caption.trim();
      const body = { id: it.id, uploadId, kind: it.kind, caption: caption || undefined, captionLanguage: caption ? lang : undefined };
      const { data, error } = routeId
        ? await api.POST('/routes/{routeId}/photos', { params: { path: { routeId } }, body })
        : await api.POST('/photos', { body });
      if (!data) throw new UploadError(error?.errors?.[0]?.message ?? error?.detail ?? t('ph.failed'));
      onAdded(data);
      patch(it.key, { state: 'processing' });
      const done = await untilProcessed(data, async () =>
        (await api.GET('/photos/{photoId}', { params: { path: { photoId: it.id } } })).data);
      onAdded(done);
      if (done.processingStatus === 'failed') patch(it.key, { state: 'error', error: t('ph.processingFailed') });
      else drop(it.key); // ready, or still processing on the server: it is in the gallery either way
    } catch (e) {
      patch(it.key, { state: 'error', error: e instanceof UploadError && e.message !== 'unsupported' ? e.message : t('ph.failed') });
    }
  };

  const uploadAll = async () => {
    setBusy(true);
    // Sequential: parallel PUTs of 10+ large photos choke a mountain-hut connection.
    for (const it of items.filter((x) => x.state === 'queued' || x.state === 'error')) await uploadOne(it);
    setBusy(false);
  };

  const pending = items.filter((x) => x.state === 'queued' || x.state === 'error').length;
  return (
    <div className="box photo-upload">
      <b>{title ?? t('ph.upload')}</b>
      <label className="file-pick">
        <span className="btn btn-sm btn-outline-blue">{t('ph.pick')}</span>
        <input type="file" multiple accept={UPLOAD_LIMITS.photo.accept} disabled={busy}
          onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
      </label>
      {rejected.map((r) => <p key={r} className="error-text">{r}</p>)}

      {items.length > 0 && (
        <div className="pu-list">
          {items.map((it) => (
            <div key={it.key} className="pu-item">
              <img src={it.preview} alt="" />
              <div className="pu-fields">
                <span className="pu-name">{it.file.name} · {(it.file.size / 1024 / 1024).toFixed(1)} {t('ph.mb')}</span>
                <div className="chips">
                  {KINDS.map((k) => (
                    <button key={k} type="button" className="chip" aria-pressed={it.kind === k} disabled={it.state !== 'queued' && it.state !== 'error'}
                      onClick={() => patch(it.key, { kind: k })}>{photoKindLabel(k, lang)}</button>
                  ))}
                </div>
                <input className="input" maxLength={1000} value={it.caption} placeholder={t('ph.captionPlaceholder')}
                  disabled={it.state !== 'queued' && it.state !== 'error'}
                  onChange={(e) => patch(it.key, { caption: e.target.value })} />
                {it.state === 'uploading' && <div className="progress"><div style={{ width: `${Math.round(it.progress * 100)}%` }} /></div>}
                {it.state === 'processing' && <span className="muted">{t('ph.processing')}</span>}
                {it.error && <span className="error-text" role="alert">{it.error}</span>}
              </div>
              {(it.state === 'queued' || it.state === 'error') && !busy && (
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => drop(it.key)}>{t('geo.delete')}</button>
              )}
            </div>
          ))}
        </div>
      )}

      {pending > 0 && (
        <button type="button" className="btn btn-primary" disabled={busy} style={{ alignSelf: 'flex-start' }} onClick={() => void uploadAll()}>
          {busy ? t('trk.uploading') : `${t('ph.uploadSubmit')} · ${pending}`}
        </button>
      )}
      <span className="field-hint">{t('ph.privacy')}</span>
    </div>
  );
}
