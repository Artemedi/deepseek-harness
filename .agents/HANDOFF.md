# Handoff (обновлено: 2026-09-13)

## Текущая задача

Forensic-анализ интеграции внешнего локального гейтвея "9router" с DSH subagent-делегированием (пользователь: расход основной квоты подозрительно высок при инструкции "используй для сабагентов бесплатные модели 9router"; часть сессий падала с ошибками). Полный отчёт (Observed architecture / Evidence / Confirmed & Suspected problems / Token accounting / Minimal reproduction / Recommended fixes) отдан пользователю в чате этой сессии, не сохранён отдельным файлом — история в этом самом диалоге и в коммитах ниже.

## Состояние

Подтверждённые находки (из живых `session.jsonl.zstd`, `~/.dsh/settings.yaml`, `~/.dsh/.agent-presets/`, `~/.dsh/profiles/web/cordis.patch.yml`):

- "9router" — не часть DSH; внешний npm-пакет (`decolua/9router`), локальный Next.js-гейтвей на `127.0.0.1:20128`, виден DSH только как обычный `llm-pi-ai` provider `nine-router` (models `dsh-agent` free-tier / `dsh-agent-paid`). Второй, более старый гейтвей `free-router` (self-written `free_router.py`, порт 8090) сосуществует и мигрируется на 9router в отдельном проекте `~/projects/free-router/`.
- Модель как минимум один раз документированно **фабриковала** запуск сабагентов (описала в тексте, не вызвав инструмент) — самопризнание найдено в реальном session-логе (`session-da02b75c...`, turn 4).
- Реально исполненные сабагенты (найдены и разобраны до отдельных child-session-логов) используют `provider: spawn`/`fork`, который **молча наследует текущую модель родителя** в момент старта — ни разу не был закреплён явно за `nine-router`. Наблюдались дети на `free-router` и на платном `OpenRouterDeepSeek` (после silent-выглядящей, но фактически явной смены модели родителя через `reason: "change"`).
- Бывший default preset `standard-claude` (пользовательский, `~/.dsh/.agent-presets/standard-claude/`) жёстко направлял `subagent`-tool на `provider: claude-code` — реальный Claude Code CLI под Claude Pro OAuth, вообще не через 9router. Пользователь уже переключил `agent-presets.default` на `standard` в `~/.dsh/settings.yaml`.
- Одна из живых сессий поймала реальный HTTP 422 (`extra_forbidden` на `assistant.reasoning`) при replay истории на `free-router` — root cause найден в исходниках `@earendil-works/pi-ai` (`openai-completions.js`: `assistantMsg[thinkingSignature] = ...` ставится безусловно). Наивный fix (резать native replay при смене provider) сломал бы существующий тест `convert.spec.ts` ("recombines... across target providers and models") — это осознанный контракт, не баг. Правильный fix — уже существующая конфигурационная опция `compat.requiresThinkingAsText`.
- Сообщение `"Upstream error from Nvidia: Service temporarily overloaded"` не матчилось ни одним паттерном `classifyPiAiError` и падало в неретраящийся `PI_AI_ERROR` — реальный, узкий баг в репозитории, исправлен.
- Провайдер `claude-code-primary` (видим в session-логах как provider ПЕРВИЧНОГО чата) не найден нигде в репозитории, ни в текущем, ни в `.bak`-снимках `settings.yaml` — вероятно внешний/приватный bridge вне `deepseek-harness`; связанная ошибка `"Claude Code failed: success"` не может быть исправлена в этом репозитории.

Сделано (репозиторий, 4 коммита на `master`):

- ✅ `packages/llm/llm-pi-ai/src/stream.ts` — `classifyPiAiError` распознаёт `/\boverloaded\b/i` как `SERVER` (ретраящийся); тест в `adapter.spec.ts`; typecheck+тесты пакета зелёные.
- ✅ Agent Note `implemented/bug-fix/2026-09-13-unstatused-overload-message-classified-as-server.{md,zh.md,i18n.yaml}`.
- ✅ `packages/subagent/tool-subagent/README.{md,zh.md}` — явно задокументирован силентный model-inheritance для `spawn`/`fork` в `agentOptions`.

Сделано (локально, `~/.dsh/`, НЕ git — вне репозитория):

- ✅ Новый preset `~/.dsh/.agent-presets/standard-free/` — копия `standard` с `subagent` явно закреплённым за `nine-router`/`dsh-agent` через `agentOptions`, плюс `compaction-basic.modelPolicies` для раннего компакта на маленьком 131072-токенном контексте (найден и объяснён deadlock: `/compact` сам падает с `CONTEXT_WINDOW_EXCEEDED`, когда уже переполнено). **Не активирован как default** — ждёт решения пользователя (`agent-presets.default: standard-free` в `settings.yaml`).
- ✅ `~/.dsh/profiles/web/cordis.patch.yml` — убран stale `default: standard-claude`, синхронизирован с `standard`.
- ✅ `~/.dsh/settings.yaml`: `nine-router.retryPolicy.maxRetries` 1→3; `compat.requiresThinkingAsText: true` на `free-router` и `nine-router` (закрывает найденный HTTP 422 без единой строки кода в репозитории).

## Следующий шаг

Спросить пользователя, активировать ли `standard-free` как default preset (реально закрепляет сабагентов за 9router вместо silent-наследования). Иначе — сессия закрыта; форензик-находки и фиксы выше самодостаточны.

## Открытые вопросы

- `claude-code-primary` (primary-chat provider, видим только в исторических session-логах) не идентифицирован — не в текущем `settings.yaml`, не в `.bak`-снимках, не в репозитории. Если пользователь снова столкнётся с `"Claude Code failed: success"`, источник нужно искать вне `deepseek-harness`.
- Заявленный `contextWindow: 131072` для `nine-router/dsh-agent` не верифицирован против реального лимита бэкенда — снижен риск через compaction threshold, но не подтверждена точная цифра.

## Грабли

- Рабочее дерево содержит ~230 untracked `packages/*/*/package.json)` файлов (обрезанные, с хвостовой скобкой в имени) — debris от прерванного `pnpm install`, не трогать, не `git add`. Задокументировано в [sandbox.md](knowledge/sandbox.md).
- `node`/`pnpm exec` недоступны в PATH по умолчанию в этой сессии — грузить через `export PATH="/home/Trintos/.local/share/fnm:$PATH" && eval "$(fnm env --shell bash)"` в каждом новом bash-вызове (включая тот, что делает `git commit`, иначе pre-commit lint-хук падает с `node: не найден`). Запускать тесты через `npx vitest run <path>` из корня репо, не `pnpm --filter <pkg> exec vitest` (workspace-проекты `thread-safe`/`process-bound` резолвятся неверно при filtered exec).
- `bwrap` недоступен (`spawn bwrap ENOENT`).

## Память

Протокол и шестислойная модель: [memory.md](knowledge/memory.md).
