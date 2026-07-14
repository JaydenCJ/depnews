/**
 * Parser for npm's package-lock.json (and npm-shrinkwrap.json).
 *
 * Supports lockfileVersion 2/3 (the flat "packages" map keyed by install
 * path) and the legacy lockfileVersion 1 nested "dependencies" tree. Local
 * workspace packages and symlink entries are skipped: depnews only reports
 * on third-party code that actually lives under node_modules.
 */

import type { LockSnapshot } from "./types.js";
import { sortVersions } from "./semver.js";

const MODULES_MARKER = "node_modules/";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Derive the package name from a v2/v3 key like "node_modules/a/node_modules/@s/b". */
function nameFromKey(key: string): string {
  const idx = key.lastIndexOf(MODULES_MARKER);
  return idx === -1 ? key : key.slice(idx + MODULES_MARKER.length);
}

function collectV2(packages: Record<string, unknown>, add: (name: string, version: string) => void): void {
  for (const [key, value] of Object.entries(packages)) {
    if (key === "") continue; // the root project itself
    if (!key.includes(MODULES_MARKER)) continue; // workspace source dirs like "packages/app"
    if (!isRecord(value)) continue;
    if (value.link === true) continue; // symlink stub; the target entry carries the version
    const version = value.version;
    if (typeof version !== "string" || version.length === 0) continue;
    const name = typeof value.name === "string" && value.name.length > 0 ? value.name : nameFromKey(key);
    add(name, version);
  }
}

function collectV1(dependencies: Record<string, unknown>, add: (name: string, version: string) => void): void {
  for (const [name, value] of Object.entries(dependencies)) {
    if (!isRecord(value)) continue;
    if (typeof value.version === "string" && value.version.length > 0) add(name, value.version);
    if (isRecord(value.dependencies)) collectV1(value.dependencies, add);
  }
}

/** Parse a package-lock.json / npm-shrinkwrap.json body into a snapshot. */
export function parseNpmLock(text: string, path = "package-lock.json"): LockSnapshot {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(`${path}: not valid JSON (${(err as Error).message})`);
  }
  if (!isRecord(data)) throw new Error(`${path}: expected a JSON object at the top level`);

  const found = new Map<string, string[]>();
  const add = (name: string, version: string): void => {
    const list = found.get(name);
    if (list) list.push(version);
    else found.set(name, [version]);
  };

  if (isRecord(data.packages)) {
    collectV2(data.packages, add);
  } else if (isRecord(data.dependencies)) {
    collectV1(data.dependencies, add);
  } else {
    throw new Error(`${path}: no "packages" or "dependencies" section — is this really an npm lockfile?`);
  }

  const packages = new Map<string, string[]>();
  for (const name of [...found.keys()].sort()) {
    packages.set(name, sortVersions(found.get(name) ?? []));
  }
  return { format: "npm", path, packages };
}
