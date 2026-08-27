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
import type { PlaneClientConfig, RateLimitState, RequestOptions } from "./types.js";

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
  private readonly onThrottle?: PlaneClientConfig["onThrottle"];
  private readonly rateLimitEnabled: boolean;
  private readonly rateLimitMinRemaining: number;
  private readonly rateLimitMaxWaitMs: number;
  /**
   * Quota state as of the last response that reported it. Empty until an
   * instance actually sends the headers — an instance that never does keeps the
   * pre-pacing behaviour, which is the point. Shared when the caller passes
   * `rateLimit.state`, because the quota belongs to the API key, not the client.
   */
  private readonly rateLimitState: RateLimitState;

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
    this.onThrottle = config.onThrottle;
    this.rateLimitEnabled = config.rateLimit?.enabled ?? true;
    // Clamped rather than trusted: a negative minRemaining or a zero maxWaitMs
    // would each disable pacing silently, in two different ways.
    this.rateLimitMinRemaining = Math.max(0, config.rateLimit?.minRemaining ?? 1);
    this.rateLimitMaxWaitMs = Math.max(0, config.rateLimit?.maxWaitMs ?? 60_000);
    this.rateLimitState = config.rateLimit?.quota ?? {};

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

  /** Sleeps, unless the wait is zero or negative. */
  private async sleep(ms: number): Promise<void> {
    if (ms <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Records the quota reported by a response.
   *
   * `x-ratelimit-reset` is an epoch in **seconds** (verified live against
   * 1.4.2); everything else here works in milliseconds, so it is converted once,
   * on the way in.
   */
  private noteRateLimit(headers: Headers): void {
    // `Number(null)` is 0, and 0 is a perfectly finite number — reading these
    // without checking for absence first turns "the instance sends no headers"
    // into "the quota is spent", and a proxy that forwards `reset` but not
    // `remaining` would park every later request for a full maxWaitMs.
    // Each header is handled on its own. A response that does not report a
    // value tells us nothing about it and must not erase what an earlier one
    // did report — overwriting unconditionally let a single header-less
    // response wipe the quota mid-sweep, and with a shared quota one client
    // could blank out what another had learned. A stale window is harmless:
    // once its reset is in the past, no wait is owed.
    const state = this.rateLimitState as { remaining?: number; resetAtMs?: number };

    // Presente-pero-vacía no es un dato: `Number("")` es 0 y finito, así que un
    // proxy que emita la cabecera sin valor convertía un barrido normal en un
    // minuto de espera por request.
    const rawRemaining = headers.get("x-ratelimit-remaining")?.trim() || null;
    if (rawRemaining !== null) {
      const remaining = Number(rawRemaining);
      state.remaining = Number.isFinite(remaining) ? remaining : undefined;
    }

    const rawReset = headers.get("x-ratelimit-reset")?.trim() || null;
    if (rawReset !== null) {
      const reset = Number(rawReset);
      state.resetAtMs = Number.isFinite(reset) && reset > 0 ? this.toResetMs(reset) : undefined;
    }
  }

  /**
   * Waits for the window to roll over when the quota is nearly spent.
   *
   * Blind retries discover the limit by hitting it: the request fails, the
   * backoff is a guess unrelated to the actual window, and a long sweep can
   * spend its whole budget on 429s. The headers say exactly how much is left and
   * when it comes back, so the client waits that long and no longer.
   *
   * A reset in the past means the window already rolled over and no wait is
   * owed — a stale value, not a reason to sleep.
   */
  /**
   * Turns the reported reset into epoch milliseconds, refusing values that
   * cannot be what they claim.
   *
   * Plane sends an epoch in seconds. Two neighbouring conventions would sail
   * through a bare multiplication, and each breaks pacing in a different
   * direction: delta-seconds (`42`) lands in 1970, so the window always reads
   * as already over and the client never waits; milliseconds land thousands of
   * years out, so every request sleeps the full cap. Anything that does not
   * resolve to a moment near now is discarded, and pacing simply stays inert.
   */
  private toResetMs(reset: number): number | undefined {
    const asMs = reset * 1000;
    const now = Date.now();
    // A real window is minutes away at most; a day of slack covers clock skew.
    const DAY_MS = 86_400_000;
    if (asMs < now - DAY_MS || asMs > now + DAY_MS) return undefined;
    return asMs;
  }

  private async paceForRateLimit(): Promise<void> {
    if (!this.rateLimitEnabled) return;
    const { remaining, resetAtMs } = this.rateLimitState;
    if (remaining === undefined || resetAtMs === undefined) return;
    if (remaining > this.rateLimitMinRemaining) return;

    const owed = resetAtMs - Date.now();
    if (owed <= 0) return;
    const waitMs = Math.min(owed, this.rateLimitMaxWaitMs);

    this.onThrottle?.({ waitMs, reason: "quota", remaining });
    await this.sleep(waitMs);

    // Only forget the window if the whole wait was served. A wait clipped by
    // maxWaitMs (an hourly window, a skewed server clock) leaves us still
    // throttled, and clearing the state here would send the next request
    // straight into the 429 we just waited to avoid.
    if (waitMs >= owed) {
      const state = this.rateLimitState as { remaining?: number; resetAtMs?: number };
      state.remaining = undefined;
      state.resetAtMs = undefined;
    }
  }

  /**
   * How long a 429 asked us to wait, in ms, or undefined if it did not say.
   * `Retry-After` is delta-seconds or an HTTP date; both spellings are legal.
   */
  private retryAfterMs(headers: Headers): number | undefined {
    const raw = headers.get("retry-after")?.trim();
    // An empty header is not "retry immediately" — `Number("")` is 0, which
    // would turn a junk header into a hot retry. Fall through to the backoff.
    if (raw === undefined || raw === "") return undefined;
    const seconds = Number(raw);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const date = Date.parse(raw);
    if (Number.isNaN(date)) return undefined;
    return Math.max(0, date - Date.now());
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
      // Pace before every attempt, the first included: the quota is shared by
      // every request this client makes, so what the previous one reported is
      // exactly what governs this one.
      await this.paceForRateLimit();

      const start = Date.now();
      const res = await fetch(urlStr, {
        method,
        headers,
        body: options?.body ? JSON.stringify(options.body) : undefined,
        redirect: options?.redirect ?? "follow",
        signal: options?.signal ?? AbortSignal.timeout(options?.timeout ?? this.defaultTimeout),
      });

      this.onResponse?.({ method, url: urlStr, status: res.status, durationMs: Date.now() - start });
      this.noteRateLimit(res.headers);

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

      if (attempt < this.maxRetries) {
        // A 429 that names its own wait knows better than our backoff curve,
        // which is a guess with no relation to the server's window.
        const retryAfter = res.status === 429 ? this.retryAfterMs(res.headers) : undefined;
        if (retryAfter !== undefined) {
          const waitMs = Math.min(retryAfter, this.rateLimitMaxWaitMs);
          this.onThrottle?.({ waitMs, reason: "retry-after" });
          await this.sleep(waitMs);
        } else {
          await this.sleep(Math.min(1000 * 2 ** attempt, 10_000));
        }
      }
    }

    throw lastError;
  }
}
