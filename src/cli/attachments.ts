import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import { loadConfig, type Config } from "./config.js";
import {
  AbortedError,
  buildClient,
  confirmAction,
  formatOutput,
  reportAction,
  resolveProjectFromOpts as resolveProject,
  resolveWorkItemId,
  resolveWorkspaceForDisplay,
  warnIfEmpty,
  type HandlerDeps,
  type TableColumn,
} from "./shared.js";
import type { PlaneClient } from "../client.js";
import { PlaneApiError } from "../error.js";

interface ListOptions {
  project?: string;
  json?: boolean;
}

interface UploadOptions {
  project?: string;
  file: string;
  type?: string;
  name?: string;
  json?: boolean;
}

interface DeleteOptions {
  project?: string;
  yes?: boolean;
  json?: boolean;
}

interface DownloadUrlOptions {
  project?: string;
  json?: boolean;
}

function resolveClient(deps?: HandlerDeps): PlaneClient {
  if (deps?.client) return deps.client;
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  return buildClient(config);
}

/**
 * MIME types by extension, for `attachments upload`.
 *
 * Plane rejects an upload whose type it does not recognise with
 * `400 {"error":"Invalid file type."}`, and the client used to send nothing at
 * all unless `--type` was passed — so the obvious form of the command,
 * `upload PROJ-42 --file photo.png`, failed every single time. Guessing from
 * the extension is what every other tool does here.
 */
const MIME_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".json": "application/json",
  ".xml": "application/xml",
  ".yaml": "application/yaml",
  ".yml": "application/yaml",
  ".html": "text/html",
  ".log": "text/plain",
  ".zip": "application/zip",
  ".gz": "application/gzip",
  ".tar": "application/x-tar",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

/**
 * The MIME type to declare for a file, from `--type` or from its extension.
 * @throws Error if neither is available, naming the flag to pass
 */
export function resolveMimeType(filePath: string, explicit?: string): string {
  if (explicit !== undefined && explicit.trim() !== "") return explicit;
  const dot = filePath.lastIndexOf(".");
  const ext = dot === -1 ? "" : filePath.slice(dot).toLowerCase();
  const guessed = MIME_BY_EXTENSION[ext];
  if (guessed !== undefined) return guessed;
  throw new Error(
    `Cannot tell the MIME type of ${filePath} from its extension. Pass --type <mimeType> (Plane rejects an upload without one).`,
  );
}

const ATTACHMENT_COLUMNS: TableColumn[] = [
  { key: "id", label: "ID", width: 36 },
  { key: "name", label: "Name", width: 30 },
  { key: "size", label: "Size", width: 10 },
];

function flattenForTable(items: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return items.map((item) => {
    const attrs = (item.attributes as Record<string, unknown> | undefined) ?? {};
    return { ...item, name: attrs.name ?? item.asset };
  });
}

/**
 * Resolves the work item an attachment belongs to, accepting an intake record
 * id as well.
 *
 * `intake list` prints the **record** id in its ID column, and that id is a 404
 * for the attachment endpoints — the same wrong-id trap that `intake accept`
 * had, at a different door. Copying an id straight out of a listing has to
 * work, so this falls back to the intake queue's own resolver.
 */
async function resolveAttachmentTarget(
  client: PlaneClient,
  projectId: string,
  ref: string,
): Promise<string> {
  const resolved = await resolveWorkItemId(client, ref, projectId);
  try {
    return await client.intake.resolveIssueId(projectId, resolved);
  } catch (err) {
    // Punto medio entre dos riesgos reales. Un catch desnudo convertía un 429 a
    // mitad del barrido de la cola en "usa el id normal", y el usuario acababa
    // leyendo "el adjunto no existe" cuando lo que hubo fue rate limit. Pero
    // relanzarlo TODO rompe el caso corriente: un token que lee work items y no
    // tiene permiso sobre intake (403, documentado como plausible) dejaría de
    // poder listar adjuntos de un work item que nada tiene que ver con intake.
    //
    // Así que 429 y 5xx suben — son transitorios y el usuario debe verlos —, y
    // 403/404 degradan al id normal, que es la respuesta correcta cuando el
    // proyecto no tiene cola o no podemos mirarla.
    const transient =
      err instanceof PlaneApiError && (err.isRateLimit || err.status >= 500);
    if (transient) throw err;
    return resolved;
  }
}

export async function handleAttachmentsList(
  workItemId: string,
  opts: ListOptions,
  deps?: HandlerDeps,
): Promise<void> {
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const client = resolveClient(deps);
  const projectId = await resolveProject(opts, config, client);
  const resolvedId = await resolveAttachmentTarget(client, projectId, workItemId);

  const items = await client.workItems.attachments.list(projectId, resolvedId);

  formatOutput(flattenForTable(items as Array<Record<string, unknown>>), { json: opts.json }, ATTACHMENT_COLUMNS);
  warnIfEmpty(items.length, {
    workspace: resolveWorkspaceForDisplay(config),
    project: projectId,
  });
}

export async function handleAttachmentsUpload(
  workItemId: string,
  opts: UploadOptions,
  deps?: HandlerDeps,
): Promise<void> {
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const client = resolveClient(deps);
  const projectId = await resolveProject(opts, config, client);
  const resolvedId = await resolveAttachmentTarget(client, projectId, workItemId);

  let fileData: Buffer;
  let size: number;
  try {
    fileData = readFileSync(opts.file);
    size = statSync(opts.file).size;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot read file ${opts.file}: ${message}`, { cause: err });
  }

  const attachment = await client.workItems.attachments.upload(
    projectId,
    resolvedId,
    {
      name: opts.name ?? basename(opts.file),
      type: resolveMimeType(opts.file, opts.type),
      size,
    },
    fileData,
  );

  formatOutput(attachment, { json: opts.json });
}

export async function handleAttachmentsDownloadUrl(
  workItemId: string,
  attachmentId: string,
  opts: DownloadUrlOptions,
  deps?: HandlerDeps,
): Promise<void> {
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const client = resolveClient(deps);
  const projectId = await resolveProject(opts, config, client);
  const resolvedId = await resolveAttachmentTarget(client, projectId, workItemId);

  const url = await client.workItems.attachments.getDownloadUrl(projectId, resolvedId, attachmentId);

  if (opts.json) {
    formatOutput({ url }, { json: true });
  } else {
    console.log(url);
  }
}

export async function handleAttachmentsDelete(
  workItemId: string,
  attachmentId: string,
  opts: DeleteOptions,
  deps?: HandlerDeps,
): Promise<void> {
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const client = resolveClient(deps);
  const projectId = await resolveProject(opts, config, client);
  const resolvedId = await resolveAttachmentTarget(client, projectId, workItemId);

  if (!opts.yes) {
    const ok = await confirmAction(`Delete attachment ${attachmentId}? This cannot be undone.`);
    if (!ok) throw new AbortedError();
  }

  await client.workItems.attachments.delete(projectId, resolvedId, attachmentId);
  reportAction(opts, "Attachment deleted", { deleted: attachmentId });
}
