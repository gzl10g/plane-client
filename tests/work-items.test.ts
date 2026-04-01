import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { PlaneClient } from "../src/client.js";

function mockFetch(responses: Array<{ status: number; body: unknown }>) {
  const original = globalThis.fetch;
  const calls: { url: string; init: RequestInit }[] = [];
  let callIndex = 0;
  globalThis.fetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    calls.push({ url, init: init ?? {} });
    const r = responses[Math.min(callIndex++, responses.length - 1)];
    return new Response(
      r.status === 204 ? null : JSON.stringify(r.body),
      { status: r.status, statusText: "OK" },
    );
  };
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

describe("WorkItemsResource", () => {
  let client: PlaneClient;
  beforeEach(() => {
    client = new PlaneClient({
      baseUrl: "https://plane.test",
      apiKey: "pk",
      workspace: "ws",
      retry: { maxRetries: 0 },
    });
  });

  it("list returns Page with items and hasMore", async () => {
    const mock = mockFetch([
      {
        status: 200,
        body: {
          results: [{ id: "1" }],
          next_cursor: "abc",
          next_page_results: true,
        },
      },
    ]);
    try {
      const page = await client.workItems.list("p1");
      assert.equal(page.items.length, 1);
      assert.equal(page.hasMore, true);
      assert.equal(page.nextCursor, "abc");
    } finally {
      mock.restore();
    }
  });

  it("list passes filters as query params", async () => {
    const mock = mockFetch([{ status: 200, body: { results: [] } }]);
    try {
      await client.workItems.list("p1", {
        stateGroup: "started",
        priority: "high",
        perPage: 50,
      });
      const url = mock.calls[0].url;
      assert(url.includes("state_group=started"));
      assert(url.includes("priority=high"));
      assert(url.includes("per_page=50"));
    } finally {
      mock.restore();
    }
  });

  it("get parses identifier PREFIX-NUMBER", async () => {
    const mock = mockFetch([
      { status: 200, body: { results: [{ sequence_id: 42, id: "uuid-42" }] } },
    ]);
    try {
      const item = await client.workItems.get("p1", "NEURAL-42");
      assert(mock.calls[0].url.includes("search=42"));
      assert.equal(item?.id, "uuid-42");
    } finally {
      mock.restore();
    }
  });

  it("get returns null for non-matching sequence_id", async () => {
    const mock = mockFetch([
      { status: 200, body: { results: [{ sequence_id: 99, id: "other" }] } },
    ]);
    try {
      const item = await client.workItems.get("p1", "NEURAL-42");
      assert.equal(item, null);
    } finally {
      mock.restore();
    }
  });

  it("get throws on invalid identifier format", async () => {
    const mock = mockFetch([{ status: 200, body: {} }]);
    try {
      await assert.rejects(
        () => client.workItems.get("p1", "invalid"),
        { message: /Invalid identifier/ },
      );
    } finally {
      mock.restore();
    }
  });

  it("create sends POST with body", async () => {
    const mock = mockFetch([
      { status: 200, body: { id: "new-id", name: "test" } },
    ]);
    try {
      await client.workItems.create("p1", {
        name: "test",
        priority: "high",
      });
      assert.equal(mock.calls[0].init.method, "POST");
      const body = JSON.parse(mock.calls[0].init.body as string);
      assert.equal(body.name, "test");
      assert.equal(body.priority, "high");
    } finally {
      mock.restore();
    }
  });

  it("update sends PATCH", async () => {
    const mock = mockFetch([{ status: 200, body: { id: "wi-1" } }]);
    try {
      await client.workItems.update("p1", "wi-1", { name: "updated" });
      assert.equal(mock.calls[0].init.method, "PATCH");
      assert(mock.calls[0].url.includes("/work-items/wi-1/"));
    } finally {
      mock.restore();
    }
  });

  it("comments.list hits correct endpoint", async () => {
    const mock = mockFetch([{ status: 200, body: [] }]);
    try {
      await client.workItems.comments.list("p1", "wi-1");
      assert(mock.calls[0].url.includes("/work-items/wi-1/comments/"));
    } finally {
      mock.restore();
    }
  });

  it("comments.create sends POST", async () => {
    const mock = mockFetch([{ status: 200, body: { id: "c1" } }]);
    try {
      await client.workItems.comments.create("p1", "wi-1", "<p>test</p>");
      assert.equal(mock.calls[0].init.method, "POST");
      const body = JSON.parse(mock.calls[0].init.body as string);
      assert.equal(body.comment_html, "<p>test</p>");
    } finally {
      mock.restore();
    }
  });

  it("links.create sends POST with url and title", async () => {
    const mock = mockFetch([{ status: 200, body: { id: "l1" } }]);
    try {
      await client.workItems.links.create("p1", "wi-1", {
        url: "https://example.com",
        title: "Link",
      });
      assert.equal(mock.calls[0].init.method, "POST");
    } finally {
      mock.restore();
    }
  });

  it("relations.create sends correct body", async () => {
    const mock = mockFetch([{ status: 200, body: {} }]);
    try {
      await client.workItems.relations.create("p1", "wi-1", {
        relationType: "blocks",
        relatedWorkItemId: "wi-2",
      });
      const body = JSON.parse(mock.calls[0].init.body as string);
      assert.equal(body.relation_type, "blocks");
      assert.deepEqual(body.related_list, ["wi-2"]);
    } finally {
      mock.restore();
    }
  });

  it("listAll iterates all pages", async () => {
    const mock = mockFetch([
      {
        status: 200,
        body: {
          results: [{ id: "1" }],
          next_cursor: "pg2",
          next_page_results: true,
        },
      },
      {
        status: 200,
        body: { results: [{ id: "2" }], next_page_results: false },
      },
    ]);
    try {
      const items: unknown[] = [];
      for await (const item of client.workItems.listAll("p1")) {
        items.push(item);
      }
      assert.equal(items.length, 2);
      assert.equal(mock.calls.length, 2);
    } finally {
      mock.restore();
    }
  });
});
