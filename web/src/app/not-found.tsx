import Link from 'next/link';
import { translator } from '@/lib/i18n';
import { getPrefs } from '@/lib/prefs-server';

export default async function NotFound() {
  const t = translator((await getPrefs()).lang);
  return (
    <div className="page">
      <h1 className="h1">{t('notFound.title')}</h1>
      <Link href="/">{t('notFound.back')}</Link>
    </div>
  );
}
