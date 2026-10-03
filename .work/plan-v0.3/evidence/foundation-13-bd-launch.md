# F-13 · `bd`-seam: резолвер JS-entry через `process.execPath`

**Статус: READY_FOR_REVIEW**

## Что сделано

1. Шаг 0 плана закрыт: `bd` **установлен** — `@beads/bd@1.3.0`, npm-глобально (`%APPDATA%\npm\node_modules\@beads\bd`), bin `{"bd":"bin/bd.js"}`, `bd version` → `bd version 1.3.0 (f45b249ce: HEAD@f45b249ce6b4)`.
2. Воспроизведён дефект: `spawn('bd', …, { shell: false })` → `ENOENT` (`errno` **-4058**), `bd.cmd` с `shell: false` → `EINVAL`.
3. Создан `packages/beads-adapter/src/launch.ts`: `resolveBeadsLaunch`, `findBeadsEntry`, `BeadsLaunchRefusal` (`BEADS_BINARY_NOT_FOUND`), `BEADS_INSTALL_HINT`.
4. Создан `tests/beads-launch.test.mjs` — 3 теста (гейт F-13).

## Изменённые пути

- Create `packages/beads-adapter/src/launch.ts`
- Create `tests/beads-launch.test.mjs`
- Modify `packages/beads-adapter/src/index.ts` (реэкспорт `launch.ts`)

## Таблица «команда → exit code → наблюдение»

| Команда | exit | Наблюдение |
| --- | --- | --- |
| `Get-Command bd` / `where.exe bd` | 0 | `C:\Users\Dmitry\AppData\Roaming\npm\bd` (без расширения), `bd.cmd`, `bd.ps1`; **`bd.exe` на `PATH` нет** |
| `bd version` | 0 | `bd version 1.3.0 (f45b249ce: HEAD@f45b249ce6b4)` |
| `node -e "spawnSync('bd',['version'],{shell:false})"` | 0 (probe) | `status=null err=ENOENT errno=-4058` — ровно P1 из `FINAL-REPORT` §8.2 |
| `node -e "spawnSync('bd.cmd',['version'],{shell:false})"` | 0 (probe) | `status=null err=EINVAL` — шим нельзя запускать без шелла |
| `node -e "spawnSync(process.execPath,[bd.js,'version'],{shell:false})"` | 0 (probe) | `status=0`, `bd version 1.3.0 …` — **seam работает** |
| `node -e "spawnSync(<pkg>\bin\bd.exe,['version'],{shell:false})"` | 0 (probe) | `status=0` — нативный бинарь тоже годится, но план требует JS-entry (и он переносим между установками) |
| `Get-Content %APPDATA%\npm\bd.cmd` | 0 | Шим запускает `node "%dp0%\node_modules\@beads\bd\bin\bd.js"` — то, что резолвер и находит |
| `node --test --test-isolation=none tests/beads-launch.test.mjs` | **0** | `ℹ tests 3 / ℹ pass 3 / ℹ fail 0 / ℹ skipped 0` — **гейт F-13** |

## Реализованное поведение

- `resolveBeadsLaunch({ platform: 'win32', findEntry })` → `{ command: process.execPath, args: [entry], shell: false }`; найденный entry обязан быть `.js/.mjs/.cjs` (шим `.bin` не подходит).
- `platform !== 'win32'` → `{ command: 'bd', args: [], shell: false }` (поведение POSIX не изменилось); `findEntry` в этом случае **не вызывается** — это проверено тестом, который бросает исключение из `findEntry`.
- win32 без entry → **типизированный отказ** `BeadsLaunchRefusal` с `code = BEADS_BINARY_NOT_FOUND` и `hint = 'npm install -g @beads/bd@1.3.0'`; молчаливого отката на шим нет.
- `findBeadsEntry` ищет в трёх местах: (1) цепочка `node_modules` вверх от `cwd` — пин проекта; (2) `bd.cmd` из `PATH` — берётся **путь entry, который называет сам шим** (шим не исполняется); (3) известные npm-глобальные корни (`%APPDATA%\npm\node_modules`, `%LOCALAPPDATA%\npm\node_modules`, `npm_config_prefix`, каталоги рядом с `process.execPath`).

## Ограничения и риски

- Эвристика поиска может найти **чужой** `bd` (например, из другого префикса npm). Митигация плана соблюдена: приоритет у локального `node_modules`, порядок источников детерминирован, есть явный `options.entry`, а при отсутствии находки — отказ, а не догадка.
- `ProcessRunnerOptions.binary` сохранён как **высший приоритет** (F-14): явный путь — ответ вызывающего, резолвер только значение по умолчанию.
- Разбор `bd.cmd` — регулярное выражение по тексту шима; если npm изменит шаблон шима, источник (2) перестанет срабатывать и останутся источники (1) и (3).

## Что НЕ проверено

- Поведение на машине без `bd` (отказ проверен только юнит-тестом с инъекцией `findEntry`).
- Поведение на POSIX-хосте (тест инжектирует `platform: 'linux'`; реальный Linux не запускался).
- Установка `bd` в локальный `node_modules` проекта (источник 1) — на этой машине `bd` только глобальный.
