# Локальная установка DeepSeek Harness (dsh) — памятка

Локальный запуск из исходников вместо `npx @deepseek-ai/dsh web` (который каждый раз
скачивает пакет). Установка уже выполнена и проверена — ниже инструкции, как этим
пользоваться и что делать после обновления.

## Пути

| Что | Где |
|---|---|
| Репозиторий | `~/projects/deepseek-harness` |
| Глобальная команда `dsh` | `~/.local/share/pnpm/bin/dsh` (каталог уже в PATH) |
| Исходник shim | `~/projects/deepseek-harness/scripts/dsh-global-shim` |
| Данные сессий/настройки | `~/.dsh` |

## Запуск

Из каталога репозитория (запуск из исходников через tsx):

```sh
cd ~/projects/deepseek-harness
pnpm dsh web            # UI на http://127.0.0.1:3080
pnpm dsh web --no-open  # без открытия браузера
pnpm dsh web --port 8080
```

Глобально, из любого каталога (запуск собранного `apps/cli/lib/bin.js`):

```sh
dsh web
```

Проверка версии: `dsh --version` → `0.1.1-rc.2` (или `pnpm dsh --version`).

## Первичная установка (что уже сделано)

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install     # зависимости workspace (использует кэш store, ~12 с)
pnpm run build   # сборка lib + web-интерфейса
```

Требования: Node 22.19+/24+/26 (у нас 26.7.0), pnpm (репозиторий пинит 11.7.0).

## Обновление после `git pull`

```sh
cd ~/projects/deepseek-harness
git pull
pnpm install
pnpm run build
```

Глобальный shim указывает на `apps/cli/lib/bin.js`, поэтому после пересборки
команда `dsh` сразу использует новую версию — переустанавливать shim не нужно.

## Глобальная команда `dsh`

Shim — это простой скрипт-запускатель, установленный в `~/.local/share/pnpm/bin`
(тот же каталог, куда pnpm кладёт свои глобальные bin). Он берёт `node` из PATH,
при отсутствии — абсолютный путь linuxbrew:

```sh
#!/bin/sh
NODE_BIN=$(command -v node 2>/dev/null || echo /home/linuxbrew/.linuxbrew/bin/node)
exec "$NODE_BIN" /var/home/Trintos/projects/deepseek-harness/apps/cli/lib/bin.js "$@"
```

Удалить глобальную команду:

```sh
rm ~/.local/share/pnpm/bin/dsh
```

Пересоздать (если файл удалили) из репозитория:

```sh
install -m 755 ~/projects/deepseek-harness/scripts/dsh-global-shim ~/.local/share/pnpm/bin/dsh
```

## ⚠️ Подводный камень: не использовать `pnpm link --global`

В этой версии pnpm (11.x) команда `pnpm link --global <dir>` из корня workspace
**пересоздаёт корневой `node_modules` и падает** с `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`
(workspace-зависимости не резолвятся). Кроме того, она молча портит файлы:

- `package.json` — добавляет `"@deepseek-ai/dsh": "link:apps/cli"` в dependencies;
- `pnpm-workspace.yaml` — **заменяет** overrides (удаляет линки `vendor/cosmokit`
  и `vendor/schemastery`);
- `pnpm-lock.yaml` — перегенерируется под испорченные файлы.

Восстановление:

```sh
git checkout -- package.json pnpm-workspace.yaml pnpm-lock.yaml
pnpm install
```

Вместо link используется shim (см. выше) — эффект тот же, а файлы не трогаются.

## API-ключ

UI запускается и без ключа. Для работы агента нужен `DEEPSEEK_API_KEY`:

- в `.env` в корне репозитория, или
- в `~/.dsh/.env`.

## Частые вопросы

- **Порт 3080 занят?** — текущая веб-сессия (GUI агента) работает из собственной
  npx-копии и занимает 3080; локальный запуск используйте на другом порту
  (`dsh web --port 3081`).
- **Git status показывает LOCAL-SETUP.md?** — нет, файл добавлен в `.gitignore`
  (локальная пометка, в репозиторий не коммитится).
- **Быстрая проверка после пересборки** — `pnpm dsh --version` и
  `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3080/` (ожидается 200).

## Устранение неполадок

### dsh не стартует: session artifact uses .jsonl, but backend is configured for compression zstd

Симптом: при запуске падает workspace-плагин с
`uses .jsonl, but this backend is configured for compression "zstd"` (или
`unsupported flat-file layout`). Причина: в `~/.dsh/sessions` лежат артефакты
старых версий dsh в виде плоских `session.jsonl` (без сжатия), а текущая сборка
требует `session.jsonl.zstd` и отказывает при смешанном кодировании.

Правильный фикс (по одному каталогу сессии):

```sh
# для каждого каталога сессии с плоским файлом:
cd ~/.dsh/sessions/--var-home-Trintos-projects--/<session-id>
zstd -f session.jsonl -o session.jsonl.zstd && rm session.jsonl
```

Проверка, что плоских файлов не осталось:

```sh
find ~/.dsh/sessions -name '*.jsonl'
# вывод должен быть пустым
```

⚠️ Чего делать НЕ стоит:
- не сжимать в `session.jsonl.zst` (суффикс `.zst` не распознаётся — только `.zstd`);
- не складывать плоские файлы в одну папку внутри `~/.dsh/sessions` командой вроде
  `mv ... session.jsonl old_session/` — все файлы называются одинаково, и `mv`
  перезапишет их друг другом (выживет только один). Дубликаты вне дерева сессий —
  только через `~/.dsh/old_session` (вне `sessions/`), как отдельный архив.

### Сброс настроек

Настройки и креды: `~/.dsh/settings.yaml` (бэкап рядом: `settings.yaml.bak.*`),
креды — `~/.dsh/.credentials.yaml`.
