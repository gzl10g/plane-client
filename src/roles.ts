import { Role, type RoleName, type RoleValue } from "./types.js";

// Maps rather than object literals on purpose: a plain literal resolves
// inherited keys, so `parseRole("constructor")` used to return a function and
// the role left the client as `undefined` — which the API then turns into a
// **guest**, the exact silent privilege downgrade this function exists to stop.
const BY_NAME = new Map<string, RoleValue>([
  ["admin", Role.Admin],
  ["member", Role.Member],
  ["guest", Role.Guest],
]);

const BY_VALUE = new Map<number, RoleName>([
  [Role.Admin, "admin"],
  [Role.Member, "member"],
  [Role.Guest, "guest"],
]);

/**
 * Normalises a role given as a name (`"admin"`) or as Plane's numeric value
 * (`20`) into the numeric value the API expects.
 *
 * Rejecting an unknown role here rather than forwarding it matters: the API
 * answers `400 {"role":["\"99\" is not a valid choice."]}`, which reads like a
 * permission problem in a CLI that only prints the status.
 *
 * @throws Error if the role is neither a known name nor a valid numeric value
 */
export function parseRole(role: RoleValue | RoleName | number | string): RoleValue {
  if (typeof role === "string") {
    const byName = BY_NAME.get(role.toLowerCase());
    if (byName !== undefined) return byName;
    const asNumber = Number(role);
    if (Number.isInteger(asNumber) && BY_VALUE.has(asNumber)) {
      return asNumber as RoleValue;
    }
    throw new Error(
      `Invalid role: ${role}. Use admin, member or guest (20, 15, 5).`,
    );
  }
  if (!BY_VALUE.has(role)) {
    throw new Error(
      `Invalid role: ${role}. Use admin, member or guest (20, 15, 5).`,
    );
  }
  return role as RoleValue;
}

/** Renders a numeric role as its human name, for output. Unknown values pass through as-is. */
export function roleName(role: number): string {
  return BY_VALUE.get(role) ?? String(role);
}
