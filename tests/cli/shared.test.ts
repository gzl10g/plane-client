import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runHandler,
  parseRefList,
  resolveHtmlOption,
  resolveProjectFromOpts,
  resolveOptionalProjectFromOpts,
  resolveEffectiveConfig,
  resolveWorkspaceForDisplay,
  resolveWorkItemId,
  resolveWorkItemIds,
  buildClient,
  formatTable,
  formatOutput,
  warnIfEmpty,
  warnIfTruncated,
  reportAction,
  toWorkItemRow,
  AbortedError,
  NotFoundError,
  EXIT_NOT_FOUND,
  WORK_ITEM_COLUMNS,
  readSecretFromStdin,
} from "../../src/cli/shared.js";
import { createRateLimitState } from "../../src/rate-limit.js";
import type { Config } from "../../src/cli/config.js";
import type { PlaneClient } from "../../src/client.js";
import { PlaneApiError } from "../../src/error.js";

describe("shared CLI utilities", () => {
  // Todo lo que se resuelve aquí lee el entorno con precedencia sobre el fichero,
  // así que la suite entera corre con el entorno limpio: una shell con estas
  // variables puestas (las exporta tests/integration/.env.example) tumbaría los
  // casos de "missing" y los de fallback a config. Los tests que necesitan una
  // variable la ponen ellos, explícitamente.
  const PLANE_ENV_KEYS = [
    "PLANE_BASE_URL",
    "PLANE_API_KEY",
    "PLANE_WORKSPACE",
    "PLANE_PROJECT",
  ] as const;
  let savedPlaneEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedPlaneEnv = {};
    for (const key of PLANE_ENV_KEYS) {
      savedPlaneEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of PLANE_ENV_KEYS) {
      const previous = savedPlaneEnv[key];
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
  });


  // La precedencia flag > PLANE_PROJECT > config la implementa ahora
  // resolveProjectFromOpts; estos casos venían del resolvedor UUID-only que
  // sustituyó, y siguen aquí porque la regla no ha cambiado.
  describe("project precedence", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    const other = "660e8400-e29b-41d4-a716-446655440111";

    async function withEnv<T>(value: string | undefined, fn: () => Promise<T>): Promise<T> {
      const previous = process.env.PLANE_PROJECT;
      if (value === undefined) delete process.env.PLANE_PROJECT;
      else process.env.PLANE_PROJECT = value;
      try {
        return await fn();
      } finally {
        if (previous === undefined) delete process.env.PLANE_PROJECT;
        else process.env.PLANE_PROJECT = previous;
      }
    }

    it("prioritises the flag over env and config", async () => {
      await withEnv(other, async () => {
        assert.equal(
          await resolveProjectFromOpts({ project: uuid }, { version: 1, project: other }),
          uuid,
        );
      });
    });

    it("uses env when the flag is absent", async () => {
      await withEnv(uuid, async () => {
        assert.equal(
          await resolveProjectFromOpts({}, { version: 1, project: other }),
          uuid,
        );
      });
    });

    it("uses the config project when flag and env are absent", async () => {
      await withEnv(undefined, async () => {
        assert.equal(
          await resolveProjectFromOpts({}, { version: 1, project: uuid }),
          uuid,
        );
      });
    });

    it("accepts an uppercase UUID (validation is case-insensitive)", async () => {
      const uppercase = "550E8400-E29B-41D4-A716-446655440000";
      assert.equal(
        await resolveProjectFromOpts({ project: uppercase }, { version: 1 }),
        uppercase,
      );
    });
  });

  describe("buildClient", () => {
    it("prefers PLANE_API_KEY over the config file", () => {
      process.env.PLANE_API_KEY = "from-env";
      const client = buildClient({
        version: 1,
        baseUrl: "http://localhost",
        apiKey: "from-config",
        workspace: "workspace",
      });
      assert.equal((client as unknown as { apiKey: string }).apiKey, "from-env");
    });

    it("prefers PLANE_BASE_URL over the config file", () => {
      process.env.PLANE_BASE_URL = "http://from-env";
      const client = buildClient({
        version: 1,
        baseUrl: "http://from-config",
        apiKey: "key",
        workspace: "workspace",
      });
      assert.equal((client as unknown as { baseUrl: string }).baseUrl, "http://from-env");
    });

    it("builds from the env alone when the config file has nothing", () => {
      process.env.PLANE_BASE_URL = "http://from-env";
      process.env.PLANE_API_KEY = "from-env";
      const client = buildClient({ version: 1, workspace: "workspace" });
      assert.equal((client as unknown as { apiKey: string }).apiKey, "from-env");
    });

    it("should throw error when baseUrl is missing", () => {
      const config: Config = {
        version: 1,
        apiKey: "key",
        workspace: "workspace",
      };
      assert.throws(
        () => buildClient(config),
        /baseUrl not configured/,
      );
    });

    it("should throw error when apiKey is missing", () => {
      const config: Config = {
        version: 1,
        baseUrl: "http://localhost",
        workspace: "workspace",
      };
      assert.throws(
        () => buildClient(config),
        /apiKey not configured/,
      );
    });

    it("should throw error when workspace is missing", () => {
      const config: Config = {
        version: 1,
        baseUrl: "http://localhost",
        apiKey: "key",
      };
      assert.throws(
        () => buildClient(config),
        /workspace not configured/,
      );
    });

    it("should create client with valid config", () => {
      const config: Config = {
        version: 1,
        baseUrl: "http://localhost:8000",
        apiKey: "test-key",
        workspace: "test-workspace",
      };
      const client = buildClient(config);
      assert.ok(client);
      assert.ok(client.workItems);
      assert.ok(client.cycles);
    });
  });

  describe("formatTable", () => {
    it("should format table with headers, separator and rows", () => {
      const rows = [
        { id: "1", name: "Alice", status: "active" },
        { id: "2", name: "Bob", status: "inactive" },
      ];
      const columns = [
        { key: "id", label: "ID" },
        { key: "name", label: "Name" },
        { key: "status", label: "Status" },
      ];
      const result = formatTable(rows, columns);
      const lines = result.split("\n");

      assert.equal(lines.length, 4); // header + separator + 2 rows
      assert.ok(lines[0].includes("ID"));
      assert.ok(lines[0].includes("Name"));
      assert.ok(lines[0].includes("Status"));
      assert.ok(lines[1].includes("─"));
      assert.ok(lines[2].includes("1"));
      assert.ok(lines[3].includes("2"));
    });

    it("should respect column width hints", () => {
      const rows = [{ id: "1", name: "A" }];
      const columns = [
        { key: "id", label: "ID", width: 10 },
        { key: "name", label: "Name", width: 20 },
      ];
      const result = formatTable(rows, columns);
      const lines = result.split("\n");
      const headerLine = lines[0];

      // Check that the header line respects the widths (10 + 2 spaces + 20 = 32+)
      assert.ok(headerLine.length >= 32);
    });

    it("should handle empty arrays", () => {
      const rows: Record<string, unknown>[] = [];
      const columns = [
        { key: "id", label: "ID" },
        { key: "name", label: "Name" },
      ];
      const result = formatTable(rows, columns);
      const lines = result.split("\n");

      assert.equal(lines.length, 2); // header + separator
      assert.ok(lines[0].includes("ID"));
    });

    it("should handle missing cell values", () => {
      const rows = [{ id: "1" }, { id: "2", name: "Bob" }];
      const columns = [
        { key: "id", label: "ID" },
        { key: "name", label: "Name" },
      ];
      const result = formatTable(rows, columns);

      assert.ok(result.includes("1"));
      assert.ok(result.includes("Bob"));
    });
  });

  describe("formatOutput", () => {
    let consoleLogOutput: string[] = [];
    let originalConsoleLog: typeof console.log;

    beforeEach(() => {
      consoleLogOutput = [];
      originalConsoleLog = console.log;
      console.log = (...args: unknown[]) => {
        consoleLogOutput.push(String(args[0]));
      };
    });

    afterEach(() => {
      console.log = originalConsoleLog;
    });

    it("should output JSON when json flag is true", () => {
      const data = { id: "1", name: "test" };
      formatOutput(data, { json: true });

      assert.equal(consoleLogOutput.length, 1);
      const parsed = JSON.parse(consoleLogOutput[0]);
      assert.deepEqual(parsed, data);
    });

    it("should format array with columns as table", () => {
      const data = [
        { id: "1", name: "Alice" },
        { id: "2", name: "Bob" },
      ];
      const columns = [
        { key: "id", label: "ID" },
        { key: "name", label: "Name" },
      ];
      formatOutput(data, {}, columns);

      assert.equal(consoleLogOutput.length, 1);
      assert.ok(consoleLogOutput[0].includes("ID"));
      assert.ok(consoleLogOutput[0].includes("─"));
    });

    it("should format object as key: value lines", () => {
      const data = { id: "123", name: "Alice", status: "active" };
      formatOutput(data, {});

      assert.equal(consoleLogOutput.length, 3);
      assert.ok(consoleLogOutput.some((line) => line.includes("id: 123")));
      assert.ok(consoleLogOutput.some((line) => line.includes("name: Alice")));
      assert.ok(consoleLogOutput.some((line) => line.includes("status: active")));
    });

    it("should format primitive values as strings", () => {
      formatOutput("test string", {});

      assert.equal(consoleLogOutput.length, 1);
      assert.equal(consoleLogOutput[0], "test string");
    });

    it("should handle array without columns", () => {
      const data = ["item1", "item2"];
      formatOutput(data, {});

      assert.equal(consoleLogOutput.length, 1);
      assert.equal(consoleLogOutput[0], "item1,item2");
    });

    it("should handle null and undefined values in objects", () => {
      const data = { id: "1", value: null, missing: undefined };
      formatOutput(data, {});

      assert.equal(consoleLogOutput.length, 3);
      assert.ok(consoleLogOutput.some((line) => line.includes("id: 1")));
      assert.ok(consoleLogOutput.some((line) => line.includes("value: ")));
    });
  });

  // B1: on success runHandler must NOT call process.exit(), which would drop
  // async-buffered stdout when piped (e.g. `| jq`) and truncate large JSON.
  describe("runHandler exit semantics", () => {
    let exitCalls: (number | undefined)[];
    let originalExit: typeof process.exit;
    let originalExitCode: typeof process.exitCode;
    let originalConsoleError: typeof console.error;

    beforeEach(() => {
      exitCalls = [];
      originalExit = process.exit;
      originalExitCode = process.exitCode;
      originalConsoleError = console.error;
      process.exit = ((code?: number): never => {
        exitCalls.push(code);
        return undefined as never;
      }) as typeof process.exit;
      console.error = () => {};
    });

    afterEach(() => {
      process.exit = originalExit;
      process.exitCode = originalExitCode;
      console.error = originalConsoleError;
    });

    it("does not call process.exit on success and sets exitCode 0", async () => {
      process.exitCode = 7;
      await runHandler(async () => {
        // simulate a large successful output write
        void "ok";
      });
      assert.equal(exitCalls.length, 0);
      assert.equal(process.exitCode, 0);
    });

    it("does not call process.exit on error and sets exitCode 1", async () => {
      await runHandler(async () => {
        throw new Error("boom");
      });
      assert.equal(exitCalls.length, 0);
      assert.equal(process.exitCode, 1);
    });
  });

  // B4: an empty list must echo the workspace/project context to stderr so a
  // wrong-context empty result is not silent (stdout stays clean for pipes).
  describe("warnIfEmpty", () => {
    let errOutput: string[];
    let originalConsoleError: typeof console.error;

    beforeEach(() => {
      errOutput = [];
      originalConsoleError = console.error;
      console.error = (...args: unknown[]) => {
        errOutput.push(String(args[0]));
      };
    });

    afterEach(() => {
      console.error = originalConsoleError;
    });

    it("prints workspace/project context to stderr when empty", () => {
      warnIfEmpty(0, { workspace: "ws1", project: "p1" });
      assert.equal(errOutput.length, 1);
      assert.ok(errOutput[0].includes("workspace=ws1"));
      assert.ok(errOutput[0].includes("project=p1"));
    });

    it("shows (unset) placeholders when context is missing", () => {
      warnIfEmpty(0, {});
      assert.equal(errOutput.length, 1);
      assert.ok(errOutput[0].includes("workspace=(unset)"));
      assert.ok(errOutput[0].includes("project=(unset)"));
    });

    it("stays silent when there are results", () => {
      warnIfEmpty(3, { workspace: "ws1", project: "p1" });
      assert.equal(errOutput.length, 0);
    });
  });

  // Q8: API auth/permission errors get an actionable hint on stderr.
  describe("runHandler error hints", () => {
    let errOutput: string[];
    let originalConsoleError: typeof console.error;
    let originalExitCode: typeof process.exitCode;

    beforeEach(() => {
      errOutput = [];
      originalConsoleError = console.error;
      originalExitCode = process.exitCode;
      console.error = (...args: unknown[]) => {
        errOutput.push(String(args[0]));
      };
    });

    afterEach(() => {
      console.error = originalConsoleError;
      process.exitCode = originalExitCode;
    });

    it("adds a 403 permission hint that does not blame permissions first", async () => {
      await runHandler(async () => {
        throw new PlaneApiError(403, "Forbidden");
      });
      assert.ok(errOutput.some((l) => l.includes("403 Forbidden")));
      // El gotcha del repo dice que un 403 raro casi nunca es falta de permisos;
      // el hint mandaba justo a la conclusión contraria.
      assert.ok(errOutput.some((l) => l.includes("check the project")));
    });

    // Plane devuelve 403 para una key inválida, no 401 — y como el CLI siempre
    // manda la key configurada, el 401 no se produce en uso normal. Resultado:
    // el caso más común de credencial mala leía el hint de permisos.
    it("tells an invalid key apart from a permission problem, by the body", async () => {
      await runHandler(async () => {
        throw new PlaneApiError(403, "Forbidden", undefined, '{"detail":"Given API token is not valid"}');
      });

      assert.ok(errOutput.some((l) => l.includes("rejected as invalid")));
      assert.ok(!errOutput.some((l) => l.includes("check the project")));
    });

    it("isInvalidToken only fires on a 403 that says so", () => {
      assert.equal(new PlaneApiError(403, "Forbidden", undefined, '{"detail":"Given API token is not valid"}').isInvalidToken, true);
      assert.equal(new PlaneApiError(403, "Forbidden", undefined, '{"detail":"You do not have permission"}').isInvalidToken, false);
      assert.equal(new PlaneApiError(401, "Unauthorized", undefined, "token is not valid").isInvalidToken, false);
      assert.equal(new PlaneApiError(403, "Forbidden").isInvalidToken, false);
    });

    it("adds a 401 auth hint distinct from 403", async () => {
      await runHandler(async () => {
        throw new PlaneApiError(401, "Unauthorized");
      });
      assert.ok(errOutput.some((l) => l.includes("401 Unauthorised")));
      assert.ok(errOutput.some((l) => l.includes("planec login")));
      assert.ok(!errOutput.some((l) => l.includes("lacks permission")));
    });

    it("adds no hint for a non-API error", async () => {
      await runHandler(async () => {
        throw new Error("plain boom");
      });
      assert.ok(!errOutput.some((l) => l.includes("Hint:")));
    });
  });

  // Q9: every handler resolves the project through this one validating helper.
  describe("resolveProjectFromOpts", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";

    /** Client stub whose workspace holds a single project, PCL. */
    function clientWithPcl(onList?: () => void): PlaneClient {
      return {
        projects: {
          listAll: async function* () {
            onList?.();
            yield { id: uuid, identifier: "PCL", name: "Plane Client" };
          },
        },
      } as unknown as PlaneClient;
    }

    it("uses the flag when it is a valid UUID", async () => {
      assert.equal(
        await resolveProjectFromOpts({ project: uuid }, { version: 1 }),
        uuid,
      );
    });

    it("does not hit the API when the value is already a UUID", async () => {
      let listed = false;
      await resolveProjectFromOpts(
        { project: uuid },
        { version: 1 },
        clientWithPcl(() => { listed = true; }),
      );
      assert.equal(listed, false, "a UUID must resolve without a lookup");
    });

    it("falls back to config", async () => {
      assert.equal(
        await resolveProjectFromOpts({}, { version: 1, project: uuid }),
        uuid,
      );
    });

    it("resolves a project identifier to its UUID", async () => {
      assert.equal(
        await resolveProjectFromOpts({ project: "PCL" }, { version: 1 }, clientWithPcl()),
        uuid,
      );
    });

    it("matches the identifier case-insensitively", async () => {
      assert.equal(
        await resolveProjectFromOpts({ project: "pcl" }, { version: 1 }, clientWithPcl()),
        uuid,
      );
    });

    it("resolves an identifier that arrives through config too", async () => {
      assert.equal(
        await resolveProjectFromOpts({}, { version: 1, project: "PCL" }, clientWithPcl()),
        uuid,
      );
    });

    it("throws when no project carries that identifier", async () => {
      await assert.rejects(
        () => resolveProjectFromOpts({ project: "NOPE" }, { version: 1 }, clientWithPcl()),
        /Project not found: NOPE/,
      );
    });

    it("throws a clear error for a value that is neither UUID nor identifier", async () => {
      await assert.rejects(
        () => resolveProjectFromOpts({ project: "not-a-uuid" }, { version: 1 }, clientWithPcl()),
        /Invalid project UUID/,
      );
    });

    it("throws a clear error when no project is specified", async () => {
      await assert.rejects(
        () => resolveProjectFromOpts({}, { version: 1 }),
        /No project specified/,
      );
    });

    // Plane acepta un identifier que empieza por dígito (verificado: 10TEST se
    // crea sin problema). Un guard demasiado estrecho lo rechazaba antes de
    // llegar siquiera a buscarlo.
    it("accepts an identifier starting with a digit", async () => {
      const client = {
        projects: {
          listAll: async function* () {
            yield { id: uuid, identifier: "10TEST", name: "digit check" };
          },
        },
      } as unknown as PlaneClient;
      assert.equal(
        await resolveProjectFromOpts({ project: "10TEST" }, { version: 1 }, client),
        uuid,
      );
    });

    it("accepts an identifier with an underscore", async () => {
      const client = {
        projects: {
          listAll: async function* () {
            yield { id: uuid, identifier: "A_B", name: "underscore check" };
          },
        },
      } as unknown as PlaneClient;
      assert.equal(
        await resolveProjectFromOpts({ project: "A_B" }, { version: 1 }, client),
        uuid,
      );
    });

    it("calls a dashless UUID what it is instead of hunting for a project", async () => {
      await assert.rejects(
        () => resolveProjectFromOpts(
          { project: "550e8400e29b41d4a716446655440000" },
          { version: 1 },
          clientWithPcl(),
        ),
        /dashes stripped/,
      );
    });
  });

  // Un override vacío no es un override: `export PLANE_API_KEY="$SIN_DEFINIR"`,
  // `docker run -e PLANE_API_KEY` sin valor o un `.env` acabado en `=` producen
  // cadena vacía, y con `??` esa cadena ganaba a una config perfectamente válida
  // y tumbaba el CLI entero con "not configured".
  describe("empty env overrides", () => {
    const validConfig = {
      version: 1 as const,
      baseUrl: "https://plane.test",
      apiKey: "pk-from-config",
      workspace: "ws-from-config",
      project: "550e8400-e29b-41d4-a716-446655440000",
    };

    it("ignores an empty PLANE_API_KEY and keeps the configured one", () => {
      process.env.PLANE_API_KEY = "";
      const client = buildClient(validConfig);
      assert.equal(
        (client as unknown as { apiKey: string }).apiKey,
        "pk-from-config",
      );
    });

    it("ignores an empty PLANE_BASE_URL", () => {
      process.env.PLANE_BASE_URL = "";
      const client = buildClient(validConfig);
      assert.equal(
        (client as unknown as { baseUrl: string }).baseUrl,
        "https://plane.test",
      );
    });

    it("ignores a whitespace-only PLANE_WORKSPACE", () => {
      process.env.PLANE_WORKSPACE = "   ";
      const client = buildClient(validConfig);
      assert.equal(
        (client as unknown as { workspace: string }).workspace,
        "ws-from-config",
      );
      assert.equal(resolveWorkspaceForDisplay(validConfig), "ws-from-config");
    });

    it("ignores an empty PLANE_PROJECT", async () => {
      process.env.PLANE_PROJECT = "";
      assert.equal(
        await resolveProjectFromOpts({}, validConfig),
        "550e8400-e29b-41d4-a716-446655440000",
      );
    });
  });

  describe("resolveEffectiveConfig", () => {
    const config = {
      version: 1 as const,
      baseUrl: "https://from-config",
      apiKey: "pk-from-config",
      workspace: "ws-from-config",
      project: "550e8400-e29b-41d4-a716-446655440000",
    };

    it("reports the config file as the source when no env is set", () => {
      const effective = resolveEffectiveConfig(config);
      assert.equal(effective.baseUrl.source, "config");
      assert.equal(effective.baseUrl.value, "https://from-config");
      assert.equal(effective.apiKey.source, "config");
    });

    it("reports the env as the source, and names the variable", () => {
      process.env.PLANE_API_KEY = "pk-from-env";
      const effective = resolveEffectiveConfig(config);
      assert.equal(effective.apiKey.source, "env");
      assert.equal(effective.apiKey.value, "pk-from-env");
      assert.equal(effective.apiKey.envVar, "PLANE_API_KEY");
      // Lo que el entorno no tapa sigue viniendo del fichero.
      assert.equal(effective.baseUrl.source, "config");
    });

    it("reports unset when neither layer has a value", () => {
      const effective = resolveEffectiveConfig({ version: 1 });
      assert.equal(effective.apiKey.source, "unset");
      assert.equal(effective.apiKey.value, undefined);
    });

    it("does not treat an empty env value as a source", () => {
      process.env.PLANE_API_KEY = "";
      const effective = resolveEffectiveConfig(config);
      assert.equal(effective.apiKey.source, "config");
    });
  });

  describe("resolveOptionalProjectFromOpts", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";

    it("returns undefined when no project is set anywhere", async () => {
      const previous = process.env.PLANE_PROJECT;
      delete process.env.PLANE_PROJECT;
      try {
        assert.equal(await resolveOptionalProjectFromOpts({}, { version: 1 }), undefined);
      } finally {
        if (previous !== undefined) process.env.PLANE_PROJECT = previous;
      }
    });

    it("still resolves an identifier that was set", async () => {
      const client = {
        projects: {
          listAll: async function* () {
            yield { id: uuid, identifier: "PCL", name: "Plane Client" };
          },
        },
      } as unknown as PlaneClient;
      assert.equal(
        await resolveOptionalProjectFromOpts({ project: "PCL" }, { version: 1 }, client),
        uuid,
      );
    });

    // Un -p equivocado no puede degradar en silencio a "busca en todo el
    // workspace": eso devuelve resultados de otros proyectos como si nada.
    it("fails loudly on a project that was set but does not resolve", async () => {
      const client = {
        projects: { listAll: async function* () { /* workspace vacío */ } },
      } as unknown as PlaneClient;
      await assert.rejects(
        () => resolveOptionalProjectFromOpts({ project: "NOPE" }, { version: 1 }, client),
        /Project not found: NOPE/,
      );
    });
  });

  // Q5: NXI-N identifiers are resolved to UUIDs; UUIDs pass through untouched.
  describe("resolveWorkItemId", () => {
    it("resolves a PREFIX-NUMBER identifier to the work item UUID", async () => {
      let getCalls = 0;
      const client = {
        workItems: {
          get: async (id: string) => {
            getCalls++;
            assert.equal(id, "NXI-42");
            return { id: "the-uuid" };
          },
        },
      } as unknown as PlaneClient;

      const resolved = await resolveWorkItemId(client, "NXI-42");
      assert.equal(resolved, "the-uuid");
      assert.equal(getCalls, 1);
    });

    it("returns a UUID unchanged without any lookup", async () => {
      let getCalls = 0;
      const client = {
        workItems: {
          get: async () => {
            getCalls++;
            return null;
          },
        },
      } as unknown as PlaneClient;

      const uuid = "550e8400-e29b-41d4-a716-446655440000";
      const resolved = await resolveWorkItemId(client, uuid);
      assert.equal(resolved, uuid);
      assert.equal(getCalls, 0);
    });

    it("throws when the identifier is not found", async () => {
      const client = {
        workItems: { get: async () => null },
      } as unknown as PlaneClient;

      await assert.rejects(
        () => resolveWorkItemId(client, "NXI-999"),
        /Work item not found/,
      );
    });

    it("rejects an identifier that belongs to another project", async () => {
      const client = {
        workItems: {
          get: async () => ({ id: "the-uuid", project: "project-a" }),
        },
      } as unknown as PlaneClient;

      await assert.rejects(
        () => resolveWorkItemId(client, "NXI-42", "project-b"),
        /belongs to project project-a/,
      );
    });

    it("accepts an identifier that belongs to the target project", async () => {
      const client = {
        workItems: {
          get: async () => ({ id: "the-uuid", project: "project-a" }),
        },
      } as unknown as PlaneClient;

      assert.equal(
        await resolveWorkItemId(client, "NXI-42", "project-a"),
        "the-uuid",
      );
    });
  });

  describe("resolveWorkItemIds", () => {
    it("resolves identifiers and passes UUIDs through", async () => {
      const client = {
        workItems: {
          get: async (id: string) => ({
            id: `uuid-of-${id}`,
            project: "project-a",
          }),
        },
      } as unknown as PlaneClient;

      const uuid = "550e8400-e29b-41d4-a716-446655440000";
      const resolved = await resolveWorkItemIds(
        client,
        ["NXI-42", uuid],
        "project-a",
      );
      assert.deepEqual(resolved, ["uuid-of-NXI-42", uuid]);
    });
  });

  describe("parseRefList", () => {
    it("splits a comma-separated string", () => {
      assert.deepEqual(parseRefList("a,b,c"), ["a", "b", "c"]);
    });

    it("keeps every entry of a variadic (space-separated) flag", () => {
      assert.deepEqual(parseRefList(["a", "b"]), ["a", "b"]);
    });

    it("handles commas inside a variadic flag and trims blanks", () => {
      assert.deepEqual(parseRefList(["a, b", "", "c,"]), ["a", "b", "c"]);
    });
  });

  describe("resolveHtmlOption", () => {
    it("returns the inline value when no file is given", () => {
      assert.equal(resolveHtmlOption("<p>hi</p>", undefined), "<p>hi</p>");
    });

    it("returns undefined when neither is given", () => {
      assert.equal(resolveHtmlOption(undefined, undefined), undefined);
    });

    it("reads the file when given", () => {
      const path = join(tmpdir(), `planec-html-${process.pid}.html`);
      writeFileSync(path, "<p>from file</p>");
      try {
        assert.equal(resolveHtmlOption(undefined, path), "<p>from file</p>");
      } finally {
        rmSync(path, { force: true });
      }
    });

    it("rejects passing both inline and file", () => {
      assert.throws(
        () => resolveHtmlOption("<p>x</p>", "/tmp/whatever.html"),
        /not both/,
      );
    });

    it("reports an unreadable file instead of sending an empty description", () => {
      assert.throws(
        () => resolveHtmlOption(undefined, "/nonexistent/nope.html"),
        /Cannot read --description-html-file/,
      );
    });
  });
});

