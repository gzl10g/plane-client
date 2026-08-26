import { loadConfig, saveConfig, mergeConfig } from "./config.js";
import {
  assertLooksLikeIdentifier,
  buildClient,
  findProjectByIdentifier,
  resolveEffectiveConfig,
  type EffectiveSetting,
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

/**
 * Shows the settings the commands will actually use, marking the ones an env
 * var is overriding. Printing the config file alone would make this command lie
 * whenever an override is in play — and this is the first thing anyone runs to
 * work out why a request went to the wrong instance or under the wrong identity.
 */
export async function handleConfigShow(deps?: HandlerDeps): Promise<void> {
  const config = loadConfig({ homeDir: deps?.homeDir });
  const effective = resolveEffectiveConfig(config);

  const render = (setting: EffectiveSetting, mask = false): string => {
    if (setting.value === undefined) return "(not configured)";
    const shown = mask ? maskApiKey(setting.value) : setting.value;
    return setting.source === "env" ? `${shown}  (from ${setting.envVar})` : shown;
  };

  console.log(`baseUrl:   ${render(effective.baseUrl)}`);
  console.log(`apiKey:    ${render(effective.apiKey, true)}`);
  console.log(`workspace: ${render(effective.workspace)}`);
  console.log(`project:   ${render(effective.project)}`);
}

export async function handleLoginToken(
  token: string,
  deps?: HandlerDeps,
): Promise<void> {
  const config = loadConfig({ homeDir: deps?.homeDir });
  const updated = mergeConfig(config, { apiKey: token });
  saveConfig(updated, { homeDir: deps?.homeDir });
  console.log("Token saved successfully");

  // Guardar un token que el entorno tapa es la trampa exacta de la máquina
  // multi-agente: alguien corre `login` para arreglar un 401, ve "saved
  // successfully" y sigue autenticando con la clave de la variable.
  if (resolveEffectiveConfig(updated).apiKey.source === "env") {
    console.error(
      "Warning: PLANE_API_KEY is set and takes precedence, so the saved token will NOT be used. Unset it to use the saved one.",
    );
  }
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
