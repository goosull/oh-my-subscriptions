import { expect, test } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import extension from "../extensions/oms";

test("native provider selection and send guard: blocked Claude falls back to Codex, no safe route sends nothing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "oms-pi-"));
  const old = process.env.PI_CODING_AGENT_DIR;
  const oldOms = process.env.OMS_HOME;
  process.env.OMS_HOME = dir;
  process.env.PI_CODING_AGENT_DIR = join(dir, "different-pi-home");
  try {
    await writeFile(join(dir, "config.json"), JSON.stringify({ pi_auto: true, pi: { accountBindingsConfirmed: true, routes: [
      { account: "claude", provider: "claude-bridge", model: "claude-sonnet-4-6" },
      { account: "codex", provider: "openai-codex", model: "gpt-5.4" },
    ] } }));
    const events: Record<string, Function> = {};
    const models = [
      { provider: "claude-bridge", id: "claude-sonnet-4-6", api: "claude-bridge" },
      { provider: "openai-codex", id: "gpt-5.4", api: "openai-codex-responses" },
      { provider: "openai", id: "metered", api: "openai-responses" },
    ];
    let calls = 0;
    const providers = new Map(models.map(m => [m.provider, {
      id: m.provider, stream: send, streamSimple: send,
    }]));
    function send(model: any) {
      calls++;
      const s = createAssistantMessageEventStream();
      s.push({ type: "done", reason: "stop", message: { role: "assistant", content: [], ...model, model: model.id,
        stopReason: "stop", timestamp: 0, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } });
      s.end(); return s;
    }
    let available = true;
    const ctx: any = { model: models[2], ui: { notify() {}, setStatus() {}, setWidget() {}, setFooter() {} }, modelRegistry: {
      getAll: () => models, getProvider: (id: string) => providers.get(id),
      find: (provider: string, id: string) => models.find(m => m.provider === provider && m.id === id),
    } };
    await extension({ on: (name: string, handler: Function) => events[name] = handler,
      registerCommand() {}, registerProvider: (p: any) => providers.set(p.id, p),
      setModel: async (m: any) => { ctx.model = m; return true; },
      exec: async () => ({ code: 0, stdout: JSON.stringify({ accounts: [
        { name: "claude", vendor: "claude", available: false, blocked: "paid overflow" },
        { name: "codex", vendor: "codex", available },
      ] }) }),
    } as any);
    await events.session_start({}, ctx);
    await events.before_agent_start({}, ctx);
    expect(ctx.model.provider).toBe("openai-codex");
    expect((await providers.get("openai-codex")!.streamSimple(ctx.model, {} as any).result()).stopReason).toBe("stop");
    expect(calls).toBe(1);
    available = false;
    await events.before_agent_start({}, ctx);
    expect((await providers.get("openai-codex")!.streamSimple(ctx.model, {} as any).result()).stopReason).toBe("error");
    expect((await providers.get("openai")!.streamSimple(models[2], {} as any).result()).stopReason).toBe("error");
    expect(calls).toBe(1);
    events.session_shutdown({}, ctx);
  } finally {
    if (old === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = old;
    if (oldOms === undefined) delete process.env.OMS_HOME; else process.env.OMS_HOME = oldOms;
    await rm(dir, { recursive: true, force: true });
  }
});
