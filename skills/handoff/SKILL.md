---
description: Carry the current work into a session on a different account. Use when the user is about to switch accounts, has hit or is near a usage limit, or asks to continue this work somewhere else, on another account, or on the other vendor.
---

A session cannot actually move between accounts. Its transcript is written with the
account that owns it, and codex and claude do not share a transcript format at all. So
what moves is a **brief**, which you write, and which becomes the first prompt of the
next session.

## Writing it

Write for an agent starting cold in the same repository with none of this conversation.
Keep it under roughly 400 words and cover only:

- **Goal** — what the user is actually trying to get done, not a recap of what happened.
- **State** — what is already done and verified, what is in progress, anything committed
  or pushed.
- **Next** — the immediate next action, concretely.
- **Watch out** — decisions already made and settled, approaches already ruled out and
  why, and any constraint that is not obvious from the code.

Name real files with paths. Do not include secrets, tokens, or anything you would not
put in a commit message — this is written to a plain file at `~/.oms/handoff.md`.

Save it by piping, so the text never has to survive shell quoting:

```bash
cat <<'BRIEF' | oms handoff -
...your brief...
BRIEF
```

## Then

Run `oms status` and say which account has room. Give the user the line to run and let
them run it — launching replaces the running process, so never run it yourself:

    oms run <account> --handoff
    oms auto codex --handoff

The brief stays until replaced, so it can be reused if the first switch does not take.
`oms handoff` prints it, `oms handoff --clear` removes it.
