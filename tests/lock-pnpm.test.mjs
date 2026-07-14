// pnpm-lock.yaml parsing across the v5 / v6-8 / v9 key grammars.
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { parsePnpmKey, parsePnpmLock } from "../dist/index.js";

function lock(entries, version = "'9.0'") {
  return `lockfileVersion: ${version}\n\npackages:\n\n${entries.map((e) => `  ${e}:\n    resolution: {integrity: sha512-x}\n`).join("\n")}`;
}

test("parses v9 quoted keys", () => {
  const snap = parsePnpmLock(lock(["'tarline@2.0.3'", "'@demo/router@3.1.0'"]));
  assert.equal(snap.format, "pnpm");
  assert.deepEqual(snap.packages.get("tarline"), ["2.0.3"]);
  assert.deepEqual(snap.packages.get("@demo/router"), ["3.1.0"]);
});

test("parses v6-8 slash-prefixed keys with @ separators", () => {
  const snap = parsePnpmLock(lock(["/tarline@2.0.3", "/@demo/router@3.1.0"], "'6.0'"));
  assert.deepEqual(snap.packages.get("tarline"), ["2.0.3"]);
  assert.deepEqual(snap.packages.get("@demo/router"), ["3.1.0"]);
});

test("parses v5 path-style keys, scoped and plain", () => {
  const snap = parsePnpmLock(lock(["/tarline/2.0.3", "/@demo/router/3.1.0"], "5.4"));
  assert.deepEqual(snap.packages.get("tarline"), ["2.0.3"]);
  assert.deepEqual(snap.packages.get("@demo/router"), ["3.1.0"]);
});

test("strips peer-dependency suffixes: (…) in v6+ and _hash in v5", () => {
  assert.deepEqual(parsePnpmKey("'ui-kit@2.1.0(react@18.2.0)(redux@5.0.0)'"), {
    name: "ui-kit",
    version: "2.1.0",
  });
  assert.deepEqual(parsePnpmKey("/ui-kit/2.1.0_react@18.2.0"), { name: "ui-kit", version: "2.1.0" });
  // v5 scoped + peer hash containing "@" is the nastiest historical shape.
  assert.deepEqual(parsePnpmKey("/@demo/router/3.1.0_history@5.3.0"), {
    name: "@demo/router",
    version: "3.1.0",
  });
});

test("skips git and tarball keys that carry no semver version", () => {
  assert.equal(parsePnpmKey("github.com/someorg/somepkg/0f0e6c7d9a"), null);
  const snap = parsePnpmLock(lock(["'real@1.0.0'", "github.com/someorg/somepkg/0f0e6c7d9a"]));
  assert.deepEqual([...snap.packages.keys()], ["real"]);
});

test("only the packages section is read; importers and snapshots are ignored", () => {
  const text = [
    "lockfileVersion: '9.0'",
    "",
    "importers:",
    "",
    "  .:",
    "    dependencies:",
    "      tarline:",
    "        specifier: ^2.0.0",
    "        version: 2.0.3",
    "",
    "packages:",
    "",
    "  'tarline@2.0.3':",
    "    resolution: {integrity: sha512-x}",
    "",
    "snapshots:",
    "",
    "  'tarline@2.0.3':",
    "    optional: false",
    "",
  ].join("\n");
  const snap = parsePnpmLock(text);
  assert.equal(snap.packages.size, 1);
  assert.deepEqual(snap.packages.get("tarline"), ["2.0.3"]);
});

test("nested duplicate versions collapse into one sorted set", () => {
  const snap = parsePnpmLock(lock(["'tarline@2.0.3'", "'tarline@1.9.0'"]));
  assert.deepEqual(snap.packages.get("tarline"), ["1.9.0", "2.0.3"]);
});

test("rejects JSON and text with neither packages nor a lockfileVersion", () => {
  assert.throws(() => parsePnpmLock('{"packages":{}}', "x.yaml"), /looks like JSON/);
  assert.throws(() => parsePnpmLock("hello: world\n", "x.yaml"), /is this really a pnpm-lock\.yaml/);
  // lockfileVersion alone (a lockfile with no external deps) is accepted.
  const empty = parsePnpmLock("lockfileVersion: '9.0'\n");
  assert.equal(empty.packages.size, 0);
});
