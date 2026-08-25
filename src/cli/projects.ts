import { loadConfig, type Config } from "./config.js";
import {
  buildClient,
  formatOutput,
  resolveWorkspaceForDisplay,
  type HandlerDeps,
  type TableColumn,
} from "./shared.js";
import type { Project } from "../types.js";

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
