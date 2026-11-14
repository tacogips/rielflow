# Homebrew Deployment Support

This file tracks user decisions that affect the final Homebrew release shape.
The first implementation can proceed with local placeholders and dry-run
verification, but publish-mode formula generation must not use unresolved
placeholder values.

## Questions

1. Which Homebrew tap should own the formula?
   - Decision: use the existing `tacogips/homebrew-tap` repository, with
     `rielflow` stored as `Formula/rielflow.rb` alongside the existing `chilla`
     cask.

2. Which release URL pattern should the formula use?
   - Option A: GitHub Releases under `tacogips/rielflow`.
   - Option B: another artifact host supplied during release.

3. Which target matrix is required for the first Homebrew release?
   - Minimum: `darwin-arm64` and `darwin-x64`.
   - Optional: Linuxbrew targets when a reliable build host is available.

4. Should `rielflow --version` be added as a required release smoke-test surface?
   - Preferred: add it so archive and Homebrew tests can verify both help and
     version output.
   - Acceptable first slice: use `rielflow --help` only if runtime code changes
     are intentionally deferred.

## Current Assumption

Implementation should use standalone Bun-compiled archives and a local
repository formula template, verify the archive locally, and avoid publishing or
pushing until explicitly requested.
