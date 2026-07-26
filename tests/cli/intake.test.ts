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
        { project: "test-proj-id", json: true },
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
        { project: "test-proj-id", json: false },
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
          project: "test-proj-id",
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
          project: "test-proj-id",
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
        { project: "test-proj-id" },
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
        { project: "test-proj-id" },
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
      await handleIntakeList({ json: true }, { client: mockClient });
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
        { client: mockClient },
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
      await handleIntakeAccept("i1", {}, { client: mockClient });
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
      await handleIntakeDecline("i1", {}, { client: mockClient });
      assert.fail("should have thrown error");
    } catch (err: unknown) {
      assert.ok(
        err instanceof Error &&
          err.message.includes("No project specified"),
        "should throw project error",
      );
    }
  });
});
