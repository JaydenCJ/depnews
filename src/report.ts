/**
 * Renderers: turn a Digest into terminal text, PR-ready Markdown, or
 * stable-keyed JSON. All three are pure functions of the digest, contain no
 * timestamps and no randomness, so re-running on the same tree is
 * byte-identical (the test suite asserts this).
 */

import type { Digest, DigestEntry, Note, NoteType, PackageChange } from "./types.js";

const NOTE_ORDER: NoteType[] = ["breaking", "security", "deprecation"];

/** Distinct note types present on an entry, in severity order. */
function noteTypes(entry: DigestEntry): NoteType[] {
  const present = new Set(entry.notes.map((n) => n.type));
  return NOTE_ORDER.filter((t) => present.has(t));
}

function headline(entry: DigestEntry): string {
  switch (entry.kind) {
    case "upgraded":
      return `${entry.from} -> ${entry.to}  (${entry.bump})`;
    case "downgraded":
      return `${entry.from} -> ${entry.to}  (${entry.bump} downgrade)`;
    case "changed":
      return `resolved set changed, top version stays ${entry.to}`;
    case "added":
      return `added at ${entry.to}`;
    case "removed":
      return `removed (was ${entry.from})`;
  }
}

function versionSetLine(entry: DigestEntry): string | null {
  if (entry.oldVersions.length <= 1 && entry.newVersions.length <= 1) return null;
  const left = entry.oldVersions.length > 0 ? entry.oldVersions.join(", ") : "(none)";
  const right = entry.newVersions.length > 0 ? entry.newVersions.join(", ") : "(none)";
  return `resolved versions: ${left} -> ${right}`;
}

function summaryParts(digest: Digest): string[] {
  const s = digest.summary;
  const parts: string[] = [];
  if (s.upgraded > 0) parts.push(`${s.upgraded} upgraded`);
  if (s.downgraded > 0) parts.push(`${s.downgraded} downgraded`);
  if (s.changed > 0) parts.push(`${s.changed} re-resolved`);
  if (s.added > 0) parts.push(`${s.added} added`);
  if (s.removed > 0) parts.push(`${s.removed} removed`);
  return parts;
}