// ── Exit codes, --json y truncado (PCL-3 / PCL-4 / PCL-5 / PCL-6 / PCL-7) ──

describe("exit codes", () => {
  let savedExitCode: typeof process.exitCode;
  let errors: string[];
  let originalError: typeof console.error;

  beforeEach(() => {
    savedExitCode = process.exitCode;
    errors = [];
    originalError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    };
  });

  afterEach(() => {
    console.error = originalError;
    process.exitCode = savedExitCode;
  });

  // El fallo que esto fija: `planec projects delete X && echo borrado` imprimía
  // «borrado» sin haber borrado nada, porque abortar salía por 0.
  it("aborting leaves a non-zero exit code", async () => {
    await runHandler(async () => {
      throw new AbortedError();
    });

    assert.equal(process.exitCode, 1);
    assert.deepEqual(errors, ["Aborted."]);
  });

  it("an abort is reported without the Error: prefix", async () => {
    await runHandler(async () => {
      throw new AbortedError("Identifier did not match. Aborted.");
    });

    assert.equal(process.exitCode, 1);
    assert.equal(errors[0], "Identifier did not match. Aborted.");
  });

  it("not found gets its own exit code, distinct from a generic failure", async () => {
    await runHandler(async () => {
      throw new NotFoundError("Work item not found: PROJ-999");
    });

    assert.equal(process.exitCode, EXIT_NOT_FOUND);
    assert.notEqual(EXIT_NOT_FOUND, 1);
    assert.match(errors[0], /^Error: Work item not found: PROJ-999$/);
  });

  it("an unexpected error still exits 1", async () => {
    await runHandler(async () => {
      throw new Error("boom");
    });

    assert.equal(process.exitCode, 1);
  });

  it("a successful handler exits 0", async () => {
    await runHandler(async () => {});
    assert.equal(process.exitCode, 0);
  });
});

