import { describe, expect, it, vi } from 'vitest';
import {
  CommandRegistry,
  CommandRegistryError,
  formatShortcut,
  normalizeShortcut,
} from './command-registry';
import {
  createDefaultCommandRegistry,
  DEFAULT_TOOL_SHORTCUTS,
  type DefaultCommandContext,
} from './default-commands';

describe('normalizeShortcut', () => {
  it('canonicalizes modifier order and key aliases', () => {
    expect(normalizeShortcut('shift+ctrl+k', 'windows')).toBe('Control+Shift+K');
    expect(normalizeShortcut('esc', 'windows')).toBe('Escape');
    expect(normalizeShortcut('Cmd+Left', 'macos')).toBe('Meta+ArrowLeft');
  });

  it('maps Mod to the platform primary modifier', () => {
    expect(normalizeShortcut('Mod+K', 'windows')).toBe('Control+K');
    expect(normalizeShortcut('Mod+K', 'macos')).toBe('Meta+K');
  });

  it('treats a trailing double plus as the Plus key', () => {
    expect(normalizeShortcut('Mod++', 'windows')).toBe('Control++');
    expect(normalizeShortcut('+', 'windows')).toBe('+');
  });

  it('rejects empty, modifier-only, and multi-key shortcuts', () => {
    expect(() => normalizeShortcut('   ', 'windows')).toThrow(CommandRegistryError);
    expect(() => normalizeShortcut('Control', 'windows')).toThrow(/non-modifier key/);
    expect(() => normalizeShortcut('K+J', 'windows')).toThrow(/more than one/);
  });

  it('derives a shortcut from a keyboard event without remapping Ctrl on macOS', () => {
    expect(normalizeShortcut({ key: 'k', ctrlKey: true }, 'macos'))
      .toBe('Control+K');
    expect(normalizeShortcut({ code: 'KeyK', metaKey: true }, 'macos'))
      .toBe('Meta+K');
  });
});

describe('formatShortcut', () => {
  it('renders macOS symbols and keeps a readable Windows form', () => {
    expect(formatShortcut('Mod+K', 'macos')).toContain('⌘');
    // The display form abbreviates; `normalizeShortcut` keeps the canonical one.
    expect(formatShortcut('Mod+K', 'windows')).toBe('Ctrl+K');
    expect(normalizeShortcut('Mod+K', 'windows')).toBe('Control+K');
  });
});

describe('CommandRegistry resolution', () => {
  const registryWith = (
    executed: string[],
  ): CommandRegistry<Record<string, unknown>> => {
    const registry = new CommandRegistry();
    registry.register({
      id: 'low',
      scope: 'canvas',
      priority: 1,
      shortcuts: ['Mod+K'],
      execute: () => executed.push('low'),
    });
    registry.register({
      id: 'high',
      scope: 'canvas',
      priority: 5,
      shortcuts: ['Mod+K'],
      execute: () => executed.push('high'),
    });
    return registry;
  };

  it('prefers the higher-priority binding', () => {
    const executed: string[] = [];
    const registry = registryWith(executed);

    const resolution = registry.resolve({
      shortcut: 'Mod+K',
      scope: 'canvas',
      platform: 'windows',
    });

    expect(resolution?.status).toBe('resolved');
    expect(resolution?.command?.id).toBe('high');
  });

  it('reports ambiguity instead of guessing between equal priorities', () => {
    const registry = new CommandRegistry();
    registry.register({
      id: 'first',
      scope: 'canvas',
      shortcuts: ['X'],
      execute: () => 'first',
    });
    registry.register({
      id: 'second',
      scope: 'canvas',
      shortcuts: ['X'],
      execute: () => 'second',
    });

    const dispatched = registry.dispatch({
      shortcut: 'X',
      scope: 'canvas',
      platform: 'windows',
    });

    expect(dispatched).toMatchObject({ handled: false, reason: 'ambiguous' });
    expect(registry.detectConflicts()[0]).toMatchObject({
      severity: 'error',
      resolution: 'ambiguous',
    });
  });

  it('does not match a binding outside the requested scope', () => {
    const registry = new CommandRegistry();
    registry.register({
      id: 'canvas-only',
      scope: 'canvas',
      shortcuts: ['P'],
      execute: () => 'canvas',
    });

    expect(registry.resolve({
      shortcut: 'P',
      scope: 'editor',
      platform: 'windows',
    })).toBeNull();
  });

  it('suppresses non-editable bindings while typing but keeps opted-in ones', () => {
    const registry = new CommandRegistry();
    registry.register({
      id: 'tool',
      scope: 'canvas',
      shortcuts: ['P'],
      execute: () => 'tool',
    });
    registry.register({
      id: 'escape',
      scope: 'canvas',
      allowInEditable: true,
      shortcuts: ['Escape'],
      execute: () => 'escape',
    });

    expect(registry.resolve({
      shortcut: 'P',
      scope: 'canvas',
      editable: true,
      platform: 'windows',
    })).toBeNull();
    expect(registry.resolve({
      shortcut: 'Escape',
      scope: 'canvas',
      editable: true,
      platform: 'windows',
    })?.command?.id).toBe('escape');
  });

  it('ignores the browser keydown for a bare modifier key', () => {
    const registry = new CommandRegistry();
    registry.register({
      id: 'palette',
      scope: 'global',
      shortcuts: ['Mod+K'],
      execute: () => 'palette',
    });

    // A modifier-only event is valid browser input, not a registry error.
    expect(registry.resolve({
      shortcut: { key: 'Control', ctrlKey: true },
      platform: 'windows',
    })).toBeNull();
  });

  it('skips a binding whose condition is unmet', () => {
    const registry = new CommandRegistry<{ ready?: boolean }>();
    registry.register({
      id: 'conditional',
      scope: 'canvas',
      when: { key: 'ready', test: ({ context }) => Boolean(context.ready) },
      shortcuts: ['Enter'],
      execute: () => 'conditional',
    });

    expect(registry.resolve({
      shortcut: 'Enter',
      scope: 'canvas',
      context: {},
      platform: 'windows',
    })).toBeNull();
    expect(registry.resolve({
      shortcut: 'Enter',
      scope: 'canvas',
      context: { ready: true },
      platform: 'windows',
    })?.command?.id).toBe('conditional');
  });
});

