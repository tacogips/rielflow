#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: git-new-branch-worktree.sh <branch-name> [start-point]

Creates or attaches a Git worktree for <branch-name> at:
  <current-worktree-root>/../worktrees/{packagename}/{branch_name}

The start point defaults to HEAD.
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ $# -lt 1 || $# -gt 2 ]]; then
  usage >&2
  exit 64
fi

branch_name="$1"
start_point="${2:-HEAD}"

if ! git check-ref-format --branch "$branch_name" >/dev/null 2>&1; then
  echo "Invalid branch name: $branch_name" >&2
  exit 65
fi

read_package_name() {
  local package_json_path="$1"

  if [[ -f "$package_json_path" ]] && command -v bun >/dev/null 2>&1; then
    PACKAGE_JSON_PATH="$package_json_path" bun -e 'const pkg = await Bun.file(process.env.PACKAGE_JSON_PATH).json(); console.log(typeof pkg.name === "string" ? pkg.name : "");' 2>/dev/null || true
  fi
}

path_safe_package_name() {
  local raw_name="$1"
  local scoped_name

  scoped_name="${raw_name##*/}"
  scoped_name="${scoped_name//@/}"
  printf '%s' "$scoped_name" | tr -cs 'A-Za-z0-9._-' '-' | sed 's/^-//; s/-$//'
}

detect_package_name() {
  local repo_root="$1"
  local current_dir="$2"
  local search_dir
  local detected_name

  case "$current_dir/" in
    "$repo_root"/*)
      search_dir="$current_dir"
      ;;
    *)
      search_dir="$repo_root"
      ;;
  esac

  while true; do
    detected_name="$(read_package_name "$search_dir/package.json")"
    if [[ -n "$detected_name" ]]; then
      printf '%s' "$detected_name"
      return
    fi

    if [[ "$search_dir" == "$repo_root" ]]; then
      break
    fi

    search_dir="$(dirname "$search_dir")"
  done

  basename "$repo_root"
}

detect_managed_root() {
  local repo_root="$1"
  local package_name="$2"
  local repo_parent
  local workspace_root

  case "$repo_root/" in
    */worktrees/"$package_name"/*)
      workspace_root="${repo_root%%/worktrees/$package_name/*}"
      printf '%s/worktrees/%s' "$workspace_root" "$package_name"
      return
      ;;
  esac

  repo_parent="$(cd "$repo_root/.." && pwd -P)"
  printf '%s/worktrees/%s' "$repo_parent" "$package_name"
}

repo_root="$(git rev-parse --show-toplevel)"
repo_root="$(cd "$repo_root" && pwd -P)"
current_dir="$(pwd -P)"
raw_package_name="$(detect_package_name "$repo_root" "$current_dir")"
safe_package_name="$(path_safe_package_name "$raw_package_name")"

if [[ -z "$safe_package_name" ]]; then
  safe_package_name="$(basename "$repo_root")"
fi

managed_root="$(detect_managed_root "$repo_root" "$safe_package_name")"
target_path="$managed_root/$branch_name"
target_parent="$(dirname "$target_path")"

mkdir -p "$target_parent"
resolved_target_parent="$(cd "$target_parent" && pwd -P)"
case "$resolved_target_parent/" in
  "$managed_root"/*|"$managed_root/")
    ;;
  *)
    echo "Resolved worktree path escapes managed root: $target_path" >&2
    exit 66
    ;;
esac

if [[ -e "$target_path" ]]; then
  echo "Worktree target already exists: $target_path" >&2
  exit 67
fi

if git show-ref --verify --quiet "refs/heads/$branch_name"; then
  if git worktree list --porcelain | grep -Fxq "branch refs/heads/$branch_name"; then
    echo "Branch is already checked out in another worktree: $branch_name" >&2
    git worktree list --porcelain >&2
    exit 68
  fi

  git worktree add "$target_path" "$branch_name"
  action="attached existing branch"
else
  git rev-parse --verify --quiet "$start_point^{commit}" >/dev/null
  git worktree add -b "$branch_name" "$target_path" "$start_point"
  action="created branch"
fi

printf 'Branch: %s\n' "$branch_name"
printf 'Action: %s\n' "$action"
printf 'Start point: %s\n' "$start_point"
printf 'Package: %s\n' "$safe_package_name"
printf 'Managed root: %s\n' "$managed_root"
printf 'Worktree: %s\n' "$target_path"
