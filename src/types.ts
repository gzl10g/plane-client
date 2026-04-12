// ── Config ──
export interface PlaneClientConfig {
  baseUrl: string;
  apiKey: string;
  workspace: string;
  timeout?: number;
  retry?: {
    maxRetries?: number;
    retryOn?: number[];
  };
  onRequest?: (req: { method: string; url: string }) => void;
  onResponse?: (res: { method: string; url: string; status: number; durationMs: number }) => void;
}

// ── Internal request ──
export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  params?: Record<string, string>;
  body?: Record<string, unknown>;
  timeout?: number;
  signal?: AbortSignal;
}

// ── Pagination ──
export interface ListOptions {
  cursor?: string;
  page?: number;
  perPage?: number;
  signal?: AbortSignal;
  [key: string]: unknown;
}

export interface Page<T> {
  items: T[];
  total?: number;
  nextCursor?: string;
  hasNext: boolean;
}

// ── Work Items ──
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

export type Priority = "urgent" | "high" | "medium" | "low" | "none";
export type StateGroup = "backlog" | "unstarted" | "started" | "completed" | "cancelled";
export type RelationType = "blocking" | "blocked_by" | "duplicate" | "relates_to" | "start_before" | "start_after" | "finish_before" | "finish_after";

export type WorkItemOrderBy =
  | "created_at" | "-created_at"
  | "updated_at" | "-updated_at"
  | "priority" | "-priority"
  | "sort_order" | "-sort_order"
  | "state__name" | "-state__name"
  | "state__group" | "-state__group"
  | "labels__name" | "-labels__name"
  | "assignees__first_name" | "-assignees__first_name";

export type ExpandField = "assignees" | "labels" | "state" | "modules" | "cycle";

export interface ListWorkItemsOptions extends ListOptions {
  orderBy?: WorkItemOrderBy;
  fields?: string[];
  expand?: ExpandField[];
  externalId?: string;
  externalSource?: string;
}

export interface SearchWorkItemsOptions {
  query: string;
  limit?: number;
  workspaceSearch?: boolean;
  projectId?: string;
  signal?: AbortSignal;
}

export interface WorkItemSearchResult {
  id: string;
  name: string;
  sequence_id: number;
  project__identifier: string;
  project_id: string;
  workspace__slug: string;
}

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

export interface CreateWorkItemInput {
  name: string;
  description_html?: string;
  state?: string;
  priority?: Priority;
  assignees?: string[];
  labels?: string[];
  parent?: string;
  start_date?: string;
  target_date?: string;
  estimate_point?: string | null;
  type?: string;
  module?: string;
}

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
export interface Comment {
  id: string;
  comment_html: string;
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
}

export interface UpdateCommentInput {
  commentHtml: string;
}

// ── Links ──
export interface CreateLinkInput {
  url: string;
  title?: string;
}

// ── Relations ──
export type RelationsMap = Record<RelationType, string[]>;

export interface CreateRelationInput {
  relationType: RelationType;
  issues: string[];
}

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
export interface State {
  id: string;
  name: string;
  group: StateGroup;
  color: string;
  [key: string]: unknown;
}

// ── Labels ──
export interface Label {
  id: string;
  name: string;
  color?: string;
  [key: string]: unknown;
}

export interface CreateLabelInput {
  name: string;
  color?: string;
}

// ── Modules ──
export interface Module {
  id: string;
  name: string;
  description?: string;
  status?: string;
  start_date?: string;
  target_date?: string;
  [key: string]: unknown;
}

export interface CreateModuleInput {
  name: string;
  description?: string;
  start_date?: string;
  target_date?: string;
}

export interface UpdateModuleInput {
  name?: string;
  description?: string;
  status?: string;
  start_date?: string;
  target_date?: string;
}

// ── Cycles ──
export interface Cycle {
  id: string;
  name: string;
  description?: string;
  start_date?: string;
  end_date?: string;
  [key: string]: unknown;
}

export interface CreateCycleInput {
  name: string;
  description?: string;
  start_date?: string;
  end_date?: string;
}

export interface UpdateCycleInput {
  name?: string;
  description?: string;
  start_date?: string;
  end_date?: string;
}

// ── Intake ──
export interface IntakeIssue {
  id: string;
  name?: string;
  status: number;
  [key: string]: unknown;
}

export interface CreateIntakeInput {
  name: string;
  description_html?: string;
  priority?: Priority;
}

// ── Pages ──
export interface PlanePageItem {
  id: string;
  name: string;
  description_html?: string;
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
}

export interface CreatePageInput {
  name: string;
  description_html?: string;
}

export interface UpdatePageInput {
  name?: string;
  description_html?: string;
}
