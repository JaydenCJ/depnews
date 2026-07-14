// Renderers: text, markdown and JSON must be faithful to the digest and
// byte-deterministic.
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import {
  buildDigest,
  demoteHeadings,
  computeDelta,
  parseLockfile,
  renderDiffTable,
  renderJson,
  renderMarkdown,
  renderText,
} from "../dist/index.js";
import { npmLockV3, pkgJson, snapshot, tempTree } from "./helpers.mjs";

function makeDigest(t) {
  const dir = tempTree(t, {
    "node_modules/csv-sift/package.json": pkgJson("csv-sift", "2.0.0"),
    "node_modules/csv-sift/HISTORY.md":
      "2.0.0 / 2026-06-30\n==================\n\n  * BREAKING: promise API only\n",
    "node_modules/opaque-blob/package.json": pkgJson("opaque-blob", "1.2.0", {
      homepage: "https://example.test/opaque-blob",
    }),
  });
  const before = parseLockfile(npmLockV3({ "csv-sift": "1.9.0", "opaque-blob": "1.1.0" }), "before.json");
  const after = parseLockfile(npmLockV3({ "csv-sift": "2.0.0", "opaque-blob": "1.2.0" }), "after.json");
  return buildDigest(before, after, { moduleDirs: [join(dir, "node_modules")], baseDir: dir });
}

test("text render carries the header, summary, notes and gap lines", (t) => {
  const text = renderText(makeDigest(t));
  assert.match(text, /^depnews 0\.1\.0 — 2 packages changed/);
  assert.match(text, /change: 2 upgraded/);
  assert.match(text, /notes: {2}breaking in 1 package/);
  assert.match(text, /gaps: {3}1 package without a changelog on disk/);
  assert.match(text, /csv-sift {2}1\.9\.0 -> 2\.0\.0 {2}\(major\) {2}\[breaking\]/);
  // The empty digest gets a friendly line instead of a bare header.
  const empty = buildDigest(snapshot({ same: "1.0.0" }), snapshot({ same: "1.0.0" }), { moduleDirs: [] });
  assert.match(renderText(empty), /no package changes between the two lockfiles/);
  assert.match(renderMarkdown(empty), /\*\*0 packages changed\*\*/);
});

test("text render points at the homepage when no changelog ships", (t) => {
  const text = renderText(makeDigest(t));
  assert.match(text, /no changelog file ships with the installed package/);
  assert.match(text, /homepage: https:\/\/example\.test\/opaque-blob/);
});

test("markdown includes a table row per entry and a details section per digestable entry", (t) => {
  const md = renderMarkdown(makeDigest(t));
  assert.match(md, /^## Dependency digest/);
  assert.match(md, /\| csv-sift \| `1\.9\.0` -> `2\.0\.0` \| major \| breaking \|/);
  assert.match(md, /### csv-sift 1\.9\.0 -> 2\.0\.0/);
  assert.match(md, /#### 2\.0\.0 \(2026-06-30\)/);
  assert.match(md, /_Source: `node_modules\/csv-sift\/HISTORY\.md`_/);
});

test("markdown demotes body headings so pasted digests keep their hierarchy", () => {
  const demoted = demoteHeadings(["### Added", "", "- x", "```", "## fenced", "```"], 4);
  assert.equal(demoted[0], "###### Added"); // 3 + 4 = 7, capped at h6
  assert.equal(demoted[4], "## fenced"); // fences are untouched
});

test("json output is parseable, newline-terminated and mirrors the summary", (t) => {
  const digest = makeDigest(t);
  const raw = renderJson(digest);
  assert.equal(raw.endsWith("\n"), true);
  const parsed = JSON.parse(raw);
  assert.equal(parsed.tool, "depnews 0.1.0");
  assert.equal(parsed.summary.total, 2);
  assert.equal(parsed.entries.length, 2);
  assert.equal(parsed.entries[0].changelog.releases[0].version, "2.0.0");
});

test("all renderers are byte-deterministic for the same digest", (t) => {
  const digest = makeDigest(t);
  assert.equal(renderText(digest), renderText(digest));
  assert.equal(renderMarkdown(digest), renderMarkdown(digest));
  assert.equal(renderJson(digest), renderJson(digest));
});

test("diff table aligns columns and handles the empty delta", () => {
  const changes = computeDelta(
    snapshot({ "csv-sift": "1.9.0", tinydate: "1.0.0" }),
    snapshot({ "csv-sift": "2.0.0" }),
  );
  const table = renderDiffTable(changes);
  const lines = table.trimEnd().split("\n");
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^package\s+before\s+after\s+change\s+bump$/);
  assert.match(lines[1], /^csv-sift\s+1\.9\.0\s+2\.0\.0\s+upgraded\s+major$/);
  assert.match(lines[2], /^tinydate\s+1\.0\.0\s+-\s+removed\s+-$/);
  assert.match(renderDiffTable([]), /no package changes/);
});
