'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, publicApi } from '@/lib/api/browser';
import type { Photo } from '@/lib/api/types';
import { formatDate, photoKindLabel } from '@/lib/i18n';
import { PhotoTopo } from './DescriptionPhotos';
import { Lightbox, type LightboxItem } from './Lightbox';
import { usePrefs } from './Prefs';

const PAGE = 24;

/**
 * Participants' photos: everything of the route that is not in the description. They are added
 * through comments; here they are shown together.
 */
export function UserPhotos({ routeId, initial, nextCursor }: { routeId: string; initial: Photo[]; nextCursor: string | null }) {
  const { t, lang, session } = usePrefs();
  const router = useRouter();
  const [photos, setPhotos] = useState(initial);
  // A new comment with photos refreshes the server render (new [initial]); anonymous visitors take it as is.
  useEffect(() => { if (!session?.user.id) setPhotos(initial); }, [initial, session?.user.id]);
  const [cursor, setCursor] = useState(nextCursor);
  const [open, setOpen] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const me = session?.user.id;

  // The server render is anonymous; a signed-in author also sees own photos that are still processing.
  useEffect(() => {
    if (!me) return;
    void api.GET('/routes/{routeId}/photos', { params: { path: { routeId }, query: { inDescription: false, limit: PAGE } } })
      .then(({ data }) => { if (data) { setPhotos(data.items); setCursor(data.nextCursor ?? null); } });
    // [initial] changes when the page is refreshed after a comment with photos: re-read then too.
  }, [me, routeId, initial]);

  const more = async () => {
    if (!cursor) return;
    setLoading(true);
    const client = me ? api : publicApi;
    const { data } = await client.GET('/routes/{routeId}/photos', {
      params: { path: { routeId }, query: { inDescription: false, limit: PAGE, cursor } },
    });
    setLoading(false);
    if (data) {
      setPhotos((p) => [...p, ...data.items.filter((x) => !p.some((y) => y.id === x.id))]);
      setCursor(data.nextCursor ?? null);
    }
  };

  const remove = async (p: Photo) => {
    if (!window.confirm(t('ph.deleteConfirm'))) return;
    const { response } = await api.DELETE('/photos/{photoId}', { params: { path: { photoId: p.id } } });
    if (response.ok) {
      setPhotos((xs) => xs.filter((x) => x.id !== p.id));
      // The photo may be in the description too: refresh the server-rendered part.
      router.refresh();
    }
  };

  // Lightbox only for processed photos; own unprocessed ones are shown as placeholders.
  const ready: LightboxItem[] = photos.filter((p) => p.urls).map((photo) => ({ photo, caption: photo.caption ?? null }));
  const unready = photos.filter((p) => !p.urls);

  return (
    <>
      {ready.length === 0 && unready.length === 0 && <p className="muted">{t('route.noUserPhotos')}</p>}
      {(ready.length > 0 || unready.length > 0) && (
        <div className="user-photos">
          {unready.map((photo) => (
            <figure key={photo.id}>
              <div className="ph-pending">{t(photo.processingStatus === 'failed' ? 'ph.failedBadge' : 'ph.processingBadge')}</div>
              <figcaption>
                {photo.caption && <span className="cap">{photo.caption}</span>}
                <span className="by">{photo.author.displayName} · {formatDate(photo.createdAt, lang)}</span>
                {photo.author.id === me && (
                  <button type="button" className="link-btn" onClick={() => void remove(photo)}>{t('ph.delete')}</button>
                )}
              </figcaption>
            </figure>
          ))}
          {ready.map(({ photo, caption }, i) => (
            // User captions are not translated (contract): shown as written.
            <figure key={photo.id}>
              <button type="button" className="topo-wrap" onClick={() => setOpen(i)} aria-label={caption ?? photo.author.displayName}>
                <img src={photo.urls?.thumbnail} alt={caption ?? ''} loading="lazy" />
                <PhotoTopo photo={photo} routeId={routeId} strokeWidth={2} />
              </button>
              <figcaption>
                {caption && <span className="cap">{caption}</span>}
                <span className="by">
                  {photo.author.displayName} · {formatDate(photo.createdAt, lang)}
                  {photo.kind !== 'overview' && ` · ${photoKindLabel(photo.kind, lang)}`}
                </span>
                {photo.author.id === me && (
                  <button type="button" className="link-btn" onClick={() => void remove(photo)}>{t('ph.delete')}</button>
                )}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
      {cursor && (
        <button type="button" className="btn btn-ghost" disabled={loading} onClick={() => void more()}>
          {t('common.more')}
        </button>
      )}
      <p className="field-hint">{t('ph.viaComments')}</p>
      <Lightbox items={ready} index={open} onIndex={setOpen} routeId={routeId} />
    </>
  );
}
