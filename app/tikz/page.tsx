import { TikzRouteClient } from '@/components/tikz/tikz-route-client';

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function TikzHome({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const initialSelectionRefs = (firstParam(params.selection) ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const rawStmtIndex = Number(firstParam(params.stmtIndex));
  const initialStmtIndex = Number.isInteger(rawStmtIndex) && rawStmtIndex >= 0
    ? rawStmtIndex
    : null;

  return (
    <main className="math-shell">
      <TikzRouteClient
        initialSelectionRefs={initialSelectionRefs}
        initialStmtIndex={initialStmtIndex}
      />
    </main>
  );
}
