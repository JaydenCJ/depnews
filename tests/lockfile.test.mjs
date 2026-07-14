// Format detection and the parseLockfile/findLockfile entry points.
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { detectFormat, findLockfile, parseLockfile, LOCKFILE_NAMES } from "../dist/index.js";
import { npmLockV3, tempTree } from "./helpers.mjs";

test("the filename wins: all four conventional names map to their format", () => {
  assert.equal(detectFormat("", "/proj/package-lock.json"), "npm");
  assert.equal(detectFormat("", "/proj/npm-shrinkwrap.json"), "npm");
  assert.equal(detectFormat("", "/proj/yarn.lock"), "yarn");
  assert.equal(detectFormat("", "/proj/pnpm-lock.yaml"), "pnpm");
});

test("content sniffing covers renamed files and stdin", () => {
  assert.equal(detectFormat("{\n  \"lockfileVersion\": 3\n}", "old.txt"), "npm");
  assert.equal(detectFormat("lockfileVersion: '9.0'\npackages:\n", "old.txt"), "pnpm");
  assert.equal(detectFormat("__metadata:\n  version: 8\n", "old.txt"), "yarn");
  assert.equal(detectFormat("# yarn lockfile v1\n", "old.txt"), "yarn");
  // Bare v1 shape without the marker comment: header + indented version.
  assert.equal(detectFormat('foo@^1.0.0:\n  version "1.0.0"\n', "old.txt"), "yarn");
});

test("undetectable content is a hard error naming the input", () => {
  assert.throws(() => detectFormat("random prose", "mystery.txt"), /mystery\.txt: cannot detect/);
});

test("parseLockfile yields the same packages from all three formats", () => {
  const npm = parseLockfile(npmLockV3({ tarline: "2.0.3" }), "package-lock.json");
  const yarn = parseLockfile('# yarn lockfile v1\ntarline@^2.0.0:\n  version "2.0.3"\n', "yarn.lock");
  const pnpm = parseLockfile(
    "lockfileVersion: '9.0'\npackages:\n  'tarline@2.0.3':\n    resolution: {integrity: sha512-x}\n",
    "pnpm-lock.yaml",
  );
  for (const snap of [npm, yarn, pnpm]) {
    assert.deepEqual(snap.packages.get("tarline"), ["2.0.3"]);
  }
  assert.deepEqual([npm.format, yarn.format, pnpm.format], ["npm", "yarn", "pnpm"]);
});

test("findLockfile probes the documented names in order", (t) => {
  const dir = tempTree(t, {
    "yarn.lock": "# yarn lockfile v1\n",
    "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
  });
  // yarn.lock beats pnpm-lock.yaml per LOCKFILE_NAMES order.
  assert.match(findLockfile(dir), /yarn\.lock$/);
  const empty = tempTree(t, {});
  assert.equal(findLockfile(empty), null);
  assert.equal(LOCKFILE_NAMES[0], "package-lock.json");
});
