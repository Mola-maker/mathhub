import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __problemGatewayTest,
  geometryProblemReferenceRecord,
  searchGeometryProblemSources,
} from './source-gateway';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  __problemGatewayTest.resetGatewayCache();
});

describe('geometry problem source gateway', () => {
  it('normalizes an attributed MathNet geometry record', () => {
    const record = __problemGatewayTest.mathNetRecord({
      id: 'abc',
      competition: 'IMO 2024',
      year: 2024,
      problem_number: '6',
      problem_markdown: 'Let ABC be a triangle.',
      solutions_markdown: ['Construct the auxiliary circle.'],
      topics_flat: ['Geometry > Plane Geometry > Circles'],
      language: 'en',
      images: [{ path: 'figure.png' }],
    });
    expect(record).toMatchObject({
      id: 'mathnet:abc',
      source: 'mathnet',
      competition: 'IMO 2024',
      hasImages: true,
      title: 'IMO 2024 · P6',
      licenseId: 'CC-BY-4.0',
      contentHashAlgorithm: 'sha256-utf8',
      contentHashScope: 'normalized-live-snapshot',
      solutionProvenance: 'dataset-provided',
      taint: 'untrusted-external-reference',
      admission: 'search-reference-only',
      provider: {
        datasetId: 'ShadenA/MathNet',
        revision: null,
        revisionStatus: 'unpinned-live-viewer',
      },
      rights: {
        sourceMaterialRights: 'conditional',
        redistribution: 'review-required',
        commercial: 'review-required',
        training: 'review-required',
      },
    });
    expect(record?.sourceUrl).toContain('mathnet.mit.edu');
    expect(record?.contentHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(record?.assets).toEqual([
      expect.objectContaining({
        role: 'problem-diagram',
        providerField: 'images[0]',
        integrity: 'unverified-live-reference',
      }),
    ]);
    const publicReference = geometryProblemReferenceRecord(record!);
    expect(publicReference.statementPreview).toBe('Let ABC be a triangle.');
    expect(publicReference.solutionCount).toBe(1);
    expect(publicReference).not.toHaveProperty('statement');
    expect(publicReference).not.toHaveProperty('solutions');
  });

  it('normalizes only Geometry rows from the attributed OlympiadBench dataset', () => {
    const record = __problemGatewayTest.olympiadBenchRecord({
      id: 2240,
      question: 'In triangle ABC, the circle with diameter BC meets two sides.',
      solution: ['Join BY and use the right angle subtended by a diameter.'],
      subfield: 'Geometry',
      subject: 'Math',
      question_type: 'Open-ended',
      difficulty: 'Competition',
      language: 'English',
      modality: 'Multimodal',
      image_1: { path: 'diagram.png' },
    }, 'OE_MM_maths_en_COMP', 2);
    expect(record).toMatchObject({
      id: 'olympiadbench:OE_MM_maths_en_COMP:2240',
      source: 'olympiadbench',
      licenseId: 'Apache-2.0',
      hasImages: true,
      solutionProvenance: 'dataset-provided',
      contentHashAlgorithm: 'sha256-utf8',
      rights: {
        sourceMaterialRights: 'review-required',
        redistribution: 'review-required',
      },
    });
    expect(record?.sourceUrl).toContain('row=2');
    expect(__problemGatewayTest.olympiadBenchRecord({
      id: 1,
      question: 'Solve x.',
      subfield: 'Algebra',
    }, 'TP_TO_maths_en_COMP')).toBeNull();
  });

  it('includes stable display and provenance metadata in the live snapshot hash', () => {
    const base = {
      id: 'hash-metadata',
      problem_markdown: 'A geometry statement.',
      solutions_markdown: ['A solution.'],
      topics_flat: ['Geometry'],
      language: 'en',
      competition: 'Contest A',
      year: 2024,
    };
    const original = __problemGatewayTest.mathNetRecord(base);
    const changed = __problemGatewayTest.mathNetRecord({
      ...base,
      competition: 'Contest B',
    });
    expect(original?.contentHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(changed?.contentHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(changed?.contentHash).not.toBe(original?.contentHash);
  });

  it('rejects non-geometry rows and ranks exact topic terms', () => {
    expect(__problemGatewayTest.mathNetRecord({
      unique_id: 'algebra',
      problem_markdown: 'Solve x.',
      topics_flat: ['Algebra'],
    })).toBeNull();
    const geometry = __problemGatewayTest.mathNetRecord({
      unique_id: 'geo',
      problem_markdown: 'Prove the Simson line is collinear.',
      topics_flat: ['Geometry > Simson'],
    })!;
    expect(__problemGatewayTest.score(geometry, ['simson'])).toBe(1);
    expect(__problemGatewayTest.queryTerms('Simson line olympiad geometry problem'))
      .toEqual(['simson', 'line']);
    const distractor = __problemGatewayTest.mathNetRecord({
      unique_id: 'line-only',
      problem_markdown: 'Several line segments intersect in the plane.',
      topics_flat: ['Geometry > Lines'],
    })!;
    expect(__problemGatewayTest.rankRecords(
      [distractor, geometry],
      ['simson', 'line'],
      8,
    )).toEqual([geometry]);
  });

  it('uses the official full-text search endpoint for non-empty queries', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe('/search');
      expect(url.searchParams.get('query')).toBe('Simson line');
      if (url.searchParams.get('dataset') === 'Hothan/OlympiadBench') {
        return new Response(JSON.stringify({ rows: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      expect(url.searchParams.get('dataset')).toBe('ShadenA/MathNet');
      expect(url.searchParams.get('config')).toBe('all');
      return new Response(JSON.stringify({
        rows: [{
          row: {
            id: 'simson-1',
            competition: 'Geometry Olympiad',
            problem_markdown: 'Let P lie on the circumcircle of ABC. Prove the Simson feet are collinear.',
            solutions_markdown: ['Drop the three perpendiculars.'],
            topics_flat: ['Geometry > Plane Geometry > Simson line'],
            language: 'en',
          },
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await searchGeometryProblemSources({
      query: 'Simson line',
      limit: 8,
      signal: new AbortController().signal,
    });
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      id: 'mathnet:simson-1',
      source: 'mathnet',
    });
    expect(result.sourceStatus[0]).toMatchObject({ id: 'mathnet', enabled: true });
    expect(result.sourceStatus[1]).toMatchObject({ id: 'olympiadbench', enabled: true });
    expect(result.sourceStatus).toHaveLength(7);
    expect(result.sourceStatus).toContainEqual(expect.objectContaining({
      id: 'geometry3k',
      enabled: false,
      accessMode: 'registry-only',
    }));
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('deduplicates concurrent identical live searches without sharing caller cancellation', async () => {
    let requests = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      requests += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return new Response(JSON.stringify({ rows: [] }), { status: 200 });
    }));
    const a = searchGeometryProblemSources({
      query: 'same query',
      signal: new AbortController().signal,
    });
    const b = searchGeometryProblemSources({
      query: 'same query',
      signal: new AbortController().signal,
    });
    await Promise.all([a, b]);
    expect(requests).toBe(5);
  });

  it('never upgrades a row-level copyright notice into an open-use decision', () => {
    const record = __problemGatewayTest.mathNetRecord({
      id: 'rights-1',
      problem_markdown: 'A geometry statement.',
      topics_flat: ['Geometry'],
      copyright_holder: 'Example National Olympiad Committee',
    });
    expect(record?.rights).toMatchObject({
      rowOverride: 'declared-upstream',
      rightsholder: 'Example National Olympiad Committee',
      redistribution: 'review-required',
      commercial: 'review-required',
      training: 'review-required',
    });
  });

  it('keeps paged row browsing for an empty query', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe('/rows');
      expect(url.searchParams.has('query')).toBe(false);
      return new Response(JSON.stringify({ rows: [] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await searchGeometryProblemSources({
      query: '',
      offset: 100,
      signal: new AbortController().signal,
    });
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('queries independent sources concurrently within one wall-clock budget', async () => {
    let inFlight = 0;
    let maximumInFlight = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      inFlight += 1;
      maximumInFlight = Math.max(maximumInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return new Response(JSON.stringify({ rows: [] }), { status: 200 });
    }));
    await searchGeometryProblemSources({
      query: '',
      signal: new AbortController().signal,
    });
    expect(maximumInFlight).toBeGreaterThan(1);
  });

  it('falls back to bounded row windows when the remote full-text endpoint is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname === '/search') return new Response('unavailable', { status: 503 });
      if (url.searchParams.get('dataset') === 'ShadenA/MathNet') {
        return new Response(JSON.stringify({
          rows: [{
            row: {
              id: 'fallback-simson',
              problem_markdown: 'Let P lie on the circumcircle. Prove the Simson feet are collinear.',
              topics_flat: ['Geometry > Simson line'],
            },
          }],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ rows: [] }), { status: 200 });
    }));

    const result = await searchGeometryProblemSources({
      query: 'Simson',
      signal: new AbortController().signal,
    });
    expect(result.records).toContainEqual(expect.objectContaining({
      id: 'mathnet:fallback-simson',
    }));
    expect(result.sourceStatus[0]).toMatchObject({
      id: 'mathnet',
      enabled: true,
    });
    expect(result.sourceStatus[0]?.detail).toContain('row-window fallback');
  });

  it('keeps one failing OlympiadBench configuration isolated from other sources', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      const dataset = url.searchParams.get('dataset');
      if (dataset === 'ShadenA/MathNet') {
        return new Response(JSON.stringify({ rows: [] }), { status: 200 });
      }
      if (url.searchParams.get('config') === 'TP_TO_maths_en_COMP') {
        return new Response('unavailable', { status: 503 });
      }
      return new Response(JSON.stringify({ rows: [{
        row_idx: 7,
        row: {
          id: 77,
          question: 'A geometry circle problem.',
          solution: ['Construct the auxiliary circle.'],
          subfield: 'Geometry',
          subject: 'Math',
          language: 'English',
        },
      }] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await searchGeometryProblemSources({
      query: 'circle',
      signal: new AbortController().signal,
    });
    expect(result.records.some((record) => record.source === 'olympiadbench')).toBe(true);
    expect(result.sourceStatus[1]).toMatchObject({
      id: 'olympiadbench',
      enabled: true,
    });
    expect(result.sourceStatus[1]?.detail).toContain('partial');
  });

  it('disables OlympiadBench when every configuration fails and returns no records', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.searchParams.get('dataset') === 'ShadenA/MathNet') {
        return new Response(JSON.stringify({ rows: [] }), { status: 200 });
      }
      if (url.searchParams.get('dataset') === 'Hothan/OlympiadBench') {
        return new Response('upstream unavailable', { status: 503 });
      }
      throw new Error(`unexpected dataset: ${url.searchParams.get('dataset')}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await searchGeometryProblemSources({
      query: 'circle',
      signal: new AbortController().signal,
    });
    const status = result.sourceStatus.find((entry) => entry.id === 'olympiadbench');
    expect(result.records).toEqual([]);
    expect(status).toMatchObject({
      id: 'olympiadbench',
      enabled: false,
      accessMode: 'live-search',
    });
    expect(status?.detail).toContain('HTTP 503');
    // One MathNet search plus search+row fallback for each of four configs.
    expect(fetchMock).toHaveBeenCalledTimes(9);
  });

  it('never reports FormalGeo searchable when only restricted configuration is present', async () => {
    vi.stubEnv('FORMALGEO_DATA_URL', 'https://example.test/formalgeo.json');
    vi.stubEnv('FORMALGEO_ACCEPT_RESTRICTED_LICENSE', '1');
    vi.stubGlobal('fetch', vi.fn(async () => (
      new Response(JSON.stringify({ rows: [] }), { status: 200 })
    )));

    const result = await searchGeometryProblemSources({
      query: '',
      signal: new AbortController().signal,
    });
    const status = result.sourceStatus.find((entry) => entry.id === 'formalgeo');
    expect(status).toMatchObject({
      id: 'formalgeo',
      enabled: false,
      accessMode: 'restricted-opt-in',
    });
    expect(status?.detail).toContain('no searchable adapter is installed');
  });

  it('propagates cancellation instead of turning an aborted run into an empty result', async () => {
    const controller = new AbortController();
    controller.abort(new DOMException('cancelled', 'AbortError'));
    vi.stubGlobal('fetch', vi.fn(async (_input, init) => {
      if ((init?.signal as AbortSignal | undefined)?.aborted) {
        throw (init?.signal as AbortSignal).reason;
      }
      return new Response(JSON.stringify({ rows: [] }));
    }));
    await expect(searchGeometryProblemSources({
      query: 'circle',
      signal: controller.signal,
    })).rejects.toThrow('cancelled');
  });
});
