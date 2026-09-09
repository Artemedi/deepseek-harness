# Agent Note: Experimental workspace memory search

Status: proposed

[English](2026-08-26-experimental-memory-search.md) | 中文

## Problem

外部记忆可以绕过 DSH 会话日志，直接把检索文本加入提示词。恢复会话时无法从日志重建模型先前看到的内容，而且由 provider 提供的 scope 可能把访问范围扩大到调用 workspace 之外。

## Proposal

增加 opt-in 的 experimental `ctx.memory` service 和 `memory_search` tool。local provider 搜索现有的 `ctx.sessionQuery` corpus，不替换 DSH 会话持久化。tool 从精确的 live calling Agent 的 `SessionHeader.cwd` 推导 workspace scope，追加包含完整有界 citations 的 versioned `memory/search` event，并且只在追加成功后返回这些 citations。

第一个 provider 只提供 search。它在查询前校验 stale Agent、缺失 workspace、空 query、hit limit 和总字节限制。append-time invariant 拒绝 workspace 与 owning session 不一致的 `memory/search` event。

Opt-in TencentDB provider 使用上游 v3 data-plane contract，而不把 DSH workspace 转换为 provider tenancy。部署配置提供 memory service、Team、Agent 和 User 标识符；每次搜索都发送该 isolation tuple，并在调用者的 DSH workspace 下记录返回的 L1 atomic-memory citations。数字 loopback standalone Gateway 可以沿用上游默认配置并关闭 authentication；由于 v3 data-plane parser 强制要求该 header 形式，DSH 仍会发送非秘密 bearer marker。Hostname alias 和非 loopback endpoint 必须提供 DSH credential reference。缺少连接、认证或隔离配置时，composition 会被拒绝，而不会选择测试数据。

可选 managed mode 仅通过 DSH local-host subprocess service 启动由 operator 安装并固定 commit 的 standalone MemoryCore checkout，显式转发现有 DSH LLM credential，并在数字 loopback health endpoint 返回精确 ready envelope 前阻止 service activation。该依赖与 composition 顺序无关；remote execution world 会在 credential resolution 前被拒绝。plugin 拒绝接管任何已有 HTTP listener，并在 unload 和 HMR 时负责终止完整 process tree。配置的 OpenAI-compatible LLM 也可以是本地服务。由于 upstream 尚未发布稳定的 standalone Gateway executable，应用启动过程不会下载或更新 MemoryCore。

可选 automatic capture 在 Agent 进入 idle 后，仅导出 completed 或 max-token turn 中的直接用户文本和助手文本。DSH 在远程写入前记录并 flush capture request，随后记录有界的 success 或 failure event。由于进程可能在 TencentDB 接受 turn 后、DSH 记录成功前停止，因此交付语义为 at least once。

可选 automatic recall 在第一个 step 前执行一次，仅从直接用户输入推导 query，并在返回单独的 model-visible reference message 前记录精确的合并结果。默认只使用 L1；部署可选择 L2 和 L3，且所有层共享一个总 hit 与 byte budget。L2 使用上游 scenario listing，按 literal query 对有界的 path 和 summary metadata 排序，并仅读取选中的 profile；L3 读取单一 core profile。该消息明确标记远程 memory 可能过时且不构成指令。某一层失败会记录安全错误码，但不会丢弃成功层或阻塞 model turn。

## Alternatives considered

**直接把外部结果注入提示词。** 拒绝，因为检索文本会成为无法从会话日志重建的隐藏 model state。

**使用 TencentDB Agent Memory 或 OpenViking 作为 DSH 会话持久化。** 拒绝，因为 append-only DSH session log 负责 replay、fork、tool history 和 UI fidelity；外部记忆保持为派生的 retrieval provider。

**从 tool arguments 接受 workspace scope。** 拒绝，因为 model arguments 不是 authorization source。service 从 calling Agent 的 session metadata 推导 scope。

## Acceptance criteria

- local provider 只返回调用者 workspace 的 citations，并执行 request bounds。
- `memory_search` 在返回 model-visible text 前把完整返回值记录到 `memory/search`。
- package invariant 拒绝声明 workspace 与 owning session 不同的 event。
- Loader-composed test 通过已安装的 tool，检查 JSON result 和 durable event。
- 真实 headless Loader 和 AgentLoop 测试证明，已记录的 TencentDB context 在 model request 中位于直接 prompt 之前。
- TencentDB request 保留配置的 v3 isolation tuple，校验业务 response envelope，并且启用的 runtime route 绝不暴露 deterministic stub。

## Risks

Local provider 只搜索 session history。TencentDB L2 没有提供 semantic search endpoint，因此 DSH 只在有界的 scenario path 和 summary metadata 上匹配，再读取选中项；它不会扫描每个 scenario body。所有远程层都必须在 model 使用前定义 provider-specific authorization、response bounds、failure behavior 和 durable event semantics。
