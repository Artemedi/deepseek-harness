# Handoff (обновлено: 2026-08-30)

## Текущая задача

Шестислойная модель памяти агента развёрнута и зафиксирована
([Agent Note: 2026-08-30-six-layer-agent-memory-model](.agents/notes/implemented/process/2026-08-30-six-layer-agent-memory-model.md),
commit `924f6461e4`). Активный продуктовый WIP по-прежнему — фаза 2 из
[three-project integration plan](.agents/notes/proposed/architecture/2026-08-26-three-project-integration-plan.md):
локальный `memory_search` провайдер поверх `ctx.sessionQuery`. План:
`.agents/plans/experimental-memory-search.md`.

## Состояние

- ✅ Принята и применена шестислойная модель памяти: `AGENTS.md` (≤1400 слов,
  бюджет в `scripts/doc-budgets.manifest.json` понижен с 1950), `.agents/HANDOFF.md`,
  `.agents/plans/`, `.agents/knowledge/` (5 тем), `.agents/notes/` (без
  изменений), `git log` как история.
- ✅ Заменён "README + audit_log" подход: внешний `audit-2026-08-30.json` НЕ
  импортирован; его 2 DSH-релевантных факта (`bwrap` недоступен, зомби
  `package.json)`) свернуты в `.agents/knowledge/sandbox.md` как
  re-checkable one-liners.
- ✅ ADR остались `architecture`-классом Agent Notes; `docs/adr/` не создан.
- 🔄 WIP: локальный `memory_search` провайдер (scope из `SessionHeader.cwd`,
  not model args), `memory/search` event с bounded citations, append-time
  workspace invariant. См. `.agents/plans/experimental-memory-search.md`.
- ⏳ Фазы 1, 3–5 интеграции (TencentDB proxy validation, native adapter,
  OpenViking, Ruflo-паттерны) — not started.

## Следующий шаг

Реализовать локальный search-only провайдер в `packages/experimental/memory/`
+ `packages/experimental/tool-memory/`. Контракт — в
[.agents/notes/proposed/architecture/2026-08-26-experimental-memory-search.md](.agents/notes/proposed/architecture/2026-08-26-experimental-memory-search.md).

## Открытые вопросы / блокеры

- **Risk-based cross-review policy** (Agent Note 2026-08-30) принята, но
  порог "significant" для non-trivial changes требует уточнения до первого PR
  по `memory_search`.
- **TencentDB proxy testbed** (фаза 1) не поднят — не блокер для локального
  провайдера (фаза 2 автономна).

## Грабли, актуальные для этой задачи

- **`bwrap` недоступен** в этом sandbox (`spawn bwrap ENOENT`). Use host
  escalation only с sandbox evidence. См. `knowledge/sandbox.md`.
- **232 зомби `packages/*/<pkg>/package.json)`** — артефакты прерванного
  `pnpm install`. Не `git add`. Чистить через `pnpm run clean`.
- **`dsh web` из исходников** запускает tsx ESM hook. Не стартовать отдельный
  Vite — только DSH web инжектирует `window.__DSH_BOOT__`.
- **`test:e2e`** self-skips без `DEEPSEEK_API_KEY`. `test`, не `test:coverage`,
  — unit tests. CI coverage gate — `test:coverage`.
- **`--force` запрещён** для rebase/merge — только `--force-with-lease`, abort
  on remote movement.
- **lefthook pre-commit требует `node` в `PATH`** — в этом sandbox node
  находился в `/var/home/Trintos/projects/bitvec-dsh/node-v22.11.0-linux-x64/bin/`
  и не на PATH. С добавлением пути hook проходит.

## Known debt

Pre-existing verifier violations (НЕ введены этим change, присутствовали до
него) — записаны здесь, чтобы последующие сессии не тратили время на их
диагностику:

1. `structure: analysis/ — unknown lifecycle folder` (verify-agent-note-format).
   Папка `.agents/notes/analysis/` не входит в closed set
   `proposed/implemented/rejected/archived`.
2. `format: proposed/architecture/2026-08-26-three-project-integration-plan.md —
   missing the required \`## Acceptance criteria\` section` и аналогично
   `## Risks`. Plan-note не дописан до `proposed/` skeleton.
3. `verify-translation-pairing.ts` падает на Node 22.11 с
   `TypeError: options.exclude must be a function. Received an instance of Array` —
   pre-existing tooling incompatibility, не mismatch пары. `verify-translation-pairing
   --write <file>` корректно пишет sidecar; corpus-wide check требует фикса
   скрипта под текущий Node API.

## Память

Протокол + шестислойная таблица: [`.agents/knowledge/memory.md`](.agents/knowledge/memory.md).
Agent Note о принятии модели: [2026-08-30-six-layer-agent-memory-model](.agents/notes/implemented/process/2026-08-30-six-layer-agent-memory-model.md).
