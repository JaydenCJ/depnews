#!/usr/bin/env node
/**
 * depnews command-line interface.
 *
 * Exit codes (shared by every subcommand, so scripts can tell a review
 * finding from a broken invocation):
 *   0  success
 *   1  --fail-on condition triggered
 *   2  usage, config or I/O error
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { UsageError, type Digest, type LockSnapshot } from "./types.js";
import { parseFlags, parseNonNegativeInt, splitList, type ParsedArgs } from "./args.js";
import { findLockfile, parseLockfile, LOCKFILE_NAMES } from "./lockfile.js";
import { computeDelta } from "./delta.js";
import { buildDigest, type DigestOptions } from "./digest.js";
import { findInstalledPackage } from "./discover.js";
import { parseChangelog, selectReleases, toSlice, type Release } from "./changelog.js";
import { renderDiffJson, renderDiffTable, renderJson, renderMarkdown, renderText } from "./report.js";
import { VERSION } from "./version.js";

const USAGE = `depnews v${VERSION} — digest the changelogs behind a lockfile diff, from installed files

usage:
  depnews digest --old <lockfile> [--new <lockfile>] [options]
  depnews diff   --old <lockfile> [--new <lockfile>] [options]
  depnews changelog <package> [--from <version>] [--to <version>] [options]

commands:
  digest      full report: version delta + changelog sections + breaking/security notes
  diff        just the version delta table
  changelog   print the extracted release sections of one installed package

common options (all commands):
  --dir <path>          project directory (default: .)
  --modules <path>      node_modules root to search; repeatable
                        (default: next to the after lockfile, or in --dir for changelog)
  --format <fmt>        text | markdown | json (default: text; markdown is digest-only)

digest / diff options:
  --old <path>          the before lockfile ("-" reads it from stdin); required
  --new <path>          the after lockfile (default: auto-detect in --dir)
  --only <names>        comma-separated packages to include ("@scope/*" prefixes allowed)
  --exclude <names>     comma-separated packages to drop

digest options:
  --max-lines <n>       per-release body cap (default: 40)
  --max-releases <n>    per-package release cap (default: 20)
  --fail-on <kinds>     exit 1 when the digest contains any of:
                        breaking, security, deprecation, major, downgrade

changelog options:
  --from <version>      show every release after this version (exclusive)
  --to <version>        up to this version inclusive (default: installed version)
  --all                 show every release in the file instead
  --max-lines <n>       per-release body cap (default: 200)

other:
  depnews --help        this text
  depnews --version     print the version

Supported lockfiles: ${LOCKFILE_NAMES.join(", ")}.
Everything is read from local disk; depnews never talks to a registry.`;

type Format = "text" | "markdown" | "json";

function readFormat(args: ParsedArgs): Format {
  const raw = args.strings.get("--format") ?? "text";
  if (raw === "text" || raw === "markdown" || raw === "json") return raw;
  throw new UsageError(`--format must be text, markdown or json, got "${raw}"`);
}

function readTextFile(path: string, label: string): string {
  if (path === "-") {
    try {
      return readFileSync(0, "utf8");
    } catch (err) {
      throw new UsageError(`cannot read ${label} from stdin (${(err as Error).message})`);
    }
  }
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    throw new UsageError(`cannot read ${label} "${path}" (${(err as Error).message})`);
  }
}

interface ResolvedInputs {
  before: LockSnapshot;
  after: LockSnapshot;
  moduleDirs: string[];
  dir: string;
}

/** Shared --old/--new/--dir/--modules resolution for digest and diff. */
function resolveInputs(args: ParsedArgs): ResolvedInputs {
  const dir = args.strings.get("--dir") ?? ".";
  const oldPath = args.strings.get("--old");
  if (oldPath === undefined) throw new UsageError("--old <lockfile> is required (use - for stdin)");

  let newPath = args.strings.get("--new");
  if (newPath === "-") {
    if (oldPath === "-") throw new UsageError("--old and --new cannot both read stdin");
  }
  if (newPath === undefined) {
    const found = findLockfile(dir);
    if (found === null) {
      throw new UsageError(
        `no lockfile found in "${dir}" (looked for ${LOCKFILE_NAMES.join(", ")}); pass --new explicitly`,
      );
    }
    newPath = found;
  }

  const before = parseLockfile(readTextFile(oldPath, "the before lockfile"), oldPath === "-" ? "" : oldPath);
  const after = parseLockfile(readTextFile(newPath, "the after lockfile"), newPath === "-" ? "" : newPath);
  if (oldPath === "-") before.path = "<stdin>";
  if (newPath === "-") after.path = "<stdin>";

  let moduleDirs = args.lists.get("--modules") ?? [];
  if (moduleDirs.length === 0) {
    const anchor = newPath === "-" ? dir : dirname(newPath);
    moduleDirs = [join(anchor, "node_modules")];
  }
  return { before, after, moduleDirs, dir };
}

