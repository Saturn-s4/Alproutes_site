'use client';

import { useState } from 'react';
import type { Photo, RouteContentPhoto } from '@/lib/api/types';
import { loc } from '@/lib/i18n';
import { currentTopo } from '@/lib/topo';
import { Lightbox, type LightboxItem } from './Lightbox';
import { usePrefs } from './Prefs';
import { TopoOverlay } from './TopoOverlay';

/** Photos that are part of the description: catalogue captions, versioned with the revision. */
export function DescriptionPhotos({ photos, refs, routeId }: { photos: Photo[]; refs: RouteContentPhoto[]; routeId: string }) {
  const { lang } = usePrefs();
  const [open, setOpen] = useState<number | null>(null);
  const items: LightboxItem[] = photos.map((photo) => {
    const ref = refs.find((r) => r.photoId === photo.id);
    const caption = loc(ref?.caption, lang);
    return { photo, caption: caption ? (caption.fallback ? `${caption.text} [${caption.lang}]` : caption.text) : null };
  });
  if (items.length === 0) return null;
  return (
    <>
      <div className="desc-photos">
        {items.map(({ photo, caption }, i) => (
          <figure key={photo.id} className={i === 0 ? 'lead' : undefined}>
            <button type="button" className="topo-wrap" onClick={() => setOpen(i)} aria-label={caption ?? undefined}>
              <img
                src={i === 0 ? photo.urls?.medium : photo.urls?.thumbnail}
                alt={caption ?? ''}
                width={photo.widthPx ?? undefined}
                height={photo.heightPx ?? undefined}
                loading={i === 0 ? 'eager' : 'lazy'}
              />
              <PhotoTopo photo={photo} routeId={routeId} strokeWidth={i === 0 ? 3 : 2} />
            </button>
            {caption && <figcaption>{caption}</figcaption>}
          </figure>
        ))}
      </div>
      <Lightbox items={items} index={open} onIndex={setOpen} routeId={routeId} />
    </>
  );
}

/** This route's current line over a photo, if it has one. */
export function PhotoTopo({ photo, routeId, strokeWidth }: { photo: Photo; routeId: string; strokeWidth?: number }) {
  const topo = currentTopo(photo, routeId);
  if (!topo || !photo.widthPx || !photo.heightPx) return null;
  // Gallery tiles crop the photo with object-fit: cover.
  return <TopoOverlay drawing={topo.drawing} width={photo.widthPx} height={photo.heightPx} strokeWidth={strokeWidth} cover />;
}
