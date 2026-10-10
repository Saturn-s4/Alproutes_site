'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '@/lib/api/browser';
import type { AreaSummary, Grade, LocalizedText, Photo, RouteContentPhoto, RouteFeature, RouteType } from '@/lib/api/types';
import { cleanText, errorsUnder, fieldErrors, intOrNull, newId, type FieldErrors } from '@/lib/edit';
import { uploadFile } from '@/lib/upload';
import { monthName, routeTypeLabel } from '@/lib/i18n';
import { PhotoUpload } from '../PhotoUpload';
import { usePrefs } from '../Prefs';
import { Field, GradesEditor, LocalizedInput, SignInFirst, AreaPicker } from './Fields';
import { GeometryEditor } from './GeometryEditor';

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
      for (const file of pendingTracks) {
        try {
          const uploadId = await uploadFile(file, 'track');
          const created = await api.POST('/routes/{routeId}/tracks', { params: { path: { routeId: rev.routeId } }, body: { id: newId(), uploadId } });
          if (!created.data) failed.push(file.name);
        } catch {
          failed.push(file.name);
        }
      }
      setBusy(false);
      if (failed.length) {
        // The route itself is saved; say which files did not make it instead of losing them silently.
        setMessage({ text: `${t('ed.tracksFailed')}: ${failed.join(', ')}`, link: `/revisions/${rev.id}` });
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
        {target.kind === 'edit' ? (
          <DescriptionPhotosField value={form.photos} onChange={(p) => set('photos', p)} photos={routePhotos} errors={err('content.photos')}
            routeId={target.routeId} onUploaded={(p) => {
              setRoutePhotos((xs) => [p, ...xs.filter((x) => x.id !== p.id)]);
              // A new upload goes into the description right away; repeated callbacks (processing done) do not duplicate it.
              setForm((f) => (f.photos.some((x) => x.photoId === p.id) ? f : { ...f, photos: [...f.photos, { photoId: p.id }] }));
            }} />
        ) : (
          <p className="muted">{t('ed.photosAfterCreate')}</p>
        )}
      </section>

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

/** Which route photos are part of the description, in which order, with catalogue captions. */
function DescriptionPhotosField({
  value, onChange, photos, errors, routeId, onUploaded,
}: {
  value: RouteContentPhoto[]; onChange: (v: RouteContentPhoto[]) => void; photos: Photo[]; errors: string[];
  routeId: string; onUploaded: (p: Photo) => void;
}) {
  const { t } = usePrefs();
  const byId = new Map(photos.map((p) => [p.id, p]));
  const available = photos.filter((p) => p.urls && !value.some((v) => v.photoId === p.id));
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  return (
    <Field label={t('ed.descriptionPhotos')} hint={t('ed.descriptionPhotosHint')} error={errors}>
      <div className="dp-list">
        {value.map((ref, i) => {
          const p = byId.get(ref.photoId);
          return (
            <div key={ref.photoId} className="dp-item">
              {p?.urls ? <img src={p.urls.thumbnail} alt="" /> : <span className="row-thumb" />}
              <div className="dp-fields">
                <LocalizedInput value={ref.caption ?? {}} maxLength={1000}
                  onChange={(c) => onChange(value.map((x, j) => (j === i ? { ...x, caption: c } : x)))} />
                <span className="muted">{p ? `${p.author.displayName}${p.caption ? ` · ${p.caption}` : ''}` : t('ed.photoUnavailable')}</span>
              </div>
              <div className="dp-actions">
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => move(i, -1)} aria-label={t('geo.up')}>↑</button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => move(i, 1)} aria-label={t('geo.down')}>↓</button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => onChange(value.filter((_, j) => j !== i))}>{t('geo.delete')}</button>
              </div>
            </div>
          );
        })}
      </div>
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
      {photos.length === 0 && <span className="muted">{t('ed.noRoutePhotos')}</span>}
      <PhotoUpload routeId={routeId} onAdded={onUploaded} title={t('ph.uploadToDescription')} />
      <span className="field-hint">{t('ph.uploadToDescriptionHint')}</span>
    </Field>
  );
}
