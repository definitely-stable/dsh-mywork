# Поток A · Board: модель, проекция, DnD-семантика, lanes v0.3 и legacy-cutover

**Вердикт потока:** девять зон и layout-знание (`grid-3x3`, `strip-horizontal`, 1100 px) действительно зашиты в domain-контракт, `applyDropIntent` действительно не может ни сменить `TaskState`, ни изменить зону (не «трудно», а невозможно: `accepted=1` из 9 зон подтверждён тестом `tests/board.test.mjs:484`), а предложенные §6 semantic lanes v0.3 ломают минимум 8 существующих утверждений `tests/board.test.mjs` и прямо противоречат приёмке MW-049 («ровно девять панелей», порог 1100 px) и MW-050 («подсвечивает только легальные цели»); числа MW-054 про леджер **опровергнуты фактами** (воркспейс `47b14762` — это и есть `H:\Repo\DSH-MyWork`, в нём 52 карточки, из них 19 `done`, а не 6; `3fc33afb` содержит 3 карточки, а не 35, и отсутствует в реестре воркспейсов), а «второй исполнитель» из `.work/EXECUTION-PLAN.md:125` — **не существует в установленной 0.4.3**: ключи `autoRun*` в профиле мёртвые, подстрока `autoRun` не встречается ни в `src/**`, ни в собранном бандле.

Срез: MyWork HEAD `0c657ae1434202865bd330f0eeaf2b60eb78f6d4` (не менялся за мою работу). DSH HEAD `c7c4c725c7889abfdb46fcdd78b14940232940cf`. Легаси-доска: `@linxin666/dsh-client-ui-task-board@0.4.3` (в пакете 55 файлов `src/**`, 53 из них `.ts`/`.tsx`), строка профиля `web-ui-task-board` в `C:\Users\Dmitry\.dsh\profiles\web\cordis.patch.yml:20-33`.

**Замечание о состоянии дерева.** На старте моей работы `git status --porcelain` давал ` M pnpm-lock.yaml`; к концу прохода дерево **чистое**, а `pnpm-lock.yaml` имеет mtime `2026-09-26 22:10:16`. Я этот файл не трогал (все мои команды — чтение; записан ровно один файл — этот отчёт, и он лежит под `.gitignore`-правилом `/.work/`). Значит lockfile изменил кто-то другой из участников кампании или внешний процесс. Для финального прогона `pnpm run check` это существенно: состояние lockfile за время кампании менялось.

---

## 1. Что проверено и как

| # | Утверждение | Как проверял | Результат |
|---|---|---|---|
| 1 | Репозиторий и ревизия не сдвинулись | `git rev-parse HEAD` → `0c657ae1…`; `git status --porcelain` → ` M pnpm-lock.yaml` (exit 0) | совпадает с брифингом §1 |
| 2 | Девять зон в domain-контракте | `packages/contracts/src/board.ts:26-44`, `:53-63` | подтверждено |
| 3 | Rows 3×3 в контракте | `packages/contracts/src/board.ts:47`, `:66-76` (`intake/active/terminal`) | подтверждено |
| 4 | `grid-3x3`\|`strip-horizontal` и порог 1100 px в контракте | `packages/contracts/src/board.ts:126`, `:129`, `:132` | подтверждено |
| 5 | Шестнадцать `TaskState` | `packages/contracts/src/task.ts:11-63`; тест `tests/board.test.mjs:62` (`TASK_STATES.length === 16`) | подтверждено |
| 6 | Полный маппинг state→зона | `packages/contracts/src/board.ts:102-119` (16 записей) + `packages/core/src/board.ts:44-46` | подтверждено; `needs-attention → blocked` |
| 7 | `idea.ts` в контрактах и ядре существует | `glob **/*idea*` по репозиторию → найден ровно один файл: `.work/reports/MW-043-idea-bank.md` | **опровергнуто: файлов нет** |
| 8 | Сущность `Idea` в коде | `Select-String 'Idea|IdeaBank|ideaId'` по `packages/**`,`tests/**` (без `node_modules`/`dist`/`lib`) → 5 совпадений, все — комментарии в `board.ts`/`board.test.mjs` | **опровергнуто: сущности нет** |
| 9 | Строка authority `idea.bank` | `Select-String 'idea'` по `packages/contracts/src/authority.ts` → 0 совпадений | **опровергнуто: строки нет** |
| 10 | `applyDropIntent` сохраняет `zone == projection(exactState)` | `packages/core/src/board.ts:521-539` | подтверждено |
| 11 | `applyDropIntent` не меняет `TaskState` | `packages/core/src/board.ts:552-557` (spread `...placement`, меняются только `zone`, `order`, `columnRevision`) | подтверждено |
| 12 | Через `applyDropIntent` принимается ровно один (свой) drop из девяти | `tests/board.test.mjs:452-484`, ключевая строка `:484` — `assert.equal(accepted, 1, …)` | подтверждено (сильнее, чем §7) |
| 13 | `legalDropTargets` и `applyDropIntent` согласованы | `packages/core/src/board.ts:161-167` против `:522`; `tests/board.test.mjs:497` | **опровергнуто: взаимно противоречивы** |
| 14 | `PlacementChange.fromZone` достижим | `packages/core/src/board.ts:561` при `:472` и `:522` | **опровергнуто: недостижим** |
| 15 | `assertSinglePlacement` ключует размещение по `(viewId, taskId)` | контракт `packages/contracts/src/board.ts:193`; реализация `packages/core/src/board.ts:110` (`Map<TaskId,…>`) | **опровергнуто: ключ только `taskId`** |
| 16 | `OperationMeta.operationId` существует | `packages/contracts/src/operation.ts` (`interface OperationMeta`, поле `operationId`) | подтверждено |
| 17 | Дедупликация по `operationId` в board-пути есть | `Select-String 'legalDropTargets|applyDropIntent|…'` по `packages`,`tests`,`scripts` → у `applyDropIntent`/`legalDropTargets` **нет ни одного продуктового вызова**, только `packages/core/src/index.ts:301-310` (реэкспорт) и тесты | **опровергнуто: реализации нет** |
| 18 | Тесты доски проходят | `node --test tests/board.test.mjs` → `tests 24 / pass 24 / fail 0`, exit 0 | подтверждено |
| 19 | Полный набор переходов | `packages/core/src/task.ts:50-67` | подтверждено; `planned→blocked`, `ready→blocked` есть |
| 20 | MW-042 фиксирует `(viewId, zone)` как ключ ревизии | `.work/reports/MW-042-board-projection.md:66` | подтверждено |
| 21 | MW-042 сознательно оставил `applyDropIntent` без связки с `transitionTask` | `.work/reports/MW-042-board-projection.md:164` (п. 8 ограничений) | подтверждено |
| 22 | MW-043 (`Idea Bank`) выполнен | `.work/reports/MW-043-idea-bank.md:3` — **Статус: BLOCKED**; `:106` — «Файлы `idea.ts` / `idea.test.mjs` … нет ни одного» | **опровергнуто: карточка заблокирована** |
| 23 | Число карточек легаси-леджера | экстрактор `ConvertFrom-Json` по `ledger-v2.json` (`schemaVersion 3`, `revision 324`, SHA256 `F988BF93…`): `tasks[55]` | 55 всего, 52 без `archivedAt` |
| 24 | Распределение по статусам | тот же экстрактор | `backlog 34 / done 19 / failed 2`; без архива — `32 / 19 / 1` = 52 |
| 25 | Распределение по `workspaceId` | тот же экстрактор | `47b14762…` = **52** (backlog 32, done 19, failed 1); `3fc33afb…` = **3** (backlog 2, failed 1) |
| 26 | Что такое `47b14762` | `C:\Users\Dmitry\.dsh\storages\workspace.json` → `tables.workspaces['47b14762-c848-44e6-a7cc-62f19949566d'].path = "H:\Repo\DSH-MyWork"` | **это и есть воркспейс MyWork** |
| 27 | Что такое `3fc33afb` | тот же файл: отсутствует и в `tables.workspaces`, и в `global.workspaceIds` (8 id) | **осиротевший id, воркспейса нет** |
| 28 | Расписания на карточках | экстрактор: поле `schedule` отсутствует у всех 55; `scheduler-v2.json` = `{"lastTickAt":1790442076557}` | расписаний нет |
| 29 | `autoRunTodo` | `cordis.patch.yml:26-32` — `autoRunTodo: true`, `autoRunPaused: true`, `autoRunMaxConcurrent: 1`, `autoRunMaxRetries: 1`, `autoRunStallMinutes: 30`, `autoRunMaxPerHour: 3`, `autoRunMaxPerDay: 0` | **не выключен** (но paused) |
| 30 | Открытые исполнения в леджере | экстрактор: executions без `endedAt` = **0**; всего 31 исполнение на 22 карточках (`succeeded 20 / failed 11`) | открытых нет |
| 31 | Идемпотентность в легаси-плагине | `ledger-v2.json` → `recentRequests[255]`, поля `{fingerprint, requestId}`; `src/host-routes.ts:211` — `service.apply(parsed.requestId, parsed.action, parsed.initiator)`; `lib/types/protocol.d.ts:114-123` | подтверждено |
| 32 | Подзадачи в леджере | экстрактор: поле `parentId` отсутствует у всех 55 карточек | подзадач в леджере нет |
| 33 | Гейт прав на карточках | экстрактор: `permission = workspace-write` у всех 55; `permissionConfirmedAt` отсутствует у **33** | подтверждено |
| 34 | Описание проекции Agent Teams | `packages/experimental/agent-team/src/projection.ts:1` — «Team state projected incrementally from committed Session events, with a durable-only client view» | подтверждено (детали UI — поток C) |
| 35 | Легаси 0.4.3 регистрирует **нативные слоты**, а не захватывает DOM | `src/client/native-panel.tsx:99-123` — `ctx.slots.inject('sidebar.panellist', …)` (`:106-113`) и `ctx.slots.inject('main', …)` (`:115-119`), key = `TASK_BOARD_PANEL_ID` = `'task-board'` (`src/core/controller.ts:66`), `order: PANEL_ORDER = 20` (`native-panel.tsx:32`, комментарий «Plugins is 0, Schedule 10») | подтверждено |
| 36 | Семантические атрибуты есть, DOM-takeover-маркеров нет | `Select-String` по `src`+`lib`: `data-dsh-panel-entry` 5, `data-dsh-taskboard-view` 6, `data-dsh-plugin` 4; `data-dsh-taskboard-active` **0**, `centerCol` **0** | подтверждено (маркеров нет) |
| 37 | Heartbeat в `dsh-market.com` присутствует и не отключается | `src/client/telemetry.ts:27` (`ENDPOINT = 'https://dsh-market.com/api/telemetry/event'`), `:5-8` (раз в UTC-сутки, анонимный UUID в `localStorage`), `:81` (`if (navigator.webdriver) return`), `:82` (дедуп по дню) | подтверждено |
| 38 | Конфиг-схема 0.4.3 **не содержит** ключей `autoRun*` | `src/index.ts:51-112` — ровно 8 полей: `announceToAgent`, `enabled`, `preventIdleSleep`, `trustedProxyHosts`, `proxyTokenEnv`, `sessionDefaultPermission`, `maxSubtaskDepth`, `teamProvider`; `Select-String 'autoRun'` по `src/**` и по собранному `lib/index.js` → **0 совпадений** | подтверждено |
| 39 | Значит `autoRunTodo`/`autoRunPaused` в профиле — мёртвые ключи | `cordis.patch.yml:26-32` против `src/index.ts:103-112`; плагин при этом смонтирован (брифинг §3: revision 324) | подтверждено |
| 40 | `invariant.ts` — пустой companion-плагин | `src/invariant.ts` (200 байт): `export function apply(): void {}`, комментарий «Provides no assertions» | подтверждено |
| 41 | 0.4.3 регистрирует восемь agent-инструментов доски | `src/host/agent-tools.ts:253,285,335,382,428,476,498,575` — `task_board_set_parent/run/manage/schedule/list/get/create/update` | подтверждено |
| 42 | `.work/EXECUTION-PLAN.md:125` содержит неверное утверждение | «Сейчас он выключен, но 34 backlog-карточки лежат готовыми, и включённый тумблер даст двух исполнителей на один проект» — против п. 38-39 | **опровергнуто** |

