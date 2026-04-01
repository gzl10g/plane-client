import type { RequestFn } from "../client.js";
import type { Label, CreateLabelInput } from "../types.js";

export class LabelsResource {
  constructor(private readonly request: RequestFn) {}

  async list(projectId: string): Promise<Label[]> {
    return this.request(`/projects/${projectId}/labels/`);
  }

  async create(projectId: string, input: CreateLabelInput): Promise<Label> {
    return this.request(`/projects/${projectId}/labels/`, {
      method: "POST",
      body: input as unknown as Record<string, unknown>,
    });
  }
}
