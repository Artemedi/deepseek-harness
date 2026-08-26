# Отчёт об интеграции DeepSeek Harness

## Краткий итог

В локальный DeepSeek Harness добавлена безопасная основа для работы с внешней памятью и оркестрацией агентов.

Сейчас Harness умеет:

- явно искать информацию в памяти через `memory_search`;
- ограничивать память текущим рабочим пространством;
- сохранять найденные сведения в append-only session log до передачи их модели;
- воспроизводить такие операции при replay;
- работать с локальными stub-провайдерами, имитирующими TencentDB Agent Memory и OpenViking;
- использовать явные уровни контекста OpenViking `L0`, `L1` и `L2`;
- возвращать понятные типизированные ошибки провайдеров;
- запускать coordinator, worker и review через существующий DSH workflow engine;
- проверять оркестрационный план до запуска задач;
- безопасно диагностировать ошибки gateway и retry-сценарии.

Внешние репозитории не изменялись. Реальные API-ключи не использовались. TencentDB и OpenViking пока представлены локальными deterministic stubs, поэтому текущая реализация полностью воспроизводима и не зависит от сети.

## Зачем это было сделано

Исходная задача состояла из нескольких связанных проблем.

### 1. Ошибки gateway были слишком общими

При сбое upstream gateway пользователь видел сообщение вроде:

```text
This turn failed
{"type":"api_error","message":"Upstream error."}
```

Такое сообщение не объясняло:

- была ли ошибка временной;
- стоит ли повторять запрос;
- какой HTTP status вернул gateway;
- к какому запросу относится ошибка.

Из-за этого Harness мог неправильно классифицировать сбой и не использовать существующую retry-политику.

### 2. Внешняя память могла нарушить replay

Если внешний сервис незаметно добавляет найденный текст в prompt, этот текст отсутствует в DSH session log.

После этого невозможно гарантировать, что:

- повторный запуск увидит тот же контекст;
- fork или resume восстановит прежнее состояние;
- изменение или недоступность внешнего сервиса не повлияет на уже начатую сессию.

Поэтому было принято правило: внешняя память должна быть явной, а точный текст каждой цитаты должен попасть в DSH log до того, как его увидит следующая модельная операция.

### 3. Ruflo частично пересекается с уже существующими DSH возможностями

Ruflo предлагает идеи coordinator, worker, review, DAG, fan-out, budget и orchestration.

Но добавление второго scheduler, второго runtime или второй системы persistence создало бы конкурирующую архитектуру.

Поэтому в Harness были перенесены только полезные паттерны, а исполнение оставлено за существующими:

- `ctx.workflowEngine`;
- `ctx.subagents`;
- `ctx.agentTeams`;
- `ctx.jobs`.

## Что изменено в DSH

## Provider-neutral memory seam

Добавлен экспериментальный пакет:

```text
@deepseek-ai/dsh-experimental-memory
```

Он предоставляет `ctx.memory` и отвечает за общие правила памяти.

### Что делает сервис

Сервис:

1. принимает exact live `Agent`;
2. проверяет, что Agent всё ещё зарегистрирован и активен;
3. получает workspace из `agent.session.header.cwd`;
4. не принимает workspace от модели как источник авторизации;
5. проверяет лимит количества результатов;
6. проверяет лимит UTF-8 байтов;
7. проверяет cancellation signal;
8. выбирает явно разрешённого provider;
9. возвращает ограниченные citations.

Это означает, что модель не может подставить чужой workspace, tenant или owner и получить чужую память.

### Доступные provider routes

```text
local
 tencentdb
openviking
```

`local` остаётся базовым маршрутом и использует существующий DSH `sessionQuery`.

`tencentdb` и `openviking` сейчас являются deterministic local stubs. Они реализуют согласованный формат данных, но не выполняют сетевые запросы.

## Explicit memory search tool

Добавлен экспериментальный пакет:

```text
@deepseek-ai/dsh-experimental-tool-memory
```

Он регистрирует модельный инструмент:

```text
memory_search
```

Инструмент поддерживает:

- `query`;
- `limit`;
- `max_content_bytes`;
- `provider`;
- `depth` для OpenViking.

Пример вызова:

```json
{
  "provider": "openviking",
  "depth": "L1",
  "query": "retry"
}
```

Передача workspace в аргументах инструмента не предусмотрена. Workspace определяется только из trusted Agent/session state.

## Durable memory/search event

