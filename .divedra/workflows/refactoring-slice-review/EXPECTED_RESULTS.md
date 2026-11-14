# Expected Results

Stable assertions for deterministic verification with the bundled duplicate-scavenge
mock scenario.
Ignore `sessionId`, timestamps, and artifact paths.

## Validate

Command:

```bash
bun run packages/divedra/src/bin.ts workflow validate refactoring-slice-review --workflow-definition-dir .divedra/workflows
```

Expected result: the workflow is valid.

## Run

Command:

```bash
bun run packages/divedra/src/bin.ts workflow run refactoring-slice-review \
  --workflow-definition-dir .divedra/workflows \
  --mock-scenario .divedra/workflows/refactoring-slice-review/mock-scenario.json \
  --output json
```

Expected stable run summary:

```json
{
  "status": "completed",
  "workflowName": "refactoring-slice-review",
  "workflowId": "refactoring-slice-review",
  "nodeExecutions": 1,
  "transitions": 0,
  "exitCode": 0
}
```

Expected final output node: `slice-review`

Expected final output payload highlights:

```json
{
  "sliceId": "package-source-boundary",
  "title": "Package source boundary",
  "findings": [
    {
      "severity": "mid",
      "file": "packages/divedra/src/index.ts",
      "risk": "Package contracts can drift from the implementation they are intended to own.",
      "confidence": "high",
      "duplicateScavenge": {
        "repeatedConcept": "package/root export normalization",
        "counterpartPaths": [
          "packages/divedra/src/lib.ts",
          "packages/divedra-core/src/index.ts",
          "packages/divedra-addons/src/index.ts"
        ],
        "behavioralDifferences": [
          "Root src remains the compatibility API while package entrypoints become ownership roots."
        ],
        "consolidationTarget": "Package-owned entrypoint contract with root src compatibility shims.",
        "verificationSuggestions": [
          "bun test packages/divedra/src/package-boundaries.test.ts",
          "bun run build"
        ]
      }
    }
  ],
  "proposedTasks": [
    {
      "taskId": "REF-001",
      "title": "Establish package source boundary contracts"
    }
  ],
  "conflictNotes": [
    "Duplicate-scavenge counterpart paths are review context only; this child review does not assign cross-slice write ownership.",
    "Root src remains a temporary compatibility surface until package-owned entrypoints pass verification.",
    "No provisioning package should be created because no concrete provisioning source surface was identified."
  ],
  "verificationSuggestions": [
    "bun run packages/divedra/src/bin.ts workflow validate refactoring-slice-review --workflow-definition-dir .divedra/workflows",
    "bun run build"
  ],
  "residualRisks": [
    "No provisioning package is created without a concrete provisioning source surface."
  ]
}
```
