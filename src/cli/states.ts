import { loadConfig, type Config } from "./config.js";
import type { CreateStateInput, StateGroup, UpdateStateInput } from "../types.js";
import {
  AbortedError,
  buildClient,
  confirmAction,
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

interface ListOptions {
  project?: string;
  json?: boolean;
}

function resolveClient(deps?: HandlerDeps) {
  if (deps?.client) return deps.client;
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  return buildClient(config);
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
  const projectId = await resolveProject(opts, config, client);

  const states = await client.states.list(projectId);

  formatOutput(states, { json: opts.json }, STATES_COLUMNS);
  warnIfEmpty(states.length, {
    workspace: resolveWorkspaceForDisplay(config),
    project: projectId,
  });
}

/** The five workflow groups Plane accepts. */
const STATE_GROUPS: StateGroup[] = ["backlog", "unstarted", "started", "completed", "cancelled"];

export async function handleStatesGet(
  id: string,
  opts: { project?: string; json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const client = resolveClient(deps);
  const projectId = await resolveProject(opts, config, client);

  const state = await client.states.get(projectId, id);
  if (state === null) throw new NotFoundError(`State not found: ${id}`);

  formatOutput(state, { json: opts.json });
}

/**
 * Creates a state.
 *
 * `--group` is required here even though the API treats it as optional, and
 * that is deliberate. Plane accepts a state with no group and files it under
 * **backlog** without a word — so `states create --name "In review"` silently
 * produces a review state that every count, filter and report treats as
 * backlog. Where the API degrades in silence, the client asks.
 */
export async function handleStatesCreate(
  opts: { project?: string; name: string; group: string; color?: string; description?: string; json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const client = resolveClient(deps);
  const projectId = await resolveProject(opts, config, client);

  if (!STATE_GROUPS.includes(opts.group as StateGroup)) {
    throw new UsageError(
      `Invalid --group ${opts.group}. One of: ${STATE_GROUPS.join(", ")}. ` +
        "It decides how every count, filter and report treats work in this state.",
    );
  }

  const input: CreateStateInput = {
    name: opts.name,
    // Required by the API (400 {"color":["This field is required."]} without
    // it), so the flag defaults rather than making everyone pick a colour.
    color: parseHexColor(opts.color) ?? "#6b7280",
    group: opts.group as StateGroup,
  };
  if (opts.description !== undefined) input.description = opts.description;

  const state = await client.states.create(projectId, input);
  formatOutput(state, { json: opts.json });
}

export async function handleStatesUpdate(
  id: string,
  opts: { project?: string; name?: string; group?: string; color?: string; description?: string; json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const client = resolveClient(deps);
  const projectId = await resolveProject(opts, config, client);

  const input: UpdateStateInput = {};
  if (opts.name !== undefined) input.name = opts.name;
  if (opts.description !== undefined) input.description = opts.description;
  const color = parseHexColor(opts.color);
  if (color !== undefined) input.color = color;
  if (opts.group !== undefined) {
    if (!STATE_GROUPS.includes(opts.group as StateGroup)) {
      throw new UsageError(`Invalid --group ${opts.group}. One of: ${STATE_GROUPS.join(", ")}`);
    }
    input.group = opts.group as StateGroup;
  }

  if (Object.keys(input).length === 0) {
    throw new UsageError("Nothing to update. Pass at least one of --name, --group, --color or --description.");
  }

  const state = await client.states.update(projectId, id, input);
  formatOutput(state, { json: opts.json });
}

export async function handleStatesDelete(
  id: string,
  opts: { project?: string; yes?: boolean; json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const client = resolveClient(deps);
  const projectId = await resolveProject(opts, config, client);

  // Deleting a state is not the same as deleting a label: work items live in
  // states, so this asks first.
  if (!opts.yes) {
    const ok = await confirmAction(
      `Delete state ${id}? Work items sitting in it have to go somewhere else.`,
    );
    if (!ok) throw new AbortedError();
  }

  await client.states.delete(projectId, id);
  reportAction(opts, `Deleted state ${id}`, { deleted: id });
}
