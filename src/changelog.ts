/**
 * Changelog parser: split an installed CHANGELOG/HISTORY file into
 * per-release sections, with no Markdown dependency.
 *
 * Recognized release headings (all must contain a version-shaped token):
 *
 *   ## [1.2.3] - 2024-05-01          Keep a Changelog
 *   # [2.0.0](…/compare/v1…v2) (2024-05-01)   conventional-changelog
 *   ### v1.2.3                        plain ATX, levels 1-3
 *   1.2.3 / 2024-05-01                setext (underlined with === or ---)
 *   ==================
 *   ## Unreleased                     captured, excluded from ranges
 *
 * Headings at level 4+ never split releases ("#### Bug fixes in 1.2.3"
 * stays inside its section), and anything inside a fenced code block is
 * body text no matter what it looks like.
 */

import type { ReleaseSlice } from "./types.js";
import { compareVersions, parseVersion } from "./semver.js";

/** One release section as found in the file, in file order. */
export interface Release {
  /** Normalized version string, or null for an Unreleased section. */
  version: string | null;
  /** Heading text exactly as written. */
  label: string;
  date: string | null;
  /** 1-based line number of the heading. */
  line: number;
  body: string[];
  /** 1-based file line of body[0] (after blank-edge trimming), for precise note locations. */
  bodyLine: number;
}

export interface ParsedChangelog {
  releases: Release[];
  /** Lines before the first release heading (title, intro prose). */
  preamble: string[];
}

const ATX_RE = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const SETEXT_UNDERLINE_RE = /^ {0,3}(=+|-{3,})\s*$/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const VERSION_TOKEN_RE = /\bv?(\d+\.\d+(?:\.\d+){0,2}(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?)\b/g;
const DATE_RE = /\b(\d{4}[-/]\d{1,2}[-/]\d{1,2})\b/;

/** Replace markdown links with their text so "[1.2.3](url)" scans as "1.2.3". */
function stripLinks(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, "$1")
    .replace(/[[\]]/g, " ");
}

export interface HeadingVersion {
  version: string | null;
  date: string | null;
  unreleased: boolean;
}

/** Extract the release version (and date) from a heading's text, if any. */
export function headingVersion(text: string): HeadingVersion {
  const plain = stripLinks(text);
  const dateMatch = DATE_RE.exec(plain);
  const date = dateMatch?.[1] ?? null;
  if (/\b(unreleased|upcoming)\b/i.test(plain)) {
    return { version: null, date, unreleased: true };
  }
  VERSION_TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = VERSION_TOKEN_RE.exec(plain)) !== null) {
    const token = m[1];
    if (token !== undefined && parseVersion(token)) {
      return { version: token, date, unreleased: false };
    }
  }
  return { version: null, date, unreleased: false };
}

function trimBlankEdges(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && (lines[start] ?? "").trim() === "") start += 1;
  while (end > start && (lines[end - 1] ?? "").trim() === "") end -= 1;
  return lines.slice(start, end);
}

/** Parse a changelog body into ordered release sections plus the preamble. */
export function parseChangelog(text: string): ParsedChangelog {
  const lines = text.split(/\r?\n/);
  const releases: Release[] = [];
  const preamble: string[] = [];
  let current: Release | null = null;
  let fenceChar: string | null = null;
  const rawStart = new Map<Release, number>();

  const pushBody = (line: string, lineNo: number): void => {
    if (current) {
      if (!rawStart.has(current)) rawStart.set(current, lineNo);
      current.body.push(line);
    } else {
      preamble.push(line);
    }
  };

  const finalize = (release: Release): void => {
    let lead = 0;
    while (lead < release.body.length && (release.body[lead] ?? "").trim() === "") lead += 1;
    release.body = trimBlankEdges(release.body);
    release.bodyLine = (rawStart.get(release) ?? release.line + 1) + lead;
  };

  const startRelease = (hv: HeadingVersion, label: string, lineNo: number): void => {
    if (current) finalize(current);
    current = { version: hv.version, label, date: hv.date, line: lineNo, body: [], bodyLine: lineNo + 1 };
    releases.push(current);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";

    // Fenced code blocks: nothing inside them is a heading.
    const fence = FENCE_RE.exec(line);
    if (fence && fence[1] !== undefined) {
      const char = fence[1][0] as string;
      if (fenceChar === null) fenceChar = char;
      else if (fenceChar === char) fenceChar = null;
      pushBody(line, i + 1);
      continue;
    }
    if (fenceChar !== null) {
      pushBody(line, i + 1);
      continue;
    }

    const atx = ATX_RE.exec(line);
    if (atx && atx[1] !== undefined && atx[2] !== undefined) {
      const level = atx[1].length;
      if (level <= 3) {
        const hv = headingVersion(atx[2]);
        if (hv.version !== null || hv.unreleased) {
          startRelease(hv, atx[2].trim(), i + 1);
          continue;
        }
      }
      pushBody(line, i + 1);
      continue;
    }

    // Setext heading: a non-blank, non-list line underlined by === or ---.
    const next = lines[i + 1];
    if (
      line.trim() !== "" &&
      !/^ {0,3}([-*+]|\d+[.)])\s/.test(line) &&
      next !== undefined &&
      SETEXT_UNDERLINE_RE.test(next)
    ) {
      const hv = headingVersion(line);
      if (hv.version !== null || hv.unreleased) {
        startRelease(hv, line.trim(), i + 1);
        i += 1; // consume the underline
        continue;
      }
    }

    pushBody(line, i + 1);
  }

  if (current !== null) finalize(current);
  return { releases, preamble: trimBlankEdges(preamble) };
}

export interface RangeSelection {
  /** Releases in range, newest first. */
  selected: Release[];
  /** True when the file contains an entry exactly matching `toInclusive`. */
  coversTo: boolean;
  /** Highest version mentioned anywhere in the file. */
  newestListed: string | null;
}

/**
 * Pick the releases a reviewer needs to read for a move to `toInclusive`.
 * With a `fromExclusive` bound, that is every release in (from, to]; without
 * one (a freshly added package), only the entry for `to` itself.
 */
export function selectReleases(
  releases: Release[],
  fromExclusive: string | null,
  toInclusive: string,
): RangeSelection {
  const versioned = releases.filter(
    (r): r is Release & { version: string } => r.version !== null && parseVersion(r.version) !== null,
  );

  let newestListed: string | null = null;
  for (const release of versioned) {
    if (newestListed === null || compareVersions(release.version, newestListed) > 0) {
      newestListed = release.version;
    }
  }

  const selected = versioned
    .filter((release) => {
      if (fromExclusive === null) return compareVersions(release.version, toInclusive) === 0;
      return (
        compareVersions(release.version, fromExclusive) > 0 &&
        compareVersions(release.version, toInclusive) <= 0
      );
    })
    .sort((a, b) => compareVersions(b.version, a.version));

  const coversTo = versioned.some((release) => compareVersions(release.version, toInclusive) === 0);
  return { selected, coversTo, newestListed };
}

/** Truncate a release body to `maxLines`, recording how many lines were dropped. */
export function toSlice(release: Release & { version: string }, maxLines: number): ReleaseSlice {
  const body = release.body;
  const kept = maxLines >= 0 && body.length > maxLines ? trimBlankEdges(body.slice(0, maxLines)) : body;
  return {
    version: release.version,
    label: release.label,
    date: release.date,
    line: release.line,
    body: kept,
    truncated: body.length - kept.length,
  };
}
