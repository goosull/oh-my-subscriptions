import { expect, test } from "bun:test";
import extension from "../extensions/oms";

test("Pi entry uses bundled OMS read-only commands without a configured core", async () => {
  const oldOms = process.env.OMS_HOME;
  process.env.OMS_HOME = `/tmp/oms-pi-command-test-${process.pid}-${Date.now()}`;
  let handler: any;
  const calls: any[] = [], messages: any[] = [], notices: any[] = [];
  let code = 0;
  try {
  await extension({
    on() {},
    registerCommand(name: string, options: any) { expect(name).toBe("oms"); handler = options.handler; },
    async exec(...args: any[]) { calls.push(args); return { code, stdout: "status", stderr: "failed" }; },
    sendMessage(message: any) { messages.push(message); },
  } as any);
  const ctx = { mode:"print", ui: { notify: (...args: any[]) => notices.push(args) } };
  await handler("status", ctx);
  expect(calls[0][0]).toBe("python3");
  expect(calls[0][1][0]).toEndWith("/bin/oms");
  expect(calls[0][1][1]).toBe("status");
  expect(messages[0].content).toBe("status");
  await handler("run --force someone", ctx);
  expect(calls.length).toBe(1);
  expect(notices[0][1]).toBe("error");
  code = 1;
  await handler("priority", ctx);
  expect(messages.length).toBe(1);
  expect(notices[1]).toEqual(["failed", "error"]);
  } finally {
    if (oldOms === undefined) delete process.env.OMS_HOME; else process.env.OMS_HOME = oldOms;
  }
});
