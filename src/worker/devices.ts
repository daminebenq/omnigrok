// Client for OmniGrok host agents.
//
// A device is one machine running host-agent/omnigrok-host.mjs behind a
// cloudflared tunnel. Two independent credentials are involved: Cloudflare
// Access guards the tunnel hostname, and the agent itself requires a bearer
// token. Either alone would be a single point of failure, so both are sent.

import type { BaseRecord } from "./resources";

export interface DeviceRecord extends BaseRecord {
  url?: string;
  /** Shared secret for the host agent. Stored server-side only. */
  hostToken?: string;
  accessClientId?: string;
  accessClientSecret?: string;
  enabled?: boolean;
  readOnly?: boolean;
}

export interface DeviceHealth {
  ok: boolean;
  name?: string;
  platform?: string;
  release?: string;
  arch?: string;
  cpuCount?: number;
  cpuModel?: string;
  memTotal?: number;
  memFree?: number;
  memUsedPct?: number;
  uptimeSeconds?: number;
  roots?: string[];
  readOnly?: boolean;
  error?: string;
}

export interface FsEntry {
  name: string;
  path: string;
  dir: boolean;
  size: number;
  modified: number;
  unreadable?: boolean;
}

const TIMEOUT_MS = 130_000;

function headers(device: DeviceRecord): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${device.hostToken ?? ""}`,
  };
  if (device.accessClientId && device.accessClientSecret) {
    h["CF-Access-Client-Id"] = device.accessClientId;
    h["CF-Access-Client-Secret"] = device.accessClientSecret;
  }
  return h;
}

async function callDevice<T>(
  device: DeviceRecord,
  path: string,
  init: { method?: string; body?: unknown } = {}
): Promise<T> {
  if (!device.url) throw new Error("device has no URL");
  const base = device.url.replace(/\/+$/, "");

  const res = await fetch(`${base}${path}`, {
    method: init.method ?? "GET",
    headers: headers(device),
    body: init.body ? JSON.stringify(init.body) : undefined,
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (res.status >= 300 && res.status < 400) {
    throw new Error(
      "Blocked by Cloudflare Access. Add a service token (client id and secret) for this device."
    );
  }
  if (res.status === 401) {
    throw new Error("The host agent rejected the token for this device.");
  }

  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Device returned a non-JSON response (HTTP ${res.status})`);
  }
  if (!res.ok) throw new Error(parsed?.error ?? `Device returned HTTP ${res.status}`);
  return parsed as T;
}

export async function deviceHealth(device: DeviceRecord): Promise<DeviceHealth> {
  try {
    const h = await callDevice<DeviceHealth>(device, "/health");
    return { ...h, ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unreachable" };
  }
}

export function deviceExec(
  device: DeviceRecord,
  command: string,
  cwd?: string
): Promise<{ ok: boolean; exitCode: number; stdout: string; stderr: string; timedOut: boolean }> {
  if (device.readOnly) {
    return Promise.resolve({
      ok: false, exitCode: -1, stdout: "", timedOut: false,
      stderr: "This device is registered read-only in OmniGrok.",
    });
  }
  return callDevice(device, "/exec", { method: "POST", body: { command, cwd } });
}

export function deviceList(device: DeviceRecord, path: string) {
  return callDevice<{ path: string; entries: FsEntry[] }>(
    device,
    `/fs/list?path=${encodeURIComponent(path)}`
  );
}

export function deviceRead(device: DeviceRecord, path: string) {
  return callDevice<{ path: string; size: number; content: string }>(
    device,
    `/fs/read?path=${encodeURIComponent(path)}`
  );
}

export function deviceWrite(device: DeviceRecord, path: string, content: string) {
  if (device.readOnly) {
    return Promise.reject(new Error("This device is registered read-only in OmniGrok."));
  }
  return callDevice<{ ok: boolean; path: string }>(device, "/fs/write", {
    method: "POST",
    body: { path, content },
  });
}
