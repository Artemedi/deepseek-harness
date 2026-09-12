# Experimental Memory Service

[English](README.md) | 中文

`@deepseek-ai/dsh-experimental-memory` 在 DSH session-query corpus 上提供显式、经 workspace 授权的检索。

该 service 接受精确的 live `Agent`，从 `agent.session.header.cwd` 推导 workspace，校验 request bounds，再把检索委托给 provider-neutral search interface。已提供的 `local` provider 从同一 workspace 的 session event 读取有界 citation，并且必须存在于配置的 provider set 中。Provider 配置在加载时解析：空、重复、未知或缺少 `local` 的 route 会在任何 search 运行前失败。该 service 不存储 provider state，不注入 prompt content，也不替代 session persistence。`memory/search` event 会在 consumer 把结果交给后续 model request 前，记录精确的规范化 query 和 citation。

TencentDB 通过 `providers: ['local', 'tencentdb']` 和包含 `baseUrl`、memory-instance `serviceId`、非空 `isolationBindings` 列表的 `tencentdb` object 显式启用。每个 binding 把一个绝对 DSH workspace 及其持久日志中的有效 agent preset 映射到已配置的 TencentDB Team、Agent 和 User 标识符；省略 `agentPreset` 只匹配未通过 preset 组合的 session。重复的 DSH scope 和多个 scope 复用同一个 TencentDB Team/Agent profile 会在加载时失败，未绑定调用方则在 HTTP 前失败。这样可在 L1-L3 保持 DSH workspace authorization boundary；Team 和 User 仍由部署显式提供，因为 DSH 没有通用 Team 或已认证 User service。`baseUrl` 必须是纯 HTTP(S) origin，不得包含 userinfo、path、query 或 fragment。数字 loopback Gateway 可以省略 `credentialRef`；即使 Gateway authentication 已关闭，DSH 仍会发送上游 v3 parser 要求的非秘密 bearer marker。`localhost` 等 hostname alias 和所有非 loopback Gateway 都要求非空 DSH credential，其中必须包含非空 Gateway bearer secret；已显式配置但无法解析的 credential 不会 fallback。远程 body 会在 `maxResponseBytes` 内流式读取，并在超限时立即取消，即使响应没有 `Content-Length`；redirect 仍会被拒绝。Native route 把 TencentDB L1 atomic search、L2 scenario profile 和单一 L3 core profile 映射成有界 citation。L2 candidate 按有界 scenario-list path 和 summary 中的 literal query match 排序，随后至多读取剩余 hit limit 数量的项目；忽略目录，list 和所有选中 read 共用一次 operation deadline。上游没有公开相应能力时，DSH 不宣称 semantic L2 search。`automaticCapture: true` 在 Agent 进入 idle 后通过 `POST /v3/conversation/add` 导出 completed 和 max-token turn；排除 synthetic user context，执行上游 100 条消息和 8192 字符限制，校验完整 acceptance result，并在远程操作前后记录持久的 requested、succeeded 或安全 failed event。Capture 仍为 at least once，因为固定版本的上游 route 为每次 retry 生成新 ID，且不接受 idempotency key 或 client message ID。`automaticRecall: true` 在第一步前按 `automaticRecallDepths`（默认 `['L1']`）运行，所有层共享一个 count 和 byte budget，把精确组合结果记录到 `memory/search`，并将 citation 作为标明可能过时且不构成指令的独立 user message 输入。失败层只记录封闭 memory diagnostic vocabulary 中的代码，保留成功层且不阻塞 model turn；cancellation 仍然向上传播。未启用 TencentDB 时开启任一 automatic operation，或缺少连接和隔离配置时启用 route，都会在 composition 加载期间失败。Endpoint、credential、isolation、capture 和 recall 的变更需要重新加载 composition。

`tencentdbRuntime` 让 DSH 拥有同机 standalone MemoryCore process。无论 composition 顺序如何，它都会等待 `@deepseek-ai/dsh-subprocess-local`，在解析 credential 前拒绝 remote 或未指定的 execution world，在 `cwd` 中启动 `args`，显式转发已配置的现有 LLM credential，并要求激活前收到精确的 `{ "status": "ok" }` health envelope。Unload 或 HMR 时会终止完整 process tree。`dataDir` 保存本地 SQLite 和 file state；`gatewayConfig` 默认为 `tdai-gateway.standalone.yaml`。启动时会拒绝非数字 loopback 或带 path 的 endpoint、缺失 LLM credential、已有 HTTP listener、process 提前退出或 readiness timeout。LLM URL 本身可以指向本地 OpenAI-compatible service，因此 managed mode 不要求第三方 memory service。由于上游不发布 standalone Gateway executable，runtime 必须是由 operator 安装并固定到已审查 commit 的 checkout；DSH 不会在应用启动期间 clone 或安装可变外部代码。

OpenViking 通过 `providers: ['local', 'openviking']` 和包含纯 HTTP(S)-origin `baseUrl`、可选非空 `credentialRef`、可选非空 trusted `targetUri` 的 `openviking` object 显式启用。Native route 调用已确认的 `POST /api/v1/search/find` endpoint，传入 `query`、`limit` 和配置的 target URI。它把 `result.memories`、`result.resources` 和 `result.skills` record 映射为 opaque citation，并应用 DSH 选择的 `L0`、`L1` 或 `L2` depth、流式 response bound、timeout、cancellation、redirect rejection 和 typed failure。没有该 object 时，route 为 deterministic local stub。Adapter 不使用 session context，也不进行 implicit prompt injection。

## Model Experience

### Service output

#### What the model sees

Service 本身不注册 model-facing schema 或 prompt text；`memory_search` 负责显式展示其有界 citation。

#### Token effect

除非已组合的 consumer 展示返回的 citation，否则该 service 不增加 token。

#### KV Cache effect

除非 consumer 显式记录并展示结果，否则该 service 不增加 model context。

## Known Limitations and Deferred Work

- **Layered recall** — TencentDB 接收 L0 conversation turn 并自行执行 asynchronous extraction。`memory_search` 接受 TencentDB L1-L3 depth。Automatic recall 默认为 L1，也可选择 L2/L3，同时保持一个 aggregate result 和 byte budget。
- **Capture delivery** — DSH 在发送 turn 前 flush 持久 request，并在之后记录 outcome。Remote success 与本地 success event 之间发生 crash 时可能重发该 turn；必须由 TencentDB message identity 或未来的 idempotency key 关闭这个 at-least-once window。
- **Opt-in HTTP routes** — TencentDB 和 OpenViking HTTP provider 只通过显式 provider 配置选择；默认 DSH/Web composition 保持不变。OpenViking 保留 deterministic local stub 用于 contract test。TencentDB 接受外部管理的 Gateway，或由 DSH 管理且 operator 已安装的 local runtime。
- **OpenViking scope** — Native route 使用已确认的 `/api/v1/search/find` envelope 和 trusted deployment `targetUri`；不会从 DSH filesystem path 或 provider response field 推导 tenant authorization。需要 multi-tenant scope 时，部署必须提供隔离的 target URI。
- **Upstream distribution** — Managed mode 需要已安装并固定 commit 的 MemoryCore checkout，因为当前 upstream npm package 没有 Gateway executable。Configuration load 不会下载 package、clone repository 或 pull container。
- **Remote durable fields** — Remote hit 省略 DSH session ID 和 event sequence，因为它们不是 first-party session record。`memory/search` 保留 provider ID、opaque source、kind、title 和精确有界 content。
- **Binding migration** — 移动 workspace 或重命名其 agent preset 需要新 binding；DSH 不移动或合并已有 provider-side profile。
