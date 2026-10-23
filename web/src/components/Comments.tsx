'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, publicApi } from '@/lib/api/browser';
import type { components } from '@/lib/api/schema';
import { newId } from '@/lib/edit';
import { isModerator as hasModeratorRole } from '@/lib/api/types';
import { formatDate } from '@/lib/i18n';
import { checkFile, UPLOAD_LIMITS, UploadError, untilProcessed, uploadFile } from '@/lib/upload';
import { PhotoTopo } from './DescriptionPhotos';
import { Lightbox, type LightboxItem } from './Lightbox';
import { usePrefs } from './Prefs';

type Comment = components['schemas']['Comment'];

const PAGE = 50;
const MAX_PHOTOS = 10;

/**
 * Route discussion: comments oldest first, one level of replies, photos attached to a comment.
 * Participants' photos come in through here; the route gallery shows them all together.
 */
export function Comments({ routeId, initial, nextCursor }: { routeId: string; initial: Comment[]; nextCursor: string | null }) {
  const { t, session } = usePrefs();
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [cursor, setCursor] = useState(nextCursor);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const me = session?.user.id;
  const isModerator = hasModeratorRole(session?.user);

  // The server render is anonymous: the author also sees own photos that are still processing.
  useEffect(() => {
    if (!me) return;
    void api.GET('/routes/{routeId}/comments', { params: { path: { routeId }, query: { limit: PAGE } } })
      .then(({ data }) => { if (data) { setItems(data.items); setCursor(data.nextCursor ?? null); } });
  }, [me, routeId]);

  const more = async () => {
    if (!cursor) return;
    const { data } = await (me ? api : publicApi).GET('/routes/{routeId}/comments', { params: { path: { routeId }, query: { limit: PAGE, cursor } } });
    if (data) {
      setItems((xs) => [...xs, ...data.items.filter((x) => !xs.some((y) => y.id === x.id))]);
      setCursor(data.nextCursor ?? null);
    }
  };

  const upsert = (c: Comment) => setItems((xs) => (xs.some((x) => x.id === c.id) ? xs.map((x) => (x.id === c.id ? c : x)) : [...xs, c]));
  /**
   * Photos also show in the server-rendered gallery: refresh it when they change. A new comment
   * comes back before its photos are processed, so wait for them first.
   */
  const changed = (c: Comment, photosChanged: boolean) => {
    upsert(c);
    if (!photosChanged) return;
    const pending = c.photos.filter((p) => p.processingStatus === 'processing');
    if (!pending.length) { router.refresh(); return; }
    void Promise.all(pending.map((p) => untilProcessed(p, async () => (await api.GET('/photos/{photoId}', { params: { path: { photoId: p.id } } })).data)))
      .then((done) => {
        setItems((xs) => xs.map((x) => (x.id === c.id ? { ...x, photos: x.photos.map((p) => done.find((d) => d.id === p.id) ?? p) } : x)));
        router.refresh();
      });
  };

  const top = items.filter((c) => !c.parentId);
  const repliesOf = (id: string) => items.filter((c) => c.parentId === id);
  // A reply whose parent is not loaded yet (next page) is shown at the top level rather than lost.
  const orphans = items.filter((c) => c.parentId && !items.some((p) => p.id === c.parentId));

  return (
    <div className="comments">
      {items.length === 0 && session !== null && <p className="muted">{t('cm.none')}</p>}
      {[...top, ...orphans].map((c) => (
        <div key={c.id} className="comment-thread">
          <CommentItem comment={c} me={me} isModerator={isModerator} onChanged={changed}
            onReply={!c.parentId && !c.isDeleted && session ? () => setReplyTo(replyTo === c.id ? null : c.id) : undefined} />
          {(repliesOf(c.id).length > 0 || replyTo === c.id) && (
            <div className="comment-replies">
              {repliesOf(c.id).map((r) => <CommentItem key={r.id} comment={r} me={me} isModerator={isModerator} onChanged={changed} />)}
              {replyTo === c.id && (
                <Composer routeId={routeId} parentId={c.id} onPosted={(x) => { changed(x, x.photos.length > 0); setReplyTo(null); }}
                  onCancel={() => setReplyTo(null)} />
              )}
            </div>
          )}
        </div>
      ))}
      {cursor && <button type="button" className="btn btn-ghost" onClick={() => void more()}>{t('common.more')}</button>}
      {session ? (
        <Composer routeId={routeId} onPosted={(x) => changed(x, x.photos.length > 0)} />
      ) : session === null && (
        <p className="muted">{items.length === 0 && `${t('cm.none')} `}<a href="/login">{t('header.signIn')}</a> — {t('cm.signIn')}</p>
      )}
    </div>
  );
}

