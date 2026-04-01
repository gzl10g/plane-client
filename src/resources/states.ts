import type { RequestFn } from "../client.js";
import type { State } from "../types.js";

export class StatesResource {
  constructor(private readonly request: RequestFn) {}

  async list(projectId: string): Promise<State[]> {
    return this.request(`/projects/${projectId}/states/`);
  }
}
