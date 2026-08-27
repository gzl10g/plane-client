import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { PlaneClient } from "../src/client.js";
import { Role } from "../src/types.js";
import { parseRole, roleName } from "../src/roles.js";

function mockFetch(responses: Array<{ status: number; body: unknown }>) {
  const original = globalThis.fetch;
  const calls: { url: string; init: RequestInit }[] = [];
  let i = 0;
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init: init ?? {} });
    const r = responses[Math.min(i++, responses.length - 1)];
    return new Response(r.status === 204 ? null : JSON.stringify(r.body), { status: r.status, statusText: "OK" });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

function member(overrides: Record<string, unknown> = {}) {
  return {
    id: "u1",
    email: "ivy@example.com",
    display_name: "ivy",
    role: Role.Member,
    is_active: true,
    is_bot: false,
    ...overrides,
  };
}

describe("roles", () => {
  it("accepts names and numeric values", () => {
    assert.equal(parseRole("admin"), 20);
    assert.equal(parseRole("Member"), 15);
    assert.equal(parseRole("guest"), 5);
    assert.equal(parseRole(15), 15);
    assert.equal(parseRole("20"), 20);
  });

  it("rejects a role the API would reject with an opaque 400", () => {
    assert.throws(() => parseRole("owner"), /Invalid role/);
    assert.throws(() => parseRole(99), /Invalid role/);
    assert.throws(() => parseRole("10"), /Invalid role/);
  });

  it("rejects inherited object keys instead of dropping the role", () => {
    // `parseRole("constructor")` used to return a function through the
    // prototype, the role left as undefined, and Plane then created a GUEST.
    for (const ref of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      assert.throws(() => parseRole(ref), /Invalid role/);
    }
  });

  it("renders numeric roles as names", () => {
    assert.equal(roleName(20), "admin");
    assert.equal(roleName(15), "member");
    assert.equal(roleName(5), "guest");
    assert.equal(roleName(7), "7");
  });
});

