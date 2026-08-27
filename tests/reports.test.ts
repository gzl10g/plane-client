import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildWorkItemReport, AllWorkspacesRefusedError } from "../src/reports.js";
import { PlaneApiError } from "../src/error.js";
import type { PlaneClient } from "../src/client.js";

const STATES = [
  { id: "s-backlog", name: "Backlog", group: "backlog" },
  { id: "s-todo", name: "Todo", group: "unstarted" },
  { id: "s-doing", name: "En curso", group: "started" },
  { id: "s-done", name: "Hecho", group: "completed" },
];

function fakeClient(overrides: Record<string, unknown> = {}): PlaneClient {
  return {
    projects: {
      async *listAll() {
        yield { id: "p1", identifier: "PCL", name: "Plane Client" };
      },
    },
    states: { list: async () => STATES },
    workItems: {
      async *listAll() {
        yield { id: "w1", sequence_id: 1, name: "Open one", state: "s-backlog", priority: "high", assignees: ["u1"], created_at: "2026-08-10T00:00:00Z" };
        yield { id: "w2", sequence_id: 2, name: "Doing", state: { id: "s-doing", name: "En curso" }, priority: "medium", assignees: [], created_at: "2026-08-12T00:00:00Z" };
        yield { id: "w3", sequence_id: 3, name: "Finished", state: "s-done", priority: "low", assignees: ["u2"], created_at: "2026-07-01T00:00:00Z", completed_at: "2026-08-20T00:00:00Z" };
      },
    },
    intake: {
      async *listAll() {
        yield { id: "i1", name: "Waiting", status: -2, issue_detail: { name: "Waiting", sequence_id: 99 } };
        yield { id: "i2", name: "Already accepted", status: 1, issue_detail: { name: "Already accepted", sequence_id: 100 } };
      },
    },
    ...overrides,
  } as unknown as PlaneClient;
}

const one = (client = fakeClient()) => [{ workspace: "ws", client }];

