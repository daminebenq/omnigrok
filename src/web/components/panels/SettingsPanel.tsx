import { useEffect, useState } from "react";
import { api, type ModelInfo } from "../../lib/api";
import { PanelShell, PrimaryButton, Field, inputClass, ErrorNote } from "./PanelShell";
import { Icon } from "../Icon";

interface SettingsPanelProps {
  models: ModelInfo[];
  currentModel: string;
  onBrowseCatalog: () => void;
}

export function SettingsPanel({ models, currentModel, onBrowseCatalog }: SettingsPanelProps) {
  const [defaultModel, setDefaultModel] = useState("");
  const [email, setEmail] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getSettings()
      .then((s) => setDefaultModel(String(s.defaultModel ?? "")))
      .catch(() => setError("Could not load settings"));
    fetch("/api/me")
      .then((r) => (r.ok ? (r.json() as Promise<{ email?: string }>) : null))
      .then((b) => b?.email && setEmail(b.email))
      .catch(() => {});
  }, []);

  const save = async () => {
    setStatus("saving");
    setError(null);
    try {
      await api.saveSettings({ defaultModel });
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
      setStatus("idle");
    }
  };

  const providers = Array.from(new Set(models.map((m) => m.provider))).sort();

  return (
    <PanelShell title="Settings" description="Defaults, account and provider status.">
      {error && <ErrorNote message={error} />}

      <section className="p-4 rounded-xl bg-bg-secondary border border-border-subtle mb-4">
        <h3 className="text-sm font-semibold text-text-primary mb-3">Model</h3>
        <p className="text-xs text-text-tertiary mb-3">
          Active in this chat: <span className="font-mono text-text-secondary">{currentModel || "none"}</span>
        </p>
        <Field label="Default model for new chats">
          <select className={inputClass} value={defaultModel} onChange={(e) => setDefaultModel(e.target.value)}>
            <option value="">Use the first available</option>
            {models.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
          </select>
        </Field>
        <div className="flex items-center gap-2 mt-3">
          <PrimaryButton icon="check" onClick={save} disabled={status === "saving"}>
            {status === "saving" ? "Saving" : status === "saved" ? "Saved" : "Save"}
          </PrimaryButton>
          <button onClick={onBrowseCatalog}
            className="px-3.5 py-2 rounded-lg text-sm text-text-tertiary hover:text-text-primary hover:bg-bg-hover
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-purple/60">
            Browse catalog
          </button>
        </div>
      </section>

      <section className="p-4 rounded-xl bg-bg-secondary border border-border-subtle mb-4">
        <h3 className="text-sm font-semibold text-text-primary mb-3">
          Providers <span className="text-text-tertiary font-normal">({models.length} models)</span>
        </h3>
        {providers.length === 0 ? (
          <p className="text-xs text-text-tertiary">
            No providers are returning models. Check that the relevant API key secrets are set on the worker.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {providers.map((p) => (
              <li key={p} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-bg-tertiary border border-border-subtle text-xs">
                <span className="w-1.5 h-1.5 rounded-full bg-accent-green" aria-hidden="true" />
                <span className="text-text-secondary">{p}</span>
                <span className="text-text-tertiary">
                  {models.filter((m) => m.provider === p).length}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="p-4 rounded-xl bg-bg-secondary border border-border-subtle">
        <h3 className="text-sm font-semibold text-text-primary mb-2">Account</h3>
        <div className="flex items-center gap-2 text-xs text-text-tertiary">
          <Icon name="check" size={13} className="text-accent-green" />
          <span>
            Signed in via Cloudflare Access{email ? ` as ${email}` : ""}.
          </span>
        </div>
      </section>
    </PanelShell>
  );
}
