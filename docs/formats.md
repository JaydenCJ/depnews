# Supported formats

Everything depnews reads is a local file. This page documents exactly which
shapes it understands, so you can predict what a digest will and will not
find.

## Lockfiles

| File | Dialects understood | Notes |
|---|---|---|
| `package-lock.json` / `npm-shrinkwrap.json` | lockfileVersion 1, 2, 3 | v2/v3 `packages` map (root, workspace-source and `link` entries skipped); v1 nested `dependencies` tree |
| `yarn.lock` | classic v1, Berry (v2+) | `workspace:` selectors and `0.0.0-use.local` resolutions skipped |
| `pnpm-lock.yaml` | v5, v6-8, v9 key grammars | peer suffixes (`(…)`, `_hash`) stripped; git/tarball entries without a semver version skipped |

Detection order: filename first (the four conventional names are rigid),
then content sniffing for renamed files and stdin. The two sides of a diff
may use different formats — useful while migrating package managers.

A package that resolves to several versions at once (nested duplicates) is
tracked as a version *set*; the digest compares the highest version on each
side and lists the full set when it has more than one member.

## Where changelogs are looked for

For each changed package, depnews searches the module roots you pass with
`--modules` (default: the `node_modules` next to the after lockfile):

1. the flat layout: `node_modules/<name>/`
2. the pnpm store: `node_modules/.pnpm/<name-encoded>@<version>*/node_modules/<name>/`
   (scoped names encode `/` as `+`; the entry matching the target version wins)

Within the package directory, candidate files are ranked by basename, then
extension — first hit wins:

- basenames: `CHANGELOG`, `HISTORY`, `CHANGES`, `NEWS`, `RELEASES`, `RELEASE-NOTES`, `RELEASE_NOTES`, `RELEASENOTES` (case-insensitive)
- extensions: `.md`, `.markdown`, `.txt`, none

Only the package root is searched; changelogs tucked into `docs/`
subdirectories are out of scope for 0.1.0. Packages that ship no changelog
are reported honestly, with the `homepage`/`repository` from their installed
`package.json` as a fallback pointer.

## Release headings the changelog parser recognizes

A heading starts a release section when it contains a version-shaped token:

| Shape | Example |
|---|---|
| Keep a Changelog | `## [1.2.3] - 2026-05-01` |
| conventional-changelog | `# [2.0.0](https://…/compare/v1.9.0...v2.0.0) (2026-06-30)` |
| plain ATX (levels 1-3) | `### v1.2.3` |
| setext | `1.2.3 / 2026-05-01` underlined with `===` or `---` |
| prose-prefixed | `## Version 1.2` |
| unreleased | `## [Unreleased]` (captured, never included in a range) |

Rules that keep noisy files honest:

- Fenced code blocks are opaque: a `## 9.9.9` inside sample output is body text.
- ATX headings at level 4+ never split releases (`#### Migrating from 1.2.0` stays inside its section).
- List items above a `---` rule are not setext headings.
- Versions are compared semantically, so out-of-order files still digest correctly,
  and `2.1` equals `2.1.0`.

## What gets flagged

Included sections are scanned line by line (code fences skipped) for:

| Note type | Triggers |
|---|---|
| `breaking` | the word "breaking" (covers `BREAKING CHANGE`, "breaking:" bullets) |
| `security` | "security", CVE ids (`CVE-YYYY-NNNN`), GHSA ids, "vulnerab…", "advisory" |
| `deprecation` | "deprecat…" |

Notes are scanned on the *full* release bodies before any `--max-lines`
truncation, so a display cap can never hide a breaking change. Keyword
scanning has no semantic understanding — treat the flags as pointers to
read, not verdicts.

## Range semantics

- Upgrade `a -> b`: sections with version in `(a, b]`, newest first.
- Downgrade `a -> b`: sections in `(b, a]` — what the rollback removes.
- Added package at `v`: only the section for `v` itself.
- If no section matches the target version, the digest says so and names the
  newest version the file documents (`coversTo: false` in JSON).
