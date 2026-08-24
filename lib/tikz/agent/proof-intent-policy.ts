/**
 * Host-side product policy for proof-solving mutations.
 *
 * This classifier does not grant source authority. It only decides whether a
 * semantic construction must cite a current read-only proof-state observation
 * before the normal GeometryIntent/Broker pipeline is allowed to continue.
 */
export function requiresGeometryProofObservation(problem: string): boolean {
  const normalized = problem.trim();
  if (normalized.length === 0) return false;
  return /(?:证明|求证|推导|解答|辅助线|竞赛几何|奥林匹克几何|奥数几何|几何命题|动态推导|proof\b|prove\b|theorem\b|derive\b|deduce\b|auxiliary\s+(?:point|line|circle|construction)|olympiad\s+geometry)/iu
    .test(normalized);
}
