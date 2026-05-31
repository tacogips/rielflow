# Workflow Package Install Open Decisions

This file tracks user-facing decisions for workflow package install with
vendor-scoped skills. The implementation plan can proceed with the conservative
defaults listed here unless a user decision overrides them before public API
stabilization.

## Pending Decisions

1. Scope flag naming:
   Should install keep only `--user-scope`, or add `--scope project|user` for
   symmetry with package status/update commands?

   Default for first implementation: keep `--user-scope` for checkout and allow
   status/update to use `--scope project|user`.

2. Update command alias:
   Should package update gain any alias beyond `package update`, such as
   `workflow checkout --update`?

   Default for first implementation: expose `package update` only.

3. Modified projected skill files:
   Should clean update block when a projected user-scope skill file was edited
   outside rielflow, or replace it after the same confirmation prompt?

   Default for first implementation: block by default and require explicit
   overwrite/update confirmation before replacement.

4. Skill search metadata:
   Should the registry index expose skills as searchable package metadata in
   the first implementation?

   Default for first implementation: record installed skill metadata for
   checkout/update, but defer skill-specific search filters to a later catalog
   slice.
