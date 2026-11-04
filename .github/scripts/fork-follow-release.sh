#!/usr/bin/env bash
# Rebuild the night-build branch onto the latest upstream release.
#
#   prepare   Fetch upstream and the fork branches, then try the rebuild.
#             Writes a result file and, on GitHub Actions, job outputs.
#             Exits 0 for uptodate, rebuilt and conflict. A conflict checks
#             the build branch back out and pushes nothing.
#   publish   Push a rebuilt HEAD to origin. Refuses a dry-run, refuses any
#             origin that is not this fork, and refuses upstream. A
#             fast-forward is a normal push. Anything else pushes a dated
#             backup of the exact remote tip, then --force-with-lease.
#
# There is no notification step. The caller opens one issue when this stops.
# Hooks are off for every command that could commit or push: the old port
# branch's hook once committed a junk fixture, and husky's pre-push runs the
# full test suite.
set -euo pipefail

BUILD_BRANCH=${BUILD_BRANCH:-test/start-minimized-on-installed}
UPSTREAM_SLUG=${UPSTREAM_SLUG:-super-productivity/super-productivity}
UPSTREAM_FETCH_URL=${UPSTREAM_FETCH_URL:-https://github.com/super-productivity/super-productivity.git}
FORK_SLUG=${FORK_SLUG:-SaintChris/super-productivity}
BRANCHES_FILE=${BRANCHES_FILE:-.github/fork-follow-branches.txt}
RESULT_FILE=${RESULT_FILE:-${RUNNER_TEMP:-/tmp}/fork-follow-result.env}
REBUILD_BRANCH=fork-follow-rebuild

die() {
  echo "fork-follow: $*" >&2
  exit 1
}

normalize_dry_run() {
  case "${DRY_RUN:-0}" in
    1 | true | TRUE | True) DRY_RUN=1 ;;
    *) DRY_RUN=0 ;;
  esac
}

gitc() {
  git -c core.hooksPath=/dev/null "$@"
}

github_slug() {
  local url=${1%.git}
  if [[ "$url" =~ github.com[:/]([^/:]+)/([^/]+)$ ]]; then
    printf '%s/%s\n' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}"
    return 0
  fi
  return 1
}

assert_origin_is_fork() {
  local url slug
  # Raw config, not `git remote get-url`: that command applies insteadOf and
  # would hide an upstream URL rewritten to a local path.
  url=$(git config --get remote.origin.pushurl || true)
  if [[ -z "$url" ]]; then
    url=$(git config --get remote.origin.url || true)
  fi
  [[ -n "$url" ]] || die "origin has no URL"
  case "$url" in
    *github.com*super-productivity/super-productivity*)
      die "refusing to push: origin is the upstream repository"
      ;;
  esac
  if slug=$(github_slug "$url"); then
    [[ "$slug" == "$FORK_SLUG" ]] || die "refusing to push: origin is $slug, want $FORK_SLUG"
    [[ "$slug" != "$UPSTREAM_SLUG" ]] || die "refusing to push: origin is upstream"
  elif [[ "${ALLOW_LOCAL_ORIGIN:-}" == "1" && "$url" != *github.com* ]]; then
    return 0
  else
    die "refusing to push: origin is not $FORK_SLUG"
  fi
}

ensure_identity() {
  if [[ -z "$(git config user.email || true)" ]]; then
    export GIT_AUTHOR_NAME='github-actions[bot]'
    export GIT_AUTHOR_EMAIL='41898282+github-actions[bot]@users.noreply.github.com'
    export GIT_COMMITTER_NAME=$GIT_AUTHOR_NAME
    export GIT_COMMITTER_EMAIL=$GIT_AUTHOR_EMAIL
  fi
}

