import Link from 'next/link';
import type { AreaSummary } from '@/lib/api/types';
import { areaTypeLabel, formatInt, locText, routeCount, type Translate } from '@/lib/i18n';
import type { Lang } from '@/lib/prefs';

export function AreaGrid({ areas, lang, t }: { areas: AreaSummary[]; lang: Lang; t: Translate }) {
  return (
    <div className="area-grid">
      {areas.map((a) => (
        <Link key={a.id} href={`/areas/${a.slug}`} className="area-card">
          <span className="kind">{areaTypeLabel(a.type, lang)}</span>
          <span className="name">{locText(a.name, lang)}</span>
          <span className="meta">
            <span>{routeCount(a.routeCount ?? 0, lang)}</span>
            {a.elevationM != null && <span>{formatInt(a.elevationM, lang)} {t('common.m')}</span>}
          </span>
        </Link>
      ))}
    </div>
  );
}
