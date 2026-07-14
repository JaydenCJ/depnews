/**
 * Lockfile format detection and the single parsing entry point.
 *
 * Detection prefers the filename (lockfile names are rigid conventions);
 * for renamed files and stdin it falls back to content sniffing.
 */

import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import type { LockFormat, LockSnapshot } from "./types.js";
import { parseNpmLock } from "./lock-npm.js";
import { parseYarnLock } from "./lock-yarn.js";
import { parsePnpmLock } from "./lock-pnpm.js";

/** Filenames probed by findLockfile, in preference order. */
export const LOCKFILE_NAMES = [
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
] as const;

/** Determine the lockfile dialect from filename first, then content shape. */
export function detectFormat(text: string, path = ""): LockFormat {
  const base = basename(path).toLowerCase();
  if (base === "package-lock.json" || base === "npm-shrinkwrap.json") return "npm";
  if (base === "yarn.lock") return "yarn";
  if (base === "pnpm-lock.yaml" || base === "pnpm-lock.yml") return "pnpm";

  if (text.trimStart().startsWith("{")) return "npm";
  if (/^lockfileVersion:/m.test(text)) return "pnpm";
  if (/yarn lockfile v\d/i.test(text) || /^__metadata:/m.test(text)) return "yarn";
  if (/^packages:\s*$/m.test(text)) return "pnpm";
  // Last resort: the classic yarn v1 shape — a column-0 "selector:" header
  // followed by an indented version field.
  if (/^[^\s#].*:\s*$/m.test(text) && /^\s+version\b/m.test(text)) return "yarn";
  throw new Error(
    `${path || "<input>"}: cannot detect the lockfile format (supported: ${LOCKFILE_NAMES.join(", ")})`,
  );
}

/** Parse any supported lockfile body into a snapshot. */
export function parseLockfile(text: string, path = ""): LockSnapshot {
  const format = detectFormat(text, path);
  const shownPath = path || "<input>";
  switch (format) {
    case "npm":
      return parseNpmLock(text, shownPath);
    case "yarn":
      return parseYarnLock(text, shownPath);
    case "pnpm":
      return parsePnpmLock(text, shownPath);
  }
}

/** Locate the lockfile of a project directory, or null when none of the known names exist. */
export function findLockfile(dir: string): string | null {
  for (const name of LOCKFILE_NAMES) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}
