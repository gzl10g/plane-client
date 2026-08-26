import { loadConfig, saveConfig, mergeConfig } from "./config.js";
import {
  assertLooksLikeIdentifier,
  buildClient,
  findProjectByIdentifier,
  type HandlerDeps,
} from "./shared.js";

const VALID_KEYS = ["baseUrl", "apiKey", "workspace"] as const;
type ValidKey = (typeof VALID_KEYS)[number];

function isValidKey(key: string): key is ValidKey {
  return (VALID_KEYS as readonly string[]).includes(key);
}

function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 4) {
    return "****";
  }
  return `****${apiKey.slice(-4)}`;
}

export async function handleConfigSet(
  key: string,
  value: string,
  deps?: HandlerDeps,
): Promise<void> {
  if (!isValidKey(key)) {
    throw new Error(
      `Invalid key: "${key}". Valid keys: ${VALID_KEYS.join(", ")}`,
    );
  }

  const config = loadConfig({ homeDir: deps?.homeDir });
  const updated = mergeConfig(config, { [key]: value });
  saveConfig(updated, { homeDir: deps?.homeDir });
  console.log(`${key} saved`);
}

export async function handleConfigShow(deps?: HandlerDeps): Promise<void> {
  const config = loadConfig({ homeDir: deps?.homeDir });

  const baseUrl = config.baseUrl ?? "(not configured)";
  const apiKey = config.apiKey
    ? maskApiKey(config.apiKey)
    : "(not configured)";
  const workspace = config.workspace ?? "(not configured)";
  const project = config.project ?? "(not configured)";

  console.log(`baseUrl:   ${baseUrl}`);
  console.log(`apiKey:    ${apiKey}`);
  console.log(`workspace: ${workspace}`);
  console.log(`project:   ${project}`);
}

export async function handleLoginToken(
  token: string,
  deps?: HandlerDeps,
): Promise<void> {
  const config = loadConfig({ homeDir: deps?.homeDir });
  const updated = mergeConfig(config, { apiKey: token });
  saveConfig(updated, { homeDir: deps?.homeDir });
  console.log("Token saved successfully");
}

/**
 * Sets the active project, accepting a UUID or the identifier (`planec use PCL`).
 *
 * The identifier is resolved to a UUID **before** saving, not stored as-is: the
 * config is read on every single command, so keeping a prefix there would pay a
 * project listing each time. Resolving once here is the whole point.
 */
export async function handleUseProject(
  ref: string,
  deps?: HandlerDeps,
): Promise<void> {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const config = loadConfig({ homeDir: deps?.homeDir });
  let projectId = ref;
  let note = "";

  if (!uuidRegex.test(ref)) {
    assertLooksLikeIdentifier(ref);
    const client = deps?.client ?? buildClient(config);
    const found = await findProjectByIdentifier(client, ref);
    if (found === null) {
      throw new Error(
        `Project not found: ${ref}. Pass a UUID or an identifier from: planec projects list`,
      );
    }
    projectId = found.id;
    note = ` (${found.identifier} — ${found.name})`;
  }

  const updated = mergeConfig(config, { project: projectId });
  saveConfig(updated, { homeDir: deps?.homeDir });
  console.log(`Active project: ${projectId}${note}`);
}

export async function handleUseWorkspace(
  slug: string,
  deps?: HandlerDeps,
): Promise<void> {
  if (!slug || slug.trim().length === 0) {
    throw new Error("Workspace slug cannot be empty");
  }

  const config = loadConfig({ homeDir: deps?.homeDir });
  const updated = mergeConfig(config, { workspace: slug });
  saveConfig(updated, { homeDir: deps?.homeDir });
  console.log(`Active workspace: ${slug}`);
}
