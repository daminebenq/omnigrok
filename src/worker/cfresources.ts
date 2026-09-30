// Cloudflare account inventory for the stats dashboard.
//
// Needs a CF_API_TOKEN secret with read access. Without it every section
// reports "not configured" rather than silently showing zeros, because an
// empty list and an unconfigured integration mean very different things.

export interface CfEnv {
  CF_API_TOKEN?: string;
  CF_ACCOUNT_ID?: string;
}

export interface ResourceGroup {
  kind: string;
  label: string;
  count: number;
  items: Array<{ name: string; detail?: string }>;
  error?: string;
}

export interface ResourceInventory {
  configured: boolean;
  accountId?: string;
  groups: ResourceGroup[];
  fetchedAt: number;
}

const API = "https://api.cloudflare.com/client/v4";

async function cfGet<T>(token: string, path: string): Promise<{ ok: true; result: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${API}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(12_000),
    });
    const body = (await res.json()) as { success?: boolean; result?: T; errors?: Array<{ message?: string }> };
    if (!res.ok || body.success === false) {
      return { ok: false, error: body.errors?.[0]?.message ?? `HTTP ${res.status}` };
    }
    return { ok: true, result: (body.result ?? []) as T };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "request failed" };
  }
}

type Row = Record<string, unknown>;

function group(
  kind: string,
  label: string,
  res: { ok: true; result: Row[] } | { ok: false; error: string },
  map: (r: Row) => { name: string; detail?: string }
): ResourceGroup {
  if (!res.ok) return { kind, label, count: 0, items: [], error: res.error };
  const rows = Array.isArray(res.result) ? res.result : [];
  return {
    kind,
    label,
    count: rows.length,
    // Cap the payload; the count is the headline, the list is a sample.
    items: rows.slice(0, 50).map(map),
  };
}

export async function getInventory(env: CfEnv): Promise<ResourceInventory> {
  const token = env.CF_API_TOKEN;
  const account = env.CF_ACCOUNT_ID;
  if (!token || !account) {
    return { configured: false, groups: [], fetchedAt: Date.now() };
  }

  const [workers, kv, r2, d1, zones, queues, pages, tunnels] = await Promise.all([
    cfGet<Row[]>(token, `/accounts/${account}/workers/scripts`),
    cfGet<Row[]>(token, `/accounts/${account}/storage/kv/namespaces`),
    cfGet<Row[]>(token, `/accounts/${account}/r2/buckets`),
    cfGet<Row[]>(token, `/accounts/${account}/d1/database`),
    cfGet<Row[]>(token, `/zones?per_page=50`),
    cfGet<Row[]>(token, `/accounts/${account}/queues`),
    cfGet<Row[]>(token, `/accounts/${account}/pages/projects`),
    cfGet<Row[]>(token, `/accounts/${account}/cfd_tunnel?is_deleted=false`),
  ]);

  const groups: ResourceGroup[] = [
    group("workers", "Workers", workers, (r) => ({
      name: String(r.id ?? "unnamed"),
      detail: r.modified_on ? `updated ${String(r.modified_on).slice(0, 10)}` : undefined,
    })),
    group("kv", "KV namespaces", kv, (r) => ({ name: String(r.title ?? r.id) })),
    // R2 returns { buckets: [...] } rather than a bare array.
    group(
      "r2",
      "R2 buckets",
      r2.ok
        ? { ok: true, result: ((r2.result as unknown as { buckets?: Row[] })?.buckets ?? (r2.result as Row[])) }
        : r2,
      (r) => ({ name: String(r.name), detail: r.creation_date ? String(r.creation_date).slice(0, 10) : undefined })
    ),
    group("d1", "D1 databases", d1, (r) => ({ name: String(r.name ?? r.uuid) })),
    group("zones", "Zones", zones, (r) => ({ name: String(r.name), detail: String(r.status ?? "") })),
    group("queues", "Queues", queues, (r) => ({ name: String(r.queue_name ?? r.queue_id) })),
    group("pages", "Pages projects", pages, (r) => ({ name: String(r.name) })),
    group("tunnels", "Tunnels", tunnels, (r) => ({
      name: String(r.name),
      detail: String(r.status ?? ""),
    })),
  ];

  return { configured: true, accountId: account, groups, fetchedAt: Date.now() };
}
