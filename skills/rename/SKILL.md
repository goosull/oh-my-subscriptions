---
description: Rename an account. Use when the user wants to call an account something else, or the name no longer describes what the account actually is.
---

`oms rename <old> <new>` — it carries the account's recorded usage and, when oms created
the profile, its directory along with it, so the account does not go back to reading
"no data yet".

Run `oms status` first and match whatever the user called it to a real account name.
Never guess: renaming the wrong account is silent, because both names look equally valid.

If the user gave only the new name, or only gestured at which account ("the personal
one", "the work codex"), show them the list and ask which — do not pick for them.

Changing a name does not change the account, its login, or its flags. To change what an
account launches with, use the `oms:config` skill instead.
