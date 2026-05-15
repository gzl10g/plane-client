import type { RequestFn } from "../client.js";
import type {
  Module,
  CreateModuleInput,
  UpdateModuleInput,
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
  return {
    items,
    nextCursor: data?.next_cursor,
    total: data?.total_results,
    hasNext: data?.next_page_results ?? false,
  };
}

/**
 * Resource for managing modules (planning buckets) in a project.
 * Modules group work items with start/target dates for sprint planning.
 */
export class ModulesResource {
  constructor(private readonly request: RequestFn) {}

  /**
   * Lists all modules in a project.
   * @param projectId - Project UUID
   * @returns Array of modules
   */
  async list(projectId: string): Promise<Module[]> {
    const data = await this.request<{ results?: Module[] }>(
      `/projects/${projectId}/modules/`,
    );
    if (!data) return [];
    return data.results ?? (Array.isArray(data) ? data as unknown as Module[] : []);
  }

  /**
   * Creates a new module in a project.
   * @param projectId - Project UUID
   * @param input - Module data (name is required)
   * @returns The created module
   */
  async create(projectId: string, input: CreateModuleInput): Promise<Module> {
    const body = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
    return this.request(`/projects/${projectId}/modules/`, {
      method: "POST", body: { ...body, project_id: projectId },
    });
  }

  /**
   * Gets a module by ID.
   * @param projectId - Project UUID
   * @param moduleId - Module ID
   * @returns The module
   */
  async get(projectId: string, moduleId: string): Promise<Module> {
    return this.request(`/projects/${projectId}/modules/${moduleId}/`);
  }

  /**
   * Updates an existing module.
   * @param projectId - Project UUID
   * @param moduleId - Module ID
   * @param input - Fields to update
   * @returns The updated module
   */
  async update(projectId: string, moduleId: string, input: UpdateModuleInput): Promise<Module> {
    return this.request(`/projects/${projectId}/modules/${moduleId}/`, {
      method: "PATCH",
      body: Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)),
    });
  }

  /**
   * Lists work items in a module with pagination.
   * @param projectId - Project UUID
   * @param moduleId - Module ID
   * @param options - Pagination options
   * @returns Paginated work items in the module
   */
  async workItems(
    projectId: string,
    moduleId: string,
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
      `/projects/${projectId}/modules/${moduleId}/module-issues/`,
      { params, signal: options?.signal },
    );
    return toPage(data);
  }

  /**
   * Iterates all work items in a module across all pages.
   * @param projectId - Project UUID
   * @param moduleId - Module ID
   * @param options - List options (cursor managed automatically)
   * @yields WorkItem one at a time
   */
  async *workItemsAll(
    projectId: string,
    moduleId: string,
    options?: Omit<ListOptions, "cursor">,
  ): AsyncIterable<WorkItem> {
    let cursor: string | undefined;
    do {
      const page = await this.workItems(projectId, moduleId, { ...options, cursor });
      for (const item of page.items) yield item;
      cursor = page.nextCursor;
    } while (cursor);
  }

  /**
   * Adds work items to a module.
   * @param projectId - Project UUID
   * @param moduleId - Module ID
   * @param workItemIds - Array of work item UUIDs to add
   * @returns API response
   */
  async addWorkItems(projectId: string, moduleId: string, workItemIds: string[]): Promise<unknown> {
    return this.request(`/projects/${projectId}/modules/${moduleId}/module-issues/`, {
      method: "POST",
      body: { issues: workItemIds },
    });
  }

  /**
   * Removes a work item from a module.
   * @param projectId - Project UUID
   * @param moduleId - Module ID
   * @param workItemId - Work item UUID to remove
   * @returns API response
   */
  async removeWorkItem(projectId: string, moduleId: string, workItemId: string): Promise<unknown> {
    return this.request(`/projects/${projectId}/modules/${moduleId}/module-issues/${workItemId}/`, {
      method: "DELETE",
    });
  }
}
