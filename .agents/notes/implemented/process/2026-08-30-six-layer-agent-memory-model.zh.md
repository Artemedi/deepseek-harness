# Agent Note: 采用六层 agent 记忆模型

Status: implemented

[English](2026-08-30-six-layer-agent-memory-model.md) | 中文

## Problem

仓库中的 `AGENTS.md` 既是人类入口又是 agent 使用指南(151 行),将稳定规则与易变事实(构建命令、sandbox 策略、测试方法、vendor 流程)混杂在一起. 人类读起来没问题,但 agent 遵循后往往将"尝试 X 失败"、"bwrap ENOENT"、"幽灵 package.json)" 之类内容追加到 `AGENTS.md`、`LOCAL-SETUP.md` 或一个 ad-hoc `audit_log` 文件中.

两难一起恶化: `AGENTS.md` 把稳定规则和易变事实揉在一起, 而手off 没有单一当前快照. agent 反复将 chronology(尝试与失败)写入越来越大的档案, 迫使每个后续 session 读完整个日志才能找回 3 条可用的事实. 而且把环境特定的 `audit-2026-08-30.json` provider 评测结果也复制到 workspace memory 里, 把实验性结论当作仓库级真理.

## Decision

采用六层记忆模型: 把 agent 提出的每个问题映射到**恰好一个**文件, 从不在 memory 文件存历史.

| 层 | 文件 | 职责 | 由谁更新 |
|---|---|---|---|
| 入口协议 | `AGENTS.md` (根) | 宪章 + start/end 协议 + 链接 | 人类(很少) |
| 当前状态 | `.agents/HANDOFF.md` | 每 session 整份重写, 永不追加 | session 结束时 |
| 活跃计划 | `.agents/plans/<task>.md` | 清单(`## Goal`、`## Checklist`、`## DoD`) | 工作中 |
| 生动知识 | `.agents/knowledge/<topic>.md` | 当前事实、坑(只记事实, 不记 chronology) | 学到稳定知识时 |
| 正式决策 | `.agents/notes/.../yyyy-mm-dd-topic.md` | 决策记录(ADR ≡ `architecture` 类; 不建 `docs/adr/`) | 非平凡决策 |
| 历史 | `git log`、PR 描述 | 真实 audit log | 自动 |

agent 每次 session 的协议:

- **开始:** 读 `AGENTS.md` → `.agents/HANDOFF.md` → 活跃计划 → 按需 topic 知识.
- **结束/重要步骤:** (1) 整份重写 `.agents/HANDOFF.md`; (2) 更新计划清单; (3) 把稳定事实折入 `.agents/knowledge/<topic>.md`; (4) 重要决策写成 Agent Note; (5) 说"完成"前确认 `HANDOFF.md` 当前.

融合关键原则(即"嵌入而不重复"):

- 不建平行的 `.agent/` 目录 — 一切都进已有的 `.agents/`。
- `architecture` 类的 Agent Note 就是 ADR — 不建 `docs/adr/`。
- `.agents/HANDOFF.md`、`.agents/plans/`、`.agents/knowledge/` 凭 scope 豁免于 `verify-agent-note-format`、`verify-translation-pairing`、`verify-doc-budgets`(这些 verifiers 只走 `.agents/notes/`)。
- `.agents/notes/` 保持不变 — 它的格式门、双语配对、lifecycle/class 分类和存档规则仍是权威。
- 外部 `audit-2026-08-30.json` 不导入仓库; 仅将其中对 DSH 相关的事实(`bwrap` 不可用、`package.json)` 幽灵文件)折入 `.agents/knowledge/sandbox.md`, 标记为可复查的单行.
- `knowledge/` 不记 chronology。标注可复查: "截至 `<date>` 观察到; 用 `<cmd>` 复查".

根 `AGENTS.md` 从 151 行裁减为入口文件(≤1400 字预算, 在 `scripts/doc-budgets.manifest.json`)，链接到 `knowledge/*` 而非重复其内容.

## Alternatives considered

**一个巨大的追加式 `memory.md`。** 被拒收: 单一追加文件无限增长, models 在噪声中丢失可用的事实. 六层切分让每个问题都能从一个小文件答到.

**把所有内容移到 `.agents/notes/`。** 被拒收: Agent Note 是带有严格格式门和双语配对的正式决策记录. HANDOFF/plans/knowledge 这类工作性文件需要整写就地、免于格式仪仗;若强塞进 notes 门, 非改格式门非豁免 notes 本身.

**在 `.agents/` 旁建立 `.agent/`(单数)目录。** 被拒收: 建一个平行目录用于同一目的, 成为第二处真理源, 正是原批评中警告的 amb 现象.

**保留 README + 追加式 audit_log。** 这是被废弃的旧态: README 面向人类描述产品; `audit_log` 是 agent 不需要的 chronology. 六层模型把人类文档、当前状态、活跃计划、生动知识、正式决策、历史各自分开.

## Consequences

- 根 `AGENTS.md` 减少 151 行, 混合事实与协议的内容拆到 `knowledge/*.md`(可重写工作事实)与 `AGENTS.md`(入口 + 协议, ~900 字).
- `.agents/notes/` 的格式门、翻译配对、树形遍历均不变 — 新工作目录因 glob 作用域(`.agents/notes/lifecycle/**/*.md`)自然不受其约束.
- 本改动不引入新的 verifier 违规(参见 [.agents/HANDOFF.md#known-debt](../../../../.agents/HANDOFF.md#known-debt))。
