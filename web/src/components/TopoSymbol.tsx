import { TOPO_SYMBOL_GRID, TOPO_SYMBOL_STROKE, topoSymbol, type TopoSymbolPath } from '@/lib/topo-symbols';

/**
 * A topo symbol inside an existing <svg> (e.g. TopoOverlay), centred at [x, y] in that SVG's units,
 * [size] units across. Drawn over a dark casing like the topo lines, so it reads on snow and rock.
 * Unknown ids draw nothing: a newer client may have added symbols this one does not know.
 */
export function TopoSymbolGlyph({
  id, x, y, size, color = '#ffffff', casing = true,
}: { id: string; x: number; y: number; size: number; color?: string; casing?: boolean }) {
  const s = topoSymbol(id);
  if (!s) return null;
  const k = size / TOPO_SYMBOL_GRID;
  const paths = s.paths as readonly TopoSymbolPath[];
  return (
    <g transform={`translate(${x - size / 2} ${y - size / 2}) scale(${k})`} strokeLinecap="round" strokeLinejoin="round">
      {casing && paths.map((p, i) => (
        <path key={`c${i}`} d={p.d} fill={p.fill ? 'rgba(0, 0, 0, 0.55)' : 'none'} stroke="rgba(0, 0, 0, 0.55)" strokeWidth={TOPO_SYMBOL_STROKE + 2} />
      ))}
      {paths.map((p, i) => (
        <path key={i} d={p.d} fill={p.fill ? color : 'none'} stroke={color} strokeWidth={TOPO_SYMBOL_STROKE} />
      ))}
    </g>
  );
}

/** A standalone symbol icon in currentColor — for the editor palette, legends and lists. */
export function TopoSymbolIcon({ id, size = 24, title, className }: { id: string; size?: number; title?: string; className?: string }) {
  const s = topoSymbol(id);
  if (!s) return null;
  const paths = s.paths as readonly TopoSymbolPath[];
  return (
    <svg
      className={className} width={size} height={size} viewBox={`0 0 ${TOPO_SYMBOL_GRID} ${TOPO_SYMBOL_GRID}`}
      fill="none" stroke="currentColor" strokeWidth={TOPO_SYMBOL_STROKE} strokeLinecap="round" strokeLinejoin="round"
      role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} aria-label={title}
    >
      {paths.map((p, i) => <path key={i} d={p.d} fill={p.fill ? 'currentColor' : undefined} />)}
    </svg>
  );
}
