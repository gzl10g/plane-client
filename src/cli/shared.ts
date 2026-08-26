import { readFileSync } from "node:fs";
import readline from "node:readline";
import { PlaneClient } from "../client.js";
import { PlaneApiError } from "../error.js";
import type { Config } from "./config.js";
import type { Project } from "../types.js";

export interface HandlerDeps {
  config?: Config;
  client?: PlaneClient;
  homeDir?: string;
}

export interface TableColumn {
  key: string;
  label: string;
  width?: number;
}

export async function runHandler(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    process.exitCode = 0;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${message}`);
    if (err instanceof PlaneApiError) {
      if (err.isAuth) {
        console.error(
          "Hint: 401 Unauthorised — your API key is missing, invalid or expired. Run: planec login --token <key>",
        );
      } else if (err.isPermission) {
        console.error(
          "Hint: 403 Forbidden — your API key lacks permission to modify this resource. It may belong to another user, or the key is read-only.",
        );
      }
    }
    process.exitCode = 1;
  }
  // Do NOT call process.exit() here: when stdout is a pipe (e.g. `| jq`),
  // writes are async-buffered and process.exit() would drop unflushed output,
  // truncating large JSON payloads. Setting exitCode lets Node drain stdout
  // and exit naturally once the event loop is empty.
}

/**
 * A plausible Plane project identifier. The accepted shape was checked against
 * the API (1.4.1): `10TEST` and `A_B` are created fine, `A-B` is rejected with
 * "Project identifier cannot contain special characters" — so alphanumerics and
 * underscore, and a leading digit is legal. The guard only exists to tell a
 * typo'd UUID apart from a prefix worth looking up; anything it lets through is
 * decided by the lookup itself.
 */
const IDENTIFIER_RE = /^[A-Za-z0-9_]+$/;

const PROJECT_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Rejects a project reference that is not a plausible identifier, before any
 * lookup is attempted. Two shapes are worth telling apart in the message: a
 * 32-char hex string is a UUID someone stripped the dashes from, not a prefix,
 * and saying "project not found" for it would send them looking in the wrong
 * place.
 * @throws Error if the reference cannot be a project identifier
 */
export function assertLooksLikeIdentifier(ref: string): void {
  if (/^[0-9a-f]{32}$/i.test(ref)) {
    throw new Error(
      `Invalid project UUID ${ref}: looks like a UUID with the dashes stripped. Use the dashed form.`,
    );
  }
  if (!IDENTIFIER_RE.test(ref)) {
    throw new Error(
      `Invalid project UUID ${ref}: must be a valid UUID or a project identifier (e.g. PCL). Run: planec projects list`,
    );
  }
}

/**
 * Finds a project by its human-readable identifier (`PCL`), case-insensitively.
 * Shared by every command that takes a project reference, so the lookup behaves
 * the same whether it arrives through `-p` or as a positional argument.
 * @returns The project, or null if no project in the workspace carries that prefix
 */
export async function findProjectByIdentifier(
  client: PlaneClient,
  identifier: string,
): Promise<Project | null> {
  const wanted = identifier.toUpperCase();
  for await (const project of client.projects.listAll()) {
    if (project.identifier?.toUpperCase() === wanted) return project;
  }
  return null;
}

/**
 * Single source of truth for resolving a project id from a command's options.
 * Applies the full precedence (flag > PLANE_PROJECT env > config), and accepts
 * either a UUID or the human-readable identifier (`-p PCL`).
 *
 * Taking the identifier is what makes `-p` usable straight from
 * `planec projects list`: before 0.16.0 every command but `projects` demanded a
 * UUID, so the prefix you can actually read had to be translated by hand.
 *
 * A UUID resolves with no request at all. An identifier costs a full project
 * listing (`listAll` walks every page, and the API caps `per_page` at 100), and
 * it pays that on *every* invocation when the identifier lives in the saved
 * config — which is why `planec use` resolves it once and stores the UUID.
 *
 * @param client - Optional client to reuse; one is built from config if omitted
 * @throws Error if no project is set, the value is neither a UUID nor a
 *   plausible identifier, or no project carries that identifier
 */
export async function resolveProjectFromOpts(
  opts: { project?: string },
  config: Config,
  client?: PlaneClient,
): Promise<string> {
  const raw = opts.project ?? process.env.PLANE_PROJECT ?? config.project;

  if (raw === undefined) {
    throw new Error(
      "No project specified. Use --project <uuid|IDENTIFIER>, set PLANE_PROJECT env var, or run: planec use <uuid>",
    );
  }

  if (PROJECT_UUID_RE.test(raw)) return raw;

  assertLooksLikeIdentifier(raw);

  const found = await findProjectByIdentifier(client ?? buildClient(config), raw);
  if (found === null) {
    throw new Error(
      `Project not found: ${raw}. Pass a UUID or an identifier from: planec projects list`,
    );
  }
  return found.id;
}

/**
 * Same resolution as `resolveProjectFromOpts`, but for commands where the
 * project is genuinely optional — `work-items search` runs workspace-wide
 * without one. Returns undefined only when no project was set anywhere; a value
 * that *was* set still has to resolve, so a bad `-p` fails loudly instead of
 * silently widening the search to the whole workspace.
 */
export async function resolveOptionalProjectFromOpts(
  opts: { project?: string },
  config: Config,
  client?: PlaneClient,
): Promise<string | undefined> {
  const raw = opts.project ?? process.env.PLANE_PROJECT ?? config.project;
  if (raw === undefined) return undefined;
  return resolveProjectFromOpts(opts, config, client);
}

/**
 * Resolves a work item reference to its UUID. Accepts a human-readable
 * identifier (`NXI-42`) — resolved via the workspace-level lookup — or a UUID,
 * returned as-is with no extra request. Lets commands that hit UUID-only
 * endpoints (update, comments, relations, module/cycle membership) accept the
 * same `PREFIX-NUMBER` id that `get` accepts.
 * @throws Error if the identifier cannot be found
 */
export async function resolveWorkItemId(
  client: PlaneClient,
  id: string,
  projectId?: string,
): Promise<string> {
  if (!/^[A-Z]+-\d+$/.test(id)) return id;
  const item = await client.workItems.get(id);
  if (item === null) {
    throw new Error(`Work item not found: ${id}`);
  }
  // The identifier lookup is workspace-level, so `NXI-42` resolves even when the
  // command is pointed at another project. The endpoints below are project-scoped
  // and answer 200 with an empty result for a foreign work item, so without this
  // check a wrong -p (or a stale `planec use`) looks like success and writes
  // nothing. Fail loudly instead.
  const itemProject = item.project;
  if (
    projectId !== undefined &&
    typeof itemProject === "string" &&
    itemProject !== projectId
  ) {
    throw new Error(
      `Work item ${id} belongs to project ${itemProject}, but the command targets ${projectId}. ` +
        `Pass the right -p/--project (or run: planec use <uuid>).`,
    );
  }
  return item.id;
}

/**
 * Resolves a list of work item references to UUIDs, accepting the same
 * `PREFIX-NUMBER` identifiers as the single-reference commands. List flags hit
 * UUID-only endpoints that reject an identifier with an opaque
 * `400 Please provide valid detail`, so resolving here is what makes
 * `--issues NXI-42,NXI-43` behave like the positional argument.
 */
export async function resolveWorkItemIds(
  client: PlaneClient,
  ids: string[],
  projectId?: string,
): Promise<string[]> {
  return Promise.all(ids.map((id) => resolveWorkItemId(client, id, projectId)));
}

/**
 * Splits a repeatable/comma-separated CLI list flag into individual references.
 * Accepts both `--flag a,b` and `--flag a b` (variadic) so neither spelling
 * silently drops the entries after the first.
 */
export function parseRefList(value: string | string[]): string[] {
  const parts = Array.isArray(value) ? value : [value];
  return parts
    .flatMap((part) => part.split(","))
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Asks for interactive confirmation on stderr (stdout stays clean for pipes).
 * Returns true only on an explicit yes. Non-interactive callers should skip
 * this via a `--yes` flag.
 */
export async function confirmAction(message: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  try {
    const answer = await new Promise<string>((resolve) => {
      rl.question(`${message} (y/N) `, resolve);
    });
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

/**
 * Resolves description HTML from either the inline flag or a file. A large
 * description passed inline dies with `E2BIG` (argv limit) long before Plane
 * complains — around 100 KB of HTML is enough — so the file form is the only
 * way to send one. Passing both is a mistake worth surfacing, not silently
 * resolving.
 */
export function resolveHtmlOption(
  inline: string | undefined,
  file: string | undefined,
  flagName = "--description-html",
): string | undefined {
  if (inline !== undefined && file !== undefined) {
    throw new Error(`Use either ${flagName} or ${flagName}-file, not both.`);
  }
  if (file === undefined) return inline;
  try {
    return readFileSync(file, "utf-8");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot read ${flagName}-file ${file}: ${message}`, {
      cause: err,
    });
  }
}

