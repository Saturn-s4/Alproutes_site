import { useMemo } from 'react';
import { elevationSeries, type TrackPoint } from '../lib/geo';

interface Props {
  track: TrackPoint[];
  height?: number;
}

/** Filled elevation profile, drawn the way the design shows it. */
export function ElevationProfile({ track, height = 90 }: Props) {
  const W = 400;
  const H = height;
  const d = useMemo(() => {
    const s = elevationSeries(track);
    if (s.length < 2) return null;
    const maxD = s[s.length - 1].d || 1;
    const es = s.map((p) => p.e);
    const lo = Math.min(...es);
    const hi = Math.max(...es);
    const span = hi - lo || 1;
    const pts = s.map((p) => [(p.d / maxD) * W, H - 4 - ((p.e - lo) / span) * (H - 12)] as const);
    const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
    return { line, area: `${line} L${W} ${H} L0 ${H} Z` };
  }, [track, H]);

  if (!d) return null;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height: `${H / 10}rem` }} aria-hidden="true">
      <path d={d.area} fillOpacity={0.12} style={{ fill: 'var(--accent)' }} />
      <path d={d.line} fill="none" strokeWidth={2} style={{ stroke: 'var(--accent)' }} vectorEffect="non-scaling-stroke" />
      <line x1={0} y1={H - 0.5} x2={W} y2={H - 0.5} style={{ stroke: 'var(--line2)' }} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
