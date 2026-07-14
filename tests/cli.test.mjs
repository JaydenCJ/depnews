// CLI integration: drives the compiled dist/cli.js as a child process
// against the bundled examples/ fixture and throwaway trees.
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, npmLockV3, pkgJson, runCli, tempTree } from "./helpers.mjs";

const MODULES = ["--modules", "examples/project/installed"];
const EXAMPLE = ["--old", "examples/before.lock.json", "--dir", "examples/project", ...MODULES];

test("--version matches package.json", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const { status, stdout } = runCli(["--version"]);
  assert.equal(status, 0);
  assert.equal(stdout.trim(), pkg.version);
});

test("--help documents every subcommand and the key flags", () => {
  const { status, stdout } = runCli(["--help"]);
  assert.equal(status, 0);
  for (const word of ["digest", "diff", "changelog", "--fail-on", "--format", "--modules"]) {
    assert.match(stdout, new RegExp(word), `help is missing ${word}`);
  }
  // Bare invocation prints usage but exits 2 (it did no work).
  assert.equal(runCli([]).status, 2);
});

test("digest renders the bundled example with sections and note tags", () => {
  const { status, stdout } = runCli(["digest", ...EXAMPLE]);
  assert.equal(status, 0);
  assert.match(stdout, /6 packages changed/);
  assert.match(stdout, /csv-sift {2}1\.9\.0 -> 2\.0\.0 {2}\(major\) {2}\[breaking\]/);
  assert.match(stdout, /quicklog {2}2\.4\.1 -> 2\.4\.3 {2}\(patch\) {2}\[security\]/);
  assert.match(stdout, /CVE-2026-11223/);
  assert.match(stdout, /slug-forge {2}added at 1\.0\.1/);
  assert.match(stdout, /tinydate {2}removed \(was 1\.0\.0\)/);
  // The old version's own section stays out of the digest.
  assert.doesNotMatch(stdout, /respect `NO_COLOR`/);
});

test("digest --format json is machine-readable, complete and byte-stable", () => {
  const { status, stdout } = runCli(["digest", ...EXAMPLE, "--format", "json"]);
  assert.equal(status, 0);
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.summary.total, 6);
  assert.equal(parsed.summary.breaking, 1);
  const blob = parsed.entries.find((e) => e.name === "opaque-blob");
  assert.equal(blob.missing, "no-changelog-file");
  assert.equal(blob.meta.homepage, "https://example.test/opaque-blob");
  // Re-running produces byte-identical output (no timestamps, no randomness).
  assert.equal(runCli(["digest", ...EXAMPLE, "--format", "json"]).stdout, stdout);
});

