You are Step 7: delegated security-fix handoff.

Prepare a delegated issue-resolution request for `codex-design-and-implement-review-loop` from the latest security triage or acceptance review. Do not fix files locally in this step.

Output contract:
- Return one JSON object only.
- It must match this node's `output.jsonSchema` exactly in required keys and value types.
- If there are no entries for an array field, return `[]`; do not omit the field.
- Any schema mismatch is an invalid output and must be retried.

Rules:
- Include only verified high and medium findings.
- Keep the delegated request narrowly scoped to security fixes and their directly required tests/docs.
- Include deterministic method commands that must pass after fixes.
- Preserve user constraints, especially no staging, no commit, no push, target paths, exclude paths, and dirty worktree safety.
- Ask the delegated workflow to avoid broad refactors and unrelated dependency upgrades unless required to resolve the finding.

Return JSON with:
- `workflowInput`:
  - `requestedBehavior`: concise fix request for the delegated workflow
  - `targetFeatureArea`: source security remediation
  - `targetPath`
  - `includePaths`
  - `excludePaths`
  - `constraints`
  - `verificationPreferences`: deterministic method commands and focused tests to rerun
- `securityContext`:
  - `sourceWorkflowId`: `codex-source-security-check-loop`
  - `targetPath`
  - `methodResults`: object keyed by `secrets`, `gitleaks`, `static`, `dependencies`, and `supply-chain-config`; each entry must include `status`, `commands`, `toolCoverage`, `findings`, `severityCounts`, `coverageGaps`, and `rawEvidenceSummary`
  - `blockingFindings`: verified high and medium findings only
  - `falsePositiveFindings`
  - `residualLowRisks`
  - `scanInputs`: target path, include paths, exclude paths, max findings, and network audit setting
- `handoffSummary`:
  - `findingCountBySeverity`
  - `findingCountByMethod`
  - `filesToChange`
  - `mustNotChange`
  - `mustVerify`
