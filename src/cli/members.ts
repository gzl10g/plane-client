import { loadConfig, type Config } from "./config.js";
import { parseRole, roleName } from "../roles.js";
import {
  buildClient,
  confirmAction,
  formatOutput,
  parseRefList,
  resolveProjectFromOpts as resolveProject,
  resolveWorkspaceForDisplay,
  warnIfEmpty,
  type HandlerDeps,
  type TableColumn,
} from "./shared.js";
import type { PlaneClient } from "../client.js";
import { PlaneApiError } from "../error.js";
import type { ProjectMember, WorkspaceMember } from "../types.js";

function resolveClient(deps?: HandlerDeps): PlaneClient {
  if (deps?.client) return deps.client;
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  return buildClient(config);
}

const MEMBER_COLUMNS: TableColumn[] = [
  { key: "display_name", label: "Name", width: 20 },
  { key: "email", label: "Email", width: 30 },
  { key: "role_name", label: "Role", width: 8 },
  { key: "active", label: "Active", width: 6 },
  { key: "id", label: "User ID", width: 36 },
];

/**
 * Adds the two derived columns the table shows. Printing the raw numeric role
 * would make the reader look up what 15 means, and `is_active` as `true/false`
 * hides the one case that matters (a deactivated membership that Plane still
 * lists as if nothing happened).
 */
function toRows(members: (WorkspaceMember | ProjectMember)[]): Record<string, unknown>[] {
  return members.map((member) => ({
    ...member,
    role_name: roleName(member.role),
    active: member.is_active ? "yes" : "NO",
  }));
}

export interface MembersListOpts {
  json?: boolean;
}

export async function handleMembersList(
  opts: MembersListOpts,
  deps?: HandlerDeps,
): Promise<void> {
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const client = resolveClient(deps);

  const members: WorkspaceMember[] = [];
  for await (const member of client.members.listAll()) members.push(member);

  formatOutput(opts.json ? members : toRows(members), { json: opts.json }, MEMBER_COLUMNS);
  warnIfEmpty(members.length, { workspace: resolveWorkspaceForDisplay(config) });
}

export interface ProjectMembersListOpts {
  project?: string;
  json?: boolean;
}

export async function handleProjectMembersList(
  opts: ProjectMembersListOpts,
  deps?: HandlerDeps,
): Promise<void> {
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const client = resolveClient(deps);
  const projectId = await resolveProject(opts, config, client);

  const members: ProjectMember[] = [];
  for await (const member of client.projectMembers.listAll(projectId)) members.push(member);

  formatOutput(opts.json ? members : toRows(members), { json: opts.json }, MEMBER_COLUMNS);
  warnIfEmpty(members.length, {
    workspace: resolveWorkspaceForDisplay(config),
    project: projectId,
  });
}

export interface ProjectMembersAddOpts {
  project?: string;
  member: string;
  role?: string;
  json?: boolean;
}

export async function handleProjectMembersAdd(
  opts: ProjectMembersAddOpts,
  deps?: HandlerDeps,
): Promise<void> {
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const client = resolveClient(deps);
  const projectId = await resolveProject(opts, config, client);

  const refs = parseRefList(opts.member);
  const userIds = await client.members.resolveMany(refs);

  const role = parseRole(opts.role ?? "member");

  // Printed one by one, as each row is created, rather than collected and
  // printed at the end: the membership id is the ONLY handle to the row (no
  // listing in API v1 returns it), so losing it to an exception raised by a
  // later member would leave that membership permanently unmanageable.
  const memberships = [];
  try {
    for (const userId of userIds) {
      const membership = await client.projectMembers.add(projectId, userId, role);
      memberships.push(membership);
      if (!opts.json) formatOutput(membership, { json: false });
    }
  } finally {
    if (opts.json && memberships.length > 0) {
      formatOutput(memberships.length === 1 ? memberships[0] : memberships, { json: true });
    }
    if (memberships.length > 0) {
      console.error(
        "Note: keep the `id` printed above — it is the membership id required by `set-role` and `deactivate`, and no listing returns it.",
      );
    }
  }
}

export interface ProjectMembersSetRoleOpts {
  project?: string;
  role: string;
  json?: boolean;
}

export async function handleProjectMembersSetRole(
  membershipId: string,
  opts: ProjectMembersSetRoleOpts,
  deps?: HandlerDeps,
): Promise<void> {
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const client = resolveClient(deps);
  const projectId = await resolveProject(opts, config, client);

  const membership = await client.projectMembers.updateRole(projectId, membershipId, parseRole(opts.role));
  formatOutput(membership, { json: opts.json });
}

export interface ProjectMembersDeactivateOpts {
  project?: string;
  yes?: boolean;
  json?: boolean;
}

export async function handleProjectMembersDeactivate(
  membershipId: string,
  opts: ProjectMembersDeactivateOpts,
  deps?: HandlerDeps,
): Promise<void> {
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const client = resolveClient(deps);
  const projectId = await resolveProject(opts, config, client);

  // One-way through the API: the row keeps existing with `is_active: false`,
  // the user cannot be re-added, and `is_active` is read-only. Only the Plane
  // UI can undo it, so this asks before doing it.
  if (!opts.yes) {
    console.error(
      "This deactivates the membership. It CANNOT be undone through the API: the user cannot be re-added and only the Plane UI can reactivate them.",
    );
    const ok = await confirmAction(`Deactivate membership ${membershipId} in project ${projectId}?`);
    if (!ok) {
      console.error("Aborted.");
      return;
    }
  }

  await client.projectMembers.deactivate(projectId, membershipId);
  console.error(
    "Deactivated. Note `planec projects members list` still shows the user, now with Active=NO.",
  );
}

