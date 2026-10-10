'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api/browser';
import type { components } from '@/lib/api/schema';
import { formatDate } from '@/lib/i18n';
import { usePrefs } from '../Prefs';

type RevisionSummary = components['schemas']['RouteRevisionSummary'];

/** Revision history of a route, newest first. The author also sees their own pending and rejected edits. */
export function History({ routeId }: { routeId: string }) {
  const { t, lang, session } = usePrefs();
  const [items, setItems] = useState<RevisionSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = async (after?: string) => {
    const { data } = await api.GET('/routes/{routeId}/revisions', { params: { path: { routeId }, query: { limit: 50, cursor: after } } });
    if (data) {
      setItems((prev) => (after ? [...prev, ...data.items] : data.items));
      setCursor(data.nextCursor ?? null);
    }
    setLoaded(true);
  };

  useEffect(() => {
    // Re-read once the session is known: it decides which pending revisions are visible.
    if (session !== undefined) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, routeId]);

  if (!loaded) return <p className="muted">{t('common.loading')}</p>;
  return (
    <div className="list-rows">
      {items.map((r) => (
        <Link key={r.id} href={`/revisions/${r.id}`} className="route-row">
          <span className="badge badge-text">#{r.revisionNumber}</span>
          <span className="body">
            <span className="peak">{r.changeSummary ?? t('rev.noSummary')}</span>
            <span className="name">
              {r.author.displayName} · {formatDate(r.createdAt, lang)}
              {r.revertedFromId && ` · ${t('rev.revertCopy')}`}
            </span>
            <span className="meta">
              <span className={r.status === 'pending' ? 'gpx' : undefined}>{r.isCurrent ? t('rev.current') : t(`rev.status.${r.status}`)}</span>
              {r.reviewNote && <span>«{r.reviewNote}»</span>}
            </span>
          </span>
        </Link>
      ))}
      {cursor && (
        <div style={{ padding: '1.2rem 1.6rem' }}>
          <button type="button" className="btn btn-ghost btn-block" onClick={() => void load(cursor)}>{t('common.more')}</button>
        </div>
      )}
    </div>
  );
}
