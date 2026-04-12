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

export class ModulesResource {
  constructor(private readonly request: RequestFn) {}

  async list(projectId: string): Promise<Module[]> {
    const data = await this.request<{ results?: Module[] }>(
      `/projects/${projectId}/modules/`,
    );
    if (!data) return [];
    return data.results ?? (Array.isArray(data) ? data as unknown as Module[] : []);
  }

  async create(projectId: string, input: CreateModuleInput): Promise<Module> {
    const body = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
    return this.request(`/projects/${projectId}/modules/`, {
      method: "POST", body: { ...body, project_id: projectId },
    });
  }

  async get(projectId: string, moduleId: string): Promise<Module> {
    return this.request(`/projects/${projectId}/modules/${moduleId}/`);
  }

  async update(projectId: string, moduleId: string, input: UpdateModuleInput): Promise<Module> {
    return this.request(`/projects/${projectId}/modules/${moduleId}/`, {
      method: "PATCH",
      body: Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)),
    });
  }

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

  async addWorkItems(projectId: string, moduleId: string, workItemIds: string[]): Promise<unknown> {
    return this.request(`/projects/${projectId}/modules/${moduleId}/module-issues/`, {
      method: "POST",
      body: { issues: workItemIds },
    });
  }

  async removeWorkItem(projectId: string, moduleId: string, workItemId: string): Promise<unknown> {
    return this.request(`/projects/${projectId}/modules/${moduleId}/module-issues/${workItemId}/`, {
      method: "DELETE",
    });
  }
}