describe("reportAction", () => {
  let logs: string[];
  let originalLog: typeof console.log;

  beforeEach(() => {
    logs = [];
    originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
  });

  afterEach(() => {
    console.log = originalLog;
  });

  it("prints the human sentence when --json is absent", () => {
    reportAction({}, "Deleted module m1", { deleted: "m1" });
    assert.deepEqual(logs, ["Deleted module m1"]);
  });

  // Un flag aceptado que no hace nada es peor que uno inexistente: no hay error
  // que delate el fallo en un script.
  it("emits parseable JSON when --json is passed", () => {
    reportAction({ json: true }, "Deleted module m1", { deleted: "m1" });

    assert.equal(logs.length, 1);
    const parsed = JSON.parse(logs[0]) as { ok: boolean; deleted: string };
    assert.equal(parsed.ok, true);
    assert.equal(parsed.deleted, "m1");
  });

  it("never mixes the human sentence into the JSON output", () => {
    reportAction({ json: true }, "Intake accepted", { accepted: "i1" });
    assert.doesNotThrow(() => JSON.parse(logs[0]));
  });
});

describe("warnIfTruncated", () => {
  let errors: string[];
  let originalError: typeof console.error;

  beforeEach(() => {
    errors = [];
    originalError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    };
  });

  afterEach(() => {
    console.error = originalError;
  });

  it("says nothing when the listing is complete", () => {
    warnIfTruncated(19, false, 19);
    assert.deepEqual(errors, []);
  });

  it("warns on stderr when more pages exist", () => {
    warnIfTruncated(20, true, 22);

    assert.equal(errors.length, 1);
    assert.match(errors[0], /first 20 of 22/);
    assert.match(errors[0], /--all/);
  });

  it("still warns when the API reports no total", () => {
    warnIfTruncated(20, true, undefined);
    assert.match(errors[0], /more pages exist/);
  });
});

