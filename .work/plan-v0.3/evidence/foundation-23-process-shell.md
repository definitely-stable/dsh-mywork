# F-23 · `scripts/lib/process.mjs`: ветка `shell: true` ведёт в битый `pnpm`-шим

**Статус: READY_FOR_REVIEW.** Гейт выполнен: `node scripts/pack.mjs` → **EXIT 0** (было 1), `Select-String scripts/lib/process.mjs -Pattern 'shell: process.platform'` → **0 совпадений**. Путь по умолчанию больше не зависит от того, что `PATH` разрешит первым.

## Изменённые пути

- Modify `scripts/lib/process.mjs` — `pnpmLaunch()` переписан на пять **shell-free** ветвей; добавлены `createProbes()` и пробники `defaultPnpmCjsNear` / `defaultCorepackEntry` / `defaultPnpmOnPath`; `runPnpm()` возвращает выбранную ветвь в поле `launch`.
- Create `tests/scripts-launch.test.mjs` — 3 теста на инъектируемых пробниках (файл создан по прямому разрешению Lead: вне исходного write-scope, конфликтов нет).
- Modify `scripts/pack.mjs` — запись выбранной ветви в `.tmp/pack-logs/pnpm-pack.launch.log` (шаг 3 плана).

## Корень дефекта (подтверждён прямым прогоном)

`scripts/lib/process.mjs:54` распознавал `npm_execpath` только по `/\.[cm]?js$/`. Значение не подходило, управление уходило в `:57` — `{ command: 'pnpm', args: [], shell: process.platform === 'win32' }`, то есть решение принимал `cmd.exe`, который находил 52-байтный битый store-шим.

**Базовый замер ДО правки** (`node scripts/pack.mjs`, exit 1) — дословно тот же текст, что цитирует план:

```
Error: pack: pnpm pack exited with code 1
'"H:\.pnpm-store\v11\links\@\pnpm\12.4.2\f6c04c51569ad17329595648978a95bb61c85b87174d5701d9eef91259f69e26\bin\\..\node_modules\pnpm\pnpm"' is not recognized as an internal or external command,
operable program or batch file.
```

### Уточнение к проверенным фактам плана (факт машины, не «план неверен»)

План записал, что `npm_execpath` — «путь **без** расширения». **Сегодня это не так:** `$env:npm_execpath` = `...\@pnpm\exe\11.7.0\a254132c…\node_modules\@pnpm\exe\pnpm.exe` — оканчивается на `.exe` и существует. Regex `/\.[cm]?js$/` не срабатывает в обоих случаях, поэтому дефект воспроизводится, но конкретная форма пути другая. Оба состояния зафиксированы: ветка `shell:true` ломается независимо от того, `.exe` там или путь без расширения.

## Реализованные ветви (все `shell: false`)

| # | Условие | Результат | Почему |
|---|---|---|---|
| 1 | `npm_execpath` оканчивается на `.js/.cjs/.mjs` и файл существует | `node <execPath>` | как было |
| 2 | рядом с `npm_execpath` есть настоящий `node_modules/pnpm/bin/pnpm.cjs` | `node <pnpm.cjs>` | лечит extensionless store-ссылку из плана |
| 3 | найден JS-entry corepack (`<node>\node_modules\corepack\dist\corepack.js`) | `node <corepack.js> pnpm` | детерминированный канон runner'а; `corepack` ставится вместе с Node |
| 4 | `where.exe pnpm` даёт `.exe` | спавн напрямую | без shell |
| 5 | `where.exe pnpm` даёт только `.cmd`/`.bat` | `cmd.exe /d /s /c "<одна командная строка>"`, `shell: false` | `.cmd` нельзя иначе; но это **не** `shell: true`, и Node не перекавычивает пути дважды |
| — | ничего не найдено | `{ kind: 'unavailable', reason }` | `pack.mjs` печатает причину, а не «is not recognized» |

## Таблица «команда → exit code → наблюдение»

| Команда | exit code | Наблюдение |
|---|---|---|
| `node scripts/pack.mjs` (**ДО правки**) | **1** | `pnpm pack exited with code 1` + текст битого шима (см. выше) |
| `node --test --test-isolation=none tests/scripts-launch.test.mjs` | **0** | `ℹ tests 3 / ℹ pass 3 / ℹ fail 0 / ℹ skipped 0` |
| `Select-String scripts\lib\process.mjs -Pattern 'shell: process.platform'` | 0 | **matches = 0** — гейт F-23 выполнен |
| `node scripts/pack.mjs` (**ПОСЛЕ**) | **0** | `pack: @dsh-mywork/controller@0.1.0`, `…\.tmp\pack\dsh-mywork-controller-0.1.0.tgz` |
| `Get-Content .tmp\pack-logs\pnpm-pack.launch.log` | 0 | `branch: corepack`, `command: C:\Program Files\nodejs\node.exe`, `args: ["…corepack.js","pnpm"]`, `shell: false` — выбрана ветвь 3 |
| `Get-ChildItem packages\controller -Filter *.tgz` | 0 | `count = 0` |

## Ограничения

- Тесты используют инъектируемые пробники, поэтому они проверяют **логику выбора ветви**, а не реальный спавн. Реальный спавн проверен гейтом `pack.mjs` (exit 0) — то есть ветвь `corepack` исполнена по-настоящему.
- Ветви 2, 4 и 5 на этой машине **не исполнялись**: `npm_execpath` не даёт extensionless-путь с соседним `pnpm.cjs`, а `where.exe pnpm` не даёт `.exe`. Они покрыты тестами с подставными пробниками.
- `quoteCommandArg` и `runCaptured` не менялись — `scripts/verify-profile.mjs` импортирует их и продолжает работать без правок.

## Что НЕ проверено

- Не проверялась ветвь `cmd-shim` на живой `.cmd`-шим (нет `.exe`-кандидата, но и `.cmd` не выбирается, потому что corepack идёт раньше). Риск: экранирование `/s /c` в этой ветви.
- Не проверялось поведение на чужой машине без `corepack` (ветвь 3 исчезнет, сработает 4 или 5).
- Не проверялось, остался ли `H:\.pnpm-store\…\bin\pnpm.CMD` битым — это вне репозитория и вне границ кампании (план прямо запрещает «чинить» pnpm).
- `node scripts/pack.mjs` запускался мной как гейт; repo-wide сборку/typecheck я не запускал (запрещено, гейт L — за Lead).