export function buildClient(config: Config): PlaneClient {
  if (!config.baseUrl) {
    throw new Error("baseUrl not configured. Run: planec config set baseUrl <value>");
  }
  if (!config.apiKey) {
    throw new Error("apiKey not configured. Run: planec login --token <value>");
  }

  const workspace = process.env.PLANE_WORKSPACE ?? config.workspace;
  if (!workspace) {
    throw new Error(
      "workspace not configured. Use --workspace <slug>, set PLANE_WORKSPACE=<slug>, or run: planec workspace use <slug>",
    );
  }

  return new PlaneClient({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    workspace,
  });
}

/**
 * Resolves the workspace slug that requests will actually use, for display.
 * Mirrors the precedence in buildClient (env over config).
 */
export function resolveWorkspaceForDisplay(config: Config): string | undefined {
  return process.env.PLANE_WORKSPACE ?? config.workspace;
}

/**
 * Emits a one-line stderr note when a list came back empty, echoing the
 * workspace/project context that produced it. A silent empty table can hide a
 * wrong-context bug (e.g. a project that lives in another workspace), so we make
 * the context explicit without polluting stdout (JSON stays clean for pipes).
 */
export function warnIfEmpty(
  count: number,
  ctx: { workspace?: string; project?: string },
): void {
  if (count > 0) return;
  const ws = ctx.workspace ?? "(unset)";
  const project = ctx.project ?? "(unset)";
  console.error(
    `No results. Context: workspace=${ws}, project=${project}. If this is unexpected, check --workspace / -p (project may belong to another workspace).`,
  );
}

