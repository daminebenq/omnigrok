// KV-backed conversation + settings storage.
//
// Key layout:
//   conv:<userId>:<convId>   -> Conversation
//   settings:<userId>        -> UserSettings
// User scoping is in the key, so one user can never read another's thread.

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
  /** Chain-of-thought text, when the provider exposes it separately. */
  reasoning?: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  createdAt: number;
}

export interface Conversation {
  id: string;
  title: string;
  model: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
  /** "generating" while a ChatSession is mid-run, so any device can re-attach. */
  status?: "generating";
  lastError?: string;
}

export interface UserSettings {
  defaultModel: string;
  providers: Record<string, { key?: string; enabled: boolean }>;
  theme: "dark" | "light" | "system";
}

const DEFAULT_SETTINGS: UserSettings = {
  defaultModel: "antigravity/claude-sonnet-4-6",
  providers: {},
  theme: "dark",
};

export async function getConversation(
  kv: KVNamespace,
  userId: string,
  convId: string
): Promise<Conversation | null> {
  return kv.get<Conversation>(`conv:${userId}:${convId}`, "json");
}

export async function listConversations(
  kv: KVNamespace,
  userId: string
): Promise<Conversation[]> {
  const list = await kv.list({ prefix: `conv:${userId}:` });
  const convs = await Promise.all(
    list.keys.map((k) => kv.get<Conversation>(k.name, "json"))
  );
  return (convs.filter(Boolean) as Conversation[]).sort(
    (a, b) => b.updatedAt - a.updatedAt
  );
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
  const stored = await kv.get<UserSettings>(`settings:${userId}`, "json");
  return { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
}

export async function saveSettings(
  kv: KVNamespace,
  userId: string,
  settings: Partial<UserSettings>
): Promise<void> {
  const current = await getSettings(kv, userId);
  await kv.put(`settings:${userId}`, JSON.stringify({ ...current, ...settings }));
}
