---
description: "Configure an opt-in OpenAI-compatible pairwise verifier that returns bounded, schema-validated probabilistic preference scores."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-verifier

English | [中文](README.zh.md)

## Summary

Use `dsh-experimental-verifier` for one explicit, bounded comparison between two evidence records. It resolves a credential through `ctx.credentials`, requests strict JSON from an OpenAI-compatible endpoint, rejects redirects, and validates the complete `score-v1` response. The returned probability is supporting evidence, never a correctness or goal-completion authority. Add `dsh-experimental-tool-verifier` only when the model should invoke comparisons directly.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the verifier after a credentials provider and call `ctx.verifier.compare` with deterministic evidence and a cancellation signal.

### When to choose it

Choose this service when an explicit workflow benefits from a second model's pairwise preference after deterministic checks. Do not choose it as a replacement for tests, type checking, security review, or human judgment.

### Minimal configuration

```yaml
- id: experimental-verifier
  name: '@deepseek-ai/dsh-experimental-verifier'
  config:
    apiKeyEnv: MISTRAL_API_KEY
```

| Field | Default | Meaning |
|---|---|---|
| `baseUrl` | `https://api.mistral.ai/v1` | OpenAI-compatible provider endpoint |
| `model` | `mistral-small-2603` | Model used for each comparison |
| `apiKeyEnv` | `MISTRAL_API_KEY` | Credential reference resolved per request |
| `maxTokens` | `64` | Fixed verifier output ceiling |
| `maxEvidenceBytes` | `16384` | UTF-8 cap for each evidence input |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-experimental-verifier) is the exhaustive source for accepted fields and bounds.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`VerifierService.compare` bounds the rubric, candidate ids, and evidence before credential or network work. It sends one temperature-zero chat-completions request with a strict JSON schema, then accepts only the three-field `score-v1` object and bounds its rationale. Cancellation and timeout share one request controller, while public errors expose a closed diagnostic code rather than provider response bodies.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Configuration, credential lookup, request boundary, and response validation |
| [`src/types.ts`](src/types.ts) | Provider-neutral comparison request and result types |
| — | No runtime invariant companion is published; each comparison returns one validated immutable result without package-owned durable state. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Credentials subsystem](../../credentials/README.md) — secret resolution boundary.
- [Verifier tool](../tool-verifier/README.md) — explicit model-facing consumer.
- [Experimental verifier bundle](../verifier-bundle/README.md) — opt-in profile layer.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-experimental-verifier) — exact defaults and bounds.

-----

<a id="model-experience"></a>
## Model Experience

### Service output

#### What the model sees

The service is not model-facing by itself. The optional verifier tool exposes the explicit `verify_pair` schema and result.

#### Token effect

One provider request is made per explicit comparison. `maxTokens` bounds its output; the service adds nothing to the calling agent context by itself.

#### KV Cache effect

The service does not modify agent context or Session history. A composed consumer owns any model-visible request and result.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits keep the verifier a narrow probabilistic aid.

- **One provider route** — provider fallback and logprob scoring are not implemented.
- **No correctness authority** — deterministic tests, inspection, security checks, and review remain required.
- **No automatic invocation** — pairwise tournament or goal orchestration belongs to an explicit workflow.
- **No durable evaluation domain** — the service itself emits no certified evaluation events.
- **No shipped default composition** — provider traffic starts only in an explicit profile or bundle.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
