import { Hono } from "hono";
import { validateCfAccessToken } from "./auth";
import { getAvailableModels } from "./inference";
import { route } from "./router";
import { summarizeUsage } from "./usage";
import { getInventory, type CfEnv } from "./cfresources";
export { ChatSession } from "./session";
import {
  listRecords,
  getRecord,
  putRecord,
  deleteRecord,
  redact,
  isCollection,
  type BaseRecord,
} from "./resources";
import { browse } from "./browse";
import { probeMcpServer } from "./mcp";
import { buildToolset } from "./tools";
import { putFile, getFile, deleteFile, availableBackends, type FileEnv } from "./files";
import {
  listConversations,
  getConversation,
  saveConversation,
  deleteConversation,
  getSettings,
  saveSettings,
  type Conversation,
  type Message,
} from "./storage";

interface Bindings {
  OMNIGROK_KV: KVNamespace;
  CHAT_SESSION: DurableObjectNamespace;
  ASSETS: Fetcher;
  ALLOWED_AUD: string;
  ACCESS_TEAM_DOMAIN: string;
  OMNIROUTE_KEY?: string;
  OMNIROUTE_BASE_URL?: string;
  CF_API_TOKEN?: string;
  CF_ACCOUNT_ID?: string;
  GROQ_KEY?: string;
  NVIDIA_KEY?: string;
  TOGETHER_KEY?: string;
  HF_KEY?: string;
  OPENAI_KEY?: string;
  GEMINI_KEY?: string;
  BYTEZ_KEY?: string;
  JARVIS_TOKEN?: string;
  FILES_R2?: R2Bucket;
  MINIO_ENDPOINT?: string;
  MINIO_REGION?: string;
  MINIO_BUCKET?: string;
  MINIO_ACCESS_KEY_ID?: string;
  MINIO_SECRET_ACCESS_KEY?: string;
  B2_ENDPOINT?: string;
  B2_REGION?: string;
  B2_BUCKET?: string;
  B2_KEY_ID?: string;
  B2_APP_KEY?: string;
  OCI_ENDPOINT?: string;
  OCI_REGION?: string;
  OCI_BUCKET?: string;
  OCI_ACCESS_KEY_ID?: string;
  OCI_SECRET_ACCESS_KEY?: string;
}

// Typed context vars, so c.set/c.get are checked rather than cast to any.
interface Variables {
  userId: string;
  userEmail: string;
}

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// No CORS wildcard: this app is same-origin behind Access. Allowing "*" would
// let any site drive the API with the user's Access cookie.
app.use("/api/*", async (c, next) => {
  // Only the Access-injected header is trusted. A client-supplied bearer token
  // would be an authentication bypass.
  const token = c.req.header("CF-Access-Jwt-Assertion") ?? null;
  const payload = await validateCfAccessToken(
    token,
    c.env.ALLOWED_AUD ?? "",
    c.env.ACCESS_TEAM_DOMAIN ?? ""
  );
  if (!payload) return c.json({ error: "Unauthorized" }, 401);
  c.set("userId", payload.sub);
  c.set("userEmail", payload.email);
  await next();
});

app.get("/api/me", (c) => c.json({ email: c.get("userEmail") }));

app.get("/api/models", async (c) => {
  try {
    const models = await getAvailableModels(c.env);
    return c.json({ models });
  } catch (error) {
    console.error("Error fetching models:", error);
    return c.json({ error: "Failed to fetch models" }, 500);
  }
});

// --- Conversations --------------------------------------------------------

app.get("/api/conversations", async (c) => {
  const convs = await listConversations(c.env.OMNIGROK_KV, c.get("userId"));
  return c.json({ conversations: convs });
});

app.get("/api/conversations/:id", async (c) => {
  const conv = await getConversation(c.env.OMNIGROK_KV, c.get("userId"), c.req.param("id"));
  if (!conv) return c.json({ error: "Not found" }, 404);
  return c.json(conv);
});

// Upsert. Used for new/renamed chats and model switches.
app.post("/api/conversations", async (c) => {
  const body = await c.req.json<Partial<Conversation>>();
  if (!body.id) return c.json({ error: "Missing conversation id" }, 400);
  const now = Date.now();
  const conv: Conversation = {
    id: body.id,
    title: body.title ?? "New Chat",
    model: body.model ?? "",
    messages: body.messages ?? [],
    createdAt: body.createdAt ?? now,
    updatedAt: now,
  };
  await saveConversation(c.env.OMNIGROK_KV, c.get("userId"), conv);
  return c.json({ ok: true, conversation: conv });
});

app.delete("/api/conversations/:id", async (c) => {
  await deleteConversation(c.env.OMNIGROK_KV, c.get("userId"), c.req.param("id"));
  return c.json({ ok: true });
});

// --- Settings -------------------------------------------------------------

app.get("/api/settings", async (c) => {
  return c.json(await getSettings(c.env.OMNIGROK_KV, c.get("userId")));
});

