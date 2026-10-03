# red-team B — доказательства для раздела «Дельта 0.2.0-rc.2 (2026-10-03)»

Файл сопровождает `.work/plan-v0.3/92-RED-TEAM-B.md`, раздел в конце. Скрипты: `.tmp/red-b-delta/{ledger,graph,execs}.mjs`, сырые выводы — `.tmp/red-b-delta/{ledger,graph,execs}.out.txt`.
Всё только чтение: живой профиль `C:\Users\Dmitry\.dsh` не изменялся, задачи доски не запускались, `.work/tasks/**` не трогался.

## 0. Замороженное состояние входа

| Объект | Замер |
|---|---|
| `30-CARD-EDITS.md` | 282 496 Б, 1427 строк, mtime `03.10.2026 11:40:33`, SHA256 `DF15F4CAB5CED1592210E80BBDD21B1A739EDCD22A0FEA1B26434634F007369C` |
| `.work/tasks/tasks.json` | 55 записей, `planRevision=2`, `schemaVersion=1` (не менялся с 27.09) |
| леджер доски | 369 794 Б, mtime `03.10.2026 12:23:35`, `revision=341` |
| чекаут DSH | `git rev-parse HEAD` → `639ed015397290b3745d163aafe02ffee4aa3f84`, `describe` → `dsh-v0.2.0-rc.2`; локальная ветка `master` = тот же коммит |
| установленная доска | `@linxin666/dsh-client-ui-task-board@0.4.4`, `package.json` mtime `02.10.2026 21:15:53` |

## 1. Живой леджер (скрипт `ledger.mjs`)

```text
schemaVersion = 4
revision      = 341
tasks         = 55
status        = {"failed":2,"backlog":34,"done":19}
status+arch   = {"ARCHIVED/failed":1,"backlog":32,"done":19,"failed":1,"ARCHIVED/backlog":2}
archived(true)= 3  [3cad0e0a…:MW-001 | e5bdbc44…:MW-027 | d66573e0…:MW-035]
permissionConfirmedAt present = 22 / 55; without = 33
permission values = {"workspace-write":55}
scheduler keys = ["timeZone","ledgerId","lastTickAt"]
tasks with armed schedule = 0
tasks with parentId = 0; distinct parents = 0
observed max subtask depth (from parentId chain) = 0
```

Ответ живой доски (`task_board_list`, `includeArchived: true`, read-only):

```text
board: revision 341, timeZone Asia/Yekaterinburg, maxSubtaskDepth 1,
       sessionDefaultPermission "read-only", runningSessions 21, armedSchedules 0,
       counts { backlog 32, todo 0, running 0, done 19, failed 1, archived 3 }
total 55 (без includeArchived — 52)
permissionPending: true — ровно 33 карточки: MW-021…MW-041 (без подтверждённых),
       MW-044…MW-055; из них архивных — MW-027, MW-035
```

Семантика `runningSessions` — `runner.listRunning()` (сессии деплоя, не карточки): `…task-board/src/host-service.ts:342,362`, `src/protocol.ts:24`.
`permissionPending` вычисляется при отдаче: `…task-board/src/host/agent-tools.ts:159-164` → `requiresPermissionConfirmation`.

## 2. Доска 0.4.4: дефекты

