import type { RequestFn } from "../client.js";
import { PlaneApiError } from "../error.js";
import type {
  Project,
  CreateProjectInput,
  UpdateProjectInput,
  ListOptions,
  Page,
} from "../types.js";

/** Plane caps `per_page` on this endpoint; anything above comes back clamped. */
const MAX_PER_PAGE = 100;

function toPage(data: {
  results?: Project[];
  next_cursor?: string;
  next_page_results?: boolean;
  total_results?: number;
  total_count?: number;
}): Page<Project> {
  const items = data?.results ?? (Array.isArray(data) ? (data as unknown as Project[]) : []);
  const hasNext = data?.next_page_results ?? false;
  return {
    items,
    // El endpoint devuelve `next_cursor` SIEMPRE, también en la última página
    // (verificado contra 1.4.1: `next_page_results: false` con
    // `next_cursor: "100:1:0"`). Propagarlo sin mirar `next_page_results`
    // deja a `listAll()` en bucle infinito repitiendo la última página.
    nextCursor: hasNext ? data?.next_cursor : undefined,
    total: data?.total_results ?? data?.total_count,
    hasNext,
  };
}

/** Maps the camelCase toggle inputs to the snake_case fields the API expects. */
function toToggleBody(toggles: {
  cycleView?: boolean;
  moduleView?: boolean;
  intakeView?: boolean;
  viewsView?: boolean;
  pageView?: boolean;
}): Record<string, boolean> {
  const body: Record<string, boolean> = {};
  if (toggles.cycleView !== undefined) body.cycle_view = toggles.cycleView;
  if (toggles.moduleView !== undefined) body.module_view = toggles.moduleView;
  if (toggles.intakeView !== undefined) body.intake_view = toggles.intakeView;
  if (toggles.viewsView !== undefined) body.issue_views_view = toggles.viewsView;
  if (toggles.pageView !== undefined) body.page_view = toggles.pageView;
  return body;
}

/**
 * Resource for listing the projects of a workspace. Workspace-level: no
 * project UUID needed — es justo el recurso que sirve para descubrirlos.
 */
export class ProjectsResource {
  constructor(private readonly request: RequestFn) {}

  /**
   * Lists projects in the workspace, one page at a time.
   * @param options - Pagination options (`perPage` is clamped to 100 by the API)
   * @returns Paginated projects
   */
  async list(options?: ListOptions): Promise<Page<Project>> {
    const params: Record<string, string> = {};
    if (options?.perPage) params.per_page = String(Math.min(options.perPage, MAX_PER_PAGE));
    if (options?.cursor) params.cursor = options.cursor;
    const data = await this.request<{
      results?: Project[];
      next_cursor?: string;
      next_page_results?: boolean;
      total_results?: number;
      total_count?: number;
    }>("/projects/", { params, signal: options?.signal });
    return toPage(data);
  }

  /**
   * Iterates every project in the workspace across all pages.
   * @param options - List options (cursor managed automatically)
   * @yields Project one at a time
   */
  async *listAll(options?: Omit<ListOptions, "cursor">): AsyncIterable<Project> {
    let cursor: string | undefined;
    do {
      const page = await this.list({ ...options, cursor });
      for (const project of page.items) yield project;
      cursor = page.nextCursor;
    } while (cursor);
  }

  /**
   * Gets a project by UUID. Returns `null` if not found (404).
   * @param projectId - Project UUID
   * @returns The project, or null
   */
  async get(projectId: string): Promise<Project | null> {
    try {
      return await this.request<Project>(`/projects/${projectId}/`);
    } catch (err) {
      if (err instanceof PlaneApiError && err.isNotFound) return null;
      throw err;
    }
  }

  /**
   * Creates a project. `name` and `identifier` (the human-readable work item
   * prefix) are both required by the API.
   *
   * The feature toggles are applied with a follow-up PATCH rather than in the
   * POST body, because the POST stores them without provisioning what they
   * turn on: a project created with `intake_view: true` answers **500** on the
   * first intake request, while the very same value re-sent as a PATCH makes
   * it work (verified against Plane 1.4.1, 2026-08-25). The extra request is
   * the price of the toggles actually working.
   *
   * `network` (project visibility) is silently ignored by the API v1 on both
   * create and update, so it is not part of the input type.
   *
   * @param input - Project data (`name` and `identifier` required)
   * @returns The created project, reflecting the applied toggles
   */
  async create(input: CreateProjectInput): Promise<Project> {
    const { cycleView, moduleView, intakeView, viewsView, pageView, ...rest } = input;
    const body = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));

    const created = await this.request<Project>("/projects/", {
      method: "POST",
      body,
    });

    const toggles = toToggleBody({ cycleView, moduleView, intakeView, viewsView, pageView });
    if (Object.keys(toggles).length === 0) return created;

    return this.request<Project>(`/projects/${created.id}/`, {
      method: "PATCH",
      body: toggles,
    });
  }

  /**
   * Updates a project.
   *
   * Note `identifier` is accepted and applied, and it is the prefix of every
   * work item in the project — changing it rewrites every `PROJ-42` reference
   * people have already pasted elsewhere. `network` is accepted by the API and
   * silently discarded, so it is not exposed here.
   *
   * @param projectId - Project UUID
   * @param input - Fields to update
   * @returns The updated project
   */
  async update(projectId: string, input: UpdateProjectInput): Promise<Project> {
    const { cycleView, moduleView, intakeView, viewsView, pageView, ...rest } = input;
    const body = {
      ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)),
      ...toToggleBody({ cycleView, moduleView, intakeView, viewsView, pageView }),
    };
    return this.request<Project>(`/projects/${projectId}/`, { method: "PATCH", body });
  }

  /**
   * Deletes a project. **Cascades**: work items, modules, cycles and the
   * intake queue go with it, with no warning from the API (verified against
   * 1.4.1 — a project holding an intake issue and a cycle deleted with 204).
   * @param projectId - Project UUID
   * @returns Resolves when the project is deleted
   */
  async delete(projectId: string): Promise<void> {
    await this.request(`/projects/${projectId}/`, { method: "DELETE" });
  }
}
