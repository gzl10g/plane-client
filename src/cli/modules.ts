import type {
  CreateModuleInput,
  UpdateModuleInput,
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

const MODULES_COLUMNS: TableColumn[] = [
  { key: "id", label: "ID", width: 36 },
  { key: "name", label: "Name", width: 30 },
  { key: "status", label: "Status", width: 12 },
  { key: "start_date", label: "Start", width: 12 },
  { key: "target_date", label: "Target", width: 12 },
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


// ── Modules ──

export async function handleModulesList(
  opts: { project?: string; json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const projectId = resolveProject(opts, config);

  const modules = await client.modules.list(projectId);

  formatOutput(modules, opts, MODULES_COLUMNS);
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
  const projectId = resolveProject(opts, config);

  const module = await client.modules.get(projectId, id);

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
  const projectId = resolveProject(opts, config);

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
  const projectId = resolveProject(opts, config);

  const input: UpdateModuleInput = {};

  if (opts.name !== undefined) input.name = opts.name;
  if (opts.description !== undefined) input.description = opts.description;
  if (opts.status !== undefined) input.status = opts.status;
  if (opts.startDate !== undefined) input.start_date = opts.startDate;
  if (opts.targetDate !== undefined) input.target_date = opts.targetDate;

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
  const projectId = resolveProject(opts, config);

  const page = await client.modules.workItems(projectId, id);

  formatOutput(page.items, opts, WORK_ITEMS_COLUMNS);
}

export async function handleModulesAddWorkItems(
  moduleId: string,
  workItems: string | string[],
  opts: { project?: string },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const projectId = resolveProject(opts, config);

  const workItemIds = await resolveWorkItemIds(
    client,
    parseRefList(workItems),
    projectId,
  );
  await client.modules.addWorkItems(projectId, moduleId, workItemIds);

  console.log(`Added ${workItemIds.length} work items to module ${moduleId}`);
}

export async function handleModulesRemoveWorkItem(
  moduleId: string,
  workItemId: string,
  opts: { project?: string },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const projectId = resolveProject(opts, config);

  const resolvedId = await resolveWorkItemId(client, workItemId, projectId);
  // Only report success once the DELETE actually completed without throwing —
  // a missing project or a wrong id now surfaces as an error, not a fake "no-op".
  await client.modules.removeWorkItem(projectId, moduleId, resolvedId);

  console.log(`Removed work item ${workItemId} from module ${moduleId}`);
}

export async function handleModulesDelete(
  id: string,
  opts: { project?: string; yes?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const projectId = resolveProject(opts, config);

  if (!opts.yes) {
    const ok = await confirmAction(`Delete module ${id}? This cannot be undone.`);
    if (!ok) {
      console.error("Aborted.");
      return;
    }
  }

  await client.modules.delete(projectId, id);
  console.log(`Deleted module ${id}`);
}
