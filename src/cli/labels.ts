import { loadConfig, type Config } from "./config.js";
import {
  buildClient,
  formatOutput,
  resolveWorkspaceForDisplay,
  warnIfEmpty,
  type HandlerDeps,
  type TableColumn,
} from "./shared.js";
import type { CreateLabelInput } from "../types.js";

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
  const projectId = resolveProject(opts, config);

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
  const projectId = resolveProject(opts, config);

  const input: CreateLabelInput = {
    name: opts.name,
  };

  if (opts.color !== undefined) {
    input.color = opts.color;
  }

  const label = await client.labels.create(projectId, input);

  formatOutput(label, { json: opts.json });
}
