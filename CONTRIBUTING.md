# Contributing to depnews

Issues, discussions and pull requests are all welcome — this project aims
to stay small, zero-dependency at runtime, and strictly offline.

## Getting started

Requirements: Node.js >= 22.13 (for the stable `node:test` runner used by the suite).

```bash
git clone https://github.com/JaydenCJ/depnews.git
cd depnews
npm install            # installs typescript, the only devDependency
npm run build          # compile TypeScript to dist/
npm test               # build + 90 node:test tests
bash scripts/smoke.sh  # end-to-end CLI check against examples/
```

`scripts/smoke.sh` exercises the real CLI (the full digest in all three
formats, the --fail-on gate, npm/yarn/pnpm and cross-format diffs, the
changelog subcommand, stdin mode and every exit code) and must print
`SMOKE OK`.

## Before you open a pull request

1. `npx tsc -p tsconfig.json --noEmit` — the tree must type-check clean (strict mode is enforced).
2. `npm test` — all tests must pass.
3. `bash scripts/smoke.sh` — must print `SMOKE OK`.
4. Add tests for behavior changes; keep logic in pure, unit-testable
   modules (parsers take strings, the delta engine takes snapshots — only
   `discover.ts` and the CLI touch the filesystem).
5. A new lockfile dialect or changelog heading shape needs a fixture-based
   test per grammar variant it claims to support.

## Ground rules

- **No runtime dependencies.** The zero-dependency install is a core
  feature; adding one needs justification in the PR and will usually be
  declined.
- **No network calls, ever.** depnews reads lockfiles and installed
  packages from local disk and writes stdout. A registry or API client
  belongs in a different tool.
- Keep output deterministic: same lockfiles and installed tree must produce
  byte-identical reports — no timestamps, no randomness (the suite asserts
  this).
- Exit codes are stable API: 0 success, 1 `--fail-on` triggered, 2
  usage/config/IO error.
- Code comments and doc comments are written in English.

## Reporting bugs

Please include: `depnews --version` output, the exact command line, which
lockfile format(s) were involved, and the smallest lockfile pair — or
changelog fragment — that reproduces the problem. Misparsed changelog
headings are the most valuable reports; paste the heading line verbatim.

## Security

Do not open public issues for security problems; use GitHub private
vulnerability reporting on this repository instead.
