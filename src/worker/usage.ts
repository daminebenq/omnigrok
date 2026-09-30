// Usage accounting.
//
// Each completed turn writes its own record rather than incrementing a shared
// daily counter. A single counter key would need read-modify-write, and two
// conversations finishing at once would silently lose one of the updates.
// Aggregation happens on read instead, which is the cheaper trade here.

export interface UsageRecord {
  id: string;
  at: number;
  model: string;
  provider: string;
  task?: string;
  routed: boolean;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  durationMs: number;
  toolCalls: number;
  ok: boolean;
}

const dayKey = (at: number) => new Date(at).toISOString().slice(0, 10);

export async function recordUsage(
  kv: KVNamespace,
  userId: string,
  rec: Omit<UsageRecord, "id">
): Promise<void> {
  const id = crypto.randomUUID();
  const key = `usage:${userId}:${dayKey(rec.at)}:${id}`;
  // 90 days is plenty for the dashboard and keeps the namespace from growing
  // without bound.
  await kv.put(key, JSON.stringify({ id, ...rec }), {
    expirationTtl: 90 * 24 * 60 * 60,
  });
}

export interface UsageBucket {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  errors: number;
  toolCalls: number;
  avgDurationMs: number;
}

export interface UsageSummary {
  from: string;
  to: string;
  totals: UsageBucket;
  byModel: Record<string, UsageBucket>;
  byProvider: Record<string, UsageBucket>;
  byTask: Record<string, UsageBucket>;
  byDay: Record<string, UsageBucket>;
  routedShare: number;
  recent: UsageRecord[];
}

function emptyBucket(): UsageBucket {
  return {
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    errors: 0,
    toolCalls: 0,
    avgDurationMs: 0,
  };
}

function add(b: UsageBucket, r: UsageRecord): void {
  // Keep a running mean so we never hold every duration in memory.
  b.avgDurationMs = (b.avgDurationMs * b.requests + r.durationMs) / (b.requests + 1);
  b.requests += 1;
  b.inputTokens += r.inputTokens;
  b.outputTokens += r.outputTokens;
  b.totalTokens += r.totalTokens;
  b.toolCalls += r.toolCalls;
  if (!r.ok) b.errors += 1;
}

function bump(map: Record<string, UsageBucket>, key: string, r: UsageRecord): void {
  map[key] ??= emptyBucket();
  add(map[key], r);
}

export async function summarizeUsage(
  kv: KVNamespace,
  userId: string,
  days = 30
): Promise<UsageSummary> {
  const now = Date.now();
  const wanted = new Set<string>();
  for (let i = 0; i < days; i++) {
    wanted.add(dayKey(now - i * 86_400_000));
  }

  const records: UsageRecord[] = [];
  for (const day of wanted) {
    const list = await kv.list({ prefix: `usage:${userId}:${day}:` });
    const rows = await Promise.all(list.keys.map((k) => kv.get<UsageRecord>(k.name, "json")));
    for (const r of rows) if (r) records.push(r);
  }
  records.sort((a, b) => b.at - a.at);

  const summary: UsageSummary = {
    from: dayKey(now - (days - 1) * 86_400_000),
    to: dayKey(now),
    totals: emptyBucket(),
    byModel: {},
    byProvider: {},
    byTask: {},
    byDay: {},
    routedShare: 0,
    recent: records.slice(0, 25),
  };

  let routed = 0;
  for (const r of records) {
    add(summary.totals, r);
    bump(summary.byModel, r.model || "unknown", r);
    bump(summary.byProvider, r.provider || "unknown", r);
    bump(summary.byTask, r.task || "unrouted", r);
    bump(summary.byDay, dayKey(r.at), r);
    if (r.routed) routed += 1;
  }
  summary.routedShare = records.length ? routed / records.length : 0;

  return summary;
}
