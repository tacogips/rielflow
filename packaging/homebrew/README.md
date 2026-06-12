# Homebrew Packaging

`rielflow` Homebrew releases install a standalone Swift executable built with
Xcode SwiftPM. The published macOS archive contains `bin/rielflow`. Homebrew
does not need a runtime dependency on Bun or a separate add-on package.

Build release archives:

```bash
scripts/build-homebrew-release.sh darwin-arm64 darwin-x64
```

The command writes archives and checksum files under `dist/homebrew/`:

```text
rielflow-<version>-darwin-arm64.tar.gz
rielflow-<version>-darwin-x64.tar.gz
```

Each archive contains:

```text
bin/rielflow
README.md
```

Create or update the GitHub release named `v<version>` with those archives:

```bash
gh release create "v<version>" \
  dist/homebrew/rielflow-<version>-darwin-arm64.tar.gz \
  dist/homebrew/rielflow-<version>-darwin-x64.tar.gz \
  --repo tacogips/rielflow \
  --title "rielflow v<version>" \
  --notes ""
```

If the release already exists, upload or replace the assets with:

```bash
gh release upload "v<version>" \
  dist/homebrew/rielflow-<version>-darwin-arm64.tar.gz \
  dist/homebrew/rielflow-<version>-darwin-x64.tar.gz \
  --repo tacogips/rielflow \
  --clobber
```

Then render the formula into the existing `tacogips/homebrew-tap` checkout:

```bash
scripts/render-homebrew-formula.sh <version> ../homebrew-tap/Formula/rielflow.rb
```

The Taskfile wrapper for that tap path is:

```bash
task homebrew:tap-formula -- <version>
```

For any other tap repository, run the render command from this repository and
write the generated formula into the tap's `Formula/rielflow.rb`.
Override `RIEL_RELEASE_BASE_URL` when the archives are hosted somewhere
other than `https://github.com/tacogips/rielflow/releases/download/v<version>`.

Commit and push the tap change:

```bash
cd ../homebrew-tap
git add Formula/rielflow.rb README.md
git commit -m "chore: add rielflow formula"
git push origin main
```

After the tap commit is pushed, users can install with:

```bash
brew tap tacogips/tap
brew install rielflow
```

Smoke-test a local formula before upload by rendering into a temporary tap that
uses the local archive directory as its URL base:

```bash
brew tap-new local/rielflow-test
tap_root="$(brew --repository local/rielflow-test)"
RIEL_RELEASE_BASE_URL="file://$PWD/dist/homebrew" \
  scripts/render-homebrew-formula.sh <version> "$tap_root/Formula/rielflow.rb"
brew install local/rielflow-test/rielflow
brew test local/rielflow-test/rielflow
rielflow workflow usage matrix-chat-reply --workflow-definition-dir ./examples --output json
brew uninstall rielflow
brew untap local/rielflow-test
```

Linux Homebrew archives are fail-closed for this cutover. The formula renderer
does not read Linux checksum files and generated formulas do not reference
stale TypeScript/Bun Linux archive URLs. Add Linux only after a reviewed Swift
Linux build contract defines targets, archive contents, checksum evidence, and
formula behavior.

## Swift Readiness And Production Cutover Archives

TASK-008 prepared local Swift readiness artifacts and blocked cutover gates.
TASK-009 recorded deterministic gate evidence for the current branch, and its
adversarial implementation review was accepted with no high or mid findings in
workflow session
`riel-codex-design-and-implement-review-loop-1781261544-53db3135`. The release
cutover now uses Swift archives under `dist/homebrew`; release upload and tap
mutation remain separate operator actions.

The Swift executable product is still named `rielflow`. Resolve the release
binary path with Xcode SwiftPM:

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  SDKROOT=/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk \
  /Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift \
    build -c release --product rielflow --show-bin-path
```

Historical Swift readiness archives remain staged separately from production
archives:

```text
dist/swift-homebrew/work/rielflow-<version>-darwin-arm64/bin/rielflow
dist/swift-homebrew/work/rielflow-<version>-darwin-x64/bin/rielflow
dist/swift-homebrew/rielflow-swift-<version>-darwin-arm64.tar.gz
dist/swift-homebrew/rielflow-swift-<version>-darwin-x64.tar.gz
```

Each archive contains `bin/rielflow` and `README.md`, and each archive must have
a sibling `.sha256` file. Preview formula testing, when needed, must use only a
local URL base such as `file://$PWD/dist/swift-homebrew` or unpublished CI
artifacts.

Build or inspect the local readiness archive plan:

```bash
RIEL_VERSION=0.0.0-task009 scripts/build-swift-homebrew-readiness.sh --dry-run darwin-arm64
RIEL_VERSION=0.0.0-task009 scripts/build-swift-homebrew-readiness.sh darwin-arm64
tar -tzf dist/swift-homebrew/rielflow-swift-0.0.0-task009-darwin-arm64.tar.gz
(cd dist/swift-homebrew && shasum -a 256 -c rielflow-swift-0.0.0-task009-darwin-arm64.tar.gz.sha256)
```

Cutover gates are recorded in `packaging/homebrew/swift-cutover-gates.json`.
For TASK-009, non-review gates were marked passed only when that manifest
recorded the exact local command, fixture or archive path, and result. The
dedicated release cutover marked `productionRuntime` as `swift-native`,
`homebrewFormulaSource` as `swift-executable-archive`, and
`allowsProductionCutover` as `true` after both macOS targets had archive,
checksum, formula, Homebrew smoke, deterministic workflow, and leakage
evidence.
