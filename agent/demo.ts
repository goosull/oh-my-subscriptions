// One turn, two engines, and the choice made on real subscriptions.
//
// The transport is mocked because this needs no account to run. The *decision* is not:
// `oms status --json` is asked which subscription has room and which would start
// charging, and the router picks on that. That split is deliberate — the routing is the
// part worth getting right, and it can be exercised long before a model is attached.
import { createMockModel } from "@oh-my-pi/pi-ai";
import { accounts, type Account } from "./oms";
import { run } from "./src/loop";
import type { Ask, Engine, Entry, Tool } from "./src/types";
import { sender } from "./src/wire";

const shell: Tool = {
  name: "shell",
  describe: "Run a shell command and return its output.",
  input: { type: "object", properties: { cmd: { type: "string" } }, required: ["cmd"] },
  async run({ cmd }: { cmd: string }) {
    const r = Bun.spawnSync(["bash", "-lc", cmd]);
    return { result: (r.stdout.toString() || r.stderr.toString()).trim() };
  },
};

const mocks: Record<string, any> = {
  legwork: createMockModel({
    id: "legwork", provider: "mock",
    responses: [{ content: [{ type: "toolCall", name: "shell", arguments: { cmd: "uname -s" } }] }],
  }),
  answer: createMockModel({
    id: "answer", provider: "mock",
    responses: [{ content: ["Darwin — the BSD-derived kernel macOS is built on."] }],
  }),
};

// Two roles. Legwork is repetitive and cheap; the answer is written once and matters.
type Role = "legwork" | "answer";
const roleFor = ({ since, step }: Ask): Role =>
  step === 0 || since.length === 0 ? "legwork" : "answer";

const spendable = accounts().filter(a => a.available);

/**
 * Back a role with a real subscription.
 *
 * Legwork goes to whatever has the most room and cannot bill. The answer prefers an
 * account that can bill, since it is one request and the good model is worth it — but
 * only one oms still considers safe, and it falls back rather than forcing it.
 */
function back(role: Role): Account | undefined {
  const free = spendable.filter(a => !a.pays_on_overflow);
  if (role === "legwork") return free[0] ?? spendable[0];
  return spendable.find(a => a.pays_on_overflow) ?? free[0];
}

const route = (ask: Ask): Engine => {
  const role = roleFor(ask);
  const acct = back(role);
  return { id: role, account: acct?.name };
};

if (!spendable.length) {
  console.log("no subscription has room right now — `oms status` says why");
  process.exit(0);
}

const loop = {
  system: ["Be terse."],
  tools: [shell],
  route,
  open: (engine: Engine) => sender(engine, mocks[engine.id].model, mocks[engine.id].stream),
};

const transcript: Entry[] = [];
for await (const ev of run(loop as any, transcript, "what kernel is this?")) {
  if (ev.at === "routed") {
    const a = spendable.find(x => x.name === ev.engine.account);
    const note = a ? `${a.used_percent?.toFixed(0)}% used, ${a.pays_on_overflow ? "can bill" : "cannot bill"}` : "no account";
    const cold = ev.sent.switched ? `  cold ${ev.sent.cold} ch` : "";
    console.log(`  step ${ev.step}  ${ev.engine.id.padEnd(8)} -> ${(ev.engine.account ?? "-").padEnd(12)} (${note})${cold}`);
  }
  if (ev.at === "call") console.log(`            ${ev.call.tool}(${JSON.stringify(ev.call.input)})`);
  if (ev.at === "result") console.log(`            => ${ev.result}`);
  if (ev.at === "text") console.log(`            "${ev.chunk}"`);
  if (ev.at === "turn_end") {
    const { sent, resent, switches } = ev.cost;
    const pct = sent ? ((resent / sent) * 100).toFixed(0) : "0";
    console.log(`\n  ${switches} switch(es). ${sent} characters sent, ${resent} of them (${pct}%) ` +
      `only because an engine had not seen them before.`);
  }
}
