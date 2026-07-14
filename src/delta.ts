/**
 * The delta engine: which packages moved between two lockfile snapshots.
 *
 * Pure data-in/data-out — no filesystem access — so every edge (nested
 * duplicate versions, downgrades, non-semver versions) is unit-testable.
 */

import type { LockSnapshot, PackageChange, ChangeKind } from "./types.js";
import { bumpKind, compareVersions, maxVersion } from "./semver.js";

export interface DeltaOptions {
  /** Keep only these packages. Exact names, or a trailing "*" prefix match like "@scope/*". */
  only?: string[];
  /** Drop these packages (same pattern rules; applied after `only`). */
  exclude?: string[];
}

function matchesPattern(name: string, pattern: string): boolean {
  if (pattern.endsWith("*")) return name.startsWith(pattern.slice(0, -1));
  return name === pattern;
}

function matchesAny(name: string, patterns: string[]): boolean {
  return patterns.some((p) => matchesPattern(name, p));
}

function sameVersions(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function classify(oldVersions: string[], newVersions: string[], from: string | null, to: string | null): ChangeKind {
  if (oldVersions.length === 0) return "added";
  if (newVersions.length === 0) return "removed";
  const cmp = compareVersions(from as string, to as string);
  if (cmp < 0) return "upgraded";
  if (cmp > 0) return "downgraded";
  return "changed"; // same top version, but the resolved set shifted (e.g. duplicates collapsed)
}

/** Compute the sorted list of package movements between two snapshots. */
export function computeDelta(
  before: LockSnapshot,
  after: LockSnapshot,
  options: DeltaOptions = {},
): PackageChange[] {
  const names = new Set<string>([...before.packages.keys(), ...after.packages.keys()]);
  const changes: PackageChange[] = [];

  for (const name of [...names].sort()) {
    if (options.only && options.only.length > 0 && !matchesAny(name, options.only)) continue;
    if (options.exclude && matchesAny(name, options.exclude)) continue;

    const oldVersions = before.packages.get(name) ?? [];
    const newVersions = after.packages.get(name) ?? [];
    if (sameVersions(oldVersions, newVersions)) continue;

    const from = maxVersion(oldVersions) ?? null;
    const to = maxVersion(newVersions) ?? null;
    changes.push({
      name,
      kind: classify(oldVersions, newVersions, from, to),
      oldVersions,
      newVersions,
      from,
      to,
      bump: from !== null && to !== null ? bumpKind(from, to) : null,
    });
  }

  return changes;
}
