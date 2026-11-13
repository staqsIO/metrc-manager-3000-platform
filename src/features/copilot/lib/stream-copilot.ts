import type { AnonymizationAudit } from '@/services/copilot/anonymizer';
import { ownKeyHeaders } from './demo-key';

/**
 * SSE client for the Copilot chat endpoint. Decodes `event: <type>` /
 * `data: <json>` frames into typed events. The `eventType` variable is
 * hoisted across reads — a single SSE event can span multiple TCP chunks
 * when the data line is large (e.g. >64KB audit payloads); resetting the
 * header per read silently drops the data line on the next chunk and
 * surfaces as "Stream ended without a complete event" client errors.
 */
export async function streamCopilotChat(
  facilityId: string | null,
  message: string,
  history: { role: string; content: string }[],
  onToolEvent: (event: { tool: string; status: 'start' | 'end' }) => void,
  signal?: AbortSignal,
  model?: string,
  skillId?: string,
  captureAudit?: boolean,
  conversationId?: string | null,
  onConversation?: (id: string, created: boolean) => void,
): Promise<{ content: string; toolsUsed: string[]; audit?: AnonymizationAudit; conversationId?: string; runId?: string; artifactId?: string }> {
  const res = await fetch('/api/copilot/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...ownKeyHeaders() },
    body: JSON.stringify({
      ...(facilityId ? { facilityId } : {}),
      message,
      history,
      model: model || undefined,
      ...(skillId ? { skillId } : {}),
      ...(captureAudit ? { captureAudit: true } : {}),
      ...(conversationId ? { conversationId } : {}),
    }),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => 'Unknown error');
    throw new Error(text || `HTTP ${res.status}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response stream');

  const decoder = new TextDecoder();
  let buffer = '';
  let result: { content: string; toolsUsed: string[]; audit?: AnonymizationAudit; conversationId?: string; runId?: string; artifactId?: string } | null = null;
  let eventType = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          eventType = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          const dataStr = line.slice(6);
          try {
            const data = JSON.parse(dataStr);
            if (eventType === 'tool') {
              onToolEvent(data as { tool: string; status: 'start' | 'end' });
            } else if (eventType === 'conversation') {
              const c = data as { id: string; created: boolean };
              onConversation?.(c.id, c.created);
            } else if (eventType === 'complete') {
              result = data as { content: string; toolsUsed: string[]; audit?: AnonymizationAudit; conversationId?: string; runId?: string; artifactId?: string };
            } else if (eventType === 'error') {
              throw new Error(data.message || 'Server error');
            }
          } catch (e) {
            if (e instanceof SyntaxError) {
              // skip malformed JSON
            } else {
              throw e;
            }
          }
          eventType = '';
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (!result) throw new Error('Stream ended without a complete event');
  return result;
}
