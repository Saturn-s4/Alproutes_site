// MapLibre 6 resolves its web worker relative to import.meta.url, which bundlers rewrite.
// Serve the worker as a static file instead; MapCanvas points setWorkerUrl() at it.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const dist = join(dirname(require.resolve('maplibre-gl/package.json')), 'dist');
mkdirSync('public/maplibre', { recursive: true });
copyFileSync(join(dist, 'maplibre-gl-worker.mjs'), 'public/maplibre/maplibre-gl-worker.mjs');
