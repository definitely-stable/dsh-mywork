# Evidence: red-team A — команды и их фактический вывод (2026-09-27)

Все команды — read-only. Рабочий каталог `H:\Repo\DSH-MyWork`.
Скрипты атаки: `.tmp/plan-v03-red-a/verify-anchors.mjs`, `.tmp/plan-v03-red-a/verify-anchors-b.mjs`.
Снапшот плана: `.tmp/plan-v03-red-a/snapshot/` (см. §0 отчёта).

## 1. `pnpm`-runner (F-01, F-12, F-25)

```
> where.exe pnpm
C:\Reposit\deepseek-harness\deepseek-harness\node_modules\.bin\pnpm      <- первый в PATH (как в F-01)
C:\Reposit\deepseek-harness\deepseek-harness\node_modules\.bin\pnpm.CMD
C:\Users\Dmitry\AppData\Roaming\npm\pnpm

> pnpm --version
EXIT=1
'"H:\.pnpm-store\v11\links\@\pnpm\12.4.2\f6c04c51569ad17329595648978a95bb61c85b87174d5701d9eef91259f69e26\bin\\..\node_modules\pnpm\pnpm"' is not recognized as an internal or external command,
operable program or batch file.

> corepack pnpm --version
EXIT=0
12.4.2                    <- F-01 подтверждён дословно

> corepack --version
0.35.0

> corepack pnpm run typecheck       <- ГЕЙТ F-01 шага 4 и ГЕЙТ F-12 (команда 2)
$ pnpm -r run typecheck
[ERROR] This project is configured to use 12.4.2 of pnpm. Your current pnpm is v11.7.0
Corepack invoked pnpm with this version, and pnpm does not switch versions when running under corepack.
Align the "packageManager" field in package.json with "devEngines.packageManager", or invoke pnpm directly (without corepack) so it can switch versions automatically.
If you want to bypass this version check, you can set the "pmOnFail" configuration to "warn" or "ignore" ...
[ELIFECYCLE] Command failed with exit code 1.
EXIT=1   SECONDS=1        <- ГЕЙТ НЕ ПРОХОДИТ

> corepack pnpm -r run typecheck   <- рабочий вариант (без вложенного bare pnpm)
Scope: 12 of 13 workspace projects
packages/contracts typecheck: Done ... packages/planner typecheck: Done
EXIT=0

> node_modules\.bin\tsc.cmd --noEmit -p packages/contracts/tsconfig.json   <- гейт E-02
EXIT=0   SECONDS=2
```

Механизм: корневой скрипт `typecheck` = `pnpm -r run typecheck`; вложенный `pnpm` резолвится из PATH
(DSH `.bin\pnpm` = 11.7.0) и падает на `pmOnFail`, потому что `package.json:8` требует `pnpm@12.4.2`.

## 2. `bd`-backend (F-13, F-16, F-17, F-21, F-22)

```
> (Get-Command bd).Source
C:\Users\Dmitry\AppData\Roaming\npm\bd.ps1     (есть также bd, bd.cmd)

> & "$env:APPDATA\npm\bd.cmd" version
bd version 1.3.0 (f45b249ce: HEAD@f45b249ce6b4)      <- bd УСТАНОВЛЕН, версия 1.3.0

> bd.cmd (334 байта) указывает на: "%dp0%\node_modules\@beads\bd\bin\bd.js"
> Test-Path node_modules\beads ; Get-ChildItem node_modules\.bin -Filter 'bd*'
False / пусто     <- в проекте bd нет, только глобальный .cmd-шим

> node -e "spawnSync('bd',['version'],{encoding:'utf8',shell:false})"
{"status":null,"errorCode":"ENOENT","errno":null,"stdout":"","stderr":""}
   <- P1 подтверждён: ENOENT, а не EPERM. Тест-файл печатает про EPERM (tests/beads-adapter.test.mjs:67-71)

> статический подсчёт: tests/beads-adapter.test.mjs — 70 top-level test(), из них 23 c `{ skip: !HAS_BD }`
   <- «23 skipped» и «pass 70 при живом bd» арифметически верны
```

## 3. Живой профиль (F-04, F-05, F-61) — только чтение

`C:\Users\Dmitry\.dsh\profiles\web\cordis.patch.yml` — 105 строк, 2586 байт:

