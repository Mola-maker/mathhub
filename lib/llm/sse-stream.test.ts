import { describe, it, expect } from 'vitest';
import { makeSseStream } from './sse-stream';

async function readAll(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let out = '';
  for (;;) { const { done, value } = await reader.read(); if (done) break; out += dec.decode(value, { stream: true }); }
  return out;
}

describe('makeSseStream', () => {
  it('token 帧 + 事件帧 + [DONE] 依次写出', async () => {
    const res = makeSseStream(async (send, sendEvent) => {
      send('你好');
      sendEvent({ tikzCode: '\\draw (0,0);' });
    });
    const text = await readAll(res);
    expect(text).toBe('data: {"token":"你好"}\n\ndata: {"tikzCode":"\\\\draw (0,0);"}\n\ndata: [DONE]\n\n');
  });

  it('gen 抛错时发出 {error} 帧后正常结束', async () => {
    const res = makeSseStream(async () => { throw new Error('boom'); });
    const text = await readAll(res);
    expect(text).toContain('"error":"boom"');
    expect(text).toContain('[DONE]');
  });
});
