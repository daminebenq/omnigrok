import { useState, useEffect } from "react";
import type { LiveLogs } from "../App";
import { Icon } from "./Icon";

interface WorkingIndicatorProps {
  isWorking: boolean;
  logs: LiveLogs | null;
}

/** Live "thinking" pill. Hovering (or focusing) reveals reasoning + usage. */
export function WorkingIndicator({ isWorking, logs }: WorkingIndicatorProps) {
  const [open, setOpen] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!isWorking || !logs) return;
    const tick = () => setElapsed(Math.floor((Date.now() - logs.startedAt) / 1000));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [isWorking, logs]);

  if (!isWorking) return null;

  const hasDetail = Boolean(logs?.reasoning || logs?.usage);

  return (
    <div
      className="relative inline-block"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        aria-expanded={open}
        aria-label={
          hasDetail ? "Working. Show reasoning and token usage" : "Working"
        }
        className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-bg-secondary border border-border-subtle
          text-accent-purple cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-purple/60"
      >
        <span className="flex gap-1" aria-hidden="true">
          {[0, 0.2, 0.4].map((d) => (
            <span
              key={d}
              className="w-1.5 h-1.5 bg-accent-purple rounded-full motion-safe:animate-pulse"
              style={{ animationDelay: `${d}s` }}
            />
          ))}
        </span>
        <span className="text-xs font-medium text-text-secondary">
          Working{elapsed > 0 ? ` · ${elapsed}s` : ""}
        </span>
        {hasDetail && <Icon name="spark" size={12} className="text-text-tertiary" />}
      </button>

      {open && hasDetail && logs && (
        <div
          role="tooltip"
          className="absolute bottom-full left-0 mb-2 w-96 max-w-[90vw] bg-bg-secondary border border-border-default
            rounded-xl shadow-2xl p-4 z-50"
        >
          <h4 className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-3">
            Processing details
          </h4>

          {logs.usage && (
            <div className="mb-3">
              <div className="flex items-center gap-1.5 mb-1.5 text-text-secondary">
                <Icon name="spark" size={12} />
                <span className="text-xs font-medium">Tokens</span>
              </div>
              <dl className="grid grid-cols-3 gap-2 text-xs">
                {(
                  [
                    ["Input", logs.usage.input],
                    ["Output", logs.usage.output],
                    ["Total", logs.usage.total],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="bg-bg-tertiary rounded-lg px-2 py-1.5">
                    <dt className="text-text-tertiary">{label}</dt>
                    <dd className="text-text-primary font-mono">{value.toLocaleString()}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {logs.reasoning && (
            <div>
              <div className="flex items-center gap-1.5 mb-1.5 text-text-secondary">
                <Icon name="reasoning" size={12} />
                <span className="text-xs font-medium">Reasoning</span>
              </div>
              <div className="text-xs text-text-tertiary leading-relaxed max-h-40 overflow-y-auto whitespace-pre-wrap bg-bg-tertiary rounded-lg p-2.5">
                {logs.reasoning}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
