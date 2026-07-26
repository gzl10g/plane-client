import { PlaneClient } from "../client.js";
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
