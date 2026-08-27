import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  handleModulesList,
  handleModulesGet,
  handleModulesCreate,
  handleModulesUpdate,
  handleModulesWorkItems,
  handleModulesAddWorkItems,
  handleModulesRemoveWorkItem,
  handleModulesDelete,
} from "../../src/cli/modules.js";
import type { PlaneClient } from "../../src/client.js";

const mockConfig = {
  version: 1 as const,
  baseUrl: "http://localhost:8000",
  apiKey: "test-key",
  workspace: "test-workspace",
  project: "550e8400-e29b-41d4-a716-446655440000",
};

const mockClient = {
  // `<resource> work-items` resuelve ahora el prefijo del proyecto (para la
  // columna ID) y los estados (porque /module-issues/ y /cycle-issues/
  // devuelven `state` como UUID plano).
  projects: {
    get: async () => ({ id: "550e8400-e29b-41d4-a716-446655440000", identifier: "TEST", name: "Test" }),
  },
  states: {
    list: async () => [
      { id: "todo", name: "Todo", group: "unstarted" },
      { id: "in_progress", name: "In Progress", group: "started" },
    ],
  },
  modules: {
    list: async () => [
      {
        id: "m1",
        name: "Module 1",
        status: "in-progress",
        start_date: "2026-01-01",
        target_date: "2026-02-01",
      },
      {
        id: "m2",
        name: "Module 2",
        status: "completed",
        start_date: "2025-12-01",
        target_date: "2025-12-31",
      },
    ],
    get: async () => ({
      id: "m1",
      name: "Module 1",
      description: "Test module",
      status: "in-progress",
      start_date: "2026-01-01",
      target_date: "2026-02-01",
    }),
    create: async () => ({
      id: "m1",
      name: "Module 1",
      description: "Test module",
      status: "backlog",
    }),
    update: async () => ({
      id: "m1",
      name: "Module 1 Updated",
      description: "Updated description",
      status: "in-progress",
    }),
    workItems: async () => ({
      items: [
        {
          id: "wi1",
          sequence_id: 1,
          name: "Work Item 1",
          state: "todo",
          priority: "high",
        },
        {
          id: "wi2",
          sequence_id: 2,
          name: "Work Item 2",
          state: "in_progress",
          priority: "medium",
        },
      ],
      hasNext: false,
    }),
    addWorkItems: async () => undefined,
    removeWorkItem: async () => undefined,
    delete: async () => undefined,
  },
} as unknown as PlaneClient;

