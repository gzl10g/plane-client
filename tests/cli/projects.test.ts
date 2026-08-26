import { describe, it } from "node:test";
import * as assert from "node:assert";
import {
  handleProjectsList,
  handleProjectsCreate,
  handleProjectsUpdate,
  handleProjectsDelete,
} from "../../src/cli/projects.js";
import type { PlaneClient } from "../../src/client.js";

function mockClient(pages: Array<{ items: unknown[]; nextCursor?: string }>): {
  client: PlaneClient;
  calls: Array<{ perPage?: number; cursor?: string }>;
} {
  const calls: Array<{ perPage?: number; cursor?: string }> = [];
  let i = 0;
  const client = {
    projects: {
      list: async (opts?: { perPage?: number; cursor?: string }) => {
        calls.push({ perPage: opts?.perPage, cursor: opts?.cursor });
        const page = pages[Math.min(i++, pages.length - 1)];
        return { items: page.items, nextCursor: page.nextCursor, hasNext: page.nextCursor !== undefined };
      },
      listAll: async function* (opts?: { perPage?: number }) {
        let cursor: string | undefined;
        do {
          const page = await client.projects.list({ ...opts, cursor });
          for (const item of page.items) yield item;
          cursor = page.nextCursor;
        } while (cursor);
      },
    },
  } as unknown as PlaneClient & {
    projects: {
      list: (opts?: { perPage?: number; cursor?: string }) => Promise<{ items: unknown[]; nextCursor?: string; hasNext: boolean }>;
    };
  };
  return { client, calls };
}

function captureLog(fn: () => Promise<void>): Promise<string> {
  return (async () => {
    let output = "";
    const originalLog = console.log;
    console.log = (msg: string) => { output = msg; };
    try {
      await fn();
    } finally {
      console.log = originalLog;
    }
    return output;
  })();
}

const PROJECTS = [
  { id: "a13d3b53-4ac0-4572-a741-927967a54024", name: "Homelab", identifier: "HL" },
  { id: "046db1fe-3974-4d7c-9fdf-5ad390ca9b9a", name: "Plane Client", identifier: "PCL" },
];

