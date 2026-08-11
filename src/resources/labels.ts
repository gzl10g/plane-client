import type { RequestFn } from "../client.js";
import type { Label, CreateLabelInput } from "../types.js";

/**
 * Resource for managing labels (tags) in a project.
 * Labels are used to group and filter work items.
 */
export class LabelsResource {
  constructor(private readonly request: RequestFn) {}

  /**
   * Lists all labels in a project.
   * @param projectId - Project UUID
   * @returns Array of labels
   */
  async list(projectId: string): Promise<Label[]> {
    const data = await this.request<{ results?: Label[] }>(
      `/projects/${projectId}/labels/`,
    );
    if (!data) return [];
    return data.results ?? (Array.isArray(data) ? data as unknown as Label[] : []);
  }

  /**
   * Creates a new label in a project.
   * @param projectId - Project UUID
   * @param input - Label name and optional color
   * @returns The created label
   */
  async create(projectId: string, input: CreateLabelInput): Promise<Label> {
    return this.request(`/projects/${projectId}/labels/`, {
      method: "POST",
      body: input as unknown as Record<string, unknown>,
    });
  }
}
