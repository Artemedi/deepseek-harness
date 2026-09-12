# 实验性 Memory 工具

[English](README.md) | 中文

`@deepseek-ai/dsh-experimental-tool-memory` 仅在显式组合时通过 `ctx.memory` 注册 `memory_search`。该工具要求存在调用方 Agent，在相应 session 中记录 `memory/search` 事件，并返回相同的有界 citation 列表。

## Model Experience

### Memory search tool

#### What the model sees

模型会看到带有显式 provider 和可选 OpenViking depth 的 `memory_search` schema。其 JSON 结果包含 provider、workspace、可用时的 first-party session 字段、可用时的 remote source 元数据，以及精确 citation 文本。在后续 step 可以复用之前，session log 会记录精确结果。

#### Token effect

工具 schema 可见时具有固定的请求成本；每条返回的 citation 都会把有界文本和 citation 元数据加入 tool-result history。

#### KV Cache effect

只要组合不变，工具定义就保持 prefix-stable。新记录的 tool result 跟在可复用请求前缀之后，不会重写更早的 history。

## Known Limitations and Deferred Work

- **仅显式搜索**——该 consumer 没有 automatic recall 或 `memory_store`。TencentDB 和 OpenViking 原生路由仍为选择加入，并要求 provider 专用 endpoint 配置。TencentDB 还要求显式的 service、team、agent 和 user isolation identifier。后续模型请求只能复用已经记录在 session log 中的 citation。
