# Integration Plan

## Architecture

DeepSeek Harness remains the system of record for agent execution, append-only session history, replay, tool authorization, persistence, and plugin composition. External projects provide optional capabilities behind explicit adapters.

## Phase 0: Gateway reliability

Investigate and test the free-model gateway path that emits `This turn failed` with `{"type":"api_error","message":"Upstream error."}`. Preserve provider, route, HTTP status, stable code, request id, original message, and retryability when available. Redact credentials and bound raw diagnostics. Do not enable memory injection by default until this path is observable and retry behavior is classified.

## Phase 1: TencentDB Agent Memory

Run the TencentDB Memory Core, Memory Hub, and Proxy stack separately. Configure an opt-in DSH profile with the `/dsh/<spaceId>` OpenAI-compatible proxy URL and a credential-store reference for the proxy user key. Validate session initialization, team/agent/task binding, injected memory, streaming, tools, compaction, title requests, retry, and gateway error propagation. Keep direct DSH provider routing as the rollback path.

The proxy is an operational experiment, not a replacement for DSH session persistence. Any external context that reaches a model must have a defined DSH replay representation before it becomes a permanent integration.

## Phase 2: DSH-native memory capability

Define an experimental `ctx.memory` Service Definition with bounded `search`, `store`, and optional `commit` operations. Results carry branded ids, explicit scopes, sources, citations, and bounded content. Recall observations are durable session events before later model use. Authorization covers user, workspace, team, agent, and task. Provider failures remain typed failures and never silently become an empty result.

## Phase 3: Native providers

Implement TencentDB and OpenViking adapters behind `ctx.memory`. Map TencentDB Chat Memory, Skill, Wiki, and CodeGraph to typed resource kinds. Map OpenViking `viking://` resources and L0/L1/L2 reads to opaque resource ids and explicit depth operations. Run OpenViking as a separate AGPLv3 service; do not vendor it into the DSH MIT distribution.

## Phase 4: Ruflo patterns

Use existing DSH `ctx.subagents`, `ctx.agentTeams`, `ctx.workflowEngine`, and `ctx.jobs`. Adopt declarative roles, task DAG dependencies, coordinator reports, bounded fan-out, budgets, retries, and review stages. Validate the plan with [`integrations/ruflo-dsh-plan.py`](../integrations/ruflo-dsh-plan.py) before handing work to DSH; the validator does not execute tasks or own state. Do not embed Ruflo's scheduler, hook runtime, or competing persistence.

## Exit Criteria

Each phase needs a runnable smoke path, bounded and redacted diagnostics, failure tests, and an audit entry. An integration is not considered complete when it only changes prompt text without replay, authorization, and lifecycle evidence.
