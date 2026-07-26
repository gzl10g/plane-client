import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type {
  PlaneClient,
  WorkItem,
  Page,
  Comment,
  RelationsMap,
  RelationType,
} from "../../src/index.js";
import type { Activity, WorkItemSearchResult } from "../../src/types.js";
import type { Config } from "../../src/cli/config.js";
import type { HandlerDeps } from "../../src/cli/shared.js";
import {
  handleWorkItemsList,
  handleWorkItemsGet,
  handleWorkItemsGetById,
  handleWorkItemsSearch,
  handleWorkItemsCreate,
  handleWorkItemsUpdate,
  handleWorkItemsActivities,
  handleCommentsList,
  handleCommentsCreate,
  handleCommentsUpdate,
  handleCommentsDelete,
  handleLinksCreate,
  handleRelationsList,
  handleRelationsCreate,
} from "../../src/cli/work-items.js";

describe("Work Items CLI Handlers", () => {
  let consoleLogOutput: string[];
  let originalConsoleLog: typeof console.log;
  let originalConsoleError: typeof console.error;

  const mockWorkItem: WorkItem = {
    id: "uuid1",
    sequence_id: 1,
    name: "Test Work Item",
    state: "s1",
    priority: "none",
    assignees: [],
    labels: [],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };

  const mockItems: Page<WorkItem> = {
    items: [mockWorkItem],
    hasNext: false,
  };

  const mockComment: Comment = {
    id: "cid1",
    comment_html: "<p>Test</p>",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };

  const mockActivity: Activity = {
    id: "aid1",
    verb: "updated",
    field: "state",
    old_value: "backlog",
    new_value: "in_progress",
    comment: null,
    actor: "user1",
    created_at: "2026-01-01T00:00:00Z",
  };

  const mockSearchResult: WorkItemSearchResult = {
    id: "uuid1",
    name: "Test Work Item",
    sequence_id: 1,
    project__identifier: "PROJ",
    project_id: "p1",
    workspace__slug: "ws",
  };

  const mockClient = {
    workItems: {
      list: async () => mockItems,
      get: async () => mockWorkItem,
      getById: async () => mockWorkItem,
      search: async () => [mockSearchResult],
      create: async () => ({ ...mockWorkItem, id: "uuid-new" }),
      update: async () => ({ ...mockWorkItem, name: "Updated" }),
      comments: {
        list: async () => [mockComment],
        create: async () => mockComment,
        update: async () => mockComment,
        delete: async () => undefined,
      },
      links: {
        create: async () => ({ id: "link1" }),
      },
      relations: {
        list: async () => ({
          blocking: [{ project_id: "p1", issue_id: "uuid2" }],
          blocked_by: [],
          relates_to: [],
          duplicate: [],
          start_before: [],
          start_after: [],
          finish_before: [],
          finish_after: [],
        } as RelationsMap),
        create: async () => [
          {
            id: "uuid2",
            name: "Related Item",
            sequence_id: 2,
            project_id: "p1",
            relation_type: "blocking" as RelationType,
            state_id: "s1",
            priority: "none",
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
          },
        ],
      },
      activities: {
        list: async () => ({
          items: [mockActivity],
          hasNext: false,
        }),
      },
    },
  } as unknown as PlaneClient;

  const mockConfig: Config = {
    version: 1,
    baseUrl: "http://localhost:8000",
    apiKey: "test-key",
    workspace: "test-workspace",
    project: "p1",
  };

  const mockDeps: HandlerDeps = {
    client: mockClient,
    config: mockConfig,
  };

  beforeEach(() => {
    consoleLogOutput = [];
    originalConsoleLog = console.log;
    originalConsoleError = console.error;
    console.log = (...args: unknown[]) => {
      consoleLogOutput.push(String(args[0]));
    };
    console.error = (...args: unknown[]) => {
      consoleLogOutput.push(String(args[0]));
    };
  });

  afterEach(() => {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  });

  describe("handleWorkItemsList", () => {
    it("should list work items and format as table by default", async () => {
      await handleWorkItemsList(
        { project: "p1", json: false },
        mockDeps,
      );

      assert(consoleLogOutput.length > 0);
      const output = consoleLogOutput[0];
      assert(output.includes("ID"));
      assert(output.includes("Name"));
      assert(output.includes("Test Work Item"));
    });

    it("should list work items as JSON", async () => {
      await handleWorkItemsList(
        { project: "p1", json: true },
        mockDeps,
      );

      assert(consoleLogOutput.length > 0);
      const parsed = JSON.parse(consoleLogOutput[0]);
      assert(Array.isArray(parsed));
      assert.equal(parsed[0].id, "uuid1");
    });

    // B2: expand must be forwarded so state/module_ids get populated.
    it("defaults expand to state,modules when --expand is absent", async () => {
      let captured: { expand?: string[] } | undefined;
      const spyDeps: HandlerDeps = {
        config: mockConfig,
        client: {
          workItems: {
            list: async (_p: string, opts: { expand?: string[] }) => {
              captured = opts;
              return mockItems;
            },
          },
        } as unknown as PlaneClient,
      };

      await handleWorkItemsList({ project: "p1", json: true }, spyDeps);

      assert.deepEqual(captured?.expand, ["state", "modules"]);
    });

    it("forwards a custom --expand list to the client", async () => {
      let captured: { expand?: string[] } | undefined;
      const spyDeps: HandlerDeps = {
        config: mockConfig,
        client: {
          workItems: {
            list: async (_p: string, opts: { expand?: string[] }) => {
              captured = opts;
              return mockItems;
            },
          },
        } as unknown as PlaneClient,
      };

      await handleWorkItemsList(
        { project: "p1", expand: "assignees,labels", json: true },
        spyDeps,
      );

      assert.deepEqual(captured?.expand, ["assignees", "labels"]);
    });
  });

  describe("handleWorkItemsGet", () => {
    it("should get work item by identifier as JSON", async () => {
      await handleWorkItemsGet("PROJ-1", { json: true }, mockDeps);

      assert(consoleLogOutput.length > 0);
      const parsed = JSON.parse(consoleLogOutput[0]);
      assert.equal(parsed.id, "uuid1");
      assert.equal(parsed.name, "Test Work Item");
    });

    it("should show (not found) when identifier not found", async () => {
      const notFoundDeps = {
        ...mockDeps,
        client: {
          ...mockClient,
          workItems: {
            ...mockClient.workItems,
            get: async () => null,
          },
        } as unknown as PlaneClient,
      };

      await handleWorkItemsGet("PROJ-999", { json: false }, notFoundDeps);

      assert(consoleLogOutput.some((line) =>
        line.includes("(not found)"),
      ));
    });
  });

  describe("handleWorkItemsGetById", () => {
    it("should get work item by UUID as JSON", async () => {
      await handleWorkItemsGetById("uuid1", { project: "p1", json: true }, mockDeps);

      assert(consoleLogOutput.length > 0);
      const parsed = JSON.parse(consoleLogOutput[0]);
      assert.equal(parsed.id, "uuid1");
    });
  });

  describe("handleWorkItemsSearch", () => {
    it("should search work items and format as table", async () => {
      await handleWorkItemsSearch(
        "test",
        { workspaceSearch: false, project: "p1", json: false },
        mockDeps,
      );

      assert(consoleLogOutput.length > 0);
      const output = consoleLogOutput[0];
      assert(output.includes("ID"));
      assert(output.includes("Project"));
      assert(output.includes("PROJ"));
    });

    it("should search work items as JSON", async () => {
      await handleWorkItemsSearch(
        "test",
        { workspaceSearch: true, limit: 10, json: true },
        mockDeps,
      );

      assert(consoleLogOutput.length > 0);
      const parsed = JSON.parse(consoleLogOutput[0]);
      assert(Array.isArray(parsed));
      assert.equal(parsed[0].name, "Test Work Item");
    });
  });

  describe("handleWorkItemsCreate", () => {
    it("should create work item with required name", async () => {
      await handleWorkItemsCreate(
        { project: "p1", name: "New Item", json: true },
        mockDeps,
      );

      assert(consoleLogOutput.length > 0);
      const parsed = JSON.parse(consoleLogOutput[0]);
      assert(parsed.id);
      assert(parsed.name);
    });

    it("should create work item with priority and state", async () => {
      await handleWorkItemsCreate(
        {
          project: "p1",
          name: "New Item",
          priority: "high",
          state: "started",
          json: true,
        },
        mockDeps,
      );

      assert(consoleLogOutput.length > 0);
      const parsed = JSON.parse(consoleLogOutput[0]);
      assert(parsed.id);
    });

    it("should parse CSV labels and assignees", async () => {
      await handleWorkItemsCreate(
        {
          project: "p1",
          name: "New Item",
          labels: "bug,urgent",
          assignees: "user1,user2",
          json: true,
        },
        mockDeps,
      );

      assert(consoleLogOutput.length > 0);
      const parsed = JSON.parse(consoleLogOutput[0]);
      assert(parsed.id);
    });
  });

  describe("handleWorkItemsUpdate", () => {
    it("should update work item name", async () => {
      await handleWorkItemsUpdate(
        "uuid1",
        { project: "p1", name: "Updated", json: true },
        mockDeps,
      );

      assert(consoleLogOutput.length > 0);
      const parsed = JSON.parse(consoleLogOutput[0]);
      assert.equal(parsed.name, "Updated");
    });

    it("should update priority and state", async () => {
      await handleWorkItemsUpdate(
        "uuid1",
        {
          project: "p1",
          priority: "urgent",
          state: "in_progress",
          json: true,
        },
        mockDeps,
      );

      assert(consoleLogOutput.length > 0);
      const parsed = JSON.parse(consoleLogOutput[0]);
      assert(parsed.id);
    });
  });

  describe("handleWorkItemsActivities", () => {
    it("should list activities as table", async () => {
      await handleWorkItemsActivities(
        "uuid1",
        { project: "p1", json: false },
        mockDeps,
      );

      assert(consoleLogOutput.length > 0);
      const output = consoleLogOutput[0];
      assert(output.includes("Verb"));
      assert(output.includes("Field"));
      assert(output.includes("updated"));
    });

    it("should list activities as JSON", async () => {
      await handleWorkItemsActivities(
        "uuid1",
        { project: "p1", json: true },
        mockDeps,
      );

      assert(consoleLogOutput.length > 0);
      const parsed = JSON.parse(consoleLogOutput[0]);
      assert(Array.isArray(parsed));
      assert.equal(parsed[0].verb, "updated");
    });
  });

  describe("handleCommentsList", () => {
    it("should list comments as table", async () => {
      await handleCommentsList("uuid1", { project: "p1", json: false }, mockDeps);

      assert(consoleLogOutput.length > 0);
      const output = consoleLogOutput[0];
      assert(output.includes("ID"));
      assert(output.includes("Created"));
    });

    it("should list comments as JSON", async () => {
      await handleCommentsList("uuid1", { project: "p1", json: true }, mockDeps);

      assert(consoleLogOutput.length > 0);
      const parsed = JSON.parse(consoleLogOutput[0]);
      assert(Array.isArray(parsed));
      assert.equal(parsed[0].id, "cid1");
    });
  });

  describe("handleCommentsCreate", () => {
    it("should create comment with HTML content", async () => {
      await handleCommentsCreate(
        "uuid1",
        "<p>New comment</p>",
        { project: "p1", json: true },
        mockDeps,
      );

      assert(consoleLogOutput.length > 0);
      const parsed = JSON.parse(consoleLogOutput[0]);
      assert.equal(parsed.id, "cid1");
    });
  });

  describe("handleCommentsUpdate", () => {
    it("should update comment HTML content", async () => {
      await handleCommentsUpdate(
        "uuid1",
        "cid1",
        "<p>Updated comment</p>",
        { project: "p1", json: true },
        mockDeps,
      );

      assert(consoleLogOutput.length > 0);
      const parsed = JSON.parse(consoleLogOutput[0]);
      assert.equal(parsed.id, "cid1");
    });
  });

  describe("handleCommentsDelete", () => {
    it("should delete comment and confirm", async () => {
      await handleCommentsDelete(
        "uuid1",
        "cid1",
        { project: "p1" },
        mockDeps,
      );

      assert(consoleLogOutput.some((line) => line.includes("deleted")));
    });
  });

  describe("handleLinksCreate", () => {
    it("should create link with URL", async () => {
      await handleLinksCreate(
        "uuid1",
        { project: "p1", url: "https://example.com", json: true },
        mockDeps,
      );

      assert(consoleLogOutput.length > 0);
      const parsed = JSON.parse(consoleLogOutput[0]);
      assert(parsed.id);
    });

    it("should create link with title", async () => {
      await handleLinksCreate(
        "uuid1",
        {
          project: "p1",
          url: "https://example.com",
          title: "Example",
          json: true,
        },
        mockDeps,
      );

      assert(consoleLogOutput.length > 0);
      const parsed = JSON.parse(consoleLogOutput[0]);
      assert(parsed.id);
    });
  });

  describe("handleRelationsList", () => {
    it("should list relations as JSON", async () => {
      await handleRelationsList(
        "uuid1",
        { project: "p1", json: true },
        mockDeps,
      );

      assert(consoleLogOutput.length > 0);
      const parsed = JSON.parse(consoleLogOutput[0]);
      assert(parsed.blocking);
      assert(Array.isArray(parsed.blocking));
    });
  });

  describe("handleRelationsCreate", () => {
    it("should create relation with type and issues", async () => {
      await handleRelationsCreate(
        "uuid1",
        { project: "p1", type: "blocking", issues: "uuid2,uuid3", json: true },
        mockDeps,
      );

      assert(consoleLogOutput.length > 0);
      const parsed = JSON.parse(consoleLogOutput[0]);
      assert(Array.isArray(parsed));
      assert.equal(parsed[0].relation_type, "blocking");
    });
  });
});
