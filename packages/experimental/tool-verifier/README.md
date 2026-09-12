# @deepseek-ai/dsh-experimental-tool-verifier

English | [中文](README.zh.md)

`@deepseek-ai/dsh-experimental-tool-verifier` registers the explicit model-facing `verify_pair` tool over `ctx.verifier`. It compares two caller-supplied evidence records against a rubric and returns the schema-validated `score-v1` result. It does not run deterministic checks, edit files, select a winner, or complete a goal.

## Model Experience

### Tool output

#### What the model sees

`verify_pair` accepts a rubric, two stable candidate ids, and bounded evidence strings. It returns `schema_version`, `probability_left`, and a concise rationale. The tool description tells the model that a score is not a correctness proof and should follow deterministic checks.

#### Token effect

The input and output consume one model-visible tool round on the calling agent, plus one bounded external verifier request. The result is compact and schema constrained.

#### KV Cache effect

The tool contributes no persistent prompt section. The normal DSH tool call and result events retain the request and response for replay.

## Known Limitations and Deferred Work

- **Explicit only** — the tool is not automatically invoked after a turn or goal round.
- **No deterministic checks** — tests, typecheck, diff, and security checks remain caller-owned evidence.
- **No tournament** — compare both orders and best-of-N orchestration belong to a future workflow consumer.
- **Opt-in package** — this tool is not part of the default base or Web bundle.
