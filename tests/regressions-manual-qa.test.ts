import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { PlaneClient } from "../src/client.js";
import {
  NotFoundError,
  UsageError,
  EXIT_OK,
  EXIT_FAILURE,
  EXIT_USAGE,
  EXIT_AUTH,
  EXIT_NOT_FOUND,
  assertWorkItemIdShape,
  resolveEffectiveConfig,
  toWorkItemRows,
  buildClient,
  runHandler,
  parseCount,
  parseHexColor,
  formatTable,
  displayWidth,
  formatDate,
  formatTimestamp,
} from "../src/cli/shared.js";
import { resolveMimeType } from "../src/cli/attachments.js";
import { resolveReportWorkspaces, handleReportWorkItems } from "../src/cli/report.js";
import { PlaneApiError } from "../src/error.js";
import { buildWorkItemReport } from "../src/reports.js";
import { handleCyclesGet } from "../src/cli/cycles.js";
import { handleModulesGet, handleModulesUpdate } from "../src/cli/modules.js";
import { handleCyclesAddWorkItems } from "../src/cli/cycles.js";
import {
  handleWorkItemsUpdate,
  handleRelationsCreate,
  handleWorkItemsSearch,
  handleWorkItemsList,
  parseOrderBy,
} from "../src/cli/work-items.js";
import { handleProjectsDelete } from "../src/cli/projects.js";
import type { Config } from "../src/cli/config.js";
import type { HandlerDeps } from "../src/cli/shared.js";

/**
 * Regresiones de la tanda de pruebas manuales del 2026-08-27 (95 casos contra
 * plane.gzl10.com). Cada caso de aquí falló en vivo antes de su arreglo; el
 * comentario dice qué se observaba, para que el siguiente que lo lea sepa qué
 * está protegiendo.
 */

function mockFetch(responses: Array<{ status: number; body?: unknown }>) {
  const original = globalThis.fetch;
  const calls: { url: string; init: RequestInit }[] = [];
  let i = 0;
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init: init ?? {} });
    const r = responses[Math.min(i++, responses.length - 1)];
    return new Response(r.status === 204 ? null : JSON.stringify(r.body ?? {}), {
      status: r.status,
      statusText: r.status === 404 ? "Not Found" : "OK",
    });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const client = () =>
  new PlaneClient({ baseUrl: "https://plane.test", apiKey: "pk", workspace: "ws", retry: { maxRetries: 0 } });

const mockConfig: Config = {
  version: 1,
  baseUrl: "https://plane.test",
  apiKey: "pk",
  workspace: "ws",
  project: "550e8400-e29b-41d4-a716-446655440000",
};

describe("QA manual · cycles transfer", () => {
  // Observado: `cycles transfer` respondía 404 {"error":"Page not found."} en
  // TODAS sus llamadas desde que existe. El test viejo pinneaba esa ruta.
  it("uses transfer-issues, the only path the API serves", async () => {
    const mock = mockFetch([{ status: 200 }]);
    try {
      await client().cycles.transfer("p1", "c1", "c2");
      assert.ok(mock.calls[0].url.endsWith("/cycles/c1/transfer-issues/"), mock.calls[0].url);
    } finally { mock.restore(); }
  });
});

describe("QA manual · work items delete", () => {
  // Observado: no existía ni en el SDK ni en el CLI, mientras que borrar un
  // proyecto entero en cascada sí. La API responde 204 desde siempre.
  it("deletes a work item", async () => {
    const mock = mockFetch([{ status: 204 }]);
    try {
      await client().workItems.delete("p1", "wi1");
      assert.equal(mock.calls[0].init.method, "DELETE");
      assert.ok(mock.calls[0].url.endsWith("/projects/p1/work-items/wi1/"));
    } finally { mock.restore(); }
  });
});

describe("QA manual · work item links", () => {
  // Observado: solo existía create, así que un link creado desde el cliente era
  // invisible e imborrable desde el cliente.
  it("lists links", async () => {
    const mock = mockFetch([{ status: 200, body: { results: [{ id: "l1", url: "https://x" }], next_page_results: false } }]);
    try {
      const page = await client().workItems.links.list("p1", "wi1");
      assert.equal(page.items.length, 1);
      assert.equal(page.items[0].url, "https://x");
    } finally { mock.restore(); }
  });

  it("gets a link, and returns null when it is gone", async () => {
    const mock = mockFetch([{ status: 404, body: { error: "not found" } }]);
    try {
      assert.equal(await client().workItems.links.get("p1", "wi1", "l1"), null);
    } finally { mock.restore(); }
  });

  it("updates a link with PATCH", async () => {
    const mock = mockFetch([{ status: 200, body: { id: "l1", url: "https://y" } }]);
    try {
      await client().workItems.links.update("p1", "wi1", "l1", { url: "https://y" });
      assert.equal(mock.calls[0].init.method, "PATCH");
      assert.ok(mock.calls[0].url.endsWith("/links/l1/"));
    } finally { mock.restore(); }
  });

  it("deletes a link", async () => {
    const mock = mockFetch([{ status: 204 }]);
    try {
      await client().workItems.links.delete("p1", "wi1", "l1");
      assert.equal(mock.calls[0].init.method, "DELETE");
    } finally { mock.restore(); }
  });
});

describe("QA manual · get() returns null on 404", () => {
  // Observado: cycles.get y modules.get lanzaban en 404 — rompiendo la
  // convención `get() → T | null` que sí cumplen work items, projects,
  // invitations y pages — y el CLI escupía el cuerpo 404 crudo de la API.
  it("cycles.get returns null", async () => {
    const mock = mockFetch([{ status: 404, body: { error: "The requested resource does not exist." } }]);
    try {
      assert.equal(await client().cycles.get("p1", "c1"), null);
    } finally { mock.restore(); }
  });

  it("modules.get returns null", async () => {
    const mock = mockFetch([{ status: 404, body: { error: "The requested resource does not exist." } }]);
    try {
      assert.equal(await client().modules.get("p1", "m1"), null);
    } finally { mock.restore(); }
  });

  it("a 500 still throws — only 404 becomes null", async () => {
    const mock = mockFetch([{ status: 500, body: { error: "boom" } }]);
    try {
      await assert.rejects(() => client().cycles.get("p1", "c1"));
    } finally { mock.restore(); }
  });

  // Observado: el exit 4 solo lo usaba `work-items get`; cycles/modules/projects
  // get y work-items update salían 1, indistinguibles de un fallo cualquiera.
  it("the CLI turns that null into exit 4", async () => {
    const deps = {
      config: mockConfig,
      client: { cycles: { get: async () => null } } as unknown as PlaneClient,
    };
    await assert.rejects(
      () => handleCyclesGet("c1", { json: true }, deps),
      (err: unknown) => err instanceof NotFoundError && err.exitCode === EXIT_NOT_FOUND,
    );
  });

  it("same for modules", async () => {
    const deps = {
      config: mockConfig,
      client: { modules: { get: async () => null } } as unknown as PlaneClient,
    };
    await assert.rejects(
      () => handleModulesGet("m1", { json: true }, deps),
      (err: unknown) => err instanceof NotFoundError,
    );
  });
});

