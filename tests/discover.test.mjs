// Disk discovery: locating installed packages (flat and pnpm layouts) and
// ranking the changelog files they ship.
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { findChangelogFile, findInstalledPackage, normalizeRepoUrl } from "../dist/index.js";
import { pkgJson, tempTree } from "./helpers.mjs";

test("finds a flat node_modules package and reads its metadata", (t) => {
  const dir = tempTree(t, {
    "node_modules/quicklog/package.json": pkgJson("quicklog", "2.4.3", {
      description: "a logger",
      homepage: "https://example.test/quicklog",
    }),
    "node_modules/quicklog/CHANGELOG.md": "## 2.4.3\n\n- fix\n",
  });
  const found = findInstalledPackage("quicklog", [join(dir, "node_modules")], "2.4.3");
  assert.equal(found.installedVersion, "2.4.3");
  assert.equal(found.meta.homepage, "https://example.test/quicklog");
  assert.match(found.changelogPath, /CHANGELOG\.md$/);
});

test("scoped package names resolve through the extra directory level", (t) => {
  const dir = tempTree(t, {
    "node_modules/@demo/router/package.json": pkgJson("@demo/router", "3.2.0"),
    "node_modules/@demo/router/CHANGELOG.md": "## 3.2.0\n\n- x\n",
  });
  const found = findInstalledPackage("@demo/router", [join(dir, "node_modules")]);
  assert.equal(found.installedVersion, "3.2.0");
});

test("falls back to the pnpm store and prefers the wanted version there", (t) => {
  const dir = tempTree(t, {
    "node_modules/.pnpm/quicklog@2.4.1/node_modules/quicklog/package.json": pkgJson("quicklog", "2.4.1"),
    "node_modules/.pnpm/quicklog@2.4.3/node_modules/quicklog/package.json": pkgJson("quicklog", "2.4.3"),
    "node_modules/.pnpm/quicklog@2.4.3/node_modules/quicklog/CHANGELOG.md": "## 2.4.3\n\n- y\n",
  });
  const found = findInstalledPackage("quicklog", [join(dir, "node_modules")], "2.4.3");
  assert.equal(found.installedVersion, "2.4.3");
  assert.match(found.changelogPath, /2\.4\.3/);
  // Scoped names use the "+"-encoded store directory.
  const scopedDir = tempTree(t, {
    "node_modules/.pnpm/@demo+router@3.2.0/node_modules/@demo/router/package.json": pkgJson("@demo/router", "3.2.0"),
  });
  const scoped = findInstalledPackage("@demo/router", [join(scopedDir, "node_modules")], "3.2.0");
  assert.equal(scoped.installedVersion, "3.2.0");
});

test("changelog ranking prefers CHANGELOG over HISTORY over CHANGES", (t) => {
  const dir = tempTree(t, {
    "pkg/HISTORY.md": "h",
    "pkg/CHANGELOG.md": "c",
    "pkg/CHANGES.md": "x",
  });
  assert.match(findChangelogFile(join(dir, "pkg")), /CHANGELOG\.md$/);
});

test("ranking prefers .md over .txt over bare, and matching is case-insensitive", (t) => {
  const dir = tempTree(t, { "a/changelog.txt": "t", "a/ChangeLog.md": "m", "b/CHANGELOG": "bare" });
  assert.match(findChangelogFile(join(dir, "a")), /ChangeLog\.md$/);
  assert.match(findChangelogFile(join(dir, "b")), /CHANGELOG$/);
});

test("returns null for a changelog-less package and for a missing package", (t) => {
  const dir = tempTree(t, { "node_modules/opaque-blob/package.json": pkgJson("opaque-blob", "1.2.0") });
  const found = findInstalledPackage("opaque-blob", [join(dir, "node_modules")]);
  assert.equal(found.changelogPath, null);
  assert.equal(findInstalledPackage("ghost-pkg", [join(dir, "node_modules")]), null);
  // Multiple module directories are searched in order.
  const multi = tempTree(t, {
    "first/quicklog/package.json": pkgJson("quicklog", "2.4.3"),
    "second/quicklog/package.json": pkgJson("quicklog", "9.9.9"),
  });
  const picked = findInstalledPackage("quicklog", [join(multi, "first"), join(multi, "second")], "2.4.3");
  assert.equal(picked.installedVersion, "2.4.3");
});

test("normalizeRepoUrl strips git+ / .git and expands GitHub shorthand", () => {
  assert.equal(
    normalizeRepoUrl({ type: "git", url: "git+https://example.test/csv-sift.git" }),
    "https://example.test/csv-sift",
  );
  assert.equal(normalizeRepoUrl("someuser/somerepo"), "https://github.com/someuser/somerepo");
  assert.equal(normalizeRepoUrl(undefined), null);
  assert.equal(normalizeRepoUrl(""), null);
});
