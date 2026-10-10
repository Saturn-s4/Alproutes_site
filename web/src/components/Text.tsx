import { loc, type Translate } from '@/lib/i18n';
import type { LocalizedText } from '@/lib/api/types';
import type { Lang } from '@/lib/prefs';

/** Localized catalogue text, marked when shown in a fallback language. */
export function LText({ text, lang, t }: { text: LocalizedText | null | undefined; lang: Lang; t: Translate }) {
  const r = loc(text, lang);
  if (!r) return null;
  return (
    <>
      {r.text}
      {r.fallback && <span className="fallback-note" title={t('common.translationMissing')}>[{r.lang}]</span>}
    </>
  );
}

/** Explicit "no data" for null facts: never a zero or a dash that reads like a value. */
export function NoData({ t }: { t: Translate }) {
  return <span className="nodata">{t('common.noData')}</span>;
}

export function Disclaimer({ t }: { t: Translate }) {
  return (
    <aside className="disclaimer" role="note">
      <b>{t('disclaimer.title')}</b>
      <span>{t('disclaimer.text')}</span>
    </aside>
  );
}
