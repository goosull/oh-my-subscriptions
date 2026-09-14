# agent

An agent whose loop is ours and whose transport is not.

```bash
bun install && bun run demo.ts
```

```
  step 0  legwork  -> codex-pro20  (60% used, cannot bill)
            shell({"cmd":"uname -s"})
            => Darwin
  step 1  answer   -> codex-work   (18% used, can bill)
            "Darwin — the BSD-derived kernel macOS is built on."
```

## The point

One turn, two engines. The cheap one does the tool-calling, the strong one writes the
answer, and the handover happens **inside** the turn.

That is the reason this loop is written rather than borrowed. Every agent loop on offer
takes one fixed model per run — `pi-agent-core`'s `agentLoop` has `model: Model` and no
per-request resolver anywhere in its config — so routing can only happen at turn
boundaries. `run()` asks the router again before **every** request:

```ts
route: ({ since, step }) =>
  step === 0 || since.length === 0 ? cheapEngine : strongEngine
```

The transport is mocked, so this runs with no account. The decision is not: `oms status
--json` is asked which subscription has room and which would start charging, and the
router picks on that. Repetitive legwork goes to a plan that cannot bill, and the one
request that matters is allowed onto a plan that can — but only while oms still calls it
safe, and it falls back rather than forcing it.

Splitting it that way is deliberate. Routing is the part worth getting right, and it can
be exercised long before a model is attached.

## Layout

| | |
|---|---|
| `src/types.ts` | our vocabulary. No vendor type appears in it |
| `src/loop.ts` | the loop. 73 lines, and knows nothing about any provider |
| `src/wire.ts` | the only file that imports `@oh-my-pi/pi-ai` |
| `src/../oms.ts` | reads `oms status --json` for what each account has left |

`pi-ai` is 109k lines of provider adapters, OAuth and wire formats — work that has
nothing to do with this idea and would never be worth repeating. It is behind `wire.ts`
and nothing above that line knows it is there. `pi-agent-core` was dropped once the loop
existed; the dependency list is one package.

## Not yet true

The demo drives mock engines, so it says nothing about what a real handover costs. Two
things only real providers can answer: whether tool-call ids, thinking signatures and
cache breakpoints survive being handed to another provider, and what re-sending a cold
prompt costs when the new engine has no warm cache. If routing burns more in re-sent
tokens than it saves, the idea needs a cheaper seam — that measurement comes first.
