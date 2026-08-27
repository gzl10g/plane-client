import { PlaneApiError } from "./error.js";
import type { PlaneClient } from "./client.js";
import { stateId } from "./state-helpers.js";
import type { IntakeIssue, Priority, Project, State, StateGroup, WorkItem } from "./types.js";

/**
 * Cross-workspace reporting over work items.
 *
 * Everything here filters **client-side**, and that is not a shortcut. Plane's
 * v1 API silently ignores `state`, `state_group`, `priority`, `cycle`,
 * `module`, `labels` and `assignees` on `/work-items/`, and `group_by` comes
 * back with `grouped_by: null` and the results ungrouped. `pql`/`filters` do
 * answer — with a `400` on the Community edition, whose message literally says
 * to filter client-side. `fields=` is the one query parameter that is honoured,
 * and it cuts the payload down a lot, so it is the one we use.
 *
 * Because of that, this module decides what to drop. Every path that drops
 * something has to be able to say so: a report that quietly leaves out a
 * project it could not read is the same lie the API tells, told back to the
 * user.
 */

/** The state groups that count as "still open". */
const OPEN_GROUPS: StateGroup[] = ["backlog", "unstarted", "started"];

const PRIORITIES: Priority[] = ["urgent", "high", "medium", "low", "none"];

/** Fields the report actually reads. Anything else is payload we pay for and drop. */
const REPORT_FIELDS = [
  "id",
  "sequence_id",
  "name",
  "state",
  "priority",
  "assignees",
  "created_at",
  "completed_at",
  "target_date",
];

/** Status code Plane gives an intake issue that is still awaiting triage. */
const INTAKE_PENDING = -2;

/** What every report row carries, whatever its source. */
interface ReportRowBase {
  /** Human identifier, rebuilt from the project identifier and sequence (`PCL-42`). */
  readonly identifier: string;
  readonly workspace: string;
  readonly project: string;
  readonly projectId: string;
  readonly name: string;
  readonly priority: Priority;
  readonly assignees: readonly string[];
  readonly createdAt?: string;
  readonly completedAt?: string;
  readonly targetDate?: string;
}

/** A row that came from the project's work items. */
export interface WorkItemRow extends ReportRowBase {
  readonly intake?: false;
  /**
   * The state's display name, or `null` when the work item's state UUID was not
   * in the project's state list. `null` rather than `"unknown"` so a project
   * that genuinely has a state *named* "Unknown" stays distinguishable from one
   * we failed to resolve.
   */
  readonly state: string | null;
  readonly stateGroup: StateGroup | "unknown";
}

/** A row that came from the intake queue, which has no workflow state at all. */
export interface IntakeRow extends ReportRowBase {
  readonly intake: true;
  readonly state: "intake";
  readonly stateGroup: "intake";
}

/**
 * A report row. Discriminated on `intake` because the two kinds do not obey the
 * same rules — state filters apply to one and not the other — and a single
 * struct with an optional flag pushed that difference into casts.
 */
export type ReportRow = WorkItemRow | IntakeRow;

/** A workspace the sweep could not read, and the reason as far as it can tell. */
export interface SkippedWorkspace {
  readonly workspace: string;
  /** Human-readable explanation. Do not parse it — switch on `kind`. */
  readonly reason: string;
  /** Machine-readable cause, so callers do not have to parse English prose. */
  readonly kind: SkipKind;
  /** HTTP status, when the failure came back as one. */
  readonly status?: number;
}

/** A single project the sweep could not read. The rest of the report still stands. */
export interface SkippedProject extends SkippedWorkspace {
  readonly project: string;
}

/**
 * Why something was skipped. `permission` is the routine one; the rest exist so
 * a timeout or a bug does not get reported as "no access", which is what a bare
 * error message looks like to whoever reads the report.
 */
export type SkipKind = "permission" | "rate-limit" | "not-found" | "http" | "other";

export interface ReportCounts {
  readonly total: number;
  readonly open: number;
  readonly done: number;
  readonly cancelled: number;
  readonly intake: number;
  /**
   * Rows dropped for having no usable date when a window was given. Counted
   * rather than silently discarded: a completed work item with a null
   * `completed_at` is real work that would otherwise vanish from the report.
   */
  readonly undated: number;
  /**
   * Rows whose state UUID was not in the project's state list. They cannot be
   * classified, so a state filter drops them — which is why they are counted.
   */
  readonly unresolvedState: number;
  readonly byGroup: Partial<Record<StateGroup | "unknown" | "intake", number>>;
}