describe("work item rows", () => {
  // expand=state devuelve el objeto entero, así que String(state) imprimía
  // [object Object] en cada tabla de work items.
  it("derives state_name from the expanded state object", () => {
    const row = toWorkItemRow({
      sequence_id: 24,
      name: "Something",
      state: { id: "s1", name: "In Progress", group: "started" },
    });

    assert.equal(row.state_name, "In Progress");
  });

  it("passes a bare state UUID through unchanged", () => {
    const row = toWorkItemRow({ state: "uuid-state" });
    assert.equal(row.state_name, "uuid-state");
  });

  it("leaves the cell empty rather than inventing one when state is missing", () => {
    assert.equal(toWorkItemRow({}).state_name, "");
    assert.equal(toWorkItemRow({ state: null }).state_name, "");
  });

  it("keeps the raw state so --json is unaffected", () => {
    const state = { id: "s1", name: "Done", group: "completed" };
    assert.deepEqual(toWorkItemRow({ state }).state, state);
  });

  it("renders a real state name in the table instead of [object Object]", () => {
    const table = formatTable(
      [toWorkItemRow({ sequence_id: 1, name: "Item", state: { name: "Backlog" }, priority: "high" })],
      WORK_ITEM_COLUMNS,
    );

    assert(table.includes("Backlog"));
    assert(!table.includes("[object Object]"));
  });
});

