# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-07-12

### Added

- `depnews digest`: joins a lockfile diff with the changelogs already
  installed under node_modules and prints, per changed package, exactly the
  release sections in the `(old, new]` range — plus honest fallbacks
  (homepage/repository) for packages that ship no changelog.
- Lockfile parsers for npm `package-lock.json` (lockfileVersion 1/2/3),
  `yarn.lock` (classic v1 and Berry) and `pnpm-lock.yaml` (v5/v6-8/v9 key
  grammars), all line-based and dependency-free; the two sides of a diff
  may use different formats.
- A delta engine that collapses nested duplicate installs into version
  sets and classifies each package as upgraded, downgraded, re-resolved,
  added or removed, with semver bump classification (major/minor/patch/
  prerelease) from a built-in comparator.
- A changelog parser covering Keep-a-Changelog, conventional-changelog
  (version-in-link), plain ATX and setext heading styles, with fence
  awareness, Unreleased handling and semantic (not file-order) range
  selection; downgrades digest the sections being rolled back.
- Note scanning that flags breaking changes, security fixes (CVE/GHSA ids)
  and deprecations with real file line numbers, always on pre-truncation
  bodies so display caps never hide a breaking change.
- Changelog discovery for flat npm/yarn layouts and pnpm's `.pnpm` store,
  ranking CHANGELOG/HISTORY/CHANGES/NEWS candidates by name and extension.
- Three renderers — terminal text, PR-ready Markdown (summary table +
  demoted sections) and stable-keyed JSON — all byte-deterministic.
- CI gating via `--fail-on breaking,security,deprecation,major,downgrade`
  (exit 1) with stable exit codes (0 ok / 1 gate / 2 usage-IO) shared by
  all subcommands; `--old -` reads the before lockfile from stdin.
- `depnews diff` (aligned version table, JSON mode) and
  `depnews changelog <pkg>` (extract one installed package's release range).
- A worked example project under `examples/` covering every change kind,
  plus yarn/pnpm lockfile pairs.
- Test suite: 90 node:test tests (semver, all three lockfile grammars,
  delta, changelog dialects, discovery, digest, renderers, CLI integration
  in fresh temp dirs) and an end-to-end `scripts/smoke.sh`.

[0.1.0]: https://github.com/JaydenCJ/depnews/releases/tag/v0.1.0
