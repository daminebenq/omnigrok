// Built-in agent tools.

import { browse } from "./browse";

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
  env: ToolEnv
): Promise<string> {
  switch (name) {
    case "jarvis_exec":
      return executeJarvis(String(args.command ?? ""), args.context as string | undefined, env.JARVIS_TOKEN);
    case "web_browse":
      return executeBrowse(String(args.url ?? ""));
    default:
      return `Unknown tool: ${name}`;
  }
}
