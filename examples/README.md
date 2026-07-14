# depnews examples

A miniature dependency-bump pull request, frozen in place so you can try
depnews without leaving the checkout. All packages are fictional and the
installed fixtures under `examples/project/installed/` (a node_modules-style
root, passed via `--modules` so no real `node_modules/` directory has to be
committed) contain metadata and changelogs only — no runnable code.

## The scenario

`before.lock.json` is the lockfile on the main branch; `project/` is the
working tree after the bump PR. Between the two:

| Package | Movement | What it demonstrates |
|---|---|---|
| `csv-sift` | 1.9.0 -> 2.0.0 | major bump, setext-style `HISTORY.md`, **breaking** notes |
| `quicklog` | 2.4.1 -> 2.4.3 | patch catch-up across 2 releases, a **security** fix (CVE id) |
| `@demo/router` | 3.1.0 -> 3.2.0 | scoped package, Keep-a-Changelog format, a **deprecation** |
| `opaque-blob` | 1.1.0 -> 1.2.0 | ships no changelog: the digest falls back to its homepage |
| `slug-forge` | added 1.0.1 | new dependency: only its own release entry is shown |
| `tinydate` | removed | removals are listed, nothing to digest |
| `muffin` | unchanged | never appears in the digest at all |

## Try it

From the repository root, after `npm install && npm run build`:

```bash
# The installed fixtures live in a node_modules-style root under --modules:
MODULES="--modules examples/project/installed"

# The full digest (text), a PR-ready markdown version, and machine JSON:
node dist/cli.js digest --old examples/before.lock.json --dir examples/project $MODULES
node dist/cli.js digest --old examples/before.lock.json --dir examples/project $MODULES --format markdown
node dist/cli.js digest --old examples/before.lock.json --dir examples/project $MODULES --format json

# Gate a CI job on what the digest found:
node dist/cli.js digest --old examples/before.lock.json --dir examples/project $MODULES --fail-on breaking,security

# Just the version table (reads only the lockfiles, no --modules needed):
node dist/cli.js diff --old examples/before.lock.json --dir examples/project

# One package's extracted release range:
node dist/cli.js changelog quicklog --dir examples/project $MODULES --from 2.4.1 --to 2.4.3
```

## Other lockfile dialects

`lockfiles/` holds small yarn v1 and pnpm v9 pairs for the same kind of
bump. Formats can even be mixed, which helps mid-migration:

```bash
node dist/cli.js diff --old examples/lockfiles/yarn-before.lock --new examples/lockfiles/pnpm-after.yaml
```
