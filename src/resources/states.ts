import type { RequestFn } from "../client.js";
import type { State } from "../types.js";

export class StatesResource {
  constructor(private readonly request: RequestFn) {}

  async list(projectId: string): Promise<State[]> {
    const data = await this.request<{ results?: State[] }>(
      `/projects/${projectId}/states/`,
    );
    if (!data) return [];
    return data.results ?? (Array.isArray(data) ? data as unknown as State[] : []);
  }
}
