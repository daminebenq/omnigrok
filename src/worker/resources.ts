// Generic per-user record storage for agents, projects and MCP servers.
// One implementation, three collections — they differ only in payload shape.

export type Collection = "agents" | "projects" | "mcps" | "files";

export const COLLECTIONS: Collection[] = ["agents", "projects", "mcps"];

export function isCollection(v: string): v is Collection {
  return (COLLECTIONS as string[]).includes(v);
}

export interface BaseRecord {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  [key: string]: unknown;
}

export interface Agent extends BaseRecord {
  description: string;
  systemPrompt: string;
  model: string;
  tools: string[];
}

export interface Project extends BaseRecord {
  description: string;
  conversationIds: string[];
}

export interface McpServer extends BaseRecord {
  url: string;
  /** Stored server-side only; never returned to the browser. */
  authToken?: string;
  enabled: boolean;
}

const key = (userId: string, col: Collection, id: string) => `${col}:${userId}:${id}`;

export async function listRecords<T extends BaseRecord>(
  kv: KVNamespace,
  userId: string,
  col: Collection
): Promise<T[]> {
  const list = await kv.list({ prefix: `${col}:${userId}:` });
  const rows = await Promise.all(list.keys.map((k) => kv.get<T>(k.name, "json")));
  return (rows.filter(Boolean) as T[]).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getRecord<T extends BaseRecord>(
  kv: KVNamespace,
  userId: string,
  col: Collection,
  id: string
): Promise<T | null> {
  return kv.get<T>(key(userId, col, id), "json");
}

export async function putRecord<T extends BaseRecord>(
  kv: KVNamespace,
  userId: string,
  col: Collection,
  record: T
): Promise<T> {
  const now = Date.now();
  const saved = { ...record, createdAt: record.createdAt || now, updatedAt: now };
  await kv.put(key(userId, col, saved.id), JSON.stringify(saved));
  return saved;
}

export async function deleteRecord(
  kv: KVNamespace,
  userId: string,
  col: Collection,
  id: string
): Promise<void> {
  await kv.delete(key(userId, col, id));
}

/** Strips fields that must never reach the browser (e.g. MCP auth tokens). */
export function redact<T extends BaseRecord>(col: Collection, record: T): T {
  if (col !== "mcps") return record;
  const { authToken, ...rest } = record as unknown as McpServer;
  return { ...rest, hasAuth: Boolean(authToken) } as unknown as T;
}
