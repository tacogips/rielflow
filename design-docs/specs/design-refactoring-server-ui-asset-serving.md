# Server UI Asset Serving Refactoring

This document defines the next refactoring slice for built frontend asset serving inside `divedra serve`.

## Overview

The current product architecture still matches the intended local-server plus replaceable-frontend design, but `src/server/api.ts` still owns built UI asset responsibilities that are separate from API routing:

- built asset path normalization for `/`, `/ui`, and direct asset requests
- path traversal rejection for `ui/dist/` reads
- content-type selection for built frontend files
- the explicit missing-UI setup response when `ui/dist/` is absent

The architecture already treats the browser bundle as a distinct frontend boundary. Keeping those asset-serving rules embedded in the main API module leaves `src/server/api.ts` with mixed responsibilities and makes future route refactors noisier than necessary.

## Intended Boundary

Introduce a server-owned helper module under `src/server/` that centralizes built UI asset serving.

Responsibilities of the new module:

- resolve the default `ui/dist/` path relative to the repository package root
- normalize request paths for built frontend asset reads
- reject traversal and out-of-root asset access
- serve built files with appropriate content types, including common Vite-emitted JavaScript, source map, image, and font assets so the server contract remains stable across frontend framework migrations
- own the explicit unavailable/setup response when frontend assets are missing

Responsibilities that remain in `src/server/api.ts`:

- HTTP route matching
- API mode checks
- workflow/session orchestration
- API request parsing and response shaping
- deciding when a request should be delegated to the built-UI asset helper

## Why This Boundary

This boundary aligns the code with the documented architecture: server routing/orchestration remains separate from frontend static-asset concerns.

It also improves maintainability by:

- reducing non-API noise inside the main route module
- making asset-serving behavior easier to test and evolve independently
- keeping the built-frontend contract explicit in one server-owned location

## Expected Module Shape

Target module:

- `src/server/ui-assets.ts`

Expected capabilities:

- resolve the default built-UI root
- serve a built asset when the request path maps to an allowed file
- return a canonical missing-UI response for root/UI entry requests

## Non-Goals

- changing any API routes or payload semantics
- adding a second browser implementation
- changing frontend build output structure
- redesigning the entire server route module in this slice

## References

- `design-docs/specs/architecture.md`
- `design-docs/specs/design-workflow-web-editor.md`
- `src/server/api.ts`
