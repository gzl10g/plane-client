import type { RequestFn } from "../client.js";
import type { Project, ListOptions, Page } from "../types.js";

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
}