export function formatTable(
  rows: Record<string, unknown>[],
  columns: TableColumn[],
): string {
  const widths = columns.map((col) => {
    const dataMax = rows.reduce((max, row) => {
      const val = String(row[col.key] ?? "");
      return Math.max(max, val.length);
    }, 0);
    return col.width ?? Math.max(col.label.length, dataMax);
  });

  const header = columns
    .map((col, i) => col.label.padEnd(widths[i]))
    .join("  ");

  const separator = widths.map((w) => "─".repeat(w)).join("  ");

  const dataRows = rows.map((row) =>
    columns
      .map((col, i) => String(row[col.key] ?? "").padEnd(widths[i]))
      .join("  "),
  );

  return [header, separator, ...dataRows].join("\n");
}

export function formatOutput(
  data: unknown,
  opts: { json?: boolean },
  columns?: TableColumn[],
): void {
  if (opts.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (Array.isArray(data) && columns && columns.length > 0) {
    console.log(formatTable(data as Record<string, unknown>[], columns));
    return;
  }

  // An array of objects without column definitions used to fall through to
  // String(data) and print `[object Object]` — which reads as a failure even
  // though the call succeeded (relations create hit this). Serialise those;
  // arrays of primitives still join readably via String().
  if (
    Array.isArray(data) &&
    data.some((entry) => typeof entry === "object" && entry !== null)
  ) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (typeof data === "object" && data !== null && !Array.isArray(data)) {
    for (const [key, value] of Object.entries(
      data as Record<string, unknown>,
    )) {
      console.log(`${key}: ${String(value ?? "")}`);
    }
    return;
  }

  console.log(String(data));
}
