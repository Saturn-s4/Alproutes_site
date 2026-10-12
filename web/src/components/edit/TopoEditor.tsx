'use client';

import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { Photo } from '@/lib/api/types';
import { newId } from '@/lib/edit';
import { topoStyleLabel } from '@/lib/i18n';
import { segmentDistance, simplifyStroke, TOPO_COLORS, TOPO_STYLES, topoPathD, type TopoDrawing, type TopoPath, type TopoStyle } from '@/lib/topo';
import { MARKER_SIZE, patternDash, topoSymbol, topoSymbolPalette, type TopoPattern } from '@/lib/topo-symbols';
import { usePrefs } from '../Prefs';
import { TopoOverlay } from '../TopoOverlay';
import { TopoSymbolIcon } from '../TopoSymbol';

type Pt = [number, number];
type Marker = NonNullable<TopoDrawing['markers']>[number];
type Tool = 'draw' | 'symbol' | 'edit';
type Defaults = { style: TopoStyle; pattern: TopoPattern; arrowEnd: boolean; smooth: boolean };
/** What the editor changes as one unit: lines and symbols share one undo history. */
type Picture = { paths: TopoPath[]; markers: Marker[] };
type Selection = { kind: 'path'; id: string } | { kind: 'marker'; index: number } | null;

/** Freehand strokes are reduced to anchors with this tolerance, as a share of the image diagonal. */
const SIMPLIFY = 0.004;
const MAX_POINTS = 2000;
const MAX_PATHS = 20;
const MAX_MARKERS = 200;
const PATTERNS: TopoPattern[] = ['solid', 'dashed', 'dash_dot', 'dotted'];

/**
 * Full-screen editor of one route's line on one photo.
 * - Draw: freehand; the stroke becomes a few anchors and a smooth spline.
 * - Symbols: pick a topo symbol (shared set, shared/topo-symbols) and click where it goes.
 * - Edit: drag anchors and symbols; double-click a line to add an anchor, an anchor to remove it;
 *   a selected symbol gets a short label and a rotation.
 * Coordinates are shares of the image size after EXIF rotation (contract TopoPoint).
 */
