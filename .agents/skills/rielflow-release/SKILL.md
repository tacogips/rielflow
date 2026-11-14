---
name: rielflow-release
description: Use when preparing, publishing, verifying, or troubleshooting a rielflow release through GitHub release assets and the tacogips/tap Homebrew formula. Applies to building standalone Homebrew archives, rendering Formula/rielflow.rb, updating the sibling homebrew-tap repository, brew smoke tests, release rollback checks, and post-release install verification.
metadata:
  short-description: Release rielflow via Homebrew
---

# Rielflow Release

Use this skill for rielflow release operations that publish standalone archives
and update the `tacogips/tap` Homebrew formula.

## Scope

This skill covers:

- building Homebrew release archives with `scripts/build-homebrew-release.sh`
- checking source version, git tag, and release asset identity
- creating or updating the GitHub release `v<version>`
- rendering `Formula/rielflow.rb` with checksums from `dist/homebrew`
- updating the `tacogips/homebrew-tap` checkout, normally at `../homebrew-tap`
- smoke-testing the released formula with `brew`

Do not use this skill for npm publishing; use `supply-chain-secure-publish`
when npm package publication is involved.

## Homebrew Release Model

Rielflow releases are Homebrew formula releases backed by GitHub release assets.
The formula installs prebuilt standalone archives for each supported platform.
The archive contains `bin/rielflow`; the Bun runtime and built-in add-on
implementation are bundled into that binary. The formula does not build
rielflow from source during `brew install`, and it does not use Homebrew bottle
publishing.

The release order is:

1. verify the rielflow source version, release commit, and tag intent
2. run project checks
3. build the four platform archives and `.sha256` files under `dist/homebrew`
4. run the local self-checkout gate against the current-platform archive
5. create or update the GitHub release `v<version>` with those archives
6. render `Formula/rielflow.rb` into the `tacogips/homebrew-tap` checkout
7. run formula-specific Homebrew audit/style, tap-name install, and formula tests
8. commit and push the tap formula update
9. verify installation from `tacogips/tap`

Do not use `brew bump-formula-pr` for this project unless the release process
has moved to an upstream Homebrew/core formula. For the current tap-based flow,
render and commit the formula in `tacogips/homebrew-tap`.

## Path Rule

Keep release instructions portable. Do not write machine-specific absolute
paths into skill docs, commits, release notes, scripts, or user-facing output.
Refer to the tap checkout as `../homebrew-tap` when it is a sibling checkout,
or as `<tap-root>` when the caller provides a different local path.

## Preflight

From the rielflow repository root:

```bash
git status --short
git branch --show-current
git rev-parse HEAD
git tag --points-at HEAD
bun --print 'JSON.parse(await Bun.file("packages/rielflow/package.json").text()).version'
gh auth status
brew --version
brew tap-info tacogips/tap --json
```

Check the tap checkout separately:

```bash
git -C ../homebrew-tap status --short
git -C ../homebrew-tap branch --show-current
```

Before publishing, confirm:

- the intended version matches `packages/rielflow/package.json`
- the release source commit is pushed and is the commit intended for
  `v<version>`
- an existing `v<version>` tag, if present, points at the intended commit
- release notes or tag intent are clear
- the rielflow and tap worktrees do not contain unrelated changes
- GitHub CLI authentication can publish to `tacogips/rielflow`
- Homebrew is available for smoke tests

