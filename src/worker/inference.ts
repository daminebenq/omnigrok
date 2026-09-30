// Provider routing + streaming proxy

export interface ProviderConfig {
  prefix: string;
  label: string;
  url: string;
  keyEnv: string;
  anthropicFormat?: boolean;
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

function resolveProvider(model: string, env: InferenceEnv): { url: string; key: string; model: string } | null {
  for (const p of PROVIDERS) {
    if (model.startsWith(p.prefix + "/")) {
      const key = (env as any)[p.keyEnv];
      if (!key) return null;
      return { url: p.url, key, model: model.slice(p.prefix.length + 1) };
    }
  }
  // fallback: OmniRoute
  if (!env.OMNIROUTE_KEY) return null;
  return {
    url: "https://omniroute.damineweb.work/v1/chat/completions",
    key: env.OMNIROUTE_KEY,
    model,
  };
}

export async function streamInference(
  model: string,
  messages: Array<{ role: string; content: string }>,
  tools: unknown[],
  env: InferenceEnv
): Promise<Response> {
  const route = resolveProvider(model, env);
  if (!route) {
    return new Response("No provider configured for this model", { status: 503 });
  }

  const body = JSON.stringify({
    model: route.model,
    messages,
    stream: true,
    tools: tools.length > 0 ? tools : undefined,
  });

  const upstream = await fetch(route.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${route.key}`,
    },
    body,
  });

  if (!upstream.ok) {
    const err = await upstream.text();
    return new Response(err, { status: upstream.status });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}

export function getAvailableModels(env: InferenceEnv): Array<{ id: string; provider: string }> {
  const models: Array<{ id: string; provider: string }> = [];

  if (env.OMNIROUTE_KEY) {
    models.push(
      { id: "antigravity/claude-sonnet-4-6", provider: "OmniRoute" },
      { id: "agy/claude-sonnet-4-6", provider: "OmniRoute" },
      { id: "no-think/agy/claude-sonnet-4-6", provider: "OmniRoute" },
      { id: "claude-sonnet-failover", provider: "OmniRoute" }
    );
  }
  if (env.GROQ_KEY) {
    models.push(
      { id: "groq/llama-3.1-70b-versatile", provider: "Groq" },
      { id: "groq/llama-3.1-8b-instant", provider: "Groq" },
      { id: "groq/mixtral-8x7b-32768", provider: "Groq" }
    );
  }
  if (env.OPENAI_KEY) {
    models.push(
      { id: "openai/gpt-4o", provider: "OpenAI" },
      { id: "openai/gpt-4o-mini", provider: "OpenAI" },
      { id: "openai/o1-preview", provider: "OpenAI" }
    );
  }
  if (env.GEMINI_KEY) {
    models.push(
      { id: "gemini/gemini-1.5-pro", provider: "Google" },
      { id: "gemini/gemini-1.5-flash", provider: "Google" }
    );
  }
  if (env.NVIDIA_KEY) {
    models.push({ id: "nvidia/meta/llama-3.1-70b-instruct", provider: "NVIDIA NIM" });
  }
  if (env.TOGETHER_KEY) {
    models.push({ id: "together/meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo", provider: "Together AI" });
  }
  if (env.HF_KEY) {
    models.push({ id: "hf/meta-llama/Meta-Llama-3.1-8B-Instruct", provider: "Hugging Face" });
  }
  return models;
}
