// File storage across multiple backends.
//
// Order of preference: R2 binding (zero egress, native) -> first configured
// S3-compatible endpoint (self-hosted MinIO on the user's VPS, B2, OCI,
// iDrive). Env var names match the existing storage-adapter convention so a
// bucket already provisioned elsewhere can be reused as-is.
//
// Google Drive is intentionally NOT here: it needs a full OAuth app +
// refresh-token flow, which is a separate piece of work.

export interface FileEnv {
  FILES_R2?: R2Bucket;
  // R2 reached over its S3 API. Used when the bucket lives on a different
  // account than the Worker, where a native binding is not possible.
  R2_ENDPOINT?: string;
  R2_REGION?: string;
  R2_BUCKET?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
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

export interface StoredFile {
  key: string;
  name: string;
  size: number;
  contentType: string;
  uploadedAt: number;
  backend: string;
}

interface S3Config {
  label: string;
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

function s3Configs(env: FileEnv): S3Config[] {
  const candidates: Array<S3Config | null> = [
    // R2 first: zero egress, and it is the cheapest read path here.
    env.R2_ENDPOINT && env.R2_BUCKET && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY
      ? {
          label: "r2",
          endpoint: env.R2_ENDPOINT,
          region: env.R2_REGION ?? "auto",
          bucket: env.R2_BUCKET,
          accessKeyId: env.R2_ACCESS_KEY_ID,
          secretAccessKey: env.R2_SECRET_ACCESS_KEY,
        }
      : null,
    env.MINIO_ENDPOINT && env.MINIO_BUCKET && env.MINIO_ACCESS_KEY_ID && env.MINIO_SECRET_ACCESS_KEY
      ? {
          label: "minio",
          endpoint: env.MINIO_ENDPOINT,
          region: env.MINIO_REGION ?? "us-east-1",
          bucket: env.MINIO_BUCKET,
          accessKeyId: env.MINIO_ACCESS_KEY_ID,
          secretAccessKey: env.MINIO_SECRET_ACCESS_KEY,
        }
      : null,
    env.B2_ENDPOINT && env.B2_BUCKET && env.B2_KEY_ID && env.B2_APP_KEY
      ? {
          label: "b2",
          endpoint: env.B2_ENDPOINT,
          region: env.B2_REGION ?? "us-east-005",
          bucket: env.B2_BUCKET,
          accessKeyId: env.B2_KEY_ID,
          secretAccessKey: env.B2_APP_KEY,
        }
      : null,
    env.OCI_ENDPOINT && env.OCI_BUCKET && env.OCI_ACCESS_KEY_ID && env.OCI_SECRET_ACCESS_KEY
      ? {
          label: "oci",
          endpoint: env.OCI_ENDPOINT,
          region: env.OCI_REGION ?? "us-ashburn-1",
          bucket: env.OCI_BUCKET,
          accessKeyId: env.OCI_ACCESS_KEY_ID,
          secretAccessKey: env.OCI_SECRET_ACCESS_KEY,
        }
      : null,
  ];
  return candidates.filter((c): c is S3Config => c !== null);
}

export function availableBackends(env: FileEnv): string[] {
  const out: string[] = [];
  if (env.FILES_R2) out.push("r2");
  out.push(...s3Configs(env).map((c) => c.label));
  return out;
}

// --- SigV4 ----------------------------------------------------------------

const enc = new TextEncoder();

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return crypto.subtle.sign("HMAC", k, enc.encode(data));
}

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? enc.encode(data) : data;
  return hex(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
}

async function signedFetch(
  cfg: S3Config,
  method: string,
  objectKey: string,
  body?: Uint8Array,
  contentType?: string,
  query = ""
): Promise<Response> {
  const url = new URL(`${cfg.endpoint.replace(/\/$/, "")}/${cfg.bucket}/${objectKey}${query}`);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);

  const payloadHash = await sha256Hex(body ?? "");
  const headers: Record<string, string> = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (contentType) headers["content-type"] = contentType;

  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((h) => `${h}:${headers[h]}\n`)
    .join("");

  const canonicalRequest = [
    method,
    url.pathname,
    url.search.replace(/^\?/, ""),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  let signingKey: ArrayBuffer | Uint8Array = enc.encode(`AWS4${cfg.secretAccessKey}`);
  for (const part of [dateStamp, cfg.region, "s3", "aws4_request"]) {
    signingKey = await hmac(signingKey, part);
  }
  const signature = hex(await hmac(signingKey, stringToSign));

  headers.authorization =
    `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return fetch(url.toString(), {
    method,
    headers,
    body: body as BodyInit | undefined,
    signal: AbortSignal.timeout(30_000),
  });
}

// --- Public API -----------------------------------------------------------

export async function putFile(
  env: FileEnv,
  key: string,
  body: Uint8Array,
  contentType: string
): Promise<string> {
  if (env.FILES_R2) {
    await env.FILES_R2.put(key, body, { httpMetadata: { contentType } });
    return "r2";
  }
  const [cfg] = s3Configs(env);
  if (!cfg) throw new Error("No storage backend configured");

  const res = await signedFetch(cfg, "PUT", key, body, contentType);
  if (!res.ok) {
    throw new Error(`${cfg.label} upload failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
  return cfg.label;
}

export async function getFile(
  env: FileEnv,
  key: string
): Promise<{ body: ReadableStream | ArrayBuffer; contentType: string } | null> {
  if (env.FILES_R2) {
    const obj = await env.FILES_R2.get(key);
    if (obj) {
      return {
        body: obj.body as ReadableStream,
        contentType: obj.httpMetadata?.contentType ?? "application/octet-stream",
      };
    }
  }
  for (const cfg of s3Configs(env)) {
    const res = await signedFetch(cfg, "GET", key);
    if (res.ok && res.body) {
      return {
        body: res.body,
        contentType: res.headers.get("content-type") ?? "application/octet-stream",
      };
    }
  }
  return null;
}

export async function deleteFile(env: FileEnv, key: string): Promise<void> {
  if (env.FILES_R2) await env.FILES_R2.delete(key);
  for (const cfg of s3Configs(env)) {
    await signedFetch(cfg, "DELETE", key).catch(() => {});
  }
}
