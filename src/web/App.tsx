import { useState, useEffect, useCallback } from "react";
import { Dashboard } from "./components/Dashboard";
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
  const [activeConvId, setActiveConvId] = useState<string>("");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [streaming, setStreaming] = useState(false);

  const activeConv = conversations.find((c) => c.id === activeConvId);

  // Load models on mount
  useEffect(() => {
    api.getModels().then(setModels);
  }, []);

  // Auto-create first conversation when models load
  useEffect(() => {
    if (models.length && !conversations.length) {
      const first = newConv(models[0].id);
      setConversations([first]);
      setActiveConvId(first.id);
    }
  }, [models, conversations]);

  // Model change handler
  const handleModelChange = useCallback((model: string) => {
    if (!activeConv) return;
    
    setConversations(prev => 
      prev.map(c => 
        c.id === activeConv.id 
          ? { ...c, model, updatedAt: Date.now() }
          : c
      )
    );
  }, [activeConv]);

  // Send message handler
  const handleSend = useCallback(async (content: string) => {
    if (!activeConv || streaming) return;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      timestamp: Date.now(),
    };

    const assistantMsg: Message = {
      id: crypto.randomUUID(),
      role: "assistant", 
      content: "",
      timestamp: Date.now(),
    };

    // Add messages immediately
    setConversations(prev =>
      prev.map(c =>
        c.id === activeConv.id
          ? { ...c, messages: [...c.messages, userMsg, assistantMsg], updatedAt: Date.now() }
          : c
      )
    );

    setStreaming(true);

    try {
      await streamChat({
        messages: [...activeConv.messages, userMsg],
        model: activeConv.model,
        onChunk: (chunk) => {
          setConversations(prev =>
            prev.map(c =>
              c.id === activeConv.id
                ? {
                    ...c,
                    messages: c.messages.map(m =>
                      m.id === assistantMsg.id
                        ? { ...m, content: m.content + chunk }
                        : m
                    ),
                    updatedAt: Date.now(),
                  }
                : c
            )
          );
        },
      });
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : "Stream failed";
      setConversations(prev =>
        prev.map(c =>
          c.id === activeConv.id
            ? {
                ...c,
                messages: c.messages.map(m =>
                  m.id === assistantMsg.id
                    ? { ...m, content: `Error: ${errMsg}` }
                    : m
                ),
                updatedAt: Date.now(),
              }
            : c
        )
      );
    } finally {
      setStreaming(false);
    }
  }, [activeConv, streaming]);

  if (!activeConv) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50 dark:bg-gray-900">
        <div className="text-gray-600 dark:text-gray-400">Loading...</div>
      </div>
    );
  }

  return (
    <Dashboard
      models={models}
      currentModel={activeConv.model}
      onModelChange={handleModelChange}
      messages={activeConv.messages}
      onSendMessage={handleSend}
      isLoading={streaming}
    />
  );
}
