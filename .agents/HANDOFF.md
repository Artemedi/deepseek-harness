# Handoff (обновлено: 2026-08-30)

## Текущая задача

Интеграция внешних систем памяти и оркестровки с DeepSeek Harness. Активный
подпроект — экспериментальная рамка поиска по памяти (`memory_search`). План:
`.agents/plans/experimental-memory-search.md`.

Эта задача реализует фазу 2 из [.agents/notes/proposed/architecture/2026-08-26-three-project-integration-plan.md](.agents/notes/proposed/architecture/2026-08-26-three-project-integration-plan.md):
определить экспериментальный `ctx.memory` Service Definition с bounded
`search`/`store`/`commit`, локальный провайдер на базе `ctx.sessionQuery`,
и потребителя для явных операций памяти с записью durable `memory/search`
событий перед возвратом текста модели.

## Состояние

- ✅ Реализована основа удалённых memory-провайдеров (коммиты `f9983eb1d0`–`dd944e5e79`):
  `ctx.memory` service, `resolve(memory)` Explicit-Provider, локальный stub-провайдер.
  - `.agents/notes/implemented/architecture/2026-08-30-risk-based-cross-review-policy.md`
    (в чеке, не закоммичен) фиксирует политику кросс-ревьюя.
- ✅ Добавлен экспериментальный JSON-верификатор bundle
  (`packages/experimental/verifier/`, `packages/bundle/experimental-verifier/`).
  Коммиты `7814240d8e`–`f4dc290500`.
- ✅ Принята и записана [политика risk-based cross-review](.agents/notes/implemented/architecture/2026-08-30-risk-based-cross-review-policy.md).
- 🔄 Активный work-in-progress: реализация `memory_search` tool и локального
  search-провайдера в `packages/experimental/tool-memory/` +
  `packages/experimental/memory/`. Провайдер должен валидировать scope из
  `SessionHeader.cwd` вызывающего агента, а не из аргументов модели.
- ⏳ Не начато: фаза 1 (TencentDB proxy validation), фаза 3–5
  (TencentDB native adapter, OpenViking adapter, паттерны Ruflo).
- ⏳ Не начато: Web-проекция для отображения memory citations и commit status
  из session events (упомянута в Acceptance criteria note).

## Следующий шаг

Начать с реализации **локального search-провайдера**:
- поиск только по корпусу `ctx.sessionQuery` (session history) в рамках workspace,
- scope выводится из `SessionHeader.cwd` вызывающего агента (никогда не из args),
- валидация: stale Agents, missing workspaces, empty queries, hit limits,
  aggregate byte limits — ДО начала работы запроса,
- append-time invariant: `memory/search` событие чужом workspace отклоняется.

См. [.agents/notes/proposed/architecture/2026-08-26-experimental-memory-search.md](.agents/notes/proposed/architecture/2026-08-26-experimental-memory-search.md)
для Acceptance criteria и Risks.

## Открытые вопросы / блокеры

- **Политика cross-review**: только что принята
  (2026-08-30-risk-based-cross-review-policy), но требует уточнения порога
  "significant" для non-trivial changes. → спросить у мейнтейнера перед первым
  PR в рамках этой задачи.
- **Тестовый стенд TencentDB proxy** (фаза 1) ещё не поднят. Без него нельзя
  приступить к валидации replay/memory-injection invariants. Блокер для фазы 1,
  но не для текущей реализации локального провайдера (фаза 2 можно делать
  автономно).

## Грабли, актуальные для этой задачи

- **bwrap недоступен** в этом sandbox (`spawn bwrap ENOENT`). Всё, что требует
  вложенного `sandbox-exec`/`bwrap`, падает. Use host escalation only с
  sandbox evidence. См. `knowledge/sandbox.md`.
- **232 зомби `packages/*/<pkg>/package.json)`** (с trailing paren) — артефакты
  прерванного `pnpm install`. Не `git add`-ить. При необходимости чистить через
  `pnpm run clean`, а не вручную.
- **`dsh web` из исходников** запускает tsx ESM hook; не стартовать отдельный Vite
  сервер для полного Web UI — только DSH web инжектирует `window.__DSH_BOOT__`.
  См. `knowledge/build.md`.
- **`test:e2e` требует `DEEPSEEK_API_KEY`**; без ключа self-skips. `test`,
  а не `test:coverage` — это unit tests; `test:coverage` — CI coverage gate.
  См. `knowledge/testing.md`.
- **`--force` запрещён** для ребейза/мёрджа — только `--force-with-lease`, и
  abort on remote movement.

## Known debt

Pre-existing verifier violations (NOT introduced by this change; present before):

1. `.agents/notes/analysis/` — unknown lifecycle folder to `walkAgentNoteTree()`
   (allowed: proposed, implemented, rejected, archived). Fix: move or remove.
2. `.agents/notes/proposed/architecture/2026-08-26-three-project-integration-plan.md`
   missing `## Acceptance criteria` and `## Risks` (required for `proposed/`).

The `verify-translation-pairing.ts` script crashes on Node 22.11 due to a
`Glob.exclude` API incompatibility (`ERR_INVALID_ARG_TYPE`) — a pre-existing
tooling issue, not a pairing mismatch.

## Memory protocol

Full protocol + six-layer map: `.agents/knowledge/memory.md`.

- AGENTS.md → как работать
- HANDOFF.md → где мы сейчас (перезаписывается)
- plans/ → чеклисты активных задач
- knowledge/ → стабильные факты
- notes/ → решения (Agent Notes; ADR ≡ класс architecture)
- git log → история

`HANDOFF.md`, `plans/`, `knowledge/` находятся **вне** области
`verify-agent-note-format` и `verify-translation-pairing` (работают над файлах в
`.agents/notes/`).
