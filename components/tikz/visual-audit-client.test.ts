import { describe, expect, it } from 'vitest';
import {
  matchesExactCanvasSurfaceBasis,
  matchesTikzRenderComparisonArtifact,
  matchesTikzVisualAuditBasis,
  tikzComparisonViewBox,
} from './visual-audit-client';

describe('matchesTikzVisualAuditBasis', () => {
  it('reuses an exact Canvas surface only for the requested source revision and digest', () => {
    const dataset = {
      sourceRevision: '7',
      sourceDigest: 'a'.repeat(64),
      artifactDigest: 'b'.repeat(64),
    };
    expect(matchesExactCanvasSurfaceBasis(dataset, {
      sourceRevision: 7,
      sourceDigest: 'a'.repeat(64),
    })).toBe(true);
    expect(matchesExactCanvasSurfaceBasis(dataset, {
      sourceRevision: 8,
      sourceDigest: 'a'.repeat(64),
    })).toBe(false);
    expect(matchesExactCanvasSurfaceBasis(dataset, {
      sourceRevision: 7,
      sourceDigest: 'c'.repeat(64),
    })).toBe(false);
  });

  it('fits interactive geometry into the same inset surface independent of pan and zoom', () => {
    const first = tikzComparisonViewBox(
      { x: 100, y: 200, width: 200, height: 100 },
      { width: 1_000, height: 600 },
    );
    const second = tikzComparisonViewBox(
      { x: 600, y: -300, width: 400, height: 200 },
      { width: 1_000, height: 600 },
    );
    const normalized = (value: string) => {
      const [x, y, width, height] = value.split(' ').map(Number) as [number, number, number, number];
      return { width, height, centerX: x + width / 2, centerY: y + height / 2 };
    };
    const normalizedFirst = normalized(first!);
    const normalizedSecond = normalized(second!);
    expect(normalizedFirst.centerX).toBeCloseTo(200, 10);
    expect(normalizedFirst.centerY).toBeCloseTo(250, 10);
    expect(normalizedSecond.centerX).toBeCloseTo(800, 10);
    expect(normalizedSecond.centerY).toBeCloseTo(-200, 10);
    expect(normalizedSecond.width).toBeCloseTo(normalizedFirst.width * 2, 10);
    expect(normalizedSecond.height).toBeCloseTo(normalizedFirst.height * 2, 10);
    expect(tikzComparisonViewBox(
      { x: 0, y: 0, width: 0, height: 0 },
      { width: 1_000, height: 600 },
    )).toBeNull();
  });

  it('binds a VLM observation to the source revision, hash, and exact artifact', () => {
    const expected = {
      documentId: 'document-1',
      epoch: 'epoch-1',
      sourceRevision: 7,
      sourceHash: 'source-hash',
      artifactDigest: 'a'.repeat(64),
    };
    expect(matchesTikzVisualAuditBasis({
      documentId: 'document-1',
      epoch: 'epoch-1',
      sourceRevision: 7,
      sourceHash: 'source-hash',
      artifactDigest: 'a'.repeat(64),
    }, expected)).toBe(true);
    expect(matchesTikzVisualAuditBasis({
      documentId: 'document-1',
      epoch: 'epoch-1',
      sourceRevision: 8,
      sourceHash: 'source-hash',
      artifactDigest: 'a'.repeat(64),
    }, expected)).toBe(false);
    expect(matchesTikzVisualAuditBasis({
      documentId: 'document-1',
      epoch: 'epoch-1',
      sourceRevision: 7,
      sourceHash: 'source-hash',
      artifactDigest: 'b'.repeat(64),
    }, expected)).toBe(false);
    expect(matchesTikzVisualAuditBasis({
      documentId: 'document-2',
      epoch: 'epoch-1',
      sourceRevision: 7,
      sourceHash: 'source-hash',
      artifactDigest: 'a'.repeat(64),
    }, expected)).toBe(false);
    expect(matchesTikzVisualAuditBasis({
      documentId: 'document-1',
      epoch: 'epoch-2',
      sourceRevision: 7,
      sourceHash: 'source-hash',
      artifactDigest: 'a'.repeat(64),
    }, expected)).toBe(false);
  });

  it('binds a render comparison artifact to both raster digests and the exact artifact', () => {
    const expected = {
      schemaVersion: 'tikz-render-comparison-artifact/v1' as const,
      documentId: 'document-1',
      epoch: 'epoch-1',
      sourceRevision: 8,
      sourceHash: 'a1b2c3d4e5f60718',
      mode: 'interactive-vs-exact' as const,
      interactiveRasterDigest: 'a'.repeat(64),
      exactRasterDigest: 'b'.repeat(64),
      exactArtifactDigest: 'c'.repeat(64),
    };
    expect(matchesTikzRenderComparisonArtifact(expected, expected)).toBe(true);
    expect(matchesTikzRenderComparisonArtifact({
      ...expected,
      exactRasterDigest: 'd'.repeat(64),
    }, expected)).toBe(false);
    expect(matchesTikzRenderComparisonArtifact({
      ...expected,
      sourceRevision: 9,
    }, expected)).toBe(false);
    expect(matchesTikzRenderComparisonArtifact({
      ...expected,
      mode: 'interactive-only',
    }, expected)).toBe(false);
  });
});
