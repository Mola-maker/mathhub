import { describe, expect, it } from 'vitest';
import { captureGeogebraLiveCommandSnapshot } from './geogebra-live-command-snapshot';

describe('captureGeogebraLiveCommandSnapshot', () => {
  it('captures free points and normalizes non-localized command brackets', () => {
    const snapshot = captureGeogebraLiveCommandSnapshot({
      getAllObjectNames: () => ['A', 'B', 's'],
      getObjectType: (name) => name === 's' ? 'segment' : 'point',
      getCommandString: (name, localized) => {
        expect(localized).toBe(false);
        if (name === 'B') return '(4,0)';
        if (name === 's') return 'Segment[A,B]';
        return '';
      },
      getXcoord: () => 0,
      getYcoord: () => 0,
    });

    expect(snapshot).toMatchObject({
      complete: true,
      objectCount: 3,
      definitionCount: 3,
      presentationCommandCount: 0,
      commands: ['A=(0,0)', 'B=(4,0)', 's=Segment(A,B)'],
      exclusions: [],
    });
  });

  it('never replaces a missing derived definition with evaluated coordinates', () => {
    const snapshot = captureGeogebraLiveCommandSnapshot({
      getAllObjectNames: () => ['lineAB'],
      getObjectType: () => 'line',
      getCommandString: () => '',
      getXcoord: () => 12,
      getYcoord: () => 8,
    });

    expect(snapshot).toMatchObject({
      complete: false,
      commands: [],
      exclusions: [{
        objectName: 'lineAB',
        objectType: 'line',
        reason: 'missing-definition',
      }],
    });
  });

  it('rejects a definition whose assignment label differs from the live object', () => {
    const snapshot = captureGeogebraLiveCommandSnapshot({
      getAllObjectNames: () => ['s'],
      getObjectType: () => 'segment',
      getCommandString: () => 'other=Segment[A,B]',
    });

    expect(snapshot).toMatchObject({
      complete: false,
      exclusions: [{ reason: 'definition-label-mismatch' }],
    });
  });
});
