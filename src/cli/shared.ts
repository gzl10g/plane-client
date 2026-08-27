import { readFileSync } from "node:fs";
import readline from "node:readline";
import { PlaneClient } from "../client.js";
import { PlaneApiError } from "../error.js";
import type { Config } from "./config.js";
import { stateName as expandedStateName } from "../state-helpers.js";
import type { PlaneClientConfig, Project, State } from "../types.js";

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

export const EXIT_OK = 0;
export const EXIT_FAILURE = 1;
/** Bad usage: unknown flag, missing argument, contradictory options. */
export const EXIT_USAGE = 2;
/** The named resource does not exist. */
export const EXIT_NOT_FOUND = 3;
/** The credential was missing, rejected, or not allowed to do this. */
export const EXIT_AUTH = 4;

/**
 * The codes this CLI can exit with. A closed set, so a stray number cannot
 * invent a sixth meaning that the README does not document.
 */
export type ExitCode =
  | typeof EXIT_OK
  | typeof EXIT_FAILURE
  | typeof EXIT_USAGE
  | typeof EXIT_NOT_FOUND
  | typeof EXIT_AUTH;

/**
 * An error that carries the exit code the CLI should end with. Everything else
 * that throws is a failure we did not anticipate and ends with 1.
 */
export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode: ExitCode = EXIT_FAILURE,
  ) {
    super(message);
    this.name = "CliError";
  }
}

/**
 * Thrown when the user declines a confirmation prompt.
 *
 * Every abort branch used to `console.error("Aborted.")` and return, which left
 * the exit code at 0 — so `planec projects delete X && echo deleted` printed
 * "deleted" without having deleted anything. A command that did not do what it
 * was asked has to say so in the only channel a script reads (clig.dev
 * §Errors; `gh` exits 1 on the same path).
 */
export class AbortedError extends CliError {
  constructor(message = "Aborted.") {
    super(message, EXIT_FAILURE);
    this.name = "AbortedError";
  }
}

/**
 * Exit codes, following the convention `gh` set: a generic failure is 1, usage
 * errors are 2, and the cases a script most often needs to branch on get their
 * own number.
 *
 * "This work item does not exist", "your key was rejected" and "the request blew
 * up" are three different answers, and a script can only tell them apart if the
 * CLI spends a code on each. Every non-zero value still fails a bare `&&` chain,
 * so nothing that already treated failure as failure changes behaviour.
 */
/** Thrown when the resource the command names does not exist. Exits {@link EXIT_NOT_FOUND}. */
export class NotFoundError extends CliError {
  constructor(message: string) {
    super(message, EXIT_NOT_FOUND);
    this.name = "NotFoundError";
  }
}

/**
 * Thrown when the command was used wrongly: a bad flag value, a missing
 * argument, two options that contradict each other. Exits {@link EXIT_USAGE}.
 *
 * Everything the CLI rejects *before* making a request is usage, and it all has
 * to answer with the same code — documenting `2` for "unknown flag, missing
 * argument, contradictory options" while those three returned `1` was worse
 * than having no convention, because a contract in the README is something
 * people write scripts against.
 */
export class UsageError extends CliError {
  constructor(message: string) {
    super(message, EXIT_USAGE);
    this.name = "UsageError";
  }
}

/**
 * Prints the hint that goes with an API error.
 *
 * Order matters. Plane returns 403 for an invalid key as well as for a real
 * permission problem, and the CLI always sends the configured key, so the 401
 * branch is effectively unreachable in normal use — which left every
 * bad-credential case reading the permissions hint and chasing the wrong thing.
 * The body is what tells them apart.
 */
function printApiHint(err: PlaneApiError): void {
  if (err.isInvalidToken) {
    console.error(
      "Hint: the API key was rejected as invalid (Plane answers 403, not 401, for a bad key). " +
        "Check which one is in play with: planec config show — the environment overrides the saved one.",
    );
  } else if (err.isAuth) {
    console.error(
      'Hint: 401 Unauthorised — no API key was sent. Run: echo "$TOKEN" | planec login --token-stdin',
    );
  } else if (err.isPermission) {
    console.error(
      "Hint: 403 Forbidden — the key is valid but not allowed here. Before assuming permissions: check the project (-p), " +
        "the identifier prefix, and the workspace slug. Run: planec config show",
    );
  }
}

