# lead-15 — Что лежит в живом леджере доски DSH (evidence)

Снято 2026-09-27; леджер mtime 2026-09-26T17:01:16.551Z. Все скрипты — `.tmp/plan-v03-lead/`, выводы рядом (`an-ledger2.out.txt`, `an-final.out.txt`, `an-idem.out.txt`, `an-files.out.txt`).

## Факты

1. **Путь и формат**: `C:\Users\Dmitry\.dsh\task-board\ledger-v2.json` — один JSON-документ (НЕ SQLite), 369634 B, sha256 `f988bf933d721d3674b90c5af52656c147aad4f12bf47d19bba7b0d50289e116`. Рядом `ledger-v2.lock` (102 B: pid 17984, probe `exact`) и `scheduler-v2.json` (28 B: `{"lastTickAt":1790442076557}`). `Get-ChildItem .dsh\task-board` → exit 0.
2. **Кто пишет**: `@linxin666/dsh-client-ui-task-board@0.4.3` (`package.json:version`); путь — `join(dir,'ledger-v2.json')` (`src/host-ledger.ts:417`), `dir` = `$DSH_HOME` иначе `~/.dsh` (`src/dsh-home.ts:36`) → **один общий леджер на все профили и воркспейсы**. `TASK_BOARD_SCHEMA_VERSION=3`, legacy=2 (`src/protocol.ts:10,12`).
3. **Объём**: 55 карточек, `revision` 324, top-level ключи `[schemaVersion, revision, tasks, scheduler, recentRequests]`. Статусы: backlog 34 (в т.ч. 2 архивных), done 19, failed 2; `archivedAt` у 3. Карточек со статусом `todo` или `running` — 0. Команда: `node .tmp/plan-v03-lead/an-ledger2.cjs` → exit 0.
4. **Сверка самой доской** (`task_board_list`, `ok:true`): revision 324; counts backlog 32 / todo 0 / running 0 / done 19 / failed 1 / archived 3, `total` 52 (API по умолчанию скрывает архивные); `armedSchedules` 0; `maxSubtaskDepth` 1; `sessionDefaultPermission` **read-only**; `runningSessions` 14.
5. `scheduler` в файле: timeZone `Asia/Yekaterinburg`, ledgerId `21d3414b-b542-4dd7-9c5a-51a6dcebb156`, lastTickAt 1790438335070 (2026-09-26T15:58:55Z); полей `error` и `importedSources` нет.
6. **done (19), исполнения**: есть у всех, всего 26 = 19 succeeded + 7 failed. 12 карточек — ровно одно `succeeded`, без error. 7 карточек (MW-003…MW-008, MW-043) — по 2: сначала failed, затем succeeded. Дословно: MW-003…MW-008 `workspace not found: 3fc33afb-e9c6-4bf2-b561-4388c8ad0e09` (1789667487381…1789673790798), MW-043 `launch: workspace not found: 3fc33afb-e9c6-4bf2-b561-4388c8ad0e09` (1789758006654). Все 7 провалов — инфраструктурные (мёртвый workspaceId), не по содержанию карточки; успех — уже на `47b14762`.
7. **Карточки с failed-исполнениями: 10** = done 7 + колонка `failed` 2 (MW-001, MW-016) + backlog 1 (MW-002). **Записей** `result:"failed"`: 11 = done 7 + failed-column 2 + backlog 2 (обе на MW-002). Без архивных карточек: 7 + 1 + 1 = 9.
8. Прочие дословные ошибки: MW-001 и MW-016 — `agent turn ended with an error` (со `sessionId`); MW-002 (обе) — `agent-presets: preset "standard" failed to mount: 24 rows name plugins that cannot be resolved:\n- row "persona": @deepseek-ai/dsh-persona …` (24 строки).
9. **Осиротевший `3fc33afb…`: 3 карточки из 55** — MW-001 (failed, archived 2026-09-17T17:22:20Z, 2 исполнения), MW-027 и MW-035 (backlog, archived 2026-09-18T17:45:02Z, 0 исполнений).
10. `C:\Users\Dmitry\.dsh\storages\workspace.json` (8 workspace'ов, `unit.version` 2) **не содержит `3fc33afb`** ни в `global.workspaceIds`, ни в `tables.workspaces`; `H:\Repo\DSH-MyWork` → `47b14762-c848-44e6-a7cc-62f19949566d`, createdAt 2026-09-17T15:06:36.503Z.
11. Скан `.dsh` (1155 + 647 файлов; исключены node_modules/.pnpm/sessions/archive/attachments): id `3fc33afb` встречается **ровно 1 раз — в самом леджере**; в `.dsh/logs/*.log` — 0 совпадений (grep → no matches).
12. Старые контракты проекта выпущены на `3fc33afb`: `.work/tasks/board-export.json` (revision 82, verifiedAt 2026-09-16T17:22:16Z, 41 карточка, все backlog, 0 исполнений), `.work/tasks/board-actions.json` (createdAt 2026-09-16T17:21:32Z, 41 карточка, `workspaceId` 3fc33afb, в каждой `create`+`move` с requestId) и план `.work/tasks/tasks.json` (55 задач, 53 planned + 2 superseded, `workspaceId: 3fc33afb…`, `executionStarted:false`). Т.е. 3fc33afb существовал 2026-09-16T17:22Z и был заменён на 47b14762 к 2026-09-17T15:06Z.
13. **Идемпотентность есть**: top-level `recentRequests: [{requestId, fingerprint}]`, 255 записей при cap `MAX_REQUEST_CACHE = 256` (`src/host-ledger.ts:1082`); fingerprint = sha256 действия, повтор requestId с другим действием отвергается (`src/host-ledger.ts:574-583`). Ни времени, ни taskId внутри записи нет; на карточках полей `requestId`/`fingerprint` нет.
14. Из 82 requestId в `board-actions.json` живой кэш держит **66**; **16 вытеснены** — MW-001…MW-008, по 2 (create+move) на карточку.
15. **Расписания**: поле `schedule` у карточек поддерживается (`src/host-ledger.ts:493,531,544`), но у **0 из 55** карточек оно есть; `armedSchedules` = 0 и в файле, и в API.
16. **`autoRun*` не читаются 0.4.3**: 0 совпадений во всём пакете (grep по `src/**` и `lib/**`, `No matches found`). `Config` объявляет только `announceToAgent, enabled, preventIdleSleep, trustedProxyHosts, proxyTokenEnv, sessionDefaultPermission, maxSubtaskDepth, teamProvider` (`src/index.ts:103-112`). Ключи существуют как мёртвая конфигурация: `profiles\web\cordis.patch.yml:27-33` (`autoRunTodo: true`, `autoRunPaused`, `autoRunMaxConcurrent`, `autoRunMaxRetries`, `autoRunStallMinutes`, `autoRunMaxPerHour`, `autoRunMaxPerDay`), `C:\Users\Dmitry\.dsh\settings.yaml.imported` (секция `task-board:`) и локализация `dsh-locale-ru-plugins\bridges\task-board.ru.json:190-208`.
17. Единственный импортёр легаси-секции явно провалился: `logs\startup-2026-09-26T05-46-53.033Z-8ecebc13-…log:3371-3376` — `web-ui-settings: legacy section 'task-board' was not imported into entry 'ui-task-board': No configurable plugin entry "ui-task-board"`. Иных потребителей нет: остальные `autoRun` в дереве — маршрут `autoRun(kind)` плагина session-archive и `autorun` в @xterm.
18. **Гейт прав**: 33 из 55 карточек закреплены на `workspace-write` без `permissionConfirmedAt` (все backlog: MW-021…MW-041, MW-044…MW-055); у 22 подтверждение есть. Все 55 — `permission: workspace-write`, `model: opencode-go/deepseek-v4.1-flash`, тег `DSH-MyWork`.
19. Связь исполнение→сессия необязательна: 22 из 31 записей имеют `sessionId`, 9 — нет; текст ошибки есть у всех 11 failed (0 без error). Незавершённых исполнений (`endedAt` не задан) — 0.
20. `runningSessions: 14` в API — это `runner.listRunning()` (`src/host-service.ts:328`), т.е. сессии DSH по всему деплою, а не работа доски.

## Опровержения / неожиданное

- «7 на done + 2 на backlog» — **неверно**: 7 на done ✔, но на backlog 1 карточка (2 записи), а 2 карточки целиком лежат в колонке `failed` (MW-001, MW-016).
- Числа в карточке MW-054 («6 done в 47b14762, 35 незавершённых в 3fc33afb») живому леджеру не соответствуют: 47b14762 — 52 карточки (19 done / 32 backlog / 1 failed), 3fc33afb — 3.
- `sessionDefaultPermission` = `read-only` (= `DEFAULT_SESSION_PERMISSION`, `src/core/handover.ts:44`), хотя в профиле задано `workspace-write`: вложенный `config:`-объект до `Config` плагина не доходит, а плоские соседи (`announceToAgent`) доходят — доска анонсируется агентам.
- `autoRunTodo: true` в профиле не имеет читателя → «двух исполнителей» из-за него не возникает; легаси-секция вообще не импортировалась (лог выше).
- Повторный прогон `board-actions.json` идемпотентен лишь частично: 16 из 82 ключей уже вытеснены.
- В леджере нет статуса `todo`, хотя колонка «К выполнению» в UI существует (`src/client/board/status-key.ts:6`): todo/running просто не встречаются в данных.

## Не проверено

- Причина исчезновения `3fc33afb` (удаление вручную / перерегистрация при обновлении стора): прямых следов нет, только даты (export 2026-09-16T17:22Z → новый workspace 2026-09-17T15:06Z).
- Нет ли второго леджера/БД доски или второго `ledgerId` вне `C:\Users\Dmitry\.dsh` (проверялся только этот корень).
- Кто и чем архивировал MW-001/MW-027/MW-035 — автора архивного действия леджер не хранит.
- Читались ли бы `autoRun*` другой (более новой) версией доски: в дереве других версий пакета нет (`.pnpm` без task-board).

## Что это значит для правила приёмки (D19) и cutover (D06)

1. D19 не может опираться на `recentRequests`: он не привязан к карточке, без времени и обрезан до 256 — «идемпотентный replay по requestId» проверять заново (16 из 82 ключей уже потеряны).
2. D19 не может считать `executions[].result` доказательством содержательной приёмки: 7 из 19 done — это failed→succeeded, где провал = «workspace not found»; нужно требовать свежий succeeded и хранить причину прошлого failed (9 из 31 записей вообще без `sessionId`).
3. Гейт прав читать как `permission` выше session default И `permissionConfirmedAt == undefined`; при фактическом default `read-only` это 33 карточки (не 0), а конфиг профиля со `workspace-write` недействителен — на него не ссылаться.
4. D06: карточки с несуществующим `workspaceId` не запускаются (`src/host-runner.ts:287`) — мастер обязан сверять id по `storages\workspace.json`, а не только по леджеру; на мёртвый 3fc33afb до сих пор указывают 3 карточки и план `.work/tasks/tasks.json`.
5. D06: исключать/архивировать по `archivedAt` (3 карточки), а не по `status`: API уже отдаёт 52 из 55, и «done-карточки не импортируются» надо проверять вместе с архивом.
6. D06: расписаний нет (0 `schedule`), `autoRunTodo` — мёртвый ключ без читателя, поэтому риск «двух исполнителей» снимается; требование не переносить строку `web-ui-task-board` вслепую остаётся — её конфиг уже вводит в заблуждение.
