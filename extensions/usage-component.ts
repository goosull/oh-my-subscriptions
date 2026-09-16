import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Snapshot } from "./routing.js";

export interface UsageHeader {
  model?: string;
  thinking?: string;
  contextPercent?: number | null;
  contextWindow?: number;
  activeAccount?: string;
}

interface UsageTheme {
  fg(color: "text" | "success" | "warning" | "error" | "muted" | "dim", text: string): string;
  bold(text: string): string;
}

const minutes = (label: string) => {
  const match = /^(\d+)([hd])$/.exec(label);
  return match ? Number(match[1]) * (match[2] === "d" ? 1440 : 60) : Number.MAX_SAFE_INTEGER;
};
const tokens = (value?: number) => !value ? "?" : value >= 1_000_000 ? `${value / 1_000_000}M` : `${Math.round(value / 1000)}K`;
const pad = (text: string, width: number) => text + " ".repeat(Math.max(0, width - visibleWidth(text)));
const bar = (percent: number, width: number, color: "success" | "warning" | "error", theme: UsageTheme) => {
  const filled = Math.max(0, Math.min(width, Math.round(percent / 100 * width)));
  return theme.fg(color, "━".repeat(filled)) + theme.fg("dim", "─".repeat(width - filled));
};

export function renderUsagePanel(snapshot: Snapshot, header: UsageHeader, theme: UsageTheme, width: number): string[] {
  if (width < 35) return [truncateToWidth(`OMS ${snapshot.accounts.map(a => `${a.name} ${a.windows?.[0]?.used_percent.toFixed(0) ?? "?"}%`).join(" · ")}`, width)];
  const lines: string[] = [];
  if (header.model) {
    const model = theme.bold(header.model.replace(/^Claude\s+/i, ""));
    const effort = header.thinking && header.thinking !== "off" ? ` ${header.thinking}` : "";
    const left = `${model}${effort}`;
    const used = header.contextPercent;
    if (used == null) lines.push(truncateToWidth(`${left}  ${theme.fg("dim", `ctx ? of ${tokens(header.contextWindow)}`)}`, width));
    else {
      const remaining = Math.max(0, 100 - used);
      const color = remaining < 15 ? "error" : remaining < 35 ? "warning" : "success";
      const right = `${theme.fg("dim", "ctx")} ${bar(remaining, 10, color, theme)} ${theme.fg(color, `${remaining.toFixed(0)}% left`)} ${theme.fg("dim", `of ${tokens(header.contextWindow)}`)}`;
      const gap = Math.max(2, width - visibleWidth(left) - visibleWidth(right));
      lines.push(truncateToWidth(`${left}${" ".repeat(gap)}${right}`, width));
    }
  }
  if (!snapshot.accounts.length) return [...lines, theme.fg("warning", "OMS: no accounts — run oms login <provider>")];

  const labels = [...new Set(snapshot.accounts.flatMap(a => (a.windows ?? []).map(w => w.window)))].sort((a, b) => minutes(a) - minutes(b));
  const nameWidth = Math.min(Math.max(...snapshot.accounts.map(a => a.name.length + (a.blocked ? 2 : 0))), Math.max(12, Math.floor(width / 3)));
  const available = Math.max(8, width - nameWidth - 2);
  const cellWidth = Math.max(8, Math.floor(available / Math.max(1, labels.length)));
  const barWidth = Math.max(2, cellWidth - 6);
  for (const account of snapshot.accounts) {
    const active = account.name === header.activeAccount;
    const marker = account.blocked ? " !" : account.stale ? " ~" : "";
    const rawName = truncateToWidth(`${account.name}${marker}`, nameWidth, "");
    const name = active ? theme.fg("success", theme.bold(rawName)) : account.blocked ? theme.fg("error", rawName) : theme.fg("muted", rawName);
    const cells = labels.map(label => {
      const win = account.windows?.find(w => w.window === label);
      if (!win) return " ".repeat(cellWidth);
      const color = account.blocked ? "error" : win.used_percent >= 60 ? "warning" : "success";
      const value = `${account.floor ? "≥" : ""}${win.used_percent.toFixed(0)}%`;
      return pad(`${bar(win.used_percent, barWidth, color, theme)} ${theme.fg(color, value)}`, cellWidth);
    }).join("");
    const fallback = account.reason ? theme.fg("dim", account.reason.replace(/[\x00-\x1f\x7f-\x9f]/g, " ")) : "";
    lines.push(truncateToWidth(`${pad(name, nameWidth)}  ${fallback || cells}`.trimEnd(), width));
  }
  return lines;
}
