import { PlaneApiError } from "./error.js";
import { WorkItemsResource } from "./resources/work-items.js";
import { StatesResource } from "./resources/states.js";
import { LabelsResource } from "./resources/labels.js";
import { ModulesResource } from "./resources/modules.js";
import { CyclesResource } from "./resources/cycles.js";
import { IntakeResource } from "./resources/intake.js";
import { ProjectsResource } from "./resources/projects.js";
import { MembersResource } from "./resources/members.js";
import { ProjectMembersResource } from "./resources/project-members.js";
import { InvitationsResource } from "./resources/invitations.js";
import type { PlaneClientConfig, RequestOptions } from "./types.js";

/**
 * Function type for making authenticated HTTP requests to Plane API.
 * Automatically prepends `/api/v1/workspaces/{workspace}` to the endpoint.
 */
export type RequestFn = <T = unknown>(endpoint: string, options?: RequestOptions) => Promise<T>;

/**
 * Main Plane API client. Provides typed access to all Plane resources
 * (projects, work items, cycles, modules, states, labels, intake, members).
 *
 * @example
 * ```ts
 * import { PlaneClient } from '@gzl10/plane-client'
 *
 * const client = new PlaneClient({
 *   baseUrl: 'https://plane.example.com',
 *   apiKey: 'pk_...',
 *   workspace: 'my-workspace',
 * })
 *
 * const page = await client.workItems.list('project-uuid')
 * const item = await client.workItems.get('PROJ-42')
 * ```
 */
export class PlaneClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly workspace: string;
  private readonly defaultTimeout: number;
  private readonly maxRetries: number;
  private readonly retryOn: number[];
  private readonly onRequest?: PlaneClientConfig["onRequest"];
  private readonly onResponse?: PlaneClientConfig["onResponse"];

  readonly workItems: WorkItemsResource;
  readonly states: StatesResource;
  readonly labels: LabelsResource;
  readonly modules: ModulesResource;
  readonly cycles: CyclesResource;
  readonly intake: IntakeResource;
  readonly projects: ProjectsResource;
  readonly members: MembersResource;
  readonly projectMembers: ProjectMembersResource;
  readonly invitations: InvitationsResource;

  /**
   * Creates a new PlaneClient instance.
   * @param config - Client configuration (baseUrl, apiKey, workspace, optional retry/timeout hooks)
   */
  constructor(config: PlaneClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.workspace = config.workspace;
    this.defaultTimeout = config.timeout ?? 30_000;
    this.maxRetries = config.retry?.maxRetries ?? 2;
    this.retryOn = config.retry?.retryOn ?? [429, 502, 503, 504];
    this.onRequest = config.onRequest;
    this.onResponse = config.onResponse;

    const request: RequestFn = this.request.bind(this);
    this.workItems = new WorkItemsResource(request);
    this.states = new StatesResource(request);
    this.labels = new LabelsResource(request);
    this.modules = new ModulesResource(request);
    this.cycles = new CyclesResource(request);
    this.intake = new IntakeResource(request);
    this.projects = new ProjectsResource(request);
    this.members = new MembersResource(request);
    this.projectMembers = new ProjectMembersResource(request);
    this.invitations = new InvitationsResource(request);
  }

  /**
   * Returns the Plane instance version.
   * @returns The current Plane version string, or "unknown" if unavailable
   * @throws PlaneApiError if the instances endpoint is unreachable
   */
  async version(): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/instances/`, {
      signal: AbortSignal.timeout(this.defaultTimeout),
    });
    if (!res.ok) throw new PlaneApiError(res.status, res.statusText);
    const data = await res.json() as { instance?: { current_version?: string } };
    return data.instance?.current_version ?? "unknown";
  }

  private async request<T = unknown>(endpoint: string, options?: RequestOptions): Promise<T> {
    const method = options?.method ?? "GET";
    const normalizedEndpoint = endpoint.endsWith("/") ? endpoint : `${endpoint}/`;
    const url = new URL(`${this.baseUrl}/api/v1/workspaces/${this.workspace}${normalizedEndpoint}`);

    if (options?.params) {
      for (const [k, v] of Object.entries(options.params)) url.searchParams.set(k, v);
    }

    const headers: Record<string, string> = { "X-API-Key": this.apiKey };
    if (options?.body) headers["Content-Type"] = "application/json";

    const urlStr = url.toString();
    this.onRequest?.({ method, url: urlStr });

    let lastError = new PlaneApiError(0, 'No attempts made');
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** (attempt - 1), 10_000)));
      }

      const start = Date.now();
      const res = await fetch(urlStr, {
        method,
        headers,
        body: options?.body ? JSON.stringify(options.body) : undefined,
        redirect: options?.redirect ?? "follow",
        signal: options?.signal ?? AbortSignal.timeout(options?.timeout ?? this.defaultTimeout),
      });

      this.onResponse?.({ method, url: urlStr, status: res.status, durationMs: Date.now() - start });

      if (options?.redirect === "manual" && res.status >= 300 && res.status < 400) {
        return res.headers.get("location") as T;
      }

      if (res.ok || res.status === 204) {
        if (res.status === 204) return undefined as T;
        return res.json() as Promise<T>;
      }

      const body = await res.text().catch(() => "");
      lastError = new PlaneApiError(res.status, res.statusText, undefined, body || undefined);

      if (!this.retryOn.includes(res.status)) break;
    }

    throw lastError;
  }
}
