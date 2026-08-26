import type { RequestFn } from "../client.js";
import type {
  Cycle,
  CreateCycleInput,
  UpdateCycleInput,
  WorkItem,
  ListOptions,
  Page,
} from "../types.js";

function toPage<T>(data: {
  results?: T[];
  next_cursor?: string;
  next_page_results?: boolean;
  total_results?: number;
}): Page<T> {
  const items = data?.results ?? (Array.isArray(data) ? (data as unknown as T[]) : []);
  const hasNext = data?.next_page_results ?? false;
  return {
    items,
    // `next_cursor` viene SIEMPRE, también en la última página (verificado en
    // vivo contra 1.4.1: 19 de 19 work items con `next_page_results: false` y
    // `next_cursor: "100:1:0"`, y ese cursor devuelve `count: 0` con otro
    // cursor detrás, indefinidamente). Propagarlo sin mirar `next_page_results`
    // deja a `listAll()` en un bucle infinito de páginas vacías hasta el 429.
    nextCursor: hasNext ? data?.next_cursor : undefined,
    total: data?.total_results,
    hasNext,
  };
}

/**
 * Resource for managing cycles (iterative timeboxes/sprints) in a project.
 * Cycles group work items within a time range for sprint planning.
 */
export class CyclesResource {
  constructor(private readonly request: RequestFn) {}

  /**
   * Lists all cycles in a project.
   * @param projectId - Project UUID
   * @returns Array of cycles
   */
  async list(projectId: string): Promise<Cycle[]> {
    const data = await this.request<{ results?: Cycle[] }>(
      `/projects/${projectId}/cycles/`,
    );
    if (!data) return [];
    return data.results ?? (Array.isArray(data) ? data as unknown as Cycle[] : []);
  }

  /**
   * Gets a cycle by ID.
   * @param projectId - Project UUID
   * @param cycleId - Cycle ID
   * @returns The cycle
   */
  async get(projectId: string, cycleId: string): Promise<Cycle> {
    return this.request(`/projects/${projectId}/cycles/${cycleId}/`);
  }

  /**
   * Creates a new cycle in a project.
   * @param projectId - Project UUID
   * @param input - Cycle data (name is required)
   * @returns The created cycle
   */
  async create(projectId: string, input: CreateCycleInput): Promise<Cycle> {
    const body = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
    return this.request(`/projects/${projectId}/cycles/`, {
      method: "POST", body: { ...body, project_id: projectId },
    });
  }

  /**
   * Updates an existing cycle.
   * @param projectId - Project UUID
   * @param cycleId - Cycle ID
   * @param input - Fields to update
   * @returns The updated cycle
   */
  async update(projectId: string, cycleId: string, input: UpdateCycleInput): Promise<Cycle> {
    return this.request(`/projects/${projectId}/cycles/${cycleId}/`, {
      method: "PATCH",
      body: Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)),
    });
  }

  /**
   * Deletes a cycle. Does not delete its work items, only the cycle and its
   * work-item associations.
   * @param projectId - Project UUID
   * @param cycleId - Cycle UUID
   * @returns Resolves when the cycle is deleted
   */
  async delete(projectId: string, cycleId: string): Promise<void> {
    await this.request(`/projects/${projectId}/cycles/${cycleId}/`, {
      method: "DELETE",
    });
  }

  /**
   * Archives a cycle (marks it as completed).
   * @param projectId - Project UUID
   * @param cycleId - Cycle ID
   * @returns API response
   */
  async archive(projectId: string, cycleId: string): Promise<unknown> {
    return this.request(`/projects/${projectId}/cycles/${cycleId}/archive/`, { method: "POST" });
  }

  /**
   * Lists work items in a cycle with pagination.
   * @param projectId - Project UUID
   * @param cycleId - Cycle ID
   * @param options - Pagination options
   * @returns Paginated work items in the cycle
   */
  async workItems(
    projectId: string,
    cycleId: string,
    options?: ListOptions,
  ): Promise<Page<WorkItem>> {
    const params: Record<string, string> = {};
    if (options?.perPage) params.per_page = String(options.perPage);
    if (options?.cursor) params.cursor = options.cursor;
    const data = await this.request<{
      results?: WorkItem[];
      next_cursor?: string;
      next_page_results?: boolean;
      total_results?: number;
    }>(
      `/projects/${projectId}/cycles/${cycleId}/cycle-issues/`,
      { params, signal: options?.signal },
    );
    return toPage(data);
  }

  /**
   * Iterates all work items in a cycle across all pages.
   * @param projectId - Project UUID
   * @param cycleId - Cycle ID
   * @param options - List options (cursor managed automatically)
   * @yields WorkItem one at a time
   */
  async *workItemsAll(
    projectId: string,
    cycleId: string,
    options?: Omit<ListOptions, "cursor">,
  ): AsyncIterable<WorkItem> {
    let cursor: string | undefined;
    do {
      const page = await this.workItems(projectId, cycleId, { ...options, cursor });
      for (const item of page.items) yield item;
      cursor = page.nextCursor;
    } while (cursor);
  }

  /**
   * Adds work items to a cycle.
   * @param projectId - Project UUID
   * @param cycleId - Cycle ID
   * @param workItemIds - Array of work item UUIDs to add
   * @returns API response
   */
  async addWorkItems(projectId: string, cycleId: string, workItemIds: string[]): Promise<unknown> {
    return this.request(`/projects/${projectId}/cycles/${cycleId}/cycle-issues/`, {
      method: "POST", body: { issues: workItemIds },
    });
  }

  /**
   * Removes a work item from a cycle.
   * @param projectId - Project UUID
   * @param cycleId - Cycle ID
   * @param workItemId - Work item UUID to remove
   * @returns API response
   */
  async removeWorkItem(projectId: string, cycleId: string, workItemId: string): Promise<unknown> {
    return this.request(`/projects/${projectId}/cycles/${cycleId}/cycle-issues/${workItemId}/`, {
      method: "DELETE",
    });
  }

  /**
   * Transfers work items from one cycle to another.
   * @param projectId - Project UUID
   * @param fromCycleId - Source cycle ID
   * @param toCycleId - Target cycle ID
   * @returns API response
   */
  async transfer(projectId: string, fromCycleId: string, toCycleId: string): Promise<unknown> {
    return this.request(`/projects/${projectId}/cycles/${fromCycleId}/transfer/`, {
      method: "POST", body: { new_cycle_id: toCycleId },
    });
  }
}