Передача найденных цитат модели теперь имеет явную последовательность:

```text
memory_search
    |
    v
memory/search event
    |
    v
tool/result
    |
    v
следующий model request
```

Событие `memory/search` содержит:

- версию события;
- provider;
- workspace;
- query;
- точный список найденных citations;
- exact text каждой citation.

Благодаря этому следующий model request может быть восстановлен из session log, даже если внешний провайдер позже недоступен или вернул другой результат.

## Provider-neutral citations

Изначально local session records имели поля DSH:

- `sessionId`;
- `seq`;
- `eventType`.

У внешних провайдеров таких DSH-полей нет. Поэтому remote citations не подделывают эти значения.

Для remote results сохраняются provider-specific, но безопасные поля:

- `id`;
- `kind`;
- `title`;
- `source`;
- `content`.

Это важно: Harness не выдаёт внешний ресурс за запись собственной session history.

## Локальные TencentDB и OpenViking stubs

В файл `packages/experimental/memory/src/remote-contract.ts` добавлены pure normalizers и deterministic records.

### TencentDB stub

Поддерживает:

- workspace filtering;
- resource kind;
- title;
- source;
- bounded content;
- opaque ids с префиксом `tencentdb:`.

Запись из другого workspace не возвращается.

### OpenViking stub

Поддерживает явные уровни:

```text
L0
L1
L2
```

Для OpenViking depth обязательна. Запрос без depth отклоняется до поиска.

URI остаётся opaque source, например:

```text
viking://stub/retry
```

ID формируется с префиксом:

```text
openviking:viking://stub/retry
```

В runtime не добавлялась библиотека OpenViking и не вендорился её AGPLv3-код.

## Ограничения и typed failures

Добавлен единый mapper для remote HTTP outcomes.

| Условие | Код Harness |
|---|---|
| `401` или `403` | `MEMORY_UNAUTHORIZED` |
| `408`, `429` или `599` | `MEMORY_RETRYABLE` |
| `5xx` | `MEMORY_PROVIDER_UNAVAILABLE` |
| остальные ошибки | `MEMORY_PROVIDER_ERROR` |

В ошибку попадают только provider id и HTTP status.

Raw provider body не сохраняется и не выводится. Provider failure не превращается в успешный пустой список.

## Cancellation и ограничения размера

Проверены две важные границы.

### Cancellation

Если операция уже отменена, `ctx.memory.search()` завершается до обращения к provider.

Это предотвращает запуск бесполезного запроса после отмены model/tool operation.

### UTF-8 bytes

Лимит считается в UTF-8 байтах, а не в количестве JavaScript-символов.

Например, текст с кириллицей может занимать больше байтов, чем кажется по его длине. Проверены оба случая:

- citation исключается, если превышает лимит;
- citation сохраняется при точном лимите.

## Исправления pi-ai gateway path

### Retry classification

Flattened сообщение:

```text
Upstream error.
```

классифицируется как:

```text
SERVER
```

Это включает существующую bounded retry policy.

Другие неизвестные pi-ai ошибки по-прежнему остаются `PI_AI_ERROR`.

### Сохранение доступного HTTP status

Если pi-ai уже включил status в текст ошибки, Harness извлекает его:

- `502: ...`;
- `HTTP 500: ...`;
- `API error (429): ...`.

Например:

```json
{
  "message": "502: {\"type\":\"api_error\",\"message\":\"Upstream error.\"}",
  "code": "SERVER",
  "status": 502
}
```

Если сообщение содержит только `Upstream error.`, status не выдумывается.

### Что пока невозможно через public pi-ai API

Текущий public pi-ai callback не даёт Harness failed-response:

- `X-Request-ID`;
- другие response headers;
- raw response body как отдельное поле;
- оригинальный Error/cause chain.

Поэтому полное structured preservation этих данных не заявляется.

## Orchestration и Ruflo-паттерны

В `Harness/integrations/ruflo-dsh-plan.py` добавлен bounded preflight validator.

Он проверяет:

- максимальное количество задач;
- максимальный fan-out зависимостей;
- явную стоимость каждой задачи;
- общий budget;
- неизвестные dependencies;
- циклические зависимости;
- наличие ровно одной review task.

Validator не является scheduler.

Он:

- не создаёт DSH agents;
- не хранит task state;
- не пишет session events;
- не превращает task text в shell commands;
- не обходится без DSH authorization.

Дополнительно добавлен explicit command bridge:

