import { MAX_UF2_BYTES } from "./uf2.ts";

export type FirmwareSource = { manifest?: string; github?: string };

export type Release = {
  version: string;
  date: string | null;
  url: string;
  sha256: string;
  /** where a person can download it by hand */
  page: string | null;
};

export class ReleaseError extends Error {
  readonly page: string | null;
  constructor(message: string, page: string | null = null) {
    super(message);
    this.page = page;
  }
}

const SEMVER = /^\d+\.\d+\.\d+$/;
const SHA256 = /^[0-9a-f]{64}$/i;
const REPOSITORY = /^[a-z0-9][a-z0-9-]*\/[a-z0-9_.-]+$/i;
const GITHUB = "https://github.com";
const GITHUB_ASSET_ORIGINS = new Set(["https://release-assets.githubusercontent.com", "https://objects.githubusercontent.com"]);
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const METADATA_TIMEOUT_MS = 10_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;

function validSha256(value: unknown): value is string {
  return typeof value === "string" && value.length === 64 && SHA256.test(value);
}

function trustedUrl(value: unknown, base?: string): URL | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value, base);
    if (url.username || url.password || url.hash) return null;
    if (url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK.has(url.hostname))) return url;
  } catch {
    return null;
  }
  return null;
}

function sameOriginPage(value: unknown, manifest: URL, github: string | undefined, version: string): string | null {
  const page = trustedUrl(value, manifest.href);
  if (page?.origin === manifest.origin) return page.href;
  if (github && page?.href === `${GITHUB}/${github}/releases/tag/v${version}`) return page.href;
  return null;
}

async function readLimited(response: Response, limit: number, tooLarge: ReleaseError) {
  if (Number(response.headers.get("content-length")) > limit) {
    void response.body?.cancel().catch(() => {});
    throw tooLarge;
  }
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array(0);
  let bytes = new Uint8Array(Math.min(64 * 1024, limit));
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const end = size + chunk.value.length;
      if (end > limit) throw tooLarge;
      if (end > bytes.length) {
        const grown = new Uint8Array(Math.min(limit, Math.max(end, bytes.length * 2)));
        grown.set(bytes);
        bytes = grown;
      }
      bytes.set(chunk.value, size);
      size = end;
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  return size === bytes.length ? bytes : bytes.slice(0, size);
}

async function readMetadata(response: Response, limit: number): Promise<Record<string, unknown>> {
  try {
    const bytes = await readLimited(response, limit, new ReleaseError("the release list is too large"));
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
  } catch (error) {
    if (error instanceof ReleaseError) throw error;
  }
  throw new ReleaseError("the release list is malformed or could not be read");
}

/** the latest release, or null when there is none yet */
export async function latestRelease(src: FirmwareSource): Promise<Release | null> {
  const github = src.github && REPOSITORY.test(src.github) && !/\/\.{1,2}$/.test(src.github) ? src.github : undefined;
  if (src.github && !github) throw new ReleaseError("invalid GitHub release repository");
  if (src.manifest) {
    const manifest = trustedUrl(src.manifest, globalThis.location?.href);
    if (!manifest) throw new ReleaseError("invalid firmware manifest address");
    const res = await fetch(manifest, {
      cache: "no-cache",
      redirect: "error",
      signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
    }).catch(() => null);
    if (res?.ok) {
      const m = await readMetadata(res, 64 * 1024);
      const url = trustedUrl(m.url, manifest.href);
      if (typeof m.version !== "string" || !SEMVER.test(m.version) || !validSha256(m.sha256) ||
          !url || url.origin !== manifest.origin || !url.pathname.endsWith(".uf2")) {
        throw new ReleaseError("the release list must include a valid version, a local uf2 and its sha256");
      }
      return {
        version: m.version,
        date: typeof m.date === "string" ? m.date : null,
        url: url.href,
        sha256: m.sha256.toLowerCase(),
        page: sameOriginPage(m.page, manifest, github, m.version),
      };
    }
    if (res && !res.ok && res.status !== 404) throw new ReleaseError(`the release list didn't load (${res.status})`);
  }
  if (github) {
    const res = await fetch(`https://api.github.com/repos/${github}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" },
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
    }).catch(() => null);
    if (!res) throw new ReleaseError("GitHub didn't answer");
    if (res.status === 404) return null; // no release yet, or the repo isn't public
    if (!res.ok) throw new ReleaseError(`GitHub said ${res.status}`);
    const rel = await readMetadata(res, 512 * 1024);
    const tag = typeof rel.tag_name === "string" ? rel.tag_name : "";
    const version = tag.replace(/^v/, "");
    if (!SEMVER.test(version) || !Array.isArray(rel.assets)) return null;
    const versionedName = `mk1-${version}.uf2`;
    const asset = rel.assets.find((item) => item?.name === versionedName)
      ?? rel.assets.find((item) => item?.name === "mk1.uf2");
    if (!asset) return null;
    const page = `${GITHUB}/${github}/releases/tag/${tag}`;
    const url = `${GITHUB}/${github}/releases/download/${tag}/${asset.name}`;
    const digest = typeof asset.digest === "string" && asset.digest.startsWith("sha256:") ? asset.digest.slice(7) : "";
    if (asset.browser_download_url !== url || !validSha256(digest)) {
      throw new ReleaseError("the GitHub release does not include a canonical uf2 and its sha256", page);
    }
    return {
      version,
      date: typeof rel.published_at === "string" ? rel.published_at : null,
      url,
      sha256: digest.toLowerCase(),
      page,
    };
  }
  return null;
}

export async function download(rel: Release): Promise<Uint8Array> {
  const url = trustedUrl(rel.url);
  if (!url || !validSha256(rel.sha256)) throw new ReleaseError("the firmware download is missing a valid address or sha256", rel.page);
  const github = url.origin === GITHUB && url.pathname.includes("/releases/download/");
  const signal = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      credentials: github ? "omit" : "same-origin",
      redirect: github ? "follow" : "error",
      referrerPolicy: "no-referrer",
      signal,
    });
    if (!res.ok) throw new ReleaseError(`the firmware didn't download (${res.status})`, rel.page);
    if (res.redirected) {
      const finalUrl = trustedUrl(res.url);
      if (!github || !finalUrl || !GITHUB_ASSET_ORIGINS.has(finalUrl.origin)) {
        void res.body?.cancel().catch(() => {});
        throw new ReleaseError("the firmware redirected to an unexpected address", rel.page);
      }
    }
    const bytes = await readLimited(res, MAX_UF2_BYTES, new ReleaseError("the firmware download is too large", rel.page));
    const sum = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
      .map((b) => b.toString(16).padStart(2, "0")).join("");
    if (sum !== rel.sha256.toLowerCase()) throw new ReleaseError("the download is damaged (checksum mismatch)", rel.page);
    return bytes;
  } catch (error) {
    if (error instanceof ReleaseError) throw error;
    throw new ReleaseError(signal.aborted ? "the firmware download timed out" : "the browser couldn't download the firmware", rel.page);
  }
}

/** -1, 0, 1 for semver strings */
export function compareVersions(a: string, b: string): number {
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

/** the release is newer than the card's firmware. compareVersions calls anything that isn't x.y.z newer (NaN
 *  compares false), so a build stamped otherwise must not read as an update */
export function isNewer(release: string, card: string | null): boolean {
  return card !== null && SEMVER.test(release) && SEMVER.test(card) && compareVersions(release, card) > 0;
}

/** a release's date as the page prints it: "12 nov" */
export const releaseDay = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }).toLowerCase() : null;
