import { TOPO_SYMBOL_SET } from './topo-symbols.data';
import type { TopoDrawing } from './topo';


/**
 * Topo symbols (UIAA-style) for drawings on photos. Data lives in shared/topo-symbols/symbols.json,
 * shared with Android; topo-symbols.data.ts is generated from it by shared/topo-symbols/build.mjs.
 */
export type TopoSymbolDef = (typeof TOPO_SYMBOL_SET.symbols)[number];
export type TopoSymbolId = TopoSymbolDef['id'];
export type TopoSymbolGroupId = (typeof TOPO_SYMBOL_SET.groups)[number]['id'];
export type TopoLineStyleDef = (typeof TOPO_SYMBOL_SET.lines)[number];
export type TopoSymbolPath = { readonly d: string; readonly fill?: boolean };

/** Side of the square grid all symbol geometry is drawn in. */
export const TOPO_SYMBOL_GRID: number = TOPO_SYMBOL_SET.viewBox;
/** Stroke width in grid units. */
export const TOPO_SYMBOL_STROKE: number = TOPO_SYMBOL_SET.strokeWidth;

export const TOPO_SYMBOLS: readonly TopoSymbolDef[] = TOPO_SYMBOL_SET.symbols;
export const TOPO_SYMBOL_GROUPS = TOPO_SYMBOL_SET.groups;
export const TOPO_LINE_STYLES: readonly TopoLineStyleDef[] = TOPO_SYMBOL_SET.lines;

const byId = new Map<string, TopoSymbolDef>(TOPO_SYMBOLS.map((s) => [s.id, s]));

export function topoSymbol(id: string): TopoSymbolDef | undefined {
  return byId.get(id);
}

export function isHumorSymbol(s: TopoSymbolDef): boolean {
  return 'humor' in s && s.humor === true;
}

/** Symbols for the editor palette, grouped in display order. Joke symbols only when asked for. */
export function topoSymbolPalette(includeHumor = false) {
  return TOPO_SYMBOL_GROUPS
    .map((g) => ({ group: g, symbols: TOPO_SYMBOLS.filter((s) => s.group === g.id && (includeHumor || !isHumorSymbol(s))) }))
    .filter((x) => x.symbols.length > 0);
}

export type TopoPattern = NonNullable<TopoDrawing['paths'][number]['pattern']>;

/** Which line style of the symbol set draws each contract pattern (TopoPath.pattern). */
export const PATTERN_LINE_STYLE: Record<Exclude<TopoPattern, 'solid'>, TopoLineStyleDef['id']> = {
  dashed: 'route',
  dash_dot: 'variant',
  dotted: 'hidden',
};

/** stroke-dasharray of a contract pattern at [strokeWidth]; undefined for a solid line. */
export function patternDash(pattern: TopoPattern | undefined, strokeWidth: number): string | undefined {
  if (!pattern || pattern === 'solid') return undefined;
  const style = TOPO_LINE_STYLES.find((l) => l.id === PATTERN_LINE_STYLE[pattern]);
  return style ? topoLineDash(style, strokeWidth) : undefined;
}

/** Marker size as a share of the image's shorter side (contract TopoMarker). */
export const MARKER_SIZE = 0.05;

/** SVG stroke-dasharray for a line style at [strokeWidth]; undefined for a solid line. */
export function topoLineDash(style: TopoLineStyleDef, strokeWidth: number): string | undefined {
  // 0.01 stands for a dot: with round caps a near-zero dash renders as a circle of the stroke width.
  return style.dash.length ? style.dash.map((v) => (v * strokeWidth).toFixed(2)).join(' ') : undefined;
}
