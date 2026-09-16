import { expect, test } from "bun:test";
import extension from "../extensions/oms";
import { usageLines } from "../extensions/routing";

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
});

test("startup widget works without routing; refresh observes global display setting and errors; shutdown stops updates", async () => {
  const events: Record<string, Function> = {};
  const shown: any[] = [];
  let widget = true, fail = false, calls = 0;
  extension({
    on: (name: string, handler: Function) => events[name] = handler,
    registerCommand() {},
    exec: async () => { calls++; return { code: fail ? 1 : 0, stdout: JSON.stringify({ accounts: [], usage_widget: widget, usage_refresh_seconds: 15 }) }; },
  } as any);
  const ctx: any = { hasUI: true, ui: { setWidget: (_name: string, lines: any) => shown.push(lines), notify() {} } };
  try {
    await events.session_start({}, ctx);
    expect(shown[0][0]).toContain("loading");
    expect(shown.at(-1)[0]).toContain("No accounts");
    widget = false;
    events.agent_end(); await new Promise(r => setTimeout(r, 10));
    expect(shown.at(-1)).toBeUndefined();
    fail = true;
    events.agent_end(); await new Promise(r => setTimeout(r, 10));
    expect(shown.at(-1)[0]).toContain("unavailable");
    events.session_shutdown();
    const before = calls;
    events.agent_end(); await new Promise(r => setTimeout(r, 10));
    expect(calls).toBe(before);
  } finally { events.session_shutdown(); }
});
