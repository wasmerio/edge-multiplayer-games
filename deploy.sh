#!/usr/bin/env bash
# Deploy the superapp and/or games to Wasmer Edge with a remote build.
#
#   ./deploy.sh                 # everything: every game dir, then the superapp
#   ./deploy.sh super           # superapp only (repo root)
#   ./deploy.sh achtung [...]   # one or more game directories
#
# Each target is a directory with an app.yaml. Owner comes from app.yaml;
# override with OWNER=<namespace>. Set NO_WAIT=1 to skip waiting for rollout.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
MIN_FILES=${MIN_FILES:-3}

die() { echo "error: $*" >&2; exit 1; }

command -v wasmer >/dev/null || die "wasmer CLI not found (curl https://get.wasmer.io -sSfL | sh)"
who=$(wasmer whoami 2>&1) || die "not logged in: run 'wasmer login'"
case "$who" in
  *"registry wasmer.io"*) ;;
  *) die "unexpected registry: $who (expected wasmer.io; check WASMER_REGISTRY and 'wasmer config get registry.url')" ;;
esac
echo "$who"

targets=()
if [ $# -eq 0 ]; then
  for d in "$ROOT"/*/; do
    [ -f "$d/app.yaml" ] && [ -f "$d/package.json" ] && targets+=("$(basename "$d")")
  done
  targets+=(super)
else
  targets=("$@")
fi

deploy_dir() {
  local name=$1 dir=$2
  [ -f "$dir/app.yaml" ] || die "$dir has no app.yaml"
  echo
  echo "==> $name ($dir)"
  local args=(--build-remote --non-interactive)
  [ -n "${OWNER:-}" ] && args+=(--owner "$OWNER")
  [ -n "${NO_WAIT:-}" ] && args+=(--no-wait)
  local log
  log=$(mktemp)
  # tee keeps the live output; the log is parsed afterwards
  (cd "$dir" && wasmer deploy "${args[@]}") 2>&1 | tee "$log"
  local status=${PIPESTATUS[0]}
  local files
  files=$(tr '\r' '\n' < "$log" | sed -n 's/.*Packaging project directory (\([0-9]*\) files.*/\1/p' | head -1)
  rm -f "$log"
  [ "$status" -eq 0 ] || die "$name: deploy failed"
  if [ -z "$files" ]; then
    echo "warning: $name: no 'Packaging project directory' line found" >&2
  elif [ "$files" -lt "$MIN_FILES" ]; then
    die "$name: only $files file(s) were packaged; the upload is empty (wrong working directory?)"
  fi
  local url
  url=$(cd "$dir" && wasmer app get -f json 2>/dev/null | sed -n 's/.*"url": *"\([^"]*\)".*/\1/p' | head -1)
  if [ -n "$url" ]; then
    local probe=/healthz
    [ "$name" = super ] && probe=/games.json
    local code
    code=$(curl -s -o /dev/null -w '%{http_code}' "$url$probe" || true)
    echo "$name: $url$probe -> HTTP $code"
    [ "$code" = 200 ] || echo "warning: $name: expected 200 from $probe" >&2
  fi
}

for t in "${targets[@]}"; do
  case "$t" in
    super|root|.) deploy_dir super "$ROOT" ;;
    *) deploy_dir "$t" "$ROOT/$t" ;;
  esac
done

echo
echo "done: ${targets[*]}"
