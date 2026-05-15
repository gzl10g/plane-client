import { loadConfig, type Config } from "./config.js";
import {
  buildClient,
  formatOutput,
  type HandlerDeps,
  type TableColumn,
} from "./shared.js";
import type { CreateIntakeInput, Priority } from "../types.js";

interface ListOptions {
  project?: string;
  json?: boolean;
}

interface CreateOptions {
  project?: string;
  name: string;
  priority?: string;
  descriptionHtml?: string;
  json?: boolean;
}

interface AcceptOptions {
  project?: string;
}

interface DeclineOptions {
  project?: string;
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

const INTAKE_COLUMNS: TableColumn[] = [
  { key: "id", label: "ID", width: 36 },
  { key: "name", label: "Name", width: 30 },
  { key: "status", label: "Status", width: 8 },
];

export async function handleIntakeList(
  opts: ListOptions,
  deps?: HandlerDeps,
): Promise<void> {
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const client = resolveClient(deps);
  const projectId = resolveProject(opts, config);

  const page = await client.intake.list(projectId);

  formatOutput(page.items, { json: opts.json }, INTAKE_COLUMNS);
}

export async function handleIntakeCreate(
  opts: CreateOptions,
  deps?: HandlerDeps,
): Promise<void> {
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const client = resolveClient(deps);
  const projectId = resolveProject(opts, config);

  const input: CreateIntakeInput = {
    name: opts.name,
  };

  if (opts.priority !== undefined) {
    input.priority = opts.priority as Priority | undefined;
  }

  if (opts.descriptionHtml !== undefined) {
    input.description_html = opts.descriptionHtml;
  }

  const issue = await client.intake.create(projectId, input);

  formatOutput(issue, { json: opts.json });
}

export async function handleIntakeAccept(
  id: string,
  opts: AcceptOptions,
  deps?: HandlerDeps,
): Promise<void> {
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const client = resolveClient(deps);
  const projectId = resolveProject(opts, config);

  await client.intake.accept(projectId, id);
  console.log("Intake accepted");
}

export async function handleIntakeDecline(
  id: string,
  opts: DeclineOptions,
  deps?: HandlerDeps,
): Promise<void> {
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const client = resolveClient(deps);
  const projectId = resolveProject(opts, config);

  await client.intake.decline(projectId, id);
  console.log("Intake declined");
}
