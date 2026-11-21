import { test } from "node:test";
import assert from "node:assert/strict";
import { compareVersions, isNewer } from "../src/mk1/flash/releases.ts";

test("versions compare as numbers, not as text", () => {
  assert.equal(compareVersions("0.10.0", "0.9.9"), 1);
  assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
  assert.equal(compareVersions("0.2.0", "0.2.1"), -1);
});

test("an update is a newer plain x.y.z than the card's", () => {
  assert.equal(isNewer("0.2.0", "0.1.9"), true);
  assert.equal(isNewer("1.0.0", "0.99.0"), true);
  assert.equal(isNewer("0.2.0", "0.2.0"), false);
  assert.equal(isNewer("0.2.0", "0.3.0"), false);
});

test("no card, or a version that isn't x.y.z on either side, is never an update", () => {
  assert.equal(isNewer("0.2.0", null), false);
  assert.equal(isNewer("0.2.0", "0.1.0-dirty"), false);
  assert.equal(isNewer("0.2.0", "dev"), false);
  assert.equal(isNewer("0.2", "0.1.0"), false);
  assert.equal(isNewer("v0.2.0", "0.1.0"), false);
});
