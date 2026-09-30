import { useCallback, useEffect, useState } from "react";

export interface ResourceRecord {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  [key: string]: unknown;
}

export type ResourceKind = "agents" | "projects" | "mcps";

/** CRUD against /api/r/<kind>. Shared by the agents, projects and MCP panels. */
export function useResource<T extends ResourceRecord>(kind: ResourceKind) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/r/${kind}`);
      if (!res.ok) throw new Error(await res.text());
      const body = (await res.json()) as { items: T[] };
      setItems(body.items);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [kind]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(
    async (record: Partial<T>) => {
      const res = await fetch(`/api/r/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(record),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Save failed");
      }
      await load();
    },
    [kind, load]
  );

  const remove = useCallback(
    async (id: string) => {
      setItems((prev) => prev.filter((i) => i.id !== id));
      await fetch(`/api/r/${kind}/${id}`, { method: "DELETE" }).catch(() => {});
      await load();
    },
    [kind, load]
  );

  return { items, loading, error, reload: load, save, remove };
}