describe("MembersResource", () => {
  let client: PlaneClient;
  beforeEach(() => {
    client = new PlaneClient({ baseUrl: "https://plane.test", apiKey: "pk", workspace: "ws", retry: { maxRetries: 0 } });
  });

  it("lists from /members-lite/, not the flat /members/ that hides is_active", async () => {
    const mock = mockFetch([{ status: 200, body: { results: [member()], next_page_results: false } }]);
    try {
      const page = await client.members.list();
      assert.equal(mock.calls[0].url, "https://plane.test/api/v1/workspaces/ws/members-lite/");
      assert.equal(page.items[0].display_name, "ivy");
      assert.equal(page.items[0].role, Role.Member);
      assert.equal(page.hasNext, false);
    } finally { mock.restore(); }
  });

  it("does not propagate next_cursor on the last page", async () => {
    const mock = mockFetch([{
      status: 200,
      body: { results: [member()], next_cursor: "100:1:0", next_page_results: false, total_results: 1 },
    }]);
    try {
      const page = await client.members.list();
      // Same trap as /projects/: a cursor comes back on the last page too, and
      // paginating on its presence loops forever.
      assert.equal(page.nextCursor, undefined);
      assert.equal(page.total, 1);
    } finally { mock.restore(); }
  });

  it("listAll walks pages until next_page_results is false", async () => {
    const mock = mockFetch([
      { status: 200, body: { results: [member({ id: "u1" })], next_cursor: "1:1:0", next_page_results: true } },
      { status: 200, body: { results: [member({ id: "u2" })], next_page_results: false } },
    ]);
    try {
      const ids: string[] = [];
      for await (const m of client.members.listAll()) ids.push(m.id);
      assert.deepEqual(ids, ["u1", "u2"]);
      assert.match(mock.calls[1].url, /cursor=1%3A1%3A0/);
    } finally { mock.restore(); }
  });

  it("resolve matches by display name, email and UUID", async () => {
    const body = { results: [member({ id: "u1", display_name: "ivy", email: "ivy@example.com" })], next_page_results: false };
    for (const ref of ["ivy", "IVY@example.com", "u1"]) {
      const mock = mockFetch([{ status: 200, body }]);
      try {
        assert.equal(await client.members.resolve(ref), "u1");
      } finally { mock.restore(); }
    }
  });

  it("prefers an exact id or email over a colliding display name", async () => {
    const members = [
      member({ id: "u1", display_name: "ivy", email: "ivy@example.com" }),
      // Second account whose display name collides with the first one's email.
      member({ id: "u2", display_name: "ivy@example.com", email: "other@example.com" }),
    ];
    const mock = mockFetch([{ status: 200, body: { results: members, next_page_results: false } }]);
    try {
      assert.equal(await client.members.resolve("ivy@example.com"), "u1");
    } finally { mock.restore(); }
  });

  it("refuses an ambiguous display name rather than picking one", async () => {
    const members = [
      member({ id: "u1", display_name: "ivy", email: "ivy@example.com", is_active: false }),
      member({ id: "u2", display_name: "ivy", email: "ivy2@example.com" }),
    ];
    const mock = mockFetch([{ status: 200, body: { results: members, next_page_results: false } }]);
    try {
      await assert.rejects(() => client.members.resolve("ivy"), /matches 2 members/);
    } finally { mock.restore(); }
  });

  it("resolve fails loudly instead of returning a wrong id", async () => {
    const mock = mockFetch([{ status: 200, body: { results: [member()], next_page_results: false } }]);
    try {
      await assert.rejects(() => client.members.resolve("nobody"), /No workspace member matches/);
    } finally { mock.restore(); }
  });

  it("resolveMany reports every missing reference and lists members once", async () => {
    const mock = mockFetch([{
      status: 200,
      body: { results: [member({ id: "u1", display_name: "ivy" }), member({ id: "u2", display_name: "codex" })], next_page_results: false },
    }]);
    try {
      assert.deepEqual(await client.members.resolveMany(["codex", "ivy"]), ["u2", "u1"]);
      assert.equal(mock.calls.length, 1);
    } finally { mock.restore(); }

    const mock2 = mockFetch([{ status: 200, body: { results: [member()], next_page_results: false } }]);
    try {
      await assert.rejects(
        () => client.members.resolveMany(["ghost", "phantom"]),
        /ghost, phantom/,
      );
    } finally { mock2.restore(); }
  });

  it("resolveMany deduplicates the same person referred to two ways", async () => {
    const mock = mockFetch([{
      status: 200,
      body: { results: [member({ id: "u1", display_name: "ivy", email: "ivy@example.com" })], next_page_results: false },
    }]);
    try {
      // Same person via name and via email: their id must travel once.
      assert.deepEqual(await client.members.resolveMany(["ivy", "ivy@example.com"]), ["u1"]);
    } finally { mock.restore(); }
  });

  it("resolveMany with no refs costs no request", async () => {
    const mock = mockFetch([{ status: 200, body: { results: [] } }]);
    try {
      assert.deepEqual(await client.members.resolveMany([]), []);
      assert.equal(mock.calls.length, 0);
    } finally { mock.restore(); }
  });
});

