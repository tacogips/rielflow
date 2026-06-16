#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"

usage() {
  cat <<'EOF'
Usage:
  scripts/build-homebrew-release.sh [--dry-run] [target ...]

Targets:
  darwin-arm64  darwin-x64

Environment:
  RIEL_VERSION             Override package version used in archive names.
  RIEL_RELEASE_DIR         Output directory. Defaults to dist/homebrew.
  RIEL_SWIFT               Swift executable. Defaults to Xcode's Swift toolchain.
  RIEL_SWIFT_DEVELOPER_DIR Defaults to /Applications/Xcode.app/Contents/Developer.
  RIEL_SWIFT_SDKROOT       Defaults to Xcode's macOS SDK path.

Examples:
  scripts/build-homebrew-release.sh
  scripts/build-homebrew-release.sh --dry-run darwin-arm64 darwin-x64
  scripts/build-homebrew-release.sh darwin-arm64 darwin-x64

This production builder stages Swift macOS archives only. It does not publish
release assets, mutate a tap, render a formula, or remove TypeScript/Bun source.
EOF
}

detect_target() {
  local kernel arch
  kernel="$(uname -s)"
  arch="$(uname -m)"

  case "$kernel:$arch" in
    Darwin:arm64) printf '%s\n' "darwin-arm64" ;;
    Darwin:x86_64) printf '%s\n' "darwin-x64" ;;
    *)
      printf 'unsupported Swift production host platform: %s/%s\n' "$kernel" "$arch" >&2
      return 1
      ;;
  esac
}

validate_target() {
  case "$1" in
    darwin-arm64 | darwin-x64) ;;
    *)
      printf 'unsupported Swift production target: %s\n' "$1" >&2
      printf 'Linux Homebrew archives are unsupported until a reviewed Swift Linux build contract exists.\n' >&2
      usage >&2
      return 1
      ;;
  esac
}

validate_version() {
  local version
  version="$1"

  if [[ "$version" == *..* || ! "$version" =~ ^[0-9]+[.][0-9]+[.][0-9]+([-+][0-9A-Za-z][0-9A-Za-z.+-]*)?$ ]]; then
    printf 'unsafe Swift production version: %s\n' "$version" >&2
    printf 'expected archive-safe semver-like value without path separators or parent traversal\n' >&2
    return 1
  fi
}

