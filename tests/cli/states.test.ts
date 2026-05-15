import { describe, it, before } from "node:test";
import * as assert from "node:assert";
import { handleStatesList } from "../../src/cli/states.js";
import type { PlaneClient } from "../../src/client.js";

describe("states CLI handlers", () => {
  it("handleStatesList returns states as JSON", async () => {
    let output = "";
    const originalLog = console.log;
    console.log = (msg: string) => {
      output = msg;
    };

    try {
      const mockClient = {
        states: {
          list: async () => [
            {
              id: "s1",
              name: "Todo",
              group: "unstarted",
              color: "#aaa",
            },
            {
              id: "s2",
              name: "Done",
              group: "completed",
              color: "#0f0",
            },
          ],
        },
      } as unknown as PlaneClient;

      await handleStatesList(
        { project: "test-proj-id", json: true },
        { client: mockClient },
      );

      assert.ok(output, "output should not be empty");
      const parsed = JSON.parse(output);
      assert.strictEqual(Array.isArray(parsed), true, "output should be array");
      assert.strictEqual(parsed.length, 2, "should have 2 states");
      assert.strictEqual(parsed[0].id, "s1");
      assert.strictEqual(parsed[0].name, "Todo");
      assert.strictEqual(parsed[1].group, "completed");
    } finally {
      console.log = originalLog;
    }
  });

  it("handleStatesList formats as table when not JSON", async () => {
    let output = "";
    const originalLog = console.log;
    console.log = (msg: string) => {
      output = msg;
    };

    try {
      const mockClient = {
        states: {
          list: async () => [
            { id: "s1", name: "Todo", group: "unstarted", color: "#aaa" },
          ],
        },
      } as unknown as PlaneClient;

      await handleStatesList(
        { project: "test-proj-id", json: false },
        { client: mockClient },
      );

      assert.ok(output.includes("ID"), "table should have ID column");
      assert.ok(output.includes("Name"), "table should have Name column");
      assert.ok(output.includes("Group"), "table should have Group column");
      assert.ok(output.includes("s1"), "table should contain state id");
    } finally {
      console.log = originalLog;
    }
  });

  it("handleStatesList throws error without project", async () => {
    const mockClient = {
      states: {
        list: async () => [],
      },
    } as unknown as PlaneClient;

    try {
      await handleStatesList({ json: true }, { client: mockClient });
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
