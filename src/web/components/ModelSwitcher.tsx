import { useState, useRef, useEffect } from "react";
import type { ModelInfo } from "../lib/api";

interface ModelSwitcherProps {
  models: ModelInfo[];
  current: string;
  onChange: (model: string) => void;
}

export function ModelSwitcher({ models, current, onChange }: ModelSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const currentInfo = models.find((m) => m.id === current);
  const grouped = models.reduce<Record<string, ModelInfo[]>>((acc, m) => {
    (acc[m.provider] ??= []).push(m);
    return acc;
  }, {});
  const filtered = search
    ? models.filter((m) => m.id.toLowerCase().includes(search.toLowerCase()) || m.provider.toLowerCase().includes(search.toLowerCase()))
    : null;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Cmd+/ shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "/") { e.preventDefault(); setOpen((v) => !v); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const modelLabel = (id: string) => {
    const parts = id.split("/");
    return parts[parts.length - 1];
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-bg-tertiary hover:bg-bg-hover border border-border-subtle text-sm text-text-secondary hover:text-text-primary transition-all"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-text-tertiary">
          <circle cx="12" cy="12" r="3" /><path d="M19.07 4.93a10 10 0 010 14.14M4.93 4.93a10 10 0 000 14.14" />
        </svg>
        <span className="flex-1 text-left truncate text-xs">{currentInfo ? `${currentInfo.provider} / ${modelLabel(current)}` : current}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-text-tertiary">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="absolute bottom-full left-0 right-0 mb-2 bg-bg-secondary border border-border-default rounded-xl shadow-2xl shadow-black/50 overflow-hidden z-50">
          <div className="p-2 border-b border-border-subtle">
            <input
              autoFocus
              type="text"
              placeholder="Search models..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-bg-tertiary border border-border-subtle rounded-lg px-3 py-1.5 text-sm text-text-primary placeholder-text-tertiary outline-none focus:border-accent-purple transition-colors"
            />
          </div>
          <div className="overflow-y-auto max-h-72 p-1.5">
            {filtered ? (
              filtered.map((m) => (
                <ModelOption key={m.id} model={m} current={current} onChange={(id) => { onChange(id); setOpen(false); setSearch(""); }} />
              ))
            ) : (
              Object.entries(grouped).map(([provider, providerModels]) => (
                <div key={provider}>
                  <p className="px-3 py-1 text-xs font-semibold text-text-tertiary uppercase tracking-wider">{provider}</p>
                  {providerModels.map((m) => (
                    <ModelOption key={m.id} model={m} current={current} onChange={(id) => { onChange(id); setOpen(false); setSearch(""); }} />
                  ))}
                </div>
              ))
            )}
            {filtered?.length === 0 && (
              <p className="text-center text-text-tertiary text-xs py-4">No models found</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ModelOption({ model, current, onChange }: { model: ModelInfo; current: string; onChange: (id: string) => void }) {
  const label = model.id.split("/").pop() ?? model.id;
  return (
    <button
      onClick={() => onChange(model.id)}
      className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors ${
        current === model.id
          ? "bg-accent-purple/20 text-text-primary"
          : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"
      }`}
    >
      {current === model.id && (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-accent-purple shrink-0">
          <path d="M20 6L9 17l-5-5" />
        </svg>
      )}
      <span className={`truncate ${current !== model.id ? "ml-5" : ""}`}>{label}</span>
    </button>
  );
}
