import type { RequestFn } from "../client.js";
import { parseRole } from "../roles.js";
import { toMemberPage, toListParams } from "./members.js";
import {
  Role,
  type ListOptions,
  type Page,
  type ProjectMember,
  type ProjectMembership,
  type RoleName,
  type RoleValue,
} from "../types.js";

/**
 * Resource for the membership of a single project.
 *
 * Two API v1 traps shape this class:
 *
 * 1. **The membership id is not discoverable.** `updateRole` and `deactivate`
 *    address the row by its ProjectMember UUID, and no listing exposes it —
 *    both `/members/` and `/project-members-lite/` return the *user* id
 *    (`source="member.id"` in Plane's serializer), and a GET with the user id
 *    answers 404. The only place that id ever appears is the response of
 *    {@link add}, so keep it if you intend to change the role later.
 * 2. **`DELETE` does not remove anybody.** It sets `is_active = false` and
 *    answers 204, while `/members/` keeps listing the member (that endpoint
 *    does not filter on `is_active`) and GET/PATCH on the row keep answering
 *    200. It is also one-way through v1: re-adding the same user answers
 *    `400 {"error":"The payload is not valid"}` (the row still exists) and
 *    `PATCH {"is_active": true}` answers 200 while changing nothing
 *    (`is_active` is not a writable field). Hence the name {@link deactivate}.
 *
 * Verified against Plane 1.4.1 on 2026-08-26.
 */
export class ProjectMembersResource {
  constructor(private readonly request: RequestFn) {}

  /**
   * Lists the members of a project, one page at a time.
   *
   * Uses `/project-members-lite/`: the plain `/members/` endpoint returns a
   * flat array with neither `role` nor `is_active`, which makes it useless for
   * the two questions worth asking about a membership.
   *
   * @param projectId - Project UUID
   * @param options - Pagination options
   * @returns Paginated members with `role` and `is_active`
   */
  async list(projectId: string, options?: ListOptions): Promise<Page<ProjectMember>> {
    const data = await this.request<{ results?: ProjectMember[] }>(
      `/projects/${projectId}/project-members-lite/`,
      { params: toListParams(options), signal: options?.signal },
    );
    return toMemberPage(data);
  }

  /**
   * Iterates every member of a project across all pages.
   * @param projectId - Project UUID
   * @param options - List options (cursor managed automatically)
   * @yields ProjectMember one at a time
   */
  async *listAll(
    projectId: string,
    options?: Omit<ListOptions, "cursor">,
  ): AsyncIterable<ProjectMember> {
    let cursor: string | undefined;
    do {
      const page = await this.list(projectId, { ...options, cursor });
      for (const member of page.items) yield member;
      cursor = page.nextCursor;
    } while (cursor);
  }

  /**
   * Adds a workspace member to a project.
   *
   * `role` is required here even though the API defaults it: a POST without a
   * role silently creates a **guest** (5), which is rarely what the caller
   * meant when adding someone to a project.
   *
   * @param projectId - Project UUID
   * @param userId - User UUID (resolve a name with `client.members.resolve()`)
   * @param role - `"admin" | "member" | "guest"` or the numeric value
   * @returns The membership row, whose `id` is the only handle to it (see the
   *   class docs) — not the user
   */
  async add(
    projectId: string,
    userId: string,
    role: RoleValue | RoleName = Role.Member,
  ): Promise<ProjectMembership> {
    return this.request<ProjectMembership>(`/projects/${projectId}/members/`, {
      method: "POST",
      body: { member: userId, role: parseRole(role) },
    });
  }

  /**
   * Changes the role of an existing membership.
   * @param projectId - Project UUID
   * @param membershipId - ProjectMember UUID, as returned by {@link add} — the
   *   user id does **not** work here (404)
   * @param role - New role
   * @returns The updated membership
   */
  async updateRole(
    projectId: string,
    membershipId: string,
    role: RoleValue | RoleName,
  ): Promise<ProjectMembership> {
    return this.request<ProjectMembership>(
      `/projects/${projectId}/members/${membershipId}/`,
      { method: "PATCH", body: { role: parseRole(role) } },
    );
  }

  /**
   * Deactivates a membership (Plane's `DELETE`, which sets `is_active = false`
   * rather than removing the row).
   *
   * **Not reversible through API v1**: the user cannot be re-added afterwards,
   * and `is_active` is read-only. Reactivating means going through the Plane
   * UI. Callers exposing this to humans should confirm first.
   *
   * @param projectId - Project UUID
   * @param membershipId - ProjectMember UUID, as returned by {@link add}
   */
  async deactivate(projectId: string, membershipId: string): Promise<void> {
    await this.request(`/projects/${projectId}/members/${membershipId}/`, {
      method: "DELETE",
    });
  }
}
