#!/usr/bin/env bash
# Local git test for fork-follow-release.sh. Not part of the daily workflow.
# Uses temporary repositories only. Refuses the real upstream URL before any push,
# and a url.insteadOf sends a mistaken push to a local bare repo.
set -euo pipefail

SCRIPT=$(cd "$(dirname "$0")" && pwd)/fork-follow-release.sh
ROOT=$(mktemp -d)
trap 'rm -rf "$ROOT"' EXIT

die() {
  echo "test: $*" >&2
  exit 1
}

assert_eq() {
  [[ "$1" == "$2" ]] || die "$3: got [$1] want [$2]"
}

git_id() {
  git -C "$1" config user.email test@example.com
  git -C "$1" config user.name Test
}

commit_file() {
  local repo=$1 path=$2 content=$3 message=$4
  mkdir -p "$(dirname "$repo/$path")"
  printf '%s\n' "$content" >"$repo/$path"
  git -C "$repo" add "$path"
  git -C "$repo" commit -q -m "$message"
}

init_upstream() {
  git init -q -b master "$ROOT/upstream"
  git_id "$ROOT/upstream"
  commit_file "$ROOT/upstream" file.txt base "base"
  git -C "$ROOT/upstream" tag v1.0.0
  commit_file "$ROOT/upstream" file.txt 'version 1.1' "release"
  git -C "$ROOT/upstream" tag v1.1.0
  commit_file "$ROOT/upstream" file.txt 'master after release' "after"
  git -C "$ROOT/upstream" rev-parse HEAD >"$ROOT/after-sha"
  git -C "$ROOT/upstream" rev-parse v1.0.0 >"$ROOT/v10-sha"
  git -C "$ROOT/upstream" rev-parse v1.1.0 >"$ROOT/v11-sha"
}

seed_fork() {
  git clone -q --bare "$ROOT/upstream" "$ROOT/origin.git"
  git clone -q "$ROOT/origin.git" "$ROOT/seed"
  git_id "$ROOT/seed"
  git -C "$ROOT/seed" checkout -q -b test/start-minimized-on-installed v1.0.0
  commit_file "$ROOT/seed" old.txt 'old pin' "old pin on the build branch"
  git -C "$ROOT/seed" rev-parse HEAD >"$ROOT/old-pin-sha"
  git -C "$ROOT/seed" checkout -q -b port/clean v1.0.0
  commit_file "$ROOT/seed" extra.txt feature "clean feature"
  git -C "$ROOT/seed" checkout -q -b port/conflict v1.0.0
  commit_file "$ROOT/seed" file.txt 'feature edit' "conflicting feature"
  git -C "$ROOT/seed" checkout -q -b feat/later master
  commit_file "$ROOT/seed" only-fork.txt 'fork only' "fork only"
  git -C "$ROOT/seed" checkout -q -b feat/empty master
  git -C "$ROOT/seed" commit -q --allow-empty -m "empty fork commit"
  git -C "$ROOT/seed" push -q origin \
    test/start-minimized-on-installed port/clean port/conflict feat/later feat/empty
  git clone -q "$ROOT/origin.git" "$ROOT/work"
  git_id "$ROOT/work"
  mkdir -p "$ROOT/work/.githooks"
  printf '#!/bin/sh\necho HOOK-RAN >&2\nexit 1\n' >"$ROOT/work/.githooks/pre-commit"
  chmod +x "$ROOT/work/.githooks/pre-commit"
  git -C "$ROOT/work" config core.hooksPath "$ROOT/work/.githooks"
  git init -q --bare "$ROOT/blocked.git"
}

build_sha() {
  git -C "$ROOT/origin.git" rev-parse "refs/heads/test/start-minimized-on-installed"
}

set_build() {
  git -C "$ROOT/origin.git" update-ref refs/heads/test/start-minimized-on-installed "$1"
}

reset_work() {
  git -C "$ROOT/work" checkout -q --force master
  git -C "$ROOT/work" branch -D fork-follow-rebuild >/dev/null 2>&1 || true
  git -C "$ROOT/work" reset -q --hard master
  git -C "$ROOT/work" clean -qfd
}

write_branches() {
  printf '%s\n' "$@" >"$ROOT/branches.txt"
}

