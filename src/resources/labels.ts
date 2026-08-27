import type { RequestFn } from "../client.js";
import { PlaneApiError } from "../error.js";
import type { Label, CreateLabelInput, UpdateLabelInput, ListOptions, Page } from "../types.js";

function toPage(data: {
  results?: Label[];
  next_cursor?: string;
  next_page_results?: boolean;
  total_results?: number;
}): Page<Label> {
  const items = data?.results ?? (Array.isArray(data) ? (data as unknown as Label[]) : []);
  const hasNext = data?.next_page_results ?? false;
  // `next_cursor` comes back on the last page too — only follow it when
  // `next_page_results` confirms another page. See work-items.ts.
  return {
    items,
    nextCursor: hasNext ? data?.next_cursor : undefined,
    total: data?.total_results,
    hasNext,
  };
}

/**
 * Resource for managing labels (tags) in a project.
 * Labels are used to group and filter work items.
 */
export class LabelsResource {
  constructor(private readonly request: RequestFn) {}

  /**
   * Lists one page of labels.
   * @param projectId - Project UUID
   * @param options - Pagination options
   * @returns Paginated labels
   */
  async listPage(projectId: string, options?: ListOptions): Promise<Page<Label>> {
    const params: Record<string, string> = {};
    if (options?.cursor) params.cursor = options.cursor;
    if (options?.perPage) params.per_page = String(options.perPage);
    const data = await this.request<{
      results?: Label[];
      next_cursor?: string;
      next_page_results?: boolean;
      total_results?: number;
    }>(`/projects/${projectId}/labels/`, { params, signal: options?.signal });
    if (!data) return { items: [], hasNext: false };
    return toPage(data);
  }

  /**
   * Iterates every label in the project across all pages.
   * @param projectId - Project UUID
   * @param options - List options (cursor managed automatically)
   * @yields Label one at a time
   */
  async *listAll(
    projectId: string,
    options?: Omit<ListOptions, "cursor">,
  ): AsyncIterable<Label> {
    let cursor: string | undefined;
    do {
      const page = await this.listPage(projectId, { ...options, cursor });
      for (const label of page.items) yield label;
      cursor = page.nextCursor;
    } while (cursor);
  }

  /**
   * Lists all labels in a project, walking every page. Previously returned only
   * the first one and discarded the cursor, so a long label set came back
   * silently clipped.
   * @param projectId - Project UUID
   * @returns Array of every label in the project
   */
  async list(projectId: string): Promise<Label[]> {
    const labels: Label[] = [];
    for await (const label of this.listAll(projectId)) labels.push(label);
    return labels;
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

  /**
   * Gets a label by id. Returns `null` if it does not exist.
   * @param projectId - Project UUID
   * @param labelId - Label UUID
   */
  async get(projectId: string, labelId: string): Promise<Label | null> {
    try {
      return await this.request<Label>(`/projects/${projectId}/labels/${labelId}/`);
    } catch (err) {
      if (err instanceof PlaneApiError && err.isNotFound) return null;
      throw err;
    }
  }

  /**
   * Updates a label's name or colour.
   * @param projectId - Project UUID
   * @param labelId - Label UUID
   * @param input - Fields to change
   */
  async update(projectId: string, labelId: string, input: UpdateLabelInput): Promise<Label> {
    return this.request(`/projects/${projectId}/labels/${labelId}/`, {
      method: "PATCH",
      body: input as unknown as Record<string, unknown>,
    });
  }

  /**
   * Deletes a label. Without this, a project accumulates throwaway labels that
   * nothing but the UI can clear.
   * @param projectId - Project UUID
   * @param labelId - Label UUID
   */
  async delete(projectId: string, labelId: string): Promise<void> {
    await this.request(`/projects/${projectId}/labels/${labelId}/`, { method: "DELETE" });
  }
}
