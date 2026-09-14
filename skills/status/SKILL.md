---
description: Show what every configured subscription has left, and which account to use next. Use when the user asks about their usage, quota, rate limit, remaining credits, which account to use, or whether they are about to be charged.
---

Run `oms status` and show its output verbatim.

Then say, in a line or two, which account to reach for next and why. Reading the table:

- `BILLS?` says what happens when that plan reaches its ceiling.
  - `no` — it stops, and costs nothing. Burn these to the top.
  - `at risk` — paid overflow is on, so the ceiling is a charge rather than a stop.
  - `BLOCKED` — oms will not launch it. Do not suggest it.
- `USED` shows every window that plan has. A short window that resets today is worth
  spending now, because what is left in it when it resets is gone.
- `>=` marks a figure oms can only bound from below, not read. Treat it as a floor.
- `AS OF` is staleness. Codex answers live; a Claude figure only updates while Claude
  Code is running, so an old one is a hint, not a fact.
- `! no data yet` means the account has not run under oms yet, not that it is empty.

`oms auto <provider> --dry-run` names the account oms would pick and prints the exact
command, without launching anything. Prefer it over reasoning about the table yourself.

To change the order, use the `oms:priority` skill.

The user must launch a session themselves, since switching accounts means starting one.
Give them the line and let them run it:

    oms run <account>
    oms auto <provider>

Never run `oms run` or `oms auto` yourself — both replace the running process. `--dry-run`
is safe.
