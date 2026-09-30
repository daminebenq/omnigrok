// Built-in agent tools: jarvis_exec + web_search stub

export interface Tool {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
}

export const BUILTIN_TOOLS: Tool[] = [
  {
    name: "jarvis_exec",
    description:
      "Execute a command or query on Jarvis OS (the user's personal OS at jarvis.damineweb.work). Use for file operations, system queries, running scripts, or any interaction with the user's personal environment.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "The command to execute on Jarvis OS" },
        context: { type: "string", description: "Optional context or explanation for the command" },
      },
      required: ["command"],
    },
  },
];

export async function executeJarvis(
  command: string,
  context: string | undefined,
  jarvisToken: string | undefined
): Promise<string> {
  if (!jarvisToken) return "Error: JARVIS_TOKEN not configured";
  try {
    const res = await fetch("https://jarvis.damineweb.work/api/exec", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jarvisToken}`,
      },
      body: JSON.stringify({ command, context }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return `Error: Jarvis returned ${res.status}`;
    const data = await res.json() as { output?: string; error?: string };
    return data.output ?? data.error ?? "No output";
  } catch (e: unknown) {
    return `Error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

export async function dispatchTool(
  name: string,
  args: Record<string, unknown>,
  env: { JARVIS_TOKEN?: string }
): Promise<string> {
  if (name === "jarvis_exec") {
    return executeJarvis(
      args.command as string,
      args.context as string | undefined,
      env.JARVIS_TOKEN
    );
  }
  return `Unknown tool: ${name}`;
}
