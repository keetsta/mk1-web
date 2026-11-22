import { MAX_UF2_BYTES } from "./uf2.ts";

export type FirmwareSource = { github: string };

export type Release = {
  version: string;
  date: string | null;
  url: string;
  sha256: string;
  notes?: { lines: string[]; truncated: boolean };
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
const RAW_GITHUB = "https://raw.githubusercontent.com";
const METADATA_TIMEOUT_MS = 10_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const MAX_NOTE_LINES = 20;
const MAX_NOTE_LENGTH = 240;

function validSha256(value: unknown): value is string {
  return typeof value === "string" && value.length === 64 && SHA256.test(value);
}

function trustedDownloadUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.origin === RAW_GITHUB && !url.username && !url.password && !url.hash && !url.search) return url;
  } catch {
    return null;
  }
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

function releaseNotes(body: unknown): Release["notes"] {
  if (typeof body !== "string") return;
  const lines: string[] = [];
  let truncated = false;
  for (const text of body.split(/\r\n|\r|\n/)) {
    const line = text.replace(/^\s*-\s+/, "").trim();
    if (!line) continue;
    if (lines.length === MAX_NOTE_LINES) {
      truncated = true;
      break;
    }
    const chars = Array.from(line);
    if (chars.length > MAX_NOTE_LENGTH) {
      lines.push(chars.slice(0, MAX_NOTE_LENGTH - 1).join("") + "…");
      truncated = true;
    } else {
      lines.push(line);
    }
  }
  if (lines.length) return { lines, truncated };
}

/** the latest release, or null when there is none yet */
export async function latestRelease({ github }: FirmwareSource): Promise<Release | null> {
  if (!REPOSITORY.test(github) || /\/\.{1,2}$/.test(github)) throw new ReleaseError("invalid GitHub release repository");

  const res = await fetch(`https://api.github.com/repos/${github}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json" },
    credentials: "omit",
    redirect: "error",
    referrerPolicy: "no-referrer",
    signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
  }).catch(() => null);
  if (!res) throw new ReleaseError("GitHub didn't answer");
  if (res.status === 404) return null;
  if (!res.ok) throw new ReleaseError(`GitHub said ${res.status}`);

  const rel = await readMetadata(res, 512 * 1024);
  const tag = typeof rel.tag_name === "string" ? rel.tag_name : "";
  const version = tag.slice(1);
  if (!tag.startsWith("v") || !SEMVER.test(version) || rel.draft || rel.prerelease || !Array.isArray(rel.assets)) return null;

  const asset = rel.assets.find((item) => item?.name === "mk1.uf2");
  if (!asset) return null;
  const page = `${GITHUB}/${github}/releases/tag/${tag}`;
  const assetUrl = `${GITHUB}/${github}/releases/download/${tag}/mk1.uf2`;
  const digest = typeof asset.digest === "string" && asset.digest.startsWith("sha256:") ? asset.digest.slice(7) : "";
  if (asset.browser_download_url !== assetUrl || !validSha256(digest)) {
    throw new ReleaseError("the GitHub release does not include a canonical uf2 and its sha256", page);
  }
  const sha256 = digest.toLowerCase();
  const notes = releaseNotes(rel.body);
  return {
    version,
    date: typeof rel.published_at === "string" ? rel.published_at : null,
    url: `${RAW_GITHUB}/${github}/refs/heads/firmware-assets/uf2/${tag}/${sha256}/mk1.uf2`,
    sha256,
    page,
    ...(notes ? { notes } : {}),
  };
}

export async function download(rel: Release): Promise<Uint8Array> {
  const url = trustedDownloadUrl(rel.url);
  if (!url || !validSha256(rel.sha256)) throw new ReleaseError("the firmware download is missing a valid address or sha256", rel.page);
  const signal = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal,
    });
    if (!res.ok) throw new ReleaseError(`the firmware didn't download (${res.status})`, rel.page);
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
