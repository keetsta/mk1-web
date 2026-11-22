import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { compareVersions, download, isNewer, latestRelease } from "../src/mk1/flash/releases.ts";
import { MAX_UF2_BYTES } from "../src/mk1/flash/uf2.ts";

const repo = "keetsta/mk1-shell";
const manifest = "https://mk1.example/firmware/latest.json";
const base = "https://mk1.example/firmware/";
const filename = "mk1-0.2.0.uf2";
const raw = new Uint8Array([1, 2, 3]);
const sha256 = createHash("sha256").update(raw).digest("hex");
const release = { version: "0.2.0", date: null, url: base + filename, page: null, sha256 };

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

test("the manifest verifies its same-origin UF2 and only links to a trusted release page", async (t) => {
  const page = "https://github.com/keetsta/mk1-shell/releases/tag/v0.2.0";
  let releasePage = page;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(String(url), manifest);
    assert.equal(init.redirect, "error");
    return Response.json({ version: release.version, url: filename, sha256: sha256.toUpperCase(), page: releasePage });
  });
  assert.deepEqual(await latestRelease({ manifest, github: repo }), { ...release, page });
  releasePage = "https://other.example/manual";
  assert.deepEqual(await latestRelease({ manifest, github: repo }), release);
});

test("manifest installs require a valid sha256 and local file, including during fallback", async (t) => {
  let metadata;
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json(metadata));
  for (const [url, digest] of [
    [filename, undefined],
    [filename, sha256 + "\n"],
    ["https://other.example/firmware/" + filename, sha256],
    ["http://mk1.example/firmware/" + filename, sha256],
    ["https://user@mk1.example/firmware/" + filename, sha256],
  ]) {
    metadata = { version: release.version, url, sha256: digest };
    await assert.rejects(latestRelease({ manifest, github: repo }), /local uf2 and its sha256/);
  }
  assert.equal(fetch.mock.callCount(), 5);
});

test("GitHub fallback selects the main UF2 and requires the canonical URL and digest", async (t) => {
  const page = "https://github.com/keetsta/mk1-shell/releases/tag/v0.2.0";
  const url = "https://github.com/keetsta/mk1-shell/releases/download/v0.2.0/" + filename;
  const asset = { name: filename, browser_download_url: url, digest: "sha256:" + sha256 };
  t.mock.method(globalThis, "fetch", async () => Response.json({
    tag_name: "v0.2.0",
    assets: [{ name: "mk1-demo-0.2.0.uf2" }, asset],
  }));
  assert.deepEqual(await latestRelease({ github: repo }), { ...release, url, page });
  asset.digest = "";
  await assert.rejects(latestRelease({ github: repo }), /canonical uf2 and its sha256/);
  asset.digest = "sha256:" + sha256;
  asset.browser_download_url = release.url;
  await assert.rejects(latestRelease({ github: repo }), /canonical uf2 and its sha256/);
});

test("download verifies streamed bytes and rejects checksum mismatches", async (t) => {
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    assert.equal(init.redirect, "error");
    assert.ok(init.signal instanceof AbortSignal);
    return new Response(raw);
  });
  assert.deepEqual(await download(release), raw);
  await assert.rejects(download({ ...release, sha256: "0".repeat(64) }), /checksum mismatch/);
});

test("download enforces the UF2 size cap with and without a content length", async (t) => {
  let response = new Response(raw, { headers: { "content-length": String(MAX_UF2_BYTES + 1) } });
  t.mock.method(globalThis, "fetch", async () => response);
  await assert.rejects(download(release), /too large/);
  const chunk = new Uint8Array(1024 * 1024);
  let cancelled = false;
  response = new Response(new ReadableStream({
    pull(controller) { controller.enqueue(chunk); },
    cancel() { cancelled = true; },
  }));
  await assert.rejects(download(release), /too large/);
  assert.equal(cancelled, true);
});

test("download rejects unexpected redirects and reports timeouts", async (t) => {
  const url = "https://github.com/keetsta/mk1-shell/releases/download/v0.2.0/" + filename;
  const fetch = t.mock.method(globalThis, "fetch", async (_url, init) => {
    assert.equal(init.redirect, "follow");
    const response = new Response(raw);
    Object.defineProperties(response, {
      redirected: { value: true },
      url: { value: "https://other.example/download" },
    });
    return response;
  });
  await assert.rejects(download({ ...release, url }), /unexpected address/);
  t.mock.method(AbortSignal, "timeout", () => AbortSignal.abort(new DOMException("expired", "TimeoutError")));
  fetch.mock.mockImplementation(async (_url, init) => { throw init.signal.reason; });
  await assert.rejects(download(release), /timed out/);
});
