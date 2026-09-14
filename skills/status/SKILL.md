---
description: Show what every configured Claude and Codex subscription has left, and which one to use next. Use when the user asks about their usage, quota, rate limit, remaining tokens, which account to use, or whether they are about to be charged.
---

Run `oms status` and show the user its output verbatim.

Then, in one or two lines, say which account to use next and why. The rules:

- An account marked `BLOCKED` must not be used. It can bill the user.
- `PAID OFF` means that plan simply stops at its ceiling and cannot charge — prefer burning those to the top.
- `AS OF` is staleness. A figure hours old is a hint, not a fact: usage only updates when that account is actually used.
- `! no data yet` means that account has never run under oms, not that it is empty.

To start work on a specific account the user must launch it themselves, because switching
accounts means starting a new session. Give them the exact line, do not try to run it:

    oms run <account>          # a specific account
    oms auto claude            # the freest account that cannot bill them

Never run `oms run` or `oms auto` yourself — both replace the running process.
