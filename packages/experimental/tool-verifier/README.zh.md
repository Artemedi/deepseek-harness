---
description: "通过已配置的 verifier service 暴露显式 verify_pair 工具，用于有界、经 schema 校验的 evidence comparison。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-tool-verifier

[English](README.md) | 中文

## 概述

当模型应依据 rubric 显式比较两条有界 evidence record 时，使用 `dsh-experimental-tool-verifier`。它通过 `ctx.verifier` 注册 `verify_pair`，并返回经 schema 校验的 `score-v1` result。Tool description 明确概率边界：分数不是 correctness proof。它不运行 deterministic check、不编辑文件、不选择最终胜者，也不完成 goal。

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

在 tools runtime 与 experimental verifier service 之后挂载该 tool。

### 何时选择

已有 deterministic evidence 且需要模型主动比较时，选择此 package。模型不应看到该能力时，直接调用 `ctx.verifier.compare` 或完全省略 verifier。

### 最小配置

```yaml
- id: experimental-verifier
  name: '@deepseek-ai/dsh-experimental-verifier'
- id: experimental-tool-verifier
  name: '@deepseek-ai/dsh-experimental-tool-verifier'
```

| Field | Default | Meaning |
|---|---|---|
| — | — | 此 tool plugin 没有 configuration field |

生成的[配置目录](../../../docs/config-catalog.zh.md)记录其必要 seam；[工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-experimental-tool-verifier)负责精确 schema。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部机制——点击展开</summary>

该 plugin 注册一个 typed tool。Execution 把五个 string argument 映射到 `ctx.verifier.compare`，共享 tool cancellation signal，把 provider-neutral result 转换为 snake-case `score-v1` JSON，并由标准 tool runtime 记录 call 与 result。

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | Tool schema、verifier call 与紧凑 JSON result |
| — | 不发布 runtime invariant companion；verifier 返回单个不可变结果，标准 tool runtime 负责持久 call/result 配对。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Verifier service](../verifier/README.zh.md) — provider、credential、bound 与 validation。
- [Tool subsystem](../../../docs/subsystems/tools.zh.md) — 标准 execution 与 durable recording。
- [Experimental verifier bundle](../verifier-bundle/README.zh.md) — 选择加入的 profile layer。
- [Generated tool catalog](../../../docs/tool-catalog.zh.md#deepseek-aidsh-experimental-tool-verifier) — 精确 model-facing schema。

-----

<a id="model-experience"></a>
## 模型体验

### 工具输出

#### 模型看到什么

`verify_pair` 接受 rubric、两个稳定 candidate id 与有界 evidence string。它返回 `schema_version`、`probability_left` 和简洁 rationale。

#### Token 影响

Schema 与 result 消耗一轮 model-visible tool round，外加一次有界 external verifier request。

#### KV Cache 影响

该 tool 不增加持久 prompt section。标准 tool call 与 result event 追加在可复用 prefix 之后。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

该 tool 有意暴露 comparison，而不是 decision authority。

- **仅显式调用**——它不会在 turn 或 goal round 后自动运行。
- **没有 deterministic check**——test、type checking、diff inspection 与 security check 仍是 caller-owned evidence。
- **没有 tournament**——反向顺序与 best-of-N orchestration 属于 workflow consumer。
- **选择加入 package**——默认 base 与 Web bundle 不暴露该 tool。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
