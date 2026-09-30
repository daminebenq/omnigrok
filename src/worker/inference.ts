// Provider routing + normalized streaming proxy.
//
// Providers speak OpenAI-compatible SSE. We normalize that into a single
// internal event protocol so the client has exactly one shape to parse and we
// can surface reasoning/usage alongside plain tokens:
//
//   data: {"type":"token","content":"..."}
//   data: {"type":"reasoning","content":"..."}
//   data: {"type":"usage","input":N,"output":N,"total":N}
//   data: [DONE]

export interface ProviderConfig {
  prefix: string;
  label: string;
  url: string;
  keyEnv: string;
}

export const PROVIDERS: ProviderConfig[] = [
  { prefix: "groq", label: "Groq", url: "https://api.groq.com/openai/v1/chat/completions", keyEnv: "GROQ_KEY" },
  { prefix: "nvidia", label: "NVIDIA NIM", url: "https://integrate.api.nvidia.com/v1/chat/completions", keyEnv: "NVIDIA_KEY" },
  { prefix: "together", label: "Together AI", url: "https://api.together.xyz/v1/chat/completions", keyEnv: "TOGETHER_KEY" },
  { prefix: "hf", label: "Hugging Face", url: "https://router.huggingface.co/v1/chat/completions", keyEnv: "HF_KEY" },
  { prefix: "openai", label: "OpenAI", url: "https://api.openai.com/v1/chat/completions", keyEnv: "OPENAI_KEY" },
  { prefix: "gemini", label: "Google Gemini", url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", keyEnv: "GEMINI_KEY" },
  { prefix: "bytez", label: "Bytez", url: "https://api.bytez.com/models/v2/openai/v1/chat/completions", keyEnv: "BYTEZ_KEY" },
];

/** The user's own gateway, the same one the OmniGrok macOS app talks to. */
const DEFAULT_OMNIROUTE_BASE = "https://omniroute.damineweb.work/v1";

function omniRouteBase(env: InferenceEnv): string {
  return (env.OMNIROUTE_BASE_URL ?? DEFAULT_OMNIROUTE_BASE).replace(/\/+$/, "");
}

export interface InferenceEnv {
  OMNIROUTE_KEY?: string;
  OMNIROUTE_BASE_URL?: string;
  GROQ_KEY?: string;
  NVIDIA_KEY?: string;
  TOGETHER_KEY?: string;
  HF_KEY?: string;
  OPENAI_KEY?: string;
  GEMINI_KEY?: string;
  BYTEZ_KEY?: string;
  JARVIS_TOKEN?: string;
}

export type Capability = "reasoning" | "vision" | "coding" | "audio" | "image" | "tools";

export interface ModelInfo {
  id: string;
  provider: string;
  capabilities: Capability[];
  contextLength?: number;
  reputation: number;
}

function resolveProvider(model: string, env: InferenceEnv): { url: string; key: string; model: string } | null {
  for (const p of PROVIDERS) {
    if (model.startsWith(p.prefix + "/")) {
      const key = (env as any)[p.keyEnv];
      if (!key) return null;
      return { url: p.url, key, model: model.slice(p.prefix.length + 1) };
    }
  }
  if (env.OMNIROUTE_KEY) {
    return { url: `${omniRouteBase(env)}/chat/completions`, key: env.OMNIROUTE_KEY, model };
  }
  return null;
}

// --- Model metadata -------------------------------------------------------

// Ordered, first match wins. Keep frontier families above their older siblings.
const REPUTATION_RULES: Array<{ test: RegExp; score: number }> = [
  { test: /claude-(opus|sonnet)-([5-9]|4[-._]?[5-9])/, score: 99 },
  { test: /\bgpt-[5-9]/, score: 98 },
  { test: /\bo[3-9]\b/, score: 97 },
  { test: /gemini-([3-9]|2[-._]?[5-9])/, score: 96 },
  { test: /claude-(opus|sonnet)-4/, score: 95 },
  { test: /grok-[3-9]/, score: 93 },
  { test: /deepseek-(r1|v3)/, score: 92 },
  { test: /\bo1\b/, score: 90 },
  { test: /gpt-4o/, score: 89 },
  { test: /claude-3[-._]?[57]/, score: 88 },
  { test: /gemini-1[-._]?5-pro/, score: 85 },
  { test: /llama-?3[-._]?[23]/, score: 82 },
  { test: /\bgpt-4\b/, score: 80 },
  { test: /claude-3/, score: 78 },
  { test: /mixtral|mistral-large/, score: 74 },
  { test: /gemini-1[-._]?5-flash/, score: 72 },
  { test: /claude-(haiku|instant)/, score: 70 },
  { test: /gpt-3[-._]?5/, score: 62 },
  { test: /llama-?2|-7b|-8b/, score: 55 },
];

function scoreReputation(id: string): number {
  const s = id.toLowerCase();
  for (const rule of REPUTATION_RULES) {
    if (rule.test.test(s)) return rule.score;
  }
  return 60;
}

const CAPABILITY_HINTS: Array<{ cap: Capability; test: RegExp }> = [
  { cap: "reasoning", test: /reason|thinking|\bo[1-9]\b|deepseek-r|-r1\b/ },
  { cap: "vision", test: /vision|multimodal|\b4o\b|claude-3|claude-(opus|sonnet)-[45]|gemini|llava|pixtral/ },
  { cap: "coding", test: /cod(e|er|ing)|deepseek-v|qwen.*coder|devstral|starcoder/ },
  { cap: "audio", test: /audio|whisper|speech|tts|voice|realtime/ },
  { cap: "image", test: /dall-?e|imagen|flux|stable-?diffusion|midjourney|image-gen/ },
];

/**
 * Prefer real capability metadata from the provider; only fall back to
 * name heuristics when the catalog gives us nothing.
 */
function deriveCapabilities(id: string, reported?: unknown): Capability[] {
  const known: Capability[] = ["reasoning", "vision", "coding", "audio", "image", "tools"];
  if (Array.isArray(reported) && reported.length) {
    const mapped = reported
      .map((c) => String(c).toLowerCase().trim())
      .map((c) => (c === "function_calling" || c === "tool_use" ? "tools" : c))
      .map((c) => (c === "text-to-image" || c === "image_generation" ? "image" : c))
      .filter((c): c is Capability => (known as string[]).includes(c));
    if (mapped.length) return Array.from(new Set(mapped));
  }
  const s = id.toLowerCase();
  return CAPABILITY_HINTS.filter((h) => h.test.test(s)).map((h) => h.cap);
}

interface RawModel {
  id?: string;
  name?: string;
  provider?: string;
  owned_by?: string;
  capabilities?: unknown;
  context_length?: number;
  context_window?: number;
}

function toModelInfo(raw: RawModel, fallbackProvider: string): ModelInfo | null {
  const id = raw.id ?? raw.name;
  if (!id) return null;
  // "anthropic/claude-x" -> group under "anthropic" when the API omits provider.
  const inferred = id.includes("/") ? id.split("/")[0] : fallbackProvider;
  return {
    id,
    provider: raw.provider ?? raw.owned_by ?? inferred,
    capabilities: deriveCapabilities(id, raw.capabilities),
    contextLength: raw.context_length ?? raw.context_window,
    reputation: scoreReputation(id),
  };
}

async function fetchOmniRouteModels(apiKey: string, baseUrl: string): Promise<ModelInfo[]> {
  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      console.warn(`OmniRoute models API error: ${response.status}`);
      return [];
    }
    const data = (await response.json()) as { data?: RawModel[]; models?: RawModel[] };
    const raw = data.data ?? data.models ?? [];
    return raw
      .map((m) => toModelInfo(m, "OmniRoute"))
      .filter((m): m is ModelInfo => m !== null);
  } catch (error) {
    console.warn("Failed to fetch OmniRoute models:", error);
    return [];
  }
}

