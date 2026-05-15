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

describe("IntakeResource", () => {
  let client: PlaneClient;
  beforeEach(() => {
    client = new PlaneClient({ baseUrl: "https://plane.test", apiKey: "pk", workspace: "ws", retry: { maxRetries: 0 } });
  });

  it("list returns Page", async () => {
    const mock = mockFetch([{ status: 200, body: { results: [{ id: "i1" }], next_page_results: false } }]);
    try {
      const page = await client.intake.list("p1");
      assert.equal(page.items.length, 1);
      assert.equal(page.hasNext, false);
    } finally { mock.restore(); }
  });

  it("list passes pagination params", async () => {
    const mock = mockFetch([{ status: 200, body: { results: [] } }]);
    try {
      await client.intake.list("p1", { perPage: 10, cursor: "abc" });
      const url = mock.calls[0].url;
      assert(url.includes("per_page=10"));
      assert(url.includes("cursor=abc"));
    } finally { mock.restore(); }
  });

  it("create wraps body in { issue: {...} }", async () => {
    const mock = mockFetch([{ status: 200, body: { id: "i1" } }]);
    try {
      await client.intake.create("p1", { name: "Bug report", priority: "high" });
      assert.equal(mock.calls[0].init.method, "POST");
      const body = JSON.parse(mock.calls[0].init.body as string);
      assert.equal(body.issue.name, "Bug report");
      assert.equal(body.issue.priority, "high");
    } finally { mock.restore(); }
  });

  it("accept sends PATCH with status 1", async () => {
    const mock = mockFetch([{ status: 200, body: {} }]);
    try {
      await client.intake.accept("p1", "intake-1");
      assert.equal(mock.calls[0].init.method, "PATCH");
      const body = JSON.parse(mock.calls[0].init.body as string);
      assert.equal(body.status, 1);
    } finally { mock.restore(); }
  });

  it("decline sends PATCH with status -1", async () => {
    const mock = mockFetch([{ status: 200, body: {} }]);
    try {
      await client.intake.decline("p1", "intake-1");
      const body = JSON.parse(mock.calls[0].init.body as string);
      assert.equal(body.status, -1);
    } finally { mock.restore(); }
  });
});
