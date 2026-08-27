import type {
  Priority,
  CreateWorkItemInput,
  UpdateWorkItemInput,
  WorkItemOrderBy,
  ExpandField,
  RelationType,
  WorkItem,
  State,
  Comment,
} from "../types.js";
import { attachModules } from "../resources/modules.js";
import { stateName } from "../state-helpers.js";
import { resolveAssignees } from "./members.js";
import { loadConfig, type Config } from "./config.js";
import {
  AbortedError,
  buildClient,
  confirmAction,
  formatOutput,
  NotFoundError,
  parseRefList,
  reportAction,
  resolveHtmlOption,
  resolveProjectFromOpts as resolveProject,
  resolveOptionalProjectFromOpts as resolveOptionalProject,
  assertWorkItemIdShape,
  normaliseWorkItemRef,
  resolveWorkItemId,
  resolveWorkItemIds,
  resolveWorkspaceForDisplay,
  toWorkItemRows,
  formatTimestamp,
  toPlainText,
  warnIfEmpty,
  warnIfTruncated,
  WORK_ITEM_COLUMNS,
  type HandlerDeps,
  type TableColumn,
  UsageError,
} from "./shared.js";

/**
 * The `order_by` values Plane actually honours, mirroring {@link WorkItemOrderBy}.
 *
 * Anything else is dropped in silence — verified with curl, `order_by=name`
 * returns exactly the same order as no parameter at all. `name` is the trap:
 * it is the first field a person would sort by, it is *not* in the union (the
 * API has `state__name` and `labels__name`, but no bare `name`), and the result
 * is an unsorted listing that looks sorted.
 */
const ORDER_BY_VALUES: WorkItemOrderBy[] = [
  "created_at", "-created_at",
  "updated_at", "-updated_at",
  "priority", "-priority",
  "sort_order", "-sort_order",
  "state__name", "-state__name",
  "state__group", "-state__group",
  "labels__name", "-labels__name",
  "assignees__first_name", "-assignees__first_name",
];

/**
 * Validates `--order-by` before the request, because the API will not.
 * @throws Error naming the accepted values
 */
export function parseOrderBy(value: string | undefined): WorkItemOrderBy | undefined {
  if (value === undefined) return undefined;
  if (!ORDER_BY_VALUES.includes(value as WorkItemOrderBy)) {
    const hint = value === "name" ? " There is no bare `name`: use state__name, or sort the JSON yourself." : "";
    throw new UsageError(
      `Invalid --order-by ${value}. Plane ignores an unknown value in silence, so this would return an unsorted list that looks sorted.${hint} One of: ${ORDER_BY_VALUES.join(", ")}`,
    );
  }
  return value as WorkItemOrderBy;
}

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

// A work item's comments are easy to miss: `get`/`get-by-id` never include
// them (they're a separate resource), so context, corrections, or an
// "this no longer applies because..." living only in a comment goes unread.
// One extra request is cheap (unlike module membership, this isn't N+1), so
// every `get` checks and surfaces it — no flag needed to find out; --with-
// comments is only for attaching the full comment bodies to the output.
//
// This check must not fail the whole command: the work item itself was
// already fetched successfully, and comments have their own permission
// surface (comments-list 403s were a real failure mode historically — see
// gotcha 12 in the plane skill). A failed check degrades to a warning, not
// a thrown error.
async function checkComments(
  client: ReturnType<typeof resolveClient>,
  projectId: string,
  workItemId: string,
  displayId: string,
  suppressHint = false,
): Promise<Comment[] | undefined> {
  let comments;
  try {
    comments = await client.workItems.comments.list(projectId, workItemId);
  } catch (err) {
    console.error(
      `Could not check comments on ${displayId}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }
  // El aviso solo tiene sentido si NO se van a imprimir a continuación: con
  // --with-comments salía justo antes de los propios comentarios, diciendo
  // cómo leer lo que ya estabas leyendo.
  if (comments.length > 0 && !suppressHint) {
    console.error(
      `${comments.length} comment(s) on ${displayId} — they may carry context the description doesn't. ` +
        `Read with: planec work-items comments list ${displayId} -p ${projectId} --json`,
    );
  }
  return comments;
}

