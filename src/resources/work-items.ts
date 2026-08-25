import type { RequestFn } from "../client.js";
import { PlaneApiError } from "../error.js";
import { AttachmentsResource } from "./attachments.js";
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
  // Internal helper — not exported, used locally in each resource file
  const items = data.results ?? (Array.isArray(data) ? (data as unknown as T[]) : []);
  return {
    items,
    nextCursor: data.next_cursor,
    total: data.total_results,
    hasNext: data.next_page_results ?? false,
  };
}

/**
 * Resource for managing comments on work items.
 */
export class WorkItemCommentsResource {
  constructor(private readonly request: RequestFn) {}

  /**
   * Lists all comments on a work item.
   * @param projectId - Project UUID
   * @param workItemId - Work item ID
   * @returns Array of comments, empty array if none
   */
  async list(projectId: string, workItemId: string): Promise<Comment[]> {
    const data = await this.request<{ results?: Comment[] }>(
      `/projects/${projectId}/work-items/${workItemId}/comments/`,
    );
    if (!data) return [];
    return data.results ?? (Array.isArray(data) ? data as unknown as Comment[] : []);
  }

  /**
   * Creates a comment on a work item.
   * @param projectId - Project UUID
   * @param workItemId - Work item ID
   * @param commentHtml - HTML content of the comment
   * @returns The created comment
   */
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

  /**
   * Updates a comment on a work item.
   * @param projectId - Project UUID
   * @param workItemId - Work item ID
   * @param commentId - Comment ID
   * @param input - Updated comment content
   * @returns The updated comment
   */
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

  /**
   * Deletes a comment on a work item.
   * @param projectId - Project UUID
   * @param workItemId - Work item ID
   * @param commentId - Comment ID
   * @returns Resolves when the comment is deleted
   */
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

/**
 * Resource for managing external links on work items.
 */
export class WorkItemLinksResource {
  constructor(private readonly request: RequestFn) {}

  /**
   * Creates an external link on a work item.
   * @param projectId - Project UUID
   * @param workItemId - Work item ID
   * @param input - Link URL and optional title
   * @returns The created link (response body)
   */
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

/**
 * Resource for managing relations between work items.
 */
export class WorkItemRelationsResource {
  constructor(private readonly request: RequestFn) {}

  /**
   * Lists all relations for a work item grouped by relation type.
   * @param projectId - Project UUID
   * @param workItemId - Work item ID
   * @returns RelationsMap keyed by RelationType, empty object if none
   */
  async list(projectId: string, workItemId: string): Promise<RelationsMap> {
    const data = await this.request<RelationsMap>(
      `/projects/${projectId}/work-items/${workItemId}/relations/`,
    );
    return data ?? {} as RelationsMap;
  }

  /**
   * Creates a relation between work items.
   * @param projectId - Project UUID
   * @param workItemId - Work item ID
   * @param input - Relation type and target work item IDs
   * @returns Array of created relation items
   */
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

/**
 * Resource for accessing activity logs on work items.
 */
export class WorkItemActivitiesResource {
  constructor(private readonly request: RequestFn) {}

  /**
   * Lists activity log entries for a work item.
   * @param projectId - Project UUID
   * @param workItemId - Work item ID
   * @param options - Pagination options (perPage, cursor)
   * @returns Paginated activity log entries
   */
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

/**
 * Main resource for work items. Composes sub-resources for comments, links, relations, and activities.
 *
 * Work items are identified by human-readable identifiers (e.g. `PROJ-42`) via `get()`,
 * or by UUID via `getById()`. The `list()` method returns paginated results; `listAll()`
 * yields all items via async iteration.
 */
export class WorkItemsResource {
  readonly comments: WorkItemCommentsResource;
  readonly links: WorkItemLinksResource;
  readonly relations: WorkItemRelationsResource;
  readonly activities: WorkItemActivitiesResource;
  readonly attachments: AttachmentsResource;

  constructor(private readonly request: RequestFn) {
    this.comments = new WorkItemCommentsResource(request);
    this.links = new WorkItemLinksResource(request);
    this.relations = new WorkItemRelationsResource(request);
    this.activities = new WorkItemActivitiesResource(request);
    this.attachments = new AttachmentsResource(request);
  }

  /**
   * Lists work items in a project with optional pagination and ordering.
   * @param projectId - Project UUID
   * @param options - List options (pagination, ordering, fields, expansion)
   * @returns Paginated work items
   */
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

  /**
   * Gets a work item by human-readable identifier (e.g. `PROJ-42`).
   * Returns `null` if the work item is not found (404).
   * @param identifier - Human-readable ID in `PREFIX-NUMBER` format
   * @returns The work item, or `null` if not found
   * @throws Error if identifier format is invalid
   */
  async get(identifier: string): Promise<WorkItem | null> {
    if (!/^[A-Z]+-\d+$/.test(identifier)) {
      throw new Error(
        `Invalid identifier format: ${identifier}. Expected PREFIX-NUMBER.`,
      );
    }
    try {
      return await this.request<WorkItem>(`/work-items/${identifier}/`, {
        params: { expand: "state,modules" },
      });
    } catch (err) {
      if (err instanceof PlaneApiError && err.isNotFound) return null;
      throw err;
    }
  }

  /**
   * Gets a work item by UUID.
   * Returns `null` if the work item is not found (404).
   * @param projectId - Project UUID
   * @param id - Work item UUID
   * @returns The work item, or `null` if not found
   */
  async getById(projectId: string, id: string): Promise<WorkItem | null> {
    try {
      return await this.request<WorkItem>(
        `/projects/${projectId}/work-items/${id}/`,
        { params: { expand: "state,modules" } },
      );
    } catch (err) {
      if (err instanceof PlaneApiError && err.isNotFound) return null;
      throw err;
    }
  }

  /**
   * Searches work items by text query (workspace-level or scoped to a project).
   * @param options - Search options (query, limit, workspace scope, project scope)
   * @returns Array of search results (lightweight, no full WorkItem payload)
   */
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

  /**
   * Creates a new work item in a project.
   * @param projectId - Project UUID
   * @param input - Work item data (name is required)
   * @returns The created work item
   */
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

  /**
   * Updates an existing work item. Only fields set in input are changed.
   * @param projectId - Project UUID
   * @param workItemId - Work item ID
   * @param input - Fields to update (omit fields that should not change)
   * @returns The updated work item
   */
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

  /**
   * Iterates all work items in a project, automatically paging through all results.
   * @param projectId - Project UUID
   * @param options - List options (pagination, ordering — cursor is managed automatically)
   * @yields WorkItem one at a time across all pages
   */
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
