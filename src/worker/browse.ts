// Server-side fetch for the built-in browser panel.
//
// This app is deliberately allowed to reach the user's own infrastructure, so
// the guard is not a blanket "block private ranges". It blocks the things that
// are never a legitimate browsing target and are the classic SSRF prizes:
// loopback, link-local, and cloud instance-metadata endpoints.

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.goog",
]);

// 127.0.0.0/8, 0.0.0.0/8, ::1, and the 169.254.0.0/16 link-local range
// (which covers 169.254.169.254, the AWS/GCP/Azure metadata address).
const BLOCKED_IP_PATTERNS = [
  /^127\./,
  /^0\./,
  /^169\.254\./,
  /^\[?::1\]?$/,
  /^\[?fe80:/i,
];

export interface BrowseSession {
  /** Serialised as a Cookie header value. */
  cookies?: string;
  userAgent?: string;
  headers?: Record<string, string>;
}

/** Headers a caller must not be able to set, because they are ours to control. */
const RESERVED_HEADERS = new Set([
  "host", "cookie", "content-length", "connection",
  "cf-access-client-id", "cf-access-client-secret", "authorization",
]);

export interface BrowseResult {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  title: string | null;
  html: string | null;
  text: string | null;
  truncated: boolean;
  /** Cookies the site set, ready to be stored back on the profile. */
  setCookies: string[];
}

const MAX_BYTES = 2_000_000;

export function assertBrowsableUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https URLs are supported");
  }

  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith(".localhost")) {
    throw new Error("This host is not reachable from the browser panel");
  }
  if (BLOCKED_IP_PATTERNS.some((re) => re.test(host))) {
    throw new Error("This host is not reachable from the browser panel");
  }
  return url;
}

function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i);
  if (!m) return null;
  return m[1].replace(/\s+/g, " ").trim() || null;
}

/** Very rough tag strip, used for the text view and for agent consumption. */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export async function browse(
  rawUrl: string,
  session: BrowseSession = {}
): Promise<BrowseResult> {
  const url = assertBrowsableUrl(rawUrl);

  const headers: Record<string, string> = {
    "User-Agent": session.userAgent || "OmniGrok/1.0 (+https://omnigrok.damineweb.work)",
    Accept: "text/html,application/xhtml+xml,application/json;q=0.9,text/plain;q=0.8,*/*;q=0.5",
    "Accept-Language": "en-US,en;q=0.9",
  };

  // Extra headers are caller-supplied, so anything that would let them forge
  // our own auth or confuse the request framing is dropped.
  for (const [k, v] of Object.entries(session.headers ?? {})) {
    if (!RESERVED_HEADERS.has(k.toLowerCase())) headers[k] = v;
  }

  // Carrying a real session is what keeps sites from treating every visit as a
  // brand-new anonymous one. It is not a bot-detection bypass.
  if (session.cookies) headers.Cookie = session.cookies;

  const res = await fetch(url.toString(), {
    redirect: "follow",
    headers,
    signal: AbortSignal.timeout(15_000),
  });

  const setCookies = typeof (res.headers as any).getSetCookie === "function"
    ? ((res.headers as any).getSetCookie() as string[])
    : (res.headers.get("set-cookie") ? [res.headers.get("set-cookie") as string] : []);

  const contentType = res.headers.get("content-type") ?? "";
  const buf = new Uint8Array(await res.arrayBuffer());
  const truncated = buf.byteLength > MAX_BYTES;
  const body = new TextDecoder("utf-8", { fatal: false }).decode(
    truncated ? buf.slice(0, MAX_BYTES) : buf
  );

  const isHtml = contentType.includes("html");

  return {
    url: rawUrl,
    finalUrl: res.url || url.toString(),
    status: res.status,
    contentType,
    title: isHtml ? extractTitle(body) : null,
    html: isHtml ? body : null,
    text: isHtml ? htmlToText(body) : body,
    truncated,
    setCookies,
  };
}
