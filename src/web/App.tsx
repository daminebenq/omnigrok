import { useState, useEffect, useCallback } from "react";
import { Sidebar } from "./components/Sidebar";
import { ChatArea } from "./components/ChatArea";
import { api, streamChat } from "./lib/api";
import type { Conversation, Message, ModelInfo } from "./lib/api";

function newConv(model: string): Conversation {
  return {
    id: crypto.randomUUID(),
    title: "New Chat",
    model,
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export default function App() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);

  const activeConv = conversations.find((c) => c.id === activeId) ?? null;
  const defaultModel = models[0]?.id ?? "antigravity/claude-sonnet-4-6";

  useEffect(() => {
    api.models().then((r) => setModels(r.models)).catch(() => {});
    api.conversations().then((r) => {
      setConversations(r.conversations);
      if (r.conversations.length > 0) setActiveId(r.conversations[0].id);
    }).catch(() => {});
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        handleNewChat();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  const handleNewChat = useCallback(() => {
    const conv = newConv(activeConv?.model ?? defaultModel);
    setConversations((prev) => [conv, ...prev]);
    setActiveId(conv.id);
  }, [activeConv?.model, defaultModel]);

  const handleSelectConv = (id: string) => setActiveId(id);

  const handleDeleteConv = async (id: string) => {
    await api.deleteConversation(id).catch(() => {});
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeId === id) {
      const remaining = conversations.filter((c) => c.id !== id);
      setActiveId(remaining[0]?.id ?? null);
    }
  };

  const handleModelChange = (model: string) => {
    if (!activeConv) return;
    setConversations((prev) =>
      prev.map((c) => (c.id === activeConv.id ? { ...c, model } : c))
    );
  };

  const handleSend = async (content: string) => {
    if (!content.trim() || streaming) return;

    let conv = activeConv;
    if (!conv) {
      conv = newConv(defaultModel);
      setConversations((prev) => [conv!, ...prev]);
      setActiveId(conv.id);
    }

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

    const updatedConv: Conversation = {
      ...conv,
      messages: [...conv.messages, userMsg, assistantMsg],
      title: conv.messages.length === 0 ? content.slice(0, 60) : conv.title,
      updatedAt: Date.now(),
    };

    setConversations((prev) =>
      prev.map((c) => (c.id === updatedConv.id ? updatedConv : c))
    );

    setStreaming(true);
    try {
      const allMessages = [...conv.messages, userMsg].map((m) => ({
        role: m.role,
        content: m.content,
      }));

      let accumulated = "";
      for await (const chunk of streamChat(conv.model, allMessages, conv.id)) {
        accumulated += chunk;
        const finalAcc = accumulated;
        setConversations((prev) =>
          prev.map((c) =>
            c.id === updatedConv.id
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === assistantMsg.id ? { ...m, content: finalAcc } : m
                  ),
                }
              : c
          )
        );
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : "Stream failed";
      setConversations((prev) =>
        prev.map((c) =>
          c.id === updatedConv.id
            ? {
                ...c,
                messages: c.messages.map((m) =>
                  m.id === assistantMsg.id
                    ? { ...m, content: `Error: ${errMsg}` }
                    : m
                ),
              }
            : c
        )
      );
    } finally {
      setStreaming(false);
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-bg-primary">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <Sidebar
        open={sidebarOpen}
        conversations={conversations}
        activeId={activeId}
        onSelect={handleSelectConv}
        onDelete={handleDeleteConv}
        onNewChat={handleNewChat}
        models={models}
        currentModel={activeConv?.model ?? defaultModel}
        onModelChange={handleModelChange}
        onClose={() => setSidebarOpen(false)}
      />

      <ChatArea
        conversation={activeConv}
        streaming={streaming}
        onSend={handleSend}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
        sidebarOpen={sidebarOpen}
      />
    </div>
  );
}
