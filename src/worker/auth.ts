// Cloudflare Access JWT validation.
//
// The Access edge already gates the hostname, but the Worker must not trust
// that alone: anything that reaches the origin directly would otherwise be
// accepted. So we verify the RS256 signature against the team's JWKS, plus
// audience and expiry.

export interface CfAccessPayload {
  sub: string;
  email: string;
  aud: string[] | string;
  iat: number;
  exp: number;
}

interface Jwk {
  kid: string;
  kty: string;
  alg: string;
  use?: string;
  e: string;
  n: string;
}

interface CachedKeys {
  keys: Jwk[];
  fetchedAt: number;
}

const JWKS_TTL_MS = 60 * 60 * 1000; // Access rotates keys ~every 6 weeks.
let jwksCache: CachedKeys | null = null;

async function getJwks(teamDomain: string): Promise<Jwk[]> {
  const now = Date.now();
  if (jwksCache && now - jwksCache.fetchedAt < JWKS_TTL_MS) return jwksCache.keys;

  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Failed to fetch Access certs: ${res.status}`);

  const body = (await res.json()) as { keys?: Jwk[] };
  const keys = body.keys ?? [];
  if (!keys.length) throw new Error("Access certs response contained no keys");

  jwksCache = { keys, fetchedAt: now };
  return keys;
}

function b64urlToBytes(s: string): ArrayBuffer {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  const bin = atob(b64);
  const buf = new ArrayBuffer(bin.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return buf;
}

function decodeSegment<T>(seg: string): T {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(seg))) as T;
}

/**
 * Verifies signature, expiry and audience. Returns null on any failure —
 * callers must treat null as "reject the request".
 */
export async function validateCfAccessToken(
  token: string | null,
  allowedAud: string,
  teamDomain: string
): Promise<CfAccessPayload | null> {
  if (!token || !teamDomain) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;

  try {
    const header = decodeSegment<{ kid?: string; alg?: string }>(headerB64);
    if (header.alg !== "RS256" || !header.kid) return null;

    const jwks = await getJwks(teamDomain);
    const jwk = jwks.find((k) => k.kid === header.kid);
    if (!jwk) return null;

    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: jwk.kty, e: jwk.e, n: jwk.n, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const signed = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      b64urlToBytes(sigB64),
      signed
    );
    if (!ok) return null;

    const payload = decodeSegment<CfAccessPayload & { iss?: string }>(payloadB64);

    // 60s skew allowance absorbs small clock differences between the edge and
    // this isolate without widening the window meaningfully.
    const now = Math.floor(Date.now() / 1000);
    const SKEW = 60;
    if (typeof payload.exp !== "number" || payload.exp < now - SKEW) return null;

    // Reject a token minted for a different Access team even if it shares a key
    // surface. The issuer is always the team domain.
    if (payload.iss && payload.iss !== `https://${teamDomain}`) return null;

    // A missing/empty allowedAud must reject, never fall through to
    // accept-any-audience: an audience check that silently does nothing is a
    // fail-open misconfiguration.
    if (!allowedAud) return null;
    const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!auds.includes(allowedAud)) return null;

    if (!payload.sub) return null;
    return payload;
  } catch {
    return null;
  }
}
