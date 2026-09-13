---
description: "Expose the explicit verify_pair tool over a configured verifier service for bounded, schema-validated evidence comparisons."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-tool-verifier

English | [中文](README.zh.md)

## Summary

Use `dsh-experimental-tool-verifier` when a model should explicitly compare two bounded evidence records against a rubric. It registers `verify_pair` over `ctx.verifier` and returns the schema-validated `score-v1` result. The tool description makes the probabilistic boundary explicit: a score is not a correctness proof. It does not run deterministic checks, edit files, choose a final winner, or complete a goal.

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

Mount the tool after the tools runtime and experimental verifier service.

### When to choose it

Choose this package for model-initiated comparison after deterministic evidence exists. Call `ctx.verifier.compare` directly or omit the verifier entirely when the model should not see this capability.

### Minimal configuration

```yaml
- id: experimental-verifier
  name: '@deepseek-ai/dsh-experimental-verifier'
- id: experimental-tool-verifier
  name: '@deepseek-ai/dsh-experimental-tool-verifier'
```

| Field | Default | Meaning |
|---|---|---|
| — | — | This tool plugin has no configuration fields |

The generated [configuration catalog](../../../docs/config-catalog.md) records its required seams; the [tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-experimental-tool-verifier) owns the exact schema.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin registers one typed tool. Execution maps its five string arguments to `ctx.verifier.compare`, shares the tool cancellation signal, converts the provider-neutral result to snake-case `score-v1` JSON, and lets the standard tool runtime record the call and result.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Tool schema, verifier call, and compact JSON result |
| [`src/invariant.ts`](src/invariant.ts) | Composition invariant for the registered tool |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Verifier service](../verifier/README.md) — provider, credential, bounds, and validation.
- [Tool subsystem](../../../docs/subsystems/tools.md) — standard execution and durable recording.
- [Experimental verifier bundle](../../bundle/experimental-verifier/README.md) — opt-in profile layer.
- [Generated tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-experimental-tool-verifier) — exact model-facing schema.

-----

<a id="model-experience"></a>
## Model Experience

### Tool output

#### What the model sees

`verify_pair` accepts a rubric, two stable candidate ids, and bounded evidence strings. It returns `schema_version`, `probability_left`, and a concise rationale.

#### Token effect

The schema and result consume one model-visible tool round, plus one bounded external verifier request.

#### KV Cache effect

The tool adds no persistent prompt section. Standard tool call and result events append after the reusable prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

The tool intentionally exposes comparison rather than decision authority.

- **Explicit only** — it is not invoked automatically after a turn or goal round.
- **No deterministic checks** — tests, type checking, diff inspection, and security checks remain caller-owned evidence.
- **No tournament** — reverse-order and best-of-N orchestration belong to a workflow consumer.
- **Opt-in package** — the default base and Web bundles do not expose the tool.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
