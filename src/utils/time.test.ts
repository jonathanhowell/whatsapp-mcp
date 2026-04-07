import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { appleEpochToISO, APPLE_EPOCH_OFFSET_SECONDS } from "./time.js";

describe("APPLE_EPOCH_OFFSET_SECONDS", () => {
  it("equals 978307200", () => {
    assert.strictEqual(APPLE_EPOCH_OFFSET_SECONDS, 978307200);
  });
});

describe("appleEpochToISO", () => {
  it("converts 797271288 to 2026-04-07T16:14:48.000Z", () => {
    assert.strictEqual(appleEpochToISO(797271288), "2026-04-07T16:14:48.000Z");
  });

  it("returns null for null input", () => {
    assert.strictEqual(appleEpochToISO(null), null);
  });

  it("returns null for 0 input", () => {
    assert.strictEqual(appleEpochToISO(0), null);
  });
});
