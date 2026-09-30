import { useState, useEffect, useCallback, useRef } from "react";
import { Dashboard } from "./components/Dashboard";
import { api, streamChat, ApiError } from "./lib/api";
import type { Conversation, Message, ModelInfo, TokenUsage, ToolEvent } from "./lib/api";

export interface LiveLogs {
  reasoning: string;
  usage?: TokenUsage;
  tools: ToolEvent[];
  startedAt: number;
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
  const [streaming, setStreaming] = useState(false);
  const [logs, setLogs] = useState<LiveLogs | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [booted, setBooted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const activeConv = conversations.find((c) => c.id === activeConvId) ?? null;

  // Boot: models and the persisted thread list load together, so a reload (or
  // a different device) picks up exactly where the user left off.
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
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Only mint a local conversation once we know the server had none.
  useEffect(() => {
    if (!booted || conversations.length || !models.length) return;
    const first = newConv(models[0].id);
    setConversations([first]);
    setActiveConvId(first.id);
  }, [booted, conversations.length, models]);

  const patchConv = useCallback(
    (id: string, fn: (c: Conversation) => Conversation) => {
      setConversations((prev) => prev.map((c) => (c.id === id ? fn(c) : c)));
    },
    []
  );

  const handleNewChat = useCallback(() => {
    if (!models.length) return;
    const conv = newConv(activeConv?.model ?? models[0].id);
    setConversations((prev) => [conv, ...prev]);
    setActiveConvId(conv.id);
  }, [models, activeConv]);

  const handleDeleteConv = useCallback(
    async (id: string) => {
      setConversations((prev) => {
        const next = prev.filter((c) => c.id !== id);
        setActiveConvId((cur) => (cur === id ? next[0]?.id ?? "" : cur));
        return next;
      });
      await api.deleteConversation(id).catch(() => {});
    },
    []
  );

  const handleModelChange = useCallback(
    (model: string) => {
      if (!activeConv) return;
      const updated = { ...activeConv, model, updatedAt: Date.now() };
      patchConv(activeConv.id, () => updated);
      // Persist only threads the server already knows about; empty new chats
      // are written on first send.
      if (updated.messages.length) api.saveConversation(updated).catch(() => {});
    },
    [activeConv, patchConv]
  );

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
    setLogs(null);
  }, []);

  const handleSend = useCallback(
    async (content: string) => {
      if (!activeConv || streaming) return;
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

      setStreaming(true);
      setLogs({ reasoning: "", tools: [], startedAt: Date.now() });

      const controller = new AbortController();
      abortRef.current = controller;

      const appendTo = (id: string, patch: (m: Message) => Message) =>
        patchConv(convId, (c) => ({
          ...c,
          messages: c.messages.map((m) => (m.id === id ? patch(m) : m)),
          updatedAt: Date.now(),
        }));

      try {
        await streamChat({
          conversationId: convId,
          messages: outbound,
          model: activeConv.model,
          signal: controller.signal,
          onToken: (chunk) =>
            appendTo(assistantMsg.id, (m) => ({ ...m, content: m.content + chunk })),
          onReasoning: (chunk) => {
            setLogs((l) => (l ? { ...l, reasoning: l.reasoning + chunk } : l));
            appendTo(assistantMsg.id, (m) => ({
              ...m,
              reasoning: (m.reasoning ?? "") + chunk,
            }));
          },
          onUsage: (usage) => setLogs((l) => (l ? { ...l, usage } : l)),
          onTool: (evt) =>
            setLogs((l) =>
              l
                ? {
                    ...l,
                    tools: l.tools.some((t) => t.id === evt.id)
                      ? l.tools.map((t) => (t.id === evt.id ? evt : t))
                      : [...l.tools, evt],
                  }
                : l
            ),
        });
      } catch (e) {
        if ((e as Error)?.name === "AbortError") return;
        const msg = e instanceof Error ? e.message : "Stream failed";
        setError(msg);
        appendTo(assistantMsg.id, (m) => ({
          ...m,
          content: m.content || `Request failed: ${msg}`,
        }));
      } finally {
        abortRef.current = null;
        setStreaming(false);
        setLogs(null);
        // Refresh from the server, which holds the authoritative copy written
        // after the stream finished.
        api
          .getConversation(convId)
          .then((fresh) => patchConv(convId, () => fresh))
          .catch(() => {});
      }
    },
    [activeConv, streaming, patchConv]
  );

  // Keyboard: new chat.
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
      streaming={streaming}
      logs={logs}
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
