# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [3.2.0] - 2026-06-21

### Added

- `router.peek()` returns the match for a path without navigating

### Deprecated

- `createHashHistory()` — use `createRouter({ history: "hash" })` instead; removal is planned for 4.0.0

## [3.1.0] - 2026-03-15

### Added

- wildcard segments (`/files/*`) capture the rest of the path
