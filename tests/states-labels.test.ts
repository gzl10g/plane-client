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

// Ambos recursos devolvían `data.results` y descartaban el cursor. Con estados
// el precio es concreto: resolver el UUID de un estado por nombre devolvía "no
// existe" para un estado que sí está, solo que en la segunda página.
describe("StatesResource pagination", () => {
  let client: PlaneClient;
  beforeEach(() => {
    client = new PlaneClient({ baseUrl: "https://plane.test", apiKey: "pk", workspace: "ws", retry: { maxRetries: 0 } });
  });

  it("list walks every page", async () => {
    const mock = mockFetch([
      { status: 200, body: { results: [{ id: "s1", name: "Backlog" }], next_cursor: "100:1:0", next_page_results: true } },
      { status: 200, body: { results: [{ id: "s2", name: "Done" }], next_cursor: "100:2:0", next_page_results: false } },
    ]);
    try {
      const states = await client.states.list("p1");
      assert.deepEqual(states.map((s) => s.name), ["Backlog", "Done"]);
      assert.equal(mock.calls.length, 2);
    } finally { mock.restore(); }
  });

  it("list does not follow the cursor on the last page", async () => {
    const mock = mockFetch([
      { status: 200, body: { results: [{ id: "s1" }], next_cursor: "100:1:0", next_page_results: false } },
    ]);
    try {
      const passthrough = globalThis.fetch;
      globalThis.fetch = async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        if (mock.calls.length >= 3) throw new Error("pagination did not stop");
        return passthrough(input, init);
      };
      assert.equal((await client.states.list("p1")).length, 1);
      assert.equal(mock.calls.length, 1);
    } finally { mock.restore(); }
  });

  it("hits /states/ and survives an unpaginated array response", async () => {
    const mock = mockFetch([{ status: 200, body: [{ id: "s1" }] }]);
    try {
      const states = await client.states.list("p1");
      assert(mock.calls[0].url.includes("/projects/p1/states/"));
      assert.equal(states.length, 1);
    } finally { mock.restore(); }
  });
});

describe("LabelsResource pagination", () => {
  let client: PlaneClient;
  beforeEach(() => {
    client = new PlaneClient({ baseUrl: "https://plane.test", apiKey: "pk", workspace: "ws", retry: { maxRetries: 0 } });
  });

  it("list walks every page", async () => {
    const mock = mockFetch([
      { status: 200, body: { results: [{ id: "l1", name: "bug" }], next_cursor: "100:1:0", next_page_results: true } },
      { status: 200, body: { results: [{ id: "l2", name: "chore" }], next_cursor: "100:2:0", next_page_results: false } },
    ]);
    try {
      const labels = await client.labels.list("p1");
      assert.deepEqual(labels.map((l) => l.name), ["bug", "chore"]);
      assert.equal(mock.calls.length, 2);
    } finally { mock.restore(); }
  });

  it("list does not follow the cursor on the last page", async () => {
    const mock = mockFetch([
      { status: 200, body: { results: [{ id: "l1" }], next_cursor: "100:1:0", next_page_results: false } },
    ]);
    try {
      const passthrough = globalThis.fetch;
      globalThis.fetch = async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        if (mock.calls.length >= 3) throw new Error("pagination did not stop");
        return passthrough(input, init);
      };
      assert.equal((await client.labels.list("p1")).length, 1);
      assert.equal(mock.calls.length, 1);
    } finally { mock.restore(); }
  });

  it("create still POSTs to /labels/", async () => {
    const mock = mockFetch([{ status: 201, body: { id: "l1", name: "bug" } }]);
    try {
      await client.labels.create("p1", { name: "bug" });
      assert.equal(mock.calls[0].init.method, "POST");
      assert(mock.calls[0].url.includes("/projects/p1/labels/"));
    } finally { mock.restore(); }
  });
});
