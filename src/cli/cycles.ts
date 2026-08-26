import type {
  CreateCycleInput,
  UpdateCycleInput,
} from "../types.js";
import { loadConfig, type Config } from "./config.js";
import {
  buildClient,
  confirmAction,
  formatOutput,
  parseRefList,
  resolveProjectFromOpts as resolveProject,
  resolveWorkItemId,
  resolveWorkItemIds,
  resolveWorkspaceForDisplay,
  warnIfEmpty,
  type HandlerDeps,
  type TableColumn,
} from "./shared.js";

const CYCLES_COLUMNS: TableColumn[] = [
  { key: "id", label: "ID", width: 36 },
  { key: "name", label: "Name", width: 30 },
  { key: "start_date", label: "Start", width: 12 },
  { key: "end_date", label: "End", width: 12 },
];

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

// ── Cycles ──

export async function handleCyclesList(
  opts: { project?: string; json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const projectId = await resolveProject(opts, config, client);

  const cycles = await client.cycles.list(projectId);

  formatOutput(cycles, opts, CYCLES_COLUMNS);
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

  const cycle = await client.cycles.update(projectId, id, input);
  formatOutput(cycle, { json: opts.json });
}

export async function handleCyclesArchive(
  id: string,
  opts: { project?: string },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const projectId = await resolveProject(opts, config, client);

  await client.cycles.archive(projectId, id);
  console.log(`Cycle ${id} archived`);
}

export async function handleCyclesTransfer(
  fromId: string,
  toId: string,
  opts: { project?: string },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const projectId = await resolveProject(opts, config, client);

  await client.cycles.transfer(projectId, fromId, toId);
  console.log(`Transferred work items from ${fromId} to ${toId}`);
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

  formatOutput(page.items, opts, WORK_ITEMS_COLUMNS);
}

export async function handleCyclesAddWorkItems(
  cycleId: string,
  workItems: string | string[],
  opts: { project?: string },
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

  await client.cycles.addWorkItems(projectId, cycleId, workItemIds);
  console.log(`Added ${workItemIds.length} work item(s) to cycle`);
}

export async function handleCyclesRemoveWorkItem(
  cycleId: string,
  workItemId: string,
  opts: { project?: string },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const projectId = await resolveProject(opts, config, client);

  const resolvedId = await resolveWorkItemId(client, workItemId, projectId);
  await client.cycles.removeWorkItem(projectId, cycleId, resolvedId);
  console.log(`Removed work item ${workItemId} from cycle`);
}

export async function handleCyclesDelete(
  id: string,
  opts: { project?: string; yes?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const projectId = await resolveProject(opts, config, client);

  if (!opts.yes) {
    const ok = await confirmAction(`Delete cycle ${id}? This cannot be undone.`);
    if (!ok) {
      console.error("Aborted.");
      return;
    }
  }

  await client.cycles.delete(projectId, id);
  console.log(`Deleted cycle ${id}`);
}
