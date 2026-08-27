import type { State } from "./types.js";

/**
 * Helpers for {@link WorkItem.state}, which is a UUID on the bare endpoint and
 * a full {@link State} whenever the request asks for `expand=state`.
 *
 * They exist because the union moves a cost onto every consumer: without them,
 * anyone reading `item.state` writes the same `typeof` dance at each use site —
 * this repo had already written it twice internally before exporting it once.
 */

/** True when the state arrived expanded, narrowing it to {@link State}. */
export function isExpandedState(state: string | State): state is State {
  return typeof state !== "string";
}

/**
 * The state's UUID, whichever form it arrived in.
 * @param state - The `state` field of a work item
 */
export function stateId(state: string | State): string {
  return typeof state === "string" ? state : state.id;
}

/**
 * The state's display name, or `null` when only a UUID is available.
 *
 * `null` rather than the UUID: printing a UUID where a name belongs is how a
 * table ends up looking broken, and the caller is better placed to decide what
 * to show instead.
 */
export function stateName(state: string | State): string | null {
  return typeof state === "string" ? null : state.name;
}

/**
 * The id of a reference that may have arrived expanded.
 *
 * `assignees` and `labels` are ids by default and objects when the request asks
 * for `expand=assignees` / `expand=labels`. Unlike {@link WorkItem.state} they
 * are **not** typed as a union, and that is deliberate: `expand` is opt-in for
 * them and default for state, so widening the type would charge every consumer
 * for a case almost none of them cause. This helper is the way to read them
 * safely when you do pass `--expand`.
 *
 * @example
 * ```ts
 * const ids = item.assignees.map(entityId);
 * ```
 */
export function entityId(value: string | { id: string }): string {
  return typeof value === "string" ? value : value.id;
}
