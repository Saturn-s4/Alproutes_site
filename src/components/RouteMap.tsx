import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect, useMemo } from 'react';
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import { loc, type Route } from '../data/routes';
import type { TrackPoint } from '../lib/geo';
import { useStore, type MapLayer } from '../store';

const TILES: Record<MapLayer, { url: string; attribution: string; maxNativeZoom: number; subdomains?: string }> = {
  topo: {
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, SRTM | © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
    maxNativeZoom: 17,
    subdomains: 'abc',
  },
  sat: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics',
    maxNativeZoom: 18,
  },
  relief: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles © Esri — Source: Esri',
    maxNativeZoom: 13,
  },
};

const ll = (p: TrackPoint | [number, number]) => [p[0], p[1]] as [number, number];

export function routeBounds(r: Route) {
  const pts = r.track ? r.track.map(ll) : [r.summit];
  const b = L.latLngBounds(pts);
  return r.track ? b : b.pad(0.02);
}

interface Props {
  routes: Route[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  layer: MapLayer;
  showOthers?: boolean;
  /** An ad-hoc track to draw (upload preview). */
  track?: TrackPoint[] | null;
  labels?: 'all' | 'selected' | 'none';
  onView?: (bounds: L.LatLngBounds, center: L.LatLng) => void;
  onReady?: (map: L.Map) => void;
  /** Change this value to re-fit the view to the selected route / track. */
  fitKey?: unknown;
}

function Events({ onView, onReady }: Pick<Props, 'onView' | 'onReady'>) {
  const map = useMapEvents({
    moveend: () => onView?.(map.getBounds(), map.getCenter()),
  });
  useEffect(() => {
    onReady?.(map);
    onView?.(map.getBounds(), map.getCenter());
    // Leaflet measures its container once; re-measure when the layout around it changes.
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(map.getContainer());
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);
  return null;
}

function Fit({ bounds, fitKey }: { bounds: L.LatLngBounds | null; fitKey: unknown }) {
  const map = useMap();
  useEffect(() => {
    if (bounds?.isValid()) map.flyToBounds(bounds, { padding: [48, 48], maxZoom: 13, duration: 0.6 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);
  return null;
}

export function RouteMap({ routes, selectedId, onSelect, layer, showOthers = true, track, labels = 'all', onView, onReady, fitKey }: Props) {
  const { lang, fmtHeight } = useStore();
  const selected = routes.find((r) => r.id === selectedId) ?? null;
  const tile = TILES[layer];

  const initial = useMemo(() => {
    if (track?.length) return L.latLngBounds(track.map(ll));
    if (selected) return routeBounds(selected);
    if (routes.length) return L.latLngBounds(routes.map((r) => r.summit)).pad(0.1);
    return L.latLngBounds([[43.2, 42.3], [43.5, 42.7]]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fitBounds = track?.length ? L.latLngBounds(track.map(ll)) : selected ? routeBounds(selected) : null;

  const shortPeak = (r: Route) => `${loc(r.peak, lang)} · ${fmtHeight(r.height)}`;

  return (
    <MapContainer
      bounds={initial}
      boundsOptions={{ padding: [48, 48], maxZoom: 13 }}
      zoomControl={false}
      className={layer === 'sat' ? 'map-sat' : undefined}
      worldCopyJump
    >
      <TileLayer key={layer} url={tile.url} attribution={tile.attribution} maxNativeZoom={tile.maxNativeZoom} maxZoom={18} subdomains={tile.subdomains ?? 'abc'} />
      <Events onView={onView} onReady={onReady} />
      <Fit bounds={fitBounds} fitKey={fitKey} />

      {showOthers &&
        routes
          .filter((r) => r.id !== selectedId && r.track)
          .map((r) => (
            <Polyline
              key={'t' + r.id}
              positions={r.track!.map(ll)}
              pathOptions={{ className: 'trk-other', weight: 2, dashArray: '6 6', opacity: 0.8 }}
              eventHandlers={{ click: () => onSelect?.(r.id) }}
            />
          ))}

      {selected?.track && (
        <>
          <Polyline positions={selected.track.map(ll)} pathOptions={{ className: 'trk-sel', weight: 4, lineCap: 'round' }} />
          <CircleMarker center={ll(selected.track[0])} radius={6} pathOptions={{ className: 'pt-start', weight: 3, fillOpacity: 1 }} />
        </>
      )}

      {track && track.length > 1 && (
        <>
          <Polyline positions={track.map(ll)} pathOptions={{ className: 'trk-sel', weight: 4, lineCap: 'round' }} />
          <CircleMarker center={ll(track[0])} radius={6} pathOptions={{ className: 'pt-start', weight: 3, fillOpacity: 1 }} />
          <CircleMarker center={ll(track.reduce((a, b) => (b[2] > a[2] ? b : a)))} radius={8} pathOptions={{ className: 'pt-sel', weight: 2, fillOpacity: 1 }} />
        </>
      )}

      {routes.map((r) => {
        const isSel = r.id === selectedId;
        if (!isSel && !showOthers) return null;
        const label = labels === 'all' || (labels === 'selected' && isSel);
        return (
          <CircleMarker
            key={'p' + r.id + (isSel ? 's' : '')}
            center={r.summit}
            radius={isSel ? 9 : 6}
            pathOptions={{ className: isSel ? 'pt-sel' : 'pt-other', weight: 2, fillOpacity: 1 }}
            eventHandlers={{ click: () => onSelect?.(r.id) }}
          >
            {label && (
              <Tooltip permanent direction="right" offset={[10, 0]} className={'peak-label' + (isSel ? '' : ' other')}>
                {shortPeak(r)}
              </Tooltip>
            )}
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
