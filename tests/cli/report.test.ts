import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { handleReportWorkItems, resolveReportWorkspaces } from "../../src/cli/report.js";
import type { PlaneClient } from "../../src/client.js";
import { PlaneApiError } from "../../src/error.js";
import type { Config } from "../../src/cli/config.js";

const mockConfig: Config = {
  version: 1,
  baseUrl: "https://plane.test",
  apiKey: "pk",
  workspace: "active-ws",
};

function fakeClient(): PlaneClient {
  return {
    projects: {
      async *listAll() {
        yield { id: "p1", identifier: "PCL", name: "Plane Client" };
      },
    },
    states: { list: async () => [{ id: "s1", name: "Todo", group: "unstarted" }] },
    workItems: {
      async *listAll() {
        yield { id: "w1", sequence_id: 7, name: "A name with, a comma", state: "s1", priority: "high", assignees: [], created_at: "2026-08-10T00:00:00Z" };
      },
    },
    intake: { async *listAll() {} },
  } as unknown as PlaneClient;
}

describe("resolveReportWorkspaces", () => {
  const savedEnv = process.env.PLANE_WORKSPACE;
  afterEach(() => {
    if (savedEnv === undefined) delete process.env.PLANE_WORKSPACE;
    else process.env.PLANE_WORKSPACE = savedEnv;
  });

  it("takes the flag first, splitting commas and repeats alike", () => {
    delete process.env.PLANE_WORKSPACE;
    assert.deepEqual(resolveReportWorkspaces({ workspaces: ["a,b", "c"] }, mockConfig), ["a", "b", "c"]);
  });

  it("falls back to the saved report list", () => {
    delete process.env.PLANE_WORKSPACE;
    const config = { ...mockConfig, workspaces: ["ws1", "ws2"] };
    assert.deepEqual(resolveReportWorkspaces({}, config), ["ws1", "ws2"]);
  });

  it("falls back to the active workspace when no list was saved", () => {
    delete process.env.PLANE_WORKSPACE;
    assert.deepEqual(resolveReportWorkspaces({}, mockConfig), ["active-ws"]);
  });

  // El `--workspace` global llega por PLANE_WORKSPACE; dividir por comas evita
  // buscar un workspace llamado literalmente "a,b".
  it("splits a comma-separated PLANE_WORKSPACE", () => {
    process.env.PLANE_WORKSPACE = "a,b";
    assert.deepEqual(resolveReportWorkspaces({}, { version: 1 }), ["a", "b"]);
  });

  // La API v1 no puede listar workspaces, así que "todos los míos" no es
  // descubrible: mejor decirlo que informar de uno y llamarlo todo.
  it("refuses to guess when there is nothing to sweep", () => {
    delete process.env.PLANE_WORKSPACE;
    assert.throws(() => resolveReportWorkspaces({}, { version: 1 }), /cannot list your workspaces/);
  });
});

