# Nix-Managed Pre-Commit Hook Integration Plan

**Status**: Completed
**Created**: 2026-05-07
**Last Updated**: 2026-05-07
**Design Reference**: `README.md`, `AGENTS.md`

## Goal

Replace the repository-local shell-managed Git hook bootstrap with a
Nix-declared pre-commit setup so hook installation, tool provisioning, and
developer guidance all flow through the flake instead of custom scripts.

## Scope

Included:

- `flake.nix` integration with `cachix/git-hooks.nix`
- removal of the checked-in `.githooks` bootstrap script and installer helper
- `Taskfile.yml`, `README.md`, and ignore-rule updates that describe the Nix
  workflow accurately
- lockfile refresh required for the new flake input

Excluded:

- changing the staged `gitleaks` command required by the repository commit
  policy
- changing the GitHub Actions secret-scanning backstop
- expanding the hook set beyond the current `gitleaks` enforcement

## Deliverables

- `flake.nix`: declare the pre-commit hook via `git-hooks.nix`, expose it to
  the dev shell, and stop configuring `core.hooksPath` manually.
- `flake.lock`: record the new `git-hooks.nix` input.
- `Taskfile.yml`: replace the custom shell installer task with a Nix-driven
  install command.
- `README.md`, `.gitignore`: document the generated `.pre-commit-config.yaml`
  and the Nix-managed install flow.
- `.githooks/pre-commit`, `scripts/install-git-hooks.sh`: remove the obsolete
  shell-based hook files.

## Completion Criteria

- [x] Entering `nix develop` installs or refreshes the generated pre-commit
  hook without the custom `.githooks` path.
- [x] The `gitleaks` pre-commit hook remains enforced for local commits.
- [x] Checked-in docs no longer point users at the removed shell installer.
- [x] Targeted Nix validation succeeds for the updated hook flow.

## Progress Log

### Session: 2026-05-07 23:10 JST

**Tasks completed**: Replaced the custom hook bootstrap with a
`git-hooks.nix`-managed pre-commit setup, refreshed the lockfile, updated
repository docs/tasks, and removed the obsolete shell hook files.

**Tasks in progress**: None

**Verification**:

- `nix develop -c pre-commit run gitleaks --all-files`
- `nix flake check`
