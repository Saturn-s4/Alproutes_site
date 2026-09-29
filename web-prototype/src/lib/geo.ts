export type TrackPoint = [lat: number, lon: number, ele: number];

export interface TrackStats {
  lengthKm: number;
  gainM: number;
  startM: number;
  maxM: number;
  summit: TrackPoint | null;
}

const R = 6371;
const rad = (d: number) => (d * Math.PI) / 180;

export function distanceKm(a: TrackPoint, b: TrackPoint): number {
  const dLat = rad(b[0] - a[0]);
  const dLon = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function trackStats(track: TrackPoint[]): TrackStats {
  if (track.length === 0) return { lengthKm: 0, gainM: 0, startM: 0, maxM: 0, summit: null };
  let length = 0;
  let gain = 0;
  let summit = track[0];
  for (let i = 1; i < track.length; i++) {
    length += distanceKm(track[i - 1], track[i]);
    const d = track[i][2] - track[i - 1][2];
    if (d > 0) gain += d;
    if (track[i][2] > summit[2]) summit = track[i];
  }
  return { lengthKm: length, gainM: Math.round(gain), startM: Math.round(track[0][2]), maxM: Math.round(summit[2]), summit };
}

/** Elevation against cumulative distance, for the profile chart. */
export function elevationSeries(track: TrackPoint[]): { d: number; e: number }[] {
  let d = 0;
  return track.map((p, i) => {
    if (i > 0) d += distanceKm(track[i - 1], p);
    return { d, e: p[2] };
  });
}

/** Parse the track points of a GPX (trkpt / rtept) or KML (LineString / gx:coord) file. */
export function parseTrackFile(text: string): TrackPoint[] {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('parse');
  const pts: TrackPoint[] = [];

  const gpx = doc.getElementsByTagName('trkpt').length ? doc.getElementsByTagName('trkpt') : doc.getElementsByTagName('rtept');
  for (const el of Array.from(gpx)) {
    const lat = parseFloat(el.getAttribute('lat') || '');
    const lon = parseFloat(el.getAttribute('lon') || '');
    const ele = parseFloat(el.getElementsByTagName('ele')[0]?.textContent || '0');
    if (Number.isFinite(lat) && Number.isFinite(lon)) pts.push([lat, lon, Number.isFinite(ele) ? ele : 0]);
  }
  if (pts.length) return pts;

  for (const el of Array.from(doc.getElementsByTagName('coordinates'))) {
    for (const tuple of (el.textContent || '').trim().split(/\s+/)) {
      const [lon, lat, ele] = tuple.split(',').map(Number);
      if (Number.isFinite(lat) && Number.isFinite(lon)) pts.push([lat, lon, Number.isFinite(ele) ? ele : 0]);
    }
  }
  for (const el of Array.from(doc.getElementsByTagName('gx:coord'))) {
    const [lon, lat, ele] = (el.textContent || '').trim().split(/\s+/).map(Number);
    if (Number.isFinite(lat) && Number.isFinite(lon)) pts.push([lat, lon, Number.isFinite(ele) ? ele : 0]);
  }
  if (!pts.length) throw new Error('empty');
  return pts;
}

export function toGpx(name: string, track: TrackPoint[]): string {
  const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);
  const pts = track
    .map(([lat, lon, ele]) => `      <trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"><ele>${ele.toFixed(1)}</ele></trkpt>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Alproutes" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${esc(name)}</name></metadata>
  <trk>
    <name>${esc(name)}</name>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>
`;
}

export function downloadText(filename: string, text: string, type = 'application/gpx+xml') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Builds a smooth demo track through waypoints. Used for the bundled sample routes
 * until real tracks come from the API.
 */
export function trackThrough(waypoints: TrackPoint[], perLeg = 24): TrackPoint[] {
  const out: TrackPoint[] = [];
  for (let w = 0; w < waypoints.length - 1; w++) {
    const [a, b] = [waypoints[w], waypoints[w + 1]];
    for (let i = 0; i < perLeg; i++) {
      const t = i / perLeg;
      const wiggle = Math.sin((w * perLeg + i) * 1.7) * 0.0006 * Math.sin(Math.PI * t);
      const eleNoise = Math.sin((w * perLeg + i) * 2.3) * 6 * Math.sin(Math.PI * t);
      out.push([a[0] + (b[0] - a[0]) * t + wiggle, a[1] + (b[1] - a[1]) * t - wiggle, a[2] + (b[2] - a[2]) * t + eleNoise]);
    }
  }
  out.push(waypoints[waypoints.length - 1]);
  return out;
}
