# Agent Note: Experimental workspace memory search

Status: proposed

[English](2026-08-26-experimental-memory-search.md) | 中文

## Problem

外部记忆可以绕过 DSH 会话日志，直接把检索文本加入提示词。恢复会话时无法从日志重建模型先前看到的内容，而且由 provider 提供的 scope 可能把访问范围扩大到调用 workspace 之外。

## Proposal

增加 opt-in 的 experimental `ctx.memory` service 和 `memory_search` tool。local provider 搜索现有的 `ctx.sessionQuery` corpus，不替换 DSH 会话持久化。tool 从精确的 live calling Agent 的 `SessionHeader.cwd` 推导 workspace scope，追加包含完整有界 citations 的 versioned `memory/search` event，并且只在追加成功后返回这些 citations。

第一个 provider 只提供 search。它在查询前校验 stale Agent、缺失 workspace、空 query、hit limit 和总字节限制。append-time invariant 拒绝 workspace 与 owning session 不一致的 `memory/search` event。

## Alternatives considered

**直接把外部结果注入提示词。** 拒绝，因为检索文本会成为无法从会话日志重建的隐藏 model state。

**使用 TencentDB Agent Memory 或 OpenViking 作为 DSH 会话持久化。** 拒绝，因为 append-only DSH session log 负责 replay、fork、tool history 和 UI fidelity；外部记忆保持为派生的 retrieval provider。

**从 tool arguments 接受 workspace scope。** 拒绝，因为 model arguments 不是 authorization source。service 从 calling Agent 的 session metadata 推导 scope。

## Acceptance criteria

- local provider 只返回调用者 workspace 的 citations，并执行 request bounds。
- `memory_search` 在返回 model-visible text 前把完整返回值记录到 `memory/search`。
- package invariant 拒绝声明 workspace 与 owning session 不同的 event。
- Loader-composed test 通过已安装的 tool，检查 JSON result 和 durable event。

## Risks

初始 provider 只搜索 session history，不提供 semantic vector retrieval 或外部 durable knowledge。自动 recall、memory storage、TencentDB 或 OpenViking 需要为每个 provider 先定义 authorization、response bounds、failure behavior 和 durable event semantics。
