'use client';

import type { LngLatBoundsLike, Map as MlMap } from 'maplibre-gl';
import { useCallback } from 'react';
import type { RouteFeature } from '@/lib/api/types';
import { themeColors } from '@/lib/map-style';
import { FEATURE_ROLE } from '@/lib/route-features';
import { MapCanvas } from './MapCanvas';

function bounds(features: RouteFeature[]): LngLatBoundsLike | null {
  const coords = features.flatMap((f) => (f.point ? [f.point.coordinates] : (f.line?.coordinates ?? [])));
  if (coords.length === 0) return null;
  const lons = coords.map((c) => c[0] as number);
  const lats = coords.map((c) => c[1] as number);
  return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
}

export function RouteFeaturesMap({ features }: { features: RouteFeature[] }) {
  const onReady = useCallback(
    (map: MlMap) => {
      map.addSource('features', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: features.flatMap((f, i) => {
            const geometry = f.point ?? f.line;
            return geometry ? [{ type: 'Feature' as const, geometry, properties: { kind: f.kind, role: FEATURE_ROLE[f.kind], order: i } }] : [];
          }),
        },
      });
      map.addLayer({
        id: 'lines',
        type: 'line',
        source: 'features',
        filter: ['==', ['geometry-type'], 'LineString'],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-width': ['match', ['get', 'kind'], 'route_line', 4, 3],
          'line-dasharray': ['match', ['get', 'kind'], 'route_line', ['literal', [1, 0]], ['literal', [2, 1.5]]],
        },
      });
      map.addLayer({
        id: 'points',
        type: 'circle',
        source: 'features',
        filter: ['==', ['geometry-type'], 'Point'],
        paint: { 'circle-radius': ['match', ['get', 'kind'], 'summit', 8, 6], 'circle-stroke-width': 2.5 },
      });
      const paint = () => {
        const c = themeColors();
        const byRole = ['match', ['get', 'role'], 'accent', c.accent, 'blue', c.blue, c.muted] as unknown as string;
        map.setPaintProperty('lines', 'line-color', byRole);
        map.setPaintProperty('points', 'circle-color', byRole);
        map.setPaintProperty('points', 'circle-stroke-color', c.bg);
      };
      paint();
      const b = bounds(features);
      if (b) map.fitBounds(b, { padding: 48, maxZoom: 14, duration: 0 });
      return paint;
    },
    [features],
  );

  const b = bounds(features) as [number, number, number, number] | null;
  const center: [number, number] = b ? [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] : [43, 43];
  return <MapCanvas center={center} zoom={12} onReady={onReady} />;
}
