# Expected Results

Stable assertions for deterministic verification with the bundled mock scenarios.
Ignore `sessionId`, timestamps, and artifact paths.

## Validate

Command:

```bash
nix run ./divedra -- workflow validate design-and-implement-review-loop
```

Expected result: the workflow is valid.

## Run

Issue-resolution command:

```bash
nix run ./divedra -- workflow run design-and-implement-review-loop \
  --mock-scenario .divedra/workflows/design-and-implement-review-loop/mock-scenario.json \
  --output json
```

Expected stable run summary:

```json
{
  "status": "completed",
  "workflowName": "design-and-implement-review-loop",
  "workflowId": "design-and-implement-review-loop",
  "nodeExecutions": 24,
  "transitions": 23,
  "exitCode": 0
}
```

Expected final output node: `workflow-output`

Expected final output payload:

```json
{
  "status": "accepted",
  "workflowMode": "issue-resolution",
  "issueReference": "tacogips/cursor-agent#123",
  "issueTitle": "Persist workflow review findings across reruns",
  "designDocPaths": [
    "design-docs/specs/design-workflow-review-findings.md",
    "design-docs/user-qa/qa-review-finding-retention.md"
  ],
  "implPlanPaths": ["impl-plans/active/workflow-review-findings.md"],
  "changedFiles": [
    "packages/divedra/src/workflow/review-findings.ts",
    "packages/divedra/src/workflow/review-findings.test.ts",
    "impl-plans/active/workflow-review-findings.md",
    "README.md",
    ".agents/skills/divedra-impl-workflow/SKILL.md"
  ],
  "designReviewSummary": "Design accepted after the unresolved retention decision was moved into user QA.",
  "implPlanReviewSummary": "Implementation plan accepted after explicit persistence migration and regression verification tasks were added.",
  "implementationSummary": "Step 6 implemented the approved plan, addressed Step 7 feedback, and updated implementation-plan progress.",
  "implementationReviewSummary": "Implementation accepted with no remaining high or mid findings.",
  "documentationFiles": [
    "README.md",
    ".agents/skills/divedra-impl-workflow/SKILL.md"
  ],
  "documentationSummary": "Step 8 refreshed the README and the user-facing workflow skill so they match the accepted implementation behavior before commit generation.",
  "commitMessage": "feat: persist workflow review findings across reruns",
  "commitHash": "abc123def4567890abc123def4567890abc123de",
  "pushedRemote": "origin",
  "pushedBranch": "main",
  "verification": ["task test", "task typecheck"],
  "residualRisks": []
}
```

Planning-only command:

```bash
nix run ./divedra -- workflow run design-and-implement-review-loop \
  --mock-scenario .divedra/workflows/design-and-implement-review-loop/mock-scenario-planning-only.json \
  --output json
```

Expected planning-only run summary:

```json
{
  "status": "completed",
  "workflowName": "design-and-implement-review-loop",
  "workflowId": "design-and-implement-review-loop",
  "nodeExecutions": 17,
  "transitions": 16,
  "exitCode": 0
}
```

Expected planning-only final output payload:

```json
{
  "status": "accepted",
  "workflowMode": "design-plan-only",
  "designDocPaths": [
    "design-docs/specs/design-codex-reference-session-history.md"
  ],
  "implPlanPaths": ["impl-plans/active/codex-reference-session-history.md"],
  "codexAgentReferences": [
    "../../codex-agent/src/session",
    "../../codex-agent/src/cli"
  ],
  "designReviewSummary": "Design accepted after Cursor adapter boundaries and codex-agent divergence were clarified.",
  "implPlanReviewSummary": "Implementation plan and design consistency review accepted after transcript edge-case tasks were added.",
  "commitMessage": "docs: add codex-reference session history design and plan",
  "commitHash": "fedcba9876543210fedcba9876543210fedcba98",
  "pushedRemote": "origin",
  "pushedBranch": "main",
  "nextStep": "Run a full issue-resolution execution for impl-plans/active/codex-reference-session-history.md when implementation is approved.",
  "residualRisks": []
}
```
