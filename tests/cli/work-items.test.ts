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
import { NotFoundError, EXIT_NOT_FOUND } from "../../src/cli/shared.js";

describe("Work Items CLI Handlers", () => {
  let consoleLogOutput: string[];
  // stdout y stderr se acumulan juntos en consoleLogOutput por compatibilidad
  // con los casos que ya existían; consoleErrorOutput separa stderr para los
  // avisos que NO deben ensuciar la salida de datos.
  let consoleErrorOutput: string[];
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

  const mockModule = { id: "m1", name: "Module 1" };

  const mockClient = {
  projects: {
    get: async () => ({ id: "550e8400-e29b-41d4-a716-446655440000", identifier: "PROJ", name: "Proj" }),
  },
  states: { list: async () => [{ id: "s1", name: "Backlog", group: "backlog" }] },
    modules: {
      membershipMap: async () => new Map([["uuid1", [mockModule]]]),
    },
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
    project: "550e8400-e29b-41d4-a716-446655440000",
  };

  const mockDeps: HandlerDeps = {
    client: mockClient,
    config: mockConfig,
  };

  beforeEach(() => {
    consoleLogOutput = [];
    consoleErrorOutput = [];
    originalConsoleLog = console.log;
    originalConsoleError = console.error;
    console.log = (...args: unknown[]) => {
      consoleLogOutput.push(String(args[0]));
    };
    console.error = (...args: unknown[]) => {
      consoleLogOutput.push(String(args[0]));
      consoleErrorOutput.push(String(args[0]));
    };
  });

  afterEach(() => {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  });

  describe("handleWorkItemsList", () => {
    it("should list work items and format as table by default", async () => {
      await handleWorkItemsList(
        { project: "550e8400-e29b-41d4-a716-446655440000", json: false },
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
        { project: "550e8400-e29b-41d4-a716-446655440000", json: true },
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

      await handleWorkItemsList({ project: "550e8400-e29b-41d4-a716-446655440000", json: true }, spyDeps);

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
        { project: "550e8400-e29b-41d4-a716-446655440000", expand: "assignees,labels", json: true },
        spyDeps,
      );

      assert.deepEqual(captured?.expand, ["assignees", "labels"]);
    });

    // Client-side workaround for the API silently ignoring expand=modules.
    it("attaches module membership when --with-modules is passed", async () => {
      await handleWorkItemsList(
        { project: "550e8400-e29b-41d4-a716-446655440000", withModules: true, json: true },
        mockDeps,
      );

      const parsed = JSON.parse(consoleLogOutput[0]);
      assert.deepEqual(parsed[0].modules, [mockModule]);
    });

    it("does not call membershipMap when --with-modules is absent", async () => {
      let called = false;
      const spyDeps: HandlerDeps = {
        config: mockConfig,
        client: {
          workItems: { list: async () => mockItems },
          modules: { membershipMap: async () => { called = true; return new Map(); } },
        } as unknown as PlaneClient,
      };

      await handleWorkItemsList({ project: "550e8400-e29b-41d4-a716-446655440000", json: true }, spyDeps);

      assert.equal(called, false);
    });
  });

  describe("handleWorkItemsGet", () => {
    it("should get work item by identifier as JSON", async () => {
      await handleWorkItemsGet("PROJ-1", { json: true }, mockDeps);

      // mockWorkItem carries no `project`, so the comments check (which
      // needs it) is skipped — output stays a single JSON line.
      assert(consoleLogOutput.length > 0);
      const parsed = JSON.parse(consoleLogOutput[0]);
      assert.equal(parsed.id, "uuid1");
      assert.equal(parsed.name, "Test Work Item");
    });

    // A work item that does not exist is a failure, not a line of stdout: it
    // used to print "(not found)" and exit 0, which broke `| jq` with no error
    // and let `&&` chains carry on.
    it("throws NotFoundError when the identifier does not exist", async () => {
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

      await assert.rejects(
        () => handleWorkItemsGet("PROJ-999", { json: false }, notFoundDeps),
        (err: unknown) => {
          assert.ok(err instanceof NotFoundError);
          assert.equal(err.exitCode, EXIT_NOT_FOUND);
          assert.match(err.message, /PROJ-999/);
          return true;
        },
      );
      assert.equal(consoleLogOutput.length, 0, "nothing should reach stdout");
    });

    it("throws NotFoundError from get-by-id too", async () => {
      const notFoundDeps = {
        ...mockDeps,
        client: {
          ...mockClient,
          workItems: {
            ...mockClient.workItems,
            getById: async () => null,
          },
        } as unknown as PlaneClient,
      };

      await assert.rejects(
        () =>
          handleWorkItemsGetById(
            "uuid-missing",
            { project: "550e8400-e29b-41d4-a716-446655440000", json: true },
            notFoundDeps,
          ),
        (err: unknown) => err instanceof NotFoundError,
      );
      assert.equal(consoleLogOutput.length, 0, "nothing should reach stdout");
    });

    it("attaches module membership when --with-modules is passed", async () => {
      const withProjectDeps: HandlerDeps = {
        ...mockDeps,
        client: {
          ...mockClient,
          workItems: { ...mockClient.workItems, get: async () => ({ ...mockWorkItem, project: "p1" }) },
        } as unknown as PlaneClient,
      };

      await handleWorkItemsGet("PROJ-1", { withModules: true, json: true }, withProjectDeps);

      // Item now has a project, so the comments hint (mockComment, 1) fires
      // first (stderr) — the JSON is the second console line.
      const parsed = JSON.parse(consoleLogOutput[1]);
      assert.deepEqual(parsed.modules, [mockModule]);
    });

    it("throws when --with-modules is passed but the item has no resolvable project", async () => {
      await assert.rejects(
        () => handleWorkItemsGet("PROJ-1", { withModules: true, json: true }, mockDeps),
        /Cannot resolve project/,
      );
    });

    // Discoverability: comments are a separate resource from the work item,
    // so context/corrections living only in a comment used to go silently
    // unread. `get` now always checks and hints — no flag needed for that.
    describe("comment discoverability", () => {
      const withProjectDeps: HandlerDeps = {
        ...mockDeps,
        client: {
          ...mockClient,
          workItems: { ...mockClient.workItems, get: async () => ({ ...mockWorkItem, project: "p1" }) },
        } as unknown as PlaneClient,
      };

      it("prints a stderr hint when the item has comments", async () => {
        await handleWorkItemsGet("PROJ-1", { json: true }, withProjectDeps);

        assert.equal(consoleLogOutput.length, 2);
        assert(consoleLogOutput[0].includes("1 comment"));
        assert(consoleLogOutput[0].includes("comments list"));
        const parsed = JSON.parse(consoleLogOutput[1]);
        assert.equal(parsed.comments, undefined); // not attached without --with-comments
      });

      it("does not print a hint when the item has no comments", async () => {
        const noCommentsDeps: HandlerDeps = {
          ...withProjectDeps,
          client: {
            ...withProjectDeps.client,
            workItems: { ...(withProjectDeps.client as unknown as { workItems: object }).workItems, comments: { list: async () => [] } },
          } as unknown as PlaneClient,
        };

        await handleWorkItemsGet("PROJ-1", { json: true }, noCommentsDeps);

        assert.equal(consoleLogOutput.length, 1);
        JSON.parse(consoleLogOutput[0]); // still just the item
      });

      it("attaches comment bodies when --with-comments is passed", async () => {
        await handleWorkItemsGet("PROJ-1", { withComments: true, json: true }, withProjectDeps);

        const parsed = JSON.parse(consoleLogOutput[1]);
        assert.equal(parsed.comments.length, 1);
        assert.equal(parsed.comments[0].id, "cid1");
      });

      // The work item was already fetched successfully — a failure checking
      // comments (403 on a differently-scoped token, timeout, rate limit)
      // must degrade to a warning, not swallow the item data.
      it("still prints the item when the comments check itself fails", async () => {
        const failingCommentsDeps: HandlerDeps = {
          ...withProjectDeps,
          client: {
            ...withProjectDeps.client,
            workItems: {
              ...(withProjectDeps.client as unknown as { workItems: object }).workItems,
              comments: { list: async () => { throw new Error("403 Forbidden"); } },
            },
          } as unknown as PlaneClient,
        };

        await handleWorkItemsGet("PROJ-1", { json: true }, failingCommentsDeps);

        assert.equal(consoleLogOutput.length, 2);
        assert(consoleLogOutput[0].includes("Could not check comments"));
        assert(consoleLogOutput[0].includes("403 Forbidden"));
        const parsed = JSON.parse(consoleLogOutput[1]);
        assert.equal(parsed.id, "uuid1");
      });

      it("runs --with-modules and the comments check concurrently, not sequentially", async () => {
        const order: string[] = [];
        const concurrentDeps: HandlerDeps = {
          ...withProjectDeps,
          client: {
            ...withProjectDeps.client,
            modules: {
              membershipMap: async () => {
                order.push("modules:start");
                await new Promise((r) => setTimeout(r, 10));
                order.push("modules:end");
                return new Map([["uuid1", [mockModule]]]);
              },
            },
            workItems: {
              ...(withProjectDeps.client as unknown as { workItems: object }).workItems,
              comments: {
                list: async () => {
                  order.push("comments:start");
                  await new Promise((r) => setTimeout(r, 10));
                  order.push("comments:end");
                  return [];
                },
              },
            },
          } as unknown as PlaneClient,
        };

        await handleWorkItemsGet("PROJ-1", { withModules: true, json: true }, concurrentDeps);

        // Sequential would read modules:start, modules:end, comments:start,
        // comments:end. Concurrent interleaves the starts before either end.
        assert.deepEqual(order.slice(0, 2).sort(), ["comments:start", "modules:start"]);
      });
    });
  });

  describe("handleWorkItemsGetById", () => {
    it("should get work item by UUID as JSON", async () => {
      await handleWorkItemsGetById("uuid1", { project: "550e8400-e29b-41d4-a716-446655440000", json: true }, mockDeps);

      // project is always known for get-by-id, so the comments hint
      // (mockComment, 1) always fires first — JSON is the second line.
      assert.equal(consoleLogOutput.length, 2);
      const parsed = JSON.parse(consoleLogOutput[1]);
      assert.equal(parsed.id, "uuid1");
    });

    it("attaches module membership when --with-modules is passed", async () => {
      await handleWorkItemsGetById(
        "uuid1",
        { project: "550e8400-e29b-41d4-a716-446655440000", withModules: true, json: true },
        mockDeps,
      );

      const parsed = JSON.parse(consoleLogOutput[1]);
      assert.deepEqual(parsed.modules, [mockModule]);
    });

    it("attaches comment bodies when --with-comments is passed", async () => {
      await handleWorkItemsGetById(
        "uuid1",
        { project: "550e8400-e29b-41d4-a716-446655440000", withComments: true, json: true },
        mockDeps,
      );

      const parsed = JSON.parse(consoleLogOutput[1]);
      assert.equal(parsed.comments.length, 1);
      assert.equal(parsed.comments[0].id, "cid1");
    });
  });

  describe("handleWorkItemsSearch", () => {
    it("should search work items and format as table", async () => {
      await handleWorkItemsSearch(
        "test",
        { workspaceSearch: false, project: "550e8400-e29b-41d4-a716-446655440000", json: false },
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
        { project: "550e8400-e29b-41d4-a716-446655440000", name: "New Item", json: true },
        mockDeps,
      );

      const jsonLine = consoleLogOutput.find((l) => l.trimStart().startsWith("{"));
      assert.ok(jsonLine, `no salió JSON: ${JSON.stringify(consoleLogOutput)}`);
      const parsed = JSON.parse(jsonLine);
      assert(parsed.id);
      assert(parsed.name);
    });

    it("should create work item with priority and state", async () => {
      await handleWorkItemsCreate(
        {
          project: "550e8400-e29b-41d4-a716-446655440000",
          name: "New Item",
          priority: "high",
          state: "started",
          json: true,
        },
        mockDeps,
      );

      const jsonLine = consoleLogOutput.find((l) => l.trimStart().startsWith("{"));
      assert.ok(jsonLine, `no salió JSON: ${JSON.stringify(consoleLogOutput)}`);
      const parsed = JSON.parse(jsonLine);
      assert(parsed.id);
    });

    it("should parse CSV labels and assignees", async () => {
      await handleWorkItemsCreate(
        {
          project: "550e8400-e29b-41d4-a716-446655440000",
          name: "New Item",
          labels: "bug,urgent",
          assignees: "user1,user2",
          json: true,
        },
        mockDeps,
      );

      // El mock devuelve `assignees: []` para los dos que se piden, que es lo que
      // hace Plane con quien no es miembro activo del proyecto: acepta con 200 y
      // no guarda nada. Así que ahora salta el aviso y el JSON ya no es la
      // primera línea.
      const jsonLine = consoleLogOutput.find((l) => l.trimStart().startsWith("{"));
      assert.ok(jsonLine, `no salió JSON: ${JSON.stringify(consoleLogOutput)}`);
      const parsed = JSON.parse(jsonLine);
      assert(parsed.id);
      assert.ok(
        consoleErrorOutput.some((e) => e.includes("did not store")),
        "y debe avisar de que Plane descartó los assignees",
      );
    });

    // Q6: --module associates the created work item in a single command.
    it("adds the created work item to a module when --module is given", async () => {
      let addArgs: { moduleId?: string; ids?: string[] } = {};
      const spyDeps: HandlerDeps = {
        config: mockConfig,
        client: {
          workItems: { create: async () => ({ ...mockWorkItem, id: "created-uuid" }) },
          modules: {
            addWorkItems: async (_p: string, moduleId: string, ids: string[]) => {
              addArgs = { moduleId, ids };
            },
          },
        } as unknown as PlaneClient,
      };

      await handleWorkItemsCreate(
        {
          project: "550e8400-e29b-41d4-a716-446655440000",
          name: "New",
          module: "mod-1",
          json: true,
        },
        spyDeps,
      );

      assert.equal(addArgs.moduleId, "mod-1");
      assert.deepEqual(addArgs.ids, ["created-uuid"]);
    });

    it("does not touch modules when --module is absent", async () => {
      let addCalled = false;
      const spyDeps: HandlerDeps = {
        config: mockConfig,
        client: {
          workItems: { create: async () => ({ ...mockWorkItem, id: "created-uuid" }) },
          modules: {
            addWorkItems: async () => {
              addCalled = true;
            },
          },
        } as unknown as PlaneClient,
      };

      await handleWorkItemsCreate(
        {
          project: "550e8400-e29b-41d4-a716-446655440000",
          name: "New",
          json: true,
        },
        spyDeps,
      );

      assert.equal(addCalled, false);
    });
  });

  describe("handleWorkItemsUpdate", () => {
    it("should update work item name", async () => {
      await handleWorkItemsUpdate(
        "uuid1",
        { project: "550e8400-e29b-41d4-a716-446655440000", name: "Updated", json: true },
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
          project: "550e8400-e29b-41d4-a716-446655440000",
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

    // Q5: an NXI-N identifier is resolved to the UUID before the UUID-only PATCH.
    it("resolves an NXI-N identifier to the UUID before updating", async () => {
      let getCalledWith: string | undefined;
      let updatedId: string | undefined;
      const spyDeps: HandlerDeps = {
        config: mockConfig,
        client: {
          workItems: {
            get: async (id: string) => {
              getCalledWith = id;
              return { ...mockWorkItem, id: "resolved-uuid" };
            },
            update: async (_p: string, id: string) => {
              updatedId = id;
              return mockWorkItem;
            },
          },
        } as unknown as PlaneClient,
      };

      await handleWorkItemsUpdate(
        "NXI-42",
        { project: "550e8400-e29b-41d4-a716-446655440000", name: "x", json: true },
        spyDeps,
      );

      assert.equal(getCalledWith, "NXI-42");
      assert.equal(updatedId, "resolved-uuid");
    });

    it("does not do an extra lookup when the id is already a UUID", async () => {
      let getCalls = 0;
      let updatedId: string | undefined;
      const uuid = "660e8400-e29b-41d4-a716-446655440000";
      const spyDeps: HandlerDeps = {
        config: mockConfig,
        client: {
          workItems: {
            get: async () => {
              getCalls++;
              return null;
            },
            update: async (_p: string, id: string) => {
              updatedId = id;
              return mockWorkItem;
            },
          },
        } as unknown as PlaneClient,
      };

      await handleWorkItemsUpdate(
        uuid,
        { project: "550e8400-e29b-41d4-a716-446655440000", name: "x", json: true },
        spyDeps,
      );

      assert.equal(getCalls, 0);
      assert.equal(updatedId, uuid);
    });
  });

  describe("handleWorkItemsActivities", () => {
    it("should list activities as table", async () => {
      await handleWorkItemsActivities(
        "uuid1",
        { project: "550e8400-e29b-41d4-a716-446655440000", json: false },
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
        { project: "550e8400-e29b-41d4-a716-446655440000", json: true },
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
      await handleCommentsList("uuid1", { project: "550e8400-e29b-41d4-a716-446655440000", json: false }, mockDeps);

      assert(consoleLogOutput.length > 0);
      const output = consoleLogOutput[0];
      assert(output.includes("ID"));
      assert(output.includes("Created"));
    });

    it("should list comments as JSON", async () => {
      await handleCommentsList("uuid1", { project: "550e8400-e29b-41d4-a716-446655440000", json: true }, mockDeps);

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
        { project: "550e8400-e29b-41d4-a716-446655440000", json: true },
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
        { project: "550e8400-e29b-41d4-a716-446655440000", json: true },
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
        // Borrar un comentario también pide confirmación desde 0.19.0.
        { project: "550e8400-e29b-41d4-a716-446655440000", yes: true },
        mockDeps,
      );

      assert(consoleLogOutput.some((line) => line.includes("deleted")));
    });
  });

  describe("handleLinksCreate", () => {
    it("should create link with URL", async () => {
      await handleLinksCreate(
        "uuid1",
        { project: "550e8400-e29b-41d4-a716-446655440000", url: "https://example.com", json: true },
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
          project: "550e8400-e29b-41d4-a716-446655440000",
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
        { project: "550e8400-e29b-41d4-a716-446655440000", json: true },
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
      // Los ids van en crudo (no son PROJ-N), así que resolveWorkItemId los
      // devuelve tal cual y son distintos del origen: el guard de auto-relación
      // no aplica aquí, que es justo lo que este caso comprueba.
      await handleRelationsCreate(
        "uuid1",
        { project: "550e8400-e29b-41d4-a716-446655440000", type: "blocking", issues: "uuid2,uuid3", json: true },
        mockDeps,
      );

      // Este fichero acumula stdout y stderr en el mismo array, y `relations
      // create` avisa por stderr de que la v1 no puede borrar relaciones, así
      // que el JSON ya no es la primera línea.
      const jsonLine = consoleLogOutput.find((l) => l.trimStart().startsWith("["));
      assert.ok(jsonLine, `no salió JSON: ${JSON.stringify(consoleLogOutput)}`);
      const parsed = JSON.parse(jsonLine);
      assert(Array.isArray(parsed));
      assert.equal(parsed[0].relation_type, "blocking");
      assert.ok(
        consoleErrorOutput.some((e) => e.includes("cannot delete relations")),
        "y el aviso debe salir por stderr",
      );
    });
  });

  // PCL-7: `list` se quedaba en la primera página sin --all ni aviso, que es el
  // mismo fallo que `projects list` ya arregló.
  describe("pagination", () => {
    const project = "550e8400-e29b-41d4-a716-446655440000";

    it("warns on stderr when the listing was cut short", async () => {
      const truncatedDeps: HandlerDeps = {
        config: mockConfig,
        client: {
          workItems: {
            list: async () => ({ items: [{ id: "a", sequence_id: 1, name: "A" }], hasNext: true, total: 42 }),
          },
        } as unknown as PlaneClient,
      };

      await handleWorkItemsList({ project, json: true }, truncatedDeps);

      assert.ok(consoleErrorOutput.some((line) => line.includes("--all")));
    });

    it("says nothing when the listing is complete", async () => {
      await handleWorkItemsList({ project, json: true }, mockDeps);

      assert.ok(!consoleErrorOutput.some((line) => line.includes("--all")));
    });

    it("--all walks every page", async () => {
      let listAllCalled = false;
      const allDeps: HandlerDeps = {
        config: mockConfig,
        client: {
          workItems: {
            list: async () => {
              throw new Error("--all must not fall back to the single-page list()");
            },
            listAll: async function* () {
              listAllCalled = true;
              yield { id: "a", sequence_id: 1, name: "A" };
              yield { id: "b", sequence_id: 2, name: "B" };
            },
          },
        } as unknown as PlaneClient,
      };

      await handleWorkItemsList({ project, all: true, json: true }, allDeps);

      assert.equal(listAllCalled, true);
      const parsed = JSON.parse(consoleLogOutput[0]) as unknown[];
      assert.equal(parsed.length, 2);
    });
  });

  // PCL-6 sobre el listado principal.
  describe("state column", () => {
    it("prints the state name instead of [object Object]", async () => {
      const expandedDeps: HandlerDeps = {
        config: mockConfig,
        client: {
          projects: { get: async () => ({ id: "p1", identifier: "PROJ" }) },
          states: { list: async () => [{ id: "s1", name: "Backlog", group: "backlog" }] },
          workItems: {
            list: async () => ({
              items: [{ id: "a", sequence_id: 1, name: "A", state: { id: "s1", name: "Backlog" }, priority: "high" }],
              hasNext: false,
            }),
          },
        } as unknown as PlaneClient,
      };

      await handleWorkItemsList({ project: "550e8400-e29b-41d4-a716-446655440000", json: false }, expandedDeps);

      assert.ok(consoleLogOutput[0].includes("Backlog"));
      assert.ok(!consoleLogOutput[0].includes("[object Object]"));
    });
  });
});
