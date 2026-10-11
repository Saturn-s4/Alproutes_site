'use client';

import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { Photo } from '@/lib/api/types';
import { newId } from '@/lib/edit';
import { topoStyleLabel } from '@/lib/i18n';
import { segmentDistance, simplifyStroke, TOPO_COLORS, TOPO_STYLES, topoPathD, type TopoDrawing, type TopoPath, type TopoStyle } from '@/lib/topo';
import { usePrefs } from '../Prefs';
import { TopoOverlay } from '../TopoOverlay';

type Pt = [number, number];
type Tool = 'draw' | 'edit';
type Defaults = { style: TopoStyle; dashed: boolean; smooth: boolean };

/** Freehand strokes are reduced to anchors with this tolerance, as a share of the image diagonal. */
const SIMPLIFY = 0.004;
const MAX_POINTS = 2000;
const MAX_PATHS = 20;

/**
 * Full-screen editor of one route's line on one photo. Draw freehand (the stroke becomes a few
 * anchors and a smooth spline), pick the line type, solid or dashed; in edit mode drag anchors,
 * double-click a line to add an anchor, double-click an anchor to remove it.
 * Coordinates are shares of the image size after EXIF rotation (contract TopoPoint).
 */
export function TopoEditor({
  photo, initial, onSave, onClose,
}: { photo: Photo; initial: TopoDrawing | null; onSave: (d: TopoDrawing) => void; onClose: () => void }) {
  const { t, lang } = usePrefs();
  const w = photo.widthPx ?? 1;
  const h = photo.heightPx ?? 1;
  const svgRef = useRef<SVGSVGElement>(null);
  const [paths, setPaths] = useState<TopoPath[]>(initial?.paths ?? []);
  const [history, setHistory] = useState<TopoPath[][]>([]);
  const [tool, setTool] = useState<Tool>(initial?.paths.length ? 'edit' : 'draw');
  const [selected, setSelected] = useState<string | null>(null);
  const [defaults, setDefaults] = useState<Defaults>({ style: 'main', dashed: false, smooth: true });
  const [stroke, setStroke] = useState<Pt[] | null>(null);
  // Refs hold the latest values for pointer handlers: events can arrive faster than React re-renders.
  const pathsRef = useRef(paths);
  const strokeRef = useRef<Pt[] | null>(null);
  const drag = useRef<{ pathId: string; index: number; moved: boolean } | null>(null);
  /** The click that ends a drag must not deselect the line. */
  const justDragged = useRef(false);
  // Markers and labels are not edited here yet; they are kept as they were.
  const extras = { markers: initial?.markers, labels: initial?.labels };

  const show = (next: TopoPath[]) => {
    pathsRef.current = next;
    setPaths(next);
  };
  /** Every change is made from the latest paths and leaves an undo step. */
  const commit = useCallback((change: (ps: TopoPath[]) => TopoPath[]) => {
    const prev = pathsRef.current;
    setHistory((hs) => [...hs.slice(-49), prev]);
    show(change(prev));
  }, []);

  const undo = useCallback(() => {
    setHistory((hs) => {
      if (!hs.length) return hs;
      show(hs[hs.length - 1]!);
      return hs.slice(0, -1);
    });
  }, []);

  const removeSelected = useCallback(() => {
    if (!selected) return;
    commit((ps) => ps.filter((p) => p.id !== selected));
    setSelected(null);
  }, [selected, commit]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') removeSelected();
      else if (e.key === 'Escape') setSelected(null);
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

  const sel = paths.find((p) => p.id === selected);
  const current: Defaults = sel ? { style: sel.style, dashed: sel.dashed ?? false, smooth: sel.smooth ?? true } : defaults;
  /** Sets the type of the selected line (edit mode) and of the lines drawn next. */
  const setProp = (patch: Partial<Defaults>) => {
    setDefaults((d) => ({ ...d, ...patch }));
    if (sel) commit((ps) => ps.map((p) => (p.id === sel.id ? { ...p, ...patch } : p)));
  };

  // ------------------------------------------------------------------ drawing

  const onDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (tool !== 'draw' || e.button !== 0) return;
    if (pathsRef.current.length >= MAX_PATHS) return;
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
    if (d) {
      const p = norm(toImage(e));
      d.moved = true;
      show(pathsRef.current.map((x) => (x.id === d.pathId ? { ...x, points: x.points.map((q, i) => (i === d.index ? p : q)) } : x)));
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
        const line = { id: newId().slice(0, 8), style: defaults.style, dashed: defaults.dashed, smooth: defaults.smooth, points: anchors.map(norm) };
        commit((ps) => [...ps, line]);
      }
    }
    justDragged.current = drag.current?.moved ?? false;
    drag.current = null;
  };

  // ------------------------------------------------------------------ editing anchors

  const startDrag = (e: ReactPointerEvent, pathId: string, index: number) => {
    if (tool !== 'edit') return;
    e.stopPropagation();
    if (svgRef.current) capture(svgRef.current, e.pointerId);
    // Snapshot for undo before the first move.
    const prev = pathsRef.current;
    setHistory((hs) => [...hs.slice(-49), prev]);
    drag.current = { pathId, index, moved: false };
    setSelected(pathId);
  };

  const removeAnchor = (pathId: string, index: number) => {
    const p = pathsRef.current.find((x) => x.id === pathId);
    if (!p || p.points.length <= 2) return;
    commit((ps) => ps.map((x) => (x.id === pathId ? { ...x, points: x.points.filter((_, i) => i !== index) } : x)));
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
    commit((ps) => ps.map((x) => (x.id === path.id ? { ...x, points } : x)));
  };

  // No lines left is a drawing too: it removes the line from the photo (contract TopoDrawing.paths).
  const save = () => onSave({ formatVersion: 1, paths, ...extras });
  const handle = 6 * scale();

  return (
    <div className="topo-editor" role="dialog" aria-modal="true" aria-label={t('topo.title')}>
      <div className="topo-toolbar">
        <div className="chips">
          <button type="button" className="chip chip-lg" aria-pressed={tool === 'draw'} onClick={() => { setTool('draw'); setSelected(null); }}>
            ✎ {t('topo.draw')}
          </button>
          <button type="button" className="chip chip-lg" aria-pressed={tool === 'edit'} onClick={() => setTool('edit')}>
            ⤧ {t('topo.edit')}
          </button>
        </div>
        <span className="topo-sep" />
        <div className="chips">
          {TOPO_STYLES.map((s) => (
            <button key={s} type="button" className="chip chip-lg" aria-pressed={current.style === s} onClick={() => setProp({ style: s })}>
              <span className="topo-swatch" style={{ background: TOPO_COLORS[s] }} />{topoStyleLabel(s, lang)}
            </button>
          ))}
        </div>
        <span className="topo-sep" />
        <div className="chips">
          <button type="button" className="chip chip-lg" aria-pressed={!current.dashed} onClick={() => setProp({ dashed: false })}>
            <svg width="28" height="10" aria-hidden="true"><line x1="2" y1="5" x2="26" y2="5" stroke="currentColor" strokeWidth="3" /></svg>
            {t('topo.solid')}
          </button>
          <button type="button" className="chip chip-lg" aria-pressed={current.dashed} onClick={() => setProp({ dashed: true })}>
            <svg width="28" height="10" aria-hidden="true"><line x1="2" y1="5" x2="26" y2="5" stroke="currentColor" strokeWidth="3" strokeDasharray="6 4" /></svg>
            {t('topo.dashed')}
          </button>
          <button type="button" className="chip chip-lg" aria-pressed={current.smooth} onClick={() => setProp({ smooth: !current.smooth })}
            title={t('topo.smoothHint')}>
            {current.smooth ? '∿' : '⟋'} {t('topo.smooth')}
          </button>
        </div>
        <span className="topo-sep" />
        <button type="button" className="btn btn-sm btn-ghost" onClick={undo} disabled={!history.length}>↶ {t('topo.undo')}</button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={removeSelected} disabled={!sel}>{t('topo.deleteLine')}</button>
        <span style={{ flexGrow: 1 }} />
        <button type="button" className="btn btn-ghost" onClick={onClose}>{t('geo.cancel')}</button>
        <button type="button" className="btn btn-primary" onClick={save}>{t('topo.done')}</button>
      </div>

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
              if (tool === 'edit' && e.target === e.currentTarget) setSelected(null);
            }}
          >
            {/* The same rendering as on the route page: the editor shows exactly what will be published. */}
            {paths.length > 0 && <TopoOverlay drawing={{ formatVersion: 1, paths }} width={w} height={h} strokeWidth={4} />}
            {/* Wide invisible strokes: easy to hit with a mouse or a finger. */}
            {tool === 'edit' && paths.map((p) => (
              <path key={p.id} d={topoPathD(p.points, w, h, p.smooth ?? true)} className="topo-hit"
                style={{ strokeWidth: 16 }} vectorEffect="non-scaling-stroke"
                onClick={(e) => { e.stopPropagation(); setSelected(p.id); }}
                onDoubleClick={(e) => { e.stopPropagation(); insertAnchor(e, p); }} />
            ))}
            {stroke && stroke.length > 1 && (
              <polyline points={stroke.map((q) => q.join(',')).join(' ')} className="topo-stroke"
                style={{ stroke: TOPO_COLORS[defaults.style] }} vectorEffect="non-scaling-stroke" />
            )}
            {sel && tool === 'edit' && sel.points.map((q, i) => (
              <circle key={i} cx={q.x * w} cy={q.y * h} r={handle} className={`topo-handle${i === 0 || i === sel.points.length - 1 ? ' end' : ''}`}
                onPointerDown={(e) => startDrag(e, sel.id, i)}
                onDoubleClick={(e) => { e.stopPropagation(); removeAnchor(sel.id, i); }} />
            ))}
          </svg>
        </div>
      </div>

      <p className="topo-help">
        {tool === 'draw' ? t('topo.helpDraw') : t('topo.helpEdit')}
        {' · '}{t('topo.counts').replace('{n}', String(paths.length)).replace('{p}', String(paths.reduce((n, p) => n + p.points.length, 0)))}
      </p>
    </div>
  );
}

/** Keeps the stroke going when the pointer leaves the image; a pointer that is already gone cannot be captured. */
function capture(el: Element, pointerId: number) {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    // Not an active pointer (e.g. released already): drawing still works inside the image.
  }
}
