# Agent Note: 无状态码的上游过载消息归类为可重试的服务器故障

Status: implemented

[English](2026-09-13-unstatused-overload-message-classified-as-server.md) | 中文

## Problem

对 DSH 真实会话日志的取证分析追查到一个本地托管的、OpenAI 兼容网关的反复失败，根源在 `dsh-llm-pi-ai` 的 `classifyPiAiError`。该网关把上游的容量故障转发为一个扁平化的错误正文,自身不带任何数字 HTTP 状态码,措辞为 `Upstream error from Nvidia: Service temporarily overloaded`。`classifyPiAiError` 的所有模式都未命中：没有 `401`/`403`/`429`/`5xx` 数字，也没有 `timeout`、`network`、`connection` 或 `stream ended` 措辞。该消息落入了通用的 `PI_AI_ERROR` 代码。

`dsh-llm-retry` 的 normal 模式只重试 `EMPTY_RESPONSE`、`RATE_LIMIT`、`SERVER`、`TIMEOUT` 和 `TRANSPORT`。`PI_AI_ERROR` 不在此集合中，因此每次出现都会立即呈现为终止性的 turn 错误，而不会进入该 provider 配置的重试预算——而这种后端故障模式（"overloaded"、"temporarily overloaded"）本质上是瞬态的，无需调用方干预即可自行恢复。

## Decision

`classifyPiAiError` 现在匹配 `/\boverloaded\b/i` 并返回 `SERVER`，与已有的裸 `upstream error.` 及 `5xx` 数字模式并列，这些模式已经覆盖了其他无状态码、经网关扁平化的正文。该匹配大小写不敏感、基于单词边界，因此能覆盖 "overloaded"、"temporarily overloaded" 及类似的上游措辞，而不依赖特定厂商的确切措辞。

## Testing

`packages/llm/llm-pi-ai/tests/adapter.spec.ts` 新增了一个用例，与已有的 "flattened gateway upstream envelope" 测试呼应：一个携带上述确切消息的 `503` 响应正文，经真实的流式 adapter 归类为 `{ code: 'SERVER' }`，而不仅仅是内部分类函数层面。

## Alternatives considered

**匹配观察到的具体厂商字符串（"Nvidia"）。** 已拒绝：该故障模式是通用的网关容量问题，而非厂商特有；将模式与某一上游的名称绑定，会漏掉任何其他经网关扁平化、位于 OpenAI 兼容路由之后的后端发出的相同措辞。

**新增第五个可重试代码，而不是复用 `SERVER`。** 已拒绝：过载的后端是一种服务器侧容量故障，相对现有 `SERVER` 代码的重试处理没有新的、面向调用方的区别；新增代码只会重复 `SERVER` 的分类，而不会改变行为。

## Consequences

网关在不带数字状态码的情况下报告过载的 provider（此处观察于一个本地免费层路由器）现在会按其配置的 `retryPolicy` 重试，而不是在首次出现时就使 turn 失败。该模式刻意保持窄范围（仅 `overloaded`）；其他未分类的网关措辞仍会落入 `PI_AI_ERROR` 并保持不可重试，直到有具体的观察案例证明需要扩大分类器范围。
