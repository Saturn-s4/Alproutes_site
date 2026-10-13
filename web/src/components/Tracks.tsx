'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, publicApi } from '@/lib/api/browser';
import type { components } from '@/lib/api/schema';
import { newId } from '@/lib/edit';
import { formatDate, formatInt } from '@/lib/i18n';
import { UploadError, uploadFile } from '@/lib/upload';
import { usePrefs } from './Prefs';

type Track = components['schemas']['Track'];
type Profile = components['schemas']['ElevationProfile'];

/** GPX/KML tracks of a route: list, smoothed elevation profile, download, upload. */
export function Tracks({ routeId, initial }: { routeId: string; initial: Track[] }) {
  const { t, lang, session } = usePrefs();
  const [tracks, setTracks] = useState(initial);
  const [selected, setSelected] = useState<string | null>(initial[0]?.id ?? null);
  useEffect(() => setTracks(initial), [initial]);

  const current = tracks.find((x) => x.id === selected);
  const m = (v: number | null | undefined) => (v != null ? `${formatInt(v, lang)} ${t('common.m')}` : t('common.noData'));

  return (
    <div className="tracks">
      {tracks.length === 0 && <p className="muted">{t('trk.none')}</p>}
      {tracks.map((tr) => (
        <div key={tr.id} className={`track-row${tr.id === selected ? ' current' : ''}`}>
          <button type="button" className="track-main" onClick={() => setSelected(tr.id)} aria-pressed={tr.id === selected}>
            <span className="pdf-icon">{tr.format.toUpperCase()}</span>
            <span className="t">
              <span>{tr.originalFilename ?? `${t('trk.track')} ${tr.id.slice(0, 8)}`}</span>
              <span>
                {tr.author.displayName}
                {tr.recordedOn && ` · ${formatDate(tr.recordedOn, lang)}`}
                {tr.processingStatus !== 'ready' && ` · ${t(`trk.status.${tr.processingStatus}`)}`}
              </span>
            </span>
          </button>
          {tr.processingStatus === 'ready' && (
            <a className="btn btn-sm btn-ghost" href={`/api/v1/tracks/${tr.id}/download`}>{t('trk.download')}</a>
          )}
        </div>
      ))}

      {current && current.processingStatus === 'ready' && (
        <div className="box">
          <div className="plain-stats">
            <div><div className="k">{t('route.length')}</div><div className="v">{m(current.lengthM)}</div></div>
            <div><div className="k">{t('trk.gain')}</div><div className="v">{m(current.elevationGainM)}</div></div>
            <div><div className="k">{t('trk.loss')}</div><div className="v">{m(current.elevationLossM)}</div></div>
            <div>
              <div className="k">{t('trk.minMax')}</div>
              <div className="v">{current.minElevationM != null && current.maxElevationM != null ? `${formatInt(current.minElevationM, lang)}–${formatInt(current.maxElevationM, lang)}` : t('common.noData')}</div>
            </div>
          </div>
          <ProfileChart trackId={current.id} />
          {current.note && <p className="muted" style={{ whiteSpace: 'pre-wrap' }}>{current.note}</p>}
          <p className="field-hint">{t('trk.statsNote')}</p>
        </div>
      )}
      {current?.processingStatus === 'failed' && <p className="error-text">{current.processingError ?? t('trk.failed')}</p>}

      {session ? <TrackUpload routeId={routeId} onAdded={(tr) => { setTracks((x) => [tr, ...x.filter((y) => y.id !== tr.id)]); setSelected(tr.id); }} /> : (
        <p className="muted"><a href="/login">{t('header.signIn')}</a> — {t('trk.signInToUpload')}</p>
      )}
    </div>
  );
}

