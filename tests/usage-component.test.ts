import { expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { renderUsagePanel } from "../extensions/usage-component";

const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text } as any;
const snapshot: any = { accounts: [
  { name: "claude-work", vendor: "claude", available: false, blocked: "overage",
    windows: [{ window: "5h", used_percent: 0 }, { window: "7d", used_percent: 195 }] },
  { name: "codex-work", vendor: "codex", available: true,
    windows: [{ window: "7d", used_percent: 69 }] },
  { name: "codex-pro20", vendor: "codex", available: true,
    windows: [{ window: "7d", used_percent: 78 }] },
  { name: "kiro", vendor: "kiro", available: true, floor: true,
    windows: [{ window: "30d", used_percent: 0 }] },
] };

test("rich usage panel renders model context and aligned account window columns", () => {
  const lines = renderUsagePanel(snapshot, {
    model: "Claude Opus 5", thinking: "high", contextPercent: 24,
    contextWindow: 1_000_000, activeAccount: "claude-work",
  }, theme, 90);
  expect(lines[0]).toContain("Opus 5 high");
  expect(lines[0]).toContain("76% left of 1M");
  expect(lines[1]).toContain("claude-work !");
  expect(lines[1]).toContain("195%");
  expect(lines[2]).toContain("69%");
  expect(lines[4]).toContain("≥0%");
  expect(lines.every(line => visibleWidth(line) <= 90)).toBe(true);
});

test("rich usage panel stays within narrow terminal width", () => {
  const lines = renderUsagePanel(snapshot, {}, theme, 34);
  expect(lines).toHaveLength(1);
  expect(visibleWidth(lines[0])).toBeLessThanOrEqual(34);
});