/**
 * Keeps an HTML error page out of the terminal.
 *
 * A malformed request can reach a proxy rather than Plane, and the body comes
 * back as a full HTML document — seven lines of `<head>`, `<center>` and
 * `cloudflare` dumped raw where an error message belongs. The page says nothing
 * a person can act on, and its bulk hides the status code that does.
 */
function summariseBody(message: string): string {
  const start = message.indexOf(" - ");
  if (start === -1) return message;
  const body = message.slice(start + 3).trimStart();
  if (!body.startsWith("<")) return message;
  return `${message.slice(0, start)} - the server returned an HTML error page, not a Plane API response (a proxy or gateway answered, so the request may not have reached Plane at all)`;
}

/** True for the documented exit codes, and only those. */
function isExitCode(value: unknown): value is ExitCode {
  return value === EXIT_OK || value === EXIT_FAILURE || value === EXIT_USAGE ||
    value === EXIT_NOT_FOUND || value === EXIT_AUTH;
}

export async function runHandler(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    process.exitCode = EXIT_OK;
  } catch (err: unknown) {
    const message = summariseBody(err instanceof Error ? err.message : String(err));
    // An abort is a decision the user made, not a failure to report back to
    // them: it gets the exit code but not the "Error:" prefix.
    if (err instanceof AbortedError) {
      console.error(message);
      process.exitCode = err.exitCode;
      return;
    }
    console.error(`Error: ${message}`);
    if (err instanceof CliError) {
      process.exitCode = err.exitCode;
      return;
    }
    // La librería (reports.ts) no importa las clases del CLI, así que marca su
    // código de salida como propiedad. Se respeta igual.
    // Solo códigos del conjunto documentado: aceptar cualquier entero
    // contradecía el union `ExitCode` que existe para que nadie invente un
    // sexto significado.
    const tagged = (err as { exitCode?: unknown }).exitCode;
    if (isExitCode(tagged)) {
      process.exitCode = tagged;
      return;
    }
    // A 404 straight from the API is a not-found too. Handing it exit 1 left the
    // code meaningful only on the handful of commands that check for null
    // first — every sub-resource (`comments delete`, `links delete`,
    // `attachments delete`, `remove-work-item`, `intake accept`…) still made a
    // script tell "does not exist" from "broke" by matching on message text,
    // which is the thing the exit code exists to replace.
    if (err instanceof PlaneApiError && err.isNotFound) {
      process.exitCode = EXIT_NOT_FOUND;
      return;
    }
    // 401 and 403 are both "the credential cannot do this", which is the other
    // branch a script actually needs — retry with different auth, rather than
    // retry at all.
    if (err instanceof PlaneApiError && (err.isAuth || err.isPermission)) {
      printApiHint(err);
      process.exitCode = EXIT_AUTH;
      return;
    }
    process.exitCode = EXIT_FAILURE;
  }
  // Do NOT call process.exit() here: when stdout is a pipe (e.g. `| jq`),
  // writes are async-buffered and process.exit() would drop unflushed output,
  // truncating large JSON payloads. Setting exitCode lets Node drain stdout
  // and exit naturally once the event loop is empty.
}

/**
 * Returns the first value that is actually set, treating an empty or
 * whitespace-only string as absent.
 *
 * The env layers are read with this rather than `??` because `??` only falls
 * back on `undefined`: `export PLANE_API_KEY="$UNSET"`, `docker run -e
 * PLANE_API_KEY` with no value, or a `.env` line ending in `=` all produce an
 * empty string, which would then win over a perfectly good
 * `~/.planec/config.json` and take the CLI down with "apiKey not configured" on
 * a setup that worked yesterday. An empty override is not an override.
 */
function firstNonEmpty(...values: (string | undefined)[]): string | undefined {
  for (const value of values) {
    if (value !== undefined && value.trim() !== "") return value;
  }
  return undefined;
}

/** Where a resolved setting actually came from, for `config show`. */
export type SettingSource = "flag" | "env" | "config" | "unset";

export interface EffectiveSetting {
  value?: string;
  source: SettingSource;
  /** The env var that would override this setting. */
  envVar: string;
}

