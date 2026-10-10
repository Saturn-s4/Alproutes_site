import { Suspense } from 'react';
import { RouteExplorer } from '@/components/RouteExplorer';

export default function MapPage() {
  return (
    <Suspense>
      <RouteExplorer />
    </Suspense>
  );
}
