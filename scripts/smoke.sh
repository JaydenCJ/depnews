#!/usr/bin/env bash
# Smoke test for depnews: exercises the real CLI end to end against the
# bundled example project. No network, idempotent, runs from a clean
# checkout (after `npm install`). Prints "SMOKE OK" on success.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT="$(pwd)"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

fail() {
  echo "SMOKE FAIL: $1" >&2
  exit 1
}

# 1. Build (idempotent).
npm run build >/dev/null 2>&1 || fail "npm run build failed"
CLI="node $ROOT/dist/cli.js"
echo "[smoke] build ok"

# 2. --version matches package.json; --help documents every subcommand.
PKG_VERSION="$(node -p "require('$ROOT/package.json').version")"
CLI_VERSION="$($CLI --version)"
[ "$CLI_VERSION" = "$PKG_VERSION" ] || fail "--version mismatch: $CLI_VERSION != $PKG_VERSION"
HELP="$($CLI --help)"
for word in digest diff changelog --fail-on --modules; do
  echo "$HELP" | grep -q -- "$word" || fail "--help missing $word"
done
echo "[smoke] --help/--version ok ($CLI_VERSION)"

# 3. The example digest finds every change kind and both critical notes.
MODULES="--modules examples/project/installed"
DIGEST="$($CLI digest --old examples/before.lock.json --dir examples/project $MODULES)"
echo "$DIGEST" | grep -q '6 packages changed' || fail "digest should report 6 changed packages"
echo "$DIGEST" | grep -q 'csv-sift  1.9.0 -> 2.0.0  (major)  \[breaking\]' || fail "missing breaking tag on csv-sift"
echo "$DIGEST" | grep -q 'CVE-2026-11223' || fail "missing the security section from quicklog 2.4.2"
echo "$DIGEST" | grep -q 'slug-forge  added at 1.0.1' || fail "missing added package"
echo "$DIGEST" | grep -q 'tinydate  removed (was 1.0.0)' || fail "missing removed package"
echo "$DIGEST" | grep -q 'no changelog file ships with the installed package' || fail "missing changelog-gap fallback"
echo "$DIGEST" | grep -q 'homepage: https://example.test/opaque-blob' || fail "missing homepage fallback pointer"
# The section of the *old* quicklog version must stay out of the digest.
echo "$DIGEST" | grep -q 'respect `NO_COLOR`' && fail "old version's own section leaked into the digest"
echo "[smoke] digest text ok"

# 4. Markdown output carries the PR-ready table and demoted sections.
MD="$($CLI digest --old examples/before.lock.json --dir examples/project $MODULES --format markdown)"
echo "$MD" | grep -q '^## Dependency digest' || fail "markdown missing digest heading"
echo "$MD" | grep -q '| csv-sift | `1.9.0` -> `2.0.0` | major | breaking |' || fail "markdown table row missing"
echo "$MD" | grep -q '^#### 2.4.2 (2026-06-18)' || fail "markdown release heading missing"
echo "[smoke] digest markdown ok"

# 5. JSON output parses, is complete, and runs are byte-identical.
$CLI digest --old examples/before.lock.json --dir examples/project $MODULES --format json > "$WORKDIR/a.json"
node -e "
  const r = require('$WORKDIR/a.json');
  if (r.summary.total !== 6 || r.summary.breaking !== 1 || r.summary.security !== 1) process.exit(1);
  if (!r.entries.some((e) => e.name === 'quicklog' && e.changelog.releases.length === 2)) process.exit(1);
" || fail "JSON digest malformed"
$CLI digest --old examples/before.lock.json --dir examples/project $MODULES --format json > "$WORKDIR/b.json"
cmp -s "$WORKDIR/a.json" "$WORKDIR/b.json" || fail "JSON output not deterministic"
echo "[smoke] json + determinism ok"

# 6. --fail-on gates in CI style: findings exit 1, clean scopes exit 0.
set +e
GATE_ERR="$($CLI digest --old examples/before.lock.json --dir examples/project $MODULES --fail-on breaking,security 2>&1 >/dev/null)"; GATE_CODE=$?
set -e
[ "$GATE_CODE" -eq 1 ] || fail "--fail-on should exit 1, got $GATE_CODE"
echo "$GATE_ERR" | grep -q -- '--fail-on triggered: breaking (1 package), security (1 package)' || fail "gate message missing"
$CLI digest --old examples/before.lock.json --dir examples/project $MODULES --only slug-forge --fail-on breaking >/dev/null \
  || fail "clean scope should pass --fail-on"
echo "[smoke] --fail-on gate ok (exit 1)"

# 7. diff prints the version table for npm, yarn and pnpm lockfiles alike.
$CLI diff --old examples/before.lock.json --dir examples/project | grep -q 'csv-sift      1.9.0   2.0.0  upgraded  major' \
  || fail "npm diff table wrong"
$CLI diff --old examples/lockfiles/yarn-before.lock --new examples/lockfiles/yarn-after.lock | grep -q 'ansi-mist' \
  || fail "yarn diff failed"
$CLI diff --old examples/lockfiles/pnpm-before.yaml --new examples/lockfiles/pnpm-after.yaml | grep -q 'tarline' \
  || fail "pnpm diff failed"
# Cross-format diff (yarn before, pnpm after) works too.
$CLI diff --old examples/lockfiles/yarn-before.lock --new examples/lockfiles/pnpm-after.yaml | grep -q 'removed' \
  || fail "cross-format diff failed"
echo "[smoke] diff ok (npm/yarn/pnpm + cross-format)"

# 8. changelog extracts a range from one installed package.
RANGE="$($CLI changelog quicklog --dir examples/project $MODULES --from 2.4.1 --to 2.4.3)"
echo "$RANGE" | grep -q '2.4.3 (2026-07-01)' || fail "changelog range missing 2.4.3"
echo "$RANGE" | grep -q '2.4.2 (2026-06-18)' || fail "changelog range missing 2.4.2"
echo "$RANGE" | grep -q '2.4.1 (' && fail "changelog range must exclude the lower bound"
echo "[smoke] changelog subcommand ok"

# 9. stdin mode: the before lockfile can be piped in.
$CLI digest --old - --dir examples/project $MODULES < examples/before.lock.json | grep -q 'before: <stdin>' \
  || fail "stdin mode failed"
echo "[smoke] stdin ok"

# 10. Error handling: bad input exits 2, never crashes.
set +e
$CLI digest --old examples/nope.json --dir examples/project >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "missing file should exit 2"; }
$CLI digest --frobnicate >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "unknown flag should exit 2"; }
$CLI changelog ghost-package --dir examples/project >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "unknown package should exit 2"; }
$CLI mystery >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "unknown command should exit 2"; }
set -e
echo "[smoke] error handling ok (exit 2)"

echo "SMOKE OK"
