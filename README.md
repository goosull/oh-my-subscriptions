# oh-my-subscriptions

One terminal, many AI subscriptions.

You pay for more than one coding plan. Each has its own windows and its own ceiling, and
you have no idea which one has room left — so you burn one to zero, get cut off
mid-task, and on the plans that allow it, quietly roll onto metered credit.

`oms status` shows every plan's remaining headroom in one table. `oms auto` launches
whichever has the most useful room left. And neither will touch an account that is about
to bill you.

```
$ oms status
ACCOUNT     VENDOR  PLAN  USED                              RESETS  AS OF  BILLS?
codex-main  codex   team  5h 18%  7d 11%  (142/5000 cr)     3h 2m   0m     at risk
codex-alt   codex   pro   7d 60%                            4d 15h  0m     no
kiro-1      kiro    -     30d >=2% (21/1000 cr, cli only)   16d 7h  0m     no

$ oms auto codex --dry-run
codex-main  5h 18%  7d 11%  (142/5000 cr)
$ codex -c model_reasoning_effort="high"
```

`ON PACE FOR` is where the window lands if the last few hours continue. Under 100% is
quota you are not going to get to spend; over means you run out before it resets. It
stays `-` until there are two readings far enough apart in the same window to draw a
line through — a projection from one sample is a guess with a decimal point on it.

`AS OF` says how old the reading is, and `stale` next to it means old enough that the
window could have moved underneath — a quarter of the window it describes, so 75 minutes
for a 5-hour one and a day and a half for a weekly one. A stale reading is not treated
as a small number; it is treated as no number. `oms auto` will not pick on one, and the
guard refuses a billable account rather than vouch for history. This is the state a
Claude account drifts into once you stop opening Claude Code, since that is the only
place its figure comes from.

`BILLS?` is what happens when a plan reaches its ceiling: `no` means it stops and costs
nothing, `at risk` means paid overflow is on so the ceiling is a charge, and `BLOCKED`
means `oms` will not launch it.

Other tools rotate accounts when one hits a wall. The point of this one is the wall it
will not let you walk through: a plan with paid overflow enabled does not stop at its
ceiling, it starts charging, and `oms` refuses to launch it before that happens.

This repository holds two things. `oms` is the tool below, and `agent/` is an agent
being built on what it knows — one conversation routed across several subscriptions,
which is what having them in one place is ultimately for. They are independent: `oms`
needs nothing from `agent/`.

## Install

One file, Python 3 standard library only, no dependencies:

```bash
curl -fsSL https://raw.githubusercontent.com/goosull/oh-my-subscriptions/main/bin/oms \
  -o ~/.local/bin/oms && chmod +x ~/.local/bin/oms
```

Then add your accounts. `oms login` installs the provider's CLI if it is missing, signs
you in, names the account and spends one throwaway turn so it reports usage right away:

```bash
oms login codex          # repeat for a second account on the same provider
oms login kiro my-kiro
oms status
```

### Optionally, inside Claude Code

The same repository is also a Claude Code plugin, which adds slash commands and the
status line. It is not required to use `oms`, and `oms` does not need Claude Code.

```bash
claude plugin marketplace add goosull/oh-my-subscriptions
claude plugin install oms@oh-my-subscriptions
oms install    # wires usage recording into ~/.claude/settings.json
```

`oms install` sets `statusLine` in `~/.claude/settings.json`, chaining whatever status
line you already had. It is also how a Claude account gets its usage numbers at all —
that figure comes from Claude Code and exists nowhere else.

With the status line installed, every account stays visible while you work — the one
you're in with both its windows, the rest with their hottest one:

```
Opus 5 high  ctx ▬▬▬▬▬▬──── 61% left of 1M
claude-main   ▬▬▬▬────  44% ▬▬──────  27%
claude-alt    ────────   0% ▬───────   8%
codex-main !                ▬▬▬▬▬▬▬▬  97%
kiro-1        kiro reports no usage
```

One account per row, one column per window ordered shortest first — so the column a
meter sits in says which window it is, and the labels that used to repeat against every
account are gone. An account with no short window leaves that column empty rather than
sliding into it. The account you are in is the bright one; `!` marks an account that
would bill you. An account with nothing to meter keeps its row and says why, so a
provider that reports no usage does not simply vanish from the list.

Every row starts with its name rather than with indentation, because Claude Code strips
leading whitespace from a status line and a leading marker column would collapse on
exactly the rows that lack a marker.

The first line is the session itself — model, reasoning effort, and context left. Every
bar fills in the direction of its number: account meters fill as quota is spent, the
context meter drains as context is used.

One account per row, one column per window, shortest first — so the column a meter
sits in says which window it is, and the labels that used to repeat against every
account are gone. An account with no short window leaves that column empty rather than
sliding into it. `▸` is where you are, `!` is an account that would bill you.

The first line is the session itself — model, reasoning effort, and context left. Every
bar fills in the direction of its number: account meters fill as quota is spent, the
context meter drains as context is used.

The first line is the session itself — model, reasoning effort, and context headroom —
so a model swap or a mid-session `/effort` change shows up immediately. Accounts sit
below it in a grid with columns that line up, laid out so a wrap never strands a lone
account on the last row.

