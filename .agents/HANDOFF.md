# Handoff (обновлено: 2026-09-13)

## Текущая задача

Forensic-анализ интеграции внешнего локального гейтвея "9router" с DSH subagent-делегированием, затем строгая верификация найденного фикса и механизма (пользователь потребовал доказательства командами/логами, не summary). Закрыта — все требования верификации выполнены с реальными командами, exit code'ами и живыми session-логами (не только unit-тестами). Полный исходный forensic-отчёт и итоговый verification-отчёт отданы пользователю в чате этой сессии, не сохранены отдельным файлом — история в диалоге и в коммитах ниже.

## Состояние

Подтверждённые находки (из живых `session.jsonl.zstd`, `~/.dsh/settings.yaml`, `~/.dsh/.agent-presets/`, `~/.dsh/profiles/web/`, и живых `dsh --profile headless` прогонов этой сессии):

- "9router" — не часть DSH; внешний npm-пакет (`decolua/9router`), локальный Next.js-гейтвей на `127.0.0.1:20128`, виден DSH только как обычный `llm-pi-ai` provider `nine-router` (models `dsh-agent` free-tier / `dsh-agent-paid`). **Реальный бэкенд за алиасом `dsh-agent` подтверждён живым прогоном**: `nvidia/nemotron-3-ultra-550b-a55b:free` (поле `responseModel` в replay-state ассистентского сообщения). Второй, более старый гейтвей `free-router` (self-written `free_router.py`, порт 8090) сосуществует, мигрируется на 9router в отдельном проекте `~/projects/free-router/`.
- Модель как минимум один раз документированно **фабриковала** запуск сабагентов (описала в тексте, не вызвав инструмент) — самопризнание найдено в реальном session-логе (`session-da02b75c...`, turn 4).
- `provider: spawn`/`fork` без `agentOptions` **молча наследует текущую модель родителя** — подтверждено ДВАЖДЫ: (1) архивно, по историческим session-логам (дети на `free-router` и на платном `OpenRouterDeepSeek`); (2) **живым контролируемым тестом** этой сессии (родителю явно задана `OpenRouterDeepSeek`/`deepseek-v4.1-flash`, `tool-subagent` без `agentOptions` → child `request/header` показывает ТОЧНО ТУ ЖЕ пару). С явным `agentOptions: {provider: nine-router, model: dsh-agent}` — child реально роутится в 9router независимо от модели родителя (тоже живым прогоном, session `de088e38.../e8f22a43...`).
- Одна из живых сессий поймала реальный HTTP 422 (`extra_forbidden` на `assistant.reasoning`) при replay истории на `free-router` — root cause в `@earendil-works/pi-ai` (`openai-completions.js`: `assistantMsg[thinkingSignature] = ...` безусловно). Наивный DSH-side fix сломал бы намеренный тест `convert.spec.ts` ("recombines... across target providers and models"). Правильный fix — существующая опция `compat.requiresThinkingAsText`, включена в `~/.dsh/settings.yaml` на `free-router`/`nine-router`. **Не тестировалась live в этой сессии** (пользователь не требовал).
- `"Upstream error from Nvidia: Service temporarily overloaded"` не матчился `classifyPiAiError`, падал в неретраящийся `PI_AI_ERROR` — исправлено (`7f5257122d`) и **строго верифицировано** (см. ниже).
- `claude-code-primary` — НЕ deepseek-harness. Отдельный, некоммиченный проект `/var/home/Trintos/projects/dsh-claude-primary-agent` (`@local/dsh-claude-primary-agent`), в `bundles` живого `~/.dsh/profiles/web/package.json` с 2026-09-08. Для presets `claude`/`standard-claude` (`src/preset-routing.ts`) молча роутит ПЕРВИЧНЫЙ чат через official Claude Agent SDK на нативном `~/.claude` OAuth. `"Claude Code failed: success"` — баг в его `src/driver.ts:30`. Плагин установлен и активен, реактивируется при выборе `claude`/`standard-claude`. **Пользователь отложил разбор** — сейчас в ходу только `standard`/`standard-free`, риска нет.

### Критическая находка этой сессии: source ≠ running artifact

Первый живой прогон verification-теста (до пересборки) поймал ИМЕННО ошибку, которую фикс `7f5257122d` должен был закрыть — но с кодом `PI_AI_ERROR`, не `SERVER`. Причина: `dsh` CLI резолвит собранный `packages/llm/llm-pi-ai/lib/index.js` (бандл tsdown), а не `src/`; `lib/` не пересобирался после коммита. `grep -c overloaded lib/index.js` = 0 до пересборки. **Полный `pnpm run build` сейчас не проходит по всему репо** из-за независимо сломанного untracked `packages/experimental/cross-review` (не моё, debris). Пересобрал `llm-pi-ai` вручную в обход (`tsc -b tsconfig.json` в директории пакета + `tsdown --no-config --no-clean`, переименование `.mjs`→`.js`); `lib/` gitignored, ничего не коммитится. После пересборки verification-тест прошёл (`exit=0`, `SUBAGENT_SAID: PONG`). **Production `dsh-web.service` (порт 3080) не перезапускался** — у него в памяти всё ещё старый модуль; фикс активен для новых процессов, не для уже запущенного.

