// Built-in agent tools.

import { browse } from "./browse";
import { McpClient, type McpAuth } from "./mcp";
import { listRecords, type BaseRecord } from "./resources";

export interface ToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, { type: string; description: string }>;
      required?: string[];
    };
  };
}

export interface ToolEnv {
  JARVIS_TOKEN?: string;
}

export const BUILTIN_TOOLS: ToolSchema[] = [
  {
    type: "function",
    function: {
      name: "jarvis_exec",
      description:
        "Execute a command or query on Jarvis OS, the user's personal operating environment at jarvis.damineweb.work. Use for file operations, system queries, running scripts, or any interaction with the user's own infrastructure.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "The command to execute on Jarvis OS" },
          context: { type: "string", description: "Why this command is being run" },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_browse",
      description:
        "Fetch a web page and return its readable text. Use to look something up or read documentation.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Absolute http(s) URL to fetch" },
        },
        required: ["url"],
      },
    },
  },
];

export const TOOL_NAMES = BUILTIN_TOOLS.map((t) => t.function.name);

// --- MCP integration ------------------------------------------------------

/** Provider tool names are constrained; keep them to a safe alphabet. */
function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24) || "srv";
}

const MCP_PREFIX = "mcp__";

export interface McpServerRecord extends BaseRecord {
  url?: string;
  enabled?: boolean;
  authToken?: string;
  accessClientId?: string;
  accessClientSecret?: string;
}

export interface Toolset {
  schemas: ToolSchema[];
  /** Maps a advertised tool name back to the server and real tool name. */
  mcpRoutes: Map<string, { url: string; auth: McpAuth; tool: string }>;
}

/**
 * Built-in tools plus the tools exposed by every enabled MCP server.
 * A server that is unreachable is skipped rather than failing the whole turn.
 */
export async function buildToolset(
  kv: KVNamespace,
  userId: string
): Promise<Toolset> {
  const schemas: ToolSchema[] = [...BUILTIN_TOOLS];
  const mcpRoutes = new Map<string, { url: string; auth: McpAuth; tool: string }>();

  let servers: McpServerRecord[] = [];
  try {
    servers = await listRecords<McpServerRecord>(kv, userId, "mcps");
  } catch {
    return { schemas, mcpRoutes };
  }

  const usable = servers.filter((s) => s.enabled !== false && s.url);
  const results = await Promise.allSettled(
    usable.map(async (srv) => {
      const auth: McpAuth = {
        authToken: srv.authToken,
        accessClientId: srv.accessClientId,
        accessClientSecret: srv.accessClientSecret,
      };
      const client = new McpClient(srv.url!, auth);
      return { srv, auth, tools: await client.listTools() };
    })
  );

  const seen = new Set(schemas.map((s) => s.function.name));
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    const { srv, auth, tools } = r.value;
    for (const t of tools) {
      let name = `${MCP_PREFIX}${slug(srv.name)}__${slug(t.name)}`.slice(0, 64);
      if (seen.has(name)) continue;
      seen.add(name);

      const params = (t.inputSchema as any) ?? { type: "object", properties: {} };
      schemas.push({
        type: "function",
        function: {
          name,
          description: `[${srv.name}] ${t.description ?? t.name}`,
          parameters: {
            type: "object",
            properties: params.properties ?? {},
            required: params.required,
          },
        },
      });
      mcpRoutes.set(name, { url: srv.url!, auth, tool: t.name });
    }
  }

  return { schemas, mcpRoutes };
}

async function executeJarvis(
  command: string,
  context: string | undefined,
  jarvisToken: string | undefined
): Promise<string> {
  if (!jarvisToken) {
    return "Error: Jarvis is not configured. Set the JARVIS_TOKEN secret on the worker.";
  }
  try {
    const res = await fetch("https://jarvis.damineweb.work/api/exec", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${jarvisToken}` },
      body: JSON.stringify({ command, context }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return `Error: Jarvis returned ${res.status}`;
    const data = (await res.json()) as { output?: string; error?: string };
    return data.output ?? data.error ?? "No output";
  } catch (e) {
    return `Error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

async function executeBrowse(url: string): Promise<string> {
  try {
    const result = await browse(url);
    const text = (result.text ?? "").slice(0, 8000);
    return `Status ${result.status} for ${result.finalUrl}\n\n${text}`;
  } catch (e) {
    return `Error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

export async function dispatchTool(
  name: string,
  args: Record<string, unknown>,
  env: ToolEnv,
  toolset?: Toolset
): Promise<string> {
  switch (name) {
    case "jarvis_exec":
      return executeJarvis(String(args.command ?? ""), args.context as string | undefined, env.JARVIS_TOKEN);
    case "web_browse":
      return executeBrowse(String(args.url ?? ""));
  }

  const route = toolset?.mcpRoutes.get(name);
  if (route) {
    try {
      return await new McpClient(route.url, route.auth).callTool(route.tool, args);
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : "MCP call failed"}`;
    }
  }

  return `Unknown tool: ${name}`;
}
