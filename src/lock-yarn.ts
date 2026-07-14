/**
 * Parser for yarn.lock — both classic v1 ("# yarn lockfile v1") and the
 * YAML flavor written by Yarn Berry (v2+).
 *
 * The parse is deliberately line-based: an entry is a column-0 header of
 * comma-separated selectors ending in ":", followed by an indented
 * `version` field. That shape is stable across every yarn release, whereas
 * a full YAML parser would be a dependency for no gain.
 */

import type { LockSnapshot } from "./types.js";
import { sortVersions } from "./semver.js";

/** Split "a@^1, \"b@^2\"" on commas that sit outside double quotes. */
function splitSelectors(header: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inQuote = false;
  for (const ch of header) {
    if (ch === '"') {
      inQuote = !inQuote;
      current += ch;
    } else if (ch === "," && !inQuote) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim().length > 0) parts.push(current);
  return parts;
}

function stripQuotes(s: string): string {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
  return s;
}

/**
 * Extract the package name from a selector like "@scope/pkg@^1.2.0" or
 * Berry's "pkg@npm:^1.2.0". Returns null for malformed selectors and for
 * workspace-protocol entries (local packages, not third-party news).
 */
function selectorName(selector: string): string | null {
  // The name/range separator is the first "@" after index 0, which also
  // handles scoped names ("@scope/pkg@…") because those start with "@".
  const at = selector.indexOf("@", 1);
  if (at === -1) return null;
  const range = selector.slice(at + 1);
  if (range.startsWith("workspace:")) return null;
  const name = selector.slice(0, at);
  return name.length > 0 ? name : null;
}

/** Berry writes local workspace resolutions as 0.0.0-use.local; they are not real releases. */
function isLocalPlaceholder(version: string): boolean {
  return version.startsWith("0.0.0-use.local");
}

/** Parse a yarn.lock body (classic v1 or Berry YAML) into a snapshot. */
export function parseYarnLock(text: string, path = "yarn.lock"): LockSnapshot {
  if (text.trimStart().startsWith("{")) {
    throw new Error(`${path}: looks like JSON, not a yarn.lock`);
  }

  const found = new Map<string, string[]>();
  const add = (name: string, version: string): void => {
    const list = found.get(name);
    if (list) list.push(version);
    else found.set(name, [version]);
  };

  let pending: string[] = [];
  let entries = 0;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;

    if (!/^\s/.test(line)) {
      // Column-0 line: either an entry header or Berry's __metadata block.
      pending = [];
      if (!trimmed.endsWith(":")) continue;
      const header = trimmed.slice(0, -1);
      if (header === "__metadata") continue;
      entries += 1;
      const names = new Set<string>();
      for (const rawSelector of splitSelectors(header)) {
        const name = selectorName(stripQuotes(rawSelector.trim()));
        if (name !== null) names.add(name);
      }
      pending = [...names];
      continue;
    }

    if (pending.length === 0) continue;
    // v1:    version "1.2.3"      Berry:    version: 1.2.3
    const m = /^\s+version:?\s+"?([^"\s]+)"?\s*$/.exec(line);
    if (m && m[1] !== undefined) {
      if (!isLocalPlaceholder(m[1])) {
        for (const name of pending) add(name, m[1]);
      }
      pending = [];
    }
  }

  if (entries === 0 && text.trim().length > 0 && !/yarn lockfile/i.test(text)) {
    throw new Error(`${path}: no lockfile entries found — is this really a yarn.lock?`);
  }

  const packages = new Map<string, string[]>();
  for (const name of [...found.keys()].sort()) {
    packages.set(name, sortVersions(found.get(name) ?? []));
  }
  return { format: "yarn", path, packages };
}
