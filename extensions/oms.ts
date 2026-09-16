import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream, type AssistantMessage, type Provider } from "@earendil-works/pi-ai";
import { approved, bindings, type Binding, type Snapshot } from "./routing.js";

const executable = fileURLToPath(new URL("../bin/oms", import.meta.url));

export default function (pi: ExtensionAPI) {
  let routes: Binding[] = [];
  let enabled = false;
  let configured = false;
  const aborters = new Set<AbortController>();
  const status = async (): Promise<Snapshot> => {
    const result = await pi.exec("python3", [executable, "status", "--json"], { timeout: 30_000 });
    if (result.code !== 0 || result.killed) throw new Error("OMS status failed or timed out");
    const data = JSON.parse(result.stdout);
    approved(data, routes); // Validate even when every account is unavailable.
    return data;
  };

  const select = async (ctx: ExtensionContext) => {
    const candidates = approved(await status(), routes);
    for (const route of candidates) {
      const model = ctx.modelRegistry.find(route.provider, route.model);
      if (model && await pi.setModel(model)) {
        ctx.ui.setStatus("oms", `OMS: ${route.account} → ${route.provider}/${route.model}`);
        return;
      }
    }
    throw new Error("OMS: no approved authenticated route; requests remain blocked");
  };

  pi.on("session_start", async (_event, ctx) => {
    let config;
    try { config = JSON.parse(await readFile(join(getAgentDir(), "oms.json"), "utf8")); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") ctx.ui.notify("Invalid OMS config; automatic routing disabled", "error");
      return;
    }
    // An operator confirms that these existing provider logins match OMS's CLI accounts.
    // This is NOT inferred from account names and does not import or rotate credentials.
    if (config.accountBindingsConfirmed !== true) {
      ctx.ui.notify("OMS: confirm existing Pi/Claude login identities in oms.json before enabling routing", "warning");
      return;
    }
    try { routes = bindings(config.routes); }
    catch (error) { ctx.ui.notify(String(error), "error"); return; }
    const originals = routes.map(r => ctx.modelRegistry.getProvider(r.provider));
    if (originals.some(p => !p)) {
      ctx.ui.notify("OMS: a configured provider is missing; load the full OMS package", "error");
      return;
    }
    // Guard every currently registered provider, so a failed selection cannot fall
    // through to an unrelated (possibly metered) default model.
    const providers = [...new Set(ctx.modelRegistry.getAll().map(m => m.provider))]
      .map(id => ctx.modelRegistry.getProvider(id)).filter((p): p is Provider => !!p);
    for (const original of providers) {
      const wrap = (send: Provider["streamSimple"]): Provider["streamSimple"] => (model, context, options) => {
        if (!enabled) return send(model, context, options);
        const output = createAssistantMessageEventStream();
        const controller = new AbortController();
        aborters.add(controller);
        void (async () => {
          try {
            const safe = approved(await status(), routes).some(r => r.provider === model.provider && r.model === model.id);
            if (!safe) throw new Error("OMS blocked this account/model; submit again to select another approved route");
            const signal = options?.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
            signal.throwIfAborted();
            const source = send(model, context, { ...options, signal });
            for await (const event of source) output.push(event);
            const result = await source.result();
            // Claude bridge may keep its subprocess alive across tool-result boundaries.
            if (result.stopReason !== "toolUse") aborters.delete(controller);
            output.end();
          } catch {
            for (const pending of aborters) pending.abort();
            aborters.clear();
            const error: AssistantMessage = {
              role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id,
              stopReason: "error", errorMessage: "OMS blocked the request or could not verify account status", timestamp: Date.now(),
              usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
            };
            output.push({ type: "error", reason: "error", error });
            output.end();
          }
        })();
        return output;
      };
      pi.registerProvider({ ...original, streamSimple: wrap(original.streamSimple.bind(original)),
        stream: wrap(original.stream.bind(original) as Provider["streamSimple"]) as Provider["stream"] });
    }
    configured = true;
    enabled = config.enabled === true;
  });
  pi.on("before_agent_start", async (_event, ctx) => {
    if (!enabled) return;
    try { await select(ctx); }
    catch (error) { ctx.ui.notify(String(error), "error"); }
  });
  const release = () => {
    for (const controller of aborters) controller.abort();
    aborters.clear();
  };
  pi.on("agent_end", release);
  pi.on("session_shutdown", release);

  pi.registerCommand("oms", {
    description: "OMS status|priority|config; auto on|off (confirmed provider bindings required)",
    handler: async (args, ctx) => {
      const command = args.trim() || "status";
      if (command === "auto off") {
        for (const controller of aborters) controller.abort();
        aborters.clear();
        enabled = false; ctx.ui.setStatus("oms", undefined); return;
      }
      if (command === "auto on") {
        if (!configured) { ctx.ui.notify("Configure confirmed routes in ~/.pi/agent/oms.json, then /reload", "error"); return; }
        enabled = true;
        try { await select(ctx); } catch (error) { ctx.ui.notify(String(error), "error"); }
        return;
      }
      if (!["status", "priority", "config"].includes(command)) {
        ctx.ui.notify("Usage: /oms [status|priority|config|auto on|auto off]", "error"); return;
      }
      try {
        const result = await pi.exec("python3", [executable, command], { timeout: 30_000 });
        if (result.code !== 0 || result.killed) throw new Error(result.stderr || "OMS command failed or timed out");
        pi.sendMessage({ customType: "oms", content: result.stdout, display: true });
      } catch (error) { ctx.ui.notify(error instanceof Error ? error.message : String(error), "error"); }
    },
  });
}
