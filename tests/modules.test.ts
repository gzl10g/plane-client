import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { PlaneClient } from "../src/client.js";

function mockFetch(responses: Array<{ status: number; body: unknown }>) {
  const original = globalThis.fetch;
  const calls: { url: string; init: RequestInit }[] = [];
  let i = 0;
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init: init ?? {} });
    const r = responses[Math.min(i++, responses.length - 1)];
    return new Response(r.status === 204 ? null : JSON.stringify(r.body), { status: r.status, statusText: "OK" });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

describe("ModulesResource", () => {
  let client: PlaneClient;
  beforeEach(() => {
    client = new PlaneClient({ baseUrl: "https://plane.test", apiKey: "pk", workspace: "ws", retry: { maxRetries: 0 } });
  });

  it("list hits /modules/", async () => {
    const mock = mockFetch([{ status: 200, body: { results: [] } }]);
    try {
      await client.modules.list("p1");
      assert(mock.calls[0].url.includes("/projects/p1/modules/"));
    } finally { mock.restore(); }
  });

  it("get hits /modules/{id}/", async () => {
    const mock = mockFetch([{ status: 200, body: { id: "m1" } }]);
    try {
      await client.modules.get("p1", "m1");
      assert(mock.calls[0].url.includes("/modules/m1/"));
    } finally { mock.restore(); }
  });

  it("update sends PATCH with filtered body", async () => {
    const mock = mockFetch([{ status: 200, body: { id: "m1" } }]);
    try {
      await client.modules.update("p1", "m1", { description: "prompt" });
      assert.equal(mock.calls[0].init.method, "PATCH");
      const body = JSON.parse(mock.calls[0].init.body as string);
      assert.equal(body.description, "prompt");
    } finally { mock.restore(); }
  });

  it("workItems hits /modules/{id}/module-issues/", async () => {
    const mock = mockFetch([{ status: 200, body: { results: [] } }]);
    try {
      await client.modules.workItems("p1", "m1");
      assert(mock.calls[0].url.includes("/modules/m1/module-issues/"));
    } finally { mock.restore(); }
  });

  it("addWorkItems sends POST with work_items array", async () => {
    const mock = mockFetch([{ status: 200, body: {} }]);
    try {
      await client.modules.addWorkItems("p1", "m1", ["wi-1", "wi-2"]);
      assert.equal(mock.calls[0].init.method, "POST");
      const body = JSON.parse(mock.calls[0].init.body as string);
      assert.deepEqual(body.issues, ["wi-1", "wi-2"]);
    } finally { mock.restore(); }
  });

  it("removeWorkItem sends DELETE to /module-issues/{id}/", async () => {
    const mock = mockFetch([{ status: 204, body: null }]);
    try {
      await client.modules.removeWorkItem("p1", "m1", "wi-1");
      assert(mock.calls[0].url.includes("/projects/p1/modules/m1/module-issues/wi-1/"));
      assert.equal(mock.calls[0].init.method, "DELETE");
    } finally { mock.restore(); }
  });
});
