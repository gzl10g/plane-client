import type { RequestFn } from "../client.js";
import { PlaneApiError } from "../error.js";
import type {
  WorkItem,
  ListWorkItemsOptions,
  SearchWorkItemsOptions,
  WorkItemSearchResult,
  CreateWorkItemInput,
  UpdateWorkItemInput,
  Comment,
  UpdateCommentInput,
  CreateLinkInput,
  CreateRelationInput,
  RelationsMap,
  RelationItem,
  Activity,
  ListOptions,
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

  async update(
    projectId: string,
    workItemId: string,
    commentId: string,
    input: UpdateCommentInput,
  ): Promise<Comment> {
    return this.request(
      `/projects/${projectId}/work-items/${workItemId}/comments/${commentId}/`,
      {
        method: "PATCH",
        body: { comment_html: input.commentHtml },
      },
    );
  }

  async delete(
    projectId: string,
    workItemId: string,
    commentId: string,
  ): Promise<void> {
    await this.request(
      `/projects/${projectId}/work-items/${workItemId}/comments/${commentId}/`,
      { method: "DELETE" },
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

export class WorkItemActivitiesResource {
  constructor(private readonly request: RequestFn) {}

  async list(
    projectId: string,
    workItemId: string,
    options?: ListOptions,
  ): Promise<Page<Activity>> {
    const params: Record<string, string> = {};
    if (options?.perPage) params.per_page = String(options.perPage);
    if (options?.cursor) params.cursor = options.cursor;
    const data = await this.request<{
      results?: Activity[];
      next_cursor?: string;
      next_page_results?: boolean;
      total_results?: number;
    }>(
      `/projects/${projectId}/work-items/${workItemId}/activities/`,
      { params, signal: options?.signal },
    );
    return toPage(data);
  }
}

export class WorkItemsResource {
  readonly comments: WorkItemCommentsResource;
  readonly links: WorkItemLinksResource;
  readonly relations: WorkItemRelationsResource;
  readonly activities: WorkItemActivitiesResource;

  constructor(private readonly request: RequestFn) {
    this.comments = new WorkItemCommentsResource(request);
    this.links = new WorkItemLinksResource(request);
    this.relations = new WorkItemRelationsResource(request);
    this.activities = new WorkItemActivitiesResource(request);
  }

  async list(
    projectId: string,
    options?: ListWorkItemsOptions,
  ): Promise<Page<WorkItem>> {
    const params: Record<string, string> = {};
    if (options?.perPage) params.per_page = String(options.perPage);
    if (options?.cursor) params.cursor = options.cursor;
    if (options?.orderBy) params.order_by = options.orderBy;
    if (options?.fields?.length) params.fields = options.fields.join(",");
    if (options?.expand?.length) params.expand = options.expand.join(",");
    if (options?.externalId) params.external_id = options.externalId;
    if (options?.externalSource) params.external_source = options.externalSource;
    const data = await this.request<{
      results?: WorkItem[];
      next_cursor?: string;
      next_page_results?: boolean;
      total_results?: number;
    }>(`/projects/${projectId}/work-items/`, { params, signal: options?.signal });
    return toPage(data);
  }

  async get(identifier: string): Promise<WorkItem | null> {
    if (!/^[A-Z]+-\d+$/.test(identifier)) {
      throw new Error(
        `Invalid identifier format: ${identifier}. Expected PREFIX-NUMBER.`,
      );
    }
    try {
      return await this.request<WorkItem>(`/work-items/${identifier}/`);
    } catch (err) {
      if (err instanceof PlaneApiError && err.isNotFound) return null;
      throw err;
    }
  }

  async getById(projectId: string, id: string): Promise<WorkItem | null> {
    try {
      return await this.request<WorkItem>(
        `/projects/${projectId}/work-items/${id}/`,
      );
    } catch (err) {
      if (err instanceof PlaneApiError && err.isNotFound) return null;
      throw err;
    }
  }

  async search(options: SearchWorkItemsOptions): Promise<WorkItemSearchResult[]> {
    const params: Record<string, string> = { search: options.query };
    if (options.limit) params.limit = String(options.limit);
    if (options.workspaceSearch) params.workspace_search = "true";
    if (options.projectId) params.project_id = options.projectId;
    const data = await this.request<{ issues?: WorkItemSearchResult[] }>(
      `/work-items/search/`,
      { params, signal: options.signal },
    );
    return data?.issues ?? [];
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
