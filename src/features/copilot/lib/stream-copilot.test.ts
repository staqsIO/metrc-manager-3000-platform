import { describe, it, expect, beforeEach, vi } from 'vitest';
import { streamCopilotChat } from './stream-copilot';

/**
 * Build a Response whose body emits the given chunks in order, simulating
 * how the real SSE response arrives across multiple TCP reads. Used to
 * regression-test the hoisted-eventType chunk-split fix.
 */
function makeStreamingResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  let i = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[i++]));
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

describe('streamCopilotChat', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('parses a single-chunk complete event', async () => {
    const completePayload = JSON.stringify({ content: 'hello', toolsUsed: ['t'] });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      makeStreamingResponse([
        `event: complete\ndata: ${completePayload}\n\n`,
      ]),
    );
    const result = await streamCopilotChat(null, 'msg', [], () => {});
    expect(result.content).toBe('hello');
    expect(result.toolsUsed).toEqual(['t']);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('preserves eventType across TCP chunk boundaries (the bug we just fixed)', async () => {
    // Build a payload large enough that real TCP would split it across reads,
    // and force the split between `event: complete\n` and the data: line.
    const big = 'x'.repeat(80_000);
    const completePayload = JSON.stringify({ content: big, toolsUsed: [] });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      makeStreamingResponse([
        // Chunk 1 ends mid-frame after `event: complete\n` — chunk 2 carries
        // only the `data: ...\n\n` line. Without the hoisted eventType the
        // second chunk would be parsed with eventType='' and the complete
        // event would silently disappear.
        `event: complete\n`,
        `data: ${completePayload}\n\n`,
      ]),
    );
    const result = await streamCopilotChat(null, 'msg', [], () => {});
    expect(result.content.length).toBe(80_000);
  });

  it('handles a payload split mid-data-line (audit-mode style)', async () => {
    const completePayload = JSON.stringify({
      content: 'ok',
      toolsUsed: [],
      audit: { mappings: [], entries: [{ source: 'system_prompt', sentToLLM: 'A'.repeat(70_000) }] },
    });
    const splitAt = 50_000;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      makeStreamingResponse([
        `event: complete\ndata: ${completePayload.slice(0, splitAt)}`,
        `${completePayload.slice(splitAt)}\n\n`,
      ]),
    );
    const result = await streamCopilotChat(null, 'msg', [], () => {});
    expect(result.content).toBe('ok');
    expect(result.audit?.entries[0].sentToLLM.length).toBe(70_000);
  });

  it('emits tool events through onToolEvent and finishes on complete', async () => {
    const events: Array<{ tool: string; status: 'start' | 'end' }> = [];
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      makeStreamingResponse([
        `event: tool\ndata: ${JSON.stringify({ tool: 'analyze_aging', status: 'start' })}\n\n`,
        `event: tool\ndata: ${JSON.stringify({ tool: 'analyze_aging', status: 'end' })}\n\n`,
        `event: complete\ndata: ${JSON.stringify({ content: 'done', toolsUsed: ['analyze_aging'] })}\n\n`,
      ]),
    );
    const result = await streamCopilotChat(null, 'msg', [], (e) => events.push(e));
    expect(events).toEqual([
      { tool: 'analyze_aging', status: 'start' },
      { tool: 'analyze_aging', status: 'end' },
    ]);
    expect(result.toolsUsed).toEqual(['analyze_aging']);
  });

  it('throws Server error on event:error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      makeStreamingResponse([
        `event: error\ndata: ${JSON.stringify({ message: 'boom' })}\n\n`,
      ]),
    );
    await expect(streamCopilotChat(null, 'msg', [], () => {})).rejects.toThrow('boom');
  });

  it('throws "Stream ended without a complete event" if no complete arrived', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      makeStreamingResponse([
        `event: tool\ndata: ${JSON.stringify({ tool: 'x', status: 'start' })}\n\n`,
      ]),
    );
    await expect(streamCopilotChat(null, 'msg', [], () => {})).rejects.toThrow(/Stream ended/);
  });

  it('forwards captureAudit flag in the request body', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      makeStreamingResponse([
        `event: complete\ndata: ${JSON.stringify({ content: 'ok', toolsUsed: [] })}\n\n`,
      ]),
    );
    await streamCopilotChat(null, 'msg', [], () => {}, undefined, undefined, undefined, true);
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.captureAudit).toBe(true);
  });
});
