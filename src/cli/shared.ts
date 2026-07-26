import readline from "node:readline";
import { PlaneClient } from "../client.js";
import { PlaneApiError } from "../error.js";
import type { Config } from "./config.js";

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

export function resolveProject(opts: {
  flag?: string;
  env?: string;
  config?: Config;
}): string {
  if (opts.flag !== undefined) {
    return validateProjectId(opts.flag, "flag");
  }

  if (opts.env !== undefined) {
    return validateProjectId(opts.env, "env");
  }

  if (opts.config?.project !== undefined) {
    return validateProjectId(opts.config.project, "config");
  }

  throw new Error(
    "No project specified. Use --project <uuid>, set PLANEC_PROJECT env var, or run: planec use <uuid>",
  );
}

function validateProjectId(value: string, source: string): string {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(value)) {
    throw new Error(
      `Invalid project UUID ${value} from ${source}: must be a valid UUID. Run: planec use <uuid>`,
    );
  }
  return value;
}

/**
 * Single source of truth for resolving a project id from a command's options.
 * Applies the full precedence (flag > PLANE_PROJECT env > config) and validates
 * the UUID, so every handler fails the same clear way on a missing or malformed
 * project instead of silently proceeding with garbage.
 */
export function resolveProjectFromOpts(
  opts: { project?: string },
  config: Config,
): string {
  return resolveProject({
    flag: opts.project,
    env: process.env.PLANE_PROJECT,
    config,
  });
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
): Promise<string> {
  if (!/^[A-Z]+-\d+$/.test(id)) return id;
  const item = await client.workItems.get(id);
  if (item === null) {
    throw new Error(`Work item not found: ${id}`);
  }
  return item.id;
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