describe("QA manual · config show provenance", () => {
  const KEYS = ["PLANE_WORKSPACE", "PLANEC_WORKSPACE_FLAG"] as const;
  let saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    saved = {};
    for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k] as string;
    }
  });

  // Observado: `--workspace gzl10 config show` decía "(from PLANE_WORKSPACE)"
  // con esa variable SIN definir, porque el flag se reenviaba escribiéndola.
  // Es el primer comando que AGENTS.md manda mirar ante un 403 masivo, así que
  // una procedencia falsa ahí sale cara.
  it("reports the flag as the flag, not as the environment", () => {
    process.env.PLANEC_WORKSPACE_FLAG = "from-flag";
    const eff = resolveEffectiveConfig({ version: 1, workspace: "from-config" });
    assert.equal(eff.workspace.value, "from-flag");
    assert.equal(eff.workspace.source, "flag");
  });

  it("still reports the environment when it is the environment", () => {
    process.env.PLANE_WORKSPACE = "from-env";
    const eff = resolveEffectiveConfig({ version: 1, workspace: "from-config" });
    assert.equal(eff.workspace.source, "env");
  });

  it("the flag wins over the environment, and says so", () => {
    process.env.PLANE_WORKSPACE = "from-env";
    process.env.PLANEC_WORKSPACE_FLAG = "from-flag";
    const eff = resolveEffectiveConfig({ version: 1 });
    assert.equal(eff.workspace.value, "from-flag");
    assert.equal(eff.workspace.source, "flag");
  });

  it("falls back to the config file with neither", () => {
    const eff = resolveEffectiveConfig({ version: 1, workspace: "from-config" });
    assert.equal(eff.workspace.source, "config");
  });
});

describe("QA manual · tablas de work items", () => {
  const projectId = "550e8400-e29b-41d4-a716-446655440000";

  function tableClient(items: Record<string, unknown>[], states: unknown[] = []) {
    return {
      projects: { get: async () => ({ id: projectId, identifier: "PRUEBA", name: "Pruebas" }) },
      states: { list: async () => states },
      workItems: { list: async () => ({ items, hasNext: false }) },
    } as unknown as PlaneClient;
  }

  // Observado: la columna ID imprimía `693`, y `work-items get 693` lo rechaza
  // con "Invalid identifier format". La salida no se podía pegar en la entrada.
  it("prints an identifier you can paste back into the CLI", async () => {
    const rows = await toWorkItemRows(
      tableClient([]),
      projectId,
      [{ sequence_id: 693, name: "x", state: { id: "s1", name: "Todo" } }],
    );
    assert.equal(rows[0].identifier, "PRUEBA-693");
  });

  // Observado: /module-issues/ y /cycle-issues/ devuelven `state` como UUID
  // plano, así que esas dos tablas mostraban un UUID truncado donde va el
  // nombre. El arreglo de la columna State no llegaba ahí.
  it("resolves a bare state UUID to its name", async () => {
    const rows = await toWorkItemRows(
      tableClient([], [{ id: "s-uuid", name: "In Progress", group: "started" }]),
      projectId,
      [{ sequence_id: 1, name: "x", state: "s-uuid" }],
    );
    assert.equal(rows[0].state_name, "In Progress");
    assert.ok(!String(rows[0].state_name).includes("-"), "no debe quedar un UUID");
  });

  it("keeps working when the state list cannot be read", async () => {
    const failing = {
      projects: { get: async () => ({ id: projectId, identifier: "PRUEBA" }) },
      states: { list: async () => { throw new Error("403"); } },
    } as unknown as PlaneClient;

    const rows = await toWorkItemRows(failing, projectId, [
      { sequence_id: 5, name: "x", state: "s-uuid" },
    ]);
    assert.equal(rows[0].identifier, "PRUEBA-5");
  });

  it("falls back to the bare sequence when the project cannot be read", async () => {
    const failing = {
      projects: { get: async () => { throw new Error("403"); } },
      states: { list: async () => [] },
    } as unknown as PlaneClient;

    const rows = await toWorkItemRows(failing, projectId, [
      { sequence_id: 7, name: "x", state: { id: "s1", name: "Todo" } },
    ]);
    assert.equal(rows[0].identifier, "7");
  });

  it("does not fetch anything for an empty listing", async () => {
    let touched = false;
    const spy = {
      projects: { get: async () => { touched = true; return null; } },
      states: { list: async () => { touched = true; return []; } },
    } as unknown as PlaneClient;

    assert.deepEqual(await toWorkItemRows(spy, projectId, []), []);
    assert.equal(touched, false);
  });
});

