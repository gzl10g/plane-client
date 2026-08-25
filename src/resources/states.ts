import type { RequestFn } from "../client.js";
import type { State } from "../types.js";

/**
 * Resource for listing workflow states in a project.
 * States define the workflow stages (e.g. "todo", "in progress", "done").
 */
export class StatesResource {
  constructor(private readonly request: RequestFn) {}

  /**
   * Lists all states in a project.
   * @param projectId - Project UUID
   * @returns Array of states
   */
  async list(projectId: string): Promise<State[]> {
    const data = await this.request<{ results?: State[] }>(
      `/projects/${projectId}/states/`,
    );
    if (!data) return [];
    return data.results ?? (Array.isArray(data) ? data as unknown as State[] : []);
  }
}
