import { useState } from "react";
import { useResource, type ResourceRecord } from "../../lib/useResource";
import {
  PanelShell, PrimaryButton, Field, inputClass, EmptyState, Skeleton, ErrorNote, DeleteButton,
} from "./PanelShell";
import { Icon } from "../Icon";

interface McpServer extends ResourceRecord {
  url?: string;
  enabled?: boolean;
  hasAuth?: boolean;
  hasServiceToken?: boolean;
  accessClientId?: string;
}

type Draft = McpServer & { authToken?: string; accessClientSecret?: string };

interface ProbeResult {
  ok: boolean;
  serverName?: string;
  tools: Array<{ name: string; description?: string }>;
  error?: string;
}

export function McpPanel() {
  const { items, loading, error, save, remove } = useResource<McpServer>("mcps");
  const [editing, setEditing] = useState<Draft | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [probing, setProbing] = useState(false);

  const blank: Draft = {
    id: "", name: "", url: "", enabled: true, createdAt: 0, updatedAt: 0,
  };

  const open = (v: Draft) => { setEditing(v); setSaveError(null); setProbe(null); };

  const runProbe = async () => {
    if (!editing?.url) return;
    setProbing(true);
    setProbe(null);
    try {
      const res = await fetch("/api/mcp/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editing.id || undefined,
          url: editing.url,
          authToken: editing.authToken,
          accessClientId: editing.accessClientId,
          accessClientSecret: editing.accessClientSecret,
        }),
      });
      setProbe((await res.json()) as ProbeResult);
    } catch (e) {
      setProbe({ ok: false, tools: [], error: e instanceof Error ? e.message : "probe failed" });
    } finally {
      setProbing(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    try {
      setSaveError(null);
      new URL(editing.url ?? "");
      const { id, ...rest } = editing;
      await save(id ? editing : rest);
      setEditing(null);
      setProbe(null);
    } catch (err) {
      setSaveError(
        err instanceof TypeError ? "Enter a valid server URL"
          : err instanceof Error ? err.message : "Save failed"
      );
    }
  };

  return (
    <PanelShell
      title="MCP servers"
      description="Connected servers add their tools to what the model can call."
      action={<PrimaryButton icon="plus" onClick={() => open(blank)}>Connect server</PrimaryButton>}
    >
      {error && <ErrorNote message={error} />}

      {editing && (
        <form onSubmit={submit} className="mb-6 p-4 rounded-xl bg-bg-secondary border border-border-default">
          {saveError && <ErrorNote message={saveError} />}

          <Field label="Name">
            <input className={inputClass} value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              placeholder="Scrapling" required />
          </Field>
          <Field label="Server URL" hint="The MCP endpoint, usually ending in /mcp">
            <input className={inputClass} type="url" value={editing.url ?? ""}
              onChange={(e) => setEditing({ ...editing, url: e.target.value })}
              placeholder="https://scrapling.facilemacile.ltd/mcp" required />
          </Field>

          <Field
            label="Bearer token"
            hint={editing.hasAuth ? "A token is stored. Leave blank to keep it." : "Optional. Stored server-side only."}
          >
            <input className={inputClass} type="password" autoComplete="off"
              value={editing.authToken ?? ""}
              onChange={(e) => setEditing({ ...editing, authToken: e.target.value })}
              placeholder={editing.hasAuth ? "Unchanged" : "Bearer token"} />
          </Field>

          <fieldset className="border border-border-subtle rounded-lg p-3 mb-3">
            <legend className="text-xs font-medium text-text-secondary px-1">
              Cloudflare Access service token
            </legend>
            <p className="text-xs text-text-tertiary mb-2.5">
              Required for servers behind Access. A browser one-time-PIN login cannot be
              replayed from the worker, so a service token is the only way in.
            </p>
            <Field label="Client ID">
              <input className={inputClass} autoComplete="off" value={editing.accessClientId ?? ""}
                onChange={(e) => setEditing({ ...editing, accessClientId: e.target.value })}
                placeholder="xxxx.access" />
            </Field>
            <Field
              label="Client secret"
              hint={editing.hasServiceToken ? "A secret is stored. Leave blank to keep it." : undefined}
            >
              <input className={inputClass} type="password" autoComplete="off"
                value={editing.accessClientSecret ?? ""}
                onChange={(e) => setEditing({ ...editing, accessClientSecret: e.target.value })}
                placeholder={editing.hasServiceToken ? "Unchanged" : "Service token secret"} />
            </Field>
          </fieldset>

          <label className="flex items-center gap-2 mb-3 cursor-pointer">
            <input type="checkbox" checked={editing.enabled ?? true}
              onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })}
              className="accent-accent-purple" />
            <span className="text-sm text-text-secondary">Enabled</span>
          </label>

          {probe && (
            <div
              role="status"
              className={`mb-3 p-3 rounded-lg border text-sm ${
                probe.ok
                  ? "bg-accent-green/10 border-accent-green/30"
                  : "bg-accent-red/10 border-accent-red/30"
              }`}
            >
              <div className="flex items-start gap-2">
                <Icon name={probe.ok ? "check" : "warning"} size={14}
                  className={`mt-0.5 shrink-0 ${probe.ok ? "text-accent-green" : "text-accent-red"}`} />
                <div className="min-w-0">
                  {probe.ok ? (
                    <>
                      <p className="text-text-primary">
                        Connected{probe.serverName ? ` to ${probe.serverName}` : ""} ·{" "}
                        {probe.tools.length} tool{probe.tools.length === 1 ? "" : "s"}
                      </p>
                      <ul className="mt-1.5 flex flex-wrap gap-1.5">
                        {probe.tools.slice(0, 12).map((t) => (
                          <li key={t.name}
                            className="px-2 py-0.5 rounded bg-bg-tertiary text-xs font-mono text-text-secondary">
                            {t.name}
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <p className="text-text-secondary break-words">{probe.error}</p>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <PrimaryButton type="submit" icon="check">Save server</PrimaryButton>
            <button type="button" onClick={() => void runProbe()} disabled={!editing.url || probing}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-border-default text-sm
                text-text-secondary hover:text-text-primary hover:bg-bg-hover disabled:opacity-50
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-purple/60">
              <Icon name="refresh" size={14} />
              {probing ? "Testing" : "Test connection"}
            </button>
            <button type="button" onClick={() => { setEditing(null); setProbe(null); }}
              className="px-3.5 py-2 rounded-lg text-sm text-text-tertiary hover:text-text-primary hover:bg-bg-hover
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-purple/60">
              Cancel
            </button>
          </div>
        </form>
      )}

      {loading ? <Skeleton /> : items.length === 0 && !editing ? (
        <EmptyState icon="mcp" message="No MCP servers connected yet." />
      ) : (
        <ul className="space-y-2">
          {items.map((m) => (
            <li key={m.id} className="flex items-center gap-3 p-3.5 rounded-xl bg-bg-secondary border border-border-subtle">
              <span aria-label={m.enabled ? "Enabled" : "Disabled"}
                className={`w-2 h-2 rounded-full shrink-0 ${m.enabled ? "bg-accent-green" : "bg-text-tertiary"}`} />
              <div className="flex-1 min-w-0">
                <button onClick={() => open(m)}
                  className="text-sm font-medium text-text-primary hover:text-accent-purple transition-colors text-left
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-purple/60 rounded">
                  {m.name}
                </button>
                <p className="text-xs text-text-tertiary mt-0.5 truncate font-mono">{m.url}</p>
              </div>
              {m.hasServiceToken && <span className="text-xs text-text-tertiary shrink-0">Service token</span>}
              {m.hasAuth && <span className="text-xs text-text-tertiary shrink-0">Bearer</span>}
              <DeleteButton onClick={() => void remove(m.id)} label={`Remove ${m.name}`} />
            </li>
          ))}
        </ul>
      )}
    </PanelShell>
  );
}
