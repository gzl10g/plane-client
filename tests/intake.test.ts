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

  it("accept resolves the record id to the work item id, then PATCHes status 1", async () => {
    const mock = mockFetch([
      { status: 200, body: { results: [{ id: "rec-1", issue: "wi-9" }] } },
      { status: 200, body: {} },
    ]);
    try {
      await client.intake.accept("p1", "rec-1");
      // First call lists the queue to resolve the work item id
      assert(mock.calls[0].url.includes("/intake-issues/"));
      // Second call PATCHes the detail endpoint keyed by the work item id
      assert.equal(mock.calls[1].init.method, "PATCH");
      assert(mock.calls[1].url.includes("/intake-issues/wi-9/"));
      const body = JSON.parse(mock.calls[1].init.body as string);
      assert.equal(body.status, 1);
    } finally { mock.restore(); }
  });

  it("accept also works when given the work item id directly", async () => {
    const mock = mockFetch([
      { status: 200, body: { results: [{ id: "rec-1", issue: "wi-9" }] } },
      { status: 200, body: {} },
    ]);
    try {
      await client.intake.accept("p1", "wi-9");
      assert(mock.calls[1].url.includes("/intake-issues/wi-9/"));
    } finally { mock.restore(); }
  });

  it("decline resolves the id then PATCHes status -1", async () => {
    const mock = mockFetch([
      { status: 200, body: { results: [{ id: "rec-1", issue: "wi-9" }] } },
      { status: 200, body: {} },
    ]);
    try {
      await client.intake.decline("p1", "rec-1");
      assert.equal(mock.calls[1].init.method, "PATCH");
      assert(mock.calls[1].url.includes("/intake-issues/wi-9/"));
      const body = JSON.parse(mock.calls[1].init.body as string);
      assert.equal(body.status, -1);
    } finally { mock.restore(); }
  });

  it("resolveIssueId falls back to the given id when no match is found", async () => {
    const mock = mockFetch([
      { status: 200, body: { results: [{ id: "other", issue: "wi-other" }] } },
    ]);
    try {
      const resolved = await client.intake.resolveIssueId("p1", "unknown-id");
      assert.equal(resolved, "unknown-id");
    } finally { mock.restore(); }
  });
});
