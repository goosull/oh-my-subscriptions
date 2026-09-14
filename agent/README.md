# agent

An agent whose loop is ours and whose transport is not.

```bash
bun install
bun run demo    # one turn, two engines, routed on real subscriptions
bun run cost    # what a switch costs, at different points in a conversation
bun test        # what the loop must not get wrong
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
| `src/loop.ts` | the loop. Short, and knows nothing about any provider |
| `src/wire.ts` | the only file that imports `@oh-my-pi/pi-ai` |
| `src/loop.test.ts` | what the loop must not get wrong |
| `oms.ts` | reads `oms status --json` for what each account has left |
| `demo.ts` | one turn, two engines, routed on real subscriptions |
| `cost.ts` | what a switch costs at different points in a conversation |

`pi-ai` is 109k lines of provider adapters, OAuth and wire formats — work that has
nothing to do with this idea and would never be worth repeating. It is behind `wire.ts`
and nothing above that line knows it is there. `pi-agent-core` was dropped once the loop
existed, so one package is all this runs on. TypeScript and its Bun types are the only
others, and they build nothing — they only check what is written here.

## What a switch costs

A provider's prompt cache is its own. Routing a request to an engine that has not seen
the transcript means re-sending all of it at full price, so a switch does not cost a
fixed amount — it costs whatever the conversation weighs at that moment. `cost.ts`
measures it:

```
  turns  switch at  resent chars  share of everything sent
      4          1          4225   20%
      4          3          8503   40%
     16          1          4225    1%
     16         15         34183   12%
```

Switching at the first turn costs the same whether the conversation runs to four turns
or sixteen. Switching at the fifteenth costs eight times as much, because by then there
is eight times as much history to re-send cold.

So the rule the router should follow is **early, not often**. Picking the right engine
before a conversation has accumulated anything is nearly free; changing your mind late
pays for the whole history. A design that swaps engines every other request would spend
more re-sending context than it saves on the cheaper model.

The loop keeps this count itself. `Ledger` tracks how much each engine has been shown,
every turn ends with what routing cost, and the router is handed the price before it
decides — because the router is what spends the money, and it was deciding blind.

Two numbers, because they are not the same: `priceOf(engine)` is everything that engine
would be sent uncached, which includes whatever is simply new since the last request and
which every engine pays alike. `penaltyOf(engine)` is what moving there costs *over
staying*, and that is the one a router decides on.

With a price in hand it can refuse:

```
short conversation
  step 1  answer   -> codex-work   (can bill)  cold 257 ch
  1 switch. 302 characters sent, 257 of them (85%) only because an engine had not seen them.

the same turn, later in the conversation
  step 1  legwork  -> codex-pro20  (cannot bill)
  0 switches. 12416 characters sent, 0 of them (0%) ...
```

Same router, same request. The second one declines the handoff because by then the
better model no longer covers what moving to it costs.

## Still not measured

Whether tool-call ids, thinking signatures and cache breakpoints survive being handed to
another provider. Only real providers can answer that, and it decides whether a mid-turn
handover is merely expensive or outright impossible for some pairs.
