// How the price of a switch grows with the conversation it interrupts.
//
// A provider's prompt cache is its own. Routing a request to an engine that has not seen
// the transcript means re-sending all of it at full price, so the cost of a switch is
// not fixed — it is whatever the conversation weighs at that moment.
import { run } from "./src/loop";
import { ledger } from "./src/types";
import type { Ask, Engine, Entry, Tool } from "./src/types";

const noop: Tool[] = [];

/** Replay a conversation of `turns` exchanges, switching engines at `switchAt`. */
async function measure(turns: number, switchAt: number | null) {
  let turn = 0;
  const loop = {
    system: ["x"], tools: noop,
    route: (_: Ask): Engine => ({ id: switchAt !== null && turn >= switchAt ? "b" : "a" }),
    open: (engine: Engine) => ({ engine, async *send() {} }),
  };
  const transcript: Entry[] = [];
  const book = ledger();          // one conversation, so one ledger across its turns
  for (let i = 0; i < turns; i++) {
    turn = i;
    // pad each exchange so the transcript grows the way a real one does
    transcript.push({ from: "tool", callId: `c${i}`, tool: "read", result: "x".repeat(2000) });
    for await (const _ of run(loop as any, transcript, `turn ${i}`, book)) { /* drain */ }
  }
  return book.cost;
}

console.log("switching once, at different points in a conversation:\n");
console.log("  turns  switch at  resent chars  share of everything sent");
for (const turns of [4, 8, 16]) {
  for (const at of [1, Math.floor(turns / 2), turns - 1]) {
    const c = await measure(turns, at);
    const share = c.sent ? ((c.resent / c.sent) * 100).toFixed(0) : "0";
    console.log(`  ${String(turns).padStart(5)}  ${String(at).padStart(9)}  ${String(c.resent).padStart(12)}  ${share.padStart(3)}%`);
  }
}