// Runs --with-modules and the comments check concurrently — neither depends
// on the other's result, so awaiting them in sequence would just double the
// added latency for no benefit.
async function enrichWorkItem(
  client: ReturnType<typeof resolveClient>,
  item: WorkItem,
  projectId: string,
  displayId: string,
  opts: { withModules?: boolean; withComments?: boolean; json?: boolean },
): Promise<WorkItem> {
  const [membership, comments] = await Promise.all([
    opts.withModules ? client.modules.membershipMap(projectId) : Promise.resolve(undefined),
    // Con --with-comments los imprimimos abajo, así que el aviso sobra.
    checkComments(client, projectId, item.id, displayId, opts.withComments === true && opts.json !== true),
  ]);

  let result = item;
  if (membership) result = attachModules([result], membership)[0];
  if (comments && opts.withComments) result = { ...result, comments };
  return result;
}

/** The comment author's display name, from whichever field the API filled in. */
function authorOf(comment: Record<string, unknown>): string {
  const detail = comment.actor_detail as { display_name?: string; email?: string } | undefined;
  return detail?.display_name ?? detail?.email ?? String(comment.actor ?? "");
}

/**
 * Prints attached comments in the human view.
 *
 * `--with-comments` only ever did anything under `--json`: without it the flag
 * was accepted, the extra request was made, and the output was identical — the
 * help promised "attach comment bodies to the output" and nothing appeared.
 */
/**
 * Renders the state as its name in the human key/value view.
 *
 * `get` asks for `expand=state`, so the field is an object and the dump printed
 * the whole JSON on a line where every other value is a scalar. `--json` keeps
 * the object untouched: this is presentation, not data.
 */
function readableState(item: WorkItem, opts: { json?: boolean }): WorkItem {
  if (opts.json) return item;
  const name = stateName(item.state as string | State);
  return name === null ? item : ({ ...item, state: name } as unknown as WorkItem);
}

function withoutComments(item: WorkItem, opts: { withComments?: boolean; json?: boolean }): WorkItem {
  // In the human view the comments get their own readable section below, so
  // leaving the raw array in the key/value dump would print each comment twice
  // — once as a wall of JSON and once properly.
  if (!opts.withComments || opts.json) return item;
  const { comments: _dropped, ...rest } = item;
  return rest as WorkItem;
}

function printComments(item: WorkItem, opts: { withComments?: boolean; json?: boolean }): void {
  if (!opts.withComments || opts.json) return;
  const comments = item.comments ?? [];
  if (comments.length === 0) return;

  console.log("");
  console.log(`Comments (${comments.length}):`);
  for (const comment of comments) {
    const who = authorOf(comment as unknown as Record<string, unknown>);
    console.log(`  ── ${formatTimestamp(comment.created_at)}${who ? ` · ${who}` : ""}`);
    const text = toPlainText(comment.comment_html);
    console.log(`     ${text === "" ? "(empty)" : text}`);
  }
}

// ── Work Items ──

