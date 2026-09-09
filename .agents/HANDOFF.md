# Handoff (обновлено: 2026-09-09)

## Текущая задача

Довести TencentDB Agent Memory от экспериментального search provider до полезной native-интеграции. Активный план: [experimental-memory-search.md](plans/experimental-memory-search.md).

## Состояние

- ✅ Local `ctx.memory` и `memory_search` ограничены workspace вызывающего Agent и записывают точные citations в `memory/search` до возврата модели.
- ✅ TencentDB L1 search приведён к v3 контракту: `x-tdai-service-id`, Team/Agent/User identifiers, `data.items` и проверка business envelope.
- ✅ Включённый TencentDB route без реальной конфигурации падает при загрузке; runtime stub удалён.
- ✅ Добавлен opt-in overlay `integrations/tencentdb-agent-memory/memory.cordis.yml.example`.
- ✅ Фокусные memory/tool-memory tests: 60 passed; расширенный subprocess/memory набор до managed-runtime коммита: 305 passed, 2 skipped; package TypeScript checks и `git diff --check` прошли.
- ✅ Opt-in L0 capture экспортирует completed/max-token turns после idle и записывает durable requested/succeeded/failed events; crash-window пока at least once.
- ✅ Opt-in automatic L1 recall выполняется перед первым step, логирует точные citations и fail-open код ошибки, затем добавляет отдельный недоверенный reference context.
- ✅ Standalone Gateway на loopback работает без отдельного bearer secret; DSH отправляет требуемый v3 parser несекретный marker, а non-loopback endpoint требует credentialRef.
- ✅ `tencentdbRuntime` запускает закреплённый локальный MemoryCore через `ctx.subprocess`, ждёт health и гарантированно завершает дерево при unload/HMR.
- ✅ Live standalone MemoryCore smoke подтвердил health, L0 capture/query и envelope endpoints L1 search, L2 list, L3 read на локальном SQLite; повторяемая команда — `pnpm smoke:tencentdb-memory`.
- ⚠️ Live L1 pipeline тоже стартует, но фактическая extraction не завершилась: оба доступных OpenAI-compatible LLM credentials в этом окружении вернули exhausted allowance. Локальный LLM endpoint также подходит.
- ✅ Explicit и automatic TencentDB recall поддерживают L1–L3: L2 идёт через bounded `scenario/ls` + query-matched `scenario/read`, L3 — через singleton `core/read`; слои делят общий hit/byte budget.
- ✅ Real headless Loader/AgentLoop e2e доказывает, что `memory/search` записан, а недоверенный TencentDB snapshot фактически попадает в model request перед direct user prompt.
- ✅ L0 capture соблюдает upstream bounds 100×8192 и проверяет полный acceptance result; delivery честно остаётся at least once, потому что pinned upstream не принимает idempotency key или client message ID.

## Следующий шаг

Провести live L1–L3 extraction smoke после появления LLM allowance.

## Открытые вопросы

- Определить отображение DSH user/team/agent identities на TencentDB isolation вместо единственного статического tuple для всего deployment.
- Для exactly-once capture нужен upstream `Idempotency-Key` или client message ID с атомарной уникальностью; deterministic key DSH должен включать session UUID, turn и digest canonical payload.
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
