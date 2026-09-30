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
  timestamp: number;
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
  getModels: async (): Promise<ModelInfo[]> => {
    const res = await af<{ models: ModelInfo[] }>("/api/models");
    return res.models;
  },
  getConversations: () => af<{ conversations: Conversation[] }>("/api/conversations"),
  getConversation: (id: string) => af<Conversation>(`/api/conversations/${id}`),
  deleteConversation: (id: string) =>
    af<{ ok: boolean }>(`/api/conversations/${id}`, { method: "DELETE" }),
  getSettings: () => af<Record<string, unknown>>("/api/settings"),
  saveSettings: (s: Record<string, unknown>) =>
    af<{ ok: boolean }>("/api/settings", { method: "POST", body: JSON.stringify(s) }),
};

export async function streamChat({
  messages,
  model,
  onChunk,
}: {
  messages: Message[];
  model: string;
  onChunk: (chunk: string) => void;
}): Promise<void> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, model }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "Unknown error");
    throw new ApiError(res.status, text);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      
      // Process complete lines
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer
      
      for (const line of lines) {
        if (line.trim() && line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data !== '[DONE]') {
            try {
              const parsed = JSON.parse(data);
              if (parsed.content) {
                onChunk(parsed.content);
              }
            } catch (e) {
              // Ignore malformed JSON chunks
            }
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
