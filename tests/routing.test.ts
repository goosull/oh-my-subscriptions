import { expect, test } from "bun:test";
import { bindings, approved } from "../extensions/routing";

test("OMS order wins and blocked, stale, unknown and mismatched accounts are excluded", () => {
  const routes = bindings([
    { account: "claude", provider: "claude-bridge", model: "claude-sonnet-4-6" },
    { account: "codex", provider: "openai-codex", model: "gpt-5.4" },
  ]);
  const codex = { name: "codex", vendor: "codex", available: true, resets_at: 200 };
  const claude = { name: "claude", vendor: "claude", available: true, resets_at: 100 };
  expect(approved({ accounts: [codex, claude] }, routes).map(r => r.account)).toEqual(["claude", "codex"]);
  for (const patch of [{ blocked: "overage" }, { stale: true }, { reason: "unknown" }, { available: false }, { vendor: "codex" }]) {
    expect(approved({ accounts: [{ ...claude, ...patch }, codex] }, routes).map(r => r.account)).toEqual(["codex"]);
  }
  expect(() => bindings([routes[0], routes[0]])).toThrow();
  expect(() => bindings([{ ...routes[0], provider: "anthropic" }])).toThrow();
  expect(() => approved({} as any, routes)).toThrow();
});
