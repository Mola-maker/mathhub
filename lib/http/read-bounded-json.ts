export class BoundedJsonError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 413,
    readonly code: 'INVALID_JSON' | 'BODY_TOO_LARGE',
  ) {
    super(message);
    this.name = 'BoundedJsonError';
  }
}

export async function readBoundedJson(
  request: Request,
  maxBytes: number,
): Promise<unknown> {
  const declaredLength = Number(request.headers.get('Content-Length'));
  if (
    Number.isFinite(declaredLength)
    && declaredLength >= 0
    && declaredLength > maxBytes
  ) {
    throw new BoundedJsonError(
      `Request body exceeds ${maxBytes} byte limit`,
      413,
      'BODY_TOO_LARGE',
    );
  }

  if (!request.body) {
    throw new BoundedJsonError('Request body is not valid JSON', 400, 'INVALID_JSON');
  }
  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let total = 0;
  let text = '';
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new BoundedJsonError(
          `Request body exceeds ${maxBytes} byte limit`,
          413,
          'BODY_TOO_LARGE',
        );
      }
      text += decoder.decode(result.value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    if (error instanceof BoundedJsonError) throw error;
    throw new BoundedJsonError('Request body is not valid UTF-8 JSON', 400, 'INVALID_JSON');
  } finally {
    reader.releaseLock();
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new BoundedJsonError('Request body is not valid JSON', 400, 'INVALID_JSON');
  }
}
