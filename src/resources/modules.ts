import type { RequestFn } from "../client.js";
import type { Module, CreateModuleInput, UpdateModuleInput, WorkItem } from "../types.js";

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

  async workItems(projectId: string, moduleId: string): Promise<WorkItem[]> {
    const data = await this.request<{ results?: WorkItem[] }>(
      `/projects/${projectId}/modules/${moduleId}/module-issues/`,
    );
    if (!data) return [];
    return data.results ?? (Array.isArray(data) ? data as unknown as WorkItem[] : []);
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
