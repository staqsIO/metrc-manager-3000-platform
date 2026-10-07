// LLM calls for the Copilot. Provider selection lives in src/services/llm (configured by super admins).
import { resolveLlm } from '@/services/llm/registry';
import { chatCompletion } from '@/services/llm/chat';
import { LlmNotConfiguredError, type ChatOptions, type ResolvedLlm } from '@/services/llm/types';

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    /**
     * Per-tool char budget for prefetched results. Numeric/aggregate tools
     * the user reads off the dashboard get more headroom (12,000); free-text
     * tools that just summarize a list keep the default (4,000) and emit
     * `truncated: true` + `totalRows` when cut. See parity plan AD3.
     */
    truncationBudget?: number;
  };
}

export interface CallLLMOptions extends ChatOptions {
  /**
   * A provider already resolved for this request. Pass it whenever a decision (e.g. whether to
   * anonymize) was made from it, so the call can't land on a different provider.
   */
  llm?: ResolvedLlm;
  /** Model to resolve when `llm` is not given. */
  model?: string;
}

export async function callLLM(
  messages: ChatMessage[],
  tools?: ToolDefinition[],
  options?: CallLLMOptions,
): Promise<ChatMessage> {
  const llm = options?.llm ?? (await resolveLlm(options?.model));
  if (!llm) throw new LlmNotConfiguredError();
  // Forward only ChatOptions — the model is carried by the resolved llm.
  const chatOptions: ChatOptions = {};
  if (options?.temperature !== undefined) chatOptions.temperature = options.temperature;
  if (options?.maxTokens !== undefined) chatOptions.maxTokens = options.maxTokens;
  if (options?.jsonResponse !== undefined) chatOptions.jsonResponse = options.jsonResponse;
  if (options?.timeoutMs !== undefined) chatOptions.timeoutMs = options.timeoutMs;
  if (options?.onUsage !== undefined) chatOptions.onUsage = options.onUsage;
  return chatCompletion(llm, messages, tools, chatOptions);
}

// ---------------------------------------------------------------------------
// Tool-use loop
// ---------------------------------------------------------------------------

export interface ToolCallEvent {
  tool: string;
  status: 'start' | 'end';
}

// Audit transcript types are defined in `anonymizer.ts` (client-safe, single
// source of truth). Re-exported here for ergonomic server-side imports.
export type { AnonymizationAuditEntry, AnonymizationAudit, AnonymizerMapping } from './anonymizer';
import type { AnonymizationAudit, AnonymizationAuditEntry, AnonymizerMapping } from './anonymizer';

export interface AnonymizerLike {
  anonymize: (text: string) => string;
  deanonymize: (text: string) => string;
  getMappings?: () => AnonymizerMapping[];
}

// Audit caps — prevent OOM and oversized SSE events when audit mode is on
// during heavy tool loops (e.g., 8 iterations × multiple retries).
const AUDIT_MAX_ENTRY_CHARS = 32_000;
const AUDIT_MAX_ENTRIES = 60;
const AUDIT_MAX_MAPPINGS = 300;
const AUDIT_MAX_TOTAL_BYTES = 800_000; // safe under typical proxy buffers (~1MB)