export interface WorkItemReport {
  readonly rows: readonly ReportRow[];
  /**
   * True when anything was skipped or dropped — a workspace, a project, or rows
   * that could not be classified — so the numbers are not the whole picture.
   */
  readonly partial: boolean;
  readonly skipped: readonly SkippedWorkspace[];
  readonly skippedProjects: readonly SkippedProject[];
  /** Project identifiers asked for with `projects` that no workspace turned out to have. */
  readonly unknownProjects: readonly string[];
  readonly counts: ReportCounts;
}

/** How the intake queue takes part in the report. */
export type IntakeMode = "exclude" | "include" | "only";

export interface ReportOptions {
  /** `open` = backlog + unstarted + started. Mutually exclusive with `groups`. */
  status?: "open" | "done" | "all";
  /** Explicit state groups, for finer control than `status`. Mutually exclusive with `status`. */
  groups?: StateGroup[];
  /** Only these project identifiers (case-insensitive), e.g. `["PCL", "NXI"]`. */
  projects?: string[];
  /** Only work items assigned to these user ids. Excludes intake rows, which have none. */
  assignees?: string[];
  /**
   * Lower bound, inclusive. `YYYY-MM-DD` or anything `Date.parse` accepts.
   * Compared against `completed_at` for completed work and `created_at` for
   * everything else, intake included.
   */
  since?: string;
  /** Upper bound, inclusive **to the end of that day**. Same fields as `since`. */
  until?: string;
  /**
   * Whether to report the intake queue: `"exclude"` (default), `"include"` to
   * add it alongside the work items, or `"only"` for the queue on its own.
   */
  intake?: IntakeMode;
  /** Called with a human-readable note whenever something is skipped. */
  onWarning?: (message: string) => void;
}

/** Thrown when every workspace was refused, which points at the credential. */
export class AllWorkspacesRefusedError extends Error {
  constructor(
    message: string,
    readonly skipped: readonly SkippedWorkspace[],
  ) {
    super(message);
    this.name = "AllWorkspacesRefusedError";
  }
}

/** Classifies a thrown error so callers get a cause, not a sentence to parse. */
function classify(err: unknown): { kind: SkipKind; status?: number; reason: string } {
  if (err instanceof PlaneApiError) {
    if (err.isPermission) {
      return {
        kind: "permission",
        status: err.status,
        reason: "403 — no access, or the name does not exist (the API answers the same either way)",
      };
    }
    if (err.isRateLimit) {
      return { kind: "rate-limit", status: err.status, reason: "429 — rate limited, retries exhausted" };
    }
    if (err.isNotFound) return { kind: "not-found", status: err.status, reason: "404 — not found" };
    return { kind: "http", status: err.status, reason: `${err.status} ${err.message}` };
  }
  return { kind: "other", reason: err instanceof Error ? err.message : String(err) };
}

/**
 * Builds the state-uuid → group map for a project.
 *
 * Grouping has to go through `group`, never through the state's name: each
 * project renames its states freely ("In Progress", "En curso", "Doing"), so a
 * report keyed on names silently splits the same column into three.
 */
function stateGroups(states: State[]): Map<string, { name: string; group: StateGroup }> {
  const map = new Map<string, { name: string; group: StateGroup }>();
  for (const state of states) {
    map.set(state.id, { name: state.name, group: state.group as StateGroup });
  }
  return map;
}

/**
 * The state's UUID, or undefined if the field arrived in neither known shape.
 *
 * The narrowing itself lives in {@link stateId}; this only guards against JSON
 * that does not match the declared type at all, which the exported helper is
 * not required to handle.
 */
function stateIdOf(state: unknown): string | undefined {
  if (typeof state === "string") return stateId(state);
  if (state !== null && typeof state === "object" && typeof (state as State).id === "string") {
    return stateId(state as State);
  }
  return undefined;
}

function toPriority(value: unknown): Priority {
  return PRIORITIES.includes(value as Priority) ? (value as Priority) : "none";
}