| Утверждение | Доказательство |
|---|---|
| версия 0.4.4, `peerDependencies`/`dsh.engines.dsh` = `>=0.2.0-rc.1` | `…task-board/package.json:4,27,47`; `profiles/web/package.json:6` (`^0.4.4`) |
| `sessionDefaultPermission` вложен в `config.config` | `profiles/web/cordis.patch.yml:25`; `dsh-web-all/lib/shell-CKmkldkq.js:1093-1097` (`familyConfigOf` срезает только `plugin`); читатель — только верхний уровень: `…task-board/src/index.ts:323` |
| эффективный дефолт `read-only` | `…task-board/src/core/handover.ts:44`, `src/index.ts:109`; живой API: `sessionDefaultPermission: "read-only"`; 33 карточки `permissionPending` |
| 7 ключей `autoRun*` в профиле | `profiles/web/cordis.patch.yml:27-33`; **0 совпадений** `autoRun` в `…task-board/src/**` и `lib/**`; `Config` = 8 полей (`src/index.ts:103-112`) |
| `teamRun` не соблюдает пин подзадачи | `…task-board/lib/types/core/tasks.d.ts:216-223` («a subtask's own permission pin cannot be honored in this mode») — и **отказ**, а не тихое игнорирование: `src/host-ledger.ts:919-933` (`kind: 'subtask-pin'`), сообщение `lib/index.js:1949`, спавн teammate без прав — `src/host-service.ts:316-333` |
| регрессия F-04 датируется 03.10, а не 0.4.4 | `profiles/web/cordis.patch.yml`: mtime `03.10.2026 00:20:49`, SHA256 `D54CBE2C8ABB4D68AC479C006A9D1F8570F7C2AB37CE18E57F745FA5A832A4B2`; в бэкапах 26.09 (`backups/20260926/profile-cordis.patch.yml.bak-20260926-p3-settings`, `profiles/web/cordis.patch.yml.bak-20260926-plugin-cleanup`) та же вложенная строка и те же 7 ключей; правка F-04 (27.09 12:56) записана в `evidence/foundation-12-stage0-gate.md:11-29,68` (hash после правки `D4572494…`, 98 строк, `autoRun` 0), замеры — `evidence/foundation-62-permission-gate.md:45-60,66-68` (`permissionPending` 33 → 0, API `workspace-write`); бэкап `.bak-planv03-F04` в `C:\Users\Dmitry\.dsh` отсутствует (рекурсивный поиск по имени → пусто) |

## 3. Граф карточек (скрипт `graph.mjs`)

```text
§3.24 block 1 (new records)   — valid JSON, 20 records
§3.24 block 2 (modified deps) — NOT valid JSON: Expected ',' or ']' after array element
                                in JSON at position 1950 (line 27 column 1) → нет закрывающей `]`
cards defined in BOTH blocks = 3: MW-065, MW-067, MW-070 (CONFLICT по dependsOn)
nodes = 75; duplicate ids = 0; dangling deps = 0; self-deps = 0
deps on superseded = 1 (MW-035 -> MW-027)
id gaps в 1..76 = MW-075 (объявлена «не создаётся»)
cycles (literal merge)   = 2 : MW-013 -> MW-070 -> MW-013 ; MW-013 -> MW-070 -> MW-015 -> MW-013
cycles (merge graph.ps1) = 0
declared-vs-computed depth mismatches = 8 из 20
sinks = MW-035, MW-041, MW-051, MW-052 (+ MW-066 при буквальном чтении)
deepest = MW-041=24, MW-055=23, MW-040=23, MW-076=22, MW-039=22, MW-053=22
```

Штатный скрипт плана на текущем документе (только чтение):

```text
pwsh .tmp/plan-v03-cards/verify-final.ps1
nodes = 75   new cards = 20   (55 base + 20 new)
EDGE TO SUPERSEDED: MW-035 [superseded] -> MW-027 …
problems = 1 ; cycles = 0
sinks among new cards = 0:  ; id gaps in 56..76 = 75 ; duplicates =  ; exit=0
```

Буквальное чтение инструкции §3.24 (`block 1` — «вставить 20 записей», `block 2` — «существующие записи, у которых меняется `dependsOn`»):
`MW-065` теряет `MW-059`, `MW-067` теряет `MW-058` и `MW-066`, `MW-070` сохраняет развёрнутое ребро `[MW-013, MW-015]` → два цикла и sink `MW-066`. Перезапись `block 2` (как делает `graph.ps1:16`) маскирует это.

Потребители `.mjs` (проверено): `Get-ChildItem scripts -File` → 8 файлов (`check-plan-citations.mjs`, `ledger-index.mjs`, `ledger-sync.mjs`, `pack.mjs`, `run-tests.mjs`, `smoke.mjs`, `verify-profile.mjs`, `with-build-lock.mjs`), `Test-Path scripts/check-deps.mjs` → `False` (только предложен в `30-CARD-EDITS.md` §4.7(1)); `tests/**/*.test.mjs` → 99 файлов.

## 4. Правило `done` (скрипт `execs.mjs`)