function resolveSetting(
  envVar: string,
  fromConfig: string | undefined,
  fromFlag?: string,
): EffectiveSetting {
  const flag = firstNonEmpty(fromFlag);
  if (flag !== undefined) return { value: flag, source: "flag", envVar };
  const fromEnv = firstNonEmpty(process.env[envVar]);
  if (fromEnv !== undefined) return { value: fromEnv, source: "env", envVar };
  const fromFile = firstNonEmpty(fromConfig);
  if (fromFile !== undefined) return { value: fromFile, source: "config", envVar };
  return { source: "unset", envVar };
}

/**
 * Resolves every setting the way the commands actually resolve it, keeping
 * track of which layer won. `config show` prints the file alone otherwise,
 * which turns the one command people run to debug their context ("why is this
 * work item attributed to the wrong agent?") into a confident wrong answer.
 */
export function resolveEffectiveConfig(config: Config): {
  baseUrl: EffectiveSetting;
  apiKey: EffectiveSetting;
  workspace: EffectiveSetting;
  project: EffectiveSetting;
} {
  return {
    baseUrl: resolveSetting("PLANE_BASE_URL", config.baseUrl),
    apiKey: resolveSetting("PLANE_API_KEY", config.apiKey),
    workspace: resolveSetting(
      "PLANE_WORKSPACE",
      config.workspace,
      process.env.PLANEC_WORKSPACE_FLAG,
    ),
    project: resolveSetting("PLANE_PROJECT", config.project),
  };
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
    throw new UsageError(
      `Invalid project UUID ${ref}: looks like a UUID with the dashes stripped. Use the dashed form.`,
    );
  }
  if (!IDENTIFIER_RE.test(ref)) {
    throw new UsageError(
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
  const raw = firstNonEmpty(opts.project, process.env.PLANE_PROJECT, config.project);

  if (raw === undefined) {
    throw new Error(
      "No project specified. Use --project <uuid|IDENTIFIER>, set PLANE_PROJECT env var, or run: planec use <uuid>",
    );
  }

  if (PROJECT_UUID_RE.test(raw)) return raw;

  assertLooksLikeIdentifier(raw);

  const found = await findProjectByIdentifier(client ?? buildClient(config), raw);
  if (found === null) {
    throw new NotFoundError(
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
  const raw = firstNonEmpty(opts.project, process.env.PLANE_PROJECT, config.project);
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
/**
 * Rejects an id that cannot be one, before it reaches the network.
 *
 * Narrow on purpose: it turns away characters that cannot appear in any id and
 * would mangle the URL — `%%%` used to come back as a proxy's HTML error page —
 * and lets through anything the API could plausibly answer for. A well-formed
 * id that does not exist deserves the API's own 404, not a guess from us.
 *
 * @throws UsageError if the id is empty or contains impossible characters
 */
export function assertWorkItemIdShape(id: string): void {
  if (id.trim() === "") {
    throw new UsageError("Missing work item id.");
  }
  if (!/^[A-Za-z0-9_-]+$/.test(id.trim())) {
    // Entrecomillado: sin comillas, un id con espacios de un copy-paste sucio
    // se leía como válido dentro del propio mensaje de error.
    throw new UsageError(
      `Invalid work item id "${id}": ids are alphanumerics, dashes and underscores — a PREFIX-NUMBER like PCL-42, or a UUID.`,
    );
  }
}

/**
 * Normalises a work item reference the way `-p` already normalises a project.
 *
 * The API rejects `prueba-805` and `" PRUEBA-805 "` alike (403), so both used to
 * cost a round trip to fail. Since the CLI already uppercases a project
 * identifier for `-p`, doing less for a work item was an asymmetry with nothing
 * behind it: a pasted id with stray whitespace, or a prefix typed in lower case,
 * now just works.
 */
export function normaliseWorkItemRef(id: string): string {
  const trimmed = id.trim();
  // Alfanuméricos y guion bajo, con dígito inicial permitido: `10TEST-5` y
  // `A_B-7` son identificadores que AGENTS.md documenta como creables, y el
  // regex estrecho los mandaba a un endpoint de proyecto como si fueran UUID.
  return /^[A-Za-z0-9_]+-\d+$/.test(trimmed) ? trimmed.toUpperCase() : trimmed;
}

export async function resolveWorkItemId(
  client: PlaneClient,
  id: string,
  projectId?: string,
): Promise<string> {
  // Anything that is not an identifier is passed through as an id, which is how
  // `%%%` reached the network and came back as a proxy's **HTML error page**
  // instead of an API response. The check is deliberately narrow: it rejects
  // characters that cannot appear in any id and would mangle the URL, and lets
  // through anything the API could plausibly answer for — a wrong-but-well-formed
  // id deserves the API's own 404, not a guess from us.
  assertWorkItemIdShape(id);
  id = normaliseWorkItemRef(id);
  if (!/^[A-Z0-9_]+-\d+$/.test(id)) return id;
  const item = await client.workItems.get(id);
  if (item === null) {
    throw new NotFoundError(`Work item not found: ${id}`);
  }
  // The identifier lookup is workspace-level, so `NXI-42` resolves even when the
  // command is pointed at another project. The endpoints below are project-scoped
  // and answer 200 with an empty result for a foreign work item, so without this
  // check a wrong -p (or a stale `planec use`) looks like success and writes
  // nothing. Fail loudly instead.
  const itemProject = item.project;
  if (projectId !== undefined && typeof itemProject !== "string") {
    // No poder comprobarlo no es lo mismo que estar comprobado. Callar aquí
    // devolvía al escenario que este guard describe: la escritura sigue contra
    // el -p equivocado, responde 200 y no escribe nada.
    console.error(
      `Warning: cannot confirm that ${id} belongs to the project this command targets (the API did not return its project id). If the write reports success but nothing changes, check -p.`,
    );
  }
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
 * Refuses to prompt when stdin is not a terminal, naming the flag that skips
 * the question.
 *
 * Without this, `readline.question()` on a closed stdin never resolves: the
 * command hangs and Node eventually kills it with an `unsettled top-level
 * await` warning and **exit 13** — from a cron or an agent, which is the normal
 * case for this CLI, that reads as the CLI being broken. An explicit error that
 * says which flag to pass is the difference between a five-second fix and a
 * hung job nobody notices.
 *
 * @param flagHint - The non-interactive escape hatch to suggest (e.g. `--yes`)
 * @throws Error if stdin is not a TTY
 */
function assertInteractive(flagHint: string): void {
  if (!process.stdin.isTTY) {
    throw new Error(
      `Refusing to prompt: stdin is not a terminal. Pass ${flagHint} to run non-interactively.`,
    );
  }
}

/**
 * Asks for interactive confirmation on stderr (stdout stays clean for pipes).
 * Returns true only on an explicit yes. Non-interactive callers should skip
 * this via a `--yes` flag — and if they do not, this throws rather than hanging.
 *
 * @param message - Question to show
 * @param flagHint - Flag named in the error when there is no terminal
 * @throws Error if stdin is not a TTY
 */
export async function confirmAction(
  message: string,
  flagHint = "--yes",
): Promise<boolean> {
  assertInteractive(flagHint);
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
 * Validates a colour flag.
 *
 * Neither Plane nor this client checked it, so `--color verde` was accepted
 * with a 200 and stored verbatim — a label whose colour renders as nothing, and
 * which nobody notices until the board looks wrong.
 *
 * @param value - Raw flag value
 * @param flag - Flag name, for the error message
 * @throws Error if it is not a `#rgb` or `#rrggbb` hex colour
 */
export function parseHexColor(value: string | undefined, flag = "--color"): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed)) {
    throw new UsageError(
      `Invalid ${flag} ${value}: expected a hex colour like #ff0000 or #f00. Plane stores whatever you send, so a typo here is invisible until the board renders it.`,
    );
  }
  return trimmed;
}

/**
 * Parses a count flag (`--per-page`, `--limit`) and refuses anything that is not
 * a sane positive integer.
 *
 * Sending these through unchecked was worse than sloppy. Against Plane 1.4.2:
 * `--per-page -5` makes the server answer **500**; `0` and `abc` are dropped,
 * which *disables* pagination and returns the whole project in one response —
 * the opposite of what the flag says; `1.5` silently truncates to 1; and
 * `99999` comes back 400. Four different wrong behaviours for four ways of
 * mistyping one number.
 *
 * @param value - Raw flag value
 * @param flag - Flag name, for the error message
 * @param max - Upper bound, when the endpoint has one
 * @throws Error if the value is not a positive integer within range
 */
export function parseCount(
  value: string | undefined,
  flag: string,
  max?: number,
): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new UsageError(`Invalid ${flag} ${value}: must be a whole number of at least 1.`);
  }
  if (max !== undefined && parsed > max) {
    throw new UsageError(`Invalid ${flag} ${value}: the API rejects anything above ${max}.`);
  }
  return parsed;
}

/**
 * Reads a secret from stdin, for the `--*-stdin` flags.
 *
 * A token passed as an argument is readable in `ps` for as long as the command
 * runs, lands in the shell history, and is echoed by any harness that logs the
 * command line it ran — which, for a CLI whose main users are agents and cron
 * jobs, is most of them. Reading it from a pipe is what `docker login
 * --password-stdin`, `gh auth login --with-token` and `glab auth login --stdin`
 * all do, and for the same reason.
 *
 * Refuses to read from a terminal: with no pipe this would sit there looking
 * like a hang, and the user would have no idea they were meant to type a secret
 * with no prompt and no echo.
 *
 * @param flagName - Flag being served, named in the error
 * @returns The trimmed contents of stdin
 * @throws Error if stdin is a terminal or carries nothing
 */
export async function readSecretFromStdin(flagName: string): Promise<string> {
  if (process.stdin.isTTY) {
    throw new Error(
      `${flagName} reads the value from stdin, but stdin is a terminal. Pipe it in: echo "$TOKEN" | planec login ${flagName}`,
    );
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk as Buffer));
  }
  const value = Buffer.concat(chunks).toString("utf-8").trim();
  if (value === "") {
    throw new Error(`${flagName} got nothing on stdin.`);
  }
  return value;
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
    throw new UsageError(`Use either ${flagName} or ${flagName}-file, not both.`);
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

