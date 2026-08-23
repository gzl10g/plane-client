import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  handleConfigSet,
  handleConfigShow,
  handleLoginToken,
  handleUseProject,
  handleUseWorkspace,
} from "../../src/cli/config-command.js";
import type { HandlerDeps } from "../../src/cli/shared.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "planec-test-"));
});

afterEach(() => {
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

function captureConsoleLog(): { logs: string[]; restore: () => void } {
  const logs: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.join(" "));
  };
  return {
    logs,
    restore: () => {
      console.log = original;
    },
  };
}

describe("handleConfigSet", () => {
  it("sets a valid key (baseUrl)", async () => {
    const deps: HandlerDeps = { homeDir: tmpDir };
    const capture = captureConsoleLog();

    try {
      await handleConfigSet("baseUrl", "https://api.plane.test", deps);
      assert.equal(capture.logs[0], "baseUrl saved");

      const configPath = path.join(tmpDir, ".planec", "config.json");
      assert(fs.existsSync(configPath));
      const content = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      assert.equal(content.baseUrl, "https://api.plane.test");
    } finally {
      capture.restore();
    }
  });

  it("sets a valid key (apiKey)", async () => {
    const deps: HandlerDeps = { homeDir: tmpDir };
    const capture = captureConsoleLog();

    try {
      await handleConfigSet("apiKey", "pk_test123456789", deps);
      assert.equal(capture.logs[0], "apiKey saved");

      const configPath = path.join(tmpDir, ".planec", "config.json");
      const content = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      assert.equal(content.apiKey, "pk_test123456789");
    } finally {
      capture.restore();
    }
  });

  it("sets a valid key (workspace)", async () => {
    const deps: HandlerDeps = { homeDir: tmpDir };
    const capture = captureConsoleLog();

    try {
      await handleConfigSet("workspace", "my-workspace", deps);
      assert.equal(capture.logs[0], "workspace saved");

      const configPath = path.join(tmpDir, ".planec", "config.json");
      const content = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      assert.equal(content.workspace, "my-workspace");
    } finally {
      capture.restore();
    }
  });

  it("throws error for invalid key", async () => {
    const deps: HandlerDeps = { homeDir: tmpDir };

    try {
      await handleConfigSet("invalidKey", "value", deps);
      assert.fail("Should have thrown");
    } catch (err) {
      assert(err instanceof Error);
      assert(err.message.includes("Invalid key"));
      assert(err.message.includes("invalidKey"));
      assert(err.message.includes("baseUrl"));
      assert(err.message.includes("apiKey"));
      assert(err.message.includes("workspace"));
    }
  });

  it("merges config with existing values", async () => {
    const deps: HandlerDeps = { homeDir: tmpDir };
    const capture = captureConsoleLog();

    try {
      await handleConfigSet("baseUrl", "https://api.test", deps);
      await handleConfigSet("apiKey", "pk_token", deps);

      const configPath = path.join(tmpDir, ".planec", "config.json");
      const content = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      assert.equal(content.baseUrl, "https://api.test");
      assert.equal(content.apiKey, "pk_token");
      assert.equal(content.version, 1);
    } finally {
      capture.restore();
    }
  });
});