run_prepare() {
  write_branches "$@"
  (
    cd "$ROOT/work"
    ALLOW_LOCAL_ORIGIN=1 \
      UPSTREAM_FETCH_URL="$ROOT/upstream" \
      RELEASE_TAG=v1.1.0 \
      BUILD_BRANCH=test/start-minimized-on-installed \
      BRANCHES_FILE="$ROOT/branches.txt" \
      RESULT_FILE="$ROOT/result.env" \
      DRY_RUN="${DRY_RUN:-0}" \
      bash "$SCRIPT" prepare
  )
}

run_publish() {
  (
    cd "$ROOT/work"
    ALLOW_LOCAL_ORIGIN=1 \
      UPSTREAM_FETCH_URL="$ROOT/upstream" \
      RELEASE_TAG=v1.1.0 \
      BUILD_BRANCH=test/start-minimized-on-installed \
      RESULT_FILE="$ROOT/result.env" \
      GITHUB_RUN_ID="${GITHUB_RUN_ID:-4242}" \
      DRY_RUN="${DRY_RUN:-0}" \
      bash "$SCRIPT" publish
  )
}

load_result() {
  # shellcheck disable=SC1091
  source "$ROOT/result.env"
}

backup_ref() {
  local date
  date=$(TZ=America/Jamaica date +%F)
  printf 'refs/heads/backup/start-minimized-on-installed-%s\n' "$date"
}

init_upstream
seed_fork

echo "case uptodate"
set_build "$(cat "$ROOT/v11-sha")"
reset_work
DRY_RUN=0 run_prepare 'port/clean'
load_result
assert_eq "$status" uptodate "uptodate status"
assert_eq "$head" "$(cat "$ROOT/v11-sha")" "uptodate head"
assert_eq "$(build_sha)" "$(cat "$ROOT/v11-sha")" "uptodate remote"
[[ -z "$(git -C "$ROOT/work" branch --list fork-follow-rebuild)" ]] || die "uptodate left a rebuild branch"

echo "case fast-forward"
set_build "$(cat "$ROOT/v10-sha")"
reset_work
DRY_RUN=0 run_prepare '  port/clean  '
load_result
assert_eq "$status" rebuilt "ff status"
[[ -f "$ROOT/work/extra.txt" ]] || die "ff did not apply the feature"
run_publish
assert_eq "$(build_sha)" "$head" "ff remote head"
git -C "$ROOT/origin.git" show-ref --verify --quiet "$(backup_ref)" && die "ff created a backup" || true

echo "case force with backup"
set_build "$(cat "$ROOT/old-pin-sha")"
reset_work
DRY_RUN=0 run_prepare port/clean
load_result
assert_eq "$status" rebuilt "force status"
old=$old_head
run_publish
assert_eq "$(build_sha)" "$head" "force remote head"
assert_eq "$(git -C "$ROOT/origin.git" rev-parse "$(backup_ref)")" "$old" "backup sha"
if git -C "$ROOT/work" cat-file -e "HEAD:old.txt" 2>/dev/null; then
  git -C "$ROOT/work" ls-tree -r --name-only HEAD >&2
  die "rebuild kept the old pin"
fi

echo "case backup name taken"
set_build "$(cat "$ROOT/old-pin-sha")"
reset_work
git -C "$ROOT/origin.git" update-ref "$(backup_ref)" "$(cat "$ROOT/v10-sha")"
DRY_RUN=0 run_prepare port/clean
load_result
GITHUB_RUN_ID=99 run_publish
suffixed="$(backup_ref)-99"
assert_eq "$(git -C "$ROOT/origin.git" rev-parse "$suffixed")" "$old_head" "suffixed backup"
assert_eq "$(git -C "$ROOT/origin.git" rev-parse "$(backup_ref)")" "$(cat "$ROOT/v10-sha")" "original backup untouched"
git -C "$ROOT/origin.git" update-ref -d "$(backup_ref)"
git -C "$ROOT/origin.git" update-ref -d "$suffixed"

echo "case lease"
set_build "$(cat "$ROOT/old-pin-sha")"
reset_work
DRY_RUN=0 run_prepare port/clean
load_result
set_build "$(cat "$ROOT/v10-sha")"
if run_publish; then
  die "lease publish should have failed"