Никаких мутаций дерева не делал: worktree не создавал, `.tmp` не использовал, probe-скрипты не писал — все экстракторы леджера выполнялись как inline-выражения `pwsh`, файлы не создавались.

---

## 2. Разбор по разделам документа

### §5. Консолидированный предыдущий анализ Board

**§5.1 — ЧАСТИЧНО.** Список «сохраняем» подтверждён по коду: `BoardView` (`contracts/src/board.ts:175-188`), `BoardPlacement` (`:197-225`), `DropIntent` как request (`:231-249`), per-column revision (`:222`), board revision (`:224`), строковые order keys (`:215`), midpoint + явный renumber (`core/src/board.ts:231`, `:377`, `:407`), `SessionLink` (`:336-347`), `EvidenceSummary` (`:317-328`), typed card commands (`:252-280`), 7 panel-состояний (`:141-166`), exact `TaskState` на карточке (`:208`). **Но пункт «Idea как отдельную сущность, не Task» не подтверждён: сущности `Idea` в дереве нет** (см. §6 ниже и CLAIMS A-03…A-05). Документ сохраняет то, чего не существует.

**§5.2 — ПОДТВЕРЖДЕНО.** «Текущий `BoardZone` жёстко задан» — `contracts/src/board.ts:26-44` + `BOARD_ZONES` `:53-63`; «layout contract знает о `grid-3x3 | strip-horizontal` и threshold 1100 px» — `:126`, `:129`, `:132`; всё это экспортируется из публичного пакета `@dsh-mywork/contracts` (`index.ts` реэкспорт `./board.ts`). Оценка «presentation-specific knowledge в domain/public contract» справедлива. Что это меняет: MW-042 уже принят (DONE) и его приёмка (`MW-042.md:21`) требует «ровно в одну из девяти зон» — то есть v0.3 не может быть «правкой формулировки», это пересмотр принятого контракта.

### §6. Board v0.3: рекомендуемая модель

**§6.1 — ЧАСТИЧНО, с внутренними противоречиями.**
- «Сохраняем все 16 TaskState» — согласуется с кодом (`contracts/src/task.ts:46-63`), и это правильно: сокращение сломало бы `TASK_TRANSITIONS` (`core/src/task.ts:50-67`) и `transitionTask`.
- `type BoardLane` из 7 членов (`ideas, queue, work, review, error, done, closed`) — **противоречит §5.2**, где целевой default view описан как **шесть** элементов («Идеи | Очередь | В работе | На проверке | Ошибка | Готово»), без `closed`. Документ не говорит, что делать с седьмым (`closed`) в default view, кроме «скрыт default view» (`§6.1`, строка 235) — это не то же самое, что отсутствие lane в контракте.
- Таблица маппинга §6.1 (строки 215-233) содержит **17 строк** (Idea + 16 состояний) и в строке `needs-attention` даёт двусмысленное `error/attention в v0.3`, тогда как §6.2 (строка 241) требует детерминированного `needs-attention → error`. Два раздела одного документа предписывают разное.
- Миграция `needs-attention` меняет принятое решение: ADR018 (`decisions.md:148`) относит `blocked` и `needs-attention` к зоне `blocked`, и код это подтверждает (`contracts/src/board.ts:113`, `:118`). §6.1 меняет обе зоны сразу (`blocked → queue`, `needs-attention → error`), то есть **пересматривает ADR018**, но §6 оформлен как «рекомендуемая модель», а не как ADR-замена. В §55 (новые ADR) замены ADR018 нет — там ADR A…F про Agent Teams/coordination.

**§6.2 — ОБОСНОВАНО, но требует сущности.** Тезис «текущий Task не содержит authoritative `originState` для `needs-attention`» проверяем: в `packages/contracts/src/task.ts:75-107` `Task` не имеет ни `originState`, ни `attention`; в `packages/core/src/task.ts:50-67` `needs-attention` — обычное состояние с переходами в `ready/failed/cancelled/superseded`. Значит phase-preserving UX действительно нельзя вывести из `Task`. Предложенный `AttentionState` в коде отсутствует (grep по `AttentionState` — 0 совпадений), и в плане карточки его нет: `NeedsAttentionReason` объявлен (`contracts/src/board.ts:356-381`), а durable записи причины — нет. **Это дефект приёмки MW-050**: «Карточка показывает конкретный NeedsAttentionReason, а не общее „требует внимания"» (`MW-050.md:21`) неисполнимо, потому что причина нигде не хранится.

**§6.3 — ПОДТВЕРЖДЕНО.** «В MyWork `blocked` допустим до active Attempt (`planned/ready → blocked`)» — `packages/core/src/task.ts:52-53` (`planned: ['ready','blocked',…]`, `ready: ['assigned','blocked',…]`). Вывод «отдельная permanent колонка не нужна» логичен, но он **снижает** число зон, а не переносит их: см. §3 (правки к MW-049).

**§6.4 — УСТАРЕЛО ОТНОСИТЕЛЬНО ПЛАНА.** «Default UI: Active / All / Needs attention / Archived» — в карточках плана таких представлений нет: MW-049 знает `grid-3x3`, `strip-horizontal` и `list` (`MW-049.md:18,21`), MW-050 — `saved views` с density/layout/фильтрами/сортировкой (`MW-050.md:21`). Понятия All/Needs attention/Archived ни в одну приёмку не попали.

### §7. Drag-and-drop: архитектурная корректировка

**ПОДТВЕРЖДЕНО и одновременно НЕДООЦЕНЕНО.** Строка 269 документа: «последний обязан сохранять `placement.zone == projection(exactState)` и сам TaskState не меняет» — точно соответствует `packages/core/src/board.ts:521-539` и `:552-557`. Но следствие сильнее, чем «настоящий cross-column drag нельзя честно реализовать только через BoardPlacement»:

1. В успешном вызове **`fromZone == toZone == placement.zone`** всегда: `:472` требует `fromZone === placement.zone`; `:522` допускает `toZone` только как `expectedZone` (== `projectTaskZone(exactState)`) или как `placement.zone`; при инварианте `zone == projectTaskZone(exactState)` оба варианта равны текущей зоне. Значит `applyDropIntent` — не «reorder + ограниченный rezone», а **чистый reorder**.
2. Поле `PlacementChange.fromZone` (`core/src/board.ts:438`) **недостижимо**: `:561` записывает его только при `intent.fromZone !== intent.toZone`, что невозможно. Мёртвое поле в публичном результате.
3. `legalDropTargets('ready')` возвращает `['ready','blocked','cancelled']` (`tests/board.test.mjs:179`), но `applyDropIntent` с `toZone: 'blocked'` вернёт `TASK_CONFLICT` (`:522`). Хуже: **отказ сам рекламирует недостижимые цели** — `:533` кладёт `legalTargets: [...legalDropTargets(placement.exactState)]` в `details`, и `tests/board.test.mjs:497` это фиксирует как ожидаемое поведение. То есть противоречие не «недосмотр», а закреплено тестом.
4. Приёмка MW-050 «DnD … подсвечивает только легальные цели» (`MW-050.md:21`) неисполнима: подсветка по `legalDropTargets` пообещает пользователю три зоны, а drop примет одну.

**Что это меняет:** §7 прав, но предлагаемое им деление (`board.reorder` — presentation-only, `semantic gesture` — domain command) требует **двух** новых кусков, которых нет ни в §56, ни в MW-050: (а) резолвер `DropIntent → MyWorkCommand` (сейчас 0 продуктовых вызовов `applyDropIntent`, см. §1 п. 17), (б) явное правило, что после доменной команды проекция пересобирается, а placement переезжает не «через applyDropIntent», а пересчётом. Пункт `board.move` в `CARD_COMMANDS` (`contracts/src/board.ts:268`) при этом описывается как «Единственная команда, которая пишет placement» — и она же не реализована нигде.

### §18. Web projection Agent Teams

**ПОДТВЕРЖДЕНО ЧАСТИЧНО, детали не мои.** `packages/experimental/agent-team/src/projection.ts:1` действительно описывает проект как `ProjectionDefinition`, построенную инкрементально из committed Session events, с durable-only клиентским представлением. Это подтверждает рамку §18 «durable facts + live overlays». Пункты про «не делает refresh polling», «mailbox-only events не публикуют лишний frame», «показывает projection failure рядом с последним валидным состоянием» я **не проверял** — это зона потока C (DSH-платформа). Что важно для Board: §18 сам запрещает помещать MyWork Board в `SessionProjection` (строка 582) — и это согласуется с §19.

### §19. Правильный Web data path MyWork

**ОТСУТСТВУЕТ В ПЛАНЕ.** Цепочка `Host Read Model → unary snapshot + watch stream → Client Store → Slots/UI` (строки 590-606) не имеет ни одного артефакта в дереве: `Select-String 'BoardSnapshot|BoardCard|BoardReadService|BoardWatchRequest|BoardStore|@Remote'` по `packages/**`, `tests/**`, `.work/architecture/**`, `.work/reports/**` даёт **одно** совпадение — `MW-001-target-capabilities.md:219` (упоминание `TaskBoardSnapshot` чужого плагина). Пакета `web`/`client-ui` не существует (в `packages/` 12 каталогов, ни одного UI). Требование «Browser не хранит canonical TaskState» (строка 608) не нарушено ровно потому, что браузерной части ещё нет. Единственный формальный носитель этого плана — карточка MW-048 (`MW-048.md:18`), и она `planned` без отчёта.

### §21. Browser mutations только через domain commands

**ЧАСТИЧНО, с расхождением словаря.** Запрет «нельзя давать Web API `setTaskState`» согласуется с кодом: `transitionTask` требует `TaskTransitionCommand` с ревизией и `activeAttemptId` (`core/src/task.ts:70-83`). Но список команд в §21 (строки 669-678) **не совпадает** с `CARD_COMMANDS` (`contracts/src/board.ts:271-280`): в документе `board.reorder`, `attempt.stop`, `attention.resolve`; в коде `board.move`, `task.stop-and-cancel`, `task.resolve-attention`. §56 (строка 1492) требует «`board.move` уточнить/разделить на reorder vs semantic command» — это правильная правка, но она затрагивает `CARD_COMMANDS` и тест `tests/board.test.mjs:617` (`CARD_COMMANDS.includes('board.move')`), чего в §56 не названо. Также §21 требует «Каждый command несёт expected revision/correlation/actor context»: `OperationMeta` даёт `operationId`, `correlationId`, `expectedRevision`, `controllerEpoch` — но `actor` в контракте отсутствует вовсе.

