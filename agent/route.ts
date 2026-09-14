// Routing inside one conversation.
//
// pi-agent-core keeps a provider-neutral transcript and converts it per provider at send
// time, and `Agent.setModel` swaps the model in place. So a conversation can change hands
// mid-context — that part is solved.
//
// What is not solved anywhere, and is the reason this project exists: deciding *which*
// provider should take the next turn. The loop takes one fixed model per run and no one
// supplies a per-turn resolver. `route()` below is where that decision lives.
import { createMockModel } from "@oh-my-pi/pi-ai";
import { Agent } from "@oh-my-pi/pi-agent-core";

const bash: any = {
  label: "bash", name: "bash",
  description: "Run a shell command and return its output.",
  parameters: { type: "object", properties: { cmd: { type: "string" } }, required: ["cmd"] },
  async execute(_id: string, p: { cmd: string }) {
    const r = Bun.spawnSync(["bash", "-lc", p.cmd]);
    return { content: [{ type: "text", text: (r.stdout.toString() || r.stderr.toString()).trim() }] };
  },
};

const cheap = createMockModel({
  id: "cheap-1", provider: "provider-a",
  responses: [{ content: [{ type: "toolCall", name: "bash", arguments: { cmd: "uname -s" } }] },
              { content: ["Darwin."] }],
});
const deep = createMockModel({
  id: "deep-1", provider: "provider-b",
  responses: [{ content: ["Darwin is the BSD-derived core under macOS."] }],
});

/** The whole point: pick who takes this turn. Today a stand-in, tomorrow the product. */
const route = (turn: string) => (/why|explain|design/i.test(turn) ? deep : cheap);

const agent = new Agent({ initialState: { tools: [bash], systemPrompt: ["You are terse."] } as any });

for (const turn of ["what kernel is this?", "explain why that matters"]) {
  const picked = route(turn);
  agent.setModel(picked.model);
  (agent as any).streamFn = picked.stream;
  console.log(`\n> ${turn}\n  routed to ${picked.model.provider}/${picked.model.id}`);
  await agent.prompt(turn);
}

const msgs = (agent as any).state.messages as any[];
console.log("\none conversation, handled by:",
  [...new Set(msgs.filter(m => m.role === "assistant").map(m => m.provider))].join(" -> "));
for (const m of msgs) {
  const body = Array.isArray(m.content)
    ? m.content.map((c: any) => c.type === "toolCall" ? `${c.name}(${JSON.stringify(c.arguments)})` : c.text).join(" ")
    : m.content;
  console.log(` ${String(m.role).padEnd(10)} ${m.provider ? `[${m.provider}] ` : ""}${body}`);
}
