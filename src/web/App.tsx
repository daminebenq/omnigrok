import { useState, useEffect, useCallback, useRef } from "react";
import { Dashboard } from "./components/Dashboard";
import { api, streamChat, attachChat, cancelChat, ApiError } from "./lib/api";
import type {
  Conversation,
  Message,
  ModelInfo,
  TokenUsage,
  ToolEvent,
  StreamHandlers,
} from "./lib/api";

export interface LiveLogs {
  reasoning: string;
  usage?: TokenUsage;
  tools: ToolEvent[];
  startedAt: number;
  /** Populated when a rate limit rerouted the turn to another model. */
  switchedTo?: string;
  switchReason?: string;
}

function newConv(model: string): Conversation {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title: "New Chat",
    model,
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

export default function App() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string>("");
  const [models, setModels] = useState<ModelInfo[]>([]);
  // Per-conversation, so several threads can generate at the same time.
  const [streamingIds, setStreamingIds] = useState<Set<string>>(new Set());
  const [logsByConv, setLogsByConv] = useState<Record<string, LiveLogs>>({});
  const [sidebarOpen, setSidebarOpen] = useState(
    () => typeof window === "undefined" || window.innerWidth >= 1024
  );
  const [booted, setBooted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<Map<string, AbortController>>(new Map());
  const activeConv = conversations.find((c) => c.id === activeConvId) ?? null;

  const patchConv = useCallback(
    (id: string, fn: (c: Conversation) => Conversation) => {
      setConversations((prev) => prev.map((c) => (c.id === id ? fn(c) : c)));
    },
    []
  );

  const setStreaming = useCallback((id: string, on: boolean) => {
    setStreamingIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  /** Handlers shared by a fresh run and a re-attach. */
  const handlersFor = useCallback(
    (convId: string, assistantId: string, seqRef: { current: number }): StreamHandlers => {
      const patchMsg = (patch: (m: Message) => Message) =>
        patchConv(convId, (c) => ({
          ...c,
          messages: c.messages.map((m) => (m.id === assistantId ? patch(m) : m)),
          updatedAt: Date.now(),
        }));

      return {
        onSeq: (seq) => {
          seqRef.current = seq + 1;
        },
        onToken: (chunk) => patchMsg((m) => ({ ...m, content: m.content + chunk })),
        onModel: (evt) =>
          setLogsByConv((prev) => {
            const cur = prev[convId];
            return cur
              ? { ...prev, [convId]: { ...cur, switchedTo: evt.model, switchReason: evt.reason } }
              : prev;
          }),
        onReasoning: (chunk) => {
          setLogsByConv((prev) => {
            const cur = prev[convId];
            return cur ? { ...prev, [convId]: { ...cur, reasoning: cur.reasoning + chunk } } : prev;
          });
          patchMsg((m) => ({ ...m, reasoning: (m.reasoning ?? "") + chunk }));
        },
        onUsage: (usage) =>
          setLogsByConv((prev) => {
            const cur = prev[convId];
            return cur ? { ...prev, [convId]: { ...cur, usage } } : prev;
          }),
        onTool: (evt) =>
          setLogsByConv((prev) => {
            const cur = prev[convId];
            if (!cur) return prev;
            const tools = cur.tools.some((t) => t.id === evt.id)
              ? cur.tools.map((t) => (t.id === evt.id ? evt : t))
              : [...cur.tools, evt];
            return { ...prev, [convId]: { ...cur, tools } };
          }),
      };
    },
    [patchConv]
  );

  /** Pull the authoritative copy once a run ends, without losing local text. */
  const reconcile = useCallback(
    (convId: string) => {
      api
        .getConversation(convId)
        .then((fresh) =>
          patchConv(convId, (local) =>
            fresh.messages.length >= local.messages.length ? fresh : local
          )
        )
        .catch(() => {});
    },
    [patchConv]
  );

  /**
   * Re-attach to a run that is still going server-side. This is what makes a
   * reload (or picking the thread up on another device) lossless.
   */
  const resume = useCallback(
    async (conv: Conversation) => {
      const last = conv.messages[conv.messages.length - 1];
      let assistantId: string;

      if (last?.role === "assistant") {
        assistantId = last.id;
      } else {
        // The reply had not been recorded yet; make a placeholder to fill.
        const placeholder: Message = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "",
          createdAt: Date.now(),
        };
        assistantId = placeholder.id;
        patchConv(conv.id, (c) => ({ ...c, messages: [...c.messages, placeholder] }));
      }

      // Replay from the start of the run so nothing that arrived while the
      // page was gone is missed; the buffer is small and bounded by one turn.
      patchConv(conv.id, (c) => ({
        ...c,
        messages: c.messages.map((m) => (m.id === assistantId ? { ...m, content: "", reasoning: "" } : m)),
      }));

      setStreaming(conv.id, true);
      setLogsByConv((prev) => ({
        ...prev,
        [conv.id]: { reasoning: "", tools: [], startedAt: Date.now() },
      }));

      const controller = new AbortController();
      abortRef.current.set(conv.id, controller);
      const seqRef = { current: 0 };

      try {
        await attachChat({
          conversationId: conv.id,
          from: 0,
          signal: controller.signal,
          ...handlersFor(conv.id, assistantId, seqRef),
        });
      } catch (e) {
        if ((e as Error)?.name !== "AbortError") {
          setError(e instanceof Error ? e.message : "Lost the stream");
        }
      } finally {
        abortRef.current.delete(conv.id);
        setStreaming(conv.id, false);
        setLogsByConv((prev) => {
          const { [conv.id]: _drop, ...rest } = prev;
          return rest;
        });
        reconcile(conv.id);
      }
    },
    [handlersFor, patchConv, reconcile, setStreaming]
  );

  // Boot: models + threads, then re-attach anything still running.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [modelResult, convResult] = await Promise.allSettled([
        api.getModels(),
        api.getConversations(),
      ]);
      if (cancelled) return;

      const loadedModels = modelResult.status === "fulfilled" ? modelResult.value : [];
      const loadedConvs = convResult.status === "fulfilled" ? convResult.value : [];

      if (modelResult.status === "rejected") {
        setError(
          modelResult.reason instanceof ApiError && modelResult.reason.status === 401
            ? "Session expired. Reload the page to sign in again."
            : "Could not load the model catalog."
        );
      }

      setModels(loadedModels);
      setConversations(loadedConvs);
      setActiveConvId(loadedConvs[0]?.id ?? "");
      setBooted(true);

      for (const conv of loadedConvs.filter((c) => c.status === "generating")) {
        void resume(conv);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Runs once; `resume` is stable enough for boot and re-running would
    // double-attach to live sessions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!booted || conversations.length || !models.length) return;
    const first = newConv(models[0].id);
    setConversations([first]);
    setActiveConvId(first.id);
  }, [booted, conversations.length, models]);

  const handleNewChat = useCallback(() => {
    if (!models.length) return;
    const conv = newConv(activeConv?.model ?? models[0].id);
    setConversations((prev) => [conv, ...prev]);
    setActiveConvId(conv.id);
  }, [models, activeConv]);

  const handleDeleteConv = useCallback(async (id: string) => {
    abortRef.current.get(id)?.abort();
    abortRef.current.delete(id);
    setConversations((prev) => {
      const next = prev.filter((c) => c.id !== id);
      setActiveConvId((cur) => (cur === id ? next[0]?.id ?? "" : cur));
      return next;
    });
    await api.deleteConversation(id).catch(() => {});
  }, []);

  const handleModelChange = useCallback(
    (model: string) => {
      if (!activeConv) return;
      const updated = { ...activeConv, model, updatedAt: Date.now() };
      patchConv(activeConv.id, () => updated);
      if (updated.messages.length) api.saveConversation(updated).catch(() => {});
    },
    [activeConv, patchConv]
  );

  /** Stop generating. Also tells the session to stop, not just this client. */
  const handleStop = useCallback(() => {
    if (!activeConv) return;
    const id = activeConv.id;
    void cancelChat(id);
    abortRef.current.get(id)?.abort();
    abortRef.current.delete(id);
    setStreaming(id, false);
  }, [activeConv, setStreaming]);

  const handleSend = useCallback(
    async (content: string) => {
      if (!activeConv || streamingIds.has(activeConv.id)) return;
      setError(null);

      const convId = activeConv.id;
      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content,
        createdAt: Date.now(),
      };
      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "",
        createdAt: Date.now(),
      };

      const outbound = [...activeConv.messages, userMsg];
      const title =
        activeConv.title === "New Chat"
          ? content.replace(/\s+/g, " ").trim().slice(0, 60)
          : activeConv.title;

      patchConv(convId, (c) => ({
        ...c,
        title,
        messages: [...outbound, assistantMsg],
        updatedAt: Date.now(),
      }));

      setStreaming(convId, true);
      setLogsByConv((prev) => ({
        ...prev,
        [convId]: { reasoning: "", tools: [], startedAt: Date.now() },
      }));

      const controller = new AbortController();
      abortRef.current.set(convId, controller);
      const seqRef = { current: 0 };

      try {
        await streamChat({
          conversationId: convId,
          messages: outbound,
          model: activeConv.model,
          signal: controller.signal,
          ...handlersFor(convId, assistantMsg.id, seqRef),
        });
      } catch (e) {
        if ((e as Error)?.name === "AbortError") return;
        const msg = e instanceof Error ? e.message : "Stream failed";
        setError(msg);
        patchConv(convId, (c) => ({
          ...c,
          messages: c.messages.map((m) =>
            m.id === assistantMsg.id && !m.content
              ? { ...m, content: `Request failed: ${msg}` }
              : m
          ),
        }));
      } finally {
        abortRef.current.delete(convId);
        setStreaming(convId, false);
        setLogsByConv((prev) => {
          const { [convId]: _drop, ...rest } = prev;
          return rest;
        });
        reconcile(convId);
      }
    },
    [activeConv, streamingIds, patchConv, handlersFor, reconcile, setStreaming]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        handleNewChat();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleNewChat]);

  if (!booted) {
    return (
      <div className="flex items-center justify-center h-screen bg-bg-primary">
        <div className="flex items-center gap-3 text-text-tertiary text-sm">
          <span className="w-4 h-4 rounded-full border-2 border-accent-purple border-t-transparent animate-spin" />
          Loading OmniGrok
        </div>
      </div>
    );
  }

  return (
    <Dashboard
      models={models}
      conversations={conversations}
      activeConv={activeConv}
      activeConvId={activeConvId}
      streaming={activeConv ? streamingIds.has(activeConv.id) : false}
      streamingIds={streamingIds}
      logs={activeConv ? logsByConv[activeConv.id] ?? null : null}
      error={error}
      sidebarOpen={sidebarOpen}
      onToggleSidebar={() => setSidebarOpen((v) => !v)}
      onSelectConv={setActiveConvId}
      onNewChat={handleNewChat}
      onDeleteConv={handleDeleteConv}
      onModelChange={handleModelChange}
      onSend={handleSend}
      onStop={handleStop}
      onDismissError={() => setError(null)}
    />
  );
}
