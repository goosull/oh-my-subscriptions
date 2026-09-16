export interface Binding { account: string; provider: "openai-codex" | "claude-bridge"; model: string }
export interface Snapshot { accounts: { name: string; vendor: string; available: boolean; blocked?: string | null; reason?: string; stale?: boolean }[] }
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
