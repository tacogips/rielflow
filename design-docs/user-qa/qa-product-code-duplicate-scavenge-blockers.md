# Product-Code Duplicate-Scavenge Blockers

This document records the owner decisions that resolved the public-surface
blockers for tasks in
`impl-plans/active/refactoring-duplicate-scavenge-product-code.md`. Earlier
delegated completion reruns treated these questions as unresolved unless an
owner answer was supplied in workflow input; the current owner decisions now
unblock `REF-003` and `REF-015`.

## REF-003: Docker-Compatible Runner Predicate Export

Resolved question:

- Is exporting a Docker-compatible runner predicate from
  `packages/divedra-addons/src/index.ts` an acceptable public package surface?

Owner decision:

- Approved to add or expose the narrowest appropriate package-owned
  Docker-compatible runner predicate surface needed to complete the task,
  including a top-level add-ons export if that is the existing package
  convention.

Implementation must preserve readiness reporting versus runtime policy error
semantics for `podman`, `docker`, and `nerdctl`.

## REF-015: Backend Constants Normalization

Resolved question:

- Should backend constants and normalization become core-owned public workflow
  model surface now, and what null-versus-undefined semantics must wrappers
  preserve?

Owner decision:

- Approved to establish core-owned backend constants and normalization while
  preserving existing null-versus-undefined caller semantics through wrappers or
  compatibility helpers.

Implementation must preserve validation issue shapes, adapter dispatch behavior,
runtime readiness behavior, and public workflow model compatibility.
