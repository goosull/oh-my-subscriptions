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

## What is ours to write

The toolset. The system prompt. The permission model. What gets routed where, and how
little context it takes to do it — the part that made using someone else's agent
frustrating in the first place. And the one thing `oms` already does that no agent here
does: refusing to spend money you did not agree to spend.
