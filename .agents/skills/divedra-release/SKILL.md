---
name: divedra-release
description: Use when preparing, publishing, verifying, or troubleshooting a divedra release through GitHub release assets and the tacogips/tap Homebrew formula. Applies to building standalone Homebrew archives, rendering Formula/divedra.rb, updating the sibling homebrew-tap repository, brew smoke tests, release rollback checks, and post-release install verification.
metadata:
  short-description: Release divedra via Homebrew
---

# Divedra Release

Use this skill for divedra release operations that publish standalone archives
and update the `tacogips/tap` Homebrew formula.

## Scope

This skill covers:

- building Homebrew release archives with `scripts/build-homebrew-release.sh`
- checking source version, git tag, and release asset identity
- creating or updating the GitHub release `v<version>`
- rendering `Formula/divedra.rb` with checksums from `dist/homebrew`
- updating the `tacogips/homebrew-tap` checkout, normally at `../homebrew-tap`
- smoke-testing the released formula with `brew`

Do not use this skill for npm publishing; use `supply-chain-secure-publish`
when npm package publication is involved.

## Path Rule

Keep release instructions portable. Do not write machine-specific absolute
paths into skill docs, commits, release notes, scripts, or user-facing output.
Refer to the tap checkout as `../homebrew-tap` when it is a sibling checkout,
or as `<tap-root>` when the caller provides a different local path.

## Preflight

From the divedra repository root:

```bash
git status --short
git branch --show-current
git rev-parse HEAD
git tag --points-at HEAD
bun --print 'JSON.parse(await Bun.file("packages/divedra/package.json").text()).version'
gh auth status
brew --version
```

Check the tap checkout separately:

```bash
git -C ../homebrew-tap status --short
git -C ../homebrew-tap branch --show-current
```

Before publishing, confirm:

- the intended version matches `packages/divedra/package.json`
- the release source commit is pushed and is the commit intended for
  `v<version>`
- an existing `v<version>` tag, if present, points at the intended commit
- release notes or tag intent are clear
- the divedra and tap worktrees do not contain unrelated changes
- GitHub CLI authentication can publish to `tacogips/divedra`
- Homebrew is available for smoke tests

If a version bump is needed, make and verify that change before starting this
release flow. Keep version-bump commits separate from tap formula commits unless
the user explicitly asks for a combined change.

## Build And Test

Run the normal project checks first unless the user explicitly asks for a
partial or emergency release:

```bash
task ci
```

Build all Homebrew archives:

```bash
task build:homebrew -- darwin-arm64 darwin-x64 linux-arm64 linux-x64
```

Expected outputs:

```text
dist/homebrew/divedra-<version>-darwin-arm64.tar.gz
dist/homebrew/divedra-<version>-darwin-x64.tar.gz
dist/homebrew/divedra-<version>-linux-arm64.tar.gz
dist/homebrew/divedra-<version>-linux-x64.tar.gz
```

Each archive must also have a matching `.sha256` file. Do not render the formula
until all four checksum files exist.

Verify the expected artifact set:

```bash
ls dist/homebrew/divedra-<version>-*.tar.gz
ls dist/homebrew/divedra-<version>-*.tar.gz.sha256
```

There should be four archives and four checksum files for:

- `darwin-arm64`
- `darwin-x64`
- `linux-arm64`
- `linux-x64`

## GitHub Release Assets

Check whether the release already exists:

```bash
gh release view "v<version>" --repo tacogips/divedra
```

Create the release when it does not exist:

```bash
gh release create "v<version>" \
  dist/homebrew/divedra-<version>-darwin-arm64.tar.gz \
  dist/homebrew/divedra-<version>-darwin-x64.tar.gz \
  dist/homebrew/divedra-<version>-linux-arm64.tar.gz \
  dist/homebrew/divedra-<version>-linux-x64.tar.gz \
  --repo tacogips/divedra \
  --title "divedra v<version>" \
  --notes "<release notes>"
```

If the tag already exists, `gh release create` will attach the release to that
tag. If the tag does not exist, be explicit about whether creating the tag from
the current release commit is intended before running the command.

If the release already exists, replace the assets intentionally:

```bash
gh release upload "v<version>" \
  dist/homebrew/divedra-<version>-darwin-arm64.tar.gz \
  dist/homebrew/divedra-<version>-darwin-x64.tar.gz \
  dist/homebrew/divedra-<version>-linux-arm64.tar.gz \
  dist/homebrew/divedra-<version>-linux-x64.tar.gz \
  --repo tacogips/divedra \
  --clobber
```

After upload, inspect the release:

```bash
gh release view "v<version>" --repo tacogips/divedra
gh release view "v<version>" --repo tacogips/divedra --json tagName,targetCommitish,assets
```

## Tap Formula

Render the formula into the sibling tap checkout:

```bash
task homebrew:tap-formula -- <version>
```

Equivalent explicit form:

```bash
scripts/render-homebrew-formula.sh <version> <tap-root>/Formula/divedra.rb
```

The default release asset URL base is:

```text
https://github.com/tacogips/divedra/releases/download/v<version>
```

Override `DIVEDRA_RELEASE_BASE_URL` only when the archives are hosted somewhere
else.

Review the rendered formula before committing:

```bash
git -C ../homebrew-tap diff -- Formula/divedra.rb
brew audit --formula ../homebrew-tap/Formula/divedra.rb
brew style ../homebrew-tap/Formula/divedra.rb
```

## Smoke Test

After the GitHub release assets are available, test the formula from the tap
checkout:

```bash
brew install --formula ../homebrew-tap/Formula/divedra.rb
brew test divedra
divedra --help
brew uninstall divedra
```

If `divedra` is already installed, use `brew reinstall --formula
../homebrew-tap/Formula/divedra.rb` for the install step.

The formula should install the archive for the current platform, run
`divedra --help`, and pass the formula `test do` block. If an installed older
formula shadows the local formula, uninstall it and rerun the local formula
install.

## Commit And Push Tap

When the user asks to complete the release, commit and push the tap update from
the tap checkout. Keep the commit focused on the formula and related tap docs.

```bash
git -C ../homebrew-tap status --short
git -C ../homebrew-tap add Formula/divedra.rb
git -C ../homebrew-tap diff --staged --stat
git -C ../homebrew-tap diff --staged --check
(
  cd ../homebrew-tap
  gitleaks git --pre-commit --redact --staged --verbose
)
git -C ../homebrew-tap commit -m "chore: update divedra formula to <version>"
git -C ../homebrew-tap push origin main
```

Do not add automated-assistant attribution or co-authorship trailers to commit
messages.

Stage `README.md` only when it actually changed. Do not stage unrelated tap
files such as other formulae or casks.

## Post-Release Verification

Verify installation through the public tap path:

```bash
brew update
brew tap tacogips/tap
brew install tacogips/tap/divedra
divedra --help
brew test tacogips/tap/divedra
```

Report back with:

- released version and GitHub release URL
- archive targets uploaded
- tap commit hash and branch
- formula file changed in the tap
- smoke-test commands run and their outcomes
- any skipped checks or remaining risks

## Troubleshooting

- Missing checksum: rebuild the missing target before rendering the formula.
- Formula points at the wrong host: re-render with the intended
  `DIVEDRA_RELEASE_BASE_URL`.
- Homebrew cannot fetch an asset: verify `gh release view` lists the exact
  archive name and that the release is public.
- Formula audit complains about generated fields: inspect
  `scripts/render-homebrew-formula.sh` before editing the formula by hand.
- Tap worktree is dirty with unrelated changes: do not overwrite them; stop and
  ask how to proceed if they block the release.
