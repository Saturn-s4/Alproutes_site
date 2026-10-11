'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '@/lib/api/browser';
import type { AreaSummary, Grade, LocalizedText, Photo, RouteContentPhoto, RouteFeature, RouteType } from '@/lib/api/types';
import { cleanText, errorsUnder, fieldErrors, intOrNull, newId, type FieldErrors } from '@/lib/edit';
import { uploadFile } from '@/lib/upload';
import { monthName, routeTypeLabel } from '@/lib/i18n';
import { Documents } from '../Documents';
import { PhotoUpload } from '../PhotoUpload';
import { usePrefs } from '../Prefs';
import { TopoOverlay } from '../TopoOverlay';
import { currentTopo, type TopoDrawing } from '@/lib/topo';
import { Field, GradesEditor, LocalizedInput, SignInFirst, AreaPicker } from './Fields';
import { GeometryEditor } from './GeometryEditor';
import { TopoEditor } from './TopoEditor';

const ROUTE_TYPES: RouteType[] = ['rock', 'snow_ice', 'combined'];

type Form = {
  area: AreaSummary | null;
  name: LocalizedText;
  description: LocalizedText;
  grades: Grade[];
  routeType: RouteType | null;
  isTraverse: boolean | null;
  elevationGainM: string;
  lengthM: string;
  seasonMonths: number[];
  firstAscentParty: string;
  firstAscentYear: string;
  dataSources: string;
  features: RouteFeature[];
  photos: RouteContentPhoto[];
};

/**
 * A route line drawn on a description photo. Topo versions are separate from route revisions
 * (contract proposeTopoLine), so they are sent after the route itself is saved.
 */
type TopoEdit = { drawing: TopoDrawing | null; baseVersionId: string | null; dirty: boolean; pending: boolean };

const emptyForm: Form = {
  area: null, name: {}, description: {}, grades: [], routeType: null, isTraverse: null, elevationGainM: '', lengthM: '',
  seasonMonths: [], firstAscentParty: '', firstAscentYear: '', dataSources: '', features: [], photos: [],
};

type Target = { kind: 'create'; areaId?: string } | { kind: 'edit'; routeId: string; fromRevisionId?: string };

