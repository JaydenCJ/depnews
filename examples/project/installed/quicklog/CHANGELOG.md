# Changelog

## 2.4.3 (2026-07-01)

* fix: flush buffered lines when the process exits mid-write

## 2.4.2 (2026-06-18)

### Security

* escape ANSI sequences in user-supplied fields before terminal output (CVE-2026-11223); untrusted log fields could previously rewrite the visible scrollback

## 2.4.1 (2026-06-02)

* respect `NO_COLOR` when the destination is not a TTY
* speed up the ISO timestamp formatter

## 2.4.0 (2026-05-20)

* add child loggers that inherit bound fields
