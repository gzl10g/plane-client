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
  return {
    items,
    nextCursor: data?.next_cursor,
    total: data?.total_results,
    hasNext: data?.next_page_results ?? false,
  };
}

export class CyclesResource {
  constructor(private readonly request: RequestFn) {}

  async list(projectId: string): Promise<Cycle[]> {
    const data = await this.request<{ results?: Cycle[] }>(
      `/projects/${projectId}/cycles/`,
    );
    if (!data) return [];
    return data.results ?? (Array.isArray(data) ? data as unknown as Cycle[] : []);
  }

  async get(projectId: string, cycleId: string): Promise<Cycle> {
    return this.request(`/projects/${projectId}/cycles/${cycleId}/`);
  }

  async create(projectId: string, input: CreateCycleInput): Promise<Cycle> {
    const body = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
    return this.request(`/projects/${projectId}/cycles/`, {
      method: "POST", body: { ...body, project_id: projectId },
    });
  }

  async update(projectId: string, cycleId: string, input: UpdateCycleInput): Promise<Cycle> {
    return this.request(`/projects/${projectId}/cycles/${cycleId}/`, {
      method: "PATCH",
      body: Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)),
    });
  }

  async archive(projectId: string, cycleId: string): Promise<unknown> {
    return this.request(`/projects/${projectId}/cycles/${cycleId}/archive/`, { method: "POST" });
  }

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

  async addWorkItems(projectId: string, cycleId: string, workItemIds: string[]): Promise<unknown> {
    return this.request(`/projects/${projectId}/cycles/${cycleId}/cycle-issues/`, {
      method: "POST", body: { issues: workItemIds },
    });
  }

  async removeWorkItem(projectId: string, cycleId: string, workItemId: string): Promise<unknown> {
    return this.request(`/projects/${projectId}/cycles/${cycleId}/cycle-issues/${workItemId}/`, {
      method: "DELETE",
    });
  }

  async transfer(projectId: string, fromCycleId: string, toCycleId: string): Promise<unknown> {
    return this.request(`/projects/${projectId}/cycles/${fromCycleId}/transfer/`, {
      method: "POST", body: { new_cycle_id: toCycleId },
    });
  }
}
