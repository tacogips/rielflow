# Product-Code Duplicate-Scavenge Blockers

This document tracks user or owner confirmation needed before implementing
blocked tasks in `impl-plans/active/refactoring-duplicate-scavenge-product-code.md`.
During delegated completion reruns, these questions remain unresolved unless an
owner answer is supplied in the workflow input. A completion request by itself
does not approve either public-surface change.

## REF-003: Docker-Compatible Runner Predicate Export

Question:

- Is exporting a Docker-compatible runner predicate from
  `packages/divedra-addons/src/index.ts` an acceptable public package surface?

Options:

- Approve a top-level public export from `packages/divedra-addons/src/index.ts`
  so root runtime readiness can reuse the add-ons-owned runner predicate.
- Prefer a narrower internal or package-subpath export, then update the
  implementation plan before unblocking `REF-003`.
- Keep the duplicate predicate as an accepted residual risk and leave `REF-003`
  blocked.

Implementation must preserve readiness reporting versus runtime policy error
semantics for `podman`, `docker`, and `nerdctl`.

## REF-015: Backend Constants Normalization

Question:

- Should backend constants and normalization become core-owned public workflow
  model surface now, and what null-versus-undefined semantics must wrappers
  preserve?

Options:

- Approve core-owned backend constants and normalization in
  `packages/divedra-core/src/workflow-model.ts`, with wrappers preserving
  caller-specific null-versus-undefined behavior.
- Defer centralization until validation, adapter dispatch, runtime-readiness,
  and workflow-model owners agree on public issue shapes and normalization
  behavior.
- Keep existing separate constants as an accepted residual risk and leave
  `REF-015` blocked.

Implementation must preserve validation issue shapes, adapter dispatch behavior,
runtime readiness behavior, and public workflow model compatibility.
