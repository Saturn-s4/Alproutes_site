import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { History } from '@/components/edit/History';
import { serverApi } from '@/lib/api/server';
import { locText, translator } from '@/lib/i18n';
import { getPrefs } from '@/lib/prefs-server';

type Props = { params: Promise<{ slug: string }> };

export const metadata: Metadata = { title: 'История правок', robots: { index: false } };

export default async function HistoryPage({ params }: Props) {
  const { lang } = await getPrefs();
  const t = translator(lang);
  const { slug } = await params;
  const { data, response } = await serverApi.GET('/routes/by-slug/{slug}', { params: { path: { slug } } });
  if (response.status === 404) notFound();
  if (!data) throw new Error(`Route request failed: ${response.status}`);
  return (
    <div className="page">
      <nav className="crumbs">
        <Link href={`/routes/${data.slug}`}>{locText(data.name, lang)}</Link>
        <span className="sep">/</span>
        <span aria-current="page">{t('rev.history')}</span>
      </nav>
      <h1 className="h1">{t('rev.history')}</h1>
      <History routeId={data.id} />
    </div>
  );
}
