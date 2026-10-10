import Link from 'next/link';
import { Fragment } from 'react';
import type { AreaRef } from '@/lib/api/types';
import { locText, type Translate } from '@/lib/i18n';
import type { Lang } from '@/lib/prefs';

export function Crumbs({ path, current, lang, t }: { path: AreaRef[]; current: string; lang: Lang; t: Translate }) {
  return (
    <nav className="crumbs" aria-label="breadcrumbs">
      <Link href="/catalog">{t('catalog.title')}</Link>
      {path.map((a) => (
        <Fragment key={a.id}>
          <span className="sep">/</span>
          <Link href={`/areas/${a.slug}`}>{locText(a.name, lang)}</Link>
        </Fragment>
      ))}
      <span className="sep">/</span>
      <span aria-current="page">{current}</span>
    </nav>
  );
}
