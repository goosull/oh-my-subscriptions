import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectCore } from "../extensions/core-client";

test("Pi core client discovers models/accounts and selects an exact account", async () => {
  const dir = await mkdtemp(join(tmpdir(), "oms-core-client-"));
  await mkdir(join(dir, "core"));
  const token = "offline-core-token-with-at-least-32-characters";
  await writeFile(join(dir, "core", "facade.token"), token, { mode: 0o600 });
  let selected: any;
  const server = Bun.serve({ hostname:"127.0.0.1", port:0, fetch: async req => {
    if (req.headers.get("authorization") !== `Bearer ${token}`) return new Response("no", { status:401 });
    const path = new URL(req.url).pathname;
    if (path === "/v1/models") return Response.json({ data:[{ id:"model-a", owned_by:"provider-a" }] });
    if (path === "/v1/oms/accounts") return Response.json({ accounts:[{ name:"account-a", provider:"provider-a", disabled:false }] });
    if (path === "/v1/oms/account" && req.method === "PUT") { selected = await req.json(); return Response.json({ current_account:selected.account }); }
    return new Response("missing", { status:404 });
  } });
  const oldHome = process.env.OMS_HOME, oldUrl = process.env.OMS_CORE_URL;
  process.env.OMS_HOME = dir; process.env.OMS_CORE_URL = `${server.url}v1`;
  try {
    const client = await connectCore({} as any);
    expect(client).toBeDefined();
    expect(await client!.models()).toEqual([{ id:"model-a", provider:"provider-a" }]);
    expect((await client!.accounts())[0].name).toBe("account-a");
    await client!.select("account-a", "model-a");
    expect(selected).toEqual({ account:"account-a", model:"model-a" });
  } finally {
    server.stop(true);
    if (oldHome === undefined) delete process.env.OMS_HOME; else process.env.OMS_HOME = oldHome;
    if (oldUrl === undefined) delete process.env.OMS_CORE_URL; else process.env.OMS_CORE_URL = oldUrl;
    await rm(dir, { recursive:true, force:true });
  }
});