describe("formatTable column widths", () => {
  // Un valor más largo que su columna empujaba las siguientes fuera de la
  // rejilla en esa fila, así que la tabla dejaba de estar alineada.
  it("truncates a value longer than its column and marks it", () => {
    const columns = [{ key: "name", label: "Name", width: 10 }];
    const table = formatTable([{ name: "a".repeat(40) }], columns);
    const row = table.split("\n")[2];

    assert.equal(row.length, 10);
    assert(row.endsWith("…"));
  });

  it("keeps every row the same width", () => {
    const columns = [
      { key: "name", label: "Name", width: 10 },
      { key: "priority", label: "Priority", width: 8 },
    ];
    const table = formatTable(
      [{ name: "short", priority: "high" }, { name: "b".repeat(30), priority: "none" }],
      columns,
    );
    const [, , first, second] = table.split("\n");

    assert.equal(first.length, second.length);
  });
});

// PCL-8: el token no debe viajar en argv, donde lo leen ps, el historial del
// shell y los logs de cualquier harness.
describe("readSecretFromStdin", () => {
  const originalStdin = Object.getOwnPropertyDescriptor(process, "stdin");

  function fakeStdin(chunks: string[], isTTY: boolean) {
    Object.defineProperty(process, "stdin", {
      configurable: true,
      value: {
        isTTY,
        async *[Symbol.asyncIterator]() {
          for (const chunk of chunks) yield Buffer.from(chunk);
        },
      },
    });
  }

  afterEach(() => {
    if (originalStdin) Object.defineProperty(process, "stdin", originalStdin);
  });

  it("reads the piped value and trims the trailing newline", async () => {
    fakeStdin(["pk_secret_token\n"], false);

    assert.equal(await readSecretFromStdin("--token-stdin"), "pk_secret_token");
  });

  it("joins a value that arrives in several chunks", async () => {
    fakeStdin(["pk_", "secret", "_token\n"], false);

    assert.equal(await readSecretFromStdin("--token-stdin"), "pk_secret_token");
  });

  // Sin pipe esto parecería un cuelgue: un prompt sin prompt y sin eco.
  it("refuses to read from a terminal instead of hanging", async () => {
    fakeStdin([], true);

    await assert.rejects(
      () => readSecretFromStdin("--token-stdin"),
      /stdin is a terminal/,
    );
  });

  it("fails loudly when stdin carries nothing", async () => {
    fakeStdin(["   \n"], false);

    await assert.rejects(() => readSecretFromStdin("--token-stdin"), /got nothing/);
  });
});

