import type { RequestFn } from "../client.js";
import type { Cycle, CreateCycleInput, UpdateCycleInput, WorkItem } from "../types.js";

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

  async workItems(projectId: string, cycleId: string): Promise<WorkItem[]> {
    const data = await this.request<{ results?: WorkItem[] }>(
      `/projects/${projectId}/cycles/${cycleId}/cycle-issues/`,
    );
    if (!data) return [];
    return data.results ?? (Array.isArray(data) ? data as unknown as WorkItem[] : []);
  }

  async addWorkItems(projectId: string, cycleId: string, workItemIds: string[]): Promise<unknown> {
    return this.request(`/projects/${projectId}/cycles/${cycleId}/cycle-issues/`, {
      method: "POST", body: { work_items: workItemIds },
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