fi
assert_eq "$(build_sha)" "$(cat "$ROOT/v10-sha")" "lease left the moved branch"
git -C "$ROOT/origin.git" show-ref --verify --quiet "$(backup_ref)" && die "lease pushed a backup" || true

echo "case conflict"
set_build "$(cat "$ROOT/old-pin-sha")"
reset_work
before=$(build_sha)
DRY_RUN=0 run_prepare port/conflict port/clean
load_result
assert_eq "$status" conflict "conflict status"
assert_eq "$failed_branch" port/conflict "conflict branch"
assert_eq "$conflict_kind" merge "conflict kind"
grep -qx file.txt "$files" || die "conflict file list missing file.txt"
assert_eq "$(build_sha)" "$before" "conflict moved the build branch"
[[ "$(git -C "$ROOT/work" branch --show-current)" == "master" ]] || die "conflict did not return to master"
[[ -z "$(git -C "$ROOT/work" branch --list fork-follow-rebuild)" ]] || die "conflict left the rebuild branch"
if DRY_RUN=0 run_publish; then
  die "publish after conflict should have failed"
fi
assert_eq "$(build_sha)" "$before" "publish after conflict moved the branch"

echo "case dry-run conflict"
reset_work
before=$(build_sha)
DRY_RUN=1 run_prepare port/conflict
load_result
assert_eq "$status" conflict "dry-run status"
assert_eq "$dry_run" 1 "dry-run flag"
assert_eq "$(build_sha)" "$before" "dry-run moved the build branch"
if DRY_RUN=1 run_publish; then
  die "dry-run publish should have failed"
fi
assert_eq "$(build_sha)" "$before" "dry-run publish moved the branch"

echo "case cherry-pick stays on the release"
reset_work
before=$(build_sha)
DRY_RUN=0 run_prepare feat/later
load_result
assert_eq "$status" rebuilt "cherry-pick status"
assert_eq "$(git -C "$ROOT/work" show HEAD:file.txt)" 'version 1.1' "cherry-pick dragged master in"
assert_eq "$(git -C "$ROOT/work" show HEAD:only-fork.txt)" 'fork only' "cherry-pick dropped the fork commit"
git -C "$ROOT/work" merge-base --is-ancestor "$(cat "$ROOT/after-sha")" HEAD \
  && die "upstream master after the release is in the rebuild" || true
assert_eq "$(build_sha)" "$before" "cherry-pick pushed"

echo "case empty cherry-pick"
reset_work
DRY_RUN=0 run_prepare feat/empty
load_result
assert_eq "$status" rebuilt "empty status"
assert_eq "$(git -C "$ROOT/work" rev-parse HEAD^{tree})" "$(git -C "$ROOT/work" rev-parse v1.1.0^{tree})" "empty changed the tree"

expect_refuse() {
  local log rc=0
  set +e
  log=$(run_publish 2>&1)
  rc=$?
  set -e
  [[ $rc -ne 0 ]] || die "$1: publish succeeded"
  printf '%s\n' "$log" | grep -q "refusing to push" || die "$1: $log"
  if git -C "$ROOT/blocked.git" show-ref | grep -v ' HEAD$' | grep -q .; then
    die "$1: publish reached a remote"
  fi
}

echo "case refuse upstream"
reset_work
set_build "$(cat "$ROOT/old-pin-sha")"
DRY_RUN=0 run_prepare port/clean
load_result
git -C "$ROOT/work" remote set-url origin https://github.com/super-productivity/super-productivity.git
git -C "$ROOT/work" config --local url."$ROOT/blocked.git".insteadOf \
  "https://github.com/super-productivity/super-productivity.git"
expect_refuse "upstream"
git -C "$ROOT/work" remote set-url origin "$ROOT/origin.git"
git -C "$ROOT/work" config --local --unset url."$ROOT/blocked.git".insteadOf

echo "case refuse other github origin"
git -C "$ROOT/work" remote set-url origin https://github.com/other/super-productivity.git
git -C "$ROOT/work" config --local url."$ROOT/blocked.git".insteadOf \
  "https://github.com/other/super-productivity.git"
expect_refuse "other origin"

echo "all fork-follow cases passed"
