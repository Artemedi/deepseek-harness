# Handoff (обновлено: 2026-09-12)

## Текущая задача

Довести TencentDB Agent Memory от экспериментального search provider до полезной native-интеграции. Активный план: [experimental-memory-search.md](plans/experimental-memory-search.md).

## Состояние

- ✅ Local `ctx.memory` и `memory_search` ограничены workspace вызывающего Agent и записывают точные citations в `memory/search` до возврата модели.
- ✅ TencentDB L1 search приведён к v3 контракту: `x-tdai-service-id`, Team/Agent/User identifiers, `data.items` и проверка business envelope.
- ✅ Включённый TencentDB route без реальной конфигурации падает при загрузке; runtime stub удалён.
- ✅ Добавлен opt-in overlay `integrations/tencentdb-agent-memory/memory.cordis.yml.example`.
- ✅ Актуальный полный memory/tool-memory набор: 92 passed в 11 файлах; package TypeScript checks и `git diff --check` прошли. Изменённые runtime-файлы `index.ts`, `http-response.ts`, `openviking-http.ts` и `tencentdb-http.ts` проходят репозиторный per-file 100% coverage gate.
- ✅ Opt-in L0 capture экспортирует completed/max-token turns после idle и записывает durable requested/succeeded/failed events; crash-window пока at least once.
- ✅ Opt-in automatic L1 recall выполняется перед первым step, логирует точные citations и fail-open код ошибки, затем добавляет отдельный недоверенный reference context.
- ✅ Standalone Gateway на loopback работает без отдельного bearer secret; DSH отправляет требуемый v3 parser несекретный marker, а non-loopback endpoint требует credentialRef.
- ✅ `tencentdbRuntime` запускает закреплённый локальный MemoryCore через `ctx.subprocess`, ждёт health и гарантированно завершает дерево при unload/HMR.
- ✅ Live standalone MemoryCore smoke подтвердил health, L0 capture/query и envelope endpoints L1 search, L2 list, L3 read на локальном SQLite; повторяемая команда — `pnpm smoke:tencentdb-memory`.
- ✅ Live L1/L2 extraction завершилась через OpenAI-compatible providers: L1 создала searchable memory, L2 создала читаемый scenario; локальный `free-router` снимает прежнюю блокировку exhausted allowance.
- ✅ L3 publication исправлена в pinned upstream checkout: tool calls работают в изолированном draft workspace, неуспешный runner отбрасывает draft, а live `persona.md` публикуется только после полного успеха и sanitization. Ошибки чтения profile, scene index и изменённых scene теперь отклоняют попытку и не продвигают checkpoint; path containment не принимает соседний каталог с тем же префиксом. 9 regression tests, plugin build и deterministic live AI-SDK smoke подтвердили, что write + три последующих 429 оставляют старый profile неизменным.
- ✅ Explicit и automatic TencentDB recall поддерживают L1–L3: L2 идёт через bounded `scenario/ls` + query-matched `scenario/read`, L3 — через singleton `core/read`; слои делят общий hit/byte budget.
- ✅ Real headless Loader/AgentLoop e2e доказывает, что `memory/search` записан, а недоверенный TencentDB snapshot фактически попадает в model request перед direct user prompt.
- ✅ L0 capture соблюдает upstream bounds 100×8192 и проверяет полный acceptance result; delivery честно остаётся at least once, потому что pinned upstream не принимает idempotency key или client message ID.
- ✅ TencentDB identity isolation больше не использует один deployment-wide tuple: `isolationBindings` точно отображает абсолютный DSH workspace и effective durable agent preset на заранее созданные Team/Agent/User identifiers. Duplicate scopes, reuse Team/Agent profile и unbound caller отвергаются до HTTP.
- ✅ Recall outage policy зафиксирована как fail-open по слоям: успешные слои сохраняются, cancellation распространяется, а durable failure принимает только закрытый безопасный набор memory diagnostic codes.
- ✅ Production-readiness review закрыл неограниченное буферизование HTTP body: TencentDB и OpenViking теперь читают поток только до `maxResponseBytes` и немедленно отменяют его при переполнении. `baseUrl` принимает только чистый HTTP(S) origin, а пустые credential refs и resolved secrets отклоняются.
- ✅ Все durable memory events (`search`, capture requested/succeeded/failed, recall failed) добавлены в generated persistence vocabulary; логи с ними больше не отвергаются при resume.
- ✅ Пользовательский гайд и integration README сверены с runtime-контрактом, исправлены и оформлены как полные EN/ZH пары; порты MemoryCore 8420 и отдельного DSH LLM proxy 8096 явно разведены.
- ✅ Package README и все затронутые generated/hand-written документы оформлены как полные EN/ZH пары; полный `doc-sync` проходит 28/28 gate без исключений.
- ✅ Generated config/tool/Cordis catalogs и capability/event graphs знают native memory и verifier seams; ссылки ведут на канонические subsystem/package страницы, а EN/ZH артефакты синхронизированы.
- ✅ Финальная проверка из чистого commit worktree: 92/92 memory tests, 28 generator tests, root `pnpm typecheck`, полный production `pnpm run build`, `doc-sync` 28/28 и `git diff --check` проходят.

## Следующий шаг

Интеграция в этом репозитории завершена и готова к публикации. Отслеживать upstream PR [TencentCloud/TencentDB-Agent-Memory#1355](https://github.com/TencentCloud/TencentDB-Agent-Memory/pull/1355). После принятия заменить локальный runtime pin на merged upstream SHA; до этого использовать проверенный fork commit `5782862789c1a91b3dcd9c52394a43df632f0525`.

## Граница модели

- Sol `medium` оказался достаточен для live smoke, документации и локальных исправлений с уже определённым контрактом.
- Sol `high` закрыл identity mapping, fail-open policy и consistency implementation.
- Усиленный финальный проход закрыл production-readiness review; незавершённых задач, требующих следующего уровня модели, в текущем scope нет.

## Открытые вопросы

- Для exactly-once capture нужен upstream `Idempotency-Key` или client message ID с атомарной уникальностью; deterministic key DSH должен включать session UUID, turn и digest canonical payload.
- Upstream L3 patch опубликован commit `5782862789c1a91b3dcd9c52394a43df632f0525` на ветке `Artemedi:fix/persona-atomic-publication` и открыт как PR #1355. Aggregate `npm run build` в базовой ветке остаётся сломанным из-за ссылки на отсутствующий `scripts/seed-v2/tsconfig.json`; затронутый `build:plugin` проходит.

## Грабли

- Рабочее дерево уже содержит много чужих untracked файлов, включая каталог `integrations/`; не удалять и не добавлять их массово.
- `pnpm exec` пытается восстановить неполный workspace и выходит в сеть; локальные Vitest/TypeScript запускать через установленные JS entrypoints.
- `tsx` требует IPC вне managed sandbox для генераторов.
- `bwrap` недоступен (`spawn bwrap ENOENT`).

## Память

Протокол и шестислойная модель: [memory.md](knowledge/memory.md).
