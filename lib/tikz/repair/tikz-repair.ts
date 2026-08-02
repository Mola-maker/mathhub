import { analyze } from '../analyze';
import { snapshotScene } from './scene-snapshot';
import { canonicalizeTikz } from '../normalize';

const FULLWIDTH: Array<[RegExp, string]> = [
  [/，/g, ','],
  [/（/g, '('],
  [/）/g, ')'],
  [/：/g, ':'],
  [/；/g, ';'],
  [/！/g, '!'],
];

export function localRepairTikz(code: string): { code: string; fixes: string[] } {
  let output = canonicalizeTikz(code);
  const fixes: string[] = [];
  if (output !== code) fixes.push('旧版过点圆转为标准 TikZ node 语法');
  const fence = /```(?:tikz|latex|tex)?\s*\n?([\s\S]*?)```/i.exec(output);
  if (fence) {
    output = fence[1].trim();
    fixes.push('剥离代码围栏');
  }
  for (const [pattern, replacement] of FULLWIDTH) {
    pattern.lastIndex = 0;
    if (pattern.test(output)) {
      pattern.lastIndex = 0;
      output = output.replace(pattern, replacement);
      fixes.push(`全角转半角 ${replacement}`);
    }
  }
  if (output.includes('\\begin{tikzpicture}') && !output.includes('\\end{tikzpicture}')) {
    output = `${output}\n\\end{tikzpicture}`;
    fixes.push('补全 \\end{tikzpicture}');
  }
  return { code: output, fixes: [...new Set(fixes)] };
}

function errorMessages(code: string): string[] {
  return analyze(code).issues
    .filter((issue) => issue.severity === 'error')
    .map((issue) => issue.message);
}

async function readRepairCode(response: Response): Promise<string | null> {
  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(payload.error ?? `HTTP ${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let repaired: string | null = null;
  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const line = frame.split(/\r?\n/).find((item) => item.startsWith('data: '));
      if (!line || line.slice(6) === '[DONE]') continue;
      try {
        const event = JSON.parse(line.slice(6)) as { tikzCode?: unknown; error?: unknown };
        if (typeof event.error === 'string') throw new Error(event.error);
        if (typeof event.tikzCode === 'string') repaired = event.tikzCode;
      } catch (error) {
        if (error instanceof SyntaxError) continue;
        throw error;
      }
    }
    if (done) return repaired;
  }
}

export interface TikzRepairOptions {
  code: string;
  provider: string;
  model?: string;
  maxRounds?: number;
  request?: typeof fetch;
}

export interface TikzRepairResult {
  code: string;
  fixes: string[];
  errorsBefore: number;
  errorsAfter: number;
  llmRounds: number;
}

export async function runTikzRepair(options: TikzRepairOptions): Promise<TikzRepairResult> {
  const request = options.request ?? fetch;
  const initialErrors = errorMessages(options.code);
  const local = localRepairTikz(options.code);
  let bestCode = options.code;
  let bestErrors = initialErrors;
  const localErrors = errorMessages(local.code);
  if (localErrors.length < bestErrors.length) {
    bestCode = local.code;
    bestErrors = localErrors;
  }

  let llmRounds = 0;
  const rounds = Math.max(0, Math.min(2, options.maxRounds ?? 2));
  while (bestErrors.length > 0 && llmRounds < rounds) {
    const analysis = analyze(bestCode);
    const response = await request('/api/tikz', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'repair',
        tikzCode: bestCode,
        failures: bestErrors,
        sceneSnapshot: analysis.scene ? snapshotScene(analysis.scene) : '',
        provider: options.provider,
        model: options.model || undefined,
      }),
    });
    llmRounds += 1;
    const candidate = await readRepairCode(response);
    if (!candidate) break;
    const cleaned = localRepairTikz(candidate);
    const candidateErrors = errorMessages(cleaned.code);
    if (candidateErrors.length >= bestErrors.length) break;
    bestCode = cleaned.code;
    bestErrors = candidateErrors;
  }

  return {
    code: bestCode,
    fixes: local.fixes,
    errorsBefore: initialErrors.length,
    errorsAfter: bestErrors.length,
    llmRounds,
  };
}
