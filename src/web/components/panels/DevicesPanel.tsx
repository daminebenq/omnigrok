import { useCallback, useEffect, useState } from "react";
import { useResource, type ResourceRecord } from "../../lib/useResource";
import {
  PanelShell, PrimaryButton, Field, inputClass, EmptyState, Skeleton, ErrorNote, DeleteButton,
} from "./PanelShell";
import { Icon } from "../Icon";

interface Device extends ResourceRecord {
  url?: string;
  enabled?: boolean;
  readOnly?: boolean;
  hasHostToken?: boolean;
  hasServiceToken?: boolean;
  accessClientId?: string;
}
type Draft = Device & { hostToken?: string; accessClientSecret?: string };

interface Health {
  ok: boolean; name?: string; platform?: string; release?: string; arch?: string;
  cpuCount?: number; memUsedPct?: number; uptimeSeconds?: number;
  roots?: string[]; readOnly?: boolean; error?: string;
}

const gb = (n?: number) => (n ? `${(n / 1024 ** 3).toFixed(1)} GB` : "—");
const dur = (s?: number) => {
  if (!s) return "—";
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600);
  return d ? `${d}d ${h}h` : `${h}h`;
};

export function DevicesPanel() {
  const { items, loading, error, save, remove } = useResource<Device>("devices");
  const [editing, setEditing] = useState<Draft | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [health, setHealth] = useState<Record<string, Health>>({});
  const [checking, setChecking] = useState<string | null>(null);

  const check = useCallback(async (id: string) => {
    setChecking(id);
    try {
      const res = await fetch(`/api/devices/${id}/health`);
      const body = (await res.json()) as Health;
      setHealth((h) => ({ ...h, [id]: body }));
    } catch {
      setHealth((h) => ({ ...h, [id]: { ok: false, error: "unreachable" } }));
    } finally {
      setChecking(null);
    }
  }, []);

  useEffect(() => {
    for (const d of items) if (d.enabled !== false && !health[d.id]) void check(d.id);
    // Checking once per device on load is enough; a manual refresh re-runs it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    try {
      setSaveError(null);
      new URL(editing.url ?? "");
      const { id, ...rest } = editing;
      await save(id ? editing : rest);
      setEditing(null);
    } catch (err) {
      setSaveError(
        err instanceof TypeError ? "Enter a valid device URL"
          : err instanceof Error ? err.message : "Save failed"
      );
    }
  };

  return (
    <PanelShell
      title="Devices"
      description="Machines running the OmniGrok host agent. The model can browse and run commands on them."
      action={
        <PrimaryButton icon="plus"
          onClick={() => { setEditing({ id: "", name: "", url: "", enabled: true, createdAt: 0, updatedAt: 0 }); setSaveError(null); }}>
          Add device
        </PrimaryButton>
      }
    >
      {error && <ErrorNote message={error} />}

      {editing && (
        <form onSubmit={submit} className="mb-6 p-4 rounded-xl bg-bg-secondary border border-border-default">
          {saveError && <ErrorNote message={saveError} />}
          <Field label="Name" hint="How you will refer to it in chat, e.g. 'macbook' or 'scaleway'">
            <input className={inputClass} value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              placeholder="macbook" required />
          </Field>
          <Field label="Tunnel URL" hint="The public hostname your cloudflared tunnel maps to the agent">
            <input className={inputClass} type="url" value={editing.url ?? ""}
              onChange={(e) => setEditing({ ...editing, url: e.target.value })}
              placeholder="https://macbook.damineweb.work" required />
          </Field>
          <Field
            label="Host agent token"
            hint={editing.hasHostToken ? "A token is stored. Leave blank to keep it." : "The OMNIGROK_HOST_TOKEN you set on the machine."}
          >
            <input className={inputClass} type="password" autoComplete="off" value={editing.hostToken ?? ""}
              onChange={(e) => setEditing({ ...editing, hostToken: e.target.value })}
              placeholder={editing.hasHostToken ? "Unchanged" : "Shared secret"} />
          </Field>

          <fieldset className="border border-border-subtle rounded-lg p-3 mb-3">
            <legend className="text-xs font-medium text-text-secondary px-1">Cloudflare Access service token</legend>
            <p className="text-xs text-text-tertiary mb-2.5">
              Required if the tunnel hostname is behind Access, which it should be.
            </p>
            <Field label="Client ID">
              <input className={inputClass} autoComplete="off" value={editing.accessClientId ?? ""}
                onChange={(e) => setEditing({ ...editing, accessClientId: e.target.value })}
                placeholder="xxxx.access" />
            </Field>
            <Field label="Client secret" hint={editing.hasServiceToken ? "A secret is stored. Leave blank to keep it." : undefined}>
              <input className={inputClass} type="password" autoComplete="off" value={editing.accessClientSecret ?? ""}
                onChange={(e) => setEditing({ ...editing, accessClientSecret: e.target.value })}
                placeholder={editing.hasServiceToken ? "Unchanged" : "Service token secret"} />
            </Field>
          </fieldset>

          <div className="flex flex-wrap gap-4 mb-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={editing.enabled ?? true} className="accent-accent-purple"
                onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })} />
              <span className="text-sm text-text-secondary">Enabled</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={editing.readOnly ?? false} className="accent-accent-purple"
                onChange={(e) => setEditing({ ...editing, readOnly: e.target.checked })} />
              <span className="text-sm text-text-secondary">Read-only (no commands, no writes)</span>
            </label>
          </div>

          <div className="flex gap-2">
            <PrimaryButton type="submit" icon="check">Save device</PrimaryButton>
            <button type="button" onClick={() => setEditing(null)}
              className="px-3.5 py-2 rounded-lg text-sm text-text-tertiary hover:text-text-primary hover:bg-bg-hover
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-purple/60">
              Cancel
            </button>
          </div>
        </form>
      )}

      {loading ? <Skeleton /> : items.length === 0 && !editing ? (
        <EmptyState icon="agents" message="No devices connected. Run the host agent on a machine, then add it here." />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {items.map((d) => {
            const h = health[d.id];
            return (
              <li key={d.id} className="p-4 rounded-xl bg-bg-secondary border border-border-subtle">
                <div className="flex items-start gap-2 mb-2">
                  <span aria-label={h?.ok ? "Online" : "Offline"}
                    className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${
                      !d.enabled ? "bg-text-tertiary" : h?.ok ? "bg-accent-green" : "bg-accent-red"
                    }`} />
                  <div className="flex-1 min-w-0">
                    <button onClick={() => { setEditing(d); setSaveError(null); }}
                      className="text-sm font-medium text-text-primary hover:text-accent-purple transition-colors
                        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-purple/60 rounded">
                      {d.name}
                    </button>
                    <p className="text-xs text-text-tertiary truncate font-mono">{d.url}</p>
                  </div>
                  <button onClick={() => void check(d.id)} aria-label={`Refresh ${d.name}`}
                    className="p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-bg-hover
                      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-purple/60">
                    <Icon name="refresh" size={13} className={checking === d.id ? "animate-spin" : ""} />
                  </button>
                  <DeleteButton onClick={() => void remove(d.id)} label={`Remove ${d.name}`} />
                </div>

                {h?.ok ? (
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs mt-3">
                    <div><dt className="text-text-tertiary inline">OS </dt>
                      <dd className="text-text-secondary inline">{h.platform} {h.arch}</dd></div>
                    <div><dt className="text-text-tertiary inline">CPUs </dt>
                      <dd className="text-text-secondary inline">{h.cpuCount ?? "—"}</dd></div>
                    <div><dt className="text-text-tertiary inline">Memory </dt>
                      <dd className="text-text-secondary inline">{h.memUsedPct ?? "—"}% used</dd></div>
                    <div><dt className="text-text-tertiary inline">Uptime </dt>
                      <dd className="text-text-secondary inline">{dur(h.uptimeSeconds)}</dd></div>
                  </dl>
                ) : h ? (
                  <p className="text-xs text-accent-red mt-2 break-words">{h.error}</p>
                ) : (
                  <p className="text-xs text-text-tertiary mt-2">Checking…</p>
                )}

                {(d.readOnly || h?.readOnly) && (
                  <span className="inline-block mt-2 px-1.5 py-0.5 rounded bg-bg-tertiary text-xs text-text-tertiary">
                    read-only
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </PanelShell>
  );
}
