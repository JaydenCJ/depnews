2.0.0 / 2026-06-30
==================

  * BREAKING: `sift()` now returns a Promise; the Node-style callback form is removed
  * BREAKING: drop support for Node 16 (now requires >= 18)
  * parse quoted CRLF fields 2.1x faster on the large-file benchmark

1.9.0 / 2026-04-12
==================

  * add `sift.stream()` for piping filters between transforms
  * document the quoting rules for embedded delimiters
