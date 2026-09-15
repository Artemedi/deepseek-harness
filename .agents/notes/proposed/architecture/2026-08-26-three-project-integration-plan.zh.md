# Agent Note: 三个外部记忆与编排项目的集成

Status: proposed

[English](2026-08-26-three-project-integration-plan.md) | 中文

## 问题

OpenViking、TencentDB-Agent-Memory 和 Ruflo 都提供有价值的 agent 基础设施，但它们分别重叠 DeepSeek Harness 的不同部分。直接嵌入三个项目会产生相互竞争的会话存储、记忆注入、agent 生命周期、任务编排和工具注册表。如果外部记忆在 DSH 会话日志之外注入，还会使模型可见上下文无法回放重建。

三个项目的集成成本也不同。TencentDB-Agent-Memory 提供 OpenAI 兼容的 Memory Proxy，并记录了 DeepSeek Harness 客户端路径。OpenViking 是使用 `viking://` 资源的独立 Python 上下文数据库，许可证为 AGPLv3。Ruflo 是完整的 meta-harness，其 swarm、workflow、memory 和 hook runtime 与 DSH 现有的 `ctx.subagents`、`ctx.agentTeams`、`ctx.workflowEngine`、`ctx.jobs` 和会话持久化重叠。

## 提案

分层集成这些项目，同时让 DSH 继续拥有 agent loop、会话日志、工具授权、持久化和插件组合。

### 优先级 0：网关错误透明度

将免费模型路由中每次出现 `This turn failed` 和 `{"type":"api_error","message":"Upstream error."}` 的情况视为发布阻断级可靠性问题。在启用任何外部记忆注入前，先端到端追踪并测试该路径。网关必须保留有界且脱敏的提供方事实，分类可重试性，并让故障在 DSH 会话日志和 UI 中可见。记忆集成不能掩盖实际失败的组件。

### 阶段 1：验证 TencentDB Proxy

把 TencentDB Agent Memory 作为外部服务使用，而不是替换 DSH 持久化。使用独立的 memory 和 proxy LLM 配置启动 `memory-core`、`memory-hub` 和 `proxy`。将非生产 DSH profile 的 `llm-deepseek.baseURL` 指向 `/dsh/<spaceId>`，并通过 DSH credentials 存储 proxy `user_key`。验证会话初始化、team／agent／task 绑定、记忆注入、压缩绕过、标题请求、工具调用、流式响应、重试行为和网关错误保留。该 profile 保持 opt-in，并保留直接上游提供方配置以便回退。

Proxy 是运行时兼容层。DSH 仍负责本地持久会话日志和回放。只有在集成测试证明请求中的表示方式以及如何为回放重建之后，才可接受 Proxy 注入的上下文；隐藏且未记录的模型可见状态不能成为永久集成。

### 阶段 2：DSH memory capability

定义实验性的 `ctx.memory` Service Definition，提供有界的 `search`、`store` 和可选 `commit` 操作。增加由现有 session-query 和 domain storage 支撑的本地 provider。仅针对显式记忆操作增加 model-facing consumer；每个返回的记忆项都携带 id、scope、source 和有界内容。结果在影响后续模型请求前记录为持久会话事件。授权按 user、workspace、team、agent 和 task 限制记忆范围；provider 故障不能静默变成空记忆。

这个 seam 是稳定的 DSH 集成点。TencentDB 和 OpenViking 后续实现该 seam，而不把各自 runtime 导入 agent loop。未来的 Web 投影可以根据会话事件显示记忆引用和提交状态。

### 阶段 3：TencentDB 原生适配器

使用 TencentDB Agent Memory 的 Memory Core 或 SDK API，为 DSH memory seam 实现 provider，而不是依赖 Proxy 改写 prompt。把 Chat Memory、Skill、Wiki 和 CodeGraph 映射为独立的类型化资源。保持 team／agent／task scope 显式。使用有界且带引用的 recall 结果，并把 recall observation 追加到 DSH 日志。把远程提交视为异步派生状态，带有重试和可见故障；它不能成为 DSH 会话事实来源。

### 阶段 4：OpenViking 适配器

把 OpenViking 作为可选远程上下文 provider，放在同一个 memory／resource seam 后面。将 `viking://` URI 映射为不透明的 branded resource id，并显式暴露分层的 L0／L1／L2 读取。将检索轨迹作为有界 observation 记录。不要把 OpenViking vendor 或链接进 DSH 的 MIT 分发物；由于上游是 AGPLv3，应将其作为独立服务部署，并通过其支持的 client／API 协议通信。

### 阶段 5：在 DSH 原语上采用 Ruflo 模式

不要嵌入 Ruflo 的 scheduler 或 agent runtime。只把有用模式作为 DSH 功能采用：声明式角色 preset、显式任务 DAG 依赖、coordinator report、有界 fan-out、成本预算、重试和 review 阶段。使用 `ctx.agentTeams`、`ctx.subagents`、`ctx.workflowEngine`、`ctx.jobs` 和已有的持久 Team task 事件来实现。只有在 Web 控制、多进程策略和授权要求解决后，才考虑将实验性 Agent Teams 提升为稳定功能。

## 考虑过的替代方案

- **把三个 runtime 都嵌入同一个 bundle。** 拒绝，因为它会重复生命周期、持久化、记忆注入和编排所有权，并产生不清晰的故障语义。

- **把 TencentDB Proxy 作为永久 DSH memory 集成。** 拒绝，因为外部 Proxy 的 prompt 改写本身无法满足 DSH 的回放和模型可见日志规则；它只保留为有用的第一阶段运行验证路径。

- **使用 OpenViking 作为 DSH 会话数据库。** 拒绝，因为 DSH 的仅追加会话日志负责回放、fork、UI fidelity 和持久模型历史；OpenViking 是上下文数据库，不是可直接替换的会话持久化 provider。

- **用 Ruflo swarm 替换 DSH Agent Teams。** 拒绝，因为 DSH 已经拥有可继续子 agent 生命周期、直接 parent 授权、持久 mailbox 和任务 DAG 语义。无需第二套 runtime 即可采用 Ruflo 模式。

- **Vendor OpenViking 源码。** 拒绝，因为 AGPLv3 许可证和 Python 服务 runtime 不符合当前 DSH package 与分发边界。

## 后果

TencentDB 是第一个实践实验，因为它记录了兼容 DSH 的 Proxy 路径，并且无需修改 DSH 源码即可评估。第一个 profile 依赖外部服务，因此不会成为默认部署。DSH-native memory seam 需要新的 experimental package、事件词汇、授权模型、provider contract 和回放覆盖，但它能防止未来集成绕过 DSH 核心不变量。

OpenViking 和 TencentDB 会成为可替换的 provider，而不是 harness 内部相互竞争的产品。Ruflo 提供编排配方和评估标准，而 DSH 保留一个 agent loop、一个会话日志、一个工具流水线和一个授权模型。

运行时验证需要 Node.js、pnpm 以及 Docker 或等效服务部署。当前开发环境缺少这些可执行文件，因此服务启动、DSH 构建和集成测试要等工具链恢复后执行。
