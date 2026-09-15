# Agent Note: Integrate external memory and orchestration projects

Status: proposed

English | [中文](2026-08-26-three-project-integration-plan.zh.md)

## Problem

OpenViking, TencentDB-Agent-Memory, and Ruflo each provide useful agent infrastructure, but they overlap different parts of DeepSeek Harness. Directly embedding all three would create competing session storage, memory injection, agent lifecycle, task orchestration, and tool registries. It would also make model-visible context non-replayable if external memory were injected outside the DSH session log.

The three projects have different integration costs. TencentDB-Agent-Memory exposes an OpenAI-compatible Memory Proxy and documents a DeepSeek Harness client path. OpenViking is a separate Python context database using `viking://` resources and AGPLv3 licensing. Ruflo is a complete meta-harness whose swarm, workflow, memory, and hook runtime overlaps DSH's existing `ctx.subagents`, `ctx.agentTeams`, `ctx.workflowEngine`, `ctx.jobs`, and session persistence.

## Proposal

Integrate the projects in layers, preserving DSH as the owner of the agent loop, session log, tool authorization, persistence, and plugin composition.

### Priority 0: Gateway error transparency

Treat every occurrence of `This turn failed` with `{"type":"api_error","message":"Upstream error."}` from the free-model route as a release-blocking reliability issue. Trace and test this path before enabling any external memory injection. The gateway must preserve bounded, redacted provider facts, classify retryability, and keep the failure visible in the DSH session log and UI. Memory integration must not obscure which component failed.

### Phase 1: TencentDB proxy validation

Use TencentDB Agent Memory as an external service, not a DSH persistence replacement. Run its `memory-core`, `memory-hub`, and `proxy` stack with separate memory and proxy LLM configuration. Point a non-production DSH profile's `llm-deepseek.baseURL` at `/dsh/<spaceId>` and store the proxy `user_key` through DSH credentials. Validate session initialization, team/agent/task binding, memory injection, compaction bypass, title requests, tool calls, streaming, retry behavior, and gateway error preservation. Keep this profile opt-in and keep the direct upstream provider configuration available for rollback.

The proxy is an operational compatibility layer. DSH remains responsible for its local durable session log and replay. Proxy-injected context is accepted only after the integration test proves how it is represented in the request and whether it can be reconstructed for replay; hidden, unlogged model-visible state is not an acceptable permanent integration.

### Phase 2: DSH memory capability

Define an experimental `ctx.memory` Service Definition with bounded `search`, `store`, and optional `commit` operations. Add a local provider backed by the existing session-query and domain storage facilities. Add a model-facing consumer only for explicit memory operations; every returned memory item carries an id, scope, source, and bounded content. Results are recorded as durable session events before they affect a later model request. Authorization scopes memory by user, workspace, team, agent, and task; provider failures never silently become empty memory.

This seam is the stable DSH integration point. TencentDB and OpenViking adapters implement it later without importing their runtime into the agent loop. A future Web projection can show memory citations and commit status from session events.

### Phase 3: TencentDB native adapter

Implement a provider for the DSH memory seam using TencentDB Agent Memory's Memory Core or SDK API rather than relying on prompt rewriting in the proxy. Map Chat Memory, Skill, Wiki, and CodeGraph into separate typed resource kinds. Keep team/agent/task scope explicit. Use bounded, cited recall results and append the recall observation to the DSH log. Treat remote commit as asynchronous derived state with retry and visible failure, never as the source of DSH session truth.

### Phase 4: OpenViking adapter

Implement OpenViking as an optional remote context provider behind the same memory/resource seam. Map `viking://` URIs to opaque branded resource ids and expose tiered L0/L1/L2 reads explicitly. Preserve retrieval trajectories as bounded logged observations. Do not vendor or link OpenViking into DSH's MIT distribution because the upstream project is AGPLv3; run it as a separately deployed service and communicate through its supported client/API protocol.

### Phase 5: Ruflo patterns on DSH primitives

Do not embed Ruflo's scheduler or agent runtime. Adopt only useful patterns as DSH features: declarative role presets, explicit task DAG dependencies, coordinator reports, bounded fan-out, cost budgets, retries, and review stages. Implement them over `ctx.agentTeams`, `ctx.subagents`, `ctx.workflowEngine`, `ctx.jobs`, and existing durable Team task events. Promote the experimental Agent Teams package only after the Web controls, multi-process stance, and authorization requirements are resolved.

## Alternatives considered

- **Embed all three runtimes in one bundle.** Rejected because it duplicates lifecycle, persistence, memory injection, and orchestration ownership and creates unclear failure semantics.

- **Use the TencentDB proxy as the permanent DSH memory integration.** Rejected because prompt rewriting at an external proxy cannot by itself satisfy DSH replay and model-visible logging rules; it remains a useful first operational validation path.

- **Use OpenViking as DSH's session database.** Rejected because DSH's append-only session log owns replay, fork, UI fidelity, and durable model history; OpenViking is a context database, not a drop-in session persistence provider.

- **Replace DSH Agent Teams with Ruflo swarm.** Rejected because DSH already owns continuable child lifecycle, direct-parent authorization, durable mailbox, and task DAG semantics. Ruflo patterns can be adopted without a second runtime.

- **Vendor OpenViking source.** Rejected because its AGPLv3 license and Python service runtime do not fit the current DSH package and distribution boundaries.

## Consequences

TencentDB is the first practical experiment because it documents a DSH-compatible proxy path and can be evaluated without changing DSH source. The first profile is dependent on an external service and therefore is not the default deployment. The DSH-native memory seam costs a new experimental package, event vocabulary, authorization model, provider contract, and replay coverage, but it prevents future integrations from bypassing DSH's core invariants.

OpenViking and TencentDB become replaceable providers rather than competing products inside the harness. Ruflo contributes orchestration recipes and evaluation criteria, while DSH retains one agent loop, one session log, one tool pipeline, and one authority model.

Runtime validation requires Node.js, pnpm, and Docker or equivalent service deployment. The current development environment lacks these executables, so stack startup, DSH build, and integration tests remain pending until the toolchain is restored.