function ProfileChart({ trackId }: { trackId: string }) {
  const { t, lang } = usePrefs();
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  useEffect(() => {
    setProfile(undefined);
    void publicApi.GET('/tracks/{trackId}/profile', { params: { path: { trackId } } }).then(({ data }) => setProfile(data ?? null));
  }, [trackId]);
  if (profile === undefined) return <p className="muted">{t('common.loading')}</p>;
  if (!profile || profile.points.length < 2) return <p className="muted">{t('trk.noProfile')}</p>;

  const pts = profile.points as [number, number][];
  const W = 600;
  const H = 140;
  const maxD = pts[pts.length - 1]![0] || 1;
  const eles = pts.map((p) => p[1]);
  const lo = Math.min(...eles);
  const hi = Math.max(...eles);
  const span = Math.max(hi - lo, 20);
  const x = (d: number) => (d / maxD) * W;
  const y = (e: number) => H - 8 - ((e - lo) / span) * (H - 24);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)} ${y(p[1]).toFixed(1)}`).join(' ');
  return (
    <figure className="profile-chart">
      <div className="head">
        <span>{t('route.profile')}</span>
        <span className="mono">{formatInt(lo, lang)} → {formatInt(hi, lang)} {t('common.m')} · {(maxD / 1000).toFixed(1)} {t('common.km')}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={t('route.profile')}>
        <path d={`${line} L${W} ${H} L0 ${H} Z`} style={{ fill: 'var(--accent-soft)' }} />
        <path d={line} style={{ fill: 'none', stroke: 'var(--accent)', strokeWidth: 2 }} vectorEffect="non-scaling-stroke" />
      </svg>
    </figure>
  );
}

function TrackUpload({ routeId, onAdded }: { routeId: string; onAdded: (t: Track) => void }) {
  const { t } = usePrefs();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [recordedOn, setRecordedOn] = useState('');
  const [note, setNote] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setError(null);
    setProgress(0);
    try {
      const uploadId = await uploadFile(file, 'track', setProgress);
      // Client-generated id: a retry after a dropped connection does not create a duplicate.
      const id = newId();
      const { data, error: problem } = await api.POST('/routes/{routeId}/tracks', {
        params: { path: { routeId } },
        body: { id, uploadId, recordedOn: recordedOn || undefined, note: note.trim() || undefined },
      });
      if (!data) throw new UploadError(problem?.detail ?? problem?.errors?.[0]?.message ?? t('trk.uploadFailed'));
      onAdded(data);
      let track = data;
      for (let i = 0; i < 60 && track.processingStatus === 'processing'; i++) {
        await new Promise((r) => setTimeout(r, 500));
        track = (await api.GET('/tracks/{trackId}', { params: { path: { trackId: id } } })).data ?? track;
      }
      onAdded(track);
      setFile(null);
      setNote('');
      setRecordedOn('');
      if (fileRef.current) fileRef.current.value = '';
      // The route map and counters are server-rendered: refresh them.
      router.refresh();
    } catch (err) {
      setError(err instanceof UploadError && err.message !== 'unsupported' ? err.message : t('trk.uploadFailed'));
    } finally {
      setProgress(null);
    }
  };

  return (
    <form className="box track-upload" onSubmit={(e) => void submit(e)}>
      <b>{t('trk.upload')}</b>
      <input ref={fileRef} type="file" accept=".gpx,.kml,application/gpx+xml,application/vnd.google-earth.kml+xml"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <div className="row-gap" style={{ gap: '1.2rem' }}>
        <label className="field">
          {t('trk.recordedOn')}
          <input className="input" type="date" value={recordedOn} onChange={(e) => setRecordedOn(e.target.value)} />
        </label>
        <label className="field" style={{ flexGrow: 1 }}>
          {t('trk.note')}
          <input className="input" maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('trk.notePlaceholder')} />
        </label>
      </div>
      {progress != null && <div className="progress"><div style={{ width: `${Math.round(progress * 100)}%` }} /></div>}
      {error && <p className="error-text" role="alert">{error}</p>}
      <button type="submit" className="btn btn-primary" disabled={!file || progress != null} style={{ alignSelf: 'flex-start' }}>
        {progress != null ? t('trk.uploading') : t('trk.uploadSubmit')}
      </button>
      <span className="field-hint">{t('trk.privacy')}</span>
    </form>
  );
}
