import { RouteEditor } from '@/components/edit/RouteEditor';

export const metadata = { title: 'Правка маршрута', robots: { index: false } };

type Props = { params: Promise<{ routeId: string }>; searchParams: Promise<{ from?: string }> };

export default async function EditRoutePage({ params, searchParams }: Props) {
  const { routeId } = await params;
  const { from } = await searchParams;
  // key: a different source revision means a fresh form.
  return <RouteEditor key={`${routeId}:${from ?? ''}`} target={{ kind: 'edit', routeId, fromRevisionId: from }} />;
}
