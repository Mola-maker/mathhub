// DashScope (阿里百炼) model catalog for the Math assistant.
// IDs must match the OpenAI-compatible endpoint `model` field.

export interface DashScopeModelEntry {
  id: string;
  label: string;
  /** When true, the model may stream `reasoning_content` before `content`. */
  thinking?: boolean;
}

/** User-selectable models (stable IDs from Bailian console / compatible-mode docs). */
export const DASHSCOPE_MODEL_CATALOG: DashScopeModelEntry[] = [
  { id: 'qwen-plus', label: 'Qwen Plus（推荐）' },
  { id: 'qwen-turbo', label: 'Qwen Turbo（快）' },
  { id: 'qwen-max', label: 'Qwen Max（强）' },
  { id: 'qwen-long', label: 'Qwen Long（长文本）' },
  { id: 'qwen3-235b-a22b', label: 'Qwen3 235B', thinking: true },
  { id: 'qwen3-32b', label: 'Qwen3 32B', thinking: true },
  { id: 'qwq-plus', label: 'QwQ Plus（推理）', thinking: true },
  { id: 'deepseek-v3', label: 'DeepSeek V3（百炼直供）' },
  { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
  { id: 'deepseek-r1', label: 'DeepSeek R1（推理）', thinking: true },
];

const CATALOG_IDS = new Set(DASHSCOPE_MODEL_CATALOG.map((m) => m.id));

/** Fallback chain when the selected model is unavailable (quota / 404). */
export function dashscopeFallbackChain(preferred: string): string[] {
  const env = process.env.DASHSCOPE_MODELS?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
  const defaults = env.length > 0
    ? env
    : DASHSCOPE_MODEL_CATALOG.map((m) => m.id);
  return [...new Set([preferred, ...defaults].filter(Boolean))];
}

export function isKnownDashscopeModel(id: string): boolean {
  return CATALOG_IDS.has(id) || /^qwen|deepseek|qwq/i.test(id);
}

/**
 * `enable_thinking` is a Qwen/Bailian-specific switch. DeepSeek models routed
 * through DashScope (deepseek-v3 / v4-flash / r1) reject it (HTTP 400 during the
 * chain-of-thought), so the toggle must only be sent to qwen* / qwq* models.
 */
export function dashscopeAcceptsThinkingToggle(id: string): boolean {
  return /^qwen|^qwq/i.test(id.trim());
}

export function dashscopeModelMeta(id: string): DashScopeModelEntry | undefined {
  return DASHSCOPE_MODEL_CATALOG.find((m) => m.id === id);
}
