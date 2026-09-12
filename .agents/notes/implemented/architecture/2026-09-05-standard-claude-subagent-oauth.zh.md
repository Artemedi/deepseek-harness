# Agent Note: Standard Claude preset 与 Claude Code OAuth 清理

Status: implemented

[English](2026-09-05-standard-claude-subagent-oauth.md) | 中文

## Problem

`web` profile 使用用户编写的 `standard-claude` preset 作为默认 Agent preset。它的 `subagent` 工具通过 Claude Code product provider 委派，而 `subagent_fork` 保持本地执行。过期的 Claude CLI 登录和 host 设置中的废弃代理会导致委派调用异常退出，即使本地 fork 仍然正常。仓库文档此前没有区分这些认证路径，也没有说明哪些 preset 依赖 Claude Code。

## Decision

保留 `standard-claude`，并在 `apps/cli/config/agent-presets/claude/` 下交付 `claude` preset。`claude` preset 将 `subagent` 和 `subagent_fork` 都路由到 Claude Code product provider；`standard-claude` 仅将 `subagent` 路由到 Claude Code；`standard` 则让两条委派路径都保持本地执行。

`subagent-claude-code` provider 使用经过清理的父环境和显式请求环境构造子环境：

```ts
const scrubbedParentEnv = (): Record<string, string> => ({ PATH: '/usr/bin' })
const spec: { env?: Record<string, string> } = {}
const childEnvironment = { ...scrubbedParentEnv(), ...spec.env }
```

`scrubbedParentEnv()` 会移除名称匹配凭据特征以及 `DSH_*` 的变量。它不会把 OAuth token 复制到子进程中。Claude Code 转而使用 host CLI 自身的设置和凭据存储。Claude 设置中过期的 `ANTHROPIC_BASE_URL` 或 `ANTHROPIC_AUTH_TOKEN` 优先于原生 OAuth，可能在无提示的情况下把子进程路由到废弃 endpoint。

package README 记录 OAuth 生命周期、常见的 `invalid-success` 原因、Bundle 要求和安全的 smoke test。operator 从启动 DSH 的同一环境验证 Claude CLI，在必要时刷新登录、移除过期的 provider override，然后启动新的 DSH session，因为 Agent preset 在创建 session 时绑定。

## Preset routing

| Preset | Primary chat | `subagent` | `subagent_fork` | Use case |
|---|---|---|---|---|
| `standard` | free-router | `spawn` | `fork` | 不依赖 Claude Code 的本地委派 |
| `standard-claude` | free-router | `claude-code` | `fork` | 普通 subagent 使用 Claude Code，in-process fork 保持本地 |
| `claude` | free-router | `claude-code` | `claude-code` | 两条委派路径都使用 Claude Code |

## Verification

- 从启动 DSH host 的同一环境运行 `claude -p "say hello"` 成功。
- 使用 Claude-backed preset 时，`dsh plugin --profile <name> list` 显示 `subagent-claude-code`。
- profile dump 将 `standard`、`standard-claude` 和 `claude` 解析为上表所示路由。
- 使用所选 preset 的新 session 能完成相应的委派调用。

## Alternatives considered

**显式转发 host OAuth token。** 拒绝，因为 product provider 有意依赖 Claude CLI 的凭据存储，并清理父环境中类似凭据的变量。把原始 OAuth 材料复制到子环境变量会扩大 secret 暴露范围，并重复 CLI 的刷新生命周期。

**让每个 preset 都通过 Claude Code 路由。** 拒绝，因为 `standard` 必须在没有外部 Claude Code 登录时仍可使用，而 `standard-claude` 有意保留本地 fork 路径。

**保留废弃代理作为 fallback。** 拒绝，因为 Claude Code 让配置的 provider override 优先于原生 OAuth。失效或被限流的 endpoint 因此会破坏本来有效的 host 认证，而不能提供冗余。

## Consequences

operator 可以明确选择本地委派、混合路由或全 Claude 路由。Claude-backed preset 依赖健康的 host Claude CLI 登录和干净的 provider 设置；Claude Code 认证不可用时，`standard` 仍然是 fallback。认证变更对新 session 生效，不会改变已经完成组合的 Agent。
