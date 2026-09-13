# Handoff (обновлено: 2026-09-13)

## Текущая задача

Три последовательные фазы вокруг интеграции внешнего локального гейтвея "9router" с DSH subagent-делегированием, все закрыты:

1. **Forensic phase** — почему расход Claude-квоты был подозрительно высок при инструкции "используй для сабагентов бесплатные модели 9router".
2. **Verification phase** — пользователь потребовал доказательств командами/логами, не summary.
3. **Remediation phase** — узкие защитные guardrails (explicit-model, fail-closed) + 3–5 burn-in прогонов.

Полные исходные отчёты отданы пользователю в чате этой сессии, не сохранены отдельным файлом — история в диалоге и в коммитах ниже. Пользовательский итоговый статус (дословно): forensic ✅ VERIFIED, overloaded fix ✅ VERIFIED regression test, subagent→9router execution path ✅ VERIFIED live, silent inheritance ✅ VERIFIED live, причина расхода Claude-квоты 🟡 сильный кандидат (inheritance, не overloaded fix — это две разные, не связанные причины), 9router как инфраструктура 🟡 нужен burn-in.

## Состояние

### Находки (forensic + verification)

- "9router" — не часть DSH; внешний npm-пакет, локальный Next.js-гейтвей `127.0.0.1:20128`, виден DSH как обычный `llm-pi-ai` provider `nine-router`. **Реальный бэкенд за алиасом `dsh-agent` подтверждён многократно живыми прогонами**: `nvidia/nemotron-3-ultra-550b-a55b:free`.
- `provider: spawn`/`fork` без `agentOptions` **молча наследует текущую модель родителя** — подтверждено архивно и живым контролируемым тестом (parent `OpenRouterDeepSeek` → child без `agentOptions` получает ТОЧНО ТУ ЖЕ пару).
- `"...overloaded"` не матчился `classifyPiAiError`, падал в неретраящийся `PI_AI_ERROR` — исправлено и верифицировано real-Loader composition тестом. **Важно, по требованию пользователя: это отдельная, самостоятельная находка, не объяснение расхода Claude-токенов.** Расход объясняется inheritance-механизмом (см. выше) и/или отдельно найденным `dsh-claude-primary-agent`, не overloaded-классификацией.
- `claude-code-primary` — внешний, некоммиченный проект `/var/home/Trintos/projects/dsh-claude-primary-agent`, перехватывает presets `claude`/`standard-claude`, роутит первичный чат на Claude Code SDK. Установлен, активен, реактивируется при выборе тех двух presets. **Отложен пользователем** — в ходу только `standard`/`standard-free`.
- **Source ≠ running artifact**: коммит фикса не был активен в рантайме, пока `packages/llm/llm-pi-ai/lib/*` не пересобран вручную (`pnpm run build` по всему репо сломан независимо, см. "Открытые вопросы"). Пересобирать после каждой правки `src/` перед live-проверкой — см. "Грабли".

### Remediation: guardrails (репозиторий, коммиты `7ddf642f13`, `b2397e395b`)

- ✅ `dsh-tool-subagent`: новый `requireExplicitModel: boolean` (default `false`) — **fail loud at mount**, если `spawn`/`fork` без полного `agentOptions.provider`+`model`. Providers, игнорирующие `agentOptions` (`claude-code`, `codex`), не затронуты.
- ✅ `started subagent <id>` / `started background subagent job <id>` теперь содержит запрошенный `(provider/model)` прямо в тексте родительского tool-result — не нужно открывать child-сессию, чтобы узнать, что было запрошено.
- ✅ Тесты (мount-time throw, успешный mount с полным `agentOptions`, точный текст с суффиксом) — 74/74 passed. Agent Note `implemented/feature/2026-09-13-explicit-model-guard-for-subagent-delegation.{md,zh.md,i18n.yaml}`.
- ✅ Применено локально: `~/.dsh/.agent-presets/standard-free/agent.cordis.yml` — `tool-subagent` теперь с `requireExplicitModel: true` (уже был с полным `agentOptions`, так что просто добавляет гарантию). `subagent_fork` сознательно НЕ получил флаг — там `agentOptions` намеренно не задан (риск reasoning-block replay на fork, см. комментарий в файле).

### Remediation: fail-closed — доказано живьём, дважды

Первая попытка была спутана (сломал `nine-router.baseURL`, а он же и был parent-моделью — упал родитель, не сабагент). Исправлено: parent временно на `OpenRouterDeepSeek` (рабочий), только `nine-router.baseURL` сломан (`http://127.0.0.1:1/v1`), `agentOptions` сабагента явно требует `nine-router`. Результат:

