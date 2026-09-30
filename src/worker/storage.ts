// KV-backed conversation + settings storage

export interface Message {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  createdAt: number;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: string;
  status: "pending" | "done" | "error";
}

export interface Conversation {
  id: string;
  title: string;
  model: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

export interface UserSettings {
  defaultModel: string;
  providers: Record<string, { key?: string; enabled: boolean }>;
  theme: "dark";
}

export async function getConversation(
  kv: KVNamespace,
  userId: string,
  convId: string
): Promise<Conversation | null> {
  const raw = await kv.get(`conv:${userId}:${convId}`);
  return raw ? JSON.parse(raw) : null;
}

export async function listConversations(
  kv: KVNamespace,
  userId: string
): Promise<Conversation[]> {
  const list = await kv.list({ prefix: `conv:${userId}:` });
  const convs = await Promise.all(
    list.keys.map(async (k) => {
      const raw = await kv.get(k.name);
      return raw ? JSON.parse(raw) : null;
    })
  );
  return (convs.filter(Boolean) as Conversation[]).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveConversation(
  kv: KVNamespace,
  userId: string,
  conv: Conversation
): Promise<void> {
  await kv.put(`conv:${userId}:${conv.id}`, JSON.stringify(conv));
}

export async function deleteConversation(
  kv: KVNamespace,
  userId: string,
  convId: string
): Promise<void> {
  await kv.delete(`conv:${userId}:${convId}`);
}

export async function getSettings(
  kv: KVNamespace,
  userId: string
): Promise<UserSettings> {
  const raw = await kv.get(`settings:${userId}`);
  if (raw) return JSON.parse(raw);
  return {
    defaultModel: "antigravity/claude-sonnet-4-6",
    providers: {},
    theme: "dark",
  };
}

export async function saveSettings(
  kv: KVNamespace,
  userId: string,
  settings: UserSettings
): Promise<void> {
  await kv.put(`settings:${userId}`, JSON.stringify(settings));
}
