You are the workflow output step.

Summarize the accepted source security check result.

Output contract:
- Return one JSON object only.
- It must match this node's `output.jsonSchema` exactly in required keys and value types.
- If status is `needs_fix`, populate `fixWorkflowInput` so another workflow can remediate the findings.
- If status is `accepted` or `blocked`, set `fixWorkflowInput` to `null` unless a caller explicitly needs the remediation payload.
- Any schema mismatch is an invalid output and must be retried.

Return JSON with:
- `status`: `"accepted"`, `"needs_fix"`, or `"blocked"`
- `targetPath`
- `scanInputs`:
  - `includePaths`
  - `excludePaths`
  - `maxFindings`
  - `runNetworkAudits`
- `methodResults`: object keyed by:
  - `secrets`
  - `gitleaks`
  - `static`
  - `dependencies`
  - `supply-chain-config`

Each `methodResults` entry must include:
- `status`
- `commands`: exact command names, argv summaries, exit status, and redacted output preview
- `toolCoverage`: available/missing tools relevant to the method
- `findings`: all method findings retained by the method output, including `id`, `severity`, `category`, `path`, `line`, `message`, and redacted `evidence`
- `severityCounts`
- `coverageGaps`
- `rawEvidenceSummary`

Also return:
- `finalFindings`: all high, medium, and low findings after agent triage
- `blockingFindings`: high and medium findings that should be handed to a fixer workflow
- `fixWorkflowInput`: populated when `status` is `"needs_fix"`; suitable for passing to `codex-design-and-implement-review-loop`
- `resolvedFindings`
- `falsePositiveFindings`
- `delegatedWorkflowRuns`
- `changedFiles`
- `verification`
- `residualLowRisks`
- `coverageGaps`
- `operatorNotes`