function CommentItem({
  comment, me, isModerator, onChanged, onReply,
}: {
  comment: Comment; me?: string; isModerator: boolean;
  onChanged: (c: Comment, photosChanged: boolean) => void; onReply?: () => void;
}) {
  const { t, lang } = usePrefs();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(comment.body ?? '');
  const [open, setOpen] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const own = !!me && comment.author.id === me;

  if (comment.isDeleted) {
    return <div className="comment deleted"><span className="muted">{t('cm.deleted')}</span></div>;
  }

  const save = async () => {
    setError(null);
    const { data, error: problem } = await api.PATCH('/comments/{commentId}', { params: { path: { commentId: comment.id } }, body: { body: text } });
    if (data) { onChanged(data, false); setEditing(false); } else setError(problem?.errors?.[0]?.message ?? problem?.detail ?? t('cm.failed'));
  };
  const remove = async () => {
    if (!window.confirm(comment.photos.length ? t('cm.deleteConfirmPhotos') : t('cm.deleteConfirm'))) return;
    const { response } = await api.DELETE('/comments/{commentId}', { params: { path: { commentId: comment.id } } });
    if (response.ok) onChanged({ ...comment, isDeleted: true, body: null, photos: [] }, comment.photos.length > 0);
  };

  // User content is not translated (contract): shown as written.
  const ready: LightboxItem[] = comment.photos.filter((p) => p.urls).map((photo) => ({ photo, caption: comment.body ?? null }));
  return (
    <div className="comment">
      <div className="comment-head">
        <b>{comment.author.displayName}</b>
        <span className="muted">{formatDate(comment.createdAt, lang)}{comment.editedAt && ` · ${t('cm.edited')}`}</span>
      </div>
      {editing ? (
        <div className="comment-edit">
          <textarea className="editor comment-input" maxLength={5000} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="row-gap" style={{ gap: '0.8rem' }}>
            <button type="button" className="btn btn-sm btn-primary" disabled={!text.trim()} onClick={() => void save()}>{t('cm.save')}</button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setEditing(false); setText(comment.body ?? ''); }}>{t('geo.cancel')}</button>
          </div>
        </div>
      ) : (
        <p className="comment-body">{comment.body}</p>
      )}
      {comment.photos.length > 0 && (
        <div className="comment-photos">
          {comment.photos.map((p) => {
            const i = ready.findIndex((x) => x.photo.id === p.id);
            return p.urls ? (
              <button key={p.id} type="button" className="topo-wrap" onClick={() => setOpen(i)} aria-label={t('cm.openPhoto')}>
                <img src={p.urls.thumbnail} alt="" loading="lazy" />
                {p.routeId && <PhotoTopo photo={p} routeId={p.routeId} strokeWidth={2} />}
              </button>
            ) : (
              <div key={p.id} className="ph-pending">{t(p.processingStatus === 'failed' ? 'ph.failedBadge' : 'ph.processingBadge')}</div>
            );
          })}
        </div>
      )}
      {error && <p className="error-text" role="alert">{error}</p>}
      {!editing && (onReply || own || isModerator) && (
        <div className="comment-actions">
          {onReply && <button type="button" className="link-btn" onClick={onReply}>{t('cm.reply')}</button>}
          {own && <button type="button" className="link-btn" onClick={() => setEditing(true)}>{t('cm.edit')}</button>}
          {(own || isModerator) && <button type="button" className="link-btn" onClick={() => void remove()}>{t('cm.delete')}</button>}
        </div>
      )}
      <Lightbox items={ready} index={open} onIndex={setOpen} routeId={comment.routeId ?? undefined} />
    </div>
  );
}

type Picked = { key: string; file: File; preview: string; photoId: string; uploaded: boolean; progress: number };

/**
 * New comment or reply. Photos are uploaded to the route first (pre-signed, straight to S3),
 * then the comment takes them by id. Ids are generated once, so pressing Send again after a
 * dropped connection repeats the same requests instead of duplicating anything.
 */
