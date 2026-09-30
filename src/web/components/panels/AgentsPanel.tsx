import { useEffect, useMemo, useState } from "react";
import { useResource, type ResourceRecord } from "../../lib/useResource";
import type { ModelInfo } from "../../lib/api";
import {
  PanelShell, PrimaryButton, Field, inputClass, EmptyState, Skeleton, ErrorNote, DeleteButton,
} from "./PanelShell";
import { Icon } from "../Icon";

interface Agent extends ResourceRecord {
  description?: string;
  systemPrompt?: string;
  model?: string;
  tools?: string[];
}

const AVAILABLE_TOOLS = [
  { id: "jarvis_exec", label: "Jarvis OS" },
  { id: "web_browse", label: "Web browse" },
  { id: "device_exec", label: "Device shell" },
  { id: "device_read_dir", label: "Device files" },
];

interface Preset {
  id: string; name: string; category: string; description: string;
  systemPrompt: string; tools: string[];
}

export function AgentsPanel({ models }: { models: ModelInfo[] }) {
  const { items, loading, error, save, remove } = useResource<Agent>("agents");
  const [editing, setEditing] = useState<Agent | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [browsing, setBrowsing] = useState(false);
  const [presetFilter, setPresetFilter] = useState("all");

  useEffect(() => {
    fetch("/api/catalog/agents")
      .then((r) => (r.ok ? (r.json() as Promise<{ presets: Preset[] }>) : null))
      .then((b) => b && setPresets(b.presets))
      .catch(() => {});
  }, []);

  const presetCategories = useMemo(
    () => ["all", ...Array.from(new Set(presets.map((p) => p.category)))],
    [presets]
  );
  const shownPresets = useMemo(
    () => presets.filter((p) => presetFilter === "all" || p.category === presetFilter),
    [presets, presetFilter]
  );

  const blank: Agent = {
    id: "", name: "", description: "", systemPrompt: "",
    model: models[0]?.id ?? "", tools: [], createdAt: 0, updatedAt: 0,
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    try {
      setSaveError(null);
      const { id, ...rest } = editing;
      await save(id ? editing : rest);
      setEditing(null);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    }
  };

  return (
    <PanelShell
      title="Agents"
      description="Reusable assistants with their own system prompt, model and tool access."
      action={
        <div className="flex gap-2">
          <button
            onClick={() => setBrowsing((v) => !v)}
            aria-pressed={browsing}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-border-default text-sm
              text-text-secondary hover:text-text-primary hover:bg-bg-hover
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-purple/60"
          >
            <Icon name="spark" size={14} />
            Library ({presets.length})
          </button>
          <PrimaryButton icon="plus" onClick={() => { setEditing(blank); setBrowsing(false); setSaveError(null); }}>
            New agent
          </PrimaryButton>
        </div>
      }
    >
      {error && <ErrorNote message={error} />}

      {browsing && (
        <div className="mb-6">
          <div className="flex flex-wrap gap-1.5 mb-3">
            {presetCategories.map((cat) => (
              <button key={cat} onClick={() => setPresetFilter(cat)} aria-pressed={presetFilter === cat}
                className={`px-2.5 py-1 rounded-lg text-xs border capitalize transition-colors
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-purple/60
                  ${presetFilter === cat
                    ? "bg-accent-purple/20 border-accent-purple/50 text-text-primary"
                    : "bg-bg-tertiary border-border-subtle text-text-tertiary hover:text-text-secondary"}`}>
                {cat}
              </button>
            ))}
          </div>
          <ul className="grid gap-2 sm:grid-cols-2">
            {shownPresets.map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => {
                    // Clone into an editable agent rather than referencing the
                    // preset, so edits never mutate the shared library.
                    setEditing({
                      ...blank,
                      name: p.name,
                      description: p.description,
                      systemPrompt: p.systemPrompt,
                      tools: [...p.tools],
                    });
                    setBrowsing(false);
                    setSaveError(null);
                  }}
                  className="w-full text-left p-3.5 rounded-xl bg-bg-secondary border border-border-subtle
                    hover:border-border-default hover:bg-bg-hover transition-colors
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-purple/60"
                >
                  <span className="text-sm font-medium text-text-primary">{p.name}</span>
                  <span className="block text-xs text-text-tertiary mt-0.5">{p.description}</span>
                  <span className="inline-block mt-2 px-1.5 py-0.5 rounded bg-bg-tertiary text-xs text-text-tertiary capitalize">
                    {p.category}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {editing && (
        <form onSubmit={submit} className="mb-6 p-4 rounded-xl bg-bg-secondary border border-border-default">
          {saveError && <ErrorNote message={saveError} />}
          <Field label="Name">
            <input className={inputClass} value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              placeholder="Research assistant" required />
          </Field>
          <Field label="Description">
            <input className={inputClass} value={editing.description ?? ""}
              onChange={(e) => setEditing({ ...editing, description: e.target.value })}
              placeholder="What this agent is for" />
          </Field>
          <Field label="Model">
            <select className={inputClass} value={editing.model ?? ""}
              onChange={(e) => setEditing({ ...editing, model: e.target.value })}>
              {models.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
            </select>
          </Field>
          <Field label="System prompt">
            <textarea className={`${inputClass} min-h-28 resize-y font-mono`} value={editing.systemPrompt ?? ""}
              onChange={(e) => setEditing({ ...editing, systemPrompt: e.target.value })}
              placeholder="You are..." />
          </Field>
          <Field label="Tools">
            <div className="flex flex-wrap gap-2">
              {AVAILABLE_TOOLS.map((t) => {
                const on = editing.tools?.includes(t.id) ?? false;
                return (
                  <button key={t.id} type="button"
                    onClick={() => setEditing({
                      ...editing,
                      tools: on ? (editing.tools ?? []).filter((x) => x !== t.id) : [...(editing.tools ?? []), t.id],
                    })}
                    aria-pressed={on}
                    className={`px-3 py-1.5 rounded-lg text-xs border transition-colors
                      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-purple/60
                      ${on ? "bg-accent-purple/20 border-accent-purple/50 text-text-primary"
                           : "bg-bg-tertiary border-border-default text-text-tertiary hover:text-text-secondary"}`}>
                    {t.label}
                  </button>
                );
              })}
            </div>
          </Field>
          <div className="flex gap-2 mt-4">
            <PrimaryButton type="submit" icon="check">Save agent</PrimaryButton>
            <button type="button" onClick={() => setEditing(null)}
              className="px-3.5 py-2 rounded-lg text-sm text-text-tertiary hover:text-text-primary hover:bg-bg-hover
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-purple/60">
              Cancel
            </button>
          </div>
        </form>
      )}

      {loading ? <Skeleton /> : items.length === 0 && !editing ? (
        <EmptyState icon="agents" message="No agents yet. Create one to get started." />
      ) : (
        <ul className="space-y-2">
          {items.map((a) => (
            <li key={a.id} className="flex items-start gap-3 p-3.5 rounded-xl bg-bg-secondary border border-border-subtle">
              <div className="flex-1 min-w-0">
                <button onClick={() => { setEditing(a); setSaveError(null); }}
                  className="text-sm font-medium text-text-primary hover:text-accent-purple transition-colors text-left
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-purple/60 rounded">
                  {a.name}
                </button>
                {a.description && <p className="text-xs text-text-tertiary mt-0.5 truncate">{a.description}</p>}
                <p className="text-xs text-text-tertiary mt-1 font-mono truncate">{a.model}</p>
              </div>
              <DeleteButton onClick={() => void remove(a.id)} label={`Delete ${a.name}`} />
            </li>
          ))}
        </ul>
      )}
    </PanelShell>
  );
}
