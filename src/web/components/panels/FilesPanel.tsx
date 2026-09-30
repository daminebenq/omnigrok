import { useCallback, useEffect, useRef, useState } from "react";
import { PanelShell, PrimaryButton, EmptyState, Skeleton, ErrorNote, DeleteButton } from "./PanelShell";
import { Icon } from "../Icon";

interface StoredFile {
  id: string;
  name: string;
  size: number;
  contentType: string;
  backend: string;
  createdAt: number;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)} ${units[i]}`;
}

export function FilesPanel() {
  const [items, setItems] = useState<StoredFile[]>([]);
  const [backends, setBackends] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/files");
      if (!res.ok) throw new Error(await res.text());
      const body = (await res.json()) as { items: StoredFile[]; backends: string[] };
      setItems(body.items);
      setBackends(body.backends);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load files");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/files", { method: "POST", body: form });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `Upload of ${file.name} failed`);
        }
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const remove = async (id: string) => {
    setItems((prev) => prev.filter((f) => f.id !== id));
    await fetch(`/api/files/${id}`, { method: "DELETE" }).catch(() => {});
    await load();
  };

  const configured = backends.length > 0;

  return (
    <PanelShell
      title="Files"
      description={
        configured
          ? `Stored on: ${backends.join(", ")}.`
          : "Upload and manage files across your storage backends."
      }
      action={
        <PrimaryButton icon="upload" disabled={!configured || uploading}
          onClick={() => inputRef.current?.click()}>
          {uploading ? "Uploading" : "Upload files"}
        </PrimaryButton>
      }
    >
      <input ref={inputRef} type="file" multiple className="sr-only"
        onChange={(e) => void upload(e.target.files)} />

      {error && <ErrorNote message={error} />}

      {!configured && !loading && (
        <div className="p-4 rounded-xl bg-bg-secondary border border-border-default mb-4">
          <div className="flex items-start gap-2">
            <Icon name="warning" size={15} className="text-accent-yellow mt-0.5 shrink-0" />
            <div className="text-sm text-text-secondary">
              <p className="text-text-primary font-medium mb-1">No storage backend configured</p>
              <p className="text-text-tertiary text-xs leading-relaxed">
                Bind an R2 bucket as <code className="font-mono text-text-secondary">FILES_R2</code> in
                {" "}<code className="font-mono text-text-secondary">wrangler.jsonc</code>, or set the
                S3-compatible secrets for MinIO, Backblaze B2 or Oracle OCI. See the README for the
                exact variable names.
              </p>
            </div>
          </div>
        </div>
      )}

      {loading ? <Skeleton /> : items.length === 0 ? (
        <EmptyState icon="files" message={configured ? "No files uploaded yet." : "Configure a backend to start uploading."} />
      ) : (
        <ul className="space-y-2">
          {items.map((f) => (
            <li key={f.id} className="flex items-center gap-3 p-3.5 rounded-xl bg-bg-secondary border border-border-subtle">
              <Icon name="files" size={16} className="text-text-tertiary shrink-0" />
              <div className="flex-1 min-w-0">
                <a href={`/api/files/${f.id}/content`} target="_blank" rel="noopener noreferrer"
                  className="text-sm text-text-primary hover:text-accent-purple transition-colors truncate block
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-purple/60 rounded">
                  {f.name}
                </a>
                <p className="text-xs text-text-tertiary mt-0.5">
                  {formatSize(f.size)} · {f.backend}
                </p>
              </div>
              <DeleteButton onClick={() => void remove(f.id)} label={`Delete ${f.name}`} />
            </li>
          ))}
        </ul>
      )}
    </PanelShell>
  );
}
