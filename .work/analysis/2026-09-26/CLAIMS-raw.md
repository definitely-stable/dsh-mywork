# Консолидированный claim-леджер (сырой, для независимой верификации)

Собрано: 2026-09-26 22:32:23 +05:00 из отчётов потоков A–G.

| ID | Утверждение | Доказательство | Статус | Источник |
|---|---|---|---|---|
| A-01 | `BoardZone` — закрытый union из девяти зон, экспортируемый из `@dsh-mywork/contracts`. | `packages/contracts/src/board.ts:26-44`, `:53-63` | verified |
| A-02 | Layout-знание (`grid-3x3`, `strip-horizontal`, порог 1100 px) лежит в domain-контракте, а не в UI. | `packages/contracts/src/board.ts:126`, `:129`, `:132`; тест `tests/board.test.mjs:638-639` | verified |
| A-03 | Сущности `Idea` в репозитории нет: файлов `packages/contracts/src/idea.ts` и `packages/core/src/idea.ts` не существует. | `glob **/*idea*` → только `.work/reports/MW-043-idea-bank.md` | verified |
| A-04 | Ни один тип `Idea`/`IdeaBank`/`ideaId` не объявлен в исходниках; все 5 совпадений слова `Idea` — комментарии. | `Select-String 'Idea|IdeaBank|ideaId'` по `packages/**`,`tests/**` (без `node_modules`/`dist`/`lib`) | verified |
| A-05 | Строка authority `idea.bank`, обещанная ADR019, в матрице отсутствует. | `Select-String 'idea'` по `packages/contracts/src/authority.ts` → 0 совпадений; ADR019 в `.work/architecture/DSH-My-Work-Architecture-v0.2-decisions.md:177` | verified |
| A-06 | Карточка MW-043 (Idea Bank) имеет статус BLOCKED и не создала ни одного файла. | `.work/reports/MW-043-idea-bank.md:3`, `:106` | verified |
| A-07 | `ZONE_BY_STATE` покрывает ровно 16 `TaskState`, каждый — один раз. | `packages/contracts/src/board.ts:102-119`; `packages/contracts/src/task.ts:46-63`; тест `tests/board.test.mjs:62,66,68` | verified |
| A-08 | В коде `needs-attention` рендерится в зоне `blocked`, а не в `error`, как предлагает §6.1. | `packages/contracts/src/board.ts:118`; ADR018 `.work/architecture/DSH-My-Work-Architecture-v0.2-decisions.md:148` | verified |
| A-09 | `blocked` достижим до активной попытки из `planned` и `ready`, что подтверждает §6.3. | `packages/core/src/task.ts:52-53` | verified |
| A-10 | `applyDropIntent` отказывает, если `toZone` не равен ни `projectTaskZone(exactState)`, ни текущей зоне. | `packages/core/src/board.ts:521-539` | verified |
| A-11 | `applyDropIntent` не меняет `TaskState`: результат строится spread'ом исходного placement. | `packages/core/src/board.ts:552-557` | verified |
| A-12 | В успешном вызове `applyDropIntent` `fromZone` и `toZone` оба равны текущей зоне, то есть функция является чистым reorder. | `packages/core/src/board.ts:472`, `:522` (при инварианте `zone == projectTaskZone(exactState)`) | verified |
| A-13 | Поле `PlacementChange.fromZone` недостижимо, так как условие его записи требует `fromZone !== toZone`. | `packages/core/src/board.ts:438`, `:561` вместе с A-12 | verified |
| A-14 | Тест фиксирует, что из девяти зон принимается ровно один drop — собственная. | `tests/board.test.mjs:452-484`, ключевая строка `:484` | verified |
| A-15 | `legalDropTargets('ready')` возвращает `['ready','blocked','cancelled']`, то есть зоны, которые `applyDropIntent` отвергнет. | `tests/board.test.mjs:179` против `packages/core/src/board.ts:522` | verified |
| A-16 | Отказ `applyDropIntent` рекламирует в `details.legalTargets` те же недостижимые цели, и это закреплено тестом. | `packages/core/src/board.ts:533`; `tests/board.test.mjs:497` | verified |
| A-17 | Ни `applyDropIntent`, ни `legalDropTargets` не имеют продуктовых вызовов — только реэкспорт и тесты. | `Select-String` по `packages`,`tests`,`scripts`; `packages/core/src/index.ts:301-310` | verified |
| A-18 | `assertSinglePlacement` дедуплицирует по `taskId`, а не по документированному ключу `(viewId, taskId)`. | `packages/core/src/board.ts:110`; контракт `packages/contracts/src/board.ts:176`, `:193` | verified |
| A-19 | `OperationMeta.operationId` объявлен как идентификатор с сохранением при повторной доставке. | `packages/contracts/src/operation.ts` (`interface OperationMeta`, поле `operationId`) | verified |
| A-20 | Дедупликации по `operationId` в board-пути нет: `columnRevision` инкрементируется при каждом вызове. | `packages/core/src/board.ts:556`; отсутствие потребителей по A-17 | verified |
| A-21 | `BoardPanelState` содержит семь состояний, включая `empty`, и не содержит `reconciliation-pending`. | `packages/contracts/src/board.ts:141-166` | verified |
| A-22 | `reconciliation-pending` — причина деградации, а не panel state. | `packages/contracts/src/board.ts:307` | verified |
| A-23 | `BoardPlacement` несёт `columnRevision` и `boardRevision`, а `Task` — собственную `revision`. | `packages/contracts/src/board.ts:222-224`; `packages/contracts/src/task.ts:89` | verified |
| A-24 | `applyDropIntent` не изменяет `boardRevision` и бампает только `columnRevision` зоны. | `packages/core/src/board.ts:552-557`; тест `tests/board.test.mjs:417` | verified |
| A-25 | Тип `BoardCardRevisionSet` и любые client stores (§49, §52) отсутствуют в дереве. | grep `BoardCardRevisionSet|BoardStore|WorkspaceStore|TaskStore|AgentStore` по `packages`,`tests`,`.work` → 0 совпадений | verified |
| A-26 | Типы `BoardSnapshot`/`BoardCard`/`BoardReadService`/`BoardWatchRequest` отсутствуют; единственное совпадение — чужой `TaskBoardSnapshot`. | grep по `packages`,`tests`,`.work/architecture`,`.work/reports` → `.work/reports/MW-001-target-capabilities.md:219` | verified |
| A-27 | Пакета с клиентским bundle в MyWork нет: в `packages/` двенадцать каталогов, ни одного UI/web. | `Get-ChildItem packages -Directory` | verified |
| A-28 | Тесты доски проходят целиком. | `node --test tests/board.test.mjs` → `tests 24 / pass 24 / fail 0`, exit 0 | verified |
| A-29 | Легаси-леджер содержит 55 карточек, 52 без `archivedAt`; статусы `backlog 34 / done 19 / failed 2`. | экстрактор `ConvertFrom-Json` по `C:\Users\Dmitry\.dsh\task-board\ledger-v2.json` (`schemaVersion 3`, `revision 324`) | verified |
| A-30 | Воркспейс `47b14762-c848-44e6-a7cc-62f19949566d` — это `H:\Repo\DSH-MyWork`, и он содержит 52 карточки, включая все 19 `done`. | `C:\Users\Dmitry\.dsh\storages\workspace.json` → `tables.workspaces['47b14762…'].path`; экстрактор леджера | verified |
| A-31 | Воркспейс `3fc33afb-e9c6-4bf2-b561-4388c8ad0e09` содержит 3 карточки (`backlog 2`, `failed 1`) и отсутствует в реестре воркспейсов. | экстрактор леджера; `workspace.json.global.workspaceIds` (8 id) и `tables.workspaces` | verified |
| A-32 | Утверждение MW-054 «6 done в 47b14762, 35 незавершённых в 3fc33afb» опровергнуто: 19 `done` в 47b14762, 3 карточки в 3fc33afb. | A-30, A-31; `.work/tasks/MW-054.md:18` | refuted |
| A-33 | Утверждение MW-054 «эти два критерия совпадают» опровергнуто: фильтр «не done» убирает 19 карточек внутри воркспейса MyWork. | A-30; `.work/tasks/MW-054.md:18` | refuted |
| A-34 | Число «41 карточка» в приёмке MW-055 не соответствует ни одной реальной проекции леджера. | `.work/tasks/MW-055.md:21`; A-29, A-30, A-31 | refuted |
| A-35 | Ни одна из 55 карточек леджера не имеет поля `schedule`, `parentId`, `teamRun` или `mode`. | экстрактор: union полей карточки = `archivedAt, createdAt, description, executions, id, model, permission, permissionConfirmedAt, prompt, status, tags, title, updatedAt, workspaceId` | verified |
| A-36 | Расписаний в леджере нет: `scheduler-v2.json` содержит только `lastTickAt`. | `C:\Users\Dmitry\.dsh\task-board\scheduler-v2.json` = `{"lastTickAt":1790442076557}` | verified |
| A-37 | Легаси `autoRunTodo` **не** выключен: в живом профиле он `true` при `autoRunPaused: true`. | `C:\Users\Dmitry\.dsh\profiles\web\cordis.patch.yml:26-27` | verified |
| A-38 | Открытых исполнений в леджере нет: 0 из 31 (20 `succeeded`, 11 `failed`) на 22 карточках. | экстрактор леджера (executions без `endedAt`) | verified |
| A-39 | Все 55 карточек имеют `permission: workspace-write`, а `permissionConfirmedAt` отсутствует у 33. | экстрактор леджера | verified |
| A-40 | Легаси-плагин реализует идемпотентность запросов через журнал `recentRequests` из `{fingerprint, requestId}`. | `ledger-v2.json.recentRequests[255]`; `src/host-routes.ts:211`; `lib/types/protocol.d.ts:114-123` | verified |
| A-41 | Строка профиля ровно одна: `web-ui-task-board` → `@linxin666/dsh-client-ui-task-board@0.4.3`. | `profiles/web/cordis.patch.yml:20-33`; `profiles/web/package.json:5` | verified |
| A-42 | Host-часть легаси-доски (ledger, runner, scheduler, routes) живёт внутри того же пакета, поэтому CSS-скрытие панели не остановит её. | `node_modules/@linxin666/dsh-client-ui-task-board/src/{host-ledger,host-runner,host-service,host-routes}.ts` | verified |
| A-43 | В леджере встречаются только три статуса из пяти, объявленных плагином: `todo` и `running` не использованы. | `src/core/tasks.ts:11` (`5` статусов); экстрактор леджера (`backlog/done/failed`) | verified |
| A-44 | Приёмка MW-049 требует «ровно девять панелей» и переключение на `strip-horizontal` ниже 1100 px, что противоречит §6.1 (семь lanes) и §5.2. | `.work/tasks/MW-049.md:21`; §6.1 документа (строки 203-211); §5.2 (строка 182) | verified |
| A-45 | При смене модели зон 9 → 7 минимум восемь утверждений `tests/board.test.mjs` становятся неверными. | `tests/board.test.mjs:36-46`, `:48-52`, `:82-85`, `:179`, `:182`, `:533`, `:534`, `:638-639` | verified |
| A-46 | Разделы §50, §58 и код называют три разных набора состояний доски (6, 4 и 7 соответственно). | §50 (строки 1351-1356); §58 (строка 1616); `packages/contracts/src/board.ts:158-166` | verified |
| A-47 | Документ использует три разных имени команды перемещения (`board.reorder` в §21/§59, `board.move` в §56/коде). | §21 (строка 677); §59 (строка 1658); §56 (строка 1492); `packages/contracts/src/board.ts:268` | verified |
| A-48 | §71 помечает строку «Idea separate» как KEEP, хотя сущности нет и карточка MW-043 заблокирована. | §71 (строка 1912); A-03, A-06 | refuted |
| A-49 | §7 подтверждается кодом, но недооценивает следствие: cross-lane drop невозможен в принципе, а не «нельзя реализовать только через BoardPlacement». | §7 (строка 269); A-12, A-14 | verified |
| A-50 | Ни §56, ни карточки MW-042/047/049/050/053/055 не описывают миграцию сохранённых placement-ключей при слиянии зон. | §56 (строки 1486-1516); тексты карточек; `packages/contracts/src/board.ts:176`, `:203` | verified |
| A-51 | «Курсор» из MW-047 не типизирован для доски: тип `Cursor` в контрактах есть, но только в `agent-runtime.ts` и `taskgraph.ts`, и ни разу не встречается рядом с board/placement/zone. | `.work/tasks/MW-047.md:18,21`; `Select-String 'Cursor'` по `packages/contracts/src` → 30 совпадений в двух файлах (`agent-runtime.ts` 16, `taskgraph.ts` 14), 0 в board-контексте | verified |
| A-52 | `BoardPlacement.subState` объявлен, но не имеет ни одного производителя: слово `subState` встречается в дереве ровно один раз. | `Select-String 'subState'` по `packages/**`,`tests/**` → единственное совпадение `packages/contracts/src/board.ts:210` | verified |
| A-53 | Контракты роустера из §47 уже существуют: `AgentIdentity`, `AgentBlueprint`, `AgentInstance`, `AgentInstanceState`, `PoolLimits`/`RoleLimits`/`WorkspaceLimits`. | `packages/contracts/src/team.ts:194`, `:229`, `:297`, `:335`, `:349-363`; `Select-String 'AgentIdentity\|AgentInstance'` → 63 совпадения | verified |
| A-54 | `BoardPlacement` не содержит `workspaceId`, поэтому кросс-воркспейсный снапшот невозможно обнаружить по контракту. | `packages/contracts/src/board.ts:197-225` против `:179` (`BoardView.workspaceId`) и `packages/contracts/src/task.ts:79` | verified |
| A-55 | `SessionLink` объявлен ровно один раз и не имеет ни одного потребителя/производителя в дереве. | `Select-String 'SessionLink'` по `packages/**`,`tests/**` → 1 совпадение: `packages/contracts/src/board.ts:336` | verified |
| A-56 | Типа результата bulk-операции в контрактах нет, хотя MW-047 и MW-050 его требуют. | `Select-String 'BulkResult'` → 0 совпадений; `.work/tasks/MW-047.md:21`, `.work/tasks/MW-050.md:21` | verified |
| A-57 | `AttentionState`, необходимый для phase-preserving отображения `needs-attention` (§6.2), не объявлен нигде. | `Select-String 'AttentionState'` по `packages/**`,`tests/**` → 0 совпадений; §6.2 документа (строки 245-253) | verified |
| A-58 | Имена зон служат одновременно ключом ревизии, ключом порядка и значением persisted placement, то есть не являются подписями UI. | `packages/contracts/src/board.ts:176`, `:203`; `packages/core/src/board.ts:407-419` | verified |
| A-59 | Диапазон `needs-attention` в коде — `blocked`, а §6.1 меняет его на `error`; это пересмотр ADR018, а не уточнение. | `packages/contracts/src/board.ts:118`; `.work/architecture/DSH-My-Work-Architecture-v0.2-decisions.md:148`; §6.1 документа (строка 230) | verified |
| A-60 | Карточка MW-042 закрыта как DONE, поэтому переход к v0.3 не имеет исполнителя: MW-049/MW-050 зависят от неё как от выполненной. | `.work/reports/MW-042-board-projection.md:7,189`; `.work/tasks/MW-049.md:4`, `MW-050.md:4` | verified |
| A-61 | Установленная 0.4.3 регистрирует панель через официальные слоты `sidebar.panellist` и `main`, а не через захват DOM. | `src/client/native-panel.tsx:1-18`, `:106-113`, `:115-119`; `src/core/controller.ts:66` (`TASK_BOARD_PANEL_ID = 'task-board'`) | verified |
| A-62 | Порядок строки панели — `order: 20` при «Plugins is 0, Schedule 10». | `src/client/native-panel.tsx:31-32` | verified |
| A-63 | Маркеров DOM-takeover (`data-dsh-taskboard-active`, `centerCol`) в 0.4.3 нет; есть только семантические якоря скинов. | `Select-String` по `src`+`lib`: `data-dsh-taskboard-active` 0, `centerCol` 0; `data-dsh-panel-entry` 5, `data-dsh-taskboard-view` 6, `data-dsh-plugin` 4 | verified |
| A-64 | Ежедневный heartbeat на `dsh-market.com` в 0.4.3 сохранён и не имеет выключателя в конфиге. | `src/client/telemetry.ts:27`, `:5-8`, `:81-82`; отсутствие полей телеметрии в `src/index.ts:51-112` | verified |
| A-65 | Конфиг-схема 0.4.3 содержит восемь полей и ни одного `autoRun*`. | `src/index.ts:51-112` (`Config`), `:103-112` (schemastery) | verified |
| A-66 | Ключи `autoRun*` из профиля не читаются: подстрока `autoRun` отсутствует в `src/**` и в собранном `lib/index.js`. | `Select-String 'autoRun'` по обоим каталогам → 0; `cordis.patch.yml:26-32` | verified |
| A-67 | Утверждение `.work/EXECUTION-PLAN.md:125` «Сейчас он выключен» + «включённый тумблер даст двух исполнителей» неверно: ключ включён, не читается и механизма нет. | `.work/EXECUTION-PLAN.md:125`; A-65, A-66 | refuted |
| A-68 | 0.4.3 регистрирует восемь agent-инструментов `task_board_*`. | `src/host/agent-tools.ts:253,285,335,382,428,476,498,575` | verified |
| A-69 | `invariant.ts` легаси-плагина — пустой companion без объявленных инвариантов. | `src/invariant.ts` целиком (`export function apply(): void {}`) | verified |
| A-70 | Пакет 0.4.3 поставляется с исходниками TypeScript (55 файлов `src/**`, из них 53 `.ts`/`.tsx`), то есть является локальным читаемым референсом для MW-047/MW-048. | `Get-ChildItem -Recurse -File` по `node_modules/@linxin666/dsh-client-ui-task-board/src` | verified |
| A-71 | API-префикс и форма снапшота легаси совпадают с тем, что планирует MW-047: `TASK_BOARD_API_PREFIX = '/api/task-board'`, событие несёт только `revision/scheduler/power`. | `src/protocol.ts` / `lib/types/protocol.d.ts:6`, `:24-48` | verified |
| A-72 | `sessionDefaultPermission` расходится между профилем (`workspace-write`) и сводкой живой доски (`read-only`); причина не выяснена. | `cordis.patch.yml:25`; `lib/index.js` (fallback `"read-only"`); брифинг §3 | unverified |
| B-01 | Дефолтные границы Agent Teams: 16 members / 256 tasks / 64 pending per member / 65 536 bytes / 5 000 мс. | `packages/experimental/agent-team/src/index.ts:41-45`, `:59-65` | verified |
| B-02 | `maxMembers: 8` — это профильный слой, а не домен: домен по умолчанию 16. | `packages/experimental/agent-team-profile/cordis.patch.yml:20` против `agent-team/src/index.ts:41` | verified |
| B-03 | `maxMembers` считается до provisioning-append и включает провалившихся участников. | `agent-team/src/roster.ts:269-278`; README:51 | verified |
| B-04 | `waitForChange` принимает только 10 000…3 600 000 мс и падает типизированно вне диапазона. | `agent-team/src/activity.ts:23-25` | verified |
| B-05 | `waitForChange` не реплеит прошлое событие: waiter живёт только в памяти и разрешается лишь будущим `notify`. | `agent-team/src/activity.ts:12`, `:28-59`, `:72-77` | verified |
| B-06 | `wait_agent` возвращает `noProgress` без ожидания, когда нет другого member'а в `running`/`provisioning`; §15 этого не описывает. | `packages/experimental/tool-agent-team/src/index.ts:39-40`, `:252-274` | verified |
| B-07 | `sendMessage` сначала append+flush `team/message/queued` внутри транзакции Lead, и только потом пытается доставить. | `agent-team/src/mailbox.ts:117-148` | verified |
| B-08 | Dispatch регистрируется до выхода из транзакции, чтобы конкурентные отправители встали в durable-порядок. | `agent-team/src/mailbox.ts:145-147` | verified |
| B-09 | Ответ `send_message` — `accepted` при немедленной доставке и `queued` иначе; durable-принятие означает **оба**. | `agent-team/src/mailbox.ts:149-150`; `types.ts:188-191` | verified |
| B-10 | Лимит pending-сообщений — на цель и считает queued-minus-delivered. | `agent-team/src/mailbox.ts:122-129` | verified |
| B-11 | `maxMessageBytes` измеряется на sender-framed доставке (префикс с id и именем входит в лимит). | `agent-team/src/mailbox.ts:137-139`, `:309-314` | verified |
| B-12 | Немедленная доставка сериализуется per-target в durable-порядке очереди. | `agent-team/src/mailbox.ts:193-209`, `:212-232` | verified |
| B-13 | Дедупликация — на стороне цели: её собственный лог/персист сканируется по id `team-message`. | `agent-team/src/mailbox.ts:301-306`, `:317-331` | verified |
| B-14 | `team/message/delivered` пишется только после `sessions.flush(target)` и подтверждённого receipt. | `agent-team/src/mailbox.ts:273-282`, `:285-298` | verified |
| B-15 | Не-live цель читается из персиста; нечитаемый персист оставляет сообщение в очереди. | `agent-team/src/mailbox.ts:254-261`, `:317-331` | verified |
| B-16 | Provisioning: `provisioning`-запись + flush → `startContinuable` с **заранее вычеканенным** childId → flush принятого промпта → терминальный edge. | `agent-team/src/roster.ts:259`, `:269-291`, `:314-336` | verified |
| B-17 | Recovery provisioning завершает сагу по независимо персистенному ребёнку, требуя parentSession + `mode=continuable` + provider + принятый initial prompt. | `agent-team/src/roster.ts:399-413` | verified |
| B-18 | Проигранная гонка оседания даёт `TEAM_PROVISIONING_CONFLICT` и drain ребёнка. | `agent-team/src/roster.ts:302-335` | verified |
| B-19 | Recovery планируется на `agent/created` и для всех уже живых агентов при конструировании сервиса. | `agent-team/src/index.ts:108`, `:123`, `:235-249` | verified |
| B-20 | `interrupt` отменяет только текущий turn, не освобождает owner и не удаляет почту. | `agent-team/src/roster.ts:204-215`; README:143, `:209` | verified |
| B-21 | Selective teardown: drains только roster-owned детей живого Lead; чужие дети и чужие родители не трогаются. | `agent-team/src/roster.ts:221-234`, `:241-243`; `packages/subagent/subagent/src/index.ts:349-363` | verified |
| B-22 | Disposal: закрытие admission → settle допущенных creations и dispatches → drains, всё в пределах `disposalTimeoutMs`. | `agent-team/src/index.ts:252-267`; `lifecycle.ts:44-64`, `:71-86` | verified |
| B-23 | Invariant companion применяет кандидата к committed prefix и отвергает append через throw из `internal/dispatch`. | `agent-team/src/invariant.ts:20-32`; `packages/core/session/src/index.ts:759-761`; `session-title/src/invariant.ts:66-67` | verified |
| B-24 | Ни один `cordis*.yml` чекаута не монтирует `agent-team/invariant`; сервис `invariants` монтируется только бандлом `sdk-minimal`. | grep `'/invariant'` по всем `cordis*.yml`; `packages/bundle/sdk-minimal/cordis.patch.yml:107-119`; `agent-team/package.json` (exports `./invariant`) | verified |
| B-25 | Активность invariant companion в живом web-профиле не подтверждена. | см. §5 п.1 (разрешённая композиция не читалась) | unverified |
| B-26 | Task CAS отвергает устаревшую revision, а owner/Lead — единственные, кто может менять задачу. | `agent-team/src/task-board.ts:115-126` | verified |
| B-27 | DAG задач отвергает self, duplicate, missing и cycle полным обходом. | `agent-team/src/task-graph.ts:26-68` | verified |
| B-28 | `writeScopes` нормализуются и дедуплицируются, а пересечение даёт только предупреждение против задач в `in_progress`. | `agent-team/src/task-board.ts:234-237`; `validation.ts:26-34`; `task-view.ts:43-49` | verified |
| B-29 | Девять Team-tools регистрируются в точном Agent-scope и снимаются при `agent/disposed`; role enforcement — в домене. | `tool-agent-team/src/index.ts:164`, `:402-422`; `agent-team/src/roster.ts:206`, `:251-253` | verified |
| B-30 | Policy запрещает создавать Team без явной просьбы пользователя. | `tool-agent-team/src/index.ts:31` | verified |
| B-31 | В MyWork ровно 16 `TaskState`, три из них терминальны. | `packages/contracts/src/task.ts:11-63`, `:66` | verified |
| B-32 | Контракт записывает authority split: TaskGraph владеет description/dependencies/readiness/priority/role requirement/final completion, MyWork — attempt/lease/fence/reviews/git refs/audit. | `packages/contracts/src/taskgraph.ts:9-14` | verified |
| B-33 | Readiness отдаётся графом (`ready`/`blocked`) и никогда не выводится из поля. | `packages/contracts/src/taskgraph.ts:119-126`, `:356`, `:363` | verified |
| B-34 | `planSchedulerTick` — чистая синхронная функция; в файле нет `Date.now`, `Math.random`, `async`, `await`, `process.` и динамических импортов. | `packages/core/src/scheduler.ts:296-333`; grep по файлу — совпадений нет (exit 1) | verified |
| B-35 | Тики сериализованы цепочкой обещаний: kick не решает против состояния, которое использует другой тик. | `packages/scheduler/src/service.ts:19-20`, `:195-196`, `:280-287` | verified |
| B-36 | Runtime делает startup reconcile, event kicks и периодический safety reconcile. | `packages/scheduler/src/service.ts:227-238`, `:256-264`, `:289-299` | verified |
| B-37 | Планировщик не делает claim: он передаёт admission в порт, которым владеет §9-сага. | `packages/scheduler/src/service.ts:105-120` | verified |
| B-38 | Сюита планировщика запрещает порт модели: «the scheduler holds no model port». | `tests/scheduler.test.mjs:921`; прогон 83 pass / 0 fail, exit 0 | verified |
| B-39 | Settlement проверяет fence против **текущего токена задачи**, затем controller epoch, и только потом сверяет с копией попытки. | `packages/execution/src/service.ts:405-429` | verified |
| B-40 | Claim — пятишаговая журналируемая сага `intent→claim→attempt→projection→complete`, intent коммитится до касания графа. | `packages/execution/src/service.ts:165-166`, `:11-14`, `:671-693` | verified |
| B-41 | Аллокатор fence монотонен, а БД отвергает понижение токена. | `packages/execution/src/store.ts:289-319`; `tests/claim-saga.test.mjs:513` | verified |
| B-42 | Recovery не разрешает сагу без доказательств и не отзывает чужой живой lease. | `tests/claim-saga.test.mjs:536`, `:572`, `:599`, `:658`; `execution/src/store.ts:327-341` | verified |
| B-43 | Лидерство контроллера — CAS с монотонной эпохой; `holdsLeadership` требует instance **и** epoch. | `packages/lease/src/lease.ts:120-192`, `:292-303` | verified |
| B-44 | Два контроллера на одном файле: только один является писателем в любой момент (тест существует). | `tests/lease.test.mjs:125`, `:380`, `:455` | verified |
| B-45 | В MyWork нет ни peer mailbox, ни coordination-модуля. | grep `mailbox|Mailbox|PeerMessage|coordination|Coordination` по `packages/**/*.ts` — совпадений нет (exit 1) | verified |
| B-46 | MyWork уже имеет transactional outbox и inbox dedup с `applyOnce(consumer, eventId)`. | `packages/storage/src/outbox.ts:2`; `inbox.ts:51-73` | verified |
| B-47 | `AgentRuntimePort` — ровно `start/resume/status/stop/events`, и `stop` не разрушает сессию-доказательство. | `packages/contracts/src/agent-runtime.ts:223-258` | verified |
| B-48 | Rollover сохраняет attempt и чеканит новую сессию; `sameAttempt` отличает продолжение от нового attempt. | `packages/core/src/session.ts:11`, `:969`, `:1025-1026` | verified |
| B-49 | `dependency-result` — не mandatory и не instruction, имеет собственный bucket и лимит токенов. | `packages/contracts/src/context.ts:108-129`, `:452-456`, `:476-477` | verified |
| B-50 | Boundary-тест MyWork не запрещает `@deepseek-ai/dsh-*` (кроме cordis) и не сканирует `scheduler`/`planner`. | `tests/boundaries.test.mjs:17-25`, `:111-124`, `:127-133`; grep `scheduler|planner|memory-native|beads-adapter` — совпадений нет | verified |
| B-51 | Scheduler в resident controller не смонтирован; конкурентность двух контроллеров на пути scheduler→admission не проверялась. | `.work/reports/MW-014-scheduler.md:204` (§7 п.4), `:212` (§7 п.12) | verified |
| B-52 | Фазовые потолки `maxConcurrentLlm`/`maxHeavyTools` в дереве не исполняет никто. | `.work/reports/MW-014-scheduler.md:208` (§7 п.8) | verified |
| B-53 | Отклонённый поздний результат не оставляет audit-строки. | `.work/reports/MW-012-attempt-saga.md:234` (§8 п.7) | verified |
| B-54 | Write-intent отсутствует в `Task`, `Plan` и `Attempt` MyWork. | чтение `packages/contracts/src/task.ts`, `plan.ts`, `attempt.ts` — поля нет | verified |
| B-55 | §42-строка «Write conflicts: можно усилить на Attempt/Plan» описывает не усиление, а новую функциональность. | §42 документа + B-54 | verified |
| B-56 | §42-строка «Install: следует повторить bundle pattern» устарела: MyWork уже публикует бандл `@dsh-mywork/controller`, и его форма проверяется end-to-end. | `packages/controller/cordis.patch.yml:12-14`; `scripts/verify-profile.mjs:27`, `:188-191`, `:210-212` | verified |
| B-57 | §11 «в текущем MyWork отдельный peer mailbox не найден» подтверждается, но durability-примитив для него уже существует (outbox + inbox dedup). | B-45, B-46 | verified |
