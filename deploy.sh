#!/usr/bin/env bash
# Deploy the root Wasmer package and/or game apps with remote builds.
#
#   ./deploy.sh                 # everything: every game dir, then the superapp
#   ./deploy.sh super           # superapp only (repo root)
#   ./deploy.sh achtung [...]   # one or more game directories
#   ./deploy.sh ring-rumble     # the 3D arena fighter
#   ./deploy.sh ring-rumble super # publish the fighter and its index card
#
# Each target is a directory with an app.yaml. Owner comes from app.yaml;
# override with OWNER=<namespace>. Set NO_WAIT=1 to skip waiting for rollout.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
MIN_FILES=${MIN_FILES:-3}

die() { echo "error: $*" >&2; exit 1; }

command -v wasmer >/dev/null || die "wasmer CLI not found (curl https://get.wasmer.io -sSfL | sh)"
command -v node >/dev/null || die "Node.js is required to update the game registry URLs"
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

app_url() {
  (cd "$1" && wasmer app get -f json) | node --input-type=module -e '
    import fs from "node:fs";
    const app = JSON.parse(fs.readFileSync(0, "utf8"));
    if (typeof app.url !== "string" || !app.url) throw new Error("Wasmer returned no app URL");
    console.log(app.url);
  '
}

sync_catalog() {
  local pending slug url
  pending=$(node "$ROOT/scripts/register-game.mjs" "$ROOT" --pending)
  while IFS= read -r slug; do
    [ -n "$slug" ] || continue
    url=$(app_url "$ROOT/$slug") || die "$slug: cannot resolve its URL; deploy the game before the superapp"
    node "$ROOT/scripts/register-game.mjs" "$ROOT" "$slug" "$url"
  done <<< "$pending"
}

check_root_package() {
  local package_dir
  package_dir=$(mktemp -d)
  if ! wasmer package build "$ROOT" -o "$package_dir/root.webc"; then
    rm -rf "$package_dir"
    die "super: local package build failed before upload"
  fi
  if ! node --input-type=module - "$package_dir/root.webc" <<'NODE'
import fs from 'node:fs';
const mib = fs.statSync(process.argv[2]).size / 1024 / 1024;
console.log(`super: package size ${mib.toFixed(1)} MiB`);
if (mib > 64) {
  console.error('Root package exceeds 64 MiB. Check the Pi exclusions in automation/daily-game/.wasmerignore.');
  process.exitCode = 1;
}
NODE
  then
    rm -rf "$package_dir"
    die "super: package size check failed before upload"
  fi
  rm -rf "$package_dir"
}

deploy_dir() {
  local name=$1 dir=$2
  [ -f "$dir/app.yaml" ] || die "$dir has no app.yaml"
  echo
  echo "==> $name ($dir)"
  local args=(--non-interactive)
  if [ -f "$dir/wasmer.toml" ]; then
    if [ "$name" = super ]; then
      command -v npm >/dev/null || die "npm is required to prepare Pi for the root package"
      npm ci --prefix "$ROOT/automation/daily-game/pi" --ignore-scripts --no-bin-links --no-audit --no-fund
      npm run --prefix "$ROOT/automation/daily-game/pi" prepare:wasmer
      check_root_package
    fi
  else
    args+=(--build-remote)
  fi
  [ -n "${OWNER:-}" ] && args+=(--owner "$OWNER")
  [ -n "${NO_WAIT:-}" ] && args+=(--no-wait)
  local log attempt
  log=$(mktemp)
  for attempt in 1 2 3; do
    echo "$name: deploy attempt $attempt/3"
    if (cd "$dir" && wasmer deploy "${args[@]}") 2>&1 | tee "$log"; then
      break
    fi
    if [ "$attempt" -eq 3 ] || ! grep -Eq 'Server returned (502|503|504)' "$log"; then
      echo "$name: failure log saved to $log" >&2
      die "$name: deploy failed"
    fi
    echo "$name: temporary gateway error; retrying in $((attempt * 5)) seconds" >&2
    sleep "$((attempt * 5))"
  done
  local files
  files=$(tr '\r' '\n' < "$log" | sed -n 's/.*Packaging project directory (\([0-9]*\) files.*/\1/p' | head -1)
  rm -f "$log"
  if [ -f "$dir/wasmer.toml" ]; then
    echo "$name: deployed the local Wasmer package"
  elif [ -z "$files" ]; then
    echo "warning: $name: no 'Packaging project directory' line found" >&2
  elif [ "$files" -lt "$MIN_FILES" ]; then
    die "$name: only $files file(s) were packaged; the upload is empty (wrong working directory?)"
  fi
  local url
  url=$(app_url "$dir") || die "$name: cannot read the deployed URL from Wasmer"
  if [ -n "$url" ]; then
    local probe=/healthz
    [ "$name" = super ] && probe=/games.json
    local code
    code=$(curl -s -o /dev/null -w '%{http_code}' "$url$probe" || true)
    echo "$name: $url$probe -> HTTP $code"
    [ "$code" = 200 ] || echo "warning: $name: expected 200 from $probe" >&2
    if [ "$name" != super ]; then
      node "$ROOT/scripts/register-game.mjs" "$ROOT" "$name" "$url"
    fi
  fi
}

for t in "${targets[@]}"; do
  case "$t" in
    super|root|.) sync_catalog; deploy_dir super "$ROOT" ;;
    *) deploy_dir "$t" "$ROOT/$t" ;;
  esac
done

echo
echo "done: ${targets[*]}"