const FAIL_ON_KINDS = ["breaking", "security", "deprecation", "major", "downgrade"] as const;
type FailOn = (typeof FAIL_ON_KINDS)[number];

function readFailOn(args: ParsedArgs): FailOn[] {
  const kinds = splitList(args.strings.get("--fail-on"));
  for (const kind of kinds) {
    if (!(FAIL_ON_KINDS as readonly string[]).includes(kind)) {
      throw new UsageError(`--fail-on accepts ${FAIL_ON_KINDS.join(", ")}; got "${kind}"`);
    }
  }
  return kinds as FailOn[];
}

/** Evaluate --fail-on conditions; returns human-readable violations. */
export function failOnViolations(digest: Digest, kinds: FailOn[]): string[] {
  const violations: string[] = [];
  const count = (n: number, what: string): string => `${what} (${n} package${n === 1 ? "" : "s"})`;
  for (const kind of kinds) {
    if (kind === "breaking" && digest.summary.breaking > 0) violations.push(count(digest.summary.breaking, "breaking"));
    if (kind === "security" && digest.summary.security > 0) violations.push(count(digest.summary.security, "security"));
    if (kind === "deprecation" && digest.summary.deprecation > 0) violations.push(count(digest.summary.deprecation, "deprecation"));
    if (kind === "downgrade" && digest.summary.downgraded > 0) violations.push(count(digest.summary.downgraded, "downgrade"));
    if (kind === "major") {
      const majors = digest.entries.filter(
        (e) => (e.kind === "upgraded" || e.kind === "downgraded") && e.bump === "major",
      ).length;
      if (majors > 0) violations.push(count(majors, "major"));
    }
  }
  return violations;
}

function cmdDigest(argv: string[]): number {
  const args = parseFlags(argv, {
    strings: ["--old", "--new", "--dir", "--format", "--only", "--exclude", "--max-lines", "--max-releases", "--fail-on"],
    lists: ["--modules"],
  });
  if (args.positionals.length > 0) throw new UsageError(`digest takes no positional arguments, got "${args.positionals[0]}"`);
  const format = readFormat(args);
  const failOn = readFailOn(args);
  const inputs = resolveInputs(args);

  const options: DigestOptions = {
    moduleDirs: inputs.moduleDirs,
    baseDir: process.cwd(),
    maxLines: parseNonNegativeInt("--max-lines", args.strings.get("--max-lines"), 40),
    maxReleases: parseNonNegativeInt("--max-releases", args.strings.get("--max-releases"), 20),
    only: splitList(args.strings.get("--only")),
    exclude: splitList(args.strings.get("--exclude")),
  };
  const digest = buildDigest(inputs.before, inputs.after, options);

  if (format === "json") process.stdout.write(renderJson(digest));
  else if (format === "markdown") process.stdout.write(renderMarkdown(digest));
  else process.stdout.write(renderText(digest));

  const violations = failOnViolations(digest, failOn);
  if (violations.length > 0) {
    process.stderr.write(`depnews: --fail-on triggered: ${violations.join(", ")}\n`);
    return 1;
  }
  return 0;
}

