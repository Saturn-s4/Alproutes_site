'use client';

import { useCallback, useEffect } from 'react';
import type { Photo } from '@/lib/api/types';
import { currentTopo } from '@/lib/topo';
import { usePrefs } from './Prefs';
import { TopoOverlay } from './TopoOverlay';

export type LightboxItem = { photo: Photo; caption: string | null };

/** Full-screen photo viewer: Esc closes, arrow keys move between photos. Shows [routeId]'s line over a topo photo. */
export function Lightbox({
  items, index, onIndex, routeId,
}: { items: LightboxItem[]; index: number | null; onIndex: (i: number | null) => void; routeId?: string }) {
  const { t } = usePrefs();
  const go = useCallback(
    (delta: number) => {
      if (index != null) onIndex((index + delta + items.length) % items.length);
    },
    [index, items.length, onIndex],
  );

  useEffect(() => {
    if (index == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onIndex(null);
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [index, go, onIndex]);

  const item = index != null ? items[index] : undefined;
  if (!item?.photo.urls) return null;
  const topo = currentTopo(item.photo, routeId);
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={item.caption ?? undefined} onClick={() => onIndex(null)}>
      <div className="topo-frame" onClick={(e) => e.stopPropagation()}>
        <img src={item.photo.urls.full} alt={item.caption ?? ''} />
        {topo && item.photo.widthPx && item.photo.heightPx && (
          <TopoOverlay drawing={topo.drawing} width={item.photo.widthPx} height={item.photo.heightPx} strokeWidth={4} />
        )}
      </div>
      <div className="lightbox-bar" onClick={(e) => e.stopPropagation()}>
        <span className="cap">
          {item.caption}
          <span className="muted"> · {item.photo.author.displayName}</span>
        </span>
        {items.length > 1 && (
          <>
            <button type="button" className="btn btn-sm btn-ghost" aria-label={t('photo.prev')} onClick={() => go(-1)}>←</button>
            <span className="mono muted">{(index ?? 0) + 1} / {items.length}</span>
            <button type="button" className="btn btn-sm btn-ghost" aria-label={t('photo.next')} onClick={() => go(1)}>→</button>
          </>
        )}
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => onIndex(null)}>{t('photo.close')}</button>
      </div>
    </div>
  );
}
