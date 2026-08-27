import { loadConfig, type Config } from "./config.js";
import {
  buildClient,
  formatOutput,
  NotFoundError,
  parseHexColor,
  reportAction,
  resolveProjectFromOpts as resolveProject,
  resolveWorkspaceForDisplay,
  warnIfEmpty,
  type HandlerDeps,
  type TableColumn,
  UsageError,
} from "./shared.js";
import type { CreateLabelInput, UpdateLabelInput } from "../types.js";

interface ListOptions {
  project?: string;
  json?: boolean;
}

interface CreateOptions {
  project?: string;
  name: string;
  color?: string;
  json?: boolean;
}

function resolveClient(deps?: HandlerDeps) {
  if (deps?.client) return deps.client;
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  return buildClient(config);
}

const LABELS_COLUMNS: TableColumn[] = [
  { key: "id", label: "ID", width: 36 },
  { key: "name", label: "Name", width: 20 },
  { key: "color", label: "Color", width: 8 },
];

export async function handleLabelsList(
  opts: ListOptions,
  deps?: HandlerDeps,
): Promise<void> {
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const client = resolveClient(deps);
  const projectId = await resolveProject(opts, config, client);

  const labels = await client.labels.list(projectId);

  formatOutput(labels, { json: opts.json }, LABELS_COLUMNS);
  warnIfEmpty(labels.length, {
    workspace: resolveWorkspaceForDisplay(config),
    project: projectId,
  });
}

export async function handleLabelsCreate(
  opts: CreateOptions,
  deps?: HandlerDeps,
): Promise<void> {
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const client = resolveClient(deps);
  const projectId = await resolveProject(opts, config, client);

  const input: CreateLabelInput = {
    name: opts.name,
  };

  const color = parseHexColor(opts.color);
  if (color !== undefined) {
    input.color = color;
  }

  const label = await client.labels.create(projectId, input);

  formatOutput(label, { json: opts.json });
}

export async function handleLabelsGet(
  id: string,
  opts: { project?: string; json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const client = resolveClient(deps);
  const projectId = await resolveProject(opts, config, client);

  const label = await client.labels.get(projectId, id);
  if (label === null) throw new NotFoundError(`Label not found: ${id}`);

  formatOutput(label, { json: opts.json });
}

export async function handleLabelsUpdate(
  id: string,
  opts: { project?: string; name?: string; color?: string; json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const client = resolveClient(deps);
  const projectId = await resolveProject(opts, config, client);

  const input: UpdateLabelInput = {};
  if (opts.name !== undefined) input.name = opts.name;
  const color = parseHexColor(opts.color);
  if (color !== undefined) input.color = color;

  if (Object.keys(input).length === 0) {
    throw new UsageError("Nothing to update. Pass --name and/or --color.");
  }

  const label = await client.labels.update(projectId, id, input);
  formatOutput(label, { json: opts.json });
}

/**
 * Deletes a label.
 *
 * No confirmation prompt: a label carries no content of its own, and its
 * absence is what has been letting throwaway `test-*` labels pile up in shared
 * projects with no way to clear them short of curl.
 */
export async function handleLabelsDelete(
  id: string,
  opts: { project?: string; json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const client = resolveClient(deps);
  const projectId = await resolveProject(opts, config, client);

  await client.labels.delete(projectId, id);
  reportAction(opts, `Deleted label ${id}`, { deleted: id });
}