describe('CommandRegistry dispatch', () => {
  it('dispatches Mod+A to the GeometryDoc-backed select-all command', () => {
    const selectAllGeometry = vi.fn();
    const registry = createDefaultCommandRegistry();

    const result = registry.dispatch({
      shortcut: { key: 'a', ctrlKey: true },
      scope: 'canvas',
      platform: 'windows',
      context: { selectAllGeometry } satisfies DefaultCommandContext,
    });

    expect(result).toMatchObject({ handled: true, commandId: 'selection.select-all' });
    expect(selectAllGeometry).toHaveBeenCalledOnce();
  });

  it('does not steal Mod+A from an editable surface', () => {
    const registry = createDefaultCommandRegistry();
    expect(registry.resolve({
      shortcut: 'Mod+A',
      scope: 'canvas',
      editable: true,
      platform: 'windows',
    })).toBeNull();
  });

  it('passes context and the originating event when the shortcut IS the event', () => {
    // Regression: discriminating on `typeof !== 'string'` treated the event
    // object as ResolveOptions and dropped its context, event, and platform.
    const registry = new CommandRegistry<{ hit?: string[] }>();
    const seen: Array<{ commandId: string; hasEvent: boolean }> = [];
    registry.register({
      id: 'escape',
      scope: 'studio',
      allowInEditable: true,
      shortcuts: ['Escape'],
      execute: (context, invocation) => {
        context.hit?.push(invocation.commandId);
        seen.push({
          commandId: invocation.commandId,
          hasEvent: invocation.event !== undefined,
        });
      },
    });
    const preventDefault = vi.fn();
    const hit: string[] = [];

    const result = registry.dispatch(
      { key: 'Escape', preventDefault },
      { scope: 'studio', context: { hit }, platform: 'windows' },
    );

    expect(result).toMatchObject({ handled: true, commandId: 'escape' });
    expect(hit).toEqual(['escape']);
    expect(seen[0]).toEqual({ commandId: 'escape', hasEvent: true });
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it('reports an executor throw without claiming the command was unhandled', () => {
    const registry = new CommandRegistry();
    const failure = new Error('executor failed');
    registry.register({
      id: 'boom',
      scope: 'canvas',
      shortcuts: ['B'],
      execute: () => { throw failure; },
    });

    const result = registry.dispatch({
      shortcut: 'B',
      scope: 'canvas',
      platform: 'windows',
    });

    expect(result).toMatchObject({
      handled: true,
      commandId: 'boom',
      error: failure,
    });
  });

  it('returns unhandled for an unregistered shortcut', () => {
    const registry = new CommandRegistry();

    expect(registry.dispatch({
      shortcut: 'Mod+Z',
      scope: 'canvas',
      platform: 'windows',
    })).toMatchObject({ handled: false, reason: 'unhandled', resolution: null });
  });

  it('rejects a duplicate id unless replace is requested', () => {
    const registry = new CommandRegistry();
    const definition = {
      id: 'dup',
      scope: 'canvas' as const,
      shortcuts: ['Z'],
      execute: () => 'first',
    };
    registry.register(definition);

    expect(() => registry.register(definition)).toThrow(CommandRegistryError);
    expect(() => registry.register(definition, { replace: true })).not.toThrow();
    expect(registry.list()).toHaveLength(1);
  });

  it('stops matching after unregister', () => {
    const registry = new CommandRegistry();
    const registration = registry.register({
      id: 'temp',
      scope: 'canvas',
      shortcuts: ['T'],
      execute: () => 'temp',
    });

    expect(registration.unregister()).toBe(true);
    expect(registry.resolve({
      shortcut: 'T',
      scope: 'canvas',
      platform: 'windows',
    })).toBeNull();
  });
});

describe('default TikZ Studio command set', () => {
  it('ships no ambiguous shortcut conflicts', () => {
    const ambiguous = createDefaultCommandRegistry()
      .detectConflicts()
      .filter((conflict) => conflict.resolution === 'ambiguous');

    expect(ambiguous).toEqual([]);
  });

  it('assigns every tool a unique activation chord', () => {
    const chords = DEFAULT_TOOL_SHORTCUTS.map((tool) => (
      normalizeShortcut(tool.shortcut, 'windows')
    ));

    expect(new Set(chords).size).toBe(chords.length);
  });

  it('gives construction.back priority over studio.close while constructing', () => {
    const registry = createDefaultCommandRegistry();
    const calls: string[] = [];
    const context: DefaultCommandContext = {
      activeConstruction: true,
      closeStudio: () => calls.push('close'),
      backConstruction: () => calls.push('back'),
    };

    const result = registry.dispatch({
      shortcut: 'Escape',
      scope: 'canvas',
      context,
      platform: 'windows',
    });

    expect(result.commandId).toBe('construction.back');
    expect(calls).toEqual(['back']);
  });

  it('closes the studio with Escape when no construction is active', () => {
    const registry = createDefaultCommandRegistry();
    const calls: string[] = [];
    const context: DefaultCommandContext = {
      activeConstruction: false,
      closeStudio: () => calls.push('close'),
      backConstruction: () => calls.push('back'),
    };

    const result = registry.dispatch({
      shortcut: 'Escape',
      scope: 'studio',
      context,
      platform: 'windows',
    });

    expect(result.commandId).toBe('studio.close');
    expect(calls).toEqual(['close']);
  });

  it('deletes the selection only when something is selected', () => {
    const registry = createDefaultCommandRegistry();
    const calls: string[] = [];
    const base: DefaultCommandContext = {
      deleteSelection: () => calls.push('delete'),
    };

    expect(registry.dispatch({
      shortcut: 'Backspace',
      scope: 'canvas',
      context: base,
      platform: 'windows',
    })).toMatchObject({ handled: false });

    expect(registry.dispatch({
      shortcut: 'Delete',
      scope: 'canvas',
      context: { ...base, hasSelection: true },
      platform: 'windows',
    })).toMatchObject({ handled: true, commandId: 'selection.delete' });
    expect(calls).toEqual(['delete']);
  });

  it('keeps the palette on the platform primary modifier', () => {
    const registry = createDefaultCommandRegistry();
    const calls: string[] = [];
    const context: DefaultCommandContext = {
      togglePalette: () => calls.push('palette'),
    };

    expect(registry.dispatch({
      shortcut: { key: 'k', metaKey: true },
      scope: 'canvas',
      context,
      platform: 'macos',
    })).toMatchObject({ handled: true, commandId: 'palette.toggle' });
    expect(registry.dispatch({
      shortcut: { key: 'k', ctrlKey: true },
      scope: 'canvas',
      context,
      platform: 'windows',
    })).toMatchObject({ handled: true, commandId: 'palette.toggle' });
    expect(calls).toEqual(['palette', 'palette']);
  });

  it('does not fire a single-letter tool chord while typing in the editor', () => {
    const registry = createDefaultCommandRegistry();
    const activated: string[] = [];

    const result = registry.dispatch({
      shortcut: 'P',
      scope: 'canvas',
      editable: true,
      context: { activateTool: (toolId) => activated.push(toolId) },
      platform: 'windows',
    });

    expect(result).toMatchObject({ handled: false });
    expect(activated).toEqual([]);
  });
});