### §22. Native DSH Web Surface

**НЕ ПРОТИВОРЕЧИТ КОДУ, НО НЕ РЕАЛИЗОВАНО В MyWork.** В MyWork нет клиентского бандла, `dsh.client`-метаданных и слотов (см. §19). Формально это «ОТСУТСТВУЕТ В ПЛАНЕ» по факту и «ПОДТВЕРЖДЕНО» по цели: MW-048 (`MW-048.md:18,21`) описывает ровно этот путь — `exports["./client"]`, манифест `dsh.client` (platform web), слоты `main` (key `mywork`) и `sidebar.panellist` (id `mywork`), навигация через `ctx.layout.selectPanel`, мост токенов `--dsw-*` → `--mw-*`. Совпадение разделов §22 и MW-048 почти дословное (это ожидаемо: MW-048 сгенерирован из той же архитектуры).

### §23. Slot discipline

**ПОДТВЕРЖДЕНО КАК ПРАВИЛО, НЕ ПРОВЕРЕНО В КОДЕ.** В MyWork нечего проверять (нет компонентов). Одно правило стоит отметить как исполнимое уже сейчас: «feature package не импортирует runtime component другой feature package» — в MyWork это уже работает на уровне слоёв, и `tests/boundaries.test.mjs` его охраняет: `Select-String` показал тесты на импорты `board.ts`/`theme.ts` в обоих пакетах и запрет `react`/`node:http`/DSH/`bd` (см. MW-042 §4.5, строка 148 отчёта). Для будущего `packages/web` потребуется **отдельный** boundary-тест: текущие allow-list тесты смотрят только `contracts`/`core`, и клиентский пакет в них не входит — иначе запрет на value-импорт чужого плагина (`MW-048.md:21`) останется декларацией.

### §47. Roster/Agents UI MyWork

**КОНТРАКТЫ УЖЕ ЕСТЬ (в отличие от того, что можно прочитать в §47 как «надо взять»); ОТСУТСТВУЕТ ТОЛЬКО UI И КАРТОЧКА.** Первая редакция этого отчёта утверждала обратное — проверка `Select-String 'AgentIdentity|AgentInstance'` по `packages/**`,`tests/**` даёт **63 совпадения**, и это исправлено. Фактически: `AgentIdentity` (`packages/contracts/src/team.ts:229`), `AgentBlueprint` (`:194`), `AgentInstance` (`:335`), `AgentInstanceState` + `AGENT_INSTANCE_STATES` + `AGENT_INSTANCE_ACTIVE_STATES` (`:297-330`), `PoolLimits`/`RoleLimits`/`WorkspaceLimits` (`:349-363`), `AgentInstanceId` (`ids.ts:33`). §47 перечисляет `role`, `blueprint revision`, `current AgentInstance state`, `pool/resource state` — всё это в контрактах **есть**. Не хватает: (а) operational view как UI (нет `packages/web`), (б) `scheduler.ts:270` уже потребляет `AgentIdentity`, то есть связь scheduler↔roster объявлена, (в) карточки, которая бы требовала роустер-панель, в плане нет — MW-053 говорит о теме/доступности/режимах раскладки, MW-047 — о backend-проекции. Вывод для Board: `§47` — не пробел контрактов, а пробел планирования UI; это меняет приоритет: роустер-панель дешевле, чем предполагает документ. Для Board существенно другое: `BoardPlacement.subState` (`contracts/src/board.ts:210`) обещает «finer state behind the zone (attempt, review, or idea state)», но `subState` встречается в дереве **ровно один раз** — в самой декларации; производителя нет. Это мёртвое поле контракта Board (второе после `fromZone` и третье, если считать зону `ideas` без сущности).

### §48. Session navigation

**ЧАСТИЧНО ПОДТВЕРЖДЕНО.** «Board уже имеет `SessionLink`» — верно: `contracts/src/board.ts:336-347` (`sessionId`, `attemptId?`, `roleId?`, `active`, `startedAt`). «Не копировать transcript в MyWork DB» — согласуется с тем, что `SessionLink` содержит только ссылку. Но приёмка MW-050 «Session link открывает реальную DSH-сессию» (`MW-050.md:21`) требует механики навигации, которой нет ни в контракте, ни в карточке MW-050 (объём перечисляет detail panel, но не API перехода). Отдельно: `SessionLink.active` — единственное «живое» поле в статичном контракте, и ни один источник его не обновляет.

### §49. Board read model как агрегат

**ЧАСТИЧНО; агрегат описан, но не объявлен.** Из девяти перечисленных владельцев (строки 1318-1327) в MyWork существуют Task (Task Graph), Attempt/lease, Review, Evidence, Session как ссылка. `BoardCardRevisionSet` (`§49`, строки 1332-1338) в коде **отсутствует** (grep — 0). Что есть: `BoardPlacement.columnRevision` + `boardRevision` (`contracts/src/board.ts:222-224`) и `Task.revision` (`contracts/src/task.ts:89`). То есть «source revisions» сведены к двум числам на карточку, и запрос «против чего отправлять commands» (`§49`, строка 1341) на attempt/review/attention сейчас не имеет ответа. Отдельное расхождение: `§58` даёт другое имя того же набора — `revisions: { task, placement, attempt?, review? }` (без `attention`), тогда как `§49` включает `attention?` и называет поле `placement`. Два раздела одного документа описывают один тип по-разному.

### §50. Board consistency и degraded mode

**ЧАСТИЧНО ОПРОВЕРГНУТО ПО СОСТАВУ.** §50 (строки 1351-1356) перечисляет шесть состояний: `ready, degraded, reconciliation-pending, unavailable, recovery, paused`. В коде `BoardPanelState` (`contracts/src/board.ts:141-166`) — **семь других**: `loading, ready, empty, degraded, unavailable, recovery, paused`. Разница существенна:
- `reconciliation-pending` — не panel state, а **причина** деградации: `DegradedProjection.reason: 'adapter-unavailable' | 'reconciliation-pending' | 'partial-read'` (`contracts/src/board.ts:307`);
- в документе потеряны `loading` и — главное — `empty`, а различие `empty` vs `unavailable` — единственное, ради чего состояния разделены (`contracts/src/board.ts:136-140`, тест `tests/board.test.mjs:598-601`). §56 (строка 1515) и §60 (строка 1681) сохраняют требование «unavailable != empty», но §50 его не называет.
Тезис «не надо притворяться, что один глобальный transaction snapshot всегда существует» (строка 1347) верен и подкреплён тем, что Task Graph — Beads, а placement — MyWork DB (`authority.ts:112-115`: `board.view`/`board.placement` → `mywork-db`, `task.provenance` → `mywork-db`).

### §51. Раздельные revisions domain и placement

**ПОДТВЕРЖДЕНО НА УРОВНЕ КОНТРАКТА, ОТСУТСТВУЕТ НА УРОВНЕ ПОВЕДЕНИЯ.** Второй уровень (`(viewId, lane)` placement revision) реализован: `BoardPlacement.columnRevision` (`contracts/src/board.ts:222`) и проверка CAS в `applyDropIntent` (`core/src/board.ts:482-498`) → `STALE_COLUMN_REVISION`. Первый уровень (`task/attempt/review`) — `Task.revision` (`contracts/src/task.ts:89`, «every accepted transition increments it»). Тезис «Reorder не должен изменять domain task revision» следует из кода: `applyDropIntent` не трогает `exactState` и не возвращает `Task` (`core/src/board.ts:552-557`), и `tests/board.test.mjs:417` фиксирует «the board snapshot does not move». Но обратное («state transition не конфликтует с независимым reorder») **не проверено**: писателей нет, а `boardRevision` в `applyDropIntent` остаётся неизменным (`:552` spread сохраняет старое значение), то есть снапшот-ревизия после move не бампается — кто и когда её двигает, в коде не определено.

### §52. MyWork client stores

**ОТСУТСТВУЕТ В ПЛАНЕ.** `WorkspaceStore`, `BoardStore`, `TaskStore`, `AgentStore` (§52, строки 1379-1406) не объявлены нигде: grep по `BoardStore|WorkspaceStore|TaskStore|AgentStore` — 0 совпадений; пакета `web` нет. Ближайшая привязка — MW-048 (`MW-048.md:18`, externals `dsh-client-store`), но она про подключение чужого store, а не про четыре модели §52. Требование «React component state хранит interaction state, а не business authority» (`§52`, строка 1408; `§62`, строка 1718) — верное и проверяемое только на будущем UI.

### §53. dsh-web/сторонний Task Board

**ПОДТВЕРЖДЕНО ПО СОСТАВУ ЧУЖОГО ПЛАГИНА.** «Нельзя переносить собственный task ledger authority / runner / scheduler / TaskStatus / auto-claim / session-reuse ownership» — всё перечисленное в плагине реально есть: `src/host-ledger.ts` (58 КБ), `src/host-runner.ts` (26 КБ), `src/core/schedule.ts`, `src/core/tasks.ts:11` (`type TaskStatus = 'backlog' | 'todo' | 'running' | 'done' | 'failed'`), `src/core/session-reuse.ts`. Список «можно взять» (card detail, filters, list, timeline, labels, relations, attachments, activity, keyboard UX) — в плагине есть `src/client/board/TaskDetail.tsx` (29 КБ), `TaskCard.tsx`, `NewTaskModal.tsx` (20 КБ), `locales.ts` (28 КБ, ru нет — только zh/en), `TaskBoard.tsx` (17 КБ). **Одно уточнение к §53:** `TaskStatus` плагина — 5 значений, и в живом леджере встречаются только три (`backlog/done/failed`): `todo` и `running` не использованы ни разу. Это значит, что «второй control plane» фактически **никогда не запускал работу** через карточки `todo` (что согласуется с `autoRunPaused: true`), и переносить из него «rich TaskStatus» нечего.

### §54. Замена стороннего Board только composition-level

**ПОДТВЕРЖДЕНО ФАКТИЧЕСКИ; ОЦЕНКА ГОТОВНОСТИ — НЕТ.** Строка профиля существует ровно одна: `cordis.patch.yml:20-33`, `id: web-ui-task-board`, `plugin: "@linxin666/dsh-client-ui-task-board"`. Пакет установлен в `profiles/web/node_modules/@linxin666/` и объявлен в `profiles/web/package.json:5` (`^0.4.3`). То есть «CSS hide недостаточно» верно конструктивно: ledger, runner и scheduler живут в **host**-части того же пакета (`src/host-ledger.ts`, `src/host-runner.ts`, `src/host-service.ts`, `src/host-routes.ts` — всего 5 host-модулей, ~136 КБ исходников), и пока строка `web-ui-task-board` включена, они монтируются независимо от того, отрисован ли UI. Обратная сторона: MW-054 (`MW-054.md:18`) уже учитывает это («после cutover строка web-ui-task-board убирается из профиля»), то есть §54 в плане покрыт — **но только в части disable**; «enable MyWork bundle» не покрыто, потому что MyWork-бандла не существует (MW-048 `planned`).

