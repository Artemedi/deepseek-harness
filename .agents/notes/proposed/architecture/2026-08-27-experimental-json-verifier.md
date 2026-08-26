# Agent Note: Experimental JSON verifier capability

Status: proposed

English | [中文](2026-08-27-experimental-json-verifier.zh.md)

## Problem

The integration repository has a live-confirmed Mistral structured-output route and a pairwise selector, but the DSH LLM adapters do not expose a general request contract for provider-specific `response_format.json_schema` fields. Adding hidden fields to an existing model adapter would make schema enforcement unobservable and provider-dependent.

## Proposal

Add two opt-in experimental packages: `@deepseek-ai/dsh-experimental-verifier` provides `ctx.verifier`, and `@deepseek-ai/dsh-experimental-tool-verifier` provides the explicit `verify_pair` tool. The service resolves `apiKeyEnv` through `ctx.credentials`, sends a bounded OpenAI-compatible JSON-schema request, rejects redirects, and validates the complete `score-v1` result before returning it. The tool exposes only rubric, candidate ids, and bounded evidence; it does not edit files, run checks, select winners, or mutate goals.

The packages remain outside the default base and Web bundles. A future workflow consumer may call the service for pairwise reranking after deterministic checks. Verification output is a probabilistic preference, not proof of correctness; deterministic tests, file inspection, diff checks, and security checks remain authoritative.

## Acceptance criteria

- The opt-in service resolves `apiKeyEnv` through `ctx.credentials`, rejects redirects, applies one fixed JSON schema, and rejects malformed or out-of-bound results.
- The explicit `verify_pair` tool returns canonical JSON through the normal tool pipeline without changing agent-loop, goal, or default-bundle behavior.
- Unit tests cover credentials, bounds, provider failures, invalid JSON, and redirects; a Loader composition test mounts service, tool, credentials, system prompt, and tools from `cordis.yml`.
- The packages build and typecheck, package invariant and README gates pass, and the opt-in example declares every referenced workspace dependency.

## Risks

- Provider-specific JSON schema support can regress or differ by model; every invalid response fails closed and requires review rather than fallback.
- Each comparison adds an external request, latency, and token cost; bounded `maxTokens` and explicit invocation control those costs but do not remove them.
- LLM preference can prefer plausible but incorrect candidates; deterministic evidence remains required and no goal completion is automated.
- A configured endpoint receives the credential-bearing request; redirect denial only prevents forwarding it to a redirect target.

## Alternatives considered

**Extend `llm-pi-ai` with hidden scorer fields.** Rejected because the current provider adapter does not promise those fields to every route, and hidden request mutation would make schema enforcement impossible to inspect or replay.

**Put the scorer in `agent-loop`.** Rejected because explicit verification is an optional capability and automatic per-turn calls would alter latency, cost, and loop semantics for every deployment.

**Use TencentDB/OpenViking memory as the verifier.** Rejected because those providers supply context and citations, not independent correctness evaluation; stale or poisoned memory must not become an authority signal.

**Embed Ruflo scheduling.** Rejected because DSH already owns subagents, workflows, jobs, and persistence; pairwise selection is a consumer concern that does not require a competing scheduler.

**Treat LLM verdict as correctness proof.** Rejected because model preference can exhibit positional bias, correlated errors, and distribution shift. Low-confidence or order-sensitive results must remain reviewable.

## Consequences

The opt-in service adds one bounded external request per explicit comparison and requires a credential reference plus a provider supporting the requested JSON schema. Redirect denial prevents credential forwarding from the configured endpoint to a redirect target. The service has no durable evaluation events because explicit tool call/result records already preserve its current model-visible input and output. If certified status later affects goals or future turns, a separate durable evaluation domain, projection, invariant, and replay coverage are required.

## Required verification

Package typecheck and build must pass. Service tests must cover credential resolution, schema validation, bounds, cancellation, provider errors, and redirect denial. The tool must have a real registry composition test. The example composition must remain opt-in and keyless; a live provider probe is recorded separately and must never log credentials or raw provider responses.