describe("handleReportWorkItems", () => {
  let logs: string[];
  let errors: string[];
  let originalLog: typeof console.log;
  let originalError: typeof console.error;

  beforeEach(() => {
    logs = [];
    errors = [];
    originalLog = console.log;
    originalError = console.error;
    console.log = (...args: unknown[]) => logs.push(String(args[0]));
    console.error = (...args: unknown[]) => errors.push(String(args[0]));
  });

  afterEach(() => {
    console.log = originalLog;
    console.error = originalError;
  });

  const deps = () => ({ config: mockConfig, client: fakeClient() });

  it("prints a table by default, with the summary on stderr", async () => {
    await handleReportWorkItems({ workspaces: ["ws"], status: "all" }, deps());

    assert.equal(logs.length, 1);
    assert.ok(logs[0].includes("PCL-7"));
    assert.ok(errors.some((e) => e.includes("1 item(s)")), "the summary must not pollute stdout");
  });

  it("--json emits the full report object", async () => {
    await handleReportWorkItems({ workspaces: ["ws"], status: "all", json: true }, deps());

    const parsed = JSON.parse(logs[0]) as { rows: unknown[]; counts: { total: number }; partial: boolean };
    assert.equal(parsed.rows.length, 1);
    assert.equal(parsed.counts.total, 1);
    assert.equal(parsed.partial, false);
  });

  it("--format csv quotes a value containing a comma", async () => {
    await handleReportWorkItems({ workspaces: ["ws"], status: "all", format: "csv" }, deps());

    const [header, row] = logs[0].split("\n");
    assert.ok(header.startsWith("identifier,workspace,project"));
    assert.ok(row.includes('"A name with, a comma"'));
  });

  it("--format md emits a markdown table", async () => {
    await handleReportWorkItems({ workspaces: ["ws"], status: "all", format: "md" }, deps());

    assert.ok(logs[0].startsWith("| ID | Project |"));
    assert.ok(logs[0].includes("| PCL-7 |"));
  });

  it("rejects an unknown --status instead of reporting on nothing", async () => {
    await assert.rejects(
      () => handleReportWorkItems({ workspaces: ["ws"], status: "pending" }, deps()),
      /Invalid --status pending/,
    );
  });

  it("rejects an unknown --group", async () => {
    await assert.rejects(
      () => handleReportWorkItems({ workspaces: ["ws"], group: "started,doing" }, deps()),
      /Invalid --group doing/,
    );
  });

  it("rejects an unknown --format", async () => {
    await assert.rejects(
      () => handleReportWorkItems({ workspaces: ["ws"], format: "xlsx" }, deps()),
      /Invalid --format xlsx/,
    );
  });

  // Una fecha ilegible filtraría todo en silencio y devolvería un informe vacío.
  it("rejects an unparseable --since", async () => {
    await assert.rejects(
      () => handleReportWorkItems({ workspaces: ["ws"], since: "last tuesday" }, deps()),
      /Invalid --since/,
    );
  });

  // El aviso de parcialidad NO puede salir solo en la tabla: redirigir csv/md a
  // un fichero es el uso normal, y ese fichero no puede parecer completo.
  it("warns about a partial report in csv too", async () => {
    const partialDeps = {
      config: mockConfig,
      client: {
        projects: {
          async *listAll() {
            yield { id: "p1", identifier: "PCL", name: "Plane Client" };
            yield { id: "p2", identifier: "BAD", name: "Unreadable" };
          },
        },
        states: {
          list: async (projectId: string) => {
            if (projectId === "p2") throw new PlaneApiError(403, "Forbidden");
            return [{ id: "s1", name: "Todo", group: "unstarted" }];
          },
        },
        workItems: {
          async *listAll() {
            yield { id: "w1", sequence_id: 7, name: "One", state: "s1", priority: "high", assignees: [], created_at: "2026-08-10T00:00:00Z" };
          },
        },
        intake: { async *listAll() {} },
      } as unknown as PlaneClient,
    };

    await handleReportWorkItems({ workspaces: ["ws"], status: "all", format: "csv" }, partialDeps);

    assert.ok(errors.some((e) => e.includes("Partial report")), "the CSV on stdout must not look complete");
  });

  it("warns about a partial report in md too", async () => {
    const partialDeps = {
      config: mockConfig,
      client: {
        projects: {
          async *listAll() {
            yield { id: "p1", identifier: "PCL", name: "Plane Client" };
          },
        },
        states: { list: async () => [] },
        workItems: { async *listAll() {} },
        intake: { async *listAll() {} },
      } as unknown as PlaneClient,
    };

    await handleReportWorkItems({ workspaces: ["ws"], status: "all", format: "md" }, partialDeps);

    assert.ok(errors.some((e) => e.includes("Partial report")));
  });

  it("refuses --intake together with --intake-only", async () => {
    await assert.rejects(
      () => handleReportWorkItems({ workspaces: ["ws"], intake: true, intakeOnly: true }, deps()),
      /not both/,
    );
  });

  it("refuses --status together with --group", async () => {
    await assert.rejects(
      () => handleReportWorkItems({ workspaces: ["ws"], status: "done", group: "started" }, deps()),
      /not both/,
    );
  });
});
