import { useState } from "react";
import { PanelShell, PrimaryButton, inputClass, EmptyState, ErrorNote } from "./PanelShell";
import { Icon } from "../Icon";

interface BrowseResult {
  finalUrl: string;
  status: number;
  contentType: string;
  title: string | null;
  html: string | null;
  text: string | null;
  truncated: boolean;
}

export function BrowserPanel() {
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<BrowseResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"rendered" | "text">("rendered");

  const go = async (e: React.FormEvent) => {
    e.preventDefault();
    const target = url.trim();
    if (!target) return;
    const withScheme = /^https?:\/\//i.test(target) ? target : `https://${target}`;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/browse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: withScheme }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error((body as { error?: string }).error ?? "Fetch failed");
      setResult(body as BrowseResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fetch failed");
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  // Rendered in a fully sandboxed iframe: no scripts, no same-origin access.
  // <base> makes relative images and links resolve against the source site.
  const srcDoc =
    result?.html
      ? `<base href="${result.finalUrl}"><style>body{font-family:system-ui;margin:16px;background:#fff;color:#111}</style>${result.html}`
      : null;

  return (
    <PanelShell title="Browser" description="Fetch a page through the worker and read it here.">
      <form onSubmit={go} className="flex gap-2 mb-4">
        <label htmlFor="browse-url" className="sr-only">URL to open</label>
        <input id="browse-url" className={inputClass} value={url} type="text"
          onChange={(e) => setUrl(e.target.value)} placeholder="example.com" />
        <PrimaryButton type="submit" icon="search" disabled={loading}>
          {loading ? "Loading" : "Open"}
        </PrimaryButton>
      </form>

      {error && <ErrorNote message={error} />}

      {result && (
        <div className="rounded-xl border border-border-subtle overflow-hidden bg-bg-secondary">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle text-xs">
            <span className={`shrink-0 px-1.5 py-0.5 rounded font-mono ${
              result.status < 400 ? "bg-accent-green/15 text-accent-green" : "bg-accent-red/15 text-accent-red"
            }`}>
              {result.status}
            </span>
            <span className="flex-1 min-w-0 truncate text-text-secondary">
              {result.title ?? result.finalUrl}
            </span>
            <a href={result.finalUrl} target="_blank" rel="noopener noreferrer"
              className="shrink-0 p-1 rounded text-text-tertiary hover:text-text-primary
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-purple/60"
              aria-label="Open in a new tab">
              <Icon name="external" size={13} />
            </a>
            {result.html && (
              <div className="shrink-0 flex rounded-md overflow-hidden border border-border-default">
                {(["rendered", "text"] as const).map((v) => (
                  <button key={v} onClick={() => setView(v)} aria-pressed={view === v}
                    className={`px-2 py-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-purple/60
                      ${view === v ? "bg-accent-purple/25 text-text-primary" : "text-text-tertiary hover:text-text-secondary"}`}>
                    {v === "rendered" ? "Page" : "Text"}
                  </button>
                ))}
              </div>
            )}
          </div>

          {view === "rendered" && srcDoc ? (
            <iframe title="Fetched page" sandbox="" srcDoc={srcDoc} className="w-full h-[60vh] bg-white" />
          ) : (
            <pre className="p-4 text-xs text-text-secondary whitespace-pre-wrap max-h-[60vh] overflow-y-auto">
              {result.text}
            </pre>
          )}

          {result.truncated && (
            <p className="px-3 py-2 text-xs text-text-tertiary border-t border-border-subtle">
              Response was truncated at 2 MB.
            </p>
          )}
        </div>
      )}

      {!result && !error && !loading && (
        <EmptyState icon="browser" message="Enter a URL to fetch a page." />
      )}
    </PanelShell>
  );
}
