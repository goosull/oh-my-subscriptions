import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export interface CoreModel { id: string; provider: string }
export interface CoreAccount { name: string; provider: string; model?: string; disabled: boolean }
export interface CoreClient {
  readonly baseUrl: string;
  readonly token: string;
  models(): Promise<CoreModel[]>;
  accounts(): Promise<CoreAccount[]>;
  select(account: string, model: string): Promise<void>;
}
const root = () => process.env.OMS_HOME || join(homedir(), ".oms");
const corePath = (...parts: string[]) => join(root(), "core", ...parts);

async function secret(path: string) {
  const info = await stat(path);
  if (!info.isFile() || (info.mode & 0o077) !== 0) throw new Error(`${path} must be a private file (0600)`);
  const value = (await readFile(path, "utf8")).trim();
  if (value.length < 32) throw new Error(`${path} is invalid`);
  return value;
}

export async function connectCore(pi: ExtensionAPI): Promise<CoreClient | undefined> {
  const binary = join(root(), "bin", "oms-core");
  const config = corePath("config.yaml");
  const facadeTokenPath = corePath("facade.token");
  const managementTokenPath = corePath("management.token");
  let token: string;
  try { token = await secret(facadeTokenPath); }
  catch { return undefined; }
  const baseUrl = (process.env.OMS_CORE_URL || "http://127.0.0.1:8319/v1").replace(/\/$/, "");
  const request = async (path: string, init?: RequestInit) => {
    const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init?.headers }, signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error(`OMS core ${path}: ${response.status}`);
    return response;
  };
  try { await request("/models"); }
  catch {
    let management: string;
    try { management = await secret(managementTokenPath); await stat(binary); await stat(config); }
    catch { return undefined; }
    const log = openSync(corePath("oms-core.log"), "a", 0o600);
    const child = spawn(binary, ["--config", config, "--listen", "127.0.0.1:8319"], {
      detached: true, stdio: ["ignore", log, log],
      env: { ...process.env, OMS_CORE_TOKEN: token, OMS_CORE_MANAGEMENT_TOKEN: management },
    });
    child.unref(); closeSync(log);
    let connected = false;
    for (let i = 0; i < 50; i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      try { await request("/models"); connected = true; break; } catch {}
    }
    if (!connected) return undefined;
  }
  return {
    baseUrl, token,
    async models() { const body = await (await request("/models")).json() as { data?: { id: string; owned_by?: string }[] }; return (body.data ?? []).map(model => ({ id:model.id, provider:model.owned_by ?? "unknown" })); },
    async accounts() { const body = await (await request("/oms/accounts")).json() as { accounts?: CoreAccount[] }; return body.accounts ?? []; },
    async select(account, model) { await request("/oms/account", { method:"PUT", body:JSON.stringify({ account, model }) }); },
  };
}
