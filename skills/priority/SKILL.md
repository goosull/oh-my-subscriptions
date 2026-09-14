---
description: Show or change the order oms picks accounts in, and explain why an account ranks where it does. Use when the user asks which account gets used first, wants to reorder or prioritize accounts, wants to save one for later, or asks why auto chose a particular account.
---

Run `oms priority` first and show the output. It prints the current order per vendor
with the reason for each position.

## Changing it

The user's wording maps to one of two things:

- **"use X before Y" / "save Z for later" / a specific order** → set it explicitly:
  `oms priority <name> <name> ...`. Accounts you leave out still get used, but only
  after every listed one. Confirm with the `oms priority` output afterwards.
- **"go back to normal" / "figure it out yourself"** → `oms priority --auto`.

Never guess a name. If the user names an account loosely ("the personal one", "work"),
run `oms status` and match it to a real account name before running anything.

## The automatic rule, if they ask why

Soonest reset first, then smallest pool. A window that refills often cannot be banked —
quota still in a 5-hour window when it resets is gone — so the shorter the reset
interval, the more urgent it is to spend. Among accounts resetting on the same cadence
the smaller pool goes first, since it runs out sooner and is worth less held back.

Pool size is not something oms can read: neither vendor reports an absolute quota, only
a percentage. It comes from `oms set <account> size=N`, any number comparable across the
user's own accounts. If they ask why two accounts on the same cadence are in the order
they are, check whether either has a size set before explaining.

This is about *order*, not safety. An account that could bill the user is skipped by the
paid-credit guard regardless of where it sits in the priority list.

## Applying it

Setting priority only affects `oms auto`. It does not switch the running session —
that needs a new one. Give the user the line and let them run it:

    oms auto codex

Never run `oms auto` or `oms run` yourself; both replace the running process.
