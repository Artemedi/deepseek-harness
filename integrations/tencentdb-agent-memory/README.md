# TencentDB Agent Memory Integration

English | [中文](README.zh.md)

## Prerequisites

- Node.js environment with npm
- Local MemoryCore runtime installed and pinned (operator-installed, commit-pinned checkout; upstream publishes no standalone Gateway executable)
- SQLite data directory path accessible
- OpenAI-compatible LLM for MemoryCore extraction (local or remote; DSH forwards LLM config to MemoryCore via environment variables)
- For numeric loopback (`http://127.0.0.1:8420`): no separate memory API key — DSH sends the non-secret bearer shape required by the upstream v3 parser
- For non-loopback Gateway: a DSH credential containing the Gateway bearer secret, referenced via `credentialRef`
- For every Gateway: `baseUrl` must be a bare HTTP(S) origin; userinfo, paths, queries, and fragments are rejected

## Managed and external modes

- **Managed mode**: DSH starts and owns a local MemoryCore process via `tencentdbRuntime` in `memory.cordis.yml.example`. It waits for the local-host subprocess provider, launches in the configured `cwd` with explicit LLM credential forwarding, rejects non-loopback endpoints and early process exits, requires the exact `{ "status": "ok" }` health envelope before activation, and terminates the complete process tree on unload or HMR.
- **External mode**: DSH talks to an already running Gateway via `tencentdb.baseUrl` in `memory.cordis.yml.example`. DSH does not start or stop the Gateway process.

## Loopback and non-loopback auth

- Numeric loopback (for example, `http://127.0.0.1:8420`) does not require a separate memory API key. DSH sends the non-secret bearer shape required by the upstream v3 parser.
- Non-loopback Gateway requires a non-empty `credentialRef` in `tencentdb`; DSH sends the resolved non-empty secret as the request bearer token. Operators of an external Gateway configure its matching server-side secret. In managed mode, DSH also forwards the resolved secret as `TDAI_GATEWAY_API_KEY` when `credentialRef` is set.

## Step 1: Configure MemoryCore

Create a `memory.cordis.yml.example` file in the `integrations/tencentdb-agent-memory` directory with the following configuration:

Under `tencentdb` (required):

- `baseUrl`: `http://127.0.0.1:8420`
- `serviceId`: `default`
- `isolationBindings`: one or more exact mappings from an absolute DSH workspace and effective agent preset to provisioned TencentDB `teamId`, `agentId`, and `userId`; omit `agentPreset` only for sessions composed without a preset
- `credentialRef`: omitted for loopback; set to a DSH credential reference for non-loopback

Under `tencentdbRuntime` (managed mode only):

- `command`: `node`
- `args`: `[--import, tsx, src/gateway/server.ts]`
- `cwd`: `/absolute/path/to/TencentDB-Agent-Memory/MemoryCore`
- `dataDir`: `/absolute/path/to/local/tdai-memory`
- `gatewayConfig`: `tdai-gateway.standalone.yaml`
- `llmCredentialRef`: `DEEPSEEK_API_KEY` (placeholder)
- `llmBaseUrl`: `https://api.deepseek.com/v1` (or local LLM URL)
- `llmModel`: `deepseek-chat` (or local model name)

Ensure the data directory exists and is writable.

## Step 2: Configure the LLM for MemoryCore

MemoryCore performs extraction and requires an OpenAI-compatible LLM. Set `llmBaseUrl`, `llmModel`, and an existing DSH `llmCredentialRef` in `tencentdbRuntime`; DSH fails startup when the reference cannot be resolved. A local endpoint may ignore the forwarded `TDAI_LLM_API_KEY`, but the configured credential reference must still resolve.

## Step 3: Start the composition

In managed mode, start DSH with the composition containing `tencentdbRuntime`. DSH launches the MemoryCore subprocess, waits for readiness, and binds the process tree to the plugin fiber. In external mode, start the Gateway yourself and DSH connects to `tencentdb.baseUrl`.

## Step 4: Run smoke test

Run `pnpm smoke:tencentdb-memory`. The script accepts the following environment variables:

- `TDAI_MEMORY_ENDPOINT`: `http://127.0.0.1:8420`
- `TDAI_MEMORY_API_KEY`: `dsh-local-loopback`
- `TDAI_MEMORY_INSTANCE_ID`: `default`
- `TDAI_MEMORY_TEAM_ID`: `dsh-smoke`
- `TDAI_MEMORY_AGENT_ID`: `dsh`
- `TDAI_MEMORY_USER_ID`: `local-user`

The script outputs a JSON object with `health`, `capture`, `l1SearchEnvelope`, `l2ListEnvelope`, `l3ReadEnvelope`, and `cleanup` sections marked `"ok"`. The `l0Count` is always 2 (smoke sends two messages). `l1Count`, `l2Count`, and `l3Present` depend on MemoryCore data and are not deterministic.

## Step 5: Troubleshooting

- **Health check failure**: Ensure the MemoryCore process is running, check logs, verify the health endpoint URL and port.
- **Capture failure**: Verify that both user and assistant messages are sent, check that the session ID matches, ensure the bearer token is correct.
- **L0 message acceptance failure**: Confirm that two messages (user and assistant) are sent and accepted, check that the session ID is unique.
- **L1 search failure**: Verify the query string, ensure the limit is not exceeded, check that the search endpoint returns items.
- **L2 list failure**: Verify that scenario data is accessible, check that entries are returned, ensure the list endpoint is reachable.
- **L3 read failure**: Ensure the content is a string, check that the core read endpoint returns valid data, verify the content length.
- **Cleanup failure**: Confirm that the conversation deletion request succeeds, check that the session is removed from the session store.
- **General**: Verify that the SQLite data directory contains the expected files, check that environment variables are set correctly, and ensure no secret values are hardcoded.
- **Oversized or redirected response**: DSH streams responses under its configured byte budget, cancels an overflowing body immediately, and rejects redirects. Check the Gateway response size and direct endpoint URL.

## Component ports

- Port **8420**: MemoryCore Gateway (`smoke.mjs`, `memory.cordis.yml.example` `tencentdb.baseUrl`)
- Port **8096**: DSH LLM proxy route (`dsh-settings.yaml.example`, `probe.py`)

These are different components. The MemoryCore gateway exposes `/v3/*` endpoints; the DSH proxy exposes OpenAI-compatible `/chat/completions`.
