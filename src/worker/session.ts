// One Durable Object per conversation.
//
// Generation runs inside the DO, not on the request that started it. That is
// what makes a reload survivable: the browser dropping its SSE connection no
// longer aborts the model call. Clients attach, detach and re-attach at will,
// and every event is buffered with a sequence number so a reconnecting client
// replays what it missed instead of losing it.

import { streamInference, type ChatMessage, type StreamEvent } from "./inference";
import type { InferenceEnv } from "./inference";
import { getConversation, saveConversation, type Conversation, type Message } from "./storage";
import { recordUsage } from "./usage";
import { buildToolset } from "./tools";

export interface SessionEnv extends InferenceEnv {
  OMNIGROK_KV: KVNamespace;
}

interface SeqEvent {
  seq: number;
  event: StreamEvent | { type: "done" } | { type: "error"; message: string };
}

interface StartPayload {
  userId: string;
  conversationId: string;
  messages: Message[];
  model: string;
  title?: string;
  /** Present when the router chose the model rather than the user. */
  task?: string;
  routed?: boolean;
  fallbacks?: string[];
}

const CHECKPOINT_EVERY = 25;

export class ChatSession implements DurableObject {
  private events: SeqEvent[] = [];
  private seq = 0;
  private done = false;
  private failed: string | null = null;
  private generating = false;
  private text = "";
  private reasoning = "";
  private waiters: Array<() => void> = [];
  private meta: StartPayload | null = null;
  private loaded = false;
  private startedAt = 0;
  private toolCalls = 0;
  private usage: { input: number; output: number; total: number } | null = null;
  /** Set when a rate limit pushed the turn onto a different model. */
  private actualModel: string | null = null;

  constructor(
    private state: DurableObjectState,
    private env: SessionEnv
  ) {}