// Static catalogs for providers without a usable list endpoint here.
const STATIC_CATALOG: Record<string, { keyEnv: keyof InferenceEnv; ids: string[]; provider: string }> = {
  groq: {
    keyEnv: "GROQ_KEY",
    provider: "Groq",
    ids: ["groq/llama-3.3-70b-versatile", "groq/llama-3.1-8b-instant", "groq/mixtral-8x7b-32768"],
  },
  openai: {
    keyEnv: "OPENAI_KEY",
    provider: "OpenAI",
    ids: ["openai/gpt-4o", "openai/gpt-4o-mini", "openai/o1-mini", "openai/gpt-4-turbo"],
  },
  gemini: {
    keyEnv: "GEMINI_KEY",
    provider: "Google",
    ids: ["gemini/gemini-2.0-flash", "gemini/gemini-1.5-pro", "gemini/gemini-1.5-flash"],
  },
  nvidia: {
    keyEnv: "NVIDIA_KEY",
    provider: "NVIDIA NIM",
    ids: ["nvidia/meta/llama-3.3-70b-instruct", "nvidia/deepseek-ai/deepseek-r1"],
  },
  together: {
    keyEnv: "TOGETHER_KEY",
    provider: "Together AI",
    ids: [
      "together/meta-llama/Llama-3.3-70B-Instruct-Turbo",
      "together/deepseek-ai/DeepSeek-R1",
    ],
  },
  hf: {
    keyEnv: "HF_KEY",
    provider: "Hugging Face",
    ids: ["hf/meta-llama/Llama-3.3-70B-Instruct", "hf/Qwen/Qwen2.5-Coder-32B-Instruct"],
  },
  bytez: {
    keyEnv: "BYTEZ_KEY",
    provider: "Bytez",
    ids: ["bytez/microsoft/phi-4"],
  },
};

