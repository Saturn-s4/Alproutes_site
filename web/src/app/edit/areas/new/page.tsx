import { AreaEditor } from '@/components/edit/AreaEditor';

export const metadata = { title: 'Новый район', robots: { index: false } };

export default async function NewAreaPage({ searchParams }: { searchParams: Promise<{ parent?: string }> }) {
  const { parent } = await searchParams;
  return <AreaEditor parentId={parent} />;
}
