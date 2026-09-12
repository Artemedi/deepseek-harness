# @deepseek-ai/dsh-experimental-verifier

[English](README.md) | 中文

`@deepseek-ai/dsh-experimental-verifier` 提供选择加入的 JSON-only pairwise verifier service。它通过 `ctx.credentials` 解析 API-key reference，发送有界的 OpenAI-compatible structured-output 请求，拒绝 redirect，并验证完整的 `score-v1` 结果后再返回。

## Model Experience

### Service output

#### What the model sees

service 本身不直接面向模型。可选的 `tool-verifier` package 暴露显式 `verify_pair` 工具。

#### Token effect

每次显式 comparison 产生一个 provider 请求。deployment 通过 `maxTokens` 控制固定输出上限；service 不使用 logprobs。

#### KV Cache effect

service 不修改调用方 agent context 或 session history。tool call 和 result 仍由标准 DSH tool pipeline 记录。

## Known Limitations and Deferred Work

- **单 provider 路由**——该 package 实现一条已配置的 OpenAI-compatible JSON 路由；provider fallback 和 logprob scoring 均已推迟。
- **不具备正确性权威**——结果是概率偏好，必须结合 deterministic test、文件检查和 security check 使用。
- **不自动调用**——service 不检查每个 turn，也不改变 goal completion。pairwise tournament orchestration 仍由显式 workflow 负责。
- **没有 durable evaluation domain**——只要 verification 还是显式工具，标准 `tool/call` 和 `tool/result` 记录就已足够。需要可 replay 的 certified state 时，durable evaluation event 必须由独立 consumer 引入。
- **没有 shipped composition**——deployment 在显式 profile 或 patch 中挂载 service 和 tool；default base 与 Web bundle 均不会启用 provider traffic。
