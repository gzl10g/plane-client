import { describe, it } from "node:test";
import * as assert from "node:assert";
import { handleLabelsList, handleLabelsCreate } from "../../src/cli/labels.js";
import type { PlaneClient } from "../../src/client.js";

describe("labels CLI handlers", () => {
  it("handleLabelsList returns labels as JSON", async () => {
    let output = "";
    const originalLog = console.log;
    console.log = (msg: string) => {
      output = msg;
    };

    try {
      const mockClient = {
        labels: {
          list: async () => [
            { id: "l1", name: "bug", color: "#ff0000" },
            { id: "l2", name: "feature", color: "#00ff00" },
          ],
        },
      } as unknown as PlaneClient;

      await handleLabelsList(
        { project: "test-proj-id", json: true },
        { client: mockClient },
      );

      assert.ok(output, "output should not be empty");
      const parsed = JSON.parse(output);
      assert.strictEqual(Array.isArray(parsed), true, "output should be array");
      assert.strictEqual(parsed.length, 2, "should have 2 labels");
      assert.strictEqual(parsed[0].id, "l1");
      assert.strictEqual(parsed[0].name, "bug");
      assert.strictEqual(parsed[1].name, "feature");
    } finally {
      console.log = originalLog;
    }
  });

  it("handleLabelsList formats as table when not JSON", async () => {
    let output = "";
    const originalLog = console.log;
    console.log = (msg: string) => {
      output = msg;
    };

    try {
      const mockClient = {
        labels: {
          list: async () => [{ id: "l1", name: "bug", color: "#ff0000" }],
        },
      } as unknown as PlaneClient;

      await handleLabelsList(
        { project: "test-proj-id", json: false },
        { client: mockClient },
      );

      assert.ok(output.includes("ID"), "table should have ID column");
      assert.ok(output.includes("Name"), "table should have Name column");
      assert.ok(output.includes("Color"), "table should have Color column");
      assert.ok(output.includes("l1"), "table should contain label id");
    } finally {
      console.log = originalLog;
    }
  });

  it("handleLabelsCreate returns created label as JSON", async () => {
    let output = "";
    const originalLog = console.log;
    console.log = (msg: string) => {
      output = msg;
    };

    try {
      const mockClient = {
        labels: {
          create: async () => ({
            id: "l1",
            name: "bug",
            color: "#ff0000",
          }),
        },
      } as unknown as PlaneClient;

      await handleLabelsCreate(
        {
          project: "test-proj-id",
          name: "bug",
          color: "#ff0000",
          json: true,
        },
        { client: mockClient },
      );

      assert.ok(output, "output should not be empty");
      const parsed = JSON.parse(output);
      assert.strictEqual(parsed.id, "l1");
      assert.strictEqual(parsed.name, "bug");
      assert.strictEqual(parsed.color, "#ff0000");
    } finally {
      console.log = originalLog;
    }
  });

  it("handleLabelsCreate works without color", async () => {
    let output = "";
    const originalLog = console.log;
    console.log = (msg: string) => {
      output = msg;
    };

    try {
      const mockClient = {
        labels: {
          create: async () => ({ id: "l1", name: "task" }),
        },
      } as unknown as PlaneClient;

      await handleLabelsCreate(
        { project: "test-proj-id", name: "task", json: true },
        { client: mockClient },
      );

      assert.ok(output, "output should not be empty");
      const parsed = JSON.parse(output);
      assert.strictEqual(parsed.name, "task");
    } finally {
      console.log = originalLog;
    }
  });

  it("handleLabelsList throws error without project", async () => {
    const mockClient = {
      labels: {
        list: async () => [],
      },
    } as unknown as PlaneClient;

    try {
      await handleLabelsList({ json: true }, { client: mockClient });
      assert.fail("should have thrown error");
    } catch (err: unknown) {
      assert.ok(
        err instanceof Error &&
          err.message.includes("No project specified"),
        "should throw project error",
      );
    }
  });

  it("handleLabelsCreate throws error without project", async () => {
    const mockClient = {
      labels: {
        create: async () => ({ id: "l1", name: "bug" }),
      },
    } as unknown as PlaneClient;

    try {
      await handleLabelsCreate(
        { name: "bug", json: true },
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
});
