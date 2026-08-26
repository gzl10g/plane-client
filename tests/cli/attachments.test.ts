import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PlaneClient, Attachment } from "../../src/index.js";
import {
  handleAttachmentsList,
  handleAttachmentsUpload,
  handleAttachmentsDownloadUrl,
  handleAttachmentsDelete,
} from "../../src/cli/attachments.js";

const PROJECT = "550e8400-e29b-41d4-a716-446655440000";
const WORK_ITEM = "660e8400-e29b-41d4-a716-446655440000";

describe("attachments CLI handlers", () => {
  let originalLog: typeof console.log;
  let output: string;
  let tmpDir: string;
  let tmpFile: string;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "planec-attachments-"));
    tmpFile = join(tmpDir, "report.pdf");
    writeFileSync(tmpFile, "hello world");
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function captureLog() {
    output = "";
    originalLog = console.log;
    console.log = (msg: string) => {
      output = msg;
    };
  }

  function restoreLog() {
    console.log = originalLog;
  }

  it("handleAttachmentsList prints attachments as JSON", async () => {
    captureLog();
    try {
      const mockAttachment: Attachment = {
        id: "a1",
        asset: "file.pdf",
        attributes: { name: "file.pdf" },
      };
      const mockClient = {
        workItems: {
          attachments: {
            list: async () => [mockAttachment],
          },
        },
      } as unknown as PlaneClient;

      await handleAttachmentsList(WORK_ITEM, { project: PROJECT, json: true }, { client: mockClient });

      const parsed = JSON.parse(output);
      assert.equal(parsed.length, 1);
      assert.equal(parsed[0].id, "a1");
    } finally {
      restoreLog();
    }
  });

  it("handleAttachmentsUpload reads the file and forwards size/name to the resource", async () => {
    captureLog();
    try {
      let uploadArgs: unknown[] = [];
      const mockClient = {
        workItems: {
          attachments: {
            upload: async (...args: unknown[]) => {
              uploadArgs = args;
              return { id: "a2", asset: "report.pdf", is_uploaded: true };
            },
          },
        },
      } as unknown as PlaneClient;

      await handleAttachmentsUpload(
        WORK_ITEM,
        { project: PROJECT, file: tmpFile, type: "application/pdf", json: true },
        { client: mockClient },
      );

      assert.equal(uploadArgs[0], PROJECT);
      assert.equal(uploadArgs[1], WORK_ITEM);
      const input = uploadArgs[2] as { name: string; type?: string; size: number };
      assert.equal(input.name, "report.pdf");
      assert.equal(input.type, "application/pdf");
      assert.equal(input.size, "hello world".length);
      const fileData = uploadArgs[3] as Uint8Array;
      assert.equal(fileData.length, "hello world".length);

      const parsed = JSON.parse(output);
      assert.equal(parsed.id, "a2");
    } finally {
      restoreLog();
    }
  });

  it("handleAttachmentsUpload uses --name to override the basename", async () => {
    captureLog();
    try {
      let uploadArgs: unknown[] = [];
      const mockClient = {
        workItems: {
          attachments: {
            upload: async (...args: unknown[]) => {
              uploadArgs = args;
              return { id: "a3", asset: "custom.pdf" };
            },
          },
        },
      } as unknown as PlaneClient;

      await handleAttachmentsUpload(
        WORK_ITEM,
        { project: PROJECT, file: tmpFile, name: "custom.pdf", json: true },
        { client: mockClient },
      );

      const input = uploadArgs[2] as { name: string };
      assert.equal(input.name, "custom.pdf");
    } finally {
      restoreLog();
    }
  });

  it("handleAttachmentsUpload throws a clear error for a missing file", async () => {
    const mockClient = {
      workItems: { attachments: { upload: async () => ({}) } },
    } as unknown as PlaneClient;

    await assert.rejects(
      () =>
        handleAttachmentsUpload(
          WORK_ITEM,
          { project: PROJECT, file: join(tmpDir, "missing.pdf") },
          { client: mockClient },
        ),
      /Cannot read file/,
    );
  });

  it("handleAttachmentsDownloadUrl prints the URL", async () => {
    captureLog();
    try {
      const mockClient = {
        workItems: {
          attachments: {
            getDownloadUrl: async () => "https://s3.amazonaws.com/bucket/file.pdf?signed",
          },
        },
      } as unknown as PlaneClient;

      await handleAttachmentsDownloadUrl(WORK_ITEM, "a1", { project: PROJECT }, { client: mockClient });

      assert.equal(output, "https://s3.amazonaws.com/bucket/file.pdf?signed");
    } finally {
      restoreLog();
    }
  });

  it("handleAttachmentsDelete calls delete and confirms", async () => {
    captureLog();
    try {
      let deleteArgs: unknown[] = [];
      const mockClient = {
        workItems: {
          attachments: {
            delete: async (...args: unknown[]) => {
              deleteArgs = args;
            },
          },
        },
      } as unknown as PlaneClient;

      await handleAttachmentsDelete(WORK_ITEM, "a1", { project: PROJECT }, { client: mockClient });

      assert.deepEqual(deleteArgs, [PROJECT, WORK_ITEM, "a1"]);
      assert.equal(output, "Attachment deleted");
    } finally {
      restoreLog();
    }
  });
});
