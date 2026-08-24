import { describe, expect, it } from 'vitest';
import { readBoundedJson } from './read-bounded-json';

describe('readBoundedJson', () => {
  it('reads a chunked JSON body within the byte budget', async () => {
    const encoder = new TextEncoder();
    const request = new Request('http://localhost/test', {
      method: 'POST',
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('{"code":"'));
          controller.enqueue(encoder.encode('\\\\draw;"}'));
          controller.close();
        },
      }),
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });

    await expect(readBoundedJson(request, 128)).resolves.toEqual({
      code: '\\draw;',
    });
  });

  it('rejects a declared oversized body before consuming it', async () => {
    const request = new Request('http://localhost/test', {
      method: 'POST',
      headers: { 'Content-Length': '1024' },
      body: '{}',
    });
    await expect(readBoundedJson(request, 16)).rejects.toMatchObject({
      status: 413,
      code: 'BODY_TOO_LARGE',
    });
  });

  it('rejects a chunked body as soon as it exceeds the byte budget', async () => {
    const request = new Request('http://localhost/test', {
      method: 'POST',
      body: JSON.stringify({ code: 'x'.repeat(64) }),
    });
    await expect(readBoundedJson(request, 16)).rejects.toMatchObject({
      status: 413,
      code: 'BODY_TOO_LARGE',
    });
  });
});
