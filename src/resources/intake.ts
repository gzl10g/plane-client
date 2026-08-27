import type { RequestFn } from "../client.js";
import type { IntakeIssue, CreateIntakeInput, ListOptions, Page } from "../types.js";

function toPage<T>(data: { results?: T[]; next_cursor?: string; next_page_results?: boolean; total_results?: number }): Page<T> {
  const items = data.results ?? (Array.isArray(data) ? data as unknown as T[] : []);
  const hasNext = data.next_page_results ?? false;
  return {
    items,
    // `next_cursor` comes back on the last page too, and following it yields
    // empty pages for ever — the stop condition is `next_page_results`. Fixed
    // in work-items, cycles, modules and projects in 0.18.0; this listing was
    // the one left carrying the same latent loop.
    nextCursor: hasNext ? data.next_cursor : undefined,
    total: data.total_results,
    hasNext,
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
   * Iterates every issue in the intake queue across all pages.
   * @param projectId - Project UUID
   * @param options - List options (cursor managed automatically)
   * @yields Intake issue one at a time
   */
  async *listAll(
    projectId: string,
    options?: Omit<ListOptions, "cursor">,
  ): AsyncIterable<IntakeIssue> {
    let cursor: string | undefined;
    do {
      const page = await this.list(projectId, { ...options, cursor });
      for (const issue of page.items) yield issue;
      cursor = page.nextCursor;
    } while (cursor);
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
    // Walks the whole queue, deliberately. It used to ask for `per_page: 100`
    // and look at that page alone — and passing `per_page` is precisely what
    // switches pagination on, so on a queue of 139 items the last 39 were
    // invisible and this returned the record id unchanged. The PATCH then went
    // to `.../intake-issues/{record_id}/`, which answers 404. Without
    // `per_page` the endpoint returns everything in one response, so walking it
    // costs the same single request in the common case.
    for await (const item of this.listAll(projectId)) {
      if (item.id === id || item.issue === id) return item.issue ?? id;
    }
    return id;
  }

  /**
   * Accepts an intake issue (moves it to the backlog).
   * @param projectId - Project UUID
   * @param id - Intake record id (as shown by `list`) or work item id
   * @returns API response
   */
  async accept(projectId: string, id: string): Promise<IntakeIssue> {
    return this.setStatus(projectId, id, 1, "accept");
  }

  /**
   * Declines an intake issue (rejects it).
   * @param projectId - Project UUID
   * @param id - Intake record id (as shown by `list`) or work item id
   * @returns API response
   */
  async decline(projectId: string, id: string): Promise<IntakeIssue> {
    return this.setStatus(projectId, id, -1, "decline");
  }

  /**
   * Sets an intake issue's triage status and **verifies that it stuck**.
   *
   * Plane answers this PATCH with `200` and the updated intake object, so the
   * response already says whether the change took. Comparing the two costs
   * nothing and turns a silent no-op into an error — this client's whole
   * premise is that a v1 API which answers 200 and discards the write is a real
   * possibility, and the caller should not have to re-read to find out.
   *
   * (An earlier version of this comment claimed Plane always dropped this
   * write. It does not: with the issue id and a credential that can write, the
   * status moves. The observation behind that claim had mixed up two API keys.)
   *
   * @param projectId - Project UUID
   * @param id - Intake record id or work item id
   * @param status - Target status (`1` accepted, `-1` declined)
   * @param verb - Used in the error message
   * @returns The updated intake issue
   * @throws Error if the API accepted the request without applying it
   */
  private async setStatus(
    projectId: string,
    id: string,
    status: number,
    verb: string,
  ): Promise<IntakeIssue> {
    const issueId = await this.resolveIssueId(projectId, id);
    const updated = await this.request<IntakeIssue>(
      `/projects/${projectId}/intake-issues/${issueId}/`,
      { method: "PATCH", body: { status } },
    );

    // La ausencia del campo no es prueba de éxito. Saltarse la comprobación
    // cuando `status` no viene —o viene como string— dejaba a esta función,
    // que existe precisamente para cazar el "200 y descarto", diciendo que sí
    // sin haber comprobado nada.
    const returned = Number(updated?.status);
    if (updated === undefined || updated === null || Number.isNaN(returned)) {
      throw new Error(
        `Plane answered the ${verb} request with 200 but did not report the resulting status, so the change cannot be confirmed. Re-read the queue with: planec intake list`,
      );
    }
    if (returned !== status) {
      throw new Error(
        `Plane accepted the ${verb} request with 200 but did not apply it: the intake issue is still ` +
          `status ${returned}, not ${status}. Triage it in the Plane UI.`,
      );
    }
    return updated;
  }
}
