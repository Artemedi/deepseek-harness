# Handoff (обновлено: 2026-08-30)

## Текущая задача

Шестислойная модель памяти агента принята и зафиксирована в
[Agent Note 2026-08-30-six-layer-agent-memory-model](.agents/notes/implemented/process/2026-08-30-six-layer-agent-memory-model.md)
(commit `d29fdb630e`). Активный продуктовый work-in-progress —
`memory_search` (фаза 2 трёхпроектного плана). План:
`.agents/plans/experimental-memory-search.md`.

## Состояние

- ✅ Шестислойная модель памяти развёрнута: `AGENTS.md` (≤1400 слов, бюджет
  снижен 1950→1400), `.agents/HANDOFF.md`, `.agents/plans/`, `.agents/knowledge/`
  (5 topics), `.agents/notes/` (без изменений топологии), `git log` = история.
- ✅ README+audit_log замещены: внешний `audit-2026-08-30.json` НЕ импортирован;
  2 DSH-релевантных факта свернуты в `knowledge/sandbox.md` как one-liners.
- ✅ ADR ≡ `architecture`-класс Agent Notes; `docs/adr/` не создан.
- ✅ Root `AGENTS.md` прошёл: doc-budgets ✅, md-links ✅, md-wrap ✅, lefthook ✅.
- 🔄 WIP: `memory_search` local provider (`ctx.sessionQuery`, scope из
  `SessionHeader.cwd`).
- ⏳ Фазы 1, 3–5 (TencentDB proxy validation, native/TencentDB/OpenViking/Ruflo) —
  not started.

## Следующий шаг

Реализовать search-only provider в `packages/experimental/{memory,tool-memory}/`
по контеркту в
`.agents/notes/proposed/architecture/2026-08-26-experimental-memory-search.md`.

## Открытые вопросы / блокеры

- **Risk-based cross-review threshold** (Agent Note 2026-08-30) требует
  уточнения "significant" перед первым PR по `memory_search`.
- **TencentDB proxy testbed** — не поднят, блокер для фазы 1, не для фазы 2.

## Грабли

- **`bwrap` недоступен** (`spawn bwrap ENOENT`). Host escalation only с evidence.
- **232 зомби `package.json)`** — артефакты прерванного `pnpm install`. Не
  `git add`. Чистить через `pnpm run clean`.
- **`dsh web` source launch** через tsx ESM hook; не стартовать отдельный Vite.
- **`test:e2e`** self-skips без `DEEPSEEK_API_KEY`; `test:coverage` = CI gate.
- **`--force` запрещён** — только `--force-with-lease`, abort on remote movement.
- **lefthook pre-commit** требует `node` в PATH — в этом sandbox node лежит в
  `/var/home/Trintos/projects/bitvec-dsh/node-v22.11.0-linux-x64/bin/`.

## Known debt (pre-existing, not introduced here)

1. `structure: analysis/ — unknown lifecycle folder` — `.agents/notes/analysis/`
   не входит в closed set `proposed/implemented/rejected/archived`.
2. `2026-08-26-three-project-integration-plan.md` missing `## Acceptance criteria`
   and `## Risks` (required for `proposed/` skeleton).
3. `verify-translation-pairing.ts` падает на Node 22.11 (`options.exclude`
   API change) — corpus-wide, но `--write <file>` работает.

## Память

Протокол + таблица: [`.agents/knowledge/memory.md`](.agents/knowledge/memory.md).
