# Agent Note: Explicit-model guard and requested-route visibility for subagent delegation

Status: implemented

English | [中文](2026-09-13-explicit-model-guard-for-subagent-delegation.zh.md)

## Problem

`dsh-tool-subagent`'s `spawn`/`fork` routes silently inherit whatever model the parent Agent currently has at the moment a child starts (`agentOptions` absent). A forensic session-log review confirmed this live: a deployment that dedicates a `tool-subagent` instance to a specific cost-controlled route (a free-tier gateway) had no way to make an accidental omission of `agentOptions` fail at load — the child would quietly ride the parent's current, possibly unrelated and possibly expensive, model instead. The only way to learn which route a child actually used was to open its own session log and read `request/header`, because the parent's own transcript recorded nothing but `started subagent <id>`.

## Decision

`tool-subagent.Config` gains `requireExplicitModel?: boolean` (default `false`). When `true`, `apply()` rejects mount unless `agentOptions.provider` and `agentOptions.model` are both non-empty strings — the same "fail loud at the earliest resolvable point" treatment `maxDepth`'s capability check already gets, not a runtime check deferred to the first delegation. The flag targets this tool's own config; it does not inspect provider capabilities, because providers that select their own model independently of `agentOptions` (`claude-code`, `codex`) ignore the field either way and are unaffected by leaving it unset or set.

Separately, every `started subagent <id>` / `started background subagent job <id>` result now appends the requested route as `(provider/model)` when `agentOptions` names both, or a partial `(model: …)` / `(provider: …)` when only one is set. This puts the REQUESTED route directly in the parent's own transcript; the EFFECTIVE route a multi-backend gateway actually served already lives in the child's own `request/header`/`responseModel`, one session away instead of requiring provider/config archaeology to even know what was asked for.

## Alternatives considered

**Add a provider capability (e.g. `SubagentCapabilities.requiresAgentOptions`) instead of a config-only flag.** Rejected for this pass: it would require every current and future in-process provider to declare it, is a larger, cross-package surface change, and the operator already knows which instances are meant to pin a route — a config flag on the row that needs it is the narrower fix. Revisit if a provider-blind footgun (setting the flag on a provider that ignores `agentOptions`) proves costly in practice.

**Put the effective route in the parent transcript too (not just requested).** Rejected: the effective route can differ per request on a gateway that internally load-balances across backends (observed: `dsh-agent` resolving to different upstream models across calls), and copying it into the parent would duplicate data the child's own durable log already owns, for a fact that changes independently of the parent's turn. The child's `request/header`/`responseModel` remains the single source for "what actually served this."

## Consequences

A deployment that sets `requireExplicitModel: true` on a `tool-subagent` row gets a load-time guarantee that this route never silently inherits the parent's model; an omitted `agentOptions` is now a startup error naming the fix, not a quiet cost surprise discovered later in a token bill or a session-log review. Existing instances that rely on inheritance are unaffected — the default is `false`, and the requested-route text addition is empty whenever `agentOptions` is unset, so every prior "started subagent"/"started background subagent job" assertion without `agentOptions` is unchanged.
