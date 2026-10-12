import type { ReactNode } from 'react';
import { endDirection, TOPO_COLORS, topoPathD, type TopoDrawing } from '@/lib/topo';
import { MARKER_SIZE, patternDash } from '@/lib/topo-symbols';
import { TopoSymbolGlyph } from './TopoSymbol';

/**
 * A topo drawing over a photo: an SVG in image pixels laid exactly over the <img>.
 * Line widths do not scale with the image, so a thumbnail and a full-screen view read alike;
 * symbols and arrows are part of the picture and scale with it (contract TopoMarker).
 * [cover] matches an image cropped with `object-fit: cover` (centred), like the gallery tiles.
 */
export function TopoOverlay({
  drawing, width, height, strokeWidth = 3, cover = false, children,
}: { drawing: TopoDrawing; width: number; height: number; strokeWidth?: number; cover?: boolean; children?: ReactNode }) {
  if (drawing.formatVersion !== 1) return null; // unknown format: show the photo without a drawing (contract)
  const short = Math.min(width, height);
  const markerSize = MARKER_SIZE * short;
  const arrow = 0.025 * short;
  return (
    <svg className="topo-overlay" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio={cover ? 'xMidYMid slice' : 'none'} aria-hidden="true">
      {drawing.paths.map((p) => {
        const d = topoPathD(p.points, width, height, p.smooth ?? true);
        const dash = patternDash(p.pattern, strokeWidth);
        const color = TOPO_COLORS[p.style];
        const dir = p.arrowEnd ? endDirection(p.points, width, height, p.smooth ?? true) : null;
        const last = p.points[p.points.length - 1];
        // Chevron at the end, opening backwards along the arriving direction.
        const head = dir && last ? (() => {
          const [ex, ey] = [last.x * width, last.y * height];
          const [bx, by] = [ex - dir[0] * arrow, ey - dir[1] * arrow];
          const [nx, ny] = [-dir[1] * arrow * 0.6, dir[0] * arrow * 0.6];
          return `M${(bx + nx).toFixed(1)} ${(by + ny).toFixed(1)} L${ex.toFixed(1)} ${ey.toFixed(1)} L${(bx - nx).toFixed(1)} ${(by - ny).toFixed(1)}`;
        })() : null;
        return (
          <g key={p.id}>
            <path d={d} className="topo-casing" style={{ strokeWidth: strokeWidth + 3 }} strokeDasharray={dash} vectorEffect="non-scaling-stroke" />
            <path d={d} className="topo-line" style={{ stroke: color, strokeWidth }} strokeDasharray={dash} vectorEffect="non-scaling-stroke" />
            {head && (
              <>
                <path d={head} className="topo-casing" style={{ strokeWidth: strokeWidth + 3 }} vectorEffect="non-scaling-stroke" />
                <path d={head} className="topo-line" style={{ stroke: color, strokeWidth }} vectorEffect="non-scaling-stroke" />
              </>
            )}
          </g>
        );
      })}
      {drawing.markers?.map((m, i) => {
        const x = m.x * width;
        const y = m.y * height;
        const size = markerSize * (m.scale ?? 1);
        return (
          <g key={`m${i}`} transform={m.rotation ? `rotate(${m.rotation} ${x} ${y})` : undefined}>
            <TopoSymbolGlyph id={m.symbol} x={x} y={y} size={size} />
            {m.label && (
              // The label stays upright whatever the symbol's rotation.
              <text className="topo-label" x={x + size * 0.62} y={y} fontSize={size * 0.62}
                transform={m.rotation ? `rotate(${-m.rotation} ${x} ${y})` : undefined}>{m.label}</text>
            )}
          </g>
        );
      })}
      {children}
    </svg>
  );
}
