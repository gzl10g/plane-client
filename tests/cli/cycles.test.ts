import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { PlaneClient } from "../../src/client.js";
import {
  handleCyclesList,
  handleCyclesGet,
  handleCyclesCreate,
  handleCyclesUpdate,
  handleCyclesArchive,
  handleCyclesTransfer,
  handleCyclesWorkItems,
  handleCyclesAddWorkItems,
  handleCyclesRemoveWorkItem,
} from "../../src/cli/cycles.js";
import type { Config } from "../../src/cli/config.js";

describe("cycles CLI handlers", () => {
  let consoleLogOutput: string[] = [];
  let consoleErrorOutput: string[] = [];
  let originalConsoleLog: typeof console.log;
  let originalConsoleError: typeof console.error;

  beforeEach(() => {
    consoleLogOutput = [];
    consoleErrorOutput = [];
    originalConsoleLog = console.log;
    originalConsoleError = console.error;
    console.log = (...args: unknown[]) => {
      consoleLogOutput.push(String(args[0]));
    };
    console.error = (...args: unknown[]) => {
      consoleErrorOutput.push(String(args[0]));
    };
  });

  afterEach(() => {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  });

  const mockClient = {
    cycles: {
      list: async () => [
        {
          id: "c1",
          name: "Sprint 1",
          start_date: "2026-01-01",
          end_date: "2026-01-14",
        },
        {
          id: "c2",
          name: "Sprint 2",
          start_date: "2026-01-15",
          end_date: "2026-01-28",
        },
      ],
      get: async () => ({
        id: "c1",
        name: "Sprint 1",
        start_date: "2026-01-01",
        end_date: "2026-01-14",
      }),
      create: async () => ({
        id: "c3",
        name: "New Sprint",
        start_date: "2026-02-01",
        end_date: "2026-02-14",
      }),
      update: async () => ({
        id: "c1",
        name: "Sprint 1 Updated",
        start_date: "2026-01-01",
        end_date: "2026-01-20",
      }),
      archive: async () => undefined,
      transfer: async () => undefined,
      workItems: async () => ({
        items: [
          {
            id: "w1",
            name: "Task 1",
            sequence_id: 1,
            state: "backlog",
            priority: "high" as const,
            assignees: [],
            labels: [],
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
          },
          {
            id: "w2",
            name: "Task 2",
            sequence_id: 2,
            state: "in_progress",
            priority: "medium" as const,
            assignees: [],
            labels: [],
            created_at: "2026-01-02T00:00:00Z",
            updated_at: "2026-01-02T00:00:00Z",
          },
        ],
        hasNext: false,
      }),
      addWorkItems: async () => undefined,
      removeWorkItem: async () => undefined,
    },
  } as unknown as PlaneClient;

  const mockConfig: Config = {
    version: 1,
    project: "550e8400-e29b-41d4-a716-446655440000",
  };

  describe("handleCyclesList", () => {
    it("should list cycles in table format", async () => {
      await handleCyclesList(
        { project: "550e8400-e29b-41d4-a716-446655440000" },
        { client: mockClient },
      );

      assert.ok(consoleLogOutput.length > 0);
      const output = consoleLogOutput.join("\n");
      assert.ok(output.includes("Sprint 1"));
      assert.ok(output.includes("Sprint 2"));
    });

    it("should list cycles in JSON format", async () => {
      await handleCyclesList(
        { project: "550e8400-e29b-41d4-a716-446655440000", json: true },
        { client: mockClient },
      );

      assert.equal(consoleLogOutput.length, 1);
      const parsed = JSON.parse(consoleLogOutput[0]);
      assert.ok(Array.isArray(parsed));
      assert.equal(parsed.length, 2);
      assert.equal(parsed[0].name, "Sprint 1");
    });
  });

  describe("handleCyclesGet", () => {
    it("should get a cycle by ID", async () => {
      await handleCyclesGet(
        "c1",
        { project: "550e8400-e29b-41d4-a716-446655440000" },
        { client: mockClient },
      );

      assert.ok(consoleLogOutput.length > 0);
      const output = consoleLogOutput.join("\n");
      assert.ok(output.includes("Sprint 1"));
      assert.ok(output.includes("c1"));
    });

    it("should get a cycle in JSON format", async () => {
      await handleCyclesGet(
        "c1",
        { project: "550e8400-e29b-41d4-a716-446655440000", json: true },
        { client: mockClient },
      );

      assert.equal(consoleLogOutput.length, 1);
      const parsed = JSON.parse(consoleLogOutput[0]);
      assert.equal(parsed.id, "c1");
      assert.equal(parsed.name, "Sprint 1");
    });
  });

  describe("handleCyclesCreate", () => {
    it("should create a cycle with minimal options", async () => {
      await handleCyclesCreate(
        {
          project: "550e8400-e29b-41d4-a716-446655440000",
          name: "New Sprint",
        },
        { client: mockClient },
      );

      assert.ok(consoleLogOutput.length > 0);
      const output = consoleLogOutput.join("\n");
      assert.ok(output.includes("New Sprint"));
    });

    it("should create a cycle in JSON format", async () => {
      await handleCyclesCreate(
        {
          project: "550e8400-e29b-41d4-a716-446655440000",
          name: "New Sprint",
          startDate: "2026-02-01",
          endDate: "2026-02-14",
          json: true,
        },
        { client: mockClient },
      );

      assert.equal(consoleLogOutput.length, 1);
      const parsed = JSON.parse(consoleLogOutput[0]);
      assert.equal(parsed.name, "New Sprint");
    });
  });

  describe("handleCyclesUpdate", () => {
    it("should update a cycle name", async () => {
      await handleCyclesUpdate(
        "c1",
        {
          project: "550e8400-e29b-41d4-a716-446655440000",
          name: "Sprint 1 Updated",
        },
        { client: mockClient },
      );

      assert.ok(consoleLogOutput.length > 0);
      const output = consoleLogOutput.join("\n");
      assert.ok(output.includes("Sprint 1 Updated"));
    });

    it("should update a cycle in JSON format", async () => {
      await handleCyclesUpdate(
        "c1",
        {
          project: "550e8400-e29b-41d4-a716-446655440000",
          name: "Sprint 1 Updated",
          json: true,
        },
        { client: mockClient },
      );

      assert.equal(consoleLogOutput.length, 1);
      const parsed = JSON.parse(consoleLogOutput[0]);
      assert.equal(parsed.name, "Sprint 1 Updated");
    });
  });

  describe("handleCyclesArchive", () => {
    it("should archive a cycle and log confirmation", async () => {
      await handleCyclesArchive(
        "c1",
        { project: "550e8400-e29b-41d4-a716-446655440000" },
        { client: mockClient },
      );

      assert.ok(consoleLogOutput.length > 0);
      assert.ok(consoleLogOutput[0].includes("archived"));
      assert.ok(consoleLogOutput[0].includes("c1"));
    });
  });

  describe("handleCyclesTransfer", () => {
    it("should transfer work items between cycles and log confirmation", async () => {
      await handleCyclesTransfer(
        "c1",
        "c2",
        { project: "550e8400-e29b-41d4-a716-446655440000" },
        { client: mockClient },
      );

      assert.ok(consoleLogOutput.length > 0);
      assert.ok(consoleLogOutput[0].includes("Transferred"));
      assert.ok(consoleLogOutput[0].includes("c1"));
      assert.ok(consoleLogOutput[0].includes("c2"));
    });
  });

  describe("handleCyclesWorkItems", () => {
    it("should list work items in a cycle", async () => {
      await handleCyclesWorkItems(
        "c1",
        { project: "550e8400-e29b-41d4-a716-446655440000" },
        { client: mockClient },
      );

      assert.ok(consoleLogOutput.length > 0);
      const output = consoleLogOutput.join("\n");
      assert.ok(output.includes("Task 1"));
      assert.ok(output.includes("Task 2"));
    });

    it("should list work items in JSON format", async () => {
      await handleCyclesWorkItems(
        "c1",
        { project: "550e8400-e29b-41d4-a716-446655440000", json: true },
        { client: mockClient },
      );

      assert.equal(consoleLogOutput.length, 1);
      const parsed = JSON.parse(consoleLogOutput[0]);
      assert.ok(Array.isArray(parsed));
      assert.equal(parsed.length, 2);
      assert.equal(parsed[0].name, "Task 1");
    });
  });

  describe("handleCyclesAddWorkItems", () => {
    it("should add single work item to cycle", async () => {
      await handleCyclesAddWorkItems(
        "c1",
        "w3",
        { project: "550e8400-e29b-41d4-a716-446655440000" },
        { client: mockClient },
      );

      assert.ok(consoleLogOutput.length > 0);
      assert.ok(consoleLogOutput[0].includes("Added 1 work item(s)"));
    });

    it("should add multiple work items to cycle", async () => {
      await handleCyclesAddWorkItems(
        "c1",
        "w3, w4, w5",
        { project: "550e8400-e29b-41d4-a716-446655440000" },
        { client: mockClient },
      );

      assert.ok(consoleLogOutput.length > 0);
      assert.ok(consoleLogOutput[0].includes("Added 3 work item(s)"));
    });

    it("should parse CSV with whitespace", async () => {
      await handleCyclesAddWorkItems(
        "c1",
        "w3 , w4 , w5",
        { project: "550e8400-e29b-41d4-a716-446655440000" },
        { client: mockClient },
      );

      assert.ok(consoleLogOutput.length > 0);
      assert.ok(consoleLogOutput[0].includes("Added 3 work item(s)"));
    });
  });

  describe("handleCyclesRemoveWorkItem", () => {
    it("should remove a work item from cycle and log confirmation", async () => {
      await handleCyclesRemoveWorkItem(
        "c1",
        "w1",
        { project: "550e8400-e29b-41d4-a716-446655440000" },
        { client: mockClient },
      );

      assert.ok(consoleLogOutput.length > 0);
      assert.ok(consoleLogOutput[0].includes("Removed"));
      assert.ok(consoleLogOutput[0].includes("w1"));
      assert.ok(consoleLogOutput[0].includes("cycle"));
    });
  });

  describe("error handling", () => {
    it("should throw error when project is not specified", async () => {
      const badMockClient = mockClient as PlaneClient;
      await assert.rejects(() =>
        handleCyclesList(
          { json: false },
          { client: badMockClient, config: { version: 1 } as Config },
        ),
      );
    });
  });
});
