---
description: Change an account's settings - the model, reasoning effort, or context window it launches with, or its name. Use when the user wants a specific account to use a particular model or effort level, wants different settings per account, or wants to rename an account.
---

Run `oms config` with no arguments first to see what each account currently launches with.

## Setting flags

`oms config <name> <flags...>` stores flags that are handed to that vendor's CLI on
every launch of that account. There is no translation layer — they are the vendor's own
flags, so anything it accepts works:

| | claude | codex |
|---|---|---|
| model | `--model opus` | `-m gpt-5.3-codex` |
| effort | `--effort high` | `-c model_reasoning_effort="high"` |
| anything else | any `claude` flag | `-c <key>=<value>` for any config key |

Setting flags **replaces** whatever was stored, so include every flag you want kept.
`oms config <name> --clear` removes them.

Check `claude --help` or `codex --help` before inventing a flag. If you are unsure a
flag exists, say so rather than storing something that will fail at launch.

## Renaming

`oms rename <old> <new>` — carries the account's recorded usage and its profile
directory along with it.

## Notes

- Flags apply at launch, so a change only affects the **next** session, not the running one.
- Anything typed at the call site comes after the stored flags, so `oms run x -m other`
  overrides a stored `-m`.
- Never guess an account name. Run `oms status` and match it to a real one first.
- Never run `oms run` or `oms auto` yourself; both replace the running process.
