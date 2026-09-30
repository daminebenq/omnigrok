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

export interface InferenceEnv {
  OMNIROUTE_KEY?: string;
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
    return { url: "https://api.omniroute.tech/v1/chat/completions", key: env.OMNIROUTE_KEY, model };
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

async function fetchOmniRouteModels(apiKey: string): Promise<ModelInfo[]> {
  try {
    const response = await fetch("https://api.omniroute.tech/v1/models", {
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

export async function getAvailableModels(env: InferenceEnv): Promise<ModelInfo[]> {
  const models: ModelInfo[] = [];

  if (env.OMNIROUTE_KEY) {
    const fetched = await fetchOmniRouteModels(env.OMNIROUTE_KEY);
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

  return models;
}

// --- Streaming ------------------------------------------------------------

function sse(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

/** Rough fallback so token counts are never blank when a provider omits usage. */
function estimateTokens(text: string): number {
  return estimateTokens2(text.length);
}

function estimateTokens2(chars: number): number {
  return Math.max(1, Math.round(chars / 4));
}

export interface StreamResult {
  stream: ReadableStream<Uint8Array>;
  /** Resolves with the full assistant text once the upstream stream completes. */
  completion: Promise<{ text: string; reasoning: string }>;
}

export async function streamInference(
  messages: Array<{ role: string; content: string }>,
  model: string,
  env: InferenceEnv
): Promise<StreamResult> {
  const resolved = resolveProvider(model, env);
  if (!resolved) throw new Error(`No provider configured for model: ${model}`);

  const { url, key, model: providerModel } = resolved;

  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: providerModel,
      messages,
      stream: true,
      max_tokens: 4096,
      temperature: 0.7,
    }),
  });

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Provider API error ${response.status}: ${detail.slice(0, 300)}`);
  }

  const promptChars = messages.reduce((n, m) => n + (m.content?.length ?? 0), 0);

  let resolveCompletion!: (v: { text: string; reasoning: string }) => void;
  const completion = new Promise<{ text: string; reasoning: string }>((res) => {
    resolveCompletion = res;
  });

  const upstream = response.body.getReader();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  let text = "";
  let reasoning = "";
  let usage: { input: number; output: number; total: number } | null = null;
  let buffer = "";

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      // Keep reading until this pull actually enqueues something. A chunk that
      // ends mid-frame yields no complete SSE line, and a pull that enqueues
      // nothing is never re-invoked -- which would stall the stream forever.
      for (;;) {
      const { done, value } = await upstream.read();

      if (done) {
        let final = usage;
        if (!final) {
          const input = estimateTokens2(promptChars);
          const output = estimateTokens(text);
          final = { input, output, total: input + output };
        }
        controller.enqueue(encoder.encode(sse({ type: "usage", ...final })));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
        resolveCompletion({ text, reasoning });
        return;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      let enqueued = false;
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;

        try {
          const chunk = JSON.parse(payload) as any;

          if (chunk.usage) {
            usage = {
              input: chunk.usage.prompt_tokens ?? 0,
              output: chunk.usage.completion_tokens ?? 0,
              total: chunk.usage.total_tokens ?? 0,
            };
          }

          const delta = chunk.choices?.[0]?.delta ?? {};
          // Providers disagree on the reasoning field name.
          const think = delta.reasoning_content ?? delta.reasoning;
          if (typeof think === "string" && think) {
            reasoning += think;
            controller.enqueue(encoder.encode(sse({ type: "reasoning", content: think })));
            enqueued = true;
          }
          if (typeof delta.content === "string" && delta.content) {
            text += delta.content;
            controller.enqueue(encoder.encode(sse({ type: "token", content: delta.content })));
            enqueued = true;
          }
        } catch {
          // Skip malformed chunk rather than kill the stream.
        }
      }

      if (enqueued) return;
      }
    },
    cancel() {
      upstream.cancel().catch(() => {});
      resolveCompletion({ text, reasoning });
    },
  });

  return { stream, completion };
}
