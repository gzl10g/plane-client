import type { RequestFn } from "../client.js";
import { PlaneApiError } from "../error.js";
import type { Attachment, AttachmentUploadCredentials, CreateAttachmentInput } from "../types.js";

/**
 * Uploads file bytes directly to storage using the presigned POST credentials
 * returned by the create-attachment step. Not part of the Plane API — a plain
 * POST straight to S3, so it bypasses `RequestFn` (no auth header, no
 * `/api/v1/workspaces/...` base).
 */
async function uploadToStorage(
  uploadData: AttachmentUploadCredentials["upload_data"],
  fileData: Uint8Array,
  contentType: string,
  filename: string,
): Promise<void> {
  const form = new FormData();
  // Field order matters for S3 presigned POST: policy/signature fields must
  // precede `file`, which has to be the last field in the multipart body.
  for (const [key, value] of Object.entries(uploadData.fields)) {
    form.append(key, value);
  }
  form.append("file", new Blob([fileData as BlobPart], { type: contentType }), filename);

  const res = await fetch(uploadData.url, { method: "POST", body: form });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new PlaneApiError(res.status, res.statusText, undefined, body || undefined);
  }
}

/**
 * Resource for file attachments on work items — including intake work items,
 * which are regular issues under the hood (resolve the intake record to its
 * `issue` id via {@link IntakeResource.resolveIssueId} first).
 *
 * Uploading is a 3-step presigned-URL flow, encapsulated by {@link upload}:
 * 1. `POST .../attachments/` — create the attachment record, get S3 credentials.
 * 2. `POST` the file straight to S3 with those credentials.
 * 3. `PATCH .../attachments/{id}/` — confirm the upload (`is_uploaded: true`).
 */
export class AttachmentsResource {
  constructor(private readonly request: RequestFn) {}

  /**
   * Lists attachments on a work item. Only returns attachments that
   * completed the upload flow (the API filters out `is_uploaded=false` records).
   * @param projectId - Project UUID
   * @param workItemId - Work item (or intake issue) UUID
   * @returns Array of attachments, empty array if none
   */
  async list(projectId: string, workItemId: string): Promise<Attachment[]> {
    const data = await this.request<Attachment[] | { results?: Attachment[] }>(
      `/projects/${projectId}/work-items/${workItemId}/attachments/`,
    );
    if (!data) return [];
    return Array.isArray(data) ? data : (data.results ?? []);
  }

  /**
   * Uploads a file as a work item attachment, driving the full presigned-URL
   * flow (credentials → storage upload → confirm) in one call.
   * @param projectId - Project UUID
   * @param workItemId - Work item (or intake issue) UUID
   * @param input - Filename, MIME type and size metadata
   * @param fileData - Raw file bytes
   * @returns The attachment record, with `is_uploaded` set to `true`
   */
  async upload(
    projectId: string,
    workItemId: string,
    input: CreateAttachmentInput,
    fileData: Uint8Array,
  ): Promise<Attachment> {
    const body: Record<string, unknown> = { name: input.name, size: input.size };
    if (input.type !== undefined) body.type = input.type;
    if (input.externalId !== undefined) body.external_id = input.externalId;
    if (input.externalSource !== undefined) body.external_source = input.externalSource;

    const credentials = await this.request<AttachmentUploadCredentials>(
      `/projects/${projectId}/work-items/${workItemId}/attachments/`,
      { method: "POST", body },
    );

    await uploadToStorage(
      credentials.upload_data,
      fileData,
      input.type ?? "application/octet-stream",
      input.name,
    );

    await this.request<void>(
      `/projects/${projectId}/work-items/${workItemId}/attachments/${credentials.asset_id}/`,
      { method: "PATCH", body: { is_uploaded: true } },
    );

    return { ...credentials.attachment, is_uploaded: true };
  }

  /**
   * Resolves the presigned download URL for an attachment. The detail GET
   * endpoint does not return JSON metadata — it 302-redirects to a presigned
   * S3 URL — so this follows the redirect manually and returns the
   * `Location` header instead of trying to parse a JSON body.
   * @param projectId - Project UUID
   * @param workItemId - Work item (or intake issue) UUID
   * @param attachmentId - Attachment UUID
   * @returns The presigned download URL
   */
  async getDownloadUrl(projectId: string, workItemId: string, attachmentId: string): Promise<string> {
    const location = await this.request<string | null>(
      `/projects/${projectId}/work-items/${workItemId}/attachments/${attachmentId}/`,
      { redirect: "manual" },
    );
    if (!location) {
      throw new Error(`No redirect Location header returned for attachment ${attachmentId}`);
    }
    return location;
  }

  /**
   * Deletes (soft-deletes) an attachment from a work item.
   * @param projectId - Project UUID
   * @param workItemId - Work item (or intake issue) UUID
   * @param attachmentId - Attachment UUID
   */
  async delete(projectId: string, workItemId: string, attachmentId: string): Promise<void> {
    await this.request(
      `/projects/${projectId}/work-items/${workItemId}/attachments/${attachmentId}/`,
      { method: "DELETE" },
    );
  }
}
