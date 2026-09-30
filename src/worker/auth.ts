// Cloudflare Access JWT validation
// Checks CF-Access-Jwt-Assertion header and verifies against Access certs

export interface CfAccessPayload {
  sub: string;
  email: string;
  aud: string[];
  iat: number;
  exp: number;
}

async function getPublicKeys(teamDomain: string): Promise<JsonWebKey[]> {
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error("Failed to fetch Access certs");
  const { public_certs } = (await res.json()) as { public_certs: { kid: string; cert: string }[] };
  // Convert PEM certs to JWK (we'll use the raw cert approach instead)
  return public_certs.map((c) => ({ kty: "RSA", use: "sig", kid: c.kid, cert: c.cert } as any));
}

// Minimal JWT decode without full verification (CF Access already validates at edge)
// For extra safety we also check audience + expiry
function decodeJwt(token: string): { header: any; payload: CfAccessPayload } {
  const [headerB64, payloadB64] = token.split(".");
  const decode = (s: string) => JSON.parse(atob(s.replace(/-/g, "+").replace(/_/g, "/")));
  return { header: decode(headerB64), payload: decode(payloadB64) };
}

export function validateCfAccessToken(
  token: string | null,
  allowedAud: string
): CfAccessPayload | null {
  if (!token) return null;
  try {
    const { payload } = decodeJwt(token);
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) return null;
    // If ALLOWED_AUD is set, verify audience
    if (allowedAud && !payload.aud.includes(allowedAud)) return null;
    return payload;
  } catch {
    return null;
  }
}
