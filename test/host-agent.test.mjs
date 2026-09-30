// The host agent is a remote shell, so its guards are the whole story:
// token required, filesystem confined to allowed roots, symlinks unable to
// escape them, and read-only mode actually read-only.
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, mkdir, symlink, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TOKEN = "test-token-that-is-long-enough-xx";
const root = await mkdtemp(join(tmpdir(), "omnigrok-root-"));
const outside = await mkdtemp(join(tmpdir(), "omnigrok-outside-"));

await writeFile(join(root, "inside.txt"), "allowed content");
await writeFile(join(outside, "secret.txt"), "SHOULD NOT BE READABLE");
await mkdir(join(root, "sub"));
// A symlink inside an allowed root pointing out of it must not be followed.
await symlink(join(outside, "secret.txt"), join(root, "escape-link"));

function start(env) {
  const p = spawn(process.execPath, ["host-agent/omnigrok-host.mjs"], {
    env: { ...process.env, OMNIGROK_HOST_TOKEN: TOKEN, OMNIGROK_HOST_ROOTS: root, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  p.stdout.resume(); p.stderr.resume();
  return p;
}

const PORT = 8901;
let proc = start({ OMNIGROK_HOST_PORT: String(PORT) });
await sleep(900);

const base = `http://127.0.0.1:${PORT}`;
const call = (path, { token = TOKEN, method = "GET", body } = {}) =>
  fetch(base + path, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

// --- auth ---
check("no token is rejected", (await call("/health", { token: "" })).status, 401);
check("wrong token is rejected", (await call("/health", { token: "nope" })).status, 401);
check("token of the right length but wrong value is rejected",
  (await call("/health", { token: "x".repeat(TOKEN.length) })).status, 401);
check("correct token is accepted", (await call("/health")).status, 200);

const health = await (await call("/health")).json();
check("health reports the platform", typeof health.platform, "string");
// The agent reports roots in resolved form, which is the form it enforces.
check("health reports allowed roots", health.roots, [await realpath(root)]);

// --- exec ---
const ex = await (await call("/exec", { method: "POST", body: { command: "echo hello-from-host" } })).json();
check("exec runs a command", ex.stdout.trim(), "hello-from-host");
check("exec reports success", ex.ok, true);
const bad = await (await call("/exec", { method: "POST", body: { command: "exit 3" } })).json();
check("exec surfaces a non-zero exit", bad.exitCode, 3);
check("exec without a command is rejected",
  (await call("/exec", { method: "POST", body: {} })).status, 400);

// --- filesystem confinement ---
const ls = await (await call(`/fs/list?path=${encodeURIComponent(root)}`)).json();
check("lists an allowed directory", ls.entries.some((e) => e.name === "inside.txt"), true);

const readOk = await (await call(`/fs/read?path=${encodeURIComponent(join(root, "inside.txt"))}`)).json();
check("reads a file inside a root", readOk.content, "allowed content");

const traversal = await call(`/fs/read?path=${encodeURIComponent(join(outside, "secret.txt"))}`);
check("refuses a path outside the roots", traversal.status, 400);
check("refusal names the reason", /outside the allowed roots/.test((await traversal.json()).error), true);

const dotdot = await call(`/fs/read?path=${encodeURIComponent(join(root, "..", "..", "etc", "hosts"))}`);
check("refuses ../ traversal", dotdot.status, 400);

const viaLink = await call(`/fs/read?path=${encodeURIComponent(join(root, "escape-link"))}`);
check("refuses a symlink escaping the root", viaLink.status, 400);

// --- writes ---
const w = await (await call("/fs/write", {
  method: "POST", body: { path: join(root, "sub", "new.txt"), content: "written" },
})).json();
check("writes inside a root", w.ok, true);
const back = await (await call(`/fs/read?path=${encodeURIComponent(join(root, "sub", "new.txt"))}`)).json();
check("write round-trips", back.content, "written");
check("refuses a write outside the roots",
  (await call("/fs/write", { method: "POST", body: { path: join(outside, "evil.txt"), content: "x" } })).status, 400);

proc.kill();
await sleep(300);

// --- read-only mode ---
const RO_PORT = 8902;
proc = start({ OMNIGROK_HOST_PORT: String(RO_PORT), OMNIGROK_HOST_RO: "1" });
await sleep(900);
const roCall = (path, opts = {}) =>
  fetch(`http://127.0.0.1:${RO_PORT}${path}`, {
    method: opts.method ?? "GET",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
check("read-only refuses exec",
  (await roCall("/exec", { method: "POST", body: { command: "echo x" } })).status, 403);
check("read-only refuses writes",
  (await roCall("/fs/write", { method: "POST", body: { path: join(root, "x"), content: "y" } })).status, 403);
check("read-only still allows reads",
  (await roCall(`/fs/read?path=${encodeURIComponent(join(root, "inside.txt"))}`)).status, 200);
proc.kill();
await sleep(200);

// --- refuses to start without a usable token ---
const weak = spawn(process.execPath, ["host-agent/omnigrok-host.mjs"], {
  env: { ...process.env, OMNIGROK_HOST_TOKEN: "short", OMNIGROK_HOST_ROOTS: root, OMNIGROK_HOST_PORT: "8903" },
  stdio: ["ignore", "pipe", "pipe"],
});
const weakCode = await new Promise((r) => weak.on("exit", r));
check("refuses to start with a weak token", weakCode, 1);

await rm(root, { recursive: true, force: true });
await rm(outside, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
