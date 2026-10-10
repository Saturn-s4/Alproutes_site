'use client';

import { useState } from 'react';
import { publicApi } from '@/lib/api/browser';
import type { Photo } from '@/lib/api/types';
import { formatDate } from '@/lib/i18n';
import { Lightbox, type LightboxItem } from './Lightbox';
import { usePrefs } from './Prefs';

const PAGE = 24;

/** Participants' photos: everything of the route that is not in the description. */
export function UserPhotos({ routeId, initial, nextCursor }: { routeId: string; initial: Photo[]; nextCursor: string | null }) {
  const { t, lang } = usePrefs();
  const [photos, setPhotos] = useState(initial);
  const [cursor, setCursor] = useState(nextCursor);
  const [open, setOpen] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const more = async () => {
    if (!cursor) return;
    setLoading(true);
    const { data } = await publicApi.GET('/routes/{routeId}/photos', {
      params: { path: { routeId }, query: { inDescription: false, limit: PAGE, cursor } },
    });
    setLoading(false);
    if (data) {
      setPhotos((p) => [...p, ...data.items]);
      setCursor(data.nextCursor ?? null);
    }
  };

  // User captions are not translated (contract): shown as written.
  const items: LightboxItem[] = photos.filter((p) => p.urls).map((photo) => ({ photo, caption: photo.caption ?? null }));
  if (items.length === 0) return <p className="muted">{t('route.noUserPhotos')}</p>;
  return (
    <>
      <div className="user-photos">
        {items.map(({ photo, caption }, i) => (
          <figure key={photo.id}>
            <button type="button" onClick={() => setOpen(i)} aria-label={caption ?? photo.author.displayName}>
              <img src={photo.urls?.thumbnail} alt={caption ?? ''} loading="lazy" />
            </button>
            <figcaption>
              {caption && <span className="cap">{caption}</span>}
              <span className="by">
                {photo.author.displayName} · {formatDate(photo.createdAt, lang)}
              </span>
            </figcaption>
          </figure>
        ))}
      </div>
      {cursor && (
        <button type="button" className="btn btn-ghost" disabled={loading} onClick={() => void more()}>
          {t('common.more')}
        </button>
      )}
      <Lightbox items={items} index={open} onIndex={setOpen} />
    </>
  );
}
