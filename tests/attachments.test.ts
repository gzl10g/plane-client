import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { AttachmentsResource } from "../src/resources/attachments.js";
import { PlaneApiError } from "../src/error.js";
import type { RequestFn } from "../src/client.js";

function mockRequest(
  responses: unknown[],
  statuses?: number[],
): { request: RequestFn; calls: Array<{ endpoint: string; options?: unknown }> } {
  const calls: Array<{ endpoint: string; options?: unknown }> = [];
  let callIndex = 0;
  const request: RequestFn = async (endpoint, options) => {
    calls.push({ endpoint, options });
    const i = Math.min(callIndex++, responses.length - 1);
    const status = statuses?.[i];
    if (status === 404) throw new PlaneApiError(404, "Not Found");
    if (status === 204 || status === undefined && responses[i] === undefined) return undefined as never;
    return responses[i] as never;
  };
  return { request, calls };
}

describe("AttachmentsResource", () => {
  it("list hits /projects/{id}/work-items/{id}/attachments/ and returns a plain array", async () => {
    const { request, calls } = mockRequest([[{ id: "a1" }, { id: "a2" }]]);
    const attachments = new AttachmentsResource(request);
    const result = await attachments.list("p1", "wi1");
    assert.equal(calls[0].endpoint, "/projects/p1/work-items/wi1/attachments/");
    assert.equal(result.length, 2);
    assert.equal(result[0].id, "a1");
  });

  it("list falls back to {results:[]} shape defensively", async () => {
    const { request } = mockRequest([{ results: [{ id: "a1" }] }]);
    const attachments = new AttachmentsResource(request);
    const result = await attachments.list("p1", "wi1");
    assert.equal(result.length, 1);
  });

  it("list returns empty array when no results", async () => {
    const { request } = mockRequest([[]]);
    const attachments = new AttachmentsResource(request);
    const result = await attachments.list("p1", "wi1");
    assert.deepEqual(result, []);
  });

  it("delete sends DELETE to the attachment detail endpoint", async () => {
    const { request, calls } = mockRequest([undefined]);
    const attachments = new AttachmentsResource(request);
    await attachments.delete("p1", "wi1", "a1");
    assert.equal(calls[0].endpoint, "/projects/p1/work-items/wi1/attachments/a1/");
    assert.equal((calls[0].options as { method: string }).method, "DELETE");
  });

  it("getDownloadUrl requests a manual redirect and returns the Location", async () => {
    const { request, calls } = mockRequest(["https://s3.amazonaws.com/bucket/file.pdf?signed"]);
    const attachments = new AttachmentsResource(request);
    const url = await attachments.getDownloadUrl("p1", "wi1", "a1");
    assert.equal(calls[0].endpoint, "/projects/p1/work-items/wi1/attachments/a1/");
    assert.equal((calls[0].options as { redirect: string }).redirect, "manual");
    assert.equal(url, "https://s3.amazonaws.com/bucket/file.pdf?signed");
  });

  it("getDownloadUrl throws when no Location is returned", async () => {
    const { request } = mockRequest([null]);
    const attachments = new AttachmentsResource(request);
    await assert.rejects(() => attachments.getDownloadUrl("p1", "wi1", "a1"));
  });
});

describe("AttachmentsResource.upload", () => {
  let originalFetch: typeof fetch;
  let fetchCalls: Array<{ url: string; init?: RequestInit }>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchCalls = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      fetchCalls.push({ url, init });
      return new Response(null, { status: 204 });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("drives the 3-step flow: credentials -> S3 upload -> confirm", async () => {
    const credentials = {
      upload_data: {
        url: "https://s3.amazonaws.com/bucket/",
        fields: { key: "file.pdf", policy: "p", signature: "s" },
      },
      asset_id: "asset-1",
      attachment: { id: "asset-1", asset: "file.pdf", is_uploaded: false },
      asset_url: "https://s3.amazonaws.com/bucket/file.pdf",
    };
    const { request, calls } = mockRequest([credentials, undefined]);
    const attachments = new AttachmentsResource(request);

    const result = await attachments.upload(
      "p1",
      "wi1",
      { name: "file.pdf", type: "application/pdf", size: 3 },
      new Uint8Array([1, 2, 3]),
    );

    // Step 1: credentials request
    assert.equal(calls[0].endpoint, "/projects/p1/work-items/wi1/attachments/");
    assert.equal((calls[0].options as { method: string }).method, "POST");
    const body1 = (calls[0].options as { body: Record<string, unknown> }).body;
    assert.deepEqual(body1, { name: "file.pdf", size: 3, type: "application/pdf" });

    // Step 2: S3 upload (bypasses RequestFn, goes through global fetch)
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url, "https://s3.amazonaws.com/bucket/");
    assert.equal(fetchCalls[0].init?.method, "POST");
    assert.ok(fetchCalls[0].init?.body instanceof FormData);

    // Step 3: confirm
    assert.equal(calls[1].endpoint, "/projects/p1/work-items/wi1/attachments/asset-1/");
    assert.equal((calls[1].options as { method: string }).method, "PATCH");
    const body2 = (calls[1].options as { body: Record<string, unknown> }).body;
    assert.deepEqual(body2, { is_uploaded: true });

    assert.equal(result.id, "asset-1");
    assert.equal(result.is_uploaded, true);
  });

  it("omits externalId/externalSource from the credentials body when not set", async () => {
    const credentials = {
      upload_data: { url: "https://s3.amazonaws.com/bucket/", fields: {} },
      asset_id: "asset-2",
      attachment: { id: "asset-2", asset: "file.txt" },
      asset_url: "https://s3.amazonaws.com/bucket/file.txt",
    };
    const { request, calls } = mockRequest([credentials, undefined]);
    const attachments = new AttachmentsResource(request);

    await attachments.upload("p1", "wi1", { name: "file.txt", size: 1 }, new Uint8Array([1]));

    const body = (calls[0].options as { body: Record<string, unknown> }).body;
    assert.ok(!("external_id" in body));
    assert.ok(!("external_source" in body));
    assert.ok(!("type" in body));
  });

  it("throws PlaneApiError when the S3 upload fails", async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("s3.amazonaws.com")) {
        return new Response("Access Denied", { status: 403, statusText: "Forbidden" });
      }
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    const credentials = {
      upload_data: { url: "https://s3.amazonaws.com/bucket/", fields: {} },
      asset_id: "asset-3",
      attachment: { id: "asset-3", asset: "file.txt" },
      asset_url: "https://s3.amazonaws.com/bucket/file.txt",
    };
    const { request } = mockRequest([credentials]);
    const attachments = new AttachmentsResource(request);

    await assert.rejects(
      () => attachments.upload("p1", "wi1", { name: "file.txt", size: 1 }, new Uint8Array([1])),
      (err: unknown) => err instanceof PlaneApiError && err.status === 403,
    );
  });
});
