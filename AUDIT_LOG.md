# Audit Log

Append-only operational record for the Harness Integrations project. Each entry records commands, evidence, failures, and the next action. Never rewrite an earlier entry; add a correction entry when needed.

## 2026-08-26: Project initialized

- **Scope:** OpenViking, TencentDB Agent Memory, and Ruflo integration around DeepSeek Harness.
- **Decision:** Keep DSH as the owner of agent loop, session log, replay, authorization, persistence, and plugin composition.
- **Priority:** P0 gateway error transparency; TencentDB proxy validation; DSH-native memory capability; OpenViking adapter; Ruflo patterns over existing orchestration.
- **Evidence:** TencentDB documents a DSH-compatible OpenAI Chat Completions proxy path. OpenViking is a separate Python AGPLv3 context database. Ruflo overlaps DSH subagents, Agent Teams, workflow, jobs, and memory concerns.
- **Next action:** Run the opt-in TencentDB stack and probe when Docker/Podman compose and LLM credentials are available.

## 2026-08-26: Gateway failure observed

- **Symptom:** `This turn failed` with `{"type":"api_error","message":"Upstream error."}` during a free-model gateway request.
- **Decision:** Treat the incident as a P0 blocker before enabling external memory injection.
- **Required evidence:** Preserve route/provider/status/code/request id/original message/retryability through gateway, API transport, DSH session log, and Web UI without exposing secrets.
- **Next action:** Trace the gateway route and add keyless regression coverage for minimal and structured error envelopes.

## 2026-08-26: Local environment probe

- **Command:** `python3 integrations/tencentdb-agent-memory/probe.py`
- **Result:** `{"check": "health", "status": 0, "classification": "non-json-response"}`; TencentDB proxy was not listening on `127.0.0.1:8096`.
- **Environment:** Host lacked Node.js, pnpm, and Docker. Podman was available. A Node 22 image was available, but the repository pnpm checks stopped before gate execution because the non-TTY workspace install attempted to remove `node_modules`.
- **Next action:** Restore a Node 22/pnpm workspace runner and start TencentDB services with a compose-capable Podman setup.

## 2026-08-26: Opt-in Podman runner added

- **Files:** `integrations/tencentdb-agent-memory/run.sh`, `.env.example`, `README.md`.
- **Behavior:** The runner uses isolated names, ports, volumes, and a network; validates all LLM settings before pulling images or creating containers; supports `validate`, `start`, `status`, `logs`, and `stop`.
- **Security:** Runtime configs and `.env` are ignored and created with owner-only umask. Credentials are passed only to container configuration/environment and are never printed by the runner.
- **Validation:** `bash -n integrations/tencentdb-agent-memory/run.sh` and `python3 -m py_compile integrations/tencentdb-agent-memory/probe.py` passed. Missing `.env` exits before container creation. Placeholder credentials exit before image pulls.
- **Result:** TencentDB images were not present locally and no LLM credentials are available in this environment, so the stack was intentionally not started.
- **Next action:** Provide local LLM credentials, run `./run.sh start`, then execute the proxy probe and record health/chat results.
