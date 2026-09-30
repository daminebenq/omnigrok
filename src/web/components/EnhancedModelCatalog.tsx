import { useEffect, useMemo, useRef, useState } from "react";
import type { Capability, ModelInfo } from "../lib/api";
import { Icon, CAPABILITY_LABEL, type IconName } from "./Icon";

interface EnhancedModelCatalogProps {
  models: ModelInfo[];
  current: string;
  onChange: (model: string) => void;
  onClose: () => void;
}

const CAPABILITY_ICON: Record<Capability, IconName> = {
  reasoning: "reasoning",
  vision: "vision",
  coding: "coding",
  audio: "audio",
  image: "image",
  tools: "tools",
};

const FILTERS: Array<{ id: "all" | Capability; label: string }> = [
  { id: "all", label: "All" },
  { id: "reasoning", label: "Reasoning" },
  { id: "vision", label: "Vision" },
  { id: "coding", label: "Coding" },
  { id: "tools", label: "Tools" },
  { id: "audio", label: "Audio" },
  { id: "image", label: "Image" },
];

export function EnhancedModelCatalog({ models, current, onChange, onClose }: EnhancedModelCatalogProps) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | Capability>("all");
  const dialogRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Group by provider; best models first within each group, and providers
  // ordered by their strongest model so the best options surface at the top.
  const groups = useMemo(() => {
    const q = search.toLowerCase().trim();
    const filtered = models.filter((m) => {
      const matchesQuery =
        !q || m.id.toLowerCase().includes(q) || m.provider.toLowerCase().includes(q);
      const matchesFilter = filter === "all" || m.capabilities.includes(filter);
      return matchesQuery && matchesFilter;
    });

    const byProvider = new Map<string, ModelInfo[]>();
    for (const m of filtered) {
      const list = byProvider.get(m.provider) ?? [];
      list.push(m);
      byProvider.set(m.provider, list);
    }

    return [...byProvider.entries()]
      .map(([provider, list]) => ({
        provider,
        models: [...list].sort(
          (a, b) => b.reputation - a.reputation || a.id.localeCompare(b.id)
        ),
      }))
      .sort(
        (a, b) =>
          b.models[0].reputation - a.models[0].reputation ||
          a.provider.localeCompare(b.provider)
      );
  }, [models, search, filter]);

  const shown = groups.reduce((n, g) => n + g.models.length, 0);

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-start justify-center z-50 p-4 sm:p-8"
      onMouseDown={(e) => {
        if (!dialogRef.current?.contains(e.target as Node)) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Model catalog"
        className="bg-bg-secondary border border-border-default rounded-2xl shadow-2xl w-full max-w-3xl max-h-full flex flex-col overflow-hidden"
      >
        <div className="p-4 border-b border-border-subtle">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-text-primary">
              Models <span className="text-text-tertiary font-normal">({shown})</span>
            </h2>
            <button
              onClick={onClose}
              aria-label="Close model catalog"
              className="p-1.5 rounded-md text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-purple/60"
            >
              <Icon name="close" size={15} />
            </button>
          </div>

          <div className="relative mb-3">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none">
              <Icon name="search" size={14} />
            </span>
            <label htmlFor="model-search" className="sr-only">Search models</label>
            <input
              id="model-search"
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by model or provider"
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-bg-tertiary border border-border-default text-sm
                text-text-primary placeholder-text-tertiary outline-none focus:border-accent-purple/60"
            />
          </div>

          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                aria-pressed={filter === f.id}
                className={`px-2.5 py-1 rounded-lg text-xs border transition-colors
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-purple/60
                  ${
                    filter === f.id
                      ? "bg-accent-purple/20 border-accent-purple/50 text-text-primary"
                      : "bg-bg-tertiary border-border-subtle text-text-tertiary hover:text-text-secondary"
                  }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {shown === 0 ? (
            <p className="text-center text-sm text-text-tertiary py-12">
              No models match that search.
            </p>
          ) : (
            groups.map(({ provider, models: list }) => (
              <section key={provider} className="mb-5 last:mb-0">
                <h3 className="text-xs font-semibold text-text-tertiary uppercase tracking-wide mb-2 px-1">
                  {provider} <span className="font-normal">({list.length})</span>
                </h3>
                <div className="space-y-1">
                  {list.map((model) => {
                    const active = current === model.id;
                    return (
                      <button
                        key={model.id}
                        onClick={() => {
                          onChange(model.id);
                          onClose();
                        }}
                        aria-current={active ? "true" : undefined}
                        className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors
                          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-purple/60
                          ${
                            active
                              ? "bg-accent-purple/15 border-accent-purple/50"
                              : "bg-bg-tertiary/50 border-transparent hover:bg-bg-hover hover:border-border-subtle"
                          }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="flex-1 min-w-0 font-mono text-sm text-text-primary truncate">
                            {model.id}
                          </span>
                          <span className="flex items-center gap-1 shrink-0 text-text-tertiary">
                            {model.capabilities.map((cap) => (
                              <Icon
                                key={cap}
                                name={CAPABILITY_ICON[cap]}
                                size={13}
                                title={CAPABILITY_LABEL[cap] ?? cap}
                              />
                            ))}
                          </span>
                          {active && <Icon name="check" size={14} className="text-accent-purple shrink-0" />}
                        </div>
                        {model.contextLength ? (
                          <span className="block text-xs text-text-tertiary mt-0.5">
                            {Math.round(model.contextLength / 1000)}K context
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
