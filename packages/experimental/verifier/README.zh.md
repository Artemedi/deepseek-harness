---
description: "配置选择加入的 OpenAI-compatible pairwise verifier，返回有界、经 schema 校验的概率偏好分数。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-verifier

[English](README.md) | 中文

## 概述

使用 `dsh-experimental-verifier` 对两条 evidence record 进行一次显式有界比较。它通过 `ctx.credentials` 解析 credential，从 OpenAI-compatible endpoint 请求 strict JSON，拒绝 redirect，并校验完整 `score-v1` response。返回的 probability 只是辅助 evidence，绝不是 correctness 或 goal-completion authority。只有模型应直接调用 comparison 时，才添加 `dsh-experimental-tool-verifier`。

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

在 credentials provider 之后挂载 verifier，并用 deterministic evidence 与 cancellation signal 调用 `ctx.verifier.compare`。

### 何时选择

显式 workflow 在 deterministic check 后能从第二个模型的 pairwise preference 获益时，选择此 service。不要用它替代 test、type checking、security review 或 human judgment。

### 最小配置

```yaml
- id: experimental-verifier
  name: '@deepseek-ai/dsh-experimental-verifier'
  config:
    apiKeyEnv: MISTRAL_API_KEY
```

| Field | Default | Meaning |
|---|---|---|
| `baseUrl` | `https://api.mistral.ai/v1` | OpenAI-compatible provider endpoint |
| `model` | `mistral-small-2603` | 每次 comparison 使用的 model |
| `apiKeyEnv` | `MISTRAL_API_KEY` | 每次 request 解析的 credential reference |
| `maxTokens` | `64` | 固定 verifier output ceiling |
| `maxEvidenceBytes` | `16384` | 每个 evidence input 的 UTF-8 cap |

所有可接受字段与 bound 以生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-experimental-verifier)为准。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部机制——点击展开</summary>

`VerifierService.compare` 在 credential 或 network work 前限制 rubric、candidate id 与 evidence。它用 strict JSON schema 发送一次 temperature-zero chat-completions request，随后只接受包含三个字段的 `score-v1` object，并限制 rationale。Cancellation 与 timeout 共享一个 request controller，而 public error 只暴露封闭 diagnostic code，不暴露 provider response body。

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | Configuration、credential lookup、request boundary 与 response validation |
| [`src/types.ts`](src/types.ts) | Provider-neutral comparison request 与 result type |
| [`src/invariant.ts`](src/invariant.ts) | Runtime service invariant |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Credentials subsystem](../../credentials/README.zh.md) — secret resolution boundary。
- [Verifier tool](../tool-verifier/README.zh.md) — 显式 model-facing consumer。
- [Experimental verifier bundle](../../bundle/experimental-verifier/README.zh.md) — 选择加入的 profile layer。
- [Generated configuration catalog](../../../docs/config-catalog.zh.md#deepseek-aidsh-experimental-verifier) — 精确 default 与 bound。

-----

<a id="model-experience"></a>
## 模型体验

### 服务输出

#### 模型看到什么

Service 本身不直接面向模型。可选 verifier tool 暴露显式 `verify_pair` schema 与 result。

#### Token 影响

每次显式 comparison 产生一个 provider request。`maxTokens` 限制其 output；service 本身不向调用方 agent context 添加内容。

#### KV Cache 影响

Service 不修改 agent context 或 Session history。已组合 consumer 负责任何 model-visible request 与 result。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

以下限制让 verifier 保持为狭窄的概率辅助工具。

- **单 provider route**——未实现 provider fallback 与 logprob scoring。
- **没有 correctness authority**——仍要求 deterministic test、inspection、security check 与 review。
- **不自动调用**——pairwise tournament 或 goal orchestration 属于显式 workflow。
- **没有 durable evaluation domain**——service 本身不发出 certified evaluation event。
- **没有 shipped default composition**——provider traffic 只在显式 profile 或 bundle 中启动。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
