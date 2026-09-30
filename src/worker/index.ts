import { Hono } from "hono";
import { cors } from "hono/cors";
import { validateCfAccessToken } from "./auth";
import { streamInference, getAvailableModels } from "./inference";
import { listConversations, getConversation, saveConversation, deleteConversation, getSettings, saveSettings } from "./storage";
import { BUILTIN_TOOLS } from "./tools";
import { randomUUID } from "node:crypto";

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

// Models endpoint
app.get("/api/models", (c) => {
  const models = getAvailableModels(c.env as any);
  return c.json({ models });
});

// Conversations
app.get("/api/conversations", async (c) => {
  const userId = (c as any).get("userId");
  const convs = await listConversations(c.env.OMNIGROK_KV, userId);
  return c.json({ conversations: convs });
});

app.get("/api/conversations/:id", async (c) => {
  const userId = (c as any).get("userId");
  const conv = await getConversation(c.env.OMNIGROK_KV, userId, c.req.param("id"));
  if (!conv) return c.json({ error: "Not found" }, 404);
  return c.json(conv);
});

app.delete("/api/conversations/:id", async (c) => {
  const userId = (c as any).get("userId");
  await deleteConversation(c.env.OMNIGROK_KV, userId, c.req.param("id"));
  return c.json({ ok: true });
});

// Inference streaming
app.post("/api/chat", async (c) => {
  const userId = (c as any).get("userId");
  const { model, messages, conversationId, title } = await c.req.json<{
    model: string;
    messages: Array<{ role: string; content: string }>;
    conversationId?: string;
    title?: string;
  }>();

  // Save/update conversation
  const convId = conversationId ?? crypto.randomUUID();
  const existing = conversationId ? await getConversation(c.env.OMNIGROK_KV, userId, convId) : null;
  const conv = existing ?? {
    id: convId,
    title: title ?? messages[0]?.content?.slice(0, 60) ?? "New Chat",
    model,
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  // Add user messages
  const newMessages = messages.filter((m) => !conv.messages.find((e: any) => e.content === m.content && e.role === m.role));
  conv.messages.push(...newMessages.map((m) => ({ id: crypto.randomUUID(), ...m, createdAt: Date.now() })));
  conv.updatedAt = Date.now();
  await saveConversation(c.env.OMNIGROK_KV, userId, conv as any);

  // Proxy stream to provider
  const streamRes = await streamInference(model, messages, BUILTIN_TOOLS, c.env as any);
  return streamRes;
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

// Static assets fallback
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
