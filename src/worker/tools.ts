// Built-in agent tools.

import { browse } from "./browse";
import { McpClient, type McpAuth } from "./mcp";
import { listRecords, type BaseRecord } from "./resources";
import {
  deviceExec, deviceList, deviceRead, deviceWrite, deviceHealth,
  type DeviceRecord,
} from "./devices";

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
  OMNIGROK_KV?: KVNamespace;
  /** Set per run so device tools can resolve a device by name. */
  __userId?: string;
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

const DEVICE_TOOLS: ToolSchema[] = [
  {
    type: "function",
    function: {
      name: "device_list",
      description:
        "List the machines connected to OmniGrok (the user's Mac, VMs, VPSs, homelab hosts) with their status, OS and available disk roots. Call this first to learn which device names are valid.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "device_exec",
      description:
        "Run a shell command on one of the user's machines. Use device_list first to get valid device names.",
      parameters: {
        type: "object",
        properties: {
          device: { type: "string", description: "Device name from device_list" },
          command: { type: "string", description: "Shell command to run" },
          cwd: { type: "string", description: "Working directory (optional)" },
        },
        required: ["device", "command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "device_read_dir",
      description: "List a directory on one of the user's machines.",
      parameters: {
        type: "object",
        properties: {
          device: { type: "string", description: "Device name" },
          path: { type: "string", description: "Absolute directory path" },
        },
        required: ["device", "path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "device_read_file",
      description: "Read a text file from one of the user's machines.",
      parameters: {
        type: "object",
        properties: {
          device: { type: "string", description: "Device name" },
          path: { type: "string", description: "Absolute file path" },
        },
        required: ["device", "path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "device_write_file",
      description: "Write a text file on one of the user's machines. Overwrites the file.",
      parameters: {
        type: "object",
        properties: {
          device: { type: "string", description: "Device name" },
          path: { type: "string", description: "Absolute file path" },
          content: { type: "string", description: "Full file contents" },
        },
        required: ["device", "path", "content"],
      },
    },
  },
];

async function loadDevices(env: ToolEnv): Promise<DeviceRecord[]> {
  if (!env.OMNIGROK_KV || !env.__userId) return [];
  try {
    const rows = await listRecords<DeviceRecord>(env.OMNIGROK_KV, env.__userId, "devices");
    return rows.filter((d) => d.enabled !== false && d.url);
  } catch {
    return [];
  }
}

function findDevice(devices: DeviceRecord[], name: unknown): DeviceRecord | undefined {
  const wanted = String(name ?? "").trim().toLowerCase();
  return devices.find((d) => d.name.toLowerCase() === wanted);
}

async function runDeviceTool(
  name: string,
  args: Record<string, unknown>,
  env: ToolEnv
): Promise<string> {
  const devices = await loadDevices(env);
  if (!devices.length) {
    return "Error: no devices are connected. Add one in the Devices panel first.";
  }

  if (name === "device_list") {
    const health = await Promise.all(
      devices.map(async (d) => ({ d, h: await deviceHealth(d) }))
    );
    return health
      .map(({ d, h }) =>
        h.ok
          ? `${d.name}: ${h.platform} ${h.release ?? ""} (${h.arch}), ${h.cpuCount} cpu, ` +
            `${h.memUsedPct}% memory used, roots: ${(h.roots ?? []).join(", ")}` +
            `${d.readOnly || h.readOnly ? " [read-only]" : ""}`
          : `${d.name}: unreachable (${h.error})`
      )
      .join("\n");
  }

  const device = findDevice(devices, args.device);
  if (!device) {
    return `Error: unknown device "${String(args.device)}". Known devices: ${devices.map((d) => d.name).join(", ")}`;
  }

  try {
    switch (name) {
      case "device_exec": {
        const r = await deviceExec(device, String(args.command ?? ""), args.cwd as string | undefined);
        const parts = [`exit ${r.exitCode}${r.timedOut ? " (timed out)" : ""}`];
        if (r.stdout.trim()) parts.push(`stdout:\n${r.stdout.trim()}`);
        if (r.stderr.trim()) parts.push(`stderr:\n${r.stderr.trim()}`);
        return parts.join("\n\n").slice(0, 12_000);
      }
      case "device_read_dir": {
        const r = await deviceList(device, String(args.path ?? ""));
        return `${r.path}\n` + r.entries
          .map((e) => `${e.dir ? "d" : "-"} ${e.name}${e.dir ? "/" : ` (${e.size} bytes)`}`)
          .join("\n").slice(0, 12_000);
      }
      case "device_read_file": {
        const r = await deviceRead(device, String(args.path ?? ""));
        return r.content.slice(0, 12_000);
      }
      case "device_write_file": {
        const r = await deviceWrite(device, String(args.path ?? ""), String(args.content ?? ""));
        return `Wrote ${r.path}`;
      }
    }
  } catch (e) {
    return `Error: ${e instanceof Error ? e.message : "device call failed"}`;
  }
  return `Unknown device tool: ${name}`;
}

const DEVICE_TOOL_NAMES = new Set(DEVICE_TOOLS.map((t) => t.function.name));

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
  const schemas: ToolSchema[] = [...BUILTIN_TOOLS, ...DEVICE_TOOLS];
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

  if (DEVICE_TOOL_NAMES.has(name)) return runDeviceTool(name, args, env);

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
