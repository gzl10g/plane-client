import type { RequestFn } from "../client.js";
import { PlaneApiError } from "../error.js";
import type { CreateStateInput, ListOptions, Page, State, UpdateStateInput } from "../types.js";

function toPage(data: {
  results?: State[];
  next_cursor?: string;
  next_page_results?: boolean;
  total_results?: number;
}): Page<State> {
  const items = data?.results ?? (Array.isArray(data) ? (data as unknown as State[]) : []);
  const hasNext = data?.next_page_results ?? false;
  // `next_cursor` comes back on the last page too, so it is only propagated
  // when `next_page_results` says another page exists — see the note in
  // work-items.ts: following the cursor alone loops for ever.
  return {
    items,
    nextCursor: hasNext ? data?.next_cursor : undefined,
    total: data?.total_results,
    hasNext,
  };
}

/**
 * Resource for listing workflow states in a project.
 * States define the workflow stages (e.g. "todo", "in progress", "done").
 */
export class StatesResource {
  constructor(private readonly request: RequestFn) {}

  /**
   * Lists one page of states.
   * @param projectId - Project UUID
   * @param options - Pagination options
   * @returns Paginated states
   */
  async listPage(projectId: string, options?: ListOptions): Promise<Page<State>> {
    const params: Record<string, string> = {};
    if (options?.cursor) params.cursor = options.cursor;
    if (options?.perPage) params.per_page = String(options.perPage);
    const data = await this.request<{
      results?: State[];
      next_cursor?: string;
      next_page_results?: boolean;
      total_results?: number;
    }>(`/projects/${projectId}/states/`, { params, signal: options?.signal });
    if (!data) return { items: [], hasNext: false };
    return toPage(data);
  }

  /**
   * Iterates every state in the project across all pages.
   * @param projectId - Project UUID
   * @param options - List options (cursor managed automatically)
   * @yields State one at a time
   */
  async *listAll(
    projectId: string,
    options?: Omit<ListOptions, "cursor">,
  ): AsyncIterable<State> {
    let cursor: string | undefined;
    do {
      const page = await this.listPage(projectId, { ...options, cursor });
      for (const state of page.items) yield state;
      cursor = page.nextCursor;
    } while (cursor);
  }

  /**
   * Lists all states in a project, walking every page.
   *
   * This used to return the first page and drop `next_cursor` on the floor, so
   * a project with more states than the page size answered a short list with no
   * hint that it was short — and the caller resolving a state UUID by name got
   * "not found" for a state that exists.
   *
   * @param projectId - Project UUID
   * @returns Array of every state in the project
   */
  async list(projectId: string): Promise<State[]> {
    const states: State[] = [];
    for await (const state of this.listAll(projectId)) states.push(state);
    return states;
  }

  /**
   * Gets a state by id. Returns `null` if it does not exist.
   * @param projectId - Project UUID
   * @param stateId - State UUID
   */
  async get(projectId: string, stateId: string): Promise<State | null> {
    try {
      return await this.request<State>(`/projects/${projectId}/states/${stateId}/`);
    } catch (err) {
      if (err instanceof PlaneApiError && err.isNotFound) return null;
      throw err;
    }
  }

  /**
   * Creates a state.
   *
   * `color` is not optional despite reading like decoration: the API answers
   * `400 {"color":["This field is required."]}` without it (verified against
   * 1.4.2). `group` is validated server-side too — an unknown one comes back
   * `"x" is not a valid choice`.
   *
   * @param projectId - Project UUID
   * @param input - Name and colour, plus an optional workflow group
   */
  async create(projectId: string, input: CreateStateInput): Promise<State> {
    return this.request(`/projects/${projectId}/states/`, {
      method: "POST",
      body: input as unknown as Record<string, unknown>,
    });
  }

  /**
   * Updates a state.
   * @param projectId - Project UUID
   * @param stateId - State UUID
   * @param input - Fields to change
   */
  async update(projectId: string, stateId: string, input: UpdateStateInput): Promise<State> {
    return this.request(`/projects/${projectId}/states/${stateId}/`, {
      method: "PATCH",
      body: input as unknown as Record<string, unknown>,
    });
  }

  /**
   * Deletes a state.
   * @param projectId - Project UUID
   * @param stateId - State UUID
   */
  async delete(projectId: string, stateId: string): Promise<void> {
    await this.request(`/projects/${projectId}/states/${stateId}/`, { method: "DELETE" });
  }
}
