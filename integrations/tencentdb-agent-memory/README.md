# TencentDB Agent Memory

This directory runs TencentDB Agent Memory as a local, opt-in Podman stack. It uses separate container names, ports, volumes, and network names so it does not modify an existing TencentDB deployment or the DSH default profile.

## Setup

```bash
cd integrations/tencentdb-agent-memory
cp .env.example .env
$EDITOR .env
./run.sh validate
./run.sh start
```

`validate` refuses missing or placeholder LLM settings, requires all three images to use immutable 64-hex `@sha256:` digests, and prints no secret values. `start` pulls the three TencentDB images, starts memory core, memory hub, and proxy, then waits for each HTTP endpoint. Runtime configs are generated under `runtime/`, which is ignored by Git and created with owner-only permissions.

The local proxy route is:

```text
http://127.0.0.1:18096/dsh/default
```

Probe it without sending model content:

```bash
TDAI_PROXY_BASE_URL=http://127.0.0.1:18096/dsh/default python3 probe.py
```

A chat probe requires both `--check-chat` and a model. It intentionally sends only `ping` and does not print authorization headers or request bodies.

For deterministic gateway-error regression without an LLM key, run the local stub in one terminal and probe it in another:

```bash
python3 stub_gateway.py
TDAI_PROXY_BASE_URL=http://127.0.0.1:18096/dsh/default TDAI_PROXY_MODEL=stub python3 probe.py --check-chat
```

The expected classification is `gateway-upstream-error`, with the stub request id shown separately. The probe also treats an unreachable endpoint as an explicit transport result (`status: 0`) and reads request or correlation ids case-insensitively. The stub never forwards content to a provider.

## DSH Route

Copy the values from `dsh-settings.yaml.example` into a non-default DSH profile or settings scope, replacing the port when needed. Do not replace the default production/free-model route until P0 gateway diagnostics are fixed.

## Operations

```bash
./run.sh status
./run.sh logs
./run.sh stop
```

`stop` preserves named volumes. Remove volumes manually only when intentionally resetting all TencentDB data.
