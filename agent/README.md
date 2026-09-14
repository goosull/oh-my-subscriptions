# agent

An agent whose loop is ours and whose transport is not.

```bash
bun install && bun run demo.ts
```

```
  step 0 -> cheap:legwork  (spends codex-pro20)
         shell({"cmd":"uname -s"})
         => Darwin
  step 1 -> strong:answer  (spends codex-work)
         "Darwin — the BSD-derived kernel macOS is built on."

engines in this single turn: cheap:legwork -> strong:answer
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

Replacing that stand-in with a real decision — on the shape of the task, on what each
subscription has left, on what a turn would cost — is the work.

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
