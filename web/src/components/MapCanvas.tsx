'use client';

import type { Map as MlMap } from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import { baseStyle, rasterPaint } from '@/lib/map-style';
import { useResolvedTheme } from './Prefs';

/** Copied to /public by `npm run prepare:assets` (see scripts/copy-maplibre-worker.mjs). */
const WORKER_URL = '/maplibre/maplibre-gl-worker.mjs';

type Props = {
  center: [number, number];
  zoom: number;
  /**
   * Called once the style is loaded; add sources and layers here.
   * May return a repaint function, called when the theme changes (canvas layers cannot use CSS variables).
   */
  onReady: (map: MlMap) => (() => void) | void;
  className?: string;
};

/** MapLibre map bound to the app theme. Loaded on the client only. */
export function MapCanvas({ center, zoom, onReady, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const theme = useResolvedTheme();
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const repaintRef = useRef<(() => void) | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let map: MlMap | null = null;
    void import('maplibre-gl')
      .then((ml) => {
        if (cancelled || !ref.current) return;
        ml.setWorkerUrl(WORKER_URL);
        const m = new ml.Map({
          container: ref.current,
          style: baseStyle(themeRef.current),
          center,
          zoom,
          attributionControl: { compact: true },
          // Offline tiles and battery matter more than smooth animations on weak devices.
          fadeDuration: 0,
        });
        map = m;
        m.on('load', () => {
          if (cancelled) return;
          mapRef.current = m;
          repaintRef.current = onReadyRef.current(m) ?? null;
          // The theme may have changed while the map was loading.
          applyTheme(m, themeRef.current, repaintRef.current);
        });
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
      mapRef.current = null;
      repaintRef.current = null;
      map?.remove();
    };
    // The map is created once; center/zoom are initial values only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (map) applyTheme(map, theme, repaintRef.current);
  }, [theme]);

  if (failed) return <div className={className}><p className="empty">WebGL map failed to load.</p></div>;
  return <div ref={ref} className={className ?? 'map-canvas'} />;
}

function applyTheme(map: MlMap, theme: 'dark' | 'light', repaint: (() => void) | null) {
  for (const [k, v] of Object.entries(rasterPaint(theme))) {
    map.setPaintProperty('topo', k as Parameters<MlMap['setPaintProperty']>[1], v);
  }
  repaint?.();
}
