import type { RequestFn } from "../client.js";
import type { IntakeIssue, CreateIntakeInput, ListOptions, Page } from "../types.js";

function toPage<T>(data: { results?: T[]; next_cursor?: string; next_page_results?: boolean; total_results?: number }): Page<T> {
  const items = data.results ?? (Array.isArray(data) ? data as unknown as T[] : []);
  return {
    items,
    nextCursor: data.next_cursor,
    total: data.total_results,
    hasNext: data.next_page_results ?? false,
  };
}

/**
 * Resource for the intake queue — issues awaiting triage before entering the backlog.
 */
export class IntakeResource {
  constructor(private readonly request: RequestFn) {}

  /**
   * Lists issues in the intake queue with pagination.
   * @param projectId - Project UUID
   * @param options - Pagination options
   * @returns Paginated intake issues
   */
  async list(projectId: string, options?: ListOptions): Promise<Page<IntakeIssue>> {
    const params: Record<string, string> = {};
    if (options?.cursor) params.cursor = options.cursor as string;
    if (options?.perPage) params.per_page = String(options.perPage);
    const data = await this.request<{ results?: IntakeIssue[]; next_cursor?: string; next_page_results?: boolean; total_results?: number }>(
      `/projects/${projectId}/intake-issues/`, { params, signal: options?.signal },
    );
    return toPage(data);
  }

  /**
   * Creates a new intake issue (pre-triage).
   * @param projectId - Project UUID
   * @param input - Issue name, optional description and priority
   * @returns The created intake issue
   */
  async create(projectId: string, input: CreateIntakeInput): Promise<IntakeIssue> {
    const issue = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
    return this.request(`/projects/${projectId}/intake-issues/`, {
      method: "POST", body: { issue },
    });
  }

  /**
   * Resolves an intake identifier to the underlying work item (issue) id.
   *
   * The intake detail/update endpoint (`.../intake-issues/{id}/`) is keyed by
   * the work item id, not by the intake record id that `list` shows first —
   * passing the record id yields a 404. This looks the identifier up in the
   * queue and returns the matching `issue` id, accepting either the record id
   * or the work item id as input. Falls back to the given id if no match.
   * @param projectId - Project UUID
   * @param id - Intake record id or work item id
   * @returns The work item id to use in the intake detail/update endpoint
   */
  async resolveIssueId(projectId: string, id: string): Promise<string> {
    const page = await this.list(projectId, { perPage: 100 });
    const match = page.items.find(
      (it) => it.id === id || it.issue === id,
    );
    return match?.issue ?? id;
  }

  /**
   * Accepts an intake issue (moves it to the backlog).
   * @param projectId - Project UUID
   * @param id - Intake record id (as shown by `list`) or work item id
   * @returns API response
   */
  async accept(projectId: string, id: string): Promise<unknown> {
    const issueId = await this.resolveIssueId(projectId, id);
    return this.request(`/projects/${projectId}/intake-issues/${issueId}/`, {
      method: "PATCH", body: { status: 1 },
    });
  }

  /**
   * Declines an intake issue (rejects it).
   * @param projectId - Project UUID
   * @param id - Intake record id (as shown by `list`) or work item id
   * @returns API response
   */
  async decline(projectId: string, id: string): Promise<unknown> {
    const issueId = await this.resolveIssueId(projectId, id);
    return this.request(`/projects/${projectId}/intake-issues/${issueId}/`, {
      method: "PATCH", body: { status: -1 },
    });
  }
}
