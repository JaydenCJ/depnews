/**
 * Shared types for the depnews public API.
 *
 * Everything here is plain data. Lockfile parsers, the delta engine, the
 * changelog parser and the digest builder communicate exclusively through
 * these shapes, so every stage stays unit-testable with in-memory input.
 */

export type LockFormat = "npm" | "yarn" | "pnpm";

/** A parsed lockfile reduced to the only fact depnews needs: which packages resolve to which versions. */
export interface LockSnapshot {
  format: LockFormat;
  /** The path the snapshot was read from, as given by the caller (`<stdin>` for piped input). */
  path: string;
  /** Package name -> sorted, de-duplicated resolved versions (nested duplicates collapse here). */
  packages: Map<string, string[]>;
}

export type ChangeKind = "upgraded" | "downgraded" | "changed" | "added" | "removed";

export type BumpKind = "major" | "minor" | "patch" | "prerelease" | "none" | "other";

/** One package's movement between two snapshots. */
export interface PackageChange {
  name: string;
  kind: ChangeKind;
  oldVersions: string[];
  newVersions: string[];
  /** Highest version on the before side; drives the changelog range. Null for added packages. */
  from: string | null;
  /** Highest version on the after side. Null for removed packages. */
  to: string | null;
  /** Semver classification of from -> to ("other" when either side is not semver). */
  bump: BumpKind | null;
}

export type NoteType = "breaking" | "security" | "deprecation";

/** A flagged line found inside an included changelog section. */
export interface Note {
  type: NoteType;
  /** The trimmed source line, capped at 160 characters. */
  text: string;
  /** 1-based line number in the changelog file. */
  line: number;
}

/** One release section extracted from an installed changelog, ready to render. */
export interface ReleaseSlice {
  version: string;
  /** Heading text exactly as written in the file. */
  label: string;
  date: string | null;
  /** 1-based line number of the heading in the source file. */
  line: number;
  body: string[];
  /** Number of body lines dropped by the per-release limit (0 when complete). */
  truncated: number;
}

/** Everything the digest knows about one package's changelog. */
export interface ChangelogInfo {
  /** Path relative to the digest base directory, always with forward slashes. */
  path: string;
  /** Release sections inside the (from, to] range, newest first. */
  releases: ReleaseSlice[];
  /** Releases in range beyond the per-package cap (listed in the file but not shown). */
  skippedReleases: number;
  /** True when the file actually contains an entry for the target version. */
  coversTo: boolean;
  /** Highest version mentioned anywhere in the file (spot outdated changelogs). */
  newestListed: string | null;
}

/** package.json metadata used as a fallback pointer when no changelog ships. */
export interface PackageMeta {
  description: string | null;
  homepage: string | null;
  repository: string | null;
}

/** Why a change carries no changelog sections. */
export type MissingReason = "package-not-installed" | "no-changelog-file" | null;

export interface DigestEntry {
  name: string;
  kind: ChangeKind;
  from: string | null;
  to: string | null;
  bump: BumpKind | null;
  oldVersions: string[];
  newVersions: string[];
  changelog: ChangelogInfo | null;
  meta: PackageMeta | null;
  notes: Note[];
  missing: MissingReason;
}

export interface SnapshotInfo {
  path: string;
  format: LockFormat;
  packageCount: number;
}

export interface DigestSummary {
  /** Total number of changed packages (all kinds). */
  total: number;
  upgraded: number;
  downgraded: number;
  changed: number;
  added: number;
  removed: number;
  /** Number of packages with at least one note of the given type. */
  breaking: number;
  security: number;
  deprecation: number;
  /** Packages that needed a changelog and had one on disk / did not. */
  withChangelog: number;
  missingChangelog: number;
}

export interface Digest {
  /** Producer stamp, e.g. "depnews 0.1.0". Deliberately no timestamp: output stays byte-reproducible. */
  tool: string;
  before: SnapshotInfo;
  after: SnapshotInfo;
  entries: DigestEntry[];
  summary: DigestSummary;
}

/** Thrown for bad command lines; the CLI maps it to exit code 2. */
export class UsageError extends Error {}
