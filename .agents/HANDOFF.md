# Handoff (обновлено: 2026-09-09)

## Текущая задача

Довести TencentDB Agent Memory от экспериментального search provider до полезной native-интеграции. Активный план: [experimental-memory-search.md](plans/experimental-memory-search.md).

## Состояние

- ✅ Local `ctx.memory` и `memory_search` ограничены workspace вызывающего Agent и записывают точные citations в `memory/search` до возврата модели.
- ✅ TencentDB L1 search приведён к v3 контракту: `x-tdai-service-id`, Team/Agent/User identifiers, `data.items` и проверка business envelope.
- ✅ Включённый TencentDB route без реальной конфигурации падает при загрузке; runtime stub удалён.
- ✅ Добавлен opt-in overlay `integrations/tencentdb-agent-memory/memory.cordis.yml.example`.
- ✅ Фокусные tests: 17 passed; package TypeScript checks и `git diff --check` прошли.
- ✅ Opt-in L0 capture экспортирует completed/max-token turns после idle и записывает durable requested/succeeded/failed events; crash-window пока at least once.
- ✅ Opt-in automatic L1 recall выполняется перед первым step, логирует точные citations и fail-open код ошибки, затем добавляет отдельный недоверенный reference context.
- ⏳ L2/L3 recall и live MemoryCore smoke не реализованы.

## Следующий шаг

Добавить bounded L2/L3 recall и live standalone MemoryCore smoke; после этого закрыть real-composition snapshot для automatic recall.

## Открытые вопросы

- Определить отображение DSH user/team/agent identities на TencentDB isolation вместо единственного статического tuple для всего deployment.
- Выбрать at-least-once idempotency: deterministic message IDs или отдельный provider-supported key.
- Зафиксировать fail-open policy для recall outage и bounded durable diagnostic.

## Грабли

- Рабочее дерево уже содержит много чужих untracked файлов, включая каталог `integrations/`; не удалять и не добавлять их массово.
- `pnpm exec` пытается восстановить неполный workspace и выходит в сеть; локальные Vitest/TypeScript запускать через установленные JS entrypoints.
- `tsx` требует IPC вне managed sandbox для генераторов.
- `bwrap` недоступен (`spawn bwrap ENOENT`).

## Known debt (pre-existing, not introduced here)

1. `structure: analysis/ — unknown lifecycle folder` — `.agents/notes/analysis/`
   не входит в closed set `proposed/implemented/rejected/archived`.
2. `2026-08-26-three-project-integration-plan.md` missing `## Acceptance criteria`
   and `## Risks` (required for `proposed/` skeleton).
3. `verify-translation-pairing.ts` падает на Node 22.11 (`options.exclude`
   API change) — corpus-wide, но `--write <file>` работает.

## Память

Протокол и шестислойная модель: [memory.md](knowledge/memory.md).
