// Model routing: the right model for the request. Classification is local and
// heuristic on purpose -- an LLM call to decide which LLM to call would add
// latency and cost to every message.
import { classify, selectModel, route } from "./.tmp-router.mjs";

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};
const user = (content) => [{ role: "user", content }];

const CATALOG = [
  { id: "anthropic/claude-opus-4-6",  provider: "anthropic", capabilities: ["reasoning","vision","coding","tools"], contextLength: 200000, reputation: 99, known: true },
  { id: "deepseek/deepseek-r1",       provider: "deepseek",  capabilities: ["reasoning","coding"],                   contextLength: 64000,  reputation: 92, known: true },
  { id: "openai/gpt-4o",              provider: "openai",    capabilities: ["vision","tools"],                       contextLength: 128000, reputation: 89, known: true },
  { id: "groq/llama-3.1-8b-instant",  provider: "groq",      capabilities: [],                                       contextLength: 8192,   reputation: 55, known: true },
];

// --- classification ---
check("code fence -> coding",        classify(user("```js\nconst a=1\n```")).task, "coding");
check("debug ask -> coding",         classify(user("can you debug this stack trace for me")).task, "coding");
check("derivation -> reasoning",     classify(user("prove that the algorithm is O(n log n) and derive the bound")).task, "reasoning");
check("tradeoffs -> reasoning",      classify(user("what are the trade-offs between these two designs and why")).task, "reasoning");
check("greeting -> fast",            classify(user("hey")).task, "fast");
check("thanks -> fast",              classify(user("thanks!")).task, "fast");
check("attachment -> vision",        classify(user("what is this"), true).task, "vision");
check("huge input -> long-context",  classify(user("x".repeat(30000))).task, "long-context");
check("ordinary ask -> general",     classify(user("Tell me about the history of the Dutch East India Company please")).task, "general");

// attachments win over everything else
check("attachment beats code",       classify(user("```js\nx\n```"), true).task, "vision");

// --- selection ---
check("coding picks a coding model",    selectModel(CATALOG, "coding").model, "anthropic/claude-opus-4-6");
check("vision picks a vision model",    selectModel(CATALOG, "vision").model, "anthropic/claude-opus-4-6");
check("fast avoids the frontier model", selectModel(CATALOG, "fast").model, "groq/llama-3.1-8b-instant");
check("long-context needs a big window", selectModel(CATALOG, "long-context").model, "anthropic/claude-opus-4-6");

// vision must not pick a model that cannot see
const noVisionTop = [
  { id: "x/reasoner", provider: "x", capabilities: ["reasoning"], contextLength: 8000, reputation: 99, known: true },
  { id: "y/seer",     provider: "y", capabilities: ["vision"],    contextLength: 8000, reputation: 70, known: true },
];
check("vision skips a higher-ranked blind model", selectModel(noVisionTop, "vision").model, "y/seer");

// long-context must not pick a small window even if it ranks higher
const smallTop = [
  { id: "a/small", provider: "a", capabilities: ["reasoning"], contextLength: 8000,   reputation: 99, known: true },
  { id: "b/roomy", provider: "b", capabilities: [],            contextLength: 200000, reputation: 70, known: true },
];
check("long-context skips a small window", selectModel(smallTop, "long-context").model, "b/roomy");

// --- degradation ---
check("empty catalog does not throw", selectModel([], "coding").model, "");
check("empty catalog flags no match", selectModel([], "coding").matched, false);
const single = [CATALOG[0]];
check("single model is always the answer", selectModel(single, "fast").model, "anthropic/claude-opus-4-6");

// --- end to end ---
const d = route(CATALOG, user("refactor this function to be tail recursive"));
check("route returns a coding decision", d.task, "coding");
check("route explains itself", typeof d.reason === "string" && d.reason.length > 10, true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
