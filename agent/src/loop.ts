// The loop, ours.
//
// It is small, and it is small on purpose: ask the router who takes this request, send,
// run whatever tools came back, repeat. The one thing it does that borrowed loops do not
// is ask the router *again before every request* rather than once per turn. That is the
// seam the whole idea needs — a cheap engine can do the tool-calling and a strong one can
// write the answer, without the conversation restarting.
import type { Ask, Call, Engine, Entry, Event, Ledger, Router, Sent, Tool } from "./types";
import { ledger as newLedger } from "./types";
import type { Sender } from "./wire";

export interface Loop {
  system: string[];
  tools: Tool[];
  route: Router;
  /** Resolves a routing decision into something that can actually send. */
  open(engine: Engine): Sender | Promise<Sender>;
  /** Refuse to spin forever when a model keeps calling tools. */
  maxSteps?: number;
}

/** Size of a transcript as it goes on the wire. Characters, not tokens: the ratio of
 *  resent to sent is what the routing decision turns on, and that ratio survives
 *  whichever tokenizer a provider happens to use. */
/** Who answered last, so a new turn does not read as a switch when it is the same engine. */
function lastEngine(transcript: readonly Entry[]): string {
  for (let i = transcript.length - 1; i >= 0; i--) {
    const e = transcript[i];
    if (e.from === "model") return e.by.id;
  }
  return "";
}

function measure(transcript: readonly Entry[]): number {
  return transcript.reduce((n, e) => n + JSON.stringify(e).length, 0);
}

export async function* run(
  loop: Loop,
  transcript: Entry[],
  said: string,
  book: Ledger = newLedger(),
  signal?: AbortSignal,
): AsyncGenerator<Event, Entry[]> {
  transcript.push({ from: "user", text: said });
  yield { at: "turn_start" };

  let since: Entry[] = [];
  const limit = loop.maxSteps ?? 16;
  const { seen, cost } = book;
  let last = lastEngine(transcript);

  for (let step = 0; step < limit; step++) {
    const size = measure(transcript);
    const ask: Ask = {
      transcript, since, step, current: last || undefined,
      priceOf: id => size - Math.min(seen.get(id) ?? 0, size),
    };
    const engine = await loop.route(ask);
    const warm = seen.get(engine.id) ?? 0;
    const sent: Sent = { size, cold: size - Math.min(warm, size), switched: !!last && last !== engine.id };
    seen.set(engine.id, size);
    cost.sent += size;
    if (sent.switched || (!last && sent.cold && seen.size > 1)) {
      cost.switches++;
      cost.resent += sent.cold;
    }
    last = engine.id;
    yield { at: "routed", engine, step, sent };

    const sender = await loop.open(engine);
    let text = "";
    const calls: Call[] = [];
    for await (const piece of sender.send(loop.system, transcript, loop.tools, signal)) {
      if (piece.text) {
        text += piece.text;
        yield { at: "text", chunk: piece.text };
      }
      if (piece.call) {
        calls.push(piece.call);
        yield { at: "call", call: piece.call };
      }
    }
    transcript.push({ from: "model", by: engine, said: text, calls });

    if (!calls.length) break;

    since = [];
    for (const call of calls) {
      const tool = loop.tools.find(t => t.name === call.tool);
      const done = tool
        ? await tool.run(call.input, signal).catch(e => ({ result: String(e), failed: true }))
        : { result: `no such tool: ${call.tool}`, failed: true };
      const entry: Entry = {
        from: "tool", callId: call.id, tool: call.tool,
        result: done.result, failed: done.failed,
      };
      transcript.push(entry);
      since.push(entry);
      yield { at: "result", callId: call.id, result: done.result, failed: done.failed };
    }
  }

  yield { at: "turn_end", transcript, cost };
  return transcript;
}
