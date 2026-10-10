import { AreaEditor } from '@/components/edit/AreaEditor';

export const metadata = { title: 'Правка района', robots: { index: false } };

export default async function EditAreaPage({ params }: { params: Promise<{ areaId: string }> }) {
  const { areaId } = await params;
  return <AreaEditor areaId={areaId} />;
}
