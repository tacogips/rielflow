# Expected Results

Running `codex-source-security-check-loop` should:

- Run five deterministic vulnerability-check methods before any agent triage:
  secrets, gitleaks, static source/SAST, dependency audit, and supply-chain/config.
- Report deterministic scanner availability and executed commands.
- Route to `codex-design-and-implement-review-loop` when verified high or medium findings remain.
- Rerun every deterministic method after delegated fixes.
- Finish only when high and medium findings are resolved, false-positive with evidence, or blocked with explicit coverage gaps.
