---
description: "Expose the explicit memory_search tool over a configured experimental memory service and record exact citations before model reuse."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-tool-memory

English | [中文](README.zh.md)

## Summary

Use `dsh-experimental-tool-memory` when a model should explicitly search the configured memory service. It registers `memory_search`, requires the calling Agent for workspace authority, and records the exact bounded result in `memory/search` before returning it. Provider selection and remote isolation remain owned by `dsh-experimental-memory`. Omit this package when memory is used only by automatic recall or host-side consumers.

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

Mount the tool after the memory and tools services in an explicit composition.

### When to choose it

Choose this package for model-initiated, auditable retrieval. Use `dsh-experimental-memory` without this consumer when only host code or automatic recall should retrieve context.

### Minimal configuration

```yaml
- id: experimental-memory
  name: '@deepseek-ai/dsh-experimental-memory'
- id: experimental-tool-memory
  name: '@deepseek-ai/dsh-experimental-tool-memory'
```

| Field | Default | Meaning |
|---|---|---|
| — | — | This tool plugin has no configuration fields |

The generated [configuration catalog](../../../docs/config-catalog.md) records its required service seams; the [tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-experimental-tool-memory) owns the complete schema.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The tool forwards validated arguments and the execution signal to `ctx.memory.search`. It appends the normalized result as `memory/search` on the exact calling Agent session, then renders that same value as compact JSON. The memory service owns authorization and provider routing; the standard tool runtime owns `tool/call` and `tool/result`.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Tool schema, execution, durable observation, and JSON rendering |
| [`src/invariant.ts`](src/invariant.ts) | Composition invariant for the registered tool |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Memory service](../memory/README.md) — workspace authority, providers, capture, and recall.
- [Tool subsystem](../../../docs/subsystems/tools.md) — standard execution and durable tool events.
- [Generated tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-experimental-tool-memory) — exact input and output schema.

-----

<a id="model-experience"></a>
## Model Experience

### Memory search tool

#### What the model sees

The model sees the `memory_search` schema with an explicit provider and provider-specific depth. Its JSON result contains the provider, workspace, available source metadata, and exact bounded citation text.

#### Token effect

The visible tool schema has a fixed request cost. Each result adds bounded citation text and metadata to tool-result history.

#### KV Cache effect

The tool definition remains prefix-stable while composition is unchanged. A logged result appends after the reusable request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

This consumer deliberately keeps retrieval explicit and narrow.

- **No memory write tool** — automatic TencentDB capture belongs to the memory service; this package exposes no `memory_store`.
- **No implicit recall** — later model requests can reuse only citations already recorded in Session history.
- **Remote setup remains separate** — TencentDB and OpenViking routes require provider-specific configuration on the memory service.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
