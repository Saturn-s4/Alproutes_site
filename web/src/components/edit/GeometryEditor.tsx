'use client';

import type { GeoJSONSource, LngLatBoundsLike, Map as MlMap, MapLayerMouseEvent } from 'maplibre-gl';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RouteFeature, RouteFeatureKind } from '@/lib/api/types';
import { featureKindLabel, loc } from '@/lib/i18n';
import { DEFAULT_VIEW, themeColors } from '@/lib/map-style';
import { FEATURE_ROLE } from '@/lib/route-features';
import { MapCanvas } from '../MapCanvas';
import { usePrefs } from '../Prefs';

const POINT_KINDS: RouteFeatureKind[] = ['start', 'summit', 'bivouac', 'descent_start'];
const LINE_KINDS: RouteFeatureKind[] = ['route_line', 'approach', 'descent'];

type Mode = { type: 'select' } | { type: 'point'; kind: RouteFeatureKind } | { type: 'line'; kind: RouteFeatureKind; coords: number[][] };

/** 6 decimals ≈ 0.1 m: more precision is noise, less loses detail on steep terrain. */
const round = (v: number) => Math.round(v * 1e6) / 1e6;
const pos = (lng: number, lat: number) => [round(lng), round(lat)];

/** Sets one translation of a note; an empty note becomes undefined ("no data"). */
function withText(note: RouteFeature['note'], lang: string, text: string): RouteFeature['note'] {
  const next = Object.fromEntries(Object.entries({ ...(note ?? {}), [lang]: text }).filter(([, v]) => v !== ''));
  return Object.keys(next).length ? next : undefined;
}

function coordsOf(f: RouteFeature): number[][] {
  return f.point ? [f.point.coordinates] : (f.line?.coordinates ?? []);
}

function bounds(features: RouteFeature[]): LngLatBoundsLike | null {
  const c = features.flatMap(coordsOf);
  if (c.length === 0) return null;
  const lons = c.map((p) => p[0] as number);
  const lats = c.map((p) => p[1] as number);
  return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
}

/**
 * Map editor for route geometry: any set of typed points and 2D lines (contract RouteFeature).
 * Click to place, drag to move, drag a midpoint to insert a vertex, right-click a vertex to remove it.
 */
