import Link from 'next/link';
import type { RouteSummary } from '@/lib/api/types';
import { formatInt, locText, routeTypeLabel, type Translate } from '@/lib/i18n';
import type { Lang } from '@/lib/prefs';

const RIDGES = [
  'M0 150 L60 80 L110 110 L170 30 L220 90 L300 60 L300 150 Z',
  'M0 150 L40 110 L120 50 L170 90 L240 40 L300 100 L300 150 Z',
  'M0 150 L80 60 L130 100 L190 70 L250 20 L300 70 L300 150 Z',
];

/** Catalogue card (design direction B): photo with the grade on top, facts below. */
export function RouteCard({
  route, preferSystem, variant, lang, t,
}: { route: RouteSummary; preferSystem: string; variant: number; lang: Lang; t: Translate }) {
  // Show the grade of the system the visitor filters by; otherwise the first one. Always with its system.
  const grade = route.grades.find((g) => g.system === preferSystem) ?? route.grades[0];
  return (
    <Link href={`/routes/${route.slug}`} className="route-card">
      <div className="photo">
        {route.coverPhotoUrl ? (
          <img src={route.coverPhotoUrl} alt="" loading="lazy" />
        ) : (
          <svg viewBox="0 0 300 150" preserveAspectRatio="none" aria-hidden="true">
            <path d={RIDGES[variant % RIDGES.length]} style={{ fill: 'var(--photo2)' }} />
          </svg>
        )}
        <span className="cat" title={grade ? `${grade.system} ${grade.value}` : t('route.noGrade')}>
          {grade ? (
            <>
              <small>{grade.system}</small> {grade.value}
            </>
          ) : (
            '?'
          )}
        </span>
        {!route.coverPhotoUrl && <span>{t('catalog.noPhoto')}</span>}
      </div>
      <div className="info">
        <div className="peak">{locText(route.name, lang)}</div>
        <div className="muted" style={{ fontSize: '1.3rem' }}>{locText(route.area.name, lang)}</div>
        <div className="meta">
          <span>
            ↑ {route.elevationGainM != null ? `${formatInt(route.elevationGainM, lang)} ${t('common.m')}` : <span className="nodata">{t('common.noData')}</span>}
          </span>
          {route.routeType && <span className="rev">{routeTypeLabel(route.routeType, lang)}</span>}
        </div>
      </div>
    </Link>
  );
}
