import { loadConfig, saveConfig, mergeConfig } from "./config.js";
import type { HandlerDeps } from "./shared.js";

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

export async function handleUseProject(
  uuid: string,
  deps?: HandlerDeps,
): Promise<void> {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (!uuidRegex.test(uuid)) {
    throw new Error(`Invalid project UUID: ${uuid}`);
  }

  const config = loadConfig({ homeDir: deps?.homeDir });
  const updated = mergeConfig(config, { project: uuid });
  saveConfig(updated, { homeDir: deps?.homeDir });
  console.log(`Active project: ${uuid}`);
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