```text
distinct outcomes = succeeded, failed
cards with >=1 failed execution = 10
   MW-001 status=failed [ARCHIVED] execs=2 failed=1
   MW-002 status=backlog execs=2 failed=2
   MW-003…MW-008 status=done execs=2 failed=1 (failed→succeeded)
   MW-016 status=failed execs=1 failed=1
   MW-043 status=done execs=2 failed=1
done cards carrying a failed execution = 7: MW-003, MW-004, MW-005, MW-006, MW-007, MW-008, MW-043
записей result:"failed" = 11
.work/reports/*.md = 47; с токеном DONE = 25
.work/plan-v0.3/evidence/lead-15-legacy-board.md — существует (12 278 Б, mtime 27.09.2026 01:33:40)
```

`lead-15-legacy-board.md` уже содержит искомый «список Lead'а»: §6 (исполнения 19 done), §7 («Карточки с failed-исполнениями: 10 = done 7 + колонка `failed` 2 + backlog 1; записей 11; без архивных 9»), §18 (33 карточки без `permissionConfirmedAt`), §32 (вложенный `config:` → API отдаёт `read-only`).

Ограничение носителя: `EXECUTION_HISTORY_LIMIT = 20` и обрезка при каждой загрузке — `…task-board/src/core/tasks.ts:65,73-77`, `src/host-ledger.ts:1226`.

## 5. Формат леджера v3 → v4 (дельта не описывает)

```text
…task-board/src/protocol.ts:11-15
export const TASK_BOARD_SCHEMA_VERSION = 4
export const TASK_BOARD_LEGACY_SCHEMA_VERSION = 3
export const TASK_BOARD_OLDER_SCHEMA_VERSION = 2
```

Миграция — «v4 adds `ScheduleRule.timeZone`», штамп текущей зоны Host в каждое включённое правило, на загрузке документа; при неудаче — fail closed с сохранением файла (`…task-board/src/host-ledger.ts:1169-1219`). Живой файл: `schemaVersion = 4`. Для сравнения — `evidence/lead-15-legacy-board.md:8`: в 0.4.3 было `TASK_BOARD_SCHEMA_VERSION=3`, файл 369 634 Б, sha256 `f988bf93…`; сейчас 369 794 Б, mtime `03.10.2026 12:23:35`.
`0.4.4 src/index.ts:109,323`; `src/core/handover.ts:44,102-117` — прочитано поштучно, совпадает с дельтой.

## 6. `time-context` (G1)

```text
packages/boot/app-boot/src/profile.ts:213-218 — OPTIONAL_BUNDLES, бандл на :217
packages/bundle/web-app/cordis.patch.yml     — 0 строк time-context / schedule / ui-schedule
packages/bundle/web-app/README.md:58         — «carries no time-context, schedule, or ui-schedule row»
packages/context/time-context/README.md:12   — то же + «gives the model a clock»
packages/experimental/schedule-bundle/cordis.patch.yml — insert: time-context, schedule, ui-schedule
profiles/web/package.json:39                 — бандл перечислен в живом профиле
git cat-file -t 5badb150                     — fatal: Not a valid object name (гайда 0.2.1 в чекауте нет)
git grep ctx.timeContext|'timeContext' в packages на 639ed0153 — 0 совпадений
packages/context/time-context/src/index.ts   — inject ['agents','sessionProjections'], ctx.sessionProjections.register
```

Живое доказательство, что `time-context` смонтирован в этом GUI-профиле: собственные строки рантайм-контекста текущей сессии — «Time sampled while preparing turn 1, step 1: 2026-10-03T12:39:49+05:00[Asia/Yekaterinburg]» и «Browser time zone for this request: unavailable. Ask the user to clarify otherwise-unqualified dates and times.»

Кандидат на «платформенный источник времени» для плагина — `@deepseek-ai/dsh-util-time` (`packages/util/time/package.json`), не `time-context` (вывод, не замер).

## 7. Прочее

- RU-мост локализации доски всё ещё переводит несуществующие в 0.4.4 ключи: `dsh-locale-ru-plugins/bridges/task-board.ru.json:201-208` (`settings.autoRun*`, включая `autoRunTodoHint` с описанием гейта прав), при 0 совпадениях `autoRun` в самом пакете 0.4.4.
- `.dsh/logs` mtime `28.09.2026 00:35:43` — перезапись профиля 02–03.10 логами не покрыта.