**Важное уточнение к §0.3/ADR021 (по запросу Lead, проверено по исходникам 0.4.3).** Факты плана, описывающие легаси-доску как «DOM-наблюдатель с инъекцией в центральную колонку», относятся к другой версии плагина. Установленная 0.4.3 работает **через официальные слоты**: `src/client/native-panel.tsx:1-18` («The board is an official-style center-column panel, not a DOM takeover») и `:99-123` (`ctx.slots.inject('sidebar.panellist', …)`, `ctx.slots.inject('main', …)`, `key = TASK_BOARD_PANEL_ID = 'task-board'` из `src/core/controller.ts:66`, `order = 20` при «Plugins is 0, Schedule 10» — `native-panel.tsx:32`). Маркеров захвата DOM в пакете нет: `data-dsh-taskboard-active` — 0 совпадений, `centerCol` — 0 совпадений. Есть только семантические якоря для скинов: `data-dsh-panel-entry` (5 совпадений), `data-dsh-taskboard-view` (6), `data-dsh-plugin` (4). Вывод для плана: аргумент ADR021 «нужен native-путь, а не DOM-patch» **остаётся верным по цели, но перестаёт быть аргументом против легаси** — легаси уже идёт тем самым путём, который MyWork планирует в MW-048. Это ослабляет обоснование «переписать, потому что чужой плагин грязный» и усиливает другое, проверяемое: heartbeat (см. ниже) и владение леджером/runner'ом.

**Осторожно с источником этого вывода: сам пакет 0.4.3 содержит устаревший комментарий.** `src/client/locales.ts:4` описывает «the DOM-injected entry row», тогда как фактическая регистрация — слотовая (`native-panel.tsx`). То есть если поток B/C проверял §0.3/ADR021 по комментариям и README, а не по `native-panel.tsx`, ошибка «DOM-takeover» воспроизводима внутри самого пакета. Рекомендация для плана: любые утверждения о поведении легаси-доски подтверждать файлом-реализацией, а не комментарием (это ровно то правило, которое брифинг §6 п.2 требует от нас, и оно применимо к чужому коду тоже).

**Heartbeat.** §53-контекст «нельзя переносить» стоит дополнить: `src/client/telemetry.ts:27` шлёт ежедневный heartbeat на `https://dsh-market.com/api/telemetry/event` (раз в UTC-сутки на браузер, анонимный UUID в `localStorage`, `:81` — пропуск при `navigator.webdriver`); выключателя в конфиге нет (в `Config`, `src/index.ts:51-112`, поля телеметрии отсутствуют). Это единственный аргумент §53-типа, который 0.4.3 подтверждает в полном объёме и который **не** устарел.

**`autoRunTodo`/`autoRunPaused` — мёртвая конфигурация (опровергает `.work/EXECUTION-PLAN.md:125`).** Профиль содержит семь ключей авто-запуска (`cordis.patch.yml:26-32`: `autoRunTodo: true`, `autoRunPaused: true`, `autoRunMaxConcurrent: 1`, `autoRunMaxRetries: 1`, `autoRunStallMinutes: 30`, `autoRunMaxPerHour: 3`, `autoRunMaxPerDay: 0`). В установленной 0.4.3 подстрока `autoRun` **не встречается ни разу** — ни в 55 файлах `src/**` (53 из них `.ts`/`.tsx`), ни в собранном `lib/index.js`. Схема `Config` (`src/index.ts:51-112`) объявляет ровно восемь полей (`announceToAgent`, `enabled`, `preventIdleSleep`, `trustedProxyHosts`, `proxyTokenEnv`, `sessionDefaultPermission`, `maxSubtaskDepth`, `teamProvider`) и ни одного `autoRun*`. Плагин при этом смонтирован и отдаёт revision 324 (брифинг §3), то есть лишние ключи не ломают загрузку — они просто не читаются. Следствия, которые надо внести в план:
1. Формулировка MW-054 «Перед cutover проверяется, что legacy autoRunTodo выключен» **неисполнима буквально**: в 0.4.3 такого параметра нет, проверять нечего. Требование надо переписать как «в профиле отсутствуют ключи `autoRun*` и не осталось per-task расписаний».
2. Утверждение `.work/EXECUTION-PLAN.md:125` («Сейчас он выключен, но 34 backlog-карточки лежат готовыми, и включённый тумблер даст двух исполнителей на один проект») неверно трижды: `autoRunTodo` в профиле **включён** (`true`), он **не читается** плагином, и «тумблер» в 0.4.3 не существует. Снятие «паузы» (`autoRunPaused: false`) не запустит ничего.
3. Реальный остаточный путь автоматического запуска в 0.4.3 — **per-task расписание** (`src/core/tasks.ts:242-243` — `schedule?: ScheduleRule`) плюс agent-инструменты (`src/host/agent-tools.ts:285` `task_board_run`, `:382` `task_board_schedule`) плюс cron. В живом леджере расписаний **нет ни на одной из 55 карточек** (поле `schedule` отсутствует у всех; `scheduler-v2.json` = `{"lastTickAt":1790442076557}`), но инструменты доступны любой сессии — то есть «второй исполнитель» возможен не по тумблеру, а по вызову инструмента или по cron-записи, которую кто-то создаст позже.
4. Для спецификации «pgrep по владельцу»: 34 backlog-карточки в воркспейсе MyWork (`47b14762`) действительно лежат готовыми, и это по-прежнему риск — но он реализуется через `task_board_run`/`task_board_schedule`, а не через `autoRunTodo`.

### §56. File-by-file изменения MyWork (board-часть)

**СОГЛАСУЕТСЯ С КОДОМ, НО НЕПОЛНО.** Все пять пунктов по `contracts/src/board.ts` (строки 1488-1493) и три по `core/src/board.ts` (1497-1502) попадают в реальные строки (см. §1). Пробелы:
- «убрать 3×3 layout semantics из domain» — не сказано, **куда** их перенести. Если в `packages/web` (которого нет), то `BOARD_STRIP_MAX_WIDTH_PX` (`contracts/src/board.ts:132`) сначала переезжает в несуществующий пакет, и MW-049 теряет константу, которую её приёмка требует проверять.
- Не упомянута `BOARD_ZONE_ROWS` (`contracts/src/board.ts:66-76`) — таблица, которая целиком кодирует 3×3. Она не «layout semantics», а row semantics, но живёт в том же файле и используется тестом `tests/board.test.mjs:48-52`.
- Не упомянут `BOARD_ZONE_ICONS` (`:82-92`) — 9 иконок по зонам; при 7 lane'ах одна иконка (`ban` для `blocked`) исчезает, а `circle-slash` для `cancelled` переименовывается. Мелочь, но она входит в приёмку MW-049 «Заголовок каждой зоны несёт иконку».
- По `tests/board.test.mjs` (1504-1516) список acceptance не совпадает с фактическим составом файла: «closed hidden default» и «blocked Queue» — новые пункты (в файле их нет), а «admission невозможно подделать drag» уже покрыт (`:146-187`) и назван иначе.

### §58. BoardSnapshot concept

**ОТСУТСТВУЕТ В ПЛАНЕ + внутреннее расхождение с §49.** `BoardSnapshot` (§58, строки 1612-1621) и `BoardCard` (1626-1648) не объявлены нигде. Дополнительно: `BoardSnapshot.state: 'ready' | 'degraded' | 'recovery' | 'paused'` — **четыре** состояния, тогда как §50 требует шесть, а код (`BOARD_PANEL_STATES`) — семь. Три раздела одного документа называют три разных набора. `BoardCard.revisions` (§58) снова без `attention`, хотя §49 её включает. `BoardCard.lane: BoardLane` — тип из §6.1, то есть §58 уже написан под v0.3, которого нет. Вывод: §58 — эскиз, а не контракт; как приёмка не годится.

### §59. Command concept

**СОГЛАСУЕТСЯ ПО ДУХУ, РАСХОДИТСЯ ПО ИМЕНАМ.** `MyWorkCommand` (§59, строки 1657-1666) содержит `board.reorder`, тогда как код знает `board.move` (`contracts/src/board.ts:268`). §21 перечисляет третий набор (`board.reorder` + `attention.resolve`). Итого в документе три разных списка команд (§21, §56, §59), и ни один не совпадает с `CARD_COMMANDS`. Требование «Browser не передаёт arbitrary target state» (строка 1668) — верное и в коде уже обеспечено типом (`CardCommand` — закрытый union, `:252-280`).

### §60. Acceptance gate: Board v0.3 до UI

**ПРАВИЛЬНЫЙ ПО СМЫСЛУ, НЕИСПОЛНИМЫЙ КАК ЕСТЬ.** Из десяти пунктов (1676-1685) сегодня не выполнены минимум семь: «semantic lane contract» (нет типа `BoardLane`), «Host BoardReadService» (нет), «Host CommandService» (нет), «Remote API» (нет), «current DSH compatibility tests» (нет), «placement concurrency» (есть только чистая функция CAS в `applyDropIntent`, писателя нет), «command/reorder boundary» (резолвера нет). Выполнены: «exact TaskState сохранён» (`contracts/src/board.ts:208`, тест `:59-88`), «no second task authority» (`authority.ts:112-115` + `projection: true`), частично «degraded/recovery snapshot semantics» (типы есть, сервиса нет). Гейт сформулирован раньше, чем определено, **чем** его закрывать (нет карточки на `BoardReadService`/`CommandService` — MW-047 даёт `TaskBoardPort`, но не эти два сервиса).

### §62. Acceptance gate: Web package

**СОГЛАСУЕТСЯ С MW-048, НО С ОДНИМ ПРОТИВОРЕЧИЕМ.** Семь из десяти пунктов (1709-1718) дословно совпадают с приёмкой MW-048 (`MW-048.md:21`): native `dsh.client`, `sidebar.panellist` + `main`, no direct DOM mutation, effect-clean unload/HMR, reconnect → authoritative snapshot, no independent TaskState store, accessibility/keyboard. Но «stream loss → degraded/recovering, а не fake empty» (§62, строка 1714) требует от клиента различать `degraded` и `empty`, а §50 этот набор состояний описал неверно (без `empty`). Также пункт «commands с expected revisions» требует, чтобы клиент знал **какую** ревизию слать: без `BoardCardRevisionSet` (§49) у него есть только `columnRevision`/`boardRevision` из `BoardPlacement`, и это ровно та причина, по которой §49 и §58 вводят набор ревизий.

### §71. KEEP / CHANGE / ADD / DO NOT ADOPT (board-строки)

**СОГЛАСУЕТСЯ С КОДОМ, КРОМЕ ОДНОЙ СТРОКИ KEEP.** KEEP-строки подтверждаются: `Board = projection` (`authority.ts:112-115` `projection: true`), `16 TaskState` (`contracts/src/task.ts:46-63`), `exact state chip` (`contracts/src/board.ts:208`), per-lane revision (`:222`), string order keys (`:215`), degraded/unavailable/recovery (`:141-166`). CHANGE-строки соответствуют найденному: «9 fixed zones» (`:53-63`), «3×3 Board contract» (`:66-76`, `:126`, `:132`), «permanent blocked lane» и «permanent cancelled lane» (нужны для `needs-attention`/`superseded` из ADR018:148,151), «`board.move` as semantic rezone» (`:268`). **Строка `Idea separate | KEEP` (строка 1912) неверна**: разделять нечего, сущности нет (`.work/reports/MW-043-idea-bank.md:3,106`), а строка authority `idea.bank`, обещанная ADR019 (`decisions.md:177`), не создана. Это не «KEEP», а «не начато» — и §6.1 ставит `Idea` первой строкой маппинга в lane `ideas`.

