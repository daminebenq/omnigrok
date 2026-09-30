#!/usr/bin/env node
// OmniGrok host agent.
//
// Runs on a machine you want OmniGrok to reach: your Mac, a VM, a VPS, a
// Windows box. Exposes a narrow HTTP API for shell execution, filesystem
// access and metrics.
//
// Security posture, in order of importance:
//   1. Binds to loopback only. It never opens a port on any network
//      interface. Remote reach is provided by cloudflared, which dials out.
//   2. Requires a bearer token on every request, compared in constant time.
//      This is checked independently of Cloudflare Access, so a
//      misconfigured tunnel does not mean an open shell.
//   3. Filesystem calls are confined to configured roots, with symlinks
//      resolved before the check so a link cannot escape.
//   4. Every request is appended to an audit log.
//
// Config comes from the environment:
//   OMNIGROK_HOST_TOKEN   required, shared secret
//   OMNIGROK_HOST_PORT    default 8787
//   OMNIGROK_HOST_NAME    label shown in the UI, default os.hostname()
//   OMNIGROK_HOST_ROOTS   ':'-separated allowed roots, default $HOME
//   OMNIGROK_HOST_RO      "1" to refuse writes and exec
//   OMNIGROK_HOST_LOG     audit log path, default ~/.omnigrok-host.log

import { createServer } from "node:http";
import { exec } from "node:child_process";
import { readFile, writeFile, readdir, stat, appendFile, mkdir, realpath } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir, hostname, platform, arch, totalmem, freemem, cpus, uptime, release } from "node:os";
import { timingSafeEqual } from "node:crypto";
import { resolve, dirname, join, sep } from "node:path";

const TOKEN = process.env.OMNIGROK_HOST_TOKEN ?? "";
const PORT = Number(process.env.OMNIGROK_HOST_PORT ?? 8787);
const NAME = process.env.OMNIGROK_HOST_NAME ?? hostname();
const READ_ONLY = process.env.OMNIGROK_HOST_RO === "1";
const LOG = process.env.OMNIGROK_HOST_LOG ?? join(homedir(), ".omnigrok-host.log");
const CONFIGURED_ROOTS = (process.env.OMNIGROK_HOST_ROOTS ?? homedir())
  .split(process.platform === "win32" ? ";" : ":")
  .filter(Boolean)
  .map((p) => resolve(p));

// Roots must be compared in their resolved form. On macOS /tmp and /var are
// symlinks into /private, so a configured root of /var/... would never match a
// target realpath of /private/var/... and every path would be refused.
const ROOTS = await Promise.all(
  CONFIGURED_ROOTS.map(async (p) => (existsSync(p) ? realpath(p) : p))
);

const EXEC_TIMEOUT_MS = 120_000;
const MAX_OUTPUT = 1_000_000;
const MAX_READ = 5_000_000;

if (!TOKEN || TOKEN.length < 24) {
  console.error("OMNIGROK_HOST_TOKEN must be set and at least 24 characters.");
  process.exit(1);
}

function authorized(req) {
  const header = req.headers.authorization ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(given);
  const b = Buffer.from(TOKEN);
  // Length must match before timingSafeEqual, and comparing lengths first
  // leaks only the length, which is not the secret.
  return a.length === b.length && timingSafeEqual(a, b);
}

async function audit(entry) {
  const line = JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n";
  await appendFile(LOG, line).catch(() => {});
}

/**
 * Resolve a path and confirm it stays inside an allowed root. Symlinks are
 * resolved first: checking the literal path would let a link inside a root
 * point anywhere on disk.
 */
async function safePath(input, { mustExist = true } = {}) {
  if (typeof input !== "string" || !input) throw new Error("path is required");
  const expanded = input.startsWith("~") ? join(homedir(), input.slice(1)) : input;
  let target = resolve(expanded);

  const probe = mustExist ? target : dirname(target);
  if (existsSync(probe)) {
    const real = await realpath(probe);
    target = mustExist ? real : join(real, target.slice(dirname(target).length + 1));
  } else if (mustExist) {
    throw new Error("no such path");
  }

  const ok = ROOTS.some((root) => target === root || target.startsWith(root + sep));
  if (!ok) throw new Error(`path is outside the allowed roots (${ROOTS.join(", ")})`);
  return target;
}