function toRow(
  item: WorkItem,
  project: Project,
  workspace: string,
  states: Map<string, { name: string; group: StateGroup }>,
): WorkItemRow {
  const resolved = stateIdOf(item.state);
  const state = resolved !== undefined ? states.get(resolved) : undefined;
  return {
    identifier: `${project.identifier}-${item.sequence_id}`,
    workspace,
    project: project.identifier,
    projectId: project.id,
    name: item.name,
    state: state?.name ?? null,
    stateGroup: state?.group ?? "unknown",
    priority: toPriority(item.priority),
    assignees: Array.isArray(item.assignees) ? item.assignees : [],
    createdAt: item.created_at,
    completedAt: item.completed_at,
    targetDate: item.target_date,
  };
}

function intakeToRow(issue: IntakeIssue, project: Project, workspace: string): IntakeRow {
  const detail = issue.issue_detail as
    | { name?: string; sequence_id?: number; priority?: string; created_at?: string }
    | undefined;
  const sequence = detail?.sequence_id;
  return {
    identifier: sequence !== undefined ? `${project.identifier}-${sequence}` : `${project.identifier}-intake`,
    workspace,
    project: project.identifier,
    projectId: project.id,
    name: issue.name ?? detail?.name ?? "",
    state: "intake",
    stateGroup: "intake",
    priority: toPriority(detail?.priority),
    assignees: [],
    createdAt: detail?.created_at,
    intake: true,
  };
}

/** A parsed, validated date window. Parsing once beats parsing per row. */
interface Window {
  sinceMs?: number;
  untilMs?: number;
}

/**
 * Parses the window up front and rejects an unusable bound.
 *
 * `Date.parse("last tuesday")` is `NaN`, and every comparison with `NaN` is
 * false — so an unparseable date used to disable the filter instead of
 * applying it, handing back *more* rows than asked for, which is the direction
 * nobody double-checks. The CLI validated its own flags; the library entry
 * point has to validate too, because it is exported.
 */
function parseWindow(opts: ReportOptions): Window {
  const parse = (value: string | undefined, name: string): number | undefined => {
    if (value === undefined) return undefined;
    const at = Date.parse(value);
    if (Number.isNaN(at)) {
      throw Object.assign(
        new Error(`Invalid ${name} ${value}: expected a date like 2026-08-01.`),
        { exitCode: 2 },
      );
    }
    return at;
  };
  const sinceMs = parse(opts.since, "since");
  const untilAt = parse(opts.until, "until");
  // `until: 2026-08-27` means the whole of the 27th, not midnight sharp.
  const untilMs = untilAt === undefined ? undefined : untilAt + 86_399_999;

  // A window that ends before it starts matches nothing, and the report would
  // say "0 item(s)" — which reads as "there is no work" rather than "you swapped
  // the dates".
  if (sinceMs !== undefined && untilMs !== undefined && untilMs < sinceMs) {
    // Sus tres hermanas del report (--json/--format, --intake/--intake-only,
    // --status/--group) salen 2, y esta salía 1 diciendo en el mismo mensaje
    // que es un typo. `reports.ts` es librería, así que el código de salida
    // viaja como propiedad en vez de importar la clase del CLI.
    throw Object.assign(
      new Error(
        `Empty date window: since ${opts.since} is after until ${opts.until}. Nothing can match, so this is a typo rather than a filter.`,
      ),
      { exitCode: 2 },
    );
  }

  return { sinceMs, untilMs };
}

/** `true` inside the window, `false` outside, `"undated"` when there is no date to judge by. */
function windowVerdict(row: ReportRow, window: Window): boolean | "undated" {
  if (window.sinceMs === undefined && window.untilMs === undefined) return true;
  // Completed work is dated by when it was finished; everything else — an open
  // work item, an intake issue waiting at the door — by when it appeared.
  const stamp = !row.intake && row.stateGroup === "completed" ? row.completedAt : row.createdAt;
  if (stamp === undefined) return "undated";
  const at = Date.parse(stamp);
  if (Number.isNaN(at)) return "undated";
  if (window.sinceMs !== undefined && at < window.sinceMs) return false;
  if (window.untilMs !== undefined && at > window.untilMs) return false;
  return true;
}