### §74. Короткий operational verdict

**ПУНКТ 3 ТРЕБУЕТ ПЕРЕФОРМУЛИРОВКИ, ОСТАЛЬНОЕ ВНЕ BOARD.** «Перевести Board на semantic lanes v0.3» (строка 2050) — единственный board-пункт. По итогам §2: перевод невозможен без одновременного (а) пересмотра ADR018, (б) правки приёмок MW-049/MW-050, (в) решения о `closed`/`empty`, (г) создания `Idea`, которого нет. Как однострочный вердикт это скрывает объём работ; см. §3 ниже. Пункты 1, 2, 4-8 — вне зоны Board (проверяют потоки B/C).

---

## 3. Правки к плану MyWork

Ниже — минимальный набор, сгруппированный по карточкам. Оценка усилия: S ≤ 0.5 дня, M ≤ 2 дня, L > 2 дня (для одной сессии-исполнителя в режиме «одна карточка за запуск»).

### 3.1 Блокирующая правка: MW-042 (DONE → переоткрыть как v0.2-bis)

Приёмка MW-042 (`MW-042.md:21`) требует «Каждый из 16 TaskState отображается ровно в одну из девяти зон». Если принимается §6, это утверждение становится ложным. Минимальный набор:

| Файл | Что менять | Почему |
|---|---|---|
| `packages/contracts/src/board.ts:26-63` | переименовать `BoardZone` → `BoardLane`, список 9 → 7 (`ideas, queue, work, review, error, done, closed`); либо сохранить 9 и добавить вложенные lanes | §56:1488 |
| `packages/contracts/src/board.ts:102-119` | новая таблица `LANE_BY_STATE`: `blocked → queue`, `needs-attention → error`, `cancelled/superseded → closed` | §6.1:215-233 |
| `packages/contracts/src/board.ts:66-76` | `BOARD_ZONE_ROWS` удалить или переопределить без 3×3 (решить, что значит «row» для 7 lanes) | §5.2:182 |
| `packages/contracts/src/board.ts:126-132` | перенести `BoardViewMode`/`BOARD_STRIP_MAX_WIDTH_PX` в presentation-пакет (сегодня его нет) либо оставить и явно назвать «UI hint» | §5.2:182, §56:1489 |
| `packages/contracts/src/board.ts:268,279` | развести `board.move` на `board.reorder` (presentation) и сохранить `board.move` только как semantic rezone | §56:1492, §21:677 |
| `packages/core/src/board.ts:44-51` | `projectTaskZone` → `projectTaskLane`; `zoneOfState` сохранить как alias | §56:1497 |
| `packages/core/src/board.ts:161-182` | `legalDropTargets` переписать так, чтобы она возвращала **то, что примет write-путь**, либо удалить и заменить на `legalDropTargets(state)` = `[]`/собственный lane | §7:269-271; иначе приёмка MW-050 неисполнима |
| `packages/core/src/board.ts:499-539` | вынести резолвер `resolveDropIntent(intent, task) → MyWorkCommand \| refusal` — сейчас его нет | §7:275-278 |

**Тесты, которые обязательно упадут при 7 lanes** (`tests/board.test.mjs`, проверено чтением):
- `:36-46` — точный список из девяти зон;
- `:48-52` — `Object.keys(BOARD_ZONE_ROWS)` равен списку зон;
- `:82-85` — множество используемых зон равно всем зонам кроме `ideas` (после объединения `blocked → queue` зона `blocked` перестанет получать состояния; тест придётся переписать, а не «поправить число»);
- `:179` — `deepEqual(legalDropTargets('ready'), ['ready','blocked','cancelled'])`;
- `:182` — `deepEqual(legalDropTargets('planned'), ['backlog','ready','blocked','cancelled'])`;
- `:533` — `taskStatesOfZone('error').length === 2` (станет 3 при `needs-attention → error`);
- `:534` — `taskStatesOfZone('cancelled').length === 2` (зона исчезает);
- `:638-639` — `BOARD_VIEW_MODES` и `1100`, если threshold уезжает из контракта;
- `:55` — иконка каждой зоны (см. `BOARD_ZONE_ICONS`).

Плюс `tests/boundaries.test.mjs:579` — allow-list по именам экспортируемых функций (`projectTaskZone`, `legalDropTargets`, …), переименование его ломает.

**Усилие: M** на контракт+ядро+тесты (≈1.5 дня с учётом переписывания 8 тестов и mutation-проверки, которой требует стиль MW-042 §3.1). **Риск: высокий** — MW-042 принят владельцем, и это пересмотр принятого контракта, а не доработка. Требуется явное решение владельца и новый ADR (замена ADR018), иначе получится «код поменяли, решение осталось прежним» — ровно тот класс расхождения, который MW-042 §5 п.1 уже зафиксировал как дефект формулировки.

### 3.2 MW-049 (сетка 3×3, порог 1100 px) — прямое противоречие

Приёмка (`MW-049.md:21`) требует:
1. «По умолчанию рендерятся ровно девять панелей в сетке 3x3» — противоречит §6.1 (7 lanes) и §71:1921-1922 (`9 fixed zones` → CHANGE, `3×3 Board contract` → CHANGE);
2. «При ширине панели менее 1100 px раскладка переключается на strip-horizontal» — противоречит §5.2:182, где само знание о 1100 px объявлено дефектом;
3. «на пороге минус 1 px раскладка strip-horizontal, на пороге — grid-3x3» — привязано к константе `BOARD_STRIP_MAX_WIDTH_PX` (`contracts/src/board.ts:132`) и к её месту в контракте;
4. «WIP-индикатор отображается, но не блокирует admission» — при переходе на lanes WIP-лимит логичнее вешать на `work`; в §6 WIP-лимитов нет вообще;
5. «На 2000 карточках в DOM не более 1.5× узлов от 1000» — не зависит от lanes, но зависит от того, сколько панелей: 7 панелей против 9 меняют базовое число узлов, а порог 1.5× калиброван под 9.

**Минимальная правка:** переформулировать п.1 как «N панелей по числу lanes контракта, проверяется по `BOARD_LANES.length`», п.2-3 — оставить порог как **UI-константу** и перенести её в `packages/web` (MW-048), а приёмку MW-049 писать против UI-константы, а не против `@dsh-mywork/contracts`; п.4 — добавить явную строку «WIP-лимит — presentation-only, `work` lane, admission не блокируется». **Усилие: S** (правка текста карточки), но она должна быть сделана **до** MW-042-bis, иначе исполнитель MW-042 и исполнитель MW-049 получат противоположные ТЗ.

### 3.3 MW-050 (DnD, bulk, detail panel) — четыре неисполнимых пункта

| Пункт приёмки (`MW-050.md:21`) | Почему неисполним | Минимальная правка |
|---|---|---|
| «DnD … подсвечивает только легальные цели» | `legalDropTargets` рекламирует зоны, которые `applyDropIntent` отвергает (`core/src/board.ts:522` vs `:161-167`, закреплено тестом `tests/board.test.mjs:497`) | либо резолвер `resolveDropIntent` (§3.1), либо `legalDropTargets(state) := [projectTaskZone(state)]` до его появления |
| «Drop в error/blocked/cancelled без выбранной причины отклоняется» | ни «причина», ни её хранение не существуют: `DropIntent` (`contracts/src/board.ts:231-249`) не имеет поля причины; `NeedsAttentionReason` (`:356-381`) — закрытый словарь, но не поле placement | добавить `reason?: NeedsAttentionReason` в `DropIntent`, `reason` в `BoardPlacement` и durable-запись; либо перенести пункт на `NeedsAttentionReason`-чип |
| «Два одинаковых DropIntent с разными operationId не меняют состояние дважды» | идемпотентности нет: `OperationMeta.operationId` объявлен (`operation.ts`), но `applyDropIntent` его игнорирует и **на каждом вызове** инкрементирует `columnRevision` (`core/src/board.ts:556`) | ввести журнал `operationId → результат` на уровне write-пути (аналог есть у легаси: `ledger-v2.json.recentRequests[255]` с `requestId`+`fingerprint`) |
| «Bulk move предлагает только цели, легальные для всех выбранных» | при 16 состояниях пересечение `legalDropTargets` по разнородной выборке почти всегда пусто (`ready → {ready,blocked,cancelled}`, `done → {done}`), то есть bulk move будет предлагать пустой список | определить bulk как «пересечение, а при пустом — только семантические команды (`task.retry`/`task.cancel`)», а не как drag |

Плюс: «Карточка показывает конкретный NeedsAttentionReason» (`MW-050.md:21`) — требует `AttentionState` (§6.2). **Усилие: M** (правка текста S + реализация идемпотентности и reason M).

### 3.4 MW-047 (backend проекции) — согласуется, но с двумя уточнениями

MW-047 (`MW-047.md:18,21`) — самая здоровая карточка потока: требует монотонную `boardRevision` + курсор, SSE-инвалидацию, `DegradedProjection` при недоступности Beads, per-card результат bulk, Null adapter, CAS ревизии колонки, `BoardPanelState`. Уточнения:
1. «Ревизия колонки проверяется CAS: конкурентный move в тот же промежуток оставляет ровно одного победителя» — уже реализовано как **чистая** проверка (`core/src/board.ts:482-498`), но без оптимистической блокировки на запись; в карточке стоит потребовать именно «persist-if-revision-matches» (compare-and-swap в MyWork DB), иначе при двух одновременных запросах оба прочитают ревизию и второй перезапишет первый, а тест на чистой функции этого не поймает.
2. «SSE-кадр не содержит карточек, только revision/projectionRevision/cursor/degraded» — согласуется с `TaskBoardEventPayload` легаси-плагина (`lib/types/protocol.d.ts:44-48`: `revision`, `scheduler`, `power`), то есть паттерн проверен на живом чужом плагине. Стоит зафиксировать это как источник: MyWork не изобретает формат, а воспроизводит работающий.
3. «Курсор» в MW-047 нигде не типизирован: в контрактах нет `Cursor`. Либо ввести (например, `boardRevision` как курсор), либо убрать слово. **Усилие: S**.

### 3.5 MW-048 / MW-052 / MW-053 — мелкие, но обязательные

- **MW-048** — добавить в объём boundary-тест для `packages/web` (сейчас allow-list покрывает только `contracts`/`core`; см. §2/§23). Усилие S.
- **MW-052** — «graph/dependency view, calendar, опциональный timeline», зависимости MW-049/MW-042; при смене модели lanes (7 вместо 9) dependency view надо писать против lane, а не зон. Усилие S (правка текста).
- **MW-053** — «тема, доступность и режимы раскладки»; режимы раскладки = `grid-3x3`/`strip-horizontal` (`contracts/src/board.ts:126`) + порог 1100. Если threshold уезжает из контракта (3.1), MW-053 становится **первой** карточкой, которая этот threshold проверяет в UI. Усилие S.

### 3.6 MW-054 (мастер импорта) — три фактические ошибки и четыре пробела

**Ошибки (опровергнуто леджером):**

