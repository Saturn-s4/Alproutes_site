'use client';

import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '@/lib/api/browser';
import type { AreaSummary, LocalizedText } from '@/lib/api/types';
import type { components } from '@/lib/api/schema';
import { cleanText, errorsUnder, fieldErrors, intOrNull, type FieldErrors } from '@/lib/edit';
import { areaTypeLabel } from '@/lib/i18n';
import { DEFAULT_VIEW, themeColors } from '@/lib/map-style';
import { MapCanvas } from '../MapCanvas';
import { usePrefs } from '../Prefs';
import { AreaPicker, Field, LocalizedInput, SignInFirst } from './Fields';

type AreaType = components['schemas']['AreaType'];
type ContentStatus = components['schemas']['ContentStatus'];
const AREA_TYPES: AreaType[] = ['mountain_system', 'region', 'ridge', 'massif', 'summit', 'other'];
const STATUSES: ContentStatus[] = ['published', 'draft', 'hidden'];

/** Areas are reference data: created and edited by moderators only (contract). */
export function AreaEditor({ areaId, parentId }: { areaId?: string; parentId?: string }) {
  const { t, lang, session } = usePrefs();
  const router = useRouter();
  const [parent, setParent] = useState<AreaSummary | null>(null);
  const [type, setType] = useState<AreaType>('region');
  const [slug, setSlug] = useState('');
  const [name, setName] = useState<LocalizedText>({});
  const [description, setDescription] = useState<LocalizedText>({});
  const [center, setCenter] = useState<number[] | null>(null);
  const [elevation, setElevation] = useState('');
  const [status, setStatus] = useState<ContentStatus>('published');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(!areaId);
  const isModerator = session?.user.role === 'moderator' || session?.user.role === 'admin';

  useEffect(() => {
    if (!session) return;
    const loadArea = async (id: string) => (await api.GET('/areas/{areaId}', { params: { path: { areaId: id } } })).data;
    void (async () => {
      if (parentId) setParent((await loadArea(parentId)) ?? null);
      if (!areaId) return;
      const a = await loadArea(areaId);
      if (!a) {
        setMessage(t('ed.loadFailed'));
        return;
      }
      if (a.parentId) setParent((await loadArea(a.parentId)) ?? null);
      setType(a.type);
      setSlug(a.slug);
      setName(a.name);
      setDescription(a.description ?? {});
      setCenter(a.center?.coordinates ?? null);
      setElevation(a.elevationM?.toString() ?? '');
      setStatus(a.status);
      setLoaded(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  if (!session) return <SignInFirst />;
  if (!isModerator) return <div className="page"><p className="status-note">{t('ed.moderatorsOnly')}</p></div>;
  if (!loaded) return <div className="page"><p className="muted">{message ?? t('common.loading')}</p></div>;

  const err = (p: string) => errorsUnder(errors, p);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);
    if (!cleanText(name)) {
      setErrors({ name: t('ed.nameRequired') });
      return;
    }
    const body = {
      parentId: parent?.id ?? null,
      type,
      slug: slug.trim(),
      name: cleanText(name)!,
      description: cleanText(description) ?? null,
      center: center ? { type: 'Point' as const, coordinates: center } : null,
      elevationM: type === 'summit' ? intOrNull(elevation) : null,
      status,
    };
    const res = areaId
      ? await api.PATCH('/areas/{areaId}', { params: { path: { areaId } }, body: body as never })
      : await api.POST('/areas', { body: { ...body, description: body.description ?? undefined, center: body.center ?? undefined } });
    if (res.data) {
      router.push(`/areas/${res.data.slug}`);
      router.refresh();
      return;
    }
    setErrors(fieldErrors(res.error));
    setMessage(res.error?.detail ?? res.error?.title ?? t('ed.saveFailed'));
  };

  return (
    <form className="page edit-page" onSubmit={(e) => void submit(e)} noValidate>
      <h1 className="h1">{areaId ? t('ed.editArea') : t('ed.newArea')}</h1>
      <section className="form-section">
        <Field label={t('ed.parentArea')} hint={t('ed.parentHint')} error={err('parentId')}>
          <AreaPicker value={parent} onChange={setParent} />
        </Field>
        <Field label={t('ed.areaType')} error={err('type')}>
          <div className="chips">
            {AREA_TYPES.map((at) => (
              <button key={at} type="button" className="chip chip-lg" aria-pressed={type === at} onClick={() => setType(at)}>
                {areaTypeLabel(at, lang)}
              </button>
            ))}
          </div>
        </Field>
        <Field label={t('ed.name')} error={err('name')}>
          <LocalizedInput value={name} onChange={setName} maxLength={200} required />
        </Field>
        <Field label={t('ed.slug')} hint={t('ed.slugAreaHint')} error={err('slug')}>
          <input className="input mono" required value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="bezengi" />
        </Field>
        <Field label={t('route.description')} error={err('description')}>
          <LocalizedInput value={description} onChange={setDescription} multiline maxLength={100000} />
        </Field>
        {type === 'summit' && (
          <Field label={`${t('area.elevation')}, ${t('common.m')}`} hint={t('ed.elevationHint')} error={err('elevationM')}>
            <input className="input mono" type="number" min={-500} max={9000} placeholder={t('common.noData')} value={elevation}
              onChange={(e) => setElevation(e.target.value)} />
          </Field>
        )}
        <Field label={t('ed.center')} hint={t('ed.centerHint')} error={err('center')}>
          <CenterPicker value={center} onChange={setCenter} />
        </Field>
        <Field label={t('ed.status')} error={err('status')}>
          <div className="segmented">
            {STATUSES.map((s) => (
              <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(s)}>{t(`ed.status.${s}`)}</button>
            ))}
          </div>
        </Field>
        {message && <p className="error-text" role="alert">{message}</p>}
        <div className="row-gap" style={{ gap: '1.2rem' }}>
          <button type="submit" className="btn btn-primary btn-lg">{t('ed.save')}</button>
          <button type="button" className="btn btn-ghost btn-lg" onClick={() => router.back()}>{t('geo.cancel')}</button>
        </div>
      </section>
    </form>
  );
}

function CenterPicker({ value, onChange }: { value: number[] | null; onChange: (v: number[] | null) => void }) {
  const { t } = usePrefs();
  const mapRef = useRef<MlMap | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const draw = useCallback((v: number[] | null) => {
    mapRef.current?.getSource<GeoJSONSource>('center')?.setData({
      type: 'FeatureCollection',
      features: v ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: v }, properties: {} }] : [],
    });
  }, []);
  useEffect(() => draw(value), [value, draw]);

  const onReady = useCallback(
    (map: MlMap) => {
      mapRef.current = map;
      map.addSource('center', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'center', type: 'circle', source: 'center', paint: { 'circle-radius': 9, 'circle-stroke-width': 3 } });
      const paint = () => {
        const c = themeColors();
        map.setPaintProperty('center', 'circle-color', c.accent);
        map.setPaintProperty('center', 'circle-stroke-color', c.bg);
      };
      paint();
      map.on('click', (e) => onChangeRef.current([Math.round(e.lngLat.lng * 1e6) / 1e6, Math.round(e.lngLat.lat * 1e6) / 1e6]));
      draw(value);
      return paint;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draw],
  );

  return (
    <div>
      <div className="route-map" style={{ height: '32rem' }}>
        <MapCanvas center={(value as [number, number] | null) ?? DEFAULT_VIEW.center} zoom={value ? 10 : DEFAULT_VIEW.zoom} onReady={onReady} />
      </div>
      <div className="row-gap" style={{ gap: '1.2rem', marginTop: '0.8rem', alignItems: 'center' }}>
        <span className="mono muted">{value ? `${value[1]?.toFixed(5)}, ${value[0]?.toFixed(5)}` : t('common.noData')}</span>
        {value && <button type="button" className="btn btn-sm btn-ghost" onClick={() => onChange(null)}>{t('geo.delete')}</button>}
      </div>
    </div>
  );
}
