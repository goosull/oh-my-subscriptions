// One turn, two engines. The cheap one does the legwork, the strong one writes the
// answer — and the handover happens *inside* the turn, not between turns.
import { createMockModel } from "@oh-my-pi/pi-ai";
import { run } from "./src/loop";
import type { Engine, Entry, Tool } from "./src/types";
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
  "cheap:legwork": createMockModel({
    id: "legwork", provider: "cheap",
    responses: [{ content: [{ type: "toolCall", name: "shell", arguments: { cmd: "uname -s" } }] }],
  }),
  "strong:answer": createMockModel({
    id: "answer", provider: "strong",
    responses: [{ content: ["Darwin — the BSD-derived kernel macOS is built on."] }],
  }),
};

const loop = {
  system: ["Be terse."],
  tools: [shell],
  // The decision, asked before every request. Step 0 has nothing to reason about yet,
  // so it goes cheap; once a tool has answered, the synthesis goes to the strong engine.
  route: ({ since, step }): Engine =>
    step === 0 || since.length === 0
      ? { id: "cheap:legwork", account: "codex-pro20" }
      : { id: "strong:answer", account: "codex-work" },
  open: (engine: Engine) => sender(engine, mocks[engine.id].model, mocks[engine.id].stream),
};

const transcript: Entry[] = [];
for await (const ev of run(loop as any, transcript, "what kernel is this?")) {
  if (ev.at === "routed") console.log(`  step ${ev.step} -> ${ev.engine.id}  (spends ${ev.engine.account})`);
  if (ev.at === "call") console.log(`         ${ev.call.tool}(${JSON.stringify(ev.call.input)})`);
  if (ev.at === "result") console.log(`         => ${ev.result}`);
  if (ev.at === "text") console.log(`         "${ev.chunk}"`);
}
console.log("\nengines in this single turn:",
  [...new Set(transcript.filter(e => e.from === "model").map((e: any) => e.by.id))].join(" -> "));