/**
 * Builds a client from the resolved configuration.
 *
 * @param config - Saved config; `config.workspace` is the fallback for the slug
 * @param overrides - Extra PlaneClient options (e.g. a shared rate-limit state)
 */
export function buildClient(
  config: Config,
  overrides?: Partial<Omit<PlaneClientConfig, "baseUrl" | "apiKey">>,
): PlaneClient {
  // El entorno gana sobre el fichero, igual que ya hacían PLANE_WORKSPACE y PLANE_PROJECT.
  // Importa cuando varios agentes comparten el usuario del sistema: la config vive en
  // ~/.planec/config.json vía os.homedir(), así que sin esto todos comparten identidad y no
  // hay forma de distinguir quién movió un work item.
  const baseUrl = firstNonEmpty(process.env.PLANE_BASE_URL, config.baseUrl);
  const apiKey = firstNonEmpty(process.env.PLANE_API_KEY, config.apiKey);

  if (!baseUrl) {
    throw new Error(
      "baseUrl not configured. Set PLANE_BASE_URL=<value> or run: planec config set baseUrl <value>",
    );
  }
  if (!apiKey) {
    throw new Error(
      "apiKey not configured. Set PLANE_API_KEY=<value> or run: planec login --token <value>",
    );
  }

  // An explicit workspace in the overrides wins over every ambient layer. The
  // cross-workspace report builds one client per workspace and passes each slug
  // here: without this, the flag or the environment overrode all of them and the
  // report swept the same workspace N times while claiming to cover the list it
  // was given — a report that is quietly about the wrong thing.
  const workspace = firstNonEmpty(
    overrides?.workspace,
    process.env.PLANEC_WORKSPACE_FLAG,
    process.env.PLANE_WORKSPACE,
    config.workspace,
  );
  if (!workspace) {
    throw new Error(
      "workspace not configured. Use --workspace <slug>, set PLANE_WORKSPACE=<slug>, or run: planec workspace use <slug>",
    );
  }

  return new PlaneClient({ ...overrides, baseUrl, apiKey, workspace });
}

