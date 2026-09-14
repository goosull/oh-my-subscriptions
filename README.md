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

Install as a Claude Code plugin and `/oh-my-subscriptions:status` answers "which
account should I use?" in the middle of a session.

## Install

```bash
claude plugin marketplace add goosull/oh-my-subscriptions
claude plugin install oh-my-subscriptions@oh-my-subscriptions
```

Then register your accounts and turn on usage recording:

```bash
oms add claude-main claude --dir ~/.claude   # your existing login, reused in place
oms add claude-alt  claude --paid-overflow no
oms add codex-main  codex
oms install                                  # wires usage recording into settings.json
```

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
oms add <name> <claude|codex> [--dir PATH] [--paid-overflow yes|no]
oms install                          wire usage recording into ~/.claude/settings.json
oms status                           what every account has left
oms run [--force] <name> [args...]   launch one account
oms auto <claude|codex> [args...]    launch the freest account that can't bill you
oms env <name>                       print the export line for a shell
```

MIT.
