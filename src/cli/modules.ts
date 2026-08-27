import type {
  CreateModuleInput,
  UpdateModuleInput,
} from "../types.js";
import { loadConfig, type Config } from "./config.js";
import {
  AbortedError,
  buildClient,
  confirmAction,
  formatDate,
  formatOutput,
  NotFoundError,
  parseRefList,
  reportAction,
  resolveProjectFromOpts as resolveProject,
  resolveWorkItemId,
  resolveWorkItemIds,
  resolveWorkspaceForDisplay,
  toWorkItemRows,
  warnIfEmpty,
  warnIfTruncated,
  WORK_ITEM_COLUMNS,
  type HandlerDeps,
  type TableColumn,
  UsageError,
} from "./shared.js";

/** The module statuses Plane accepts. A wrong one is a 400 we can save. */
const MODULE_STATUSES = ["backlog", "planned", "in-progress", "paused", "completed", "cancelled"];

const MODULES_COLUMNS: TableColumn[] = [
  { key: "id", label: "ID", width: 36 },
  { key: "name", label: "Name", width: 30 },
  { key: "status", label: "Status", width: 12 },
  { key: "start_date", label: "Start", width: 10 },
  { key: "target_date", label: "Target", width: 10 },
];

function resolveClient(deps?: HandlerDeps) {
  if (deps?.client) return deps.client;
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  return buildClient(config);
}


// ── Modules ──

export async function handleModulesList(
  opts: { project?: string; json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const projectId = await resolveProject(opts, config, client);

  const modules = await client.modules.list(projectId);

  // Las fechas llegan como ISO completo (`2026-08-27T22:52:10.265467+02:00`) y
  // la columna mide 10: sin formatear salía `2026-08-2…`, cortada justo por
  // donde se distingue una fecha de otra.
  const rows = modules.map((item) => ({
    ...item,
    start_date: formatDate(item.start_date),
    target_date: formatDate(item.target_date),
  }));

  formatOutput(opts.json ? modules : rows, opts, MODULES_COLUMNS);
  warnIfEmpty(modules.length, {
    workspace: resolveWorkspaceForDisplay(config),
    project: projectId,
  });
}

export async function handleModulesGet(
  id: string,
  opts: { project?: string; json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const projectId = await resolveProject(opts, config, client);

  const module = await client.modules.get(projectId, id);
  if (module === null) throw new NotFoundError(`Module not found: ${id}`);

  formatOutput(module, opts);
}

export async function handleModulesCreate(
  opts: {
    project?: string;
    name: string;
    description?: string;
    startDate?: string;
    targetDate?: string;
    json?: boolean;
  },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const projectId = await resolveProject(opts, config, client);

  const input: CreateModuleInput = {
    name: opts.name,
    description: opts.description,
    start_date: opts.startDate,
    target_date: opts.targetDate,
  };

  const module = await client.modules.create(projectId, input);
  formatOutput(module, { json: opts.json });
}

export async function handleModulesUpdate(
  id: string,
  opts: {
    project?: string;
    name?: string;
    description?: string;
    status?: string;
    startDate?: string;
    targetDate?: string;
    json?: boolean;
  },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const projectId = await resolveProject(opts, config, client);

  const input: UpdateModuleInput = {};

  if (opts.name !== undefined) input.name = opts.name;
  if (opts.description !== undefined) input.description = opts.description;
  if (opts.status !== undefined) {
    if (!MODULE_STATUSES.includes(opts.status)) {
      throw new UsageError(`Invalid --status ${opts.status}. One of: ${MODULE_STATUSES.join(", ")}`);
    }
    input.status = opts.status;
  }
  if (opts.startDate !== undefined) input.start_date = opts.startDate;
  if (opts.targetDate !== undefined) input.target_date = opts.targetDate;

  // Same empty-PATCH problem as `work-items update`: Plane answers 200 and moves
  // updated_at/updated_by, so a no-op command rewrites the audit trail. Fixing
  // it in one of the three siblings and leaving two is how the listAll() bug
  // stayed latent for four versions.
  if (Object.keys(input).length === 0) {
    throw new UsageError("Nothing to update. Pass at least one of --name, --description, --status, --start-date or --target-date.");
  }

  const module = await client.modules.update(projectId, id, input);
  formatOutput(module, { json: opts.json });
}

export async function handleModulesWorkItems(
  id: string,
  opts: { project?: string; json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const projectId = await resolveProject(opts, config, client);

  const page = await client.modules.workItems(projectId, id);
  warnIfTruncated(page.items.length, page.hasNext, page.total);

  // --json keeps the raw API objects; only the table gets the readable id and
  // the resolved state name — these endpoints return `state` as a bare UUID.
  formatOutput(
    opts.json
      ? page.items
      : await toWorkItemRows(client, projectId, page.items as unknown as Record<string, unknown>[]),
    opts,
    WORK_ITEM_COLUMNS,
  );
}

export async function handleModulesAddWorkItems(
  moduleId: string,
  workItems: string | string[],
  opts: { project?: string; json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const projectId = await resolveProject(opts, config, client);

  const workItemIds = await resolveWorkItemIds(
    client,
    parseRefList(workItems),
    projectId,
  );
  await client.modules.addWorkItems(projectId, moduleId, workItemIds);

  reportAction(opts, `Added ${workItemIds.length} work item(s) to module ${moduleId}`, {
    module: moduleId,
    added: workItemIds,
  });
}

export async function handleModulesRemoveWorkItem(
  moduleId: string,
  workItemId: string,
  opts: { project?: string; json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const projectId = await resolveProject(opts, config, client);

  const resolvedId = await resolveWorkItemId(client, workItemId, projectId);
  // Only report success once the DELETE actually completed without throwing —
  // a missing project or a wrong id now surfaces as an error, not a fake "no-op".
  await client.modules.removeWorkItem(projectId, moduleId, resolvedId);

  reportAction(opts, `Removed work item ${workItemId} from module ${moduleId}`, {
    module: moduleId,
    removed: resolvedId,
  });
}

export async function handleModulesDelete(
  id: string,
  opts: { project?: string; yes?: boolean; json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const projectId = await resolveProject(opts, config, client);

  if (!opts.yes) {
    const ok = await confirmAction(`Delete module ${id}? This cannot be undone.`);
    if (!ok) throw new AbortedError();
  }

  await client.modules.delete(projectId, id);
  reportAction(opts, `Deleted module ${id}`, { deleted: id });
}
