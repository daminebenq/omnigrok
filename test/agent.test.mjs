// Proves the tool-calling loop works end to end: the model requests a tool,
// the worker executes it, feeds the result back, and the model answers.
// Previously BUILTIN_TOOLS was imported but never used and dispatchTool was
// never called, so the model could never reach Jarvis at all.
import { streamInference } from "./.tmp-inference.mjs";

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};

const enc = new TextEncoder();
const sseStream = (frames) => new ReadableStream({
  pull(c) { if (!frames.length) return c.close(); c.enqueue(enc.encode(frames.shift())); }
});

// Turn 1: model asks for jarvis_exec (arguments split across chunks).
// Turn 2: model answers using the tool result.
const TURN1 = [
  'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"jarvis_exec","arguments":"{\\"comm"}}]}}]}\n\n',
  'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"and\\":\\"uptime\\"}"}}]}}]}\n\n',
  'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
  'data: [DONE]\n\n',
];
const TURN2 = [
  'data: {"choices":[{"delta":{"content":"Your box has been up 3 days."}}]}\n\n',
  'data: [DONE]\n\n',
];

let providerCalls = 0;
let jarvisBody = null;
let sentTools = null;

globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes("/chat/completions")) {
    providerCalls++;
    const body = JSON.parse(init.body);
    if (providerCalls === 1) sentTools = body.tools?.map((t) => t.function.name) ?? null;
    if (providerCalls === 2) jarvisBody = body.messages;
    return new Response(sseStream(providerCalls === 1 ? [...TURN1] : [...TURN2]), { status: 200 });
  }
  if (u.includes("jarvis.damineweb.work")) {
    return new Response(JSON.stringify({ output: "up 3 days" }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  }
  throw new Error("unexpected fetch: " + u);
};

const { stream, completion } = await streamInference(
  [{ role: "user", content: "how long has my server been up?" }],
  "openai/gpt-4o",
  { OPENAI_KEY: "k", JARVIS_TOKEN: "jt" }
);
const raw = await new Response(stream).text();
const done = await completion;

check("tools are advertised to the model", sentTools, ["jarvis_exec", "web_browse"]);
check("provider called twice (tool turn + answer)", providerCalls, 2);
check("tool 'running' event emitted", raw.includes('"type":"tool"') && raw.includes('"status":"running"'), true);
check("tool 'done' event emitted", raw.includes('"status":"done"'), true);
check("jarvis result fed back to model", jarvisBody?.some?.((m) => m.role === "tool" && m.content.includes("up 3 days")), true);
check("assistant tool_calls recorded in history", jarvisBody?.some?.((m) => m.role === "assistant" && m.tool_calls), true);
check("final answer streamed", done.text, "Your box has been up 3 days.");

// Jarvis unconfigured must degrade to a clear message, not a crash.
providerCalls = 0;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes("/chat/completions")) {
    providerCalls++;
    return new Response(sseStream(providerCalls === 1 ? [...TURN1] : [...TURN2]), { status: 200 });
  }
  throw new Error("jarvis should not be called without a token");
};
const r2 = await streamInference(
  [{ role: "user", content: "x" }], "openai/gpt-4o", { OPENAI_KEY: "k" }
);
const raw2 = await new Response(r2.stream).text();
check("missing JARVIS_TOKEN reported as tool error", raw2.includes('"status":"error"'), true);
check("missing token does not kill the stream", (await r2.completion).text, "Your box has been up 3 days.");

// A provider that rejects `tools` should be retried without them.
let attempts = [];
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  attempts.push(Boolean(body.tools));
  if (body.tools) return new Response("tools unsupported", { status: 400 });
  return new Response(sseStream([...TURN2]), { status: 200 });
};
const r3 = await streamInference([{ role: "user", content: "x" }], "openai/gpt-4o", { OPENAI_KEY: "k" });
await new Response(r3.stream).text();
check("retries without tools on 400", attempts, [true, false]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
