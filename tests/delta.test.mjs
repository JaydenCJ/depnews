// The delta engine: classifying package movement between two snapshots.
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { computeDelta } from "../dist/index.js";
import { snapshot } from "./helpers.mjs";

test("classifies upgrades with their semver bump", () => {
  const delta = computeDelta(snapshot({ quicklog: "2.4.1" }), snapshot({ quicklog: "2.4.3" }));
  assert.equal(delta.length, 1);
  const change = delta[0];
  assert.equal(change.kind, "upgraded");
  assert.equal(change.from, "2.4.1");
  assert.equal(change.to, "2.4.3");
  assert.equal(change.bump, "patch");
});

test("classifies downgrades, additions and removals", () => {
  const delta = computeDelta(
    snapshot({ "csv-sift": "2.0.0", tinydate: "1.0.0" }),
    snapshot({ "csv-sift": "1.9.0", "slug-forge": "1.0.1" }),
  );
  const byName = new Map(delta.map((c) => [c.name, c]));
  assert.equal(byName.get("csv-sift").kind, "downgraded");
  assert.equal(byName.get("csv-sift").bump, "major");
  assert.equal(byName.get("slug-forge").kind, "added");
  assert.equal(byName.get("slug-forge").from, null);
  assert.equal(byName.get("tinydate").kind, "removed");
  assert.equal(byName.get("tinydate").to, null);
});

test("unchanged packages never appear in the delta", () => {
  const delta = computeDelta(
    snapshot({ muffin: "0.3.2", quicklog: "2.4.1" }),
    snapshot({ muffin: "0.3.2", quicklog: "2.4.3" }),
  );
  assert.deepEqual(delta.map((c) => c.name), ["quicklog"]);
});

test("a shifted resolved set with the same top version is 'changed'", () => {
  // Deduping a nested duplicate is worth flagging but is not an upgrade.
  const delta = computeDelta(
    snapshot({ "ansi-mist": ["1.0.4", "2.0.0"] }),
    snapshot({ "ansi-mist": ["2.0.0"] }),
  );
  assert.equal(delta[0].kind, "changed");
  assert.equal(delta[0].from, "2.0.0");
  assert.equal(delta[0].to, "2.0.0");
});

test("from/to pick the highest version on each side", () => {
  const delta = computeDelta(
    snapshot({ dep: ["1.0.0", "1.5.0"] }),
    snapshot({ dep: ["1.5.0", "2.2.0"] }),
  );
  assert.equal(delta[0].from, "1.5.0");
  assert.equal(delta[0].to, "2.2.0");
  assert.equal(delta[0].kind, "upgraded");
});

test("only/exclude filters accept exact names and @scope/* prefixes", () => {
  const before = snapshot({ "@demo/router": "3.1.0", "@demo/store": "1.0.0", quicklog: "2.4.1" });
  const after = snapshot({ "@demo/router": "3.2.0", "@demo/store": "1.1.0", quicklog: "2.4.3" });
  const scoped = computeDelta(before, after, { only: ["@demo/*"] });
  assert.deepEqual(scoped.map((c) => c.name), ["@demo/router", "@demo/store"]);
  const excluded = computeDelta(before, after, { exclude: ["@demo/*"] });
  assert.deepEqual(excluded.map((c) => c.name), ["quicklog"]);
  // exclude wins over only for the same name.
  const both = computeDelta(before, after, { only: ["@demo/*"], exclude: ["@demo/store"] });
  assert.deepEqual(both.map((c) => c.name), ["@demo/router"]);
});

test("output is sorted by package name", () => {
  const delta = computeDelta(
    snapshot({ zeta: "1.0.0", alpha: "1.0.0" }),
    snapshot({ zeta: "2.0.0", alpha: "2.0.0", "@demo/router": "3.2.0" }),
  );
  assert.deepEqual(delta.map((c) => c.name), ["@demo/router", "alpha", "zeta"]);
});

test("non-semver versions still produce a change with bump 'other'", () => {
  const delta = computeDelta(snapshot({ weird: "blue" }), snapshot({ weird: "green" }));
  assert.equal(delta[0].kind, "upgraded"); // "green" > "blue" by string order
  assert.equal(delta[0].bump, "other");
});
