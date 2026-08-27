// ── Config ──

/**
 * Quota state, shared by every client that authenticates with one API key.
 *
 * The client mutates it; callers only pass it around. Treat it as opaque — the
 * fields are readonly from the outside precisely so its representation can
 * change without breaking anyone.
 */
export interface RateLimitState {
  /** Requests left in the current window, as of the last response that reported it. */
  readonly remaining?: number;
  /**
   * Epoch **milliseconds** at which the window rolls over. Named for its unit
   * because the API reports it in seconds: the conversion happens on the way in,
   * and a name that hid that would be a trap.
   */
  readonly resetAtMs?: number;
}

/** What {@link PlaneClientConfig.onThrottle} receives. May gain fields. */
export interface ThrottleInfo {
  /** How long the client is about to sleep. */
  waitMs: number;
  /** `"quota"` when pacing ahead of the limit, `"retry-after"` when a 429 asked. */
  reason: "quota" | "retry-after";
  /** Requests left when pacing on quota. */
  remaining?: number;
}

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
  /**
   * Rate-limit pacing. Plane throttles **per API key** and reports the state of
   * your quota on every response (`x-ratelimit-remaining`, `x-ratelimit-reset`).
   * The default is `60/minute` (`API_KEY_RATE_LIMIT`), which is what any
   * untouched instance and Plane Cloud will give you — enough that a single
   * report-style sweep can exhaust it.
   *
   * With pacing on (the default), the client waits for the window to roll over
   * when the quota is nearly spent, instead of spending it and retrying blind.
   * An instance that sends no such headers behaves exactly as before.
   */
  rateLimit?: {
    /** Set to false to disable pacing entirely (default: true) */
    enabled?: boolean;
    /**
     * Quota to share between clients. Plane throttles **per API key**, so
     * several clients on one key — a cross-workspace sweep builds one per
     * workspace — share a single quota. Without a shared object each of them
     * starts blind and walks into the 429 the others already saw coming.
     *
     * Build it with {@link createRateLimitState}; do not read or write it.
     */
    quota?: RateLimitState;
    /**
     * Wait for the window to reset once the remaining quota drops to this or
     * below (default: 1). Zero means "only wait once the quota is spent".
     */
    minRemaining?: number;
    /**
     * Never sleep longer than this in one go (default: 60000). A clock skewed
     * far enough could otherwise park a command for hours on a bogus reset.
     */
    maxWaitMs?: number;
  };
  /**
   * Hook called when the client pauses for the rate limit. `reason` is
   * `"quota"` when pacing ahead of the limit, `"retry-after"` when honouring a
   * `Retry-After` header on a 429.
   */
  onThrottle?: (info: ThrottleInfo) => void;
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
  /**
   * Redirect handling (default: "follow"). Use `"manual"` for endpoints that
   * respond with a 3xx pointing at a resource outside the JSON API (e.g. the
   * attachment download endpoint, which redirects to a presigned S3 URL) —
   * the resolved `Location` header is returned as the result instead of
   * following the redirect and trying to parse the target as JSON.
   */
  redirect?: "follow" | "manual";
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
  /**
   * The state. A UUID on the bare endpoint, but the **full {@link State}
   * object** whenever the request asks for `expand=state` — which every CLI
   * read does. Declaring it `string` alone is what let `String(item.state)`
   * type-check and print `[object Object]` in every work-item table.
   */
  state: string | State;
  priority: Priority;
  /**
   * Assignee user ids — **or objects**, when the request asks for
   * `expand=assignees`.
   *
   * Deliberately not typed as a union, unlike {@link WorkItem.state}: `expand`
   * is opt-in here and default for state, so widening this would charge every
   * consumer for a case almost none of them cause. If you do pass `--expand
   * assignees`, read the entries with the exported `entityId()` helper.
   */
  assignees: string[];
  /** Label ids, or objects with `expand=labels`. Same caveat as {@link WorkItem.assignees}. */
  labels: string[];
  parent?: string;
  start_date?: string;
  target_date?: string;
  estimate_point?: string | null;
  type?: string;
  module?: string;
  /**
   * Modules this work item belongs to. NOT populated by the Plane API itself
   * (v1 silently ignores `expand=modules` on work-item endpoints) — only
   * present when set client-side by {@link attachModules} using
   * {@link ModulesResource.membershipMap}.
   */
  modules?: Module[];
  /**
   * Comments on this work item. NOT populated by the Plane API's work-item
   * endpoints (comments are a separate resource, `GET .../comments/`) — only
   * present when explicitly attached, e.g. by the CLI's `--with-comments`.
   */
  comments?: Comment[];
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

