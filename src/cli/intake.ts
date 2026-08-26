import { loadConfig, type Config } from "./config.js";
import {
  buildClient,
  formatOutput,
  resolveHtmlOption,
  resolveProjectFromOpts as resolveProject,
  resolveWorkspaceForDisplay,
  warnIfEmpty,
  type HandlerDeps,
  type TableColumn,
} from "./shared.js";
import type { CreateIntakeInput, IntakeIssue, Priority } from "../types.js";

interface ListOptions {
  project?: string;
  json?: boolean;
}

interface CreateOptions {
  project?: string;
  name: string;
  priority?: string;
  descriptionHtml?: string;
  descriptionHtmlFile?: string;
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

const INTAKE_COLUMNS: TableColumn[] = [
  { key: "id", label: "ID", width: 36 },
  { key: "name", label: "Name", width: 30 },
  { key: "status", label: "Status", width: 14 },
];

/**
 * Intake status codes. Verified live against Plane 1.4.1: `-2` on a freshly
 * created intake issue, `-1` after `intake decline`, `1` after `intake accept`.
 * `0` and `2` are present in real data (set through the UI, which is the only
 * way to reach them — the API v1 exposes no snooze or mark-duplicate endpoint),
 * so their labels follow Plane's own wording rather than a round-trip of ours.
 * Unknown codes fall through to the bare number instead of being mislabelled.
 */
const INTAKE_STATUS: Record<number, string> = {
  [-2]: "pending",
  [-1]: "declined",
  0: "snoozed",
  1: "accepted",
  2: "duplicate",
};

/**
 * Flattens an intake issue for tabular output. The list endpoint carries the
 * work item's title inside `issue_detail`, not at the root, so the plain table
 * used to print an empty Name column next to a raw `-2` — a listing that looked
 * broken even though the call had succeeded. The status keeps its numeric code
 * alongside the label: the codes are what the API speaks, and showing both means
 * a relabelled or new code is visible instead of silently mistranslated.
 */
function toRow(item: IntakeIssue): Record<string, unknown> {
  const detail = item.issue_detail as { name?: string } | undefined;
  const label = INTAKE_STATUS[item.status];
  return {
    id: item.id,
    name: item.name ?? detail?.name ?? "",
    status: label !== undefined ? `${label} (${item.status})` : String(item.status),
  };
}

export async function handleIntakeList(
  opts: ListOptions,
  deps?: HandlerDeps,
): Promise<void> {
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const client = resolveClient(deps);
  const projectId = await resolveProject(opts, config, client);

  const page = await client.intake.list(projectId);

  // --json keeps the raw API objects (issue_detail and all); only the table is flattened.
  formatOutput(
    opts.json ? page.items : page.items.map(toRow),
    { json: opts.json },
    INTAKE_COLUMNS,
  );
  warnIfEmpty(page.items.length, {
    workspace: resolveWorkspaceForDisplay(config),
    project: projectId,
  });
}

export async function handleIntakeCreate(
  opts: CreateOptions,
  deps?: HandlerDeps,
): Promise<void> {
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const client = resolveClient(deps);
  const projectId = await resolveProject(opts, config, client);

  const input: CreateIntakeInput = {
    name: opts.name,
  };

  if (opts.priority !== undefined) {
    input.priority = opts.priority as Priority | undefined;
  }

  const descriptionHtml = resolveHtmlOption(
    opts.descriptionHtml,
    opts.descriptionHtmlFile,
  );
  if (descriptionHtml !== undefined) {
    input.description_html = descriptionHtml;
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
  const projectId = await resolveProject(opts, config, client);

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
  const projectId = await resolveProject(opts, config, client);

  await client.intake.decline(projectId, id);
  console.log("Intake declined");
}
