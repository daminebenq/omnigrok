import { useState } from "react";
import { useResource, type ResourceRecord } from "../../lib/useResource";
import {
  PanelShell, PrimaryButton, Field, inputClass, EmptyState, Skeleton, ErrorNote, DeleteButton,
} from "./PanelShell";

interface Project extends ResourceRecord {
  description?: string;
}

export function ProjectsPanel() {
  const { items, loading, error, save, remove } = useResource<Project>("projects");
  const [editing, setEditing] = useState<Project | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

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
      title="Projects"
      description="Group related work so context and conversations stay together."
      action={
        <PrimaryButton icon="plus"
          onClick={() => { setEditing({ id: "", name: "", description: "", createdAt: 0, updatedAt: 0 }); setSaveError(null); }}>
          New project
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
              placeholder="Q1 platform migration" required />
          </Field>
          <Field label="Description">
            <textarea className={`${inputClass} min-h-20 resize-y`} value={editing.description ?? ""}
              onChange={(e) => setEditing({ ...editing, description: e.target.value })}
              placeholder="What this project covers" />
          </Field>
          <div className="flex gap-2 mt-4">
            <PrimaryButton type="submit" icon="check">Save project</PrimaryButton>
            <button type="button" onClick={() => setEditing(null)}
              className="px-3.5 py-2 rounded-lg text-sm text-text-tertiary hover:text-text-primary hover:bg-bg-hover
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-purple/60">
              Cancel
            </button>
          </div>
        </form>
      )}

      {loading ? <Skeleton /> : items.length === 0 && !editing ? (
        <EmptyState icon="projects" message="No projects yet." />
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {items.map((p) => (
            <li key={p.id} className="flex items-start gap-3 p-3.5 rounded-xl bg-bg-secondary border border-border-subtle">
              <div className="flex-1 min-w-0">
                <button onClick={() => { setEditing(p); setSaveError(null); }}
                  className="text-sm font-medium text-text-primary hover:text-accent-purple transition-colors text-left
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-purple/60 rounded">
                  {p.name}
                </button>
                {p.description && <p className="text-xs text-text-tertiary mt-1 line-clamp-2">{p.description}</p>}
              </div>
              <DeleteButton onClick={() => void remove(p.id)} label={`Delete ${p.name}`} />
            </li>
          ))}
        </ul>
      )}
    </PanelShell>
  );
}
