// Thin fetch wrapper for all /api/* calls.

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function af<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "Unknown error");
    throw new ApiError(res.status, text);
  }
  return res.json() as Promise<T>;
}

export type Capability = "reasoning" | "vision" | "coding" | "audio" | "image" | "tools";

export interface ModelInfo {
  id: string;
  provider: string;
  capabilities: Capability[];
  contextLength?: number;
  reputation: number;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: string;
  status: "pending" | "done" | "error";
}

export interface Message {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  reasoning?: string;
  toolCalls?: ToolCall[];
  createdAt: number;
}

export interface Conversation {
  id: string;
  title: string;
  model: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

export interface TokenUsage {
  input: number;
  output: number;
  total: number;
}

export interface ToolEvent {
  id: string;
  name: string;
  status: "running" | "done" | "error";
  detail?: string;
}

export const api = {
  getModels: async (): Promise<ModelInfo[]> => {
    const res = await af<{ models: ModelInfo[] }>("/api/models");
    return res.models;
  },
  getConversations: async (): Promise<Conversation[]> => {
    const res = await af<{ conversations: Conversation[] }>("/api/conversations");
    return res.conversations;
  },
  getConversation: (id: string) => af<Conversation>(`/api/conversations/${id}`),
  saveConversation: (conv: Conversation) =>
    af<{ ok: boolean }>("/api/conversations", {
      method: "POST",
      body: JSON.stringify(conv),
    }),
  deleteConversation: (id: string) =>
    af<{ ok: boolean }>(`/api/conversations/${id}`, { method: "DELETE" }),
  getSettings: () => af<Record<string, unknown>>("/api/settings"),
  saveSettings: (s: Record<string, unknown>) =>
    af<{ ok: boolean }>("/api/settings", { method: "POST", body: JSON.stringify(s) }),
};

/**
 * Consumes the worker's normalized SSE protocol:
 *   {"type":"token"|"reasoning","content":"..."} | {"type":"usage",...}
 */
export async function streamChat({
  conversationId,
  messages,
  model,
  onToken,
  onReasoning,
  onUsage,
  onTool,
  signal,
}: {
  conversationId: string;
  messages: Message[];
  model: string;
  onToken: (chunk: string) => void;
  onReasoning?: (chunk: string) => void;
  onUsage?: (usage: TokenUsage) => void;
  onTool?: (evt: ToolEvent) => void;
  signal?: AbortSignal;
}): Promise<void> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversationId, messages, model }),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "Unknown error");
    let msg = text;
    try {
      msg = (JSON.parse(text) as { error?: string }).error ?? text;
    } catch {
      /* plain-text error */
    }
    throw new ApiError(res.status, msg);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";
  let streamError: string | null = null;

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
        if (!payload || payload === "[DONE]") continue;

        try {
          const evt = JSON.parse(payload) as {
            type?: string;
            content?: string;
            input?: number;
            output?: number;
            total?: number;
            id?: string;
            name?: string;
            status?: ToolEvent["status"];
            detail?: string;
            message?: string;
          };
          if (evt.type === "token" && evt.content) onToken(evt.content);
          else if (evt.type === "reasoning" && evt.content) onReasoning?.(evt.content);
          else if (evt.type === "usage") {
            onUsage?.({ input: evt.input ?? 0, output: evt.output ?? 0, total: evt.total ?? 0 });
          } else if (evt.type === "tool" && evt.id && evt.name && evt.status) {
            onTool?.({ id: evt.id, name: evt.name, status: evt.status, detail: evt.detail });
          } else if (evt.type === "error") {
            // The stream opened with 200 before the provider failed, so the
            // error arrives in-band rather than as an HTTP status.
            streamError = evt.message ?? "Inference failed";
          }
        } catch {
          // Skip malformed chunk rather than abort the stream.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (streamError) throw new ApiError(502, streamError);
}
