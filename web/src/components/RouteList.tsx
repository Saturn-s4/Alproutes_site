import Link from 'next/link';
import type { RouteSummary } from '@/lib/api/types';
import { formatInt, locText, type Translate } from '@/lib/i18n';
import type { Lang } from '@/lib/prefs';
import { Grades } from './Grades';
import { LText } from './Text';

/** Server-rendered list of routes: crawlable links for area and catalogue pages. */
export function RouteList({ routes, lang, t, showArea }: { routes: RouteSummary[]; lang: Lang; t: Translate; showArea?: boolean }) {
  return (
    <div className="list-rows">
      {routes.map((r) => (
        <Link key={r.id} href={`/routes/${r.slug}`} className="route-row">
          {r.coverPhotoUrl ? <img className="row-thumb" src={r.coverPhotoUrl} alt="" loading="lazy" /> : <span className="row-thumb" />}
          <span className="body">
            <span className="peak"><LText text={r.name} lang={lang} t={t} /></span>
            {showArea && <span className="name">{locText(r.area.name, lang)}</span>}
            <span className="meta">
              <Grades grades={r.grades} emptyLabel={t('route.noGrade')} />
              {r.elevationGainM != null && <span>↑ {formatInt(r.elevationGainM, lang)} {t('common.m')}</span>}
              {r.lengthM != null && <span>{formatInt(r.lengthM, lang)} {t('common.m')}</span>}
            </span>
          </span>
        </Link>
      ))}
    </div>
  );
}