/** Create a route or propose an edit: always a full snapshot (contract RouteContent). */
export function RouteEditor({ target }: { target: Target }) {
  const { t, lang, session } = usePrefs();
  const router = useRouter();
  const [form, setForm] = useState<Form>(emptyForm);
  const [baseRevisionId, setBaseRevisionId] = useState<string | null>(null);
  const [routePhotos, setRoutePhotos] = useState<Photo[]>([]);
  const [summary, setSummary] = useState('');
  const [slug, setSlug] = useState('');
  const [publish, setPublish] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<{ text: string; link?: string } | null>(null);
  const [loading, setLoading] = useState(target.kind === 'edit');
  const [busy, setBusy] = useState(false);
  /** New route only: GPX/KML files to upload as its tracks right after it is created. */
  const [pendingTracks, setPendingTracks] = useState<File[]>([]);
  const [topo, setTopo] = useState<Record<string, TopoEdit>>({});
  const isModerator = session?.user.role === 'moderator' || session?.user.role === 'admin';

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    const loadArea = async (id: string) => (await api.GET('/areas/{areaId}', { params: { path: { areaId: id } } })).data ?? null;

    if (target.kind === 'create') {
      if (target.areaId) void loadArea(target.areaId).then((a) => !cancelled && a && set('area', a));
      return;
    }
    void (async () => {
      const { routeId, fromRevisionId } = target;
      // The base must be the published revision, or the latest one while the route is still a draft.
      const [current, latest] = await Promise.all([
        api.GET('/routes/{routeId}', { params: { path: { routeId } } }),
        api.GET('/routes/{routeId}/revisions', { params: { path: { routeId }, query: { limit: 1 } } }),
      ]);
      const base = current.data?.currentRevision.id ?? latest.data?.items[0]?.id ?? null;
      const source = fromRevisionId
        ? (await api.GET('/route-revisions/{revisionId}', { params: { path: { revisionId: fromRevisionId } } })).data?.content
        : current.data;
      const photos = await api.GET('/routes/{routeId}/photos', { params: { path: { routeId }, query: { limit: 100 } } });
      if (cancelled) return;
      if (!source || !base) {
        setMessage({ text: t('ed.loadFailed') });
        setLoading(false);
        return;
      }
      const area = await loadArea(source.areaId);
      if (cancelled) return;
      setBaseRevisionId(base);
      setRoutePhotos(photos.data?.items ?? []);
      setForm({
        area,
        name: source.name,
        description: source.description ?? {},
        grades: source.grades,
        routeType: source.routeType ?? null,
        isTraverse: source.isTraverse ?? null,
        elevationGainM: source.elevationGainM?.toString() ?? '',
        lengthM: source.lengthM?.toString() ?? '',
        seasonMonths: source.seasonMonths ?? [],
        firstAscentParty: source.firstAscentParty ?? '',
        firstAscentYear: source.firstAscentYear?.toString() ?? '',
        dataSources: source.dataSources ?? '',
        features: source.features ?? [],
        photos: source.photos ?? [],
      });
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  if (!session) return <SignInFirst />;
  if (loading) return <div className="page"><p className="muted">{t('common.loading')}</p></div>;

  const err = (path: string) => errorsUnder(errors, path);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);
    // Client-side checks for what the user can fix right here; the server re-validates everything.
    const local: FieldErrors = {};
    if (!form.area) local['content.areaId'] = t('ed.areaRequired');
    if (!cleanText(form.name)) local['content.name'] = t('ed.nameRequired');
    form.grades.forEach((g, i) => {
      if (!g.value) local[`content.grades[${i}].value`] = t('ed.gradeValueRequired');
    });
    if (Object.keys(local).length) {
      setErrors(local);
      return;
    }
    const content = {
      areaId: form.area!.id,
      name: cleanText(form.name)!,
      description: cleanText(form.description),
      grades: form.grades,
      routeType: form.routeType ?? undefined,
      isTraverse: form.isTraverse,
      elevationGainM: intOrNull(form.elevationGainM),
      lengthM: intOrNull(form.lengthM),
      seasonMonths: form.seasonMonths.length ? [...form.seasonMonths].sort((a, b) => a - b) : null,
      firstAscentParty: form.firstAscentParty.trim() || null,
      firstAscentYear: intOrNull(form.firstAscentYear),
      dataSources: form.dataSources.trim() || null,
      features: form.features,
      photos: form.photos.map((p) => ({ photoId: p.photoId, caption: cleanText(p.caption) })),
    };
    setBusy(true);
    const res =
      target.kind === 'create'
        ? await api.POST('/routes', {
            body: { content, slug: slug.trim() || undefined, changeSummary: summary.trim() || undefined, publish: isModerator && publish },
          })
        : await api.POST('/routes/{routeId}/revisions', {
            params: { path: { routeId: target.routeId } },
            body: { baseRevisionId: baseRevisionId!, content, changeSummary: summary.trim() || undefined, publish: isModerator && publish },
          });
    if (res.data) {
      const rev = res.data;
      // Tracks need the route to exist: upload the files picked in the form now.
      const failed: string[] = [];
      failed.push(...(await saveTopo(rev.routeId)));
      for (const file of pendingTracks) {
        try {
          const uploadId = await uploadFile(file, 'track');
          const created = await api.POST('/routes/{routeId}/tracks', { params: { path: { routeId: rev.routeId } }, body: { id: newId(), uploadId } });
          if (!created.data) failed.push(`${t('trk.track')} ${file.name}`);
        } catch {
          failed.push(`${t('trk.track')} ${file.name}`);
        }
      }
      setBusy(false);
      if (failed.length) {
        // The route itself is saved; say which files did not make it instead of losing them silently.
        setMessage({ text: `${t('ed.savedWithErrors')}: ${failed.join('; ')}`, link: `/revisions/${rev.id}` });
        return;
      }
      if (rev.status === 'approved') {
        const route = await api.GET('/routes/{routeId}', { params: { path: { routeId: rev.routeId } } });
        router.push(route.data ? `/routes/${route.data.slug}` : `/revisions/${rev.id}`);
      } else {
        router.push(`/revisions/${rev.id}`);
      }
      router.refresh();
      return;
    }
    setBusy(false);
    const problem = res.error;
    setErrors(fieldErrors(problem));
    if (problem?.type === 'revision-conflict') {
      setMessage({ text: t('ed.conflict'), link: problem.currentRevisionId ? `/revisions/${problem.currentRevisionId}` : undefined });
    } else {
      setMessage({ text: problem?.detail ?? problem?.title ?? t('ed.saveFailed') });
    }
  };

  /** Proposes every changed drawing of a photo still in the description; returns what failed. */
  const saveTopo = async (routeId: string): Promise<string[]> => {
    const failed: string[] = [];
    const publishNow = isModerator && publish;
    for (const [photoId, edit] of Object.entries(topo)) {
      if (!edit.dirty || !edit.drawing || !form.photos.some((x) => x.photoId === photoId)) continue;
      const photo = routePhotos.find((x) => x.id === photoId);
      const label = `${t('topo.title')} (${photo?.caption ?? photoId.slice(0, 8)})`;
      // The contract draws on topo photos only: the author (or a moderator) switches the type first.
      if (photo && photo.kind !== 'topo') {
        const patched = await api.PATCH('/photos/{photoId}', { params: { path: { photoId } }, body: { kind: 'topo' } });
        if (!patched.data) { failed.push(`${label}: ${patched.error?.detail ?? t('topo.failed')}`); continue; }
      }
      const res = await api.POST('/photos/{photoId}/topo-lines/{routeId}/versions', {
        params: { path: { photoId, routeId } },
        body: { baseVersionId: edit.baseVersionId, drawing: edit.drawing, publish: publishNow },
      });
      if (!res.data) failed.push(`${label}: ${res.error?.type === 'revision-conflict' ? t('topo.conflict') : res.error?.detail ?? t('topo.failed')}`);
    }
    return failed;
  };

  const center = form.area?.center?.coordinates as [number, number] | undefined;

  return (
    <form className="page edit-page" onSubmit={(e) => void submit(e)} noValidate>
      <h1 className="h1">{target.kind === 'create' ? t('ed.newRoute') : t('ed.editRoute')}</h1>
      <p className="dev-box">{t('ed.factsRule')}</p>

      <section className="form-section">
        <h2 className="h2">{t('ed.main')}</h2>
        <Field label={t('ed.area')} error={err('content.areaId')}>
          <AreaPicker value={form.area} onChange={(a) => set('area', a)} />
        </Field>
        <Field label={t('ed.name')} error={err('content.name')}>
          <LocalizedInput value={form.name} onChange={(v) => set('name', v)} maxLength={200} required />
        </Field>
        {target.kind === 'create' && (
          <Field label={t('ed.slug')} hint={t('ed.slugHint')} error={err('slug')}>
            <input className="input mono" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="dykh-tau-mummery" />
          </Field>
        )}
        <Field label={t('route.grades')} hint={t('ed.gradesHint')} error={err('content.grades').filter((m) => !/^\[\d+\]/.test(m))}>
          <GradesEditor value={form.grades} onChange={(g) => set('grades', g)} errors={(i) => err(`content.grades[${i}]`).map((m) => m.replace(/^(value|system): /, ''))} />
        </Field>
      </section>

      <section className="form-section">
        <h2 className="h2">{t('ed.facts')}</h2>
        <div className="grid3">
          <Field label={t('route.type')} error={err('content.routeType')}>
            <div className="chips">
              <button type="button" className="chip chip-lg" aria-pressed={form.routeType === null} onClick={() => set('routeType', null)}>{t('common.noData')}</button>
              {ROUTE_TYPES.map((rt) => (
                <button key={rt} type="button" className="chip chip-lg" aria-pressed={form.routeType === rt} onClick={() => set('routeType', rt)}>{routeTypeLabel(rt, lang)}</button>
              ))}
            </div>
          </Field>
          <Field label={t('route.traverse')}>
            <div className="chips">
              {([null, true, false] as const).map((v) => (
                <button key={String(v)} type="button" className="chip chip-lg" aria-pressed={form.isTraverse === v} onClick={() => set('isTraverse', v)}>
                  {v === null ? t('common.noData') : t(v ? 'route.yes' : 'route.no')}
                </button>
              ))}
            </div>
          </Field>
          <Field label={`${t('route.gain')}, ${t('common.m')}`} error={err('content.elevationGainM')}>
            <input className="input mono" type="number" min={1} max={8999} placeholder={t('common.noData')} value={form.elevationGainM}
              onChange={(e) => set('elevationGainM', e.target.value)} />
          </Field>
          <Field label={`${t('route.length')}, ${t('common.m')}`} error={err('content.lengthM')}>
            <input className="input mono" type="number" min={1} placeholder={t('common.noData')} value={form.lengthM}
              onChange={(e) => set('lengthM', e.target.value)} />
          </Field>
          <Field label={t('route.firstAscentYear')} error={err('content.firstAscentYear')}>
            <input className="input mono" type="number" min={1700} max={2100} placeholder={t('common.noData')} value={form.firstAscentYear}
              onChange={(e) => set('firstAscentYear', e.target.value)} />
          </Field>
          <Field label={t('route.firstAscent')} error={err('content.firstAscentParty')}>
            <input className="input" maxLength={1000} placeholder={t('common.noData')} value={form.firstAscentParty}
              onChange={(e) => set('firstAscentParty', e.target.value)} />
          </Field>
        </div>
        <Field label={t('route.season')} hint={t('ed.seasonHint')} error={err('content.seasonMonths')}>
          <div className="chips">
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <button key={m} type="button" className="chip chip-lg" aria-pressed={form.seasonMonths.includes(m)}
                onClick={() => set('seasonMonths', form.seasonMonths.includes(m) ? form.seasonMonths.filter((x) => x !== m) : [...form.seasonMonths, m])}>
                {monthName(m, lang)}
              </button>
            ))}
          </div>
        </Field>
        <Field label={t('route.sources')} hint={t('ed.sourcesHint')} error={err('content.dataSources')}>
          <textarea className="editor" style={{ height: '8rem', borderRadius: '0.8rem' }} maxLength={2000} value={form.dataSources}
            onChange={(e) => set('dataSources', e.target.value)} />
        </Field>
      </section>

      <section className="form-section">
        <h2 className="h2">{t('route.description')}</h2>
        <Field label={t('route.description')} error={err('content.description')}>
          <LocalizedInput value={form.description} onChange={(v) => set('description', v)} multiline maxLength={100000} />
        </Field>
      </section>

      <section className="form-section">
        <h2 className="h2">{t('ed.photos')}</h2>
        <PhotosField
          value={form.photos}
          onChange={(p) => set('photos', p)}
          photos={routePhotos}
          errors={err('content.photos')}
          routeId={target.kind === 'edit' ? target.routeId : undefined}
          topo={topo}
          onTopo={(photoId, edit) => setTopo((x) => ({ ...x, [photoId]: edit }))}
          canDraw={(p) => p.kind === 'topo' || p.author.id === session.user.id || isModerator}
          onUploaded={(p) => {
            setRoutePhotos((xs) => [p, ...xs.filter((x) => x.id !== p.id)]);
            // A new upload goes into the description right away; the second callback (processing done) does not duplicate it.
            setForm((f) => (f.photos.some((x) => x.photoId === p.id) ? f : {
              ...f,
              photos: [...f.photos, { photoId: p.id, caption: p.caption && p.captionLanguage ? { [p.captionLanguage]: p.caption } : undefined }],
            }));
          }}
        />
      </section>

      {target.kind === 'edit' && (
        <section className="form-section">
          <h2 className="h2">{t('route.archive')}</h2>
          <p className="field-hint">{t('ed.documentsHint')}</p>
          <Documents routeId={target.routeId} documents={[]} withUpload />
        </section>
      )}

      <section className="form-section">
        <h2 className="h2">{t('route.map')}</h2>
        {err('content.features').map((m) => <span key={m} className="field-error">{m}</span>)}
        <GeometryEditor
          value={form.features}
          onChange={(f) => set('features', f)}
          center={center}
          routeId={target.kind === 'edit' ? target.routeId : undefined}
          onTrackFile={target.kind === 'create' ? (f) => setPendingTracks((x) => [...x.filter((y) => y.name !== f.name), f]) : undefined}
        />
        {pendingTracks.length > 0 && (
          <div className="pending-tracks">
            <span className="field-hint">{t('ed.pendingTracks')}</span>
            {pendingTracks.map((f) => (
              <span key={f.name} className="chip chip-lg">
                {f.name}
                <button type="button" className="linklike" aria-label={t('geo.delete')}
                  onClick={() => setPendingTracks((x) => x.filter((y) => y !== f))}>✕</button>
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="form-section">
        <Field label={t('ed.summary')} error={err('changeSummary')}>
          <input className="input" maxLength={500} placeholder={t('ed.summaryHint')} value={summary} onChange={(e) => setSummary(e.target.value)} />
        </Field>
        {isModerator && (
          <label className="check-row">
            <input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} />
            <span className="t">{t('ed.publishNow')}</span>
          </label>
        )}
        {message && (
          <p className="error-text" role="alert">
            {message.text} {message.link && <Link href={message.link}>{t('ed.seeCurrent')}</Link>}
          </p>
        )}
        {Object.keys(errors).length > 0 && !message && <p className="error-text" role="alert">{t('ed.fixErrors')}</p>}
        <div className="row-gap" style={{ gap: '1.2rem' }}>
          <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>
            {isModerator && publish ? t('ed.savePublish') : t('ed.submit')}
          </button>
          <button type="button" className="btn btn-ghost btn-lg" onClick={() => router.back()}>{t('geo.cancel')}</button>
        </div>
      </section>
    </form>
  );
}

/**
 * Photos of the description, in order, with catalogue captions; the first one is the cover.
 * Editing a route: pick from the route photos or upload new ones to it.
 * Creating one: uploads stay unattached until the route is saved and takes them.
 */
function PhotosField({
  value, onChange, photos, errors, routeId, onUploaded, topo, onTopo, canDraw,
}: {
  value: RouteContentPhoto[]; onChange: (v: RouteContentPhoto[]) => void; photos: Photo[]; errors: string[];
  routeId?: string; onUploaded: (p: Photo) => void;
  topo: Record<string, TopoEdit>; onTopo: (photoId: string, edit: TopoEdit) => void; canDraw: (p: Photo) => boolean;
}) {
  const { t } = usePrefs();
  const [drawing, setDrawing] = useState<{ photo: Photo; edit: TopoEdit } | null>(null);

  /** The base of a new version: the current approved one, or the latest one while none is approved. */
  const openTopo = async (p: Photo) => {
    const known = topo[p.id];
    if (known) { setDrawing({ photo: p, edit: known }); return; }
    if (!routeId) { setDrawing({ photo: p, edit: { drawing: null, baseVersionId: null, dirty: false, pending: false } }); return; }
    const { data } = await api.GET('/photos/{photoId}/topo-lines/{routeId}/versions', { params: { path: { photoId: p.id, routeId }, query: { limit: 20 } } });
    const items = data?.items ?? [];
    const current = items.find((x) => x.isCurrent);
    const latest = items[0];
    // The server expects the current version as the base, or the latest one while none is approved.
    const base = current ?? latest;
    setDrawing({
      photo: p,
      edit: {
        drawing: current?.drawing ?? latest?.drawing ?? null,
        baseVersionId: base?.id ?? null,
        dirty: false,
        pending: !!latest && latest.status === 'pending',
      },
    });
  };
  const byId = new Map(photos.map((p) => [p.id, p]));
  const available = photos.filter((p) => p.urls && !value.some((v) => v.photoId === p.id));
  const move = (i: number, to: number) => {
    if (to < 0 || to >= value.length) return;
    const next = [...value];
    const [item] = next.splice(i, 1);
    next.splice(to, 0, item!);
    onChange(next);
  };
  const remove = (i: number) => {
    const ref = value[i]!;
    onChange(value.filter((_, j) => j !== i));
    // An unattached upload of a route being created is of no use once taken out: delete it.
    if (!routeId) void api.DELETE('/photos/{photoId}', { params: { path: { photoId: ref.photoId } } });
  };
  return (
    <Field label={t('ed.descriptionPhotos')} hint={t('ed.descriptionPhotosHint')} error={errors}>
      <div className="dp-list">
        {value.map((ref, i) => {
          const p = byId.get(ref.photoId);
          return (
            <div key={ref.photoId} className={`dp-item${i === 0 ? ' cover' : ''}`}>
              <div className="dp-thumb">
                {p?.urls ? <img src={p.urls.thumbnail} alt="" /> : <span className="row-thumb">{p ? t('ph.processingBadge') : ''}</span>}
                {p?.urls && p.widthPx && p.heightPx && (() => {
                  const d = topo[p.id]?.drawing ?? currentTopo(p, routeId)?.drawing;
                  return d ? <TopoOverlay drawing={d} width={p.widthPx} height={p.heightPx} strokeWidth={2} cover /> : null;
                })()}
                {i === 0 && <span className="dp-cover">{t('ed.cover')}</span>}
              </div>
              <div className="dp-fields">
                <LocalizedInput value={ref.caption ?? {}} maxLength={1000}
                  onChange={(c) => onChange(value.map((x, j) => (j === i ? { ...x, caption: c } : x)))} />
                <span className="muted">{p ? `${p.author.displayName}${p.caption ? ` · ${p.caption}` : ''}` : t('ed.photoUnavailable')}</span>
                {p && (
                  <div className="dp-topo">
                    <button type="button" className="btn btn-sm btn-outline-blue" disabled={!p.urls || !p.widthPx || !canDraw(p)}
                      title={!p.urls ? t('topo.notReady') : !canDraw(p) ? t('topo.cantEdit') : undefined}
                      onClick={() => void openTopo(p)}>
                      {topo[p.id]?.drawing?.paths.length || currentTopo(p, routeId) ? t('topo.editButton') : t('topo.drawButton')}
                    </button>
                    {topo[p.id]?.dirty && (
                      <span className="field-hint">{topo[p.id]?.drawing?.paths.length ? t('topo.changed') : t('topo.removed')}</span>
                    )}
                    {!topo[p.id]?.dirty && topo[p.id]?.pending && <span className="field-hint">{t('topo.pendingNote')}</span>}
                  </div>
                )}
              </div>
              <div className="dp-actions">
                {i > 0 && <button type="button" className="btn btn-sm btn-outline-blue" onClick={() => move(i, 0)}>{t('ed.makeCover')}</button>}
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label={t('geo.up')}>↑</button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => move(i, i + 1)} disabled={i === value.length - 1} aria-label={t('geo.down')}>↓</button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => remove(i)}>{t('geo.delete')}</button>
              </div>
            </div>
          );
        })}
      </div>
      {value.length === 0 && <span className="muted">{t('ed.noDescriptionPhotos')}</span>}
      {available.length > 0 && (
        <>
          <span className="field-hint">{t('ed.addFromGallery')}</span>
          <div className="dp-pick">
            {available.map((p) => (
              <button key={p.id} type="button" title={p.caption ?? p.author.displayName}
                onClick={() => onChange([...value, { photoId: p.id, caption: p.caption && p.captionLanguage ? { [p.captionLanguage]: p.caption } : undefined }])}>
                <img src={p.urls!.thumbnail} alt={p.caption ?? ''} />
              </button>
            ))}
          </div>
        </>
      )}
      <PhotoUpload routeId={routeId} onAdded={onUploaded} title={t('ph.uploadToDescription')} />
      {drawing && (
        <TopoEditor
          photo={drawing.photo}
          initial={drawing.edit.drawing}
          onClose={() => setDrawing(null)}
          onSave={(d) => {
            const hadLine = !!drawing.edit.drawing?.paths.length || !!currentTopo(drawing.photo, routeId);
            // Nothing drawn and nothing to remove: no version to send.
            if (d.paths.length || hadLine) onTopo(drawing.photo.id, { ...drawing.edit, drawing: d, dirty: true });
            setDrawing(null);
          }}
        />
      )}
      <span className="field-hint">{routeId ? t('ph.uploadToDescriptionHint') : t('ph.uploadToNewRouteHint')}</span>
    </Field>
  );
}
