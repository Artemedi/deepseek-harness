# @deepseek-ai/dsh-experimental-tool-verifier

[English](README.md) | 中文

`@deepseek-ai/dsh-experimental-tool-verifier` 通过 `ctx.verifier` 注册显式的 model-facing `verify_pair` 工具。它依据 rubric 比较两条由调用方提供的 evidence record，并返回经过 schema 验证的 `score-v1` 结果。它不运行 deterministic check、不编辑文件、不选择胜者，也不完成 goal。

## Model Experience

### Tool output

#### What the model sees

`verify_pair` 接受 rubric、两个稳定的 candidate id 和有界 evidence string。它返回 `schema_version`、`probability_left` 和简洁 rationale。工具描述会告知模型：分数不是正确性证明，并且应在 deterministic check 之后使用。

#### Token effect

input 和 output 在调用方 agent 上消耗一轮 model-visible tool round，外加一个有界 external verifier request。结果紧凑且受 schema 约束。

#### KV Cache effect

该工具不贡献持久 prompt section。正常的 DSH tool call 和 result event 会保留 request 与 response 以供 replay。

## Known Limitations and Deferred Work

- **仅显式调用**——该工具不会在 turn 或 goal round 后自动运行。
- **没有 deterministic check**——test、typecheck、diff 和 security check 仍是调用方负责的 evidence。
- **没有 tournament**——双向比较和 best-of-N orchestration 属于未来的 workflow consumer。
- **选择加入的 package**——该工具不属于 default base 或 Web bundle。
