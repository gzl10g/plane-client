// ── Config ──

/** Configuration for the Plane API client */
export interface PlaneClientConfig {
  /** Your Plane instance base URL (e.g. `https://plane.example.com`) */
  baseUrl: string;
  /** API key (format: `pk_...` or `sk_...`) */
  apiKey: string;
  /** Workspace slug for requests */
  workspace: string;
  /** Request timeout in ms (default: 30000) */
  timeout?: number;
  /** Retry configuration for failed requests */
  retry?: {
    /** Maximum retry attempts (default: 2) */
    maxRetries?: number;
    /** HTTP status codes that trigger a retry (default: [429, 502, 503, 504]) */
    retryOn?: number[];
  };
  /** Hook called before each request. Useful for debugging */
  onRequest?: (req: { method: string; url: string }) => void;
  /** Hook called after each response. Useful for observability (status, duration) */
  onResponse?: (res: { method: string; url: string; status: number; durationMs: number }) => void;
}

// ── Internal request ──

/** Options passed to the internal request function */
export interface RequestOptions {
  /** HTTP method (default: "GET") */
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  /** Query parameters appended to the URL */
  params?: Record<string, string>;
  /** Request body (serialized to JSON) */
  body?: Record<string, unknown>;
  /** Per-request timeout override in ms */
  timeout?: number;
  /** Abort signal for cancelling the request */
  signal?: AbortSignal;
}

// ── Pagination ──

/** Base options for list requests supporting cursor-based pagination */
export interface ListOptions {
  /** Cursor from a previous page for continuation */
  cursor?: string;
  /** Page number (legacy, cursor preferred) */
  page?: number;
  /** Items per page (default: server-defined) */
  perPage?: number;
  /** Abort signal for this request */
  signal?: AbortSignal;
  /** Additional query params (state, priority, labels, etc.) */
  [key: string]: unknown;
}

/**
 * Normalised paginated response from Plane API.
 * @template T - The type of items in this page
 */
export interface Page<T> {
  /** Items on this page */
  items: T[];
  /** Total item count (may be undefined if API doesn't return it) */
  total?: number;
  /** Cursor for the next page (undefined if no more pages) */
  nextCursor?: string;
  /** Whether there are more pages available */
  hasNext: boolean;
}

// ── Work Items ──

/** A Plane work item (issue, task, story, bug, etc.) */
export interface WorkItem {
  id: string;
  name: string;
  sequence_id: number;
  description_html?: string;
  state: string;
  priority: Priority;
  assignees: string[];
  labels: string[];
  parent?: string;
  start_date?: string;
  target_date?: string;
  estimate_point?: string | null;
  type?: string;
  module?: string;
  completed_at?: string;
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
}

/** Work item priority levels: `urgent`, `high`, `medium`, `low`, or `none` */
export type Priority = "urgent" | "high" | "medium" | "low" | "none";
/** Possible workflow states for a work item: `backlog`, `unstarted`, `started`, `completed`, `cancelled` */
export type StateGroup = "backlog" | "unstarted" | "started" | "completed" | "cancelled";
/** Types of relationships between work items: `blocking`, `blocked_by`, `duplicate`, `relates_to`, `start_before`, `start_after`, `finish_before`, `finish_after` */
export type RelationType = "blocking" | "blocked_by" | "duplicate" | "relates_to" | "start_before" | "start_after" | "finish_before" | "finish_after";

/** Valid values for the `order_by` parameter in list requests */
export type WorkItemOrderBy =
  | "created_at" | "-created_at"
  | "updated_at" | "-updated_at"
  | "priority" | "-priority"
  | "sort_order" | "-sort_order"
  | "state__name" | "-state__name"
  | "state__group" | "-state__group"
  | "labels__name" | "-labels__name"
  | "assignees__first_name" | "-assignees__first_name";

/** Fields that can be expanded in work item responses (e.g. `assignees`, `labels`) */
export type ExpandField = "assignees" | "labels" | "state" | "modules" | "cycle";

/** Options for listing work items with pagination and filtering */
export interface ListWorkItemsOptions extends ListOptions {
  /** Sort field with optional `-` prefix for descending (e.g. `-created_at`) */
  orderBy?: WorkItemOrderBy;
  /** Comma-separated field names to include */
  fields?: string[];
  /** Fields to expand (relations, nested objects) */
  expand?: ExpandField[];
  /** Filter by external identifier */
  externalId?: string;
  /** Filter by external source */
  externalSource?: string;
}

/** Options for searching work items */
export interface SearchWorkItemsOptions {
  /** Search query string */
  query: string;
  /** Maximum number of results (default: API-defined) */
  limit?: number;
  /** Search across the entire workspace (not just the project) */
  workspaceSearch?: boolean;
  /** Restrict search to a specific project */
  projectId?: string;
  /** Abort signal */
  signal?: AbortSignal;
}

