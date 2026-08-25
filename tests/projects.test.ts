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

describe("ProjectsResource", () => {
  let client: PlaneClient;
  beforeEach(() => {
    client = new PlaneClient({ baseUrl: "https://plane.test", apiKey: "pk", workspace: "ws", retry: { maxRetries: 0 } });
  });

  it("list hits the workspace-level /projects/", async () => {
    const mock = mockFetch([{ status: 200, body: { results: [] } }]);
    try {
      await client.projects.list();
      assert.equal(mock.calls[0].url, "https://plane.test/api/v1/workspaces/ws/projects/");
    } finally { mock.restore(); }
  });

  it("sends the API key as X-API-Key (case matters: X-Api-Key answers 403)", async () => {
    const mock = mockFetch([{ status: 200, body: { results: [] } }]);
    try {
      await client.projects.list();
      const headers = mock.calls[0].init.headers as Record<string, string>;
      assert.equal(headers["X-API-Key"], "pk");
    } finally { mock.restore(); }
  });

  it("normalises the response into a Page", async () => {
    const mock = mockFetch([{
      status: 200,
      body: {
        results: [{ id: "p1", name: "Homelab", identifier: "HL" }],
        total_count: 1,
        total_results: 1,
        next_cursor: "100:1:0",
        next_page_results: false,
      },
    }]);
    try {
      const page = await client.projects.list();
      assert.equal(page.items.length, 1);
      assert.equal(page.items[0].identifier, "HL");
      assert.equal(page.total, 1);
      assert.equal(page.hasNext, false);
      // next_cursor viene aunque no haya más páginas: no debe propagarse.
      assert.equal(page.nextCursor, undefined);
    } finally { mock.restore(); }
  });

  it("clamps perPage to the API maximum of 100", async () => {
    const mock = mockFetch([{ status: 200, body: { results: [] } }]);
    try {
      await client.projects.list({ perPage: 500 });
      assert(mock.calls[0].url.includes("per_page=100"));
    } finally { mock.restore(); }
  });

  it("passes the cursor through", async () => {
    const mock = mockFetch([{ status: 200, body: { results: [] } }]);
    try {
      await client.projects.list({ cursor: "3:1:0" });
      assert(mock.calls[0].url.includes("cursor=3%3A1%3A0"));
    } finally { mock.restore(); }
  });

  it("listAll walks every page and stops on the last one", async () => {
    const mock = mockFetch([
      { status: 200, body: { results: [{ id: "p1", name: "A", identifier: "A" }], next_cursor: "1:1:0", next_page_results: true } },
      { status: 200, body: { results: [{ id: "p2", name: "B", identifier: "B" }], next_cursor: "1:2:0", next_page_results: false } },
    ]);
    try {
      const seen: string[] = [];
      for await (const project of client.projects.listAll({ perPage: 1 })) seen.push(project.id);
      assert.deepEqual(seen, ["p1", "p2"]);
      assert.equal(mock.calls.length, 2);
    } finally { mock.restore(); }
  });

  it("returns an empty page when the API answers a bare array", async () => {
    const mock = mockFetch([{ status: 200, body: [] }]);
    try {
      const page = await client.projects.list();
      assert.deepEqual(page.items, []);
      assert.equal(page.hasNext, false);
    } finally { mock.restore(); }
  });
});
