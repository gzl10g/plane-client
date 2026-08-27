import { loadConfig, type Config } from "./config.js";
import { buildWorkItemReport, AllWorkspacesRefusedError } from "../reports.js";
import type { IntakeMode, ReportRow, WorkItemReport } from "../reports.js";
import type { RateLimitState, StateGroup } from "../types.js";
import {
  buildClient,
  formatTable,
  UsageError,
  type HandlerDeps,
  type TableColumn,
} from "./shared.js";

export interface ReportWorkItemsOptions {
  workspaces?: string[];
  status?: string;
  group?: string;
  project?: string;
  assignee?: string[];
  since?: string;
  until?: string;
  intake?: boolean;
  intakeOnly?: boolean;
  format?: string;
  json?: boolean;
}

const REPORT_COLUMNS: TableColumn[] = [
  { key: "identifier", label: "ID", width: 12 },
  { key: "project", label: "Project", width: 10 },
  { key: "name", label: "Name", width: 46 },
  { key: "state", label: "State", width: 16 },
  { key: "priority", label: "Priority", width: 8 },
];

const VALID_STATUS = ["open", "done", "all"] as const;
const VALID_GROUPS: StateGroup[] = ["backlog", "unstarted", "started", "completed", "cancelled"];
const VALID_FORMATS = ["table", "json", "csv", "md"] as const;

function parseList(value: string | string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const parts = Array.isArray(value) ? value : [value];
  const out = parts
    .flatMap((p) => p.split(","))
    .map((s) => s.trim())
    .filter(Boolean);
  return out.length > 0 ? out : undefined;
}

/** A date the report can actually compare, rejected early rather than filtering everything out. */
function assertDate(value: string | undefined, flag: string): void {
  if (value === undefined) return;
  if (Number.isNaN(Date.parse(value))) {
    throw new UsageError(`Invalid ${flag} ${value}: expected a date like 2026-08-01.`);
  }
}

/**
 * Resolves the workspaces to sweep: the flag if given, otherwise the ones saved
 * with `planec workspace add`, otherwise the single active workspace.
 *
 * There is no fourth option — the v1 API cannot list workspaces at all (no such
 * route), so "all of mine" is not something this command can discover. Saying
 * that plainly beats reporting on one workspace and calling it everything.
 */
export function resolveReportWorkspaces(opts: { workspaces?: string[] }, config: Config): string[] {
  const explicit = parseList(opts.workspaces);
  if (explicit) return explicit;

  const saved = config.workspaces?.filter(Boolean);
  if (saved && saved.length > 0) return saved;

  // The single active workspace, from any of the three layers the CLI documents:
  // the global --workspace flag, PLANE_WORKSPACE, or `workspace use`.
  //
  // The flag has to be listed explicitly. It used to arrive here disguised as
  // PLANE_WORKSPACE because the hook forwarded it by writing that variable;
  // when that was fixed (it made `config show` report a false provenance), this
  // fallback silently lost the highest-precedence layer of the three, and
  // `--workspace gzl10 report work-items` started failing with "No workspaces
  // to report on" while the other two layers kept working.
  //
  // Splitting on commas means `--workspace a,b` sweeps both rather than looking
  // up one workspace literally named "a,b".
  const active = parseList(
    process.env.PLANEC_WORKSPACE_FLAG ?? process.env.PLANE_WORKSPACE ?? config.workspace,
  );
  if (active) return active;

  throw new Error(
    "No workspaces to report on. Pass --workspaces <slug...>, or save them with: planec workspace add <slug>. " +
      "The Plane v1 API cannot list your workspaces, so this list has to come from you.",
  );
}

