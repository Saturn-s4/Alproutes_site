'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api/browser';
import type { components } from '@/lib/api/schema';
import type { RouteFeature, RouteFeatureKind } from '@/lib/api/types';
import { newId } from '@/lib/edit';
import { GpxReadError, readTrackFile, type Segments } from '@/lib/gpx';
import { featureKindLabel, formatDate, formatInt } from '@/lib/i18n';
import { UploadError, uploadFile } from '@/lib/upload';
import { usePrefs } from '../Prefs';

type Track = components['schemas']['Track'];

const LINE_KINDS: RouteFeatureKind[] = ['route_line', 'approach', 'descent'];
/** Contract limit for a route line (GeoJsonLineString.maxItems). */
const MAX_VERTICES = 10000;

/** Douglas–Peucker in degrees with a growing tolerance until the line fits the contract limit. */
function fit(coords: number[][]): number[][] {
  if (coords.length <= MAX_VERTICES) return coords;
  const simplify = (pts: number[][], eps: number): number[][] => {
    const keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    const stack: [number, number][] = [[0, pts.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop()!;
      const [ax, ay] = pts[a] as [number, number];
      const [bx, by] = pts[b] as [number, number];
      let maxD = 0;
      let idx = -1;
      for (let i = a + 1; i < b; i++) {
        const [px, py] = pts[i] as [number, number];
        const dx = bx - ax;
        const dy = by - ay;
        const len = dx * dx + dy * dy;
        const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
        const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
        if (d > maxD) { maxD = d; idx = i; }
      }
      if (maxD > eps && idx > 0) {
        keep[idx] = 1;
        stack.push([a, idx], [idx, b]);
      }
    }
    return pts.filter((_, i) => keep[i]);
  };
  let eps = 0.000005; // ≈ 0.5 m
  let out = simplify(coords, eps);
  while (out.length > MAX_VERTICES) out = simplify(coords, (eps *= 2));
  return out;
}

type Picked = { segments: Segments; trackId?: string };

/**
 * Takes a line from a GPX/KML track into the route geometry; the route keeps its own 2D copy.
 * - Existing route: pick one of its tracks, or upload a new file (it becomes a track of the route).
 * - New route: the file is read in the browser; it is uploaded as a track once the route exists
 *   ([onFile] hands it to the form).
 * Several segments are never joined silently: the editor picks one or joins them explicitly.
 */
export function TrackImport({
  routeId, onImport, onFile,
}: { routeId?: string; onImport: (f: RouteFeature) => void; onFile?: (file: File) => void }) {
  const { t, lang } = usePrefs();
  const [open, setOpen] = useState(false);
  const [tracks, setTracks] = useState<Track[] | null>(routeId ? null : []);
  const [kind, setKind] = useState<RouteFeatureKind>('route_line');
  const [picked, setPicked] = useState<Picked | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || tracks || !routeId) return;
    void api.GET('/routes/{routeId}/tracks', { params: { path: { routeId }, query: { limit: 100 } } })
      .then(({ data }) => setTracks((data?.items ?? []).filter((x) => x.processingStatus === 'ready')));
  }, [open, tracks, routeId]);

  const offer = (p: Picked) => {
    if (p.segments.length === 1) importCoords(p, p.segments[0]!);
    else setPicked(p);
  };

  const fromTrack = async (trackId: string) => {
    const { data } = await api.GET('/tracks/{trackId}/geometry', { params: { path: { trackId } } });
    if (!data) throw new Error(t('trk.geometryFailed'));
    offer({ segments: data.coordinates, trackId });
  };

  const fromFile = async (file: File) => {
    setError(null);
    setBusy(true);
    try {
      // Reading locally first catches a wrong file before anything is uploaded.
      const segments = await readTrackFile(file);
      if (!routeId) {
        onFile?.(file);
        offer({ segments });
        return;
      }
      const uploadId = await uploadFile(file, 'track');
      const id = newId();
      const created = await api.POST('/routes/{routeId}/tracks', { params: { path: { routeId } }, body: { id, uploadId } });
      if (!created.data) throw new UploadError(created.error?.detail ?? t('trk.uploadFailed'));
      let track = created.data;
      for (let i = 0; i < 60 && track.processingStatus === 'processing'; i++) {
        await new Promise((r) => setTimeout(r, 500));
        track = (await api.GET('/tracks/{trackId}', { params: { path: { trackId: id } } })).data ?? track;
      }
      if (track.processingStatus !== 'ready') throw new UploadError(track.processingError ?? t('trk.failed'));
      setTracks(null); // re-read the list with the new track
      await fromTrack(id);
    } catch (e) {
      setError(e instanceof GpxReadError ? t(`trk.read.${e.message}` as 'trk.read.not-xml') : e instanceof Error ? e.message : t('trk.uploadFailed'));
    } finally {
      setBusy(false);
    }
  };

  const importCoords = (p: Picked, coords: number[][]) => {
    const line = fit(coords.map((c) => [c[0] as number, c[1] as number]));
    onImport({ kind, line: { type: 'LineString', coordinates: line }, sourceTrackId: p.trackId });
    setPicked(null);
    setOpen(false);
  };

  if (!open) {
    return (
      <div className="geo-group">
        <span className="label">GPX</span>
        <button type="button" className="chip chip-lg" onClick={() => setOpen(true)}>{t('trk.importLine')}</button>
      </div>
    );
  }
  return (
    <div className="box track-import">
      <div className="row-gap" style={{ gap: '1rem', alignItems: 'center' }}>
        <b>{t('trk.importLine')}</b>
        <div className="chips">
          {LINE_KINDS.map((k) => (
            <button key={k} type="button" className="chip" aria-pressed={kind === k} onClick={() => setKind(k)}>{featureKindLabel(k, lang)}</button>
          ))}
        </div>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setOpen(false); setPicked(null); }}>{t('geo.cancel')}</button>
      </div>

      {!picked && (
        <>
          {routeId && tracks === null && <p className="muted">{t('common.loading')}</p>}
          {tracks?.map((tr) => (
            <button key={tr.id} type="button" className="geo-item" disabled={busy}
              onClick={() => void fromTrack(tr.id).catch((e: Error) => setError(e.message))}>
              <span className="mono">{tr.format.toUpperCase()}</span>
              <span>{tr.originalFilename ?? tr.id.slice(0, 8)}</span>
              <span className="muted">
                {tr.author.displayName}
                {tr.recordedOn && ` · ${formatDate(tr.recordedOn, lang)}`}
                {tr.lengthM != null && ` · ${formatInt(tr.lengthM, lang)} ${t('common.m')}`}
              </span>
            </button>
          ))}
          <label className="file-pick">
            <span className="btn btn-sm btn-outline-blue">{busy ? t('trk.uploading') : t('trk.pickFile')}</span>
            <input type="file" accept=".gpx,.kml,application/gpx+xml,application/vnd.google-earth.kml+xml" disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void fromFile(f);
              }} />
            <span className="field-hint">{routeId ? t('trk.pickFileHintEdit') : t('trk.pickFileHintNew')}</span>
          </label>
        </>
      )}

      {picked && (
        <>
          <p className="muted">{t('trk.segmentsHint').replace('{n}', String(picked.segments.length))}</p>
          {picked.segments.map((seg, i) => (
            <button key={i} type="button" className="geo-item" onClick={() => importCoords(picked, seg)}>
              {t('trk.segment')} {i + 1} <span className="muted">· {seg.length} {t('geo.vertices')}</span>
            </button>
          ))}
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => importCoords(picked, picked.segments.flat())}>
            {t('trk.joinSegments')}
          </button>
        </>
      )}
      {error && <p className="error-text" role="alert">{error}</p>}
    </div>
  );
}