/** An external link attached to a work item */
export interface WorkItemLink {
  id: string;
  url: string;
  title?: string;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
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

/** Input for creating a state. */
export interface CreateStateInput {
  name: string;
  /** Required by the API: without it the response is `400 {"color":["This field is required."]}`. */
  color: string;
  /**
   * ⚠️ Optional to the API, but pass it always. Plane accepts a state with no
   * group and files it under `backlog` **without saying so**, so a review state
   * created without one is counted as backlog by every filter, count and
   * report. The CLI requires it for this reason.
   */
  group?: StateGroup;
  description?: string;
}

/** Fields that can be changed on a state */
export interface UpdateStateInput {
  name?: string;
  color?: string;
  group?: StateGroup;
  description?: string;
}

/** Fields that can be changed on a label */
export interface UpdateLabelInput {
  name?: string;
  color?: string;
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

// ── Projects ──

/**
 * A Plane project inside a workspace. `identifier` is the human-readable
 * prefix (HL, PCL…) that prefixes every work item id of the project, and `id`
 * is the UUID every project-scoped command (`-p/--project`) expects.
 */
export interface Project {
  id: string;
  name: string;
  identifier: string;
  description?: string;
  network?: number;
  workspace?: string;
  project_lead?: string | null;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

/** Input for creating a project. `name` and `identifier` are required by the API. */
export interface CreateProjectInput {
  name: string;
  /** Human-readable work item prefix (HL, PCL…). Required by the API. */
  identifier: string;
  description?: string;
  project_lead?: string;
  default_assignee?: string;
  timezone?: string;
  /** Enable cycles (sprints). */
  cycleView?: boolean;
  /** Enable modules. */
  moduleView?: boolean;
  /** Enable the intake (triage) queue. */
  intakeView?: boolean;
  /** Enable saved views (`issue_views_view` in the API). */
  viewsView?: boolean;
  /** Enable pages. */
  pageView?: boolean;
}

/**
 * Input for updating a project. Every field is optional.
 * `network` is deliberately absent: the API v1 accepts it and discards it.
 */
export type UpdateProjectInput = Partial<CreateProjectInput>;

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
  /** The intake record id (shown first by `intake list`) */
  id: string;
  /**
   * The underlying work item (issue) id. The intake detail/update endpoint is
   * keyed by this id, NOT by the intake record `id`.
   */
  issue?: string;
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

// ── Attachments ──

/**
 * A file attachment on a work item (or intake work item — intake issues are
 * regular issues under the hood, see {@link IntakeResource.resolveIssueId}).
 * Returned by `list()` and embedded in the upload flow's credentials step.
 */
export interface Attachment {
  id: string;
  /** Storage object key */
  asset: string;
  entity_type?: string;
  entity_identifier?: string;
  size?: number;
  /** Whether the file has actually been uploaded to storage (false right after the credentials step) */
  is_uploaded?: boolean;
  is_deleted?: boolean;
  is_archived?: boolean;
  external_id?: string;
  external_source?: string;
  storage_metadata?: unknown;
  attributes?: { name?: string; type?: string; size?: number; [key: string]: unknown };
  created_by?: string;
  updated_by?: string;
  created_at?: string;
  updated_at?: string;
  workspace?: string;
  project?: string;
  issue?: string;
  comment?: string;
  page?: string;
  draft_issue?: string;
  /** Presigned URL to the object (only present right after the credentials step) */
  asset_url?: string;
  [key: string]: unknown;
}

/** Input for starting an attachment upload (the credentials step) */
export interface CreateAttachmentInput {
  /** Original filename */
  name: string;
  /** MIME type (must be an allowed type on the Plane instance) */
  type?: string;
  /** File size in bytes */
  size: number;
  /** External identifier for integration tracking (dedupes with `externalSource`) */
  externalId?: string;
  /** External source system for integration tracking */
  externalSource?: string;
}

/**
 * Raw response from the presigned-upload-credentials step (`POST .../attachments/`).
 * Consumed internally by {@link AttachmentsResource.upload}; exposed for callers
 * who need to drive the 3-step flow manually.
 */
export interface AttachmentUploadCredentials {
  upload_data: {
    /** S3 endpoint to POST the file to */
    url: string;
    /** Form fields to include in the multipart POST alongside `file`, in order, before it */
    fields: Record<string, string>;
  };
  asset_id: string;
  attachment: Attachment;
  asset_url: string;
}

// ── Members ──

/**
 * Role values Plane accepts for a workspace or project membership. The API
 * validates against exactly these three (`{"role":["\"99\" is not a valid
 * choice."]}`), so anything else is a client-side bug, not a permission issue.
 */
export const Role = {
  Admin: 20,
  Member: 15,
  Guest: 5,
} as const;

/** Numeric role as stored by Plane: 20 admin, 15 member, 5 guest. */
export type RoleValue = (typeof Role)[keyof typeof Role];

/** Human spelling of a role, accepted by the client and the CLI. */
export type RoleName = "admin" | "member" | "guest";

/**
 * A member of the workspace, as returned by `/members-lite/`.
 *
 * `id` is the **user** id — the one that goes into `assignees`, not the
 * membership id. See {@link ProjectMember} for why that distinction bites.
 */
export interface WorkspaceMember {
  /** User UUID. This is what `assignees` expects. */
  id: string;
  email: string;
  display_name: string;
  first_name?: string;
  last_name?: string;
  avatar?: string;
  avatar_url?: string;
  /**
   * Numeric role as Plane stores it — 20/15/5 today ({@link Role}), but typed
   * as `number` on purpose: this is a value the API *returns*, and pinning it to
   * the union would make a consumer's exhaustive `switch` lie the day Plane adds
   * a role. Use {@link roleName} to render it; writes are validated separately.
   */
  role: number;
  is_active: boolean;
  is_bot: boolean;
  [key: string]: unknown;
}

/**
 * A member of a project, as returned by `/project-members-lite/`.
 *
 * Same shape as {@link WorkspaceMember}: `id` is the user id. The
 * **ProjectMember** id — the one `updateRole`/`deactivate` need in the URL — is
 * not part of any listing in API v1; it only ever appears in the response of
 * {@link ProjectMembersResource.add}.
 */
export type ProjectMember = WorkspaceMember;

/** What `POST .../members/` answers: the membership row, not the user. */
export interface ProjectMembership {
  /** ProjectMember UUID — the `pk` that `updateRole`/`deactivate` require. */
  id: string;
  /** User UUID of the member added. */
  member: string;
  role: RoleValue;
}

/** A pending (or accepted) workspace invitation. */
export interface WorkspaceInvitation {
  id: string;
  email: string;
  role: RoleValue;
  accepted: boolean;
  responded_at?: string | null;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

/** Input for inviting an email address to the workspace. */
export interface CreateInvitationInput {
  email: string;
  /** Role for the invitee. Defaults to `Role.Member` if omitted. */
  role?: RoleValue | RoleName;
}
