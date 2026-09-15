# Agent Note: Risk-based cross-review policy

Status: implemented

## Problem

DSH provides independent subagents, pairwise verification, approval, and tool guards as separate opt-in capabilities. No runtime policy requires a second position before a configured risky action, and no durable record distinguishes reviewed work from an executor's own claim.

## Decision

The private `@deepseek-ai/dsh-experimental-cross-review` plugin composes those capabilities for explicitly configured tool names. It starts a one-shot reviewer with a distinct model, persona, structured verdict, and restricted tool allow-list. It appends `cross-review/evaluated` to the owning Session log and uses a monotonic `tools.guard()` to deny every configured risky call without a durable `approved` record. Reviewer unavailability is fail-closed by default.

The plugin is opt-in and does not alter the agent loop or shipped base bundle. The private `@deepseek-ai/dsh-experimental-cross-review-bundle` supplies a Cordis patch for explicit deployment composition, but no shipped default mounts it. Unknown tools are not inferred as risky. The reviewer verdict remains advisory evidence; deterministic checks and human approval remain responsible for rollout decisions.

## Alternatives considered

**Require review for every tool call.** Rejected because it adds latency and cost to ordinary read-only work and cannot replace risk-specific deterministic checks.

**Put the rule in prompts or the Web UI.** Rejected because direct executor callers and alternate transports could bypass a presentation-only rule.

**Use `verify_pair` as the gate.** Rejected because its result is a probabilistic preference and it does not provide independent task execution or durable review state.

**Use a local unrestricted model for all security review.** Rejected because it changes the data and safety threat model without supplying a correctness authority.

## Consequences

Configured write and production-adjacent actions incur one independent reviewer run and can remain blocked during reviewer outages. The event is replayable with the Session log, while the package remains private until an audited human override, risk inference, and assembled application composition are added.
