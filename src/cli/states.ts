import { loadConfig, type Config } from "./config.js";
import {
  buildClient,
  formatOutput,
  resolveWorkspaceForDisplay,
  warnIfEmpty,
  type HandlerDeps,
  type TableColumn,
} from "./shared.js";

interface ListOptions {
  project?: string;
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

const STATES_COLUMNS: TableColumn[] = [
  { key: "id", label: "ID", width: 36 },
  { key: "name", label: "Name", width: 20 },
  { key: "group", label: "Group", width: 12 },
  { key: "color", label: "Color", width: 8 },
];

export async function handleStatesList(
  opts: ListOptions,
  deps?: HandlerDeps,
): Promise<void> {
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const client = resolveClient(deps);
  const projectId = resolveProject(opts, config);

  const states = await client.states.list(projectId);

  formatOutput(states, { json: opts.json }, STATES_COLUMNS);
  warnIfEmpty(states.length, {
    workspace: resolveWorkspaceForDisplay(config),
    project: projectId,
  });
}
