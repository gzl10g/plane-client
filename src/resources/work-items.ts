import type { RequestFn } from "../client.js";
import type {
  WorkItem,
  ListWorkItemsOptions,
  SearchWorkItemsOptions,
  CreateWorkItemInput,
  UpdateWorkItemInput,
  Comment,
  CreateLinkInput,
  CreateRelationInput,
  RelationsMap,
  RelationItem,
  Page,
} from "../types.js";

function toPage<T>(data: {
  results?: T[];
  next_cursor?: string;
  next_page_results?: boolean;
  total_results?: number;
}): Page<T> {
  const items = data.results ?? (Array.isArray(data) ? (data as unknown as T[]) : []);
  return {
    items,
    nextCursor: data.next_cursor,
    total: data.total_results,
    hasNext: data.next_page_results ?? false,
  };
}

export class WorkItemCommentsResource {
  constructor(private readonly request: RequestFn) {}

  async list(projectId: string, workItemId: string): Promise<Comment[]> {
    const data = await this.request<{ results?: Comment[] }>(
      `/projects/${projectId}/work-items/${workItemId}/comments/`,
    );
    if (!data) return [];
    return data.results ?? (Array.isArray(data) ? data as unknown as Comment[] : []);
  }

  async create(
    projectId: string,
    workItemId: string,
    commentHtml: string,
  ): Promise<Comment> {
    return this.request(
      `/projects/${projectId}/work-items/${workItemId}/comments/`,
      {
        method: "POST",
        body: { comment_html: commentHtml },
      },
    );
  }
}

export class WorkItemLinksResource {
  constructor(private readonly request: RequestFn) {}

  async create(
    projectId: string,
    workItemId: string,
    input: CreateLinkInput,
  ): Promise<unknown> {
    return this.request(
      `/projects/${projectId}/work-items/${workItemId}/links/`,
      {
        method: "POST",
        body: input as unknown as Record<string, unknown>,
      },
    );
  }
}

export class WorkItemRelationsResource {
  constructor(private readonly request: RequestFn) {}

  async list(projectId: string, workItemId: string): Promise<RelationsMap> {
    const data = await this.request<RelationsMap>(
      `/projects/${projectId}/work-items/${workItemId}/relations/`,
    );
    return data ?? {} as RelationsMap;
  }

  async create(
    projectId: string,
    workItemId: string,
    input: CreateRelationInput,
  ): Promise<RelationItem[]> {
    return this.request(
      `/projects/${projectId}/work-items/${workItemId}/relations/`,
      {
        method: "POST",
        body: {
          relation_type: input.relationType,
          issues: input.issues,
        },
      },
    );
  }
}

export class WorkItemsResource {
  readonly comments: WorkItemCommentsResource;
  readonly links: WorkItemLinksResource;
  readonly relations: WorkItemRelationsResource;

  constructor(private readonly request: RequestFn) {
    this.comments = new WorkItemCommentsResource(request);
    this.links = new WorkItemLinksResource(request);
    this.relations = new WorkItemRelationsResource(request);
  }

  async list(
    projectId: string,
    options?: ListWorkItemsOptions,
  ): Promise<Page<WorkItem>> {
    const params: Record<string, string> = {};
    if (options?.perPage) params.per_page = String(options.perPage);
    if (options?.cursor) params.cursor = options.cursor;
    if (options?.stateGroup) params.state_group = options.stateGroup;
    if (options?.priority) params.priority = options.priority;
    if (options?.assignee) params.assignees = options.assignee;
    if (options?.label) params.labels = options.label;
    const data = await this.request<{
      results?: WorkItem[];
      next_cursor?: string;
      next_page_results?: boolean;
      total_results?: number;
    }>(`/projects/${projectId}/work-items/`, { params, signal: options?.signal });
    return toPage(data);
  }

  async get(projectId: string, identifier: string): Promise<WorkItem | null> {
    const match = identifier.match(/^([A-Z]+)-(\d+)$/);
    if (!match)
      throw new Error(
        `Invalid identifier format: ${identifier}. Expected PREFIX-NUMBER.`,
      );
    const seqId = Number(match[2]);
    const data = await this.request<{ results?: WorkItem[] }>(
      `/projects/${projectId}/work-items/`,
      { params: { search: String(seqId) } },
    );
    const items =
      data.results ?? (Array.isArray(data) ? (data as unknown as WorkItem[]) : []);
    return items.find((i) => i.sequence_id === seqId) ?? null;
  }

  async search(
    projectId: string,
    options: SearchWorkItemsOptions,
  ): Promise<Page<WorkItem>> {
    const params: Record<string, string> = { search: options.query };
    if (options.cursor) params.cursor = options.cursor;
    if (options.perPage) params.per_page = String(options.perPage);
    const data = await this.request<{
      results?: WorkItem[];
      next_cursor?: string;
      next_page_results?: boolean;
      total_results?: number;
    }>(`/projects/${projectId}/work-items/`, { params, signal: options.signal });
    return toPage(data);
  }

  async create(
    projectId: string,
    input: CreateWorkItemInput,
  ): Promise<WorkItem> {
    return this.request(`/projects/${projectId}/work-items/`, {
      method: "POST",
      body: Object.fromEntries(
        Object.entries(input).filter(([, v]) => v !== undefined),
      ),
    });
  }

  async update(
    projectId: string,
    workItemId: string,
    input: UpdateWorkItemInput,
  ): Promise<WorkItem> {
    return this.request(
      `/projects/${projectId}/work-items/${workItemId}/`,
      {
        method: "PATCH",
        body: Object.fromEntries(
          Object.entries(input).filter(([, v]) => v !== undefined),
        ),
      },
    );
  }

  async *listAll(
    projectId: string,
    options?: Omit<ListWorkItemsOptions, "cursor">,
  ): AsyncIterable<WorkItem> {
    let cursor: string | undefined;
    do {
      const page = await this.list(projectId, { ...options, cursor });
      for (const item of page.items) yield item;
      cursor = page.nextCursor;
    } while (cursor);
  }
}
