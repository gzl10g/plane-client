import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PagesResource } from "../src/resources/pages.js";
import { PlaneApiError } from "../src/error.js";
import type { RequestFn } from "../src/client.js";

function mockRequest(response: unknown, status = 200): { request: RequestFn; calls: Array<{ endpoint: string; options?: unknown }> } {
  const calls: Array<{ endpoint: string; options?: unknown }> = [];
  const request: RequestFn = async (endpoint, options) => {
    calls.push({ endpoint, options });
    if (status === 404) throw new PlaneApiError(404, "Not Found");
    if (status === 204) return undefined as never;
    return response as never;
  };
  return { request, calls };
}

describe("PagesResource", () => {
  it("list hits /projects/{id}/pages/", async () => {
    const { request, calls } = mockRequest({ results: [{ id: "pg1" }] });
    const pages = new PagesResource(request);
    const result = await pages.list("p1");
    assert.equal(calls[0].endpoint, "/projects/p1/pages/");
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "pg1");
  });

  it("list returns empty array when no results", async () => {
    const { request } = mockRequest({ results: [] });
    const pages = new PagesResource(request);
    const result = await pages.list("p1");
    assert.deepEqual(result, []);
  });

  it("get hits /projects/{id}/pages/{pageId}/", async () => {
    const { request, calls } = mockRequest({ id: "pg1", name: "Test" });
    const pages = new PagesResource(request);
    const page = await pages.get("p1", "pg1");
    assert.equal(calls[0].endpoint, "/projects/p1/pages/pg1/");
    assert.equal(page?.id, "pg1");
  });

  it("get returns null on 404", async () => {
    const { request } = mockRequest(null, 404);
    const pages = new PagesResource(request);
    const page = await pages.get("p1", "pg-missing");
    assert.equal(page, null);
  });

  it("create sends POST", async () => {
    const { request, calls } = mockRequest({ id: "pg2", name: "New" });
    const pages = new PagesResource(request);
    const page = await pages.create("p1", { name: "New" });
    assert.equal(calls[0].endpoint, "/projects/p1/pages/");
    assert.equal((calls[0].options as { method: string }).method, "POST");
    assert.equal(page.id, "pg2");
  });

  it("create filters undefined values from body", async () => {
    const { request, calls } = mockRequest({ id: "pg3", name: "Only name" });
    const pages = new PagesResource(request);
    await pages.create("p1", { name: "Only name", description_html: undefined });
    const body = (calls[0].options as { body: Record<string, unknown> }).body;
    assert(!("description_html" in body));
  });

  it("update sends PATCH", async () => {
    const { request, calls } = mockRequest({ id: "pg1", name: "Updated" });
    const pages = new PagesResource(request);
    const page = await pages.update("p1", "pg1", { name: "Updated" });
    assert.equal(calls[0].endpoint, "/projects/p1/pages/pg1/");
    assert.equal((calls[0].options as { method: string }).method, "PATCH");
    assert.equal(page.name, "Updated");
  });

  it("delete sends DELETE", async () => {
    const { request, calls } = mockRequest(null, 204);
    const pages = new PagesResource(request);
    await pages.delete("p1", "pg1");
    assert.equal(calls[0].endpoint, "/projects/p1/pages/pg1/");
    assert.equal((calls[0].options as { method: string }).method, "DELETE");
  });
});
