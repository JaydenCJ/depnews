/**
 * depnews public API.
 *
 * The CLI is a thin layer over these functions; everything a programmatic
 * consumer needs — parsing lockfiles, computing deltas, reading installed
 * changelogs and rendering digests — is exported here with type
 * declarations.
 */

export { VERSION } from "./version.js";
export {
  UsageError,
  type BumpKind,
  type ChangeKind,
  type ChangelogInfo,
  type Digest,
  type DigestEntry,
  type DigestSummary,
  type LockFormat,
  type LockSnapshot,
  type MissingReason,
  type Note,
  type NoteType,
  type PackageChange,
  type PackageMeta,
  type ReleaseSlice,
  type SnapshotInfo,
} from "./types.js";
export {
  bumpKind,
  compareSemver,
  compareVersions,
  maxVersion,
  parseVersion,
  sortVersions,
  type SemVer,
} from "./semver.js";
export { parseNpmLock } from "./lock-npm.js";
export { parseYarnLock } from "./lock-yarn.js";
export { parsePnpmLock, parsePnpmKey } from "./lock-pnpm.js";
export { detectFormat, findLockfile, parseLockfile, LOCKFILE_NAMES } from "./lockfile.js";
export { computeDelta, type DeltaOptions } from "./delta.js";
export {
  findChangelogFile,
  findInstalledPackage,
  normalizeRepoUrl,
  readPackageMeta,
  type InstalledPackage,
} from "./discover.js";
export {
  headingVersion,
  parseChangelog,
  selectReleases,
  toSlice,
  type HeadingVersion,
  type ParsedChangelog,
  type RangeSelection,
  type Release,
} from "./changelog.js";
export { buildDigest, scanNotes, type DigestOptions } from "./digest.js";
export {
  demoteHeadings,
  renderDiffJson,
  renderDiffTable,
  renderJson,
  renderMarkdown,
  renderText,
} from "./report.js";
