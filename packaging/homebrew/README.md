# Homebrew Packaging

`divedra` Homebrew releases install a standalone executable built with
`bun build --compile`. The published archive contains `bin/divedra`, and the
Bun runtime is embedded in that binary. Homebrew does not need a runtime
dependency on Bun.

Build release archives:

```bash
scripts/build-homebrew-release.sh darwin-arm64 darwin-x64 linux-arm64 linux-x64
```

The command writes archives and checksum files under `dist/homebrew/`:

```text
divedra-<version>-darwin-arm64.tar.gz
divedra-<version>-darwin-x64.tar.gz
divedra-<version>-linux-arm64.tar.gz
divedra-<version>-linux-x64.tar.gz
```

Create or update the GitHub release named `v<version>` with those archives:

```bash
gh release create "v<version>" \
  dist/homebrew/divedra-<version>-darwin-arm64.tar.gz \
  dist/homebrew/divedra-<version>-darwin-x64.tar.gz \
  dist/homebrew/divedra-<version>-linux-arm64.tar.gz \
  dist/homebrew/divedra-<version>-linux-x64.tar.gz \
  --repo tacogips/divedra \
  --title "divedra v<version>" \
  --notes ""
```

If the release already exists, upload or replace the assets with:

```bash
gh release upload "v<version>" \
  dist/homebrew/divedra-<version>-darwin-arm64.tar.gz \
  dist/homebrew/divedra-<version>-darwin-x64.tar.gz \
  dist/homebrew/divedra-<version>-linux-arm64.tar.gz \
  dist/homebrew/divedra-<version>-linux-x64.tar.gz \
  --repo tacogips/divedra \
  --clobber
```

Then render the formula into the existing `tacogips/homebrew-tap` checkout:

```bash
scripts/render-homebrew-formula.sh <version> ../homebrew-tap/Formula/divedra.rb
```

The Taskfile wrapper for that tap path is:

```bash
task homebrew:tap-formula -- <version>
```

For any other tap repository, run the render command from this repository and
write the generated formula into the tap's `Formula/divedra.rb`.
Override `DIVEDRA_RELEASE_BASE_URL` when the archives are hosted somewhere
other than `https://github.com/tacogips/divedra/releases/download/v<version>`.

Commit and push the tap change:

```bash
cd ../homebrew-tap
git add Formula/divedra.rb README.md
git commit -m "chore: add divedra formula"
git push origin main
```

After the tap commit is pushed, users can install with:

```bash
brew tap tacogips/tap
brew install divedra
```

Smoke-test a local formula before upload by rendering into a temporary tap that
uses the local archive directory as its URL base:

```bash
brew tap-new local/divedra-test
tap_root="$(brew --repository local/divedra-test)"
DIVEDRA_RELEASE_BASE_URL="file://$PWD/dist/homebrew" \
  scripts/render-homebrew-formula.sh <version> "$tap_root/Formula/divedra.rb"
brew install local/divedra-test/divedra
brew test local/divedra-test/divedra
brew uninstall divedra
brew untap local/divedra-test
```