export function GeometryEditor({
  value,
  onChange,
  center,
}: {
  value: RouteFeature[];
  onChange: (features: RouteFeature[]) => void;
  /** Where to start when there is no geometry yet (e.g. the area centre). */
  center?: [number, number] | null;
}) {
  const { t, lang } = usePrefs();
  const [mode, setMode] = useState<Mode>({ type: 'select' });
  const [selected, setSelected] = useState<number | null>(null);
  const mapRef = useRef<MlMap | null>(null);

  // Map handlers are registered once; they read current state through refs.
  const state = useRef({ value, mode, selected, onChange });
  state.current = { value, mode, selected, onChange };

  const redraw = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const { value: features, mode: m, selected: sel } = state.current;
    map.getSource<GeoJSONSource>('ed-features')?.setData({
      type: 'FeatureCollection',
      features: features.flatMap((f, i) => {
        const geometry = f.point ?? f.line;
        return geometry
          ? [{ type: 'Feature' as const, geometry, properties: { i, kind: f.kind, role: FEATURE_ROLE[f.kind], sel: i === sel ? 1 : 0 } }]
          : [];
      }),
    });
    const handles: GeoJSON.Feature[] = [];
    const line = sel != null ? features[sel]?.line : undefined;
    if (line) {
      line.coordinates.forEach((c, v) => {
        handles.push({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: { v, mid: 0 } });
        const next = line.coordinates[v + 1];
        if (next) {
          const mid = [((c[0] as number) + (next[0] as number)) / 2, ((c[1] as number) + (next[1] as number)) / 2];
          handles.push({ type: 'Feature', geometry: { type: 'Point', coordinates: mid }, properties: { v: v + 1, mid: 1 } });
        }
      });
    }
    map.getSource<GeoJSONSource>('ed-handles')?.setData({ type: 'FeatureCollection', features: handles });
    map.getSource<GeoJSONSource>('ed-draft')?.setData({
      type: 'FeatureCollection',
      features:
        m.type === 'line' && m.coords.length > 0
          ? [
              { type: 'Feature', geometry: { type: 'LineString', coordinates: m.coords.length > 1 ? m.coords : [m.coords[0]!, m.coords[0]!] }, properties: {} },
              ...m.coords.map((c) => ({ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: c }, properties: {} })),
            ]
          : [],
    });
  }, []);

  useEffect(redraw, [value, mode, selected, redraw]);

  const finishLine = useCallback(() => {
    const m = state.current.mode;
    if (m.type !== 'line') return;
    if (m.coords.length >= 2) {
      const next = [...state.current.value, { kind: m.kind, line: { type: 'LineString' as const, coordinates: m.coords } }];
      state.current.onChange(next);
      setSelected(next.length - 1);
    }
    setMode({ type: 'select' });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'Enter') finishLine();
      if (e.key === 'Escape') setMode({ type: 'select' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [finishLine]);

  const onReady = useCallback(
    (map: MlMap) => {
      mapRef.current = map;
      const empty = { type: 'FeatureCollection' as const, features: [] };
      map.addSource('ed-features', { type: 'geojson', data: empty });
      map.addSource('ed-handles', { type: 'geojson', data: empty });
      map.addSource('ed-draft', { type: 'geojson', data: empty });
      map.addLayer({
        id: 'ed-lines', type: 'line', source: 'ed-features', filter: ['==', ['geometry-type'], 'LineString'],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-width': ['case', ['==', ['get', 'sel'], 1], 6, 4] },
      });
      map.addLayer({
        id: 'ed-points', type: 'circle', source: 'ed-features', filter: ['==', ['geometry-type'], 'Point'],
        paint: { 'circle-radius': ['case', ['==', ['get', 'sel'], 1], 10, 8], 'circle-stroke-width': 3 },
      });
      map.addLayer({ id: 'ed-draft-line', type: 'line', source: 'ed-draft', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-width': 3, 'line-dasharray': [2, 1] } });
      map.addLayer({ id: 'ed-draft-pts', type: 'circle', source: 'ed-draft', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 5 } });
      map.addLayer({
        id: 'ed-handles', type: 'circle', source: 'ed-handles',
        paint: { 'circle-radius': ['case', ['==', ['get', 'mid'], 1], 5, 8], 'circle-stroke-width': 2, 'circle-opacity': ['case', ['==', ['get', 'mid'], 1], 0.6, 1] },
      });

      const paint = () => {
        const c = themeColors();
        const byRole = ['match', ['get', 'role'], 'accent', c.accent, 'blue', c.blue, c.muted] as unknown as string;
        map.setPaintProperty('ed-lines', 'line-color', byRole);
        map.setPaintProperty('ed-points', 'circle-color', byRole);
        map.setPaintProperty('ed-points', 'circle-stroke-color', ['case', ['==', ['get', 'sel'], 1], c.text, c.bg] as unknown as string);
        map.setPaintProperty('ed-draft-line', 'line-color', c.text);
        map.setPaintProperty('ed-draft-pts', 'circle-color', c.text);
        map.setPaintProperty('ed-handles', 'circle-color', c.bg);
        map.setPaintProperty('ed-handles', 'circle-stroke-color', c.text);
      };
      paint();

      map.on('click', (e) => {
        const { mode: m, value: features } = state.current;
        const p = pos(e.lngLat.lng, e.lngLat.lat);
        if (m.type === 'point') {
          const next = [...features, { kind: m.kind, point: { type: 'Point' as const, coordinates: p } }];
          state.current.onChange(next);
          setSelected(next.length - 1);
          setMode({ type: 'select' });
          return;
        }
        if (m.type === 'line') {
          setMode({ ...m, coords: [...m.coords, p] });
          return;
        }
        const hit = map.queryRenderedFeatures(e.point, { layers: ['ed-points', 'ed-lines'] })[0];
        setSelected(hit ? (hit.properties.i as number) : null);
      });
      map.on('dblclick', (e) => {
        if (state.current.mode.type === 'line') {
          e.preventDefault();
          finishLine();
        }
      });

      // Dragging: whole points, line vertices, and midpoints (which insert a vertex).
      let drag: { feature: number; vertex: number | null } | null = null;
      const startDrag = (e: MapLayerMouseEvent, layer: 'ed-points' | 'ed-handles') => {
        if (state.current.mode.type !== 'select') return;
        const f = e.features?.[0];
        if (!f) return;
        e.preventDefault();
        if (layer === 'ed-points') {
          drag = { feature: f.properties.i as number, vertex: null };
          setSelected(drag.feature);
        } else {
          const sel = state.current.selected;
          const line = sel != null ? state.current.value[sel]?.line : undefined;
          if (sel == null || !line) return;
          const v = f.properties.v as number;
          if (f.properties.mid === 1) {
            const coords = [...line.coordinates];
            coords.splice(v, 0, pos(e.lngLat.lng, e.lngLat.lat));
            update(sel, { ...state.current.value[sel]!, line: { type: 'LineString', coordinates: coords } });
          }
          drag = { feature: sel, vertex: v };
        }
        map.dragPan.disable();
        map.getCanvas().style.cursor = 'grabbing';
      };
      const update = (i: number, f: RouteFeature) => {
        const next = state.current.value.map((x, j) => (j === i ? f : x));
        state.current = { ...state.current, value: next };
        state.current.onChange(next);
      };
      map.on('mousedown', 'ed-points', (e) => startDrag(e, 'ed-points'));
      map.on('mousedown', 'ed-handles', (e) => startDrag(e, 'ed-handles'));
      map.on('mousemove', (e) => {
        if (!drag) return;
        const f = state.current.value[drag.feature];
        if (!f) return;
        const p = pos(e.lngLat.lng, e.lngLat.lat);
        if (drag.vertex == null && f.point) update(drag.feature, { ...f, point: { type: 'Point', coordinates: p } });
        else if (drag.vertex != null && f.line) {
          const coords = f.line.coordinates.map((c, k) => (k === drag!.vertex ? p : c));
          update(drag.feature, { ...f, line: { type: 'LineString', coordinates: coords } });
        }
      });
      map.on('mouseup', () => {
        if (!drag) return;
        drag = null;
        map.dragPan.enable();
        map.getCanvas().style.cursor = '';
      });
      map.on('contextmenu', 'ed-handles', (e) => {
        const f = e.features?.[0];
        const sel = state.current.selected;
        const line = sel != null ? state.current.value[sel]?.line : undefined;
        if (!f || f.properties.mid === 1 || sel == null || !line || line.coordinates.length <= 2) return;
        e.preventDefault();
        const coords = line.coordinates.filter((_, k) => k !== (f.properties.v as number));
        update(sel, { ...state.current.value[sel]!, line: { type: 'LineString', coordinates: coords } });
      });
      for (const layer of ['ed-points', 'ed-lines', 'ed-handles']) {
        map.on('mouseenter', layer, () => {
          if (state.current.mode.type === 'select') map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', layer, () => {
          if (!drag) map.getCanvas().style.cursor = '';
        });
      }

      map.doubleClickZoom.disable();
      const b = bounds(state.current.value);
      if (b) map.fitBounds(b, { padding: 60, maxZoom: 14, duration: 0 });
      redraw();
      return paint;
    },
    [finishLine, redraw],
  );

  const setFeature = (i: number, patch: Partial<RouteFeature>) => onChange(value.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const remove = (i: number) => {
    onChange(value.filter((_, j) => j !== i));
    setSelected(null);
  };
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
    setSelected(j);
  };

  const sel = selected != null ? value[selected] : undefined;
  const hint =
    mode.type === 'point' ? t('geo.hintPoint') : mode.type === 'line' ? t('geo.hintLine') : value.length ? t('geo.hintSelect') : t('geo.hintEmpty');

  return (
    <div className="geo-editor">
      <div className="geo-tools">
        <div className="geo-group">
          <span className="label">{t('geo.points')}</span>
          {POINT_KINDS.map((k) => (
            <button key={k} type="button" className="chip chip-lg" aria-pressed={mode.type === 'point' && mode.kind === k}
              onClick={() => setMode(mode.type === 'point' && mode.kind === k ? { type: 'select' } : { type: 'point', kind: k })}>
              + {featureKindLabel(k, lang)}
            </button>
          ))}
        </div>
        <div className="geo-group">
          <span className="label">{t('geo.lines')}</span>
          {LINE_KINDS.map((k) => (
            <button key={k} type="button" className="chip chip-lg" aria-pressed={mode.type === 'line' && mode.kind === k}
              onClick={() => setMode(mode.type === 'line' && mode.kind === k ? { type: 'select' } : { type: 'line', kind: k, coords: [] })}>
              + {featureKindLabel(k, lang)}
            </button>
          ))}
          {mode.type === 'line' && (
            <>
              <button type="button" className="btn btn-sm btn-primary" disabled={mode.coords.length < 2} onClick={finishLine}>{t('geo.finish')}</button>
              <button type="button" className="btn btn-sm btn-ghost" disabled={mode.coords.length === 0}
                onClick={() => setMode({ ...mode, coords: mode.coords.slice(0, -1) })}>{t('geo.undo')}</button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setMode({ type: 'select' })}>{t('geo.cancel')}</button>
            </>
          )}
        </div>
      </div>
      <div className="geo-body">
        <div className="geo-map">
          <MapCanvas center={center ?? DEFAULT_VIEW.center} zoom={center ? 12 : DEFAULT_VIEW.zoom} onReady={onReady} />
          <div className="map-overlay map-notice">{hint}</div>
        </div>
        <div className="geo-side">
          <ol className="geo-list">
            {value.map((f, i) => (
              <li key={i}>
                <button type="button" className="geo-item" aria-current={i === selected} onClick={() => setSelected(i)}>
                  <span className={`swatch${f.point ? ' pt' : ''}`} style={{ background: `var(--${{ accent: 'accent', blue: 'blue-text', muted: 'muted' }[FEATURE_ROLE[f.kind]]})` }} />
                  <span>{featureKindLabel(f.kind, lang)}</span>
                  {f.line && <span className="mono muted">{f.line.coordinates.length} {t('geo.vertices')}</span>}
                  {f.note && <span className="muted">· {loc(f.note, lang)?.text}</span>}
                </button>
              </li>
            ))}
          </ol>
          {value.length === 0 && <p className="muted">{t('geo.none')}</p>}
          {sel && selected != null && (
            <div className="box geo-props">
              <div className="row">
                <b>{featureKindLabel(sel.kind, lang)}</b>
                <span className="spacer" />
                <button type="button" className="btn btn-sm btn-ghost" aria-label={t('geo.up')} onClick={() => move(selected, -1)}>↑</button>
                <button type="button" className="btn btn-sm btn-ghost" aria-label={t('geo.down')} onClick={() => move(selected, 1)}>↓</button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => remove(selected)}>{t('geo.delete')}</button>
              </div>
              {sel.point && (
                <>
                  <span className="mono muted">{sel.point.coordinates[1]?.toFixed(5)}, {sel.point.coordinates[0]?.toFixed(5)}</span>
                  <label className="field">
                    {t('geo.elevation')}
                    <input className="input" type="number" min={-500} max={9000} placeholder={t('common.noData')}
                      value={sel.elevationM ?? ''}
                      onChange={(e) => setFeature(selected, { elevationM: e.target.value === '' ? null : Number(e.target.value) })} />
                  </label>
                </>
              )}
              <label className="field">
                {t('geo.note')} (RU)
                <input className="input" maxLength={1000} value={sel.note?.ru ?? ''}
                  onChange={(e) => setFeature(selected, { note: withText(sel.note, 'ru', e.target.value) })} />
              </label>
              <label className="field">
                {t('geo.note')} (EN)
                <input className="input" maxLength={1000} value={sel.note?.en ?? ''}
                  onChange={(e) => setFeature(selected, { note: withText(sel.note, 'en', e.target.value) })} />
              </label>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