describe("buildWorkItemReport", () => {
  it("defaults to the open groups: backlog, unstarted and started", async () => {
    const report = await buildWorkItemReport(one(), { status: "open" });

    assert.deepEqual(report.rows.map((r) => r.identifier), ["PCL-1", "PCL-2"]);
    assert.equal(report.counts.open, 2);
    assert.equal(report.counts.done, 0);
  });

  it("status done keeps only completed work", async () => {
    const report = await buildWorkItemReport(one(), { status: "done" });

    assert.deepEqual(report.rows.map((r) => r.identifier), ["PCL-3"]);
  });

  it("status all keeps everything", async () => {
    const report = await buildWorkItemReport(one(), { status: "all" });
    assert.equal(report.rows.length, 3);
  });

  // Cada proyecto renombra sus estados, así que agrupar por nombre parte la
  // misma columna en tres. El grupo es lo único estable.
  it("groups by state.group, not by the state's name", async () => {
    const report = await buildWorkItemReport(one(), { groups: ["started"] });

    assert.equal(report.rows.length, 1);
    assert.equal(report.rows[0].state, "En curso");
    assert.equal(report.rows[0].stateGroup, "started");
  });

  it("resolves the state whether it arrives expanded or as a bare uuid", async () => {
    const report = await buildWorkItemReport(one(), { status: "all" });
    const byId = new Map(report.rows.map((r) => [r.identifier, r]));

    assert.equal(byId.get("PCL-1")?.state, "Backlog");
    assert.equal(byId.get("PCL-2")?.state, "En curso");
  });

  it("rebuilds the human identifier from the project prefix", async () => {
    const report = await buildWorkItemReport(one(), { status: "all" });
    assert.ok(report.rows.every((r) => r.identifier.startsWith("PCL-")));
  });

  it("filters by project identifier, case-insensitively", async () => {
    const empty = await buildWorkItemReport(one(), { status: "all", projects: ["nxi"] });
    const hit = await buildWorkItemReport(one(), { status: "all", projects: ["pcl"] });

    assert.equal(empty.rows.length, 0);
    assert.equal(hit.rows.length, 3);
  });

  it("filters by assignee", async () => {
    const report = await buildWorkItemReport(one(), { status: "all", assignees: ["u2"] });
    assert.deepEqual(report.rows.map((r) => r.identifier), ["PCL-3"]);
  });

  // Una fila cerrada se fecha por cuándo se terminó; el resto, por cuándo apareció.
  it("dates done rows by completed_at and open rows by created_at", async () => {
    const done = await buildWorkItemReport(one(), { status: "done", since: "2026-08-19" });
    assert.equal(done.rows.length, 1, "completed_at 2026-08-20 falls inside the window");

    const doneOut = await buildWorkItemReport(one(), { status: "done", since: "2026-08-21" });
    assert.equal(doneOut.rows.length, 0);

    const open = await buildWorkItemReport(one(), { status: "open", since: "2026-08-11" });
    assert.deepEqual(open.rows.map((r) => r.identifier), ["PCL-2"]);
  });

  it("--until covers the whole of its day, not midnight sharp", async () => {
    const report = await buildWorkItemReport(one(), { status: "done", until: "2026-08-20" });
    assert.equal(report.rows.length, 1);
  });

  it("rejects a work item whose state is unknown to the project", async () => {
    const client = fakeClient({
      states: { list: async () => [] },
    });
    const report = await buildWorkItemReport(one(client), { status: "open" });

    assert.equal(report.rows.length, 0, "an unknown group cannot claim to be open");
  });

  describe("intake", () => {
    it("is left out by default", async () => {
      const report = await buildWorkItemReport(one(), { status: "all" });
      assert.equal(report.counts.intake, 0);
    });

    // Los aceptados ya salen en /work-items/; contarlos otra vez los duplica.
    it("adds only what is still pending triage", async () => {
      const report = await buildWorkItemReport(one(), { status: "all", intake: "include" });

      const intake = report.rows.filter((r) => r.intake);
      assert.equal(intake.length, 1);
      assert.equal(intake[0].name, "Waiting");
      assert.equal(intake[0].identifier, "PCL-99");
    });

    it("--intake-only skips the work item sweep entirely", async () => {
      const client = fakeClient({
        workItems: {
          // eslint-disable-next-line require-yield
          async *listAll(): AsyncGenerator<never> {
            throw new Error("--intake-only must not list work items");
          },
        },
      });
      const report = await buildWorkItemReport(one(client), { intake: "only" });

      assert.equal(report.rows.length, 1);
      assert.equal(report.counts.intake, 1);
    });

    it("intake rows survive the status filter", async () => {
      const report = await buildWorkItemReport(one(), { status: "done", intake: "include" });
      assert.equal(report.counts.intake, 1, "the flag adds a block, it does not filter one");
    });
  });

  describe("degradation", () => {
    const refused = () =>
      ({
        projects: {
          // eslint-disable-next-line require-yield
          async *listAll(): AsyncGenerator<never> {
            throw new PlaneApiError(403, "Forbidden");
          },
        },
      }) as unknown as PlaneClient;

    it("skips a refused workspace and marks the report partial", async () => {
      const warnings: string[] = [];
      const report = await buildWorkItemReport(
        [
          { workspace: "good", client: fakeClient() },
          { workspace: "bad", client: refused() },
        ],
        { status: "all", onWarning: (m) => warnings.push(m) },
      );

      assert.equal(report.partial, true);
      assert.deepEqual(report.skipped.map((s) => s.workspace), ["bad"]);
      assert.equal(report.rows.length, 3, "the readable workspace still reports");
      assert.equal(warnings.length, 1);
    });

    // No se pueden distinguir: la API devuelve 403 para los dos casos. Y la
    // causa se expone como dato (`kind`/`status`), no solo como prosa en inglés
    // que el consumidor tendría que parsear.
    it("classifies the skip as a permission problem, as data", async () => {
      const report = await buildWorkItemReport(
        [
          { workspace: "good", client: fakeClient() },
          { workspace: "bad", client: refused() },
        ],
        { status: "all" },
      );

      assert.equal(report.skipped[0].kind, "permission");
      assert.equal(report.skipped[0].status, 403);
      assert.match(report.skipped[0].reason, /no access, or the name does not exist/);
    });

    it("does not report a timeout as if it were a permission problem", async () => {
      const slow = {
        projects: {
          // eslint-disable-next-line require-yield
          async *listAll(): AsyncGenerator<never> {
            throw new Error("The operation was aborted due to timeout");
          },
        },
      } as unknown as PlaneClient;

      const report = await buildWorkItemReport(
        [
          { workspace: "good", client: fakeClient() },
          { workspace: "slow", client: slow },
        ],
        { status: "all" },
      );

      assert.equal(report.skipped[0].kind, "other");
      assert.equal(report.skipped[0].status, undefined);
    });

    // Todos a la vez no es falta de permisos, es la credencial: sin esto el
    // informe volvería vacío con aspecto perfectamente legítimo.
    it("refuses to return an empty report when every workspace was refused", async () => {
      await assert.rejects(
        () =>
          buildWorkItemReport(
            [
              { workspace: "a", client: refused() },
              { workspace: "b", client: refused() },
            ],
            { status: "all" },
          ),
        (err: unknown) => {
          assert.ok(err instanceof AllWorkspacesRefusedError);
          assert.match(err.message, /usually the credential/);
          assert.match(err.message, /planec config show/);
          assert.equal(err.skipped.length, 2);
          return true;
        },
      );
    });
  });

  it("sweeps every workspace it is given", async () => {
    const report = await buildWorkItemReport(
      [
        { workspace: "ws1", client: fakeClient() },
        { workspace: "ws2", client: fakeClient() },
      ],
      { status: "all" },
    );

    assert.equal(report.rows.length, 6);
    assert.deepEqual([...new Set(report.rows.map((r) => r.workspace))], ["ws1", "ws2"]);
  });

  // fields= es el único query param que la v1 respeta, y recorta mucho el payload.
  it("asks only for the fields the report reads, and never sends per_page", async () => {
    let captured: { fields?: string[]; perPage?: number } | undefined;
    const client = fakeClient({
      workItems: {
        // eslint-disable-next-line require-yield
        async *listAll(_p: string, options: { fields?: string[]; perPage?: number }): AsyncGenerator<never> {
          captured = options;
        },
      },
    });

    await buildWorkItemReport(one(client), { status: "all" });

    assert.ok(captured?.fields?.includes("completed_at"));
    assert.ok(captured?.fields?.includes("sequence_id"));
    // Sin per_page la API devuelve todo en una respuesta; mandarlo es lo que
    // activa la paginación, que aquí solo costaría requests.
    assert.equal(captured?.perPage, undefined);
  });

  // Finding del review: el informe tomaba UNA página y no miraba `hasNext`.
  // «Sin per_page la API lo devuelve todo» es comportamiento observado en una
  // instancia, no un contrato — y truncar en silencio es justo lo que este
  // release arregla en todas partes.
  it("walks every page instead of reporting the first one as the whole project", async () => {
    const client = fakeClient({
      workItems: {
        async *listAll() {
          yield { id: "w1", sequence_id: 1, name: "Page one", state: "s-backlog", priority: "none", assignees: [], created_at: "2026-08-10T00:00:00Z" };
          yield { id: "w2", sequence_id: 2, name: "Page two", state: "s-backlog", priority: "none", assignees: [], created_at: "2026-08-10T00:00:00Z" };
        },
      },
    });

    const report = await buildWorkItemReport(one(client), { status: "all" });

    assert.deepEqual(report.rows.map((r) => r.name), ["Page one", "Page two"]);
  });

  // Un 403 de UN proyecto (huérfano, feature apagada, sin permiso) no puede
  // tirar el barrido entero y tirar con él lo ya recogido.
  it("skips an unreadable project without losing the rest of the sweep", async () => {
    const warnings: string[] = [];
    const twoProjects = {
      projects: {
        async *listAll() {
          yield { id: "p1", identifier: "PCL", name: "Plane Client" };
          yield { id: "p2", identifier: "BAD", name: "Unreadable" };
        },
      },
      states: {
        list: async (projectId: string) => {
          if (projectId === "p2") throw new PlaneApiError(403, "Forbidden");
          return STATES;
        },
      },
    };
    const report = await buildWorkItemReport(one(fakeClient(twoProjects)), {
      status: "all",
      onWarning: (m) => warnings.push(m),
    });

    assert.equal(report.rows.length, 3, "the readable project still reports");
    assert.equal(report.partial, true);
    assert.deepEqual(report.skippedProjects.map((s) => s.project), ["BAD"]);
    assert.ok(warnings.some((w) => w.includes("BAD")));
  });

  // La ventana de fechas también manda sobre el intake: si no, `--intake
  // --since` devolvía los work items de agosto junto a TODA la cola histórica.
  it("applies the date window to intake rows too", async () => {
    const client = fakeClient({
      intake: {
        async *listAll() {
          yield { id: "i1", name: "Old", status: -2, issue_detail: { name: "Old", sequence_id: 90, created_at: "2026-01-05T00:00:00Z" } };
          yield { id: "i2", name: "Recent", status: -2, issue_detail: { name: "Recent", sequence_id: 91, created_at: "2026-08-15T00:00:00Z" } };
        },
      },
    });

    const report = await buildWorkItemReport(one(client), {
      status: "all",
      intake: "include",
      since: "2026-08-01",
    });

    const intake = report.rows.filter((r) => r.intake);
    assert.deepEqual(intake.map((r) => r.name), ["Recent"]);
  });

  it("without a date window every pending intake issue is still reported", async () => {
    const report = await buildWorkItemReport(one(), { status: "all", intake: "include" });
    assert.equal(report.counts.intake, 1);
  });

  // Un proyecto cuyos estados no se pueden leer no es un proyecto sin trabajo:
  // sin estados, TODA su lista cae fuera de cualquier filtro y el proyecto
  // desaparece del informe con `partial: false` y exit 0.
  describe("unreadable state list", () => {
    it("treats a project with no states as skipped, not as empty", async () => {
      const warnings: string[] = [];
      const client = fakeClient({ states: { list: async () => [] } });

      const report = await buildWorkItemReport(one(client), {
        status: "open",
        onWarning: (m) => warnings.push(m),
      });

      assert.equal(report.rows.length, 0);
      assert.equal(report.partial, true, "an empty report here must not look complete");
      assert.equal(report.skippedProjects.length, 1);
      assert.ok(warnings.some((w) => w.includes("PCL")));
    });

    it("counts work items whose state the project did not list", async () => {
      const client = fakeClient({
        states: { list: async () => [{ id: "s-other", name: "Other", group: "backlog" }] },
      });

      const report = await buildWorkItemReport(one(client), { status: "all" });

      assert.equal(report.counts.unresolvedState, 3);
      assert.equal(report.partial, true);
      // `null`, no la cadena "unknown": un proyecto puede tener un estado que se
      // llame así de verdad.
      assert.ok(report.rows.every((r) => !r.intake && r.state === null));
    });
  });

  describe("input validation", () => {
    // Date.parse("ayer") es NaN y toda comparación con NaN es false, así que una
    // fecha ilegible DESACTIVABA el filtro y devolvía MÁS filas de las pedidas.
    it("rejects an unparseable since instead of silently disabling the filter", async () => {
      await assert.rejects(
        () => buildWorkItemReport(one(), { status: "all", since: "last tuesday" }),
        /Invalid since/,
      );
    });

    it("rejects an unparseable until", async () => {
      await assert.rejects(
        () => buildWorkItemReport(one(), { status: "all", until: "soon" }),
        /Invalid until/,
      );
    });

    // Este cliente documenta que Plane ignora parámetros en silencio; hacerlo
    // nosotros sería el mismo pecado.
    it("refuses status and groups together instead of ignoring one", async () => {
      await assert.rejects(
        () => buildWorkItemReport(one(), { status: "done", groups: ["started"] }),
        /not both/,
      );
    });
  });

  describe("dropped rows are accounted for", () => {
    // Un WI completado con completed_at nulo existe y está hecho: caerse del
    // informe sin contarse lo hace indistinguible de que no hubiera nada.
    it("counts rows dropped for having no date", async () => {
      const warnings: string[] = [];
      const client = fakeClient({
        workItems: {
          async *listAll() {
            yield { id: "w1", sequence_id: 1, name: "Undated", state: "s-done", priority: "none", assignees: [], created_at: "2026-08-01T00:00:00Z" };
          },
        },
      });

      const report = await buildWorkItemReport(one(client), {
        status: "done",
        since: "2026-08-01",
        onWarning: (m) => warnings.push(m),
      });

      assert.equal(report.rows.length, 0);
      assert.equal(report.counts.undated, 1);
      assert.ok(warnings.some((w) => w.includes("no date")));
    });
  });

  describe("project selection", () => {
    // Un typo en --project recorre todo, no encaja nada y devuelve un informe
    // vacío que parece legítimo.
    it("reports a project identifier no workspace turned out to have", async () => {
      const warnings: string[] = [];
      const report = await buildWorkItemReport(one(), {
        status: "all",
        projects: ["PCLL"],
        onWarning: (m) => warnings.push(m),
      });

      assert.deepEqual(report.unknownProjects, ["PCLL"]);
      assert.equal(report.partial, true);
      assert.ok(warnings.some((w) => w.includes("PCLL")));
    });

    it("says nothing when every requested project was found", async () => {
      const report = await buildWorkItemReport(one(), { status: "all", projects: ["PCL"] });
      assert.deepEqual(report.unknownProjects, []);
      assert.equal(report.partial, false);
    });
  });

  describe("intake recognition", () => {
    // Distingue "las colas están vacías" de "no reconocí ningún estado".
    it("warns when it read intake issues and recognised none as pending", async () => {
      const warnings: string[] = [];
      const client = fakeClient({
        intake: {
          async *listAll() {
            yield { id: "i1", name: "Accepted", status: 1, issue_detail: { name: "Accepted", sequence_id: 1 } };
            yield { id: "i2", name: "Declined", status: -1, issue_detail: { name: "Declined", sequence_id: 2 } };
          },
        },
      });

      await buildWorkItemReport(one(client), {
        status: "all",
        intake: "include",
        onWarning: (m) => warnings.push(m),
      });

      assert.ok(warnings.some((w) => w.includes("recognised none as pending")));
    });
  });

  describe("partial rows are not merged", () => {
    // Si un proyecto revienta a medias, sus filas ya recogidas NO pueden quedarse
    // en el informe mientras el proyecto figura como saltado: los totales
    // saldrían mal de una forma que nadie puede detectar desde la salida.
    it("discards the rows of a project that failed halfway", async () => {
      const client = fakeClient({
        workItems: {
          async *listAll() {
            yield { id: "w1", sequence_id: 1, name: "Page one", state: "s-backlog", priority: "none", assignees: [], created_at: "2026-08-01T00:00:00Z" };
            throw new PlaneApiError(429, "Too Many Requests");
          },
        },
      });

      const report = await buildWorkItemReport(one(client), { status: "all" });

      assert.equal(report.rows.length, 0, "no half a project in the totals");
      assert.equal(report.skippedProjects.length, 1);
      assert.equal(report.skippedProjects[0].kind, "rate-limit");
    });
  });

  describe("counts", () => {
    it("cancelled work is counted on its own, not folded into open or done", async () => {
      const client = fakeClient({
        states: { list: async () => [...STATES, { id: "s-cancel", name: "Descartado", group: "cancelled" }] },
        workItems: {
          async *listAll() {
            yield { id: "w1", sequence_id: 1, name: "Open", state: "s-backlog", priority: "none", assignees: [], created_at: "2026-08-01T00:00:00Z" };
            yield { id: "w2", sequence_id: 2, name: "Dropped", state: "s-cancel", priority: "none", assignees: [], created_at: "2026-08-01T00:00:00Z" };
          },
        },
      });

      const report = await buildWorkItemReport(one(client), { status: "all" });

      assert.equal(report.counts.open, 1);
      assert.equal(report.counts.done, 0);
      assert.equal(report.counts.cancelled, 1);
      assert.equal(report.counts.open + report.counts.done + report.counts.cancelled, report.counts.total);
    });

    it("byGroup keys are the state groups, plus intake", async () => {
      const report = await buildWorkItemReport(one(), { status: "all", intake: "include" });
      assert.equal(report.counts.byGroup.backlog, 1);
      assert.equal(report.counts.byGroup.intake, 1);
    });
  });
});
