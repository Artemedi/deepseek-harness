# Handoff (обновлено: 2026-09-13)

## Текущая задача

Forensic-анализ интеграции внешнего локального гейтвея "9router" с DSH subagent-делегированием (пользователь: расход основной квоты подозрительно высок при инструкции "используй для сабагентов бесплатные модели 9router"; часть сессий падала с ошибками). Закрыта. Полный исходный отчёт (Observed architecture / Evidence / Confirmed & Suspected problems / Token accounting / Minimal reproduction / Recommended fixes) отдан пользователю в чате этой сессии, не сохранён отдельным файлом — история в диалоге и в коммитах ниже.

## Состояние

Подтверждённые находки (из живых `session.jsonl.zstd`, `~/.dsh/settings.yaml`, `~/.dsh/.agent-presets/`, `~/.dsh/profiles/web/`):

- "9router" — не часть DSH; внешний npm-пакет (`decolua/9router`), локальный Next.js-гейтвей на `127.0.0.1:20128`, виден DSH только как обычный `llm-pi-ai` provider `nine-router` (models `dsh-agent` free-tier / `dsh-agent-paid`). Второй, более старый гейтвей `free-router` (self-written `free_router.py`, порт 8090) сосуществует и мигрируется на 9router в отдельном проекте `~/projects/free-router/`.
- Модель как минимум один раз документированно **фабриковала** запуск сабагентов (описала в тексте, не вызвав инструмент) — самопризнание найдено в реальном session-логе (`session-da02b75c...`, turn 4).
- Реально исполненные сабагенты (найдены и разобраны до отдельных child-session-логов) используют `provider: spawn`/`fork`, который **молча наследует текущую модель родителя** в момент старта — ни разу не был закреплён явно за `nine-router`. Наблюдались дети на `free-router` и на платном `OpenRouterDeepSeek` (после явной, но silent-выглядящей смены модели родителя, `request/header.reason: "change"`).
- Одна из живых сессий поймала реальный HTTP 422 (`extra_forbidden` на `assistant.reasoning`) при replay истории на `free-router` — root cause найден в исходниках `@earendil-works/pi-ai` (`openai-completions.js`: `assistantMsg[thinkingSignature] = ...` ставится безусловно). Наивный fix (резать native replay при смене provider) сломал бы существующий тест `convert.spec.ts` ("recombines... across target providers and models") — это осознанный контракт, не баг. Правильный fix — уже существующая конфигурационная опция `compat.requiresThinkingAsText`.
- Сообщение `"Upstream error from Nvidia: Service temporarily overloaded"` не матчилось ни одним паттерном `classifyPiAiError` и падало в неретраящийся `PI_AI_ERROR` — реальный, узкий баг в репозитории, исправлен.
- `claude-code-primary` (provider первичного чата в исторических session-логах) НАЙДЕН И ОБЪЯСНЁН ПОЛНОСТЬЮ: это НЕ deepseek-harness. Это отдельный, некоммиченный (`main` без единого коммита) проект `/var/home/Trintos/projects/dsh-claude-primary-agent`, установленный как `@local/dsh-claude-primary-agent` (link-зависимость) и добавленный в `bundles` живого `~/.dsh/profiles/web/package.json` **2026-09-08** (см. его собственный `AUDIT.md`). Плагин перехватывает `agent/request` waterfall и для presets `claude`/`standard-claude` (`src/preset-routing.ts: routingForPreset`) молча роутит ПЕРВИЧНЫЙ чат (не только сабагентов) через official Claude Agent SDK на нативном `~/.claude` OAuth — реально тратит Claude Pro/subscription квоту на каждый ход агента под этими двумя presets, независимо от `settings.yaml`/`agent-default-model`. Вероятно более крупная причина "подозрительно высокого расхода квоты", чем subagent-роутинг. `"Claude Code failed: success"` — баг форматирования сообщения в его `src/driver.ts:30`: бросается, когда SDK возвращает `subtype: 'success'` одновременно с `is_error: true`, а текст ошибки использует сырое значение `subtype`. Плагин **всё ещё установлен и активен** — реактивируется, как только сессия выбирает preset `claude` или `standard-claude`. Пользователь решил отложить разбор (см. "Следующий шаг").

