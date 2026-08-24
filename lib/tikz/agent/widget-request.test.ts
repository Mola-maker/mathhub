import { describe, expect, it } from 'vitest';
import {
  requestsGeometryFlowWidget,
  requestsReadOnlyAgentWidget,
} from './widget-request';

describe('read-only Agent widget requests', () => {
  it('recognizes Chinese geometry flow phrasing without requiring the word widget', () => {
    const problem = '请把中点到中线的推导拆成四步动态几何流程图，只读，不修改画板。';
    expect(requestsGeometryFlowWidget(problem)).toBe(true);
    expect(requestsReadOnlyAgentWidget(problem)).toBe(true);
  });

  it('recognizes English proof-flow requests and ignores ordinary explanations', () => {
    expect(requestsReadOnlyAgentWidget('Show a read-only proof flow for the altitude.')).toBe(true);
    expect(requestsReadOnlyAgentWidget('Explain the altitude.')).toBe(false);
  });
});