test("digest --format markdown emits the PR-ready table", () => {
  const { status, stdout } = runCli(["digest", ...EXAMPLE, "--format", "markdown"]);
  assert.equal(status, 0);
  assert.match(stdout, /^## Dependency digest/);
  assert.match(stdout, /\| csv-sift \| `1\.9\.0` -> `2\.0\.0` \| major \| breaking \|/);
});

test("--only and --exclude narrow the digest", () => {
  const only = runCli(["digest", ...EXAMPLE, "--only", "quicklog"]).stdout;
  assert.match(only, /1 package changed/);
  assert.match(only, /quicklog/);
  assert.doesNotMatch(only, /csv-sift/);
  const excluded = runCli(["digest", ...EXAMPLE, "--exclude", "quicklog,csv-sift"]).stdout;
  assert.match(excluded, /4 packages changed/);
});

test("--fail-on turns findings into exit code 1 with a stderr reason", () => {
  const breaking = runCli(["digest", ...EXAMPLE, "--fail-on", "breaking"]);
  assert.equal(breaking.status, 1);
  assert.match(breaking.stderr, /--fail-on triggered: breaking \(1 package\)/);
  const both = runCli(["digest", ...EXAMPLE, "--fail-on", "security,major"]);
  assert.equal(both.status, 1);
  assert.match(both.stderr, /security \(1 package\), major \(1 package\)/);
  // A digest without the condition passes.
  const clean = runCli(["digest", ...EXAMPLE, "--only", "slug-forge", "--fail-on", "breaking"]);
  assert.equal(clean.status, 0);
});

test("diff prints the aligned version table, including cross-format diffs", () => {
  const { status, stdout } = runCli(["diff", ...EXAMPLE]);
  assert.equal(status, 0);
  assert.match(stdout, /csv-sift\s+1\.9\.0\s+2\.0\.0\s+upgraded\s+major/);
  // yarn.lock before, pnpm-lock.yaml after: useful mid-migration.
  const cross = runCli([
    "diff",
    "--old", "examples/lockfiles/yarn-before.lock",
    "--new", "examples/lockfiles/pnpm-after.yaml",
  ]);
  assert.equal(cross.status, 0);
  assert.match(cross.stdout, /@demo\/router\s+3\.1\.0\s+3\.2\.0\s+upgraded\s+minor/);
  assert.match(cross.stdout, /ansi-mist\s+1\.0\.4\s+-\s+removed/);
});

test("changelog extracts a range from one installed package", () => {
  const { status, stdout } = runCli([
    "changelog", "quicklog", "--dir", "examples/project", ...MODULES, "--from", "2.4.1", "--to", "2.4.3",
  ]);
  assert.equal(status, 0);
  assert.match(stdout, /2\.4\.3 \(2026-07-01\)/);
  assert.match(stdout, /2\.4\.2 \(2026-06-18\)/);
  assert.doesNotMatch(stdout, /2\.4\.1 \(/);
  // Default (no --from/--to) shows the installed version's entry only.
  const single = runCli(["changelog", "quicklog", "--dir", "examples/project", ...MODULES]);
  assert.match(single.stdout, /2\.4\.3/);
  assert.doesNotMatch(single.stdout, /2\.4\.2/);
});

test("the before lockfile can be piped through stdin as --old -", (t) => {
  const old = readFileSync(join(ROOT, "examples", "before.lock.json"), "utf8");
  const { status, stdout } = runCli(["digest", "--old", "-", "--dir", "examples/project", ...MODULES], { input: old });
  assert.equal(status, 0);
  assert.match(stdout, /before: <stdin>/);
  assert.match(stdout, /6 packages changed/);
});

test("auto-detection finds the after lockfile in --dir", (t) => {
  const dir = tempTree(t, {
    "package-lock.json": npmLockV3({ quicklog: "2.4.3" }),
    "old.lock.json": npmLockV3({ quicklog: "2.4.1" }),
    "node_modules/quicklog/package.json": pkgJson("quicklog", "2.4.3"),
    "node_modules/quicklog/CHANGELOG.md": "## 2.4.3\n\n- newest\n\n## 2.4.1\n\n- old\n",
  });
  const { status, stdout } = runCli(["digest", "--old", join(dir, "old.lock.json"), "--dir", dir]);
  assert.equal(status, 0);
  assert.match(stdout, /quicklog {2}2\.4\.1 -> 2\.4\.3/);
  assert.match(stdout, /- newest/);
});

test("usage and I/O problems exit 2 with a depnews-prefixed message", () => {
  const cases = [
    ["digest", "--frobnicate"], // unknown flag
    ["digest", "--dir", "examples/project"], // missing --old
    ["digest", "--old", "examples/nope.json", "--dir", "examples/project"], // unreadable file
    ["mystery"], // unknown command
    ["digest", ...EXAMPLE, "--fail-on", "vibes"], // bad fail-on kind
    ["digest", ...EXAMPLE, "--format", "yaml"], // bad format
    ["changelog", "ghost-package", "--dir", "examples/project"], // not installed
  ];
  for (const args of cases) {
    const { status, stderr } = runCli(args);
    assert.equal(status, 2, `expected exit 2 for: ${args.join(" ")}`);
    assert.match(stderr, /^depnews: /, `stderr should be prefixed for: ${args.join(" ")}`);
  }
});
