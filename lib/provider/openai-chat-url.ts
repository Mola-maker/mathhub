/** Resolve OpenAI-compatible `…/v1/chat/completions` from a provider base URL. */
export function chatCompletionsUrl(baseUrl: string): string {
  let b = (baseUrl || '').trim().replace(/\/+$/, '');
  b = b.replace(/\/chat\/completions$/, '');
  if (!/\/v1$/.test(b)) b = `${b}/v1`;
  return `${b}/chat/completions`;
}