/**
 * Resolves the workspace slug that requests will actually use, for display.
 * Mirrors the precedence in buildClient (env over config).
 */
export function resolveWorkspaceForDisplay(config: Config): string | undefined {
  return firstNonEmpty(
    process.env.PLANEC_WORKSPACE_FLAG,
    process.env.PLANE_WORKSPACE,
    config.workspace,
  );
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

/**
 * Emits a one-line stderr note when a listing showed only the first page.
 *
 * Silently truncating is the failure this CLI keeps paying for: a workspace of
 * 22 projects hid two behind the default page of 20 and said nothing, and the
 * same shape was still live in `work-items list`. If the caller does not want
 * every page, they should at least know a page is all they got.
 *
 * @param shown - Items actually printed
 * @param hasNext - Whether the API says more pages follow
 * @param total - Total count, when the API reported one
 * @param allFlag - The flag that fetches everything
 */
export function warnIfTruncated(
  shown: number,
  hasNext: boolean,
  total?: number,
  allFlag = "--all",
): void {
  if (!hasNext) return;
  const of = total !== undefined ? ` of ${total}` : "";
  console.error(
    `Showing the first ${shown}${of} result(s) — more pages exist. Pass ${allFlag} to fetch them all.`,
  );
}

/**
 * Reports the outcome of a command that has nothing to print but "it worked".
 *
 * `--json` is a global flag, so commander accepts it after any subcommand — and
 * around fifteen of them took it and printed their human sentence anyway. A
 * flag that is accepted and ignored is worse than one that does not exist:
 * there is no error to notice in a script or an agent, just output that will
 * not parse.
 *
 * @param opts - The command's options, for `--json`
 * @param message - Human sentence for the plain-text mode
 * @param data - Fields to merge into the JSON object (which always has `ok`)
 */
export function reportAction(
  opts: { json?: boolean },
  message: string,
  data: Record<string, unknown> = {},
): void {
  if (opts.json) {
    console.log(JSON.stringify({ ok: true, ...data }, null, 2));
    return;
  }
  console.log(message);
}

/**
 * A work item's `state` rendered for a table cell.
 *
 * The CLI asks for `expand=state`, so the field is the full object, not the
 * UUID the bare endpoint returns — `types.ts` declaring it `string` is why
 * `String(state)` printing `[object Object]` in every work-item table
 * type-checked cleanly. The narrowing lives in the exported {@link
 * expandedStateName}; this wrapper takes `unknown` because table rows are
 * `Record<string, unknown>`, and falls back to the raw UUID, which is more use
 * in a cell than an empty column.
 */
function stateCell(state: unknown): string {
  if (typeof state === "string") return state;
  if (state !== null && typeof state === "object" && typeof (state as State).name === "string") {
    return expandedStateName(state as State) ?? "";
  }
  return "";
}

/**
 * Flattens a work item for tabular output, deriving the columns a table can
 * print from the nested objects `expand` returns. Same shape as the intake
 * listing's `toRow`: the raw object is what `--json` keeps, the flattened one
 * is what the table gets.
 */
export function toWorkItemRow(item: Record<string, unknown>): Record<string, unknown> {
  return { ...item, state_name: stateCell(item.state) };
}

/**
 * Formats a timestamp for a table cell.
 *
 * The raw ISO string is 27 characters, so every date column truncated to
 * `2026-08-27T21:58:52…` — cutting off precisely the part that tells two rows
 * apart. Three comments from the same minute were indistinguishable. Minutes
 * are enough for a listing; the full value is one `--json` away.
 *
 * @param value - ISO timestamp, or anything else (returned unchanged)
 */
export function formatTimestamp(value: unknown): string {
  if (typeof value !== "string" || value === "") return String(value ?? "");
  const at = Date.parse(value);
  if (Number.isNaN(at)) return value;
  // LOCAL time, not UTC. The first version of this printed `toISOString()` with
  // the Z stripped, so a comment written at 23:01 CEST showed as 21:01 next to
  // a clock reading 23:01 — and the reader concludes it is somebody else's
  // comment, or an older one. A date that is merely truncated is useless; one
  // that is quietly two hours off is worse.
  const d = new Date(at);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Just the calendar day, for columns that hold a date and no time. */
export function formatDate(value: unknown): string {
  if (typeof value !== "string" || value === "") return String(value ?? "");

  // Un valor que ya es solo fecha se devuelve intacto: `Date.parse("2026-04-01")`
  // es medianoche UTC, y renderizarlo con los getters locales lo retrasa un día
  // al oeste de Greenwich. Es lo que guardan los módulos.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

  // Y si viene como instante, se formatea en **UTC**, no en local. Los ciclos
  // guardan `start_date`/`end_date` como timestamp anclado al día pedido
  // (`2027-03-15` se almacena como `2027-03-16T00:59:00+01:00`, o sea 23:59Z
  // del 15). Ese valor representa un DÍA, no un momento del día, así que
  // convertirlo a la zona local lo desplaza: en Madrid el ciclo que el usuario
  // creó hasta el 15 se mostraba hasta el 16, y en Los Ángeles el inicio caía
  // al día anterior. En UTC coincide con lo que se tecleó, en cualquier zona.
  //
  // Ojo con la simetría engañosa: módulos y ciclos llaman `start_date` a campos
  // de tipo distinto, así que aplicarles el mismo criterio "local" parece lo
  // coherente y es justo lo que falla.
  const at = Date.parse(value);
  if (Number.isNaN(at)) return value;
  return new Date(at).toISOString().slice(0, 10);
}

/**
 * Strips tags from a rich-text field so it can share a table cell.
 * Plane stores comments and descriptions as HTML.
 */
export function toPlainText(html: unknown): string {
  if (typeof html !== "string") return "";
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** Columns for a work-item table, shared by every command that prints one. */
export const WORK_ITEM_COLUMNS: TableColumn[] = [
  { key: "identifier", label: "ID", width: 12 },
  { key: "name", label: "Name", width: 46 },
  { key: "state_name", label: "State", width: 20 },
  { key: "priority", label: "Priority", width: 10 },
];

/**
 * Prepares a project's work items for a table: the readable identifier in the
 * ID column, and the state's *name* in the State column.
 *
 * Both need context the work item itself does not carry. The ID column used to
 * print the bare `sequence_id` (`693`), which is not something you can paste
 * back into any command — `work-items get 693` rejects it, it wants
 * `PRUEBA-693`. And `/module-issues/` and `/cycle-issues/` return `state` as a
 * plain UUID rather than the expanded object, so those two tables printed a
 * truncated UUID where a state name belongs.
 *
 * Costs at most two extra requests per listing (the project, for its prefix;
 * the state list, to name the states), and only fetches what the rows actually
 * need.
 *
 * @param client - Client to resolve with
 * @param projectId - Project the items belong to
 * @param items - Raw work items
 * @returns Rows ready for {@link WORK_ITEM_COLUMNS}
 */
export async function toWorkItemRows(
  client: PlaneClient,
  projectId: string,
  items: Record<string, unknown>[],
): Promise<Record<string, unknown>[]> {
  if (items.length === 0) return [];

  const needsStateNames = items.some((item) => typeof item.state === "string");
  // Degradar está bien —la tabla es presentación— pero callarlo no: sin esto,
  // un 403 o un 429 dejaba la columna ID con el `sequence_id` pelado (justo el
  // valor que esta función existe para eliminar) y la columna State vacía, con
  // exit 0 y sin una línea en stderr. El usuario concluía que el work item no
  // tiene estado.
  const warn = (what: string, err: unknown): void => {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`Could not read ${what} for this table (${reason}); showing raw values instead.`);
  };
  const [project, states] = await Promise.all([
    client.projects.get(projectId).catch((err: unknown) => {
      warn("the project prefix", err);
      return null;
    }),
    needsStateNames
      ? client.states.list(projectId).catch((err: unknown) => {
          warn("the state names", err);
          return [];
        })
      : Promise.resolve([]),
  ]);

  const stateById = new Map(states.map((state) => [state.id, state.name]));
  const prefix = project?.identifier;

  return items.map((item) => {
    const row = toWorkItemRow(item);
    if (row.state_name === "" || typeof item.state === "string") {
      row.state_name = stateById.get(String(item.state)) ?? row.state_name;
    }
    row.identifier =
      prefix !== undefined && item.sequence_id !== undefined
        ? `${prefix}-${String(item.sequence_id)}`
        : String(item.sequence_id ?? "");
    return row;
  });
}

/**
 * Fits a cell to its column. A column declares a width so the table lines up;
 * a value longer than it used to be printed in full, pushing every later column
 * out of alignment on that row (a 90-char work item name shifted State and
 * Priority off the grid). Truncation is marked with `…` so a clipped value is
 * never mistaken for the whole one.
 */
/**
 * How many terminal columns a code point draws in.
 *
 * These are the East Asian Wide and Fullwidth blocks plus the main emoji
 * planes: CJK, Hangul, kana, fullwidth forms. Everything else is one column.
 * Measuring with `.length` treats 日本語 as 3 when the terminal draws 6.
 */
function codePointWidth(cp: number): number {
  return (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3041 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f64f) ||
    (cp >= 0x1f900 && cp <= 0x1f9ff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
    ? 2
    : 1;
}

/** Splits text into grapheme clusters, so an emoji is never cut in half. */
function graphemes(value: string): string[] {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  return Array.from(segmenter.segment(value), (entry) => entry.segment);
}

/**
 * The width a string draws in, in terminal columns.
 *
 * A grapheme cluster counts once however many code points it holds: the family
 * emoji 👨‍👩‍👧‍👦 is seven code points joined by ZWJ and draws in two columns.
 */
export function displayWidth(value: string): number {
  let total = 0;
  for (const cluster of graphemes(value)) {
    let widest = 0;
    for (const char of cluster) {
      const cp = char.codePointAt(0);
      if (cp === undefined || cp === 0x200d) continue;
      widest = Math.max(widest, codePointWidth(cp));
    }
    total += widest === 0 ? 1 : widest;
  }
  return total;
}

/**
 * Fits a cell to its column, measured in **terminal columns and whole
 * graphemes** rather than code points.
 *
 * A column declares a width so the table lines up, and `.length` broke that in
 * both directions: 13 CJK characters draw as 26 columns and overflowed a
 * 20-wide column without ever tripping the truncation, while a ZWJ emoji counts
 * as 7 code points but draws as 2, so its row was padded short. Slicing on code
 * points also cut through grapheme clusters and left a dangling ZWJ, which the
 * terminal then tries to join with whatever follows.
 *
 * A newline in the value (the Plane UI allows them in names) would split the
 * row in two, so control characters fold to a space before anything measures
 * the width.
 */
function fitCell(value: string, width: number): string {
  // eslint-disable-next-line no-control-regex -- folding control characters is the point
  value = value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();

  const visible = displayWidth(value);
  if (visible <= width) return value + " ".repeat(width - visible);
  if (width <= 1) return "…".slice(0, width);

  let out = "";
  let used = 0;
  for (const cluster of graphemes(value)) {
    const w = displayWidth(cluster);
    if (used + w > width - 1) break;
    out += cluster;
    used += w;
  }
  return `${out}…${" ".repeat(Math.max(0, width - used - 1))}`;
}

export function formatTable(
  rows: Record<string, unknown>[],
  columns: TableColumn[],
): string {
  const widths = columns.map((col) => {
    const dataMax = rows.reduce((max, row) => {
      const val = String(row[col.key] ?? "");
      // En columnas de terminal, igual que `fitCell` al pintar. Medir aquí con
      // `.length` dejaba desalineadas justo las columnas sin ancho declarado
      // ante CJK o emoji — el fallo que displayWidth vino a arreglar.
      return Math.max(max, displayWidth(val));
    }, 0);
    return col.width ?? Math.max(col.label.length, dataMax);
  });

  const header = columns
    .map((col, i) => fitCell(col.label, widths[i]))
    .join("  ");

  const separator = widths.map((w) => "─".repeat(w)).join("  ");

  const dataRows = rows.map((row) =>
    columns
      .map((col, i) => fitCell(String(row[col.key] ?? ""), widths[i]))
      .join("  "),
  );

  return [header, separator, ...dataRows].join("\n");
}

/**
 * Renders one value of a key/value dump.
 *
 * `String(value)` was fine for scalars and a lie for everything else: a work
 * item read with `expand=state` printed `state: [object Object]`, which reads as
 * a bug even though the request succeeded. Nested values are serialised
 * compactly instead — the point of this view is to show what came back, not to
 * summarise it.
 */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    if (value.length === 0) return "";
    return value.every((v) => typeof v !== "object" || v === null)
      ? value.map((v) => String(v)).join(", ")
      : JSON.stringify(value);
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
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
      console.log(`${key}: ${formatValue(value)}`);
    }
    return;
  }

  console.log(String(data));
}
