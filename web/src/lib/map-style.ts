import type { StyleSpecification } from 'maplibre-gl';

// TODO: move to /shared once the Android client needs the same style (CLAUDE.md: one style for both).
// OpenTopoMap: free for low-traffic use with attribution; a self-hosted OSM+DEM tile server replaces it later.
export function baseStyle(theme: 'dark' | 'light'): StyleSpecification {
  return {
    version: 8,
    sources: {
      topo: {
        type: 'raster',
        tiles: ['a', 'b', 'c'].map((s) => `https://${s}.tile.opentopomap.org/{z}/{x}/{y}.png`),
        tileSize: 256,
        maxzoom: 17,
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>, SRTM · ' +
          '<a href="https://opentopomap.org" target="_blank" rel="noreferrer">OpenTopoMap</a> (CC-BY-SA)',
      },
    },
    layers: [{ id: 'topo', type: 'raster', source: 'topo', paint: rasterPaint(theme) }],
  };
}

/**
 * Dark theme mirrors the prototype's CSS filter (invert + hue-rotate) with raster paint
 * properties: min > max inverts brightness, so vector overlays keep their real colours.
 */
export function rasterPaint(theme: 'dark' | 'light') {
  return theme === 'dark'
    ? { 'raster-brightness-min': 0.82, 'raster-brightness-max': 0.06, 'raster-hue-rotate': 180, 'raster-saturation': -0.45, 'raster-contrast': -0.08 }
    : { 'raster-brightness-min': 0, 'raster-brightness-max': 1, 'raster-hue-rotate': 0, 'raster-saturation': -0.15, 'raster-contrast': 0 };
}

/** Theme colours from CSS tokens, for map layers (canvas cannot read CSS variables). */
export function themeColors() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  return { accent: v('--accent'), blue: v('--blue-text'), bg: v('--bg'), muted: v('--muted'), text: v('--text') };
}

/** Default view: Central Caucasus, until the catalogue has its own starting point. */
export const DEFAULT_VIEW = { center: [43.0, 43.15] as [number, number], zoom: 8 };
