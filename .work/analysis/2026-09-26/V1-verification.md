# V1 · Независимая верификация (режим falsify): поток A (Board) и Lead-заметки

**Роль:** независимый верификатор-фальсификатор. Читал исходники сам, чужим доказательствам не верил; всё, что можно было воспроизвести командой, воспроизводил.
**Режим:** только чтение. Мутаций нет: не создавал worktree, не писал probe-скриптов, леджер читал inline-экстракторами `pwsh` (`ConvertFrom-Json`), единственный исполняемый «эксперимент» — `node --input-type=module -e` против **собранных** пакетов (`packages/*/lib`), которые и так использует штатный `tests/lib/fixtures.mjs`, плюс штатный прогон `node --test tests/board.test.mjs`. Ничего не коммитил, ни один чужой файл не менял.
**Ревизии на момент проверки:** MyWork `0c657ae1…`, `git status --porcelain` **пуст** (в брифинге §1 записан ` M pnpm-lock.yaml` — дрейф к моменту проверки исчез, exit 0); DSH `c7c4c725…`, `package.json` = `0.1.7-rc.2`.
**Итог:** проверено **47** утверждений (35 из A, 12 из L): **31 подтверждено** (часть — с поправками в числах/ссылках), **12 опровергнуто** (из них 3 — числа/факты, 9 — «доказательство указывает не туда» или «вывод не следует»), **4 неопределённо** (причина указана в §5). Ни один опровергнутый пункт не разрушает главные выводы потоков: модель зон, недостижимость cross-lane drop, мёртвые `autoRun*` и расхождение леджеров — подтверждены.

---

## 1. Ключевые проверки: команда/чтение → результат

| # | Что проверял | Как | Результат |
|---|---|---|---|
| 1 | `BoardZone` — 9 зон | `read packages/contracts/src/board.ts:26-63` | 9 литералов `:26-44`, `BOARD_ZONES` `:53-63` (frozen) |
| 2 | Строки 3×3 | `:47`, `:66-76` | `BoardZoneRow = intake\|active\|terminal`; `BOARD_ZONE_ROWS` `:66-76` |
| 3 | Layout в домене | `:126`, `:129`, `:132`; `tests/board.test.mjs:637-640` | `'grid-3x3'\|'strip-horizontal'` :126, `BOARD_VIEW_MODES` :129, `BOARD_STRIP_MAX_WIDTH_PX = 1100` :132; тест `:638-639` |
| 4 | `applyDropIntent` — инвариант зоны | `read packages/core/src/board.ts:458-566` | `:472` fromZone==placement.zone, `:482` CAS revision, `:499/:507` ideas-зона, `:521-539` «toZone ∈ {expectedZone, placement.zone}», `:552-557` spread, `:561` условный `fromZone` |
| 5 | Контрпример к «чистому reorder» | `node --input-type=module -e "…applyDropIntent…"` → exit 0 | `ok=true zone_before=backlog zone_after=ready fromZone=backlog columnRevision=2`; `assertSinglePlacement(out)=true`, `assertSinglePlacement(input)=false CONTRACT_MISMATCH` |
| 6 | `legalDropTargets('ready')` против write-пути | тот же inline-node, цикл по 3 целям → exit 0 | `ready → ACCEPTED`; `blocked → TASK_CONFLICT ["ready","blocked","cancelled"]`; `cancelled → TASK_CONFLICT […]` |
| 7 | Тесты доски | `node --test tests/board.test.mjs` → exit 0 | `tests 24 / pass 24 / fail 0`, 138 ms |
| 8 | Сущность `Idea` | `Get-ChildItem -Recurse -Filter *idea*`; `Select-String -CaseSensitive 'IdeaBank\|ideaId\|\bIdea\b'` | файл один — `.work/reports/MW-043-idea-bank.md`; 4 совпадения `Idea`, все в комментариях; `idea.bank` в `authority.ts` — 0 |
| 9 | MW-043 и MW-011 | `read .work/reports/MW-043-idea-bank.md:3,106`; `git log -- plan.ts`; `git merge-base --is-ancestor` | статус BLOCKED `:3`, «файлов нет» `:106`; MW-011 — коммит `d0b0cbc` (2026-09-19 18:37), **не** предок базы отчёта `fbee7a0b` (exit 1), но предок HEAD; mtime отчёта MW-043 = 2026-09-19 00:38 |
| 10 | Легаси 0.4.3 | `read …ui-task-board/{package.json,src/…}` | версия 0.4.3; `native-panel.tsx:99-124` — слоты `sidebar.panellist`/`main`, `order=20` (`:32`), `TASK_BOARD_PANEL_ID='task-board'` (`controller.ts:66`) |
| 11 | Маркеры захвата DOM | `Select-String -SimpleMatch` по `src`+`lib` | `data-dsh-taskboard-active` = 0, `centerCol` = 0; `data-dsh-panel-entry` = 6, `data-dsh-taskboard-view` = 9, `data-dsh-plugin` = 5 (у A — 5/6/4) |
| 12 | `autoRun*` | `Select-String 'autoRun'` по всему пакету (src+lib+types) | **0** совпадений; `Config` (`src/index.ts:51-88`, схема `:103-112`) — ровно 8 полей |
| 13 | Леджер | inline `ConvertFrom-Json` | `schemaVersion=3 revision=324`, `tasks=55`, без `archivedAt` = 52; `backlog 34 / done 19 / failed 2`; `47b14762…=52`, `3fc33afb…=3` (все 3 архивированы); executions 31 на 22 карточках, `result`: `succeeded 20 / failed 11`, без `endedAt` — 0; `permission=workspace-write` у 55, `permissionConfirmedAt` нет у 33; union полей карточки — 14 имён, `schedule/parentId/teamRun/mode` отсутствуют |
| 14 | Реестр воркспейсов | `C:\Users\Dmitry\.dsh\storages\workspace.json` | `47b14762 → H:\Repo\DSH-MyWork`; `3fc33afb` нет ни в `tables.workspaces`, ни в `global.workspaceIds` (8 id) |
| 15 | Плагин-агрегат | `read @linxin666/dsh-web-all/{package.json,cordis.patch.yml}` | 0.4.3; `peerDependencies {"@deepseek-ai/dsh":">=0.1.7-rc.2"}`; 19 уникальных строк `web-ui-*`, среди них `web-ui-task-board` (`name: @linxin666/dsh-web-all/task-board`, `config.plugin: @linxin666/dsh-client-ui-task-board`) |
| 16 | Профиль | `profiles/web/cordis.patch.yml:20-35` | `announceToAgent: true` `:26`, `autoRunTodo: true` `:27`, `autoRunPaused: true` `:28`, `sessionDefaultPermission` — внутри **вложенного** `config` `:25` |
| 17 | Как агрегат отдаёт конфиг | `read web-all/lib/shell-DWqLngib.js:1088-1092` | `const { plugin: _spec, ...family } = row` — «The config the real plugin receives: every row key but the shell's own» |
| 18 | Дефолт прав | `Select-String 'sessionDefaultPermission' …ui-task-board/src` | `index.ts:323 config?.sessionDefaultPermission ?? DEFAULT_SESSION_PERMISSION`; `core/handover.ts:44 DEFAULT_SESSION_PERMISSION = 'read-only'` |
| 19 | Дельта DSH | `git rev-list --count dsh-v0.1.5-rc.2..dsh-v0.1.7-rc.2` → exit 0 | `3650`; теги `fb2c4b9e69/2026-09-10`, `c36a83ff6b/09-22`, `46a7f68b09/09-23`, `477b4f4205/09-24`; `477b4f4..HEAD` = 1 |
| 20 | Разбивка по типам | `git log --no-merges --format='%s' …` | `fix 1010 / test 462 / feat 329 / docs 265 / refactor 202 / perf 29 / revert 7` — точное совпадение с L; **только** при `--no-merges` (в диапазоне 1215 merge-коммитов из 3650) |
| 21 | «Новые» пути | `git ls-tree` по тегам + `--diff-filter=A --follow` | presence-таблица L верна; но `packages/deliverables/tool-present` — **переезд** (`--diff-filter=R`: `f800ea46e5` «refactor(deliverables): group tool-present and workspace-changes»), раньше `packages/fs/tool-present` |
| 22 | Первые добавления | `git log --diff-filter=A -- <path>` | ssh: `4fb0fdac68` 2026-09-12 (не `33d89aee77`/~09-14); token-meter: `f038780ff6` 2026-07-15 (не `b565df3442`/08-25); auto-review: самый ранний add `55e53907ab` 2026-09-09, не предок 0.1.5-rc.2, но предок 0.1.7-rc.2; product-telemetry: `910d52f717` 2026-09-21; plugin-manager: `98b92b683c` 2026-09-14 |
| 23 | docs/subsystems | `git ls-tree -r` по тегам | без `*.zh.md`: **54 → 63**, добавлено 10 (boot, browser-use, computer-use, deliverables, mcp, office-to-pdf, product-telemetry, ptc-runtime, ssh, voice-input), **удалён** `code-runtime.md` |
| 24 | K1 (транспорт) | `.work/tasks/MW-029.md:18,21`, `MW-046.md:18`, `MW-047.md:18,21`; документ `:614-622`, `:628`, `:646` | карточки: `ctx.webServer.register`, `/v1/tasks/{id}/discussion`, `/v1/attempts/{id}/steer`, SSE-инвалидация; документ: `TypertRemoteService`, `@RemoteScope`, `@Remote({mode:'stream'})`, `watch(...): AsyncIterable<BoardChangeFrame>`, «Это позволяет **не создавать собственный loopback HTTP service**» |
| 25 | K2 (модель зон) | `.work/…-v0.2-decisions.md:145-151`; `MW-049.md:21`; документ `:182`, `:203-211`, `:221`, `:230` | ADR018: `blocked ← {blocked, needs-attention}`; MW-049: «ровно девять панелей 3x3» + порог 1100; документ §5.2: «presentation-specific knowledge, попавшее в domain/public contract»; §6.1: `BoardLane = ideas\|queue\|work\|review\|error\|done\|closed` (7), `blocked → queue + BLOCKED badge`, `needs-attention → error/attention` |
| 26 | INDEX.md | `Select-String 'planned' .work/tasks/INDEX.md` | **53** строки `planned` + `MW-027`/`MW-035` = `superseded` (`:69`, `:97`) — не «все 55 planned» |
| 27 | Композиция профиля | `profiles/web/package.json`; `Get-ChildItem packages -Directory`; `packages/controller/src` | 12 пакетов MyWork; `controller/src` = `dsh-session.ts, index.ts, model-catalog.ts`; профиль: 14 бандлов, `@linxin666/dsh-web-all` присутствует, отдельного бандла task-board в списке нет |

