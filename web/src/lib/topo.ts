import type { components } from './api/schema';

export type TopoDrawing = components['schemas']['TopoDrawing'];
export type TopoPath = components['schemas']['TopoPath'];
export type TopoStyle = TopoPath['style'];
export type TopoLine = components['schemas']['TopoLine'];

type Pt = [number, number];

/**
 * Line colours over a photo. Fixed, not theme tokens: the background is the photo itself.
 * Every line is drawn over a dark casing so it stays readable on snow and on rock.
 */
export const TOPO_COLORS: Record<TopoStyle, string> = {
  main: '#ff7a1a',
  variant: '#3da5ff',
  approach: '#ffd23f',
  descent: '#7cdb6a',
};

export const TOPO_STYLES: TopoStyle[] = ['main', 'variant', 'approach', 'descent'];

/**
 * SVG path of a topo line in image pixels (contract TopoPath.smooth): a centripetal Catmull–Rom
 * spline (alpha 0.5) through the anchor points, end points repeated, written as cubic Béziers;
 * or a polyline when smoothing is off. Android must draw the same curve.
 */
export function topoPathD(points: { x: number; y: number }[], w: number, h: number, smooth = true): string {
  const p: Pt[] = points.map((q) => [q.x * w, q.y * h]);
  if (p.length === 0) return '';
  const f = (n: number) => n.toFixed(1);
  let d = `M${f(p[0]![0])} ${f(p[0]![1])}`;
  if (!smooth || p.length < 3) {
    for (let i = 1; i < p.length; i++) d += ` L${f(p[i]![0])} ${f(p[i]![1])}`;
    return d;
  }
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] ?? p[i]!;
    const p1 = p[i]!;
    const p2 = p[i + 1]!;
    const p3 = p[i + 2] ?? p2;
    const [b1, b2] = bezierControls(p0, p1, p2, p3);
    d += ` C${f(b1[0])} ${f(b1[1])} ${f(b2[0])} ${f(b2[1])} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d;
}

/**
 * Direction the line arrives at its last point, in image pixels: the last Bézier tangent of the
 * spline (or the last segment of a polyline). For the end arrow (TopoPath.arrowEnd).
 */
export function endDirection(points: { x: number; y: number }[], w: number, h: number, smooth = true): [number, number] | null {
  const p: Pt[] = points.map((q) => [q.x * w, q.y * h]);
  const n = p.length;
  if (n < 2) return null;
  const end = p[n - 1]!;
  let from = p[n - 2]!;
  if (smooth && n >= 3) from = bezierControls(p[n - 3]!, p[n - 2]!, end, end)[0];
  const dx = end[0] - from[0];
  const dy = end[1] - from[1];
  const len = Math.hypot(dx, dy);
  return len ? [dx / len, dy / len] : null;
}

/** Bézier control points of the centripetal Catmull–Rom segment p1→p2 (Yuksel et al.). */
function bezierControls(p0: Pt, p1: Pt, p2: Pt, p3: Pt): [Pt, Pt] {
  const dist = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  // alpha = 0.5: d^alpha = sqrt(dist), d^(2 alpha) = dist.
  const d1 = Math.sqrt(dist(p0, p1));
  const d2 = Math.sqrt(dist(p1, p2));
  const d3 = Math.sqrt(dist(p2, p3));
  const eps = 1e-6;
  if (d2 < eps) return [p1, p2];
  const b1: Pt = d1 < eps ? p1 : [0, 1].map((k) =>
    (d1 * d1 * p2[k]! - d2 * d2 * p0[k]! + (2 * d1 * d1 + 3 * d1 * d2 + d2 * d2) * p1[k]!) / (3 * d1 * (d1 + d2))) as Pt;
  const b2: Pt = d3 < eps ? p2 : [0, 1].map((k) =>
    (d3 * d3 * p1[k]! - d2 * d2 * p3[k]! + (2 * d3 * d3 + 3 * d3 * d2 + d2 * d2) * p2[k]!) / (3 * d3 * (d3 + d2))) as Pt;
  return [b1, b2];
}

/**
 * Turns a freehand stroke into a few anchor points: Douglas–Peucker in pixels with [tolerance].
 * The spline through the anchors is what makes the line smooth, so the stored drawing stays small
 * and every point can be dragged later.
 */
export function simplifyStroke(points: Pt[], tolerance: number): Pt[] {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let max = 0;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = segmentDistance(points[i]!, points[a]!, points[b]!);
      if (d > max) { max = d; idx = i; }
    }
    if (max > tolerance && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

export function segmentDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** The current drawing of [routeId] on a photo; an empty current version means the line was removed. */
export function currentTopo(photo: { topoLines: TopoLine[] }, routeId: string | undefined): TopoLine | undefined {
  const line = routeId ? photo.topoLines.find((l) => l.routeId === routeId && l.isCurrent) : undefined;
  return line && line.drawing.paths.length > 0 ? line : undefined;
}
