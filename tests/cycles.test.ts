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

describe("CyclesResource", () => {
  let client: PlaneClient;
  beforeEach(() => {
    client = new PlaneClient({ baseUrl: "https://plane.test", apiKey: "pk", workspace: "ws", retry: { maxRetries: 0 } });
  });

  it("list hits /cycles/", async () => {
    const mock = mockFetch([{ status: 200, body: { results: [] } }]);
    try {
      await client.cycles.list("p1");
      assert(mock.calls[0].url.includes("/projects/p1/cycles/"));
    } finally { mock.restore(); }
  });

  it("create sends POST with project_id in body", async () => {
    const mock = mockFetch([{ status: 200, body: { id: "c1" } }]);
    try {
      await client.cycles.create("p1", { name: "Sprint 1", start_date: "2026-04-01" });
      const body = JSON.parse(mock.calls[0].init.body as string);
      assert.equal(body.name, "Sprint 1");
      assert.equal(body.project_id, "p1");
    } finally { mock.restore(); }
  });

  it("update sends PATCH", async () => {
    const mock = mockFetch([{ status: 200, body: { id: "c1" } }]);
    try {
      await client.cycles.update("p1", "c1", { name: "Sprint 1 updated" });
      assert.equal(mock.calls[0].init.method, "PATCH");
    } finally { mock.restore(); }
  });

  it("delete sends DELETE to /cycles/{id}/", async () => {
    const mock = mockFetch([{ status: 204, body: null }]);
    try {
      await client.cycles.delete("p1", "c1");
      assert.equal(mock.calls[0].init.method, "DELETE");
      assert(mock.calls[0].url.includes("/projects/p1/cycles/c1/"));
    } finally { mock.restore(); }
  });

  it("archive sends POST to /archive/", async () => {
    const mock = mockFetch([{ status: 204, body: null }]);
    try {
      await client.cycles.archive("p1", "c1");
      assert.equal(mock.calls[0].init.method, "POST");
      assert(mock.calls[0].url.includes("/cycles/c1/archive/"));
    } finally { mock.restore(); }
  });

  it("workItems hits /cycles/{id}/cycle-issues/", async () => {
    const mock = mockFetch([{ status: 200, body: { results: [] } }]);
    try {
      await client.cycles.workItems("p1", "c1");
      assert(mock.calls[0].url.includes("/cycles/c1/cycle-issues/"));
    } finally { mock.restore(); }
  });

  it("addWorkItems sends POST with work_items", async () => {
    const mock = mockFetch([{ status: 200, body: {} }]);
    try {
      await client.cycles.addWorkItems("p1", "c1", ["wi-1"]);
      const body = JSON.parse(mock.calls[0].init.body as string);
      assert.deepEqual(body.issues, ["wi-1"]);
    } finally { mock.restore(); }
  });

  it("removeWorkItem sends DELETE", async () => {
    const mock = mockFetch([{ status: 204, body: null }]);
    try {
      await client.cycles.removeWorkItem("p1", "c1", "wi-1");
      assert.equal(mock.calls[0].init.method, "DELETE");
      assert(mock.calls[0].url.includes("/cycles/c1/cycle-issues/wi-1/"));
    } finally { mock.restore(); }
  });

  // Este test pinneaba `/transfer/`, una ruta que NUNCA existió: la API
  // respondía 404 "Page not found" a cada llamada desde que se escribió el
  // método. Mockear la respuesta y assertar solo el body no comprueba que el
  // endpoint exista — el test estaba defendiendo el bug, no cazándolo.
  // Verificado en vivo el 2026-08-27: POST .../transfer/ → 404;
  // POST .../transfer-issues/ → 400 "The old cycle is not completed yet",
  // o sea la ruta buena contestando con un error de negocio.
  it("transfer posts to transfer-issues, the path that actually exists", async () => {
    const mock = mockFetch([{ status: 200, body: {} }]);
    try {
      await client.cycles.transfer("p1", "c1", "c2");
      const body = JSON.parse(mock.calls[0].init.body as string);
      assert.equal(body.new_cycle_id, "c2");
      assert(mock.calls[0].url.includes("/cycles/c1/transfer-issues/"), mock.calls[0].url);
      assert(!mock.calls[0].url.includes("/transfer/"), "the 404 path must not come back");
    } finally { mock.restore(); }
  });

  it("stops paginating when next_page_results is false, even though a cursor comes back", async () => {
    // Same trap as /projects/ and /work-items/: the last page carries a cursor,
    // and workItemsAll() looped on it until the API answered 429.
    const mock = mockFetch([
      { status: 200, body: { results: [{ id: "c1" }], next_cursor: "100:1:0", next_page_results: false } },
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
      for await (const item of client.cycles.workItemsAll("p1", "cy1")) items.push(item);
      assert.equal(items.length, 1);
      assert.equal(mock.calls.length, 1, "the last page must not be followed");
    } finally {
      mock.restore();
    }
  });

  it("cycles list walks every page instead of stopping at the first", async () => {
    // El bug: `list()` devolvía la primera página y tiraba el cursor, así que un
    // proyecto por encima del tamaño de página respondía una lista corta sin
    // decir que lo era.
    const mock = mockFetch([
      { status: 200, body: { results: [{ id: "a1" }], next_cursor: "100:1:0", next_page_results: true } },
      { status: 200, body: { results: [{ id: "a2" }], next_cursor: "100:2:0", next_page_results: false } },
    ]);
    try {
      const items = await client.cycles.list("p1");
      assert.equal(items.length, 2);
      assert.deepEqual(items.map((i) => i.id), ["a1", "a2"]);
      assert.equal(mock.calls.length, 2);
    } finally { mock.restore(); }
  });

  it("cycles list does not follow the cursor the last page still carries", async () => {
    const mock = mockFetch([
      { status: 200, body: { results: [{ id: "a1" }], next_cursor: "100:1:0", next_page_results: false } },
    ]);
    try {
      const passthrough = globalThis.fetch;
      globalThis.fetch = async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        if (mock.calls.length >= 3) {
          throw new Error("pagination did not stop on next_page_results: false");
        }
        return passthrough(input, init);
      };
      const items = await client.cycles.list("p1");
      assert.equal(items.length, 1);
      assert.equal(mock.calls.length, 1, "the last page must not be followed");
    } finally { mock.restore(); }
  });
});
