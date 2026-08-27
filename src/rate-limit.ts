import type { RateLimitState } from "./types.js";

/**
 * Creates the quota object several clients can share.
 *
 * Plane throttles **per API key**, so a job that builds one client per
 * workspace is spending one quota, not N. Pass the same object to each client
 * as `rateLimit.quota` and they pace as one.
 *
 * Treat the result as opaque: the client fills it in, and its fields are
 * readonly from the outside so the representation can change without breaking
 * callers.
 *
 * @example
 * ```ts
 * const quota = createRateLimitState();
 * const clients = slugs.map((workspace) =>
 *   new PlaneClient({ baseUrl, apiKey, workspace, rateLimit: { quota } }),
 * );
 * ```
 */
export function createRateLimitState(): RateLimitState {
  return {};
}
