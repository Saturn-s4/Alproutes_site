'use client';

import Link from 'next/link';
import { usePrefs } from '../Prefs';

/**
 * Edit entry points on server-rendered pages. Shown by role on the client: the pages themselves
 * are rendered without a session (SSR for search engines).
 */
export function RouteEditLinks({ routeId, slug }: { routeId: string; slug: string }) {
  const { t, session } = usePrefs();
  return (
    <div className="row-gap" style={{ gap: '1rem' }}>
      {session && <Link className="btn btn-sm btn-ghost" href={`/edit/routes/${routeId}`}>{t('ed.edit')}</Link>}
      <Link className="btn btn-sm btn-ghost" href={`/routes/${slug}/history`}>{t('rev.history')}</Link>
    </div>
  );
}

export function AreaEditLinks({ areaId }: { areaId?: string }) {
  const { t, session } = usePrefs();
  if (!session) return null;
  const moderator = session.user.role === 'moderator' || session.user.role === 'admin';
  return (
    <div className="row-gap" style={{ gap: '1rem' }}>
      <Link className="btn btn-sm btn-primary" href={areaId ? `/edit/routes/new?area=${areaId}` : '/edit/routes/new'}>+ {t('ed.newRoute')}</Link>
      {moderator && (
        <>
          <Link className="btn btn-sm btn-ghost" href={areaId ? `/edit/areas/new?parent=${areaId}` : '/edit/areas/new'}>
            + {areaId ? t('ed.newSubarea') : t('ed.newArea')}
          </Link>
          {areaId && <Link className="btn btn-sm btn-ghost" href={`/edit/areas/${areaId}`}>{t('ed.editArea')}</Link>}
        </>
      )}
    </div>
  );
}
