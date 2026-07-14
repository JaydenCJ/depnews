// Changelog parsing: the heading dialects real packages ship, and range
// selection over the parsed releases.
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { headingVersion, parseChangelog, selectReleases, toSlice } from "../dist/index.js";

test("parses Keep-a-Changelog ATX headings with bracketed versions and dates", () => {
  const { releases, preamble } = parseChangelog(
    "# Changelog\n\nAll notable changes.\n\n## [1.1.0] - 2026-05-01\n\n### Added\n\n- thing\n\n## [1.0.0] - 2026-01-01\n\n- initial\n",
  );
  assert.deepEqual(releases.map((r) => r.version), ["1.1.0", "1.0.0"]);
  assert.equal(releases[0].date, "2026-05-01");
  assert.deepEqual(releases[0].body, ["### Added", "", "- thing"]);
  assert.deepEqual(preamble, ["# Changelog", "", "All notable changes."]);
});

test("parses conventional-changelog headings where the version is a markdown link", () => {
  const { releases } = parseChangelog(
    "# [2.0.0](https://example.test/compare/v1.9.0...v2.0.0) (2026-06-30)\n\n* feat: everything\n\n## [1.9.1](https://example.test/compare/v1.9.0...v1.9.1) (2026-04-11)\n\n* fix: something\n",
  );
  // conventional-changelog mixes heading levels 1 and 2 in one file.
  assert.deepEqual(releases.map((r) => r.version), ["2.0.0", "1.9.1"]);
  assert.equal(releases[0].date, "2026-06-30");
});

test("parses setext headings underlined with = or ---, but never list items", () => {
  const text =
    "2.0.0 / 2026-06-30\n==================\n\n  * breaking stuff\n\n1.9.0 / 2026-03-02\n------------------\n\n  * calm stuff\n";
  const { releases } = parseChangelog(text);
  assert.deepEqual(releases.map((r) => r.version), ["2.0.0", "1.9.0"]);
  assert.equal(releases[0].line, 1);
  assert.deepEqual(releases[1].body, ["  * calm stuff"]);
  // A list item above a --- thematic break must not become a heading.
  const trap = parseChangelog("## 1.0.0\n\n- bumped dep to 9.9.9\n---\nfooter\n");
  assert.deepEqual(trap.releases.map((r) => r.version), ["1.0.0"]);
});

test("an Unreleased section is captured but never selected into a range", () => {
  const { releases } = parseChangelog("## Unreleased\n\n- soon\n\n## 1.0.0\n\n- shipped\n");
  assert.equal(releases[0].version, null);
  assert.equal(releases[0].label, "Unreleased");
  const { selected } = selectReleases(releases, null, "1.0.0");
  assert.deepEqual(selected.map((r) => r.version), ["1.0.0"]);
});

test("headings inside fenced code blocks are body text", () => {
  const text =
    "## 1.1.0\n\n```md\n## 9.9.9 this is sample output, not a release\n```\n\n- real change\n\n## 1.0.0\n\n- first\n";
  const { releases } = parseChangelog(text);
  assert.deepEqual(releases.map((r) => r.version), ["1.1.0", "1.0.0"]);
  assert.equal(releases[0].body.includes("## 9.9.9 this is sample output, not a release"), true);
});

test("versioned headings at level 4+ stay inside their release", () => {
  const { releases } = parseChangelog("## 2.0.0\n\n#### Migrating from 1.2.0\n\n- steps\n");
  assert.deepEqual(releases.map((r) => r.version), ["2.0.0"]);
  assert.equal(releases[0].body.includes("#### Migrating from 1.2.0"), true);
});

test("headingVersion: version tokens, v-prefixes, both date styles, prose immunity", () => {
  assert.equal(headingVersion("[1.2.3] - 2026-05-01").version, "1.2.3");
  assert.equal(headingVersion("v2.0.0-rc.1").version, "2.0.0-rc.1");
  assert.equal(headingVersion("Version 1.2").version, "1.2");
  assert.equal(headingVersion("1.0.0 (2026/05/01)").date, "2026/05/01");
  assert.equal(headingVersion("[1.1.0] - 2026-05-01").date, "2026-05-01");
  // Prose headings must not become releases.
  assert.equal(headingVersion("Added").version, null);
  assert.equal(headingVersion("What's new").version, null);
  // A bare date is not a version (no dotted token).
  assert.equal(headingVersion("2026-05-01").version, null);
});

test("selectReleases picks the half-open range (from, to], newest first", () => {
  const { releases } = parseChangelog(
    "## 2.1.0\n\n- newest\n\n## 2.0.0\n\n- big\n\n## 1.9.1\n\n- fixup\n\n## 1.9.0\n\n- base\n\n## 1.8.0\n\n- old\n",
  );
  const { selected, coversTo } = selectReleases(releases, "1.9.0", "2.0.0");
  assert.deepEqual(selected.map((r) => r.version), ["2.0.0", "1.9.1"]);
  assert.equal(coversTo, true);
  // Sorting is semantic, not file order, so shuffled files still read right.
  const shuffled = parseChangelog("## 1.9.1\n\n- a\n\n## 2.0.0\n\n- b\n\n## 1.10.0\n\n- c\n");
  const picked = selectReleases(shuffled.releases, "1.9.0", "2.0.0").selected;
  assert.deepEqual(picked.map((r) => r.version), ["2.0.0", "1.10.0", "1.9.1"]);
});

test("selectReleases without a lower bound returns only the exact target entry", () => {
  const { releases } = parseChangelog("## 1.0.1\n\n- fix\n\n## 1.0.0\n\n- initial\n");
  const { selected } = selectReleases(releases, null, "1.0.1");
  assert.deepEqual(selected.map((r) => r.version), ["1.0.1"]);
});

test("a stale changelog reports coversTo=false plus the newest listed version", () => {
  const { releases } = parseChangelog("## 1.9.2\n\n- last documented\n\n## 1.9.0\n\n- base\n");
  const { selected, coversTo, newestListed } = selectReleases(releases, "1.9.0", "2.0.0");
  assert.deepEqual(selected.map((r) => r.version), ["1.9.2"]);
  assert.equal(coversTo, false);
  assert.equal(newestListed, "1.9.2");
});

test("toSlice truncates long bodies; blank edges are trimmed from bodies", () => {
  const body = Array.from({ length: 10 }, (_, i) => `- line ${i + 1}`);
  const { releases } = parseChangelog(`## 1.0.0\n\n${body.join("\n")}\n`);
  const slice = toSlice(releases[0], 4);
  assert.deepEqual(slice.body, ["- line 1", "- line 2", "- line 3", "- line 4"]);
  assert.equal(slice.truncated, 6);
  // No truncation when the body fits.
  assert.equal(toSlice(releases[0], 100).truncated, 0);
  // Blank edges never count as content, and bodyLine tracks the trim.
  const trimmed = parseChangelog("## 1.0.0\n\n\n- middle\n\n\n## 0.9.0\n\n- x\n");
  assert.deepEqual(trimmed.releases[0].body, ["- middle"]);
  assert.equal(trimmed.releases[0].bodyLine, 4);
});
