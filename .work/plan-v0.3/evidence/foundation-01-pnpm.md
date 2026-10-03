# F-01 · Рабочий bootstrap `pnpm`: диагноз и канонический runner

**Статус: READY_FOR_REVIEW**

## Что сделано

1. Подтверждён первый элемент `PATH` и поломка обычного `pnpm` (диагноз воспроизведён заново, не скопирован из плана).
2. Подтверждён рабочий обход `corepack pnpm` и его пригодность для реальной задачи.
3. Прогнан гейт F-01: `corepack pnpm -r run typecheck` → **EXIT=0** (12 из 13 workspace-проектов).
4. Прогнан контроль выбора runner'а: `corepack pnpm run typecheck` (**без `-r`**) → **EXIT=1**.
5. В `README.md` (раздел «Команды») записана каноническая строка шага 5 и добавлена заметка о `npm_execpath` (нужна для `verify:profile`, см. F-03).

## Изменённые пути

- `README.md` — раздел «Команды»: +11 строк (текст шага 5 + заметка про `npm_execpath`).
- `.work/plan-v0.3/evidence/foundation-01-pnpm.md` — этот файл.

## Таблица «команда → exit code → наблюдение»

| Команда | exit | Наблюдение |
| --- | --- | --- |
| `where.exe pnpm` | 0 | Первой строкой `C:\Reposit\deepseek-harness\deepseek-harness\node_modules\.bin\pnpm` (+ `.CMD`), затем `%APPDATA%\npm\pnpm(.cmd)`; `.bin` DSH-чекаута перекрывает глобальные установки |
| `pnpm --version` | **1** | Без вывода версии; stderr дословно: `'"H:\.pnpm-store\v11\links\@\pnpm\12.4.2\f6c04c51569ad17329595648978a95bb61c85b87174d5701d9eef91259f69e26\bin\\..\node_modules\pnpm\pnpm"' is not recognized as an internal or external command, operable program or batch file.` |
| `corepack pnpm --version` | 0 | `12.4.2` |
| `Get-Content <DSH-checkout>\.bin\pnpm.CMD` | 0 | Шим запускает `node "%~dp0\..\pnpm\bin\pnpm.mjs"` (pnpm 11.7.0 из `.pnpm\pnpm@11.7.0`) |
| `(Get-Item 'H:\.pnpm-store\...\<hash>\bin\pnpm.CMD').Length` + `Get-Content` | 0 | **52 байта**, содержимое ровно `@SETLOCAL` / `@"%~dp0\..\node_modules\pnpm\pnpm"   %*` — цель `node_modules\pnpm\pnpm` (2051 байт) не `.exe` |
| `Get-Content ...\node_modules\pnpm\pnpm -TotalCount 1` | 0 | `# pnpm's native binary replaces this file during installation (see` — то есть цель шима не исполняемый файл Windows, `cmd.exe` его запустить не может |
| `corepack pnpm -r run typecheck` | **0** | «Scope: 12 of 13 workspace projects», все `Done`, `TYPECHECK_EXIT=0` |
| `corepack pnpm run typecheck` (без `-r`) | **1** | Падает за ~1 с: `$ pnpm -r run typecheck` → `[ERROR] This project is configured to use 12.4.2 of pnpm. Your current pnpm is v11.7.0` … `[ELIFECYCLE] Command failed with exit code 1.` |
| `node --import tsx/esm apps/cli/src/bin.ts --version` (через `dsh --version`) | 0 | `0.1.7-rc.2` (независимая проверка CLI, нужна для F-03) |

## Уточнение к R-06 (отличие от текста плана)

План (F-01 шаг 4) объясняет падение без `-r` «вложенным bare `pnpm` 11.7.0 из `.bin` DSH-чекаута». Это подтверждено, но **механизм точнее**: вложенный `pnpm` 11.7.0 останавливается не на сломанном шиме H:-store, а раньше — на собственной проверке версии pnpm 12.4.2 («pnpm does not switch versions when running under corepack»), и только при прямом запуске `pnpm` из `PATH` в каталоге репозитория срабатывает self-switch на сломанный H:-store шим. Для выбора runner'а вывод не меняется: рабочий вариант — **только** `corepack pnpm -r run <script>`.

## Ограничения

- Диагноз снят на живой машине при работающем DSH; профиль при этом не читался и не изменялся.
- «Открытая проверка» плана (какой именно процесс печатает ошибку: self-switch pnpm 11.7.0 vs `@pnpm/exe` из `%LOCALAPPDATA%\pnpm`) **не закрыта** — цепочка доказана до «вложенный pnpm 11.7.0 → проверка версии / H:-store 12.4.2».
- Резервный путь (`npm i -g pnpm@12.4.2`, `manage-package-manager-versions=false`) описан в плане, но в этой кампании **не исполнялся** и не проверялся.
- `corepack` тянет бинарь из сети при первом вызове; в этой сессии он уже был в кэше `%LOCALAPPDATA%\node\corepack\v1\pnpm\12.4.2`, сеть не потребовалась.

## Что НЕ проверено

- Работа `corepack pnpm -r run <script>` для остальных скриптов репозитория (`build`, `smoke`, `test`, `check`, `pack:local`) — вне шага F-01.
- Поведение на машине без кэша corepack / без сети.
- `scripts/` не изменялись (запрещено условиями задачи), поэтому дефект `scripts/lib/process.mjs:52-58` (`pnpmLaunch` берёт `pnpm` из `PATH`, когда `npm_execpath` не `.js`/`.mjs`) остаётся — он зафиксирован в F-03.

## Правка по запросу Lead (после приёмки F-01)

README заявлял «DSH 0.1.5-rc.2 — для `verify:profile`», фактическая версия CLI на машине — **0.1.7-rc.2** (`dsh --version` → `0.1.7-rc.2`, EXIT=0; `dsh-guard --dry-run` печатает `build up to date (c7c4c72, 0.1.7-rc.2)`). Строка в `README.md` (раздел «Требования») исправлена на `DSH 0.1.7-rc.2 … (фактическая версия CLI; здесь ранее было указано 0.1.5-rc.2)`.