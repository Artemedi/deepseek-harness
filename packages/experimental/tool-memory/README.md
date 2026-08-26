# Experimental Memory Tool

`@deepseek-ai/dsh-experimental-tool-memory` registers `memory_search` over `ctx.memory` when explicitly composed. The tool requires a calling Agent, records a `memory/search` event in that session, and returns the same bounded citation list.

## Model Experience

### Memory search tool

#### What the model sees

The model sees the `memory_search` schema and a JSON result containing explicit workspace, session, event, and citation text. The session log records the exact result before a later step can reuse it.

#### Token effect

The tool schema has a fixed request cost while visible; each returned citation adds its bounded text and citation metadata to the tool-result history.

#### KV Cache effect

The tool definition remains prefix-stable while composition is unchanged. A new logged tool result follows the reusable request prefix and does not rewrite earlier history.

## Known Limitations and Deferred Work

- **Explicit search only** — this consumer has no automatic recall, `memory_store`, TencentDB provider, or OpenViking provider.