trim() {
  local s=$1
  s=${s#"${s%%[![:space:]]*}"}
  s=${s%"${s##*[![:space:]]}"}
  printf '%s\n' "$s"
}

read_branches() {
  local line
  BRANCHES=()
  [[ -f "$BRANCHES_FILE" ]] || die "branches file not found: $BRANCHES_FILE"
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" =~ ^[[:space:]]*$ ]] && continue
    line=$(trim "$line")
    [[ "$line" =~ ^[A-Za-z0-9._/-]+$ ]] || die "bad branch name: $line"
    BRANCHES+=("$line")
  done <"$BRANCHES_FILE"
  [[ ${#BRANCHES[@]} -gt 0 ]] || die "branches file is empty"
}

write_result() {
  mkdir -p "$(dirname "$RESULT_FILE")"
  files_file=${files_file:-}
  cat >"$RESULT_FILE" <<EOF
status=$status
release=$release
base=$base
failed_branch=$failed_branch
conflict_kind=$conflict_kind
head=$head
old_head=$old_head
dry_run=$DRY_RUN
files=$files_file
EOF
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    {
      echo "status=$status"
      echo "release=$release"
      echo "base=$base"
      echo "failed_branch=$failed_branch"
      echo "conflict_kind=$conflict_kind"
      echo "head=$head"
      echo "old_head=$old_head"
      echo "dry_run=$DRY_RUN"
      echo "files=$files_file"
    } >>"$GITHUB_OUTPUT"
  fi
}

fetch_upstream() {
  # actions/checkout puts the fork token in http.extraheader. Clear it so the
  # token is not sent to the upstream repository.
  git -c http.extraheader= fetch -q --no-tags "$UPSTREAM_FETCH_URL" \
    "+refs/heads/master:refs/remotes/upstream/master" \
    "+refs/tags/v*:refs/tags/v*"
}

fetch_fork_ref() {
  local branch=$1
  git fetch -q --no-tags origin \
    "+refs/heads/${branch}:refs/remotes/origin/${branch}"
}

base_tag_of() {
  local commit=$1 tags
  tags=$(git tag --merged "$commit" --list 'v*')
  # grep exits 1 when every tag is a pre-release. That is "no base", not an error.
  printf '%s\n' "$tags" | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -n 1 || true
}

restore_start() {
  gitc merge --abort >/dev/null 2>&1 || true
  gitc cherry-pick --abort >/dev/null 2>&1 || true
  gitc reset -q --hard
  if [[ -n "${start_branch:-}" ]]; then
    gitc checkout -q --force "$start_branch"
  else
    gitc checkout -q --force "$start_sha"
  fi
  git branch -D "$REBUILD_BRANCH" >/dev/null 2>&1 || true
}

record_conflict() {
  local kind=$1
  conflict_kind=$kind
  failed_branch=$current_branch
  files_file=$(dirname "$RESULT_FILE")/fork-follow-files.txt
  git diff --name-only --diff-filter=U >"$files_file" || true
  if [[ $(wc -l <"$files_file") -gt 200 ]]; then
    head -n 200 "$files_file" >"$files_file.part"
    echo "(list truncated)" >>"$files_file.part"
    mv "$files_file.part" "$files_file"
  fi
  status=conflict
  head=
  restore_start
  write_result
}

cherry_pick_range() {
  local tip=$1 sha
  local commits
  # `|| die` rather than set -e: this runs under `if ! apply_branch`, which
  # turns set -e off for the whole call.
  commits=$(git rev-list --reverse --no-merges refs/remotes/upstream/master.."$tip") \
    || die "cannot list commits on $current_branch"
  [[ -n "$commits" ]] || return 0
  while IFS= read -r sha; do
    [[ -z "$sha" ]] && continue
    if gitc cherry-pick "$sha" >/dev/null; then
      continue
    fi
    if [[ -n "$(git diff --name-only --diff-filter=U)" ]]; then
      record_conflict cherry-pick
      return 1
    fi
    if git diff --quiet && git diff --cached --quiet; then
      gitc cherry-pick --skip >/dev/null \
        || die "cherry-pick --skip failed for $sha on $current_branch"
      continue
    fi
    gitc cherry-pick --abort >/dev/null 2>&1 || true
    restore_start
    die "cherry-pick $sha failed without a conflict on $current_branch"
  done <<<"$commits"
}

apply_branch() {
  local tip=$1 mb
  current_branch=$2
  mb=$(git merge-base "$tip" refs/remotes/upstream/master) \
    || die "no merge-base for $current_branch and upstream master"
  if git merge-base --is-ancestor "$mb" HEAD; then
    if ! gitc merge -q --no-ff --no-edit "$tip"; then
      if [[ -n "$(git diff --name-only --diff-filter=U)" ]]; then
        record_conflict merge
        return 1
      fi
      gitc merge --abort >/dev/null 2>&1 || true
      die "merge of $current_branch failed without a conflict"
    fi
  else
    cherry_pick_range "$tip" || return 1
  fi
}

resolve_release() {
  if [[ -n "${RELEASE_TAG:-}" ]]; then
    release=$RELEASE_TAG
  else
    command -v gh >/dev/null 2>&1 || die "gh is not installed and RELEASE_TAG is unset"
    release=$(gh release view -R "$UPSTREAM_SLUG" --json tagName --jq .tagName)
  fi
  [[ "$release" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "release tag is not vX.Y.Z: $release"
}

prepare() {
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "not a git checkout"
  normalize_dry_run
  read_branches
  resolve_release
  ensure_identity
  start_sha=$(git rev-parse HEAD)
  start_branch=$(git symbolic-ref --quiet --short HEAD || true)
  status= failed_branch= conflict_kind= head= old_head= base= files_file=

  if git show-ref --verify --quiet "refs/heads/$REBUILD_BRANCH"; then
    git branch -D "$REBUILD_BRANCH" >/dev/null
  fi

  fetch_upstream
  git rev-parse --verify --quiet "refs/tags/${release}^{commit}" >/dev/null \
    || die "upstream tag $release was not fetched"
  fetch_fork_ref "$BUILD_BRANCH"
  old_head=$(git rev-parse "refs/remotes/origin/${BUILD_BRANCH}")
  base=$(base_tag_of "refs/remotes/origin/${BUILD_BRANCH}")
  [[ -n "$base" ]] || die "no vX.Y.Z tag is contained in $BUILD_BRANCH"

  if git merge-base --is-ancestor "$release" "refs/remotes/origin/${BUILD_BRANCH}"; then
    status=uptodate
    head=$old_head
    write_result
    echo "fork-follow: $BUILD_BRANCH already contains $release"
    return 0
  fi

  local branch
  for branch in "${BRANCHES[@]}"; do
    fetch_fork_ref "$branch"
  done

  gitc checkout -q --force -B "$REBUILD_BRANCH" "$release"
  for branch in "${BRANCHES[@]}"; do
    echo "fork-follow: apply $branch"
    if ! apply_branch "refs/remotes/origin/${branch}" "$branch"; then
      echo "fork-follow: stopped on $branch ($conflict_kind conflict); $BUILD_BRANCH left at $old_head"
      return 0
    fi
  done

  status=rebuilt
  head=$(git rev-parse HEAD)
  if [[ "$DRY_RUN" == "1" ]]; then
    restore_start
    echo "fork-follow: dry-run rebuilt $release as $head; nothing kept or pushed"
  else
    echo "fork-follow: rebuilt $release as $head"
  fi
  write_result
}

backup_name() {
  local date stem
  date=$(TZ=America/Jamaica date +%F)
  stem=${BUILD_BRANCH#test/}
  stem=${stem//\//-}
  printf 'backup/%s-%s\n' "$stem" "$date"
}

remote_sha() {
  local ref=$1
  if git fetch --no-tags origin "+refs/heads/${ref}:refs/remotes/origin/${ref}" >/dev/null 2>&1; then
    git rev-parse "refs/remotes/origin/${ref}"
    return 0
  fi
  return 1
}

publish() {
  local recorded_old recorded_head backup existing suffix pushed_backup
  normalize_dry_run
  [[ "$DRY_RUN" == "1" ]] && die "publish refused in a dry-run"
  [[ -f "$RESULT_FILE" ]] || die "no prepare result at $RESULT_FILE"
  # shellcheck disable=SC1090
  source "$RESULT_FILE"
  [[ "${dry_run:-0}" == "0" ]] || die "publish refused: prepare was a dry-run"
  [[ "${status:-}" == "rebuilt" ]] || die "publish refused: status is ${status:-missing}"
  [[ -n "${head:-}" && -n "${old_head:-}" ]] || die "publish refused: missing head"
  [[ "$(git rev-parse HEAD)" == "$head" ]] || die "publish refused: HEAD is not the rebuilt commit"
  assert_origin_is_fork

  recorded_old=$old_head
  recorded_head=$head
  remote_sha "$BUILD_BRANCH" >/dev/null || die "cannot fetch $BUILD_BRANCH"
  if [[ "$(git rev-parse "refs/remotes/origin/${BUILD_BRANCH}")" != "$recorded_old" ]]; then
    die "refusing to push: $BUILD_BRANCH moved after prepare"
  fi

  if git merge-base --is-ancestor "$recorded_old" "$recorded_head"; then
    gitc push origin "${recorded_head}:refs/heads/${BUILD_BRANCH}"
    echo "fork-follow: fast-forwarded $BUILD_BRANCH to $recorded_head"
    return 0
  fi

  backup=$(backup_name)
  if existing=$(remote_sha "$backup"); then
    if [[ "$existing" != "$recorded_old" ]]; then
      suffix=${GITHUB_RUN_ID:-}
      [[ -n "$suffix" ]] || die "backup $backup exists at another commit and GITHUB_RUN_ID is unset"
      backup="${backup}-${suffix}"
      if existing=$(remote_sha "$backup"); then
        [[ "$existing" == "$recorded_old" ]] || die "backup $backup already exists at another commit"
      fi
    fi
  fi
  gitc push origin "${recorded_old}:refs/heads/${backup}"
  pushed_backup=$backup
  gitc push --force-with-lease="refs/heads/${BUILD_BRANCH}:${recorded_old}" \
    origin "${recorded_head}:refs/heads/${BUILD_BRANCH}"
  echo "fork-follow: backed up $recorded_old as $pushed_backup and moved $BUILD_BRANCH to $recorded_head"
}

main() {
  case "${1:-}" in
    prepare) prepare ;;
    publish) publish ;;
    *) die "usage: fork-follow-release.sh prepare|publish" ;;
  esac
}

main "$@"
