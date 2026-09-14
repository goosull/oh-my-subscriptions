// The only file that knows pi-ai exists.
//
// Everything above this line speaks the vocabulary in types.ts. Everything below is
// somebody else's transport. Keeping the seam this narrow is what makes the engine
// layer replaceable later without the loop noticing.
import { stream } from "@oh-my-pi/pi-ai";
import type { Call, Engine, Entry, Tool } from "./types";

/** A resolved way to actually send a request. Engines are ids; this is the thing behind one. */
export interface Sender {
  engine: Engine;
  send(
    system: string[],
    transcript: readonly Entry[],
    tools: readonly Tool[],
    signal?: AbortSignal,
  ): AsyncGenerator<{ text?: string; call?: Call }, void>;
}

/**
 * Rebuild the transcript in the shape the vendor's client expects.
 *
 * An assistant message has to carry api/provider/model, and pi-ai's converters branch
 * on them. History produced by one engine and replayed to another therefore has to be
 * stamped with the engine it is being *sent to*, not the one that wrote it — otherwise
 * a codex transcript arrives at an anthropic converter labelled as codex and is read
 * through the wrong branch. Who actually said it is kept in our own `Entry.by`, which
 * is the record that matters.
 */
const toWire = (transcript: readonly Entry[], target: any): any[] =>
  transcript.map(e => {
    if (e.from === "user") return { role: "user", content: e.text };
    if (e.from === "tool")
      return {
        role: "toolResult",
        toolCallId: e.callId,
        toolName: e.tool,
        content: [{ type: "text", text: e.result }],
        isError: !!e.failed,
      };
    return {
      role: "assistant",
      content: [
        ...(e.said ? [{ type: "text", text: e.said }] : []),
        ...e.calls.map(c => ({ type: "toolCall", id: c.id, name: c.tool, arguments: c.input })),
      ],
      api: target.api,
      provider: target.provider,
      model: target.id,
      usage: EMPTY_USAGE,
      stopReason: "stop",
    };
  });

const EMPTY_USAGE = {
  input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/** Wrap any pi-ai model as a Sender. The model object never escapes this file. */
export function sender(engine: Engine, model: any, streamFn = stream): Sender {
  return {
    engine,
    async *send(system, transcript, tools, signal) {
      const context = {
        systemPrompt: system,
        messages: toWire(transcript, model),
        tools: tools.map(t => ({ name: t.name, description: t.describe, parameters: t.input })),
      };
      // The stream's own vocabulary, confirmed against what it emits rather than
      // guessed: text_start/text_delta/text_end and toolcall_start/_delta/_end, with
      // the finished call on `toolCall`. Only the _end events carry a complete value.
      const events = streamFn(model, context as any, { signal } as any);
      for await (const ev of events as any) {
        if (ev.type === "text_end") yield { text: ev.content };
        if (ev.type === "toolcall_end" && ev.toolCall) {
          const c = ev.toolCall;
          yield { call: { id: c.id, tool: c.name, input: c.arguments ?? {} } };
        }
      }
    },
  };
}