```text
--execute -- <operator-supplied-command>
```

Команда выполняется только после успешного preflight. Plan text никогда автоматически не превращается в команду.

## Keyless workflow fixture

В DSH добавлен assembled headless snapshot с реальным Loader composition.

Сценарий выполняет:

1. coordinator вызывает `workflow`;
2. workflow запускает worker;
3. worker возвращает evidence;
4. coordinator запускает review;
5. review возвращает решение;
6. workflow result возвращается coordinator;
7. отдельные child sessions сохраняются штатным DSH persistence.

Проверены события:

```text
tool-workflow/run-start
tool-workflow/agent-start
tool-workflow/agent-end
tool-workflow/run-end
```

Это доказывает, что Ruflo-паттерн реализован поверх DSH, а не через второй runtime.

## Deployment hardening TencentDB

В `Harness/integrations/tencentdb-agent-memory/run.sh` добавлены проверки:

- обязательные credentials до pull/start;
- immutable image references;
- ровно 64 hexadecimal символа после `@sha256:`;
- отсутствие secret values в output;
- proxy-side injection отключён;
- runtime configs создаются с owner-only permissions.

Такой runner не позволит случайно заменить проверенный image digest на mutable `latest`.

## Gateway probe

Добавлен probe для TencentDB-compatible gateway.

Он проверяет:

- health endpoint;
- chat completions endpoint;
- HTTP status;
- тип ошибки;
- `X-Request-ID`;
- `X-Correlation-ID`;
- malformed JSON;
- transport failure с `status: 0`.

Wire regression запускает локальный stub gateway как subprocess и вызывает настоящий probe CLI. Это проверяет не только отдельные функции, но и весь локальный diagnostic path.

## Защита от повреждённых данных

Local JSONL memory provider теперь явно отклоняет:

- malformed JSON;
- structurally incomplete records.

Повреждённое хранилище не трактуется как пустая память. Это делает поведение ближе к требованиям будущих remote providers.

## Проверки

В рамках работы были выполнены следующие проверки.

### DSH

- pi-ai convert tests: `72/72`;
- retry transport recovery: `7/7`;
- assembled workflow snapshot refresh: `1/1`;
- assembled workflow snapshot replay: `1/1`;
- memory service/invariant/Loader tests: до `15/15`;
- remote contract tests;
- provider-neutral memory tests;
- package TypeScript checks в Node 22;
- Host build и runtime closure;
- generated persistence/tool catalogs;
- keyless replay transcript.

### Harness

- local memory tests;
- Ruflo plan validator tests;
- gateway probe tests;
- subprocess gateway wire-path regression;
- digest-pinning runner regression;
- Python compilation;
- `bash -n` для deployment runner.

Финальный объединённый Harness integration suite проходил с результатом `15/15`.

## Git и audit trail

Интеграционные решения записывались в append-only `Harness/AUDIT_LOG.md`.

Последний audit commit:

```text
d56ef26 audit: record fully composed memory stubs
```

Предыдущие связанные audit commits:

```text
5065628 audit: record remote failure normalization
a7711ca audit: record stub remote memory contracts
dc69689 audit: record provider-neutral memory seam
```

Последние локальные DSH commits, относящиеся к финальной memory integration:

```text
3c28820939 feat: add provider-neutral memory search seam
582739c464 feat: add stub remote memory contracts
2663f7096d api: export remote memory contract
e84eaec8ce feat: normalize remote memory failures
d0c4f84240 feat: mount local remote memory stubs
8a27e579af feat: mount local remote memory provider stubs
```

## Полученные выгоды

### Replay стал надёжнее

Модель видит только те citations, которые уже записаны в DSH session log.

Результат внешнего поиска не является скрытой переменной prompt assembly.

### Безопасность workspace стала явной

Модель не может сама выбрать чужой workspace. Scope выводится из live Agent и canonical session header.

### Провайдеры можно менять

Local, TencentDB и OpenViking используют общий provider-neutral seam. В будущем можно заменить stub на настоящий adapter, не переписывая agent loop и tool authorization.

### OpenViking не смешивается с MIT distribution

OpenViking остаётся внешним сервисом. Его AGPLv3-код не добавляется в DSH distribution.

### Ошибки стали пригодны для автоматической обработки

Коды `MEMORY_UNAUTHORIZED`, `MEMORY_RETRYABLE`, `MEMORY_PROVIDER_UNAVAILABLE` и `MEMORY_PROVIDER_ERROR` позволяют различать отказ доступа, временную проблему и ошибку данных.

