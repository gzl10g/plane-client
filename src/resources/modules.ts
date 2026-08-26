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
   * Deletes a module. Does not delete its work items, only the module and its
   * work-item associations.
   * @param projectId - Project UUID
   * @param moduleId - Module UUID
   * @returns Resolves when the module is deleted
   */
  async delete(projectId: string, moduleId: string): Promise<void> {
    await this.request(`/projects/${projectId}/modules/${moduleId}/`, {
      method: "DELETE",
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

  /**
   * Builds a work-item-ID → modules map by fetching every module in the
   * project and iterating its work items.
   *
   * This is a client-side workaround for a Plane API v1 limitation: the
   * work-item endpoints accept `expand=modules` but silently omit the
   * `modules` key from the response regardless (verified against Plane
   * 1.4.1). There is no reverse lookup ("which modules is issue X in") on
   * the API, so the only way to recover membership is to walk it from the
   * module side.
   *
   * Cost: 1 request to list modules + 1 request per module page (paginated
   * internally). For a project with M modules and up to a few hundred work
   * items each, that is M(+) requests — call once and reuse the map rather
   * than per work item.
   *
   * @param projectId - Project UUID
   * @returns Map of work item UUID to the array of modules it belongs to
   */
  async membershipMap(projectId: string): Promise<Map<string, Module[]>> {
    const modules = await this.list(projectId);
    const map = new Map<string, Module[]>();
    for (const mod of modules) {
      for await (const item of this.workItemsAll(projectId, mod.id)) {
        const existing = map.get(item.id);
        if (existing) existing.push(mod);
        else map.set(item.id, [mod]);
      }
    }
    return map;
  }
}

/**
 * Merges module membership (from {@link ModulesResource.membershipMap}) into
 * a list of work items, adding a `modules` array to each. Pure function:
 * returns new objects, does not mutate `items` or its entries.
 *
 * @param items - Work items (or any objects with an `id`) to enrich
 * @param membership - Map produced by `client.modules.membershipMap(projectId)`
 * @returns New array of items, each with a `modules` field attached
 *
 * @example
 * ```ts
 * const page = await client.workItems.list(projectId)
 * const membership = await client.modules.membershipMap(projectId)
 * const enriched = attachModules(page.items, membership)
 * enriched[0].modules // -> Module[]
 * ```
 */
export function attachModules<T extends { id: string }>(
  items: T[],
  membership: Map<string, Module[]>,
): (T & { modules: Module[] })[] {
  return items.map((item) => ({ ...item, modules: membership.get(item.id) ?? [] }));
}