Сделано (репозиторий, 8 коммитов на `master`, `e661a30f0c..bd54f5f63d`):

- ✅ `packages/llm/llm-pi-ai/src/stream.ts` — `classifyPiAiError` распознаёт `/\boverloaded\b/i` как `SERVER`.
- ✅ Тест позитивный + **негативный** (`bd54f5f63d`: 401+"overloaded" остаётся `AUTH`) — дискриминирующая сила негативного теста доказана экспериментально (временная порча порядка проверок → тест красный → откат → тест зелёный).
- ✅ Agent Note `implemented/bug-fix/2026-09-13-unstatused-overload-message-classified-as-server.{md,zh.md,i18n.yaml}`.
- ✅ `packages/subagent/tool-subagent/README.{md,zh.md}` — задокументирован silent model-inheritance.
- ✅ Найден и прогнан существующий real-Loader composition тест (`llm-retry/tests/loader-composition.spec.ts`), доказывающий, что код `SERVER` реально ретраится и восстанавливается через настоящий agent-loop (не только классифицируется).

Сделано (локально, `~/.dsh/`, НЕ git):

- ✅ Preset `~/.dsh/.agent-presets/standard-free/`, активирован как default.
- ✅ `~/.dsh/profiles/web/cordis.patch.yml` синхронизирован (`default: standard`).
- ✅ `~/.dsh/settings.yaml`: `nine-router.retryPolicy.maxRetries` 1→3; `compat.requiresThinkingAsText: true` на `free-router`/`nine-router`.
- ✅ Пересобран `packages/llm/llm-pi-ai/lib/*` (build-артефакт, не в git) — см. критическую находку выше.
- ⚠️ `agent-default-model` временно менялся трижды на протяжении verification (`deepseek-official`→`groq`→`OpenRouterDeepSeek`) для контролируемого inheritance-теста, каждый раз с полной проверкой; **окончательно возвращён и подтверждён**: `provider: nine-router, model: dsh-agent`.

## Следующий шаг

Нет активной задачи. Всё, что просил проверить пользователь, проверено с командами/exit code/session-логами (не только докой). `@local/dsh-claude-primary-agent` и `compat.requiresThinkingAsText` живьём не тестировались — отложены/не требовались.

## Открытые вопросы

- Полная сборка репозитория (`pnpm run build`) сломана независимо от этой работы: `packages/experimental/cross-review/src/index.ts` ссылается на файл, не входящий в `tsconfig.host.json` (`TS6307`). Не трогал (untracked, чужое). Любой следующий build-related фикс должен либо чинить это, либо документировать обход (сборка per-package через локальный `tsconfig.json`, как сделано здесь для `llm-pi-ai`).
- `deepseek-official` API-ключ реально исчерпан (`Insufficient Balance`) — подтверждено дважды (архивный лог + live прогон этой сессии).
- `groq`'s TPM-лимит (8000) меньше системного промпта DSH (~9569 токенов) — не пригоден как parent-модель для тестов без сокращения промпта.
- Заявленный `contextWindow: 131072` для `nine-router/dsh-agent` не верифицирован против реального лимита бэкенда.

## Грабли

- **`lib/` может быть stale относительно `src/`** — тесты (vitest) транспилируют TS напрямую и НЕ ловят это; только реальный запуск через `dsh` CLI (который грузит `lib/index.js`) вскрывает расхождение. После правки `packages/llm/*/src/*.ts` и перед live-верификацией: пересобрать через `tsc -b tsconfig.json` (в директории пакета) + `npx tsdown --no-config --no-clean lib/types/index.js lib/types/invariant.js --out-dir lib --format esm --platform node --target es2024`, затем переименовать `.mjs`→`.js` (root `fixedExtension: false` не воспроизводится вне корневого `tsdown.config.ts`, а корневой конфиг сейчас недоступен из-за поломки `cross-review`).
- Рабочее дерево содержит ~230 untracked `packages/*/*/package.json)` файлов (debris от прерванного `pnpm install`) — не трогать. См. [sandbox.md](knowledge/sandbox.md).
- `node`/`pnpm exec` недоступны в PATH по умолчанию — грузить `fnm` в каждом bash-вызове (включая `git commit`). Тесты — `npx vitest run <path>` из корня, не `pnpm --filter <pkg> exec vitest`.
- `dsh --profile headless --patch <file> "task"` — рабочий способ живой one-shot верификации; `--patch` **не** переопределяет `agent-default-model`/`agent-presets`, если у них есть settings.yaml user-layer запись (та побеждает) — для теста с другой parent-моделью нужно временно править сам `settings.yaml`.
- `bwrap` недоступен (`spawn bwrap ENOENT`).

## Память

Протокол и шестислойная модель: [memory.md](knowledge/memory.md).
