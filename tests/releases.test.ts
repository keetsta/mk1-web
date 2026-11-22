import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { compareVersions, download, isNewer, latestRelease } from "../src/mk1/flash/releases.ts";
import { MAX_UF2_BYTES } from "../src/mk1/flash/uf2.ts";

const repo = "keetsta/mk1-shell";
const api = "https://api.github.com/repos/keetsta/mk1-shell/releases/latest";
const page = "https://github.com/keetsta/mk1-shell/releases/tag/v0.2.0";
const assetUrl = "https://github.com/keetsta/mk1-shell/releases/download/v0.2.0/mk1.uf2";
const raw = new Uint8Array([1, 2, 3]);
const sha256 = createHash("sha256").update(raw).digest("hex");
const url = `https://raw.githubusercontent.com/${repo}/refs/heads/firmware-assets/uf2/v0.2.0/${sha256}/mk1.uf2`;
const release = { version: "0.2.0", date: "2026-11-22T10:00:00Z", url, page, sha256 };

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

test("the latest public GitHub release supplies the version and checksum for the raw UF2", async (t) => {
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, api);
    assert.equal(init.redirect, "error");
    assert.equal(init.credentials, "omit");
    return Response.json({
      tag_name: "v0.2.0",
      published_at: release.date,
      assets: [
        { name: "mk1-demo.uf2" },
        { name: "mk1.uf2", browser_download_url: assetUrl, digest: "sha256:" + sha256.toUpperCase() },
      ],
    });
  });
  assert.deepEqual(await latestRelease({ github: repo }), release);
});

test("the demo has its own download path and checksum", async (t) => {
  const demoBytes = new Uint8Array([4, 5, 6]);
  const demoHash = createHash("sha256").update(demoBytes).digest("hex");
  const demoUrl = `https://raw.githubusercontent.com/${repo}/refs/heads/firmware-assets/uf2/v0.2.0/${demoHash}/mk1-demo.uf2`;
  const demoAsset = {
    name: "mk1-demo.uf2",
    browser_download_url: `${page.replace("/tag/", "/download/")}/mk1-demo.uf2`,
    digest: "sha256:" + demoHash,
  };
  t.mock.method(globalThis, "fetch", async (url) => {
    if (url === api) {
      return Response.json({
        tag_name: "v0.2.0",
        published_at: release.date,
        assets: [demoAsset, { name: "mk1.uf2", browser_download_url: assetUrl, digest: "sha256:" + sha256 }],
      });
    }
    assert.equal(String(url), demoUrl);
    return new Response(demoBytes);
  });

  const latest = await latestRelease({ github: repo });
  assert.deepEqual(latest, { ...release, demo: { url: demoUrl, sha256: demoHash } });
  assert.ok(latest?.demo);
  assert.deepEqual(await download({ ...latest.demo, page }), demoBytes);

  demoAsset.browser_download_url = assetUrl;
  assert.deepEqual(await latestRelease({ github: repo }), release);
});

test("release notes keep commit subjects as plain text and skip empty entries", async (t) => {
  let body: unknown = "\r\n - Tune the light sensor \r\n\r\n- <img src=x> and **literal**\n  Other notes\r\n-   ";
  t.mock.method(globalThis, "fetch", async () => Response.json({
    tag_name: "v0.2.0",
    body,
    assets: [{ name: "mk1.uf2", browser_download_url: assetUrl, digest: "sha256:" + sha256 }],
  }));
  assert.deepEqual((await latestRelease({ github: repo }))?.notes, {
    lines: ["Tune the light sensor", "<img src=x> and **literal**", "Other notes"],
    truncated: false,
  });
  for (const empty of [null, [], "\n \r\n-  \n"]) {
    body = empty;
    const result = await latestRelease({ github: repo });
    assert.ok(result);
    assert.equal("notes" in result, false);
  }
});