### Оркестрация не создала второй runtime

Coordinator, worker, review, budget и DAG validation используют существующие DSH lifecycle, authorization, cancellation и persistence.

### Deployment стал воспроизводимее

Image digest validation и fail-closed checks уменьшают риск незаметно запустить другую версию TencentDB stack.

### Тесты стали ближе к реальному продукту

Проверяются не только отдельные классы, но и:

- Loader composition;
- реальный headless app;
- subprocess gateway;
- replay transcript;
- persisted session logs.

## Что намеренно не сделано

Следующие вещи сознательно не выдаются за готовые.

### Реальный TencentDB network adapter

Пока есть локальный deterministic stub и response normalizers. Реальный HTTP transport, credential-store integration и live provider validation не подключены.

### Реальный OpenViking network adapter

Пока есть локальный stub с explicit depth. Реальный отдельный OpenViking deployment не подключён к DSH runtime.

### `memory_store`

Store operation не добавлялся в production-like DSH seam, поскольку для него нужно отдельно определить:

- durable event semantics;
- persistence commit behavior;
- indexing semantics;
- provider failure and rollback rules;
- model-facing consumer contract.

### Полные pi-ai diagnostics

HTTP status сохраняется, если он уже есть в flattened message. Request id и headers пока недоступны на failed-response path через текущий public pi-ai API.

## Что полезно сделать дальше

1. Зафиксировать durable event schema для remote citation metadata как стабильный experimental format.
2. Добавить adapter-owned HTTP transport для TencentDB и OpenViking только с redacted typed responses.
3. Добавить Loader snapshot, который проверяет remote `memory/search` event целиком, включая source/title/kind/content.
4. Добавить replay path, который не обращается к remote provider после записи citation.
5. Отдельно решить, нужен ли `memory_store`, и только после этого реализовывать его persistence/rollback contract.
6. Для полного pi-ai diagnostics preservation либо дождаться upstream hook, либо реализовать adapter-owned transport с эквивалентными retry, auth, streaming и replay semantics.

## Основные файлы

### DeepSeek Harness

- `packages/experimental/memory/src/index.ts`
- `packages/experimental/memory/src/types.ts`
- `packages/experimental/memory/src/remote-contract.ts`
- `packages/experimental/memory/tests/memory.spec.ts`
- `packages/experimental/memory/tests/remote-contract.spec.ts`
- `packages/experimental/memory/tests/invariant.spec.ts`
- `packages/experimental/tool-memory/src/index.ts`
- `packages/experimental/tool-memory/tests/loader-composition.spec.ts`
- `examples/headless-agent/tests/fixtures/workflow.cordis.snapshot.yml`
- `examples/headless-agent/tests/fixtures/workflow-mock-llm.ts`
- `examples/headless-agent/tests/snapshots/bounded-workflow/stream-json.expected.jsonl`
- `packages/llm/llm-pi-ai/src/stream.ts`
- `packages/llm/llm-pi-ai/tests/convert.spec.ts`

### Harness Integrations

- `README.md`
- `AUDIT_LOG.md`
- `docs/INTEGRATION_PLAN.md`
- `docs/DSH_MEMORY_SEAM.md`
- `docs/EXTERNAL_MEMORY_ADAPTERS.md`
- `integrations/local-memory.py`
- `integrations/test_local_memory.py`
- `integrations/test_probe.py`
- `integrations/test_ruflo_dsh_plan.py`
- `integrations/ruflo-dsh-plan.py`
- `integrations/tencentdb-agent-memory/run.sh`
- `integrations/tencentdb-agent-memory/probe.py`
- `integrations/tencentdb-agent-memory/stub_gateway.py`

## Заключение

Главный результат работы не в том, что Harness уже подключён к production TencentDB или OpenViking.

Главный результат в том, что локальный DSH теперь имеет безопасную и проверяемую основу для такого подключения:

- scope контролирует DSH;
- citations фиксируются в session log;
- replay не зависит от скрытого внешнего состояния;
- provider errors не маскируются;
- remote ids не подделываются под DSH session records;
- OpenViking depth выбирается явно;
- workflow остаётся частью существующего DSH runtime;
- все локальные шаги проверяются keyless tests.

Это позволяет подключать настоящие внешние сервисы позже, не ломая основные гарантии Harness.
