'use client';

import dynamic from 'next/dynamic';

const TikzStudio = dynamic(
  () => import('@/components/tikz-studio').then((module) => module.TikzStudio),
  {
    ssr: false,
    loading: () => (
      <div className="studio-route-loading" role="status">
        正在打开 TikZ Studio…
      </div>
    ),
  },
);

export function TikzRouteClient({
  initialSelectionRefs,
  initialStmtIndex,
}: {
  initialSelectionRefs: readonly string[];
  initialStmtIndex: number | null;
}) {
  return (
    <TikzStudio
      startOpen
      initialSelectionRefs={initialSelectionRefs}
      initialStmtIndex={initialStmtIndex}
    />
  );
}