function runCommand(command, cwd) {
  return new Promise((resolvePromise) => {
    exec(
      command,
      { cwd: cwd || homedir(), timeout: EXEC_TIMEOUT_MS, maxBuffer: MAX_OUTPUT, shell: true },
      (err, stdout, stderr) => {
        resolvePromise({
          ok: !err,
          exitCode: err?.code ?? 0,
          timedOut: err?.killed === true,
          stdout: String(stdout ?? "").slice(0, MAX_OUTPUT),
          stderr: String(stderr ?? "").slice(0, MAX_OUTPUT),
        });
      }
    );
  });
}

async function metrics() {
  const load = cpus();
  return {
    name: NAME,
    platform: platform(),
    release: release(),
    arch: arch(),
    uptimeSeconds: Math.round(uptime()),
    cpuCount: load.length,
    cpuModel: load[0]?.model ?? "unknown",
    memTotal: totalmem(),
    memFree: freemem(),
    memUsedPct: Math.round(((totalmem() - freemem()) / totalmem()) * 100),
    roots: ROOTS,
    readOnly: READ_ONLY,
  };
}

const json = (res, body, code = 200) => {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

async function body(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;

  if (!authorized(req)) {
    await audit({ path, event: "unauthorized", ip: req.socket.remoteAddress });
    return json(res, { error: "Unauthorized" }, 401);
  }

  try {
    if (path === "/health") {
      return json(res, { ok: true, ...(await metrics()) });
    }

    if (path === "/metrics") {
      return json(res, await metrics());
    }

    if (path === "/exec" && req.method === "POST") {
      if (READ_ONLY) return json(res, { error: "This host is read-only" }, 403);
      const { command, cwd } = await body(req);
      if (!command) return json(res, { error: "command is required" }, 400);
      const safeCwd = cwd ? await safePath(cwd) : undefined;
      const result = await runCommand(command, safeCwd);
      await audit({ event: "exec", command, cwd: safeCwd, exitCode: result.exitCode });
      return json(res, result);
    }

    if (path === "/fs/list") {
      const dir = await safePath(url.searchParams.get("path") ?? homedir());
      const names = await readdir(dir);
      const entries = await Promise.all(
        names.slice(0, 1000).map(async (name) => {
          try {
            const s = await stat(join(dir, name));
            return {
              name,
              path: join(dir, name),
              dir: s.isDirectory(),
              size: s.size,
              modified: s.mtimeMs,
            };
          } catch {
            return { name, path: join(dir, name), dir: false, size: 0, modified: 0, unreadable: true };
          }
        })
      );
      await audit({ event: "fs.list", path: dir });
      entries.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
      return json(res, { path: dir, entries });
    }

    if (path === "/fs/read") {
      const file = await safePath(url.searchParams.get("path") ?? "");
      const s = await stat(file);
      if (s.size > MAX_READ) return json(res, { error: `file is too large (${s.size} bytes)` }, 413);
      const content = await readFile(file, "utf8");
      await audit({ event: "fs.read", path: file, size: s.size });
      return json(res, { path: file, size: s.size, content });
    }

    if (path === "/fs/write" && req.method === "POST") {
      if (READ_ONLY) return json(res, { error: "This host is read-only" }, 403);
      const { path: p, content } = await body(req);
      const file = await safePath(p, { mustExist: false });
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, String(content ?? ""), "utf8");
      await audit({ event: "fs.write", path: file, bytes: String(content ?? "").length });
      return json(res, { ok: true, path: file });
    }

    return json(res, { error: "Not found" }, 404);
  } catch (e) {
    await audit({ event: "error", path, message: String(e?.message ?? e) });
    return json(res, { error: String(e?.message ?? e) }, 400);
  }
});

// A bind failure must be loud. Under launchd/systemd with KeepAlive a silent
// crash just restarts forever and the agent looks installed but is not there.
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `Port ${PORT} on 127.0.0.1 is already in use by another process. ` +
        `Set OMNIGROK_HOST_PORT to a free port and reinstall.`
    );
  } else {
    console.error(`Failed to listen on 127.0.0.1:${PORT}: ${err.message}`);
  }
  process.exit(1);
});

// Loopback only. cloudflared dials out to reach this; nothing dials in.
server.listen(PORT, "127.0.0.1", () => {
  console.log(`omnigrok-host "${NAME}" on 127.0.0.1:${PORT}`);
  console.log(`  roots: ${ROOTS.join(", ")}`);
  console.log(`  mode:  ${READ_ONLY ? "read-only" : "read-write"}`);
  console.log(`  audit: ${LOG}`);
});
