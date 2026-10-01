// Minimal MCP client over the Streamable HTTP transport.
//
// Enough of the protocol to discover a server's tools and call them:
// initialize -> notifications/initialized -> tools/list -> tools/call.
//
// Servers fronted by Cloudflare Access need a service token, not a bearer
// token, so both are supported. A browser OTP login cannot be replayed from a
// worker, which is why an Access-gated server without a service token fails
// with a clear message rather than a confusing redirect.

export interface McpAuth {
  authToken?: string;
  accessClientId?: string;
  accessClientSecret?: string;
}

export interface McpToolDef {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number | string;
  result?: any;
  error?: { code: number; message: string };
}

import { assertBrowsableUrl } from "./browse";

const PROTOCOL_VERSION = "2025-06-18";
const TIMEOUT_MS = 30_000;

function headersFor(auth: McpAuth, sessionId?: string): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    // Streamable HTTP servers may answer with either, so accept both.
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": PROTOCOL_VERSION,
  };
  if (auth.authToken) h.Authorization = `Bearer ${auth.authToken}`;
  if (auth.accessClientId && auth.accessClientSecret) {
    h["CF-Access-Client-Id"] = auth.accessClientId;
    h["CF-Access-Client-Secret"] = auth.accessClientSecret;
  }
  if (sessionId) h["Mcp-Session-Id"] = sessionId;
  return h;
}

/** Streamable HTTP replies can be a JSON body or an SSE stream of frames. */
async function parseRpc(res: Response): Promise<JsonRpcResponse | null> {
  const type = res.headers.get("content-type") ?? "";
  const body = await res.text();

  if (type.includes("text/event-stream")) {
    for (const line of body.split("\n")) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const payload = t.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const parsed = JSON.parse(payload) as JsonRpcResponse;
        // Skip server-initiated notifications; we want the response.
        if (parsed.result !== undefined || parsed.error !== undefined) return parsed;
      } catch {
        /* keep scanning */
      }
    }
    return null;
  }

  if (!body.trim()) return null;
  try {
    return JSON.parse(body) as JsonRpcResponse;
  } catch {
    return null;
  }
}

export class McpClient {
  private sessionId?: string;
  private initialized = false;
  private nextId = 1;

  constructor(
    private url: string,
    private auth: McpAuth = {}
  ) {
    // Same SSRF guard as the browser panel: an MCP server URL is user-supplied
    // and fetched server-side, so reject loopback/link-local/metadata targets
    // before any request. Throws on an invalid or blocked URL.
    assertBrowsableUrl(url);
  }

  private async call(method: string, params?: unknown, notify = false): Promise<any> {
    const id = notify ? undefined : this.nextId++;
    const res = await fetch(this.url, {
      method: "POST",
      headers: headersFor(this.auth, this.sessionId),
      body: JSON.stringify(notify ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id, method, params }),
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    // Access answers unauthenticated calls with a redirect to its login page.
    if (res.status >= 300 && res.status < 400) {
      throw new Error(
        "Server is behind Cloudflare Access. Add a service token (client id and secret) to connect."
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Authentication rejected by the MCP server (HTTP ${res.status}).`);
    }

    const sid = res.headers.get("Mcp-Session-Id");
    if (sid) this.sessionId = sid;

    if (notify) return null;

    if (!res.ok) {
      throw new Error(`MCP server returned HTTP ${res.status}`);
    }

    const rpc = await parseRpc(res);
    if (!rpc) throw new Error("MCP server returned an unreadable response");
    if (rpc.error) throw new Error(`MCP error ${rpc.error.code}: ${rpc.error.message}`);
    return rpc.result;
  }

  async initialize(): Promise<{ name?: string; version?: string }> {
    if (this.initialized) return {};
    const result = await this.call("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "omnigrok", version: "1.0" },
    });
    // Best-effort: some servers do not require the notification.
    await this.call("notifications/initialized", {}, true).catch(() => {});
    this.initialized = true;
    return result?.serverInfo ?? {};
  }

  async listTools(): Promise<McpToolDef[]> {
    await this.initialize();
    const result = await this.call("tools/list", {});
    const tools = result?.tools;
    return Array.isArray(tools) ? tools : [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    await this.initialize();
    const result = await this.call("tools/call", { name, arguments: args });

    // Content is a list of typed blocks; flatten the textual ones.
    const content = result?.content;
    if (Array.isArray(content)) {
      const text = content
        .map((c: any) => (typeof c?.text === "string" ? c.text : c?.type ? `[${c.type}]` : ""))
        .filter(Boolean)
        .join("\n")
        .trim();
      if (result?.isError) return `Error: ${text || "tool reported failure"}`;
      return text || "(no output)";
    }
    return typeof result === "string" ? result : JSON.stringify(result ?? null);
  }
}

/** Probe a server so the UI can show what it offers before the model uses it. */
export async function probeMcpServer(
  url: string,
  auth: McpAuth
): Promise<{ ok: boolean; serverName?: string; tools: McpToolDef[]; error?: string }> {
  try {
    const client = new McpClient(url, auth);
    const info = await client.initialize();
    const tools = await client.listTools();
    return { ok: true, serverName: info?.name, tools };
  } catch (e) {
    return { ok: false, tools: [], error: e instanceof Error ? e.message : "connection failed" };
  }
}
