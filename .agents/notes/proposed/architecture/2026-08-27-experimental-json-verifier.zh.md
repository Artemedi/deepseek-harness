# Agent Note: 实验性 JSON 验证器能力

Status: proposed

[English](2026-08-27-experimental-json-verifier.md) | 中文

## Problem

集成仓库已经确认 Mistral 的结构化输出路由并实现了成对选择器，但 DSH LLM 适配器没有通用的 provider 专用 `response_format.json_schema` 请求契约。向现有模型适配器添加隐藏字段会使 schema 强制执行不可观察且依赖 provider。

## Proposal

添加两个选择加入的实验包：`@deepseek-ai/dsh-experimental-verifier` 提供 `ctx.verifier`，`@deepseek-ai/dsh-experimental-tool-verifier` 提供显式 `verify_pair` 工具。服务通过 `ctx.credentials` 解析 `apiKeyEnv`，发送有界的 OpenAI 兼容 JSON-schema 请求，拒绝重定向，并在返回前验证完整 `score-v1` 结果。工具仅暴露 rubric、候选 id 和有界 evidence；不编辑文件、不运行检查、不选择胜者，也不修改 goals。

这些包不进入默认 base 或 Web bundle。未来 workflow consumer 可以在确定性检查之后调用服务进行成对重排序。验证输出是概率偏好，不是正确性证明；确定性测试、文件检查、diff 检查和安全检查仍然是权威。

## Acceptance criteria

- 选择加入的 service 通过 `ctx.credentials` 解析 `apiKeyEnv`，拒绝重定向，应用一个固定 JSON schema，并拒绝 malformed 或 out-of-bound 结果。
- 显式 `verify_pair` tool 通过正常 tool pipeline 返回 canonical JSON，不改变 agent-loop、goal 或 default-bundle 行为。
- Unit tests 覆盖 credentials、bounds、provider failures、invalid JSON 和 redirects；Loader composition test 从 `cordis.yml` 挂载 service、tool、credentials、system prompt 和 tools。
- packages build 和 typecheck，package invariant 和 README gates 通过，opt-in example 声明每个引用的 workspace dependency。

## Risks

- Provider-specific JSON schema support 可能回归或因 model 而异；每个 invalid response 都 fail closed，需要 review 而不是 fallback。
- 每次 comparison 增加 external request、latency 和 token cost；有界 `maxTokens` 和 explicit invocation 控制这些成本，但不能消除它们。
- LLM preference 可能偏好看似合理但错误的 candidates；仍需要 deterministic evidence，且不自动完成 goal。
- 配置 endpoint 会收到 credential-bearing request；redirect denial 只防止把它转发到 redirect target。

## Alternatives considered

**用隐藏 scorer 字段扩展 `llm-pi-ai`。** 拒绝，因为当前 provider adapter 不向每条 route 承诺这些字段，隐藏请求变更会使 schema 强制执行无法检查或 replay。

**把 scorer 放入 `agent-loop`。** 拒绝，因为显式验证是可选能力，自动的每 turn 调用会为每个 deployment 改变延迟、成本和 loop 语义。

**把 TencentDB/OpenViking memory 用作验证器。** 拒绝，因为这些 provider 提供 context 和 citations，而不是独立正确性评估；过期或受污染 memory 不得成为 authority signal。

**嵌入 Ruflo scheduler。** 拒绝，因为 DSH 已拥有 subagents、workflows、jobs 和 persistence；成对选择是 consumer 问题，不需要竞争性 scheduler。

**把 LLM verdict 当作正确性证明。** 拒绝，因为模型偏好可能有位置偏差、相关错误和分布漂移。低置信度或顺序敏感的结果必须保持可 review。

## Consequences

选择加入的服务为每次显式比较增加一个有界外部请求，并要求 credential reference 和支持所请求 JSON schema 的 provider。重定向拒绝防止 credential 从配置端点转发到重定向目标。服务没有 durable evaluation events，因为显式 tool call/result records 已保存当前 model-visible input 和 output。若经过认证的状态以后影响 goals 或 future turns，需要独立 durable evaluation domain、projection、invariant 和 replay coverage。

## Required verification

package typecheck 和 build 必须通过。service tests 必须覆盖 credential resolution、schema validation、bounds、cancellation、provider errors 和 redirect denial。tool 必须有真实 registry composition test。example composition 必须保持 opt-in 和 keyless；live provider probe 单独记录，绝不能记录 credentials 或原始 provider responses。
