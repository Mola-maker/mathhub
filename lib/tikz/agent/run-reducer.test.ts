import { describe, expect, it } from 'vitest';
import { tikzAgentEvent } from './protocol';
import { emptyTikzAgentRun, reduceTikzAgentRun } from './run-reducer';

describe('reduceTikzAgentRun', () => {
  it('accepts exactly one terminal and ignores late events', () => {
    let state = emptyTikzAgentRun('run');
    state = reduceTikzAgentRun(state, tikzAgentEvent('run', 0, {
      type: 'run.started', title: 'start',
    }));
    state = reduceTikzAgentRun(state, tikzAgentEvent('run', 1, {
      type: 'run.completed', title: 'done', outcome: 'answer',
    }));
    state = reduceTikzAgentRun(state, tikzAgentEvent('run', 2, {
      type: 'proposal.ready', title: 'late',
    }));
    state = reduceTikzAgentRun(state, tikzAgentEvent('run', 3, {
      type: 'run.failed', title: 'duplicate terminal', outcome: 'failed',
    }));
    expect(state.status).toBe('completed');
    expect(state.steps.map((step) => step.type)).toEqual(['run.started', 'run.completed']);
  });

  it('ignores duplicate and foreign events', () => {
    const event = tikzAgentEvent('run', 0, { type: 'run.started', title: 'start' });
    const once = reduceTikzAgentRun(emptyTikzAgentRun('run'), event);
    expect(reduceTikzAgentRun(once, event)).toBe(once);
    expect(reduceTikzAgentRun(once, tikzAgentEvent('other', 1, {
      type: 'run.started', title: 'other',
    }))).toBe(once);
  });

  it('rejects replayed or out-of-order sequence numbers', () => {
    const started = reduceTikzAgentRun(
      emptyTikzAgentRun('run'),
      tikzAgentEvent('run', 10, { type: 'run.started', title: 'start' }),
    );
    expect(reduceTikzAgentRun(started, tikzAgentEvent('run', 9, {
      type: 'context.read', title: 'stale',
    }))).toBe(started);
    expect(reduceTikzAgentRun(started, tikzAgentEvent('run', 10, {
      type: 'context.read', title: 'collision',
    }))).toBe(started);
  });

  it('upserts one tool lifecycle by toolCallId instead of creating duplicate actions', () => {
    let state = reduceTikzAgentRun(
      emptyTikzAgentRun('run'),
      tikzAgentEvent('run', 0, { type: 'run.started', title: 'start' }),
    );
    state = reduceTikzAgentRun(state, tikzAgentEvent('run', 1, {
      type: 'tool.started',
      title: 'reading geometry',
      toolCallId: 'call-1',
      toolName: 'read-geometry-context',
    }));
    state = reduceTikzAgentRun(state, tikzAgentEvent('run', 2, {
      type: 'tool.completed',
      title: 'geometry read',
      detail: '12 entities',
      toolCallId: 'call-1',
      toolName: 'read-geometry-context',
    }));

    expect(state.toolCalls).toEqual([expect.objectContaining({
      toolCallId: 'call-1',
      toolName: 'read-geometry-context',
      status: 'completed',
      title: 'geometry read',
      detail: '12 entities',
      firstSequence: 1,
      lastSequence: 2,
      startedEventId: 'run:1',
      terminalEventId: 'run:2',
    })]);
    expect(state.steps.map((step) => step.type)).toEqual([
      'run.started',
      'tool.started',
      'tool.completed',
    ]);
  });

  it('quarantines tool identity conflicts and transitions after the tool terminal', () => {
    const state = reduceTikzAgentRun(
      emptyTikzAgentRun('run'),
      tikzAgentEvent('run', 0, {
        type: 'tool.completed',
        title: 'geometry read',
        toolCallId: 'call-1',
        toolName: 'read-geometry-context',
      }),
    );
    const conflictingName = reduceTikzAgentRun(state, tikzAgentEvent('run', 1, {
      type: 'tool.started',
      title: 'pretend write',
      toolCallId: 'call-1',
      toolName: 'apply-source-patch',
    }));
    expect(conflictingName).toBe(state);

    const secondTerminal = reduceTikzAgentRun(state, tikzAgentEvent('run', 2, {
      type: 'tool.rejected',
      title: 'duplicate terminal',
      toolCallId: 'call-1',
      toolName: 'read-geometry-context',
    }));
    expect(secondTerminal).toBe(state);
  });

  it('settles an open tool card when its owning run reaches a terminal', () => {
    let state = reduceTikzAgentRun(
      emptyTikzAgentRun('run'),
      tikzAgentEvent('run', 0, {
        type: 'tool.started',
        title: 'searching',
        toolCallId: 'call-1',
        toolName: 'search-geometry-problems',
      }),
    );
    state = reduceTikzAgentRun(state, tikzAgentEvent('run', 1, {
      type: 'run.completed',
      title: 'cancelled',
      outcome: 'unapplied-candidate',
    }));

    expect(state.toolCalls[0]).toMatchObject({
      toolCallId: 'call-1',
      status: 'cancelled',
      lastSequence: 1,
      terminalEventId: 'run:1',
    });
  });
});
