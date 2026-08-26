import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { PlaneClient } from "../src/client.js";
import { attachModules } from "../src/resources/modules.js";

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

  it("delete sends DELETE to /modules/{id}/", async () => {
    const mock = mockFetch([{ status: 204, body: null }]);
    try {
      await client.modules.delete("p1", "m1");
      assert.equal(mock.calls[0].init.method, "DELETE");
      assert(mock.calls[0].url.includes("/projects/p1/modules/m1/"));
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

  // Client-side workaround for the Plane API v1 limitation where
  // expand=modules on work-item endpoints is accepted but never populated
  // (verified against Plane 1.4.1).
  describe("membershipMap", () => {
    it("walks every module's work items and builds an id -> modules map", async () => {
      const mock = mockFetch([
        { status: 200, body: { results: [{ id: "m1", name: "Module 1" }, { id: "m2", name: "Module 2" }] } },
        { status: 200, body: { results: [{ id: "wi1" }, { id: "wi2" }], next_page_results: false } },
        { status: 200, body: { results: [{ id: "wi2" }], next_page_results: false } },
      ]);
      try {
        const map = await client.modules.membershipMap("p1");

        assert.deepEqual(map.get("wi1")?.map((m) => m.id), ["m1"]);
        assert.deepEqual(map.get("wi2")?.map((m) => m.id), ["m1", "m2"]);
        assert.equal(map.get("wi3"), undefined);

        assert.equal(mock.calls.length, 3);
        assert(mock.calls[0].url.includes("/projects/p1/modules/"));
        assert(mock.calls[1].url.includes("/projects/p1/modules/m1/module-issues/"));
        assert(mock.calls[2].url.includes("/projects/p1/modules/m2/module-issues/"));
      } finally { mock.restore(); }
    });

    it("returns an empty map when the project has no modules", async () => {
      const mock = mockFetch([{ status: 200, body: { results: [] } }]);
      try {
        const map = await client.modules.membershipMap("p1");
        assert.equal(map.size, 0);
        assert.equal(mock.calls.length, 1);
      } finally { mock.restore(); }
    });
  });
});

describe("attachModules", () => {
  it("merges membership into items, defaulting to an empty array when absent", () => {
    const items = [{ id: "wi1", name: "A" }, { id: "wi2", name: "B" }];
    const membership = new Map([["wi1", [{ id: "m1", name: "Module 1" }]]]);

    const result = attachModules(items, membership);

    assert.deepEqual(result[0].modules, [{ id: "m1", name: "Module 1" }]);
    assert.deepEqual(result[1].modules, []);
  });

  it("does not mutate the input items", () => {
    const items = [{ id: "wi1", name: "A" }];
    attachModules(items, new Map([["wi1", [{ id: "m1", name: "Module 1" }]]]));
    assert.equal((items[0] as { modules?: unknown }).modules, undefined);
  });

});

describe("ModulesResource pagination", () => {
  let client: PlaneClient;
  beforeEach(() => {
    client = new PlaneClient({ baseUrl: "https://plane.test", apiKey: "pk", workspace: "ws", retry: { maxRetries: 0 } });
  });

  it("stops paginating when next_page_results is false, even though a cursor comes back", async () => {
    // membershipMap() walks workItemsAll() for every module, so this is the loop
    // behind `planec work-items list --with-modules`: infinite until the fix.
    const mock = mockFetch([
      { status: 200, body: { results: [{ id: "m1" }], next_cursor: "100:1:0", next_page_results: false } },
      { status: 200, body: { results: [], next_cursor: "100:2:0", next_page_results: false } },
    ]);
    try {
      // La válvula tiene que vivir en el fetch, no en el cuerpo del for-await:
      // con el bug, las páginas vuelven VACÍAS, así que el cuerpo del bucle no
      // se ejecuta nunca y un break ahí dentro no salva de nada — el test se
      // cuelga en vez de fallar, que es un peor testigo. Verificado: así fue.
      const passthrough = globalThis.fetch;
      globalThis.fetch = async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        if (mock.calls.length >= 3) {
          throw new Error(
            "pagination did not stop: the cursor was followed on a page with next_page_results: false",
          );
        }
        return passthrough(input, init);
      };
      const items: unknown[] = [];
      for await (const item of client.modules.workItemsAll("p1", "mod1")) items.push(item);
      assert.equal(items.length, 1);
      assert.equal(mock.calls.length, 1, "the last page must not be followed");
    } finally {
      mock.restore();
    }
  });
});