| Утверждение MW-054 (`MW-054.md:18,21`) | Факт | Доказательство |
|---|---|---|
| «6 done-карточек лежат в отдельном воркспейсе 47b14762» | `47b14762` — **это воркспейс MyWork** (`H:\Repo\DSH-MyWork`), и в нём **19** `done`, а не 6 | `workspace.json.tables.workspaces['47b14762…'].path`; экстрактор `ledger-v2.json` |
| «35 незавершённых — в 3fc33afb» | в `3fc33afb` — **3** карточки (`backlog 2, failed 1`), и сам id **отсутствует** в реестре воркспейсов (осиротевший) | экстрактор + `workspace.json.global.workspaceIds` (8 id, `3fc33afb` нет) |
| «в реальном леджере эти два критерия совпадают» | не совпадают: критерий «`workspaceId == MyWork`» даёт **52** карточки, включая все 19 `done`; фильтр «не `done`» обязателен и убирает 19 | экстрактор: `47b14762 → backlog 32 / done 19 / failed 1` |

Следствие: **MW-055** (`MW-055.md:21`) требует «Прогон мастера импорта на копии реального ledger **из 41 карточки**» — число 41 = 6 + 35 из ошибочной посылки MW-054. Ни одна из реальных проекций не даёт 41: всего 55, без архива 52, только `47b14762` 52, только не-`done` без архива 33, только `3fc33afb` 3.

**Пробелы:**
1. **`archivedAt` не упомянут.** Правило «`workspaceId == MyWork` И статус не `done`» не исключает архив: 3 карточки имеют `archivedAt` (`3cad0e0a…` failed — как раз та, что в `3fc33afb`, `e5bdbc44…`, `d66573e0…`). При импорте «по правилу MW-054» они попадут в выборку. Нужно добавить «И `archivedAt` отсутствует» и зафиксировать ожидаемое число (52 в `47b14762`, из них 33 не-`done`).
2. **Маппинг статусов не задан.** Легаси знает 5 статусов (`src/core/tasks.ts:11`), MyWork — 16 состояний. Правило «не `done` → импортировать» не говорит, во что превращаются `backlog` (34 карточки) и `failed` (2). Импорт всех как `draft` сделает `bd ready` пустым и «оживит» план, который уже выполнен отчётами в `.work/reports/`. Это надо решать явно, вплоть до «импортировать как `planned` с `dependsOn` на ничего» или «импортировать только как архивную запись без state».
3. **Самореферентность.** Содержимое леджера — это план развития самого MyWork (заголовки `MW-001 … MW-055`, теги `DSH-MyWork`/`00-foundation`, пример — `3cad0e0a…` = «MW-001 · Проверить целевой DSH и контракты интеграций»). Импорт превратит «второй леджер того же плана» в задачи MyWork Board, то есть доска начнёт планировать собственную разработку из импортированной копии. Приёмка MW-054 этого не запрещает, а «origin=imported-legacy + 0 attempts» создаёт ровно ту видимость работы, от которой предостерегает §53.
4. **`permission` не учтён.** У всех 55 карточек `permission: workspace-write`, а `permissionConfirmedAt` отсутствует у 33. MW-054 не говорит, что делать с подтверждением прав при импорте (в легаси-плагине есть отдельный action `confirm-permission`, `protocol.d.ts:107-108`). Если импортировать без подтверждения, 33 карточки сразу получат `permissionPending`-подобное состояние в MyWork; если с подтверждением — MyWork молча унаследует `workspace-write`, обойдя собственный гейт (§33 брифинга про compat gate здесь не при чём, но принцип тот же).

**Что в MW-054 верно и подтверждено:** «Открытый execution блокирует commit» — сейчас вакуумно (0 открытых из 31); «Ни одно legacy-исполнение не превращается в Attempt» — согласуется со структурой (`executions[]` c `sessionId`/`initiatedBy`/`result`/`error`, отдельные id); «архив обязан читаться из файла, а не по HTTP» — подтверждается тем, что ledger и scheduler-файл лежат **вне** плагина (`C:\Users\Dmitry\.dsh\task-board\ledger-v2.json` + `ledger-v2.lock` + `scheduler-v2.json`), то есть доступны файлово; «источник — файл `ledger-v2.json`» — верно, `schemaVersion: 3`.

### 3.7 Общая правка: смена модели зон — это миграция placement-ключей

