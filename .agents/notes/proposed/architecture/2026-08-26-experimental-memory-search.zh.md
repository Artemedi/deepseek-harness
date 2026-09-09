# Agent Note: Experimental workspace memory search

Status: proposed

[English](2026-08-26-experimental-memory-search.md) | 中文

## Problem

外部记忆可以绕过 DSH 会话日志，直接把检索文本加入提示词。恢复会话时无法从日志重建模型先前看到的内容，而且由 provider 提供的 scope 可能把访问范围扩大到调用 workspace 之外。

## Proposal

增加 opt-in 的 experimental `ctx.memory` service 和 `memory_search` tool。local provider 搜索现有的 `ctx.sessionQuery` corpus，不替换 DSH 会话持久化。tool 从精确的 live calling Agent 的 `SessionHeader.cwd` 推导 workspace scope，追加包含完整有界 citations 的 versioned `memory/search` event，并且只在追加成功后返回这些 citations。

第一个 provider 只提供 search。它在查询前校验 stale Agent、缺失 workspace、空 query、hit limit 和总字节限制。append-time invariant 拒绝 workspace 与 owning session 不一致的 `memory/search` event。

Opt-in TencentDB provider 使用上游 v3 data-plane contract，而不把 DSH workspace 转换为 provider tenancy。部署配置提供 memory service、Team、Agent 和 User 标识符；每次搜索都发送该 isolation tuple，并在调用者的 DSH workspace 下记录返回的 L1 atomic-memory citations。缺少连接或隔离配置时，composition 会被拒绝，而不会选择测试数据。

可选 automatic capture 在 Agent 进入 idle 后，仅导出 completed 或 max-token turn 中的直接用户文本和助手文本。DSH 在远程写入前记录并 flush capture request，随后记录有界的 success 或 failure event。由于进程可能在 TencentDB 接受 turn 后、DSH 记录成功前停止，因此交付语义为 at least once。

## Alternatives considered

**直接把外部结果注入提示词。** 拒绝，因为检索文本会成为无法从会话日志重建的隐藏 model state。

**使用 TencentDB Agent Memory 或 OpenViking 作为 DSH 会话持久化。** 拒绝，因为 append-only DSH session log 负责 replay、fork、tool history 和 UI fidelity；外部记忆保持为派生的 retrieval provider。

**从 tool arguments 接受 workspace scope。** 拒绝，因为 model arguments 不是 authorization source。service 从 calling Agent 的 session metadata 推导 scope。

## Acceptance criteria

- local provider 只返回调用者 workspace 的 citations，并执行 request bounds。
- `memory_search` 在返回 model-visible text 前把完整返回值记录到 `memory/search`。
- package invariant 拒绝声明 workspace 与 owning session 不同的 event。
- Loader-composed test 通过已安装的 tool，检查 JSON result 和 durable event。
- TencentDB request 保留配置的 v3 isolation tuple，校验业务 response envelope，并且启用的 runtime route 绝不暴露 deterministic stub。

## Risks

Local provider 只搜索 session history。TencentDB retrieval 是显式 L1 search；自动 recall、conversation capture、memory storage、L2/L3 context 和 OpenViking 需要为每个 provider 先定义 authorization、response bounds、failure behavior 和 durable event semantics。
