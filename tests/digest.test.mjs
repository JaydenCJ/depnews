// The digest builder: delta + on-disk changelogs + note scanning, end to end
// against throwaway fixture trees.
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { buildDigest, parseLockfile, scanNotes } from "../dist/index.js";
import { npmLockV3, pkgJson, tempTree } from "./helpers.mjs";

/** Standard fixture: one of each change kind, with changelogs to match. */
function makeProject(t) {
  const dir = tempTree(t, {
    "node_modules/quicklog/package.json": pkgJson("quicklog", "2.4.3"),
    "node_modules/quicklog/CHANGELOG.md":
      "# Changelog\n\n## 2.4.3 (2026-07-01)\n\n- flush on exit\n\n## 2.4.2 (2026-06-18)\n\n- security: escape ANSI in fields (CVE-2026-11223)\n\n## 2.4.1 (2026-05-30)\n\n- older\n",
    "node_modules/csv-sift/package.json": pkgJson("csv-sift", "2.0.0"),
    "node_modules/csv-sift/HISTORY.md":
      "2.0.0 / 2026-06-30\n==================\n\n  * BREAKING: promise API only\n  * drop Node 16\n  * faster parser\n\n1.9.0 / 2026-03-02\n==================\n\n  * base\n",
    "node_modules/opaque-blob/package.json": pkgJson("opaque-blob", "1.2.0", {
      homepage: "https://example.test/opaque-blob",
    }),
    "node_modules/slug-forge/package.json": pkgJson("slug-forge", "1.0.1"),
    "node_modules/slug-forge/CHANGELOG.md": "## 1.0.1\n\n- added pkg entry\n\n## 1.0.0\n\n- initial\n",
  });
  const before = parseLockfile(
    npmLockV3({ quicklog: "2.4.1", "csv-sift": "1.9.0", "opaque-blob": "1.1.0", tinydate: "1.0.0" }),
    "before.json",
  );
  const after = parseLockfile(
    npmLockV3({ quicklog: "2.4.3", "csv-sift": "2.0.0", "opaque-blob": "1.2.0", "slug-forge": "1.0.1" }),
    "after.json",
  );
  return { dir, before, after, options: { moduleDirs: [join(dir, "node_modules")], baseDir: dir } };
}

test("builds entries for every change kind and a summary that matches them", (t) => {
  const { before, after, options } = makeProject(t);
  const digest = buildDigest(before, after, options);
  assert.deepEqual(
    digest.entries.map((e) => [e.name, e.kind]),
    [
      ["csv-sift", "upgraded"],
      ["opaque-blob", "upgraded"],
      ["quicklog", "upgraded"],
      ["slug-forge", "added"],
      ["tinydate", "removed"],
    ],
  );
  const { summary } = digest;
  assert.equal(summary.total, 5);
  assert.equal(summary.upgraded, 3);
  assert.equal(summary.added, 1);
  assert.equal(summary.removed, 1);
  assert.equal(summary.breaking, 1);
  assert.equal(summary.security, 1);
  assert.equal(summary.withChangelog, 3);
  assert.equal(summary.missingChangelog, 1);
});

test("includes exactly the releases in (from, to], with baseDir-relative paths", (t) => {
  const { before, after, options } = makeProject(t);
  const digest = buildDigest(before, after, options);
  const quicklog = digest.entries.find((e) => e.name === "quicklog");
  // 2.4.1 is the old version: its section must not reappear.
  assert.deepEqual(quicklog.changelog.releases.map((r) => r.version), ["2.4.3", "2.4.2"]);
  const added = digest.entries.find((e) => e.name === "slug-forge");
  assert.deepEqual(added.changelog.releases.map((r) => r.version), ["1.0.1"]);
  // Paths are relative to baseDir and use forward slashes on every platform.
  assert.equal(quicklog.changelog.path, "node_modules/quicklog/CHANGELOG.md");
});

test("flags breaking and security notes with real file line numbers", (t) => {
  const { before, after, options } = makeProject(t);
  const digest = buildDigest(before, after, options);
  const csv = digest.entries.find((e) => e.name === "csv-sift");
  assert.equal(csv.notes.some((n) => n.type === "breaking"), true);
  const quicklog = digest.entries.find((e) => e.name === "quicklog");
  const security = quicklog.notes.find((n) => n.type === "security");
  assert.match(security.text, /CVE-2026-11223/);
  // Line 9 of the fixture CHANGELOG.md holds the security bullet.
  assert.equal(security.line, 9);
});

