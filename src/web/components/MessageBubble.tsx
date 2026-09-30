import { useState, useEffect } from "react";
import type { Message } from "../lib/api";

// Simple markdown renderer (no external deps needed for basic formatting)
function renderMarkdown(text: string): string {
  return text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    // code blocks first
    .replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) =>
      `<pre class="not-prose my-3 rounded-xl overflow-hidden"><div class="flex items-center justify-between bg-bg-tertiary px-4 py-2 border-b border-border-subtle"><span class="text-xs text-text-tertiary font-mono">${lang || "code"}</span><button class="copy-btn text-xs text-text-tertiary hover:text-text-primary transition-colors px-2 py-1 rounded hover:bg-bg-hover">Copy</button></div><code class="block bg-bg-secondary px-4 py-3 font-mono text-sm text-text-primary overflow-x-auto whitespace-pre">${code.trimEnd()}</code></pre>`
    )
    .replace(/`([^`]+)`/g, '<code class="bg-bg-tertiary px-1.5 py-0.5 rounded text-sm font-mono text-text-primary border border-border-subtle">$1</code>')
    .replace(/^#{1,6}\s+(.+)$/gm, (m, t, o) => {
      const lvl = m.match(/^#+/)?.[0].length ?? 1;
      const sizes = ["text-2xl","text-xl","text-lg","text-base","text-sm","text-xs"];
      return `<h${lvl} class="${sizes[lvl-1] || "text-base"} font-semibold text-text-primary mt-4 mb-2">${t}</h${lvl}>`;
    })
    .replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold text-text-primary">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em class="italic text-text-secondary">$1</em>')
    .replace(/~~(.+?)~~/g, '<del>$1</del>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" class="text-accent-purple hover:underline">$1</a>')
    .replace(/^---$/gm, '<hr class="border-border-default my-4" />')
    .replace(/^> (.+)$/gm, '<blockquote class="border-l-4 border-border-bright pl-4 text-text-secondary my-2 italic">$1</blockquote>')
    .replace(/^[\s]*[-*]\s+(.+)$/gm, '<li class="ml-4 my-0.5 text-text-primary">$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul class="list-disc my-2 space-y-1">${m}</ul>`)
    .replace(/\n\n/g, '</p><p class="my-2">')
    .replace(/\n/g, "<br />");
}

interface MessageBubbleProps {
  message: Message;
  streaming?: boolean;
}

export function MessageBubble({ message, streaming }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);

  const copyAll = async () => {
    await navigator.clipboard.writeText(message.content).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // Wire copy buttons in rendered markdown
  useEffect(() => {
    if (isUser) return;
    const btns = document.querySelectorAll<HTMLButtonElement>(".copy-btn");
    btns.forEach((btn) => {
      btn.onclick = async () => {
        const code = btn.closest("pre")?.querySelector("code")?.textContent ?? "";
        await navigator.clipboard.writeText(code).catch(() => {});
        const orig = btn.textContent;
        btn.textContent = "Copied!";
        setTimeout(() => { btn.textContent = orig; }, 1500);
      };
    });
  }, [message.content, isUser]);

  if (isUser) {
    return (
      <div className="flex justify-end mb-4 px-4 group">
        <div className="max-w-[80%] lg:max-w-[65%]">
          <div className="bg-accent-purple/20 border border-accent-purple/30 rounded-2xl rounded-tr-sm px-4 py-3">
            <p className="text-sm text-text-primary leading-relaxed whitespace-pre-wrap">{message.content}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3 mb-6 px-4 group">
      {/* Avatar */}
      <div className="shrink-0 w-7 h-7 rounded-lg bg-accent-purple/20 border border-accent-purple/30 flex items-center justify-center mt-0.5">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-accent-purple">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
        </svg>
      </div>

      <div className="flex-1 min-w-0">
        {/* Content */}
        {message.content ? (
          <div
            className="prose text-sm text-text-primary leading-relaxed"
            dangerouslySetInnerHTML={{ __html: `<p class="my-2">${renderMarkdown(message.content)}</p>` }}
          />
        ) : streaming ? (
          <div className="flex items-center gap-1.5 py-2">
            <span className="w-1.5 h-1.5 bg-text-tertiary rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
            <span className="w-1.5 h-1.5 bg-text-tertiary rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
            <span className="w-1.5 h-1.5 bg-text-tertiary rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
          </div>
        ) : null}

        {/* Streaming cursor */}
        {streaming && message.content && (
          <span className="inline-block w-0.5 h-4 bg-accent-purple animate-pulse ml-0.5" />
        )}

        {/* Copy button */}
        {!streaming && message.content && (
          <button
            onClick={copyAll}
            className="mt-2 opacity-0 group-hover:opacity-100 flex items-center gap-1.5 text-xs text-text-tertiary hover:text-text-secondary transition-all"
          >
            {copied ? (
              <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6L9 17l-5-5" /></svg>Copied</>
            ) : (
              <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>Copy</>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
