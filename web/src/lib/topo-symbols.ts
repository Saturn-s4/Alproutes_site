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

/**
 * Symbol for each marker kind the contract knows today (TopoMarker.kind). Lets clients draw
 * markers with these glyphs before the contract carries a symbol id of its own.
 */
export const MARKER_KIND_SYMBOL: Record<NonNullable<TopoDrawing['markers']>[number]['kind'], TopoSymbolId> = {
  belay: 'belay_good',
  crux: 'crux',
  bivouac: 'bivouac_good',
  rappel: 'rappel',
  key_point: 'cairn',
};

/** SVG stroke-dasharray for a line style at [strokeWidth]; undefined for a solid line. */
export function topoLineDash(style: TopoLineStyleDef, strokeWidth: number): string | undefined {
  // 0.01 stands for a dot: with round caps a near-zero dash renders as a circle of the stroke width.
  return style.dash.length ? style.dash.map((v) => (v * strokeWidth).toFixed(2)).join(' ') : undefined;
}
