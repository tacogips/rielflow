# Container Runtime Environment Isolation Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-container-runtime-contract.md#rules
**Created**: 2026-04-20
**Last Updated**: 2026-04-20

---

## Design Document Reference

**Source**: design-docs/specs/design-container-runtime-contract.md

### Summary

Review found that container execution reused the runner process environment as
the container process environment. That leaked ambient host variables into
container workloads and did not match the intended explicit `envTemplate` model.

### Scope

**Included**: Split native command, runner, and container process environment
construction; add regression coverage for container env forwarding; document the
runtime contract.

**Excluded**: New schema fields for secret management, build args, or
runner-specific credential configuration.

---

## Modules

### 1. Native Executor Environment Boundaries

#### src/workflow/native-node-executor.ts

**Status**: COMPLETED

```typescript
function buildCommandEnv(input: ExecutionEnvInput): NodeJS.ProcessEnv;
function buildRunnerEnv(input: {
  readonly ambientEnv?: Readonly<Record<string, string | undefined>>;
}): NodeJS.ProcessEnv;
function buildContainerEnv(
  input: ContainerEnvInput,
): Readonly<Record<string, string>>;
```

**Checklist**:

- [x] Keep command nodes compatible with ambient host env inheritance
- [x] Keep runner CLI processes compatible with ambient host env inheritance
- [x] Limit container `-e` entries to explicit workflow env and Divedra runtime env
- [x] Unit tests

---

## Module Status

| Module                    | File Path                              | Status    | Tests                                       |
| ------------------------- | -------------------------------------- | --------- | ------------------------------------------- |
| Native executor env split | `src/workflow/native-node-executor.ts` | COMPLETED | `src/workflow/native-node-executor.test.ts` |

## Dependencies

| Feature                 | Depends On                         | Status    |
| ----------------------- | ---------------------------------- | --------- |
| Container env isolation | Existing command/container runtime | Available |

## Completion Criteria

- [x] Design documents describe explicit container env behavior
- [x] Container nodes no longer forward arbitrary host env variables
- [x] Regression tests cover explicit env forwarding and ambient env exclusion
- [x] Type checking passes
- [x] Focused tests pass

## Progress Log

### Session: 2026-04-20 07:37

**Tasks Completed**: TASK-001
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Implemented as a review follow-up to today's native process log changes.

## Related Plans

- **Previous**: `impl-plans/completed/v2-cutover-command-container-runtime.md`
- **Next**: None
- **Depends On**: `impl-plans/completed/v2-cutover-command-container-runtime.md`
