// What the loop must not get wrong. `bun test`
//
// The ledger shipped once with a bug this file would have caught immediately: it lived
// inside run(), so it forgot between turns and reported every switch as free.
import { expect, test } from "bun:test";
import { run } from "./loop";
import { ledger } from "./types";
import type { Engine, Entry, Tool } from "./types";

const echo: Tool = {
  name: "echo", describe: "echo", input: { type: "object" },
  async run({ say }: { say: string }) { return { result: say }; },
};

/** A sender that says whatever the script hands it, one entry per request. */
const scripted = (script: ({ text?: string; call?: any } | undefined)[]) => {
  let i = 0;
  return (engine: Engine) => ({
    engine,
    async *send() { const s = script[i++]; if (s) yield s; },
  });
};

const drain = async (loop: any, transcript: Entry[], said: string, book?: any) => {
  const seen: any[] = [];
  for await (const ev of run(loop, transcript, said, book)) seen.push(ev);
  return seen;
};

test("a tool call is executed and its result returns to the transcript", async () => {
  const transcript: Entry[] = [];
  await drain({
    system: [], tools: [echo], route: (): Engine => ({ id: "a" }),
    open: scripted([{ call: { id: "1", tool: "echo", input: { say: "hi" } } }, { text: "done" }]),
  }, transcript, "go");

  expect(transcript.map(e => e.from)).toEqual(["user", "model", "tool", "model"]);
  expect((transcript[2] as any).result).toBe("hi");
  expect((transcript[3] as any).said).toBe("done");
});

test("a missing tool fails that call without killing the turn", async () => {
  const transcript: Entry[] = [];
  await drain({
    system: [], tools: [], route: (): Engine => ({ id: "a" }),
    open: scripted([{ call: { id: "1", tool: "nope", input: {} } }, { text: "recovered" }]),
  }, transcript, "go");

  expect((transcript[2] as any).failed).toBe(true);
  expect((transcript[3] as any).said).toBe("recovered");
});

test("a model that only ever calls tools is stopped", async () => {
  const transcript: Entry[] = [];
  await drain({
    system: [], tools: [echo], maxSteps: 3, route: (): Engine => ({ id: "a" }),
    open: (engine: Engine) => ({
      engine,
      async *send() { yield { call: { id: `${Math.random()}`, tool: "echo", input: { say: "x" } } }; },
    }),
  }, transcript, "go");

  expect(transcript.filter(e => e.from === "model")).toHaveLength(3);
});

test("staying on one engine costs nothing extra, however long the conversation", async () => {
  const transcript: Entry[] = [];
  const book = ledger();
  const loop = {
    system: [], tools: [], route: (): Engine => ({ id: "a" }),
    open: scripted([{ text: "1" }, { text: "2" }, { text: "3" }]),
  };
  for (const t of ["one", "two", "three"]) await drain(loop, transcript, t, book);

  expect(book.cost.switches).toBe(0);
  expect(book.cost.resent).toBe(0);
});

test("the ledger remembers across turns, so a second turn on the same engine is free", async () => {
  const transcript: Entry[] = [];
  const book = ledger();
  const loop = {
    system: [], tools: [], route: (): Engine => ({ id: "a" }),
    open: scripted([{ text: "1" }, { text: "2" }]),
  };
  await drain(loop, transcript, "one", book);
  const afterFirst = book.cost.sent;
  await drain(loop, transcript, "two", book);

  expect(book.cost.switches).toBe(0);              // the bug that shipped: this was 1
  expect(book.cost.sent).toBeGreaterThan(afterFirst);
});

test("switching bills the whole conversation the new engine has not seen", async () => {
  const transcript: Entry[] = [];
  const book = ledger();
  let which = "a";
  const loop = {
    system: [], tools: [], route: (): Engine => ({ id: which }),
    open: scripted([{ text: "1" }, { text: "2" }]),
  };
  await drain(loop, transcript, "one", book);
  which = "b";
  await drain(loop, transcript, "two", book);

  expect(book.cost.switches).toBe(1);
  expect(book.cost.resent).toBeGreaterThan(0);
});

test("the router is quoted what moving costs over staying", async () => {
  const quotes: Record<string, number>[] = [];
  const transcript: Entry[] = [];
  const book = ledger();
  const loop = {
    system: [], tools: [], open: scripted([{ text: "1" }, { text: "2" }]),
    route: (ask: any): Engine => {
      quotes.push({ priceA: ask.priceOf("a"), penaltyA: ask.penaltyOf("a"),
                    penaltyB: ask.penaltyOf("b") });
      return { id: "a" };
    },
  };
  await drain(loop, transcript, "one", book);
  await drain(loop, transcript, "two", book);

  // nothing to leave on the first request, so no move is penalised
  expect(quotes[0].penaltyA).toBe(0);
  expect(quotes[0].penaltyB).toBe(0);
  // by the second turn the new user message is uncached for everyone, "a" included,
  // so its raw price is not zero - but staying still costs nothing extra
  expect(quotes[1].priceA).toBeGreaterThan(0);
  expect(quotes[1].penaltyA).toBe(0);
  expect(quotes[1].penaltyB).toBeGreaterThan(0);
});
