---
description: "从 source checkout 向所选 dsh profile 添加实验性 verifier service 与显式 verify_pair 工具。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-verifier-bundle

[English](README.md) | 中文

## 概述

此选择加入 layer 向一个所选 profile 添加实验性 JSON verifier service 与 `verify_pair` tool。任何 shipped base、headless 或 Web profile 都不包含它。通过 profile package manager 安装或移除，使 dependency resolution 与 patch reconciliation 保持 profile-local。该 package 为 private，面向已构建 source checkout；其 score 仍是概率 evidence，而不是 correctness authority。

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

### 安装到 profile

在已构建的 source checkout 中，把 local package 安装到所选 profile，并按 package name 移除：

```text
pnpm dsh plugin --profile web add ./packages/experimental/verifier-bundle
pnpm dsh plugin --profile web remove @deepseek-ai/dsh-experimental-verifier-bundle
```

Profile-local dependency graph 使两个 private experimental package 均可解析，reconciliation 会激活声明的 `dsh.bundle.patch`。没有该声明的 package 可以作为 dependency 安装，但不会贡献 layer。不要把这些 row 直接复制到 profile patch。

### 获得的能力

该 layer 先插入 `experimental-verifier`，以有界 Mistral-compatible route 与 `MISTRAL_API_KEY` 配置，再插入 `experimental-tool-verifier`。Service 负责 provider request 与 response validation；tool 负责 model-facing schema 与紧凑 result。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部机制——点击展开</summary>

该 package 是静态双 row patch carrier。Profile reconciliation 应用 [`cordis.patch.yml`](cordis.patch.yml)；后续具有相同 id 的 profile 或 user row 会替换完整 configuration。TypeScript entry 没有 runtime behavior，每个 inserted package 负责自身 service 或 tool contract。

| 文件 | 作用 |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | 带有界 default 的 verifier service 与 tool row |
| [`src/index.ts`](src/index.ts) | 空 bundle entry |
| — | 不发布 runtime invariant companion；静态 patch 不持有可供交叉检查的 event 或 mutable runtime relation。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Verifier service](../verifier/README.zh.md) — provider 与 validation contract。
- [Verifier tool](../tool-verifier/README.zh.md) — model-facing schema 与 boundary。
- [Package map](../../README.zh.md) — workspace package inventory。
- [Generated composition graph](../../../apps/cli/composition.md) — 当前 profile row。

-----

<a id="model-experience"></a>
## 模型体验

间接通过 inserted verifier tool；该 package 负责其 model-facing schema 与 result。

#### KV Cache 影响

Bundle 本身不增加 request prefix。只要 profile composition 不变，inserted tool definition 就保持稳定。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

以下约束来自 bundle 的 private、选择加入状态。

- **仅 source checkout**——private package 不作为 release dependency 发布。
- **Whole-row override**——后续 patch 替换一个 row 的完整 configuration，而不是合并单个 field。
- **没有 automatic verification**——该 layer 只暴露显式 `verify_pair` call。
- **没有 correctness authority**——仍然要求 deterministic evidence 与 human review。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
