// Shared test helpers: build throwaway fixture trees, synthesize lockfiles
// and drive the compiled CLI. Everything is offline and deterministic; temp
// directories are removed when each test finishes.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const CLI = join(ROOT, "dist", "cli.js");

/**
 * Create a temp directory populated from a { "relative/path": "content" }
 * map and register cleanup on the test context. Returns the directory.
 */
export function tempTree(t, files = {}) {
  const dir = mkdtempSync(join(tmpdir(), "depnews-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [rel, content] of Object.entries(files)) {
    const path = join(dir, ...rel.split("/"));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  return dir;
}

/**
 * Synthesize a lockfileVersion-3 package-lock.json body. `packages` maps
 * package name (or a full "node_modules/…" key for nested installs) to a
 * version string.
 */
export function npmLockV3(packages, name = "fixture") {
  const entries = { "": { name, version: "1.0.0" } };
  for (const [key, version] of Object.entries(packages)) {
    const fullKey = key.startsWith("node_modules/") ? key : `node_modules/${key}`;
    entries[fullKey] = { version };
  }
  return JSON.stringify({ name, version: "1.0.0", lockfileVersion: 3, requires: true, packages: entries }, null, 2);
}

/** Build an in-memory LockSnapshot; values may be a version string or an array. */
export function snapshot(packages, format = "npm", path = "<memory>") {
  const map = new Map();
  for (const [name, versions] of Object.entries(packages)) {
    map.set(name, Array.isArray(versions) ? versions : [versions]);
  }
  return { format, path, packages: map };
}

/** Run the compiled CLI; returns { status, stdout, stderr }. */
export function runCli(args, { cwd = ROOT, input } = {}) {
  const result = spawnSync("node", [CLI, ...args], { encoding: "utf8", cwd, input });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/** package.json body for a fixture package. */
export function pkgJson(name, version, extra = {}) {
  return JSON.stringify({ name, version, license: "MIT", ...extra }, null, 2);
}
