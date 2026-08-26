#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER="$ROOT/run.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cat > "$TMP/pinned.env" <<'EOF'
MEMORY_LLM_BASE_URL=http://memory.example
MEMORY_LLM_API_KEY=test-memory-key
MEMORY_LLM_MODEL=test-memory
PROXY_UPSTREAM_URL=http://upstream.example
PROXY_UPSTREAM_API_KEY=test-upstream-key
PROXY_UPSTREAM_MODEL=test-upstream
TDAI_CORE_IMAGE=agentmemory/memory-core@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
TDAI_HUB_IMAGE=agentmemory/memory-hub@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
TDAI_PROXY_IMAGE=agentmemory/memory-proxy@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
EOF

output="$(ENV_FILE="$TMP/pinned.env" PODMAN=true "$RUNNER" validate)"
[[ "$output" == *"digest-pinned"* ]]
[[ "$output" != *"test-memory-key"* && "$output" != *"test-upstream-key"* ]]

sed 's#@sha256:[a-f]*#:#' "$TMP/pinned.env" > "$TMP/tag.env"
if ENV_FILE="$TMP/tag.env" PODMAN=true "$RUNNER" validate >"$TMP/out" 2>&1; then
  echo "mutable image tag was accepted" >&2
  exit 1
fi
grep -q '64-hex @sha256 digest' "$TMP/out"

sed 's#aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa#short#' "$TMP/pinned.env" > "$TMP/short.env"
if ENV_FILE="$TMP/short.env" PODMAN=true "$RUNNER" validate >"$TMP/out" 2>&1; then
  echo "short image digest was accepted" >&2
  exit 1
fi

echo "runner digest validation passed"
