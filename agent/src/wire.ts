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

const toWire = (transcript: readonly Entry[]): any[] =>
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
      api: "mock",
      provider: e.by.id.split(":")[0],
      model: e.by.id,
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
        messages: toWire(transcript),
        tools: tools.map(t => ({ name: t.name, description: t.describe, parameters: t.input })),
      };
      const events = streamFn(model, context as any, { signal } as any);
      for await (const ev of events as any) {
        if (ev.type === "text_end") yield { text: ev.content };
        if (ev.type === "toolcall_end" || ev.type === "toolCall_end") {
          const c = ev.toolCall ?? ev.content;
          if (c) yield { call: { id: c.id, tool: c.name, input: c.arguments ?? {} } };
        }
      }
    },
  };
}