function toCsv(rows: readonly ReportRow[]): string {
  const escape = (value: unknown): string => {
    const s = String(value ?? "");
    // RFC 4180 requires quoting for CR as well as LF, and a lone CR in a work
    // item name would otherwise let a parser that normalises line endings split
    // one record into two. The tab is in here for the same reason: it is a
    // delimiter in enough downstream tools to be worth quoting.
    return /["\n\r\t,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = "identifier,workspace,project,name,state,state_group,priority,created_at,completed_at,target_date";
  const lines = rows.map((r) =>
    [
      r.identifier,
      r.workspace,
      r.project,
      r.name,
      r.state,
      r.stateGroup,
      r.priority,
      r.createdAt ?? "",
      r.completedAt ?? "",
      r.targetDate ?? "",
    ]
      .map(escape)
      .join(","),
  );
  return [header, ...lines].join("\n");
}

function toMarkdown(report: WorkItemReport): string {
  const lines = [
    "| ID | Project | Name | State | Priority |",
    "| --- | --- | --- | --- | --- |",
    ...report.rows.map(
      (r) => `| ${r.identifier} | ${r.project} | ${r.name.replace(/\|/g, "\\|")} | ${r.state} | ${r.priority} |`,
    ),
  ];
  if (report.partial) {
    const skipped = [
      ...report.skipped.map((s) => s.workspace),
      ...report.skippedProjects.map((s) => `${s.workspace}/${s.project}`),
    ];
    lines.push("", `> Partial report: skipped ${skipped.join(", ")}.`);
  }
  return lines.join("\n");
}

/** One summary line, so a long listing still says what it adds up to. */
function summary(report: WorkItemReport): string {
  const parts = [`${report.counts.total} item(s)`];
  if (report.counts.open > 0) parts.push(`${report.counts.open} open`);
  if (report.counts.done > 0) parts.push(`${report.counts.done} done`);
  if (report.counts.intake > 0) parts.push(`${report.counts.intake} awaiting triage`);
  return parts.join(" · ");
}

export async function handleReportWorkItems(
  opts: ReportWorkItemsOptions,
  deps?: HandlerDeps,
): Promise<void> {
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });

  if (opts.status !== undefined && !(VALID_STATUS as readonly string[]).includes(opts.status)) {
    throw new UsageError(`Invalid --status ${opts.status}. One of: ${VALID_STATUS.join(", ")}`);
  }
  if (opts.json && opts.format !== undefined && opts.format !== "json") {
    throw new UsageError(
      `Use either --json or --format ${opts.format}, not both: --json is shorthand for --format json.`,
    );
  }
  const format = opts.json ? "json" : (opts.format ?? "table");
  if (!(VALID_FORMATS as readonly string[]).includes(format)) {
    throw new UsageError(`Invalid --format ${format}. One of: ${VALID_FORMATS.join(", ")}`);
  }
  const groups = parseList(opts.group) as StateGroup[] | undefined;
  if (groups && opts.status !== undefined) {
    // The API this wraps ignores parameters it dislikes and says nothing. Not
    // doing that to our own users.
    throw new UsageError("Use either --status or --group, not both.");
  }
  const unknownGroup = groups?.find((g) => !VALID_GROUPS.includes(g));
  if (unknownGroup) {
    throw new UsageError(`Invalid --group ${unknownGroup}. One of: ${VALID_GROUPS.join(", ")}`);
  }
  assertDate(opts.since, "--since");
  assertDate(opts.until, "--until");

  if (opts.intake && opts.intakeOnly) {
    throw new UsageError("Use either --intake or --intake-only, not both.");
  }

  // An intake issue has no workflow state, so a state filter can only match
  // nothing — and the report used to apply it to nothing and say the same as
  // without it. That is precisely the silent filter this client exists to
  // catch Plane doing; doing it ourselves is worse.
  if (opts.intakeOnly && (opts.status !== undefined || opts.group !== undefined)) {
    throw new UsageError(
      "--intake-only cannot be combined with --status or --group: items awaiting triage have no workflow state, so those filters would be ignored. Use --since/--until or --project to narrow the queue.",
    );
  }
  const intakeMode: IntakeMode = opts.intakeOnly ? "only" : opts.intake ? "include" : "exclude";

  const workspaces = resolveReportWorkspaces(opts, config);

  // One client per workspace: the slug is immutable on PlaneClient, so a
  // cross-workspace sweep is N clients, not one client reconfigured.
  //
  // They are built through `buildClient`, not by hand: it applies the same
  // credential precedence as every other command (and treats an empty env var
  // as unset, which `??` would not), and it fails with "baseUrl not configured"
  // instead of firing requests at a malformed URL. Hand-rolling it here meant
  // an empty PLANE_API_KEY produced a wave of 403s that this command then
  // blamed on the credential — right conclusion, unreadable route to it.
  //
  // They also share one rate-limit state: Plane throttles per API key, so a
  // per-workspace client starting blind would walk into the 429 the previous
  // one already saw coming.
  const quota: RateLimitState = {};
  const clients = workspaces.map((workspace) => ({
    workspace,
    client:
      deps?.client ??
      buildClient(config, {
          // Explicit, so the global --workspace flag and PLANE_WORKSPACE cannot
          // silently redirect every client at one workspace.
          workspace,
          rateLimit: { quota },
          // Without this, a sweep that exhausts the quota sits there for up to a
          // minute per request with no output — indistinguishable from a hang,
          // which this repo has already paid for once.
          onThrottle: ({ waitMs, reason, remaining }) =>
            console.error(
              `Rate limit: waiting ${Math.round(waitMs / 1000)}s (${reason}${
                remaining === undefined ? "" : `, ${remaining} request(s) left`
              })…`,
            ),
        }),
  }));

  let report: WorkItemReport;
  try {
    report = await buildWorkItemReport(clients, {
      // Only one of the two reaches the report; passing both is refused above.
      status: groups ? undefined : ((opts.status ?? "open") as "open" | "done" | "all"),
      groups,
      projects: parseList(opts.project),
      assignees: parseList(opts.assignee),
      since: opts.since,
      until: opts.until,
      intake: intakeMode,
      onWarning: (message) => console.error(message),
    });
  } catch (err) {
    if (err instanceof AllWorkspacesRefusedError) {
      // Re-thrown as a plain error so runHandler prints it and exits 1: an empty
      // report that looks legitimate is worse than a loud failure. The original
      // travels as `cause`, so the skipped list is still reachable.
      throw new Error(err.message, { cause: err });
    }
    throw err;
  }

  if (format === "json") {
    // The JSON payload already carries `partial`, `skipped` and the counts.
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (format === "csv") {
    console.log(toCsv(report.rows));
  } else if (format === "md") {
    console.log(toMarkdown(report));
  } else {
    console.log(formatTable(report.rows as unknown as Record<string, unknown>[], REPORT_COLUMNS));
    // Summary on stderr: stdout stays a clean table for a pipe.
    console.error(summary(report));
  }

  // Redirecting stdout to a file is the normal way to use csv/md, and a report
  // missing a workspace must not look complete in that file. The caveat goes to
  // stderr for every text format, not just the table.
  warnIfIncomplete(report);
}

/** Says on stderr, for any format, what the report is missing. */
function warnIfIncomplete(report: WorkItemReport): void {
  if (!report.partial) return;

  const parts: string[] = [];
  if (report.skipped.length > 0) {
    parts.push(
      `${report.skipped.length} workspace(s): ${report.skipped
        .map((s) => `${s.workspace} (${s.reason})`)
        .join("; ")}`,
    );
  }
  if (report.skippedProjects.length > 0) {
    parts.push(
      `${report.skippedProjects.length} project(s): ${report.skippedProjects
        .map((s) => `${s.workspace}/${s.project}`)
        .join(", ")}`,
    );
  }
  if (report.unknownProjects.length > 0) {
    parts.push(`unknown project identifier(s): ${report.unknownProjects.join(", ")}`);
  }
  if (report.counts.unresolvedState > 0) {
    parts.push(`${report.counts.unresolvedState} work item(s) whose state could not be classified`);
  }
  console.error(`Partial report — ${parts.join("; ")}`);
}
