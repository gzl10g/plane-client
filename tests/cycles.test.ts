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

  it("transfer sends POST with new_cycle_id", async () => {
    const mock = mockFetch([{ status: 200, body: {} }]);
    try {
      await client.cycles.transfer("p1", "c1", "c2");
      const body = JSON.parse(mock.calls[0].init.body as string);
      assert.equal(body.new_cycle_id, "c2");
      assert(mock.calls[0].url.includes("/cycles/c1/transfer/"));
    } finally { mock.restore(); }
  });
});
