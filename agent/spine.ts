// The spine, and nothing else: one user turn, one tool, one loop, no credentials.
//
// This exists to answer one question — can an agent be assembled from pi-ai and
// pi-agent-core rather than written from scratch — and it answers yes. What it proves:
// the loop drives a model, the model calls a tool, the tool really runs, its result
// goes back into the transcript, and a second turn closes the conversation.
//
// A mock model stands in for a provider so this runs with no account and no network.
// Everything that makes an agent worth using - which model, which tools, what prompt,
// what it refuses to do - is deliberately absent. That is the part worth writing.
//
//   bun install && bun run spine.ts
import { createMockModel } from "@oh-my-pi/pi-ai";
import { agentLoop, defaultConvertToLlm } from "@oh-my-pi/pi-agent-core";

const bash: any = {
  label: "bash",
  name: "bash",
  description: "Run a shell command and return its output.",
  parameters: {
    type: "object",
    properties: { cmd: { type: "string", description: "command to run" } },
    required: ["cmd"],
  },
  async execute(_id: string, params: { cmd: string }) {
    const p = Bun.spawnSync(["bash", "-lc", params.cmd]);
    return { content: [{ type: "text", text: (p.stdout.toString() || p.stderr.toString()).trim() }] };
  },
};

const mock = createMockModel({
  responses: [
    { content: [{ type: "toolCall", name: "bash", arguments: { cmd: "echo hello from the tool" } }] },
    { content: ["done"] },
  ],
});

const stream = agentLoop(
  [{ role: "user", content: "run echo" } as any],
  { systemPrompt: ["You are a terse agent."], messages: [], tools: [bash] },
  { model: mock.model, convertToLlm: defaultConvertToLlm } as any,
  undefined,
  mock.stream,
);

for await (const ev of stream as any) {
  const extra = ev.type === "message_end" ? JSON.stringify(ev.message).slice(0, 260) : "";
  console.log("·", ev.type, extra);
}
console.log("\nmodel was called", mock.calls.length, "times");
