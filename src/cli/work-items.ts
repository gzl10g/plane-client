import type {
  Priority,
  CreateWorkItemInput,
  UpdateWorkItemInput,
  WorkItemOrderBy,
  ExpandField,
  RelationType,
} from "../types.js";
import { loadConfig, type Config } from "./config.js";
import {
  buildClient,
  formatOutput,
  parseRefList,
  resolveHtmlOption,
  resolveProjectFromOpts as resolveProject,
  resolveWorkItemId,
  resolveWorkItemIds,
  resolveWorkspaceForDisplay,
  warnIfEmpty,
  type HandlerDeps,
  type TableColumn,
} from "./shared.js";

const WORK_ITEMS_COLUMNS: TableColumn[] = [
  { key: "sequence_id", label: "ID", width: 8 },
  { key: "name", label: "Name", width: 50 },
  { key: "state", label: "State", width: 20 },
  { key: "priority", label: "Priority", width: 10 },
];

function resolveClient(deps?: HandlerDeps) {
  if (deps?.client) return deps.client;
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  return buildClient(config);
}

function parseCSV(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// ── Work Items ──

export async function handleWorkItemsList(
  opts: { project?: string; perPage?: number; orderBy?: string; expand?: string; json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const projectId = resolveProject(opts, config);

  const expand = opts.expand ? parseCSV(opts.expand) : ["state", "modules"];

  const page = await client.workItems.list(projectId, {
    perPage: opts.perPage,
    orderBy: opts.orderBy as WorkItemOrderBy | undefined,
    expand: expand as ExpandField[],
  });

  formatOutput(page.items, opts, WORK_ITEMS_COLUMNS);
  warnIfEmpty(page.items.length, {
    workspace: resolveWorkspaceForDisplay(config),
    project: projectId,
  });
}

export async function handleWorkItemsGet(
  identifier: string,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const item = await client.workItems.get(identifier);

  if (item === null) {
    console.log(`${identifier} (not found)`);
    return;
  }

  formatOutput(item, opts);
}

export async function handleWorkItemsGetById(
  id: string,
  opts: { project?: string; json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const projectId = resolveProject(opts, config);

  const workItemId = await resolveWorkItemId(client, id, projectId);
  const item = await client.workItems.getById(projectId, workItemId);

  if (item === null) {
    console.log(`${id} (not found)`);
    return;
  }

  formatOutput(item, opts);
}

export async function handleWorkItemsSearch(
  query: string,
  opts: {
    workspaceSearch?: boolean;
    project?: string;
    limit?: number;
    json?: boolean;
  },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });

  const results = await client.workItems.search({
    query,
    workspaceSearch: opts.workspaceSearch,
    projectId: opts.project ?? config.project,
    limit: opts.limit,
  });

  const columns: TableColumn[] = [
    { key: "sequence_id", label: "ID", width: 8 },
    { key: "name", label: "Name", width: 50 },
    { key: "project__identifier", label: "Project", width: 12 },
  ];

  formatOutput(results, opts, columns);
}

export interface CreateWorkItemsOpts {
  project?: string;
  name: string;
  priority?: string;
  state?: string;
  descriptionHtml?: string;
  descriptionHtmlFile?: string;
  labels?: string;
  assignees?: string;
  module?: string;
  json?: boolean;
}

export async function handleWorkItemsCreate(
  opts: CreateWorkItemsOpts,
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const projectId = resolveProject(opts, config);

  const input: CreateWorkItemInput = {
    name: opts.name,
    priority: opts.priority as Priority | undefined,
    state: opts.state,
    description_html: resolveHtmlOption(
      opts.descriptionHtml,
      opts.descriptionHtmlFile,
    ),
  };

  if (opts.labels) {
    input.labels = parseCSV(opts.labels);
  }

  if (opts.assignees) {
    input.assignees = parseCSV(opts.assignees);
  }

  const item = await client.workItems.create(projectId, input);

  // Module membership is a separate association in Plane (the create body does
  // not assign it), so wire it in one shot after creation when requested.
  if (opts.module) {
    await client.modules.addWorkItems(projectId, opts.module, [item.id]);
  }

  formatOutput(item, { json: opts.json });
}

export interface UpdateWorkItemsOpts {
  project?: string;
  name?: string;
  priority?: string;
  state?: string;
  descriptionHtml?: string;
  descriptionHtmlFile?: string;
  json?: boolean;
}

export async function handleWorkItemsUpdate(
  id: string,
  opts: UpdateWorkItemsOpts,
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const projectId = resolveProject(opts, config);

  const input: UpdateWorkItemInput = {};

  if (opts.name !== undefined) input.name = opts.name;
  if (opts.priority !== undefined) input.priority = opts.priority as Priority;
  if (opts.state !== undefined) input.state = opts.state;
  const descriptionHtml = resolveHtmlOption(
    opts.descriptionHtml,
    opts.descriptionHtmlFile,
  );
  if (descriptionHtml !== undefined) input.description_html = descriptionHtml;

  const workItemId = await resolveWorkItemId(client, id, projectId);
  const item = await client.workItems.update(projectId, workItemId, input);
  formatOutput(item, { json: opts.json });
}

export async function handleWorkItemsActivities(
  id: string,
  opts: { project?: string; json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const projectId = resolveProject(opts, config);

  const workItemId = await resolveWorkItemId(client, id, projectId);
  const page = await client.workItems.activities.list(projectId, workItemId);

  const columns: TableColumn[] = [
    { key: "verb", label: "Verb", width: 12 },
    { key: "field", label: "Field", width: 20 },
    { key: "created_at", label: "Created", width: 20 },
  ];

  formatOutput(page.items, opts, columns);
}

// ── Comments ──

export async function handleCommentsList(
  workItemId: string,
  opts: { project?: string; json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const projectId = resolveProject(opts, config);

  const resolvedId = await resolveWorkItemId(client, workItemId, projectId);
  const comments = await client.workItems.comments.list(projectId, resolvedId);

  const columns: TableColumn[] = [
    { key: "id", label: "ID", width: 36 },
    { key: "created_at", label: "Created", width: 20 },
  ];

  formatOutput(comments, opts, columns);
}

export async function handleCommentsCreate(
  workItemId: string,
  commentHtml: string,
  opts: { project?: string; json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const projectId = resolveProject(opts, config);

  const resolvedId = await resolveWorkItemId(client, workItemId, projectId);
  const comment = await client.workItems.comments.create(
    projectId,
    resolvedId,
    commentHtml,
  );

  formatOutput(comment, { json: opts.json });
}

export async function handleCommentsUpdate(
  workItemId: string,
  commentId: string,
  commentHtml: string,
  opts: { project?: string; json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const projectId = resolveProject(opts, config);

  const resolvedId = await resolveWorkItemId(client, workItemId, projectId);
  const comment = await client.workItems.comments.update(
    projectId,
    resolvedId,
    commentId,
    { commentHtml },
  );

  formatOutput(comment, { json: opts.json });
}

export async function handleCommentsDelete(
  workItemId: string,
  commentId: string,
  opts: { project?: string },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const projectId = resolveProject(opts, config);

  const resolvedId = await resolveWorkItemId(client, workItemId, projectId);
  await client.workItems.comments.delete(projectId, resolvedId, commentId);
  console.log(`Comment ${commentId} deleted`);
}

// ── Links ──

export async function handleLinksCreate(
  workItemId: string,
  opts: { project?: string; url: string; title?: string; json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const projectId = resolveProject(opts, config);

  const resolvedId = await resolveWorkItemId(client, workItemId, projectId);
  const link = await client.workItems.links.create(projectId, resolvedId, {
    url: opts.url,
    title: opts.title,
  });

  formatOutput(link, { json: opts.json });
}

// ── Relations ──

export async function handleRelationsList(
  workItemId: string,
  opts: { project?: string; json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const projectId = resolveProject(opts, config);

  const resolvedId = await resolveWorkItemId(client, workItemId, projectId);
  const relations = await client.workItems.relations.list(projectId, resolvedId);

  formatOutput(relations, { json: opts.json });
}

export async function handleRelationsCreate(
  workItemId: string,
  opts: { project?: string; type: string; issues: string | string[]; json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const projectId = resolveProject(opts, config);

  const resolvedId = await resolveWorkItemId(client, workItemId, projectId);
  const issues = await resolveWorkItemIds(
    client,
    parseRefList(opts.issues),
    projectId,
  );
  const items = await client.workItems.relations.create(
    projectId,
    resolvedId,
    {
      relationType: opts.type as RelationType,
      issues,
    },
  );

  formatOutput(items, { json: opts.json });
}
