/**
 * Minimal semantic-version handling: parse, compare, classify bumps.
 *
 * Implements enough of the SemVer 2.0.0 precedence rules for lockfile work
 * (numeric fields, prerelease ordering, build metadata ignored) plus a loose
 * mode that accepts the shapes real lockfiles and changelogs actually use:
 * "v2.1", "0.10", "1.4.0.1". No dependency on the npm semver package.
 */

import type { BumpKind } from "./types.js";

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  /** Extra numeric segments beyond patch ("1.2.3.4" keeps [4]). */
  extra: number[];
  /** Dot-separated prerelease identifiers; numeric ones are stored as numbers. */
  prerelease: (string | number)[];
  raw: string;
}

const VERSION_RE =
  /^v?=?\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?((?:\.\d+)*)(?:-([0-9A-Za-z][0-9A-Za-z.-]*))?(?:\+[0-9A-Za-z.-]+)?$/;

/** Loose parse; returns null when the input is not version-shaped at all. */
export function parseVersion(input: string): SemVer | null {
  const raw = input.trim();
  const m = VERSION_RE.exec(raw);
  if (!m || m[1] === undefined) return null;
  const extra = (m[4] ?? "")
    .split(".")
    .filter((part) => part.length > 0)
    .map((part) => Number(part));
  const prerelease =
    m[5] === undefined
      ? []
      : m[5].split(".").map((id) => (/^\d+$/.test(id) ? Number(id) : id));
  return {
    major: Number(m[1]),
    minor: Number(m[2] ?? "0"),
    patch: Number(m[3] ?? "0"),
    extra,
    prerelease,
    raw,
  };
}

function compareIdentifiers(a: string | number, b: string | number): number {
  const aNum = typeof a === "number";
  const bNum = typeof b === "number";
  if (aNum && bNum) return a === b ? 0 : a < b ? -1 : 1;
  // Numeric identifiers always have lower precedence than alphanumeric ones.
  if (aNum) return -1;
  if (bNum) return 1;
  return a === b ? 0 : a < b ? -1 : 1;
}

/** SemVer precedence comparison: negative when a < b, 0 when equal, positive when a > b. */
export function compareSemver(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  const extras = Math.max(a.extra.length, b.extra.length);
  for (let i = 0; i < extras; i++) {
    const ae = a.extra[i] ?? 0;
    const be = b.extra[i] ?? 0;
    if (ae !== be) return ae < be ? -1 : 1;
  }
  // A version without prerelease identifiers outranks one that has them.
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0;
  if (a.prerelease.length === 0) return 1;
  if (b.prerelease.length === 0) return -1;
  const ids = Math.max(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < ids; i++) {
    const ai = a.prerelease[i];
    const bi = b.prerelease[i];
    // A shorter prerelease list that is a prefix of the longer one ranks lower.
    if (ai === undefined) return -1;
    if (bi === undefined) return 1;
    const cmp = compareIdentifiers(ai, bi);
    if (cmp !== 0) return cmp;
  }
  return 0;
}

/**
 * Compare two version strings. Both parseable: SemVer precedence. One
 * parseable: the parseable one wins. Neither: plain string comparison, so
 * ordering stays total and deterministic.
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (pa && pb) return compareSemver(pa, pb);
  if (pa) return 1;
  if (pb) return -1;
  return a === b ? 0 : a < b ? -1 : 1;
}

/** Classify the distance between two versions ("other" when either side is not semver). */
export function bumpKind(from: string, to: string): BumpKind {
  const a = parseVersion(from);
  const b = parseVersion(to);
  if (!a || !b) return from.trim() === to.trim() ? "none" : "other";
  const cmp = compareSemver(a, b);
  if (cmp === 0) return "none";
  const [lo, hi] = cmp < 0 ? [a, b] : [b, a];
  if (hi.major !== lo.major) return "major";
  if (hi.minor !== lo.minor) return "minor";
  if (hi.patch !== lo.patch) return "patch";
  const extras = Math.max(hi.extra.length, lo.extra.length);
  for (let i = 0; i < extras; i++) {
    if ((hi.extra[i] ?? 0) !== (lo.extra[i] ?? 0)) return "patch";
  }
  return "prerelease";
}

/** Highest version in the list (undefined for an empty list). */
export function maxVersion(versions: string[]): string | undefined {
  let best: string | undefined;
  for (const v of versions) {
    if (best === undefined || compareVersions(v, best) > 0) best = v;
  }
  return best;
}

/** Ascending, de-duplicated copy of a version list. */
export function sortVersions(versions: string[]): string[] {
  return [...new Set(versions)].sort(compareVersions);
}
