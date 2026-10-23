'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, publicApi } from '@/lib/api/browser';
import type { components } from '@/lib/api/schema';
import { newId } from '@/lib/edit';
import { formatDate } from '@/lib/i18n';
import type { Lang } from '@/lib/prefs';
import { checkFile, UPLOAD_LIMITS, UploadError, untilProcessed, uploadFile } from '@/lib/upload';
import { PhotoTopo } from './DescriptionPhotos';
import { Lightbox, type LightboxItem } from './Lightbox';
import { usePrefs } from './Prefs';
import { isModerator as hasModeratorRole } from '@/lib/api/types';

type Ascent = components['schemas']['Ascent'];
type AscentFields = components['schemas']['AscentFields'];
type Member = components['schemas']['AscentMember'];
type Precision = AscentFields['datePrecision'];

const PAGE = 20;
const MAX_PHOTOS = 20;

/** "15 июля 2025", "июль 2025" or "2025": an old ascent is often known only that precisely. */
function ascentDateLabel(a: Pick<Ascent, 'ascentDate' | 'datePrecision'>, lang: Lang): string {
  if (a.datePrecision === 'year') return a.ascentDate.slice(0, 4);
  if (a.datePrecision === 'month') {
    return new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${a.ascentDate}T00:00:00Z`));
  }
  return formatDate(a.ascentDate, lang);
}

function durationLabel(minutes: number, t: (k: 'asc.h' | 'asc.min') => string): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h ? `${h} ${t('asc.h')}` : null, m ? `${m} ${t('asc.min')}` : null].filter(Boolean).join(' ');
}

/**
 * Ascents of this route: records by climbers who did it (or turned back), newest first.
 * Private records are shown to their author only.
 */
export function Ascents({ routeId, initial, nextCursor }: { routeId: string; initial: Ascent[]; nextCursor: string | null }) {
  const { t, session } = usePrefs();
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [cursor, setCursor] = useState(nextCursor);
  const [editing, setEditing] = useState<Ascent | 'new' | null>(null);
  const me = session?.user.id;
  const isModerator = hasModeratorRole(session?.user);

  // The server render is anonymous: the author also gets own private records.
  useEffect(() => {
    if (!me) return;
    void api.GET('/routes/{routeId}/ascents', { params: { path: { routeId }, query: { limit: PAGE } } })
      .then(({ data }) => { if (data) { setItems(data.items); setCursor(data.nextCursor ?? null); } });
  }, [me, routeId]);

  const more = async () => {
    if (!cursor) return;
    const { data } = await (me ? api : publicApi).GET('/routes/{routeId}/ascents', { params: { path: { routeId }, query: { limit: PAGE, cursor } } });
    if (data) {
      setItems((xs) => [...xs, ...data.items.filter((x) => !xs.some((y) => y.id === x.id))]);
      setCursor(data.nextCursor ?? null);
    }
  };

  const saved = (a: Ascent) => {
    setItems((xs) => [a, ...xs.filter((x) => x.id !== a.id)].sort((p, q) => q.ascentDate.localeCompare(p.ascentDate)));
    setEditing(null);
    // Counters and the gallery are server-rendered.
    router.refresh();
  };

  return (
    <div className="ascents">
      {session && editing === null && (
        <button type="button" className="btn btn-sm btn-outline-blue" style={{ alignSelf: 'flex-start' }} onClick={() => setEditing('new')}>
          + {t('asc.add')}
        </button>
      )}
      {session === null && (
        <p className="muted">{items.length === 0 && `${t('asc.none')} `}<a href="/login">{t('header.signIn')}</a> — {t('asc.signIn')}</p>
      )}
      {editing === 'new' && <AscentForm routeId={routeId} onSaved={saved} onCancel={() => setEditing(null)} />}
      {items.length === 0 && editing !== 'new' && session !== null && <p className="muted">{t('asc.none')}</p>}
      {items.map((a) => (editing !== 'new' && editing?.id === a.id ? (
        <AscentForm key={a.id} routeId={routeId} ascent={a} onSaved={saved} onCancel={() => setEditing(null)} />
      ) : (
        <AscentCard key={a.id} ascent={a} own={a.user.id === me} canDelete={a.user.id === me || isModerator}
          onEdit={() => setEditing(a)}
          onDeleted={() => { setItems((xs) => xs.filter((x) => x.id !== a.id)); router.refresh(); }} />
      )))}
      {cursor && <button type="button" className="btn btn-ghost" onClick={() => void more()}>{t('common.more')}</button>}
    </div>
  );
}

function AscentCard({
  ascent: a, own, canDelete, onEdit, onDeleted,
}: { ascent: Ascent; own: boolean; canDelete: boolean; onEdit: () => void; onDeleted: () => void }) {
  const { t, lang } = usePrefs();
  const [open, setOpen] = useState<number | null>(null);
  const [showReport, setShowReport] = useState(false);
  const remove = async () => {
    if (!window.confirm(a.photos.length ? t('asc.deleteConfirmPhotos') : t('asc.deleteConfirm'))) return;
    const { response } = await api.DELETE('/ascents/{ascentId}', { params: { path: { ascentId: a.id } } });
    if (response.ok) onDeleted();
  };
  const members = a.members ?? [];
  const ready: LightboxItem[] = a.photos.filter((p) => p.urls).map((photo) => ({ photo, caption: photo.caption ?? null }));

  // User content is not translated (contract): shown as written.
  return (
    <article className="ascent">
      <div className="ascent-head">
        <span className="ascent-date">{ascentDateLabel(a, lang)}</span>
        {a.outcome && <span className={`ascent-outcome ${a.outcome}`}>{a.outcome === 'summit' ? `✓ ${t('asc.summit')}` : t('asc.retreat')}</span>}
        {a.isPrivate && <span className="ascent-private">{t('asc.privateBadge')}</span>}
        <span className="muted">{a.user.displayName}</span>
      </div>
      {(members.length > 0 || a.totalTimeMinutes) && (
        <dl className="ascent-facts">
          {members.length > 0 && (
            <div>
              <dt>{t('asc.team')}</dt>
              <dd>{members.map((m) => `${m.user?.displayName ?? m.name}${m.isLeader ? ` (${t('asc.leaderShort')})` : ''}`).join(', ')}</dd>
            </div>
          )}
          {a.totalTimeMinutes ? <div><dt>{t('asc.time')}</dt><dd>{durationLabel(a.totalTimeMinutes, t)}</dd></div> : null}
        </dl>
      )}
      {a.conditions && <p className="ascent-text"><b>{t('asc.conditions')}:</b> {a.conditions}</p>}
      {a.report && (
        <>
          <button type="button" className="link-btn" onClick={() => setShowReport(!showReport)}>
            {showReport ? t('asc.hideReport') : t('asc.showReport')}
          </button>
          {showReport && <p className="ascent-text">{a.report}</p>}
        </>
      )}
      {a.photos.length > 0 && (
        <div className="comment-photos">
          {a.photos.map((p) => {
            const i = ready.findIndex((x) => x.photo.id === p.id);
            return p.urls ? (
              <button key={p.id} type="button" className="topo-wrap" onClick={() => setOpen(i)} aria-label={t('cm.openPhoto')}>
                <img src={p.urls.thumbnail} alt="" loading="lazy" />
                <PhotoTopo photo={p} routeId={a.routeId} strokeWidth={2} />
              </button>
            ) : (
              <div key={p.id} className="ph-pending">{t(p.processingStatus === 'failed' ? 'ph.failedBadge' : 'ph.processingBadge')}</div>
            );
          })}
        </div>
      )}
      {(own || canDelete) && (
        <div className="comment-actions">
          {own && <button type="button" className="link-btn" onClick={onEdit}>{t('cm.edit')}</button>}
          {canDelete && <button type="button" className="link-btn" onClick={() => void remove()}>{t('cm.delete')}</button>}
        </div>
      )}
      <Lightbox items={ready} index={open} onIndex={setOpen} routeId={a.routeId} />
    </article>
  );
}

type Picked = { key: string; file: File; preview: string; photoId: string; uploaded: boolean };

/**
 * Create or replace a record (PUT replaces it whole, members included). New photos are uploaded
 * after the record is saved, since a photo points at its ascent. Ids are generated once, so
 * pressing Save again after a dropped connection repeats the same requests.
 */
function AscentForm({
  routeId, ascent, onSaved, onCancel,
}: { routeId: string; ascent?: Ascent; onSaved: (a: Ascent) => void; onCancel: () => void }) {
  const { t, lang } = usePrefs();
  const id = useRef(ascent?.id ?? newId());
  const [created, setCreated] = useState(!!ascent);
  const [precision, setPrecision] = useState<Precision>(ascent?.datePrecision ?? 'day');
  const [date, setDate] = useState(ascent?.ascentDate ?? '');
  const [outcome, setOutcome] = useState<AscentFields['outcome']>(ascent?.outcome ?? null);
  const [hours, setHours] = useState(ascent?.totalTimeMinutes ? String(Math.floor(ascent.totalTimeMinutes / 60)) : '');
  const [mins, setMins] = useState(ascent?.totalTimeMinutes ? String(ascent.totalTimeMinutes % 60) : '');
  const [conditions, setConditions] = useState(ascent?.conditions ?? '');
  const [report, setReport] = useState(ascent?.report ?? '');
  const [members, setMembers] = useState<Member[]>(ascent?.members ?? []);
  const [isPrivate, setIsPrivate] = useState(ascent?.isPrivate ?? false);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => () => picked.forEach((p) => URL.revokeObjectURL(p.preview)), []); // eslint-disable-line react-hooks/exhaustive-deps

  /** The date input value for the chosen precision → an ISO date (the server normalizes to the period start). */
  const isoDate = (): string | null => {
    if (precision === 'year') return /^\d{4}$/.test(date) ? `${date}-01-01` : null;
    if (precision === 'month') return /^\d{4}-\d{2}/.test(date) ? `${date.slice(0, 7)}-01` : null;
    return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
  };
  const inputValue = precision === 'year' ? date.slice(0, 4) : precision === 'month' ? date.slice(0, 7) : date;

  const add = (files: FileList | null) => {
    if (!files) return;
    const bad: string[] = [];
    const next: Picked[] = [];
    for (const file of Array.from(files)) {
      const problem = checkFile(file, 'photo');
      if (problem) { bad.push(`${file.name}: ${t(`ph.reject.${problem}`)}`); continue; }
      next.push({ key: newId(), file, preview: URL.createObjectURL(file), photoId: newId(), uploaded: false });
    }
    setPicked((xs) => [...xs, ...next].slice(0, MAX_PHOTOS));
    setError(bad.length ? bad.join('; ') : null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const d = isoDate();
    if (!d) { setError(t('asc.dateRequired')); return; }
    const total = (Number(hours) || 0) * 60 + (Number(mins) || 0);
    const fields: AscentFields = {
      ascentDate: d,
      datePrecision: precision,
      outcome,
      totalTimeMinutes: total > 0 ? total : null,
      conditions: conditions.trim() || null,
      report: report.trim() || null,
      language: lang,
      isPrivate,
      members: members.filter((m) => m.userId || m.name?.trim()).map((m) => ({ userId: m.userId ?? null, name: m.name?.trim() || null, isLeader: !!m.isLeader })),
    };
    setBusy(true);
    setError(null);
    try {
      const res = created
        ? await api.PUT('/ascents/{ascentId}', { params: { path: { ascentId: id.current } }, body: fields })
        : await api.POST('/routes/{routeId}/ascents', { params: { path: { routeId } }, body: { ...fields, id: id.current } });
      if (!res.data) throw new UploadError(res.error?.errors?.map((x) => x.message).join('; ') ?? res.error?.detail ?? t('asc.failed'));
      setCreated(true);
      for (const p of picked) {
        if (p.uploaded) continue;
        const uploadId = await uploadFile(p.file, 'photo');
        const ph = await api.POST('/routes/{routeId}/photos', { params: { path: { routeId } }, body: { id: p.photoId, uploadId, kind: 'detail', ascentId: id.current } });
        if (!ph.data) throw new UploadError(ph.error?.detail ?? t('ph.failed'));
        p.uploaded = true;
        await untilProcessed(ph.data, async () => (await api.GET('/photos/{photoId}', { params: { path: { photoId: p.photoId } } })).data);
      }
      const fresh = await api.GET('/ascents/{ascentId}', { params: { path: { ascentId: id.current } } });
      onSaved(fresh.data ?? res.data);
    } catch (err) {
      setError(err instanceof UploadError && err.message !== 'unsupported' ? err.message : t('asc.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="box ascent-form" onSubmit={(e) => void submit(e)}>
      <b>{ascent ? t('asc.editTitle') : t('asc.add')}</b>
      <div className="ascent-form-row">
        <div className="field">
          <span>{t('asc.date')}</span>
          <div className="row-gap" style={{ gap: '0.8rem', alignItems: 'center' }}>
            {precision === 'day' && <input className="input" type="date" max={today} value={inputValue} onChange={(e) => setDate(e.target.value)} />}
            {precision === 'month' && <input className="input" type="month" max={today.slice(0, 7)} value={inputValue} onChange={(e) => setDate(e.target.value)} />}
            {precision === 'year' && (
              <input className="input" type="number" min={1850} max={Number(today.slice(0, 4))} style={{ width: '10rem' }} value={inputValue}
                onChange={(e) => setDate(e.target.value)} />
            )}
            <div className="chips">
              {(['day', 'month', 'year'] as Precision[]).map((p) => (
                <button key={p} type="button" className="chip" aria-pressed={precision === p} onClick={() => setPrecision(p)}>{t(`asc.precision.${p}`)}</button>
              ))}
            </div>
          </div>
          <span className="field-hint">{t('asc.precisionHint')}</span>
        </div>
      </div>
      <div className="ascent-form-row">
        <div className="field">
          <span>{t('asc.outcome')}</span>
          <div className="chips">
            <button type="button" className="chip chip-lg" aria-pressed={outcome === 'summit'} onClick={() => setOutcome('summit')}>✓ {t('asc.summit')}</button>
            <button type="button" className="chip chip-lg" aria-pressed={outcome === 'retreat'} onClick={() => setOutcome('retreat')}>{t('asc.retreat')}</button>
            <button type="button" className="chip chip-lg chip-dashed" aria-pressed={outcome === null} onClick={() => setOutcome(null)}>{t('common.noData')}</button>
          </div>
        </div>
        <div className="field">
          <span>{t('asc.time')}</span>
          <div className="row-gap" style={{ gap: '0.6rem', alignItems: 'center' }}>
            <input className="input" type="number" min={0} max={1440} style={{ width: '8rem' }} value={hours} onChange={(e) => setHours(e.target.value)} />
            <span>{t('asc.h')}</span>
            <input className="input" type="number" min={0} max={59} style={{ width: '8rem' }} value={mins} onChange={(e) => setMins(e.target.value)} />
            <span>{t('asc.min')}</span>
          </div>
        </div>
      </div>
      <div className="field">
        <span>{t('asc.team')}</span>
        {members.map((m, i) => (
          <div key={i} className="row-gap" style={{ gap: '0.8rem', alignItems: 'center' }}>
            {m.userId ? <span className="input" style={{ display: 'flex', alignItems: 'center' }}>{m.user?.displayName}</span> : (
              <input className="input" maxLength={200} placeholder={t('asc.memberName')} value={m.name ?? ''}
                onChange={(e) => setMembers((xs) => xs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            )}
            <label className="check-row" style={{ margin: 0 }}>
              <input type="checkbox" checked={!!m.isLeader} onChange={(e) => setMembers((xs) => xs.map((x, j) => (j === i ? { ...x, isLeader: e.target.checked } : x)))} />
              <span className="t">{t('asc.leader')}</span>
            </label>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setMembers((xs) => xs.filter((_, j) => j !== i))}>{t('geo.delete')}</button>
          </div>
        ))}
        {members.length < 30 && (
          <button type="button" className="btn btn-sm btn-ghost" style={{ alignSelf: 'flex-start' }}
            onClick={() => setMembers((xs) => [...xs, { name: '', isLeader: false }])}>+ {t('asc.addMember')}</button>
        )}
        <span className="field-hint">{t('asc.teamHint')}</span>
      </div>
      <label className="field">
        {t('asc.conditions')}
        <textarea className="editor" style={{ height: '7rem', borderRadius: '0.8rem' }} maxLength={5000} value={conditions}
          placeholder={t('asc.conditionsPlaceholder')} onChange={(e) => setConditions(e.target.value)} />
      </label>
      <label className="field">
        {t('asc.report')}
        <textarea className="editor" style={{ height: '12rem', borderRadius: '0.8rem' }} maxLength={20000} value={report}
          placeholder={t('asc.reportPlaceholder')} onChange={(e) => setReport(e.target.value)} />
      </label>
      <div className="field">
        <span>{t('asc.photos')}</span>
        {picked.length > 0 && (
          <div className="comment-photos">
            {picked.map((p) => (
              <div key={p.key} className="picked">
                <img src={p.preview} alt="" />
                {!busy && !p.uploaded && (
                  <button type="button" className="picked-remove" aria-label={t('geo.delete')}
                    onClick={() => { URL.revokeObjectURL(p.preview); setPicked((xs) => xs.filter((x) => x.key !== p.key)); }}>✕</button>
                )}
              </div>
            ))}
          </div>
        )}
        <label className="file-pick">
          <span className="btn btn-sm btn-ghost">📷 {t('asc.addPhotos')}</span>
          <input type="file" multiple accept={UPLOAD_LIMITS.photo.accept} disabled={busy} onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
        </label>
      </div>
      <label className="check-row">
        <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
        <span className="t">{t('asc.private')}</span>
      </label>
      {error && <p className="error-text" role="alert">{error}</p>}
      <div className="row-gap" style={{ gap: '1rem' }}>
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? t('trk.uploading') : t('asc.save')}</button>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={onCancel}>{t('geo.cancel')}</button>
      </div>
    </form>
  );
}
