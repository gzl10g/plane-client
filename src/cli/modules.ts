import type {
  CreateModuleInput,
  UpdateModuleInput,
} from "../types.js";
import { loadConfig, type Config } from "./config.js";
import {
  buildClient,
  formatOutput,
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

function resolveProject(
  opts: { project?: string },
  config: Config,
): string {
  if (opts.project) return opts.project;
  if (config.project) return config.project;
  throw new Error(
    "No project specified. Use --project <uuid> or run: planec use <uuid>",
  );
}

function parseCSV(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
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
  workItemsCsv: string,
  opts: { project?: string },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const projectId = resolveProject(opts, config);

  const workItemIds = parseCSV(workItemsCsv);
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

  await client.modules.removeWorkItem(projectId, moduleId, workItemId);

  console.log(`Removed work item ${workItemId} from module ${moduleId}`);
}
