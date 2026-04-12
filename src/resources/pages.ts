import type { RequestFn } from "../client.js";
import type { PlanePageItem, CreatePageInput, UpdatePageInput } from "../types.js";
import { PlaneApiError } from "../error.js";

export class PagesResource {
  constructor(private readonly request: RequestFn) {}

  async list(projectId: string): Promise<PlanePageItem[]> {
    const data = await this.request<{ results?: PlanePageItem[] }>(
      `/projects/${projectId}/pages/`,
    );
    if (!data) return [];
    return data.results ?? (Array.isArray(data) ? data as unknown as PlanePageItem[] : []);
  }

  async get(projectId: string, pageId: string): Promise<PlanePageItem | null> {
    try {
      return await this.request<PlanePageItem>(
        `/projects/${projectId}/pages/${pageId}/`,
      );
    } catch (err) {
      if (err instanceof PlaneApiError && err.isNotFound) return null;
      throw err;
    }
  }

  async create(projectId: string, input: CreatePageInput): Promise<PlanePageItem> {
    return this.request(`/projects/${projectId}/pages/`, {
      method: "POST",
      body: Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)),
    });
  }

  async update(projectId: string, pageId: string, input: UpdatePageInput): Promise<PlanePageItem> {
    return this.request(`/projects/${projectId}/pages/${pageId}/`, {
      method: "PATCH",
      body: Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)),
    });
  }

  async delete(projectId: string, pageId: string): Promise<void> {
    await this.request(`/projects/${projectId}/pages/${pageId}/`, {
      method: "DELETE",
    });
  }
}
