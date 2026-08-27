import { describe, it } from "node:test";
import * as assert from "node:assert";
import {
  handleIntakeList,
  handleIntakeCreate,
  handleIntakeAccept,
  handleIntakeDecline,
} from "../../src/cli/intake.js";
import type { PlaneClient } from "../../src/client.js";

describe("intake CLI handlers", () => {
  it("handleIntakeList returns intake issues as JSON", async () => {
    let output = "";
    const originalLog = console.log;
    console.log = (msg: string) => {
      output = msg;
    };

    try {
      const mockClient = {
        intake: {
          list: async () => ({
            items: [
              { id: "i1", name: "Bug report", status: 0 },
              { id: "i2", name: "Feature request", status: 0 },
            ],
            hasNext: false,
          }),
        },
      } as unknown as PlaneClient;

      await handleIntakeList(
        { project: "550e8400-e29b-41d4-a716-446655440000", json: true },
        { client: mockClient },
      );

      assert.ok(output, "output should not be empty");
      const parsed = JSON.parse(output);
      assert.strictEqual(Array.isArray(parsed), true, "output should be array");
      assert.strictEqual(parsed.length, 2, "should have 2 intake issues");
      assert.strictEqual(parsed[0].id, "i1");
      assert.strictEqual(parsed[0].name, "Bug report");
      assert.strictEqual(parsed[1].name, "Feature request");
    } finally {
      console.log = originalLog;
    }
  });

  it("handleIntakeList formats as table when not JSON", async () => {
    let output = "";
    const originalLog = console.log;
    console.log = (msg: string) => {
      output = msg;
    };

    try {
      const mockClient = {
        intake: {
          list: async () => ({
            items: [{ id: "i1", name: "Bug report", status: 0 }],
            hasNext: false,
          }),
        },
      } as unknown as PlaneClient;

      await handleIntakeList(
        { project: "550e8400-e29b-41d4-a716-446655440000", json: false },
        { client: mockClient },
      );

      assert.ok(output.includes("ID"), "table should have ID column");
      assert.ok(output.includes("Name"), "table should have Name column");
      assert.ok(output.includes("Status"), "table should have Status column");
      assert.ok(output.includes("i1"), "table should contain issue id");
    } finally {
      console.log = originalLog;
    }
  });

  it("handleIntakeCreate returns created intake issue as JSON", async () => {
    let output = "";
    const originalLog = console.log;
    console.log = (msg: string) => {
      output = msg;
    };

    try {
      const mockClient = {
        intake: {
          create: async () => ({
            id: "i1",
            name: "Bug report",
            status: 0,
          }),
        },
      } as unknown as PlaneClient;

      await handleIntakeCreate(
        {
          project: "550e8400-e29b-41d4-a716-446655440000",
          name: "Bug report",
          priority: "high",
          json: true,
        },
        { client: mockClient },
      );

      assert.ok(output, "output should not be empty");
      const parsed = JSON.parse(output);
      assert.strictEqual(parsed.id, "i1");
      assert.strictEqual(parsed.name, "Bug report");
      assert.strictEqual(parsed.status, 0);
    } finally {
      console.log = originalLog;
    }
  });

  it("handleIntakeCreate works with description HTML", async () => {
    let output = "";
    const originalLog = console.log;
    console.log = (msg: string) => {
      output = msg;
    };

    try {
      const mockClient = {
        intake: {
          create: async () => ({
            id: "i1",
            name: "Issue",
            status: 0,
          }),
        },
      } as unknown as PlaneClient;

      await handleIntakeCreate(
        {
          project: "550e8400-e29b-41d4-a716-446655440000",
          name: "Issue",
          descriptionHtml: "<p>Test</p>",
          json: true,
        },
        { client: mockClient },
      );

      assert.ok(output, "output should not be empty");
      const parsed = JSON.parse(output);
      assert.strictEqual(parsed.name, "Issue");
    } finally {
      console.log = originalLog;
    }
  });

  it("handleIntakeAccept logs success", async () => {
    let output = "";
    const originalLog = console.log;
    console.log = (msg: string) => {
      output = msg;
    };

    try {
      const mockClient = {
        intake: {
          accept: async () => undefined,
        },
      } as unknown as PlaneClient;

      await handleIntakeAccept(
        "i1",
        { project: "550e8400-e29b-41d4-a716-446655440000" },
        { client: mockClient },
      );

      assert.strictEqual(output, "Intake accepted");
    } finally {
      console.log = originalLog;
    }
  });

  it("handleIntakeDecline logs success", async () => {
    let output = "";
    const originalLog = console.log;
    console.log = (msg: string) => {
      output = msg;
    };

    try {
      const mockClient = {
        intake: {
          decline: async () => undefined,
        },
      } as unknown as PlaneClient;

      await handleIntakeDecline(
        "i1",
        { project: "550e8400-e29b-41d4-a716-446655440000" , yes: true },
        { client: mockClient },
      );

      assert.strictEqual(output, "Intake declined");
    } finally {
      console.log = originalLog;
    }
  });

  it("handleIntakeList throws error without project", async () => {
    const mockClient = {
      intake: {
        list: async () => ({ items: [], hasNext: false }),
      },
    } as unknown as PlaneClient;

    try {
      await handleIntakeList({ json: true }, { client: mockClient, config: { version: 1 } });
      assert.fail("should have thrown error");
    } catch (err: unknown) {
      assert.ok(
        err instanceof Error &&
          err.message.includes("No project specified"),
        "should throw project error",
      );
    }
  });

  it("handleIntakeCreate throws error without project", async () => {
    const mockClient = {
      intake: {
        create: async () => ({ id: "i1", name: "Issue", status: 0 }),
      },
    } as unknown as PlaneClient;

    try {
      await handleIntakeCreate(
        { name: "Issue", json: true },
        { client: mockClient, config: { version: 1 } },
      );
      assert.fail("should have thrown error");
    } catch (err: unknown) {
      assert.ok(
        err instanceof Error &&
          err.message.includes("No project specified"),
        "should throw project error",
      );
    }
  });

  it("handleIntakeAccept throws error without project", async () => {
    const mockClient = {
      intake: {
        accept: async () => undefined,
      },
    } as unknown as PlaneClient;

    try {
      await handleIntakeAccept("i1", {}, { client: mockClient, config: { version: 1 } });
      assert.fail("should have thrown error");
    } catch (err: unknown) {
      assert.ok(
        err instanceof Error &&
          err.message.includes("No project specified"),
        "should throw project error",
      );
    }
  });

  it("handleIntakeDecline throws error without project", async () => {
    const mockClient = {
      intake: {
        decline: async () => undefined,
      },
    } as unknown as PlaneClient;

    try {
      await handleIntakeDecline("i1", {}, { client: mockClient, config: { version: 1 } });
      assert.fail("should have thrown error");
    } catch (err: unknown) {
      assert.ok(
        err instanceof Error &&
          err.message.includes("No project specified"),
        "should throw project error",
      );
    }
  });

  // El listado trae el título dentro de issue_detail, no en la raíz: la tabla
  // imprimía Name vacío y un `-2` crudo, y parecía una llamada fallida.
  it("handleIntakeList takes the name from issue_detail when the root has none", async () => {
    let output = "";
    const originalLog = console.log;
    console.log = (msg: string) => { output = msg; };

    try {
      const mockClient = {
        intake: {
          list: async () => ({
            items: [{ id: "i1", issue_detail: { name: "primer intake" }, status: -2 }],
            hasNext: false,
          }),
        },
      } as unknown as PlaneClient;

      await handleIntakeList(
        { project: "550e8400-e29b-41d4-a716-446655440000", json: false },
        { client: mockClient },
      );

      assert.ok(output.includes("primer intake"), "the table must show the work item title");
      assert.ok(output.includes("pending (-2)"), "the status must be labelled, keeping the code");
    } finally {
      console.log = originalLog;
    }
  });

  it("handleIntakeList labels every known status and keeps unknown codes bare", async () => {
    let output = "";
    const originalLog = console.log;
    console.log = (msg: string) => { output = msg; };

    try {
      const mockClient = {
        intake: {
          list: async () => ({
            items: [
              { id: "i1", issue_detail: { name: "a" }, status: -2 },
              { id: "i2", issue_detail: { name: "b" }, status: -1 },
              { id: "i3", issue_detail: { name: "c" }, status: 0 },
              { id: "i4", issue_detail: { name: "d" }, status: 1 },
              { id: "i5", issue_detail: { name: "e" }, status: 2 },
              { id: "i6", issue_detail: { name: "f" }, status: 99 },
            ],
            hasNext: false,
          }),
        },
      } as unknown as PlaneClient;

      await handleIntakeList(
        { project: "550e8400-e29b-41d4-a716-446655440000", json: false },
        { client: mockClient },
      );

      for (const label of ["pending (-2)", "declined (-1)", "snoozed (0)", "accepted (1)", "duplicate (2)"]) {
        assert.ok(output.includes(label), `missing status label: ${label}`);
      }
      // Un código nuevo se muestra tal cual antes que traducirse mal.
      assert.ok(/\s99\s/.test(output), "an unknown status must show as the bare number");
      assert.ok(!output.includes("(99)"), "an unknown status must not be given a label");
    } finally {
      console.log = originalLog;
    }
  });

  it("handleIntakeList --json keeps the raw API objects untouched", async () => {
    let output = "";
    const originalLog = console.log;
    console.log = (msg: string) => { output = msg; };

    try {
      const mockClient = {
        intake: {
          list: async () => ({
            items: [{ id: "i1", issue_detail: { name: "crudo" }, status: -2 }],
            hasNext: false,
          }),
        },
      } as unknown as PlaneClient;

      await handleIntakeList(
        { project: "550e8400-e29b-41d4-a716-446655440000", json: true },
        { client: mockClient },
      );

      const parsed = JSON.parse(output);
      // El aplanado es solo para la tabla: --json no debe perder issue_detail
      // ni convertir el status en una cadena.
      assert.strictEqual(parsed[0].issue_detail.name, "crudo");
      assert.strictEqual(parsed[0].status, -2);
    } finally {
      console.log = originalLog;
    }
  });

  // PCL-5 / PCL-7 sobre la cola de intake.
  it("accept emits JSON with --json", async () => {
    let output = "";
    const originalLog = console.log;
    console.log = (msg: string) => { output = msg; };

    try {
      const mockClient = {
        intake: { accept: async () => undefined },
      } as unknown as PlaneClient;

      await handleIntakeAccept("i1", { project: "550e8400-e29b-41d4-a716-446655440000", json: true }, { client: mockClient });

      const parsed = JSON.parse(output) as { ok: boolean; accepted: string };
      assert.strictEqual(parsed.ok, true);
      assert.strictEqual(parsed.accepted, "i1");
    } finally {
      console.log = originalLog;
    }
  });

  it("decline keeps the human sentence without --json", async () => {
    let output = "";
    const originalLog = console.log;
    console.log = (msg: string) => { output = msg; };

    try {
      const mockClient = {
        intake: { decline: async () => undefined },
      } as unknown as PlaneClient;

      await handleIntakeDecline("i1", { project: "550e8400-e29b-41d4-a716-446655440000" , yes: true }, { client: mockClient });

      assert.strictEqual(output, "Intake declined");
    } finally {
      console.log = originalLog;
    }
  });

  it("warns on stderr when the queue listing was cut short", async () => {
    const errors: string[] = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = () => {};
    console.error = (msg: string) => { errors.push(String(msg)); };

    try {
      const mockClient = {
        intake: {
          list: async () => ({ items: [{ id: "i1", name: "One", status: -2 }], hasNext: true, total: 30 }),
        },
      } as unknown as PlaneClient;

      await handleIntakeList(
        { project: "550e8400-e29b-41d4-a716-446655440000", json: true },
        { client: mockClient },
      );

      assert.ok(errors.some((e) => e.includes("--all")));
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }
  });

  it("--all walks every page instead of the first", async () => {
    let output = "";
    const originalLog = console.log;
    console.log = (msg: string) => { output = msg; };

    try {
      const mockClient = {
        intake: {
          list: async () => { throw new Error("--all must not use the single-page list()"); },
          listAll: async function* () {
            yield { id: "i1", name: "One", status: -2 };
            yield { id: "i2", name: "Two", status: -2 };
          },
        },
      } as unknown as PlaneClient;

      await handleIntakeList(
        { project: "550e8400-e29b-41d4-a716-446655440000", all: true, json: true },
        { client: mockClient },
      );

      assert.strictEqual((JSON.parse(output) as unknown[]).length, 2);
    } finally {
      console.log = originalLog;
    }
  });
});
