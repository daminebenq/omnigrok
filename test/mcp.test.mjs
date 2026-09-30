// MCP client over Streamable HTTP. Servers differ in whether they answer with
// JSON or SSE, and the user's own servers sit behind Cloudflare Access, so
// both transports and the service-token path have to work.
import { McpClient, probeMcpServer } from "./.tmp-mcp.mjs";

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};

const TOOLS = [
  { name: "scrape", description: "Fetch a page", inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } },
  { name: "search", description: "Search", inputSchema: { type: "object", properties: { q: { type: "string" } } } },
];

function server({ sse = false, requireServiceToken = false } = {}) {
  const seen = { headers: [], methods: [], toolArgs: null };
  const handler = async (url, init) => {
    const h = init.headers ?? {};
    seen.headers.push(h);

    if (requireServiceToken && !h["CF-Access-Client-Secret"]) {
      return new Response("", { status: 302, headers: { location: "https://x.cloudflareaccess.com/login" } });
    }

    const req = JSON.parse(init.body);
    seen.methods.push(req.method);
    let result;
    if (req.method === "initialize") result = { serverInfo: { name: "scrapling", version: "1.2" }, capabilities: {} };
    else if (req.method === "notifications/initialized") return new Response("", { status: 202 });
    else if (req.method === "tools/list") result = { tools: TOOLS };
    else if (req.method === "tools/call") { seen.toolArgs = req.params; result = { content: [{ type: "text", text: "scraped ok" }] }; }
    else result = {};

    const payload = JSON.stringify({ jsonrpc: "2.0", id: req.id, result });
    return sse
      ? new Response(`event: message\ndata: ${payload}\n\n`, { status: 200, headers: { "content-type": "text/event-stream", "Mcp-Session-Id": "sess-1" } })
      : new Response(payload, { status: 200, headers: { "content-type": "application/json", "Mcp-Session-Id": "sess-1" } });
  };
  return { handler, seen };
}

// --- JSON transport ---
let s = server();
globalThis.fetch = s.handler;
let c = new McpClient("https://mcp.example/mcp", { authToken: "t1" });
const info = await c.initialize();
check("initialize returns server info", info.name, "scrapling");
check("tools/list returns tools", (await c.listTools()).map((t) => t.name), ["scrape", "search"]);
check("tool call returns text content", await c.callTool("scrape", { url: "https://x" }), "scraped ok");
check("tool args forwarded", s.seen.toolArgs, { name: "scrape", arguments: { url: "https://x" } });
check("bearer token sent", s.seen.headers[0].Authorization, "Bearer t1");
check("session id echoed back", s.seen.headers.at(-1)["Mcp-Session-Id"], "sess-1");
check("handshake ordered correctly", s.seen.methods.slice(0, 2), ["initialize", "notifications/initialized"]);

// --- SSE transport ---
s = server({ sse: true });
globalThis.fetch = s.handler;
c = new McpClient("https://mcp.example/mcp", {});
check("SSE transport also works", (await c.listTools()).map((t) => t.name), ["scrape", "search"]);

// --- Cloudflare Access ---
s = server({ requireServiceToken: true });
globalThis.fetch = s.handler;
let err = null;
try { await new McpClient("https://mcp.example/mcp", { authToken: "bearer-only" }).listTools(); }
catch (e) { err = e.message; }
check("Access redirect explains the real fix", /service token/i.test(err ?? ""), true);

const withToken = await probeMcpServer("https://mcp.example/mcp", {
  accessClientId: "id", accessClientSecret: "secret",
});
check("service token gets through Access", withToken.ok, true);
check("probe reports the tool list", withToken.tools.length, 2);

// --- failure handling ---
globalThis.fetch = async () => new Response(JSON.stringify({
  jsonrpc: "2.0", id: 1, error: { code: -32601, message: "Method not found" },
}), { status: 200, headers: { "content-type": "application/json" } });
const bad = await probeMcpServer("https://mcp.example/mcp", {});
check("rpc error surfaces, does not throw", bad.ok, false);
check("rpc error message kept", /Method not found/.test(bad.error ?? ""), true);

globalThis.fetch = async () => { throw new Error("ECONNREFUSED"); };
const dead = await probeMcpServer("https://nope.example/mcp", {});
check("unreachable server degrades cleanly", dead.ok, false);

globalThis.fetch = async () => new Response("<html>not json</html>", { status: 200, headers: { "content-type": "text/html" } });
const junk = await probeMcpServer("https://mcp.example/mcp", {});
check("non-JSON body degrades cleanly", junk.ok, false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
