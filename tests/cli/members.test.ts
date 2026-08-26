import { describe, it } from "node:test";
import * as assert from "node:assert";
import {
  handleMembersList,
  handleProjectMembersList,
  handleProjectMembersAdd,
  handleProjectMembersDeactivate,
  handleInvitationsCreate,
  resolveAssignees,
} from "../../src/cli/members.js";
import type { PlaneClient } from "../../src/client.js";
import { PlaneApiError } from "../../src/error.js";

const PROJECT = "550e8400-e29b-41d4-a716-446655440000";

function capture() {
  const originalLog = console.log;
  const originalError = console.error;
  const out: string[] = [];
  const err: string[] = [];
  console.log = (msg?: unknown) => { out.push(String(msg)); };
  console.error = (msg?: unknown) => { err.push(String(msg)); };
  return {
    out,
    err,
    restore: () => { console.log = originalLog; console.error = originalError; },
  };
}

async function* iterate<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) yield item;
}

function memberClient(members: Record<string, unknown>[], projectMembers = members) {
  return {
    members: {
      listAll: () => iterate(members),
      resolveMany: async (refs: string[]) =>
        refs.map((ref) => {
          const found = members.find(
            (m) => m.display_name === ref || m.email === ref || m.id === ref,
          );
          if (!found) throw new Error(`No workspace member matches: ${ref}`);
          return found.id as string;
        }),
    },
    projectMembers: {
      listAll: () => iterate(projectMembers),
      add: async (_projectId: string, userId: string, role: number) => ({
        id: `pm-${userId}`,
        member: userId,
        role,
      }),
      deactivate: async () => undefined,
    },
  } as unknown as PlaneClient;
}

const IVY = { id: "u1", display_name: "ivy", email: "ivy@example.com", role: 15, is_active: true, is_bot: false };
const CODEX = { id: "u2", display_name: "codex", email: "codex@example.com", role: 5, is_active: false, is_bot: false };

describe("members CLI handlers", () => {
  it("handleMembersList emits raw members as JSON", async () => {
    const cap = capture();
    try {
      await handleMembersList({ json: true }, { client: memberClient([IVY]), config: { workspace: "ws" } as never });
      const parsed = JSON.parse(cap.out.join("\n"));
      assert.strictEqual(parsed[0].display_name, "ivy");
      assert.strictEqual(parsed[0].role, 15);
    } finally { cap.restore(); }
  });

  it("handleMembersList renders the role name and a loud Active=NO in the table", async () => {
    const cap = capture();
    try {
      await handleMembersList({}, { client: memberClient([IVY, CODEX]), config: { workspace: "ws" } as never });
      const table = cap.out.join("\n");
      assert.match(table, /member/);
      assert.match(table, /guest/);
      // A deactivated membership Plane still lists must be visible at a glance.
      assert.match(table, /NO/);
    } finally { cap.restore(); }
  });

  it("handleProjectMembersList warns with context when a project has no members", async () => {
    const cap = capture();
    try {
      await handleProjectMembersList(
        { project: PROJECT, json: true },
        { client: memberClient([]), config: { workspace: "ws" } as never },
      );
      assert.match(cap.err.join("\n"), /No results/);
    } finally { cap.restore(); }
  });

  it("handleProjectMembersAdd resolves names and defaults to member, not guest", async () => {
    const cap = capture();
    try {
      await handleProjectMembersAdd(
        { project: PROJECT, member: "ivy", json: true },
        { client: memberClient([IVY]), config: { workspace: "ws" } as never },
      );
      const parsed = JSON.parse(cap.out.join("\n"));
      assert.strictEqual(parsed.member, "u1");
      assert.strictEqual(parsed.role, 15);
      // The membership id is undiscoverable afterwards, so the note must be there.
      assert.match(cap.err.join("\n"), /membership id/);
    } finally { cap.restore(); }
  });

  it("handleProjectMembersAdd accepts a comma-separated list", async () => {
    const cap = capture();
    try {
      await handleProjectMembersAdd(
        { project: PROJECT, member: "ivy,codex", role: "admin", json: true },
        { client: memberClient([IVY, CODEX]), config: { workspace: "ws" } as never },
      );
      const parsed = JSON.parse(cap.out.join("\n"));
      assert.strictEqual(parsed.length, 2);
      assert.strictEqual(parsed[1].member, "u2");
      assert.strictEqual(parsed[0].role, 20);
    } finally { cap.restore(); }
  });

  it("handleProjectMembersAdd rejects an unknown role before hitting the API", async () => {
    const cap = capture();
    try {
      await assert.rejects(
        () => handleProjectMembersAdd(
          { project: PROJECT, member: "ivy", role: "owner" },
          { client: memberClient([IVY]), config: { workspace: "ws" } as never },
        ),
        /Invalid role/,
      );
    } finally { cap.restore(); }
  });

  it("handleProjectMembersDeactivate with --yes says the listing keeps showing the user", async () => {
    const cap = capture();
    try {
      await handleProjectMembersDeactivate(
        "pm1",
        { project: PROJECT, yes: true },
        { client: memberClient([IVY]), config: { workspace: "ws" } as never },
      );
      const stderr = cap.err.join("\n");
      assert.match(stderr, /Deactivated/);
      assert.match(stderr, /Active=NO/);
    } finally { cap.restore(); }
  });

  it("handleInvitationsCreate warns that v1 sends no email", async () => {
    const cap = capture();
    const client = {
      invitations: {
        create: async (input: { email: string; role: number }) => ({ id: "i1", ...input, accepted: false }),
      },
    } as unknown as PlaneClient;
    try {
      await handleInvitationsCreate("new@example.com", { role: "guest", json: true }, { client, config: { workspace: "ws" } as never });
      const parsed = JSON.parse(cap.out.join("\n"));
      assert.strictEqual(parsed.role, 5);
      assert.match(cap.err.join("\n"), /does not send an invitation email/);
    } finally { cap.restore(); }
  });
});

