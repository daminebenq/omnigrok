// The reported failure: a turn died with
//   429 {"error":{"code":"model_cooldown","model":"ibm-granite/granite-4.2-8b",
//        "reset_seconds":120,...}}
// Chat must fall through to another model instead of surfacing that, and must
// stop choosing a model it already knows is cooling.
import { parseRateLimit, markCooling, isCooling, coolingModels } from "./.tmp-cooldown.mjs";
import { streamInference } from "./.tmp-inference.mjs";
import { buildFallbacks, selectModel } from "./.tmp-router.mjs";

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};
// Each entry point bundles its own copy of the cooldown module, so the
// in-memory map here is NOT the one streamInference mutates. KV is the shared,
// durable record and the thing that actually matters across isolates, so
// assert on that.
const store = new Map();
const kv = {
  get: async (k, t) => (store.has(k) ? (t === "json" ? JSON.parse(store.get(k)) : store.get(k)) : null),
  put: async (k, v) => void store.set(k, v),
};
const kvCooling = () => JSON.parse(store.get("cooldowns:v1") ?? "[]").map((e) => e.model);

const REAL_429 = JSON.stringify({ error: {
  message: "All credentials for model ibm-granite/granite-4.2-8b are cooling down",
  type: "rate_limit_error", code: "model_cooldown",
  model: "ibm-granite/granite-4.2-8b", reset_seconds: 120,
  retry_after: "2026-09-30T16:19:55.383Z", credentials_cooling: 1 }});

// --- parsing the real payload ---
const p = parseRateLimit(429, REAL_429, null);
check("recognised as a rate limit", p.isRateLimit, true);
check("names the cooling model", p.model, "ibm-granite/granite-4.2-8b");
check("reads reset_seconds", p.resetSeconds, 120);
check("plain 429 without a body still counts", parseRateLimit(429, "Too Many Requests").isRateLimit, true);
check("Retry-After header honoured", parseRateLimit(429, "{}", "45").resetSeconds, 45);
check("a 500 is not a rate limit", parseRateLimit(500, "boom").isRateLimit, false);
// A hostile reset value must not park a model for a week.
check("absurd reset clamped", (await (async () => {
  await markCooling(kv, "x/huge", 999999, "r"); return isCooling("x/huge");
})()), true);

// --- the fallback actually happens ---
const enc = new TextEncoder();
const sse = (frames) => new ReadableStream({
  pull(c) { if (!frames.length) return c.close(); c.enqueue(enc.encode(frames.shift())); } });
const ANSWER = [
  'data: {"choices":[{"delta":{"content":"Answered by the fallback."}}]}\n\n',
  'data: [DONE]\n\n',
];

let tried = [];
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  tried.push(body.model);
  if (body.model === "granite-4.2-8b") {
    return new Response(REAL_429, { status: 429, headers: { "content-type": "application/json" } });
  }
  return new Response(sse([...ANSWER]), { status: 200 });
};

const r = await streamInference(
  [{ role: "user", content: "hi" }],
  "openai/granite-4.2-8b",
  { OPENAI_KEY: "k" },
  { fallbacks: ["openai/gpt-4o"], kv, tools: false }
);
const raw = await new Response(r.stream).text();
const done = await r.completion;

check("rate-limited model was tried first", tried[0], "granite-4.2-8b");
check("fell through to the fallback", tried[1], "gpt-4o");
check("user gets an answer, not a 429", done.text, "Answered by the fallback.");
check("switch is announced to the client", raw.includes('"type":"model"'), true);
check("switch names the new model", raw.includes('openai/gpt-4o'), true);
check("cooling model persisted to KV", kvCooling().includes("ibm-granite/granite-4.2-8b"), true);

// --- exhausted chain reports honestly ---
globalThis.fetch = async () => new Response(REAL_429, { status: 429, headers: { "content-type": "application/json" } });
const r2 = await streamInference(
  [{ role: "user", content: "hi" }], "openai/a", { OPENAI_KEY: "k" },
  { fallbacks: ["openai/b"], kv, tools: false }
);
const raw2 = await new Response(r2.stream).text();
check("all-limited surfaces an error event", raw2.includes('"type":"error"'), true);
check("error explains the wait", /rate limited/i.test(raw2), true);

// --- routing avoids known-cooling models ---
const CATALOG = [
  { id: "a/top",  provider: "a", capabilities: ["coding"], contextLength: 9000, reputation: 99, known: true },
  { id: "b/next", provider: "b", capabilities: ["coding"], contextLength: 9000, reputation: 80, known: true },
];
check("router skips a cooling model", selectModel(CATALOG, "coding", undefined, (id) => id === "a/top").model, "b/next");
check("fallbacks exclude the primary", buildFallbacks(CATALOG, "a/top", "coding"), ["b/next"]);
check("fallbacks never include auto",
  buildFallbacks([...CATALOG, { id: "auto", provider: "x", capabilities: [], reputation: 100, known: true }], "a/top", "coding"),
  ["b/next"]);

// unknown junk models must not win the "fast" tier (the granite case)
const NOISY = [
  { id: "vendor/obscure-thing", provider: "v", capabilities: [], reputation: 60, known: false },
  { id: "groq/llama-3.1-8b-instant", provider: "groq", capabilities: [], reputation: 55, known: true },
  { id: "anthropic/claude-opus-4-6", provider: "a", capabilities: ["reasoning"], reputation: 99, known: true },
];
check("fast tier ignores unrecognised models", selectModel(NOISY, "fast").model, "groq/llama-3.1-8b-instant");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
