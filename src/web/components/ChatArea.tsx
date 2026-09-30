import { useState, useRef, useEffect } from "react";
import type { Conversation } from "../lib/api";
import { MessageBubble } from "./MessageBubble";

interface ChatAreaProps {
  conversation: Conversation | null;
  streaming: boolean;
  onSend: (content: string) => void;
  onToggleSidebar: () => void;
  sidebarOpen: boolean;
}

export function ChatArea({ conversation, streaming, onSend, onToggleSidebar, sidebarOpen }: ChatAreaProps) {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation?.messages.length, streaming]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
  }, [input]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSend = () => {
    if (!input.trim() || streaming) return;
    onSend(input.trim());
    setInput("");
  };

  const msgs = conversation?.messages ?? [];
  const isEmpty = msgs.length === 0;

  return (
    <div className="flex-1 flex flex-col min-w-0 h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border-subtle bg-bg-primary/80 backdrop-blur-sm">
        <button
          onClick={onToggleSidebar}
          className="p-1.5 rounded-md text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors"
          aria-label="Toggle sidebar"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {sidebarOpen
              ? <><path d="M3 6h18M3 12h18M3 18h18"/></>
              : <><path d="M3 6h18M3 12h18M3 18h18"/></>
            }
          </svg>
        </button>
        <span className="text-sm text-text-secondary truncate">
          {conversation?.title ?? "OmniGrok"}
        </span>
        {conversation?.model && (
          <span className="ml-auto text-xs text-text-tertiary bg-bg-tertiary border border-border-subtle px-2 py-0.5 rounded-md truncate max-w-[200px]">
            {conversation.model.split("/").pop()}
          </span>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 px-4">
            <div className="w-12 h-12 rounded-2xl bg-accent-purple/20 border border-accent-purple/30 flex items-center justify-center">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent-purple">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
            </div>
            <div className="text-center">
              <h2 className="text-lg font-semibold text-text-primary">OmniGrok</h2>
              <p className="text-sm text-text-tertiary mt-1">Multi-provider AI, at your fingertips.</p>
            </div>
            <div className="grid grid-cols-2 gap-2 w-full max-w-md mt-2">
              {["What can you do?", "Run a Jarvis command", "Write me some code", "Explain something"].map((p) => (
                <button
                  key={p}
                  onClick={() => { setInput(p); textareaRef.current?.focus(); }}
                  className="px-3 py-2.5 text-sm text-text-secondary bg-bg-secondary border border-border-subtle rounded-xl hover:bg-bg-hover hover:text-text-primary hover:border-border-default transition-all text-left"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="pt-6 pb-4">
            {msgs.map((msg, i) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                streaming={streaming && i === msgs.length - 1 && msg.role === "assistant"}
              />
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="px-4 pb-4 pt-2">
        <div className="relative flex items-end gap-2 bg-bg-secondary border border-border-default rounded-2xl focus-within:border-accent-purple/50 transition-colors p-3">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message OmniGrok..."
            rows={1}
            className="flex-1 bg-transparent text-sm text-text-primary placeholder-text-tertiary resize-none outline-none max-h-48 leading-relaxed"
            style={{ overflowY: "auto" }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || streaming}
            className={`shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-all
              ${input.trim() && !streaming
                ? "bg-accent-purple hover:bg-accent-purple/80 text-white"
                : "bg-bg-tertiary text-text-tertiary cursor-not-allowed"
              }`}
          >
            {streaming ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="animate-pulse">
                <rect x="4" y="4" width="16" height="16" rx="2" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
              </svg>
            )}
          </button>
        </div>
        <p className="text-center text-xs text-text-tertiary mt-2">
          Enter to send · Shift+Enter for newline · ⌘K new chat · ⌘/ switch model
        </p>
      </div>
    </div>
  );
}