describe("modules CLI handlers", () => {
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

  describe("handleModulesList", () => {
    it("should list modules as JSON", async () => {
      await handleModulesList(
        { json: true },
        { client: mockClient, config: mockConfig },
      );

      assert.equal(consoleLogOutput.length, 1);
      const parsed = JSON.parse(consoleLogOutput[0]);
      assert.ok(Array.isArray(parsed));
      assert.equal(parsed.length, 2);
      assert.equal(parsed[0].id, "m1");
      assert.equal(parsed[0].name, "Module 1");
    });

    it("should list modules as table", async () => {
      await handleModulesList(
        { json: false },
        { client: mockClient, config: mockConfig },
      );

      assert.equal(consoleLogOutput.length, 1);
      assert.ok(consoleLogOutput[0].includes("ID"));
      assert.ok(consoleLogOutput[0].includes("Name"));
      assert.ok(consoleLogOutput[0].includes("Module 1"));
    });
  });

  describe("handleModulesGet", () => {
    it("should get module by ID as JSON", async () => {
      await handleModulesGet("m1", { json: true }, {
        client: mockClient,
        config: mockConfig,
      });

      assert.equal(consoleLogOutput.length, 1);
      const parsed = JSON.parse(consoleLogOutput[0]);
      assert.equal(parsed.id, "m1");
      assert.equal(parsed.name, "Module 1");
      assert.equal(parsed.description, "Test module");
    });

    it("should get module by ID as key: value", async () => {
      await handleModulesGet("m1", { json: false }, {
        client: mockClient,
        config: mockConfig,
      });

      assert.ok(consoleLogOutput.some((line) => line.includes("id: m1")));
      assert.ok(consoleLogOutput.some((line) => line.includes("name: Module 1")));
    });
  });

  describe("handleModulesCreate", () => {
    it("should create module as JSON", async () => {
      await handleModulesCreate(
        {
          name: "Module 1",
          description: "Test module",
          json: true,
        },
        { client: mockClient, config: mockConfig },
      );

      assert.equal(consoleLogOutput.length, 1);
      const parsed = JSON.parse(consoleLogOutput[0]);
      assert.equal(parsed.id, "m1");
      assert.equal(parsed.name, "Module 1");
    });

    it("should create module with dates", async () => {
      await handleModulesCreate(
        {
          name: "Module 1",
          startDate: "2026-01-01",
          targetDate: "2026-02-01",
          json: true,
        },
        { client: mockClient, config: mockConfig },
      );

      assert.equal(consoleLogOutput.length, 1);
      const parsed = JSON.parse(consoleLogOutput[0]);
      assert.equal(parsed.id, "m1");
    });
  });

  describe("handleModulesUpdate", () => {
    it("should update module as JSON", async () => {
      await handleModulesUpdate(
        "m1",
        {
          name: "Module 1 Updated",
          status: "in-progress",
          json: true,
        },
        { client: mockClient, config: mockConfig },
      );

      assert.equal(consoleLogOutput.length, 1);
      const parsed = JSON.parse(consoleLogOutput[0]);
      assert.equal(parsed.id, "m1");
      assert.equal(parsed.name, "Module 1 Updated");
    });

    it("should update only provided fields", async () => {
      await handleModulesUpdate(
        "m1",
        {
          description: "Updated description",
          json: true,
        },
        { client: mockClient, config: mockConfig },
      );

      assert.equal(consoleLogOutput.length, 1);
      const parsed = JSON.parse(consoleLogOutput[0]);
      assert.equal(parsed.id, "m1");
    });
  });

  describe("handleModulesWorkItems", () => {
    it("should list work items as JSON", async () => {
      await handleModulesWorkItems("m1", { json: true }, {
        client: mockClient,
        config: mockConfig,
      });

      assert.equal(consoleLogOutput.length, 1);
      const parsed = JSON.parse(consoleLogOutput[0]);
      assert.ok(Array.isArray(parsed));
      assert.equal(parsed.length, 2);
      assert.equal(parsed[0].id, "wi1");
      assert.equal(parsed[0].name, "Work Item 1");
    });

    it("should list work items as table", async () => {
      await handleModulesWorkItems("m1", { json: false }, {
        client: mockClient,
        config: mockConfig,
      });

      assert.equal(consoleLogOutput.length, 1);
      assert.ok(consoleLogOutput[0].includes("ID"));
      assert.ok(consoleLogOutput[0].includes("Name"));
      assert.ok(consoleLogOutput[0].includes("Work Item 1"));
    });
  });

  describe("handleModulesAddWorkItems", () => {
    it("should add work items to module", async () => {
      await handleModulesAddWorkItems("m1", "wi1,wi2,wi3", { project: mockConfig.project }, {
        client: mockClient,
        config: mockConfig,
      });

      assert.equal(consoleLogOutput.length, 1);
      assert.ok(consoleLogOutput[0].includes("Added 3 work item(s) to module m1"));
    });

    it("should handle CSV with spaces", async () => {
      await handleModulesAddWorkItems("m1", "wi1, wi2 , wi3", {}, {
        client: mockClient,
        config: mockConfig,
      });

      assert.equal(consoleLogOutput.length, 1);
      assert.ok(consoleLogOutput[0].includes("Added 3 work item(s) to module m1"));
    });

    it("should handle single work item", async () => {
      await handleModulesAddWorkItems("m1", "wi1", {}, {
        client: mockClient,
        config: mockConfig,
      });

      assert.equal(consoleLogOutput.length, 1);
      assert.ok(consoleLogOutput[0].includes("Added 1 work item(s) to module m1"));
    });
  });

  describe("handleModulesRemoveWorkItem", () => {
    it("should remove work item from module", async () => {
      await handleModulesRemoveWorkItem("m1", "wi1", {}, {
        client: mockClient,
        config: mockConfig,
      });

      assert.equal(consoleLogOutput.length, 1);
      assert.ok(consoleLogOutput[0].includes("Removed work item wi1 from module m1"));
    });

    // Q7: a missing project must fail loudly, not print a fake success.
    it("throws a clear error when project is missing", async () => {
      const configNoProject = { ...mockConfig, project: undefined };

      await assert.rejects(
        () =>
          handleModulesRemoveWorkItem("m1", "wi1", {}, {
            client: mockClient,
            config: configNoProject,
          }),
        /No project specified/,
      );
      assert.equal(consoleLogOutput.length, 0);
    });
  });

  // F10: delete a module, guarded by confirmation unless --yes.
  describe("handleModulesDelete", () => {
    it("deletes the module and confirms when --yes is passed", async () => {
      let deletedWith: { project?: string; id?: string } = {};
      const spyClient = {
        modules: {
          delete: async (project: string, id: string) => {
            deletedWith = { project, id };
          },
        },
      } as unknown as PlaneClient;

      await handleModulesDelete("m1", { yes: true }, {
        client: spyClient,
        config: mockConfig,
      });

      assert.equal(deletedWith.id, "m1");
      assert.equal(deletedWith.project, mockConfig.project);
      assert.ok(consoleLogOutput.some((l) => l.includes("Deleted module m1")));
    });

    it("throws a clear error when project is missing", async () => {
      const configNoProject = { ...mockConfig, project: undefined };

      await assert.rejects(
        () =>
          handleModulesDelete("m1", { yes: true }, {
            client: mockClient,
            config: configNoProject,
          }),
        /No project specified/,
      );
    });
  });

  describe("error handling", () => {
    it("should throw error when project is not specified", async () => {
      const configNoProject = { ...mockConfig, project: undefined };

      assert.rejects(
        () =>
          handleModulesList(
            { json: true },
            { client: mockClient, config: configNoProject },
          ),
        /No project specified/,
      );
    });

    // Q9: an invalid (non-UUID) project fails clearly through the shared helper.
    it("rejects an invalid project UUID with a clear error", async () => {
      await assert.rejects(
        () =>
          handleModulesList(
            { project: "not-a-uuid", json: true },
            { client: mockClient, config: mockConfig },
          ),
        /Invalid project UUID/,
      );
    });
  });

  // PCL-5: --json se aceptaba y se ignoraba en estos comandos, así que un
  // script recibía una frase en prosa donde esperaba JSON, y sin error.
  describe("--json on action commands", () => {
    const deps = { client: mockClient, config: mockConfig };

    it("delete emits JSON with --json", async () => {
      await handleModulesDelete("m1", { yes: true, json: true }, deps);

      const parsed = JSON.parse(consoleLogOutput[0]) as { ok: boolean; deleted: string };
      assert.equal(parsed.ok, true);
      assert.equal(parsed.deleted, "m1");
    });

    it("add-work-items emits JSON with --json", async () => {
      await handleModulesAddWorkItems("m1", ["wi-uuid"], { json: true }, deps);

      const parsed = JSON.parse(consoleLogOutput[0]) as { ok: boolean; module: string };
      assert.equal(parsed.ok, true);
      assert.equal(parsed.module, "m1");
    });

    it("remove-work-item emits JSON with --json", async () => {
      await handleModulesRemoveWorkItem("m1", "wi-uuid", { json: true }, deps);

      assert.doesNotThrow(() => JSON.parse(consoleLogOutput[0]));
    });

    it("keeps the human sentence when --json is absent", async () => {
      await handleModulesDelete("m1", { yes: true }, deps);

      assert.ok(consoleLogOutput[0].includes("Deleted module m1"));
      assert.throws(() => JSON.parse(consoleLogOutput[0]));
    });
  });

  // PCL-6: la columna State imprimía [object Object] porque expand=state
  // devuelve el objeto entero.
  describe("work-items table", () => {
    it("prints the state name, not [object Object]", async () => {
      const expandedClient = {
        ...mockClient,
        modules: {
          ...(mockClient as unknown as { modules: Record<string, unknown> }).modules,
          workItems: async () => ({
            items: [
              { id: "wi1", sequence_id: 1, name: "Item", state: { id: "s1", name: "In Progress" }, priority: "high" },
            ],
            hasNext: false,
          }),
        },
      } as unknown as PlaneClient;

      await handleModulesWorkItems("m1", { json: false }, { client: expandedClient, config: mockConfig });

      assert.ok(consoleLogOutput[0].includes("In Progress"));
      assert.ok(!consoleLogOutput[0].includes("[object Object]"));
    });

    it("leaves the raw state object untouched under --json", async () => {
      const expandedClient = {
        ...mockClient,
        modules: {
          ...(mockClient as unknown as { modules: Record<string, unknown> }).modules,
          workItems: async () => ({
            items: [{ id: "wi1", sequence_id: 1, name: "Item", state: { id: "s1", name: "In Progress" } }],
            hasNext: false,
          }),
        },
      } as unknown as PlaneClient;

      await handleModulesWorkItems("m1", { json: true }, { client: expandedClient, config: mockConfig });

      const parsed = JSON.parse(consoleLogOutput[0]) as Array<{ state: { name: string } }>;
      assert.equal(parsed[0].state.name, "In Progress");
    });
  });
});
