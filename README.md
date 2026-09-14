# oh-my-subscriptions

One terminal, many AI subscriptions.

You pay for more than one Claude or Codex plan. Each has its own 5-hour and weekly
windows, and you have no idea which one has room left — so you burn one to zero,
get cut off mid-task, and on some plans quietly roll onto metered credit.

`oms` shows every plan's remaining headroom in one table, and refuses to launch an
account that could charge you.

```
$ oms status
ACCOUNT      VENDOR PLAN   USED                   RESETS    AS OF  PAID
claude-main  claude -      5h 24% / 7d 41%        2d 3h     4m     ON
claude-alt   claude -      5h 0% / 7d 12%         6d 1h     2d     OFF
codex-main   codex  pro    7d 50%                 4d 17h    1m     OFF

$ oms auto codex "fix the flaky test"
oms: codex-alt (8% used)
```

With the status line installed, every account stays visible while you work — the one
you're in with both its windows, the rest with their hottest one:

```
claude-main 5h ━━━───── 34%  7d ━━━━━━─ 88%  │  claude-alt 5h ━──── 12%  7d ━━─── 31%
codex-main 5h ━━━━━ 97%  7d ━━─── 40%
```

Every window is shown and labelled, so a number is never ambiguous about which quota
it describes. The status line cannot scroll, so rather than overrun and get truncated
it wraps at your terminal width (`COLUMNS`, which Claude Code sets for the script) and
stops after three rows, collapsing any remainder to `+N more` so a long account list
can never swallow the screen.

Green under 60%, amber above. **Red, with a leading `!`, means money and only money** —
a plan with no credit attached can sit at 99% without turning red, because it stops
rather than charges. The bar is drawn with a filled `━` and a lighter `─`, so it still
reads on a terminal with no colour.

Installed as a Claude Code plugin, two skills keep it out of the terminal:
`/oms:status` answers "which account should I use?" mid-session, and `/oms:priority`
shows or changes the order without you remembering flags.

## Install

```bash
claude plugin marketplace add goosull/oh-my-subscriptions
claude plugin install oms@oh-my-subscriptions
```

Then register your accounts and turn on usage recording:

```bash
oms add claude-main claude --dir ~/.claude   # an existing login, reused in place
oms login claude                             # a new one: log in first, name it after
oms login codex
oms install                                  # wires usage recording into settings.json
```

`oms login` logs in to a scratch profile and only asks what to call the account once
the login succeeds, so you never name an account you failed to log in to. Got the name
wrong anyway? `oms rename <old> <new>` moves its recorded usage along with it.

`oms install` sets `statusLine` in `~/.claude/settings.json`, chaining whatever status
line you already had. Restart Claude Code and the numbers start filling in.

## How it works

| | isolation | where the numbers come from |
|---|---|---|
| claude | `CLAUDE_CONFIG_DIR=<dir>` | `rate_limits` in the [statusLine stdin JSON](https://code.claude.com/docs/en/statusline) |
| codex | `CODEX_HOME=<dir>` | `rate_limits` in the session rollout files codex writes under that dir |

Both env vars are documented, supported configuration. **`oms` never calls a vendor
API, never reads or writes a credential, and never handles a token.** It reads a
documented extension point and files the vendors' own CLIs wrote on your disk, and
it launches the vendors' own CLIs to do the work.

Non-default claude profiles symlink `skills/ plugins/ agents/ commands/ settings.json
CLAUDE.md output-styles` back to `~/.claude`, so a second account isn't a bare install.

### The catch

Usage is only as fresh as the last time you actually used that account — that's what
the `AS OF` column is for. There is no supported way to poll a plan you aren't using,
and `oms` does not try to invent one.

Switching also happens at launch, not mid-session: a running CLI holds its own session.
`oms status` tells you when it's worth restarting somewhere else.

## Which account gets used first

A 5-hour window refills four or five times a day, so quota still sitting in it when the
window resets is gone — it cannot be banked. A weekly-only pool is a fixed budget worth
the same whenever it is spent. So `oms auto` drains short windows first and keeps
weekly-only accounts in reserve, preferring the most headroom within each group.

```
$ oms priority
priority: automatic - short windows first, then most headroom

  codex 1. codex-a         5h at 0%, expires on reset
  codex 2. codex-b         weekly pool, 51% used
```

Override it with an explicit order, `oms priority codex-b codex-a`, and go back with
`oms priority --auto`. Accounts you leave out still get used, just after every listed
one. Priority is only about order — an account that could bill you is skipped by the
guard below no matter where it sits.

## The paid-credit guard

An account is blocked when **paid overflow is on for it AND usage is at or above
`block_at` (default 95%)**.

- A plan with no credit attached can't charge you — it just stops at the ceiling.
  `oms` never blocks those, so you use the whole thing.
- A plan with credit attached *can* charge you the moment the window fills. That's
  what the guard is for. Codex reports its own credit balance; for Claude, set it
  yourself with `--paid-overflow yes|no`, since that flag is org-side.

`oms` also strips `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` from
the launched process, so a stray key in your shell can't silently convert plan usage
into metered usage.

Per-account override: `"block_at": N` in `~/.oms/config.json`. One-off: `oms run --force`.

## What this is not

It does not pool, share, or resell accounts, and it does not lift any account above
its own limits. Every account is one you signed up for, it logs in through the vendor's
own flow, and each plan's limit applies to it exactly as before. `oms` only tells you
which of your plans has room and keeps you from running one into paid overage.

Any account you register should be one you are entitled to use on your own terms. If an
account belongs to an employer or is billed to someone else, their policy governs it,
not this tool.

## Commands

```
oms login <claude|codex>             log in to a new account, then name it
oms add <name> <claude|codex> [--dir PATH] [--paid-overflow yes|no]
oms install                          wire usage recording into ~/.claude/settings.json
oms status                           what every account has left
oms run [--force] <name> [args...]   launch one account
oms auto <claude|codex> [args...]    launch the freest account that can't bill you
oms rename <old> <new>               rename an account, keeping its usage history
oms env <name>                       print the export line for a shell
```

MIT.
