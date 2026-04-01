import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { PlaneClient } from "../src/client.js";
import { PlaneApiError } from "../src/error.js";

function mockFetch(responses: Array<{ status: number; body: unknown }>) {
  const original = globalThis.fetch;
  const calls: { url: string; init: RequestInit }[] = [];
  let callIndex = 0;
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init: init ?? {} });
    const r = responses[Math.min(callIndex++, responses.length - 1)];
    return new Response(
      r.status === 204 ? null : JSON.stringify(r.body),
      { status: r.status, statusText: r.status === 200 ? "OK" : "Error" },
    );
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

describe("PlaneClient", () => {
  let client: PlaneClient;

  beforeEach(() => {
    client = new PlaneClient({
      baseUrl: "https://plane.example.com",
      apiKey: "pk_test",
      workspace: "test-ws",
      retry: { maxRetries: 0 },
    });
  });

  describe("request basics", () => {
    it("builds correct URL with workspace", async () => {
      const mock = mockFetch([{ status: 200, body: [] }]);
      try {
        await client.states.list("proj-123");
        assert.equal(mock.calls.length, 1);
        assert(mock.calls[0].url.includes("/api/v1/workspaces/test-ws/projects/proj-123/states/"));
      } finally { mock.restore(); }
    });

    it("adds trailing slash", async () => {
      const mock = mockFetch([{ status: 200, body: [] }]);
      try {
        await client.states.list("proj-123");
        const url = mock.calls[0].url;
        assert(url.endsWith("/") || url.includes("/?"), `URL should end with /: ${url}`);
      } finally { mock.restore(); }
    });

    it("sends X-API-Key header", async () => {
      const mock = mockFetch([{ status: 200, body: {} }]);
      try {
        await client.states.list("proj-123");
        const headers = mock.calls[0].init.headers as Record<string, string>;
        assert.equal(headers["X-API-Key"], "pk_test");
      } finally { mock.restore(); }
    });

    it("sends JSON body on POST", async () => {
      const mock = mockFetch([{ status: 200, body: { id: "new" } }]);
      try {
        await client.labels.create("proj-123", { name: "bug" });
        assert.equal(mock.calls[0].init.method, "POST");
        const body = JSON.parse(mock.calls[0].init.body as string);
        assert.equal(body.name, "bug");
      } finally { mock.restore(); }
    });
  });

  describe("error handling", () => {
    it("throws PlaneApiError on non-ok response", async () => {
      const mock = mockFetch([{ status: 400, body: "bad request" }]);
      try {
        await assert.rejects(
          () => client.states.list("proj-123"),
          (err: unknown) => {
            assert(err instanceof PlaneApiError);
            assert.equal(err.status, 400);
            return true;
          },
        );
      } finally { mock.restore(); }
    });

    it("returns empty array for 204 No Content on list", async () => {
      const mock = mockFetch([{ status: 204, body: null }]);
      try {
        const result = await client.states.list("proj-123");
        assert.deepEqual(result, []);
      } finally { mock.restore(); }
    });
  });

  describe("retry", () => {
    it("retries on 429 and succeeds", async () => {
      const mock = mockFetch([
        { status: 429, body: "rate limited" },
        { status: 200, body: [] },
      ]);
      try {
        const retryClient = new PlaneClient({
          baseUrl: "https://plane.test", apiKey: "pk", workspace: "ws",
          retry: { maxRetries: 1, retryOn: [429] },
        });
        await retryClient.states.list("p1");
        assert.equal(mock.calls.length, 2);
      } finally { mock.restore(); }
    });

    it("does not retry on 400", async () => {
      const mock = mockFetch([
        { status: 400, body: "bad" },
        { status: 200, body: [] },
      ]);
      try {
        await assert.rejects(() => client.states.list("p1"));
        assert.equal(mock.calls.length, 1);
      } finally { mock.restore(); }
    });
  });

  describe("hooks", () => {
    it("calls onRequest and onResponse", async () => {
      const mock = mockFetch([{ status: 200, body: [] }]);
      const requests: unknown[] = [];
      const responses: unknown[] = [];
      try {
        const hookedClient = new PlaneClient({
          baseUrl: "https://plane.test", apiKey: "pk", workspace: "ws",
          retry: { maxRetries: 0 },
          onRequest: (r) => requests.push(r),
          onResponse: (r) => responses.push(r),
        });
        await hookedClient.states.list("p1");
        assert.equal(requests.length, 1);
        assert.equal(responses.length, 1);
        assert.equal((responses[0] as { status: number }).status, 200);
        assert.equal(typeof (responses[0] as { durationMs: number }).durationMs, "number");
      } finally { mock.restore(); }
    });
  });
});
