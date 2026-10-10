import { RouteEditor } from '@/components/edit/RouteEditor';

export const metadata = { title: 'Новый маршрут', robots: { index: false } };

export default async function NewRoutePage({ searchParams }: { searchParams: Promise<{ area?: string }> }) {
  const { area } = await searchParams;
  return <RouteEditor target={{ kind: 'create', areaId: area }} />;
}