test("release notes cap the preview without splitting Unicode code points", async (t) => {
  const longSubject = "🌙".repeat(240);
  const subjects = [longSubject, ...Array.from({ length: 19 }, (_, i) => "Commit " + (i + 1))];
  t.mock.method(globalThis, "fetch", async () => Response.json({
    tag_name: "v0.2.0",
    body: subjects.map((line) => "- " + line).join("\n") + "\n\n",
    assets: [{ name: "mk1.uf2", browser_download_url: assetUrl, digest: "sha256:" + sha256 }],
  }));
  assert.deepEqual((await latestRelease({ github: repo }))?.notes, { lines: subjects, truncated: false });
  subjects[0] += "x";
  assert.deepEqual((await latestRelease({ github: repo }))?.notes, {
    lines: ["🌙".repeat(239) + "…", ...subjects.slice(1)],
    truncated: true,
  });
  subjects[0] = longSubject;
  subjects.push("Hidden commit");
  assert.deepEqual((await latestRelease({ github: repo }))?.notes, {
    lines: subjects.slice(0, 20),
    truncated: true,
  });
});

test("release notes stop at the standalone license notices marker", async (t) => {
  const marker = "<!-- mk1:license-notices -->";
  const subjects = [marker, ...Array.from({ length: 19 }, (_, i) => "Commit " + (i + 1))];
  t.mock.method(globalThis, "fetch", async () => Response.json({
    tag_name: "v0.2.0",
    body: subjects.map((line) => "- " + line).join("\r\n") + "\r\n \t" + marker + "  \r\n- License notice",
    assets: [{ name: "mk1.uf2", browser_download_url: assetUrl, digest: "sha256:" + sha256 }],
  }));
  assert.deepEqual((await latestRelease({ github: repo }))?.notes, { lines: subjects, truncated: false });
  subjects.push("Extra commit");
  assert.deepEqual((await latestRelease({ github: repo }))?.notes, {
    lines: subjects.slice(0, 20),
    truncated: true,
  });
});

test("GitHub releases must supply the canonical asset and its checksum", async (t) => {
  const asset = { name: "mk1.uf2", browser_download_url: assetUrl, digest: "sha256:" + sha256 };
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json({ tag_name: "v0.2.0", assets: [asset] }));
  for (const [downloadUrl, digest] of [
    [assetUrl, ""],
    [assetUrl, "sha256:" + sha256 + "\n"],
    [release.url, "sha256:" + sha256],
  ]) {
    asset.browser_download_url = downloadUrl;
    asset.digest = digest;
    await assert.rejects(latestRelease({ github: repo }), /canonical uf2 and its sha256/);
  }
  await assert.rejects(latestRelease({ github: "keetsta/.." }), /invalid GitHub release repository/);
  assert.equal(fetch.mock.callCount(), 3);
});

test("an unpublished, missing or non-stable release doesn't offer an update", async (t) => {
  const valid = {
    tag_name: "v0.2.0",
    assets: [{ name: "mk1.uf2", browser_download_url: assetUrl, digest: "sha256:" + sha256 }],
  };
  let response = new Response(null, { status: 404 });
  t.mock.method(globalThis, "fetch", async () => response);
  assert.equal(await latestRelease({ github: repo }), null);
  for (const value of [
    { ...valid, draft: true },
    { ...valid, prerelease: true },
    { ...valid, tag_name: "v0.2.0-beta" },
    { ...valid, tag_name: "0.2.0" },
    { ...valid, assets: [{ name: "mk1-demo.uf2" }] },
  ]) {
    response = Response.json(value);
    assert.equal(await latestRelease({ github: repo }), null);
  }
});

test("download verifies streamed bytes and rejects checksum mismatches", async (t) => {
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    assert.equal(String(_url), release.url);
    assert.equal(init.redirect, "error");
    assert.equal(init.credentials, "omit");
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
  const fetch = t.mock.method(globalThis, "fetch", async (_url, init) => {
    assert.equal(init.redirect, "error");
    throw new TypeError("unexpected redirect");
  });
  await assert.rejects(download(release), /couldn't download/);
  await assert.rejects(download({ ...release, url: assetUrl }), /missing a valid address/);
  assert.equal(fetch.mock.callCount(), 1);
  t.mock.method(AbortSignal, "timeout", () => AbortSignal.abort(new DOMException("expired", "TimeoutError")));
  fetch.mock.mockImplementation(async (_url, init) => { throw init.signal.reason; });
  await assert.rejects(download(release), /timed out/);
});
