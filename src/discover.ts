/**
 * Disk discovery: locate an installed package and the changelog it ships.
 *
 * Understands the flat node_modules layout used by npm and yarn, nested
 * installs, and pnpm's content-addressed `.pnpm` store. Everything is a
 * plain directory read — depnews never opens a socket.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { PackageMeta } from "./types.js";

/** Changelog basenames in preference order (matched case-insensitively). */
const CHANGELOG_BASES = [
  "changelog",
  "history",
  "changes",
  "news",
  "releases",
  "release-notes",
  "release_notes",
  "releasenotes",
];

/** Extensions in preference order; "" covers extension-less files like "CHANGELOG". */
const CHANGELOG_EXTS = ["md", "markdown", "txt", ""];

export interface InstalledPackage {
  name: string;
  /** Directory of the installed package. */
  dir: string;
  /** Version from the installed package.json (null when unreadable). */
  installedVersion: string | null;
  meta: PackageMeta;
  /** Absolute path of the best changelog candidate, or null when none ships. */
  changelogPath: string | null;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function listDir(path: string): string[] {
  try {
    return readdirSync(path).sort();
  } catch {
    return [];
  }
}

/** Normalize the repository field: strip the git+ prefix / .git suffix, expand "user/repo" shorthand. */
export function normalizeRepoUrl(value: unknown): string | null {
  let url: string | null = null;
  if (typeof value === "string") url = value;
  else if (typeof value === "object" && value !== null) {
    const u = (value as Record<string, unknown>).url;
    if (typeof u === "string") url = u;
  }
  if (url === null || url.length === 0) return null;
  if (url.startsWith("git+")) url = url.slice(4);
  if (url.endsWith(".git")) url = url.slice(0, -4);
  if (/^[\w.-]+\/[\w.-]+$/.test(url)) url = `https://github.com/${url}`;
  return url;
}

/** Read the fallback metadata (description/homepage/repository) from a package directory. */
export function readPackageMeta(pkgDir: string): { version: string | null; meta: PackageMeta } {
  const empty: PackageMeta = { description: null, homepage: null, repository: null };
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
  } catch {
    return { version: null, meta: empty };
  }
  if (typeof data !== "object" || data === null) return { version: null, meta: empty };
  const pkg = data as Record<string, unknown>;
  return {
    version: typeof pkg.version === "string" ? pkg.version : null,
    meta: {
      description: typeof pkg.description === "string" ? pkg.description : null,
      homepage: typeof pkg.homepage === "string" ? pkg.homepage : null,
      repository: normalizeRepoUrl(pkg.repository),
    },
  };
}

/**
 * Pick the best changelog file directly inside a package directory.
 * Ranking: basename preference first (CHANGELOG beats HISTORY beats CHANGES…),
 * then extension (.md beats .txt beats bare). Ties break lexicographically,
 * so results are deterministic on case-insensitive filesystems too.
 */
export function findChangelogFile(pkgDir: string): string | null {
  let best: { entry: string; score: number } | null = null;
  for (const entry of listDir(pkgDir)) {
    const lower = entry.toLowerCase();
    const dot = lower.lastIndexOf(".");
    const base = dot === -1 ? lower : lower.slice(0, dot);
    const ext = dot === -1 ? "" : lower.slice(dot + 1);
    const baseIdx = CHANGELOG_BASES.indexOf(base);
    const extIdx = CHANGELOG_EXTS.indexOf(ext);
    if (baseIdx === -1 || extIdx === -1) continue;
    const path = join(pkgDir, entry);
    try {
      if (!statSync(path).isFile()) continue;
    } catch {
      continue;
    }
    const score = baseIdx * CHANGELOG_EXTS.length + extIdx;
    if (best === null || score < best.score || (score === best.score && entry < best.entry)) {
      best = { entry, score };
    }
  }
  return best === null ? null : join(pkgDir, best.entry);
}

/** Candidate package directories inside a pnpm store for the given name (best match first). */
function pnpmStoreCandidates(root: string, name: string, wantedVersion: string | null): string[] {
  const store = join(root, ".pnpm");
  if (!isDirectory(store)) return [];
  const prefix = `${name.replace(/\//g, "+")}@`;
  const matches = listDir(store).filter((entry) => entry.startsWith(prefix));
  const exact = wantedVersion === null
    ? []
    : matches.filter((entry) => {
        const rest = entry.slice(prefix.length);
        return rest === wantedVersion || rest.startsWith(`${wantedVersion}(`) || rest.startsWith(`${wantedVersion}_`);
      });
  // Exact-version store entries first, then the rest (newest last per sort order).
  const ordered = [...exact, ...matches.filter((entry) => !exact.includes(entry))];
  return ordered
    .map((entry) => join(store, entry, "node_modules", ...name.split("/")))
    .filter((dir) => isDirectory(dir));
}

/**
 * Find where a package is installed. `moduleDirs` are node_modules roots,
 * searched in order; within each, the flat layout is preferred and the pnpm
 * store is the fallback. When several copies exist, the one whose
 * package.json version equals `wantedVersion` wins.
 */
export function findInstalledPackage(
  name: string,
  moduleDirs: string[],
  wantedVersion: string | null = null,
): InstalledPackage | null {
  const candidates: string[] = [];
  for (const root of moduleDirs) {
    const direct = join(root, ...name.split("/"));
    if (isDirectory(direct)) candidates.push(direct);
    candidates.push(...pnpmStoreCandidates(root, name, wantedVersion));
  }
  if (candidates.length === 0) return null;

  let picked: { dir: string; version: string | null; meta: PackageMeta } | null = null;
  for (const dir of candidates) {
    const { version, meta } = readPackageMeta(dir);
    if (picked === null) picked = { dir, version, meta };
    if (wantedVersion !== null && version === wantedVersion) {
      picked = { dir, version, meta };
      break;
    }
  }
  if (picked === null) return null;

  return {
    name,
    dir: picked.dir,
    installedVersion: picked.version,
    meta: picked.meta,
    changelogPath: findChangelogFile(picked.dir),
  };
}

/** True when a directory exists — exported for CLI validation of --modules. */
export function moduleDirExists(dir: string): boolean {
  return isDirectory(dir) || existsSync(dir);
}
