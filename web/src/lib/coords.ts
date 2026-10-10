/**
 * Parses a coordinate pair typed by hand. Latitude comes first unless hemisphere letters say
 * otherwise (descriptions and GPS units write "N 43°.., E 42°.."). Accepted forms:
 *   43.35147, 42.43611          decimal degrees
 *   N43.35147 E42.43611         with hemisphere letters (С/Ю/В/З also accepted)
 *   43°21.088' N, 42°26.167' E  degrees and decimal minutes
 *   43°21'05.3"N 42°26'10.0"E   degrees, minutes, seconds
 * Returns [lon, lat] (GeoJSON order) or an error message key.
 */
export type ParsedCoord = { ok: true; lonLat: [number, number] } | { ok: false; error: 'format' | 'range' };

const HEMI: Record<string, 'N' | 'S' | 'E' | 'W'> = {
  N: 'N', S: 'S', E: 'E', W: 'W', С: 'N', Ю: 'S', В: 'E', З: 'W', Ш: 'N', Д: 'E',
};

type Part = { value: number; hemi: 'N' | 'S' | 'E' | 'W' | null };

function parsePart(raw: string): Part | null {
  let s = raw.trim().toUpperCase().replace(/,/g, '.');
  let hemi: Part['hemi'] = null;
  const lead = s.match(/^([NSEWСЮВЗ])\s*/u);
  const tail = s.match(/\s*([NSEWСЮВЗ])$/u);
  if (lead) { hemi = HEMI[lead[1]!] ?? null; s = s.slice(lead[0].length); }
  else if (tail) { hemi = HEMI[tail[1]!] ?? null; s = s.slice(0, -tail[0].length); }
  const nums = s.match(/-?\d+(?:\.\d+)?/g);
  if (!nums || nums.length > 3) return null;
  // Anything besides numbers, spaces and degree/minute/second marks is not a coordinate.
  if (s.replace(/-?\d+(?:\.\d+)?/g, '').replace(/[\s°º'′’"″”]/g, '') !== '') return null;
  const [d, m = '0', sec = '0'] = nums;
  const deg = Number(d);
  const min = Number(m);
  const secs = Number(sec);
  if (min >= 60 || secs >= 60 || min < 0 || secs < 0) return null;
  const sign = deg < 0 ? -1 : 1;
  return { value: sign * (Math.abs(deg) + min / 60 + secs / 3600), hemi };
}

export function parseCoordinates(input: string): ParsedCoord {
  const text = input.trim();
  if (!text) return { ok: false, error: 'format' };
  // Split into two halves: by ';', by a comma followed by space, by hemisphere letters, or by whitespace for plain decimals.
  let halves: string[] | null = null;
  for (const sep of [
    /\s*;\s*/,
    /,\s+/,
    // "N 43°06.3' E 43°00.6'": split before the second leading hemisphere letter.
    /[\s,]+(?=[NSEWСЮВЗnsewсювз]\s*-?\d)/u,
    // "43°06.3' N 43°00.6' E": split after a trailing hemisphere letter.
    /(?<=[NSEWСЮВЗnsewсювз])[\s,]+/u,
  ]) {
    const parts = text.split(sep);
    if (parts.length === 2) { halves = parts; break; }
  }
  if (!halves) {
    const plain = text.split(/[\s,]+/);
    if (plain.length === 2) halves = plain;
  }
  if (!halves) return { ok: false, error: 'format' };
  const a = parsePart(halves[0]!);
  const b = parsePart(halves[1]!);
  if (!a || !b) return { ok: false, error: 'format' };

  let lat: number;
  let lon: number;
  if ((a.hemi === 'E' || a.hemi === 'W') && (b.hemi === null || b.hemi === 'N' || b.hemi === 'S')) {
    lon = a.value * (a.hemi === 'W' ? -1 : 1);
    lat = b.value * (b.hemi === 'S' ? -1 : 1);
  } else {
    lat = a.value * (a.hemi === 'S' ? -1 : 1);
    lon = b.value * (b.hemi === 'W' ? -1 : 1);
  }
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return { ok: false, error: 'range' };
  return { ok: true, lonLat: [Math.round(lon * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6] };
}

/** "43.35147° N, 42.43611° E" — how the UI shows a point, latitude first. */
export function formatLatLon([lon, lat]: number[], digits = 5): string {
  if (lon == null || lat == null) return '';
  return `${Math.abs(lat).toFixed(digits)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(digits)}° ${lon >= 0 ? 'E' : 'W'}`;
}
