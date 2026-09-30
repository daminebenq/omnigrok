// Proves the two chat-breaking bugs are fixed:
//  1. worker normalizes OpenAI SSE (old code passed it through raw)
//  2. client parses that protocol (old code read a field that never existed)
import { streamInference } from "./.tmp-inference.mjs";
import { streamChat } from "./.tmp-api.mjs";

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};

// A realistic OpenAI-compatible stream, including reasoning + usage + a
// split-across-chunks frame and a malformed line.
const UPSTREAM = [
  'data: {"choices":[{"delta":{"reasoning_content":"Let me think. "}}]}\n\n',
  'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
  'data: {"choices":[{"delta":{"content":", wor',            // deliberately split
  'ld"}}]}\n\ndata: {"choices":[{"delta":{"content":"!"}}]}\n\n',
  'data: {not json}\n\n',                                     // must not kill stream
  'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":11,"completion_tokens":4,"total_tokens":15}}\n\n',
  'data: [DONE]\n\n',
];

function upstreamResponse() {
  const enc = new TextEncoder();
  let i = 0;
  return new Response(new ReadableStream({
    pull(c) {
      if (i >= UPSTREAM.length) return c.close();
      c.enqueue(enc.encode(UPSTREAM[i++]));
    },
  }), { status: 200, headers: { "content-type": "text/event-stream" } });
}

globalThis.fetch = async (url) => {
  if (String(url).includes("/chat/completions")) return upstreamResponse();
  throw new Error("unexpected fetch: " + url);
};

// --- worker side ---
const { stream, completion } = await streamInference(
  [{ role: "user", content: "hi" }],
  "openai/gpt-4o",
  { OPENAI_KEY: "test" }
);

// Tee so we can both inspect raw frames and feed the client parser.
const [forRaw, forClient] = stream.tee();

const rawText = await new Response(forRaw).text();
check("worker emits token events", rawText.includes('{"type":"token","content":"Hello"}'), true);
check("worker emits reasoning events", rawText.includes('"type":"reasoning"'), true);
check("worker emits usage event", rawText.includes('{"type":"usage","input":11,"output":4,"total":15}'), true);
check("worker terminates with [DONE]", rawText.trim().endsWith("data: [DONE]"), true);

const done = await completion;
check("completion captures full text (for persistence)", done.text, "Hello, world!");
check("completion captures reasoning", done.reasoning, "Let me think. ");

// --- client side ---
globalThis.fetch = async (url) => {
  if (url === "/api/chat") {
    return new Response(forClient, { status: 200, headers: { "content-type": "text/event-stream" } });
  }
  throw new Error("unexpected fetch: " + url);
};

let text = "", reasoning = "", usage = null;
await streamChat({
  conversationId: "c1",
  messages: [{ id: "m1", role: "user", content: "hi", createdAt: 0 }],
  model: "openai/gpt-4o",
  onToken: (c) => { text += c; },
  onReasoning: (c) => { reasoning += c; },
  onUsage: (u) => { usage = u; },
});

check("client reassembles streamed text", text, "Hello, world!");
check("client receives reasoning", reasoning, "Let me think. ");
check("client receives usage", usage, { input: 11, output: 4, total: 15 });

// --- error paths ---
// Immediate provider failure must throw, so the route can answer 502 rather
// than a 200 carrying an error frame.
globalThis.fetch = async () => new Response("upstream exploded", { status: 500 });
let threw = null;
try {
  await streamInference([{ role: "user", content: "x" }], "openai/gpt-4o", { OPENAI_KEY: "k" });
} catch (e) { threw = e.message; }
check("immediate provider error throws (-> HTTP 502)", /500/.test(threw ?? ""), true);

// An unconfigured model must fail fast too.
threw = null;
try {
  await streamInference([{ role: "user", content: "x" }], "openai/gpt-4o", {});
} catch (e) { threw = e.message; }
check("unconfigured model throws", /No provider configured/.test(threw ?? ""), true);

// A failure AFTER streaming started can only be reported in-band: the 200
// and its headers are already sent by then.
function sseStreamOf(frames) {
  const e = new TextEncoder();
  return new ReadableStream({ pull(c) { if (!frames.length) return c.close(); c.enqueue(e.encode(frames.shift())); } });
}
let providerCall = 0;
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes("/chat/completions")) {
    providerCall++;
    // Turn 1 asks for a tool; turn 2 (after the tool ran) blows up.
    if (providerCall === 1) {
      return new Response(sseStreamOf([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","type":"function","function":{"name":"jarvis_exec","arguments":"{\\"command\\":\\"ls\\"}"}}]}}]}\n\n',
        'data: [DONE]\n\n',
      ]), { status: 200 });
    }
    return new Response("boom", { status: 500 });
  }
  if (u.includes("jarvis.damineweb.work")) {
    return new Response(JSON.stringify({ output: "ok" }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  }
  throw new Error("unexpected fetch: " + u);
};
const late = await streamInference(
  [{ role: "user", content: "x" }], "openai/gpt-4o", { OPENAI_KEY: "k", JARVIS_TOKEN: "t" }
);
const lateRaw = await new Response(late.stream).text();
check("mid-stream failure reported in-band", lateRaw.includes('"type":"error"'), true);
check("stream still terminates cleanly", lateRaw.trim().endsWith("data: [DONE]"), true);
check("partial work still resolves for persistence", typeof (await late.completion).text, "string");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