describe("ProjectMembersResource", () => {
  let client: PlaneClient;
  beforeEach(() => {
    client = new PlaneClient({ baseUrl: "https://plane.test", apiKey: "pk", workspace: "ws", retry: { maxRetries: 0 } });
  });

  it("lists from /project-members-lite/, the only listing carrying role and is_active", async () => {
    const mock = mockFetch([{ status: 200, body: { results: [member({ is_active: false })], next_page_results: false } }]);
    try {
      const page = await client.projectMembers.list("p1");
      assert.equal(mock.calls[0].url, "https://plane.test/api/v1/workspaces/ws/projects/p1/project-members-lite/");
      assert.equal(page.items[0].is_active, false);
    } finally { mock.restore(); }
  });

  it("add posts {member, role} — not the {members:[...]} shape, which answers 400", async () => {
    const mock = mockFetch([{ status: 201, body: { id: "pm1", member: "u1", role: 15 } }]);
    try {
      const membership = await client.projectMembers.add("p1", "u1", "member");
      assert.equal(mock.calls[0].url, "https://plane.test/api/v1/workspaces/ws/projects/p1/members/");
      assert.equal(mock.calls[0].init.method, "POST");
      assert.deepEqual(JSON.parse(mock.calls[0].init.body as string), { member: "u1", role: 15 });
      // The returned id is the membership id, the only handle to the row.
      assert.equal(membership.id, "pm1");
    } finally { mock.restore(); }
  });

  it("add defaults to member, not to the guest the API defaults to", async () => {
    const mock = mockFetch([{ status: 201, body: { id: "pm1", member: "u1", role: 15 } }]);
    try {
      await client.projectMembers.add("p1", "u1");
      assert.deepEqual(JSON.parse(mock.calls[0].init.body as string), { member: "u1", role: Role.Member });
    } finally { mock.restore(); }
  });

  it("updateRole patches the membership id, not the user id", async () => {
    const mock = mockFetch([{ status: 200, body: { id: "pm1", member: "u1", role: 20 } }]);
    try {
      await client.projectMembers.updateRole("p1", "pm1", "admin");
      assert.equal(mock.calls[0].url, "https://plane.test/api/v1/workspaces/ws/projects/p1/members/pm1/");
      assert.equal(mock.calls[0].init.method, "PATCH");
      assert.deepEqual(JSON.parse(mock.calls[0].init.body as string), { role: 20 });
    } finally { mock.restore(); }
  });

  it("deactivate DELETEs the membership and swallows the empty 204", async () => {
    const mock = mockFetch([{ status: 204, body: null }]);
    try {
      await client.projectMembers.deactivate("p1", "pm1");
      assert.equal(mock.calls[0].init.method, "DELETE");
      assert.equal(mock.calls[0].url, "https://plane.test/api/v1/workspaces/ws/projects/p1/members/pm1/");
    } finally { mock.restore(); }
  });
});

describe("InvitationsResource", () => {
  let client: PlaneClient;
  beforeEach(() => {
    client = new PlaneClient({ baseUrl: "https://plane.test", apiKey: "pk", workspace: "ws", retry: { maxRetries: 0 } });
  });

  it("list accepts the flat array the endpoint actually returns", async () => {
    const mock = mockFetch([{ status: 200, body: [{ id: "i1", email: "new@example.com", role: 15, accepted: false }] }]);
    try {
      const invitations = await client.invitations.list();
      assert.equal(mock.calls[0].url, "https://plane.test/api/v1/workspaces/ws/invitations/");
      assert.equal(invitations.length, 1);
      assert.equal(invitations[0].email, "new@example.com");
    } finally { mock.restore(); }
  });

  it("get returns null on 404", async () => {
    const mock = mockFetch([{ status: 404, body: { error: "not found" } }]);
    try {
      assert.equal(await client.invitations.get("i1"), null);
    } finally { mock.restore(); }
  });

  it("create sends email and the resolved role", async () => {
    const mock = mockFetch([{ status: 201, body: { id: "i1", email: "new@example.com", role: 20, accepted: false } }]);
    try {
      await client.invitations.create({ email: "new@example.com", role: "admin" });
      assert.equal(mock.calls[0].init.method, "POST");
      assert.deepEqual(JSON.parse(mock.calls[0].init.body as string), { email: "new@example.com", role: 20 });
    } finally { mock.restore(); }
  });

  it("create defaults the role to member", async () => {
    const mock = mockFetch([{ status: 201, body: { id: "i1", email: "new@example.com", role: 15, accepted: false } }]);
    try {
      await client.invitations.create({ email: "new@example.com" });
      assert.deepEqual(JSON.parse(mock.calls[0].init.body as string), { email: "new@example.com", role: Role.Member });
    } finally { mock.restore(); }
  });

  it("delete revokes by id", async () => {
    const mock = mockFetch([{ status: 204, body: null }]);
    try {
      await client.invitations.delete("i1");
      assert.equal(mock.calls[0].init.method, "DELETE");
      assert.equal(mock.calls[0].url, "https://plane.test/api/v1/workspaces/ws/invitations/i1/");
    } finally { mock.restore(); }
  });
});
