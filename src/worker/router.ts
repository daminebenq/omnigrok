// Model routing: pick the right model for the request instead of always using
// whatever the thread happens to be set to.
//
// Classification is deliberately heuristic and local. Spending an LLM call to
// decide which LLM to call would add latency and cost to every single message,
// and the signals that actually matter here (attachments, code, length) are
// visible in the request itself.

import type { Capability, ModelInfo } from "./inference";

export type TaskKind =
  | "vision"
  | "coding"
  | "reasoning"
  | "long-context"
  | "fast"
  | "general";

export interface RouteDecision {
  model: string;
  task: TaskKind;
  reason: string;
  /** False when nothing matched and we fell back. */
  matched: boolean;
}

const CODE_SIGNALS = [
  /```/,
  /\b(function|const|let|var|class|def|import|export|return|async|await)\b/,
  /\b(typescript|javascript|python|rust|golang|java|c\+\+|sql|bash|regex)\b/i,
  /\b(refactor|debug|stack ?trace|compile|lint|unit test|null pointer)\b/i,
  /[{};]\s*$/m,
];

const REASONING_SIGNALS = [
  /\b(prove|derive|theorem|algorithm|complexity|optimi[sz]e)\b/i,
  /\b(step[- ]by[- ]step|reason through|think through|work out|analy[sz]e)\b/i,
  /\b(why does|explain how|trade[- ]?offs?|compare and contrast)\b/i,
  /\b(integral|derivative|probability|matrix|equation)\b/i,
  /\d+\s*[+\-*/^]\s*\d+/,
];

const FAST_SIGNALS = [
  /^(hi|hey|hello|thanks|thank you|ok|okay|yes|no|sure|cool|nice)\b/i,
  /^.{0,60}$/s, // very short asks rarely need a frontier model
];

const LONG_CONTEXT_CHARS = 24_000;

export function classify(
  messages: Array<{ role: string; content: string }>,
  hasAttachments = false
): { task: TaskKind; reason: string } {
  if (hasAttachments) {
    return { task: "vision", reason: "the request includes an image or attachment" };
  }

  const totalChars = messages.reduce((n, m) => n + (m.content?.length ?? 0), 0);
  if (totalChars > LONG_CONTEXT_CHARS) {
    return {
      task: "long-context",
      reason: `the conversation is ${Math.round(totalChars / 1000)}K characters`,
    };
  }

  const last = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";

  if (CODE_SIGNALS.some((re) => re.test(last))) {
    return { task: "coding", reason: "the message looks like a coding task" };
  }
  if (REASONING_SIGNALS.some((re) => re.test(last))) {
    return { task: "reasoning", reason: "the message asks for analysis or derivation" };
  }
  if (FAST_SIGNALS.every((re) => re.test(last.trim()))) {
    return { task: "fast", reason: "the message is short and conversational" };
  }
  return { task: "general", reason: "no specialised signal detected" };
}

/** Capability a task wants, in order of preference. */
const WANTS: Record<TaskKind, Capability[]> = {
  vision: ["vision"],
  coding: ["coding", "reasoning"],
  reasoning: ["reasoning"],
  "long-context": [],
  fast: [],
  general: [],
};

export function selectModel(
  models: ModelInfo[],
  task: TaskKind,
  preferred?: string
): RouteDecision {
  const byRep = [...models].sort((a, b) => b.reputation - a.reputation);
  if (!byRep.length) {
    return { model: preferred ?? "", task, reason: "no models available", matched: false };
  }

  // "fast" deliberately inverts the usual preference: a trivial message does
  // not justify the slowest, most expensive model on the list.
  if (task === "fast") {
    const cheap = [...models]
      .filter((m) => m.reputation >= 55 && m.reputation <= 85)
      .sort((a, b) => a.reputation - b.reputation)[0];
    if (cheap) {
      return { model: cheap.id, task, reason: "short message, using a quick model", matched: true };
    }
  }

  if (task === "long-context") {
    const roomy = [...models]
      .filter((m) => (m.contextLength ?? 0) >= 100_000)
      .sort((a, b) => b.reputation - a.reputation)[0];
    if (roomy) {
      return {
        model: roomy.id,
        task,
        reason: `needs a large context window (${Math.round((roomy.contextLength ?? 0) / 1000)}K)`,
        matched: true,
      };
    }
  }

  for (const cap of WANTS[task]) {
    const hit = byRep.find((m) => m.capabilities.includes(cap));
    if (hit) {
      return { model: hit.id, task, reason: `best available model with ${cap}`, matched: true };
    }
  }

  return { model: byRep[0].id, task, reason: "best available model overall", matched: task === "general" };
}

export function route(
  models: ModelInfo[],
  messages: Array<{ role: string; content: string }>,
  opts: { hasAttachments?: boolean } = {}
): RouteDecision {
  const { task, reason } = classify(messages, opts.hasAttachments);
  const decision = selectModel(models, task);
  return { ...decision, reason: `${reason}; ${decision.reason}` };
}