describe("QA manual · escrituras que avisan o se niegan", () => {
  const mockConfig2: Config = {
    version: 1,
    baseUrl: "https://plane.test",
    apiKey: "pk",
    workspace: "ws",
    project: "550e8400-e29b-41d4-a716-446655440000",
  };

  let errors: string[];
  let originalError: typeof console.error;
  let originalLog: typeof console.log;

  beforeEach(() => {
    errors = [];
    originalError = console.error;
    originalLog = console.log;
    console.error = (...a: unknown[]) => errors.push(String(a[0]));
    console.log = () => {};
  });

  afterEach(() => {
    console.error = originalError;
    console.log = originalLog;
  });

  // Observado: un PATCH sin campos respondía 200 y movía updated_at/updated_by,
  // reescribiendo el rastro de auditoría de un work item que nadie tocó.
  it("work-items update with no fields refuses locally", async () => {
    let called = false;
    const deps = {
      config: mockConfig2,
      client: {
        workItems: { update: async () => { called = true; return {}; } },
      } as unknown as PlaneClient,
    };

    await assert.rejects(() => handleWorkItemsUpdate("PROJ-1", {}, deps), /Nothing to update/);
    assert.equal(called, false, "no debe gastarse el request");
  });

  // Observado: `relations create X --issues X` devolvía 200 y dejaba el WI
  // bloqueado por sí mismo. Y v1 no puede borrar relaciones (405), así que era
  // permanente.
  it("refuses to relate a work item to itself", async () => {
    const deps = {
      config: mockConfig2,
      client: {
        workItems: {
          get: async () => ({ id: "same-uuid", project: mockConfig2.project }),
          relations: { create: async () => { throw new Error("no debería llegar aquí"); } },
        },
      } as unknown as PlaneClient,
    };

    await assert.rejects(
      () => handleRelationsCreate("PROJ-1", { type: "blocking", issues: "PROJ-1" }, deps),
      /Cannot relate PROJ-1 to itself/,
    );
  });

  // Observado: añadir un WI a un segundo ciclo lo saca del primero y el CLI solo
  // informaba de la mitad que le pediste.
  it("says that adding to a cycle removes the item from its previous one", async () => {
    const deps = {
      config: mockConfig2,
      client: {
        workItems: { get: async () => ({ id: "wi-uuid", project: mockConfig2.project }) },
        cycles: { addWorkItems: async () => undefined },
      } as unknown as PlaneClient,
    };

    await handleCyclesAddWorkItems("c1", ["PROJ-1"], {}, deps);

    assert.ok(
      errors.some((e) => e.includes("one cycle at a time")),
      `esperaba el aviso; salió: ${JSON.stringify(errors)}`,
    );
  });
});

describe("QA manual · tanda 3", () => {
  // A) Observado: `attachments upload --file foto.png` sin --type fallaba
  // SIEMPRE con 400 {"error":"Invalid file type."}, o sea que la forma natural
  // del comando no funcionaba nunca.
  describe("attachments MIME", () => {
    it("infers the type from the extension", () => {
      assert.equal(resolveMimeType("/tmp/foto.png"), "image/png");
      assert.equal(resolveMimeType("/tmp/informe.pdf"), "application/pdf");
      assert.equal(resolveMimeType("/tmp/notas.TXT"), "text/plain");
    });

    it("lets --type win over the guess", () => {
      assert.equal(resolveMimeType("/tmp/foto.png", "application/octet-stream"), "application/octet-stream");
    });

    // Adivinar mal es peor que no adivinar: Plane rechaza el tipo desconocido
    // después de subir el fichero a S3.
    it("refuses to guess an unknown extension, naming the flag", () => {
      assert.throws(() => resolveMimeType("/tmp/cosa.xyzzy"), /Pass --type/);
      assert.throws(() => resolveMimeType("/tmp/sin-extension"), /Pass --type/);
    });
  });

  // C) Observado: Plane responde 403 (no 401) a una key inválida, así que el
  // hint que salía siempre era el de permisos — el diagnóstico equivocado para
  // el caso más común.
  describe("invalid token vs permission", () => {
    it("reads the cause from the body, not from the status", () => {
      const invalid = new PlaneApiError(403, "Forbidden", undefined, '{"detail":"Given API token is not valid"}');
      const forbidden = new PlaneApiError(403, "Forbidden", undefined, '{"detail":"You do not have permission to perform this action."}');

      assert.equal(invalid.isInvalidToken, true);
      assert.equal(forbidden.isInvalidToken, false);
      assert.equal(forbidden.isPermission, true);
    });
  });

  // E) Observado: `--workspace gzl10 report work-items --workspaces otro`
  // devolvía el informe de gzl10. La causa no era el parseo de flags: era
  // buildClient ignorando el workspace que le pasaban.
  describe("buildClient workspace precedence", () => {
    const KEYS = ["PLANE_WORKSPACE", "PLANEC_WORKSPACE_FLAG"] as const;
    let saved: Record<string, string | undefined> = {};

    beforeEach(() => {
      saved = {};
      for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
    });

    afterEach(() => {
      for (const k of KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k] as string;
      }
    });

    it("an explicit workspace beats the flag and the environment", async () => {
      process.env.PLANEC_WORKSPACE_FLAG = "from-flag";
      process.env.PLANE_WORKSPACE = "from-env";

      const client = buildClient(
        { version: 1, baseUrl: "https://plane.test", apiKey: "pk", workspace: "from-config" },
        { workspace: "explicit-one" },
      );

      const mock = mockFetch([{ status: 200, body: { results: [] } }]);
      try {
        await client.states.list("p1");
        assert.ok(
          mock.calls[0].url.includes("/workspaces/explicit-one/"),
          `fue a ${mock.calls[0].url}`,
        );
      } finally { mock.restore(); }
    });

    it("without an explicit one, the flag still wins over config", async () => {
      process.env.PLANEC_WORKSPACE_FLAG = "from-flag";
      const client = buildClient({ version: 1, baseUrl: "https://plane.test", apiKey: "pk", workspace: "from-config" });

      const mock = mockFetch([{ status: 200, body: { results: [] } }]);
      try {
        await client.states.list("p1");
        assert.ok(mock.calls[0].url.includes("/workspaces/from-flag/"));
      } finally { mock.restore(); }
    });
  });

  // F) Observado: el exit 4 solo lo daban los comandos que comprobaban null
  // antes; todos los sub-recursos salían 1 con el 404 crudo, así que un script
  // seguía teniendo que distinguir por texto.
  describe("exit code on a raw API 404", () => {
    let savedExit: typeof process.exitCode;
    let originalError: typeof console.error;

    beforeEach(() => {
      savedExit = process.exitCode;
      originalError = console.error;
      console.error = () => {};
    });

    afterEach(() => {
      console.error = originalError;
      process.exitCode = savedExit;
    });

    it("a 404 from any command exits 4", async () => {
      await runHandler(async () => {
        throw new PlaneApiError(404, "Not Found", undefined, '{"error":"The requested resource does not exist."}');
      });
      assert.equal(process.exitCode, EXIT_NOT_FOUND);
    });

    it("other API errors still exit 1", async () => {
      await runHandler(async () => {
        throw new PlaneApiError(400, "Bad Request");
      });
      assert.equal(process.exitCode, 1);
    });
  });
});