const INVITATION_COLUMNS: TableColumn[] = [
  { key: "email", label: "Email", width: 30 },
  { key: "role_name", label: "Role", width: 8 },
  { key: "accepted", label: "Accepted", width: 8 },
  { key: "id", label: "ID", width: 36 },
];

export async function handleInvitationsList(
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const client = resolveClient(deps);

  const invitations = await client.invitations.list();
  const rows = invitations.map((invitation) => ({
    ...invitation,
    role_name: roleName(invitation.role),
  }));

  formatOutput(opts.json ? invitations : rows, { json: opts.json }, INVITATION_COLUMNS);
  warnIfEmpty(invitations.length, { workspace: resolveWorkspaceForDisplay(config) });
}

export async function handleInvitationsCreate(
  email: string,
  opts: { role?: string; json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const invitation = await client.invitations.create({
    email,
    role: parseRole(opts.role ?? "member"),
  });

  // Both are surprises worth stating: the v1 endpoint writes the row without
  // queueing the email the UI sends, and it happily invites somebody who is
  // already a member.
  console.error(
    "Note: API v1 does not send an invitation email (the Plane UI does), and it does not check whether the address is already a member.",
  );

  formatOutput(invitation, { json: opts.json });
}

export async function handleInvitationsSetRole(
  invitationId: string,
  opts: { role: string; json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const invitation = await client.invitations.updateRole(invitationId, parseRole(opts.role));
  formatOutput(invitation, { json: opts.json });
}

export async function handleInvitationsDelete(
  invitationId: string,
  opts: { yes?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);

  if (!opts.yes) {
    const ok = await confirmAction(`Revoke invitation ${invitationId}?`);
    if (!ok) {
      console.error("Aborted.");
      return;
    }
  }

  await client.invitations.delete(invitationId);
  console.error(`Invitation ${invitationId} revoked.`);
}

/**
 * Resolves assignee references (display name, email or UUID) to user UUIDs and
 * warns about the ones Plane will silently drop.
 *
 * Plane accepts a PATCH with an assignee who is not a member of the project and
 * answers **200 with `assignees: []`** — the write looks like it worked and
 * nothing was assigned (verified against 1.4.1). A deactivated membership has
 * the same effect. Warning on stderr keeps stdout/JSON clean while making the
 * silent drop visible.
 *
 * @param client - Client to resolve with
 * @param projectId - Project the work item belongs to
 * @param refs - Assignee references
 * @returns User UUIDs
 * @throws Error if any reference matches no workspace member
 */
export async function resolveAssignees(
  client: PlaneClient,
  projectId: string,
  refs: string[],
): Promise<string[]> {
  // `/members-lite/` está gateado por WorkSpaceAdminPermission en Plane, así que
  // un token que no sea admin DEL WORKSPACE recibe 403 al traducir un nombre a
  // UUID — y sin este catch el 403 tumba un `work-items create` que, con
  // `--assignees <uuid>`, habría funcionado. El hint genérico de 403 del CLI
  // ("lacks permission to modify this resource") es doblemente engañoso aquí:
  // esto es una lectura, y lo que falta es rol en el workspace, no en el WI.
  let userIds: string[];
  try {
    userIds = await client.members.resolveMany(refs);
  } catch (err: unknown) {
    if (err instanceof PlaneApiError && err.isPermission) {
      throw new Error(
        "Cannot resolve assignees by name: listing workspace members requires a workspace-admin token. " +
          "Use --assignees <uuid> (raw UUIDs) or a token with admin role in the workspace.",
        { cause: err },
      );
    }
    throw err;
  }
  if (userIds.length === 0) return userIds;

  // This check is advisory, so it must never be what fails the command: a 429
  // (this is the third request of the invocation, and Plane throttles hard) or a
  // token that cannot read the project membership would otherwise abort a write
  // that Plane would have accepted. Same rule the comments check follows: warn
  // and carry on, never hide or block data.
  const active = new Set<string>();
  try {
    for await (const member of client.projectMembers.listAll(projectId)) {
      if (member.is_active) active.add(member.id);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `Warning: could not verify project membership (${message}). Assignees Plane does not accept are dropped silently — check with: planec projects members list -p ${projectId}`,
    );
    return userIds;
  }

  // Report the reference the caller typed, with the id in brackets: "opencode
  // is not a member" is actionable, a bare UUID sends them back to the listing.
  const dropped = userIds
    .map((id, i) => ({ id, ref: refs[i] }))
    .filter(({ id }) => !active.has(id))
    .map(({ id, ref }) => `${ref} (${id})`);
  if (dropped.length > 0) {
    console.error(
      `Warning: ${dropped.join(", ")} ${dropped.length === 1 ? "is not an active member" : "are not active members"} of project ${projectId}. ` +
        "Plane will accept the request and drop the assignee silently. Add them first: planec projects members add",
    );
  }
  return userIds;
}
