#!/usr/bin/env bash
# Run TencentDB Agent Memory as an opt-in Podman integration.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"
PODMAN="${PODMAN:-podman}"

usage() {
  echo "Usage: $0 validate|start|status|stop|logs" >&2
  exit 2
}

[[ $# -eq 1 ]] || usage
command -v "$PODMAN" >/dev/null || { echo "podman is required" >&2; exit 1; }

if [[ "$1" != "status" && "$1" != "stop" && "$1" != "logs" ]]; then
  [[ -f "$ENV_FILE" ]] || { echo "Missing $ENV_FILE. Copy .env.example and supply local credentials." >&2; exit 1; }
fi

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

require_var() {
  local name="$1" value="${!1:-}"
  [[ -n "$value" && "$value" != "REPLACE_ME" ]] || { echo "Missing required $name in $ENV_FILE" >&2; return 1; }
}

require_digest() {
  local name="$1" value="${!1:-}"
  require_var "$name" || return 1
  [[ "$value" == *@sha256:* ]] || { echo "$name must pin an immutable @sha256 digest" >&2; return 1; }
}

validate() {
  local missing=0
  for name in MEMORY_LLM_BASE_URL MEMORY_LLM_API_KEY MEMORY_LLM_MODEL PROXY_UPSTREAM_URL PROXY_UPSTREAM_API_KEY PROXY_UPSTREAM_MODEL; do
    require_var "$name" || missing=1
  done
  for name in TDAI_CORE_IMAGE TDAI_HUB_IMAGE TDAI_PROXY_IMAGE; do
    require_digest "$name" || missing=1
  done
  [[ "$missing" == 0 ]] || return 1
  echo "TencentDB configuration is complete. Images are digest-pinned; no credentials were printed."
}

ensure_network() {
  "$PODMAN" network exists "$TDAI_NETWORK" || "$PODMAN" network create "$TDAI_NETWORK" >/dev/null
}

remove_container() {
  "$PODMAN" rm -f "$1" >/dev/null 2>&1 || true
}

wait_for_http() {
  local url="$1" name="$2"
  for _ in $(seq 1 60); do
    if curl --fail --silent --show-error --max-time 2 "$url" >/dev/null 2>&1; then
      echo "$name is reachable at $url"
      return 0
    fi
    sleep 2
  done
  "$PODMAN" logs --tail 80 "$name" >&2 || true
  echo "$name did not become reachable" >&2
  return 1
}

write_configs() {
  umask 077
  mkdir -p "$ROOT/runtime/core" "$ROOT/runtime/proxy"
  cat > "$ROOT/runtime/core/tdai-gateway.yaml" <<EOF
deployMode: standalone
stateBackend: local
server: { host: 0.0.0.0, port: 8420 }
data: { baseDir: /data/tdai-memory }
llm:
  baseUrl: "${MEMORY_LLM_BASE_URL}"
  apiKey: "${MEMORY_LLM_API_KEY}"
  model: "${MEMORY_LLM_MODEL}"
memory:
  capture: { enabled: true }
  extraction: { enabled: true }
  recall: { enabled: true, maxResults: 5, strategy: hybrid }
  storeBackend: sqlite
  embedding: { provider: none }
skill:
  enabled: true
EOF
  cat > "$ROOT/runtime/proxy/config.yaml" <<EOF
server: { host: 0.0.0.0, port: 8096, forwardTimeoutMs: 600000 }
upstream:
  url: "${PROXY_UPSTREAM_URL}"
  apiKey: "${PROXY_UPSTREAM_API_KEY}"
log: { file: "", level: info, backend: console }
tdai:
  enabled: true
  endpoint: "http://memory-core:8420"
  serviceId: default
  # DSH-native memory retrieval must remain explicit and log citations before
  # model use; proxy-side context injection would be unreplayable hidden state.
  memory: { enabled: true, inject: false, writeL0: true, recallL1: true, injectL2L3: false }
auth: { enabled: false }
sessionInit: { enabled: false }
injection: { enabled: false }
redis: { enabled: false }
EOF
}

start() {
  validate
  ensure_network
  write_configs
  "$PODMAN" pull "$TDAI_CORE_IMAGE"
  "$PODMAN" pull "$TDAI_HUB_IMAGE"
  "$PODMAN" pull "$TDAI_PROXY_IMAGE"
  remove_container "$TDAI_CORE_CONTAINER"
  remove_container "$TDAI_HUB_CONTAINER"
  remove_container "$TDAI_PROXY_CONTAINER"

  "$PODMAN" run -d --name "$TDAI_CORE_CONTAINER" --network "$TDAI_NETWORK" --network-alias memory-core \
    -p "$TDAI_CORE_PORT:8420" -v "$TDAI_CORE_VOLUME:/data/tdai-memory" \
    -v "$ROOT/runtime/core/tdai-gateway.yaml:/data/config/tdai-gateway.yaml:ro" \
    -e TDAI_GATEWAY_PORT=8420 -e TDAI_GATEWAY_HOST=0.0.0.0 -e TDAI_DATA_DIR=/data/tdai-memory \
    "$TDAI_CORE_IMAGE" >/dev/null
  wait_for_http "http://127.0.0.1:$TDAI_CORE_PORT/health" "$TDAI_CORE_CONTAINER"

  "$PODMAN" run -d --name "$TDAI_HUB_CONTAINER" --network "$TDAI_NETWORK" --network-alias memory-hub \
    -p "$TDAI_PANEL_PORT:8125" -p "$TDAI_KNOWLEDGE_PORT:8424" -v "$TDAI_HUB_VOLUME:/data/knowledge" \
    -e PANEL_PORT=8125 -e KNOWLEDGE_PORT=8424 -e REMOTE_INSTANCE_ID=default -e REMOTE_INSTANCE_NAME=default \
    -e REMOTE_INSTANCE_URL=http://memory-core:8420 -e LLM_MODE=custom -e LLM_PROTOCOL="$MEMORY_LLM_PROTOCOL" \
    -e LLM_API_KEY="$MEMORY_LLM_API_KEY" -e LLM_BASE_URL="$MEMORY_LLM_BASE_URL" -e LLM_MODEL="$MEMORY_LLM_MODEL" \
    "$TDAI_HUB_IMAGE" >/dev/null
  wait_for_http "http://127.0.0.1:$TDAI_PANEL_PORT/" "$TDAI_HUB_CONTAINER"

  "$PODMAN" run -d --name "$TDAI_PROXY_CONTAINER" --network "$TDAI_NETWORK" --network-alias proxy \
    -p "$TDAI_PROXY_PORT:8096" -v "$ROOT/runtime/proxy/config.yaml:/data/config.yaml:ro" \
    "$TDAI_PROXY_IMAGE" >/dev/null
  wait_for_http "http://127.0.0.1:$TDAI_PROXY_PORT/health" "$TDAI_PROXY_CONTAINER"
  echo "Proxy route: http://127.0.0.1:$TDAI_PROXY_PORT/dsh/default"
}

status() {
  "$PODMAN" ps -a --filter "name=${TDAI_CORE_CONTAINER:-harness-tdai-core}" --filter "name=${TDAI_HUB_CONTAINER:-harness-tdai-hub}" --filter "name=${TDAI_PROXY_CONTAINER:-harness-tdai-proxy}"
}

stop() {
  remove_container "${TDAI_PROXY_CONTAINER:-harness-tdai-proxy}"
  remove_container "${TDAI_HUB_CONTAINER:-harness-tdai-hub}"
  remove_container "${TDAI_CORE_CONTAINER:-harness-tdai-core}"
}

logs() {
  "$PODMAN" logs --tail 100 "${TDAI_PROXY_CONTAINER:-harness-tdai-proxy}"
}

case "$1" in
  validate) validate ;;
  start) start ;;
  status) status ;;
  stop) stop ;;
  logs) logs ;;
  *) usage ;;
esac