describe("QA manual · tanda 4", () => {
  // G) Observado contra 1.4.2: `--per-page -5` provoca un 500 en el servidor;
  // `0` y `abc` se descartan y DESACTIVAN la paginación (devuelven el proyecto
  // entero); `1.5` trunca a 1; `99999` vuelve 400. Cuatro comportamientos
  // distintos para cuatro formas de teclear mal un número.
  describe("count flags are validated locally", () => {
    it("rejects a negative value before it reaches the server", () => {
      assert.throws(() => parseCount("-5", "--per-page", 100), /at least 1/);
    });

    it("rejects zero, which silently disabled pagination", () => {
      assert.throws(() => parseCount("0", "--per-page", 100), /at least 1/);
    });

    it("rejects a non-number instead of ignoring it", () => {
      assert.throws(() => parseCount("abc", "--per-page", 100), /at least 1/);
    });

    it("rejects a fraction instead of truncating it", () => {
      assert.throws(() => parseCount("1.5", "--per-page", 100), /at least 1/);
    });

    it("rejects a value above the API cap, naming the cap", () => {
      assert.throws(() => parseCount("99999", "--per-page", 100), /above 100/);
    });

    it("accepts a legitimate value and leaves an absent flag alone", () => {
      assert.equal(parseCount("50", "--per-page", 100), 50);
      assert.equal(parseCount(undefined, "--per-page", 100), undefined);
    });

    it("has no cap where the endpoint has none", () => {
      assert.equal(parseCount("5000", "--limit"), 5000);
    });
  });

  // H) Observado: un work item cuyo nombre lleva un salto de línea (la UI de
  // Plane los permite) partía la fila en dos y desalineaba todas las columnas.
  describe("control characters in a table cell", () => {
    it("keeps the row on one line", () => {
      const table = formatTable(
        [{ name: "linea1\nlinea2", other: "x" }],
        [{ key: "name", label: "Name", width: 30 }, { key: "other", label: "Other", width: 5 }],
      );
      const rows = table.split("\n");
      assert.equal(rows.length, 3, "cabecera, separador y UNA fila");
      assert.ok(rows[2].includes("linea1 linea2"));
    });

    it("survives tabs and carriage returns too", () => {
      const table = formatTable(
        [{ name: "a\tb\r\nc" }],
        [{ key: "name", label: "Name", width: 20 }],
      );
      assert.equal(table.split("\n").length, 3);
    });
  });

  // Regresión introducida al arreglar dos cosas correctas: el flag global
  // dejó de reenviarse como PLANE_WORKSPACE (provenance falsa) y dejó de pisar
  // a --workspaces (informe equivocado). Entre ambas, `report` perdió la capa
  // de contexto de MÁS precedencia y `--workspace X report work-items` empezó a
  // fallar con "No workspaces to report on".
  describe("report workspace fallback covers all three layers", () => {
    const KEYS = ["PLANE_WORKSPACE", "PLANEC_WORKSPACE_FLAG"] as const;
    let saved: Record<string, string | undefined> = {};

    beforeEach(() => {
      saved = {};
      for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
    });

    afterEach(() => {
      for (const k of KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k] as string;
      }
    });

    it("falls back to the global --workspace flag", () => {
      process.env.PLANEC_WORKSPACE_FLAG = "from-flag";
      assert.deepEqual(resolveReportWorkspaces({}, { version: 1 }), ["from-flag"]);
    });

    it("falls back to PLANE_WORKSPACE", () => {
      process.env.PLANE_WORKSPACE = "from-env";
      assert.deepEqual(resolveReportWorkspaces({}, { version: 1 }), ["from-env"]);
    });

    it("falls back to the saved workspace", () => {
      assert.deepEqual(resolveReportWorkspaces({}, { version: 1, workspace: "from-config" }), ["from-config"]);
    });

    // Y lo que NO debe volver: el flag global no puede pisar la lista explícita.
    it("--workspaces still beats the global flag", () => {
      process.env.PLANEC_WORKSPACE_FLAG = "from-flag";
      assert.deepEqual(resolveReportWorkspaces({ workspaces: ["asked-for"] }, { version: 1 }), ["asked-for"]);
    });

    it("the saved report list still beats every single-workspace layer", () => {
      process.env.PLANEC_WORKSPACE_FLAG = "from-flag";
      assert.deepEqual(
        resolveReportWorkspaces({}, { version: 1, workspaces: ["ws1", "ws2"] }),
        ["ws1", "ws2"],
      );
    });
  });
});

