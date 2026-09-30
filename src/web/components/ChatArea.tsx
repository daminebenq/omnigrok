import { useState, useRef, useEffect } from "react";
import type { Conversation } from "../lib/api";
import type { LiveLogs } from "../App";
import { MessageBubble } from "./MessageBubble";
import { WorkingIndicator } from "./WorkingIndicator";
import { Icon } from "./Icon";

interface ChatAreaProps {
  conversation: Conversation | null;
  streaming: boolean;
  logs: LiveLogs | null;
  onSend: (content: string) => void;
  onStop: () => void;
  onToggleSidebar: () => void;
  sidebarOpen: boolean;
}

const PROMPTS = [
  "What can you do?",
  "Run a Jarvis command",
  "Write me some code",
  "Explain something",
];

export function ChatArea({
  conversation,
  streaming,
  logs,
  onSend,
  onStop,
  onToggleSidebar,
  sidebarOpen,
}: ChatAreaProps) {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const msgs = conversation?.messages ?? [];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs.length, streaming]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, [input]);

  const handleSend = () => {
    const value = input.trim();
    if (!value || streaming) return;
    onSend(value);
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const isEmpty = msgs.length === 0;

  return (
    <div className="flex-1 flex flex-col min-w-0 h-full bg-bg-primary">
      <header className="flex items-center gap-3 px-4 py-3 border-b border-border-subtle bg-bg-primary/80 backdrop-blur-sm">
        <button
          onClick={onToggleSidebar}
          aria-label={sidebarOpen ? "Hide conversations" : "Show conversations"}
          aria-expanded={sidebarOpen}
          className="p-1.5 rounded-md text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-purple/60"
        >
          <Icon name="menu" />
        </button>
        <span className="text-sm text-text-secondary truncate">
          {conversation?.title ?? "OmniGrok"}
        </span>
        {conversation?.model && (
          <span className="ml-auto text-xs text-text-tertiary bg-bg-tertiary border border-border-subtle px-2 py-0.5 rounded-md truncate max-w-[220px] font-mono">
            {conversation.model}
          </span>
        )}
      </header>

      <div className="flex-1 overflow-y-auto">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 px-4">
            <div className="w-12 h-12 rounded-2xl bg-accent-purple/20 border border-accent-purple/30 flex items-center justify-center text-accent-purple">
              <Icon name="logo" size={22} />
            </div>
            <div className="text-center">
              <h2 className="text-lg font-semibold text-text-primary">OmniGrok</h2>
              <p className="text-sm text-text-tertiary mt-1">
                Multi-provider AI, at your fingertips.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-md mt-2">
              {PROMPTS.map((p) => (
                <button
                  key={p}
                  onClick={() => {
                    setInput(p);
                    textareaRef.current?.focus();
                  }}
                  className="px-3 py-2.5 text-sm text-text-secondary bg-bg-secondary border border-border-subtle rounded-xl
                    hover:bg-bg-hover hover:text-text-primary hover:border-border-default transition-all text-left
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-purple/60"
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
            {streaming && (
              <div className="max-w-3xl mx-auto px-4 pt-1">
                <WorkingIndicator isWorking logs={logs} />
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <div className="px-4 pb-4 pt-2">
        <div className="max-w-3xl mx-auto">
          <div className="relative flex items-end gap-2 bg-bg-secondary border border-border-default rounded-2xl focus-within:border-accent-purple/50 transition-colors p-3">
            <label htmlFor="composer" className="sr-only">
              Message OmniGrok
            </label>
            <textarea
              id="composer"
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message OmniGrok..."
              rows={1}
              className="flex-1 bg-transparent text-sm text-text-primary placeholder-text-tertiary resize-none outline-none max-h-48 leading-relaxed"
            />
            <button
              onClick={streaming ? onStop : handleSend}
              disabled={!streaming && !input.trim()}
              aria-label={streaming ? "Stop generating" : "Send message"}
              className={`shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-all
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-purple/60
                ${
                  streaming
                    ? "bg-accent-red/80 hover:bg-accent-red text-white"
                    : input.trim()
                      ? "bg-accent-purple hover:bg-accent-purple/80 text-white"
                      : "bg-bg-tertiary text-text-tertiary cursor-not-allowed"
                }`}
            >
              <Icon name={streaming ? "stop" : "send"} size={14} />
            </button>
          </div>
          <p className="text-center text-xs text-text-tertiary mt-2">
            Enter to send, Shift+Enter for a newline, Cmd+K for a new chat
          </p>
        </div>
      </div>
    </div>
  );
}