Accounts appear in the order `oms auto` would pick them — the one you're in first, then
its own vendor's alternatives, so the next account to switch to is always the next chip.
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
`/oms:status` answers "which account should I use?" mid-session, `/oms:priority` shows
or changes the pick order, `/oms:config` sets an account's model or effort,
`/oms:rename` renames one, and `/oms:handoff` writes the brief that carries your work
to another account.


## Working on it

```bash
git config core.hooksPath .githooks   # once: refuses a commit the checks would fail
./bin/oms --selftest                  # the tool, including that the guard stops a launch
python3 .github/check-docs.py         # that nothing documents a command the CLI lacks
cd agent && bun test                  # the loop
```

The same checks run in CI. The hook exists because they found a red selftest after it
was already pushed, which is a broken branch and a second commit apologising for the
first.

## Providers

| | isolation | where the numbers come from |
|---|---|---|
| claude | `CLAUDE_CONFIG_DIR=<dir>` | `rate_limits` in the [statusLine stdin JSON](https://code.claude.com/docs/en/statusline) |
| codex | `CODEX_HOME=<dir>` | `account/rateLimits/read` over the JSON-RPC its `app-server` speaks |
| kiro | `KIRO_HOME=<dir>` — settings and sessions only | credits metered per turn in its session files — a floor |

Kiro is a partial fit and oms says so rather than pretending. `KIRO_HOME` moves its
settings and sessions, but not its login: the credential is a single machine-wide
keychain entry, and a brand new `KIRO_HOME` still reports the account already signed in.
So Kiro holds **one login at a time** — registering a second Kiro account warns that
logging into it signs the other out.

For codex that answers for an account you have not touched in days, and carries the
absolute credit allowance too, so `size` sets itself. Claude has no equivalent, so its
figure is only as fresh as its last session — which is what `AS OF` is for.

Kiro has no usage command — `user` is only login/logout/whoami, `profile` is for IdC
accounts, and the real balance lives server-side behind `kiro-cli dashboard`, which just
opens a browser. What it does leave on disk is the cost of each turn, in credits, so
`oms` sums those for the current billing period. That needs the plan's allowance and
reset day, which only you know:

```bash
oms set kiro size=1000 resets_on=1
```

The result is reported as `>=`, because it is a floor rather than a balance: it counts
only CLI turns made through this profile, so Kiro IDE and web spend is invisible to it,
and it goes stale if sessions are pruned. Clear `size` to stop tracking it at all.

A provider you have not installed is still a provider. `oms login kiro` offers to
install the CLI first and then logs you in:

```
$ oms login kiro kiro-1
installing kiro-cli
$ brew install --cask kiro-cli
```

It picks the first install route whose own tool is on your machine — Homebrew before
the curl script, for instance — and echoes the command before running it. You named the
provider, so installing its CLI is the prerequisite of what you asked for rather than a
surprise; `--no-install` refuses instead.

Naming the account up front logs straight into it, adopting one you already registered.
Leave the name off and oms asks once the login succeeds, so a failed login never leaves
a named half-account behind. `oms remove <name>` unregisters one, and `--purge` also
deletes the profile directory, but only ever one oms created itself.


All three environment variables are documented, supported configuration. **`oms` never calls a vendor
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

`oms auto` picks by **soonest reset first, then smallest pool.** A window that refills
often cannot be banked — quota still sitting in a 5-hour window when it resets is simply
gone — so the shorter the reset interval, the more urgent it is to spend. Among accounts
that reset on the same cadence, the smaller pool goes first: it runs out sooner and is
worth less held in reserve.

```
$ oms priority
priority: automatic - soonest reset first, then smallest pool

  codex 1. codex-main     resets every 5h, 0% used
  codex 2. codex-alt      resets every 7d, 56% used, pool 100
```

Pool size is whatever you set: `oms set codex-alt size=100`. It is any number you can
compare across your own accounts — oms cannot read it, because neither vendor reports an
absolute quota, only a percentage. An account with no size set sorts after ones that
have it.

Override the whole thing with an explicit order, `oms priority codex-alt codex-main`,
and go back with `oms priority --auto`. Accounts you leave out still get used, just
after every listed one. Priority is only about order — an account that could bill you is
skipped by the guard below no matter where it sits.

## When something stops working

Most of this is wiring into other programs — a status line path in Claude Code's
settings, a hook in a plugin, a CLI per provider — and each of those is built to fail
quietly, because a status line must not throw and a hook must not stand between you and
your prompt. Quiet failure needs somewhere loud to ask:

```
$ oms doctor
  ok    oms                    /Users/you/.local/bin/oms
  ok    on PATH                /Users/you/.local/bin/oms
  FAIL  status line            /gone/oms is gone - run `oms install`
  ok    codex-main             5h 27%  7d 12%  (142/5000 cr)
```

It exits non-zero when anything is unreachable, so it works in a script too.

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
oms login <provider> [<name>]        install if missing, log in, name it
oms add <name> <provider> [--dir PATH] [--paid-overflow yes|no]
oms remove <name> [--purge]          unregister an account
oms install                          wire usage recording into ~/.claude/settings.json
oms status                           what every account has left
oms run [--force] <name> [args...]   launch one account
oms auto <provider> [args...]        launch the freest account that can't bill you
oms rename <old> <new>               rename an account, keeping its usage history
oms env <name>                       print the export line for a shell
```

MIT.
