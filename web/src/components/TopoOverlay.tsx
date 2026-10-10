import type { ReactNode } from 'react';
import { TOPO_COLORS, topoPathD, type TopoDrawing } from '@/lib/topo';

/**
 * A topo drawing over a photo: an SVG in image pixels laid exactly over the <img>.
 * Stroke widths do not scale with the image, so a thumbnail and a full-screen view read alike.
 * [cover] matches an image cropped with `object-fit: cover` (centred), like the gallery tiles.
 */
export function TopoOverlay({
  drawing, width, height, strokeWidth = 3, cover = false, children,
}: { drawing: TopoDrawing; width: number; height: number; strokeWidth?: number; cover?: boolean; children?: ReactNode }) {
  if (drawing.formatVersion !== 1) return null; // unknown format: show the photo without a drawing (contract)
  return (
    <svg className="topo-overlay" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio={cover ? 'xMidYMid slice' : 'none'} aria-hidden="true">
      {drawing.paths.map((p) => {
        const d = topoPathD(p.points, width, height, p.smooth ?? true);
        const dash = p.dashed ? `${strokeWidth * 3} ${strokeWidth * 2.2}` : undefined;
        return (
          <g key={p.id}>
            <path d={d} className="topo-casing" style={{ strokeWidth: strokeWidth + 3 }} strokeDasharray={dash} vectorEffect="non-scaling-stroke" />
            <path d={d} className="topo-line" style={{ stroke: TOPO_COLORS[p.style], strokeWidth }} strokeDasharray={dash} vectorEffect="non-scaling-stroke" />
          </g>
        );
      })}
      {children}
    </svg>
  );
}
