import { expect, test } from "bun:test";
import extension from "../extensions/oms";

test("Pi entry uses bundled OMS read-only commands, never credentials or providers", async () => {
  let handler: any;
  const calls: any[] = [], messages: any[] = [], notices: any[] = [];
  let code = 0;
  extension({
    on() {},
    registerCommand(name: string, options: any) { expect(name).toBe("oms"); handler = options.handler; },
    async exec(...args: any[]) { calls.push(args); return { code, stdout: "status", stderr: "failed" }; },
    sendMessage(message: any) { messages.push(message); },
  } as any);
  const ctx = { ui: { notify: (...args: any[]) => notices.push(args) } };
  await handler("", ctx);
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
});
