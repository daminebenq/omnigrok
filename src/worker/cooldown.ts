// Rate-limit / cooldown tracking.
//
// Gateways answer an exhausted model with 429 and a reset window. Retrying the
// same model inside that window just burns the request, so a model that says
// it is cooling down is parked until it is due back and traffic moves to the
// next candidate instead.

export interface CooldownEntry {
  model: string;
  until: number;
  reason: string;
}

/** Per-isolate cache so the hot path avoids a KV read on every request. */
const memory = new Map<string, CooldownEntry>();

const KEY = "cooldowns:v1";

function alive(e: CooldownEntry, now: number): boolean {
  return e.until > now;
}

export async function loadCooldowns(kv: KVNamespace): Promise<Map<string, CooldownEntry>> {
  const now = Date.now();
  for (const [k, v] of memory) if (!alive(v, now)) memory.delete(k);

  try {
    const stored = await kv.get<CooldownEntry[]>(KEY, "json");
    for (const e of stored ?? []) {
      if (alive(e, now)) {
        const existing = memory.get(e.model);
        if (!existing || existing.until < e.until) memory.set(e.model, e);
      }
    }
  } catch {
    // A cooldown list we cannot read is not worth failing a request over.
  }
  return memory;
}

export async function markCooling(
  kv: KVNamespace,
  model: string,
  seconds: number,
  reason: string
): Promise<void> {
  // Clamp: a malformed or hostile reset value should not park a model forever.
  const secs = Math.min(Math.max(Number.isFinite(seconds) ? seconds : 60, 5), 3600);
  const entry: CooldownEntry = { model, until: Date.now() + secs * 1000, reason };
  memory.set(model, entry);

  try {
    const now = Date.now();
    const merged = [...memory.values()].filter((e) => alive(e, now));
    await kv.put(KEY, JSON.stringify(merged), { expirationTtl: 3600 });
  } catch {
    // In-memory is still correct for this isolate.
  }
}

export function isCooling(model: string): boolean {
  const e = memory.get(model);
  if (!e) return false;
  if (!alive(e, Date.now())) {
    memory.delete(model);
    return false;
  }
  return true;
}

export function coolingModels(): string[] {
  const now = Date.now();
  return [...memory.values()].filter((e) => alive(e, now)).map((e) => e.model);
}

export interface RateLimitInfo {
  isRateLimit: boolean;
  model?: string;
  resetSeconds: number;
  message: string;
}

/**
 * Recognises the shapes gateways use for "slow down": an explicit
 * model_cooldown payload, a generic 429, or a Retry-After header.
 */
export function parseRateLimit(status: number, body: string, retryAfter?: string | null): RateLimitInfo {
  let resetSeconds = 60;
  let model: string | undefined;
  let message = body.slice(0, 200);

  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: string; code?: string; model?: string; reset_seconds?: number };
    };
    const err = parsed.error;
    if (err) {
      if (typeof err.reset_seconds === "number") resetSeconds = err.reset_seconds;
      if (err.model) model = err.model;
      if (err.message) message = err.message;
    }
  } catch {
    // Non-JSON body; fall back to the header and defaults below.
  }

  if (retryAfter) {
    const asNumber = Number(retryAfter);
    if (Number.isFinite(asNumber)) {
      resetSeconds = asNumber;
    } else {
      const at = Date.parse(retryAfter);
      if (!Number.isNaN(at)) resetSeconds = Math.max(1, Math.round((at - Date.now()) / 1000));
    }
  }

  // A 429 is always a rate limit. The body-text heuristic only applies to
  // statuses that plausibly signal throttling (429/503) so a 400 that merely
  // mentions "quota" in an unrelated error does not park a healthy model.
  const throttleStatus = status === 429 || status === 503;
  const isRateLimit =
    status === 429 ||
    (throttleStatus && /cooling down|rate.?limit|quota|too many requests/i.test(body));
  return { isRateLimit, model, resetSeconds, message };
}