/** Search result for a work item (lightweight, no full WorkItem payload) */
export interface WorkItemSearchResult {
  id: string;
  name: string;
  sequence_id: number;
  project__identifier: string;
  project_id: string;
  workspace__slug: string;
}

/** Activity log entry tracking changes to a work item */
export interface Activity {
  id: string;
  created_at: string;
  verb: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  comment: string | null;
  actor: string;
  [key: string]: unknown;
}

/** Input for creating a new work item */
export interface CreateWorkItemInput {
  /** Work item name/title (required) */
  name: string;
  /** HTML description */
  description_html?: string;
  /** State UUID to assign */
  state?: string;
  /** Priority level */
  priority?: Priority;
  /** Assignee user IDs */
  assignees?: string[];
  /** Label IDs */
  labels?: string[];
  /** Parent work item ID (for sub-issues) */
  parent?: string;
  /** Start date (ISO date string) */
  start_date?: string;
  /** Target/estimated completion date */
  target_date?: string;
  /** Estimate point UUID */
  estimate_point?: string | null;
  /** Work item type */
  type?: string;
  /** Module/iteration UUID */
  module?: string;
}

/** Input for updating an existing work item (only set fields to change) */
export interface UpdateWorkItemInput {
  name?: string;
  description_html?: string;
  state?: string;
  priority?: Priority;
  assignees?: string[];
  labels?: string[];
  start_date?: string;
  target_date?: string;
  estimate_point?: string | null;
  type?: string;
  module?: string;
}

// ── Comments ──

/** A comment on a work item */
export interface Comment {
  id: string;
  comment_html: string;
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
}

/** Input for updating a comment */
export interface UpdateCommentInput {
  commentHtml: string;
}

// ── Links ──

/** Input for creating an external link on a work item */
export interface CreateLinkInput {
  url: string;
  title?: string;
}

// ── Relations ──

/** A related work item reference returned by the relations API */
export interface RelationTarget {
  project_id: string;
  issue_id: string;
}

/** Maps relation types to arrays of related work item references */
export type RelationsMap = Record<RelationType, RelationTarget[]>;

/** Input for creating a relation between work items */
export interface CreateRelationInput {
  relationType: RelationType;
  issues: string[];
}

/** A related work item returned from the relations API */
export interface RelationItem {
  id: string;
  name: string;
  sequence_id: number;
  project_id: string;
  relation_type: RelationType;
  state_id: string;
  priority: string;
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
}

// ── States ──

/** A state representing workflow stage for work items (e.g. "todo", "in progress", "done") */
export interface State {
  id: string;
  name: string;
  group: StateGroup;
  color: string;
  [key: string]: unknown;
}

// ── Labels ──

/** A label for grouping/tagging work items */
export interface Label {
  id: string;
  name: string;
  color?: string;
  [key: string]: unknown;
}

/** Input for creating a label */
export interface CreateLabelInput {
  name: string;
  color?: string;
}

// ── Modules ──

/** A module (sprint/planning bucket) grouping work items */
export interface Module {
  id: string;
  name: string;
  description?: string;
  status?: string;
  start_date?: string;
  target_date?: string;
  [key: string]: unknown;
}

/** Input for creating a module */
export interface CreateModuleInput {
  name: string;
  description?: string;
  start_date?: string;
  target_date?: string;
}

/** Input for updating a module */
export interface UpdateModuleInput {
  name?: string;
  description?: string;
  status?: string;
  start_date?: string;
  target_date?: string;
}

// ── Cycles ──

/** A cycle (iterative timebox) grouping work items */
export interface Cycle {
  id: string;
  name: string;
  description?: string;
  start_date?: string;
  end_date?: string;
  [key: string]: unknown;
}

/** Input for creating a cycle */
export interface CreateCycleInput {
  name: string;
  description?: string;
  start_date?: string;
  end_date?: string;
}

/** Input for updating a cycle */
export interface UpdateCycleInput {
  name?: string;
  description?: string;
  start_date?: string;
  end_date?: string;
}

// ── Intake ──

/** An issue in the intake queue awaiting triage */
export interface IntakeIssue {
  id: string;
  name?: string;
  status: number;
  [key: string]: unknown;
}

/** Input for creating an intake issue */
export interface CreateIntakeInput {
  name: string;
  description_html?: string;
  priority?: Priority;
}

// ── Pages ──

/** A Plane page (note/document) — not available in API v1 */
export interface PlanePageItem {
  id: string;
  name: string;
  description_html?: string;
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
}

/** Input for creating a page */
export interface CreatePageInput {
  name: string;
  description_html?: string;
}

/** Input for updating a page */
export interface UpdatePageInput {
  name?: string;
  description_html?: string;
}
