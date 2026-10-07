// MCP (Model Context Protocol) client for connecting to external MCP servers
// Speaks JSON-RPC over HTTP — no SDK needed.

import type { ToolDefinition } from './openrouter-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MCPServer {
  name: string;    // e.g. "metrc-api", "metrc-docs"
  url: string;     // JSON-RPC endpoint URL
  prefix: string;  // tool name prefix, e.g. "mcp__" or "docs__"
  apiKey?: string;  // optional auth token
  enabled: boolean;
}

interface MCPToolSchema {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface MCPToolsListResponse {
  result?: { tools?: MCPToolSchema[] };
  error?: { code?: number; message?: string };
}

interface MCPToolCallResponse {
  result?: { content?: { type: string; text?: string }[] };
  error?: { code?: number; message?: string };
}

interface ToolCache {
  tools: ToolDefinition[];
  raw: MCPToolSchema[];
  cachedAt: number;
}

// ---------------------------------------------------------------------------
// Configuration from env vars
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getConfiguredServers(): MCPServer[] {
  const servers: MCPServer[] = [];

  const metrcMcpUrl = process.env.METRC_MCP_URL;
  if (metrcMcpUrl) {
    servers.push({
      name: 'metrc-api',
      url: metrcMcpUrl,
      prefix: 'mcp__',
      apiKey: process.env.METRC_MCP_API_KEY,
      enabled: true,
    });
  }

  const docsMcpUrl = process.env.METRC_DOCS_MCP_URL;
  if (docsMcpUrl) {
    servers.push({
      name: 'metrc-docs',
      url: docsMcpUrl,
      prefix: 'docs__',
      apiKey: process.env.METRC_DOCS_MCP_API_KEY,
      enabled: true,
    });
  }

  return servers;
}

// ---------------------------------------------------------------------------
// Per-server tool cache
// ---------------------------------------------------------------------------

const toolCaches = new Map<string, ToolCache>();
let rpcId = 0;

async function jsonRpc(url: string, method: string, params?: Record<string, unknown>, apiKey?: string): Promise<unknown> {
  const body: Record<string, unknown> = {
    jsonrpc: '2.0',
    id: ++rpcId,
    method,
  };
  if (params) body.params = params;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => 'unknown');
    throw new Error(`MCP server returned ${res.status}: ${text}`);
  }

  return res.json();
}

function convertToToolDefinitions(tools: MCPToolSchema[], prefix: string): ToolDefinition[] {
  return tools.map(t => ({
    type: 'function' as const,
    function: {
      name: prefix + t.name,
      description: t.description || t.name,
      parameters: t.inputSchema || { type: 'object', properties: {}, required: [] },
    },
  }));
}

async function fetchToolsForServer(server: MCPServer): Promise<{ tools: ToolDefinition[]; raw: MCPToolSchema[] }> {
  const data = (await jsonRpc(server.url, 'tools/list', undefined, server.apiKey)) as MCPToolsListResponse;

  if (data.error) {
    throw new Error(`MCP tools/list error: ${data.error.message || JSON.stringify(data.error)}`);
  }

  const rawTools = data.result?.tools || [];
  const tools = convertToToolDefinitions(rawTools, server.prefix);
  return { tools, raw: rawTools };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get tool definitions from all configured and reachable MCP servers.
 * Results are cached with a 5-minute TTL per server.
 */
export async function getMCPToolDefinitions(): Promise<ToolDefinition[]> {
  const servers = getConfiguredServers();
  if (servers.length === 0) return [];

  const now = Date.now();

  const settled = await Promise.allSettled(
    servers.map(async (server): Promise<ToolDefinition[]> => {
      const cached = toolCaches.get(server.name);
      if (cached && now - cached.cachedAt < CACHE_TTL_MS) {
        return cached.tools;
      }

      try {
        const { tools, raw } = await fetchToolsForServer(server);
        toolCaches.set(server.name, { tools, raw, cachedAt: now });
        return tools;
      } catch (err) {
        console.warn(
          `[MCP] Failed to fetch tools from ${server.name} (${server.url}): ${err instanceof Error ? err.message : err}`,
        );
        // Use stale cache if available
        return cached ? cached.tools : [];
      }
    }),
  );

  return settled.flatMap(r => r.status === 'fulfilled' ? r.value : []);
}

/**
 * Call an MCP tool by its prefixed name. Routes to the correct server.
 * Auto-injects `license_number` for metrc-api tools when provided.
 */
export async function callMCPTool(
  prefixedName: string,
  args: Record<string, unknown>,
  licenseNumber?: string,
): Promise<string> {
  const servers = getConfiguredServers();

  // Find the server whose prefix matches
  const server = servers.find(s => prefixedName.startsWith(s.prefix));
  if (!server) {
    console.warn(`[MCP] No server found for tool: ${prefixedName}`);
    return JSON.stringify({ error: `No MCP server found for tool: ${prefixedName}` });
  }

  // Strip prefix to get the raw tool name
  const rawName = prefixedName.slice(server.prefix.length);

  // Auto-inject license_number for metrc-api tools
  const finalArgs = { ...args };
  if (server.name === 'metrc-api' && licenseNumber && !finalArgs.license_number) {
    finalArgs.license_number = licenseNumber;
  }

  try {
    const data = (await jsonRpc(server.url, 'tools/call', {
      name: rawName,
      arguments: finalArgs,
    }, server.apiKey)) as MCPToolCallResponse;

    if (data.error) {
      return JSON.stringify({ error: data.error.message || 'MCP tool call failed' });
    }

    // Extract text content from MCP response
    const contents = data.result?.content || [];
    const textParts = contents
      .filter(c => c.type === 'text' && c.text)
      .map(c => c.text!);

    if (textParts.length === 0) {
      return JSON.stringify({ result: 'Tool executed successfully (no output)' });
    }

    return textParts.join('\n');
  } catch (err) {
    return JSON.stringify({
      error: `MCP tool call failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

/**
 * Check if a tool name belongs to an MCP server (has a known prefix).
 */
export function isMCPTool(name: string): boolean {
  return getConfiguredServers().some(s => name.startsWith(s.prefix));
}

/**
 * Returns info about configured MCP servers and their tools (for the frontend).
 */
export async function getMCPServersInfo(): Promise<{
  servers: { name: string; prefix: string; toolCount: number; tools: { name: string; description: string }[] }[];
}> {
  const servers = getConfiguredServers();
  if (servers.length === 0) return { servers: [] };

  const allDefs = await getMCPToolDefinitions();

  return {
    servers: servers.map(server => {
      const serverTools = allDefs
        .filter(d => d.function.name.startsWith(server.prefix))
        .map(d => ({
          name: d.function.name,
          description: d.function.description,
        }));
      return {
        name: server.name,
        prefix: server.prefix,
        toolCount: serverTools.length,
        tools: serverTools,
      };
    }),
  };
}