describe("handleConfigShow", () => {
  it("displays all config fields", async () => {
    const deps: HandlerDeps = { homeDir: tmpDir };
    const capture = captureConsoleLog();

    try {
      // Set some config
      await handleConfigSet("baseUrl", "https://api.plane.test", deps);
      await handleConfigSet("apiKey", "pk_verylongtoken1234567890", deps);
      await handleConfigSet("workspace", "test-ws", deps);

      // Clear logs from set operations
      capture.logs.length = 0;

      // Now show config
      await handleConfigShow(deps);

      assert.equal(capture.logs.length, 4);
      assert(capture.logs[0].includes("baseUrl"));
      assert(capture.logs[0].includes("https://api.plane.test"));
      assert(capture.logs[1].includes("apiKey"));
      assert(capture.logs[1].includes("****"));
      assert(!capture.logs[1].includes("pk_verylongtoken1234567890"));
      assert(capture.logs[2].includes("workspace"));
      assert(capture.logs[2].includes("test-ws"));
      assert(capture.logs[3].includes("project"));
      assert(capture.logs[3].includes("(not configured)"));
    } finally {
      capture.restore();
    }
  });

  it("masks apiKey correctly with long token", async () => {
    const deps: HandlerDeps = { homeDir: tmpDir };
    const capture = captureConsoleLog();

    try {
      await handleConfigSet("apiKey", "pk_very_long_token_1234567890", deps);
      capture.logs.length = 0;

      await handleConfigShow(deps);

      const apiKeyLine = capture.logs[1];
      assert(apiKeyLine.includes("****7890"));
      assert(!apiKeyLine.includes("pk_very"));
    } finally {
      capture.restore();
    }
  });

  it("masks apiKey correctly with short token", async () => {
    const deps: HandlerDeps = { homeDir: tmpDir };
    const capture = captureConsoleLog();

    try {
      await handleConfigSet("apiKey", "pk12", deps);
      capture.logs.length = 0;

      await handleConfigShow(deps);

      const apiKeyLine = capture.logs[1];
      assert(apiKeyLine.includes("****"));
      assert(!apiKeyLine.includes("pk12"));
    } finally {
      capture.restore();
    }
  });

  it("shows (not configured) for missing fields", async () => {
    const deps: HandlerDeps = { homeDir: tmpDir };
    const capture = captureConsoleLog();

    try {
      // Don't set anything
      await handleConfigShow(deps);

      assert.equal(capture.logs.length, 4);
      assert(capture.logs[0].includes("(not configured)"));
      assert(capture.logs[1].includes("(not configured)"));
      assert(capture.logs[2].includes("(not configured)"));
      assert(capture.logs[3].includes("(not configured)"));
    } finally {
      capture.restore();
    }
  });
});

describe("handleLoginToken", () => {
  it("saves token as apiKey without logging it", async () => {
    const deps: HandlerDeps = { homeDir: tmpDir };
    const capture = captureConsoleLog();

    try {
      await handleLoginToken("pk_token_secret123", deps);

      assert.equal(capture.logs[0], "Token saved successfully");
      // Verify token is NOT in console output
      assert(!capture.logs[0].includes("pk_token"));
      assert(!capture.logs[0].includes("secret123"));

      // Verify token is saved in config
      const configPath = path.join(tmpDir, ".planec", "config.json");
      const content = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      assert.equal(content.apiKey, "pk_token_secret123");
    } finally {
      capture.restore();
    }
  });

  it("overwrites existing apiKey", async () => {
    const deps: HandlerDeps = { homeDir: tmpDir };
    const capture = captureConsoleLog();

    try {
      await handleLoginToken("pk_old_token", deps);
      capture.logs.length = 0;

      await handleLoginToken("pk_new_token", deps);

      const configPath = path.join(tmpDir, ".planec", "config.json");
      const content = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      assert.equal(content.apiKey, "pk_new_token");
    } finally {
      capture.restore();
    }
  });
});

