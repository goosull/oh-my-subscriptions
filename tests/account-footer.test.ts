import { expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { accountText, renderAccountFooter } from "../extensions/account-footer";

const theme = { fg: (_color: string, text: string) => text } as any;
const footerData = {
  getGitBranch: () => "main", getAvailableProviderCount: () => 2,
  getExtensionStatuses: () => new Map([["mcp", "\x1b[38;2;90;128;128mMCP 0/15\x1b[39m"], ["pony", "ponytail: FULL"]]),
  onBranchChange: () => () => {},
};
const ctx: any = {
  cwd: "/tmp/project", thinkingLevel: "high",
  model: { provider: "openai-codex", id: "gpt-5.6-sol", reasoning: true, contextWindow: 872000 },
  getContextUsage: () => ({ percent: 0, contextWindow: 872000, tokens: 0 }),
  sessionManager: { getEntries: () => [], getSessionName: () => undefined },
};

test("active account is right-aligned below provider/model while existing statuses stay left", () => {
  const snapshot: any = { accounts: [{ name: "codex-pro20", vendor: "codex", available: true }] };
  const lines = renderAccountFooter(ctx, footerData, theme, snapshot, "codex-pro20", 100);
  expect(lines).toHaveLength(3);
  expect(lines[1]).toContain("(openai-codex) gpt-5.6-sol • high");
  expect(lines[2]).toContain("\x1b[38;2;90;128;128mMCP 0/15\x1b[39m");
  expect(lines[2].replace(/\x1b\[[0-9;]*m/g, "")).toStartWith("MCP 0/15 ponytail: FULL");
  expect(lines[2]).toEndWith("OMS account: codex-pro20");
  expect(lines.every(line => visibleWidth(line) <= 100)).toBe(true);
});

test("account footer never guesses and reflects live risk markers", () => {
  expect(accountText(undefined, undefined, theme)).toContain("unbound");
  expect(accountText({ accounts: [{ name: "work", vendor: "codex", available: false, blocked: "x" }] }, "work", theme)).toContain("BLOCKED");
  expect(accountText({ accounts: [{ name: "work", vendor: "codex", available: false, stale: true }] }, "work", theme)).toContain("STALE");
});
