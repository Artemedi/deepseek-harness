# TencentDB Agent Memory 集成

[English](README.md) | 中文

## 前置条件

- 带 npm 的 Node.js 环境
- 已在本地安装并固定版本的 MemoryCore 运行时（由操作员安装并固定到具体提交；上游不发布独立的 Gateway 可执行文件）
- 可访问的 SQLite 数据目录路径
- 供 MemoryCore 提取记忆使用的 OpenAI 兼容 LLM（本地或远程；DSH 通过环境变量把 LLM 配置转发给 MemoryCore）
- 对于数值 loopback（`http://127.0.0.1:8420`）：无需单独的 memory API key；DSH 会发送上游 v3 解析器要求的非秘密 bearer 格式
- 对于非 loopback Gateway：DSH 凭据中必须保存 Gateway bearer secret，并通过 `credentialRef` 引用
- 对于所有 Gateway：`baseUrl` 必须是纯 HTTP(S) origin；userinfo、path、query 和 fragment 会被拒绝

## 受管模式与外部模式

- **受管模式**：DSH 通过 `memory.cordis.yml.example` 中的 `tencentdbRuntime` 启动并拥有本地 MemoryCore 进程。它等待 local-host 子进程提供方，在配置的 `cwd` 中启动进程并显式转发 LLM 凭据，拒绝非 loopback 端点和提前退出的进程，要求激活前收到精确的 `{ "status": "ok" }` 健康响应，并在卸载或 HMR 时终止整个进程树。
- **外部模式**：DSH 通过 `memory.cordis.yml.example` 中的 `tencentdb.baseUrl` 连接已经运行的 Gateway。DSH 不负责启动或停止 Gateway 进程。

## Loopback 与非 loopback 认证

- 数值 loopback（例如 `http://127.0.0.1:8420`）无需单独的 memory API key。DSH 会发送上游 v3 解析器要求的非秘密 bearer 格式。
- 非 loopback Gateway 要求在 `tencentdb` 中设置非空 `credentialRef`；DSH 把解析出的非空 secret 作为请求 bearer token 发送。外部 Gateway 的操作员需要配置与之匹配的服务端 secret。在受管模式中，设置 `credentialRef` 后 DSH 还会把解析出的 secret 作为 `TDAI_GATEWAY_API_KEY` 转发。

## 步骤 1：配置 MemoryCore

在 `integrations/tencentdb-agent-memory` 目录中创建 `memory.cordis.yml.example`，并配置以下字段：

`tencentdb` 下的必填字段：

- `baseUrl`：`http://127.0.0.1:8420`
- `serviceId`：`default`
- `isolationBindings`：一项或多项精确映射，把 DSH 的绝对工作区和当前有效的 agent preset 映射到已配置的 TencentDB `teamId`、`agentId` 和 `userId`；仅当会话没有通过 preset 组合时才省略 `agentPreset`
- `credentialRef`：loopback 时省略；非 loopback 时设为 DSH 凭据引用

仅受管模式使用的 `tencentdbRuntime` 字段：

- `command`：`node`
- `args`：`[--import, tsx, src/gateway/server.ts]`
- `cwd`：`/absolute/path/to/TencentDB-Agent-Memory/MemoryCore`
- `dataDir`：`/absolute/path/to/local/tdai-memory`
- `gatewayConfig`：`tdai-gateway.standalone.yaml`
- `llmCredentialRef`：`DEEPSEEK_API_KEY`（占位示例）
- `llmBaseUrl`：`https://api.deepseek.com/v1`（或本地 LLM URL）
- `llmModel`：`deepseek-chat`（或本地模型名称）

确保数据目录存在且可写。

## 步骤 2：为 MemoryCore 配置 LLM

MemoryCore 执行记忆提取，并需要 OpenAI 兼容 LLM。在 `tencentdbRuntime` 中设置 `llmBaseUrl`、`llmModel` 和一个已有的 DSH `llmCredentialRef`；引用无法解析时，DSH 会拒绝启动。本地端点可以忽略转发的 `TDAI_LLM_API_KEY`，但配置的凭据引用仍必须能够解析。

## 步骤 3：启动组合

在受管模式中，使用包含 `tencentdbRuntime` 的组合启动 DSH。DSH 会启动 MemoryCore 子进程、等待其就绪，并把进程树绑定到插件 fiber。在外部模式中，由操作员启动 Gateway，DSH 再连接 `tencentdb.baseUrl`。

## 步骤 4：运行冒烟测试

运行 `pnpm smoke:tencentdb-memory`。脚本接受以下环境变量：

- `TDAI_MEMORY_ENDPOINT`：`http://127.0.0.1:8420`
- `TDAI_MEMORY_API_KEY`：`dsh-local-loopback`
- `TDAI_MEMORY_INSTANCE_ID`：`default`
- `TDAI_MEMORY_TEAM_ID`：`dsh-smoke`
- `TDAI_MEMORY_AGENT_ID`：`dsh`
- `TDAI_MEMORY_USER_ID`：`local-user`

脚本输出 JSON 对象，其中 `health`、`capture`、`l1SearchEnvelope`、`l2ListEnvelope`、`l3ReadEnvelope` 和 `cleanup` 字段应为 `"ok"`。`l0Count` 始终为 2（冒烟测试会发送两条消息）。`l1Count`、`l2Count` 和 `l3Present` 取决于 MemoryCore 数据，并非固定值。

## 步骤 5：故障排除

- **健康检查失败**：确认 MemoryCore 进程正在运行，并检查日志、健康端点 URL 和端口。
- **捕获失败**：确认同时发送了用户和 assistant 消息、会话 ID 一致且 bearer token 正确。
- **L0 消息接收失败**：确认两条消息（用户和 assistant）均已发送并被接受，且会话 ID 唯一。
- **L1 搜索失败**：检查查询字符串、限制值以及搜索端点是否返回 items。
- **L2 列表失败**：确认场景数据可访问、结果包含 entries，且列表端点可达。
- **L3 读取失败**：确认 content 是字符串，并检查 core read 端点是否返回有效数据及其内容长度。
- **清理失败**：确认会话删除请求成功，且会话已从会话存储中移除。
- **常规检查**：确认 SQLite 数据目录包含预期文件、环境变量已设置，并且没有硬编码 secret。
- **响应过大或被重定向**：DSH 在配置的字节预算内流式读取响应，body 超限时立即取消，并拒绝 redirect。请检查 Gateway 响应大小和直接 endpoint URL。

## 组件端口

- 端口 **8420**：MemoryCore Gateway（`smoke.mjs`、`memory.cordis.yml.example` 中的 `tencentdb.baseUrl`）
- 端口 **8096**：DSH LLM proxy 路由（`dsh-settings.yaml.example`、`probe.py`）

这是两个不同的组件。MemoryCore Gateway 暴露 `/v3/*` 端点；DSH proxy 暴露 OpenAI 兼容的 `/chat/completions`。
