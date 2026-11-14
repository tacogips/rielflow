# Product Rename to Rielflow Open Decisions

This file tracks user decisions needed for the repository-wide rename from
`rielflow` to `rielflow`.

## Questions

- Should the historical `rielflow` CLI binary remain as a backwards-compatible
  alias for `rielflow`, and if so should text output include a deprecation
  warning?
- Should published package names and Homebrew tap formula names change in the
  same release as the code rename, or should compatibility wrappers be shipped
  for one release first?
- Should historical design documents, completed implementation plans, and old
  runtime artifact examples be fully rewritten, or should they retain
  historical `rielflow` references with explicit notes?
- Should existing local runtime roots, user-scope workflow directories,
  self-improve logs, and event receipt stores be migrated automatically,
  discovered as legacy read-only roots, or left for manual migration?
