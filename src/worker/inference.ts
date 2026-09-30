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

  // OmniRoute fallback
  if (env.OMNIROUTE_KEY) {
    return { url: "https://api.omniroute.tech/v1/chat/completions", key: env.OMNIROUTE_KEY, model };
  }

  return null;
}

interface OmniRouteModel {
  id: string;
  provider: string;
  capabilities?: string[];
  context_length?: number;
  description?: string;
}

// Fetch full model catalog from OmniRoute API
async function fetchOmniRouteModels(apiKey: string): Promise<Array<{ id: string; provider: string }>> {
  try {
    const response = await fetch("https://api.omniroute.tech/v1/models", {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      }
    });

    if (!response.ok) {
      console.warn(`OmniRoute API error: ${response.status}`);
      return [];
    }

    const data = await response.json();
    const models = data.data || data.models || [];
    
    return models.map((model: OmniRouteModel) => ({
      id: model.id,
      provider: model.provider || "OmniRoute"
    }));
  } catch (error) {
    console.warn("Failed to fetch OmniRoute models:", error);
    return [];
  }
}

export async function getAvailableModels(env: InferenceEnv): Promise<Array<{ id: string; provider: string }>> {
  const models: Array<{ id: string; provider: string }> = [];

  // Fetch full OmniRoute catalog if API key is available
  if (env.OMNIROUTE_KEY) {
    const omniRouteModels = await fetchOmniRouteModels(env.OMNIROUTE_KEY);
    models.push(...omniRouteModels);
    
    // Fallback to hardcoded list if API call fails
    if (omniRouteModels.length === 0) {
      models.push(
        { id: "antigravity/claude-sonnet-4-6", provider: "OmniRoute" },
        { id: "agy/claude-sonnet-4-6", provider: "OmniRoute" },
        { id: "no-think/agy/claude-sonnet-4-6", provider: "OmniRoute" },
        { id: "claude-sonnet-failover", provider: "OmniRoute" }
      );
    }
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
      { id: "openai/gpt-4-turbo", provider: "OpenAI" },
      { id: "openai/gpt-3.5-turbo", provider: "OpenAI" }
    );
  }

  if (env.GEMINI_KEY) {
    models.push(
      { id: "gemini/gemini-1.5-pro", provider: "Google" },
      { id: "gemini/gemini-1.5-flash", provider: "Google" }
    );
  }

  return models;
}

export async function streamInference(
  messages: Array<{ role: string; content: string }>,
  model: string,
  env: InferenceEnv
): Promise<ReadableStream> {
  const resolved = resolveProvider(model, env);
  if (!resolved) throw new Error(`No provider configured for model: ${model}`);

  const { url, key, model: providerModel } = resolved;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: providerModel,
      messages,
      stream: true,
      max_tokens: 4096,
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    throw new Error(`Provider API error: ${response.status} ${response.statusText}`);
  }

  return response.body!;
}