  /** Restore buffered events if this DO was evicted and woken by an attach. */
  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    const saved = await this.state.storage.get<{
      events: SeqEvent[];
      seq: number;
      done: boolean;
      failed: string | null;
      text: string;
      reasoning: string;
    }>("buffer");
    if (saved) {
      this.events = saved.events ?? [];
      this.seq = saved.seq ?? 0;
      this.done = saved.done ?? false;
      this.failed = saved.failed ?? null;
      this.text = saved.text ?? "";
      this.reasoning = saved.reasoning ?? "";
    }
  }

  private async checkpoint(): Promise<void> {
    await this.state.storage.put("buffer", {
      events: this.events,
      seq: this.seq,
      done: this.done,
      failed: this.failed,
      text: this.text,
      reasoning: this.reasoning,
    });
  }

  private emit(event: SeqEvent["event"]): void {
    this.events.push({ seq: this.seq++, event });
    for (const w of this.waiters.splice(0)) w();
  }

  private wake(): Promise<void> {
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  async fetch(request: Request): Promise<Response> {
    await this.load();
    const url = new URL(request.url);
    const action = url.pathname.split("/").pop();

    if (action === "start") {
      const payload = (await request.json()) as StartPayload;
      // Idempotent: a duplicate start just attaches to the run in flight.
      if (!this.generating && !this.done) {
        this.meta = payload;
        this.generating = true;
        this.startedAt = Date.now();
        this.state.waitUntil(this.generate(payload));
      }
      return this.streamFrom(0);
    }

    if (action === "attach") {
      const from = Number(url.searchParams.get("from") ?? "0");
      return this.streamFrom(Number.isFinite(from) ? from : 0);
    }

    if (action === "status") {
      return Response.json({
        generating: this.generating,
        done: this.done,
        error: this.failed,
        lastSeq: this.seq,
        text: this.text,
        reasoning: this.reasoning,
      });
    }

    if (action === "cancel") {
      if (this.generating) {
        this.generating = false;
        this.done = true;
        this.emit({ type: "done" });
        await this.finalize();
      }
      return Response.json({ ok: true });
    }

    return new Response("Not found", { status: 404 });
  }

  /** SSE of everything from `from` onward, then live events until done. */
  private streamFrom(from: number): Response {
    const encoder = new TextEncoder();
    const self = this;

    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        for (;;) {
          const pending = self.events.filter((e) => e.seq >= from);
          if (pending.length) {
            for (const e of pending) {
              from = e.seq + 1;
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ seq: e.seq, ...e.event })}\n\n`)
              );
            }
            return;
          }
          if (self.done || !self.generating) {
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
            return;
          }
          await self.wake();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  }

  private async generate(payload: StartPayload): Promise<void> {
    try {
      const chat: ChatMessage[] = payload.messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      // Built per run, so newly connected MCP servers are picked up without
      // a redeploy. An unreachable server is skipped, not fatal.
      const toolset = await buildToolset(this.env.OMNIGROK_KV, payload.userId).catch(() => undefined);
      const { stream } = await streamInference(chat, payload.model, this.env, {
        toolset,
        fallbacks: payload.fallbacks,
        kv: this.env.OMNIGROK_KV,
      });
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let sinceCheckpoint = 0;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const t = line.trim();
          if (!t.startsWith("data:")) continue;
          const raw = t.slice(5).trim();
          if (!raw || raw === "[DONE]") continue;
          let evt: StreamEvent;
          try {
            evt = JSON.parse(raw) as StreamEvent;
          } catch {
            continue;
          }
          if (evt.type === "token") this.text += evt.content;
          if (evt.type === "reasoning") this.reasoning += evt.content;
          if (evt.type === "tool" && evt.status === "running") this.toolCalls += 1;
          if (evt.type === "model") this.actualModel = evt.model;
          if (evt.type === "usage") {
            this.usage = { input: evt.input, output: evt.output, total: evt.total };
          }
          this.emit(evt);
          if (++sinceCheckpoint >= CHECKPOINT_EVERY) {
            sinceCheckpoint = 0;
            await this.checkpoint();
          }
        }
      }
    } catch (e) {
      this.failed = e instanceof Error ? e.message : "Generation failed";
      this.emit({ type: "error", message: this.failed });
    } finally {
      this.generating = false;
      this.done = true;
      this.emit({ type: "done" });
      await this.finalize();
    }
  }

  /** Write the finished turn back to KV and clear the generating flag. */
  private async finalize(): Promise<void> {
    await this.checkpoint();
    const payload = this.meta;
    if (!payload) return;

    try {
      const existing = await getConversation(
        this.env.OMNIGROK_KV,
        payload.userId,
        payload.conversationId
      );
      const conv: Conversation = existing ?? {
        id: payload.conversationId,
        title: payload.title ?? "New Chat",
        model: payload.model,
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      conv.model = payload.model;
      conv.messages = [
        ...payload.messages,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: this.text,
          reasoning: this.reasoning || undefined,
          createdAt: Date.now(),
        },
      ];
      conv.updatedAt = Date.now();
      conv.status = undefined; // no longer generating
      if (this.failed) conv.lastError = this.failed;
      await saveConversation(this.env.OMNIGROK_KV, payload.userId, conv);

      const usedModel = this.actualModel ?? payload.model;
      await recordUsage(this.env.OMNIGROK_KV, payload.userId, {
        at: Date.now(),
        model: usedModel,
        provider: usedModel.includes("/") ? usedModel.split("/")[0] : "omniroute",
        task: payload.task,
        routed: Boolean(payload.routed),
        inputTokens: this.usage?.input ?? 0,
        outputTokens: this.usage?.output ?? 0,
        totalTokens: this.usage?.total ?? 0,
        durationMs: this.startedAt ? Date.now() - this.startedAt : 0,
        toolCalls: this.toolCalls,
        ok: !this.failed,
      });
    } catch (e) {
      console.error("ChatSession.finalize failed:", e);
    }
  }
}
