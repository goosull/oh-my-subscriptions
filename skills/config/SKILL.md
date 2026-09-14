---
description: Change an account's settings - the model, reasoning effort or context window it launches with, its billing threshold, or how big its plan is. Use when the user wants a specific account to run a particular model or effort level, or wants different settings per account.
---

Run `oms config` first. It shows every setting, global and per account, and ends each
account with the exact command that account will launch as.

## Changing anything

`oms set` is the only thing that writes a setting:

```bash
oms set all effort=high            # every account, in each provider's own spelling
oms set <account> model=<model>
oms set block_at=90                # global
oms set <account> size=            # an empty value clears a key
```

Keys are canonical, not vendor flags — oms translates. `effort=high` becomes
`--effort high` for claude and `-c model_reasoning_effort="high"` for codex. A key the
provider has no flag for is refused when you set it, rather than silently ignored later.

| per account | |
|---|---|
| `model` | that provider's own model name |
| `effort` | `low` `medium` `high` `xhigh` `max`, and `minimal` on codex |
| `context` | context window in tokens, where the provider takes one |
| `size` | how big the plan's pool is, for ordering and for percentages |
| `resets_on` | day of month the plan's credits reset |
| `paid_overflow` | `yes` if hitting the ceiling on this account is charged |
| `block_at` | override the global threshold for this account |
| `args` | extra vendor flags, appended raw, for anything not covered |

| global | |
|---|---|
| `block_at` | percentage at which an account that can bill is refused |
| `warn_at` | percentage at which the hook offers a handoff |
| `priority` | explicit pick order |

## Notes

- Settings apply at launch, so a change affects the **next** session, not the running one.
- Anything typed at the call site comes after, so `oms run x -m other` beats a stored model.
- Never guess an account name. Run `oms status` and match it to a real one first.
- If unsure a model or flag exists, say so rather than storing one that fails at launch.
- To rename an account, use the `oms:rename` skill.
