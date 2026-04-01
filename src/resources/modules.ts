import type { RequestFn } from "../client.js";
import type { Module, UpdateModuleInput, WorkItem } from "../types.js";

export class ModulesResource {
  constructor(private readonly request: RequestFn) {}

  async list(projectId: string): Promise<Module[]> {
    return this.request(`/projects/${projectId}/modules/`);
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
    return this.request(`/projects/${projectId}/modules/${moduleId}/work-items/`);
  }

  async addWorkItems(projectId: string, moduleId: string, workItemIds: string[]): Promise<unknown> {
    return this.request(`/projects/${projectId}/modules/${moduleId}/work-items/`, {
      method: "POST",
      body: { work_items: workItemIds },
    });
  }
}