function notesParts(digest: Digest): string[] {
  const s = digest.summary;
  const parts: string[] = [];
  if (s.breaking > 0) parts.push(`breaking in ${s.breaking} package${s.breaking === 1 ? "" : "s"}`);
  if (s.security > 0) parts.push(`security in ${s.security}`);
  if (s.deprecation > 0) parts.push(`deprecations in ${s.deprecation}`);
  return parts;
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/** Render the digest as plain terminal text. */
export function renderText(digest: Digest): string {
  const lines: string[] = [];
  lines.push(`${digest.tool} — ${digest.summary.total} package${digest.summary.total === 1 ? "" : "s"} changed`);
  lines.push(`before: ${digest.before.path} (${digest.before.format}, ${digest.before.packageCount} packages)`);
  lines.push(`after:  ${digest.after.path} (${digest.after.format}, ${digest.after.packageCount} packages)`);

  if (digest.summary.total === 0) {
    lines.push("");
    lines.push("no package changes between the two lockfiles");
    return lines.join("\n") + "\n";
  }

  const summary = summaryParts(digest).join(", ");
  const notes = notesParts(digest);
  lines.push(`change: ${summary}`);
  if (notes.length > 0) lines.push(`notes:  ${notes.join(" · ")}`);
  if (digest.summary.missingChangelog > 0) {
    lines.push(`gaps:   ${digest.summary.missingChangelog} package${digest.summary.missingChangelog === 1 ? "" : "s"} without a changelog on disk`);
  }

  for (const entry of digest.entries) {
    lines.push("");
    const tags = noteTypes(entry).map((t) => `[${t}]`).join(" ");
    lines.push(`${entry.name}  ${headline(entry)}${tags.length > 0 ? `  ${tags}` : ""}`);
    const versions = versionSetLine(entry);
    if (versions !== null) lines.push(`  ${versions}`);

    if (entry.missing === "package-not-installed") {
      lines.push("  not installed under the searched module directories");
      continue;
    }
    if (entry.missing === "no-changelog-file") {
      lines.push("  no changelog file ships with the installed package");
      if (entry.meta?.homepage) lines.push(`  homepage: ${entry.meta.homepage}`);
      else if (entry.meta?.repository) lines.push(`  repository: ${entry.meta.repository}`);
      continue;
    }
    if (entry.changelog === null) continue;

    lines.push(`  changelog: ${entry.changelog.path}`);
    if (!entry.changelog.coversTo) {
      const target = entry.kind === "downgraded" ? entry.from : entry.to;
      lines.push(
        `  note: no entry for ${target}${entry.changelog.newestListed !== null ? ` (newest listed: ${entry.changelog.newestListed})` : ""}`,
      );
    }
    if (entry.kind === "downgraded" && entry.changelog.releases.length > 0) {
      lines.push("  the sections below were rolled back by this downgrade:");
    }
    for (const release of entry.changelog.releases) {
      lines.push("");
      lines.push(`  ${release.version}${release.date !== null ? ` (${release.date})` : ""}`);
      for (const bodyLine of release.body) lines.push(`    ${bodyLine}`.trimEnd());
      if (release.truncated > 0) {
        lines.push(`    ... ${release.truncated} more line${release.truncated === 1 ? "" : "s"} in the file`);
      }
    }
    if (entry.changelog.skippedReleases > 0) {
      lines.push(`  (+${entry.changelog.skippedReleases} earlier release${entry.changelog.skippedReleases === 1 ? "" : "s"} in range not shown)`);
    }
  }

  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

const MD_FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;

/** Demote ATX headings in a body so it nests under the digest's own headings. */
export function demoteHeadings(lines: string[], by: number): string[] {
  let fenceChar: string | null = null;
  return lines.map((line) => {
    const fence = MD_FENCE_RE.exec(line);
    if (fence && fence[1] !== undefined) {
      const char = fence[1][0] as string;
      if (fenceChar === null) fenceChar = char;
      else if (fenceChar === char) fenceChar = null;
      return line;
    }
    if (fenceChar !== null) return line;
    const m = /^( {0,3})(#{1,6})(\s.*)$/.exec(line);
    if (!m || m[1] === undefined || m[2] === undefined || m[3] === undefined) return line;
    const level = Math.min(6, m[2].length + by);
    return `${m[1]}${"#".repeat(level)}${m[3]}`;
  });
}

function mdChangeCell(entry: DigestEntry): string {
  switch (entry.kind) {
    case "upgraded":
    case "downgraded":
      return `\`${entry.from}\` -> \`${entry.to}\``;
    case "changed":
      return `re-resolved at \`${entry.to}\``;
    case "added":
      return `added \`${entry.to}\``;
    case "removed":
      return `removed \`${entry.from}\``;
  }
}

/** Render the digest as Markdown ready to paste into a pull-request description. */
export function renderMarkdown(digest: Digest): string {
  const lines: string[] = [];
  lines.push("## Dependency digest");
  lines.push("");
  const summary = summaryParts(digest).join(", ");
  const notes = notesParts(digest);
  lines.push(
    `**${digest.summary.total} package${digest.summary.total === 1 ? "" : "s"} changed**` +
      (summary.length > 0 ? ` — ${summary}` : "") +
      (notes.length > 0 ? `. Notes: **${notes.join("**, **")}**.` : "."),
  );
  lines.push("");
  lines.push(`_${digest.before.path} -> ${digest.after.path}, generated by ${digest.tool} from installed files._`);

  if (digest.summary.total === 0) return lines.join("\n") + "\n";

  lines.push("");
  lines.push("| Package | Change | Bump | Notes |");
  lines.push("| --- | --- | --- | --- |");
  for (const entry of digest.entries) {
    const bump = entry.kind === "upgraded" || entry.kind === "downgraded" ? (entry.bump ?? "") : "";
    const tags = noteTypes(entry).join(", ");
    lines.push(`| ${entry.name} | ${mdChangeCell(entry)} | ${bump} | ${tags} |`);
  }

  for (const entry of digest.entries) {
    if (entry.kind === "removed" || entry.kind === "changed") continue;
    lines.push("");
    const tags = noteTypes(entry);
    lines.push(`### ${entry.name} ${headline(entry)}${tags.length > 0 ? ` — **${tags.join("**, **")}**` : ""}`);

    if (entry.missing === "package-not-installed") {
      lines.push("");
      lines.push("_Not installed under the searched module directories._");
      continue;
    }
    if (entry.missing === "no-changelog-file" || entry.changelog === null) {
      lines.push("");
      const pointer = entry.meta?.homepage ?? entry.meta?.repository;
      lines.push(
        `_No changelog file ships with the installed package.${pointer ? ` See ${pointer}` : ""}_`,
      );
      continue;
    }

    lines.push("");
    lines.push(`_Source: \`${entry.changelog.path}\`_`);
    if (!entry.changelog.coversTo) {
      const target = entry.kind === "downgraded" ? entry.from : entry.to;
      lines.push("");
      lines.push(
        `_No entry for ${target}${entry.changelog.newestListed !== null ? ` (newest listed: ${entry.changelog.newestListed})` : ""}._`,
      );
    }
    if (entry.kind === "downgraded" && entry.changelog.releases.length > 0) {
      lines.push("");
      lines.push("_The sections below were rolled back by this downgrade:_");
    }
    for (const release of entry.changelog.releases) {
      lines.push("");
      lines.push(`#### ${release.version}${release.date !== null ? ` (${release.date})` : ""}`);
      lines.push("");
      lines.push(...demoteHeadings(release.body, 4));
      if (release.truncated > 0) {
        lines.push("");
        lines.push(`_... ${release.truncated} more line${release.truncated === 1 ? "" : "s"} in the file._`);
      }
    }
    if (entry.changelog.skippedReleases > 0) {
      lines.push("");
      lines.push(`_+${entry.changelog.skippedReleases} earlier release${entry.changelog.skippedReleases === 1 ? "" : "s"} in range not shown._`);
    }
  }

  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

function noteToJson(note: Note): Record<string, unknown> {
  return { type: note.type, line: note.line, text: note.text };
}

/** Render the digest as stable-keyed, pretty-printed JSON (trailing newline included). */
export function renderJson(digest: Digest): string {
  const out = {
    tool: digest.tool,
    before: digest.before,
    after: digest.after,
    summary: digest.summary,
    entries: digest.entries.map((entry) => ({
      name: entry.name,
      kind: entry.kind,
      from: entry.from,
      to: entry.to,
      bump: entry.bump,
      oldVersions: entry.oldVersions,
      newVersions: entry.newVersions,
      missing: entry.missing,
      meta: entry.meta,
      notes: entry.notes.map(noteToJson),
      changelog:
        entry.changelog === null
          ? null
          : {
              path: entry.changelog.path,
              coversTo: entry.changelog.coversTo,
              newestListed: entry.changelog.newestListed,
              skippedReleases: entry.changelog.skippedReleases,
              releases: entry.changelog.releases.map((release) => ({
                version: release.version,
                date: release.date,
                line: release.line,
                truncated: release.truncated,
                body: release.body,
              })),
            },
    })),
  };
  return JSON.stringify(out, null, 2) + "\n";
}

// ---------------------------------------------------------------------------
// Diff table (for `depnews diff`)
// ---------------------------------------------------------------------------

/** Render the bare version delta as an aligned text table. */
export function renderDiffTable(changes: PackageChange[]): string {
  if (changes.length === 0) return "no package changes between the two lockfiles\n";
  const rows = changes.map((c) => [
    c.name,
    c.oldVersions.length > 0 ? c.oldVersions.join(",") : "-",
    c.newVersions.length > 0 ? c.newVersions.join(",") : "-",
    c.kind,
    c.kind === "upgraded" || c.kind === "downgraded" ? (c.bump ?? "-") : "-",
  ]);
  const header = ["package", "before", "after", "change", "bump"];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (cells: string[]): string =>
    cells.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join("  ").trimEnd();
  return [line(header), ...rows.map(line)].join("\n") + "\n";
}

/** Render the bare version delta as JSON. */
export function renderDiffJson(changes: PackageChange[]): string {
  return JSON.stringify(changes, null, 2) + "\n";
}
