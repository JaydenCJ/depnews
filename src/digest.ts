/**
 * The digest builder: joins the lockfile delta with the changelogs found on
 * disk and scans the included sections for review-critical notes
 * (breaking changes, security fixes, deprecations).
 */

import { readFileSync } from "node:fs";
import { isAbsolute, relative, sep } from "node:path";
import type {
  ChangelogInfo,
  Digest,
  DigestEntry,
  DigestSummary,
  LockSnapshot,
  Note,
  NoteType,
  PackageChange,
  ReleaseSlice,
} from "./types.js";
import { computeDelta, type DeltaOptions } from "./delta.js";
import { findInstalledPackage } from "./discover.js";
import { parseChangelog, selectReleases, toSlice, type Release } from "./changelog.js";
import { VERSION } from "./version.js";

export interface DigestOptions extends DeltaOptions {
  /** node_modules roots to search, in order. */
  moduleDirs: string[];
  /** Base for the relative paths shown in reports (default: current working directory). */
  baseDir?: string;
  /** Per-release body cap (default 40 lines). */
  maxLines?: number;
  /** Per-package release cap (default 20 sections). */
  maxReleases?: number;
}

const DEFAULT_MAX_LINES = 40;
const DEFAULT_MAX_RELEASES = 20;
const MAX_NOTES_PER_ENTRY = 20;
const NOTE_TEXT_CAP = 160;

const NOTE_PATTERNS: ReadonlyArray<{ type: NoteType; re: RegExp }> = [
  { type: "breaking", re: /\bbreaking\b/i },
  { type: "security", re: /\bsecurity\b|\bCVE-\d{4}-\d{3,}\b|\bGHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}\b|vulnerab|\badvisor(?:y|ies)\b/i },
  { type: "deprecation", re: /deprecat/i },
];

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Scan release-body lines for review-critical keywords. `startLine` is the
 * 1-based file line of the first body line, so notes point into the real
 * file. Fenced code blocks are skipped: sample output that merely mentions
 * "security" is not a security note.
 */
export function scanNotes(body: string[], startLine: number): Note[] {
  const notes: Note[] = [];
  let fenceChar: string | null = null;
  for (let i = 0; i < body.length; i++) {
    const line = body[i] ?? "";
    const fence = FENCE_RE.exec(line);
    if (fence && fence[1] !== undefined) {
      const char = fence[1][0] as string;
      if (fenceChar === null) fenceChar = char;
      else if (fenceChar === char) fenceChar = null;
      continue;
    }
    if (fenceChar !== null) continue;
    for (const { type, re } of NOTE_PATTERNS) {
      if (!re.test(line)) continue;
      const trimmed = line.trim();
      const text = trimmed.length > NOTE_TEXT_CAP ? `${trimmed.slice(0, NOTE_TEXT_CAP - 3)}...` : trimmed;
      notes.push({ type, text, line: startLine + i });
    }
  }
  return notes;
}

/** Render a path relative to baseDir with forward slashes, for stable reports on every platform. */
function displayPath(path: string, baseDir: string | undefined): string {
  let shown = path;
  if (baseDir !== undefined && isAbsolute(path)) {
    const rel = relative(baseDir, path);
    if (rel.length > 0 && !rel.startsWith("..")) shown = rel;
  }
  return sep === "/" ? shown : shown.split(sep).join("/");
}

/** Kinds that warrant a changelog lookup on the after-side tree. */
function needsChangelog(kind: PackageChange["kind"]): boolean {
  return kind === "upgraded" || kind === "downgraded" || kind === "added";
}

const KIND_ORDER: Record<PackageChange["kind"], number> = {
  upgraded: 0,
  downgraded: 1,
  changed: 2,
  added: 3,
  removed: 4,
};

function buildEntry(change: PackageChange, options: DigestOptions): DigestEntry {
  const entry: DigestEntry = {
    name: change.name,
    kind: change.kind,
    from: change.from,
    to: change.to,
    bump: change.bump,
    oldVersions: change.oldVersions,
    newVersions: change.newVersions,
    changelog: null,
    meta: null,
    notes: [],
    missing: null,
  };
  if (!needsChangelog(change.kind)) return entry;

  const target = change.to as string; // added/upgraded/downgraded always have `to`
  const installed = findInstalledPackage(change.name, options.moduleDirs, target);
  if (installed === null) {
    entry.missing = "package-not-installed";
    return entry;
  }
  entry.meta = installed.meta;
  if (installed.changelogPath === null) {
    entry.missing = "no-changelog-file";
    return entry;
  }

  let text: string;
  try {
    text = readFileSync(installed.changelogPath, "utf8");
  } catch {
    entry.missing = "no-changelog-file";
    return entry;
  }

  const parsed = parseChangelog(text);
  // Downgrades read the sections being rolled back: (to, from].
  const [lo, hi] =
    change.kind === "downgraded" ? [change.to, change.from as string] : [change.from, target];
  const selection = selectReleases(parsed.releases, lo, hi as string);

  const maxReleases = options.maxReleases ?? DEFAULT_MAX_RELEASES;
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const kept = selection.selected.slice(0, maxReleases);
  const releases: ReleaseSlice[] = kept.map((release) =>
    toSlice(release as Release & { version: string }, maxLines),
  );

  // Notes are scanned on the full pre-truncation bodies of every release in
  // range, so a cap never hides a breaking change.
  for (const release of selection.selected) {
    entry.notes.push(...scanNotes(release.body, release.bodyLine));
    if (entry.notes.length >= MAX_NOTES_PER_ENTRY) break;
  }
  entry.notes = entry.notes.slice(0, MAX_NOTES_PER_ENTRY);

  const info: ChangelogInfo = {
    path: displayPath(installed.changelogPath, options.baseDir),
    releases,
    skippedReleases: selection.selected.length - kept.length,
    // For downgrades this means "the rolled-back version has an entry".
    coversTo: selection.coversTo,
    newestListed: selection.newestListed,
  };
  entry.changelog = info;
  return entry;
}

function summarize(entries: DigestEntry[]): DigestSummary {
  const summary: DigestSummary = {
    total: entries.length,
    upgraded: 0,
    downgraded: 0,
    changed: 0,
    added: 0,
    removed: 0,
    breaking: 0,
    security: 0,
    deprecation: 0,
    withChangelog: 0,
    missingChangelog: 0,
  };
  for (const entry of entries) {
    summary[entry.kind] += 1;
    const types = new Set(entry.notes.map((n) => n.type));
    if (types.has("breaking")) summary.breaking += 1;
    if (types.has("security")) summary.security += 1;
    if (types.has("deprecation")) summary.deprecation += 1;
    if (needsChangelog(entry.kind)) {
      if (entry.changelog !== null) summary.withChangelog += 1;
      else summary.missingChangelog += 1;
    }
  }
  return summary;
}

/** Build the full digest for two snapshots. Deterministic for fixed inputs on disk. */
export function buildDigest(
  before: LockSnapshot,
  after: LockSnapshot,
  options: DigestOptions,
): Digest {
  const delta = computeDelta(before, after, { only: options.only, exclude: options.exclude });
  const entries = delta
    .map((change) => buildEntry(change, options))
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.name < b.name ? -1 : 1));

  return {
    tool: `depnews ${VERSION}`,
    before: { path: before.path, format: before.format, packageCount: before.packages.size },
    after: { path: after.path, format: after.format, packageCount: after.packages.size },
    entries,
    summary: summarize(entries),
  };
}
