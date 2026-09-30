import { useCallback, useEffect, useState } from "react";
import { PanelShell, PrimaryButton, Field, inputClass, EmptyState, ErrorNote, DeleteButton } from "./PanelShell";
import { Icon } from "../Icon";

interface Profile {
  id: string;
  name: string;
  userAgent?: string;
  hasCookies?: boolean;
}

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
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profileId, setProfileId] = useState("");
  const [editingProfile, setEditingProfile] = useState<
    (Partial<Profile> & { cookies?: string }) | null
  >(null);
  const [result, setResult] = useState<BrowseResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"rendered" | "text">("rendered");

  const loadProfiles = useCallback(async () => {
    try {
      const res = await fetch("/api/r/browser");
      if (!res.ok) return;
      const body = (await res.json()) as { items: Profile[] };
      setProfiles(body.items);
    } catch {
      /* profiles are optional */
    }
  }, []);

  useEffect(() => { void loadProfiles(); }, [loadProfiles]);

  const saveProfile = async () => {
    if (!editingProfile?.name?.trim()) return;
    await fetch("/api/r/browser", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editingProfile),
    });
    setEditingProfile(null);
    await loadProfiles();
  };

  const deleteProfile = async (id: string) => {
    await fetch(`/api/r/browser/${id}`, { method: "DELETE" }).catch(() => {});
    if (profileId === id) setProfileId("");
    await loadProfiles();
  };

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
        body: JSON.stringify({ url: withScheme, profileId: profileId || undefined }),
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
      <form onSubmit={go} className="flex flex-wrap gap-2 mb-3">
        <label htmlFor="browse-url" className="sr-only">URL to open</label>
        <input id="browse-url" className={`${inputClass} flex-1 min-w-[220px]`} value={url} type="text"
          onChange={(e) => setUrl(e.target.value)} placeholder="example.com" />
        <label htmlFor="browse-profile" className="sr-only">Session profile</label>
        <select id="browse-profile" value={profileId} onChange={(e) => setProfileId(e.target.value)}
          className="px-2.5 py-2 rounded-lg bg-bg-tertiary border border-border-default text-sm text-text-primary
            outline-none focus:border-accent-purple/60">
          <option value="">No session</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>{p.name}{p.hasCookies ? " (signed in)" : ""}</option>
          ))}
        </select>
        <PrimaryButton type="submit" icon="search" disabled={loading}>
          {loading ? "Loading" : "Open"}
        </PrimaryButton>
      </form>

      <details className="mb-4 rounded-xl bg-bg-secondary border border-border-subtle">
        <summary className="px-3.5 py-2.5 text-sm text-text-secondary cursor-pointer select-none
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-purple/60 rounded-xl">
          Session profiles ({profiles.length})
        </summary>
        <div className="px-3.5 pb-3.5">
          <p className="text-xs text-text-tertiary mb-3">
            A profile carries the cookies for a site you are already signed in to, so fetches
            arrive as a returning session instead of an anonymous one. Cookies the site sets
            are stored back automatically. Paste them from your browser&apos;s dev tools.
          </p>

          {editingProfile ? (
            <div className="p-3 rounded-lg bg-bg-tertiary border border-border-default">
              <Field label="Name">
                <input className={inputClass} value={editingProfile.name ?? ""}
                  onChange={(e) => setEditingProfile({ ...editingProfile, name: e.target.value })}
                  placeholder="github" />
              </Field>
              <Field label="Cookies" hint={editingProfile.hasCookies ? "Stored. Leave blank to keep." : "name=value; name2=value2"}>
                <textarea className={`${inputClass} min-h-20 resize-y font-mono`}
                  value={editingProfile.cookies ?? ""}
                  onChange={(e) => setEditingProfile({ ...editingProfile, cookies: e.target.value })}
                  placeholder={editingProfile.hasCookies ? "Unchanged" : "session=abc; csrf=xyz"} />
              </Field>
              <Field label="User agent" hint="Optional. Some sites serve different markup per agent.">
                <input className={inputClass} value={editingProfile.userAgent ?? ""}
                  onChange={(e) => setEditingProfile({ ...editingProfile, userAgent: e.target.value })}
                  placeholder="Mozilla/5.0 ..." />
              </Field>
              <div className="flex gap-2 mt-2">
                <PrimaryButton icon="check" onClick={() => void saveProfile()}>Save</PrimaryButton>
                <button onClick={() => setEditingProfile(null)}
                  className="px-3.5 py-2 rounded-lg text-sm text-text-tertiary hover:text-text-primary hover:bg-bg-hover
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-purple/60">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <ul className="space-y-1.5 mb-2">
                {profiles.map((p) => (
                  <li key={p.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-bg-tertiary">
                    <span className="flex-1 min-w-0 text-sm text-text-secondary truncate">{p.name}</span>
                    {p.hasCookies && <span className="text-xs text-text-tertiary">cookies set</span>}
                    <button onClick={() => setEditingProfile(p)}
                      className="text-xs text-text-tertiary hover:text-text-primary px-1.5
                        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-purple/60 rounded">
                      Edit
                    </button>
                    <DeleteButton onClick={() => void deleteProfile(p.id)} label={`Delete ${p.name}`} />
                  </li>
                ))}
              </ul>
              <PrimaryButton icon="plus" onClick={() => setEditingProfile({ name: "" })}>
                New profile
              </PrimaryButton>
            </>
          )}
        </div>
      </details>

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
