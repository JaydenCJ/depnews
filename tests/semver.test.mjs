// Semver parsing, precedence and bump classification — the foundation every
// range decision in the digest rests on.
import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  bumpKind,
  compareVersions,
  maxVersion,
  parseVersion,
  sortVersions,
} from "../dist/index.js";

test("parses triples, v-prefixes, prerelease identifiers; ignores build metadata", () => {
  assert.deepEqual(parseVersion("1.2.3"), {
    major: 1, minor: 2, patch: 3, extra: [], prerelease: [], raw: "1.2.3",
  });
  assert.equal(parseVersion("v2.0.1").major, 2);
  const withBuild = parseVersion("1.2.3+build.99");
  assert.equal(withBuild.patch, 3);
  assert.deepEqual(withBuild.prerelease, []);
  // Prerelease identifiers split on dots; numeric ones become numbers.
  assert.deepEqual(parseVersion("1.0.0-rc.1").prerelease, ["rc", 1]);
  assert.deepEqual(parseVersion("1.0.0-alpha.beta").prerelease, ["alpha", "beta"]);
});

test("loose mode fills missing fields and keeps extra numeric segments", () => {
  // Changelog headings often write "2.1" for "2.1.0"; both must land on the
  // same point in the ordering or range selection would drop sections.
  const short = parseVersion("2.1");
  assert.equal(short.minor, 1);
  assert.equal(short.patch, 0);
  assert.equal(compareVersions("2.1", "2.1.0"), 0);
  // Four-segment versions exist in the wild (typescript nightlies, forks).
  assert.deepEqual(parseVersion("1.2.3.4").extra, [4]);
  assert.equal(compareVersions("1.2.3.4", "1.2.3") > 0, true);
});

test("rejects input that is not version-shaped", () => {
  for (const bad of ["", "next", "1.2.x", "not 1.2.3", "one.two.three", "^1.2.3"]) {
    assert.equal(parseVersion(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

test("numeric fields compare numerically; garbage still orders deterministically", () => {
  // The classic string-compare trap: "10" < "9" as strings.
  assert.equal(compareVersions("0.10.0", "0.9.0") > 0, true);
  assert.equal(compareVersions("2.0.0", "10.0.0") < 0, true);
  assert.equal(compareVersions("1.2.3", "1.2.3"), 0);
  // A parseable version outranks garbage; garbage orders by plain string.
  assert.equal(compareVersions("1.0.0", "garbage") > 0, true);
  assert.equal(compareVersions("apple", "banana") < 0, true);
  assert.equal(compareVersions("same", "same"), 0);
});

test("a release outranks all of its own prereleases", () => {
  assert.equal(compareVersions("1.0.0", "1.0.0-rc.9") > 0, true);
  assert.equal(compareVersions("1.0.0-alpha", "1.0.0") < 0, true);
});

test("prerelease ordering follows semver precedence rules", () => {
  // alpha < alpha.1 (prefix ranks lower) < beta.2 < beta.11 (numeric) < rc.1
  const order = ["1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-beta.2", "1.0.0-beta.11", "1.0.0-rc.1"];
  for (let i = 1; i < order.length; i++) {
    assert.equal(compareVersions(order[i - 1], order[i]) < 0, true, `${order[i - 1]} < ${order[i]}`);
  }
  // Numeric identifiers rank below alphanumeric ones.
  assert.equal(compareVersions("1.0.0-1", "1.0.0-alpha") < 0, true);
});

test("bumpKind classifies the distance regardless of direction", () => {
  assert.equal(bumpKind("1.9.0", "2.0.0"), "major");
  assert.equal(bumpKind("3.1.0", "3.2.0"), "minor");
  assert.equal(bumpKind("2.4.1", "2.4.3"), "patch");
  assert.equal(bumpKind("1.0.0-rc.1", "1.0.0-rc.2"), "prerelease");
  // A downgrade is still a "major" distance; the delta kind carries direction.
  assert.equal(bumpKind("2.0.0", "1.9.0"), "major");
  assert.equal(bumpKind("1.2.3", "1.2.3"), "none");
  assert.equal(bumpKind("abc", "def"), "other");
});

test("maxVersion and sortVersions dedupe and order whole lists", () => {
  assert.equal(maxVersion(["1.0.0", "0.10.0", "1.0.0-rc.1"]), "1.0.0");
  assert.equal(maxVersion([]), undefined);
  assert.deepEqual(sortVersions(["2.0.0", "1.0.0", "2.0.0", "1.10.0"]), ["1.0.0", "1.10.0", "2.0.0"]);
});