app.post("/api/settings", async (c) => {
  await saveSettings(c.env.OMNIGROK_KV, c.get("userId"), await c.req.json());
  return c.json({ ok: true });
});

// --- Chat -----------------------------------------------------------------

function deriveTitle(messages: Message[]): string {
  const first = messages.find((m) => m.role === "user")?.content ?? "";
  const clean = first.replace(/\s+/g, " ").trim();
  if (!clean) return "New Chat";
  return clean.length > 60 ? `${clean.slice(0, 60)}...` : clean;
}

/** One session per (user, conversation), so ids never collide across users. */
function sessionStub(c: any, conversationId: string) {
  const name = `${c.get("userId")}:${conversationId}`;
  return c.env.CHAT_SESSION.get(c.env.CHAT_SESSION.idFromName(name));
}

app.post("/api/chat", async (c) => {
  const userId = c.get("userId");
  const kv = c.env.OMNIGROK_KV;

  let body: { messages?: Message[]; model?: string; conversationId?: string; title?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const { messages, conversationId } = body;
  let model = body.model;
  if (!Array.isArray(messages) || !messages.length || !model) {
    return c.json({ error: "Missing messages or model" }, 400);
  }
  if (!conversationId) return c.json({ error: "Missing conversationId" }, 400);

  // "auto" means: pick the right model for this particular request.
  let task: string | undefined;
  let routed = false;
  if (model === "auto") {
    const catalog = await getAvailableModels(c.env);
    const decision = route(catalog, messages);
    if (!decision.model) {
      return c.json({ error: "Auto routing found no available model" }, 503);
    }
    model = decision.model;
    task = decision.task;
    routed = true;
  }

  // Record the question and mark the thread as running before handing off, so
  // another device that loads mid-run knows to attach.
  const existing = await getConversation(kv, userId, conversationId);
  const conv: Conversation = existing ?? {
    id: conversationId,
    title: body.title ?? deriveTitle(messages),
    model,
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  conv.model = model;
  conv.messages = messages;
  conv.updatedAt = Date.now();
  conv.status = "generating";
  conv.lastError = undefined;
  if (!conv.title || conv.title === "New Chat") conv.title = deriveTitle(messages);
  await saveConversation(kv, userId, conv);

  return sessionStub(c, conversationId).fetch(
    new Request("https://session/start", {
      method: "POST",
      body: JSON.stringify({ userId, conversationId, messages, model, title: conv.title, task, routed }),
    })
  );
});

/** Re-attach to a run already in progress, replaying from `from`. */
app.get("/api/chat/attach", async (c) => {
  const conversationId = c.req.query("conversationId");
  if (!conversationId) return c.json({ error: "Missing conversationId" }, 400);
  const from = c.req.query("from") ?? "0";
  return sessionStub(c, conversationId).fetch(
    new Request(`https://session/attach?from=${encodeURIComponent(from)}`)
  );
});

app.get("/api/chat/status", async (c) => {
  const conversationId = c.req.query("conversationId");
  if (!conversationId) return c.json({ error: "Missing conversationId" }, 400);
  return sessionStub(c, conversationId).fetch(new Request("https://session/status"));
});

app.post("/api/chat/cancel", async (c) => {
  const { conversationId } = await c.req.json<{ conversationId?: string }>().catch(() => ({ conversationId: undefined }));
  if (!conversationId) return c.json({ error: "Missing conversationId" }, 400);
  return sessionStub(c, conversationId).fetch(new Request("https://session/cancel", { method: "POST" }));
});

app.get("/api/usage", async (c) => {
  const days = Math.min(90, Math.max(1, Number(c.req.query("days") ?? "30")));
  return c.json(await summarizeUsage(c.env.OMNIGROK_KV, c.get("userId"), days));
});

app.get("/api/resources", async (c) => {
  return c.json(await getInventory(c.env as CfEnv));
});

// --- Agents / Projects / MCP servers --------------------------------------
// One generic CRUD surface; the three collections differ only in payload.

app.get("/api/r/:collection", async (c) => {
  const col = c.req.param("collection");
  if (!isCollection(col)) return c.json({ error: "Unknown collection" }, 404);
  const rows = await listRecords<BaseRecord>(c.env.OMNIGROK_KV, c.get("userId"), col);
  return c.json({ items: rows.map((r) => redact(col, r)) });
});

app.post("/api/r/:collection", async (c) => {
  const col = c.req.param("collection");
  if (!isCollection(col)) return c.json({ error: "Unknown collection" }, 404);

  const body = await c.req.json<Partial<BaseRecord>>().catch(() => null);
  if (!body || typeof body.name !== "string" || !body.name.trim()) {
    return c.json({ error: "A name is required" }, 400);
  }

  const id = body.id ?? crypto.randomUUID();
  const existing = await getRecord<BaseRecord>(c.env.OMNIGROK_KV, c.get("userId"), col, id);

  // Never let a blank token from the UI wipe a stored secret.
  const merged = { ...(existing ?? {}), ...body, id, name: body.name.trim() } as BaseRecord;
  if (col === "mcps") {
    if (!body.authToken && existing?.authToken) merged.authToken = existing.authToken;
    if (!body.accessClientSecret && existing?.accessClientSecret) {
      merged.accessClientSecret = existing.accessClientSecret;
    }
  }

  const saved = await putRecord(c.env.OMNIGROK_KV, c.get("userId"), col, merged);
  return c.json({ ok: true, item: redact(col, saved) });
});

app.delete("/api/r/:collection/:id", async (c) => {
  const col = c.req.param("collection");
  if (!isCollection(col)) return c.json({ error: "Unknown collection" }, 404);
  await deleteRecord(c.env.OMNIGROK_KV, c.get("userId"), col, c.req.param("id"));
  return c.json({ ok: true });
});

/** Test an MCP server and report the tools it exposes. */
app.post("/api/mcp/probe", async (c) => {
  const body = await c.req.json<{
    id?: string;
    url?: string;
    authToken?: string;
    accessClientId?: string;
    accessClientSecret?: string;
  }>().catch(() => null);
  if (!body?.url) return c.json({ error: "Missing url" }, 400);

  // Editing a saved server sends a blank secret to mean "unchanged", so fall
  // back to what is already stored rather than probing with no credentials.
  let auth = {
    authToken: body.authToken,
    accessClientId: body.accessClientId,
    accessClientSecret: body.accessClientSecret,
  };
  if (body.id && !auth.authToken && !auth.accessClientSecret) {
    const stored = await getRecord<BaseRecord>(c.env.OMNIGROK_KV, c.get("userId"), "mcps", body.id);
    if (stored) {
      auth = {
        authToken: stored.authToken as string | undefined,
        accessClientId: stored.accessClientId as string | undefined,
        accessClientSecret: stored.accessClientSecret as string | undefined,
      };
    }
  }

  return c.json(await probeMcpServer(body.url, auth));
});

/** Everything the model can currently call, for the settings UI. */
app.get("/api/tools", async (c) => {
  const toolset = await buildToolset(c.env.OMNIGROK_KV, c.get("userId"));
  return c.json({
    tools: toolset.schemas.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      source: toolset.mcpRoutes.has(t.function.name) ? "mcp" : "builtin",
    })),
  });
});

