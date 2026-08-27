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
  WorkItemLink,
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
  const hasNext = data.next_page_results ?? false;
  return {
    items,
    // `next_cursor` viene SIEMPRE, también en la última página (verificado en
    // vivo contra 1.4.1: 19 de 19 work items con `next_page_results: false` y
    // `next_cursor: "100:1:0"`, y ese cursor devuelve `count: 0` con otro
    // cursor detrás, indefinidamente). Propagarlo sin mirar `next_page_results`
    // deja a `listAll()` en un bucle infinito de páginas vacías hasta el 429.
    nextCursor: hasNext ? data.next_cursor : undefined,
    total: data.total_results,
    hasNext,
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
  async listPage(
    projectId: string,
    workItemId: string,
    options?: ListOptions,
  ): Promise<Page<Comment>> {
    const params: Record<string, string> = {};
    if (options?.cursor) params.cursor = options.cursor;
    if (options?.perPage) params.per_page = String(options.perPage);
    const data = await this.request<{
      results?: Comment[];
      next_cursor?: string;
      next_page_results?: boolean;
      total_results?: number;
    }>(`/projects/${projectId}/work-items/${workItemId}/comments/`, {
      params,
      signal: options?.signal,
    });
    if (!data) return { items: [], hasNext: false };
    return toPage<Comment>(data);
  }

  /** Iterates every comment across all pages. */
  async *listAll(
    projectId: string,
    workItemId: string,
    options?: Omit<ListOptions, "cursor">,
  ): AsyncIterable<Comment> {
    let cursor: string | undefined;
    do {
      const page = await this.listPage(projectId, workItemId, { ...options, cursor });
      for (const comment of page.items) yield comment;
      cursor = page.nextCursor;
    } while (cursor);
  }

  /**
   * Lists every comment on a work item, walking all pages.
   *
   * This was the one listing left out of the 0.18.0 pagination fix, and the
   * cost was not just a short list: `work-items get` prints "N comment(s)" from
   * it, so the count itself could be smaller than the truth — a number asserted
   * on an incomplete read, which is the thing this client exists not to do.
   */
  async list(projectId: string, workItemId: string): Promise<Comment[]> {
    const comments: Comment[] = [];
    for await (const comment of this.listAll(projectId, workItemId)) comments.push(comment);
    return comments;
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
  ): Promise<WorkItemLink> {
    return this.request(
      `/projects/${projectId}/work-items/${workItemId}/links/`,
      {
        method: "POST",
        body: input as unknown as Record<string, unknown>,
      },
    );
  }

  /**
   * Lists the links on a work item.
   *
   * Without this, a link created through the client was invisible and
   * unremovable from it — the API served all four verbs, only `create` was
   * wired up.
   *
   * @param projectId - Project UUID
   * @param workItemId - Work item ID
   * @returns Paginated links
   */
  async list(
    projectId: string,
    workItemId: string,
    options?: ListOptions,
  ): Promise<Page<WorkItemLink>> {
    const params: Record<string, string> = {};
    if (options?.cursor) params.cursor = options.cursor;
    if (options?.perPage) params.per_page = String(options.perPage);
    const data = await this.request<{
      results?: WorkItemLink[];
      next_cursor?: string;
      next_page_results?: boolean;
      total_results?: number;
    }>(`/projects/${projectId}/work-items/${workItemId}/links/`, {
      params,
      signal: options?.signal,
    });
    return toPage<WorkItemLink>(data);
  }

  /**
   * Gets a single link. Returns `null` if it does not exist, like every other
   * `get()` in this client.
   * @param projectId - Project UUID
   * @param workItemId - Work item ID
   * @param linkId - Link UUID
   */
  async get(
    projectId: string,
    workItemId: string,
    linkId: string,
  ): Promise<WorkItemLink | null> {
    try {
      return await this.request<WorkItemLink>(
        `/projects/${projectId}/work-items/${workItemId}/links/${linkId}/`,
      );
    } catch (err) {
      if (err instanceof PlaneApiError && err.isNotFound) return null;
      throw err;
    }
  }

  /**
   * Updates a link's URL or title.
   * @param projectId - Project UUID
   * @param workItemId - Work item ID
   * @param linkId - Link UUID
   * @param input - Fields to change
   */
  async update(
    projectId: string,
    workItemId: string,
    linkId: string,
    input: CreateLinkInput,
  ): Promise<WorkItemLink> {
    return this.request(
      `/projects/${projectId}/work-items/${workItemId}/links/${linkId}/`,
      { method: "PATCH", body: input as unknown as Record<string, unknown> },
    );
  }

  /**
   * Deletes a link.
   * @param projectId - Project UUID
   * @param workItemId - Work item ID
   * @param linkId - Link UUID
   */
  async delete(projectId: string, workItemId: string, linkId: string): Promise<void> {
    await this.request(
      `/projects/${projectId}/work-items/${workItemId}/links/${linkId}/`,
      { method: "DELETE" },
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
      // Same shape check the CLI applies everywhere else. It stays here too
      // because this is a library entry point, but the CLI now routes `get`
      // through the shared validator so `%%%` cannot answer 1 here and 2 in
      // `delete` — the same input deserves the same exit code.
      throw new Error(
        `Invalid identifier format: ${identifier}. Expected PREFIX-NUMBER (e.g. PCL-42).`,
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
   * Deletes a work item permanently.
   *
   * The API has supported this all along (`204 No Content`); the client simply
   * never exposed it, so you could cascade-delete an entire project but not
   * remove one work item — which is how test suites leave hundreds of throwaway
   * items behind.
   *
   * @param projectId - Project UUID
   * @param id - Work item UUID
   */
  async delete(projectId: string, id: string): Promise<void> {
    await this.request(`/projects/${projectId}/work-items/${id}/`, { method: "DELETE" });
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
