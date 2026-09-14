# agent

An agent of our own, assembled rather than written from scratch.

`spine.ts` is the smallest thing that runs: a user turn, a model, a tool that really
executes, its result fed back, and a closing turn. It uses a mock model, so it needs no
account and no network.

```bash
bun install
bun run spine.ts
```

## Why these packages

[oh-my-pi](https://github.com/can1357/oh-my-pi) publishes its internals as MIT packages,
so the expensive layers are already solved:

| | package |
|---|---|
| 60+ provider adapters, OAuth, credential vault, usage reporting | `@oh-my-pi/pi-ai` |
| agent loop, context management, compaction, tokenizer | `@oh-my-pi/pi-agent-core` |
| model catalog and discovery | `@oh-my-pi/pi-catalog` |
| differential-rendering terminal UI | `@oh-my-pi/pi-tui` |

Both packages ship their TypeScript sources, so the implementations are readable in
`node_modules` rather than guessed at.

## Routing inside one conversation

`route.ts` is the reason this project exists: one conversation, handled by more than one
provider, without starting over.

```
> what kernel is this?        routed to provider-a/cheap-1
> explain why that matters    routed to provider-b/deep-1

 user       what kernel is this?
 assistant  [provider-a] bash({"cmd":"uname -s"})
 toolResult Darwin
 assistant  [provider-a] Darwin.
 user       explain why that matters
 assistant  [provider-b] Darwin is the BSD-derived core under macOS.
```

The second provider reads the first one's tool call and its result as ordinary history.
That works because `pi-agent-core` keeps a provider-neutral transcript and each provider
converts it at send time, and because `Agent.setModel` swaps the model in place.

**What nobody supplies is the decision.** `agentLoop` takes one fixed model per run;
there is no per-turn resolver anywhere in the stack. `route()` is a regex stand-in for
now, and replacing it is the work: choosing per turn on the shape of the task, what each
account has left, and what a turn would cost.

Two things the mock cannot tell us, and real providers will: whether tool-call ids,
thinking signatures and cache breakpoints survive a handoff, and what a swap costs in
re-sent prompt tokens when the new provider has no warm cache.

## What is ours to write

The router above. The toolset. The system prompt. The permission model — and how little
context a turn needs, which is what made someone else's agent frustrating to begin with.
Plus the one thing `oms` already does that no agent here does: refusing to spend money
you did not agree to spend.
