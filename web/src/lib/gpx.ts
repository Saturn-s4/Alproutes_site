/**
 * Reads line segments from a GPX or KML file in the browser, for previewing and importing a line
 * before the route exists. The backend parses the same file again when it is uploaded as a track:
 * statistics and the elevation profile always come from the server.
 */
export type Segments = number[][][]; // [segment][point][lon, lat]

export class GpxReadError extends Error {}

const MAX_POINTS = 200_000;

export async function readTrackFile(file: File): Promise<Segments> {
  if (file.size > 20 * 1024 * 1024) throw new GpxReadError('too-large');
  const doc = new DOMParser().parseFromString(await file.text(), 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new GpxReadError('not-xml');
  const root = doc.documentElement.localName;
  let segments: Segments;
  if (root === 'gpx') {
    const pts = (parent: Element, tag: string) =>
      Array.from(parent.getElementsByTagNameNS('*', tag)).flatMap((p) => {
        const lat = Number(p.getAttribute('lat'));
        const lon = Number(p.getAttribute('lon'));
        return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [[lon, lat]] : [];
      });
    segments = Array.from(doc.getElementsByTagNameNS('*', 'trkseg')).map((s) => pts(s, 'trkpt'));
    // Like the server: a recorded track wins over a planned route.
    if (!segments.some((s) => s.length >= 2)) segments = Array.from(doc.getElementsByTagNameNS('*', 'rte')).map((r) => pts(r, 'rtept'));
  } else if (root === 'kml') {
    const coord = (parts: string[]) => {
      const lon = Number(parts[0]);
      const lat = Number(parts[1]);
      return Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [[lon, lat]] : [];
    };
    segments = [
      ...Array.from(doc.getElementsByTagNameNS('*', 'LineString')).map((ls) =>
        (ls.getElementsByTagNameNS('*', 'coordinates')[0]?.textContent ?? '').trim().split(/\s+/).flatMap((c) => coord(c.split(',')))),
      ...Array.from(doc.getElementsByTagNameNS('*', 'Track')).map((tr) =>
        Array.from(tr.getElementsByTagNameNS('*', 'coord')).flatMap((c) => coord((c.textContent ?? '').trim().split(/\s+/)))),
    ];
  } else {
    throw new GpxReadError('not-track');
  }
  segments = segments.filter((s) => s.length >= 2);
  if (!segments.length) throw new GpxReadError('no-line');
  if (segments.reduce((n, s) => n + s.length, 0) > MAX_POINTS) throw new GpxReadError('too-many');
  return segments;
}
