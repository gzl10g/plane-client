/**
 * Error thrown by PlaneAPI requests. Provides typed accessors for HTTP status codes.
 *
 * @example
 * ```ts
 * try {
 *   await client.workItems.create('proj', { name: '' })
 * } catch (err) {
 *   if (err instanceof PlaneApiError) {
 *     if (err.isAuth) console.log('Invalid API key')
 *     if (err.isNotFound) console.log('Resource not found')
 *   }
 * }
 * ```
 */
export class PlaneApiError extends Error {
  override readonly name = "PlaneApiError";

  /**
   * @param status - HTTP status code returned by the API
   * @param statusText - HTTP status text
   * @param code - Optional error code from the response body
   * @param body - Raw response body (if text could be read)
   */
  constructor(
    readonly status: number,
    readonly statusText: string,
    readonly code?: string,
    readonly body?: unknown,
  ) {
    const bodyStr = typeof body === "string" ? body : undefined;
    super(`Plane API ${status}: ${statusText}${bodyStr ? ` - ${bodyStr}` : ""}`);
  }

  /** HTTP 401 — Unauthorised (invalid or expired API key) */
  get isAuth(): boolean { return this.status === 401; }
  /** HTTP 403 — Forbidden (API key lacks permission for this resource) */
  get isPermission(): boolean { return this.status === 403; }
  /**
   * True when the response says the credential itself is bad.
   *
   * Plane answers an **invalid API key with 403**, not 401 — 401 only happens
   * with no key at all, which a configured CLI never sends. So the plain status
   * cannot tell "your key is wrong" from "your key lacks permission here", and
   * the body is the only thing that can: it carries `Given API token is not
   * valid`. Verified against 1.4.2 on 2026-08-27.
   */
  get isInvalidToken(): boolean {
    if (this.status !== 403) return false;
    const body = typeof this.body === "string" ? this.body : JSON.stringify(this.body ?? "");
    return /token is not valid/i.test(body);
  }
  /** HTTP 404 — Not Found. `get()` methods return `null` instead of throwing this */
  get isNotFound(): boolean { return this.status === 404; }
  /** HTTP 429 — Rate Limited. Throttle requests */
  get isRateLimit(): boolean { return this.status === 429; }
  /** HTTP 408 — Request Timeout */
  get isTimeout(): boolean { return this.status === 408; }
}