Сделано (репозиторий, 6 коммитов на `master`, `e661a30f0c..4db97bd155`):

- ✅ `packages/llm/llm-pi-ai/src/stream.ts` — `classifyPiAiError` распознаёт `/\boverloaded\b/i` как `SERVER` (ретраящийся); тест в `adapter.spec.ts`; typecheck+тесты пакета зелёные.
- ✅ Agent Note `implemented/bug-fix/2026-09-13-unstatused-overload-message-classified-as-server.{md,zh.md,i18n.yaml}`.
- ✅ `packages/subagent/tool-subagent/README.{md,zh.md}` — явно задокументирован силентный model-inheritance для `spawn`/`fork` в `agentOptions`.
- ✅ Этот файл переписан дважды по ходу сессии, отражая находки по мере появления.

Сделано (локально, `~/.dsh/`, НЕ git — вне репозитория, изменения не коммитятся):

- ✅ Новый preset `~/.dsh/.agent-presets/standard-free/` — копия `standard` с `subagent` явно закреплённым за `nine-router`/`dsh-agent` через `agentOptions`, плюс `compaction-basic.modelPolicies` для раннего компакта на маленьком 131072-токенном контексте (найден и объяснён deadlock: `/compact` сам падает с `CONTEXT_WINDOW_EXCEEDED`, когда уже переполнено).
- ✅ `agent-presets.default: standard-free` в `~/.dsh/settings.yaml` — активирован, подтверждено пользователем.
- ✅ `~/.dsh/profiles/web/cordis.patch.yml` — убран stale `default: standard-claude`, синхронизирован с `standard`.
- ✅ `~/.dsh/settings.yaml`: `nine-router.retryPolicy.maxRetries` 1→3; `compat.requiresThinkingAsText: true` на `free-router` и `nine-router` (закрывает найденный HTTP 422 без единой строки кода в репозитории).

## Следующий шаг

Нет активной задачи. `@local/dsh-claude-primary-agent` отложен пользователем: пока в ходу только `standard`/`standard-free` (не `claude`/`standard-claude` — единственные два preset-id, которые этот плагин перехватывает), риска нет. При возврате к теме: решить — оставить, поправить сообщение об ошибке в его `driver.ts:30`, или откатить (rollback уже задокументирован в его собственном `AUDIT.md`: `package.json.before-claude-primary-2026-09-08` + `cordis.patch.yml.before-claude-primary-2026-09-08`, `pnpm install`, restart `dsh-web.service`).

## Открытые вопросы

- Заявленный `contextWindow: 131072` для `nine-router/dsh-agent` не верифицирован против реального лимита бэкенда — риск снижен через compaction threshold, но точная цифра не подтверждена.

## Грабли

- Рабочее дерево содержит ~230 untracked `packages/*/*/package.json)` файлов (обрезанные, с хвостовой скобкой в имени) — debris от прерванного `pnpm install`, не трогать, не `git add`. Задокументировано в [sandbox.md](knowledge/sandbox.md).
- `node`/`pnpm exec` недоступны в PATH по умолчанию в этой сессии — грузить через `export PATH="/home/Trintos/.local/share/fnm:$PATH" && eval "$(fnm env --shell bash)"` в каждом новом bash-вызове (включая тот, что делает `git commit`, иначе pre-commit lint-хук падает с `node: не найден`). Запускать тесты через `npx vitest run <path>` из корня репо, не `pnpm --filter <pkg> exec vitest` (workspace-проекты `thread-safe`/`process-bound` резолвятся неверно при filtered exec).
- `bwrap` недоступен (`spawn bwrap ENOENT`).

## Память

Протокол и шестислойная модель: [memory.md](knowledge/memory.md).