function cmdDiff(argv: string[]): number {
  const args = parseFlags(argv, {
    strings: ["--old", "--new", "--dir", "--format", "--only", "--exclude"],
    lists: ["--modules"],
  });
  if (args.positionals.length > 0) throw new UsageError(`diff takes no positional arguments, got "${args.positionals[0]}"`);
  const format = readFormat(args);
  if (format === "markdown") throw new UsageError("diff supports --format text or json (use digest for markdown)");
  const inputs = resolveInputs(args);
  const changes = computeDelta(inputs.before, inputs.after, {
    only: splitList(args.strings.get("--only")),
    exclude: splitList(args.strings.get("--exclude")),
  });
  process.stdout.write(format === "json" ? renderDiffJson(changes) : renderDiffTable(changes));
  return 0;
}

function cmdChangelog(argv: string[]): number {
  const args = parseFlags(argv, {
    strings: ["--dir", "--from", "--to", "--format", "--max-lines"],
    lists: ["--modules"],
    booleans: ["--all"],
  });
  const name = args.positionals[0];
  if (name === undefined) throw new UsageError("changelog requires a package name");
  if (args.positionals.length > 1) throw new UsageError(`changelog takes one package name, got "${args.positionals[1]}"`);
  const format = readFormat(args);
  if (format === "markdown") throw new UsageError("changelog supports --format text or json");
  const maxLines = parseNonNegativeInt("--max-lines", args.strings.get("--max-lines"), 200);

  const dir = args.strings.get("--dir") ?? ".";
  const moduleDirs = args.lists.get("--modules") ?? [join(dir, "node_modules")];
  const wanted = args.strings.get("--to") ?? null;
  const installed = findInstalledPackage(name, moduleDirs, wanted);
  if (installed === null) {
    throw new UsageError(`package "${name}" is not installed under ${moduleDirs.join(", ")}`);
  }
  if (installed.changelogPath === null) {
    throw new UsageError(`package "${name}" ships no changelog file in ${installed.dir}`);
  }

  const parsed = parseChangelog(readTextFile(installed.changelogPath, "the changelog"));
  const to = wanted ?? installed.installedVersion;
  if (to === null) throw new UsageError(`cannot determine the installed version of "${name}"; pass --to`);

  let selected: Release[];
  if (args.booleans.has("--all")) {
    selected = parsed.releases.filter((r) => r.version !== null);
  } else {
    selected = selectReleases(parsed.releases, args.strings.get("--from") ?? null, to).selected;
  }

  if (format === "json") {
    const slices = selected.map((r) => toSlice(r as Release & { version: string }, maxLines));
    process.stdout.write(JSON.stringify({ name, path: installed.changelogPath, releases: slices }, null, 2) + "\n");
    return 0;
  }

  const lines: string[] = [`${name} — ${installed.changelogPath}`];
  if (selected.length === 0) {
    lines.push(`no matching release entries (asked for ${args.strings.get("--from") ?? "start"} -> ${to})`);
  }
  for (const release of selected) {
    const slice = toSlice(release as Release & { version: string }, maxLines);
    lines.push("");
    lines.push(`${slice.version}${slice.date !== null ? ` (${slice.date})` : ""}`);
    for (const bodyLine of slice.body) lines.push(`  ${bodyLine}`.trimEnd());
    if (slice.truncated > 0) lines.push(`  ... ${slice.truncated} more line${slice.truncated === 1 ? "" : "s"} in the file`);
  }
  process.stdout.write(lines.join("\n") + "\n");
  return 0;
}

/** Entry point; returns the process exit code. */
export function main(argv: string[]): number {
  try {
    const first = argv[0];
    if (first === undefined || first === "--help" || first === "-h" || first === "help") {
      process.stdout.write(USAGE + "\n");
      return first === undefined ? 2 : 0;
    }
    if (first === "--version" || first === "-v" || first === "version") {
      process.stdout.write(VERSION + "\n");
      return 0;
    }
    const rest = argv.slice(1);
    switch (first) {
      case "digest":
        return cmdDigest(rest);
      case "diff":
        return cmdDiff(rest);
      case "changelog":
        return cmdChangelog(rest);
      default:
        throw new UsageError(`unknown command: ${first} (try depnews --help)`);
    }
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`depnews: ${err.message}\n`);
      return 2;
    }
    process.stderr.write(`depnews: ${(err as Error).message}\n`);
    return 2;
  }
}

process.exitCode = main(process.argv.slice(2));