// El fix del [object Object] cubría solo las tablas: `work-items get` usa el
// volcado clave:valor, que seguía imprimiéndolo (`get` pide expand=state).
describe("formatOutput key/value dump", () => {
  let logs: string[];
  let originalLog: typeof console.log;

  beforeEach(() => {
    logs = [];
    originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(String(args[0]));
  });

  afterEach(() => {
    console.log = originalLog;
  });

  it("serialises a nested object instead of printing [object Object]", () => {
    formatOutput({ id: "w1", state: { id: "s1", name: "In Progress", group: "started" } }, {});

    const stateLine = logs.find((l) => l.startsWith("state:"));
    assert.ok(stateLine);
    assert.ok(!stateLine.includes("[object Object]"));
    assert.ok(stateLine.includes("In Progress"));
  });

  it("joins an array of primitives readably", () => {
    formatOutput({ labels: ["bug", "chore"] }, {});
    assert.equal(logs.find((l) => l.startsWith("labels:")), "labels: bug, chore");
  });

  it("serialises an array of objects", () => {
    formatOutput({ modules: [{ id: "m1", name: "Core" }] }, {});
    const line = logs.find((l) => l.startsWith("modules:"));
    assert.ok(line?.includes("Core"));
    assert.ok(!line?.includes("[object Object]"));
  });

  it("keeps empty and missing values blank", () => {
    formatOutput({ assignees: [], parent: null, name: "x" }, {});
    assert.equal(logs.find((l) => l.startsWith("assignees:")), "assignees: ");
    assert.equal(logs.find((l) => l.startsWith("parent:")), "parent: ");
  });

  it("leaves scalars alone", () => {
    formatOutput({ sequence_id: 42, done: false }, {});
    assert.equal(logs.find((l) => l.startsWith("sequence_id:")), "sequence_id: 42");
    assert.equal(logs.find((l) => l.startsWith("done:")), "done: false");
  });
});