If a version bump is needed, use `rielflow-version-bump` first and verify that
change before starting this release flow. Keep version-bump commits separate
from tap formula commits unless the user explicitly asks for a combined change.

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
dist/homebrew/rielflow-<version>-darwin-arm64.tar.gz
dist/homebrew/rielflow-<version>-darwin-x64.tar.gz
dist/homebrew/rielflow-<version>-linux-arm64.tar.gz
dist/homebrew/rielflow-<version>-linux-x64.tar.gz
```

Each archive must also have a matching `.sha256` file. Do not render the formula
until all four checksum files exist.

Each archive should contain the installed binary:

```bash
tar -tzf dist/homebrew/rielflow-<version>-darwin-arm64.tar.gz | grep -E '^\./bin/rielflow$'
```

Verify the expected artifact set:

```bash
ls dist/homebrew/rielflow-<version>-*.tar.gz
ls dist/homebrew/rielflow-<version>-*.tar.gz.sha256
```

There should be four archives and four checksum files for:

- `darwin-arm64`
- `darwin-x64`
- `linux-arm64`
- `linux-x64`

## Self-Checkout Gate

Before uploading or replacing GitHub release assets, self-check the current
platform archive exactly as a user install would see it. This is mandatory for
normal releases and should be skipped only for an explicitly named emergency
release.

Resolve the current platform target, extract the archive into a temporary
directory, and run both a basic CLI smoke and an add-on-backed workflow usage
smoke:

```bash
case "$(uname -s):$(uname -m)" in
  Darwin:arm64) target="darwin-arm64" ;;
  Darwin:x86_64) target="darwin-x64" ;;
  Linux:aarch64 | Linux:arm64) target="linux-arm64" ;;
  Linux:x86_64 | Linux:amd64) target="linux-x64" ;;
  *) echo "unsupported local platform" >&2; exit 1 ;;
esac

tmp_dir="$(mktemp -d)"
smoke_root="$(mktemp -d)"
trap 'rm -rf "$tmp_dir" "$smoke_root"' EXIT

tar -C "$tmp_dir" -xzf "dist/homebrew/rielflow-<version>-$target.tar.gz"
test -x "$tmp_dir/bin/rielflow"
"$tmp_dir/bin/rielflow" --help
```

Create a temporary workflow that uses a built-in add-on and verify the extracted
binary can resolve it without any separate add-on package installation:

```bash
mkdir -p "$smoke_root/addon-smoke"
cat > "$smoke_root/addon-smoke/workflow.json" <<'JSON'
{
  "workflowId": "addon-smoke",
  "description": "Smoke workflow that requires built-in add-on package resolution.",
  "defaults": { "maxLoopIterations": 1, "nodeTimeoutMs": 60000 },
  "entryStepId": "send-reply",
  "nodes": [
    {
      "id": "send-reply",
      "addon": {
        "name": "rielflow/chat-reply-worker",
        "version": "1",
        "config": {
          "textTemplate": "ok",
          "visibility": "public",
          "threadPolicy": "same-thread",
          "onMissingTarget": "dry-run"
        }
      }
    }
  ],
  "steps": [{ "id": "send-reply", "nodeId": "send-reply", "role": "worker" }]
}
JSON

"$tmp_dir/bin/rielflow" workflow usage addon-smoke \
  --workflow-definition-dir "$smoke_root" \
  --output json | grep '"workflowId": "addon-smoke"'
```

For releases that change workflow catalog or add-on behavior, also run the
user-scope workflow usage command from the extracted binary when local user
workflows are available:

```bash
"$tmp_dir/bin/rielflow" workflow usage --scope user --output json
```

Do not upload release assets until this self-checkout gate passes.

## GitHub Release Assets

Check whether the release already exists:

```bash
gh release view "v<version>" --repo tacogips/rielflow
```

Create the release when it does not exist:

```bash
gh release create "v<version>" \
  dist/homebrew/rielflow-<version>-darwin-arm64.tar.gz \
  dist/homebrew/rielflow-<version>-darwin-x64.tar.gz \
  dist/homebrew/rielflow-<version>-linux-arm64.tar.gz \
  dist/homebrew/rielflow-<version>-linux-x64.tar.gz \
  --repo tacogips/rielflow \
  --title "rielflow v<version>" \
  --notes "<release notes>"
```

If the tag already exists, `gh release create` will attach the release to that
tag. If the tag does not exist, be explicit about whether creating the tag from
the current release commit is intended before running the command.

If the release already exists, replace the assets intentionally:

```bash
gh release upload "v<version>" \
  dist/homebrew/rielflow-<version>-darwin-arm64.tar.gz \
  dist/homebrew/rielflow-<version>-darwin-x64.tar.gz \
  dist/homebrew/rielflow-<version>-linux-arm64.tar.gz \
  dist/homebrew/rielflow-<version>-linux-x64.tar.gz \
  --repo tacogips/rielflow \
  --clobber
