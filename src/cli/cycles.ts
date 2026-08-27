import type {
  CreateCycleInput,
  UpdateCycleInput,
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

const CYCLES_COLUMNS: TableColumn[] = [
  { key: "id", label: "ID", width: 36 },
  { key: "name", label: "Name", width: 30 },
  { key: "start_date", label: "Start", width: 10 },
  { key: "end_date", label: "End", width: 10 },
];

function resolveClient(deps?: HandlerDeps) {
  if (deps?.client) return deps.client;
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  return buildClient(config);
}

// ── Cycles ──

export async function handleCyclesList(
  opts: { project?: string; json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const projectId = await resolveProject(opts, config, client);

  const cycles = await client.cycles.list(projectId);

  // Las fechas llegan como ISO completo (`2026-08-27T22:52:10.265467+02:00`) y
  // la columna mide 10: sin formatear salía `2026-08-2…`, cortada justo por
  // donde se distingue una fecha de otra.
  const rows = cycles.map((item) => ({
    ...item,
    start_date: formatDate(item.start_date),
    end_date: formatDate(item.end_date),
  }));

  formatOutput(opts.json ? cycles : rows, opts, CYCLES_COLUMNS);
  warnIfEmpty(cycles.length, {
    workspace: resolveWorkspaceForDisplay(config),
    project: projectId,
  });
}

export async function handleCyclesGet(
  id: string,
  opts: { project?: string; json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const projectId = await resolveProject(opts, config, client);

  const cycle = await client.cycles.get(projectId, id);
  if (cycle === null) throw new NotFoundError(`Cycle not found: ${id}`);

  formatOutput(cycle, opts);
}

export async function handleCyclesCreate(
  opts: {
    project?: string;
    name: string;
    description?: string;
    startDate?: string;
    endDate?: string;
    json?: boolean;
  },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const projectId = await resolveProject(opts, config, client);

  const input: CreateCycleInput = {
    name: opts.name,
    description: opts.description,
    start_date: opts.startDate,
    end_date: opts.endDate,
  };

  const cycle = await client.cycles.create(projectId, input);
  formatOutput(cycle, { json: opts.json });
}

export async function handleCyclesUpdate(
  id: string,
  opts: {
    project?: string;
    name?: string;
    description?: string;
    startDate?: string;
    endDate?: string;
    json?: boolean;
  },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const projectId = await resolveProject(opts, config, client);

  const input: UpdateCycleInput = {};

  if (opts.name !== undefined) input.name = opts.name;
  if (opts.description !== undefined) input.description = opts.description;
  if (opts.startDate !== undefined) input.start_date = opts.startDate;
  if (opts.endDate !== undefined) input.end_date = opts.endDate;

  // Same empty-PATCH problem as `work-items update`: Plane answers 200 and moves
  // updated_at/updated_by, so a no-op command rewrites the audit trail. Fixing
  // it in one of the three siblings and leaving two is how the listAll() bug
  // stayed latent for four versions.
  if (Object.keys(input).length === 0) {
    throw new UsageError("Nothing to update. Pass at least one of --name, --description, --start-date or --end-date.");
  }

  const cycle = await client.cycles.update(projectId, id, input);
  formatOutput(cycle, { json: opts.json });
}

export async function handleCyclesArchive(
  id: string,
  opts: { project?: string; json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const projectId = await resolveProject(opts, config, client);

  await client.cycles.archive(projectId, id);
  reportAction(opts, `Cycle ${id} archived`, { archived: id });
}

export async function handleCyclesTransfer(
  fromId: string,
  toId: string,
  opts: { project?: string; json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const projectId = await resolveProject(opts, config, client);

  await client.cycles.transfer(projectId, fromId, toId);
  reportAction(opts, `Transferred work items from ${fromId} to ${toId}`, {
    from: fromId,
    to: toId,
  });
}

export async function handleCyclesWorkItems(
  id: string,
  opts: { project?: string; json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const projectId = await resolveProject(opts, config, client);

  const page = await client.cycles.workItems(projectId, id);
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

export async function handleCyclesAddWorkItems(
  cycleId: string,
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

  // Plane allows a work item in exactly one cycle, so adding it here removes it
  // from whichever cycle it was in — and says nothing about it. Reporting only
  // the half that was asked for is how a work item goes missing from a sprint
  // nobody touched on purpose.
  console.error(
    `Note: a work item belongs to one cycle at a time, so this removes ${
      workItemIds.length === 1 ? "it" : "them"
    } from any cycle ${workItemIds.length === 1 ? "it was" : "they were"} in.`,
  );

  await client.cycles.addWorkItems(projectId, cycleId, workItemIds);
  reportAction(opts, `Added ${workItemIds.length} work item(s) to cycle ${cycleId}`, {
    cycle: cycleId,
    added: workItemIds,
  });
}

export async function handleCyclesRemoveWorkItem(
  cycleId: string,
  workItemId: string,
  opts: { project?: string; json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const projectId = await resolveProject(opts, config, client);

  const resolvedId = await resolveWorkItemId(client, workItemId, projectId);
  await client.cycles.removeWorkItem(projectId, cycleId, resolvedId);
  reportAction(opts, `Removed work item ${workItemId} from cycle ${cycleId}`, {
    cycle: cycleId,
    removed: resolvedId,
  });
}

export async function handleCyclesDelete(
  id: string,
  opts: { project?: string; yes?: boolean; json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const projectId = await resolveProject(opts, config, client);

  if (!opts.yes) {
    const ok = await confirmAction(`Delete cycle ${id}? This cannot be undone.`);
    if (!ok) throw new AbortedError();
  }

  await client.cycles.delete(projectId, id);
  reportAction(opts, `Deleted cycle ${id}`, { deleted: id });
}