describe("QA manual · huecos de cobertura", () => {
  let logs: string[];
  let originalLog: typeof console.log;
  let originalError: typeof console.error;

  beforeEach(() => {
    logs = [];
    originalLog = console.log;
    originalError = console.error;
    console.log = (...a: unknown[]) => logs.push(String(a[0]));
    console.error = () => {};
  });

  afterEach(() => {
    console.log = originalLog;
    console.error = originalError;
  });

  // B) Observado: con intake_view en false, `intake list` devuelve lista vacía
  // en vez de error, así que el inventario del borrado degradaba a un `0`
  // confiado sobre una cola con items reales. El inventario es lo único que
  // sostiene la ceremonia de confirmación de un borrado en cascada.
  describe("projects delete blast radius", () => {
    const project = {
      id: "p1",
      identifier: "QAM",
      name: "QA manual",
      intake_view: false,
    };

    function deleteClient() {
      return {
        projects: { get: async () => project, delete: async () => undefined },
        workItems: { list: async () => ({ items: [{ id: "w1" }], hasNext: false, total: 1 }) },
        modules: { list: async () => [] },
        cycles: { list: async () => [] },
        intake: {
          // Esto es lo que hace Plane con el toggle apagado: 200 y lista vacía.
          list: async () => ({ items: [], hasNext: false, total: 0 }),
        },
      } as unknown as PlaneClient;
    }

    it("says the intake cannot be listed instead of claiming zero", async () => {
      await handleProjectsDelete(
        "550e8400-e29b-41d4-a716-446655440000",
        { dryRun: true },
        { config: mockConfig, client: deleteClient() },
      );

      const printed = logs.join("\n");
      assert.ok(printed.includes("intake: ?"), `salió: ${printed}`);
      assert.ok(!/intake: 0/.test(printed), "un 0 aquí sería una mentira sobre contenido real");
    });

    it("still counts the intake when the feature is on", async () => {
      const enabled = {
        projects: { get: async () => ({ ...project, intake_view: true }), delete: async () => undefined },
        workItems: { list: async () => ({ items: [], hasNext: false, total: 0 }) },
        modules: { list: async () => [] },
        cycles: { list: async () => [] },
        intake: { list: async () => ({ items: [{ id: "i1" }, { id: "i2" }], hasNext: false, total: 2 }) },
      } as unknown as PlaneClient;

      await handleProjectsDelete(
        "550e8400-e29b-41d4-a716-446655440000",
        { dryRun: true },
        { config: mockConfig, client: enabled },
      );

      assert.ok(logs.join("\n").includes("intake: 2"));
    });
  });

  // search: la única tabla donde el prefijo sale gratis, porque el endpoint ya
  // devuelve project__identifier en cada fila. Y la que más lo necesita: search
  // es workspace-level, así que mezcla proyectos.
  describe("search identifier", () => {
    const searchClient = {
      workItems: {
        search: async () => [
          { id: "a", sequence_id: 707, name: "uno", project__identifier: "PRUEBA" },
          { id: "b", sequence_id: 42, name: "dos", project__identifier: "PCL" },
        ],
      },
    } as unknown as PlaneClient;

    const deps: HandlerDeps = {
      config: { version: 1 as const, baseUrl: "https://plane.test", apiKey: "pk", workspace: "ws" },
      client: searchClient,
    };

    it("composes the identifier from the row itself, with no extra request", async () => {
      await handleWorkItemsSearch("x", { json: false }, deps);

      const table = logs.join("\n");
      assert.ok(table.includes("PRUEBA-707"), table);
      assert.ok(table.includes("PCL-42"), table);
    });

    it("leaves --json untouched: no invented identifier key", async () => {
      await handleWorkItemsSearch("x", { json: true }, deps);

      const parsed = JSON.parse(logs[0]) as Array<Record<string, unknown>>;
      assert.equal(parsed[0].sequence_id, 707);
      assert.equal(parsed[0].identifier, undefined);
    });
  });
});

describe("QA manual · tanda 5", () => {
  const client = () =>
    new PlaneClient({ baseUrl: "https://plane.test", apiKey: "pk", workspace: "ws", retry: { maxRetries: 0 } });

  // J) Observado: states solo tenía list y labels solo list+create, aunque la
  // v1 sirve los cuatro verbos en ambos. Consecuencia medida: 53 labels `test-*`
  // acumuladas en el proyecto de pruebas que nada salvo curl podía limpiar.
  describe("states CRUD", () => {
    it("creates with the colour the API demands", async () => {
      const mock = mockFetch([{ status: 200, body: { id: "s1", name: "x", group: "started" } }]);
      try {
        await client().states.create("p1", { name: "x", color: "#aabbcc", group: "started" });
        const body = JSON.parse(mock.calls[0].init.body as string) as Record<string, unknown>;
        assert.equal(mock.calls[0].init.method, "POST");
        // Sin color la API responde 400 {"color":["This field is required."]}.
        assert.equal(body.color, "#aabbcc");
      } finally { mock.restore(); }
    });

    it("gets, updates and deletes", async () => {
      const mock = mockFetch([
        { status: 200, body: { id: "s1", name: "x" } },
        { status: 200, body: { id: "s1", name: "y" } },
        { status: 204 },
      ]);
      try {
        assert.ok(await client().states.get("p1", "s1"));
        await client().states.update("p1", "s1", { name: "y" });
        await client().states.delete("p1", "s1");
        assert.deepEqual(mock.calls.map((c) => c.init.method ?? "GET"), ["GET", "PATCH", "DELETE"]);
      } finally { mock.restore(); }
    });

    it("returns null for a state that is gone", async () => {
      const mock = mockFetch([{ status: 404, body: { error: "nope" } }]);
      try {
        assert.equal(await client().states.get("p1", "s1"), null);
      } finally { mock.restore(); }
    });
  });

  describe("labels CRUD", () => {
    it("gets, updates and deletes", async () => {
      const mock = mockFetch([
        { status: 200, body: { id: "l1", name: "bug" } },
        { status: 200, body: { id: "l1", name: "chore" } },
        { status: 204 },
      ]);
      try {
        assert.ok(await client().labels.get("p1", "l1"));
        await client().labels.update("p1", "l1", { name: "chore" });
        await client().labels.delete("p1", "l1");
        assert.deepEqual(mock.calls.map((c) => c.init.method ?? "GET"), ["GET", "PATCH", "DELETE"]);
      } finally { mock.restore(); }
    });
  });

  // I) Observado: `labels create --color verde` → 200, y el label queda con
  // color "verde". Ni la API ni el CLI lo comprobaban, pese a que el help dice
  // "(hex, e.g. #ff0000)".
  describe("hex colour validation", () => {
    it("accepts both hex forms", () => {
      assert.equal(parseHexColor("#ff0000"), "#ff0000");
      assert.equal(parseHexColor("#F00"), "#F00");
      assert.equal(parseHexColor("  #abc  "), "#abc");
    });

    it("rejects a colour name, which the API would happily store", () => {
      assert.throws(() => parseHexColor("verde"), /expected a hex colour/);
      assert.throws(() => parseHexColor("red"), /expected a hex colour/);
    });

    it("rejects a hex without the hash and a wrong-length one", () => {
      assert.throws(() => parseHexColor("ff0000"), /expected a hex colour/);
      assert.throws(() => parseHexColor("#ff00"), /expected a hex colour/);
    });

    it("leaves an absent flag alone", () => {
      assert.equal(parseHexColor(undefined), undefined);
    });
  });

  // Fleco del peer: el quoting del CSV miraba coma, comilla y \n, pero no \r.
  // RFC 4180 exige entrecomillar CR, y un parser que normalice finales de línea
  // parte ese registro en dos.
  describe("CSV quoting", () => {
    async function csvOf(name: string): Promise<string> {
      const logs: string[] = [];
      const originalLog = console.log;
      const originalError = console.error;
      console.log = (...a: unknown[]) => logs.push(String(a[0]));
      console.error = () => {};
      try {
        await handleReportWorkItems(
          { workspaces: ["ws"], status: "all", format: "csv" },
          {
            config: mockConfig,
            client: {
              projects: { async *listAll() { yield { id: "p1", identifier: "PRUEBA", name: "P" }; } },
              states: { list: async () => [{ id: "s1", name: "Todo", group: "unstarted" }] },
              workItems: {
                async *listAll() {
                  yield { id: "w1", sequence_id: 1, name, state: "s1", priority: "none", assignees: [], created_at: "2026-08-01T00:00:00Z" };
                },
              },
              intake: { async *listAll() {} },
            } as unknown as PlaneClient,
          },
        );
        return logs.join("\n");
      } finally {
        console.log = originalLog;
        console.error = originalError;
      }
    }

    it("quotes a carriage return", async () => {
      const csv = await csvOf("con\rcarry");
      assert.ok(csv.includes('"con\rcarry"'), JSON.stringify(csv));
    });

    it("quotes a tab", async () => {
      const csv = await csvOf("con\tcolumna");
      assert.ok(csv.includes('"con\tcolumna"'));
    });

    it("still quotes commas, quotes and newlines", async () => {
      assert.ok((await csvOf('a, b')).includes('"a, b"'));
      assert.ok((await csvOf('con "comillas"')).includes('""comillas""'));
      assert.ok((await csvOf("dos\nlineas")).includes('"dos\nlineas"'));
    });

    it("leaves a plain value unquoted", async () => {
      const csv = await csvOf("sencillo");
      assert.ok(csv.includes(",sencillo,"), csv);
    });
  });
});