```

After upload, inspect the release:

```bash
gh release view "v<version>" --repo tacogips/rielflow
gh release view "v<version>" --repo tacogips/rielflow --json tagName,targetCommitish,assets
```

## Tap Formula

Render the formula into the sibling tap checkout:

```bash
task homebrew:tap-formula -- <version>
```

Equivalent explicit form:

```bash
scripts/render-homebrew-formula.sh <version> <tap-root>/Formula/rielflow.rb
```

The default release asset URL base is:

```text
https://github.com/tacogips/rielflow/releases/download/v<version>
```

Override `RIEL_RELEASE_BASE_URL` only when the archives are hosted somewhere
else.

Review the rendered formula before committing:

```bash
git -C ../homebrew-tap diff -- Formula/rielflow.rb
brew audit --formula tacogips/tap/rielflow
brew style tacogips/tap/rielflow
```

Recent Homebrew versions reject path-based formula audit commands such as
`brew audit --formula ../homebrew-tap/Formula/rielflow.rb`. Use the formula
name instead. Avoid `brew audit --tap=tacogips/tap` for this release gate
because unrelated formulae or casks in the tap can fail and obscure the
rielflow formula result.

The formula should contain `on_macos` and `on_linux` blocks with architecture
specific URLs and checksums for:

- `darwin-arm64`
- `darwin-x64`
- `linux-arm64`
- `linux-x64`

If Homebrew reports checksum, fetch, or URL errors, inspect the rendered formula
and `gh release view "v<version>" --repo tacogips/rielflow --json assets`
before editing generated formula content by hand.

## Smoke Test

After the GitHub release assets are available, test the formula from the tap
path users will install from:

```bash
brew update
brew tap tacogips/tap
brew install tacogips/tap/rielflow
rielflow --version
rielflow --help
brew test tacogips/tap/rielflow
rielflow workflow usage --scope user --output json
brew uninstall rielflow
```

If `rielflow` is already installed, use `brew reinstall tacogips/tap/rielflow`
for the install step. Do not use `brew install --formula <path>` for this
project; recent Homebrew rejects that path-based install for this tap workflow,
and it does not verify the public user install path.

The formula should install the archive for the current platform, run
`rielflow --help`, load built-in add-ons during `workflow usage`, and pass the
formula `test do` block. If an installed older formula shadows the local
formula, uninstall it and rerun the local formula install.

## Commit And Push Tap

When the user asks to complete the release, commit and push the tap update from
the tap checkout. Keep the commit focused on the formula and related tap docs.

```bash
git -C ../homebrew-tap status --short
git -C ../homebrew-tap add Formula/rielflow.rb
git -C ../homebrew-tap diff --staged --stat
git -C ../homebrew-tap diff --staged --check
(
  cd ../homebrew-tap
  gitleaks git --pre-commit --redact --staged --verbose
)
git -C ../homebrew-tap commit -m "chore: update rielflow formula to <version>"
git -C ../homebrew-tap push origin main
```

Do not add automated-assistant attribution or co-authorship trailers to commit
messages.

If the tap checkout has a pre-commit hook installed but no
`.pre-commit-config.yaml`, and the staged formula has already passed
`git diff --staged --check` and gitleaks, rerun only that tap commit with
`PRE_COMMIT_ALLOW_NO_CONFIG=1`.

Stage `README.md` only when it actually changed. Do not stage unrelated tap
files such as other formulae or casks.

## Post-Release Verification

Verify installation through the public tap path:

```bash
brew update
brew tap tacogips/tap
brew install tacogips/tap/rielflow
rielflow --version
rielflow --help
brew test tacogips/tap/rielflow
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
  `RIEL_RELEASE_BASE_URL`.
- Homebrew cannot fetch an asset: verify `gh release view` lists the exact
  archive name and that the release is public.
- Formula audit complains about generated fields: inspect
  `scripts/render-homebrew-formula.sh` before editing the formula by hand.
- Tap worktree is dirty with unrelated changes: do not overwrite them; stop and
  ask how to proceed if they block the release.