- Child: `request/header` → `nine-router/dsh-agent` (запрошенный маршрут), 3 попытки `llm/retry` (тот самый `maxRetries: 3` из forensic-фазы) на ТОМ ЖЕ provider, exhausted, `turn/end: {code: TRANSPORT}`.
- Ни разу не был запрошен никакой другой provider — no fallback, ни к parent-модели, ни к любой другой.
- Parent (`OpenRouterDeepSeek`) получил `Error: subagent run failed`, честно сообщил о провале, не сфабриковал ответ.
- Оба изменённых значения `settings.yaml` немедленно возвращены и подтверждены постфактум.

### Remediation: 5 burn-in прогонов (`/tmp/dsh-repro/smoke-9router-subagent.sh`)

Скрипт: `dsh --profile headless --patch <patch>` с `tool-subagent{requireExplicitModel:true, agentOptions:{nine-router,dsh-agent}}`, парсит child-сессию, проверяет `providers_seen == {(nine-router,dsh-agent)}` (no-fallback инвариант).

| Run | Результат | Детали |
|---|---|---|
| burnin-1 | ✅ PASS | effective=nvidia/nemotron-3-ultra-550b-a55b:free |
| burnin-2 | ✅ PASS | то же |
| burnin-3 | ✅ PASS | то же, +cacheReadTokens |
| burnin-4 | ✅ PASS | то же |
| burnin-5 | ❌ FAIL (честный) | `SERVER: Upstream error from Nvidia: Service temporarily overloaded` — реальный live-повтор проблемы из forensic-фазы; классификация правильная (`SERVER`, не старый `PI_AI_ERROR`), 3 retry сделаны, но outage пережил retry-бюджет. **Никакого fallback не произошло** — упало явно. |

**4/5 успех, 1/5 честный transient-fail с корректным fail-closed поведением.** Подтверждает калибровку пользователя: механизм routing/guardrails работает; сама инфраструктура 9router (конкретно nvidia/nemotron backend) периодически перегружена и нуждается в более длинном burn-in перед TeamAI/Team Context, либо в увеличении `maxRetries`/backoff для этого конкретного provider.

## Следующий шаг

Нет активной задачи с моей стороны. Возможные следующие шаги (не начаты, ждут запроса):
- Дальнейший burn-in 9router (больше прогонов, дольше период) перед использованием в TeamAI/Team Context.
- Если частота "overloaded" окажется высокой — рассмотреть больший `maxRetries`/backoff специально для `nine-router`, либо смену конкретной free-модели, стоящей за алиасом `dsh-agent`, если 9router это позволяет настроить.
- `@local/dsh-claude-primary-agent` и `compat.requiresThinkingAsText` — отложены/не тестировались live, ждут отдельного запроса.

## Открытые вопросы

- Полная сборка репозитория (`pnpm run build`) сломана независимо от этой работы: `packages/experimental/cross-review/src/index.ts` — `TS6307`. Untracked, чужое, не трогал. Любой build-related фикс должен либо чинить это, либо документировать per-package обход (см. "Грабли").
- Заявленный `contextWindow: 131072` для `nine-router/dsh-agent` не верифицирован против реального лимита бэкенда.

## Грабли

- **`lib/` может быть stale относительно `src/`** — vitest транспилирует TS напрямую и не ловит это; только реальный `dsh` CLI прогон (грузит `lib/index.js`) вскрывает расхождение. После правки `packages/*/*/src/*.ts` и перед live-верификацией: `tsc -b tsconfig.json` (в директории пакета) + `npx tsdown --no-config --no-clean lib/types/index.js lib/types/invariant.js --out-dir lib --format esm --platform node --target es2024`, затем переименовать `.mjs`→`.js` (root `fixedExtension: false` недоступен вне корневого `tsdown.config.ts`, а тот сломан из-за `cross-review`).
- `dsh --profile headless --patch <file> "task"` — рабочий способ живой one-shot верификации. `--patch` **не** переопределяет `agent-default-model`/`agent-presets`, если есть settings.yaml user-layer запись (та побеждает) — для теста с другой parent-моделью нужно временно править сам `settings.yaml` (правка → тест → немедленный откат → подтверждение отката, каждый раз).
- Рабочее дерево содержит ~230 untracked `packages/*/*/package.json)` файлов (debris) — не трогать. См. [sandbox.md](knowledge/sandbox.md).
- `node`/`pnpm exec` недоступны в PATH по умолчанию — грузить `fnm` в каждом bash-вызове (включая `git commit`). Тесты — `npx vitest run <path>` из корня, не `pnpm --filter <pkg> exec vitest`.
- `bwrap` недоступен (`spawn bwrap ENOENT`).

## Память

Протокол и шестислойная модель: [memory.md](knowledge/memory.md).
