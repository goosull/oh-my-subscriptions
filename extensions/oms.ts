import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { DynamicBorder, getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, type SelectItem, SelectList, Text } from "@earendil-works/pi-tui";
import { createAssistantMessageEventStream, type AssistantMessage, type Provider } from "@earendil-works/pi-ai";
import { approved, bindings, type Binding, type Snapshot, usageStatus } from "./routing.js";
import { renderUsagePanel } from "./usage-component.js";
import { renderAccountFooter } from "./account-footer.js";
import { connectCore, type CoreClient } from "./core-client.js";

const executable = fileURLToPath(new URL("../bin/oms", import.meta.url));
const omsHome = () => process.env.OMS_HOME || join(homedir(), ".oms");

export default async function (pi: ExtensionAPI) {
  let core: CoreClient | undefined = await connectCore(pi);
  if (core) {
    const models = await core.models();
    if (models.length) pi.registerProvider("oms-core", {
      name: "OMS Core", baseUrl: core.baseUrl, apiKey: core.token, api: "openai-completions",
      models: models.map(model => ({ id:model.id, name:`${model.id} (${model.provider})`, reasoning:true,
        input:["text"] as const, contextWindow:128000, maxTokens:32768,
        cost:{ input:0, output:0, cacheRead:0, cacheWrite:0 } })),
    });
  }
  let routes: Binding[] = [];
  let enabled = false;
  let configured = false;
  const aborters = new Set<AbortController>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let latest: Snapshot | undefined;
  let refresh: (() => Promise<void>) | undefined;
  let refreshing = false;
  let pinnedAccount = process.env.OMS_ACCOUNT || undefined;
  let activeAccount = pinnedAccount;
  let requestRender: (() => void) | undefined;
  const showUsage = (ctx: ExtensionContext, snapshot: Snapshot) => {
    const display = snapshot.usage_display ?? "off";
    ctx.ui.setStatus("oms-usage", display === "status" ? usageStatus(snapshot) : undefined);
    if (display !== "widget") { ctx.ui.setWidget("oms-usage", undefined); return; }
    const activeAccount = routes.find(r => r.provider === ctx.model?.provider && r.model === ctx.model?.id)?.account;
    ctx.ui.setWidget("oms-usage", (_tui, theme) => ({
      render: (width: number) => renderUsagePanel(snapshot, {
        model: ctx.model?.name ?? ctx.model?.id,
        thinking: ctx.thinkingLevel,
        contextPercent: ctx.getContextUsage()?.percent,
        contextWindow: ctx.getContextUsage()?.contextWindow ?? ctx.model?.contextWindow,
        activeAccount,
      }, theme, width),
      invalidate() {},
    }));
  };
  const status = async (): Promise<Snapshot> => {
    if (core) {
      await pi.exec("python3", [executable, "core", "sync"], { timeout: 30_000 });
      const models = await core.models();
      if (models.length) pi.registerProvider("oms-core", {
        name:"OMS Core", baseUrl:core.baseUrl, apiKey:core.token, api:"openai-completions",
        models:models.map(model => ({ id:model.id, name:`${model.id} (${model.provider})`, reasoning:true,
          input:["text"] as const, contextWindow:128000, maxTokens:32768,
          cost:{ input:0, output:0, cacheRead:0, cacheWrite:0 } })),
      });
    }
    const result = await pi.exec("python3", [executable, "status", "--json"], { timeout: 30_000 });
    if (result.code !== 0 || result.killed) throw new Error("OMS status failed or timed out");
    const data = JSON.parse(result.stdout);
    approved(data, routes); // Validate even when every account is unavailable.
    latest = data;
    requestRender?.();
    if (configured && typeof data.pi_auto === "boolean") enabled = data.pi_auto;
    return data;
  };

  const pick = async (ctx: ExtensionContext, title: string, items: SelectItem[]) => {
    if (ctx.mode !== "tui") return undefined;
    return ctx.ui.custom<string | null>((tui, theme, _keybindings, done) => {
      const container = new Container();
      container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
      container.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 0));
      const list = new SelectList(items, Math.min(items.length, 14), {
        selectedPrefix: text => theme.fg("accent", text),
        selectedText: text => theme.fg("accent", text),
        description: text => theme.fg("muted", text),
        scrollInfo: text => theme.fg("dim", text),
        noMatch: text => theme.fg("warning", text),
      });
      list.onSelect = item => done(item.value);
      list.onCancel = () => done(null);
      container.addChild(list);
      container.addChild(new Text(theme.fg("dim", "↑↓ navigate • type to search • enter select • esc cancel"), 1, 0));
      container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
      return {
        render: (width: number) => container.render(width),
        invalidate: () => container.invalidate(),
        handleInput: (data: string) => { list.handleInput(data); tui.requestRender(); },
      };
    });
  };

  const select = async (ctx: ExtensionContext) => {
    const candidates = approved(await status(), routes);
    const ordered = pinnedAccount ? candidates.filter(route => route.account === pinnedAccount) : candidates;
    for (const route of ordered) {
      if (route.provider === "oms-core") {
        if (!core) continue;
        try { await core.select(route.coreAccount ?? route.account, route.model); } catch { continue; }
      }
      const model = ctx.modelRegistry.find(route.provider, route.model);
      if (model && await pi.setModel(model)) {
        if (route.effort) pi.setThinkingLevel(route.effort);
        activeAccount = route.account;
        requestRender?.();
        return;
      }
    }
    throw new Error(pinnedAccount ? `OMS: ${pinnedAccount} is not currently available` : "OMS: no approved authenticated route; requests remain blocked");
  };

  const configure = async (ctx: ExtensionContext) => {
    if (ctx.mode !== "tui") { ctx.ui.notify("OMS configuration requires TUI mode", "error"); return; }
    const snapshot = await status();
    const coreRoutes = routes.filter(route => route.provider === "oms-core");
    if (!core || !coreRoutes.length) { ctx.ui.notify("No OMS Core accounts are configured", "warning"); return; }
    const account = await pick(ctx, "OMS Account", coreRoutes.map(route => {
      const state = snapshot.accounts.find(item => item.name === route.account);
      const availability = state?.available ? "available" : state?.blocked ? "BLOCKED" : state?.reason ?? "unavailable";
      return { value:route.account, label:route.account,
        description:`${state?.vendor ?? "core"} • ${route.model}${route.effort ? ` • effort:${route.effort}` : ""} • ${availability}` };
    }));
    if (!account) return;
    const route = coreRoutes.find(item => item.account === account)!;
    const vendor = snapshot.accounts.find(item => item.name === account)?.vendor;
    const catalog = await core.models();
    const matching = catalog.filter(model => !vendor || model.provider === vendor);
    const models = matching.length ? matching : catalog;
    const model = await pick(ctx, `${account} · Model`, models.map(item => ({
      value:item.id, label:item.id === route.model ? `${item.id} (current)` : item.id,
      description:item.provider,
    })));
    if (!model) return;
    const levels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
    const effort = await pick(ctx, `${account} · Effort`, levels.map(level => ({
      value:level, label:level === (route.effort ?? "off") ? `${level} (current)` : level,
    })));
    if (!effort) return;
    const saved = await pi.exec("python3", [executable, "set", account, `model=${model}`, `effort=${effort}`], { timeout:30_000 });
    if (saved.code !== 0 || saved.killed) { ctx.ui.notify(saved.stderr || "Could not save OMS configuration", "error"); return; }
    route.model = model;
    route.effort = effort as Binding["effort"];
    ctx.ui.notify(`Saved global default: ${account} · ${model} · effort:${effort} (current session unchanged)`, "info");
  };

  pi.registerShortcut?.("ctrl+shift+o", { description:"Configure OMS account, model, and effort", handler:configure });

  pi.on("session_start", async (_event, ctx) => {
    stopped = false;
    ctx.ui.setFooter((tui, theme, footerData) => {
      requestRender = () => tui.requestRender();
      const unsubscribe = footerData.onBranchChange(requestRender);
      return {
        dispose: () => { unsubscribe(); requestRender = undefined; },
        invalidate() {},
        render: (width: number) => renderAccountFooter(ctx, footerData, theme, latest, activeAccount, routes, width),
      };
    });
    refresh = async () => {
      if (stopped || refreshing || !ctx.hasUI) return;
      refreshing = true;
      clearTimeout(timer);
      try {
        const snapshot = await status();
        if (!stopped) {
          showUsage(ctx, snapshot);
        }
      } catch {
        if (!stopped) {
          ctx.ui.setWidget("oms-usage", undefined);
          ctx.ui.setStatus("oms-usage", "OMS usage unavailable · /oms");
        }
      } finally {
        refreshing = false;
        if (!stopped) {
          const seconds = latest?.usage_refresh_seconds;
          const delay = typeof seconds === "number" && Number.isFinite(seconds) ? Math.min(3600, Math.max(15, seconds)) : 60;
          timer = setTimeout(() => { void refresh?.(); }, delay * 1000);
          timer.unref();
        }
      }
    };
    await refresh();
    let config;
    try {
      const global = JSON.parse(await readFile(join(omsHome(), "config.json"), "utf8"));
      config = global.pi;
      if (config && typeof global.pi_auto === "boolean") config = { ...config, enabled: global.pi_auto };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") { ctx.ui.notify("Invalid OMS global config; routing disabled", "error"); return; }
    }
    try {
      if (!config) config = JSON.parse(await readFile(join(getAgentDir(), "oms.json"), "utf8"));
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") ctx.ui.notify("Invalid OMS config; automatic routing disabled", "error");
      return;
    }
    // An operator confirms that these existing provider logins match OMS's CLI accounts.
    // This is NOT inferred from account names and does not import or rotate credentials.
    if (config.accountBindingsConfirmed !== true) {
      ctx.ui.notify("OMS: confirm Pi/Claude identities under pi in ~/.oms/config.json before enabling routing", "warning");
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
    enabled = typeof latest?.pi_auto === "boolean" ? latest.pi_auto : config.enabled === true;
    activeAccount ??= routes.find(r => r.provider === ctx.model?.provider && r.model === ctx.model?.id)?.account;
    requestRender?.();
  });
  pi.on("model_select", (event) => {
    activeAccount = routes.find(r => r.provider === event.model.provider && r.model === event.model.id)?.account;
    requestRender?.();
  });
  pi.on("before_agent_start", async (_event, ctx) => {
    try {
      if (!enabled && ctx.model?.provider === "oms-core") {
        const candidates = approved(await status(), routes).filter(route => route.provider === "oms-core" && route.model === ctx.model?.id);
        let selected = false;
        for (const route of candidates) {
          try { await core?.select(route.coreAccount ?? route.account, route.model); activeAccount = route.account; selected = true; requestRender?.(); break; } catch {}
        }
        if (!selected) throw new Error("OMS: no approved core account provides this model");
        return;
      }
      if (enabled) await select(ctx);
    } catch (error) { ctx.ui.notify(String(error), "error"); }
  });
  const release = () => {
    for (const controller of aborters) controller.abort();
    aborters.clear();
  };
  pi.on("agent_end", () => { release(); void refresh?.(); });
  pi.on("session_shutdown", (_event, ctx) => {
    stopped = true; clearTimeout(timer); release();
    ctx.ui.setWidget("oms-usage", undefined);
    ctx.ui.setStatus("oms-usage", undefined);
    ctx.ui.setFooter(undefined);
  });

  pi.registerCommand("oms", {
    description: "Configure global defaults; use switches the current Pi session",
    handler: async (args, ctx) => {
      const command = args.trim();
      if (!command || command === "config") { await configure(ctx); return; }
      if (command === "auto off" || command === "auto on") {
        const on = command === "auto on";
        if (on && !configured) { ctx.ui.notify("Configure confirmed pi routes in ~/.oms/config.json, then /reload", "error"); return; }
        try {
          const saved = await pi.exec("python3", [executable, "set", `pi_auto=${on ? "yes" : "no"}`], { timeout: 30_000 });
          if (saved.code !== 0 || saved.killed) throw new Error("Could not save global OMS routing setting");
          enabled = on;
          if (on) await select(ctx); else { release(); activeAccount = undefined; requestRender?.(); }
        } catch (error) { ctx.ui.notify(String(error), "error"); }
        return;
      }
      if (command === "use") {
        if (ctx.mode !== "tui") { ctx.ui.notify("OMS account switching requires TUI mode", "error"); return; }
        const snapshot = await status();
        const available = approved(snapshot, routes);
        const account = await pick(ctx, "Switch Current Pi Session", available.map(route => ({
          value:route.account, label:route.account,
          description:`${route.model}${route.effort ? ` • effort:${route.effort}` : ""}`,
        })));
        if (!account) return;
        pinnedAccount = account;
        try { await select(ctx); ctx.ui.notify(`Current Pi session switched to ${account}`, "info"); }
        catch (error) { ctx.ui.notify(String(error), "error"); }
        return;
      }
      if (command === "use auto") {
        pinnedAccount = undefined;
        try { await select(ctx); ctx.ui.notify("Current Pi session switched to automatic selection", "info"); }
        catch (error) { ctx.ui.notify(String(error), "error"); }
        return;
      }
      if (command.startsWith("use ")) {
        const account = command.slice(4).trim();
        if (!routes.some(route => route.account === account)) { ctx.ui.notify(`Unknown OMS account: ${account}`, "error"); return; }
        pinnedAccount = account;
        try { await select(ctx); ctx.ui.notify(`Current Pi session switched to ${account}`, "info"); }
        catch (error) { ctx.ui.notify(String(error), "error"); }
        return;
      }
      if (!["status", "priority"].includes(command)) {
        ctx.ui.notify("Usage: /oms [status|priority|config|use <account>|use auto|auto on|auto off]", "error"); return;
      }
      try {
        const result = await pi.exec("python3", [executable, command], { timeout: 30_000 });
        if (result.code !== 0 || result.killed) throw new Error(result.stderr || "OMS command failed or timed out");
        pi.sendMessage({ customType: "oms", content: result.stdout, display: true });
        if (command === "status") await refresh?.();
      } catch (error) { ctx.ui.notify(error instanceof Error ? error.message : String(error), "error"); }
    },
  });
}
