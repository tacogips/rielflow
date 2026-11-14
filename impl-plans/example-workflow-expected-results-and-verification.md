# Example Workflow Expected Results And Verification Implementation Plan

**Status**: Completed
**Design Reference**: `examples/README.md`, `design-docs/specs/architecture.md`, `design-docs/specs/design-workflow-json.md`
**Created**: 2026-03-30
**Last Updated**: 2026-03-30

## Scope

Define test-case style expected-result documentation inside each example bundle
under `examples/`, ensure every bundled example can be executed deterministically
in the current repository, and verify the runtime outputs against those
documented expectations.

Out of scope:

- changing the authored meaning of any example workflow beyond what is needed to
  make deterministic verification possible
- adding non-deterministic live-backend assertions

## Modules

### 1. Per-example expected-result documents

#### `examples/*/EXPECTED_RESULTS.md`

**Status**: COMPLETED

**Checklist**:

- [x] Add a test-case style expectation document to every example directory
- [x] Record the execution command used for verification
- [x] Record the stable expected output fields for each example
- [x] Record any example-specific execution notes or limitations

### 2. Deterministic execution coverage

#### `examples/*/mock-scenario.json`

#### `examples/README.md`

#### `README.md`

**Status**: COMPLETED

**Checklist**:

- [x] Ensure every example bundle has a deterministic execution path
- [x] Add or correct bundled mock scenarios where needed
- [x] Update example-facing docs to reflect actual runnable status

### 3. Verification and regression coverage

#### `src/**/*.test.ts`

#### `scripts/*`

**Status**: COMPLETED

**Checklist**:

- [x] Add or update automated verification where it materially reduces drift
- [x] Run validation and execution checks for every example
- [x] Fix any runtime or fixture bugs exposed by the verification pass

## Completion Criteria

- [x] Every example directory contains expected-result documentation
- [x] Every example bundle validates successfully
- [x] Every example bundle executes deterministically in the current repository
- [x] Actual stable outputs match the documented expectations
- [x] Tests and type checks pass after any TypeScript modifications

## Progress Log

### Session: 2026-03-30 10:41 JST

**Tasks Completed**: Created implementation plan
**Tasks In Progress**: Repository inspection and deterministic execution audit
**Blockers**: None
**Notes**: Initial inspection shows seven example bundles. Five already include
`mock-scenario.json`; two bundles currently appear to lack deterministic run
fixtures and may need additional coverage or runtime fixes.

### Session: 2026-03-30 10:58 JST

**Tasks Completed**: Added per-example expected-result docs, added missing mock
scenarios, corrected the debate example graph, fixed scenario-mock sequencing
for repeated output-contract nodes, and re-verified all bundled examples
**Tasks In Progress**: None
**Blockers**: None
**Notes**: All seven example bundles now validate and run with deterministic
mock scenarios. The debate example previously failed to alternate correctly
because it routed speaker outputs directly to the opposing manager instead of
returning through the root manager. The scenario adapter also required a fix so
repeated executions of output-contract nodes advance through scenario arrays
correctly instead of reusing the first element.
