// The reported bug: reloading the page lost the in-progress answer, because
// the browser held the SSE connection and dropping it aborted the model call.
// Generation now lives in a Durable Object, so it keeps going and any client
// can re-attach and replay what it missed.
import { ChatSession } from "./.tmp-session.mjs";

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- mocks ---------------------------------------------------------------
function mockState() {
  const store = new Map();
  const pending = [];
  return {
    storage: {
      get: async (k) => store.get(k),
      put: async (k, v) => void store.set(k, v),
    },
    waitUntil: (p) => pending.push(p),
    _pending: pending,
  };
}
function mockKV() {
  const m = new Map();
  return {
    _m: m,
    get: async (k, t) => (m.has(k) ? (t === "json" ? JSON.parse(m.get(k)) : m.get(k)) : null),
    put: async (k, v) => void m.set(k, v),
    delete: async (k) => void m.delete(k),
    list: async () => ({ keys: [...m.keys()].map((name) => ({ name })) }),
  };
}

// A provider that pauses mid-answer so the test can disconnect a client
// while generation is still in flight.
let release;
const gate = new Promise((r) => { release = r; });

function providerStream2() {
  const enc = new TextEncoder();
  const frames = [
    'data: {"choices":[{"delta":{"reasoning_content":"thinking hard. "}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"Part one. "}}]}\n\n',
    "__GATE__",
    'data: {"choices":[{"delta":{"content":"Part two."}}]}\n\n',
    'data: [DONE]\n\n',
  ];
  let i = 0;
  return new ReadableStream({
    async pull(c) {
      if (i >= frames.length) return c.close();
      const f = frames[i++];
      if (f === "__GATE__") { await gate; return; }
      c.enqueue(enc.encode(f));
    },
  });
}

globalThis.fetch = async (url) => {
  if (String(url).includes("/chat/completions")) {
    return new Response(providerStream2(), { status: 200 });
  }
  throw new Error("unexpected fetch " + url);
};

async function readSse(res, { stopAfter } = {}) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", out = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n"); buf = lines.pop() ?? "";
      for (const l of lines) {
        const t = l.trim();
        if (!t.startsWith("data:")) continue;
        const p = t.slice(5).trim();
        if (!p || p === "[DONE]") continue;
        out.push(JSON.parse(p));
        if (stopAfter && out.length >= stopAfter) { await reader.cancel(); return out; }
      }
    }
  } catch { /* cancelled */ }
  return out;
}
const textOf = (evts) => evts.filter(e => e.type === "token").map(e => e.content).join("");
const reasoningOf = (evts) => evts.filter(e => e.type === "reasoning").map(e => e.content).join("");

// --- the scenario --------------------------------------------------------
const state = mockState();
const kv = mockKV();
const env = { OPENAI_KEY: "k", OMNIGROK_KV: kv };
const session = new ChatSession(state, env);

const startBody = {
  userId: "u1",
  conversationId: "c1",
  model: "openai/gpt-4o",
  title: "T",
  messages: [{ id: "m1", role: "user", content: "hi", createdAt: 1 }],
};

// 1. First client starts the run, reads a couple of events, then "reloads"
//    by cancelling its reader mid-answer.
const res1 = await session.fetch(new Request("https://session/start", {
  method: "POST", body: JSON.stringify(startBody),
}));
const firstClient = await readSse(res1, { stopAfter: 2 });
check("first client sees the early events", textOf(firstClient), "Part one. ");
check("first client sees reasoning", reasoningOf(firstClient), "thinking hard. ");

// 2. That client is gone. Generation must NOT have been aborted.
await sleep(30);
const midStatus = await (await session.fetch(new Request("https://session/status"))).json();
check("still generating after client disconnects", midStatus.generating, true);

// 3. Let the provider finish, as it would have kept doing all along.
release();
await sleep(60);

// 4. A reloaded page re-attaches from seq 0 and replays the whole turn,
//    including the part produced while nothing was connected.
const res2 = await session.fetch(new Request("https://session/attach?from=0"));
const reattached = await readSse(res2);
check("re-attach replays the full answer", textOf(reattached), "Part one. Part two.");
check("re-attach replays reasoning", reasoningOf(reattached), "thinking hard. ");

// 5. Resuming from a sequence number yields only what was missed.
const res3 = await session.fetch(new Request("https://session/attach?from=2"));
const resumed = await readSse(res3);
check("resume from seq skips what was already seen", textOf(resumed), "Part two.");

// 6. The finished turn is persisted, and the thread is no longer flagged.
await Promise.all(state._pending);
const saved = JSON.parse(kv._m.get("conv:u1:c1"));
const assistant = saved.messages.find((m) => m.role === "assistant");
check("assistant reply persisted to KV", assistant.content, "Part one. Part two.");
check("reasoning persisted", assistant.reasoning, "thinking hard. ");
check("generating flag cleared", saved.status, undefined);

const finalStatus = await (await session.fetch(new Request("https://session/status"))).json();
check("session reports done", finalStatus.done, true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
