# OmniGrok Web

OmniGrok as a web app — same multi-provider AI routing as the macOS app, deployed on Cloudflare Workers at `omnigrok.damineweb.work`, protected by Cloudflare Access.

## Architecture

- **Worker** (`src/worker/`): Hono app handling auth, inference proxying, KV storage
- **Frontend** (`src/web/`): React + Tailwind, SSE streaming, dark theme
- **Routing**: OmniRoute (primary) → direct providers (Groq, NVIDIA, OpenAI, Gemini, etc.)

## Setup

### 1. Create KV namespace

```bash
wrangler kv namespace create OMNIGROK_KV
```

Copy the `id` into `wrangler.jsonc` under `kv_namespaces`.

### 2. Configure Cloudflare Access

Create an Access application for `omnigrok.damineweb.work` in the Cloudflare Zero Trust dashboard. Copy the **Audience tag** (AUD) into `wrangler.jsonc` as `ALLOWED_AUD`.

### 3. Add worker secrets

```bash
wrangler secret put OMNIROUTE_KEY   # your OmniRoute bearer key
wrangler secret put GROQ_KEY        # optional
wrangler secret put OPENAI_KEY      # optional
wrangler secret put GEMINI_KEY      # optional
wrangler secret put NVIDIA_KEY      # optional
wrangler secret put TOGETHER_KEY    # optional
wrangler secret put HF_KEY          # optional
wrangler secret put BYTEZ_KEY       # optional
wrangler secret put JARVIS_TOKEN    # token for jarvis.damineweb.work/api/exec
```

### 4. Build and deploy

```bash
npm install
npm run build
wrangler deploy
```

## Development

```bash
npm install
npm run dev   # wrangler dev with local KV
```

## Model routing

| Prefix | Provider |
|--------|----------|
| `groq/` | Groq |
| `openai/` | OpenAI |
| `gemini/` | Google Gemini |
| `nvidia/` | NVIDIA NIM |
| `together/` | Together AI |
| `hf/` | Hugging Face |
| `bytez/` | Bytez |
| *(none)* | OmniRoute |
