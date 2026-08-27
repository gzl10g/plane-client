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
      // La respuesta del PATCH tiene que confirmar el estado: desde 0.19.0 un
      // 200 que no lo diga es un error, no un éxito silencioso.
      { status: 200, body: { id: "rec-1", issue: "wi-9", status: 1 } },
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
      { status: 200, body: { id: "rec-1", issue: "wi-9", status: 1 } },
    ]);
    try {
      await client.intake.accept("p1", "wi-9");
      assert(mock.calls[1].url.includes("/intake-issues/wi-9/"));
    } finally { mock.restore(); }
  });

  it("decline resolves the id then PATCHes status -1", async () => {
    const mock = mockFetch([
      { status: 200, body: { results: [{ id: "rec-1", issue: "wi-9" }] } },
      { status: 200, body: { id: "rec-1", issue: "wi-9", status: -1 } },
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

  it("listAll stops on next_page_results, not on the cursor", async () => {
    // El mismo cursor-en-la-última-página que ya colgó un barrido de 20 minutos
    // en work-items: intake era el listado que seguía arrastrándolo.
    const mock = mockFetch([
      { status: 200, body: { results: [{ id: "i1" }], next_cursor: "100:1:0", next_page_results: false } },
    ]);
    try {
      const passthrough = globalThis.fetch;
      globalThis.fetch = async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        if (mock.calls.length >= 3) {
          throw new Error("pagination did not stop on next_page_results: false");
        }
        return passthrough(input, init);
      };
      const items: unknown[] = [];
      for await (const issue of client.intake.listAll("p1")) items.push(issue);
      assert.equal(items.length, 1);
      assert.equal(mock.calls.length, 1, "the last page must not be followed");
    } finally { mock.restore(); }
  });

  it("listAll walks every page while more results remain", async () => {
    const mock = mockFetch([
      { status: 200, body: { results: [{ id: "i1" }], next_cursor: "100:1:0", next_page_results: true } },
      { status: 200, body: { results: [{ id: "i2" }], next_cursor: "100:2:0", next_page_results: false } },
    ]);
    try {
      const items: unknown[] = [];
      for await (const issue of client.intake.listAll("p1")) items.push(issue);
      assert.equal(items.length, 2);
    } finally { mock.restore(); }
  });

  // Reportado desde fuera y reproducido en vivo contra 1.4.2 el 2026-08-27:
  // `planec intake accept` decía "Intake accepted" y la cola no se movía.
  it("accept refuses to report success when Plane discards the write", async () => {
    // La API responde 200 con el objeto... y el status sin tocar.
    const mock = mockFetch([
      { status: 200, body: { results: [{ id: "rec1", issue: "iss1", status: -2 }], next_page_results: false } },
      { status: 200, body: { id: "rec1", issue: "iss1", status: -2 } },
    ]);
    try {
      await assert.rejects(
        () => client.intake.accept("p1", "rec1"),
        /did not apply it: the intake issue is still status -2, not 1/,
      );
    } finally { mock.restore(); }
  });

  it("decline refuses the same way", async () => {
    const mock = mockFetch([
      { status: 200, body: { results: [{ id: "rec1", issue: "iss1", status: -2 }], next_page_results: false } },
      { status: 200, body: { id: "rec1", issue: "iss1", status: -2 } },
    ]);
    try {
      await assert.rejects(() => client.intake.decline("p1", "rec1"), /not -1/);
    } finally { mock.restore(); }
  });

  it("accept returns the issue when the write did stick", async () => {
    const mock = mockFetch([
      { status: 200, body: { results: [{ id: "rec1", issue: "iss1", status: -2 }], next_page_results: false } },
      { status: 200, body: { id: "rec1", issue: "iss1", status: 1 } },
    ]);
    try {
      const updated = await client.intake.accept("p1", "rec1");
      assert.equal(updated.status, 1);
    } finally { mock.restore(); }
  });

  // El otro fallo del mismo reporte: pedir per_page ACTIVA la paginación, así
  // que mirar solo la primera página dejaba invisible el resto de la cola y el
  // PATCH acababa yendo al id del record, que responde 404.
  it("resolveIssueId finds a record beyond the first page", async () => {
    const mock = mockFetch([
      { status: 200, body: { results: [{ id: "other", issue: "iss-other", status: -2 }], next_cursor: "100:1:0", next_page_results: true } },
      { status: 200, body: { results: [{ id: "rec-late", issue: "iss-late", status: -2 }], next_cursor: "100:2:0", next_page_results: false } },
    ]);
    try {
      assert.equal(await client.intake.resolveIssueId("p1", "rec-late"), "iss-late");
    } finally { mock.restore(); }
  });

  it("resolveIssueId does not send per_page, which is what turns pagination on", async () => {
    const mock = mockFetch([
      { status: 200, body: { results: [{ id: "rec1", issue: "iss1", status: -2 }], next_page_results: false } },
    ]);
    try {
      await client.intake.resolveIssueId("p1", "rec1");
      assert.ok(!mock.calls[0].url.includes("per_page"), mock.calls[0].url);
    } finally { mock.restore(); }
  });
});