function wantedGroups(opts: ReportOptions): StateGroup[] | undefined {
  if (opts.groups?.length) {
    if (opts.status !== undefined) {
      // The API this client wraps ignores parameters it dislikes and says
      // nothing; refusing to do the same to our own callers.
      throw new Error("Pass either status or groups, not both.");
    }
    return opts.groups;
  }
  if (opts.status === "done") return ["completed"];
  if (opts.status === "all" || opts.status === undefined) return undefined;
  return OPEN_GROUPS;
}

/**
 * Sweeps every project of every given client and returns the matching rows.
 *
 * One client per workspace: the workspace is fixed at construction, so N
 * workspaces means N clients — and they should share one rate-limit state,
 * because Plane throttles per API key.
 *
 * Request budget is roughly `1 + 2·projects` per workspace (`+1` per project
 * with intake): a projects listing, then states and work items per project.
 * `/work-items/` returns everything in one response as long as `per_page` is
 * not sent, so that middle figure is usually one request, not one per page.
 *
 * @param clients - One entry per workspace to sweep
 * @param opts - Filters, all applied client-side
 * @throws Error if the date window or the status/groups pair is unusable
 * @throws AllWorkspacesRefusedError if every workspace was refused
 */
export async function buildWorkItemReport(
  clients: Array<{ workspace: string; client: PlaneClient }>,
  opts: ReportOptions = {},
): Promise<WorkItemReport> {
  const groups = wantedGroups(opts);
  const window = parseWindow(opts);
  const intakeMode: IntakeMode = opts.intake ?? "exclude";
  const wantedProjects = opts.projects?.map((p) => p.toUpperCase());

  const rows: ReportRow[] = [];
  const skipped: SkippedWorkspace[] = [];
  const skippedProjects: SkippedProject[] = [];
  const seenProjects = new Set<string>();
  let unresolvedState = 0;
  let intakeSeen = 0;
  let intakePending = 0;

  const warn = (message: string): void => opts.onWarning?.(message);

  for (const { workspace, client } of clients) {
    let projects: Project[];
    try {
      projects = [];
      for await (const project of client.projects.listAll()) projects.push(project);
    } catch (err) {
      // A workspace you cannot read and a workspace that does not exist both
      // answer 403 — the API does not tell them apart, so neither can we.
      const { kind, status, reason } = classify(err);
      skipped.push({ workspace, kind, status, reason });
      warn(`Skipping workspace ${workspace}: ${reason}`);
      continue;
    }

    for (const project of projects) {
      seenProjects.add(project.identifier.toUpperCase());
      if (wantedProjects && !wantedProjects.includes(project.identifier.toUpperCase())) {
        continue;
      }

      // Collected per project and only merged once the project finishes. A
      // failure halfway through would otherwise leave that project's first
      // pages in the report *and* list it as skipped — totals that are wrong in
      // a way no reader can detect.
      const projectRows: ReportRow[] = [];
      let projectUnresolved = 0;
      let projectIntakeSeen = 0;
      let projectIntakePending = 0;

      try {
        if (intakeMode !== "only") {
          const states = await client.states.list(project.id);
          if (states.length === 0) {
            // Not "a project with no work": a project whose states we could not
            // read. Every row would fall out of every state filter, and the
            // project would vanish from the report looking empty.
            throw new Error(
              "the project reported no states, so its work items cannot be classified",
            );
          }
          const stateMap = stateGroups(states);
          // `listAll` rather than one page: without `perPage` this instance
          // answers with every work item in a single response, but that is
          // observed behaviour, not a contract — and reporting one page as if
          // it were the whole project is the failure this release exists to fix.
          // When the response does come back whole, `listAll` costs one request.
          for await (const item of client.workItems.listAll(project.id, { fields: REPORT_FIELDS })) {
            const row = toRow(item, project, workspace, stateMap);
            if (row.stateGroup === "unknown") projectUnresolved++;
            projectRows.push(row);
          }
        }

        if (intakeMode !== "exclude") {
          for await (const issue of client.intake.listAll(project.id)) {
            projectIntakeSeen++;
            // Only what is still waiting: accepted intake issues are already in
            // the work item listing, and counting them again would double them.
            if (issue.status === INTAKE_PENDING) {
              projectIntakePending++;
              projectRows.push(intakeToRow(issue, project, workspace));
            }
          }
        }
      } catch (err) {
        // One unreadable project must not take the sweep down with it: a 403 is
        // routine (an orphan, a disabled feature, a project this key cannot
        // read). Its partial rows are discarded rather than merged.
        const { kind, status, reason } = classify(err);
        skippedProjects.push({ workspace, project: project.identifier, kind, status, reason });
        warn(`Skipping project ${project.identifier} in ${workspace}: ${reason}`);
        continue;
      }

      rows.push(...projectRows);
      unresolvedState += projectUnresolved;
      intakeSeen += projectIntakeSeen;
      intakePending += projectIntakePending;
      if (projectUnresolved > 0) {
        warn(
          `${projectUnresolved} work item(s) in ${project.identifier} carry a state this project did not list; they cannot be classified.`,
        );
      }
    }
  }

  if (clients.length > 0 && skipped.length === clients.length) {
    // Not a permissions problem to shrug at: every workspace refusing at once is
    // the signature of the wrong credential — typically a PLANE_API_KEY in the
    // environment overriding the config, which answers 200 workspace-level and
    // 403 on everything project-level. Without this, the report would come back
    // empty and look perfectly legitimate.
    throw new AllWorkspacesRefusedError(
      `Every workspace was refused (${skipped.map((s) => s.workspace).join(", ")}). ` +
        "That is usually the credential, not your permissions — check which key is in play with: planec config show",
      skipped,
    );
  }

  // A project asked for by name that no workspace turned out to have is a typo,
  // not an empty backlog — and an empty report is exactly what a typo produces.
  const unknownProjects = (wantedProjects ?? []).filter((p) => !seenProjects.has(p));
  for (const missing of unknownProjects) {
    // `seenProjects` solo se llena con los workspaces que sí se pudieron leer,
    // así que culpar al identificador cuando alguno fue rechazado manda al
    // lector a buscar un typo teniendo la causa real dos líneas más arriba.
    warn(
      skipped.length > 0
        ? `Did not find project ${missing} in the workspaces that could be read. It may live in one of the ${skipped.length} skipped above, rather than being a typo.`
        : `No project named ${missing} in the workspaces swept. Check the identifier with: planec projects list`,
    );
  }

  if (intakeMode !== "exclude" && intakeSeen > 0 && intakePending === 0) {
    // Distinguishes "the queues are empty" from "no row looked pending to us",
    // which would otherwise read identically as `0 awaiting triage`.
    warn(
      `Read ${intakeSeen} intake issue(s) and recognised none as pending (status ${INTAKE_PENDING}).`,
    );
  }

  let undated = 0;
  const filtered = rows.filter((row) => {
    if (!row.intake) {
      if (groups && !groups.includes(row.stateGroup as StateGroup)) return false;
      if (opts.assignees?.length && !row.assignees.some((a) => opts.assignees?.includes(a))) {
        return false;
      }
    } else if (opts.assignees?.length) {
      // Intake issues carry no assignees, so an assignee filter excludes them.
      return false;
    }
    const verdict = windowVerdict(row, window);
    if (verdict === "undated") {
      undated++;
      return false;
    }
    return verdict;
  });

  if (undated > 0) {
    warn(`${undated} row(s) dropped for having no date to compare against the requested window.`);
  }

  const byGroup: Partial<Record<StateGroup | "unknown" | "intake", number>> = {};
  for (const row of filtered) {
    const key = row.stateGroup;
    byGroup[key] = (byGroup[key] ?? 0) + 1;
  }

  return {
    rows: filtered,
    // `undated` también cuenta: son filas descartadas, y el docblock de
    // `partial` promete "true cuando algo se ha saltado o descartado". El CLI
    // lo salvaba avisando por onWarning, pero un consumidor de la librería que
    // mire `partial` recibía `false` habiendo tirado trabajo real.
    partial:
      skipped.length > 0 ||
      skippedProjects.length > 0 ||
      unknownProjects.length > 0 ||
      unresolvedState > 0 ||
      undated > 0,
    skipped,
    skippedProjects,
    unknownProjects,
    counts: {
      total: filtered.length,
      open: filtered.filter((r) => !r.intake && OPEN_GROUPS.includes(r.stateGroup as StateGroup)).length,
      done: filtered.filter((r) => !r.intake && r.stateGroup === "completed").length,
      cancelled: filtered.filter((r) => !r.intake && r.stateGroup === "cancelled").length,
      intake: filtered.filter((r) => r.intake === true).length,
      undated,
      unresolvedState,
      byGroup,
    },
  };
}
