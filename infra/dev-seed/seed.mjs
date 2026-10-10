// Local development only: fills the dev database with clearly labelled TEST content through
// the public API, exactly like the clients do (dev-login, pre-signed upload, entity creation).
// No real routes, no factual data.
//
//   java infra/dev-seed/GenerateSamples.java infra/dev-seed/samples
//   node infra/dev-seed/seed.mjs            # API_URL defaults to http://localhost:8080/api/v1
//
// Re-runnable: existing areas, routes, photos and documents are found and skipped.

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = process.env.API_URL ?? 'http://localhost:8080/api/v1';
const SAMPLES = join(dirname(fileURLToPath(import.meta.url)), 'samples');

async function call(method, path, token, body) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

async function tryGet(path, token) {
  const res = await fetch(API + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return res.ok ? res.json() : null;
}

const login = (email, displayName, role) =>
  call('POST', '/auth/dev-login', undefined, { email, displayName, role }).then((t) => t.accessToken);

async function upload(token, purpose, contentType, file) {
  const bytes = await readFile(join(SAMPLES, file));
  const slot = await call('POST', '/uploads', token, { purpose, contentType, sizeBytes: bytes.length, fileName: file });
  const put = await fetch(slot.url, { method: 'PUT', headers: slot.headers, body: bytes });
  if (!put.ok) throw new Error(`PUT ${file} -> ${put.status} ${await put.text()}`);
  return slot.uploadId;
}

const point = (lon, lat) => ({ type: 'Point', coordinates: [lon, lat] });
const line = (...c) => ({ type: 'LineString', coordinates: c });

async function ensureArea(mod, slug, body) {
  return (await tryGet(`/areas/by-slug/${slug}`)) ?? call('POST', '/areas', mod, { slug, status: 'published', ...body });
}

async function ensureRoute(mod, slug, content) {
  const existing = await tryGet(`/routes/by-slug/${slug}`);
  if (existing) return existing;
  await call('POST', '/routes', mod, { slug, publish: true, changeSummary: 'тестовые данные', content });
  return call('GET', `/routes/by-slug/${slug}`);
}

/** Photo ids are fixed per sample, so a repeated run finds them instead of uploading again. */
async function ensurePhoto(token, routeId, id, file, kind, caption) {
  const existing = await tryGet(`/photos/${id}`, token);
  if (existing) return existing;
  const uploadId = await upload(token, 'photo', 'image/jpeg', file);
  return call('POST', `/routes/${routeId}/photos`, token, { id, uploadId, kind, caption, captionLanguage: caption ? 'ru' : undefined });
}

async function awaitReady(token, ids) {
  for (let i = 0; i < 100; i++) {
    const photos = await Promise.all(ids.map((id) => call('GET', `/photos/${id}`, token)));
    const failed = photos.find((p) => p.processingStatus === 'failed');
    if (failed) throw new Error(`photo ${failed.id} failed to process`);
    if (photos.every((p) => p.processingStatus === 'ready')) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('photos were not processed in time');
}

async function ensureDocument(uploader, mod, routeId, file, title, rights) {
  const docs = await call('GET', `/routes/${routeId}/documents?limit=100`, mod);
  let doc = docs.items.find((d) => d.title.ru === title);
  if (!doc) {
    const uploadId = await upload(uploader, 'document', 'application/pdf', file);
    doc = await call('POST', `/routes/${routeId}/documents`, uploader, {
      uploadId,
      title: { ru: title, en: title.replace('Тестовый документ', 'Test document') },
      sourceType: 'other',
      sourceDescription: 'Сгенерирован скриптом infra/dev-seed для проверки интерфейса',
      year: null,
      claimedRightsStatus: 'own_work',
    });
  }
  if (rights && doc.visibility !== 'visible') {
    doc = await call('PUT', `/documents/${doc.id}/rights`, mod, rights);
  }
  return doc;
}

// --------------------------------------------------------------------------- content

const mod = await login('mod@local', 'Модератор', 'moderator');
const anna = await login('anna@local', 'Анна (тест)', 'user');
const boris = await login('boris@local', 'Борис (тест)', 'user');

const region = await ensureArea(mod, 'demo-region', {
  type: 'region',
  name: { ru: 'Тестовый район', en: 'Test region' },
  description: { ru: 'Тестовые данные для проверки интерфейса. Не реальный район.' },
  center: point(43.0, 43.1),
});
const summit = await ensureArea(mod, 'demo-summit', {
  parentId: region.id,
  type: 'summit',
  name: { ru: 'Тестовая вершина', en: 'Test summit' },
  center: point(43.02, 43.12),
  elevationM: null,
});

const description = {
  ru: 'Тестовое описание для проверки интерфейса.\nДанные выдуманы и не относятся к реальному маршруту.',
};
const baseContent = {
  areaId: summit.id,
  name: { ru: 'Тестовый маршрут 1 (не настоящий)', en: 'Test route 1 (not real)' },
  description,
  grades: [{ system: 'RU', value: '2А' }, { system: 'IFAS', value: 'PD' }],
  routeType: 'snow_ice',
  isTraverse: false,
  seasonMonths: [7, 8],
  dataSources: 'Тестовые данные',
  features: [
    { kind: 'start', point: point(43.0, 43.1) },
    { kind: 'approach', line: line([42.99, 43.095], [43.0, 43.1]) },
    { kind: 'route_line', line: line([43.0, 43.1], [43.008, 43.108], [43.015, 43.115], [43.02, 43.12]) },
    { kind: 'summit', point: point(43.02, 43.12) },
    { kind: 'bivouac', point: point(42.99, 43.095), note: { ru: 'Тестовая ночёвка' } },
  ],
};
let route = await ensureRoute(mod, 'demo-route-1', baseContent);
await ensureRoute(mod, 'demo-route-2', {
  areaId: summit.id,
  name: { ru: 'Тестовый маршрут 2 без категории' },
  grades: [],
  features: [{ kind: 'start', point: point(43.04, 43.09) }],
});
await ensureRoute(mod, 'demo-route-3', {
  areaId: region.id,
  name: { ru: 'Тестовый маршрут 3 без геометрии' },
  grades: [{ system: 'UIAA', value: 'IV' }],
  features: [],
});

// Photos of the description: uploaded by the moderator, then put into a new revision.
const descriptionPhotos = [
  ['5e1d0000-0000-4000-8000-000000000001', 'description-1.jpg', 'overview', { ru: 'Общий вид (тестовое фото)', en: 'Overview (test photo)' }],
  ['5e1d0000-0000-4000-8000-000000000002', 'description-2.jpg', 'topo', { ru: 'Фото для прорисовки нитки (тест)' }],
  ['5e1d0000-0000-4000-8000-000000000003', 'description-3.jpg', 'detail', { ru: 'Деталь участка (тест)' }],
];
for (const [id, file, kind] of descriptionPhotos) await ensurePhoto(mod, route.id, id, file, kind);
await awaitReady(mod, descriptionPhotos.map(([id]) => id));

if (route.photos.length === 0) {
  await call('POST', `/routes/${route.id}/revisions`, mod, {
    baseRevisionId: route.currentRevision.id,
    changeSummary: 'Тестовые фото в описании',
    publish: true,
    content: { ...baseContent, photos: descriptionPhotos.map(([photoId, , , caption]) => ({ photoId, caption })) },
  });
  route = await call('GET', `/routes/by-slug/demo-route-1`);
}

// Participants' photos: other users, own captions, not part of the description.
const userPhotos = [
  [anna, '5e1d0000-0000-4000-8000-000000000011', 'user-1.jpg', 'overview', 'Тест: вечер на подходе'],
  [anna, '5e1d0000-0000-4000-8000-000000000012', 'user-2.jpg', 'detail', 'Тест: гребень'],
  [boris, '5e1d0000-0000-4000-8000-000000000013', 'user-3.jpg', 'overview', 'Тест: рассвет'],
  [boris, '5e1d0000-0000-4000-8000-000000000014', 'user-4.jpg', 'detail', null],
];
for (const [token, id, file, kind, caption] of userPhotos) await ensurePhoto(token, route.id, id, file, kind, caption);
await awaitReady(mod, userPhotos.map(([, id]) => id));

// Documents: one with cleared rights (public), one left for the moderation queue (hidden).
await ensureDocument(anna, mod, route.id, 'document-1.pdf', 'Тестовый документ 1', { rightsStatus: 'own_work', visibility: 'visible' });
await ensureDocument(boris, mod, route.id, 'document-2.pdf', 'Тестовый документ 2 (ждёт проверки прав)', null);

const final = await call('GET', `/routes/by-slug/demo-route-1`);
console.log(`Route ${final.slug}: ${final.descriptionPhotos.length} description photos, stats`, final.stats);
