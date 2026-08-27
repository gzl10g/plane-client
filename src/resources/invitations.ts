import type { RequestFn } from "../client.js";
import { PlaneApiError } from "../error.js";
import { parseRole } from "../roles.js";
import {
  Role,
  type CreateInvitationInput,
  type RoleName,
  type RoleValue,
  type WorkspaceInvitation,
} from "../types.js";

/**
 * Resource for workspace invitations — the only way API v1 offers to bring a
 * new person into a workspace (`/members/` is GET-only).
 *
 * Two things to know before wiring this into anything user-facing (both
 * verified against Plane 1.4.1 on 2026-08-26):
 *
 * - **It does not send an email.** Plane's v1 `create` only writes the
 *   invitation row; the UI is what queues the notification. Whether the
 *   invitee ever sees the pending invitation was not verified.
 * - **It does not check membership.** Inviting somebody who is already a member
 *   of the workspace answers 201. The only uniqueness check is on the
 *   invitation itself (`EMAIL_ALREADY_INVITED`).
 */
export class InvitationsResource {
  constructor(private readonly request: RequestFn) {}

  /**
   * Lists the workspace invitations. Flat array, not paginated.
   * @returns Every invitation, pending or accepted
   */
  async list(): Promise<WorkspaceInvitation[]> {
    const data = await this.request<WorkspaceInvitation[] | { results?: WorkspaceInvitation[] }>(
      "/invitations/",
    );
    if (!data) return [];
    if (Array.isArray(data)) return data;
    return data.results ?? [];
  }

  /**
   * Gets an invitation by UUID. Returns `null` if not found (404).
   * @param invitationId - Invitation UUID
   * @returns The invitation, or null
   */
  async get(invitationId: string): Promise<WorkspaceInvitation | null> {
    try {
      return await this.request<WorkspaceInvitation>(`/invitations/${invitationId}/`);
    } catch (err) {
      if (err instanceof PlaneApiError && err.isNotFound) return null;
      throw err;
    }
  }

  /**
   * Invites an email address to the workspace.
   * @param input - Email and role (role defaults to member)
   * @returns The created invitation
   */
  async create(input: CreateInvitationInput): Promise<WorkspaceInvitation> {
    return this.request<WorkspaceInvitation>("/invitations/", {
      method: "POST",
      body: { email: input.email, role: parseRole(input.role ?? Role.Member) },
    });
  }

  /**
   * Changes the role offered by a pending invitation. The email cannot be
   * updated once the invitation exists (the API answers 400
   * `EMAIL_CANNOT_BE_UPDATED`).
   * @param invitationId - Invitation UUID
   * @param role - New role
   * @returns The updated invitation
   */
  async updateRole(
    invitationId: string,
    role: RoleValue | RoleName,
  ): Promise<WorkspaceInvitation> {
    return this.request<WorkspaceInvitation>(`/invitations/${invitationId}/`, {
      method: "PATCH",
      body: { role: parseRole(role) },
    });
  }

  /**
   * Revokes a pending invitation. The API refuses (400) once it has been
   * accepted or otherwise responded to.
   * @param invitationId - Invitation UUID
   */
  async delete(invitationId: string): Promise<void> {
    await this.request(`/invitations/${invitationId}/`, { method: "DELETE" });
  }
}