```
 20: - {
 21:     id: web-ui-task-board,
 22:     config:
 23:       {
 24:         plugin: "@linxin666/dsh-client-ui-task-board",
 25:         config: { sessionDefaultPermission: workspace-write },
 26:         announceToAgent: true,
 27:         autoRunTodo: true,
 ...   autoRunPaused, autoRunMaxConcurrent, autoRunMaxRetries, autoRunStallMinutes, autoRunMaxPerHour,
 33:         autoRunMaxPerDay: 0
 34:       }
 35:   }
 66: - id: agent-preset-registry
 67:   config:
 68:     default: cordis
```
`Select-String sessionDefaultPermission` → 1 совпадение (строка 25). `Select-String autoRun` → 7.
Анкоры F-04/F-05/F-61 совпадают с файлом **точно**.

## 4. Доска (F-06, F-07, F-09, F-27, F-61, F-62) — только чтение

```
> task_board_get MW-044
{"ok": false, "code": "task-not-found", "message": "no task with id MW-044"}
   <- идентификатор карточки на доске — UUID; «MW-044» живёт только в title

> task_board_list (limit 15)
board: revision 324, timeZone Asia/Yekaterinburg, maxSubtaskDepth 1,
       sessionDefaultPermission "read-only", runningSessions 12, armedSchedules 0,
       counts { backlog: 32, todo: 0, running: 0, done: 19, failed: 1, archived: 3 }
total: 52
   <- F-62 фиксирует revision 324 и «backlog 34 (в т.ч. 2 архивных), done 19, failed 2».
      revision совпадает, счётчики — нет.
   <- F-61 фиксирует провал пресета: identity MW-002 latestExecution.error =
      'agent-presets: preset "standard" failed to mount: 24 rows name plugins that cannot be resolved: ...'
      startedAt 1789583900711 → endedAt 1789583900781 (70 мс) — совпадает с F-61 п. 4.
```

## 5. Файлы/символы (машинная проверка анкоров)

`node .tmp/plan-v03-red-a/verify-anchors.mjs` — 84 анкора §6 «Сводка доказательств» `20-STEPS-foundation.md`
по файлам MyWork: **0 анкоров вне диапазона, 0 несуществующих файлов MyWork** (19 «missing» — пути
DSH-чек-аута, проверены отдельно, все существуют).

`node .tmp/plan-v03-red-a/verify-anchors-b.mjs` — 184 анкора `21-…`, 171 `22-…`, 131 `23-…`.
Найден один анкор вне диапазона: `packages/contracts/src/board.ts:434-441` (в файле 381 строка; сам план
оговаривает это в записи B-03, но оставляет неверный путь в поле «Файлы»).

Дополнительно проверено вручную:
- `packages/core/src/board.ts` = 566 строк, `packages/contracts/src/board.ts` = 381 — как заявлено в §0.2 файла 22;
- `packages/core/src/authority.ts` = 86 строк, `packages/contracts/src/authority.ts` = 135 → анкор `authority.ts:113`
  указывает на **contracts** (владелец `mywork-db`), а не на core;
- `packages/controller/src/dsh-session.ts:93` = `scopedTools: true` (E-39 — точно);
- `tests/boundaries.test.mjs:488` = `assert.deepEqual(modules, ['node:crypto'], ...)` (E-01 — точно);
- `collect(join(repoRoot, 'packages'` в `tests/boundaries.test.mjs` — ровно **6** (F-42 «было 6» — точно);
- `packages/beads-adapter/src` — 10 файлов, `adapter.ts` 45299 б (F-15 — точно);
- `packages/controller/src/security.ts`… `packages/core/src/security.ts:203-207` содержит `worktree-escape` (E-05 — точно);
- `tsdown.config.ts` всех 12 пакетов содержат `clean: true`.

## 6. Полный статический подсчёт тестов (базлайн)

```
adapters 15, attempt 12, authority 7, beads-adapter 70, board 24, boundaries 26, budget 15,
claim-saga 32, config 7, context 57, events 4, evidence 19, guards 5, lease 25, memory-beads 17,
memory 68, plan-mutation 72, review 10, routing 19, runtime 17, scheduler 27, security 38,
session 51, skill 28, storage-crash 2, storage 15, task 16, team 12
TOTAL = 710  (710 − 23 skip = 687 pass — совпадает с «710 / 687 / 23» файла 20)
```
Базлайн `659 tests / 636 pass` из `21-STEPS-execution.md` §1.5 — **устарел на 51 тест**.
