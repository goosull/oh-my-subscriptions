// The accounts layer, borrowed rather than rebuilt.
//
// `oms status --json` already answers what every subscription has left, which accounts
// would bill you, and in what order they should be spent. It is a different language,
// which is fine: it is a process boundary, not a library one, and the policy stays in
// one place instead of drifting between two implementations.
export interface Account {
  name: string;
  vendor: string;
  bin: string;
  installed: boolean;
  flags: string[];
  available: boolean;
  /** Why this account must not be used. Null when it is fine. */
  blocked?: string | null;
  /** Set instead of `blocked` when usage could not be read at all. */
  reason?: string;
  plan?: string;
  used_percent?: number;
  windows?: { window: string; used_percent: number }[];
  resets_at?: number;
  /** True when hitting the ceiling on this account is charged rather than refused. */
  pays_on_overflow?: boolean;
}

/** Accounts in the order oms would spend them, safe ones first. Empty if oms is absent. */
export function accounts(vendor?: string): Account[] {
  const r = Bun.spawnSync(["oms", "status", "--json"]);
  if (!r.success) return [];
  const all: Account[] = JSON.parse(r.stdout.toString()).accounts;
  return all.filter(a => (!vendor || a.vendor === vendor) && a.installed);
}

/** The account to spend next, or undefined when every one of them would cost money. */
export function pick(vendor?: string): Account | undefined {
  return accounts(vendor).find(a => a.available);
}
