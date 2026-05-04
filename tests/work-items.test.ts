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

  it("list returns Page with items and hasNext", async () => {
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
      assert.equal(page.hasNext, true);
      assert.equal(page.nextCursor, "abc");
    } finally {
      mock.restore();
    }
  });

  it("list envía orderBy, fields y expand como query params", async () => {
    const mock = mockFetch([{ status: 200, body: { results: [] } }]);
    try {
      await client.workItems.list("p1", {
        orderBy: "-created_at",
        fields: ["id", "name"],
        expand: ["assignees", "labels"],
        perPage: 50,
      });
      const url = mock.calls[0].url;
      assert(url.includes("order_by=-created_at"));
      assert(url.includes("fields=id%2Cname"));
      assert(url.includes("expand=assignees%2Clabels"));
      assert(url.includes("per_page=50"));
    } finally {
      mock.restore();
    }
  });

  it("list con externalId + externalSource los pasa como params", async () => {
    const mock = mockFetch([{ status: 200, body: { results: [] } }]);
    try {
      await client.workItems.list("p1", {
        externalId: "gh-42",
        externalSource: "github",
      });
      const url = mock.calls[0].url;
      assert(url.includes("external_id=gh-42"));
      assert(url.includes("external_source=github"));
    } finally {
      mock.restore();
    }
  });

  it("get por identifier usa endpoint directo /work-items/{ident}/", async () => {
    const mock = mockFetch([
      { status: 200, body: { id: "wi-1", sequence_id: 207 } },
    ]);
    try {
      const res = await client.workItems.get("PRUEBA-207");
      const url = mock.calls[0].url;
      assert(url.includes("/work-items/PRUEBA-207/"));
      assert(!url.includes("search="));
      assert(!url.includes("/projects/"));
      assert.equal(res?.id, "wi-1");
    } finally {
      mock.restore();
    }
  });

  it("get devuelve null en 404", async () => {
    const mock = mockFetch([{ status: 404, body: { error: "not found" } }]);
    try {
      const res = await client.workItems.get("PRUEBA-999999");
      assert.equal(res, null);
    } finally {
      mock.restore();
    }
  });

  it("get rechaza identifier mal formado", async () => {
    await assert.rejects(
      () => client.workItems.get("bad-format-x"),
      /Invalid identifier/,
    );
  });

  it("getById usa /projects/{p}/work-items/{uuid}/", async () => {
    const mock = mockFetch([{ status: 200, body: { id: "wi-1" } }]);
    try {
      const res = await client.workItems.getById("p1", "wi-1");
      assert(mock.calls[0].url.includes("/projects/p1/work-items/wi-1/"));
      assert.equal(res?.id, "wi-1");
    } finally {
      mock.restore();
    }
  });

  it("getById devuelve null en 404", async () => {
    const mock = mockFetch([{ status: 404, body: {} }]);
    try {
      assert.equal(await client.workItems.getById("p1", "xxx"), null);
    } finally {
      mock.restore();
    }
  });

  it("search usa /work-items/search/ workspace-level", async () => {
    const mock = mockFetch([
      { status: 200, body: { issues: [{ id: "x", name: "y", sequence_id: 1 }] } },
    ]);
    try {
      const res = await client.workItems.search({
        query: "foo",
        limit: 5,
        projectId: "p1",
      });
      const url = mock.calls[0].url;
      assert(url.includes("/work-items/search/"));
      assert(url.includes("search=foo"));
      assert(url.includes("limit=5"));
      assert(url.includes("project_id=p1"));
      assert(!url.includes("/projects/p1/"));
      assert.equal(res.length, 1);
    } finally {
      mock.restore();
    }
  });

  it("search workspace-wide pasa workspace_search=true", async () => {
    const mock = mockFetch([{ status: 200, body: { issues: [] } }]);
    try {
      await client.workItems.search({ query: "foo", workspaceSearch: true });
      assert(mock.calls[0].url.includes("workspace_search=true"));
    } finally {
      mock.restore();
    }
  });

  it("activities.list devuelve Page<Activity>", async () => {
    const mock = mockFetch([
      {
        status: 200,
        body: {
          results: [{ id: "a1", verb: "created" }],
          total_results: 1,
          next_page_results: false,
        },
      },
    ]);
    try {
      const page = await client.workItems.activities.list("p1", "wi-1");
      assert(
        mock.calls[0].url.includes("/projects/p1/work-items/wi-1/activities/"),
      );
      assert.equal(page.items.length, 1);
      assert.equal(page.items[0].id, "a1");
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

  it("create sends estimate_point, type and module", async () => {
    const mock = mockFetch([
      { status: 200, body: { id: "new-id", name: "test", estimate_point: "3", type: "type-1", module: "mod-1" } },
    ]);
    try {
      const item = await client.workItems.create("p1", {
        name: "test",
        estimate_point: "3",
        type: "type-1",
        module: "mod-1",
      });
      const body = JSON.parse(mock.calls[0].init.body as string);
      assert.equal(body.estimate_point, "3");
      assert.equal(body.type, "type-1");
      assert.equal(body.module, "mod-1");
      assert.equal(item.estimate_point, "3");
    } finally {
      mock.restore();
    }
  });

  it("create omits undefined optional fields", async () => {
    const mock = mockFetch([
      { status: 200, body: { id: "new-id", name: "test" } },
    ]);
    try {
      await client.workItems.create("p1", { name: "test" });
      const body = JSON.parse(mock.calls[0].init.body as string);
      assert(!("estimate_point" in body));
      assert(!("type" in body));
      assert(!("module" in body));
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
    const mock = mockFetch([{ status: 200, body: { results: [] } }]);
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

  it("comments.update sends PATCH with comment_html", async () => {
    const mock = mockFetch([{ status: 200, body: { id: "c1", comment_html: "<p>edit</p>" } }]);
    try {
      const res = await client.workItems.comments.update("p1", "wi-1", "c1", {
        commentHtml: "<p>edit</p>",
      });
      assert(mock.calls[0].url.includes("/work-items/wi-1/comments/c1/"));
      assert.equal(mock.calls[0].init.method, "PATCH");
      const body = JSON.parse(mock.calls[0].init.body as string);
      assert.equal(body.comment_html, "<p>edit</p>");
      assert.equal(res.id, "c1");
    } finally {
      mock.restore();
    }
  });

  it("comments.delete sends DELETE", async () => {
    const mock = mockFetch([{ status: 204, body: null }]);
    try {
      await client.workItems.comments.delete("p1", "wi-1", "c1");
      assert(mock.calls[0].url.includes("/work-items/wi-1/comments/c1/"));
      assert.equal(mock.calls[0].init.method, "DELETE");
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
    const mock = mockFetch([{
      status: 200,
      body: [{ id: "r1", name: "Related", relation_type: "blocked_by" }],
    }]);
    try {
      const result = await client.workItems.relations.create("p1", "wi-1", {
        relationType: "blocking",
        issues: ["wi-2"],
      });
      const body = JSON.parse(mock.calls[0].init.body as string);
      assert.equal(body.relation_type, "blocking");
      assert.deepEqual(body.issues, ["wi-2"]);
      assert(Array.isArray(result));
      assert.equal(result[0].id, "r1");
    } finally {
      mock.restore();
    }
  });

  it("relations.list returns RelationsMap", async () => {
    const mock = mockFetch([{
      status: 200,
      body: {
        blocking: ["wi-2"],
        blocked_by: [],
        duplicate: [],
        relates_to: [],
        start_before: [],
        start_after: [],
        finish_before: [],
        finish_after: [],
      },
    }]);
    try {
      const relations = await client.workItems.relations.list("p1", "wi-1");
      assert(!Array.isArray(relations));
      assert.deepEqual(relations.blocking, ["wi-2"]);
      assert.deepEqual(relations.blocked_by, []);
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
