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

Return adapter JSON:

```json
{
  "when": {
    "has_findings": true
  },
  "payload": {
    "sliceId": "workflow-runtime",
    "title": "Workflow runtime",
    "ownedPaths": ["src/workflow"],
    "reviewedPaths": ["src/workflow/engine.ts"],
    "findings": [
      {
        "severity": "mid",
        "file": "src/workflow/example.ts",
        "line": 1,
        "problem": "Implementation and validation ownership are mixed.",
        "recommendedRefactor": "Extract validation-only helpers behind a narrow interface.",
        "risk": "Behavior drift if runtime callers depend on implicit mutation.",
        "confidence": "medium",
        "duplicateScavenge": {
          "repeatedConcept": "workflow input validation",
          "counterpartPaths": ["src/cli/example.ts", "src/graphql/example.ts"],
          "behavioralDifferences": ["CLI reports usage errors; GraphQL returns typed errors."],
          "consolidationTarget": "Existing validation helper or a new narrow helper owned by src/workflow.",
          "verificationSuggestions": ["bun test src/workflow/example.test.ts"]
        }
      }
    ],
    "proposedTasks": [
      {
        "taskId": "REF-001",
        "title": "Extract validation helpers",
        "ownedPaths": ["src/workflow/example.ts"],
        "blockedBy": [],
        "verificationCommands": ["bun test src/workflow/example.test.ts"]
      }
    ],
    "conflictNotes": [],
    "verificationSuggestions": [],
    "residualRisks": []
  }
}
```

Use `when.has_findings: false` and empty `findings` / `proposedTasks` when no actionable high or mid maintainability work exists for the slice.
