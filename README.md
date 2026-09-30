# OmniGrok Web

Multi-provider AI chat, deployed as a Cloudflare Worker at
**https://omnigrok.damineweb.work** and gated by Cloudflare Access.

## Architecture

| Piece | Where |
|---|---|
| SPA (React + Vite + Tailwind) | `src/web` |
| Worker API (Hono) | `src/worker` |
| Conversations, settings, agents, projects, MCP servers | Workers KV |
| Uploaded files | R2, or any S3-compatible bucket |

### Request flow

Cloudflare Access gates the hostname and injects `CF-Access-Jwt-Assertion`.
The worker independently verifies that JWT (RS256 against the team JWKS, plus
audience and expiry) before serving any `/api/*` route — the edge check alone
is not treated as sufficient, so a request reaching the origin directly is
still rejected.

### Streaming protocol

Providers speak OpenAI-compatible SSE. The worker normalizes that into one
internal event shape so the client has a single format to parse and reasoning
and usage can ride alongside tokens:

```
data: {"type":"token","content":"..."}
data: {"type":"reasoning","content":"..."}
data: {"type":"tool","id":"...","name":"jarvis_exec","status":"running"}
data: {"type":"usage","input":11,"output":4,"total":15}
data: [DONE]
```

An assistant reply is captured server-side and written to KV after the stream
finishes, so a reload — or a tab closed mid-answer — keeps the thread.

## Configuration

### Vars (`wrangler.jsonc`)

| Name | Purpose |
|---|---|
| `ALLOWED_AUD` | Access application audience tag |
| `ACCESS_TEAM_DOMAIN` | e.g. `damine.cloudflareaccess.com` |

### Secrets (`wrangler secret put <NAME>`)

Model providers — set at least one. Without `OMNIROUTE_KEY` the catalog is
limited to whichever direct providers are configured.

| Name | Provider |
|---|---|
| `OMNIROUTE_KEY` | OmniRoute (full catalog, and the fallback for unprefixed models) |
| `OMNIROUTE_BASE_URL` | Optional. Defaults to `https://omniroute.damineweb.work/v1`, the same gateway the macOS app uses. |
| `GROQ_KEY` | Groq |
| `OPENAI_KEY` | OpenAI |
| `GEMINI_KEY` | Google Gemini |
| `NVIDIA_KEY` | NVIDIA NIM |
| `TOGETHER_KEY` | Together AI |
| `HF_KEY` | Hugging Face |
| `BYTEZ_KEY` | Bytez |
| `JARVIS_TOKEN` | Jarvis OS, for the `jarvis_exec` tool |

A model id prefixed with a provider (`groq/...`, `openai/...`) routes directly
to that provider. Anything else goes to OmniRoute.

### File storage

Files work as soon as one backend is configured. R2 is preferred when present.

**R2** — add to `wrangler.jsonc`:

```jsonc
"r2_buckets": [{ "binding": "FILES_R2", "bucket_name": "omnigrok-files" }]
```

**S3-compatible** (self-hosted MinIO, Backblaze B2, Oracle OCI) — set the
matching group as secrets:

```
MINIO_ENDPOINT  MINIO_REGION  MINIO_BUCKET  MINIO_ACCESS_KEY_ID  MINIO_SECRET_ACCESS_KEY
B2_ENDPOINT     B2_REGION     B2_BUCKET     B2_KEY_ID            B2_APP_KEY
OCI_ENDPOINT    OCI_REGION    OCI_BUCKET    OCI_ACCESS_KEY_ID    OCI_SECRET_ACCESS_KEY
```

Google Drive is **not** wired up: it needs an OAuth app plus a refresh-token
flow, which is a separate piece of work.

## Development

```bash
npm install
npm run typecheck    # tsc --noEmit
npm run build        # typecheck, then vite build
sh test/run.sh       # auth, streaming and agent-loop checks
npm run deploy       # build, then wrangler deploy
```

`npm run build` gates on `typecheck` deliberately. `vite build` alone uses
esbuild, which strips types without checking them — that is how a fatal
prop-contract mismatch previously reached production.

`wrangler dev` serves the app locally, but `/api/*` requires a valid Access
JWT, so local API calls return 401 unless you front it with Access.

## Tools

The model can call:

- **`jarvis_exec`** — runs a command on Jarvis OS (`jarvis.damineweb.work`).
  Requires `JARVIS_TOKEN`; without it the tool returns a clear error instead
  of failing the turn.
- **`web_browse`** — fetches a page and returns readable text.

Tool turns are capped at 5 per message. Providers that reject a `tools` array
are automatically retried without it.

## Devices

A machine runs `host-agent/omnigrok-host.mjs` and OmniGrok reaches it through a
cloudflared tunnel. Install with:

```bash
sh host-agent/install.sh --roots "$HOME"        # add --read-only to forbid exec and writes
```

The agent binds to `127.0.0.1` only and is not reachable from anywhere until a
tunnel is pointed at it. Two independent credentials guard it: Cloudflare
Access on the hostname, and a bearer token the agent checks itself. Either
alone would be a single point of failure.

Add an ingress rule to your tunnel config, **before** the catch-all rule, since
ingress is matched in order:

```yaml
  - hostname: mac.example.com
    service: http://127.0.0.1:8789
    originRequest:
      noTLSVerify: true
      connectTimeout: 30s
      noHappyEyeballs: true
  - service: http_status:404
```

Do not set `http2Origin`: the agent is plain HTTP/1.1 and h2c to such an origin
drops long requests. Then put an Access application on the hostname with a
**non-identity** policy allowing a service token, and register the device in the
Devices panel with the tunnel URL, the agent token from `~/.omnigrok/token`, and
the service token pair.

## Known gaps

- Google Drive storage backend (see above).
- The OmniGrok macOS app's history is not readable from disk: its local stores
  are ~20KB with no conversation data and its gateway descriptor is encrypted,
  so that history lives server-side. Importing it needs the gateway's
  conversation API, not filesystem access.
- MCP servers can be registered and stored, but their tools are not yet
  exposed to the model — only the two built-ins above are.
- The browser panel renders pages in a fully sandboxed iframe, so scripts do
  not run. It is a reader, not a full browser.
