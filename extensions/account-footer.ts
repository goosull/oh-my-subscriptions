import { homedir } from "node:os";
import { relative, resolve, sep, isAbsolute } from "node:path";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { approved, type Binding, type Snapshot } from "./routing.js";

interface FooterData {
  getGitBranch(): string | null;
  getExtensionStatuses(): ReadonlyMap<string, string>;
  getAvailableProviderCount(): number;
  onBranchChange(callback: () => void): () => void;
}
interface FooterTheme {
  fg(color: "dim" | "warning" | "error" | "success", text: string): string;
}
const formatTokens = (n: number) => n < 1000 ? `${n}` : n < 10_000 ? `${(n / 1000).toFixed(1)}k` : n < 1_000_000 ? `${Math.round(n / 1000)}k` : `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)}M`;
// Extension statuses already contain trusted Pi theme ANSI. Match Pi's built-in
// footer sanitizer: strip layout-breaking whitespace but preserve styling escapes.
const sanitizeStatus = (text: string) => text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
const sanitizePlain = (text: string) => text.replace(/[\x00-\x1f\x7f-\x9f]/g, " ").replace(/ +/g, " ").trim();
const homePath = (cwd: string) => {
  const home = process.env.HOME || process.env.USERPROFILE || homedir();
  const rel = relative(resolve(home), resolve(cwd));
  return rel === "" ? "~" : rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel) ? `~${sep}${rel}` : cwd;
};
const align = (left: string, right: string, width: number, theme: FooterTheme) => {
  const rightWidth = visibleWidth(right);
  if (rightWidth >= width) return truncateToWidth(right, width, "");
  const keptLeft = truncateToWidth(left, Math.max(0, width - rightWidth - 2), "…");
  return keptLeft + " ".repeat(Math.max(2, width - visibleWidth(keptLeft) - rightWidth)) + right;
};

const until = (timestamp?: number) => {
  if (!timestamp) return "reset ?";
  const seconds = Math.max(0, Math.floor(timestamp - Date.now() / 1000));
  if (seconds === 0) return "now";
  if (seconds >= 86400) return `${Math.floor(seconds / 86400)}d ${Math.floor(seconds % 86400 / 3600)}h`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m`;
};
const accountUsage = (snapshot: Snapshot | undefined, name: string) => {
  const account = snapshot?.accounts.find(a => a.name === name);
  if (!account) return { text: `${sanitizePlain(name)} (?)`, color: "warning" as const };
  if (account.reason || account.used_percent == null) return { text: `${sanitizePlain(name)} (usage unknown)`, color: "warning" as const };
  const percent = `${account.floor ? "≥" : ""}${account.stale ? "~" : ""}${account.used_percent.toFixed(0)}% used`;
  const suffix = account.blocked ? ", BLOCKED" : account.stale ? ", STALE" : "";
  return { text: `${sanitizePlain(name)} (${percent} ${until(account.resets_at)}${suffix})`,
    color: account.blocked ? "error" as const : account.stale ? "warning" as const : "success" as const };
};

export function accountText(snapshot: Snapshot | undefined, active: string | undefined, theme: FooterTheme): string {
  if (!active) return theme.fg("warning", "Current Account: unbound");
  const value = accountUsage(snapshot, active);
  return theme.fg(value.color, `Current Account: ${value.text}`);
}

export function nextAccountText(snapshot: Snapshot | undefined, routes: Binding[], active: string | undefined, theme: FooterTheme): string {
  const safe = snapshot && approved(snapshot, routes).find(route => route.account !== active);
  // If nothing is currently safe, still show the next configured route and why it
  // cannot be selected instead of the ambiguous "none available".
  const next = safe ?? snapshot?.accounts.flatMap(account => routes.filter(route => route.account === account.name))
    .find(route => route.account !== active);
  if (!next) return theme.fg("dim", "Next Account: none configured");
  const value = accountUsage(snapshot, next.account);
  return theme.fg(value.color === "success" ? "dim" : value.color, `Next Account: ${value.text}`);
}

export function renderAccountFooter(
  ctx: ExtensionContext,
  footerData: FooterData,
  theme: FooterTheme,
  snapshot: Snapshot | undefined,
  active: string | undefined,
  routes: Binding[],
  width: number,
): string[] {
  let input = 0, output = 0, cacheRead = 0, cacheWrite = 0, cost = 0;
  for (const entry of ctx.sessionManager.getEntries()) {
    const usage = entry.type === "message" && (entry.message.role === "assistant" || entry.message.role === "toolResult")
      ? entry.message.usage : (entry.type === "branch_summary" || entry.type === "compaction") ? entry.usage : undefined;
    if (!usage) continue;
    input += usage.input; output += usage.output; cacheRead += usage.cacheRead; cacheWrite += usage.cacheWrite; cost += usage.cost.total;
  }
  const branch = footerData.getGitBranch();
  const name = ctx.sessionManager.getSessionName();
  const pwd = `${homePath(ctx.cwd)}${branch ? ` (${branch})` : ""}${name ? ` • ${name}` : ""}`;
  const usage = ctx.getContextUsage();
  const percent = usage?.percent == null ? "?" : usage.percent.toFixed(1);
  const stats = [input ? `↑${formatTokens(input)}` : "", output ? `↓${formatTokens(output)}` : "",
    cacheRead ? `R${formatTokens(cacheRead)}` : "", cacheWrite ? `W${formatTokens(cacheWrite)}` : "",
    `$${cost.toFixed(3)}${ctx.model && ["openai-codex", "claude-bridge", "kimi-coding"].includes(ctx.model.provider) ? " (sub)" : ""}`,
    `${percent}%/${formatTokens(usage?.contextWindow ?? ctx.model?.contextWindow ?? 0)}`].filter(Boolean).join(" ");
  const model = ctx.model ? `${footerData.getAvailableProviderCount() > 1 ? `(${ctx.model.provider}) ` : ""}${ctx.model.id}${ctx.model.reasoning ? ` • ${ctx.thinkingLevel ?? "off"}` : ""}` : "no-model";
  const statuses = [...footerData.getExtensionStatuses()].filter(([key]) => key !== "oms" && key !== "oms-usage")
    .sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => sanitizeStatus(value)).join(" ");
  return [
    truncateToWidth(theme.fg("dim", pwd), width, theme.fg("dim", "...")),
    align(theme.fg("dim", stats), theme.fg("dim", model), width, theme),
    align(statuses, accountText(snapshot, active, theme), width, theme),
    align("", nextAccountText(snapshot, routes, active, theme), width, theme),
  ];
}
