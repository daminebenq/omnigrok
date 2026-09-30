import { Hono } from "hono";
import { cors } from "hono/cors";
import { validateCfAccessToken } from "./auth";
import { streamInference, getAvailableModels } from "./inference";
import { listConversations, getConversation, saveConversation, deleteConversation, getSettings, saveSettings } from "./storage";
import { BUILTIN_TOOLS } from "./tools";

interface Bindings {
  OMNIGROK_KV: KVNamespace;
  ASSETS: Fetcher;
  ALLOWED_AUD: string;
  OMNIROUTE_KEY?: string;
  GROQ_KEY?: string;
  NVIDIA_KEY?: string;
  TOGETHER_KEY?: string;
  HF_KEY?: string;
  OPENAI_KEY?: string;
  GEMINI_KEY?: string;
  BYTEZ_KEY?: string;
  JARVIS_TOKEN?: string;
}

// Generate UUID using Web Crypto API
function generateUUID(): string {
  return crypto.randomUUID();
}

const app = new Hono<{ Bindings: Bindings }>();

app.use("/api/*", cors({ origin: "*", allowMethods: ["GET", "POST", "DELETE", "OPTIONS"] }));

// Auth middleware for API routes
app.use("/api/*", async (c, next) => {
  const token = c.req.header("CF-Access-Jwt-Assertion") ?? c.req.header("Authorization")?.replace("Bearer ", "") ?? null;
  const payload = validateCfAccessToken(token, c.env.ALLOWED_AUD ?? "");
  if (!payload) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  c.set("userId" as any, payload.sub);
  c.set("userEmail" as any, payload.email);
  await next();
});

// Models endpoint - now async to fetch full OmniRoute catalog
app.get("/api/models", async (c) => {
  try {
    const models = await getAvailableModels(c.env as any);
    return c.json({ models });
  } catch (error) {
    console.error("Error fetching models:", error);
    return c.json({ error: "Failed to fetch models" }, 500);
  }
});

// Conversations
app.get("/api/conversations", async (c) => {
  const userId = (c as any).get("userId");
  const convs = await listConversations(c.env.OMNIGROK_KV, userId);
  return c.json({ conversations: convs });
});

app.get("/api/conversations/:id", async (c) => {
  const userId = (c as any).get("userId");
  const id = c.req.param("id");
  const conv = await getConversation(c.env.OMNIGROK_KV, userId, id);
  if (!conv) return c.json({ error: "Not found" }, 404);
  return c.json(conv);
});

app.delete("/api/conversations/:id", async (c) => {
  const userId = (c as any).get("userId");
  const id = c.req.param("id");
  await deleteConversation(c.env.OMNIGROK_KV, userId, id);
  return c.json({ ok: true });
});

// Settings
app.get("/api/settings", async (c) => {
  const userId = (c as any).get("userId");
  const settings = await getSettings(c.env.OMNIGROK_KV, userId);
  return c.json(settings);
});

app.post("/api/settings", async (c) => {
  const userId = (c as any).get("userId");
  const body = await c.req.json();
  await saveSettings(c.env.OMNIGROK_KV, userId, body);
  return c.json({ ok: true });
});

// Chat endpoint with streaming
app.post("/api/chat", async (c) => {
  try {
    const userId = (c as any).get("userId");
    const body = await c.req.json();
    const messages = body.messages;
    const model = body.model;
    let conversationId = body.conversationId as string | undefined;

    if (!messages || !model) {
      return c.json({ error: "Missing messages or model" }, 400);
    }

    // Reuse existing conversation if the client supplied an id, else create one
    if (!conversationId) {
      conversationId = generateUUID();
    }
    const existing = await getConversation(c.env.OMNIGROK_KV, userId, conversationId).catch(() => null);
    const createdAt = existing?.createdAt || Date.now();

    // Persist the user turn immediately so a reload never loses the question
    await saveConversation(c.env.OMNIGROK_KV, userId, {
      id: conversationId,
      title: existing?.title || messages[0]?.content?.slice(0, 50) || "New Chat",
      model,
      messages,
      createdAt,
      updatedAt: Date.now(),
    });

    // Start streaming inference
    const stream = await streamInference(messages, model, c.env as any);

    // Tee the stream: one branch to the client, one to accumulate the reply
    const [clientStream, saveStream] = stream.tee();

    // Background task: read the full assistant reply and persist it
    const persist = (async () => {
      try {
        const reader = saveStream.getReader();
        const decoder = new TextDecoder();
        let assistant = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          assistant += decoder.decode(value, { stream: true });
        }
        await saveConversation(c.env.OMNIGROK_KV, userId, {
          id: conversationId!,
          title: existing?.title || messages[0]?.content?.slice(0, 50) || "New Chat",
          model,
          messages: [...messages, { role: "assistant", content: assistant }],
          createdAt,
          updatedAt: Date.now(),
        });
      } catch (err) {
        console.error("Failed to persist assistant reply:", err);
      }
    })();
    if ((c as any).executionCtx?.waitUntil) {
      (c as any).executionCtx.waitUntil(persist);
    }

    return new Response(clientStream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Conversation-Id": conversationId,
      },
    });
  } catch (error) {
    console.error("Chat error:", error);
    return c.json({ error: "Chat failed" }, 500);
  }
});

app.get("*", async (c) => {
  const response = await c.env.ASSETS.fetch(c.req.raw);
  return response;
});

export default app;
