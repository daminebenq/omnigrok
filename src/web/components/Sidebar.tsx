import { useState } from "react";
import type { Conversation, ModelInfo } from "../lib/api";
import { ModelSwitcher } from "./ModelSwitcher";

interface SidebarProps {
  open: boolean;
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onNewChat: () => void;
  models: ModelInfo[];
  currentModel: string;
  onModelChange: (model: string) => void;
  onClose: () => void;
  onBrowseCatalog: () => void;
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function Sidebar({
  open, conversations, activeId, onSelect, onDelete, onNewChat,
  models, currentModel, onModelChange, onClose, onBrowseCatalog,
}: SidebarProps) {
  const [hoverId, setHoverId] = useState<string | null>(null);

  return (
    <aside
      className={`
        fixed lg:relative z-30 lg:z-auto flex flex-col
        w-72 h-full bg-bg-secondary border-r border-border-subtle
        transition-transform duration-200 ease-out
        ${open ? "translate-x-0" : "-translate-x-full lg:-translate-x-full"}
      `}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-accent-purple flex items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
          </div>
          <span className="text-sm font-semibold text-text-primary tracking-tight">OmniGrok</span>
        </div>
        <button
          onClick={onClose}
          className="lg:hidden p-1.5 rounded-md text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* New Chat button */}
      <div className="px-3 pt-3 pb-1">
        <button
          onClick={onNewChat}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-bg-tertiary hover:bg-bg-hover border border-border-subtle text-sm text-text-secondary hover:text-text-primary transition-all duration-150 group"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-tertiary group-hover:text-text-primary transition-colors">
            <path d="M12 5v14M5 12h14" />
          </svg>
          New chat
          <kbd className="ml-auto text-xs text-text-tertiary bg-bg-primary px-1.5 py-0.5 rounded border border-border-subtle font-mono">⌘K</kbd>
        </button>
      </div>

      {/* Conversations list */}
      <div className="flex-1 overflow-y-auto px-3 py-1">
        {conversations.length === 0 && (
          <p className="text-center text-text-tertiary text-xs py-8">No conversations yet</p>
        )}
        {conversations.map((conv) => (
          <div
            key={conv.id}
            className={`
              group relative flex items-start gap-2 px-3 py-2.5 rounded-lg cursor-pointer mb-0.5
              transition-colors duration-100
              ${activeId === conv.id
                ? "bg-bg-active text-text-primary"
                : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"
              }
            `}
            onClick={() => onSelect(conv.id)}
            onMouseEnter={() => setHoverId(conv.id)}
            onMouseLeave={() => setHoverId(null)}
          >
            <svg width="14" height="14" className="mt-0.5 shrink-0 text-text-tertiary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
            </svg>
            <div className="flex-1 min-w-0">
              <p className="text-sm truncate leading-snug">{conv.title}</p>
              <p className="text-xs text-text-tertiary mt-0.5">{timeAgo(conv.updatedAt)}</p>
            </div>
            {(hoverId === conv.id || activeId === conv.id) && (
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(conv.id); }}
                className="shrink-0 p-1 rounded text-text-tertiary hover:text-accent-red hover:bg-bg-hover transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Model switcher at bottom */}
      <div className="border-t border-border-subtle p-3">
        <ModelSwitcher models={models} current={currentModel} onChange={onModelChange} />
        <button
          onClick={onBrowseCatalog}
          className="mt-2 w-full text-xs text-text-tertiary hover:text-text-primary transition-colors py-1.5 rounded-md
            hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-purple/60"
        >
          Browse all {models.length} models
        </button>
      </div>
    </aside>
  );
}
