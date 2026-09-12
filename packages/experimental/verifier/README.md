# @deepseek-ai/dsh-experimental-verifier

English | [中文](README.zh.md)

`@deepseek-ai/dsh-experimental-verifier` provides an opt-in JSON-only pairwise verifier service. It resolves an API-key reference through `ctx.credentials`, sends a bounded OpenAI-compatible structured-output request, rejects redirects, and validates the complete `score-v1` result before returning it.

## Model Experience

### Service output

#### What the model sees

The service is not model-facing by itself. The optional `tool-verifier` package exposes the explicit `verify_pair` tool.

#### Token effect

One provider request is made per explicit comparison. The deployment controls the fixed output ceiling through `maxTokens`; the service does not use logprobs.

#### KV Cache effect

The service does not modify the calling agent context or session history. Tool calls and results remain recorded by the standard DSH tool pipeline.

## Known Limitations and Deferred Work

- **One provider route** — this package implements one configured OpenAI-compatible JSON route; provider fallback and logprob scoring are deferred.
- **No correctness authority** — the result is a probabilistic preference and must be combined with deterministic tests, file inspection, and security checks.
- **No automatic invocation** — the service does not inspect every turn or change goal completion. Pairwise tournament orchestration remains an explicit workflow responsibility.
- **No durable evaluation domain** — the standard `tool/call` and `tool/result` records are sufficient while verification is an explicit tool. Durable evaluation events require a separate consumer that needs replayable certified state.
- **No shipped composition** — deployments mount the service and tool in an explicit profile or patch; neither default base nor Web bundle enables provider traffic.