export async function handleWorkItemsList(
  opts: { project?: string; perPage?: number; orderBy?: string; expand?: string; withModules?: boolean; all?: boolean; json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  // Flags first, project second. Resolving a project costs a request (a full
  // listing if you passed an identifier), and spending it only to report a typo
  // in a flag is backwards — `--per-page` was already validated up front and
  // `--order-by` was not, so the same mistake failed differently depending on
  // which flag you got wrong.
  const orderBy = parseOrderBy(opts.orderBy);

  const client = resolveClient(deps);
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const projectId = await resolveProject(opts, config, client);

  const expand = opts.expand ? parseCSV(opts.expand) : ["state", "modules"];

  const listOptions = {
    perPage: opts.perPage,
    orderBy,
    expand: expand as ExpandField[],
  };

  // Without --all this fetches one page and says so when there are more. It is
  // not silently the whole project: `/work-items/` only paginates when
  // `per_page` is sent, so the default call still returns everything in one
  // response — but the moment someone passes --per-page, the listing was cut
  // short with no hint, which is the bug `projects list` already fixed.
  let items: WorkItem[];
  if (opts.all) {
    items = [];
    for await (const item of client.workItems.listAll(projectId, listOptions)) {
      items.push(item);
    }
  } else {
    const page = await client.workItems.list(projectId, listOptions);
    items = page.items;
    warnIfTruncated(page.items.length, page.hasNext, page.total);
  }

  // The API accepts expand=modules above but never actually returns it
  // (verified against Plane 1.4.1) — --with-modules recovers it client-side
  // by walking every module in the project. See ModulesResource.membershipMap.
  const enriched = opts.withModules
    ? attachModules(items, await client.modules.membershipMap(projectId))
    : items;

  // --json keeps the raw API objects; only the table gets the readable id and
  // the resolved state name.
  formatOutput(
    opts.json ? enriched : await toWorkItemRows(client, projectId, enriched),
    opts,
    WORK_ITEM_COLUMNS,
  );
  warnIfEmpty(enriched.length, {
    workspace: resolveWorkspaceForDisplay(config),
    project: projectId,
  });
}

export async function handleWorkItemsGet(
  identifier: string,
  opts: { withModules?: boolean; withComments?: boolean; json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  // Por el mismo validador que el resto de comandos: antes `get` traía el suyo
  // y un id malformado salía 1 aquí y 2 en `delete`. Y por la misma
  // normalización, para que `prueba-42` o un id pegado con espacios funcionen
  // igual que en los demás.
  assertWorkItemIdShape(identifier);
  identifier = normaliseWorkItemRef(identifier);
  const item = await client.workItems.get(identifier);

  // Printing "(not found)" on stdout and exiting 0 made `| jq` blow up with no
  // error to catch, and `planec ... && next-step` carry on as if the work item
  // existed. The SDK is fine — `get()` returning null is the 404; it is the CLI
  // that has to turn it into a failure.
  if (item === null) {
    throw new NotFoundError(`Work item not found: ${identifier}`);
  }

  const projectId = typeof item.project === "string" ? item.project : undefined;
  if (opts.withModules && !projectId) {
    throw new Error(`Cannot resolve project for ${identifier} to look up modules`);
  }

  const result = projectId ? await enrichWorkItem(client, item, projectId, identifier, opts) : item;

  formatOutput(readableState(withoutComments(result, opts), opts), opts);
  printComments(result, opts);
}

export async function handleWorkItemsGetById(
  id: string,
  opts: { project?: string; withModules?: boolean; withComments?: boolean; json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const projectId = await resolveProject(opts, config, client);

  const workItemId = await resolveWorkItemId(client, id, projectId);
  const item = await client.workItems.getById(projectId, workItemId);

  if (item === null) {
    throw new NotFoundError(`Work item not found: ${id}`);
  }

  const result = await enrichWorkItem(client, item, projectId, id, opts);

  formatOutput(readableState(withoutComments(result, opts), opts), opts);
  printComments(result, opts);
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

  // `search` es el único comando cuyo proyecto es opcional (sin él busca en todo
  // el workspace), así que no puede usar el resolvedor que exige uno — pero sí
  // tiene que resolver el que reciba: pasar `-p PCL` en crudo mandaba
  // `project_id=PCL` a la API, y leer `opts.project` a pelo se saltaba
  // PLANE_PROJECT y ensanchaba la búsqueda al workspace entero sin avisar.
  const projectId = await resolveOptionalProject(opts, config, client);

  const results = await client.workItems.search({
    query,
    workspaceSearch: opts.workspaceSearch,
    projectId,
    limit: opts.limit,
  });

  const columns: TableColumn[] = [
    { key: "identifier", label: "ID", width: 12 },
    { key: "name", label: "Name", width: 50 },
    { key: "project__identifier", label: "Project", width: 12 },
  ];

  // Unlike the other work-item tables, this one needs no extra request: the
  // search endpoint already returns `project__identifier` on every row. And it
  // is where a bare number hurts most — search is workspace-level, so its
  // results mix projects.
  const rows = results.map((row) => ({
    ...row,
    identifier:
      row.project__identifier !== undefined
        ? `${String(row.project__identifier)}-${String(row.sequence_id)}`
        : String(row.sequence_id ?? ""),
  }));

  formatOutput(opts.json ? results : rows, opts, columns);
  warnIfEmpty(results.length, {
    workspace: resolveWorkspaceForDisplay(config),
    project: projectId ?? "(workspace-wide)",
  });
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
  /** Assignee references (display name, email or UUID), resolved before sending. */
  assignee?: string | string[];
  module?: string;
  json?: boolean;
}

export async function handleWorkItemsCreate(
  opts: CreateWorkItemsOpts,
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const projectId = await resolveProject(opts, config, client);

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

  // Both flags write the same field, so accepting both would silently drop one
  // set of assignees — the kind of half-applied write this CLI warns about
  // elsewhere. Refuse instead.
  if (opts.assignees && opts.assignee) {
    throw new UsageError("Use either --assignee (names, emails or UUIDs) or --assignees (raw UUIDs), not both.");
  }

  if (opts.assignees) {
    input.assignees = parseCSV(opts.assignees);
  }

  if (opts.assignee) {
    input.assignees = await resolveAssignees(client, projectId, parseRefList(opts.assignee));
  }

  const item = await client.workItems.create(projectId, input);
  warnIfAssigneesDropped(input.assignees, item);

  // 10) El work item YA existe aquí. Si la asociación al módulo falla, el error
  // subía antes de imprimirlo y su id se perdía: el usuario creía que no se
  // había creado nada, repetía el comando y acababa con un duplicado.
  if (opts.module) {
    try {
      await client.modules.addWorkItems(projectId, opts.module, [item.id]);
    } catch (err) {
      formatOutput(item, { json: opts.json });
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Work item ${item.id} WAS created; only adding it to module ${opts.module} failed (${reason}). Do not re-run create — add it with: planec modules add-work-items ${opts.module} --work-items ${item.id}`,
        { cause: err },
      );
    }
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
  /** Assignee references (display name, email or UUID). Replaces the current set. */
  assignee?: string | string[];
  json?: boolean;
}

export async function handleWorkItemsUpdate(
  id: string,
  opts: UpdateWorkItemsOpts,
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const projectId = await resolveProject(opts, config, client);

  const input: UpdateWorkItemInput = {};

  if (opts.name !== undefined) input.name = opts.name;
  if (opts.priority !== undefined) input.priority = opts.priority as Priority;
  if (opts.state !== undefined) input.state = opts.state;
  const descriptionHtml = resolveHtmlOption(
    opts.descriptionHtml,
    opts.descriptionHtmlFile,
  );
  if (descriptionHtml !== undefined) input.description_html = descriptionHtml;
  // Plane replaces the whole set rather than merging, so this both assigns and
  // unassigns. To clear every assignee, pass an empty value (`--assignee ""`):
  // commander rejects the flag with no value at all (variadic with a required
  // argument), and `parseRefList` drops the empty string, leaving `[]`.
  if (opts.assignee !== undefined) {
    input.assignees = await resolveAssignees(client, projectId, parseRefList(opts.assignee));
  }

  // A PATCH with nothing in it still counts as an edit: Plane answers 200 and
  // moves updated_at/updated_by, so a no-op command rewrites the audit trail of
  // a work item nobody actually changed.
  if (Object.keys(input).length === 0) {
    throw new UsageError(
      "Nothing to update. Pass at least one of --name, --priority, --state, --assignee or --description-html.",
    );
  }

  const workItemId = await resolveWorkItemId(client, id, projectId);
  const item = await client.workItems.update(projectId, workItemId, input);
  warnIfAssigneesDropped(input.assignees, item);
  formatOutput(item, { json: opts.json });
}

export async function handleWorkItemsActivities(
  id: string,
  opts: { project?: string; json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const projectId = await resolveProject(opts, config, client);

  const workItemId = await resolveWorkItemId(client, id, projectId);
  const page = await client.workItems.activities.list(projectId, workItemId);
  warnIfTruncated(page.items.length, page.hasNext, page.total);

  const columns: TableColumn[] = [
    { key: "created", label: "Created", width: 16 },
    { key: "verb", label: "Verb", width: 10 },
    { key: "field", label: "Field", width: 18 },
    { key: "change", label: "Change", width: 40 },
  ];

  const rows = page.items.map((activity) => ({
    ...activity,
    created: formatTimestamp(activity.created_at),
    change: [activity.old_value, activity.new_value]
      .map((v) => (typeof v === "string" ? v : ""))
      .filter(Boolean)
      .join(" → "),
  }));

  formatOutput(opts.json ? page.items : rows, opts, columns);
}

// ── Comments ──

export async function handleCommentsList(
  workItemId: string,
  opts: { project?: string; json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const projectId = await resolveProject(opts, config, client);

  const resolvedId = await resolveWorkItemId(client, workItemId, projectId);
  const comments = await client.workItems.comments.list(projectId, resolvedId);

  // The old table was an id and a truncated ISO date: no author, no text, and
  // three comments from the same minute looked identical. The point of listing
  // comments is reading them.
  const columns: TableColumn[] = [
    { key: "created", label: "Created", width: 16 },
    { key: "author", label: "Author", width: 14 },
    { key: "comment", label: "Comment", width: 60 },
    { key: "id", label: "ID", width: 36 },
  ];

  const rows = comments.map((comment) => ({
    ...comment,
    created: formatTimestamp(comment.created_at),
    author: authorOf(comment),
    comment: toPlainText(comment.comment_html),
  }));

  formatOutput(opts.json ? comments : rows, opts, columns);
}

export async function handleCommentsCreate(
  workItemId: string,
  commentHtml: string,
  opts: { project?: string; json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const projectId = await resolveProject(opts, config, client);

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
  const projectId = await resolveProject(opts, config, client);

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
  opts: { project?: string; yes?: boolean; json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const projectId = await resolveProject(opts, config, client);

  const resolvedId = await resolveWorkItemId(client, workItemId, projectId);

  // Every other destructive command asks; these two were the exceptions, and a
  // comment is not recoverable from the API either.
  if (!opts.yes) {
    const ok = await confirmAction(`Delete comment ${commentId}? This cannot be undone.`);
    if (!ok) throw new AbortedError();
  }

  await client.workItems.comments.delete(projectId, resolvedId, commentId);
  reportAction(opts, `Comment ${commentId} deleted`, { deleted: commentId });
}

/**
 * Says so when Plane accepted an assignment and stored none of it.
 *
 * The API answers `200` with `assignees: []` for a user who is not an active
 * member of the project — the flagship example of the silent discard this
 * client exists to catch. `resolveAssignees` warns *before* the write, but only
 * for `--assignee`, and it stands down entirely when it cannot read the
 * membership; `--assignees <uuid>` skips it altogether. The response is the
 * definitive evidence and it was going unread.
 */
function warnIfAssigneesDropped(requested: string[] | undefined, item: WorkItem): void {
  if (!requested || requested.length === 0) return;
  const stored = Array.isArray(item.assignees) ? item.assignees.map((a) => (typeof a === "string" ? a : String((a as { id?: unknown }).id ?? ""))) : [];
  const missing = requested.filter((id) => !stored.includes(id));
  if (missing.length === 0) return;
  console.error(
    `Warning: Plane accepted the request but did not store ${missing.length} of ${requested.length} assignee(s) (${missing.join(", ")}). ` +
      "It answers 200 and drops assignees who are not active members of the project — check with: planec projects members list",
  );
}

// ── Work item delete ──

export async function handleWorkItemsDelete(
  id: string,
  opts: { project?: string; yes?: boolean; json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const projectId = await resolveProject(opts, config, client);

  const workItemId = await resolveWorkItemId(client, id, projectId);

  // Deleting a work item is not undoable through the API, so it asks — the same
  // bar `modules delete` and `cycles delete` already set. Without this command
  // the client could cascade-delete a whole project but not remove one item,
  // which is why test projects accumulate hundreds of throwaway work items.
  if (!opts.yes) {
    const ok = await confirmAction(`Delete work item ${id}? This cannot be undone.`);
    if (!ok) throw new AbortedError();
  }

  await client.workItems.delete(projectId, workItemId);
  reportAction(opts, `Deleted work item ${id}`, { deleted: workItemId });
}

// ── Links ──

export async function handleLinksCreate(
  workItemId: string,
  opts: { project?: string; url: string; title?: string; json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const projectId = await resolveProject(opts, config, client);

  const resolvedId = await resolveWorkItemId(client, workItemId, projectId);
  const link = await client.workItems.links.create(projectId, resolvedId, {
    url: opts.url,
    title: opts.title,
  });

  formatOutput(link, { json: opts.json });
}

export async function handleLinksList(
  workItemId: string,
  opts: { project?: string; json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const projectId = await resolveProject(opts, config, client);

  const resolvedId = await resolveWorkItemId(client, workItemId, projectId);
  const page = await client.workItems.links.list(projectId, resolvedId);

  const columns: TableColumn[] = [
    { key: "id", label: "ID", width: 36 },
    { key: "title", label: "Title", width: 30 },
    { key: "url", label: "URL", width: 50 },
  ];

  formatOutput(page.items, opts, columns);
  warnIfTruncated(page.items.length, page.hasNext, page.total);
}

export async function handleLinksUpdate(
  workItemId: string,
  linkId: string,
  opts: { project?: string; url?: string; title?: string; json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const projectId = await resolveProject(opts, config, client);

  if (opts.url === undefined && opts.title === undefined) {
    throw new UsageError("Nothing to update. Pass --url and/or --title.");
  }

  const resolvedId = await resolveWorkItemId(client, workItemId, projectId);
  const existing = await client.workItems.links.get(projectId, resolvedId, linkId);
  if (existing === null) throw new NotFoundError(`Link not found: ${linkId}`);

  const link = await client.workItems.links.update(projectId, resolvedId, linkId, {
    // The API replaces rather than merges, so a partial update has to carry the
    // current value of whatever it is not changing.
    url: opts.url ?? existing.url,
    title: opts.title ?? existing.title,
  });

  formatOutput(link, { json: opts.json });
}

export async function handleLinksDelete(
  workItemId: string,
  linkId: string,
  opts: { project?: string; yes?: boolean; json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const projectId = await resolveProject(opts, config, client);

  const resolvedId = await resolveWorkItemId(client, workItemId, projectId);

  // Confirma como los otros siete borrados. Se quedó fuera al arreglar
  // `comments delete` y `attachments delete`, que es la cuarta vez hoy que algo
  // se arregla en dos de tres hermanos: cuando toques una familia, lista sus
  // miembros primero. (`labels delete` sí va sin preguntar, y es deliberado:
  // una label no contiene nada y la basura acumulada pesa a favor.)
  if (!opts.yes) {
    const ok = await confirmAction(`Delete link ${linkId}? This cannot be undone.`);
    if (!ok) throw new AbortedError();
  }

  await client.workItems.links.delete(projectId, resolvedId, linkId);
  reportAction(opts, `Deleted link ${linkId}`, { deleted: linkId });
}

// ── Relations ──

export async function handleRelationsList(
  workItemId: string,
  opts: { project?: string; json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const projectId = await resolveProject(opts, config, client);

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
  const projectId = await resolveProject(opts, config, client);

  const resolvedId = await resolveWorkItemId(client, workItemId, projectId);
  const issues = await resolveWorkItemIds(
    client,
    parseRefList(opts.issues),
    projectId,
  );

  // Plane accepts a work item related to itself with a 200 and stores it —
  // `PROJ-1 blocking PROJ-1` ends up listed as blocked_by itself. Since v1 has
  // no way to delete a relation, that nonsense is permanent from here.
  if (issues.includes(resolvedId)) {
    throw new UsageError(
      `Cannot relate ${workItemId} to itself. Plane would accept it and there is no way to undo it from the API.`,
    );
  }

  // Relations are create-only in v1: DELETE on the collection answers 405 and
  // there is no detail route. Worth saying before the write, not after.
  console.error(
    "Note: API v1 cannot delete relations (405, no detail route). A wrong one can only be removed in the Plane UI.",
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
