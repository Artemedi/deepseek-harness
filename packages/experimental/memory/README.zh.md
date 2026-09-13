---
description: "配置经 workspace 授权的 session memory、TencentDB capture 与 recall、OpenViking retrieval，或受管的本地 MemoryCore Gateway。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-memory

[English](README.md) | 中文

## 概述

当 agent 需要同一 workspace session history 中的有界 citation，或需要显式配置的 remote memory provider 时，使用 `dsh-experimental-memory`。默认 local route 读取现有 session-query corpus，不注入 prompt content。可选 TencentDB route 增加持久 automatic capture 和 pre-step recall；OpenViking 增加显式分层 retrieval。所有 remote route 均为选择加入，并且 package 会在网络访问前保持 workspace 与 agent-preset isolation。

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

在 base-backed composition 中挂载该 service；只有当模型应主动发起显式搜索时，才添加 `dsh-experimental-tool-memory`。

### 何时选择

需要 workspace-scoped retrieval、显式 remote-memory isolation，或必须在持久 Session log 中可见的 TencentDB capture 与 recall 时，选择此 package。调用方只需要普通 transcript search 时保留现有 session-query stack；此 package 不替代 Session persistence 或 provider-side storage。

### 最小配置

默认 route 依赖 shipped profile 已提供的 base session、projection、agent 与 query service：

```yaml
- id: experimental-memory
  name: '@deepseek-ai/dsh-experimental-memory'
```

| Field | Default | Meaning |
|---|---|---|
| `providers` | `['local']` | 启用的 route；始终要求 `local` |
| `tencentdb` | absent | TencentDB Gateway endpoint、credential、service 与 isolation binding |
| `tencentdbRuntime` | absent | 由 DSH 拥有、operator 已安装的本地 MemoryCore process |
| `openviking` | absent | OpenViking endpoint、credential 与可选 target URI |
| `automaticCapture` | `false` | 向 TencentDB 导出 completed 与 max-token turn |
| `automaticRecall` | `false` | 第一步之前 recall TencentDB context |

所有可接受字段与默认值以生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-experimental-memory)为准。

### Provider 与持久性边界

Local provider 接受精确的 live `Agent`，从 `agent.session.header.cwd` 推导 authority，并返回同一 workspace 的有界 event citation。空、重复、未知或缺少 `local` 的 provider set 会在 composition 阶段失败。Consumer 必须在向后续 model request 展示 citation 前，把精确结果追加为 `memory/search`。

TencentDB 要求纯 HTTP(S) origin、memory-instance service id，以及从绝对 DSH workspace 加可选有效 agent preset 到已配置 Team、Agent、User id 的非空 binding。数字 loopback 可以使用非秘密 local bearer marker；hostname alias 和非 loopback gateway 要求已解析 DSH credential。L1 atomic memory、L2 scenario profile 与单一 L3 core profile 在同一 deadline 和 byte budget 下转换为有界 citation。

启用 `automaticCapture` 时，idle-agent maintenance 从持久 event 投影未捕获的 completed turn，flush `memory/capture-requested`，调用 `/v3/conversation/add`，再记录 success 或封闭 diagnostic code。Delivery 为 at least once。启用 `automaticRecall` 时，第一步在一个 aggregate budget 下搜索配置的 L1-L3 depth，记录精确组合结果，并前置一条标注为可能过时且不构成指令的独立 reference message；失败层不会丢弃成功层或阻塞 turn。

`tencentdbRuntime` 通过 DSH subprocess seam 拥有 operator 已安装、commit-pinned 的 standalone MemoryCore process。它转发现有 LLM credential，激活前要求精确 healthy response，拒绝已占用或非 loopback endpoint，在 `dataDir` 保存状态，并在 unload 时终止 process tree。应用启动绝不会 clone、安装或 pull 可变 upstream code。

OpenViking 调用已确认的 `/api/v1/search/find` route，并按显式 L0-L2 depth 映射 memory、resource 与 skill record。Response streaming、deadline、cancellation、redirect refusal 和 output bound 均会执行。没有 `openviking` object 时，显式启用的 route 是 deterministic local contract-test stub。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部机制——点击展开</summary>

`MemoryService` 解析 caller authority 与 provider routing。已注册的 Session projection 把直接 user 与 assistant message 折叠为 completed turn，并只在 `memory/capture-succeeded` 后移除 turn，因此 restart recovery 不依赖同步 log scan。Provider adapter 负责 wire validation，并把外部 record 规范化为有界 opaque citation；managed-runtime adapter 只负责 process lifecycle。

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | Service、configuration、local route、capture projection 与 automatic recall/capture orchestration |
| [`src/tencentdb-http.ts`](src/tencentdb-http.ts) | TencentDB isolation、L1-L3 retrieval 与 conversation capture |
| [`src/tencentdb-runtime.ts`](src/tencentdb-runtime.ts) | 受管本地 Gateway lifecycle 与 readiness |
| [`src/openviking-http.ts`](src/openviking-http.ts) | OpenViking request 与 response boundary |
| [`src/remote-contract.ts`](src/remote-contract.ts) | 共享 remote citation normalization 与 safe failure |
| [`src/invariant.ts`](src/invariant.ts) | 持久 memory event 的 runtime invariant check |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Session-query subsystem](../../../docs/subsystems/session-query.zh.md) — local retrieval corpus 与 filtering boundary。
- [TencentDB integration guide](../../../docs/user/guide/tencentdb-memory.zh.md) — deployment 与 managed-runtime configuration。
- [TencentDB integration contract](../../../integrations/tencentdb-agent-memory/README.zh.md) — 固定 upstream surface 与 verification。
- [Memory tool](../tool-memory/README.zh.md) — 显式 model-facing search 与持久 result recording。
- [Generated configuration catalog](../../../docs/config-catalog.zh.md#deepseek-aidsh-experimental-memory) — 完整 loader configuration。

-----

<a id="model-experience"></a>
## 模型体验

### 服务输出

#### 模型看到什么

Service 本身不注册 model-facing schema。Automatic recall 会提供一条独立 untrusted reference message；`memory_search` 负责显式展示有界 citation。

#### Token 影响

Local 与 capture path 不增加 request token。Automatic recall 增加有界 citation text，已组合的 tool consumer 增加其 schema 与 result。

#### KV Cache 影响

Service 不重写更早 context。Automatic recall 与显式 result 追加在可复用 request prefix 之后。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

以下约束说明 deployment 在何处需要额外 isolation 或 delivery handling。

- **Capture 为 at least once**——remote acceptance 之后、本地 success event 之前 crash 可能重发 turn，因为固定的 upstream route 不接受 idempotency key 或 client message id。
- **Remote route 为选择加入**——默认 DSH 与 Web composition 不会发出 TencentDB 或 OpenViking request。
- **OpenViking scope 由 deployment 负责**——provider-side multi-tenancy 重要时，trusted `targetUri` 必须提供 isolation。
- **Managed mode 需要已安装的 upstream checkout**——当前 upstream package 不发布 standalone Gateway executable。
- **Remote citation 是 opaque 的**——它们省略 DSH session id 与 event sequence，只保留 provider identity、source metadata 与有界 content。
- **Binding migration 为手动操作**——改变 workspace 或 agent preset 不会移动或合并已有 provider-side profile。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
