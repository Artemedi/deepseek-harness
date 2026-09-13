# Agent Note: 子 agent 委派的显式模型防护与请求路由可见性

Status: implemented

[English](2026-09-13-explicit-model-guard-for-subagent-delegation.md) | 中文

## Problem

`dsh-tool-subagent` 的 `spawn`/`fork` 路由会在子 agent 启动那一刻，静默继承父级 Agent 当时使用的任意模型（`agentOptions` 缺失时）。一次取证性的会话日志复盘现场证实了这一点：某部署把一个 `tool-subagent` 实例专门绑定到一条成本受控的路由（免费层网关），却无法让 `agentOptions` 的意外遗漏在加载时就失败——子 agent 会悄悄搭上父级当下、可能毫不相关且可能昂贵的模型。要知道子 agent 到底用了哪条路由,唯一办法是打开它自己的会话日志读取 `request/header`,因为父级自身的会话记录里只有 `started subagent <id>`,什么都没说明。

## Decision

`tool-subagent.Config` 新增 `requireExplicitModel?: boolean`（默认 `false`）。设为 `true` 时，`apply()` 会拒绝挂载，除非 `agentOptions.provider` 和 `agentOptions.model` 都是非空字符串——这与 `maxDepth` 的能力检查已经采用的"在最早可判定的时点大声失败"处理方式相同，而不是推迟到第一次委派时才做运行时检查。该开关只针对这个工具自身的配置；它不检查提供方能力，因为那些独立于 `agentOptions` 自行选择模型的提供方（`claude-code`、`codex`）无论该字段是否设置都会忽略它，不受影响。

另外，每一条 `started subagent <id>` / `started background subagent job <id>` 结果现在都会附带所请求的路由：当 `agentOptions` 同时命名了两者时为 `(provider/model)`，只设置其一时为部分形式 `(model: …)` / `(provider: …)`。这把"请求了什么"直接放进父级自身的会话记录；而某个多后端网关实际服务请求所用的"有效路由"，已经存在于子 agent 自己的 `request/header`/`responseModel` 中，只需多看一个会话，而不必为了知道当初请求了什么而去做 provider/config 考古。

## Alternatives considered

**新增一个提供方能力（例如 `SubagentCapabilities.requiresAgentOptions`），而不是仅在配置层加开关。** 本轮拒绝：这需要每一个现有及未来的进程内提供方都去声明它，是一个更大的、跨包的表面改动；而运维方本就清楚哪些实例需要固定路由——在需要的那一行加配置开关是更窄的修复。如果"在忽略 `agentOptions` 的提供方上设置该开关"这种能力盲区在实践中造成明显代价，再重新考虑。

**把有效路由也放进父级会话记录（不只是请求路由）。** 已拒绝：在内部跨后端负载均衡的网关上，有效路由可能逐次请求各不相同（已观察到：`dsh-agent` 在不同调用中解析为不同的上游模型），把它复制进父级会话会重复子 agent 自身持久化日志已经拥有的数据，而这个事实的变化与父级的回合无关。子 agent 的 `request/header`/`responseModel` 仍然是"这次请求实际由谁服务"的唯一来源。

## Consequences

在某个 `tool-subagent` 行上设置 `requireExplicitModel: true` 的部署，会获得一个加载期保证：这条路由永远不会静默继承父级的模型；遗漏 `agentOptions` 现在会是一个指明修复方式的启动期错误，而不是日后才在账单或会话日志复盘中发现的悄然成本意外。依赖继承的既有实例不受影响——默认值为 `false`，当 `agentOptions` 未设置时，请求路由文本的追加内容为空，因此此前所有不带 `agentOptions` 的 "started subagent"/"started background subagent job" 断言均保持不变。