// --- Built-in browser -----------------------------------------------------

app.post("/api/browse", async (c) => {
  const { url } = await c.req.json<{ url?: string }>().catch(() => ({ url: undefined }));
  if (!url) return c.json({ error: "Missing url" }, 400);
  try {
    return c.json(await browse(url));
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Fetch failed" }, 400);
  }
});

// --- Files ----------------------------------------------------------------

app.get("/api/storage", (c) => c.json({ backends: availableBackends(c.env as FileEnv) }));

app.get("/api/files", async (c) => {
  const rows = await listRecords<BaseRecord>(c.env.OMNIGROK_KV, c.get("userId"), "files");
  return c.json({ items: rows, backends: availableBackends(c.env as FileEnv) });
});

app.post("/api/files", async (c) => {
  const userId = c.get("userId");
  if (!availableBackends(c.env as FileEnv).length) {
    return c.json({ error: "No storage backend is configured" }, 503);
  }

  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return c.json({ error: "No file provided" }, 400);

  const id = crypto.randomUUID();
  const objectKey = `u/${userId}/${id}/${file.name}`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  let backend: string;
  try {
    backend = await putFile(c.env as FileEnv, objectKey, bytes, file.type || "application/octet-stream");
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Upload failed" }, 502);
  }

  const record = await putRecord(c.env.OMNIGROK_KV, userId, "files", {
    id,
    name: file.name,
    objectKey,
    size: bytes.byteLength,
    contentType: file.type || "application/octet-stream",
    backend,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  return c.json({ ok: true, item: record });
});

app.get("/api/files/:id/content", async (c) => {
  const rec = await getRecord<BaseRecord>(c.env.OMNIGROK_KV, c.get("userId"), "files", c.req.param("id"));
  if (!rec) return c.json({ error: "Not found" }, 404);

  const found = await getFile(c.env as FileEnv, String(rec.objectKey));
  if (!found) return c.json({ error: "Object missing from storage" }, 404);

  return new Response(found.body as BodyInit, {
    headers: {
      "Content-Type": found.contentType,
      "Content-Disposition": `inline; filename="${String(rec.name).replace(/"/g, "")}"`,
    },
  });
});

app.delete("/api/files/:id", async (c) => {
  const userId = c.get("userId");
  const rec = await getRecord<BaseRecord>(c.env.OMNIGROK_KV, userId, "files", c.req.param("id"));
  if (rec) await deleteFile(c.env as FileEnv, String(rec.objectKey));
  await deleteRecord(c.env.OMNIGROK_KV, userId, "files", c.req.param("id"));
  return c.json({ ok: true });
});

// Static assets last, so /api/* never falls through to the SPA.
app.get("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