describe("handleUseProject", () => {
  it("saves valid UUID as project", async () => {
    const deps: HandlerDeps = { homeDir: tmpDir };
    const capture = captureConsoleLog();

    try {
      const uuid = "550e8400-e29b-41d4-a716-446655440000";
      await handleUseProject(uuid, deps);

      assert(capture.logs[0].includes("Active project"));
      assert(capture.logs[0].includes(uuid));

      const configPath = path.join(tmpDir, ".planec", "config.json");
      const content = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      assert.equal(content.project, uuid);
    } finally {
      capture.restore();
    }
  });

  it("accepts lowercase UUID", async () => {
    const deps: HandlerDeps = { homeDir: tmpDir };

    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    await handleUseProject(uuid, deps);

    const configPath = path.join(tmpDir, ".planec", "config.json");
    const content = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    assert.equal(content.project, uuid);
  });

  it("accepts uppercase UUID", async () => {
    const deps: HandlerDeps = { homeDir: tmpDir };

    const uuid = "550E8400-E29B-41D4-A716-446655440000";
    await handleUseProject(uuid, deps);

    const configPath = path.join(tmpDir, ".planec", "config.json");
    const content = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    assert.equal(content.project, uuid);
  });

  it("throws error for invalid UUID", async () => {
    const deps: HandlerDeps = { homeDir: tmpDir };

    try {
      await handleUseProject("not-a-uuid", deps);
      assert.fail("Should have thrown");
    } catch (err) {
      assert(err instanceof Error);
      assert(err.message.includes("Invalid project UUID"));
      assert(err.message.includes("not-a-uuid"));
    }
  });

  it("throws error for missing dashes", async () => {
    const deps: HandlerDeps = { homeDir: tmpDir };

    try {
      await handleUseProject("550e8400e29b41d4a716446655440000", deps);
      assert.fail("Should have thrown");
    } catch (err) {
      assert(err instanceof Error);
      assert(err.message.includes("Invalid project UUID"));
    }
  });

  it("throws error for wrong segment lengths", async () => {
    const deps: HandlerDeps = { homeDir: tmpDir };

    try {
      await handleUseProject("550e8400-e29b-41d4-a716-44665544", deps);
      assert.fail("Should have thrown");
    } catch (err) {
      assert(err instanceof Error);
      assert(err.message.includes("Invalid project UUID"));
    }
  });

  it("throws error for non-hex characters", async () => {
    const deps: HandlerDeps = { homeDir: tmpDir };

    try {
      await handleUseProject("550e8400-e29b-41d4-a716-44665544gggg", deps);
      assert.fail("Should have thrown");
    } catch (err) {
      assert(err instanceof Error);
      assert(err.message.includes("Invalid project UUID"));
    }
  });
});

describe("handleUseWorkspace", () => {
  it("saves workspace slug", async () => {
    const deps: HandlerDeps = { homeDir: tmpDir };
    const capture = captureConsoleLog();

    try {
      await handleUseWorkspace("my-workspace", deps);

      assert(capture.logs[0].includes("Active workspace"));
      assert(capture.logs[0].includes("my-workspace"));

      const configPath = path.join(tmpDir, ".planec", "config.json");
      const content = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      assert.equal(content.workspace, "my-workspace");
    } finally {
      capture.restore();
    }
  });

  it("accepts various slug formats", async () => {
    const deps: HandlerDeps = { homeDir: tmpDir };

    const testCases = [
      "workspace-1",
      "workspace_2",
      "workspace123",
      "ws",
      "a",
    ];

    for (const slug of testCases) {
      fs.rmSync(tmpDir, { recursive: true });
      fs.mkdirSync(tmpDir);

      await handleUseWorkspace(slug, deps);

      const configPath = path.join(tmpDir, ".planec", "config.json");
      const content = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      assert.equal(content.workspace, slug);
    }
  });

  it("throws error for empty slug", async () => {
    const deps: HandlerDeps = { homeDir: tmpDir };

    try {
      await handleUseWorkspace("", deps);
      assert.fail("Should have thrown");
    } catch (err) {
      assert(err instanceof Error);
      assert(err.message.includes("cannot be empty"));
    }
  });

  it("throws error for whitespace-only slug", async () => {
    const deps: HandlerDeps = { homeDir: tmpDir };

    try {
      await handleUseWorkspace("   ", deps);
      assert.fail("Should have thrown");
    } catch (err) {
      assert(err instanceof Error);
      assert(err.message.includes("cannot be empty"));
    }
  });

  it("overwrites existing workspace", async () => {
    const deps: HandlerDeps = { homeDir: tmpDir };
    const capture = captureConsoleLog();

    try {
      await handleUseWorkspace("old-ws", deps);
      capture.logs.length = 0;

      await handleUseWorkspace("new-ws", deps);

      const configPath = path.join(tmpDir, ".planec", "config.json");
      const content = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      assert.equal(content.workspace, "new-ws");
    } finally {
      capture.restore();
    }
  });
});
