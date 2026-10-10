'use client';

import { useState } from 'react';
import type { Photo, RouteContentPhoto } from '@/lib/api/types';
import { loc } from '@/lib/i18n';
import { Lightbox, type LightboxItem } from './Lightbox';
import { usePrefs } from './Prefs';

/** Photos that are part of the description: catalogue captions, versioned with the revision. */
export function DescriptionPhotos({ photos, refs }: { photos: Photo[]; refs: RouteContentPhoto[] }) {
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
            <button type="button" onClick={() => setOpen(i)} aria-label={caption ?? undefined}>
              <img
                src={i === 0 ? photo.urls?.medium : photo.urls?.thumbnail}
                alt={caption ?? ''}
                width={photo.widthPx ?? undefined}
                height={photo.heightPx ?? undefined}
                loading={i === 0 ? 'eager' : 'lazy'}
              />
            </button>
            {caption && <figcaption>{caption}</figcaption>}
          </figure>
        ))}
      </div>
      <Lightbox items={items} index={open} onIndex={setOpen} />
    </>
  );
}
