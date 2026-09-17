import { expect, test } from "bun:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("OMS settings persist independently of cwd and are exposed to every host", async () => {
  const dir = await mkdtemp(join(tmpdir(), "oms-config-"));
  const executable = fileURLToPath(new URL("../bin/oms", import.meta.url));
  const run = (...args: string[]) => Bun.spawnSync(["python3", executable, ...args], {
    cwd: tmpdir(), env: { ...process.env, OMS_HOME: dir },
  });
  try {
    await writeFile(join(dir, "config.json"), JSON.stringify({ accounts: [], block_at: 95, pi: { routes: [
      { account: "google-work", coreAccount: "google-id", provider: "oms-core", model: "gemini-pro-agent" },
    ] } }));
    expect(run("set", "usage_display=status", "usage_refresh_seconds=30", "pi_auto=no").exitCode).toBe(0);
    const snapshot = JSON.parse(run("status", "--json").stdout.toString());
    expect(snapshot.usage_display).toBe("status");
    expect(snapshot.usage_refresh_seconds).toBe(30);
    expect(snapshot.pi_auto).toBe(false);
    const saved = await readFile(join(dir, "config.json"), "utf8");
    expect(JSON.parse(saved).pi.routes[0].model).toBe("gemini-pro-agent");
    expect(run("set", "google-work", "model=gemini-3.7-flash-high", "effort=high").exitCode).toBe(0);
    const configured = JSON.parse(await readFile(join(dir, "config.json"), "utf8"));
    expect(configured.pi.routes[0]).toMatchObject({ model: "gemini-3.7-flash-high", effort: "high" });
    expect(run("set", "usage_refresh_seconds=0").exitCode).toBe(1);
    expect(run("set", "usage_display=maybe").exitCode).toBe(1);
    expect(run("pi").stderr.toString()).toContain("usage: oms pi");
    expect(JSON.parse(await readFile(join(dir, "config.json"), "utf8")).pi.routes[0]).toMatchObject({ model: "gemini-3.7-flash-high", effort: "high" });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