---

## 2. Разбор ключевых утверждений A

### 2.1 Контракт зон и layout — ПОДТВЕРЖДЕНО дословно
`packages/contracts/src/board.ts:26-44` (union), `:53-63` (`BOARD_ZONES`), `:66-76` (`BOARD_ZONE_ROWS`), `:126/:129/:132` — все четыре ссылки A-01/A-02 совпадают строка-в-строку; тест `tests/board.test.mjs:637-640` действительно проверяет оба режима и порог 1100. Дополнительно: `ZONE_BY_STATE` (`:102-119`) — ровно 16 записей, `needs-attention → blocked` (`:118`), `BOARD_PANEL_STATES` (`:158-166`) — 7 состояний, `DegradedProjection.reason` содержит `'reconciliation-pending'` (`:307`), `BoardPlacement.columnRevision/:222`, `boardRevision/:224`, `subState/:210`, `BoardView.workspaceId/:179`, ключ ревизии `(viewId, zone)` в комментарии `:176` и «Keyed `(viewId, taskId)`» `:193`. Всё это подтверждает A-07, A-21, A-22, A-23, A-24, A-52, A-54, A-58.

### 2.2 `applyDropIntent`: «чистый reorder» — подтверждено **условно**, поле `fromZone` — **опровергнуто**
Функция (`packages/core/src/board.ts:458-566`) отвергает вызов, если `intent.fromZone !== placement.zone` (`:472`), и пропускает успех только при `toZone === projectTaskZone(exactState) || toZone === placement.zone` (`:522`). **Если** инвариант `placement.zone === projectTaskZone(exactState)` выполнен (его требует `assertSinglePlacement`, `:124-133`, и он записан в комментарии контракта `board.ts:202`), то в успешном вызове `fromZone === toZone === placement.zone` — A-12 в такой редакции верен.

