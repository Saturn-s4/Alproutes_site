import type { Metadata } from 'next';
import { AreaGrid } from '@/components/AreaGrid';
import { RouteList } from '@/components/RouteList';
import { serverApi } from '@/lib/api/server';
import { translator } from '@/lib/i18n';
import { getPrefs } from '@/lib/prefs-server';

export const metadata: Metadata = { title: 'Каталог' };

export default async function CatalogPage() {
  const { lang } = await getPrefs();
  const t = translator(lang);
  const [areas, routes] = await Promise.all([
    serverApi.GET('/areas', { params: { query: { limit: 100 } } }),
    serverApi.GET('/routes', { params: { query: { sort: 'updated', limit: 20 } } }),
  ]);
  if (!areas.data || !routes.data) throw new Error('Catalogue request failed');

  return (
    <div className="page">
      <h1 className="h1">{t('catalog.title')}</h1>
      <section style={{ display: 'flex', flexDirection: 'column', gap: '1.4rem' }}>
        <h2 className="h2">{t('catalog.areas')}</h2>
        {areas.data.items.length === 0 ? <p className="muted">{t('catalog.noAreas')}</p> : <AreaGrid areas={areas.data.items} lang={lang} t={t} />}
      </section>
      <section style={{ display: 'flex', flexDirection: 'column', gap: '1.4rem' }}>
        <h2 className="h2">{t('catalog.recent')}</h2>
        {routes.data.items.length === 0 ? <p className="muted">{t('catalog.noRoutes')}</p> : <RouteList routes={routes.data.items} lang={lang} t={t} showArea />}
      </section>
    </div>
  );
}
