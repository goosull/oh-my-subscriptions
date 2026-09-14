# What the transport actually does

Findings from reading `@oh-my-pi/pi-ai`'s sources, recorded because they change design
decisions and are easy to rediscover the hard way.

## A tool call survives a handoff. Thinking does not.

Tool-call ids pass through verbatim (`tool_use_id: msg.toolCallId`), and a provider only
checks that a result pairs with a call earlier in the same request, not what the id looks
like. Our transcript carries the call and its result together, so the pairing is intact
whoever produced it.

Thinking is a different matter. `providers/anthropic.ts` documents two rejection shapes
for "a replayed **unsigned** thinking block", and recovers by logging *"signing proxy
detected (thinking signature rejected), demoting unsigned thinking and retrying"* — a
wasted round trip, after which the thinking is dropped anyway. A *signed* block fares no
better across a rewrite: `THINKING_PREFIX_BINDING_PATTERN` catches "bound to a different
conversation", so a signature is tied to the exact prefix it was produced under.

**Consequence:** thinking cannot be handed between engines, and sending it anyway costs a
failed request. `src/types.ts` carries no thinking block at all, which sidesteps this by
construction — at the price of losing reasoning continuity across a switch. That is a
real cost of routing, alongside the re-sent context `cost.ts` measures.

## The Anthropic OAuth path impersonates Claude Code

`providers/claude-code-fingerprint.ts` is explicit about it:

```ts
/** Current Claude Code CLI version represented on the Anthropic wire. */
export const claudeCodeVersion = "2.1.257";
/** User-Agent emitted by Claude Code's CLI inference entrypoint. */
export const claudeCodeUserAgent = `claude-cli/${claudeCodeVersion} (external, cli)`;
/** Identity block prepended by Claude Code's CLI runtime. */
export const claudeCodeSystemInstruction = "You are Claude Code, Anthropic's official CLI for Claude.";
```

That is how a third-party tool reaches a Claude Pro/Max subscription: by presenting
itself on the wire as the first-party client. It is the same pattern Anthropic cut
OpenCode off for in January 2026. The codex path carries its own equivalent — an
attestation header alongside a pinned user agent.

**Consequence:** building on `pi-ai` and signing in with a subscription inherits this,
and the risk is not ours to control — an account can stop working for reasons that have
nothing to do with our code. API-key providers and local models do not go through it.

`src/wire.ts` exists partly for this. It is the only file that imports `pi-ai`, so which
transport we accept is one decision in one place rather than a commitment baked through
the whole program.
