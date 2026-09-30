import { useEffect, useMemo, useState } from "react";
import { PanelShell, PrimaryButton, inputClass, Skeleton, ErrorNote } from "./PanelShell";
import { Icon } from "../Icon";

interface Skill {
  id: string; name: string; category: string; description: string;
  inputLabel: string; inputPlaceholder: string;
}

interface SkillsPanelProps {
  /** Sends the expanded prompt into the active chat. */
  onRun: (prompt: string) => void;
}

export function SkillsPanel({ onRun }: SkillsPanelProps) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [active, setActive] = useState<Skill | null>(null);
  const [input, setInput] = useState("");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    fetch("/api/catalog/skills")
      .then((r) => (r.ok ? (r.json() as Promise<{ skills: Skill[]; categories: string[] }>) : Promise.reject(new Error("Could not load skills"))))
      .then((b) => {
        setSkills(b.skills);
        setCategories(b.categories);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const shown = useMemo(() => {
    const q = search.toLowerCase().trim();
    return skills.filter(
      (s) =>
        (filter === "all" || s.category === filter) &&
        (!q || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q))
    );
  }, [skills, filter, search]);

  const run = async () => {
    if (!active || !input.trim()) return;
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(`/api/catalog/skills/${active.id}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error((body as { error?: string }).error ?? "Could not run skill");
      onRun((body as { prompt: string }).prompt);
      setActive(null);
      setInput("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not run skill");
    } finally {
      setRunning(false);
    }
  };

  return (
    <PanelShell title="Skills" description={`${skills.length} task templates. Running one starts it in the chat.`}>
      {error && <ErrorNote message={error} />}

      {active ? (
        <div className="p-4 rounded-xl bg-bg-secondary border border-border-default">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <h3 className="text-sm font-semibold text-text-primary">{active.name}</h3>
              <p className="text-xs text-text-tertiary mt-0.5">{active.description}</p>
            </div>
            <button onClick={() => setActive(null)} aria-label="Back to skills"
              className="p-1.5 rounded-md text-text-tertiary hover:text-text-primary hover:bg-bg-hover
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-purple/60">
              <Icon name="close" size={14} />
            </button>
          </div>
          <label className="block">
            <span className="block text-xs font-medium text-text-secondary mb-1.5">{active.inputLabel}</span>
            <textarea className={`${inputClass} min-h-40 resize-y font-mono`} value={input}
              onChange={(e) => setInput(e.target.value)} placeholder={active.inputPlaceholder} autoFocus />
          </label>
          <div className="mt-3">
            <PrimaryButton icon="send" onClick={() => void run()} disabled={!input.trim() || running}>
              {running ? "Starting" : "Run in chat"}
            </PrimaryButton>
          </div>
        </div>
      ) : loading ? (
        <Skeleton rows={4} />
      ) : (
        <>
          <div className="flex flex-wrap gap-2 mb-4">
            <div className="relative flex-1 min-w-[200px]">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none">
                <Icon name="search" size={14} />
              </span>
              <label htmlFor="skill-search" className="sr-only">Search skills</label>
              <input id="skill-search" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search skills" className={`${inputClass} pl-9`} />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {["all", ...categories].map((cat) => (
                <button key={cat} onClick={() => setFilter(cat)} aria-pressed={filter === cat}
                  className={`px-2.5 py-1 rounded-lg text-xs border capitalize transition-colors
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-purple/60
                    ${filter === cat
                      ? "bg-accent-purple/20 border-accent-purple/50 text-text-primary"
                      : "bg-bg-tertiary border-border-subtle text-text-tertiary hover:text-text-secondary"}`}>
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <ul className="grid gap-2 sm:grid-cols-2">
            {shown.map((s) => (
              <li key={s.id}>
                <button onClick={() => { setActive(s); setInput(""); }}
                  className="w-full text-left p-3.5 rounded-xl bg-bg-secondary border border-border-subtle
                    hover:border-border-default hover:bg-bg-hover transition-colors
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-purple/60">
                  <span className="text-sm font-medium text-text-primary">{s.name}</span>
                  <span className="block text-xs text-text-tertiary mt-0.5">{s.description}</span>
                  <span className="inline-block mt-2 px-1.5 py-0.5 rounded bg-bg-tertiary text-xs text-text-tertiary capitalize">
                    {s.category}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {shown.length === 0 && (
            <p className="text-center text-sm text-text-tertiary py-10">No skills match that search.</p>
          )}
        </>
      )}
    </PanelShell>
  );
}