function Composer({
  routeId, parentId, onPosted, onCancel,
}: { routeId: string; parentId?: string; onPosted: (c: Comment) => void; onCancel?: () => void }) {
  const { t, lang } = usePrefs();
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<Picked[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const commentId = useRef(newId());

  useEffect(() => () => picked.forEach((p) => URL.revokeObjectURL(p.preview)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const add = (files: FileList | null) => {
    if (!files) return;
    const bad: string[] = [];
    const next: Picked[] = [];
    for (const file of Array.from(files)) {
      const problem = checkFile(file, 'photo');
      if (problem) { bad.push(`${file.name}: ${t(`ph.reject.${problem}`)}`); continue; }
      next.push({ key: newId(), file, preview: URL.createObjectURL(file), photoId: newId(), uploaded: false, progress: 0 });
    }
    setPicked((xs) => [...xs, ...next].slice(0, MAX_PHOTOS));
    setError(bad.length ? bad.join('; ') : picked.length + next.length > MAX_PHOTOS ? t('cm.tooManyPhotos') : null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      for (const p of picked) {
        if (p.uploaded) continue;
        const uploadId = await uploadFile(p.file, 'photo', (f) => setPicked((xs) => xs.map((x) => (x.key === p.key ? { ...x, progress: f } : x))));
        const res = await api.POST('/routes/{routeId}/photos', { params: { path: { routeId } }, body: { id: p.photoId, uploadId, kind: 'overview' } });
        if (!res.data) throw new UploadError(res.error?.detail ?? t('ph.failed'));
        setPicked((xs) => xs.map((x) => (x.key === p.key ? { ...x, uploaded: true, progress: 1 } : x)));
        p.uploaded = true;
      }
      const { data, error: problem } = await api.POST('/routes/{routeId}/comments', {
        params: { path: { routeId } },
        body: { id: commentId.current, body: text.trim(), parentId, language: lang, photoIds: picked.map((p) => p.photoId) },
      });
      if (!data) throw new UploadError(problem?.errors?.[0]?.message ?? problem?.detail ?? t('cm.failed'));
      picked.forEach((p) => URL.revokeObjectURL(p.preview));
      setPicked([]);
      setText('');
      commentId.current = newId();
      onPosted(data);
    } catch (err) {
      setError(err instanceof UploadError && err.message !== 'unsupported' ? err.message : t('cm.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={`comment-composer${parentId ? ' reply' : ''}`} onSubmit={(e) => void submit(e)}>
      <textarea className="editor comment-input" maxLength={5000} value={text} disabled={busy}
        placeholder={parentId ? t('cm.replyPlaceholder') : t('cm.placeholder')} onChange={(e) => setText(e.target.value)} />
      {picked.length > 0 && (
        <div className="comment-photos">
          {picked.map((p) => (
            <div key={p.key} className="picked">
              <img src={p.preview} alt="" />
              {busy && !p.uploaded && <div className="progress"><div style={{ width: `${Math.round(p.progress * 100)}%` }} /></div>}
              {!busy && !p.uploaded && (
                <button type="button" className="picked-remove" aria-label={t('geo.delete')}
                  onClick={() => { URL.revokeObjectURL(p.preview); setPicked((xs) => xs.filter((x) => x.key !== p.key)); }}>✕</button>
              )}
            </div>
          ))}
        </div>
      )}
      {error && <p className="error-text" role="alert">{error}</p>}
      <div className="row-gap" style={{ gap: '0.8rem', alignItems: 'center' }}>
        <button type="submit" className="btn btn-sm btn-primary" disabled={busy || !text.trim()}>{busy ? t('trk.uploading') : t('cm.send')}</button>
        <label className="file-pick" style={{ flexDirection: 'row' }}>
          <span className="btn btn-sm btn-ghost">📷 {t('cm.addPhotos')}</span>
          <input type="file" multiple accept={UPLOAD_LIMITS.photo.accept} disabled={busy || picked.length >= MAX_PHOTOS}
            onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
        </label>
        {onCancel && <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={onCancel}>{t('geo.cancel')}</button>}
      </div>
      {!parentId && <span className="field-hint">{t('cm.photosHint')}</span>}
    </form>
  );
}