Но **сама функция этот инвариант не проверяет**. Исполненный контрпример (§4, К-1) даёт успешный вызов, в котором зона меняется `backlog → ready` и возвращается `fromZone: 'backlog'`. Значит:
- строка `:561` (`...(intent.fromZone === intent.toZone ? {} : { fromZone: intent.fromZone })`) **достижима по ветке else**, и A-13 («поле `PlacementChange.fromZone` недостижимо») как безусловное утверждение **опровергнут**;
- комментарий самой функции `:516-519` («A drop must land in the zone the card's own state renders in, or stay where it is (a reorder)») описывает не то, что код гарантирует: он гарантирует только `toZone ∈ {expectedZone, placement.zone}` для **пришедшего** placement, а не согласованность пришедшего placement с его `exactState`.
- Практическая цена сейчас нулевая: продуктовых вызовов у `applyDropIntent` нет (A-17 подтверждён: только `core/src/index.ts:301,306` и тесты), поэтому это латентная дыра API, а не живой баг. Но при появлении писателя (§3.3 у A: «резолвер `resolveDropIntent`») её надо закрыть проверкой `placement.zone === expectedZone` — иначе «reorder» может тихо стать rezone в обход `transitionTask`.

### 2.3 `legalDropTargets` противоречит write-пути — ПОДТВЕРЖДЕНО, и это не только тест
A-15/A-16 подтверждены не только ссылками (`tests/board.test.mjs:179` → `['ready','blocked','cancelled']`; `core/src/board.ts:533` → `legalTargets` в `details`; `tests/board.test.mjs:497` → `deepEqual(..., [...legalDropTargets('ready')])`), но и исполнением (§4, К-2): для `ready`-карточки `blocked` и `cancelled` **рекламируются** и **отвергаются** одной и той же функцией, причём отказ перечисляет их же как «legalTargets». Это внутреннее противоречие публичного API, закреплённое тестом, — вывод A верен.

### 2.4 `Idea`, MW-043 и MW-011 — ПОДТВЕРЖДЕНО, с одной поправкой к причине
- Файлов `idea.ts` нет ни в одном пакете; единственный файл с `idea` в имени — `.work/reports/MW-043-idea-bank.md`; case-sensitive `IdeaBank|ideaId|\bIdea\b` даёт **4** совпадения (A пишет «5»), все — комментарии (`contracts/src/board.ts:27,100`, `core/src/board.ts:56`, `tests/board.test.mjs:80`). Существо A-03/A-04 верно, число — нет.
- `idea.bank` в `packages/contracts/src/authority.ts` — 0 совпадений (A-05 верен); ADR019 обещает эту строку (`decisions.md:177`), ADR018 относит `needs-attention` к `blocked` (`:148`).
- MW-043: `:3` «Статус: BLOCKED», `:106` «Файлы `idea.ts` / `idea.test.mjs` … нет ни одного». Причина в отчёте («MW-011 не реализован, ни в исходниках, ни в истории git») **была верна на момент написания** (mtime 2026-09-19 00:38, база `fbee7a0b` 2026-09-18), но **устарела**: MW-011 реализован коммитом `d0b0cbc` 2026-09-19 18:37 (`packages/contracts/src/plan.ts`, `packages/core/src/plan.ts`, `packages/planner/src/service.ts`; `Planner`, `BlockerGateRequest`, `createPlanner`), это предок HEAD и потомок `fbee7a0b`. MW-026 по-прежнему не реализован: `TaskSetter` — 0 совпадений в `packages/**`; в `planner/src/service.ts` есть только `Planner`/`createPlanner`. То есть формулировка Lead «блокер MW-043 частично устарел: MW-011 закрыт, MW-026 — нет» — точна; A-06 (BLOCKED + ни одного файла) — верен, но его отчёт не отмечает, что причина блокировки уже недействительна.

### 2.5 Легаси-доска 0.4.3 — ПОДТВЕРЖДЕНО по существу, три ссылки/числа неточны
- Нативные слоты: `src/client/native-panel.tsx:99-124`, `slots.inject('sidebar.panellist', …)` `:106-113` (`id`, `order: PANEL_ORDER = 20`, `label`), `slots.inject('main', …)` `:115-119` (`key = TASK_BOARD_PANEL_ID`); `PANEL_ORDER = 20` с комментарием «Plugins is 0, Schedule 10» — `:31-32`; `TASK_BOARD_PANEL_ID = 'task-board'` — `src/core/controller.ts:66`. A-61/A-62 верны дословно.
- Маркеров DOM-захвата нет: `data-dsh-taskboard-active` = 0, `centerCol` = 0 — **по существу A-63 подтверждён**, но приведённые числа (5/6/4) не воспроизвелись: у меня `data-dsh-panel-entry` = 6, `data-dsh-taskboard-view` = 9, `data-dsh-plugin` = 5 (`src`+`lib`, `-SimpleMatch`). Устаревший комментарий «the DOM-injected entry row» в самом пакете (`src/client/locales.ts:4`) подтверждён — A-152 (§54) прав, источник ошибки «DOM-takeover» воспроизводим.
- Heartbeat: `src/client/telemetry.ts:27` `ENDPOINT = 'https://dsh-market.com/api/telemetry/event'`, раз в UTC-сутки + анонимный UUID (`:5-8`, `:25-26`), `if (navigator.webdriver) return` `:81`, дедуп по дню `:82`; полей телеметрии в `Config` нет, выключателя нет. A-64 верен.
- `autoRun*`: подстрока `autoRun` — **0** совпадений во всём пакете (не только в `src/**` и `lib/index.js`), и **0** в агрегате `dsh-web-all`; `Config` — 8 полей (`src/index.ts:51-88`, схема `:103-112`). A-65, A-66 верны; A-37 верен по существу, но ссылка «`cordis.patch.yml:26-27`» неточна: `announceToAgent` — `:26`, `autoRunTodo` — `:27`, `autoRunPaused` — `:28`.
- Восемь agent-инструментов: `src/host/agent-tools.ts:253,285,335,382,428,476,498,575` — `set_parent/run/manage/schedule/list/get/create/update`, все восемь строк совпали с A-68 буквально.
- `src/invariant.ts` — 4 строки, `export function apply(): void {}` (A-69 верен). `src/**` — 55 файлов, из них 42 `.ts` + 11 `.tsx` = 53 (A-70 верен).
- A-42/§54: host-модулей **шесть** (`host-ai.ts 6.5 КБ`, `host-ledger.ts 57 КБ`, `host-routes.ts 13.2 КБ`, `host-runner.ts 26 КБ`, `host-service.ts 20.6 КБ`, `host-api.ts 10.6 КБ`; сумма ≈ 134 КБ), а не «5 host-модулей ~136 КБ» — числа близки, счёт неверен.
- Прямой конфликт с буквой §54 подтверждён: строка `web-ui-task-board` живёт **внутри** агрегата `@linxin666/dsh-web-all` (19 уникальных строк `web-ui-*`), поэтому «удалить чужой бандл» в этой среде невозможно — только строчный override. У A это сказано как «строка профиля ровно одна», у Lead (3.1/3.2) — точнее.

### 2.6 Леджер и MW-054/MW-055 — ПОДТВЕРЖДЕНО, выводы A об опровержении верны
Все числа A-29…A-39, A-35, A-36 воспроизвелись точно: 55 карточек (52 без `archivedAt`), `backlog 34 / done 19 / failed 2`, `47b14762 = 52` (все 19 `done` там), `3fc33afb = 3` (2 backlog + 1 failed, **все три архивированы** и id отсутствует в реестре), 0 открытых исполнений из 31 (`result`: 20 succeeded / 11 failed на 22 карточках), `permission = workspace-write` у всех 55, `permissionConfirmedAt` нет у 33, поля `schedule/parentId/teamRun/mode` отсутствуют у всех, `scheduler-v2.json = {"lastTickAt":1790442076557}`, `recentRequests` — 255 записей `{requestId, fingerprint}`. Единственная придирка: A-40 ссылается на `recentRequests[255]`, а последний индекс — **254** (элементов 255); поле `result` в A-38 не названо, но значения верны.

Отсюда опровержения A-32/A-33/A-34 корректны: в `MW-054.md:18` действительно написано «6 done-карточек … в отдельном воркспейсе 47b14762, 35 незавершённых — в 3fc33afb» и «эти два критерия совпадают», в `MW-055.md:21` — «копии реального ledger из 41 карточки»; ни одна реальная проекция 41 не даёт (55 / 52 / 52 в воркспейсе MyWork / 33 не-`done` без архива / 3 в `3fc33afb`). Оговорка: числа могли быть верны на момент написания карточек и «устареть» вместе с леджером (revision 324, mtime 2026-09-26 22:01) — исторических версий леджера нет, поэтому «устарели» и «были неверны всегда» неразличимо; на текущей ревизии они ложны.

### 2.7 Отдельная находка: A-72 больше не «неопределён» — причина расхождения найдена
A пишет: «`sessionDefaultPermission` расходится между профилем (`workspace-write`) и сводкой доски (`read-only`); причина не выяснена» (статус `unverified`). Причина найдена и проверена по коду:
1. Профиль задаёт право **вложенно**: `cordis.patch.yml:25` — `config: { sessionDefaultPermission: workspace-write }` внутри объекта, который сам является `config` строки.
2. Агрегат `@linxin666/dsh-web-all` монтирует реальный плагин через оболочку, которая отдаёт ему **все ключи строки, кроме `plugin`** (`lib/shell-DWqLngib.js:1088-1092`). То есть реальный плагин получает `{ config: {...}, announceToAgent: true, autoRun*: … }`.
3. Плагин читает право с верхнего уровня: `src/index.ts:323` `config?.sessionDefaultPermission ?? DEFAULT_SESSION_PERMISSION`, где `DEFAULT_SESSION_PERMISSION = 'read-only'` (`src/core/handover.ts:44`).
Итог: значение из профиля **не доходит** до плагина, действует дефолт `read-only`, и именно поэтому 12 карточек MW-044…MW-055 (`backlog`, `permission: workspace-write`, `permissionConfirmedAt` отсутствует) не проходят гейт (L-2.4 подтверждён). Побочно: `announceToAgent: true` (`:26`) — живой ключ (`src/index.ts:315`), в отличие от `autoRun*`, то есть объявление доски агентам действительно работает.

---

## 3. Разбор Lead-заметок

### 3.1 Часть 1 (дельта платформы) — числа дельты верны, атрибуции первых добавлений — нет
- `git rev-list --count dsh-v0.1.5-rc.2..dsh-v0.1.7-rc.2` = **3650** (exit 0) — совпадает. Даты и коммиты всех четырёх тегов — совпадают. `477b4f4..HEAD` = 1 — совпадает.
- Разбивка по типам совпала **точно** (1010/462/329/265/202/29/7), но только при `--no-merges`; в заметках метод не указан, а без него получается 1020/331/205 (merge-коммитов в диапазоне 1215). Формально «доказательство не воспроизводится буквально», фактически цифры верны.
- «Затронутые области по числу изменённых файлов» (`packages/client` 12 524, `packages/api` 1 537, `packages/session` 866) **не воспроизвелись**: `git log --name-only --format='' <range> -- <path>` даёт 12 112 / 1 424 / 731. Метод не указан; соотношение областей сохраняется, абсолютные числа — нет.
- Presence-таблица `git ls-tree` по тегам верна для всех 19 проверенных путей (в т. ч. «уже существовали»: `typert`, `api/gateway`, `token-meter`, `invariants`, `session-reference`, `spill`, `session-query`, `workflow`, `plan-mode`, `schedule`, `user-questions`, `mcp`).
- **«Новая подсистема `packages/deliverables/tool-present`» — опровергнуто**: `--diff-filter=R --follow` показывает переезд `packages/fs/tool-present → packages/deliverables/tool-present` в `f800ea46e5` (refactor). Новым является только группировка `deliverables` (+ `workspace-changes`, которого на теге 0.1.5-rc.2 действительно нет) и документ `docs/subsystems/deliverables.md`.
- **Атрибуции «первого добавления» неточны**: ssh — `4fb0fdac68` (2026-09-12), а не `33d89aee77`/~09-14 (тот коммит лишь правит файлы `packages/ssh/**` и `docs/subsystems/workspace.md`); token-meter — `f038780ff6` (2026-07-15), а не `b565df3442`/08-25; auto-review — самый ранний add `55e53907ab` (2026-09-09, не предок 0.1.5-rc.2, но предок 0.1.7-rc.2), тогда как приведённый `a3480857dd` — последний из трёх add-коммитов пути. Для `product-telemetry-otel` (`910d52f717`, 09-21) и `boot/plugin-manager` (`98b92b683c`, 09-14) формулировка «в окне» верна.
- `docs/subsystems`: **54 → 63** воспроизводится точно, но только если исключить `*.zh.md` (всего `.md` 108 → 126); «+10 новых» верно, однако не упомянуто **удаление** `code-runtime.md`.
- 1.3 п.2: `cc478ac70a` датирован в заметках 2026-09-18, фактически **2026-09-21** (дата неверна, содержание верно).
- 1.3 п.1: коммиты peer-compat существуют (`2c67633990`, `51d70c5f5c`, 09-23). Но «все `@dsh-mywork/*` имеют только `main`, без `engines`/`peerDependencies`» — **частично опровергнуто**: `packages/controller/package.json` объявляет `peerDependencies: {"@deepseek-ai/cordis": "^4.0.2"}`; `engines` есть только в корневом `package.json` (`node >= 22.18.0`), у пакетов его нет. Существенная часть (нет DSH-совместимости, gate не пройден) остаётся верной.

### 3.2 Часть 3 (композиция профиля) — основное верно
- `@linxin666/dsh-web-all` 0.4.3, `peerDependencies {"@deepseek-ai/dsh": ">=0.1.7-rc.2"}` — подтверждено; у `@linxin666/dsh-client-ui-task-board` 0.4.3 — тот же peer плюс `react ^18.2.0`.
- «Агрегат из ~19 строк» — подтверждено: 19 уникальных `id: web-ui-*` в `web-all/cordis.patch.yml`, включая `web-ui-task-board` (`name: '@linxin666/dsh-web-all/task-board'`, `config.plugin: '@linxin666/dsh-client-ui-task-board'`). Ключевой для §53–§54 вывод Lead (замена возможна только строчным override) подтверждён конструктивно.
- HTTP-прецедент: `src/index.ts:35` `inject = ['systemPrompt','typertGateway','workspaceRegistry','webServer','agents','commands']`, `:388` `ctx.webServer.register(route)`, `src/protocol.ts:13` `TASK_BOARD_API_PREFIX = '/api/task-board'` — все три ссылки точны. Файлы `src/core/{subtask,session-reuse,schedule,handover,freeze-snapshot}.ts` существуют — таблица 3.2 верна.
- «Отдельный бандл `@linxin666/dsh-client-ui-task-board` `enabled: false`» — **не проверял** (потребовался бы `plugin_manager list_bundles`; в списке бандлов профиля `package.json` этого бандла нет вообще, поэтому утверждение может относиться только к выводу Plugin Manager).
- Часть 3.3: вывод «`autoRun*` — мёртвая конфигурация» подтверждён сильнее, чем у A (0 совпадений во всём пакете и в агрегате); «остаточный путь — per-task `schedule` + `task_board_run`/`task_board_schedule`» подтверждён (`agent-tools.ts:285,382`; в леджере расписаний нет). Формулировка «`sessionDefaultPermission` расходится … кандидат в проверку» теперь закрыта: значение не доходит до плагина (§2.7).

### 3.3 Часть 2: K1 и K2
- **K1 — ПОДТВЕРЖДЁН.** Карточки действительно требуют HTTP: `MW-029.md:18` «Регистрация через `ctx.webServer.register`…», `MW-046.md:18` «Маршруты `/v1/tasks/{id}/discussion` и `/v1/attempts/{id}/steer` … через `ctx.webServer`», `MW-047.md:18` «SSE-инвалидация» (`ctx.webServer` в MW-047 не упомянут — цитата Lead неточна, но конфликт не в этом). Документ §19–§21 требует обратного: `:614-622` перечисляет `TypertRemoteService`, `@RemoteScope`, generated descriptors, `@Remote({mode:'stream'})`; `:628` — «Это позволяет **не создавать собственный loopback HTTP service**»; `:646` — `watch(...): AsyncIterable<BoardChangeFrame>`. Это конфликт транспортного решения, а не дополнение. **Уточнение-находка:** сама `MW-029` внутренне противоречива — цель (`:18`) требует `ctx.webServer.register`, приёмка (`:21`) — `connection.fetch.register`; обе версии всё равно HTTP, но план надо чинить и в этой точке.
- **K2 — ПОДТВЕРЖДЁН.** `MW-049.md:21` требует «ровно девять панелей в сетке 3x3» и переключение на `strip-horizontal` «при ширине менее 1100 px»; ADR018 (`decisions.md:145-151`) фиксирует 9 зон и `blocked ← {blocked, needs-attention}` (`:148`); документ `:182` называет это «presentation-specific knowledge, попавшее в domain/public contract», а §6.1 (`:203-211`, `:221`, `:230`) вводит 7 lanes и переносит `blocked` в бейдж, `needs-attention` — в `error`. Тип конфликта описан Lead верно: словарь и постоянные колонки, при согласии в принципе «зона ≠ состояние».

---

## 4. КОНТР-ДОКАЗАТЕЛЬСТВА (что пытался сломать и что вышло)

**К-1. «`applyDropIntent` — чистый reorder; `fromZone` недостижим». СЛОМАНО.**
Искал вход, на котором функция меняет зону. Команда (inline, без файлов):
`node --input-type=module -e "import {core,meta} from './tests/lib/fixtures.mjs'; … applyDropIntent({viewId:'default',taskId:'T-1',zone:'backlog',exactState:'ready',order:'V',columnRevision:1,boardRevision:1}, {…fromZone:'backlog',toZone:'ready',expectedColumnRevision:1}, 'W', M)"` → exit 0.
Наблюдаемый результат: `ok=true zone_before=backlog zone_after=ready fromZone=backlog columnRevision=2`; `assertSinglePlacement(выход) = true` (выход согласован), `assertSinglePlacement(вход) = false CONTRACT_MISMATCH` (вход — тот, который функция обязана была отвергнуть или нормализовать явно).
Вывод: зона меняется, `PlacementChange.fromZone` достижим. Условие недостижимости — внешний инвариант `zone == projectTaskZone(exactState)`, которого функция не проверяет; A-12 защищён оговоркой в скобках, A-13 — нет.

**К-2. «`legalDropTargets` и `applyDropIntent` согласованы». СЛОМАНО.**
Цикл по `core.legalDropTargets('ready')` → `ready: ACCEPTED`, `blocked: TASK_CONFLICT`, `cancelled: TASK_CONFLICT`, причём `details.legalTargets` отказа = `["ready","blocked","cancelled"]`. Публичный API рекламирует две цели, которые сам отвергает, и это закреплено тестом `:497`. Вывод A верен; дополнительно видно, что тест `:452-484` этого не ловит, потому что проверяет только «принято ровно одно» и не сверяет принятую зону со списком целей иначе как через `includes`.

**К-3. «Маркеры DOM-takeover существуют / числа совпадут». Частично сломано.**
Искал `data-dsh-taskboard-active` и `centerCol` во всём пакете (включая `lib`, `*.d.ts`, `*.map`) — 0 и 0, то есть существо A-63/Lead-3.2 стоит. Но заявленные числа семантических якорей не воспроизвелись ни в одном разрезе: `src` = 2/4/2, `lib` = 4/5/3, вместе = 6/9/5 против A-ных 5/6/4. Доказательство A-63 в числовой части невоспроизводимо.

**К-4. «`autoRunTodo` — второй исполнитель». СЛОМАТЬ НЕ УДАЛОСЬ (подтверждаю A и Lead).**
Искал реализацию ключа где угодно: `autoRun` в `src/**`, в `lib/**` (включая `client.js`, `index.js`, `types/**`), в `@linxin666/dsh-web-all` (включая его `cordis.patch.yml`) — 0 совпадений везде. Единственные реальные пути авто-запуска — per-task `schedule` (у 55 карточек отсутствует) и agent-инструменты (`task_board_run`/`task_board_schedule`, `agent-tools.ts:285,382`). Утверждение `.work/EXECUTION-PLAN.md:125` («Сейчас он выключен») ложно буквально: `autoRunTodo: true` (`cordis.patch.yml:27`).

**К-5. «`Idea` где-нибудь да есть». СЛОМАТЬ НЕ УДАЛОСЬ.**
Искал `IdeaBank`, `ideaId`, `IdeaState`, `IdeaPromotion`, `idea.bank`, `Idea` (case-sensitive) по `packages/**` и `tests/**`, а также файлы с `idea` в имени по всему репозиторию. Результат: 0 типов, 0 строк authority, 4 комментария, 1 файл-отчёт.

**К-6. «Леджер содержит расписания/подзадачи/иное распределение». СЛОМАТЬ НЕ УДАЛОСЬ.**
Искал `schedule`, `parentId`, `teamRun`, `mode` в union полей: 14 полей, ни одного из четырёх; `status` ∈ {backlog, done, failed}; `workspaceId` — два значения 52/3; `executions` без `endedAt` — 0.

**К-7. «В названиях/строках A и L есть ссылки на несуществующее». Частично сломано.**
Проверял адресность ссылок: все `файл:строка` из обязательного списка существуют и содержат то, что заявлено. Исключения собраны в §7. Отдельно: отчёт MW-043 ссылается на базу `fbee7a0b` — коммит существует (`git cat-file -t` → `commit`, exit 0) и является предком HEAD.

**Что искал и не нашёл (то есть не сломал):** продуктовый вызов `applyDropIntent`/`legalDropTargets` вне тестов; производитель `BoardPlacement` помимо `assertSinglePlacement`; вторую строку `web-ui-task-board` в профиле или в агрегате; `permissionPending` как **хранимое** поле леджера (в леджере его нет — это производный флаг read-model); тип `AttentionState`, `BulkResult`, `SessionLink` (кроме одного объявления), `BoardSnapshot`/`BoardCard`/`BoardReadService`, client stores; `TaskSetter` (MW-026).

---

## 5. НЕОПРЕДЕЛЁННОСТЬ (что не проверял и почему)

1. **`plugin_manager list_bundles` / `list_plugins`** — не вызывал: в этой сессии approval-промпты отключены, а действие требует danger-full-access; посчитать «21 бандл», состояние `enabled/disabled` для строк и «отдельный бандл task-board `enabled: false`» (L-3.1) локальными файлами нельзя. Что проверяемо файлами — проверено (`profiles/web/package.json`: 14 бандлов, из них `@linxin666/dsh-web-all` есть, отдельного task-board нет).
2. **Семантика patch-слоя DSH** («как именно loader применяет `config` патча к строке бандла») — не проверял: `grep 'cordis.patch.yml'` по `packages/**` не успел (запуск ушёл в фон и был снят). Вывод §2.7 опирается на наблюдаемые факты (вложенность в файле профиля + `familyConfigOf` в агрегате + дефолт плагина), а не на код loader'а; остаётся неустановленным, не выполняет ли loader какого-либо «подъёма» вложенного `config`.
3. **Схема `Config` реального плагина при монтаже через оболочку** (обрезает ли она неизвестные ключи `config`, `autoRun*` и не логирует ли отказ) — не проверял: нужен запуск с мутацией/логом живого профиля, что запрещено. Косвенно: доска смонтирована (revision 324), значит ключи её не ломают.
4. **Историческая верность чисел MW-054/MW-055 на момент написания** — не проверял: версий `ledger-v2.json` нет, `git` историю он не имеет. Утверждаю только ложность на текущей ревизии 324.
5. **Разделы A, которые я не проверял вовсе:** §4 «Новое» (идеи/оценки), §3.1–3.5 и §3.7–3.9 (предложения по правке карточек, оценки усилий), A-27…A-28 (частично: A-27 проверен — 12 каталогов), A-44…A-51, A-58…A-60 (A-60 проверен), A-64…A-71 (проверены выборочно), A-45 («восемь утверждений теста станут неверными» — оценочное, не проверял), а также Lead 1.3 пп. 3–5, 2.2, 2.5, §42–§44 документа.
6. **`docs/subsystems`-удаление `code-runtime.md`** — констатировал факт по `git ls-tree`; содержательно не проверял, куда переехала подсистема.
7. **`permissionPending: true` из брифинга §3** — как поле леджера не существует; проверял производный признак (`permissionConfirmedAt` отсутствует у 33, у MW-044…MW-055 — у всех 12). Как именно read-model называет это состояние, не проверял.

---

## 6. РАСХОЖДЕНИЯ МЕЖДУ ОТЧЁТАМИ (кто прав по моей проверке)

| Тема | A (Board) | Lead-заметки | Прав по проверке |
|---|---|---|---|
| `autoRun*` | «мёртвая конфигурация»: 0 совпадений в `src/**` и `lib/index.js` (A-65/A-66), `EXECUTION-PLAN.md:125` опровергнут (A-67) | То же, со ссылкой на A и с оговоркой «остаточный путь — schedule + инструменты» (3.3, 3.4) | **Оба правы**; моя проверка усиливает: 0 совпадений не только в `src/**`+`lib/index.js`, но и в `types/**` и в агрегате `dsh-web-all`. Расхождений по существу нет — расхождение было в первой редакции Lead и снято самим Lead |
| «Второй исполнитель» | Реализуется не тумблером, а `task_board_run`/`task_board_schedule` или cron-записью (A, §54 п. 3) | То же (3.3, с пометкой «поправка потока A») | **Оба правы**; в леджере расписаний нет (проверено), инструменты доступны (8 инструментов, `agent-tools.ts`) |
| DOM-takeover легаси-доски | «Нативные слоты, маркеров нет» — A-61/A-63, ссылка на `native-panel.tsx:1-18` и `:99-123` | То же (3.2, 3.4 п. 2), со ссылкой `:99-124` | **Оба правы**; числа A (5/6/4) не воспроизвелись (мои 6/9/5), ссылка Lead `:99-124` точнее (файл — 124 строки) |
| `sessionDefaultPermission` | Расхождение профиля и сводки доски, **причина не выяснена** (A-72, `unverified`) | «Расходится … кандидат в проверку, а не установленный факт» (3.3) | **Оба недосказали; причина найдена мной**: значение лежит во вложенном `config`, оболочка агрегата отдаёт плагину все ключи кроме `plugin`, плагин читает право с верхнего уровня → действует дефолт `read-only`. Практический вывод: это не «расхождение сводок», а неработающая настройка профиля |
| Причина BLOCKED у MW-043 | «Карточка BLOCKED, файлов нет» (A-06) | «Заблокирован отсутствием MW-011 и MW-026; MW-011 с тех пор реализован» (3.4 п. 3) | **Lead точнее**: MW-011 реализован `d0b0cbc` (2026-09-19 18:37), отчёт MW-043 написан 2026-09-19 00:38 на базе `fbee7a0b`; MW-026 не реализован (`TaskSetter` = 0). У A вердикт верен, но причина не пересмотрена |
| Первые добавления путей в DSH | не рассматривал | ssh / token-meter / auto-review / tool-present — атрибуции неверны | **A не при чём; ошибки у Lead** (см. §3.1). Проверяемая часть карты конфликтов (K1, K2, peers, агрегат) у Lead верна |
| Число совпадений `Idea` | «5 совпадений» (A-04) | не называет числа | **Ни тот, ни другой**: case-sensitive `Idea` — 4 совпадения; существо (типов нет) верно у A |
| Состояние `INDEX.md` | не рассматривал | «у всех 55 карточек `planned`» (2.3) | **Lead неправ** (и брифинг тоже): 53 `planned` + MW-027/MW-035 `superseded` (`INDEX.md:69,97`) |

---

## 7. Находки в доказательствах (ссылки, которые не выдерживают проверки)

1. `A-40`: `ledger-v2.json.recentRequests[255]` — такого индекса нет, последний = 254 (всего 255 записей). Утверждение верно, ссылка — нет.
2. `A-37`: `cordis.patch.yml:26-27` для пары `autoRunTodo`/`autoRunPaused` — фактически `:27`/`:28` (`:26` — `announceToAgent`).
3. `A-63`: числа маркеров 5/6/4 не воспроизводятся (6/9/5 при `src`+`lib`); сами нули по `data-dsh-taskboard-active`/`centerCol` верны.
4. `A-04`: «5 совпадений `Idea`» — 4 (case-sensitive).
5. `A` (§54/§53-текст): «5 host-модулей, ~136 КБ» — фактически 6 файлов `host-*.ts`, ≈134 КБ.
6. `Lead 3.4 п. 3`: «`PlanMutationIntent/StagedPlanMutation/BlockerResolutionGate` (grep, 183 совпадения)» — 86 совпадений по `packages`+`tests` (198 по подстроке `PlanMutation*`); число не воспроизводится, существование типов — да.
7. `Lead 1.2`: «`packages/ssh` первое добавление ~2026-09-14 (`33d89aee77`)» — первый add `4fb0fdac68` (2026-09-12); «`packages/llm/token-meter` 2026-08-25 (`b565df3442`)» — первый add `f038780ff6` (2026-07-15); «`packages/experimental/auto-review` 2026-09-24 (`a3480857dd`)» — самый ранний add `55e53907ab` (2026-09-09).
8. `Lead 1.1`: разбивка 1010/462/329/265/202/29/7 воспроизводится **только** с `--no-merges`; в заметках ключ не указан.
9. `Lead 1.3 п. 2`: дата `cc478ac70a` — 2026-09-21, а не 2026-09-18.
10. `Lead 2.3`: «у всех 55 карточек `planned`» — 53 `planned`, MW-027 и MW-035 `superseded`.

---

## 8. Таблица вердиктов

| ID | Вердикт | Доказательство | Комментарий |
|---|---|---|---|
| A-01 | ПОДТВЕРЖДЁН | `contracts/src/board.ts:26-44`, `:53-63` | 9 зон, union закрыт, `BOARD_ZONES` frozen |
| A-02 | ПОДТВЕРЖДЁН | `:126`, `:129`, `:132`; `tests/board.test.mjs:637-640` | обе строки режима и порог 1100 — дословно |
| A-03 | ПОДТВЕРЖДЁН | `Get-ChildItem *idea*` → только `.work/reports/MW-043-idea-bank.md` | файлов `idea.ts` нет |
| A-04 | ПОДТВЕРЖДЁН (число неверно) | case-sensitive `IdeaBank\|ideaId\|\bIdea\b` → 4 комментария | типов нет; у A «5 совпадений» |
| A-05 | ПОДТВЕРЖДЁН | `authority.ts` по `idea` → 0 | ADR019 обещает строку (`decisions.md:177`) |
| A-06 | ПОДТВЕРЖДЁН | `MW-043-idea-bank.md:3`, `:106` | причина блокировки устарела: MW-011 есть (`d0b0cbc`) |
| A-07 | ПОДТВЕРЖДЁН | `board.ts:102-119`; `tests/board.test.mjs:62,66,68` | 16 состояний, каждое один раз |
| A-10 | ПОДТВЕРЖДЁН | `core/src/board.ts:521-539` | отказ типизирован `TASK_CONFLICT` |
| A-11 | ПОДТВЕРЖДЁН | `core/src/board.ts:552-557` | `exactState` не пишется, меняются `zone/order/columnRevision` |
| A-12 | ПОДТВЕРЖДЁН (условно) | `:472`, `:522` + исполнение | верно **при** инварианте, который функция не проверяет |
| A-13 | **ОПРОВЕРГНУТ** | исполненный контрпример: `zone backlog→ready`, `fromZone='backlog'`, `ok=true`, exit 0 | поле достижимо на несогласованном входе; сегодня латентно (нет продуктовых вызовов) |
| A-14 | ПОДТВЕРЖДЁН | `tests/board.test.mjs:452-484` (ключ `:484`) + `node --test` 24/24, exit 0 | «принят ровно один drop» |
| A-15 | ПОДТВЕРЖДЁН | `tests/board.test.mjs:179` + исполнение: `blocked`/`cancelled` → `TASK_CONFLICT` | цели рекламируются и отвергаются |
| A-16 | ПОДТВЕРЖДЁН | `core/src/board.ts:533`; `tests/board.test.mjs:497` | отказ перечисляет те же недостижимые цели |
| A-17 | ПОДТВЕРЖДЁН | grep `applyDropIntent\|legalDropTargets` → определение, `core/src/index.ts:301,306`, тесты | продуктовых вызовов нет |
| A-18 | ПОДТВЕРЖДЁН | `core/src/board.ts:110` (`Map<TaskId,…>`) против `contracts/…:176,193` | ключ только `taskId` |
| A-19 | ПОДТВЕРЖДЁН | `contracts/src/operation.ts:19` | `readonly operationId` |
| A-21 | ПОДТВЕРЖДЁН | `contracts/src/board.ts:141-166` | 7 состояний, `empty` есть, `reconciliation-pending` нет |
| A-22 | ПОДТВЕРЖДЁН | `contracts/src/board.ts:307` | это `DegradedProjection.reason` |
| A-23 | ПОДТВЕРЖДЁН | `board.ts:222,224`; `task.ts:89` | три ревизии на месте |
| A-24 | ПОДТВЕРЖДЁН | `:552-557`; `tests/board.test.mjs:417` | `boardRevision` не двигается |
| A-25 | ПОДТВЕРЖДЁН | grep `BoardCardRevisionSet\|BoardStore\|WorkspaceStore\|TaskStore\|AgentStore` → 0 | client stores отсутствуют |
| A-26 | ПОДТВЕРЖДЁН | grep `BoardSnapshot\|BoardCard\|BoardReadService` по `packages`,`tests` → 0 | единственное совпадение — чужой `TaskBoardSnapshot` в отчёте |
| A-28 | ПОДТВЕРЖДЁН | `node --test tests/board.test.mjs` → `tests 24 / pass 24 / fail 0`, exit 0 | воспроизведено |
| A-29 | ПОДТВЕРЖДЁН | экстрактор леджера | 55 карточек, `backlog 34/done 19/failed 2`, 52 без `archivedAt` |
| A-30 | ПОДТВЕРЖДЁН | `workspace.json` + экстрактор | `47b14762 = H:\Repo\DSH-MyWork`, 52 карточки, все 19 `done` |
| A-31 | ПОДТВЕРЖДЁН | экстрактор + `global.workspaceIds` | 3 карточки (2 backlog, 1 failed), id отсутствует в реестре; **все 3 архивированы** |
| A-32 | ПОДТВЕРЖДЁН (опровержение верно) | `MW-054.md:18`; экстрактор | 19 `done` в 47b14762, 3 карточки в 3fc33afb |
| A-33 | ПОДТВЕРЖДЁН (опровержение верно) | `MW-054.md:18`; экстрактор | критерии не совпадают: фильтр «не done» убирает 19 |
| A-34 | ПОДТВЕРЖДЁН (опровержение верно) | `MW-055.md:21`; экстрактор | 41 не даёт ни одна проекция (55/52/33/3) |
| A-35 | ПОДТВЕРЖДЁН | union полей карточки (14 имён) | ни `schedule`, ни `parentId`, ни `teamRun`, ни `mode` |
| A-36 | ПОДТВЕРЖДЁН | `scheduler-v2.json` | `{"lastTickAt":1790442076557}` |
| A-37 | ПОДТВЕРЖДЁН (ссылка неточна) | `cordis.patch.yml:26-28` | `autoRunTodo: true` на `:27`, `autoRunPaused: true` на `:28` |
| A-38 | ПОДТВЕРЖДЁН | экстрактор: `result` 20 succeeded / 11 failed, 0 без `endedAt` | поле называется `result`, не `status` |
| A-39 | ПОДТВЕРЖДЁН | экстрактор | `workspace-write` у 55, `permissionConfirmedAt` нет у 33 |
| A-40 | ПОДТВЕРЖДЁН (ссылка на несуществующий индекс) | `recentRequests` — 255 записей; последний индекс 254 | `[255]` выходит за границы |
| A-41 | ПОДТВЕРЖДЁН | `cordis.patch.yml:20-35`, `profiles/web/package.json:5` (`^0.4.3`) | версия установлена 0.4.3; `name` строки — `@linxin666/dsh-web-all/task-board` |
| A-42 | ПОДТВЕРЖДЁН (счёт неточен) | 6 файлов `src/host-*.ts`, ≈134 КБ | host-часть живёт в том же пакете — вывод верен |
| A-43 | ПОДТВЕРЖДЁН | `src/core/tasks.ts:11`; экстрактор леджера | 5 статусов объявлено, использованы 3 |
| A-52 | ПОДТВЕРЖДЁН | grep `subState` → 1 (`contracts/src/board.ts:210`) | производителя нет |
| A-53 | ПОДТВЕРЖДЁН | grep `AgentIdentity\|AgentInstance` → 63 | контракты роустера существуют |
| A-54 | ПОДТВЕРЖДЁН | `board.ts:197-225` против `:179` | `workspaceId` в placement нет |
| A-55 | ПОДТВЕРЖДЁН | grep `SessionLink` → 1 (`board.ts:336`) | ни потребителей, ни производителей |
| A-56 | ПОДТВЕРЖДЁН | grep `BulkResult` → 0 | тип результата bulk отсутствует |
| A-57 | ПОДТВЕРЖДЁН | grep `AttentionState` → 0 | при этом документ объявляет его в §6.2 (`:246`) |
| A-58 | ПОДТВЕРЖДЁН | `board.ts:176,203`; `core/src/board.ts:407-419` | зона = ключ ревизии, порядка и persisted-значение |
| A-59 | ПОДТВЕРЖДЁН | `board.ts:118`; `decisions.md:148`; документ `:230` | `needs-attention → blocked` против `error/attention` в §6.1 |
| A-60 | ПОДТВЕРЖДЁН | `MW-042-board-projection.md:7`, `:189`; `MW-049.md:4`, `MW-050.md:4` | MW-042 закрыт DONE, база отчёта `fbee7a0b` |
| A-61 | ПОДТВЕРЖДЁН | `native-panel.tsx:99-124`, `controller.ts:66` | нативные слоты, key = `task-board` |
| A-62 | ПОДТВЕРЖДЁН | `native-panel.tsx:31-32` | `order = 20`, «Plugins is 0, Schedule 10» |
| A-63 | ПОДТВЕРЖДЁН по существу, числа нет | `-SimpleMatch` по `src`+`lib`: 0/0; 6/9/5 | маркеров захвата DOM нет |
| A-64 | ПОДТВЕРЖДЁН | `telemetry.ts:27,5-8,81,82`; `index.ts:51-112` | heartbeat без выключателя |
| A-65 | ПОДТВЕРЖДЁН | `src/index.ts:51-88`, `:103-112` | ровно 8 полей |
| A-66 | ПОДТВЕРЖДЁН (усилен) | `autoRun` → 0 во всём пакете **и** в `dsh-web-all` | мёртвые ключи |
| A-67 | ПОДТВЕРЖДЁН (опровержение верно) | `EXECUTION-PLAN.md:125`; A-65/A-66 | «выключен» ложно (`true`), тумблера нет |
| A-68 | ПОДТВЕРЖДЁН | `agent-tools.ts:253,285,335,382,428,476,498,575` | все 8 строк совпали |
| A-69 | ПОДТВЕРЖДЁН | `src/invariant.ts` (4 строки) | пустой companion |
| A-70 | ПОДТВЕРЖДЁН | 55 файлов `src/**`, из них 42 `.ts` + 11 `.tsx` | исходники поставляются |
| A-72 | ОПРОВЕРГНУТ в части «причина не выяснена» | `cordis.patch.yml:25`; `shell-DWqLngib.js:1088-1092`; `index.ts:323`; `handover.ts:44` | причина — вложенный `config`: право не доходит, действует `read-only` |
| L-1.1 (3650, теги, +1) | ПОДТВЕРЖДЁН | `git rev-list --count … → 3650` (exit 0); `git log -1` по 4 тегам | даты и SHA совпали |
| L-1.1 (типы коммитов) | ПОДТВЕРЖДЁН с оговоркой | `git log --no-merges` → 1010/462/329/265/202/29/7 | без `--no-merges` — 1020/331/205; ключ в заметках не указан |
| L-1.1 (файлы по областям) | **ОПРОВЕРГНУТ** | `git log --name-only` → client 12 112, api 1 424, session 731 | заявленные 12 524/1 537/866 не воспроизводятся |
| L-1.2 (presence-таблица) | ПОДТВЕРЖДЁН | `git ls-tree` по тегам, 19 путей | все НЕТ/ЕСТЬ совпали |
| L-1.2 (`tool-present` — новая подсистема) | **ОПРОВЕРГНУТ** | `--diff-filter=R --follow` → переезд из `packages/fs/tool-present` (`f800ea46e5`) | новое — группировка `deliverables`, не сам tool |
| L-1.2 (первые добавления) | **ОПРОВЕРГНУТ** (3 из 5) | `--diff-filter=A`: ssh `4fb0fdac68`/09-12; token-meter `f038780ff6`/07-15; auto-review `55e53907ab`/09-09 | product-telemetry и plugin-manager — «в окне» верно |
| L-1.2 (docs/subsystems 54→63, +10) | ПОДТВЕРЖДЁН с оговоркой | `git ls-tree -r`, исключая `*.zh.md`: 54 → 63, +10 | не упомянуто удаление `code-runtime.md` |
| L-1.3 п.1 (peer-compat, нет peers у MyWork) | ЧАСТИЧНО | `2c67633990`, `51d70c5f5c`; `packages/controller/package.json` | у controller есть `peerDependencies: cordis ^4.0.2`; у пакетов нет `engines` |
| L-1.3 п.2 (дата `cc478ac70a`) | **ОПРОВЕРГНУТ** | `git log -1 cc478ac70a` → 2026-09-21 | в заметках 2026-09-18 |
| L-2.1 K1 | ПОДТВЕРЖДЁН | `MW-029.md:18`, `MW-046.md:18`, `MW-047.md:18`; документ `:614-628`, `:646` | + находка: `MW-029.md:21` называет другой API (`connection.fetch.register`) |
| L-2.1 K2 | ПОДТВЕРЖДЁН | `MW-049.md:21`; `decisions.md:145-151`; документ `:182`, `:203-211`, `:221`, `:230` | 9 зон против 7 lanes, `blocked` → бейдж |
| L-2.3 («у всех 55 planned») | **ОПРОВЕРГНУТ** | `INDEX.md`: 53 `planned`; `MW-027`/`MW-035` `superseded` (`:69`, `:97`) | заодно снимает ту же ошибку брифинга §3 |
| L-2.4 (12 карточек с непройденным гейтом) | ПОДТВЕРЖДЁН | экстрактор: MW-044…MW-055 — 12 карточек, `permissionConfirmedAt` пуст у всех | `permissionPending` — производный флаг, в леджере не хранится |
| L-3.1 (web-all как агрегат, peers) | ПОДТВЕРЖДЁН | `web-all/package.json`, `cordis.patch.yml` (19 строк) | `peerDependencies >= 0.1.7-rc.2` у web-all и у task-board |
| L-3.1 («отдельный бандл enabled: false») | НЕОПРЕДЕЛЁННО | нужен `plugin_manager list_bundles`; в `profiles/web/package.json` этого бандла нет | в файлах профиля подтверждения нет |
| L-3.2 (слоты, HTTP-прецедент, файлы домена) | ПОДТВЕРЖДЁН | `native-panel.tsx:99-124`; `index.ts:35,388`; `protocol.ts:13`; `src/core/{subtask,session-reuse,schedule,handover,freeze-snapshot}.ts` | все ссылки точны |
| L-3.3 (`autoRun*` мертвы, путь — schedule/инструменты) | ПОДТВЕРЖДЁН | 0 совпадений в пакете и агрегате; `agent-tools.ts:285,382`; расписаний в леджере нет | совпадает с A-66 и моим К-4 |
| L-3.4 п.3 (183 совпадения PlanMutation) | **ОПРОВЕРГНУТ** (число) | grep по `packages`+`tests` → 86 (по подстроке `PlanMutation*` → 198) | типы существуют, число — нет |
| L-3.4 п.3 (MW-011 закрыт, MW-026 нет) | ПОДТВЕРЖДЁН | `d0b0cbc`; `TaskSetter` → 0 | план/planner есть, Task Setter — нет |

---

**Что этот файл меняет для кампании:**
1. A-13 надо переписать: «`fromZone` недостижим» неверно; корректная формулировка — «недостижим, пока вход согласован, а согласованность функция не проверяет» — и это надо закрыть в правке §3.3 у A (резолвер `resolveDropIntent` обязан валидировать `placement.zone === projectTaskZone(exactState)` до выбора ветки).
2. `legalDropTargets`/`applyDropIntent` — не «несогласованность тестов», а несогласованность публичного API: правка нужна в коде (или список целей должен строиться из достижимых зон с учётом `:522`, или `:522` должен принимать `legalDropTargets` как источник истины).
3. Гейт прав MW-044…MW-055 — не «непонятное расхождение» (A-72), а дефект конфигурации профиля: `sessionDefaultPermission` вложен на уровень глубже, чем читает плагин; лечится переносом ключа на верхний уровень `config` строки (проверяется по `index.ts:323` и `handover.ts:44`).
4. Числа в MW-054/MW-055 надо переписать не «на актуальные», а на правило: `workspaceId == MyWork` И `archivedAt` отсутствует И `status != done` → 33 карточки (52 без архива, 19 `done`); «41» не существует ни в одной проекции.
5. В карте Lead'а исправить три атрибуции «первого добавления», убрать «новая подсистема» у `tool-present`, число файлов по областям и дату `cc478ac70a`; в брифинге/INDEX-строке — «53 `planned` + 2 `superseded`».
