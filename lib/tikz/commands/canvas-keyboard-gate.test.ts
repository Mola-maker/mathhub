import { describe, expect, it } from 'vitest';
import { explicitCanvasKeyboardFocusEntry } from './canvas-keyboard-gate';

describe('Canvas keyboard focus gate', () => {
  it('rejects focus restoration with no source target', () => {
    expect(explicitCanvasKeyboardFocusEntry(null)).toBe(false);
  });

  it('accepts an explicit focus transition such as Tab navigation', () => {
    expect(explicitCanvasKeyboardFocusEntry({} as EventTarget)).toBe(true);
  });
});