test("scanNotes skips fenced code blocks and caps note text length", () => {
  const notes = scanNotes(["```", "this security word is sample output", "```", "- real security fix"], 1);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].line, 4);
  const long = scanNotes([`- breaking: ${"x".repeat(300)}`], 10);
  assert.equal(long[0].text.length, 160);
  assert.equal(long[0].text.endsWith("..."), true);
});

test("maxLines truncates release bodies and records the dropped count", (t) => {
  const { before, after, options } = makeProject(t);
  const digest = buildDigest(before, after, { ...options, maxLines: 1 });
  const csv = digest.entries.find((e) => e.name === "csv-sift");
  const first = csv.changelog.releases[0];
  assert.equal(first.body.length, 1);
  assert.equal(first.truncated > 0, true);
  // Notes are scanned before truncation, so the breaking flag survives.
  assert.equal(csv.notes.some((n) => n.type === "breaking"), true);
});

test("maxReleases caps the sections and reports how many were skipped", (t) => {
  const dir = tempTree(t, {
    "node_modules/chatty/package.json": pkgJson("chatty", "1.0.5"),
    "node_modules/chatty/CHANGELOG.md":
      ["## 1.0.5", "- e", "## 1.0.4", "- d", "## 1.0.3", "- c", "## 1.0.2", "- b", "## 1.0.1", "- a"].join("\n\n") + "\n",
  });
  const before = parseLockfile(npmLockV3({ chatty: "1.0.0" }), "b.json");
  const after = parseLockfile(npmLockV3({ chatty: "1.0.5" }), "a.json");
  const digest = buildDigest(before, after, { moduleDirs: [join(dir, "node_modules")], baseDir: dir, maxReleases: 2 });
  const entry = digest.entries[0];
  assert.deepEqual(entry.changelog.releases.map((r) => r.version), ["1.0.5", "1.0.4"]);
  assert.equal(entry.changelog.skippedReleases, 3);
});

test("a changelog-less package reports the reason and falls back to metadata", (t) => {
  const { before, after, options } = makeProject(t);
  const digest = buildDigest(before, after, options);
  const blob = digest.entries.find((e) => e.name === "opaque-blob");
  assert.equal(blob.missing, "no-changelog-file");
  assert.equal(blob.changelog, null);
  assert.equal(blob.meta.homepage, "https://example.test/opaque-blob");
});

test("a package absent from disk is reported as not installed", (t) => {
  const dir = tempTree(t, {});
  const before = parseLockfile(npmLockV3({ ghost: "1.0.0" }), "b.json");
  const after = parseLockfile(npmLockV3({ ghost: "2.0.0" }), "a.json");
  const digest = buildDigest(before, after, { moduleDirs: [join(dir, "node_modules")], baseDir: dir });
  assert.equal(digest.entries[0].missing, "package-not-installed");
});

test("a stale changelog yields coversTo=false and the newest listed version", (t) => {
  const dir = tempTree(t, {
    "node_modules/sleepy/package.json": pkgJson("sleepy", "3.0.0"),
    "node_modules/sleepy/CHANGELOG.md": "## 2.5.0\n\n- last documented release\n",
  });
  const before = parseLockfile(npmLockV3({ sleepy: "2.0.0" }), "b.json");
  const after = parseLockfile(npmLockV3({ sleepy: "3.0.0" }), "a.json");
  const digest = buildDigest(before, after, { moduleDirs: [join(dir, "node_modules")], baseDir: dir });
  const entry = digest.entries[0];
  assert.equal(entry.changelog.coversTo, false);
  assert.equal(entry.changelog.newestListed, "2.5.0");
  assert.deepEqual(entry.changelog.releases.map((r) => r.version), ["2.5.0"]);
});

test("a downgrade digests the sections being rolled back", (t) => {
  const dir = tempTree(t, {
    "node_modules/csv-sift/package.json": pkgJson("csv-sift", "1.9.0"),
    "node_modules/csv-sift/HISTORY.md":
      "2.0.0 / 2026-06-30\n==================\n\n  * BREAKING: promise API only\n\n1.9.0 / 2026-03-02\n==================\n\n  * base\n",
  });
  const before = parseLockfile(npmLockV3({ "csv-sift": "2.0.0" }), "b.json");
  const after = parseLockfile(npmLockV3({ "csv-sift": "1.9.0" }), "a.json");
  const digest = buildDigest(before, after, { moduleDirs: [join(dir, "node_modules")], baseDir: dir });
  const entry = digest.entries[0];
  assert.equal(entry.kind, "downgraded");
  // The rolled-back range is (to, from] = (1.9.0, 2.0.0].
  assert.deepEqual(entry.changelog.releases.map((r) => r.version), ["2.0.0"]);
});

