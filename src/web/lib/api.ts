// Thin fetch wrapper for all /api/* calls

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

export interface Conversation {
  id: string;
  title: string;
  model: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

export interface Message {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCall[];
  createdAt: number;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: string;
  status: "pending" | "done" | "error";
}

export interface ModelInfo {
  id: string;
  provider: string;
}

export const api = {
  models: () => af<{ models: ModelInfo[] }>("/api/models"),
  conversations: () => af<{ conversations: Conversation[] }>("/api/conversations"),
  conversation: (id: string) => af<Conversation>(`/api/conversations/${id}`),
  deleteConversation: (id: string) =>
    af<{ ok: boolean }>(`/api/conversations/${id}`, { method: "DELETE" }),
  settings: () => af<Record<string, unknown>>("/api/settings"),
  saveSettings: (s: Record<string, unknown>) =>
    af<{ ok: boolean }>("/api/settings", { method: "POST", body: JSON.stringify(s) }),
};

export async function* streamChat(
  model: string,
  messages: Array<{ role: string; content: string }>,
  conversationId?: string
): AsyncGenerator<string, void, unknown> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, conversationId }),
  });

  if (!res.ok || !res.body) {
    throw new ApiError(res.status, await res.text().catch(() => "Stream failed"));
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") return;
      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        // skip malformed
      }
    }
  }
}