describe("QA manual · tanda 6", () => {
  // O) Observado con curl: `order_by=name` devuelve el mismo orden que sin
  // parámetro, igual que `order_by=inventado`. `name` es la trampa: es por
  // donde un humano ordenaría primero, no está en el union (hay state__name,
  // no name) y el resultado es un listado desordenado que parece ordenado.
  describe("--order-by is validated, because the API ignores it in silence", () => {
    it("accepts the values Plane honours", () => {
      assert.equal(parseOrderBy("created_at"), "created_at");
      assert.equal(parseOrderBy("-priority"), "-priority");
      assert.equal(parseOrderBy("state__name"), "state__name");
      assert.equal(parseOrderBy(undefined), undefined);
    });

    it("rejects a bare name, and says what to use instead", () => {
      assert.throws(() => parseOrderBy("name"), /no bare `name`/);
    });

    it("rejects anything else, explaining why silence is the problem", () => {
      assert.throws(() => parseOrderBy("inventado"), /ignores an unknown value in silence/);
    });
  });

  // Q) Enum cerrado que no se validaba: se gastaba el request para que la API
  // contestara 400.
  describe("module status", () => {
    it("is validated before the request", async () => {
      let called = false;
      const deps: HandlerDeps = {
        config: mockConfig,
        client: { modules: { update: async () => { called = true; return {}; } } } as unknown as PlaneClient,
      };

      await assert.rejects(
        () => handleModulesUpdate("m1", { status: "inventado" }, deps),
        /Invalid --status inventado/,
      );
      assert.equal(called, false);
    });
  });

  // Fechas: cada bound se validaba por separado, pero no su relación. Una
  // ventana invertida no casa nada y el informe decía "0 item(s)", que se lee
  // como "no hay trabajo" en vez de "te has cambiado las fechas".
  describe("report date window", () => {
    it("refuses a window that ends before it starts", async () => {
      await assert.rejects(
        () =>
          buildWorkItemReport(
            [{ workspace: "ws", client: {} as unknown as PlaneClient }],
            { since: "2026-12-01", until: "2026-01-01" },
          ),
        /Empty date window/,
      );
    });

    it("allows a single-day window", async () => {
      const client = {
        projects: { async *listAll() { /* vacío */ } },
      } as unknown as PlaneClient;

      const report = await buildWorkItemReport(
        [{ workspace: "ws", client }],
        { since: "2026-08-27", until: "2026-08-27" },
      );
      assert.equal(report.counts.total, 0);
    });
  });
});

