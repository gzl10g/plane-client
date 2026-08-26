import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadConfig, saveConfig, mergeConfig, type Config } from "../../src/cli/config.js";

describe("cli/config", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `plane-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("loadConfig", () => {
    it("returns { version: 1 } when file does not exist", () => {
      const config = loadConfig({ homeDir: testDir });
      assert.deepEqual(config, { version: 1 });
    });

    it("loads and returns config when file exists", () => {
      const configDir = path.join(testDir, ".planec");
      fs.mkdirSync(configDir, { recursive: true });
      const configFile = path.join(configDir, "config.json");
      const expected: Config = {
        version: 1,
        baseUrl: "https://plane.example.com",
        apiKey: "test-key",
        workspace: "test-workspace",
        project: "test-project-uuid",
      };
      fs.writeFileSync(configFile, JSON.stringify(expected, null, 2), "utf-8");

      const config = loadConfig({ homeDir: testDir });
      assert.deepEqual(config, expected);
    });

    it("throws error if version is not 1", () => {
      const configDir = path.join(testDir, ".planec");
      fs.mkdirSync(configDir, { recursive: true });
      const configFile = path.join(configDir, "config.json");
      fs.writeFileSync(configFile, JSON.stringify({ version: 2, baseUrl: "https://example.com" }, null, 2), "utf-8");

      assert.throws(
        () => loadConfig({ homeDir: testDir }),
        (err: Error) => err.message.includes("expected version 1"),
      );
    });

    it("throws error if parsed value is not an object", () => {
      const configDir = path.join(testDir, ".planec");
      fs.mkdirSync(configDir, { recursive: true });
      const configFile = path.join(configDir, "config.json");
      fs.writeFileSync(configFile, JSON.stringify("invalid", null, 2), "utf-8");

      assert.throws(
        () => loadConfig({ homeDir: testDir }),
        (err: Error) => err.message.includes("expected version 1"),
      );
    });

    it("throws error if parsed value is null", () => {
      const configDir = path.join(testDir, ".planec");
      fs.mkdirSync(configDir, { recursive: true });
      const configFile = path.join(configDir, "config.json");
      fs.writeFileSync(configFile, "null", "utf-8");

      assert.throws(
        () => loadConfig({ homeDir: testDir }),
        (err: Error) => err.message.includes("expected version 1"),
      );
    });
  });

  describe("saveConfig", () => {
    it("creates directory and saves config", () => {
      const config: Config = {
        version: 1,
        baseUrl: "https://plane.example.com",
        apiKey: "test-key",
      };

      saveConfig(config, { homeDir: testDir });

      const configFile = path.join(testDir, ".planec", "config.json");
      assert(fs.existsSync(configFile));

      const loaded = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      assert.deepEqual(loaded, config);
    });

    it("saves all fields correctly", () => {
      const config: Config = {
        version: 1,
        baseUrl: "https://plane.example.com",
        apiKey: "test-key",
        workspace: "test-workspace",
        project: "test-project-uuid",
      };

      saveConfig(config, { homeDir: testDir });

      const loaded = loadConfig({ homeDir: testDir });
      assert.deepEqual(loaded, config);
    });

    it("saves only version field when other fields are undefined", () => {
      const config: Config = { version: 1 };

      saveConfig(config, { homeDir: testDir });

      const loaded = loadConfig({ homeDir: testDir });
      assert.deepEqual(loaded, { version: 1 });
    });

    it("applies chmod 600 to config file", () => {
      const config: Config = {
        version: 1,
        baseUrl: "https://plane.example.com",
      };

      saveConfig(config, { homeDir: testDir });

      const configFile = path.join(testDir, ".planec", "config.json");
      const stats = fs.statSync(configFile);
      const mode = stats.mode & 0o777;

      assert.equal(mode, 0o600, `expected mode 0o600, got ${mode.toString(8)}`);
    });

    it("overwrites existing config", () => {
      const config1: Config = {
        version: 1,
        baseUrl: "https://plane1.example.com",
      };
      const config2: Config = {
        version: 1,
        baseUrl: "https://plane2.example.com",
        apiKey: "new-key",
      };

      saveConfig(config1, { homeDir: testDir });
      saveConfig(config2, { homeDir: testDir });

      const loaded = loadConfig({ homeDir: testDir });
      assert.deepEqual(loaded, config2);
    });
  });

  describe("mergeConfig", () => {
    it("merges partial config with current config", () => {
      const current: Config = {
        version: 1,
        baseUrl: "https://plane.example.com",
        apiKey: "test-key",
        workspace: "test-workspace",
      };

      const merged = mergeConfig(current, { apiKey: "new-key", project: "new-project-uuid" });

      assert.deepEqual(merged, {
        version: 1,
        baseUrl: "https://plane.example.com",
        apiKey: "new-key",
        workspace: "test-workspace",
        project: "new-project-uuid",
      });
    });

    it("does not mutate the original config", () => {
      const current: Config = {
        version: 1,
        baseUrl: "https://plane.example.com",
        workspace: "test-workspace",
      };
      const original = JSON.parse(JSON.stringify(current));

      mergeConfig(current, { apiKey: "new-key" });

      assert.deepEqual(current, original);
    });

    it("returns new config with updated fields", () => {
      const current: Config = {
        version: 1,
      };

      const merged = mergeConfig(current, {
        baseUrl: "https://plane.example.com",
        apiKey: "test-key",
        workspace: "test-workspace",
      });

      assert.notEqual(merged, current);
      assert.equal(merged.baseUrl, "https://plane.example.com");
      assert.equal(merged.apiKey, "test-key");
      assert.equal(merged.workspace, "test-workspace");
    });

    it("can clear fields by setting them to undefined", () => {
      const current: Config = {
        version: 1,
        baseUrl: "https://plane.example.com",
        apiKey: "test-key",
      };

      const merged = mergeConfig(current, { apiKey: undefined });

      assert.deepEqual(merged, {
        version: 1,
        baseUrl: "https://plane.example.com",
        apiKey: undefined,
      });
    });
  });

  describe("roundtrip: saveConfig + loadConfig", () => {
    it("preserves all config fields", () => {
      const original: Config = {
        version: 1,
        baseUrl: "https://plane.example.com",
        apiKey: "test-api-key",
        workspace: "my-workspace",
        project: "550e8400-e29b-41d4-a716-446655440000",
      };

      saveConfig(original, { homeDir: testDir });
      const loaded = loadConfig({ homeDir: testDir });

      assert.deepEqual(loaded, original);
    });

    it("preserves partial config", () => {
      const original: Config = {
        version: 1,
        baseUrl: "https://plane.example.com",
      };

      saveConfig(original, { homeDir: testDir });
      const loaded = loadConfig({ homeDir: testDir });

      assert.deepEqual(loaded, original);
    });
  });
});
