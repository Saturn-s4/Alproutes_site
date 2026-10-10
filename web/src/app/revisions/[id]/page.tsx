import { RevisionView } from '@/components/edit/RevisionView';

export const metadata = { title: 'Ревизия маршрута', robots: { index: false } };

export default async function RevisionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RevisionView key={id} revisionId={id} />;
}
