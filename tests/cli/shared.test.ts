import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  runHandler,
  resolveProject,
  resolveProjectFromOpts,
  resolveWorkItemId,
  buildClient,
  formatTable,
  formatOutput,
  warnIfEmpty,
} from "../../src/cli/shared.js";
import type { Config } from "../../src/cli/config.js";
import type { PlaneClient } from "../../src/client.js";
import { PlaneApiError } from "../../src/error.js";

describe("shared CLI utilities", () => {

  describe("resolveProject", () => {
    it("should prioritize flag over env and config", () => {
      const projectUuid = "550e8400-e29b-41d4-a716-446655440000";
      const result = resolveProject({
        flag: projectUuid,
        env: "invalid",
        config: { version: 1, project: "also-invalid" },
      });
      assert.equal(result, projectUuid);
    });

    it("should use env when flag is not provided", () => {
      const projectUuid = "550e8400-e29b-41d4-a716-446655440000";
      const result = resolveProject({
        env: projectUuid,
        config: { version: 1, project: "from-config" },
      });
      assert.equal(result, projectUuid);
    });

    it("should use config project when flag and env are not provided", () => {
      const projectUuid = "550e8400-e29b-41d4-a716-446655440000";
      const result = resolveProject({
        config: { version: 1, project: projectUuid },
      });
      assert.equal(result, projectUuid);
    });

    it("should throw error when no project is specified", () => {
      assert.throws(
        () => resolveProject({}),
        /No project specified/,
      );
    });

    it("should throw error for invalid UUID", () => {
      assert.throws(
        () => resolveProject({ flag: "not-a-uuid" }),
        /Invalid project UUID/,
      );
    });

    it("should validate UUID format case-insensitively", () => {
      const uppercase = "550E8400-E29B-41D4-A716-446655440000";
      const result = resolveProject({ flag: uppercase });
      assert.equal(result, uppercase);
    });
  });

  describe("buildClient", () => {
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

    it("adds a 403 permission hint", async () => {
      await runHandler(async () => {
        throw new PlaneApiError(403, "Forbidden");
      });
      assert.ok(errOutput.some((l) => l.includes("403 Forbidden")));
      assert.ok(errOutput.some((l) => l.includes("lacks permission")));
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

    it("uses the flag when it is a valid UUID", () => {
      assert.equal(
        resolveProjectFromOpts({ project: uuid }, { version: 1 }),
        uuid,
      );
    });

    it("falls back to config", () => {
      assert.equal(
        resolveProjectFromOpts({}, { version: 1, project: uuid }),
        uuid,
      );
    });

    it("throws a clear error for an invalid project UUID", () => {
      assert.throws(
        () => resolveProjectFromOpts({ project: "not-a-uuid" }, { version: 1 }),
        /Invalid project UUID/,
      );
    });

    it("throws a clear error when no project is specified", () => {
      assert.throws(
        () => resolveProjectFromOpts({}, { version: 1 }),
        /No project specified/,
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
  });
});
