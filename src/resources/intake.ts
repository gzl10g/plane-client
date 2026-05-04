import type { RequestFn } from "../client.js";
import type { IntakeIssue, CreateIntakeInput, ListOptions, Page } from "../types.js";

function toPage<T>(data: { results?: T[]; next_cursor?: string; next_page_results?: boolean; total_results?: number }): Page<T> {
  const items = data.results ?? (Array.isArray(data) ? data as unknown as T[] : []);
  return {
    items,
    nextCursor: data.next_cursor,
    total: data.total_results,
    hasNext: data.next_page_results ?? false,
  };
}

export class IntakeResource {
  constructor(private readonly request: RequestFn) {}

  async list(projectId: string, options?: ListOptions): Promise<Page<IntakeIssue>> {
    const params: Record<string, string> = {};
    if (options?.cursor) params.cursor = options.cursor as string;
    if (options?.perPage) params.per_page = String(options.perPage);
    const data = await this.request<{ results?: IntakeIssue[]; next_cursor?: string; next_page_results?: boolean; total_results?: number }>(
      `/projects/${projectId}/intake-issues/`, { params, signal: options?.signal },
    );
    return toPage(data);
  }

  async create(projectId: string, input: CreateIntakeInput): Promise<IntakeIssue> {
    const issue = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
    return this.request(`/projects/${projectId}/intake-issues/`, {
      method: "POST", body: { issue },
    });
  }

  async accept(projectId: string, intakeIssueId: string): Promise<unknown> {
    return this.request(`/projects/${projectId}/intake-issues/${intakeIssueId}/`, {
      method: "PATCH", body: { status: 1 },
    });
  }

  async decline(projectId: string, intakeIssueId: string): Promise<unknown> {
    return this.request(`/projects/${projectId}/intake-issues/${intakeIssueId}/`, {
      method: "PATCH", body: { status: -1 },
    });
  }
}
