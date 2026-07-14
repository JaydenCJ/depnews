/**
 * Parser for pnpm-lock.yaml.
 *
 * Reads the top-level `packages:` map, whose keys encode name and version.
 * The key grammar drifted across pnpm majors and all dialects are handled:
 *
 *   v5   /foo/1.2.3            /@scope/foo/1.2.3_peerhash
 *   v6-8 /foo@1.2.3            /@scope/foo@1.2.3(react@18.2.0)
 *   v9   'foo@1.2.3':          '@scope/foo@1.2.3(react@18.2.0)':
 *
 * Only the two-space-indented keys of the packages section are consumed, so
 * no YAML dependency is needed. Git/tarball entries whose "version" is a
 * commit hash are skipped: they carry no comparable release number.
 */

import type { LockSnapshot } from "./types.js";
import { parseVersion, sortVersions } from "./semver.js";

function stripQuotes(s: string): string {
  if (s.length >= 2) {
    const first = s[0];
    if ((first === "'" || first === '"') && s.endsWith(first)) return s.slice(1, -1);
  }
  return s;
}

/** "name" or "@scope/name" — exactly zero or one slash, scoped iff it starts with "@". */
function isValidPackageName(name: string): boolean {
  if (name.length === 0) return false;
  const parts = name.split("/");
  if (name.startsWith("@")) return parts.length === 2 && parts.every((p) => p.length > 0);
  return parts.length === 1;
}

/** v5 appends "_<peerhash>" to the version segment; peer info in v6+ uses "(…)" handled earlier. */
function cleanVersion(version: string): string {
  const underscore = version.indexOf("_");
  return underscore === -1 ? version : version.slice(0, underscore);
}

/** Decode one packages-section key into { name, version }, or null for non-registry entries. */
export function parsePnpmKey(rawKey: string): { name: string; version: string } | null {
  let key = stripQuotes(rawKey.trim());
  const paren = key.indexOf("(");
  if (paren !== -1) key = key.slice(0, paren); // v6+ peer-dependency suffix
  if (key.startsWith("/")) key = key.slice(1);
  if (key.length === 0) return null;

  // v6+ style: name@version, where the separator is the last "@" past index 0.
  const at = key.lastIndexOf("@");
  if (at > 0) {
    const name = key.slice(0, at);
    const version = cleanVersion(key.slice(at + 1));
    if (isValidPackageName(name) && parseVersion(version)) return { name, version };
  }

  // v5 style: name/version (the version is the last path segment).
  const slash = key.lastIndexOf("/");
  if (slash > 0) {
    const name = key.slice(0, slash);
    const version = cleanVersion(key.slice(slash + 1));
    if (isValidPackageName(name) && parseVersion(version)) return { name, version };
  }

  return null; // git deps ("github.com/u/r/<sha>"), tarballs, malformed keys
}

/** Parse a pnpm-lock.yaml body into a snapshot. */
export function parsePnpmLock(text: string, path = "pnpm-lock.yaml"): LockSnapshot {
  if (text.trimStart().startsWith("{")) {
    throw new Error(`${path}: looks like JSON, not a pnpm-lock.yaml`);
  }

  const found = new Map<string, string[]>();
  const add = (name: string, version: string): void => {
    const list = found.get(name);
    if (list) list.push(version);
    else found.set(name, [version]);
  };

  let inPackages = false;
  let sawPackagesKey = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^[^\s#]/.test(line)) {
      // New top-level section.
      inPackages = /^(['"]?)packages\1:\s*$/.test(line.trimEnd());
      if (inPackages) sawPackagesKey = true;
      continue;
    }
    if (!inPackages) continue;
    // Entry keys sit at exactly two spaces of indentation and end with ":".
    const m = /^ {2}(\S(?:.*\S)?):\s*$/.exec(line);
    if (!m || m[1] === undefined) continue;
    const parsed = parsePnpmKey(m[1]);
    if (parsed) add(parsed.name, parsed.version);
  }

  if (!sawPackagesKey && !/^lockfileVersion/m.test(text)) {
    throw new Error(`${path}: no "packages:" section or lockfileVersion marker — is this really a pnpm-lock.yaml?`);
  }

  const packages = new Map<string, string[]>();
  for (const name of [...found.keys()].sort()) {
    packages.set(name, sortVersions(found.get(name) ?? []));
  }
  return { format: "pnpm", path, packages };
}