export const AUTO_MODEL: ModelInfo = {
  id: "auto",
  provider: "OmniGrok",
  capabilities: ["reasoning", "vision", "coding", "tools"],
  reputation: 100,
};

export async function getAvailableModels(env: InferenceEnv): Promise<ModelInfo[]> {
  const models: ModelInfo[] = [];

  if (env.OMNIROUTE_KEY) {
    const fetched = await fetchOmniRouteModels(env.OMNIROUTE_KEY, omniRouteBase(env));
    if (fetched.length) {
      models.push(...fetched);
    } else {
      // Keep the app usable if the catalog endpoint is down.
      for (const id of ["antigravity/claude-sonnet-4-6", "agy/claude-sonnet-4-6", "claude-sonnet-failover"]) {
        models.push(toModelInfo({ id }, "OmniRoute")!);
      }
    }
  }

  for (const entry of Object.values(STATIC_CATALOG)) {
    if (!env[entry.keyEnv]) continue;
    for (const id of entry.ids) {
      models.push(toModelInfo({ id, provider: entry.provider }, entry.provider)!);
    }
  }

  // Only offer auto-routing when there is more than one model to choose from.
  if (models.length > 1) models.unshift(AUTO_MODEL);

  return models;
}

// --- Streaming + agent loop ----------------------------------------------

import { BUILTIN_TOOLS, dispatchTool, type ToolEnv, type Toolset } from "./tools";

export type StreamEvent =
  | { type: "token"; content: string }
  | { type: "reasoning"; content: string }
  | { type: "tool"; id: string; name: string; status: "running" | "done" | "error"; detail?: string }
  | { type: "usage"; input: number; output: number; total: number };

export interface ChatMessage {
  role: string;
  content: string;
  tool_calls?: unknown;
  tool_call_id?: string;
}

