#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: worktree-clean-merged.sh [--apply] [--default-branch <ref>] [--package-name <name>]

Dry-runs cleanup of managed package worktrees by default. With --apply, removes
worktrees under:
  <current-worktree-root>/../worktrees/{packagename}/

Merged means the worktree branch commit is an ancestor of the default branch commit.
USAGE
}

apply=false
default_branch=""
package_name_override=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply)
      apply=true
      shift
      ;;
    --default-branch)
      if [[ -z "${2:-}" ]]; then
        echo "Missing value for --default-branch" >&2
        exit 64
      fi
      default_branch="$2"
      shift 2
      ;;
    --package-name)
      if [[ -z "${2:-}" ]]; then
        echo "Missing value for --package-name" >&2
        exit 64
      fi
      package_name_override="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 64
      ;;
  esac
done

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

  if [[ -n "$package_name_override" ]]; then
    printf '%s' "$package_name_override"
    return
  fi

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

  detected_name="$(read_package_name "$repo_root/package.json")"
  if [[ -n "$detected_name" ]]; then
    printf '%s' "$detected_name"
    return
  fi

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

detect_default_branch() {
  local origin_head

  if [[ -n "$default_branch" ]]; then
    printf '%s' "$default_branch"
    return
  fi

  origin_head="$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null || true)"
  if [[ -n "$origin_head" ]]; then
    printf '%s' "$origin_head"
    return
  fi

  if git show-ref --verify --quiet refs/heads/main; then
    printf '%s' "main"
    return
  fi

  if git show-ref --verify --quiet refs/heads/master; then
    printf '%s' "master"
    return
  fi

  echo "Unable to determine default branch. Pass --default-branch <ref>." >&2
  exit 65
}

resolve_default_short_name() {
  local ref="$1"

  case "$ref" in
    refs/remotes/origin/*)
      printf '%s' "${ref#refs/remotes/origin/}"
      ;;
    origin/*)
      printf '%s' "${ref#origin/}"
      ;;
    refs/heads/*)
      printf '%s' "${ref#refs/heads/}"
      ;;
    *)
      printf '%s' "$ref"
      ;;
  esac
}

prune_empty_parents() {
  local path="$1"
  local stop="$2"
  local dir

  dir="$(dirname "$path")"
  while [[ "$dir" != "$stop" && "$dir" == "$stop"/* ]]; do
    rmdir "$dir" 2>/dev/null || break
    dir="$(dirname "$dir")"
  done
}

evaluate_worktree() {
  local worktree_path="$1"
  local branch_ref="$2"
  local branch_name
  local branch_commit
  local status_output

  if [[ "$worktree_path/" != "$managed_root/"* ]]; then
    return
  fi

  if [[ "$worktree_path" == "$repo_root" ]]; then
    printf 'KEEP current-worktree %s\n' "$worktree_path"
    return
  fi

  if [[ -z "$branch_ref" ]]; then
    printf 'KEEP detached-or-missing-branch %s\n' "$worktree_path"
    return
  fi

  branch_name="${branch_ref#refs/heads/}"

  if [[ "$branch_name" == "$default_short_name" || "$branch_ref" == "refs/heads/$default_short_name" ]]; then
    printf 'KEEP default-branch %s (%s)\n' "$worktree_path" "$branch_name"
    return
  fi

  if ! git show-ref --verify --quiet "$branch_ref"; then
    printf 'KEEP missing-local-branch %s (%s)\n' "$worktree_path" "$branch_name"
    return
  fi

  status_output="$(git -C "$worktree_path" status --porcelain)"
  if [[ -n "$status_output" ]]; then
    printf 'KEEP dirty %s (%s)\n' "$worktree_path" "$branch_name"
    return
  fi

  branch_commit="$(git rev-parse --verify "$branch_ref^{commit}")"
  if git merge-base --is-ancestor "$branch_commit" "$default_commit"; then
    if [[ "$apply" == true ]]; then
      git worktree remove "$worktree_path"
      prune_empty_parents "$worktree_path" "$managed_root"
      printf 'REMOVED merged %s (%s)\n' "$worktree_path" "$branch_name"
    else
      printf 'REMOVE merged %s (%s)\n' "$worktree_path" "$branch_name"
    fi
    return
  fi

  printf 'KEEP unmerged %s (%s)\n' "$worktree_path" "$branch_name"
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
resolved_default_branch="$(detect_default_branch)"
default_short_name="$(resolve_default_short_name "$resolved_default_branch")"

if ! default_commit="$(git rev-parse --verify "$resolved_default_branch^{commit}" 2>/dev/null)"; then
  echo "Default branch ref does not resolve to a commit: $resolved_default_branch" >&2
  exit 66
fi

printf 'Mode: %s\n' "$([[ "$apply" == true ]] && printf 'apply' || printf 'dry-run')"
printf 'Package: %s\n' "$safe_package_name"
printf 'Managed root: %s\n' "$managed_root"
printf 'Default branch: %s\n' "$resolved_default_branch"
printf 'Default commit: %s\n' "$default_commit"

current_worktree=""
current_branch_ref=""
matched_any=false

while IFS= read -r line || [[ -n "$line" ]]; do
  if [[ -z "$line" ]]; then
    if [[ -n "$current_worktree" ]]; then
      if [[ "$current_worktree/" == "$managed_root/"* ]]; then
        matched_any=true
      fi
      evaluate_worktree "$current_worktree" "$current_branch_ref"
    fi
    current_worktree=""
    current_branch_ref=""
    continue
  fi

  case "$line" in
    worktree\ *)
      current_worktree="${line#worktree }"
      ;;
    branch\ *)
      current_branch_ref="${line#branch }"
      ;;
  esac
done < <(git worktree list --porcelain)

if [[ -n "$current_worktree" ]]; then
  if [[ "$current_worktree/" == "$managed_root/"* ]]; then
    matched_any=true
  fi
  evaluate_worktree "$current_worktree" "$current_branch_ref"
fi

if [[ "$matched_any" == false ]]; then
  printf 'No managed worktrees found for package root: %s\n' "$managed_root"
fi

if [[ "$apply" == true ]]; then
  git worktree prune
fi