describe("members CLI failure modes", () => {
  it("add prints each membership as it is created, so a later failure loses none", async () => {
    const cap = capture();
    const client = {
      members: { resolveMany: async () => ["u1", "u2"] },
      projectMembers: {
        add: async (_p: string, userId: string) => {
          // Re-adding a deactivated user is exactly what answers 400 in Plane.
          if (userId === "u2") throw new Error("400 The payload is not valid");
          return { id: "pm-u1", member: userId, role: 15 };
        },
      },
    } as unknown as PlaneClient;
    try {
      await assert.rejects(
        () => handleProjectMembersAdd(
          { project: PROJECT, member: "ivy,codex" },
          { client, config: { workspace: "ws" } as never },
        ),
        /payload is not valid/,
      );
      // The id of the membership that WAS created must have reached the user:
      // no listing can recover it afterwards.
      assert.match(cap.out.join("\n"), /pm-u1/);
      assert.match(cap.err.join("\n"), /membership id/);
    } finally { cap.restore(); }
  });

  it("resolveAssignees warns but does not fail the write when the membership check errors", async () => {
    const cap = capture();
    const client = {
      members: { resolveMany: async () => ["u1"] },
      projectMembers: {
        listAll: () => {
          async function* boom(): AsyncIterable<never> {
            // eslint-disable-next-line @typescript-eslint/only-throw-error
            throw new Error("429 Too Many Requests");
          }
          return boom();
        },
      },
    } as unknown as PlaneClient;
    try {
      const ids = await resolveAssignees(client, PROJECT, ["ivy"]);
      assert.deepStrictEqual(ids, ["u1"]);
      assert.match(cap.err.join("\n"), /could not verify project membership/);
    } finally { cap.restore(); }
  });
});

describe("resolveAssignees", () => {
  it("returns the resolved user ids without warning when everybody is an active project member", async () => {
    const cap = capture();
    try {
      const ids = await resolveAssignees(memberClient([IVY]), PROJECT, ["ivy"]);
      assert.deepStrictEqual(ids, ["u1"]);
      assert.strictEqual(cap.err.length, 0);
    } finally { cap.restore(); }
  });

  it("warns about an assignee Plane will silently drop (not a project member)", async () => {
    const cap = capture();
    try {
      // ivy exists in the workspace but the project has nobody in it.
      const ids = await resolveAssignees(memberClient([IVY], []), PROJECT, ["ivy"]);
      assert.deepStrictEqual(ids, ["u1"]);
      assert.match(cap.err.join("\n"), /drop the assignee silently/);
    } finally { cap.restore(); }
  });

  it("warns when the membership exists but is deactivated", async () => {
    const cap = capture();
    try {
      await resolveAssignees(memberClient([CODEX], [CODEX]), PROJECT, ["codex"]);
      assert.match(cap.err.join("\n"), /not an active member/);
    } finally { cap.restore(); }
  });
});

describe("non-interactive safety (PCL-2)", () => {
  // A cron or an agent runs with stdin closed. Before the guard, readline's
  // question() never resolved there: the command hung until Node killed it with
  // exit 13, which reads as "the CLI is broken" rather than "pass --yes".
  function withoutTTY<T>(fn: () => Promise<T>): Promise<T> {
    const original = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    return fn().finally(() => {
      if (original) Object.defineProperty(process.stdin, "isTTY", original);
      else delete (process.stdin as unknown as { isTTY?: boolean }).isTTY;
    });
  }

  it("deactivate refuses to prompt instead of hanging, and names the flag", async () => {
    const cap = capture();
    try {
      await withoutTTY(async () => {
        await assert.rejects(
          () => handleProjectMembersDeactivate(
            "pm1",
            { project: PROJECT },
            { client: memberClient([IVY]), config: { workspace: "ws" } as never },
          ),
          /stdin is not a terminal.*--yes/s,
        );
      });
    } finally { cap.restore(); }
  });

  it("--yes still runs with no terminal (that is the whole point of the flag)", async () => {
    const cap = capture();
    try {
      await withoutTTY(async () => {
        await handleProjectMembersDeactivate(
          "pm1",
          { project: PROJECT, yes: true },
          { client: memberClient([IVY]), config: { workspace: "ws" } as never },
        );
      });
      assert.match(cap.err.join("\n"), /Deactivated/);
    } finally { cap.restore(); }
  });
});

describe("assignee resolution edge cases", () => {
  it("a 403 resolving names explains the workspace-admin requirement instead of surfacing a raw 403", async () => {
    // /members-lite/ is gated by WorkSpaceAdminPermission in Plane, so a
    // member-role token cannot translate a name to a UUID. Without this, the
    // 403 aborted a create that `--assignees <uuid>` would have completed.
    const cap = capture();
    const client = {
      members: {
        resolveMany: async () => { throw new PlaneApiError(403, "Forbidden"); },
      },
      projectMembers: { listAll: () => iterate([]) },
    } as unknown as PlaneClient;
    try {
      await assert.rejects(
        () => resolveAssignees(client, PROJECT, ["ivy"]),
        /workspace-admin token.*--assignees/s,
      );
    } finally { cap.restore(); }
  });

  it("a non-permission error is not swallowed", async () => {
    const cap = capture();
    const client = {
      members: { resolveMany: async () => { throw new PlaneApiError(500, "Server Error"); } },
      projectMembers: { listAll: () => iterate([]) },
    } as unknown as PlaneClient;
    try {
      await assert.rejects(() => resolveAssignees(client, PROJECT, ["ivy"]), /500/);
    } finally { cap.restore(); }
  });
});