export async function runToolLoop(
  messages: ChatMessage[],
  tools: ToolDefinition[],
  executeTool: (name: string, args: Record<string, unknown>) => Promise<string>,
  maxIterations: number = 5,
  onToolCall: ((event: ToolCallEvent) => void) | undefined,
  /** Resolved once by the caller; every iteration uses this provider (see callLLM). */
  llm: ResolvedLlm,
  anonymizer?: AnonymizerLike,
  captureAudit: boolean = false,
): Promise<{ content: string; toolsUsed: string[]; audit?: AnonymizationAudit; toolResults?: Record<string, unknown> }> {
  const auditEntries: AnonymizationAuditEntry[] = [];
  let auditDroppedCount = 0;
  // Captures parsed tool result JSON (deanonymized — pre-anonymize call) keyed
  // by tool name. Phase 2c-B: lets the artifact canvas render structured tool
  // output (interactive tables) instead of re-parsing markdown after the fact.
  // Last call for a given tool wins — that's the data the LLM grounded its
  // final narrative on.
  const toolResults: Record<string, unknown> = {};
  const captureToolResult = (toolName: string, rawResult: string) => {
    try {
      toolResults[toolName] = JSON.parse(rawResult);
    } catch {
      // Non-JSON tool result (rare) — store the raw string so callers can
      // still see what the LLM saw, just untyped.
      toolResults[toolName] = rawResult;
    }
  };
  const recordAudit = (source: string, sentToLLM: string, shownToUser?: string) => {
    if (!captureAudit) return;
    if (auditEntries.length >= AUDIT_MAX_ENTRIES) {
      auditDroppedCount++;
      return;
    }
    const truncated = sentToLLM.length > AUDIT_MAX_ENTRY_CHARS
      ? sentToLLM.slice(0, AUDIT_MAX_ENTRY_CHARS) + `\n…[truncated ${(sentToLLM.length - AUDIT_MAX_ENTRY_CHARS).toLocaleString()} chars]`
      : sentToLLM;
    auditEntries.push({ source, sentToLLM: truncated, shownToUser });
  };
  const buildAudit = (): AnonymizationAudit | undefined => {
    if (!captureAudit || !anonymizer || !anonymizer.getMappings) return undefined;
    let mappings = anonymizer.getMappings();
    if (mappings.length > AUDIT_MAX_MAPPINGS) {
      mappings = mappings.slice(0, AUDIT_MAX_MAPPINGS);
    }
    let entries = auditEntries;
    if (auditDroppedCount > 0) {
      entries = [...entries, { source: 'audit_truncation_notice', sentToLLM: `[${auditDroppedCount} additional payload(s) omitted — audit cap is ${AUDIT_MAX_ENTRIES} entries]` }];
    }
    const audit: AnonymizationAudit = { mappings, entries };
    // Final size guard — if still too large, drop the entries (keep mappings)
    try {
      const size = JSON.stringify(audit).length;
      if (size > AUDIT_MAX_TOTAL_BYTES) {
        return {
          mappings,
          entries: [{ source: 'audit_truncation_notice', sentToLLM: `[Audit payload exceeded ${AUDIT_MAX_TOTAL_BYTES.toLocaleString()} byte cap — ${entries.length} entries, ${size.toLocaleString()} bytes — entries dropped, mapping retained]` }],
        };
      }
    } catch {
      return undefined;
    }
    return audit;
  };
  // Anonymize the initial messages (system prompt contains facility name + license)
  const conversationMessages = anonymizer
    ? messages.map(m => ({ ...m, content: typeof m.content === 'string' ? anonymizer.anonymize(m.content) : m.content }))
    : [...messages];
  if (captureAudit && anonymizer) {
    for (const m of conversationMessages) {
      if (typeof m.content === 'string') {
        recordAudit(m.role === 'system' ? 'system_prompt' : `${m.role}_message`, m.content);
      }
    }
  }
  const toolsUsed: string[] = [];

  for (let i = 0; i < maxIterations; i++) {
    onToolCall?.({ tool: '_thinking', status: 'start' });
    const response = await callLLM(conversationMessages, tools, { llm });
    onToolCall?.({ tool: '_thinking', status: 'end' });

    // If the model responded with text (no tool calls), we're done
    if (!response.tool_calls || response.tool_calls.length === 0) {
      const content = response.content || 'I was unable to generate a response. Please try again.';
      const final = anonymizer ? anonymizer.deanonymize(content) : content;
      recordAudit('final_response', content, final);
      return {
        content: final,
        toolsUsed,
        ...((): { audit?: AnonymizationAudit; toolResults?: Record<string, unknown> } => {
          const a = buildAudit();
          const out: { audit?: AnonymizationAudit; toolResults?: Record<string, unknown> } = {};
          if (a) out.audit = a;
          if (Object.keys(toolResults).length > 0) out.toolResults = toolResults;
          return out;
        })(),
      };
    }

    // Add the assistant's tool_calls message to conversation
    conversationMessages.push(response);

    // Execute each tool call and add results
    for (const toolCall of response.tool_calls) {
      const toolName = toolCall.function.name;
      toolsUsed.push(toolName);

      onToolCall?.({ tool: toolName, status: 'start' });

      let result: string;
      try {
        const args = JSON.parse(toolCall.function.arguments);
        result = await executeTool(toolName, args);
      } catch (err) {
        result = JSON.stringify({
          error: err instanceof Error ? err.message : 'Tool execution failed',
        });
      }

      onToolCall?.({ tool: toolName, status: 'end' });

      // Capture the deanonymized JSON (what the user-side will see) BEFORE the
      // anonymizer rewrites identifiers for the LLM. The artifact canvas
      // renders this directly, so the user sees real Metrc tags / facility
      // names in the structured table.
      captureToolResult(toolName, result);
      const sentResult = anonymizer ? anonymizer.anonymize(result) : result;
      conversationMessages.push({
        role: 'tool',
        content: sentResult,
        tool_call_id: toolCall.id,
        name: toolName,
      });
      recordAudit(`tool_result:${toolName}`, sentResult);
    }
  }

  // If we exhausted iterations, make one final call without tools to get a summary.
  // Use higher max_tokens and retry once if content is null.
  // Prepend a warning so the model knows this is partial data.
  conversationMessages.push({
    role: 'system',
    content: 'WARNING: The tool-use loop reached its maximum iterations. The data collected so far may be incomplete — some tool calls may have failed or returned partial results. When summarizing, clearly state which data you have and which you do not. NEVER fabricate numbers to fill gaps. If a breakdown is incomplete, say so.',
  });
  onToolCall?.({ tool: '_thinking', status: 'start' });
  let finalContent: string | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const finalResponse = await callLLM(conversationMessages, undefined, {
        llm,
        maxTokens: 4096,
      });
      if (finalResponse.content) {
        finalContent = finalResponse.content;
        break;
      }
      console.warn(`[COPILOT] Final summarization call returned null content (attempt ${attempt + 1}/2, ${toolsUsed.length} tools used)`);
    } catch (err) {
      console.error(`[COPILOT] Final summarization call failed (attempt ${attempt + 1}/2):`, err instanceof Error ? err.message : err);
    }
  }
  onToolCall?.({ tool: '_thinking', status: 'end' });

  if (!finalContent) {
    // Build a best-effort summary from the tool results already in the conversation
    const toolResults = conversationMessages
      .filter(m => m.role === 'tool' && m.content)
      .slice(-3);
    if (toolResults.length > 0) {
      finalContent = `I gathered data from ${toolsUsed.length} tools but had trouble summarizing. Here are the key results:\n\n` +
        toolResults.map(m => {
          try {
            const parsed = JSON.parse(m.content!);
            return `**${m.name}**: ${JSON.stringify(parsed).slice(0, 500)}`;
          } catch {
            return `**${m.name}**: ${(m.content ?? '').slice(0, 500)}`;
          }
        }).join('\n\n');
    }
  }

  const content = finalContent || 'Analysis complete but I could not summarize the results. Please try again or ask a more specific question.';
  const final = anonymizer ? anonymizer.deanonymize(content) : content;
  recordAudit('final_response', content, final);
  return {
    content: final,
    toolsUsed,
    ...((): { audit?: AnonymizationAudit; toolResults?: Record<string, unknown> } => {
      const a = buildAudit();
      const out: { audit?: AnonymizationAudit; toolResults?: Record<string, unknown> } = {};
      if (a) out.audit = a;
      if (Object.keys(toolResults).length > 0) out.toolResults = toolResults;
      return out;
    })(),
  };
}
