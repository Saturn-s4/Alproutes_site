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
