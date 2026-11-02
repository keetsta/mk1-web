/* Where the card's firmware comes from.
   1. A manifest on the site itself (the deploy mirrors the latest GitHub release into it), so the page
      downloads from its own origin: { "version": "0.2.0", "date": "2026-11-12", "url": "mc1-0.2.0.uf2",
      "sha256": "…", "page": "https://github.com/…/releases/tag/v0.2.0" }, url relative to the manifest.
   2. Else GitHub's releases API for owner/repo, the asset ending in .uf2 (needs a public repo; GitHub may
      refuse the download to a page, then the visitor gets the release page and installs from a file). */

export type FirmwareSource = { manifest?: string; github?: string };

export type Release = {
  version: string;
  date: string | null;
  url: string;
  sha256: string | null;
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

/** the latest release, or null when there is none yet */
export async function latestRelease(src: FirmwareSource): Promise<Release | null> {
  if (src.manifest) {
    const res = await fetch(src.manifest, { cache: "no-cache" }).catch(() => null);
    const json = res?.ok && (res.headers.get("content-type") ?? "").includes("json");
    if (json) {
      const m = await res!.json().catch(() => null);
      if (!m) throw new ReleaseError("the release list is malformed");
      if (typeof m.version !== "string" || !SEMVER.test(m.version) || typeof m.url !== "string")
        throw new ReleaseError("the release list is malformed");
      return {
        version: m.version,
        date: typeof m.date === "string" ? m.date : null,
        url: new URL(m.url, new URL(src.manifest, location.href)).href,
        sha256: typeof m.sha256 === "string" ? m.sha256.toLowerCase() : null,
        page: typeof m.page === "string" ? m.page : null,
      };
    }
    if (res && !res.ok && res.status !== 404) throw new ReleaseError(`the release list didn't load (${res.status})`);
  }
  if (src.github) {
    const res = await fetch(`https://api.github.com/repos/${src.github}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" },
    }).catch(() => null);
    if (!res) throw new ReleaseError("GitHub didn't answer");
    if (res.status === 404) return null; // no release yet, or the repo isn't public
    if (!res.ok) throw new ReleaseError(`GitHub said ${res.status}`);
    const rel = await res.json();
    const asset = (rel.assets ?? []).find((a: { name: string }) => a.name.endsWith(".uf2"));
    const version = String(rel.tag_name ?? "").replace(/^v/, "");
    if (!asset || !SEMVER.test(version)) return null;
    return {
      version,
      date: rel.published_at ?? null,
      url: asset.browser_download_url,
      sha256: typeof asset.digest === "string" && asset.digest.startsWith("sha256:") ? asset.digest.slice(7) : null,
      page: rel.html_url ?? null,
    };
  }
  return null;
}

export async function download(rel: Release): Promise<Uint8Array> {
  const res = await fetch(rel.url).catch(() => null);
  if (!res) throw new ReleaseError("the browser couldn't download the firmware", rel.page);
  if (!res.ok) throw new ReleaseError(`the firmware didn't download (${res.status})`, rel.page);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (rel.sha256) {
    const sum = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
      .map((b) => b.toString(16).padStart(2, "0")).join("");
    if (sum !== rel.sha256) throw new ReleaseError("the download is damaged (checksum mismatch)", rel.page);
  }
  return bytes;
}

/** -1, 0, 1 for semver strings */
export function compareVersions(a: string, b: string): number {
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}
