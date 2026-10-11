'use client';

import { api } from './api/browser';

type Purpose = 'photo' | 'track' | 'document';

const EXT_TYPES: Record<string, string> = {
  gpx: 'application/gpx+xml',
  kml: 'application/vnd.google-earth.kml+xml',
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
};

/** Browsers often report "" or "application/octet-stream" for GPX/KML: trust the extension then. */
export function contentTypeOf(file: File): string | null {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return EXT_TYPES[ext] ?? (file.type || null);
}

export class UploadError extends Error {}

/** Mirrors the backend upload rules; checked before asking for a slot so a wrong file fails at once. */
export const UPLOAD_LIMITS: Record<Purpose, { maxBytes: number; accept: string }> = {
  // HEIC is accepted by the upload endpoint but the photo processor cannot read it yet.
  photo: { maxBytes: 30 * 1024 * 1024, accept: '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp' },
  track: { maxBytes: 20 * 1024 * 1024, accept: '.gpx,.kml,application/gpx+xml,application/vnd.google-earth.kml+xml' },
  document: { maxBytes: 100 * 1024 * 1024, accept: '.pdf,application/pdf' },
};

/** Null when the file fits the purpose, otherwise 'type' or 'size'. */
export function checkFile(file: File, purpose: Purpose): 'type' | 'size' | null {
  const ct = contentTypeOf(file);
  const ok: Record<Purpose, string[]> = {
    photo: ['image/jpeg', 'image/png', 'image/webp'],
    track: ['application/gpx+xml', 'application/vnd.google-earth.kml+xml'],
    document: ['application/pdf'],
  };
  if (!ct || !ok[purpose].includes(ct)) return 'type';
  if (file.size > UPLOAD_LIMITS[purpose].maxBytes) return 'size';
  return null;
}

/** Polls [get] while the entity is still being processed (photos, tracks): about 30 s at most. */
export async function untilProcessed<T extends { processingStatus: string }>(first: T, get: () => Promise<T | undefined>): Promise<T> {
  let cur = first;
  for (let i = 0; i < 60 && cur.processingStatus === 'processing'; i++) {
    await new Promise((r) => setTimeout(r, 500));
    cur = (await get()) ?? cur;
  }
  return cur;
}

/**
 * Pre-signed upload straight to S3 (the file never passes through the backend, see CLAUDE.md),
 * then the caller creates the entity with the returned uploadId.
 */
export async function uploadFile(file: File, purpose: Purpose, onProgress?: (fraction: number) => void): Promise<string> {
  const contentType = contentTypeOf(file);
  if (!contentType) throw new UploadError('unsupported');
  const { data: slot, error } = await api.POST('/uploads', {
    body: { purpose, contentType, sizeBytes: file.size, fileName: file.name },
  });
  if (!slot) throw new UploadError(error?.errors?.[0]?.message ?? error?.detail ?? 'upload-slot');

  // XHR instead of fetch: fetch has no upload progress.
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(slot.method, slot.url);
    for (const [k, v] of Object.entries(slot.headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new UploadError(`storage ${xhr.status}`)));
    xhr.onerror = () => reject(new UploadError('network'));
    xhr.send(file);
  });
  return slot.uploadId;
}
