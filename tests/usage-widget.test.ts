import { expect, test } from "bun:test";
import extension from "../extensions/oms";
import { usageLines, usageStatus } from "../extensions/routing";

test("usage renderer distinguishes stale, blocked, missing and lower-bound usage", () => {
  const text = usageLines({ accounts: [
    { name: "claude", vendor: "claude", available: false, stale: true, age_seconds: 960,
      blocked: "overage", windows: [{ window: "7d", used_percent: 99 }] },
    { name: "kiro", vendor: "kiro", available: true, floor: true, windows: [{ window: "30d", used_percent: 2 }] },
    { name: "new", vendor: "codex", available: false, reason: "no data" },
  ] }).join("\n");
  expect(text).toContain("99%"); expect(text).toContain("16m ago");
  expect(text).toContain("STALE"); expect(text).toContain("BLOCKED");
  expect(text).toContain(">=2%"); expect(text).toContain("no data");
  expect(usageLines({ accounts: [] })[0]).toContain("No accounts");
  expect(usageStatus({ accounts: [
    { name: "safe", vendor: "codex", available: true, windows: [{ window: "7d", used_percent: 26 }] },
    { name: "risk", vendor: "claude", available: false, blocked: "x", stale: true,
      windows: [{ window: "7d", used_percent: 99 }] },
  ] })).toBe("OMS safe 26% · !risk ~99% · /oms");
});

test("startup widget works without routing; refresh observes global display setting and errors; shutdown stops updates", async () => {
  const oldOms = process.env.OMS_HOME;
  process.env.OMS_HOME = `/tmp/oms-widget-test-${process.pid}-${Date.now()}`;
  const events: Record<string, Function> = {};
  const widgets: any[] = [], statuses: any[] = [];
  let display: "status" | "widget" | "off" = "status", fail = false, calls = 0;
  await extension({
    on: (name: string, handler: Function) => events[name] = handler,
    registerCommand() {},
    exec: async () => { calls++; return { code: fail ? 1 : 0, stdout: JSON.stringify({ accounts: [], usage_display: display, usage_refresh_seconds: 15 }) }; },
  } as any);
  const ctx: any = { hasUI: true, getContextUsage: () => undefined, ui: {
    setWidget: (_name: string, value: any) => widgets.push(value),
    setStatus: (_name: string, text: any) => statuses.push(text),
    setFooter() {}, notify() {},
  } };
  try {
    await events.session_start({}, ctx);
    expect(statuses.at(-1)).toContain("no accounts");
    expect(widgets.at(-1)).toBeUndefined();
    display = "widget";
    events.agent_end(); await new Promise(r => setTimeout(r, 10));
    const factory = widgets.at(-1);
    const component = factory({}, { fg: (_c: string, text: string) => text, bold: (text: string) => text });
    expect(component.render(80).at(-1)).toContain("no accounts");
    expect(statuses.at(-1)).toBeUndefined();
    display = "off";
    events.agent_end(); await new Promise(r => setTimeout(r, 10));
    expect(widgets.at(-1)).toBeUndefined(); expect(statuses.at(-1)).toBeUndefined();
    fail = true;
    events.agent_end(); await new Promise(r => setTimeout(r, 10));
    expect(statuses.at(-1)).toContain("unavailable");
    events.session_shutdown({}, ctx);
    const before = calls;
    events.agent_end(); await new Promise(r => setTimeout(r, 10));
    expect(calls).toBe(before);
  } finally {
    events.session_shutdown({}, ctx);
    if (oldOms === undefined) delete process.env.OMS_HOME; else process.env.OMS_HOME = oldOms;
  }
});