describe("buildClient overrides", () => {
  const config = {
    version: 1 as const,
    baseUrl: "https://plane.test",
    apiKey: "pk",
    workspace: "ws",
  };

  // report.ts pasa aquí su `onThrottle`: sin propagación, un barrido que agota
  // la cuota se para hasta un minuto por petición sin decir una palabra, que es
  // indistinguible de un cuelgue.
  it("propagates onThrottle and the shared quota to the client", async () => {
    const throttles: unknown[] = [];
    const quota = createRateLimitState();
    const client = buildClient(config, {
      rateLimit: { quota, maxWaitMs: 20 },
      onThrottle: (info) => throttles.push(info),
    });

    const originalFetch = globalThis.fetch;
    let call = 0;
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers:
          call++ === 0
            ? {
                "x-ratelimit-remaining": "0",
                "x-ratelimit-reset": String(Math.ceil((Date.now() + 60_000) / 1000)),
              }
            : {},
      });
    try {
      await client.states.list("p1");
      await client.states.list("p1");
      assert.equal(throttles.length, 1, "the hook reached the client");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // El report construía el cliente a mano con `??`, que solo cae en undefined:
  // un PLANE_API_KEY vacío ganaba a una config perfectamente válida.
  it("still treats an empty env var as unset", () => {
    const saved = process.env.PLANE_API_KEY;
    process.env.PLANE_API_KEY = "";
    try {
      assert.doesNotThrow(() => buildClient(config));
    } finally {
      if (saved === undefined) delete process.env.PLANE_API_KEY;
      else process.env.PLANE_API_KEY = saved;
    }
  });

  it("fails with a usable message when there is no baseUrl at all", () => {
    const saved = process.env.PLANE_BASE_URL;
    delete process.env.PLANE_BASE_URL;
    try {
      assert.throws(() => buildClient({ version: 1, apiKey: "pk", workspace: "ws" }), /baseUrl not configured/);
    } finally {
      if (saved !== undefined) process.env.PLANE_BASE_URL = saved;
    }
  });
});