describe("projects CLI handlers", () => {
  it("handleProjectsList returns projects as JSON", async () => {
    const { client } = mockClient([{ items: PROJECTS }]);
    const output = await captureLog(() =>
      handleProjectsList({ json: true }, { client, config: { version: 1 } }),
    );

    const parsed = JSON.parse(output);
    assert.strictEqual(Array.isArray(parsed), true, "output should be array");
    assert.strictEqual(parsed.length, 2);
    assert.strictEqual(parsed[0].identifier, "HL");
    assert.strictEqual(parsed[1].id, "046db1fe-3974-4d7c-9fdf-5ad390ca9b9a");
  });

  it("handleProjectsList formats identifier / name / uuid as a table", async () => {
    const { client } = mockClient([{ items: PROJECTS }]);
    const output = await captureLog(() =>
      handleProjectsList({ json: false }, { client, config: { version: 1 } }),
    );

    assert.ok(output.includes("Identifier"), "table should have Identifier column");
    assert.ok(output.includes("Name"), "table should have Name column");
    assert.ok(output.includes("UUID"), "table should have UUID column");
    assert.ok(output.includes("PCL"), "table should contain the project identifier");
    assert.ok(output.includes("046db1fe-3974-4d7c-9fdf-5ad390ca9b9a"), "table should contain the UUID");
  });

  it("handleProjectsList walks every page instead of truncating at the first", async () => {
    const { client, calls } = mockClient([
      { items: [PROJECTS[0]], nextCursor: "1:1:0" },
      { items: [PROJECTS[1]] },
    ]);
    const output = await captureLog(() =>
      handleProjectsList({ json: true }, { client, config: { version: 1 } }),
    );

    assert.strictEqual(JSON.parse(output).length, 2);
    assert.strictEqual(calls.length, 2, "should have requested both pages");
    assert.strictEqual(calls[1].cursor, "1:1:0");
  });

  it("handleProjectsList forwards --per-page", async () => {
    const { client, calls } = mockClient([{ items: PROJECTS }]);
    await captureLog(() =>
      handleProjectsList({ perPage: "50", json: true }, { client, config: { version: 1 } }),
    );

    assert.strictEqual(calls[0].perPage, 50);
  });

  it("handleProjectsList rejects a non-numeric --per-page", async () => {
    const { client } = mockClient([{ items: [] }]);
    await assert.rejects(
      () => handleProjectsList({ perPage: "many", json: true }, { client, config: { version: 1 } }),
      /Invalid --per-page/,
    );
  });

  it("handleProjectsList warns on stderr when the workspace has no projects", async () => {
    const { client } = mockClient([{ items: [] }]);
    let stderr = "";
    const originalError = console.error;
    console.error = (msg: string) => { stderr = msg; };
    try {
      await captureLog(() =>
        handleProjectsList({ json: true }, { client, config: { version: 1, workspace: "gzl10" } }),
      );
    } finally {
      console.error = originalError;
    }

    assert.ok(stderr.includes("workspace=gzl10"), "warning should echo the workspace in use");
  });

  it("handleProjectsCreate applies the default toggles: modules/intake/views on, cycles/pages off", async () => {
    let received: Record<string, unknown> | undefined;
    const client = {
      projects: {
        create: async (input: Record<string, unknown>) => {
          received = input;
          return { id: "p1", identifier: "TEST89", name: "test89" };
        },
      },
    } as unknown as PlaneClient;

    const originalError = console.error;
    console.error = () => {};
    try {
      await captureLog(() =>
        handleProjectsCreate(
          { name: "test89", identifier: "TEST89", json: true },
          { client, config: { version: 1 } },
        ),
      );
    } finally {
      console.error = originalError;
    }

    assert.strictEqual(received?.moduleView, true);
    assert.strictEqual(received?.intakeView, true);
    assert.strictEqual(received?.viewsView, true);
    assert.strictEqual(received?.cycleView, false);
    assert.strictEqual(received?.pageView, false);
  });

  it("handleProjectsCreate uppercases the identifier and honours --cycles", async () => {
    let received: Record<string, unknown> | undefined;
    const client = {
      projects: {
        create: async (input: Record<string, unknown>) => {
          received = input;
          return { id: "p1" };
        },
      },
    } as unknown as PlaneClient;

    const originalError = console.error;
    console.error = () => {};
    try {
      await captureLog(() =>
        handleProjectsCreate(
          { name: "x", identifier: "test89", cycles: true, json: true },
          { client, config: { version: 1 } },
        ),
      );
    } finally {
      console.error = originalError;
    }

    assert.strictEqual(received?.identifier, "TEST89");
    assert.strictEqual(received?.cycleView, true);
  });

  it("handleProjectsUpdate resolves an identifier to the UUID before patching", async () => {
    let patched: { id?: string; input?: Record<string, unknown> } = {};
    const client = {
      projects: {
        listAll: async function* () {
          yield { id: "uuid-1", identifier: "TEST89", name: "test89" };
        },
        update: async (id: string, input: Record<string, unknown>) => {
          patched = { id, input };
          return { id, ...input };
        },
      },
    } as unknown as PlaneClient;

    await captureLog(() =>
      handleProjectsUpdate("test89", { name: "renombrado", json: true }, { client, config: { version: 1 } }),
    );

    assert.strictEqual(patched.id, "uuid-1");
    assert.strictEqual(patched.input?.name, "renombrado");
  });

  it("handleProjectsUpdate rejects a no-op update", async () => {
    const client = {
      projects: {
        get: async () => ({ id: "uuid-1", identifier: "TEST89" }),
        update: async () => { throw new Error("should not be called"); },
      },
    } as unknown as PlaneClient;

    await assert.rejects(
      () => handleProjectsUpdate(
        "a13d3b53-4ac0-4572-a741-927967a54024",
        { json: true },
        { client, config: { version: 1 } },
      ),
      /Nothing to update/,
    );
  });

  it("handleProjectsDelete refuses when --confirm does not match the identifier", async () => {
    let deleted = false;
    const client = deletableClient(() => { deleted = true; });

    const originalError = console.error;
    console.error = () => {};
    try {
      await assert.rejects(
        () => handleProjectsDelete("TEST89", { confirm: "TEST88" }, { client, config: { version: 1 } }),
        /does not match the project identifier/,
      );
    } finally {
      console.error = originalError;
    }
    assert.strictEqual(deleted, false, "nothing may be deleted on a mismatch");
  });

  it("handleProjectsDelete deletes when --confirm matches (case-insensitive)", async () => {
    let deleted = false;
    const client = deletableClient(() => { deleted = true; });

    const originalError = console.error;
    console.error = () => {};
    try {
      await captureLog(() =>
        handleProjectsDelete("TEST89", { confirm: "test89" }, { client, config: { version: 1 } }),
      );
    } finally {
      console.error = originalError;
    }
    assert.strictEqual(deleted, true);
  });

  it("handleProjectsDelete --dry-run reports the blast radius without deleting", async () => {
    let deleted = false;
    const client = deletableClient(() => { deleted = true; });

    const output = await captureLog(() =>
      handleProjectsDelete("TEST89", { dryRun: true }, { client, config: { version: 1 } }),
    );

    assert.strictEqual(deleted, false, "--dry-run must not delete");
    assert.ok(output.includes("Would delete"), "should announce it is a dry run");
    assert.ok(output.includes("TEST89"), "should name the project");
    assert.ok(output.includes("work items: 7"), "should report the work item count");
    assert.ok(output.includes("cycles: 2"), "should report the cycle count");
  });

  it("handleProjectsDelete degrades to ? when a feature-disabled count fails", async () => {
    const client = deletableClient(() => {}, { failCycles: true });

    const output = await captureLog(() =>
      handleProjectsDelete("TEST89", { dryRun: true }, { client, config: { version: 1 } }),
    );

    assert.ok(output.includes("cycles: ?"), "a failed count must not block the command");
    assert.ok(output.includes("work items: 7"), "the counts that did work are still reported");
  });
});

/** Client stub for the delete tests: one project, a known content inventory. */
function deletableClient(onDelete: () => void, opts?: { failCycles?: boolean }): PlaneClient {
  return {
    projects: {
      listAll: async function* () {
        yield { id: "uuid-1", identifier: "TEST89", name: "test89" };
      },
      delete: async () => { onDelete(); },
    },
    workItems: { list: async () => ({ items: [], hasNext: false, total: 7 }) },
    modules: { list: async () => [{ id: "m1" }] },
    cycles: {
      list: async () => {
        if (opts?.failCycles) throw new Error("Cycles are not enabled for this project");
        return [{ id: "c1" }, { id: "c2" }];
      },
    },
    intake: { list: async () => ({ items: [], hasNext: false, total: 0 }) },
  } as unknown as PlaneClient;
}
