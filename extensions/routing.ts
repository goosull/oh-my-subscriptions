export interface Binding { account: string; provider: "openai-codex" | "claude-bridge"; model: string }
export interface Snapshot {
  usage_widget?: boolean; usage_display?: "status" | "widget" | "off";
  usage_refresh_seconds?: number; pi_auto?: boolean | null;
  accounts: { name: string; vendor: string; available: boolean; blocked?: string | null;
    reason?: string; stale?: boolean; age_seconds?: number; floor?: boolean; pays_on_overflow?: boolean;
    windows?: { window: string; used_percent: number }[] }[];
}

const clean = (text: string) => text.replace(/[\x00-\x1f\x7f-\x9f]/g, " ");

export function usageStatus(snapshot: Snapshot): string {
  if (!snapshot.accounts.length) return "OMS no accounts · /oms";
  return `OMS ${snapshot.accounts.map(a => {
    const hottest = [...(a.windows ?? [])].sort((x, y) => y.used_percent - x.used_percent)[0];
    const usage = a.reason ? "?" : hottest ? `${a.floor ? "≥" : ""}${hottest.used_percent.toFixed(0)}%` : "?";
    return `${a.blocked ? "!" : ""}${clean(a.name)} ${a.stale ? "~" : ""}${usage}`;
  }).join(" · ")} · /oms`;
}

export function usageLines(snapshot: Snapshot): string[] {
  if (!snapshot.accounts.length) return ["OMS · No accounts registered — run oms login <provider>"];
  return ["OMS · account usage (used %, not remaining) · /oms", ...snapshot.accounts.map(a => {
    const usage = a.reason ? clean(a.reason) : (a.windows ?? []).map(w =>
      `${clean(w.window)} ${a.floor ? ">=" : ""}${w.used_percent.toFixed(0)}%`).join(" · ") || "usage unknown";
    const age = a.age_seconds == null ? "" : ` · ${Math.max(0, Math.floor(a.age_seconds / 60))}m ago`;
    const billing = a.blocked ? " · BLOCKED" : a.pays_on_overflow ? " · paid overflow ON" : "";
    return `${clean(a.name)} (${clean(a.vendor)}) · ${usage}${age}${a.stale ? " · STALE" : ""}${billing}`;
  })];
}
export function bindings(value: unknown): Binding[] {
  if (!Array.isArray(value) || !value.length) throw new Error("OMS routes must be a nonempty array");
  const seen = new Set<string>();
  for (const r of value) {
    if (!r || typeof r.account !== "string" || !r.account.trim() || typeof r.model !== "string" || !r.model.trim() ||
      !["openai-codex", "claude-bridge"].includes(r.provider) || seen.has(r.provider)) {
      throw new Error("Use one explicit account/model binding per supported Pi provider");
    }
    seen.add(r.provider);
  }
  return value;
}
export function approved(snapshot: Snapshot, routes: Binding[]): Binding[] {
  if (!snapshot || !Array.isArray(snapshot.accounts)) throw new Error("Invalid OMS status");
  return snapshot.accounts.flatMap(a => routes.filter(r => r.account === a.name &&
    a.vendor === (r.provider === "claude-bridge" ? "claude" : "codex") &&
    a.available === true && !a.blocked && !a.reason && !a.stale));
}
