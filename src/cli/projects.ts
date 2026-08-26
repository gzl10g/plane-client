import readline from "node:readline";
import { loadConfig, type Config } from "./config.js";
import {
  buildClient,
  confirmAction,
  findProjectByIdentifier,
  formatOutput,
  resolveWorkspaceForDisplay,
  type HandlerDeps,
  type TableColumn,
} from "./shared.js";
import type { Project, CreateProjectInput, UpdateProjectInput } from "../types.js";

interface ListOptions {
  perPage?: string;
  json?: boolean;
}

function resolveClient(deps?: HandlerDeps) {
  if (deps?.client) return deps.client;
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  return buildClient(config);
}

const PROJECTS_COLUMNS: TableColumn[] = [
  { key: "identifier", label: "Identifier", width: 10 },
  { key: "name", label: "Name", width: 30 },
  { key: "id", label: "UUID", width: 36 },
];

function parsePerPage(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid --per-page ${value}: must be a positive integer.`);
  }
  return parsed;
}

/**
 * Lists the projects of the workspace. Workspace-scoped: no `-p/--project`,
 * porque este es precisamente el comando del que sale ese UUID.
 *
 * Recorre todas las páginas (`listAll`) en vez de devolver la primera: con la
 * página por defecto de 20 un workspace de 22 proyectos escondía dos sin decir
 * nada, que es justo el fallo que este comando viene a arreglar.
 */
export async function handleProjectsList(
  opts: ListOptions,
  deps?: HandlerDeps,
): Promise<void> {
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const client = resolveClient(deps);
  const perPage = parsePerPage(opts.perPage);

  const projects: Project[] = [];
  for await (const project of client.projects.listAll({ perPage })) {
    projects.push(project);
  }

  formatOutput(projects, { json: opts.json }, PROJECTS_COLUMNS);

  // `warnIfEmpty` habla de `-p/--project`, que aquí no existe: el aviso propio
  // apunta al único contexto que puede estar mal, el workspace.
  if (projects.length === 0) {
    console.error(
      `No projects. Context: workspace=${resolveWorkspaceForDisplay(config) ?? "(unset)"}. ` +
        "If this is unexpected, check --workspace / PLANE_WORKSPACE, or whether the API key has access to it.",
    );
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves a project reference to the full project, accepting either the UUID
 * or the human-readable identifier (`TEST89`). Taking the identifier is a
 * safety feature as much as a convenience: pasting the wrong UUID into a
 * destructive command is a lot easier than mistyping a prefix you can read.
 *
 * Returns the whole project (not just its id) because the callers need its
 * `identifier` and `name` — to confirm a delete, or to tell a rename apart from
 * a no-op. The identifier lookup itself is shared with `-p` via
 * `findProjectByIdentifier`.
 */
async function resolveProjectRef(
  client: ReturnType<typeof resolveClient>,
  ref: string,
): Promise<Project> {
  if (UUID_RE.test(ref)) {
    const project = await client.projects.get(ref);
    if (project === null) throw new Error(`Project not found: ${ref}`);
    return project;
  }
  const found = await findProjectByIdentifier(client, ref);
  if (found === null) {
    throw new Error(
      `Project not found: ${ref}. Pass a UUID or an identifier from: planec projects list`,
    );
  }
  return found;
}

/** Gets a project by UUID or identifier and prints it. */
export async function handleProjectsGet(
  ref: string,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const project = await resolveProjectRef(client, ref);
  formatOutput(project, { json: opts.json });
}

interface CreateOptions {
  name: string;
  identifier: string;
  description?: string;
  cycles?: boolean;
  modules?: boolean;
  intake?: boolean;
  views?: boolean;
  pages?: boolean;
  json?: boolean;
}

/**
 * Creates a project. The feature toggles default to work items + modules +
 * intake + views on, cycles and pages off; `--cycles`/`--pages` and the
 * `--no-*` forms override each one.
 */
export async function handleProjectsCreate(
  opts: CreateOptions,
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const input: CreateProjectInput = {
    name: opts.name,
    identifier: opts.identifier.toUpperCase(),
    description: opts.description,
    cycleView: opts.cycles ?? false,
    moduleView: opts.modules ?? true,
    intakeView: opts.intake ?? true,
    viewsView: opts.views ?? true,
    pageView: opts.pages ?? false,
  };
  const project = await client.projects.create(input);
  formatOutput(project, { json: opts.json });
  // La visibilidad no es gobernable por la API v1: decirlo aquí evita que
  // alguien dé por privado un proyecto que no lo es.
  console.error(
    "Note: project visibility (network) cannot be set through the Plane v1 API — change it in the UI if it must be private.",
  );
}

interface UpdateOptions {
  name?: string;
  identifier?: string;
  description?: string;
  cycles?: boolean;
  modules?: boolean;
  intake?: boolean;
  views?: boolean;
  pages?: boolean;
  yes?: boolean;
  json?: boolean;
}

/** Updates a project by UUID or identifier. */
export async function handleProjectsUpdate(
  ref: string,
  opts: UpdateOptions,
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const project = await resolveProjectRef(client, ref);

  const input: UpdateProjectInput = {
    name: opts.name,
    description: opts.description,
    cycleView: opts.cycles,
    moduleView: opts.modules,
    intakeView: opts.intake,
    viewsView: opts.views,
    pageView: opts.pages,
  };

  if (opts.identifier !== undefined) {
    const next = opts.identifier.toUpperCase();
    // El identifier prefija TODOS los work items del proyecto: cambiarlo
    // reescribe cada referencia `PROJ-42` ya pegada en comentarios, MRs y
    // documentación. No es un campo cosmético, así que se confirma.
    if (!opts.yes && next !== project.identifier) {
      const ok = await confirmAction(
        `Rename identifier ${project.identifier} -> ${next}? Every work item reference (${project.identifier}-1, ...) changes with it.`,
      );
      if (!ok) {
        console.error("Aborted.");
        return;
      }
    }
    input.identifier = next;
  }

  if (Object.values(input).every((v) => v === undefined)) {
    throw new Error("Nothing to update. Pass at least one field to change.");
  }

  const updated = await client.projects.update(project.id, input);
  formatOutput(updated, { json: opts.json });
}

/**
 * Deletes a project. Deleting a project is not `modules delete` with a bigger
 * blast radius — it takes every work item, module, cycle and the intake queue
 * with it, and the API neither warns nor refuses. So a bare `--yes` is not
 * accepted: the caller has to name the project it means to destroy, the same
 * bar GitHub and GitLab set for deleting a repository.
 */
export async function handleProjectsDelete(
  ref: string,
  opts: { confirm?: string; dryRun?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const project = await resolveProjectRef(client, ref);

  const inventory = await countContents(client, project.id);
  const summary =
    `${project.identifier} "${project.name}" (${project.id})\n` +
    `  work items: ${inventory.workItems}  modules: ${inventory.modules}  cycles: ${inventory.cycles}  intake: ${inventory.intake}`;

  if (opts.dryRun) {
    console.log(`Would delete:\n${summary}`);
    return;
  }

  console.error(`About to permanently delete:\n${summary}\nThis cascades and cannot be undone.`);

  if (opts.confirm !== undefined) {
    if (opts.confirm.toUpperCase() !== project.identifier?.toUpperCase()) {
      throw new Error(
        `--confirm ${opts.confirm} does not match the project identifier ${project.identifier}. Nothing was deleted.`,
      );
    }
  } else {
    const typed = await promptForIdentifier(project.identifier);
    if (typed.toUpperCase() !== project.identifier?.toUpperCase()) {
      console.error("Identifier did not match. Aborted.");
      return;
    }
  }

  await client.projects.delete(project.id);
  console.log(`Deleted project ${project.identifier} (${project.id})`);
}

/**
 * Counts what the delete would take down. Best-effort: a disabled feature
 * answers an error rather than an empty list, and a project we cannot fully
 * inspect is still deletable — so a failed count reports "?" instead of
 * blocking the command.
 */
async function countContents(
  client: ReturnType<typeof resolveClient>,
  projectId: string,
): Promise<{ workItems: string; modules: string; cycles: string; intake: string }> {
  const count = async (fn: () => Promise<{ length: number }>): Promise<string> => {
    try {
      return String((await fn()).length);
    } catch {
      return "?";
    }
  };
  const [workItems, modules, cycles, intake] = await Promise.all([
    (async () => {
      try {
        const page = await client.workItems.list(projectId, { perPage: 1 });
        return page.total !== undefined ? String(page.total) : String(page.items.length);
      } catch {
        return "?";
      }
    })(),
    count(() => client.modules.list(projectId)),
    count(() => client.cycles.list(projectId)),
    (async () => {
      try {
        const page = await client.intake.list(projectId);
        return page.total !== undefined ? String(page.total) : String(page.items.length);
      } catch {
        return "?";
      }
    })(),
  ]);
  return { workItems, modules, cycles, intake };
}

async function promptForIdentifier(identifier: string | undefined): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  try {
    return await new Promise<string>((resolve) => {
      rl.question(`Type ${identifier ?? "the identifier"} to confirm: `, resolve);
    });
  } finally {
    rl.close();
  }
}