describe("QA manual · tanda 7", () => {
  // T) Observado: el ancho se medía en code points. 13 caracteres CJK dibujan 26
  // columnas y desbordaban una columna de 20 sin activar el truncado; un emoji
  // ZWJ cuenta 7 code points y dibuja 2, así que su fila quedaba corta. Y al
  // cortar por code points se partía el grafema, dejando un ZWJ colgando que el
  // terminal intenta unir con lo siguiente.
  describe("table width is measured in terminal columns", () => {
    it("counts a CJK character as two columns", () => {
      assert.equal(displayWidth("日本語"), 6);
      assert.equal(displayWidth("abc"), 3);
    });

    it("counts a ZWJ emoji as one grapheme of two columns", () => {
      assert.equal(displayWidth("👨‍👩‍👧‍👦"), 2);
    });

    it("counts Arabic as single-width", () => {
      assert.equal(displayWidth("العربية"), 7);
    });

    it("pads every row to the same visible width", () => {
      const columns = [
        { key: "name", label: "Name", width: 20 },
        { key: "state", label: "State", width: 10 },
      ];
      const table = formatTable(
        [
          { name: "ascii", state: "Todo" },
          { name: "日本語のテストです長い名前", state: "Todo" },
          { name: "👨‍👩‍👧‍👦 familia", state: "Todo" },
          { name: "العربية اختبار", state: "Todo" },
        ],
        columns,
      );

      const widths = table.split("\n").slice(2).map((row) => displayWidth(row));
      assert.equal(new Set(widths).size, 1, `anchos distintos: ${widths.join(", ")}`);
    });

    it("truncates wide text that would overflow, which it never used to", () => {
      const table = formatTable(
        [{ name: "日本語のテストです長い名前" }],
        [{ key: "name", label: "Name", width: 12 }],
      );
      const row = table.split("\n")[2];
      assert.ok(row.includes("…"), row);
      assert.equal(displayWidth(row), 12);
    });

    it("never cuts a grapheme in half", () => {
      const table = formatTable(
        [{ name: "👨‍👩‍👧‍👦👨‍👩‍👧‍👦👨‍👩‍👧‍👦" }],
        [{ key: "name", label: "Name", width: 5 }],
      );
      const row = table.split("\n")[2];
      // Un ZWJ colgando al final es la firma del corte a mitad de cluster.
      assert.ok(!row.replace(/\s+$/, "").endsWith("‍"), JSON.stringify(row));
      assert.ok(!row.includes("‍…"), "no debe quedar un ZWJ antes de la elipsis");
    });
  });

  // U) Observado: con --intake-only, --status y --group se ignoraban en silencio
  // y devolvían exactamente las mismas filas. Es la familia de fallo contra la
  // que existe este cliente, reproducida por nosotros.
  describe("contradictory report flags are refused, not ignored", () => {
    const deps = (): HandlerDeps => ({
      config: mockConfig,
      client: {
        projects: { async *listAll() { /* no hace falta */ } },
      } as unknown as PlaneClient,
    });

    it("refuses --intake-only with --status", async () => {
      await assert.rejects(
        () => handleReportWorkItems({ workspaces: ["ws"], intakeOnly: true, status: "done" }, deps()),
        /cannot be combined with --status or --group/,
      );
    });

    it("refuses --intake-only with --group", async () => {
      await assert.rejects(
        () => handleReportWorkItems({ workspaces: ["ws"], intakeOnly: true, group: "backlog" }, deps()),
        /cannot be combined/,
      );
    });

    it("allows --intake-only with the filters that do apply", async () => {
      await assert.doesNotReject(() =>
        handleReportWorkItems({ workspaces: ["ws"], intakeOnly: true, since: "2026-08-01", json: true }, deps()),
      );
    });

    // W) --json es atajo de --format json, así que pedir otro formato a la vez
    // es una contradicción explícita. Se resolvía en silencio a favor de --json.
    it("refuses --json together with a different --format", async () => {
      await assert.rejects(
        () => handleReportWorkItems({ workspaces: ["ws"], format: "csv", json: true }, deps()),
        /not both/,
      );
    });

    it("allows --json with --format json, which says the same thing twice", async () => {
      await assert.doesNotReject(() =>
        handleReportWorkItems({ workspaces: ["ws"], format: "json", json: true }, deps()),
      );
    });
  });

  // X) Observado: --per-page se validaba antes de tocar la red y --order-by
  // después de resolver el proyecto, así que el mismo error de tecleo fallaba
  // distinto según el flag y gastaba requests para culpar al proyecto.
  describe("flags are validated before the project is resolved", () => {
    it("does not resolve the project to report a bad --order-by", async () => {
      let touched = false;
      const deps: HandlerDeps = {
        config: mockConfig,
        client: {
          projects: {
            async *listAll() {
              touched = true;
            },
          },
        } as unknown as PlaneClient,
      };

      await assert.rejects(
        () => handleWorkItemsList({ project: "NOEXISTE", orderBy: "name" }, deps),
        /Invalid --order-by/,
      );
      assert.equal(touched, false, "no debe gastarse un listado de proyectos");
    });
  });
});

describe("QA manual · el contrato de exit codes se cumple entero", () => {
  // El fallo que esto fija no fue un bug de código: fue documentar en README y
  // llms.txt un contrato ("2 = mal uso: flag desconocido, argumento que falta,
  // opciones contradictorias") que el código no cumplía en NINGUNO de los tres
  // ejemplos, mientras el 2 existía solo para un caso no documentado. Un
  // contrato escrito que no se cumple es peor que no tenerlo, porque alguien lo
  // programa.
  let savedExit: typeof process.exitCode;
  let originalError: typeof console.error;

  beforeEach(() => {
    savedExit = process.exitCode;
    originalError = console.error;
    console.error = () => {};
  });

  afterEach(() => {
    console.error = originalError;
    process.exitCode = savedExit;
  });

  it("a local validation failure is usage (2), not a generic failure", async () => {
    await runHandler(async () => {
      throw new UsageError("Invalid --per-page -5");
    });
    assert.equal(process.exitCode, EXIT_USAGE);
    assert.equal(EXIT_USAGE, 2);
  });

  it("every flag validator raises usage, not a bare Error", () => {
    const cases: Array<() => unknown> = [
      () => parseCount("-5", "--per-page", 100),
      () => parseCount("abc", "--limit"),
      () => parseHexColor("verde"),
      () => parseOrderBy("name"),
      () => assertWorkItemIdShape("%%%"),
      () => assertWorkItemIdShape(""),
    ];

    for (const run of cases) {
      assert.throws(run, (err: unknown) => {
        assert.ok(err instanceof UsageError, `no es UsageError: ${String(err)}`);
        assert.equal((err as UsageError).exitCode, EXIT_USAGE);
        return true;
      });
    }
  });

  // El mismo input daba 1 en `get` (que validaba por su cuenta) y 2 en `delete`
  // (que pasa por el validador compartido).
  it("the same malformed id gives the same code wherever it is passed", () => {
    const codes = new Set<number>();
    for (const attempt of [() => assertWorkItemIdShape("%%%"), () => assertWorkItemIdShape("a b")]) {
      try {
        attempt();
      } catch (err) {
        codes.add((err as UsageError).exitCode);
      }
    }
    assert.deepEqual([...codes], [EXIT_USAGE]);
  });

  it("keeps the other codes distinct", () => {
    assert.equal(EXIT_OK, 0);
    assert.equal(EXIT_FAILURE, 1);
    assert.equal(EXIT_USAGE, 2);
    assert.equal(EXIT_NOT_FOUND, 3);
    assert.equal(EXIT_AUTH, 4);
    assert.equal(new Set([EXIT_OK, EXIT_FAILURE, EXIT_USAGE, EXIT_NOT_FOUND, EXIT_AUTH]).size, 5);
  });

  it("a rejected credential is 4, whether Plane said 401 or 403", async () => {
    for (const status of [401, 403]) {
      await runHandler(async () => {
        throw new PlaneApiError(status, "nope");
      });
      assert.equal(process.exitCode, EXIT_AUTH, `status ${status}`);
    }
  });

  it("an HTML error page is summarised, not dumped", async () => {
    const messages: string[] = [];
    console.error = (...a: unknown[]) => messages.push(String(a[0]));

    await runHandler(async () => {
      throw new PlaneApiError(400, "Bad Request", undefined, "<html>\n<head><title>400</title></head>\n<body>cloudflare</body>\n</html>");
    });

    assert.ok(messages.some((m) => m.includes("HTML error page")), messages.join("|"));
    assert.ok(!messages.some((m) => m.includes("<head>")), "no debe volcarse el HTML");
  });
});

