import type { RequestFn } from "../client.js";
import type { ListOptions, Page, WorkspaceMember } from "../types.js";

/** Shape of the paginated `-lite` member endpoints. */
interface LitePayload<T> {
  results?: T[];
  next_cursor?: string;
  next_page_results?: boolean;
  total_results?: number;
  total_count?: number;
}

/**
 * Normalises a `-lite` member page. `next_cursor` is only propagated when
 * `next_page_results` says there is another page — the same trap the projects
 * endpoint sets, where a cursor comes back on the last page too and paginating
 * on its presence loops forever.
 */
export function toMemberPage<T>(data: LitePayload<T>): Page<T> {
  const items = data?.results ?? (Array.isArray(data) ? (data as unknown as T[]) : []);
  const hasNext = data?.next_page_results ?? false;
  return {
    items,
    nextCursor: hasNext ? data?.next_cursor : undefined,
    total: data?.total_results ?? data?.total_count,
    hasNext,
  };
}

export function toListParams(options?: ListOptions): Record<string, string> {
  const params: Record<string, string> = {};
  if (options?.perPage) params.per_page = String(options.perPage);
  if (options?.cursor) params.cursor = options.cursor;
  return params;
}

/**
 * Picks the member a free-form reference points at, preferring the unique keys.
 *
 * The order is not cosmetic: `id` and `email` are unique in Plane, a display
 * name is not, and this listing also carries deactivated members and bots. A
 * first-match-wins scan across all three could quietly return the deactivated
 * "ivy" of two, and the only symptom would be a work item that Plane saves with
 * `assignees: []`. So an ambiguous display name is an error, not a coin flip —
 * while an exact id or email always wins over any name that happens to collide.
 *
 * @param members - Every member to consider
 * @param ref - UUID, email or display name (case-insensitive)
 * @returns The matching member, or null if none matches
 * @throws Error if the reference matches several members by display name
 */
export function pickMember<T extends WorkspaceMember>(members: T[], ref: string): T | null {
  const wanted = ref.trim().toLowerCase();
  if (wanted === "") return null;

  const byId = members.find((member) => member.id?.toLowerCase() === wanted);
  if (byId !== undefined) return byId;

  const byEmail = members.find((member) => member.email?.toLowerCase() === wanted);
  if (byEmail !== undefined) return byEmail;

  const byName = members.filter((member) => member.display_name?.toLowerCase() === wanted);
  if (byName.length > 1) {
    throw new Error(
      `"${ref}" matches ${byName.length} members (${byName.map((member) => `${member.email} ${member.is_active ? "" : "[inactive] "}${member.id}`).join("; ")}). Pass the email or the UUID.`,
    );
  }
  return byName[0] ?? null;
}

/**
 * Resource for reading the members of a workspace.
 *
 * Read-only by design, not by omission: `/workspaces/{slug}/members/` is
 * registered GET-only in Plane's API v1, so a workspace role cannot be changed
 * (nor a member removed) through the public API. New members arrive through
 * {@link InvitationsResource}.
 *
 * Backed by `/members-lite/` rather than `/members/`: the latter returns a flat
 * array that ignores `per_page` and carries no `is_active`, so a member
 * deactivated in the workspace is indistinguishable from an active one.
 */
export class MembersResource {
  constructor(private readonly request: RequestFn) {}

  /**
   * Lists workspace members, one page at a time.
   * @param options - Pagination options
   * @returns Paginated members, including their workspace `role`
   */
  async list(options?: ListOptions): Promise<Page<WorkspaceMember>> {
    const data = await this.request<LitePayload<WorkspaceMember>>("/members-lite/", {
      params: toListParams(options),
      signal: options?.signal,
    });
    return toMemberPage(data);
  }

  /**
   * Iterates every workspace member across all pages.
   * @param options - List options (cursor managed automatically)
   * @yields WorkspaceMember one at a time
   */
  async *listAll(options?: Omit<ListOptions, "cursor">): AsyncIterable<WorkspaceMember> {
    let cursor: string | undefined;
    do {
      const page = await this.list({ ...options, cursor });
      for (const member of page.items) yield member;
      cursor = page.nextCursor;
    } while (cursor);
  }

  /**
   * Finds a workspace member by UUID, email or display name.
   * @param ref - `"ivy"`, `"ivy@example.com"` or a user UUID
   * @returns The member, or null if nobody in the workspace matches
   */
  async find(ref: string): Promise<WorkspaceMember | null> {
    const members: WorkspaceMember[] = [];
    for await (const member of this.listAll()) members.push(member);
    return pickMember(members, ref);
  }

  /**
   * Resolves a member reference to the **user UUID** that `assignees`,
   * `project_lead` and `default_assignee` expect.
   *
   * This is the piece the API gives you no shortcut for: those fields take
   * UUIDs, and Plane silently drops an assignee it does not accept (a work item
   * PATCHed with a non-member assignee answers 200 with `assignees: []`), so a
   * wrong id looks like success.
   *
   * @param ref - UUID, email or display name
   * @returns The user UUID
   * @throws Error if no workspace member matches
   */
  async resolve(ref: string): Promise<string> {
    const member = await this.find(ref);
    if (member === null) {
      throw new Error(
        `No workspace member matches "${ref}". Check: planec members list`,
      );
    }
    return member.id;
  }

  /**
   * Resolves several references in one pass over the member list, so a command
   * taking `--assignee a --assignee b` costs one listing rather than N.
   * @param refs - UUIDs, emails or display names
   * @returns User UUIDs, in the order given
   * @throws Error listing every reference that matched nobody
   */
  async resolveMany(refs: string[]): Promise<string[]> {
    if (refs.length === 0) return [];
    const members: WorkspaceMember[] = [];
    for await (const member of this.listAll()) members.push(member);

    const resolved: string[] = [];
    const missing: string[] = [];
    for (const ref of refs) {
      const found = pickMember(members, ref);
      if (found === null) missing.push(ref);
      else resolved.push(found.id);
    }
    if (missing.length > 0) {
      throw new Error(
        `No workspace member matches: ${missing.join(", ")}. Check: planec members list`,
      );
    }
    // "ivy" y "ivy@example.com" son la misma persona: sin deduplicar, su UUID
    // viaja dos veces en `assignees`. Se conserva el orden de la primera
    // aparición, que es el que el llamante escribió.
    return [...new Set(resolved)];
  }
}
