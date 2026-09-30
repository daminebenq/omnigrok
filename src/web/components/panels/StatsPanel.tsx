import { useCallback, useEffect, useState } from "react";
import { PanelShell, Skeleton, ErrorNote, EmptyState } from "./PanelShell";
import { Icon } from "../Icon";

interface Bucket {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  errors: number;
  toolCalls: number;
  avgDurationMs: number;
}
interface UsageSummary {
  from: string;
  to: string;
  totals: Bucket;
  byModel: Record<string, Bucket>;
  byProvider: Record<string, Bucket>;
  byTask: Record<string, Bucket>;
  byDay: Record<string, Bucket>;
  routedShare: number;
  recent: Array<{
    id: string; at: number; model: string; provider: string; task?: string;
    routed: boolean; totalTokens: number; durationMs: number; toolCalls: number; ok: boolean;
  }>;
}
interface ResourceGroup {
  kind: string; label: string; count: number;
  items: Array<{ name: string; detail?: string }>; error?: string;
}
interface Inventory { configured: boolean; accountId?: string; groups: ResourceGroup[]; }

const nf = (n: number) => n.toLocaleString();
const ms = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${Math.round(n)}ms`);

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-bg-secondary border border-border-subtle rounded-xl p-3.5">
      <div className="text-xs text-text-tertiary">{label}</div>
      <div className="text-xl font-semibold text-text-primary mt-1 tabular-nums">{value}</div>
      {sub && <div className="text-xs text-text-tertiary mt-0.5">{sub}</div>}
    </div>
  );
}

/** Horizontal bars. A chart library would be a lot of bytes for this. */
function BarList({ title, data, unit }: { title: string; data: Record<string, Bucket>; unit: "tokens" | "requests" }) {
  const rows = Object.entries(data)
    .map(([k, b]) => ({ key: k, value: unit === "tokens" ? b.totalTokens : b.requests, b }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
  const max = Math.max(1, ...rows.map((r) => r.value));

  if (!rows.length) {
    return (
      <section className="bg-bg-secondary border border-border-subtle rounded-xl p-4">
        <h3 className="text-sm font-semibold text-text-primary mb-2">{title}</h3>
        <p className="text-xs text-text-tertiary">No data yet.</p>
      </section>
    );
  }

  return (
    <section className="bg-bg-secondary border border-border-subtle rounded-xl p-4">
      <h3 className="text-sm font-semibold text-text-primary mb-3">{title}</h3>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.key}>
            <div className="flex items-baseline justify-between gap-2 mb-1">
              <span className="text-xs text-text-secondary font-mono truncate">{r.key}</span>
              <span className="text-xs text-text-tertiary tabular-nums shrink-0">
                {nf(r.value)} {unit === "tokens" ? "tok" : "req"}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-bg-tertiary overflow-hidden">
              <div
                className="h-full rounded-full bg-accent-purple"
                style={{ width: `${(r.value / max) * 100}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function DailyChart({ byDay }: { byDay: Record<string, Bucket> }) {
  const days = Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b)).slice(-30);
  const max = Math.max(1, ...days.map(([, b]) => b.totalTokens));
  if (!days.length) return null;

  return (
    <section className="bg-bg-secondary border border-border-subtle rounded-xl p-4">
      <h3 className="text-sm font-semibold text-text-primary mb-3">Tokens per day</h3>
      <div className="flex items-end gap-1 h-28" role="img" aria-label="Daily token usage">
        {days.map(([day, b]) => (
          // h-full matters: without it the percentage heights below resolve
          // against an auto-height parent and every bar collapses to nothing.
          <div key={day} className="flex-1 min-w-0 h-full flex items-end group">
            <div
              className="w-full rounded-t bg-accent-purple/70 group-hover:bg-accent-purple transition-colors"
              style={{ height: `${Math.max(2, (b.totalTokens / max) * 100)}%` }}
              title={`${day}: ${nf(b.totalTokens)} tokens, ${nf(b.requests)} requests`}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-between text-xs text-text-tertiary mt-2">
        <span>{days[0][0]}</span>
        <span>{days[days.length - 1][0]}</span>
      </div>
    </section>
  );
}

export function StatsPanel() {
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [inv, setInv] = useState<Inventory | null>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [u, r] = await Promise.all([
        fetch(`/api/usage?days=${days}`).then((x) => (x.ok ? x.json() : Promise.reject(new Error("usage failed")))),
        fetch("/api/resources").then((x) => (x.ok ? x.json() : null)).catch(() => null),
      ]);
      setUsage(u as UsageSummary);
      setInv(r as Inventory | null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load stats");
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { void load(); }, [load]);

  const t = usage?.totals;

  return (
    <PanelShell
      title="Stats"
      description={usage ? `Usage from ${usage.from} to ${usage.to}.` : "Token, provider and resource usage."}
      action={
        <div className="flex items-center gap-2">
          <label htmlFor="range" className="sr-only">Time range</label>
          <select id="range" value={days} onChange={(e) => setDays(Number(e.target.value))}
            className="px-2.5 py-1.5 rounded-lg bg-bg-tertiary border border-border-default text-sm text-text-primary
              outline-none focus:border-accent-purple/60">
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
          </select>
          <button onClick={() => void load()} aria-label="Refresh stats"
            className="p-2 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-bg-hover
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-purple/60">
            <Icon name="refresh" size={14} />
          </button>
        </div>
      }
    >
      {error && <ErrorNote message={error} />}
      {loading && !usage ? <Skeleton rows={4} /> : null}

      {t && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <Stat label="Requests" value={nf(t.requests)} sub={t.errors ? `${nf(t.errors)} failed` : "no failures"} />
            <Stat label="Total tokens" value={nf(t.totalTokens)}
              sub={`${nf(t.inputTokens)} in / ${nf(t.outputTokens)} out`} />
            <Stat label="Avg response" value={t.requests ? ms(t.avgDurationMs) : "—"}
              sub={`${nf(t.toolCalls)} tool calls`} />
            <Stat label="Auto-routed" value={`${Math.round((usage?.routedShare ?? 0) * 100)}%`}
              sub="of requests" />
          </div>

          {t.requests === 0 ? (
            <EmptyState icon="spark" message="No requests recorded in this window yet." />
          ) : (
            <div className="grid gap-3 lg:grid-cols-2 mb-4">
              <DailyChart byDay={usage!.byDay} />
              <BarList title="Tokens by model" data={usage!.byModel} unit="tokens" />
              <BarList title="Requests by provider" data={usage!.byProvider} unit="requests" />
              <BarList title="Requests by routed task" data={usage!.byTask} unit="requests" />
            </div>
          )}
        </>
      )}

      <section className="mt-2">
        <h3 className="text-sm font-semibold text-text-primary mb-3">Cloudflare resources</h3>
        {!inv ? (
          <p className="text-xs text-text-tertiary">Could not reach the resource inventory.</p>
        ) : !inv.configured ? (
          <div className="p-4 rounded-xl bg-bg-secondary border border-border-default">
            <div className="flex items-start gap-2">
              <Icon name="warning" size={15} className="text-accent-yellow mt-0.5 shrink-0" />
              <div className="text-sm">
                <p className="text-text-primary font-medium mb-1">Resource inventory not configured</p>
                <p className="text-text-tertiary text-xs leading-relaxed">
                  Set the <code className="font-mono text-text-secondary">CF_API_TOKEN</code> and
                  {" "}<code className="font-mono text-text-secondary">CF_ACCOUNT_ID</code> worker secrets
                  to list Workers, KV, R2, D1, zones, queues, Pages and tunnels here.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {inv.groups.map((g) => (
              <div key={g.kind} className="bg-bg-secondary border border-border-subtle rounded-xl p-3.5">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-text-tertiary">{g.label}</span>
                  <span className="text-lg font-semibold text-text-primary tabular-nums">
                    {g.error ? "—" : nf(g.count)}
                  </span>
                </div>
                {g.error ? (
                  <p className="text-xs text-accent-yellow mt-1 break-words">{g.error}</p>
                ) : (
                  <ul className="mt-2 space-y-0.5">
                    {g.items.slice(0, 4).map((it) => (
                      <li key={it.name} className="text-xs text-text-tertiary truncate font-mono">{it.name}</li>
                    ))}
                    {g.count > 4 && (
                      <li className="text-xs text-text-tertiary">+{g.count - 4} more</li>
                    )}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {usage && usage.recent.length > 0 && (
        <section className="mt-4">
          <h3 className="text-sm font-semibold text-text-primary mb-3">Recent requests</h3>
          <div className="overflow-x-auto rounded-xl border border-border-subtle">
            <table className="w-full text-xs">
              <thead className="bg-bg-tertiary text-text-tertiary">
                <tr>
                  <th className="text-left font-medium px-3 py-2">When</th>
                  <th className="text-left font-medium px-3 py-2">Model</th>
                  <th className="text-left font-medium px-3 py-2">Task</th>
                  <th className="text-right font-medium px-3 py-2">Tokens</th>
                  <th className="text-right font-medium px-3 py-2">Time</th>
                </tr>
              </thead>
              <tbody>
                {usage.recent.map((r) => (
                  <tr key={r.id} className="border-t border-border-subtle">
                    <td className="px-3 py-2 text-text-tertiary whitespace-nowrap">
                      {new Date(r.at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 font-mono text-text-secondary truncate max-w-[220px]">
                      {r.model}
                      {!r.ok && <span className="ml-1.5 text-accent-red">failed</span>}
                    </td>
                    <td className="px-3 py-2 text-text-tertiary">
                      {r.routed ? r.task ?? "auto" : "manual"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-text-secondary">{nf(r.totalTokens)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-text-tertiary">{ms(r.durationMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </PanelShell>
  );
}
