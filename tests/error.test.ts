import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PlaneApiError } from "../src/error.js";

describe("PlaneApiError", () => {
  it("stores status, code, and body", () => {
    const err = new PlaneApiError(404, "Not Found", "not_found", "resource missing");
    assert.equal(err.status, 404);
    assert.equal(err.statusText, "Not Found");
    assert.equal(err.code, "not_found");
    assert.equal(err.body, "resource missing");
    assert.equal(err.message, "Plane API 404: Not Found - resource missing");
    assert(err instanceof Error);
  });

  it("has name PlaneApiError", () => {
    const err = new PlaneApiError(500, "Internal Server Error");
    assert.equal(err.name, "PlaneApiError");
  });

  it("includes body in message when body is string", () => {
    const err = new PlaneApiError(400, "Bad Request", undefined, "invalid field");
    assert.equal(err.message, "Plane API 400: Bad Request - invalid field");
  });

  it("does not include body in message when body is object", () => {
    const err = new PlaneApiError(400, "Bad Request", undefined, { error: "details" });
    assert.equal(err.message, "Plane API 400: Bad Request");
  });

  it("classifies auth errors", () => {
    assert.equal(new PlaneApiError(401, "Unauthorized").isAuth, true);
    assert.equal(new PlaneApiError(403, "Forbidden").isAuth, false);
  });

  it("classifies permission errors", () => {
    assert.equal(new PlaneApiError(403, "Forbidden").isPermission, true);
    assert.equal(new PlaneApiError(401, "Unauthorized").isPermission, false);
  });

  it("classifies not found", () => {
    assert.equal(new PlaneApiError(404, "Not Found").isNotFound, true);
  });

  it("classifies rate limit", () => {
    assert.equal(new PlaneApiError(429, "Too Many Requests").isRateLimit, true);
  });

  it("classifies timeout", () => {
    assert.equal(new PlaneApiError(408, "Request Timeout").isTimeout, true);
  });
});
