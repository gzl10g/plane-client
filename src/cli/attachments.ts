import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import { loadConfig, type Config } from "./config.js";
import {
  buildClient,
  formatOutput,
  resolveProjectFromOpts as resolveProject,
  resolveWorkItemId,
  resolveWorkspaceForDisplay,
  warnIfEmpty,
  type HandlerDeps,
  type TableColumn,
} from "./shared.js";
import { PlaneClient } from "../client.js";

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

export async function handleAttachmentsList(
  workItemId: string,
  opts: ListOptions,
  deps?: HandlerDeps,
): Promise<void> {
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const client = resolveClient(deps);
  const projectId = resolveProject(opts, config);
  const resolvedId = await resolveWorkItemId(client, workItemId, projectId);

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
  const projectId = resolveProject(opts, config);
  const resolvedId = await resolveWorkItemId(client, workItemId, projectId);

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
      type: opts.type,
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
  const projectId = resolveProject(opts, config);
  const resolvedId = await resolveWorkItemId(client, workItemId, projectId);

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
  const projectId = resolveProject(opts, config);
  const resolvedId = await resolveWorkItemId(client, workItemId, projectId);

  await client.workItems.attachments.delete(projectId, resolvedId, attachmentId);
  console.log("Attachment deleted");
}
