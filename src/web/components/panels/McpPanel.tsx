import { useState } from "react";
import { useResource, type ResourceRecord } from "../../lib/useResource";
import {
  PanelShell, PrimaryButton, Field, inputClass, EmptyState, Skeleton, ErrorNote, DeleteButton,
} from "./PanelShell";

interface McpServer extends ResourceRecord {
  url?: string;
  enabled?: boolean;
  hasAuth?: boolean;
}

export function McpPanel() {
  const { items, loading, error, save, remove } = useResource<McpServer>("mcps");
  const [editing, setEditing] = useState<(McpServer & { authToken?: string }) | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

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
        err instanceof TypeError ? "Enter a valid server URL"
          : err instanceof Error ? err.message : "Save failed"
      );
    }
  };

  return (
    <PanelShell
      title="MCP servers"
      description="Connect Model Context Protocol servers to extend what your agents can reach."
      action={
        <PrimaryButton icon="plus"
          onClick={() => {
            setEditing({ id: "", name: "", url: "", enabled: true, createdAt: 0, updatedAt: 0 });
            setSaveError(null);
          }}>
          Connect server
        </PrimaryButton>
      }
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
          <Field label="Server URL">
            <input className={inputClass} type="url" value={editing.url ?? ""}
              onChange={(e) => setEditing({ ...editing, url: e.target.value })}
              placeholder="https://example.com/mcp" required />
          </Field>
          <Field
            label="Auth token"
            hint={editing.hasAuth ? "A token is stored. Leave blank to keep it." : "Optional bearer token. Stored server-side only."}
          >
            <input className={inputClass} type="password" autoComplete="off"
              value={editing.authToken ?? ""}
              onChange={(e) => setEditing({ ...editing, authToken: e.target.value })}
              placeholder={editing.hasAuth ? "Unchanged" : "Bearer token"} />
          </Field>
          <label className="flex items-center gap-2 mb-2 cursor-pointer">
            <input type="checkbox" checked={editing.enabled ?? true}
              onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })}
              className="accent-accent-purple" />
            <span className="text-sm text-text-secondary">Enabled</span>
          </label>
          <div className="flex gap-2 mt-4">
            <PrimaryButton type="submit" icon="check">Save server</PrimaryButton>
            <button type="button" onClick={() => setEditing(null)}
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
              <span
                aria-label={m.enabled ? "Enabled" : "Disabled"}
                className={`w-2 h-2 rounded-full shrink-0 ${m.enabled ? "bg-accent-green" : "bg-text-tertiary"}`}
              />
              <div className="flex-1 min-w-0">
                <button onClick={() => { setEditing(m); setSaveError(null); }}
                  className="text-sm font-medium text-text-primary hover:text-accent-purple transition-colors text-left
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-purple/60 rounded">
                  {m.name}
                </button>
                <p className="text-xs text-text-tertiary mt-0.5 truncate font-mono">{m.url}</p>
              </div>
              {m.hasAuth && <span className="text-xs text-text-tertiary shrink-0">Auth set</span>}
              <DeleteButton onClick={() => void remove(m.id)} label={`Remove ${m.name}`} />
            </li>
          ))}
        </ul>
      )}
    </PanelShell>
  );
}
