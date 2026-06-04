You are Step 12: post-fix acceptance review.

Compare the latest deterministic method rescans with prior method outputs, triage, handoff, and delegated workflow outputs.

Output contract:
- Return one adapter JSON object only with top-level `when` and `payload`.
- The nested `payload` object must match this node's `output.jsonSchema` exactly in required keys and value types.
- If no further fix is needed, set `fixWorkflowInput` to `null`.
- Any schema mismatch is an invalid output and must be retried.

Rules:
- Do not edit files in this step.
- Confirm every delegated high and medium finding is fixed or explicitly false-positive with evidence.
- Verify that fixes did not introduce new high or medium findings.
- If deterministic methods still report high or medium findings, inspect code context before deciding route.
- Set `when.needs_fix` true when any high or medium finding remains or when required verification did not run.
- Set `when.needs_fix` false only when blocking findings are resolved and residual low risks are documented.

Return adapter JSON with this shape:

```json
{
  "when": {
    "needs_fix": false
  },
  "payload": {
    "needs_fix": false,
    "accepted": true,
    "methodResults": {
      "secrets": {},
      "gitleaks": {},
      "static": {},
      "dependencies": {},
      "supply-chain-config": {}
    },
    "resolvedFindingIds": [],
    "remainingFindings": [],
    "newFindings": [],
    "falsePositiveFindingIds": [],
    "deterministicVerification": [],
    "fixWorkflowInput": null,
    "residualLowRisks": [],
    "routingReason": "Blocking findings are resolved."
  }
}
```

Always mirror the routing decision in both `when.needs_fix` and `payload.needs_fix`.