function sse(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

/** Rough fallback so token counts are never blank when a provider omits usage. */
function estimateTokens(text: string): number {
  return estimateChars(text.length);
}

function estimateChars(chars: number): number {
  return Math.max(1, Math.round(chars / 4));
}

/** Yields each complete `data:` payload from an SSE body. */
async function* sseFrames(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload) yield payload;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

interface AccumulatedToolCall {
  id: string;
  name: string;
  args: string;
}

async function callProvider(
  url: string,
  key: string,
  model: string,
  messages: ChatMessage[],
  withTools: boolean,
  toolSchemas: typeof BUILTIN_TOOLS
): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      max_tokens: 4096,
      temperature: 0.7,
      ...(withTools && toolSchemas.length ? { tools: toolSchemas, tool_choice: "auto" } : {}),
    }),
  });
}

const MAX_TOOL_TURNS = 5;

/**
 * Drives the model, executing any tools it asks for and feeding the results
 * back, until it produces a final answer or the turn budget is spent.
 */
async function* runAgent(
  initialMessages: ChatMessage[],
  model: string,
  env: InferenceEnv,
  enableTools: boolean,
  toolset?: Toolset
): AsyncGenerator<StreamEvent, { text: string; reasoning: string }> {
  const toolSchemas = toolset?.schemas ?? BUILTIN_TOOLS;
  const resolved = resolveProvider(model, env);
  if (!resolved) throw new Error(`No provider configured for model: ${model}`);
  const { url, key, model: providerModel } = resolved;

  const convo: ChatMessage[] = [...initialMessages];
  const promptChars = convo.reduce((n, m) => n + (m.content?.length ?? 0), 0);

  let finalText = "";
  let allReasoning = "";
  let usage: { input: number; output: number; total: number } | null = null;
  let useTools = enableTools;

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    let res = await callProvider(url, key, providerModel, convo, useTools, toolSchemas);

    // Not every OpenAI-compatible endpoint accepts a `tools` array. If that is
    // what it rejected, drop tools and try once more rather than failing.
    if (!res.ok && useTools && res.status >= 400 && res.status < 500) {
      useTools = false;
      res = await callProvider(url, key, providerModel, convo, false, toolSchemas);
    }
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Provider API error ${res.status}: ${detail.slice(0, 300)}`);
    }

    let text = "";
    const toolCalls = new Map<number, AccumulatedToolCall>();

    for await (const payload of sseFrames(res.body)) {
      if (payload === "[DONE]") break;
      let chunk: any;
      try {
        chunk = JSON.parse(payload);
      } catch {
        continue; // Skip a malformed frame rather than abort the turn.
      }

      if (chunk.usage) {
        usage = {
          input: chunk.usage.prompt_tokens ?? 0,
          output: chunk.usage.completion_tokens ?? 0,
          total: chunk.usage.total_tokens ?? 0,
        };
      }

      const delta = chunk.choices?.[0]?.delta ?? {};

      const think = delta.reasoning_content ?? delta.reasoning;
      if (typeof think === "string" && think) {
        allReasoning += think;
        yield { type: "reasoning", content: think };
      }
      if (typeof delta.content === "string" && delta.content) {
        text += delta.content;
        yield { type: "token", content: delta.content };
      }

      // Tool call fragments arrive split across chunks, keyed by index.
      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          const acc = toolCalls.get(idx) ?? { id: "", name: "", args: "" };
          if (tc.id) acc.id = tc.id;
          if (tc.function?.name) acc.name = tc.function.name;
          if (tc.function?.arguments) acc.args += tc.function.arguments;
          toolCalls.set(idx, acc);
        }
      }
    }

    if (toolCalls.size === 0) {
      finalText = text;
      break;
    }

    // Record the assistant's tool request, then run each tool.
    const calls = [...toolCalls.values()].filter((c) => c.name);
    convo.push({
      role: "assistant",
      content: text,
      tool_calls: calls.map((c) => ({
        id: c.id || crypto.randomUUID(),
        type: "function",
        function: { name: c.name, arguments: c.args || "{}" },
      })),
    });

    for (const call of calls) {
      const id = call.id || crypto.randomUUID();
      yield { type: "tool", id, name: call.name, status: "running" };

      let args: Record<string, unknown> = {};
      try {
        args = call.args ? JSON.parse(call.args) : {};
      } catch {
        // Fall through with empty args; the tool reports the problem.
      }

      const result = await dispatchTool(call.name, args, env as ToolEnv, toolset);
      const failed = result.startsWith("Error:");
      yield {
        type: "tool",
        id,
        name: call.name,
        status: failed ? "error" : "done",
        detail: result.slice(0, 400),
      };

      convo.push({ role: "tool", tool_call_id: id, content: result });
    }

    if (turn === MAX_TOOL_TURNS - 1) {
      finalText = text;
    }
  }

  if (!usage) {
    const input = estimateChars(promptChars);
    const output = estimateTokens(finalText);
    usage = { input, output, total: input + output };
  }
  yield { type: "usage", ...usage };

  return { text: finalText, reasoning: allReasoning };
}

export interface StreamResult {
  stream: ReadableStream<Uint8Array>;
  /** Resolves with the final assistant text once the stream completes. */
  completion: Promise<{ text: string; reasoning: string }>;
}

export async function streamInference(
  messages: ChatMessage[],
  model: string,
  env: InferenceEnv,
  opts: { tools?: boolean; toolset?: Toolset } = {}
): Promise<StreamResult> {
  // Resolve eagerly so a misconfigured model fails as an HTTP error rather
  // than as a dead stream the client cannot interpret.
  if (!resolveProvider(model, env)) {
    throw new Error(`No provider configured for model: ${model}`);
  }

  const encoder = new TextEncoder();
  const agent = runAgent(messages, model, env, opts.tools !== false, opts.toolset);

  let resolveCompletion!: (v: { text: string; reasoning: string }) => void;
  const completion = new Promise<{ text: string; reasoning: string }>((res) => {
    resolveCompletion = res;
  });

  let settled = false;
  let partialText = "";
  let partialReasoning = "";
  const settle = (v: { text: string; reasoning: string }) => {
    if (settled) return;
    settled = true;
    resolveCompletion(v);
  };

  // Pull the first event eagerly. If the provider is going to fail outright,
  // it fails here and the caller can answer with a real HTTP status instead
  // of a 200 carrying an error frame. Failures on later turns can only be
  // reported in-band, since headers are long gone by then.
  let primed: IteratorResult<StreamEvent, { text: string; reasoning: string }> | null =
    await agent.next();
  if (primed.done) {
    settle(primed.value ?? { text: "", reasoning: "" });
  } else if (primed.value.type === "token") {
    partialText += primed.value.content;
  } else if (primed.value.type === "reasoning") {
    partialReasoning += primed.value.content;
  }

  // Generator-backed: next() always advances to the next yield or to return,
  // so a pull can never come back empty and stall the stream.
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = primed ?? (await agent.next());
        primed = null;
        if (done) {
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
          settle(value ?? { text: partialText, reasoning: partialReasoning });
          return;
        }
        if (value.type === "token") partialText += value.content;
        if (value.type === "reasoning") partialReasoning += value.content;
        controller.enqueue(encoder.encode(sse(value)));
      } catch (e) {
        const message = e instanceof Error ? e.message : "Inference failed";
        controller.enqueue(encoder.encode(sse({ type: "error", message })));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
        settle({ text: partialText, reasoning: partialReasoning });
      }
    },
    cancel() {
      // Client went away: keep whatever was produced so the thread survives.
      void agent.return?.({ text: partialText, reasoning: partialReasoning });
      settle({ text: partialText, reasoning: partialReasoning });
    },
  });

  return { stream, completion };
}
