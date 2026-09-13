---
description: "通过已配置的实验性 memory service 暴露显式 memory_search 工具，并在模型复用前记录精确 citation。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-tool-memory

[English](README.md) | 中文

## 概述

当模型应显式搜索已配置 memory service 时，使用 `dsh-experimental-tool-memory`。它注册 `memory_search`，要求调用方 Agent 提供 workspace authority，并在返回前把精确有界结果记录到 `memory/search`。Provider selection 与 remote isolation 仍由 `dsh-experimental-memory` 负责。Memory 只供 automatic recall 或 host-side consumer 使用时，省略此 package。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在显式 composition 中，将该 tool 挂载在 memory 与 tools service 之后。

### 何时选择

需要模型主动发起且可审计的 retrieval 时，选择此 package。只有 host code 或 automatic recall 应检索 context 时，使用不带此 consumer 的 `dsh-experimental-memory`。

### 最小配置

```yaml
- id: experimental-memory
  name: '@deepseek-ai/dsh-experimental-memory'
- id: experimental-tool-memory
  name: '@deepseek-ai/dsh-experimental-tool-memory'
```

| Field | Default | Meaning |
|---|---|---|
| — | — | 此 tool plugin 没有 configuration field |

生成的[配置目录](../../../docs/config-catalog.zh.md)记录其必要 service seam；[工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-experimental-tool-memory)负责完整 schema。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部机制——点击展开</summary>

该 tool 把已校验 argument 与 execution signal 转发到 `ctx.memory.search`。它在精确调用方 Agent session 上把规范化结果追加为 `memory/search`，随后将相同值渲染为紧凑 JSON。Memory service 负责 authorization 与 provider routing；标准 tool runtime 负责 `tool/call` 与 `tool/result`。

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | Tool schema、execution、durable observation 与 JSON rendering |
| [`src/invariant.ts`](src/invariant.ts) | 已注册 tool 的 composition invariant |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Memory service](../memory/README.zh.md) — workspace authority、provider、capture 与 recall。
- [Tool subsystem](../../../docs/subsystems/tools.zh.md) — 标准 execution 与 durable tool event。
- [Generated tool catalog](../../../docs/tool-catalog.zh.md#deepseek-aidsh-experimental-tool-memory) — 精确 input 与 output schema。

-----

<a id="model-experience"></a>
## 模型体验

### Memory 搜索工具

#### 模型看到什么

模型会看到带显式 provider 与 provider-specific depth 的 `memory_search` schema。其 JSON result 包含 provider、workspace、可用 source metadata 与精确有界 citation text。

#### Token 影响

可见 tool schema 具有固定 request cost。每个 result 都会把有界 citation text 与 metadata 加入 tool-result history。

#### KV Cache 影响

只要 composition 不变，tool definition 就保持 prefix-stable。已记录 result 追加在可复用 request prefix 之后。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

此 consumer 有意保持显式且狭窄的 retrieval surface。

- **没有 memory write tool**——automatic TencentDB capture 属于 memory service；此 package 不暴露 `memory_store`。
- **没有 implicit recall**——后续 model request 只能复用已记录在 Session history 中的 citation。
- **Remote setup 保持独立**——TencentDB 与 OpenViking route 要求在 memory service 上进行 provider-specific configuration。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