export function TopoEditor({
  photo, initial, onSave, onClose,
}: { photo: Photo; initial: TopoDrawing | null; onSave: (d: TopoDrawing) => void; onClose: () => void }) {
  const { t, lang } = usePrefs();
  const w = photo.widthPx ?? 1;
  const h = photo.heightPx ?? 1;
  const svgRef = useRef<SVGSVGElement>(null);
  const [pic, setPic] = useState<Picture>(() => fromDrawing(initial));
  const [history, setHistory] = useState<Picture[]>([]);
  const [tool, setTool] = useState<Tool>(initial?.paths.length ? 'edit' : 'draw');
  const [sel, setSel] = useState<Selection>(null);
  const [defaults, setDefaults] = useState<Defaults>({ style: 'main', pattern: 'solid', arrowEnd: false, smooth: true });
  const [symbol, setSymbol] = useState<string>('belay_good');
  const [humor, setHumor] = useState(false);
  const [stroke, setStroke] = useState<Pt[] | null>(null);
  // Refs hold the latest values for pointer handlers: events can arrive faster than React re-renders.
  const picRef = useRef(pic);
  const strokeRef = useRef<Pt[] | null>(null);
  const drag = useRef<{ target: Exclude<Selection, null>; index: number; moved: boolean } | null>(null);
  /** The click that ends a drag must not deselect what was dragged. */
  const justDragged = useRef(false);
  // Section labels are not edited here yet; they are kept as they were.
  const labels = initial?.labels;

  const show = (next: Picture) => {
    picRef.current = next;
    setPic(next);
  };
  /** Every change is made from the latest picture and leaves an undo step. */
  const commit = useCallback((change: (p: Picture) => Picture) => {
    const prev = picRef.current;
    setHistory((hs) => [...hs.slice(-49), prev]);
    show(change(prev));
  }, []);

  const undo = useCallback(() => {
    setHistory((hs) => {
      if (!hs.length) return hs;
      show(hs[hs.length - 1]!);
      return hs.slice(0, -1);
    });
    setSel(null);
  }, []);

  const removeSelected = useCallback(() => {
    if (!sel) return;
    if (sel.kind === 'path') commit((p) => ({ ...p, paths: p.paths.filter((x) => x.id !== sel.id) }));
    else commit((p) => ({ ...p, markers: p.markers.filter((_, i) => i !== sel.index) }));
    setSel(null);
  }, [sel, commit]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') removeSelected();
      else if (e.key === 'Escape') setSel(null);
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [undo, removeSelected]);

  /** Pointer position in image pixels, clamped to the image. */
  const toImage = (e: { clientX: number; clientY: number }): Pt => {
    const r = svgRef.current!.getBoundingClientRect();
    return [
      Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1) * w,
      Math.min(Math.max((e.clientY - r.top) / r.height, 0), 1) * h,
    ];
  };
  /** Image pixels per screen pixel: thresholds below are in screen pixels. */
  const scale = () => w / (svgRef.current?.getBoundingClientRect().width || w);
  const norm = ([x, y]: Pt) => ({ x: Math.round((x / w) * 1e5) / 1e5, y: Math.round((y / h) * 1e5) / 1e5 });

  const selPath = sel?.kind === 'path' ? pic.paths.find((p) => p.id === sel.id) : undefined;
  const selMarker = sel?.kind === 'marker' ? pic.markers[sel.index] : undefined;
  const current: Defaults = selPath
    ? { style: selPath.style, pattern: selPath.pattern ?? 'solid', arrowEnd: selPath.arrowEnd ?? false, smooth: selPath.smooth ?? true }
    : defaults;
  /** Sets the type of the selected line (edit mode) and of the lines drawn next. */
  const setProp = (patch: Partial<Defaults>) => {
    setDefaults((d) => ({ ...d, ...patch }));
    if (selPath) commit((p) => ({ ...p, paths: p.paths.map((x) => (x.id === selPath.id ? { ...x, ...patch } : x)) }));
  };
  const setMarker = (patch: Partial<Marker>) => {
    if (sel?.kind !== 'marker') return;
    commit((p) => ({ ...p, markers: p.markers.map((m, i) => (i === sel.index ? { ...m, ...patch } : m)) }));
  };

  // ------------------------------------------------------------------ drawing and placing

  const onDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    if (tool === 'symbol') {
      if (picRef.current.markers.length >= MAX_MARKERS) return;
      const at = norm(toImage(e));
      commit((p) => ({ ...p, markers: [...p.markers, { ...at, symbol, rotation: 0 }] }));
      return;
    }
    if (tool !== 'draw' || picRef.current.paths.length >= MAX_PATHS) return;
    capture(e.currentTarget, e.pointerId);
    strokeRef.current = [toImage(e)];
    setStroke(strokeRef.current);
  };
  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const st = strokeRef.current;
    if (st) {
      const p = toImage(e);
      const last = st[st.length - 1]!;
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= 2 * scale()) {
        strokeRef.current = [...st, p];
        setStroke(strokeRef.current);
      }
      return;
    }
    const d = drag.current;
    if (!d) return;
    const at = norm(toImage(e));
    d.moved = true;
    const cur = picRef.current;
    if (d.target.kind === 'marker') {
      show({ ...cur, markers: cur.markers.map((m, i) => (i === d.index ? { ...m, ...at } : m)) });
    } else {
      const id = d.target.id;
      show({ ...cur, paths: cur.paths.map((x) => (x.id === id ? { ...x, points: x.points.map((q, i) => (i === d.index ? at : q)) } : x)) });
    }
  };
  const onUp = () => {
    const st = strokeRef.current;
    if (st) {
      strokeRef.current = null;
      setStroke(null);
      const anchors = simplifyStroke(st, SIMPLIFY * Math.hypot(w, h)).slice(0, MAX_POINTS);
      const span = anchors.length >= 2
        ? Math.hypot(anchors[anchors.length - 1]![0] - anchors[0]![0], anchors[anchors.length - 1]![1] - anchors[0]![1]) : 0;
      // A click without a drag is not a line. The new line is not selected: the type buttons keep
      // setting up the next stroke instead of silently restyling this one.
      if (span > 6 * scale()) {
        const line: TopoPath = {
          id: newId().slice(0, 8), style: defaults.style, pattern: defaults.pattern, arrowEnd: defaults.arrowEnd,
          smooth: defaults.smooth, points: anchors.map(norm),
        };
        commit((p) => ({ ...p, paths: [...p.paths, line] }));
      }
    }
    justDragged.current = drag.current?.moved ?? false;
    drag.current = null;
  };

  // ------------------------------------------------------------------ editing

  const startDrag = (e: ReactPointerEvent, target: Exclude<Selection, null>, index: number) => {
    if (tool !== 'edit') return;
    e.stopPropagation();
    if (svgRef.current) capture(svgRef.current, e.pointerId);
    // Snapshot for undo before the first move.
    const prev = picRef.current;
    setHistory((hs) => [...hs.slice(-49), prev]);
    drag.current = { target, index, moved: false };
    setSel(target);
  };

  const removeAnchor = (pathId: string, index: number) => {
    const p = picRef.current.paths.find((x) => x.id === pathId);
    if (!p || p.points.length <= 2) return;
    commit((c) => ({ ...c, paths: c.paths.map((x) => (x.id === pathId ? { ...x, points: x.points.filter((_, i) => i !== index) } : x)) }));
  };

  const insertAnchor = (e: ReactMouseEvent, path: TopoPath) => {
    if (tool !== 'edit' || path.points.length >= MAX_POINTS) return;
    const at = toImage(e);
    const px: Pt[] = path.points.map((q) => [q.x * w, q.y * h]);
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < px.length - 1; i++) {
      const d = segmentDistance(at, px[i]!, px[i + 1]!);
      if (d < bestD) { bestD = d; best = i; }
    }
    const points = [...path.points];
    points.splice(best + 1, 0, norm(at));
    commit((c) => ({ ...c, paths: c.paths.map((x) => (x.id === path.id ? { ...x, points } : x)) }));
  };

  // No lines and no symbols left is a drawing too: it removes the line from the photo (contract TopoDrawing.paths).
  const save = () => onSave({
    formatVersion: 1, paths: pic.paths,
    ...(pic.markers.length ? { markers: pic.markers } : {}),
    ...(labels?.length ? { labels } : {}),
  });
  const handle = 6 * scale();
  const markerSize = MARKER_SIZE * Math.min(w, h);
  const pickTool = (next: Tool) => { setTool(next); setSel(null); };

  return (
    <div className="topo-editor" role="dialog" aria-modal="true" aria-label={t('topo.title')}>
      <div className="topo-toolbar">
        <div className="chips">
          <button type="button" className="chip chip-lg" aria-pressed={tool === 'draw'} onClick={() => pickTool('draw')}>✎ {t('topo.draw')}</button>
          <button type="button" className="chip chip-lg" aria-pressed={tool === 'symbol'} onClick={() => pickTool('symbol')}>
            <TopoSymbolIcon id={symbol} size={18} /> {t('topo.symbols')}
          </button>
          <button type="button" className="chip chip-lg" aria-pressed={tool === 'edit'} onClick={() => setTool('edit')}>⤧ {t('topo.edit')}</button>
        </div>
        <span className="topo-sep" />
        {(tool === 'draw' || selPath) && (
          <>
            <div className="chips">
              {TOPO_STYLES.map((s) => (
                <button key={s} type="button" className="chip chip-lg" aria-pressed={current.style === s} onClick={() => setProp({ style: s })}>
                  <span className="topo-swatch" style={{ background: TOPO_COLORS[s] }} />{topoStyleLabel(s, lang)}
                </button>
              ))}
            </div>
            <span className="topo-sep" />
            <div className="chips">
              {PATTERNS.map((p) => (
                <button key={p} type="button" className="chip chip-lg" aria-pressed={current.pattern === p} onClick={() => setProp({ pattern: p })}
                  title={t(`topo.pattern.${p}`)}>
                  <svg width="34" height="10" aria-hidden="true">
                    <line x1="3" y1="5" x2="31" y2="5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray={patternDash(p, 3)} />
                  </svg>
                  {t(`topo.pattern.${p}`)}
                </button>
              ))}
              <button type="button" className="chip chip-lg" aria-pressed={current.arrowEnd} onClick={() => setProp({ arrowEnd: !current.arrowEnd })}>
                → {t('topo.arrow')}
              </button>
              <button type="button" className="chip chip-lg" aria-pressed={current.smooth} onClick={() => setProp({ smooth: !current.smooth })}
                title={t('topo.smoothHint')}>
                {current.smooth ? '∿' : '⟋'} {t('topo.smooth')}
              </button>
            </div>
            <span className="topo-sep" />
          </>
        )}
        {selMarker && (
          <>
            <div className="topo-marker-props">
              <TopoSymbolIcon id={selMarker.symbol} size={22} />
              <span>{symbolLabel(selMarker.symbol, lang)}</span>
              <input className="input" maxLength={50} placeholder={t('topo.markerLabel')} value={selMarker.label ?? ''}
                onChange={(e) => setMarker({ label: e.target.value || undefined })} />
              <button type="button" className="btn btn-sm btn-ghost" title={t('topo.rotate')}
                onClick={() => setMarker({ rotation: ((selMarker.rotation ?? 0) + 315) % 360 })}>↺</button>
              <button type="button" className="btn btn-sm btn-ghost" title={t('topo.rotate')}
                onClick={() => setMarker({ rotation: ((selMarker.rotation ?? 0) + 45) % 360 })}>↻</button>
            </div>
            <span className="topo-sep" />
          </>
        )}
        <button type="button" className="btn btn-sm btn-ghost" onClick={undo} disabled={!history.length}>↶ {t('topo.undo')}</button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={removeSelected} disabled={!sel}>
          {selMarker ? t('topo.deleteSymbol') : t('topo.deleteLine')}
        </button>
        <span style={{ flexGrow: 1 }} />
        <button type="button" className="btn btn-ghost" onClick={onClose}>{t('geo.cancel')}</button>
        <button type="button" className="btn btn-primary" onClick={save}>{t('topo.done')}</button>
      </div>

      <div className="topo-body">
        {tool === 'symbol' && (
          <aside className="topo-palette" aria-label={t('topo.symbols')}>
            {topoSymbolPalette(humor).map(({ group, symbols }) => (
              <section key={group.id}>
                <h3>{group.label[lang]}</h3>
                <div className="topo-palette-grid">
                  {symbols.map((s) => (
                    <button key={s.id} type="button" aria-pressed={symbol === s.id} title={s.label[lang]} onClick={() => setSymbol(s.id)}>
                      <TopoSymbolIcon id={s.id} size={26} />
                      <span>{s.label[lang]}</span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
            <label className="check-row topo-humor">
              <input type="checkbox" checked={humor} onChange={(e) => setHumor(e.target.checked)} />
              <span className="t">{t('topo.humor')}</span>
            </label>
          </aside>
        )}
        <div className="topo-stage">
          <div className="topo-canvas" style={{ aspectRatio: `${w} / ${h}` }}>
            <img src={photo.urls?.full} alt="" draggable={false} />
            <svg
              ref={svgRef}
              className={`topo-input tool-${tool}`}
              viewBox={`0 0 ${w} ${h}`}
              preserveAspectRatio="none"
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              onClick={(e) => {
                if (justDragged.current) { justDragged.current = false; return; }
                if (tool === 'edit' && e.target === e.currentTarget) setSel(null);
              }}
            >
              {/* The same rendering as on the route page: the editor shows exactly what will be published. */}
              {(pic.paths.length > 0 || pic.markers.length > 0) && (
                <TopoOverlay drawing={{ formatVersion: 1, paths: pic.paths, markers: pic.markers }} width={w} height={h} strokeWidth={4} />
              )}
              {/* Wide invisible strokes and discs: easy to hit with a mouse or a finger. */}
              {tool === 'edit' && pic.paths.map((p) => (
                <path key={p.id} d={topoPathD(p.points, w, h, p.smooth ?? true)} className="topo-hit"
                  style={{ strokeWidth: 16 }} vectorEffect="non-scaling-stroke"
                  onClick={(e) => { e.stopPropagation(); setSel({ kind: 'path', id: p.id }); }}
                  onDoubleClick={(e) => { e.stopPropagation(); insertAnchor(e, p); }} />
              ))}
              {tool === 'edit' && pic.markers.map((m, i) => (
                <circle key={`m${i}`} cx={m.x * w} cy={m.y * h} r={markerSize * 0.62}
                  className={`topo-marker-hit${sel?.kind === 'marker' && sel.index === i ? ' selected' : ''}`}
                  vectorEffect="non-scaling-stroke"
                  onPointerDown={(e) => startDrag(e, { kind: 'marker', index: i }, i)}
                  onClick={(e) => e.stopPropagation()} />
              ))}
              {stroke && stroke.length > 1 && (
                <polyline points={stroke.map((q) => q.join(',')).join(' ')} className="topo-stroke"
                  style={{ stroke: TOPO_COLORS[defaults.style] }} vectorEffect="non-scaling-stroke" />
              )}
              {selPath && tool === 'edit' && selPath.points.map((q, i) => (
                <circle key={i} cx={q.x * w} cy={q.y * h} r={handle} className={`topo-handle${i === 0 || i === selPath.points.length - 1 ? ' end' : ''}`}
                  onPointerDown={(e) => startDrag(e, { kind: 'path', id: selPath.id }, i)}
                  onDoubleClick={(e) => { e.stopPropagation(); removeAnchor(selPath.id, i); }} />
              ))}
            </svg>
          </div>
        </div>
      </div>

      <p className="topo-help">
        {tool === 'draw' ? t('topo.helpDraw') : tool === 'symbol' ? t('topo.helpSymbol') : t('topo.helpEdit')}
        {' · '}{t('topo.counts')
          .replace('{n}', String(pic.paths.length))
          .replace('{p}', String(pic.paths.reduce((n, p) => n + p.points.length, 0)))
          .replace('{s}', String(pic.markers.length))}
      </p>
    </div>
  );
}

/**
 * Only contract fields go back to the server (it refuses unknown ones). Drawings saved before line
 * patterns and symbols had `dashed` and marker `kind`: the first becomes the dashed pattern, markers
 * without a symbol are dropped.
 */
function fromDrawing(d: TopoDrawing | null): Picture {
  const paths = (d?.paths ?? []).map((p) => {
    const legacy = p as TopoPath & { dashed?: boolean };
    return {
      id: p.id, style: p.style, points: p.points, smooth: p.smooth ?? true, arrowEnd: p.arrowEnd ?? false,
      pattern: p.pattern ?? (legacy.dashed ? 'dashed' : 'solid'),
    } satisfies TopoPath;
  });
  const markers = (d?.markers ?? [])
    .filter((m) => typeof m.symbol === 'string')
    .map((m) => ({ x: m.x, y: m.y, symbol: m.symbol, rotation: m.rotation ?? 0, ...(m.label ? { label: m.label } : {}) }));
  return { paths, markers };
}

function symbolLabel(id: string, lang: 'ru' | 'en'): string {
  return topoSymbol(id)?.label[lang] ?? id;
}

/** Keeps the stroke going when the pointer leaves the image; a pointer that is already gone cannot be captured. */
function capture(el: Element, pointerId: number) {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    // Not an active pointer (e.g. released already): drawing still works inside the image.
  }
}