absolute_path() {
  case "$1" in
    /*) printf '%s\n' "$1" ;;
    *) printf '%s/%s\n' "$repo_root" "$1" ;;
  esac
}

validate_release_dir() {
  local path part
  local -a parts
  path="$1"

  if [[ -z "$path" ]]; then
    printf 'unsafe Swift production release directory: empty path\n' >&2
    return 1
  fi

  IFS='/' read -r -a parts <<< "$path"
  for part in "${parts[@]}"; do
    if [[ "$part" == "." || "$part" == ".." ]]; then
      printf 'unsafe Swift production release directory: %s\n' "$path" >&2
      printf 'release directory must not contain . or .. path components\n' >&2
      return 1
    fi
  done
}

assert_child_path() {
  local root child
  root="${1%/}"
  child="$2"

  if [[ -z "$root" || "$root" == "/" || "$child" != "$root"/* ]]; then
    printf 'unsafe Swift production path outside release directory: %s\n' "$child" >&2
    return 1
  fi
}

swift_triple_for_target() {
  case "$1" in
    darwin-arm64) printf '%s\n' "arm64-apple-macosx" ;;
    darwin-x64) printf '%s\n' "x86_64-apple-macosx" ;;
  esac
}

write_sha256() {
  local file dir base
  file="$1"
  dir="$(dirname "$file")"
  base="$(basename "$file")"

  if command -v shasum >/dev/null 2>&1; then
    ( cd "$dir" && shasum -a 256 "$base" )
    return
  fi
  if command -v sha256sum >/dev/null 2>&1; then
    ( cd "$dir" && sha256sum "$base" )
    return
  fi

  printf 'missing checksum tool: expected shasum or sha256sum\n' >&2
  return 1
}

package_version() {
  if [[ -n "${RIEL_VERSION:-}" ]]; then
    printf '%s\n' "$RIEL_VERSION"
    return
  fi

  (
    cd "$repo_root"
    bun --print 'JSON.parse(await Bun.file("packages/rielflow/package.json").text()).version'
  )
}

swift_release_bin_path() {
  local target swift_bin developer_dir sdkroot triple
  target="$1"
  swift_bin="${RIEL_SWIFT:-/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift}"
  developer_dir="${RIEL_SWIFT_DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
  sdkroot="${RIEL_SWIFT_SDKROOT:-/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk}"
  triple="$(swift_triple_for_target "$target")"

  (
    cd "$repo_root"
    DEVELOPER_DIR="$developer_dir" SDKROOT="$sdkroot" \
      "$swift_bin" build -c release --product rielflow --triple "$triple" >/dev/null
    DEVELOPER_DIR="$developer_dir" SDKROOT="$sdkroot" \
      "$swift_bin" build -c release --product rielflow --triple "$triple" --show-bin-path
  )
}

print_plan() {
  local version target release_dir work_dir archive binary triple
  version="$1"
  target="$2"
  release_dir="$3"
  work_dir="$release_dir/work/rielflow-$version-$target"
  archive="$release_dir/rielflow-$version-$target.tar.gz"
  binary="$work_dir/bin/rielflow"
  triple="$(swift_triple_for_target "$target")"

  assert_child_path "$release_dir" "$work_dir"
  assert_child_path "$release_dir" "$archive"

  printf 'Swift production Homebrew archive plan\n'
  printf '  product: rielflow\n'
  printf '  target: %s\n' "$target"
  printf '  swift triple: %s\n' "$triple"
  printf '  release bin path command: swift build -c release --product rielflow --triple %s --show-bin-path\n' "$triple"
  printf '  staged binary: %s\n' "$binary"
  printf '  archive: %s\n' "$archive"
  printf '  checksum: %s.sha256\n' "$archive"
  printf '  publish side effects: false\n'
}

build_target() {
  local version target release_dir bin_path work_dir archive binary
  version="$1"
  target="$2"
  release_dir="$3"
  work_dir="$release_dir/work/rielflow-$version-$target"
  archive="$release_dir/rielflow-$version-$target.tar.gz"
  binary="$work_dir/bin/rielflow"

  assert_child_path "$release_dir" "$work_dir"
  assert_child_path "$release_dir" "$archive"

  rm -rf "$work_dir" "$archive" "$archive.sha256"
  mkdir -p "$work_dir/bin"

  bin_path="$(swift_release_bin_path "$target" | tail -n 1)"
  cp "$bin_path/rielflow" "$binary"
  chmod 0755 "$binary"
  cp "$repo_root/README.md" "$work_dir/README.md"

  tar -C "$work_dir" -czf "$archive" .
  write_sha256 "$archive" > "$archive.sha256"

  printf 'built %s\n' "$archive"
  cat "$archive.sha256"
}

main() {
  local dry_run
  dry_run=false

  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    usage
    return
  fi

  if [[ "${1:-}" == "--dry-run" ]]; then
    dry_run=true
    shift
  fi

  local version release_dir
  version="$(package_version)"
  validate_version "$version"
  release_dir="$(absolute_path "${RIEL_RELEASE_DIR:-dist/homebrew}")"
  validate_release_dir "$release_dir"

  local -a targets
  if [[ "$#" -eq 0 ]]; then
    targets=("$(detect_target)")
  else
    targets=("$@")
  fi

  local target
  for target in "${targets[@]}"; do
    validate_target "$target"
    if [[ "$dry_run" == true ]]; then
      print_plan "$version" "$target" "$release_dir"
    else
      mkdir -p "$release_dir"
      build_target "$version" "$target" "$release_dir"
    fi
  done

  printf '\nRender a formula after all platform archives exist:\n'
  printf '  scripts/render-homebrew-formula.sh %s\n' "$version"
}

main "$@"
