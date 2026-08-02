'use client';

import dynamic from 'next/dynamic';

const MathStudio = dynamic(
  () => import('@/components/math-studio').then((module) => module.MathStudio),
  {
    ssr: false,
    loading: () => (
      <div className="studio-route-loading" role="status">
        正在打开 GeoGebra Studio…
      </div>
    ),
  },
);

export function MathStudioRoute() {
  return <MathStudio startOpen />;
}
