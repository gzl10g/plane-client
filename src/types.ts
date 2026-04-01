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
  completed_at?: string;
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
}

export type Priority = "urgent" | "high" | "medium" | "low" | "none";
export type StateGroup = "backlog" | "unstarted" | "started" | "completed" | "cancelled";
export type RelationType = "blocking" | "blocked_by" | "duplicate" | "relates_to" | "start_before" | "start_after" | "finish_before" | "finish_after";

export interface ListWorkItemsOptions extends ListOptions {
  stateGroup?: StateGroup;
  priority?: Priority;
  assignee?: string;
  label?: string;
}

export interface SearchWorkItemsOptions extends ListOptions {
  query: string;
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
}

// ── Comments ──
export interface Comment {
  id: string;
  comment_html: string;
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
}

// ── Links ──
export interface CreateLinkInput {
  url: string;
  title?: string;
}

// ── Relations ──
export interface CreateRelationInput {
  relationType: RelationType;
  issues: string[];
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
