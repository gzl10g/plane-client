import { loadConfig, saveConfig, mergeConfig } from "./config.js";
import {
  assertLooksLikeIdentifier,
  buildClient,
  findProjectByIdentifier,
  NotFoundError,
  reportAction,
  resolveEffectiveConfig,
  type EffectiveSetting,
  type HandlerDeps,
  UsageError,
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
  opts: { json?: boolean } = {},
  deps?: HandlerDeps,
): Promise<void> {
  if (!isValidKey(key)) {
    throw new UsageError(`Invalid key: "${key}". Valid keys: ${VALID_KEYS.join(", ")}`);
  }

  // Recortado como en `login` y en `--stdin`: `config set apiKey "$(cat key.txt)"`
  // guardaba el salto de línea final, y undici rechaza esa cabecera con un error
  // opaco justo en la zona que este release intenta hacer legible.
  const config = loadConfig({ homeDir: deps?.homeDir });
  const updated = mergeConfig(config, { [key]: value.trim() });
  saveConfig(updated, { homeDir: deps?.homeDir });
  reportAction(opts, `${key} saved`, { key });
}

/**
 * Shows the settings the commands will actually use, marking the ones an env
 * var is overriding. Printing the config file alone would make this command lie
 * whenever an override is in play — and this is the first thing anyone runs to
 * work out why a request went to the wrong instance or under the wrong identity.
 */
export async function handleConfigShow(
  opts: { json?: boolean } = {},
  deps?: HandlerDeps,
): Promise<void> {
  const config = loadConfig({ homeDir: deps?.homeDir });
  const effective = resolveEffectiveConfig(config);

  const render = (setting: EffectiveSetting, mask = false): string => {
    if (setting.value === undefined) return "(not configured)";
    const shown = mask ? maskApiKey(setting.value) : setting.value;
    if (setting.source === "env") return `${shown}  (from ${setting.envVar})`;
    if (setting.source === "flag") return `${shown}  (from --workspace)`;
    return shown;
  };

  if (opts.json) {
    // The whole point of this command is which layer won, so `source` is part
    // of the payload, not decoration. The key stays masked: this output ends up
    // in logs and issue reports.
    console.log(
      JSON.stringify(
        {
          baseUrl: { value: effective.baseUrl.value, source: effective.baseUrl.source },
          apiKey: {
            value:
              effective.apiKey.value === undefined
                ? undefined
                : maskApiKey(effective.apiKey.value),
            source: effective.apiKey.source,
          },
          workspace: { value: effective.workspace.value, source: effective.workspace.source },
          project: { value: effective.project.value, source: effective.project.source },
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(`baseUrl:   ${render(effective.baseUrl)}`);
  console.log(`apiKey:    ${render(effective.apiKey, true)}`);
  console.log(`workspace: ${render(effective.workspace)}`);
  console.log(`project:   ${render(effective.project)}`);
}

export async function handleLoginToken(
  token: string,
  opts: { json?: boolean } = {},
  deps?: HandlerDeps,
): Promise<void> {
  const trimmed = token.trim();
  if (trimmed === "") {
    throw new Error("Empty token. Pipe the token into --token-stdin, or pass --token <value>.");
  }
  const config = loadConfig({ homeDir: deps?.homeDir });
  const updated = mergeConfig(config, { apiKey: trimmed });
  saveConfig(updated, { homeDir: deps?.homeDir });
  reportAction(opts, "Token saved successfully", { saved: true });

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
  opts: { json?: boolean } = {},
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
      throw new NotFoundError(
        `Project not found: ${ref}. Pass a UUID or an identifier from: planec projects list`,
      );
    }
    projectId = found.id;
    note = ` (${found.identifier} — ${found.name})`;
  }

  const updated = mergeConfig(config, { project: projectId });
  saveConfig(updated, { homeDir: deps?.homeDir });
  reportAction(opts, `Active project: ${projectId}${note}`, { project: projectId });
}

export async function handleUseWorkspace(
  slug: string,
  opts: { json?: boolean } = {},
  deps?: HandlerDeps,
): Promise<void> {
  if (!slug || slug.trim().length === 0) {
    throw new Error("Workspace slug cannot be empty");
  }

  const config = loadConfig({ homeDir: deps?.homeDir });
  const updated = mergeConfig(config, { workspace: slug });
  saveConfig(updated, { homeDir: deps?.homeDir });
  reportAction(opts, `Active workspace: ${slug}`, { workspace: slug });
}

/**
 * Saves a workspace to the list the cross-workspace report sweeps.
 *
 * This list is the report's only human input, and it exists because the API
 * cannot provide it: v1 has no route that lists workspaces (verified — both
 * `/workspaces/` and `/users/me/workspaces/` are 404s of route). Nothing else in
 * the CLI reads it; the active workspace stays `workspace use`.
 */
export async function handleWorkspaceAdd(
  slug: string,
  opts: { json?: boolean } = {},
  deps?: HandlerDeps,
): Promise<void> {
  if (!slug || slug.trim().length === 0) {
    throw new Error("Workspace slug cannot be empty");
  }
  const trimmed = slug.trim();
  const config = loadConfig({ homeDir: deps?.homeDir });
  const current = config.workspaces ?? [];

  if (current.includes(trimmed)) {
    reportAction(opts, `Workspace ${trimmed} was already on the report list`, {
      workspaces: current,
      added: false,
    });
    return;
  }

  const workspaces = [...current, trimmed];
  saveConfig(mergeConfig(config, { workspaces }), { homeDir: deps?.homeDir });
  reportAction(opts, `Added ${trimmed}. Report workspaces: ${workspaces.join(", ")}`, {
    workspaces,
    added: true,
  });
}

/** Removes a workspace from the report list. */
export async function handleWorkspaceRemove(
  slug: string,
  opts: { json?: boolean } = {},
  deps?: HandlerDeps,
): Promise<void> {
  // `add` stores the trimmed slug, so `remove` has to trim too — otherwise
  // `add " ws "` saves `ws` and `remove " ws "` swears it was never there.
  const trimmed = slug.trim();
  const config = loadConfig({ homeDir: deps?.homeDir });
  const current = config.workspaces ?? [];
  if (!current.includes(trimmed)) {
    throw new Error(
      `Workspace ${trimmed} is not on the report list. Current: ${current.join(", ") || "(empty)"}`,
    );
  }
  const workspaces = current.filter((w) => w !== trimmed);
  saveConfig(mergeConfig(config, { workspaces }), { homeDir: deps?.homeDir });
  reportAction(opts, `Removed ${trimmed}. Report workspaces: ${workspaces.join(", ") || "(empty)"}`, {
    workspaces,
  });
}

/** Lists the workspaces the report will sweep, and the active one. */
export async function handleWorkspaceList(
  opts: { json?: boolean } = {},
  deps?: HandlerDeps,
): Promise<void> {
  const config = loadConfig({ homeDir: deps?.homeDir });
  const workspaces = config.workspaces ?? [];
  const active = resolveEffectiveConfig(config).workspace.value;

  if (opts.json) {
    console.log(JSON.stringify({ active, workspaces }, null, 2));
    return;
  }
  console.log(`Active workspace: ${active ?? "(not configured)"}`);
  if (workspaces.length === 0) {
    console.log("Report workspaces: (none) — add them with: planec workspace add <slug>");
    return;
  }
  console.log(`Report workspaces: ${workspaces.join(", ")}`);
}