Ни одна карточка (MW-042/047/049/050/053/054/055) не описывает миграцию **сохранённых** placements при смене модели зон. Между тем `board.placement` — строка authority в MyWork DB (`authority.ts:112`), а `BoardPlacement.zone` хранит имя зоны (`contracts/src/board.ts:203`), и `order` — ключ внутри `(viewId, zone)` (`:176` комментарий). При 9 → 7 зонах:
- `blocked` сливается с `ready`/`backlog` (lane `queue`), `cancelled` → `closed`, `needs-attention` → `error`;
- `order`-ключи двух зон попадают в одну → возможны **равные ключи**, а `boardOrdering` (`core/src/board.ts:339-350`) различает их только по `taskId`, то есть порядок станет произвольным (детерминированным, но не тем, что был у пользователя);
- `columnRevision` двух слитых зон надо свести к одному числу (иначе CAS начнёт отвергать все move'ы).

**Минимальный набор:** миграция `board-placement-lanes-v3` с правилом «merge: max(revision), renumber keys через `renumberKeys(count)` (`core/src/board.ts:407`), сохранив относительный порядок по старому `(zone, order, taskId)`» + тест «до и после миграции последовательность карточек внутри новой lane идентична конкатенации старых зон в порядке чтения». **Усилие: S-M**; **без неё** апгрейд молча перемешает карточки, а `ORDER_RENUMBER_REQUIRED` (`:377-391`) не спасёт, потому что равные ключи он ловит только при вставке, а не при чтении.

### 3.8 Порядок работ и сводная оценка

Правки взаимозависимы, и неверный порядок гарантирует переделку. Предлагаемая последовательность (с учётом того, что критический путь брифинга §3 идёт `042 → 047 → 048 → 049 → 050 → 053 → 055`, а 054 — отдельная ветка):

| Шаг | Что | Карточки/файлы | Усилие | Блокирует |
|---|---|---|---|---|
| 1 | Решение владельца: принимается ли v0.3 (7 lanes) или сохраняется v0.2 (9 зон). Без этого шага шаги 2-4 взаимно противоречивы | решение + ADR-замена ADR018 | S | всё |
| 2 | Если v0.3: правка `contracts/src/board.ts` + `core/src/board.ts` + переписывание 8 тестов | MW-042-bis | M | MW-049, MW-050, MW-052, MW-053 |
| 3 | Резолвер `resolveDropIntent` + приведение `legalDropTargets` в соответствие с write-путём | `core/src/board.ts:161-182`, новый модуль | M | MW-050 |
| 4 | Правка текстов приёмок MW-049/MW-050/MW-053 (lanes, threshold, WIP, bulk, reason) | `.work/tasks/MW-049.md:21`, `MW-050.md:21`, `MW-053.md:21` | S | исполнители UI-карточек |
| 5 | Миграция placement-ключей (merge зон) + тест на сохранение порядка | новая миграция в `packages/storage` | S-M | любой апгрейд с сохранёнными placements |
| 6 | Исправление фактов в MW-054 (числа, `archivedAt`, маппинг статусов, permission) и в `MW-055.md:21` (41 → фактическое) | `.work/tasks/MW-054.md:18,21`, `MW-055.md:21` | S | MW-054, MW-055 |
| 7 | Журнал идемпотентности `operationId` на write-пути | MW-047 | M | MW-050, MW-055 |
| 8 | `AttentionState` (durable причина) либо перенос требования на чип `NeedsAttentionReason` | MW-047/050 | S-M | MW-050 |
| 9 | Backend-проекция (MW-047) как есть | MW-047 | L | MW-048…053 |
| 10 | Импорт леджера | MW-054 | L | MW-055 |

Суммарно по потоку A: **2S-решения + M+M+S+M+S+S-M+M+L+L**. Ключевой вывод: **ни шаг 2, ни шаг 3 не входят ни в одну существующую карточку**, а шаг 5 не входит вообще никуда. То есть переход к v0.3 в текущем плане не имеет исполнителя — карточка MW-042 закрыта (DONE), а MW-049/MW-050 зависят от неё как от выполненной.

### 3.9 Что менять НЕ надо (защита от переусердствования)

Разбирая §56, легко «починить» лишнее. Явно сохранить:
- `ZONE_BY_STATE` как **единственный** источник проекции и обе функции (`projectTaskZone`, `zoneOfState`) — двойная таблица «lane→states» и «state→lane» разошлась бы (сейчас `taskStatesOfZone` выводится из той же таблицы, `core/src/board.ts:71-73`, и это правильно).
- Base-62 midpoint-схему (`core/src/board.ts:231-279`) — она проверена сильнее всего: 1000 вставок с чередованием, обе буквальные стратегии ADR, 19 936 случайных приёмок ревьюером MW-042 (§4.5 отчёта). Менять её при переходе на lanes не нужно и опасно.
- `assertSinglePlacement` как отдельную функцию — но с исправленным ключом (A4-1).
- Отказ от равных order-ключей (`ORDER_RENUMBER_REQUIRED`, `:377-391`) — это защита от «невидимого reorder», и её нельзя заменить авто-перенумерацией «на лету».
- Терминологию `exactState`-чипа — она и есть механизм, которым доска доказывает, что не является state machine.

---

### 3.10 Правка MW-054 и `.work/EXECUTION-PLAN.md:125` по итогам проверки 0.4.3

| Что | Было | Должно быть | Почему |
|---|---|---|---|
| `.work/EXECUTION-PLAN.md:125` | «Перед cutover обязательно проверить, что legacy `autoRunTodo` выключен… Сейчас он выключен, но 34 backlog-карточки лежат готовыми, и включённый тумблер даст двух исполнителей на один проект» | «…проверить, что в записи `web-ui-task-board` нет ключей `autoRun*` и ни на одной карточке нет `schedule.enabled`; в 0.4.3 механизма `autoRunTodo` не существует, поэтому остаточный риск — вызовы `task_board_run`/`task_board_schedule` и cron» | `src/index.ts:51-112`, `Select-String 'autoRun'` → 0; `src/host/agent-tools.ts:285,382`; леджер: `schedule` отсутствует у 55/55 |
| `MW-054.md:18` | «Перед cutover проверяется, что legacy autoRunTodo выключен и расписаний на мигрированных карточках нет, иначе проект получит двух исполнителей» | вторую половину оставить (расписаний действительно нет — проверено), первую заменить на «нет ключей `autoRun*` в профиле» | то же |
| `MW-054.md:18` | «6 done-карточек лежат в отдельном воркспейсе 47b14762, 35 незавершённых — в 3fc33afb» | «в воркспейсе MyWork (`47b14762`) 52 карточки: 32 `backlog`, 19 `done`, 1 `failed`; в осиротевшем `3fc33afb` — 3 карточки (MW-001 `failed` + MW-027 и MW-035, обе архивированы); правило eligible = `workspaceId == MyWork` И `status != done` И `archivedAt` отсутствует → 33 карточки» | экстрактор леджера + `storages/workspace.json` |
| `MW-055.md:21` | «Прогон мастера импорта на копии реального ledger из 41 карточки» | «из 55 карточек (52 без архива)» либо явно «33 eligible» | 41 = 6 + 35 из ошибочной посылки MW-054 |
| `MW-054.md:21` | «Cutover не начинается, пока legacy autoRunTodo не выключен» | переформулировать как проверку состава конфига и отсутствия `schedule` | п. 1 |

Дополнительно в MW-054 стоит внести: исключение `archivedAt` (3 карточки), явный маппинг легаси-статусов в `TaskState` (34 `backlog` + 2 `failed` → ?), решение по `permission: workspace-write` / отсутствующему `permissionConfirmedAt` у 33 карточек и запрет импорта в режиме «оживить выполненный план» (самореферентность: содержимое леджера — план развития самого MyWork).

---

## 4. Новое, чего не было в документе и в плане

Оценка: **усилие** S/M/L, **влияние** (на корректность/mvp), **риск** (вероятность, что без этого будет больно). Три пункта (A4-14…A4-16) добавлены после первого прохода; A4-1…A4-13 перечислены выше.

**A4-1. `assertSinglePlacement` не умеет multi-view — а доска многоview по построению. S / высокое / средний.**
Контракт объявляет ключ `(viewId, taskId)` (`contracts/src/board.ts:176,193`), `BoardView` — сущность с `viewId` (`:175-188`), а `assertSinglePlacement` дедуплицирует по `taskId` (`core/src/board.ts:110`). Если снапшот принесёт placements одной задачи из двух views (`default` и saved view), функция откажет с `TASK_CONFLICT` и **текстом «placed in two zones»**, даже когда зона одна и та же. Сегодня это не всплывает, потому что снапшот всегда один view; как только MW-050 добавит saved views (`MW-050.md:21`), любой «показать то же в двух представлениях» сломается. Правка: ключ `(viewId, taskId)` и отдельная проверка «внутри одного view — не более одного placement на задачу».

**A4-2. `resolveInsertion` детерминирована — и именно поэтому две одинаковые вставки дают равные ключи. S / высокое / высокий.**
`resolveInsertion` (`core/src/board.ts:377-391`) — чистая функция от пары соседей: одинаковые `lower`/`upper` дают **один и тот же** ключ. Два клиента, вставивших карточку между теми же `A` и `B` (типичный случай «двое получили снапшот одновременно»), получат **равные** `order`. Защита — только `columnRevision` (`:482-498`): второй запрос отвергается `STALE_COLUMN_REVISION`, и это работает, но (а) превращает честную конкуренцию в сериализацию на всю зону, (б) при потере проверки (или при записи мимо `applyDropIntent`, которого пока нет) даёт два placements с равным ключом, которые `boardOrdering` (`:339-350`) различит **только по `taskId`** — то есть порядок станет детерминированным, но не тем, который выбрал пользователь, и `resolveInsertion` при следующей вставке между ними честно вернёт `ORDER_RENUMBER_REQUIRED`. Ни документ, ни карточки не обсуждают ни дробление ревизии до промежутка, ни дедупликацию равных вставок. Наблюдение из легаси-плагина: там та же проблема решается журналом `requestId`+`fingerprint` (`ledger-v2.json.recentRequests[255]`, `src/host-routes.ts:211`) — рабочая альтернатива «одна ревизия на зону».

**A4-3. Cursor-семантика ревизии не определена (ни одного `Cursor` в контрактах). M / среднее / высокий.**
MW-047 требует «монотонный `boardRevision` и курсор», SSE-кадр с `cursor`. В `@dsh-mywork/contracts` нет ни типа курсора, ни правил: что значит «повторный кадр с той же revision не вызывает refetch» (`MW-047.md:21`), если клиент переподключился и пропустил 3 кадра? Нужны: (а) монотонность `boardRevision` при любом изменении (сегодня `applyDropIntent` его **не** двигает, `core/src/board.ts:552`), (б) правило «cursor < current → полный refetch», (в) тест на разрыв потока. Без этого degraded/reconnect из §50/§62 останется декларацией.

**A4-4. WIP-лимиты: в §6 их нет, в MW-049 есть индикатор без лимита. S / среднее / низкий.**
`MW-049.md:21`: «WIP-индикатор отображается, но не блокирует admission». При переходе на lane `work` (= `assigned`+`executing`) WIP-лимит — естественная метрика, но она **должна** сверяться с `autoRunMaxConcurrent`-подобным параметром scheduler'а, а не с UI. В §6 (`BoardLane`) поля лимита нет; в §58 (`BoardCard`) тоже. Если лимит появится в UI-состоянии, он станет «второй authority» для admission — прямо против §20 ADR («один resident scheduler»). Рекомендация: лимит живёт в scheduler-конфиге, доска только отображает `current/limit` из read model.

**A4-5. Виртуализация и 2000 карточек: приёмка MW-049 калибрована под 9 панелей. S / среднее / средний.**
MW-049 требует «на 2000 карточках в DOM не более 1.5× узлов от 1000» и «задержка фильтрации на 2000 не более 2× от 1000». Это разумные свойства, но они ничего не говорят о (а) числе панелей (7 vs 9 меняет базовый оверхед заголовков) и (б) стоимости пересборки проекции на Host — а именно Host строит снапшот из Beads + MyWork DB (`.work/reports/MW-042-board-projection.md:161` фиксирует, что `TaskBoardPort` не реализован). Риск: оптимизируют DOM, а тормозить будет проекция. Предложение: добавить в MW-047 метрику «p95 сборки снапшота на N=100/500/1000/2000 карточек», а в MW-049 оставить только DOM.

**A4-6. Offline/reconnect и «stale» как first-class. M / высокое / высокий.**
§50 говорит «показывается last valid data + explicit stale/failure banner», §62 — «stream loss → degraded/recovering, а не fake empty». В контрактах есть `DegradedProjection.snapshotAt` (`contracts/src/board.ts:311`) и `staleZones` (`:313`) — то есть **частичная** деградация по зонам уже предусмотрена, что сильнее, чем формулировка §50 (она говорит о снапшоте целиком). Это стоит зафиксировать как удачное решение: `staleZones` позволяет показать «эта колонка устарела», а не «вся доска устарела». Ничего из этого не реализовано (нет сервиса), и ни одна карточка не требует теста на «reconnect после 5 минут offline показывает последний валидный снапшот + banner».

**A4-7. Доска как отчёт: метрик потока нет ни в §6/§58, ни в карточках. M / высокое / средний.**
Карточки несут `createdAt`/`updatedAt` (легаси) — в MyWork контрактах у `Task` есть `revision`, но нет полей времени, из которых строится cycle time (`contracts/src/task.ts:75-107`; времени входа в состояние нет). При этом §53 предлагает взять из чужого плагина «timeline», «Gantt/analytics позже». Без durable «вошёл в состояние X в момент T» (или, как минимум, без журнала переходов с временем) ни cycle time, ни WIP-тренд, ни time-in-review не выводятся из проекции — их придётся считать по DSH-сессиям, то есть вне MyWork. Предложение: добавить в Task Graph (Beads) событие перехода с `at` либо таблицу `task_state_transitions(taskId, from, to, at, actor)` в MyWork DB. Оценка: M, влияние высокое (это то, чем доска полезна менеджеру), риск средний.

**A4-8. Права на карточку: домен их не знает вообще. M / высокое / средний.**
Ни `Task`, ни `BoardPlacement`, ни `CardCommand` не несут actor/role; `OperationMeta` даёт `operationId`/`correlationId`/`expectedRevision`/`controllerEpoch`, но **не** `actor` (см. §2/§21). При этом §21 требует «actor context», а MW-055 — «reviewer не подтверждает сам себя», «неавторизованная команда карточки отвергнута без изменения графа» (`MW-055.md:21`). Значит решение о правах должно появиться **в контракте команды**, иначе MW-055 нечего проверять. У легаси-плагина есть `initiator` (client-asserted, `protocol.d.ts:119-122`) — прямо помечен как «не trust boundary»; MyWork не должен повторять эту ошибку, ему нужен server-side actor из сессии.

**A4-9. Шаблоны карточек / «создать как» — нет в плане, но есть основание. S / низкое / низкий.**
У легаси-плагина есть `TaskForm.tsx` (6.7 КБ) и `/parse` (текст → черновик карточки через LLM, `protocol.d.ts:53-63`). Ни §5.1, ни §53 не упоминают parse-путь, хотя это самая дешёвая интеграция с Planner/`TaskClaims` (`MW-043`). Стоит зафиксировать как кандидат, а не изобретать: «быстрая задача» ADR019 (`decisions.md:177`) по смыслу ближе всего к `parse → draft → approved-plan`.

**A4-10. Bulk-команды и частичный отказ. S / среднее / низкий.**
MW-047 требует «Bulk из N команд возвращает N результатов и не является all-or-nothing», MW-050 — «Bulk move … возвращает результат по каждой карточке». Механика в контрактах отсутствует: нет типа `BulkResult`. Плюс не решено, что делать с **половиной** применённых команд при отказе на середине (например, `task.admit` упал на 3-й из 10): журнал, компенсация или явное «частично применено» с `operationId`-группой. Предложение: `BulkResult { results: readonly (Ok|Err)[], groupId }` + запрет «откатывать» успешные (иначе нужна saga, а её в Board быть не должно).

**A4-11. Идемпотентность: контракт обещает, реализация молчит. S / высокое / высокий.**
`OperationMeta.operationId` документирован как «repeated delivery keeps the same value» (`operation.ts`), `DropIntent` не несёт `operationId` вовсе, а `applyDropIntent` инкрементит `columnRevision` безусловно (`core/src/board.ts:556`). То есть повторная доставка одного и того же намерения **дважды** меняет состояние (ревизия +2, `order` перезаписан). Для сети с ретраями это не «теоретический» риск. Рабочий образец есть у легаси: журнал `recentRequests[255]` `{requestId, fingerprint}`; надо только сделать его durable и с TTL.

**A4-12. «Доска теряет только представление» не проверено тестом. M / высокое / средний.**
ADR017 (`decisions.md:129`) требует: «Пересборка проекции из Task Graph даёт идентичную раскладку; удаление и повторная сборка snapshot не изменяет граф». В `tests/board.test.mjs` такого теста **нет** (24 теста — все про чистые функции), потому что нет store и проектора. MW-047 переносит это в приёмку («Потеря проекции не изменяет Task Graph…»), но без store тест всё равно не напишется. Это делает ADR017 до MW-047 **непроверенным инвариантом** — единственная причина, по которой Board принято считать «projection, never authority», держится на честном слове.

**A4-13. Второй леджер того же плана — риск «двойного учёта» уже сейчас. S / высокое / высокий.**
`.work/tasks/INDEX.md` держит статус `planned` у **всех** карточек (брифинг §3), `.work/tasks/tasks.json` и `board-export.json`/`board-actions.json`/`board-before.json` дублируют тот же план, а легаси-леджер содержит 55 карточек с теми же заголовками. Три источника одного плана уже расходятся (INDEX не знает о 23 отчётах, леджер знает о 19 `done`). MW-054 добавляет четвёртый (импорт). Прежде чем строить мастер импорта, стоит решить, какой из четырёх объявляется authority — иначе «один control plane» (§54) не наступит даже после disable строки `web-ui-task-board`.

**A4-14. `BoardPlacement` не несёт `workspaceId` — снапшот нельзя проверить на кросс-воркспейсную утечку. S / высокое / средний.**
`BoardView` знает свой воркспейс (`contracts/src/board.ts:179`), `BoardPlacement` — **нет** (`:197-225`: только `viewId`, `taskId`, `zone`, `exactState`, `subState?`, `order`, `pinned?`, `columnRevision`, `boardRevision`). Следствия: (а) размещение нельзя отфильтровать по воркспейсу без join через view; (б) `assertSinglePlacement` (`core/src/board.ts:106-145`) не может обнаружить снапшот, собранный из views **разных** воркспейсов; (в) `Task.workspaceId` существует (`contracts/src/task.ts:79`) и объявлен обязательным, а размещение от него не зависит — то есть инвариант «карточка и её placement в одном воркспейсе» нигде не проверяется. Для MyWork с одним воркспейсом это незаметно, но §54/§61 ADR021 говорит о нескольких воркспейсах, а `DshModelCatalog`/team-контракты уже мультиворкспейсные (`WorkspaceLimits`, `team.ts:363`). Правка: либо `workspaceId` в placement, либо проверка в `assertSinglePlacement` «все placements одного снапшота принадлежат воркспейсу view».

**A4-15. Клавиатурное перемещение карточки не выразимо текущим контрактом. S / среднее / средний.**
MW-050 требует «Keyboard-only проход выполняет все действия: выбор, перемещение, bulk, открытие detail, поиск» (`MW-050.md:21`). `DropIntent` выражает позицию через `beforeTaskId`/`afterTaskId` (`contracts/src/board.ts:244-246`) — это координаты **указателя**, а не намерение «поднять карточку на одну позицию». Для клавиатуры нужен либо явный `resolveInsertion`-вызов от клиента (значит клиент сам считает соседей, то есть частично дублирует серверную логику порядка), либо новая команда вида `board.reorder { direction, steps }`. Ни в §7, ни в §21, ни в MW-050 этого нет; при этом «перемещение» входит в приёмку. Риск: исполнитель MW-050 реализует клавиатурный reorder на клиенте и создаст второй вычислитель порядка — против ADR017.

**A4-16. Локализация: имена lanes — это ключи ревизий и порядковых ключей, а не подписи. S / низкое / низкий.**
`BOARD_ZONE_ICONS` устроен правильно: значения — семантические идентификаторы (`'lightbulb'`, `'circle-dashed'`, `contracts/src/board.ts:82-92`), а не кодпоинты, и это отдельно проверено тестом (`tests/board.test.mjs:54-56`). Но **сами имена зон** (`'in-progress'`, `'needs-attention'`) — это одновременно отображаемый ключ, ключ ревизии (`(viewId, zone)`, `:176`) и фактически часть persisted placement (`:203`). Значит display-имя нельзя менять без миграции, и при v0.3 `blocked → queue` произойдёт не «переименование в UI», а миграция данных (3.7). Нужен отдельный label-слой (аналог иконок) и явное правило «имя lane — идентификатор, никогда не строка для человека». Для MW-048 (ru/en, `MW-048.md:18`) это снимает целый класс ошибок: легаси-плагин служит здесь отрицательным примером — его словари «zh-first with an English fallback» (`src/client/locales.ts:1-5`), русского нет, а подписи статусов лежат в одном модуле со значениями (`src/core/tasks.ts:382-386`, `board.status.backlog/todo/running/done/failed`). Показательная деталь: комментарий `locales.ts:4` до сих пор описывает «the DOM-injected entry row», хотя 0.4.3 уже использует слоты (`native-panel.tsx:1-18`) — то есть в самом легаси-пакете документация отстала от реализации на одну архитектурную итерацию.

**A4-17. Рядом лежит работающий референс ровно того, что планируют строить MW-047/MW-048/MW-029 — и он не используется. M / высокое / средний.**
Установленный `@linxin666/dsh-client-ui-task-board@0.4.3` поставляется **с исходниками TypeScript** (`profiles/web/node_modules/@linxin666/dsh-client-ui-task-board/src/**`, 55 файлов): `src/client/native-panel.tsx` (регистрация `sidebar.panellist` + `main`, key, order, inject-фабрика `{controller}` — ровно то, что требует MW-048), `src/host-routes.ts` + `src/protocol.ts` (`TASK_BOARD_API_PREFIX = '/api/task-board'`, `TaskBoardSnapshot`, `TaskBoardEventPayload` с `revision/scheduler/power` — то, что MW-047 называет «SSE-кадр без карточек»), `src/host/agent-tools.ts` (восемь `task_board_*` через `defineTool` — образец для инструментов MyWork), `src/core/{subtask,session-reuse,schedule,handover,freeze-snapshot}.ts` (подзадачи с лимитом глубины, повторное использование сессии, cron, передача задачи, заморозка снапшота), `src/core/controller.ts:66` (panel id). При этом `src/invariant.ts` — **пустой** companion-плагин (`export function apply(): void {}`, «Provides no assertions»), то есть паттерн invariant-companion существует, но cross-package инвариантов у доски нет: MyWork, который их вводит (ADR017/ADR018), пойдёт дальше референса. Предложение: в MW-047/MW-048 добавить обязательный пункт «сверить форму с работающим образцом 0.4.3 (файл:строка) и записать расхождения» — это дешевле, чем проектировать тот же контур с нуля, и снижает риск, что MyWork повторит уже отброшенный DOM-путь (в 0.4.3 его нет: `data-dsh-taskboard-active` и `centerCol` — 0 совпадений).

**A4-18. Расхождение эффективного `sessionDefaultPermission`: профиль говорит `workspace-write`, живая доска — `read-only`. S / среднее / средний.**
`cordis.patch.yml:25` задаёт плагину `sessionDefaultPermission: workspace-write`; собранный код при отсутствии значения падает на `"read-only"` (`lib/index.js`), а сводка живой доски (брифинг §3) сообщает session-default `read-only`. При этом `permission: workspace-write` стоит у всех 55 карточек, и `permissionConfirmedAt` отсутствует у 33. Значит либо значение из профиля не доезжает до рантайма, либо сводка брифинга снята из другого источника. Для MyWork это важно потому, что MW-054 импортирует карточки с их `permission`, а MW-050/MW-055 требуют гейта подтверждения: если MyWork унаследует `workspace-write` как session-default, 33 «неподтверждённые» карточки легаси станут подтверждёнными сами собой. Рекомендация: до MW-054 выяснить, какое значение действует (одна команда: открыть настройки плагина в GUI либо прочитать `permission` из снапшота доски), и зафиксировать это как вход мастера импорта, а не как допущение.

---


## 5. Открытые вопросы и что я НЕ проверял

1. **Не проверял DSH-часть §18/§22/§23 глубже одного файла.** Прочитал только шапку `packages/experimental/agent-team/src/projection.ts` (строка 1) и состав `packages/experimental/client-ui-agent-team/`. Утверждения §18 про «не делает refresh polling», «projection failure рядом с последним валидным состоянием», «board read-only» и весь `docs/subsystems/slots.md` / `packages/client/ui-sidebar/README.md` — зона потока C. Мои выводы по §22/§23 опираются на отсутствие клиентского пакета в MyWork, а не на проверку DSH.
2. **Не проверял MW-044/MW-045/MW-051** (не входили в задание), хотя они соседи по доске.
3. **Не проверял `packages/web` «на будущее»** — его нет; всё, что я пишу про `PLATFORM_MODULES`, `dsh.client.external`, build-gate, взято из текста `MW-048.md:18,21`, а не из DSH-кода.
4. **Не измерял производительность.** Числа вроде «1.5× DOM-узлов» — цитаты приёмки MW-049, я их не воспроизводил (нет UI).
5. **Не проверял `pnpm run check` целиком** — только `node --test tests/board.test.mjs` (exit 0, 24/24). Полный прогон (231 тест по отчёту MW-042) не запускал: риск задеть чужие незакоммиченные изменения в дереве (`packages/lease/`, `packages/evidence/` — см. MW-042 §5 п.3).
6. **Не проверял `pack:local`/`verify:profile`** (запрещены как долгие).
7. **Не проверял, какой именно `sessionDefaultPermission` действует вживую.** В `cordis.patch.yml:25` у плагина стоит `sessionDefaultPermission: workspace-write`, а сводка доски в брифинге §3 сообщает session-default `read-only`. Расхождение зафиксировал, причину не выяснял; оно влияет на смысл `permissionConfirmedAt` (у 33 карточек из 55 его нет).
8. **Не проверял, жив ли `3fc33afb`** как удалённый воркспейс: он отсутствует и в `tables.workspaces`, и в `global.workspaceIds` файла `storages/workspace.json`. Возможные объяснения (удалённая запись, id из другой инсталляции, устаревшая миграция) не различал.
9. **Не проверял `recentRequests` на содержание** (только структуру `{fingerprint, requestId}`, 255 записей) — не выводил значения, чтобы не тянуть 369 КБ в контекст.
10. **Не проверял эмпирически, что 7 lanes ломают именно те 8 тестов, которые я перечислил**: вывод сделан чтением кода тестов против предлагаемой таблицы §6.1, а не прогоном мутации (для мутации потребовался бы worktree и правка тестов — счёл неоправданным, так как вывод однозначен по тексту).
11. **Не проверял §66-§73** целиком (кроме §71 и §74): они вне board-зоны.
12. **Не выяснил, какое значение `sessionDefaultPermission` действует в рантайме** (A-72): профиль задаёт `workspace-write`, собранный код падает на `"read-only"`, сводка живой доски сообщает `read-only`. Не проверял настройки плагина в GUI и не читал снапшот доски изнутри (это потребовало бы вызова `task_board_*`, запрещённого мне заданием).
13. **Не проверял, действительно ли schemastery отбрасывает неизвестные ключи** `autoRun*` молча, или Loader ругается в лог. Наблюдаемый факт — плагин смонтирован и отдаёт revision 324; поведение самой библиотеки не проверял.
14. **Не читал `src/core/{subtask,session-reuse,schedule,handover,freeze-snapshot}.ts` и `src/host/agent-tools.ts` построчно** — только перечень и точки входа (`agent-tools.ts:253-575`, `tasks.ts:242-243`). Как референс они заявлены (A4-17) именно на уровне «существует и покрывает тот же контур», а не «проверены построчно».

---

## 6. CLAIMS

| ID | Утверждение | Доказательство | Статус |
|---|---|---|---|
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

**Итог по CLAIMS:** 72 пункта. `refuted` — 5: A-32, A-33, A-34 (числа и воркспейсы MW-054/MW-055), A-48 (строка `Idea separate | KEEP` в §71) и A-67 (`.work/EXECUTION-PLAN.md:125` про `autoRunTodo`). `unverified` — 1: A-72 (какое значение `sessionDefaultPermission` действует в рантайме — расхождение зафиксировано, причина не выяснена; это же вынесено в §5). Остальные 66 — `verified`.

Две ошибки первой редакции этого отчёта, найденные при самопроверке и исправленные: (1) утверждение «сущностей роустера нет» — **опровергнуто**, контракты `AgentIdentity`/`AgentInstance` существуют (`team.ts:229`, `:335`), см. A-53; (2) утверждение «`Cursor` отсутствует в контрактах» — **опровергнуто**, тип есть в `agent-runtime.ts` и `taskgraph.ts`, но не в board-контексте, см. A-51. Оба исправления ослабляют критику документа в этих двух точках и не затрагивают выводы о Board.