describe("QA manual · fechas y zonas horarias", () => {
  // Observado en vivo: un ciclo creado con `--end-date 2027-03-15` se mostraba
  // como 2027-03-16 en Madrid y su inicio caía al día anterior en Los Ángeles.
  // La trampa está en que ciclos y módulos llaman `start_date` a campos de tipo
  // distinto: el módulo guarda "2027-03-01" y el ciclo
  // "2027-03-01T01:00:01+01:00". Aplicarles el mismo criterio parece lo
  // coherente y es justo lo que falla.
  it("leaves a date-only value alone (modules)", () => {
    assert.equal(formatDate("2027-03-01"), "2027-03-01");
    assert.equal(formatDate("2026-12-31"), "2026-12-31");
  });

  it("renders a cycle timestamp as the day it represents, in UTC", () => {
    // 23:59Z del día 15, que es como Plane ancla un --end-date 2027-03-15.
    assert.equal(formatDate("2027-03-16T00:59:00+01:00"), "2027-03-15");
    assert.equal(formatDate("2027-03-01T01:00:01+01:00"), "2027-03-01");
  });

  it("gives the same day whatever the machine's timezone is", () => {
    const saved = process.env.TZ;
    try {
      for (const tz of ["UTC", "Europe/Madrid", "America/Los_Angeles", "Pacific/Kiritimati", "Pacific/Midway"]) {
        process.env.TZ = tz;
        assert.equal(formatDate("2027-03-16T00:59:00+01:00"), "2027-03-15", `en ${tz}`);
        assert.equal(formatDate("2027-03-01"), "2027-03-01", `en ${tz}`);
      }
    } finally {
      if (saved === undefined) delete process.env.TZ;
      else process.env.TZ = saved;
    }
  });

  // Y lo contrario: un comentario SÍ es un instante y se lee en hora local.
  it("a comment timestamp stays local, because that one is a moment", () => {
    const local = formatTimestamp("2026-08-27T21:07:00.000Z");
    assert.match(local, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    // No asertamos la hora concreta (depende de la TZ de la máquina), sino que
    // NO es la representación UTC cuando la máquina no está en UTC.
    const d = new Date("2026-08-27T21:07:00.000Z");
    const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    assert.equal(local, expected);
  });

  it("passes through anything that is not a date", () => {
    assert.equal(formatDate("mañana"), "mañana");
    assert.equal(formatDate(undefined), "");
    assert.equal(formatDate(null), "");
  });
});

describe("QA manual · paginación de comentarios", () => {
  // El QA manual verificó que los números cuadran (104 comentarios: la API, el
  // --json, la tabla y el hint dicen 104), pero NO pudo ejercitar el camino
  // multipágina: sin `per_page` la instancia devuelve todo en una respuesta, y
  // `comments list` no expone ese flag. O sea que este bucle no lo había
  // recorrido nadie contra Plane — y es exactamente la forma en la que el
  // cursor infinito mordió dos veces (0.18.0 y otra vez en intake).
  function mockFetchLocal(responses: Array<{ status: number; body?: unknown }>) {
    const original = globalThis.fetch;
    const calls: string[] = [];
    let i = 0;
    globalThis.fetch = async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      calls.push(url);
      const r = responses[Math.min(i++, responses.length - 1)];
      return new Response(JSON.stringify(r.body ?? {}), { status: r.status, statusText: "OK" });
    };
    return { calls, restore: () => { globalThis.fetch = original; } };
  }

  const client = () =>
    new PlaneClient({ baseUrl: "https://plane.test", apiKey: "pk", workspace: "ws", retry: { maxRetries: 0 } });

  it("walks every page of comments", async () => {
    const mock = mockFetchLocal([
      { status: 200, body: { results: [{ id: "c1" }], next_cursor: "100:1:0", next_page_results: true } },
      { status: 200, body: { results: [{ id: "c2" }], next_cursor: "100:2:0", next_page_results: false } },
    ]);
    try {
      const comments = await client().workItems.comments.list("p1", "wi1");
      assert.deepEqual(comments.map((c) => c.id), ["c1", "c2"]);
      assert.equal(mock.calls.length, 2);
    } finally { mock.restore(); }
  });

  // El shape que causó el bucle infinito: última página CON cursor.
  it("stops on next_page_results even though the last page carries a cursor", async () => {
    const mock = mockFetchLocal([
      { status: 200, body: { results: [{ id: "c1" }], next_cursor: "100:1:0", next_page_results: false } },
    ]);
    try {
      const passthrough = globalThis.fetch;
      globalThis.fetch = async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        if (mock.calls.length >= 3) {
          throw new Error("pagination did not stop: the cursor was followed on a page with next_page_results false");
        }
        return passthrough(input, init);
      };
      const comments = await client().workItems.comments.list("p1", "wi1");
      assert.equal(comments.length, 1);
      assert.equal(mock.calls.length, 1, "la última página no debe seguirse");
    } finally { mock.restore(); }
  });

  // Y el número que se afirma en pantalla: el hint de `work-items get` lo saca
  // de esta lista, así que una lectura corta lo convertía en una cifra falsa.
  it("the count asserted on screen covers every page", async () => {
    const mock = mockFetchLocal([
      { status: 200, body: { results: [{ id: "c1" }, { id: "c2" }], next_cursor: "1", next_page_results: true } },
      { status: 200, body: { results: [{ id: "c3" }], next_cursor: "2", next_page_results: false } },
    ]);
    try {
      assert.equal((await client().workItems.comments.list("p1", "wi1")).length, 3);
    } finally { mock.restore(); }
  });
});
