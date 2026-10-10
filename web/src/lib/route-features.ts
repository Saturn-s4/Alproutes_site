import type { RouteFeatureKind } from './api/types';

/** Colour role per feature kind; resolved against theme tokens (map) or CSS variables (legend). */
export const FEATURE_ROLE: Record<RouteFeatureKind, 'accent' | 'blue' | 'muted'> = {
  route_line: 'accent',
  approach: 'blue',
  descent: 'muted',
  start: 'accent',
  summit: 'accent',
  bivouac: 'blue',
  descent_start: 'muted',
};
