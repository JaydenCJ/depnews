// package-lock.json parsing across lockfileVersion 1, 2 and 3 layouts.
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { parseNpmLock } from "../dist/index.js";
import { npmLockV3 } from "./helpers.mjs";

test("parses a v3 packages map into sorted names and versions", () => {
  const snap = parseNpmLock(npmLockV3({ "quicklog": "2.4.3", "csv-sift": "2.0.0", "@demo/router": "3.2.0" }));
  assert.equal(snap.format, "npm");
  assert.deepEqual(snap.packages.get("quicklog"), ["2.4.3"]);
  assert.deepEqual(snap.packages.get("csv-sift"), ["2.0.0"]);
  // Names come out sorted for deterministic downstream output.
  assert.deepEqual([...snap.packages.keys()], ["@demo/router", "csv-sift", "quicklog"]);
});

test("collapses nested duplicate installs into one sorted version set", () => {
  // The same package at two versions via nesting is one logical entry.
  const snap = parseNpmLock(
    npmLockV3({ "ansi-mist": "2.0.0", "node_modules/legacy-tool/node_modules/ansi-mist": "1.0.4", "legacy-tool": "3.0.0" }),
  );
  assert.deepEqual(snap.packages.get("ansi-mist"), ["1.0.4", "2.0.0"]);
});

test("skips the root project, workspace source dirs and link entries", () => {
  const body = JSON.stringify({
    lockfileVersion: 3,
    packages: {
      "": { name: "monorepo", version: "1.0.0" },
      "packages/app": { version: "1.0.0" }, // workspace source, not third-party
      "node_modules/my-lib": { link: true, resolved: "packages/lib" },
      "node_modules/real-dep": { version: "1.2.3" },
    },
  });
  const snap = parseNpmLock(body);
  assert.deepEqual([...snap.packages.keys()], ["real-dep"]);
});

test("derives scoped names from nested keys and honors a name override", () => {
  const body = JSON.stringify({
    lockfileVersion: 3,
    packages: {
      "node_modules/wrapper/node_modules/@demo/router": { version: "3.2.0" },
      "node_modules/aliased": { name: "actual-name", version: "1.0.0" },
      "node_modules/wrapper": { version: "1.0.0" },
    },
  });
  const snap = parseNpmLock(body);
  assert.deepEqual(snap.packages.get("@demo/router"), ["3.2.0"]);
  assert.deepEqual(snap.packages.get("actual-name"), ["1.0.0"]);
  assert.equal(snap.packages.has("aliased"), false);
});

test("parses a legacy v1 dependencies tree recursively", () => {
  const body = JSON.stringify({
    name: "old-app",
    lockfileVersion: 1,
    dependencies: {
      "quicklog": { version: "2.4.1", dependencies: { "ansi-mist": { version: "1.0.4" } } },
      "tinydate": { version: "1.0.0" },
    },
  });
  const snap = parseNpmLock(body);
  assert.deepEqual([...snap.packages.keys()], ["ansi-mist", "quicklog", "tinydate"]);
  assert.deepEqual(snap.packages.get("ansi-mist"), ["1.0.4"]);
});

test("rejects invalid JSON with the file path in the message", () => {
  assert.throws(() => parseNpmLock("{ nope", "broken.json"), /broken\.json: not valid JSON/);
});

test("rejects JSON that has neither packages nor dependencies", () => {
  assert.throws(
    () => parseNpmLock(JSON.stringify({ name: "x" }), "x.json"),
    /no "packages" or "dependencies" section/,
  );
});
