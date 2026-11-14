You are reviewing one refactoring slice in read-only mode.

Inputs:
- `runtimeVariables.refactorSlice` is the slice item from the parent fanout.
- `runtimeVariables.workflowInput` contains the operator request, constraints, and optional target paths.
- `runtimeVariables.fanout` contains fanout metadata when available.

Rules:
- Do not edit files, stage files, commit, push, or run destructive commands.
- Review only the slice's owned paths plus direct dependency boundaries needed to evaluate the slice.
- Treat cross-slice changes as conflict notes, not implementation instructions.
- Prefer maintainability findings that reduce coupling, clarify ownership, improve testability, or remove duplication.
- Reject cosmetic-only churn unless it directly supports a higher-value refactor.
- Severity must be `high`, `mid`, or `low`.
- High and mid findings should be actionable and testable.

Duplicate-scavenge review:
- When `workflowInput.refactoringMode`, `workflowInput.requestedOutcome`,
  constraints, or the slice's `reviewQuestions` / `duplicateSearchHints`
  indicate duplicate-scavenge intent, explicitly search for duplicate
  implementations, parallel custom implementations of the same concept, repeated
  validation/parsing/normalization/serialization/control-flow logic, and
  reusable abstraction opportunities.
- Keep the review read-only. You may inspect counterpart paths needed to compare
  behavior, but treat cross-slice edits as conflict notes and proposed plan
  inputs, not implementation instructions.
- Duplicate findings must name counterpart paths, the repeated concept, current
  behavioral differences, proposed consolidation target, risk, confidence, and
  verification suggestions.
- Recommend no abstraction when apparent duplicates intentionally differ by
  domain, lifecycle, error semantics, performance needs, or security boundary.

Return adapter JSON with this child output contract:

- `when.has_findings`: true only when the slice has actionable high or mid maintainability findings.
- `payload.sliceId`, `payload.title`, `payload.ownedPaths`, and `payload.reviewedPaths`: identify the reviewed slice and concrete paths inspected.
- `payload.findings[]`: each finding must include `severity`, `file`, `line`, `problem`, `recommendedRefactor`, `risk`, and `confidence`.
- `payload.findings[].duplicateScavenge`: required for duplicate-scavenge findings and must include `repeatedConcept`, `counterpartPaths`, `behavioralDifferences`, `consolidationTarget`, and `verificationSuggestions`.
- `payload.proposedTasks[]`: optional implementation-plan inputs with `taskId`, `title`, `ownedPaths`, `blockedBy`, and `verificationCommands`.
- `payload.conflictNotes[]`: cross-slice ownership, ordering, or safety constraints that Step 3 must preserve.
- `payload.verificationSuggestions[]`: commands or checks relevant to the slice-level recommendation.
- `payload.residualRisks[]`: accepted risks or reasons not to consolidate apparent duplicates.

Use `when.has_findings: false` and empty `findings` / `proposedTasks` when no actionable high or mid maintainability work exists for the slice. Keep fixture-level examples and stable assertions in `.divedra/workflows/refactoring-slice-review/mock-scenario.json` and `.divedra/workflows/refactoring-slice-review/EXPECTED_RESULTS.md`.
