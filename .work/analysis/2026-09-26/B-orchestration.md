# Поток B: оркестрация — Agent Teams, TaskGraph/Scheduler/Execution, coordination и durability

**Вердикт потока:** механика Agent Teams, описанная в §8–§17, подтверждается исходниками DSH почти дословно (bounds, queue-before-delivery, dedup на цели, `waitForChange` по edge, invariant companion, selective teardown, provisioning saga, отсутствие авто-освобождения owner); исключения — три: (1) invariant companion опубликован, но **не смонтирован** ни в одной композиции чекаута, а сам сервис `invariants` монтируется только бандлом `sdk-minimal`, поэтому «отвергается до append» в живом web-профиле не действует; (2) `wait_agent` имеет не описанный документом короткий путь `noProgress`, то есть буквальное «блокирует до следующего изменения» неверно; (3) границы сообщения считаются по **sender-framed** доставке, поэтому полезная нагрузка меньше `maxMessageBytes`. Утверждения §3–§4 и §42 о MyWork подтверждаются: 16 `TaskState` в коде, authority split TaskGraph/MyWork записан в контракт дословно, scheduler — чистая синхронная функция без LLM (файл не содержит `Date.now`/`Math.random`/`async`/`await`), attempt/lease/fence есть и проверяются (fence против **токена задачи**, затем controller epoch), peer mailbox отсутствует. Практический вывод: из §9–§17 в план стоит взять два пункта (provisioning saga и handoff artifact как `dependency-result`), один — условно (advisory write scopes на уровне Attempt), а coordination subsystem (§45) строить не нужно: у MyWork уже есть transactional outbox + inbox dedup, а продуктовая потребность в peer-chat не заявлена.

**Границы работы.** Мутирующих экспериментов не потребовалось, worktree не создавался. Прогоны тестов выполнены в живом дереве (`node --test`, ничего не коммитит); после прогонов `git status --porcelain` пуст, HEAD `0c657ae1434202865bd330f0eeaf2b60eb78f6d4`. Правок в живом дереве, в профиле DSH, в доске и в чужих файлах не делалось; записан ровно один файл — этот.

## 1. Что проверено и как

| Утверждение | Как проверял | Результат |
|---|---|---|
| Дефолтные bounds домена Agent Teams | `packages/experimental/agent-team/src/index.ts:41-45`, `:59-65` | 16 / 256 / 64 / 65 536 / 5 000 мс — совпадает с README:49-55 |
| `maxMembers: 8` — это профиль, а не домен | `packages/experimental/agent-team-profile/cordis.patch.yml:20`; домен `index.ts:41` | подтверждено: профильный слой переопределяет 16 → 8 |
| Профиль `web` действительно подключает этот слой | `C:\Users\Dmitry\.dsh\profiles\web\package.json:32` (bundle list) | пакет `@deepseek-ai/dsh-experimental-agent-team-profile` в списке бандлов; эффективное значение в рантайме не измерял |
| Queue-before-delivery | `src/mailbox.ts:117-151` | append+flush `team/message/queued` внутри транзакции Lead до регистрации dispatch |
| Dedup на стороне цели | `src/mailbox.ts:301-306`, `:317-331` | цель ищется по своему логу/персисту по `team-message` id |
| `delivered` только после durability цели | `src/mailbox.ts:273-282` | `sessions.flush(target)` → проверка receipt → append `delivered` |
| Per-target serialization | `src/mailbox.ts:193-209`, `:212-232` | очередь по `targetId`, доставка строго в durable-порядке |
| `waitForChange` не реплеит старое | `src/activity.ts:22-66`, `:72-77` | waiter регистрируется на будущий edge; `notify` будит и очищает |
| Короткий путь `noProgress` у `wait_agent` | `packages/experimental/tool-agent-team/src/index.ts:242-275` | при отсутствии running/provisioning peer возврат без ожидания |
| Provisioning saga: порядок и восстановление | `src/roster.ts:259-337`, `:392-434`, `:464-482` | provisioning→startContinuable(pre-minted childId)→flush prompt→terminal; recovery по персисту ребёнка |
| Selective teardown | `src/roster.ts:221-234`, `:241-243`; `packages/subagent/subagent/src/index.ts:349-363` | drains только roster-owned дети живого Lead |
| Disposal cutoff и timeout | `src/index.ts:252-267`; `src/lifecycle.ts:44-64`, `:71-86` | close → settle creations → settle dispatches → drains, всё в пределах `disposalTimeoutMs` |
| Invariant companion: проекция кандидата на committed prefix | `src/invariant.ts:20-32`; `packages/core/session/src/index.ts:759-761` | валидация вызывается до `log.push`, throw отвергает append |
| Companion смонтирован в композиции | grep `'/invariant'` по всем `cordis*.yml` чекаута; `packages/bundle/sdk-minimal/cordis.patch.yml:107-119` | **не смонтирован**: сервис `invariants` есть только в `sdk-minimal`, `agent-team/invariant` — нигде |
| Task CAS/DAG/tombstones/writeScopes | `src/task-board.ts:115-126`, `:189-197`, `:234-237`; `src/task-graph.ts:26-68`; `src/validation.ts:26-34` | всё на месте; `writeScopes` — только предупреждения (`src/task-view.ts:43-49`) |
| 9 tools, role enforcement в домене | `tool-agent-team/src/index.ts:164-422`; `src/roster.ts:206`, `:251-253` | 9 tools, единые схемы, Lead-only проверяется сервисом |
| 16 `TaskState` в MyWork | `packages/contracts/src/task.ts:11-63` | ровно 16, три терминальных (`:66`) |
| Authority split TaskGraph/MyWork | `packages/contracts/src/taskgraph.ts:9-14` | записан дословно, включая readiness и final completion |
| Scheduler детерминирован и без LLM | `packages/core/src/scheduler.ts:296-333`; grep `Date.now|Math.random|async |await |process\.` по файлу | совпадений нет (exit 1); `planSchedulerTick` — синхронная чистая функция |
| Тики сериализованы, есть startup/reconcile/kick | `packages/scheduler/src/service.ts:195-196`, `:227-238`, `:256-264`, `:280-287`, `:289-299` | подтверждено |
| Scheduler не делает claim | `packages/scheduler/src/service.ts:105-120` | «The scheduler never claims work itself: §9's saga owns the claim» |
| Attempt/lease/fence и порядок проверки | `packages/contracts/src/attempt.ts:80-89`, `:104-127`; `packages/execution/src/service.ts:405-429` | fence против токена задачи → controller epoch → сверка с копией попытки |
| Claim — 5-шаговая сага | `packages/execution/src/service.ts:165-166`, `:11-14`, `:671-693` | intent→claim→attempt→projection→complete; intent коммитится до графа |
| Controller lease — CAS с эпохой | `packages/lease/src/lease.ts:120-192`, `:292-303` | `WHERE scope_id=? AND epoch=? AND lease_until<=?`; `holdsLeadership` требует instance+epoch |
| Peer mailbox/coordination в MyWork | grep `mailbox|PeerMessage|coordination` по `packages/**/*.ts` | совпадений нет (exit 1) — отсутствует |
| Outbox/inbox уже есть в storage | `packages/storage/src/outbox.ts:2`, `inbox.ts:51-73` | транзакционный outbox + `applyOnce(consumer,eventId)` |
| Прогон доменных тестов MyWork | `node --test --test-isolation=none tests/scheduler.test.mjs tests/attempt.test.mjs tests/lease.test.mjs tests/authority.test.mjs tests/team.test.mjs` | 83 pass / 0 fail, exit 0 |
| Прогон саги и границ | `node --test ... tests/claim-saga.test.mjs tests/boundaries.test.mjs tests/storage-crash.test.mjs` | 60 pass / 0 fail, exit 0 |
| Границы не ловят `@deepseek-ai/dsh-*` кроме cordis | `tests/boundaries.test.mjs:17-25`, `:127-133`, `:111-124` | список FORBIDDEN содержит только `@deepseek-ai/cordis`; scheduler/planner вне source-скана |

## 2. Разбор по разделам документа

### §3. MyWork Team Work богаче DSH Agent Teams — **ПОДТВЕРЖДЕНО**

Все пять сущностей и их разделение существуют: `RoleContract` (`contracts/src/team.ts:109-122`, закрытая форма `:129-136`), `RoleStrategy` (`:139-150`, своя revision `:163`), `AgentBlueprint` (`:194-213`: `roleId`, `modelPolicy`, `reasoning`, `preset`, `permissions`, `skills`, `pool`), `AgentIdentity` (`:229-254`: overlays, sessionRefs, performance/experience refs, learningProvenance), `AgentInstance` (`:335-346`).

State machine instance: `sleeping → waking → running → settling` + `failed/revoked/terminated` (`:297-322`), причём identity **не** несёт runtime-полей: `IDENTITY_RUNTIME_FIELDS` (`:267-274`) прямо запрещает `attemptId/instanceId/runtime/session/sessionId` на durable-записи, а `IDENTITY_FIELDS` (`:281-294`) закрывает форму. Permissions — 12 значений (`:34-74`), включая `review.approve` с оговоркой «worker never holds this for its own attempt» (`:47`).

Проверки: `tests/team.test.mjs:284` («the durable identity carries references, never the running attempt or session»), `:122` («learning evolves the strategy and can never rewrite the contract»), `:169` («the closed §13 shapes refuse a field they do not declare») — все в зелёном прогоне (83 pass).

Что это меняет: ничего в плане; §3 можно считать подтверждённой основой для §44 («TeamTask как canonical Task» не переносить).

### §4. TaskGraph и Scheduler: Agent Teams не authority — **ПОДТВЕРЖДЕНО**

§4.1 совпадает с контрактом дословно: `contracts/src/taskgraph.ts:9-14` — «The task graph owns description, dependencies, **readiness**, priority, role requirement and final completion. MyWork owns the current attempt, leases and fences, reviews, git refs and audit». Readiness не выводится из поля: `TaskRef` намеренно без `is_blocked` (`:119-126`), порт отдаёт `ready()` и `blocked()` отдельно (`:356`, `:363`). Проверка: `tests/authority.test.mjs:52` («the matrix reproduces every authority row of the architecture»).

§4.2 подтверждается по каждому пункту:
- «deterministic, без LLM» — `core/src/scheduler.ts:296-299` («reads nothing but its argument and calls nothing but pure policy, so two calls with the same input produce the same plan»), и grep по файлу не находит `Date.now`, `Math.random`, `async`, `await`, `process.`, динамических импортов (exit 1 — совпадений нет). Тест `tests/scheduler.test.mjs:921` («the scheduler holds no model port: an injected one is never called, and no source names one») это закрепляет.
- «state observation → pure plan» — `SchedulerTickInput` → `SchedulerPlan` (`contracts/src/scheduler.ts:368-389`, `:532-546`), реализация `:303-333` замораживает результат.
- «serialized ticks» — `packages/scheduler/src/service.ts:19-20`, `:195-196`, `:280-287`; тест `tests/scheduler.test.mjs:947`.
- «startup reconcile» — `service.ts:227-238`; «event-driven kicks» — `:256-259`; «periodic safety reconcile» — `:289-299`; тесты `tests/scheduler.test.mjs:832`, `:866`.
- «workspace fairness» — `core/src/scheduler.ts:336` (`runFairRounds`), тесты `tests/scheduler.test.mjs:450`, `:474`; «budgets» — `budgetVerdict` (`:554`); «pool/role/workspace limits» — `capacityRefusal` (`:584`); «отдельный admit port» — `service.ts:113-120`; «claim выполняет execution saga, а не scheduler» — `service.ts:108-111` + `packages/execution/src/service.ts`.

Что это меняет: §4 не требует правок; вывод «MyWork Task ⇄ DSH TeamTask с двумя writable authorities недопустима» подтверждён структурно — у MyWork уже два разных владельца, и третий (TeamTask) некуда встроить без нарушения `tests/authority.test.mjs:61` («the Task Board is a projection, not a competing authority»).

### §8. DSH Agent Teams: фактическая реализация — **ПОДТВЕРЖДЕНО**

§8.1: `TeamId` — это root `SessionId` (`src/types.ts:15-17`); inject-список ровно `agents, sessions, sessionPersistence, sessionProjections, subagents` (`src/index.ts:57`); публичные операции совпадают поимённо — `membership`/`listMembers`/`spawnTeammate`/`sendMessage`/`createTask`/`getTask`/`listTasks`/`updateTask`/`waitForChange`/`interrupt`/`tryMembership` (`src/index.ts:131-232`); четыре durable-семейства событий (`src/types.ts:229-244`); durable state начинается с пустой проекции (`src/projection.ts:145-154`) и восстанавливается реплеем лога Lead (`docs/subsystems/agent-team.md:125`).

§8.2 bounds — **ПОДТВЕРЖДЕНО**, но с уточнением, которое документ не формулирует: 8 — это значение **профильного слоя** `agent-team-profile/cordis.patch.yml:20`, тогда как домен по умолчанию 16 (`src/index.ts:41`). Все пять границ валидируются как положительные safe integer и падают типизированно (`src/index.ts:47-53`, `:79-91`). `maxMembers` считает и провалившихся участников: проверка стоит до provisioning-append и считает `state.members.length` (`src/roster.ts:274-276`), что подтверждает README:51 («including failed ones») и тест `tests/team.spec.ts:328`.

Что это меняет: формулировку «в опубликованном profile используется более консервативный `maxMembers: 8`, хотя domain default шире» стоит уточнить до «в профильном слое бандла», потому что сам пакет значения не задаёт.

### §9. Provisioning teammate как pattern — **ПОДТВЕРЖДЕНО**

Порядок шагов из документа совпадает с кодом с точностью до одного важного добавления, которого в документе нет: **childId чеканится сагой до внешнего side effect** (`src/roster.ts:259`), поэтому identity существует даже если runtime упал на старте. Далее: `journal.transact` проверяет уникальность имени и лимит, `appendAndFlush('team/member', provisioning)` (`:269-278`), `startContinuable({childId, provider, label, request})` (`:282-291`), `checkpointInitialPrompt` — flush принятого промпта ребёнка (`:340-389`), затем терминальный edge `active`/`failed` (`:314-336`, `:464-482`).

Recovery: `reconcileProvisioning` (`:392-434`) читает **независимо** персистенный Session ребёнка и требует четыре факта — `parentSession === root.id`, `descriptor.mode === 'continuable'`, `descriptor.provider === member.provider`, принятый initial prompt (`:406-409`); иначе `failed` с причиной. Живой ребёнок пропускается — терминальный edge принадлежит создателю (`:396-398`). Конфликт оседания даёт `TEAM_PROVISIONING_CONFLICT` и drain ребёнка (`:302-335`), recovery планируется на `agent/created` и для уже живых агентов (`src/index.ts:108`, `:123`, `:235-249`).

Тесты: `tests/team.spec.ts:235` («flushes the accepted child prompt before committing the active roster edge»), `:317`, `:341`, `:369`, `:394`, `:1736`; `tests/persistence.spec.ts:168`, `:243`.

Что это меняет: §9 переносится в MyWork почти без изменений, но с обязательным условием — MyWork должен чеканить `AgentInstanceId`/`SessionId` **до** вызова `AgentRuntimePort.start`, иначе восстановление вынуждено искать сессию по эвристике.

### §10. Durable mailbox — **ПОДТВЕРЖДЕНО**, с одной неточностью в границах

§10.1: `sendAdmitted` внутри `journal.transact` считает pending, валидирует размер, затем `appendAndFlush('team/message/queued')`, и **регистрирует dispatch до выхода из транзакции**, чтобы конкурентные отправители встали в очередь в durable-порядке (`src/mailbox.ts:117-148`, комментарий `:145-146`). Ответ `{status: 'accepted' | 'queued'}` (`:149-150`, `types.ts:188-191`) означает durable-принятие в обоих случаях — документ говорит только про `queued`, что не ошибка, но неполно.

§10.2: running-цель получает Steer, inactive стартует turn, отсутствующая (не live) — cold-resume через continuation owner (`:235-270`; `packages/subagent/subagent/src/index.ts:300-311`, `continuation.ts:196`, `:403-430`). Для Lead доставка идёт прямым `root.steer(input)` (`:249-253`).

§10.3: dedup — `targetRecorded` читает **лог самой цели** (`:301-306`), для не-live цели — персист (`:317-331`); `delivered` пишется только после `sessions.flush(target)` и подтверждённого receipt (`:273-282`); повторный `markDelivered` идемпотентен (`:285-298`). Тесты: `tests/team.spec.ts:1079`, `:1161`, `:905`, `:955`; `tests/persistence.spec.ts:284`, `:332`, `:439`.

**Неточность:** `maxMessageBytes` измеряется на **sender-framed** содержимом — `JSON.stringify(this.deliveryContent(queued))`, где `deliveryContent` добавляет блок `Team message <id> from <name>:` (`:137-139`, `:309-314`). То есть предельная полезная нагрузка меньше объявленных 65 536 байт, и разница зависит от длины id и имени отправителя. Документ описывает границу как «message bytes» без этой поправки.

Что это меняет: при переносе semantics в MyWork границу надо формулировать как «размер полной доставки», иначе тест на границу будет расходиться с реализацией на десятки байт.

### §11. Нужен ли MyWork собственный mailbox — **ПОДТВЕРЖДЕНО** (отсутствует), вывод — **ЧАСТИЧНО**

Проверено: `grep -E "mailbox|Mailbox|PeerMessage|coordination|Coordination"` по `packages/**/*.ts` — совпадений нет (exit 1). Отдельного peer mailbox в MyWork действительно нет, и §11 прав, что он не prerequisite Board.

Чего документ не заметил: **durability-примитив для такого mailbox уже существует** — транзакционный `outbox` (`packages/storage/src/outbox.ts:2`, `:113-190`) и `inbox_dedup` с `applyOnce(consumer, eventId, apply)` (`inbox.ts:51-73`), причём с явным требованием синхронного эффекта, чтобы «не записать обработанным то, что ещё не завершилось» (`:58-63`). Если mailbox когда-нибудь понадобится, ему нужен не новый журнал, а эта пара плюс per-target ordering.

Что это меняет: в §45 (см. ниже) «durable queue» и «de-dup» перестают быть новыми обязанностями — это уже реализованный kernel.

### §12. Peer message и Context Fabric — **ПОДТВЕРЖДЕНО**, и в MyWork это дешевле, чем описано

DSH доставляет peer content как user-role сообщение с стабильным префиксом (`src/mailbox.ts:308-314`, README:187). Для MyWork документ требует «данные с provenance, а не trusted instruction» — и это **уже обеспечено** контрактом Context Fabric: класс `dependency-result` (`contracts/src/context.ts:67`, `:83`) не входит ни в `MANDATORY_CONTEXT_CLASSES` (`:108-112`), ни в `INSTRUCTION_CONTEXT_CLASSES` (`:125-129`), а значит рендерится как data; у него есть собственный бюджетный bucket `dependencies` (`:452-456`) и целевой лимит токенов (`:476-477`). Тесты: `tests/context.test.mjs:343` («untrusted optional context is still selected, but as data»), `:791`, `:838`.

Что это меняет: §12 не требует новой политики доверия — достаточно доставлять peer/handoff содержимое классом `dependency-result`, а не как user-message в разговор.

### §13. Shared Team task board — **ПОДТВЕРЖДЕНО**

Статусы ровно четыре (`src/types.ts:71`), действий ровно восемь (`:202-210`). Каждая мутация через `expectedRevision` (`src/task-board.ts:115-120`); CAS-отказ типизирован `TEAM_TASK_STALE_REVISION`. DAG: self/cycle/duplicate/missing отвергаются полным обходом (`src/task-graph.ts:26-68`), тест `tests/team.spec.ts:673`. Только Lead может `reassign` (`src/task-board.ts:172-173`), owner или Lead — остальные переходы (`:122-126`). Удалённые задачи остаются tombstone и не блокируют удаление, пока держат зависимых (`:189-197`), и не занимают `maxTasks` (`:48`, `:94`). `writeScopes` нормализуются и дедуплицируются (`:234-237`, `src/validation.ts:26-34`).

Что это меняет: ничего; переносить нужно именно ergonomics (CAS+DAG), а не сущность — как и говорит §13.

### §14. Advisory write scopes — **ПОДТВЕРЖДЕНО** (в DSH), в плане MyWork — **ОТСУТСТВУЕТ**

DSH: `writeScopes` не lock, не permission и не запрет claim — они только порождают предупреждения о пересечении **с задачами в `in_progress`** (`src/task-view.ts:43-49`), и claim не читает их вовсе (`src/task-board.ts:133`). Overlap считается по компонентам пути (`task-view.ts:14-16`), а сами префиксы нормализуются с запретом абсолютных и `..` (`validation.ts:26-34`). README:207 прямо предупреждает, что Bash/форматтеры/генераторы обходят проверки файлов.

В MyWork поля write-intent нет ни в `Task`, ни в `Plan`, ни в `Attempt` (проверено чтением `contracts/src/task.ts`, `plan.ts`, `attempt.ts`). Рекомендация §14 «связать не только с Task, а с Plan/Attempt» **обоснована дополнительным аргументом, которого документ не приводит**: `Task` — чужая authority (TaskGraph владеет описанием, `taskgraph.ts:9-14`), поэтому write-intent на `Task` был бы вторым писателем в чужую сущность и нарушил бы `tests/authority.test.mjs:61`.

Что это меняет: см. §3 отчёта (правки к плану) — новый тип на уровне `Attempt` (и, опционально, `Plan`), но не `Task`.

### §15. `waitForChange` вместо polling — **ЧАСТИЧНО**

Подтверждено: `TeamActivity.wait` (`src/activity.ts:22-66`) регистрирует waiter и разрешает его только по `notify` (`:72-77`) или таймауту; прошлое событие не реплеится, потому что состояние waiter'а живёт только в памяти (`:12`) и `close()` будит всех при disposal (`:79-86`). Диапазон таймаута — 10 000…3 600 000 мс (`:23-25`), отмена даёт `TEAM_WAIT_ABORTED` (`:45-52`).

Опровергается буквальное «блокирует caller до следующего change»: `wait_agent` сначала читает roster и, если **ни один другой** member не в `running`/`provisioning`, немедленно возвращает `{timedOut:false, noProgress:{reason:'no-active-peer'}}` (`tool-agent-team/src/index.ts:39-40`, `:252-274`), причём чтение roster и регистрация waiter'а обязаны быть одним синхронным интервалом (`:260-263`). Документ этого не описывает.

Что это меняет: при переносе паттерна в MyWork нельзя обещать «блокирует до изменения» — нужен эквивалент `noProgress` (иначе worker будет ждать час в пустой системе), и в спеке §15 его надо назвать явно.

### §16. Selective teardown — **ПОДТВЕРЖДЕНО**

Порядок: `disposeRuntime` закрывает admission (`lifecycle.close()`, `src/lifecycle.ts:44-47`), будит ожидающих (`activity.close()`), затем `settle()` дожидается уже допущенных creations и dispatches, отбрасывая только ожидаемую отмену (`:54-64`, `src/index.ts:256-258`), и лишь потом drains (`src/index.ts:259-265`). Ошибки не проглатываются — `AggregateError` (`:266`).

Селективность: `liveChildrenByRoot` собирает детей **по membership в журнале Team** и `parentSession` (`src/roster.ts:221-234`), `stopTeammates` вызывает `drainContinuableChildren(root, childIds)` (`:241-243`), а тот документирован как «Release selected resident continuable direct children of one exact live parent. Other children of the same parent remain admitted and resident» и бросает `UNAUTHORIZED` на чужого родителя (`packages/subagent/subagent/src/index.ts:349-363`). Таймаут ограничивает уборку (`lifecycle.withTimeout`, `:71-86`); тест на неотвечающий drain — `tests/team.spec.ts:1644`, на неудачу уборки — `:1475`, `:1726`.

Что это меняет: §16 переносится в MyWork как обязательный invariant controller shutdown: «останавливаем только свои AgentInstance/Attempt, Session остаётся evidence» — что совпадает с `AgentRuntimePort.stop` («never destructive: the session record survives as evidence», `contracts/src/agent-runtime.ts:245-250`).

### §17. Invariant companion — **ЧАСТИЧНО** (механика подтверждена, применение — нет)

Механика ровно такая, как описано: слушатель `internal/dispatch` берёт **committed prefix** (`ctx.sessionProjections.stateOf(session,'agentTeam')`), применяет к нему кандидата через `teamProjectionDefinition.apply` и при `failure` вызывает `fail(...)` (`src/invariant.ts:20-32`). Ключевое — почему это «до append»: `Session.append` собирает callbacks через `ctx.events.dispatch('emit', ...)` (`packages/core/session/src/index.ts:759`) **раньше** `this.log.push(event)` (`:761`), и заголовок метода это формулирует прямо: «A synchronous internal dispatch validation failure ... also rejects before the log changes» (`:716-720`). Тот же приём с той же мотивацией описан в `packages/session/session-title/src/invariant.ts:66-67` («internal/dispatch interception rejects the append before publication (the session/event listener would only observe the already-committed log)»).

Но применение в этой сборке не подтверждено:
- companion публикуется отдельным подпутём (`agent-team/package.json`, `exports["./invariant"]`, `files: lib/invariant.js`) и требует сервис `invariants` (`src/invariant.ts:17`);
- сервис `@deepseek-ai/dsh-invariants` монтируется **только** бандлом `sdk-minimal` (`packages/bundle/sdk-minimal/cordis.patch.yml:107`) вместе с четырьмя companions (`:110-119`);
- ни один `cordis*.yml` в чекауте не содержит `@deepseek-ai/dsh-experimental-agent-team/invariant`, а `packages/bundle/base` и `packages/bundle/web-app` не упоминают `invariant` вообще;
- профильный слой `agent-team-profile/cordis.patch.yml:16-33` вставляет только `agent-team`, `tool-agent-team`, `ui-agent-team`.

Итог: проекция кандидата и «последнее валидное состояние» (`types.ts:111-113`, `projection.ts:225-239`) работают всегда — они часть самого пакета; а вот **отказ до append** в живом web-профиле, скорее всего, не действует. Я не проверял разрешённую композицию живого профиля (сторонние бандлы могли смонтировать `invariants`), поэтому формулирую как «не подтверждено», а не «опровергнуто».

Что это меняет: §17 нельзя переносить как «готовую гарантию»; при переносе паттерна в MyWork нужно сразу включить проверку в композицию (или, что уместнее для MyWork, — см. §68 ниже — сделать это CAS-precondition внутри транзакции, а не реплей-проекцией).

### §25. Agent Teams tools — **ПОДТВЕРЖДЕНО** (с уточнением)

Девять tools существуют и перечислены ровно в том порядке (`tool-agent-team/src/index.ts:175-391`); они регистрируются в **точном Agent-scope** каждого member'а и снимаются при `agent/disposed` (`:402-422`), а не глобально. Схемы одинаковы для Lead и teammate, role enforcement — в домене: `spawn_teammate` и `interrupt_agent` требуют Lead (`src/roster.ts:251-253`, `:206`), `reassign` — тоже (`src/task-board.ts:173`). Policy действительно запрещает создавать Team без явной просьбы пользователя (`tool-agent-team/src/index.ts:31`).

Уточнение: документ говорит «Все Team members видят одинаковые schemas» — это верно по схемам, но не по видимости: tools ставятся per-Agent, а `tryMembership` отсекает не-Team субагентов (`src/roster.ts:92-122`), поэтому набор tools у member'а появляется только после того, как он стал member'ом.

Что это меняет: вывод «не core admission path» подтверждён; для MyWork это означает, что модельные tools не должны иметь доступа к admission вообще (у них нет scheduler-порта, и это правильно).

### §26. Fresh/fork и SessionWindow — **ПОДТВЕРЖДЕНО**

DSH: `context: 'fresh' | 'fork'` — часть durable-снапшота (`src/types.ts:52`, `:170`), провайдер выбирается по контексту (`cordis.patch.yml:29-30`: `freshProvider: spawn`, `forkProvider: fork`), fork = «captures the Lead's completed-turn prefix once» (README:129), а сам fork-бэкенд передаёт сбалансированный префикс до последнего `turn/end` (`docs/subsystems/subagent.md:462`). Fresh/fork — неизменяемая часть identity: `projection.ts:261-263` отвергает смену `context` у существующего member'а.

MyWork-правила подтверждены: rollover сохраняет attempt (`core/src/session.ts:11` — «A rollover preserves the attempt (§22.5)»), baseline чеканит сессию на attempt (`:969`), а `sameAttempt` — предикат «продолжение того же attempt» (`:1025-1026`).

Что это меняет: запрет §26 на fork как default для worker Attempt подтверждён независимо: fork несёт незафиксированную историю Lead, а MyWork фиксирует revisions в attempt (`contracts/src/attempt.ts:119-120`, `FrozenRevisions`).

### §42. Сводная матрица — **ПОДТВЕРЖДЕНО** по всем строкам, кроме одной формулировки

Проверено по строкам: Team root = root SessionId (`types.ts:15-17`) ↔ Team/workspace config (`contracts/src/team.ts:390-404`); identity — rostered child Session ↔ `AgentIdentity`+`AgentInstance` (`team.ts:229`, `:335`); runtime — continuable child ↔ `AgentRuntimePort`/SessionWindow (`agent-runtime.ts:223`, `contracts/src/session.ts:145`); task authority — Lead log ↔ `TaskGraphPort` (`taskgraph.ts:343`); task states 4 ↔ 16 (`types.ts:71` ↔ `task.ts:11-63`); assignment — claim/reassign ↔ scheduler + claim saga (`scheduler/src/service.ts:108-111`, `execution/src/service.ts`); execution ownership — task owner ↔ Attempt+lease/fence (`attempt.ts:80-89`); review — нет домена ↔ `contracts/src/review.ts` (81 строка, отдельный домен); mailbox — built-in ↔ отсутствует (grep); persistence — Lead Session log ↔ TaskGraph + MyWork DB + Session + Artifact (`storage/src/outbox.ts`, `contracts/src/artifact.ts:28`); cross-process — не обещан (README:210) ↔ lease/fence (`lease/src/lease.ts`); context — fresh/fork ↔ Context Fabric (`contracts/src/context.ts:53-97`); memory — conversation ↔ Memory Fabric (`contracts/src/memory.ts`); write conflicts — advisory writeScopes ↔ нет поля (см. §14); human ask — child restricted ↔ `HumanGate` (`contracts/src/security.ts:171-193`); scheduler — model/user actions ↔ deterministic Scheduler.

Две неточности в этой таблице, найденные сверкой:
1. Строка «Write conflicts | advisory writeScopes | можно усилить на Attempt/Plan» — в MyWork сейчас **нет ни одного** из этих полей, поэтому это не «усиление», а новая функциональность.
2. Строка «Install | one optional bundle | следует повторить bundle pattern» — **УСТАРЕЛО**: pattern уже повторён. `packages/controller/cordis.patch.yml:12-14` вставляет строку `mywork-controller` → `@dsh-mywork/controller`, а `scripts/verify-profile.mjs` проверяет публикационную форму end-to-end: `BUNDLE = '@dsh-mywork/controller'` (`:27`), наличие пакета в `dependencies` и в `dsh.profile.bundles` (`:188-191`), присутствие слоя `# == @dsh-mywork/controller` и разрешённой строки в собранной конфигурации (`:210-212`). То есть §42 в этой строке описывает уже сделанное как предстоящее.

### §43. Что переносим — **ПОДТВЕРЖДЕНО**, список полный, но неполно обоснован

Все 16 пунктов имеют подтверждение в DSH-коде (см. §9–§17 выше). Из списка стоит выделить два, которые документ перечисляет, но не объясняет, **почему** они работают:
- «durable intent before external runtime side effect» — работает потому, что identity чеканится до side effect (`src/roster.ts:259`), а не потому, что «сначала пишем событие»;
- «delivery ack after target durability» — работает потому, что receipt ищется в логе **самой цели** (`mailbox.ts:301-306`), то есть ack проверяем независимо от процесса-отправителя.

Что это меняет: при переносе в MyWork эти два механизма надо копировать буквально (pre-minted id + проверка receipt по durable-логу цели), иначе получится «append ради append».

### §44. Что не переносим — **ПОДТВЕРЖДЕНО**

Каждый пункт имеет доказательство: TeamTask ≠ canonical Task (§13 + `taskgraph.ts:9-14`); TeamId == SessionId (`types.ts:15-17`); Lead log как system of record (README:105); 4-state lifecycle (`types.ts:71`); manual spawn как scheduler (policy `tool-agent-team/src/index.ts:31` + `service.ts:108-111`); process-local как достаточная durability (README:106, `:210`); shared cwd как deployment contract (README:206); task owner ≠ lease (README:209); no automatic owner release (README:209); peer message ≠ trusted instruction (§12); conversation-header panel ≠ основная UI (README:179).

### §45. Опциональный Agent Coordination subsystem — **ОТСУТСТВУЕТ В ПЛАНЕ** (и это правильно)

В MyWork нет ни `contracts/coordination.ts`, ни `core/coordination.ts`, ни пакета `coordination-runtime` (файлы отсутствуют в `packages/contracts/src` и `packages/core/src`; grep по `coordination` — без совпадений).

**Аргументы против создания сейчас:** (1) потребителя нет — сам документ в §11 называет mailbox «не prerequisite Board», а Board v0.3 — текущий приоритет; (2) это второй путь доставки контента в разговор со своими правилами доверия и бюджета, тогда как §12 решается классом `dependency-result` бесплатно; (3) у MyWork уже есть durable queue и dedup (`outbox.ts`, `inbox.ts:51-73`), поэтому новый пакет добавит в основном **новую authority**, а не новую возможность; (4) fencing контроллера уже есть (`lease/src/lease.ts:292-303`), и дублировать его в coordination-домене — путь к двум источникам истины.

**Аргументы за (если peer collaboration войдёт в scope):** живая координация между двумя attempt'ами одного workspace не выражается ни TaskGraph, ни Artifact — это единственная ниша, которую нечем закрыть.

**Минимальная граница ответственности (если строить):** `AgentCoordinationPort` с операциями `enqueue(request) → {messageId, status}`, `ack(messageId)`, `pending(targetId)`, `waitForChange(targetId, timeoutMs, signal)`; durable — строка в outbox MyWork DB (`eventId = messageId`, `consumer = targetInstanceId`), dedup — `inbox.applyOnce`; ordering — per-target; fence — `controllerEpoch` в каждой записи; bounds — типизированные ошибки `COORDINATION_QUEUE_FULL` / `COORDINATION_MESSAGE_TOO_LARGE`. Явно **не** входит: TaskGraph, scheduler, assignment, review, memory, artifact authority (совпадает с §45 документа). Acceptance-гейт §61 при этом надо дополнить двумя пунктами, которых там нет: «message не является instruction-классом контекста» и «overload не ретраится отправителем» (последнее DSH формулирует прямо: «without encouraging retry after enqueue», `tests/team.spec.ts:1304`).

### §46. Handoff Artifact — **ПОДТВЕРЖДЕНО** как предпочтительная альтернатива, и в MyWork он дешевле, чем в документе

Механизм доставки уже существует: класс `dependency-result` (`contracts/src/context.ts:67`) — не mandatory, не instruction, со своим bucket'ом (`:452-456`) и лимитом (`:476-477`). Хранилище тоже есть: `Artifact` с закрытым списком видов (`contracts/src/artifact.ts:31-75`) и метаданными, включая `taskId/attemptId/causationId` (`:82-96`). Чего нет: вида артефакта для передачи работы и схемы payload'а. Ближайший существующий вид — `worker-report` (`:45`), но это отчёт о своей работе, а не адресованная передача преемнику; смешивать их нельзя, иначе provenance «кто кому передал» теряется.

Предлагаемый формат — **не** новый пакет, а новый вид артефакта `handoff` + схема `mywork.handoff/v1` со ровно шестью полями из §46: `summary: string`, `changedFiles: readonly string[]`, `assumptions: readonly string[]`, `unresolvedQuestions: readonly string[]`, `evidenceRefs: readonly ArtifactRef[]`, `nextAction: string`. Плюс обязательная привязка: `taskId`, `attemptId` (от кого), `causationId` (какой attempt его запросил). Рендер в контекст — как `dependency-result` item со ссылкой `ArtifactRef` (`:129-137`) и ленивой материализацией L1/L2, а не как полный текст.

Что это меняет: §46 перестаёт быть «альтернативой, которую стоит рассмотреть» и становится самым дешёвым пунктом плана: одно значение enum, одна схема payload'а, один провайдер контекста.

### §61. Acceptance gate: optional Coordination — **ЧАСТИЧНО**

Десять пунктов гейта разумны, но три из них уже обеспечены существующими механизмами MyWork, и это стоит записать, чтобы не строить их заново: «stable MessageId» и «durable enqueue до success» — это `outbox` + `EventId` (`storage/src/outbox.ts:47-70`); «target dedup после restart» — `inbox.applyOnce` (`inbox.ts:51-73`); «stale controller epoch не dispatch/ack» — `holdsLeadership(scopeId, instanceId, epoch, at)` (`lease/src/lease.ts:292-303`). Не покрыты гейтом и должны быть добавлены: per-target ordering (в DSH это `dispatchTails`, `mailbox.ts:193-209`), поведение при переполнении (типизированный отказ, а не drop), и «late ack» — ack, пришедший после того, как attempt отозван.

### §66. Что делать с Agent Teams сейчас — **ПОДТВЕРЖДЕНО**, с одной поправкой к механике запрета

Рекомендация «не добавлять experimental Agent Teams dependency в MyWork core» верна, но **механически она сейчас не enforced полностью**: `tests/boundaries.test.mjs:17-25` перечисляет только `@deepseek-ai/cordis`, `beads`, `hindsight`, `openviking`, `sqlite`, `better-sqlite3`, `node:sqlite`; ни одного шаблона `@deepseek-ai/dsh-*` там нет. Source-скан покрывает только `contracts` и `core` (`:111-114`), storage/evidence/lease/execution — своими списками (`:117-124`, `FORBIDDEN_FOR_STORAGE` `:127-133`), а `scheduler`, `planner`, `memory-native`, `beads-adapter`, `adapter-sdk` не сканируются вовсе (grep по `scheduler|planner|memory-native|beads-adapter` в файле — без совпадений). Built-artifact проверки покрывают contracts/core/controller (`:186-198`), storage (`:242`), evidence (`:326`), lease (`:407`), execution (`:480`) — scheduler и planner снова нет.

Итог: импорт `@deepseek-ai/dsh-experimental-agent-team` в `packages/scheduler/src` не поймает ни один существующий тест. Это единственная правка, которую §66 требует в план (см. §3 отчёта).

Сам spike «AgentRuntime adapter over continuable DSH subagents» полезен и хорошо ложится на существующий конформанс-кит: `adapter-sdk/src/conformance.ts:419-438` уже перечисляет проверки `agent-runtime` — `create`, `resume`, `stop`, `status`, late event, cancellation, process restart.

### §67. Заменять ли AgentRuntimePort — **ПОДТВЕРЖДЕНО** («нет»)

Порт имеет ровно те пять операций, что названы в документе: `start`, `resume`, `status`, `stop`, `events` (`contracts/src/agent-runtime.ts:223-258`), причём `stop` документирован как неразрушающий («never destructive: the session record survives as evidence», `:245-250`), а §39-список проверок вынесен в conformance-кит (`adapter-sdk/src/conformance.ts:438`). Реализация для DSH существует и регистрируется как адаптер (`packages/controller/src/dsh-session.ts:426`, `:695`), а фейк для тестов — в `adapter-sdk/src/testing.ts:332`.

Что это меняет: ничего; вывод §67 подтверждён и подкреплён тем, что замена порта потребовала бы переписать `tests/runtime.test.mjs` (643 строки) и конформанс-кит.

### §68. Переносить ли whole-snapshot events — **ПОДТВЕРЖДЕНО** («только локально»)

В DSH whole-snapshot — это `TeamMemberSnapshot`/`TeamTaskSnapshot` с revision и строгой схемой реплея (`src/types.ts:73-83`, `projection.ts:248-310`), с континуальностью revision (`projection.ts:277-279`) и терминальным `failure`, сохраняющим последнее валидное состояние (`types.ts:111-113`). Для MyWork это не нужно: TaskGraph — authority (см. §4), MyWork DB — authority для attempts/reviews, а долговечность обеспечивает транзакционный outbox (`storage/src/outbox.ts:2`) и inbox dedup (`inbox.ts`).

Важная адаптация, которой нет в документе: у MyWork нет и не должно быть реплей-проекции перед append — у него есть **транзакция**. Эквивалент «invariant companion» здесь — валидация внутри той же транзакции, что и запись (как `claim_intent`-CAS `execution/src/store.ts:219-256` и уникальные индексы `execution/src/schema.ts:88-115`), а не слушатель на dispatch. Это и проще, и строже: отказ не требует «не публиковать событие», потому что запись ещё не произошла.

### §69. «no automatic owner release» подтверждает lease model — **ПОДТВЕРЖДЕНО** и усилено

DSH формулирует сильнее, чем документ: «No automatic ownership release — inactivity, interruption, process exit, and failed work do not release a task owner» (README:209), а `interrupt()` «neither releases task ownership nor deletes durable mail» (README:143; код — `src/roster.ts:204-215`, тест `tests/team.spec.ts:1335`).

MyWork-сторона: все четыре требования §69 уже реализованы для attempt-пути. «stale runtime revoke» — `settleAttempt(..., 'revoked', ...)` (`execution/src/service.ts:1092`, `:1184`); «late result rejection» — fence против **токена задачи**, затем epoch (`:405-429`, ошибка `STALE_FENCE` `:411-418`), тест `tests/claim-saga.test.mjs:367`; «successor Attempt» — суперсессия живого attempt при создании нового (`:348-390`, `:366`), монотонный аллокатор fence (`store.ts:289-319`, тест `claim-saga.test.mjs:513`); «controller recovery» — `recover`/`revoke` с запретом трогать чужой live lease (`:1159-1215`, тесты `claim-saga.test.mjs:658`, `:794`), плюс отказ заселения после отзыва (`claim-saga.test.mjs:865`).

Что это меняет: §69 не требует новых карточек, но требует **не ослаблять** уже сделанное; отдельно стоит назвать пробел (см. §4 отчёта): отклонённый поздний результат **не оставляет audit-строки** (MW-012 §8 п.7), то есть оператор не увидит, кто пытался заселить отозванный attempt.

### §70. Shared checkout — **ПОДТВЕРЖДЕНО**

DSH: «One process and one shared checkout — members share cwd and observe edits immediately; this package provides no worktree, remote member, merge, or filesystem lock» (README:206), «Advisory write scopes — Bash, formatters, code generators, and direct external writers can bypass filesystem version checks; Leads must coordinate ownership and review the final diff» (README:207). MyWork не обязан создавать worktree автоматически, и это согласуется с тем, что `WorktreeRef` в контракте **опционален** (`contracts/src/attempt.ts:121-122`: «Isolated worktree, when the workspace is a git repository»).

Что это меняет: §70 подтверждает, что workspace isolation — pluggable policy, а не обязательство; в плане это уже отражено опциональностью `WorktreeRef`, менять нечего. Единственное, что стоит зафиксировать явно: `writeScopes` (если появятся) не должны притворяться isolation primitive — в DSH они таковыми не являются (README:207), и в MyWork их не должно быть в admission-гейте.

## 3. Правки к плану MyWork

Правки сформулированы как «что меняется → почему → чем проверяется». Ни одна из них не выполнена: это предложения к плану, а не сделанная работа.

### 3.1. Новая карточка: Agent Instance provisioning saga (группа `01-runtime`)

**Что меняется.** Новый контракт `contracts/src/provisioning.ts` и реализация в `packages/execution` (или отдельный `packages/provisioning`), плюс запись в MyWork DB рядом с `claim_intent` (`execution/src/schema.ts:88-115`). Зависимости: MW-009 (epoch/lease), MW-012 (сага), MW-015 (AgentRuntime).

**Структура записи (предлагаю буквально):**

```ts
type ProvisioningStep = 'intent' | 'session-created' | 'scope-pinned' | 'prompt-enqueued' | 'active'
type ProvisioningState = 'planned' | 'provisioning' | 'active' | 'failed' | 'revoked' | 'orphan-drained'

interface AgentInstanceProvisioning {
  readonly operationId: OperationId        // идемпотентность, как в claim-саге
  readonly controllerEpoch: ControllerEpoch // fence: старый контроллер не продолжает сагу
  readonly agentId: AgentId                // durable identity (contracts/src/team.ts:229)
  readonly instanceId: AgentInstanceId     // чеканится САГОЙ до start()
  readonly attemptId?: AttemptId           // связь с attempt (contracts/src/attempt.ts:104)
  readonly sessionId?: SessionId           // реальный id, как его вернул runtime
  readonly requested: { preset: string; model?: AgentModelSelection; permission?: HarnessPolicy }
  readonly steps: readonly { kind: ProvisioningStep; state: 'pending' | 'applied' | 'failed'; detail?: string }[]
  readonly state: ProvisioningState
  readonly failure?: string
  readonly startedAt: EpochMs
  readonly settledAt?: EpochMs
}
```

**Почему именно так.** Пять шагов совпадают с уже принятой в проекте дисциплиной журнала: `STEP_ORDER` claim-саги — `['intent','claim','attempt','projection','complete']` (`execution/src/service.ts:165-166`), и та же тройка правил («intent durable before external effect», «success is an observation», «authority на трёх осях») уже сформулирована в заголовке `execution/src/service.ts:9-24`. Ключевое заимствование из DSH — **чеканить `instanceId` до вызова runtime** (`src/roster.ts:259`): тогда recovery ищет сессию по известному id, а не по эвристике.

**Шаги recovery (то, чего нет ни в документе, ни в плане):**

| Состояние записи | Что видно в мире | Действие recovery | Кто решает |
|---|---|---|---|
| `planned`, шаг `intent` не applied | ничего | закрыть как `failed` (abandon), ничего не откатывать | автоматически |
| `intent` applied, `session-created` pending | сессии с `instanceId` нет | повторить `start()` один раз с тем же `instanceId`; runtime обязан отвергнуть дубликат (`AgentRuntimePort.start` — «the runtime rejects a duplicate», `agent-runtime.ts:68-69`) | автоматически |
| `session-created` applied, `scope-pinned` pending | сессия есть, scope неизвестен | `resume(sessionId)` и **повторно** применить scope (idempotent по контракту `:231-237`) | автоматически |
| `scope-pinned` applied, `prompt-enqueued` pending | сессия есть, промпта нет | `resume` + admit prompt с тем же `runId`; перед admit прочитать лог сессии на наличие промпта | автоматически |
| `prompt-enqueued` applied, `active` pending | промпт в логе | дописать `active`; повторный admit запрещён | автоматически |
| `active`, но instance исчез | сессия жива | не воскрешать: `settling`/`failed` через attempt-путь, Session остаётся evidence (`agent-runtime.ts:245-250`) | автоматически |
| шаг `failed` + `attemptId` есть | attempt жив | `revoke` attempt (как §49), instance → `revoked` | автоматически |
| epoch записи < текущего epoch контроллера | любое | **не продолжать**: пометить `orphan-drained`, отдать решение новому контроллеру | автоматически + запись в audit |
| расхождение `requested.preset/model` с фактическим scope сессии | любое | остановить и поднять `needs-attention` с причиной | **человек** |

Последняя строка — единственная, где нужен человек: смена preset/model — это смена контракта исполнения, а не восстановление.

**Чем проверяется.** Новый `tests/provisioning.test.mjs` по образцу `tests/claim-saga.test.mjs:1020`/`:1065` (процесс, убитый между шагами, оставляет ровно одну запись и не создаёт второй сессии); mutation-батарея на «шаг applied без наблюдения»; прогон `pnpm run check`.

### 3.2. Новая карточка или расширение MW-022/MW-044: advisory write scopes на уровне Attempt

**Что меняется.** Тип в `contracts/src/attempt.ts` (не в `task.ts`!) и, опционально, в `contracts/src/plan.ts`:

```ts
interface WorkIntentScope { readonly path: string; readonly mode: 'read' | 'write' }
// Attempt: readonly writeIntents?: readonly WorkIntentScope[]
// PlanChange (при планировании): readonly writeIntents?: readonly WorkIntentScope[]
```

**Почему на Attempt, а не на Task.** `Task` — чужая authority: TaskGraph владеет описанием, зависимостями, readiness и final completion (`taskgraph.ts:9-14`), а `tests/authority.test.mjs:61` фиксирует, что Board — проекция, а не конкурирующая authority. Добавление write-intent в `Task` создало бы второго писателя в чужую сущность. `Attempt` — MyWork-сущность (`contracts/src/attempt.ts:104-127`), и файлы действительно становятся известны после планирования, как и говорит §14.

**Где хранится.** MyWork DB, рядом с attempt (в `controller.sqlite`, как fence/attempt — MW-012 §8 п.8), индекс по `(workspaceId, path)`; предупреждения **не хранятся**, а выводятся на чтение (как в DSH: `task-view.ts:43-49` считает их каждый раз).

**Семантика — копировать у DSH буквально:** нормализация префикса с запретом абсолютных путей, `..` и пустых сегментов (`validation.ts:26-34`); пересечение по компонентам пути (`task-view.ts:14-16`); предупреждение только против **активных** attempt'ов; claim/admission не читает поле вовсе (`task-board.ts:133`); в README-предупреждении — что shell/форматтеры/генераторы обходят проверку (README:207).

**Чем проверяется.** Тест «write intent не влияет на admission» (два attempt'а с пересечением стартуют оба), тест нормализации (абсолютный путь и `..` отвергаются), тест на то, что предупреждение исчезает при завершении соседа. Граница: если попытка ввести write-intent в `Task` — тест `boundaries`/`authority` должен падать.

### 3.3. Новая карточка: Handoff Artifact (зависит от MW-008 evidence, MW-016 Context Fabric)

**Что меняется.** (а) `contracts/src/artifact.ts`: добавить `'handoff'` в `ArtifactKind` (`:31-60`) и в `ARTIFACT_KINDS` (`:62-75`) — аддитивно, без переинтерпретации существующих видов; (б) новая схема payload'а `mywork.handoff/v1` (шесть полей из §46 + `nextAction`); (в) провайдер контекста, отдающий handoff классом `dependency-result` со ссылкой `ArtifactRef`.

**Почему.** `dependency-result` не mandatory и не instruction (`context.ts:108-129`), имеет свой bucket (`:452-456`) и лимит (`:476-477`) — то есть §12 (peer content как данные) и §46 (структурированная передача вместо чата) закрываются одним и тем же механизмом. `worker-report` (`artifact.ts:45`) для этого не годится: это отчёт о своей работе, а handoff адресован преемнику, и смешение теряет provenance «кто кому передал».

**Формат (предлагаю):**

```ts
interface HandoffPayload {
  readonly summary: string
  readonly changedFiles: readonly string[]
  readonly assumptions: readonly string[]
  readonly unresolvedQuestions: readonly string[]
  readonly evidenceRefs: readonly ArtifactRef[]   // artifact.ts:129-137
  readonly nextAction: string
}
// метаданные артефакта: taskId (задача-приёмник), attemptId (от кого), causationId (чей запрос)
```

**Чем проверяется.** Тест «handoff рендерится как data, а не как instruction» (по образцу `tests/context.test.mjs:791`), тест «handoff не превышает bucket `dependencies`» (по образцу `:771`), тест «handoff без `evidenceRefs` отвергается» (пустая передача не должна выглядеть как результат).

### 3.4. Правка §66: закрыть дыру в boundary-тесте

**Что меняется.** `tests/boundaries.test.mjs`: добавить в `FORBIDDEN` (`:17-25`) и `FORBIDDEN_FOR_STORAGE` (`:127-133`) шаблон `'@deepseek-ai/dsh'` (подстрока, как устроен матчинг `:170`, `:221`), расширить source-скан на `scheduler`, `planner`, `adapter-sdk`, `memory-native`, `beads-adapter`, и добавить built-artifact проверки для `packages/scheduler/lib/index.js` и `packages/planner/lib/index.js`.

**Почему.** Сейчас импорт `@deepseek-ai/dsh-experimental-agent-team` в `packages/scheduler/src` не поймает ни один тест: список запрещённых содержит только `@deepseek-ai/cordis` (`:17-25`), source-скан покрывает `contracts`+`core` (`:111-114`) и четыре отдельных слоя (`:117-124`), а `scheduler`/`planner` не упоминаются в файле вовсе (grep — без совпадений). То есть рекомендация §66 «не добавлять Agent Teams dependency в MyWork core» сегодня держится на дисциплине, а не на тесте.

**Чем проверяется.** Временный импорт DSH-пакета в `packages/scheduler/src` в **отдельном worktree** должен валить тест; в живом дереве — только прогон нового теста на текущем коде (зелёный).

### 3.5. Что менять не нужно (зафиксировать как «не трогать»)

- `AgentRuntimePort` (§67) — не заменять и не расширять: пять операций + conformance-кит (`adapter-sdk/src/conformance.ts:419-438`).
- TaskGraph authority (§4.1) — не добавлять writable-зеркало TeamTask.
- Scheduler — не добавлять LLM/порт модели: тест `tests/scheduler.test.mjs:921` это уже запрещает.
- §45 coordination — не создавать пакет (см. §2 §45 и §4 отчёта).

### 3.6. Правка приоритетов в плане

`MW-014` §7 п.8 фиксирует, что фазовые потолки `maxConcurrentLlm`/`maxHeavyTools` сейчас не исполняет никто в дереве. Это не дефект карточки, но это значит, что до MW-022/MW-044 §15 неполон: планировщик гарантирует только «не добавляю работу к насыщенному ресурсу». Стоит либо назвать это в acceptance §15, либо добавить пункт в MW-022. То же — по `MW-012` §8 п.3: истечение lease не проверяется при `settle` (policy истечения отнесена к reconciler'у, которого ещё нет).

## 4. Новое, чего не было в документе и в плане

Оценки: усилие S/M/L, влияние (на корректность/цену), риск.

**N-01. Invariant companion опубликован, но не смонтирован — «отказ до append» в этом профиле не действует.** Доказательство: `agent-team/package.json` (exports `./invariant`), `src/invariant.ts:17` (`inject = ['invariants']`), `packages/bundle/sdk-minimal/cordis.patch.yml:107` — единственный монтаж сервиса `invariants`, и ни один `cordis*.yml` не содержит `agent-team/invariant`. **Усилие S** (две строки в композиции), **влияние M** (fail-fast на порче Team-стрима), **риск L** (проверка не блокирует корректные события). Что делать: если переносить §17 в MyWork — не полагаться на «компаньон уже есть», а проверять его наличие тестом композиции.

**N-02. `wait_agent` имеет короткий путь `noProgress`, которого нет в §15.** Доказательство: `tool-agent-team/src/index.ts:39-40`, `:252-274`; статус `provisioning` считается активным (`:39`), `inactive` — нет. **Усилие S** (правка спеки), **влияние M** (иначе worker спроектирует ожидание «до изменения» и будет простаивать), **риск L**. Что делать: в MyWork-эквиваленте wait-for-change обязательно вернуть причину «некому менять состояние».

**N-03. Граница сообщения считается по sender-framed доставке.** `mailbox.ts:137-139` + `:309-314`: лимит применяется к `JSON.stringify([{text: 'Team message <id> from <name>:'}, ...content])`. **Усилие S**, **влияние L** (расхождение на десятки байт), **риск L**. Что делать: при переносе формулировать лимит как «размер полной доставки» и тестировать на границе.

**N-04. Для mailbox в MyWork уже есть durability: outbox + inbox dedup.** `storage/src/outbox.ts:2`, `inbox.ts:51-73`. **Усилие S** (использовать), **влияние M** (не строить второй журнал), **риск L**. Что делать: если coordination когда-нибудь появится — строить его на этой паре, а не на новом append-only логе.

**N-05. Context Fabric уже даёт §12 и §46 бесплатно.** `dependency-result` не mandatory и не instruction (`context.ts:108-129`), имеет bucket и лимит (`:452-456`, `:476-477`); тесты `tests/context.test.mjs:343`, `:791`. **Усилие S**, **влияние M**, **риск L**. Что делать: handoff и любые peer-данные доставлять этим классом; не вводить новый класс доверия.

**N-06. Переносимый трюк provisioning-саги — pre-minted identity, а не «сначала событие».** `roster.ts:259` (`childId` чеканится до `startContinuable`), `:282-291`, и только потом `:314-336` терминальный edge. **Усилие S** (одно проектное решение), **влияние L** (без него recovery вынужден угадывать сессию), **риск M** (требует, чтобы runtime принимал id извне — у MyWork `AgentStartRequest.runId` уже caller-owned, `agent-runtime.ts:67-69`). Что делать: закрепить в контракте провижининга.

**N-07. Два контроллера (split-brain) — это не пробел дизайна MyWork, а пробел интеграции.** Проверено: `tests/lease.test.mjs:125` («two controllers never both become writer»), `:380` («two controllers on one file: only one holds the lease at any instant»), `:455` (БД не даёт понизить epoch), `:281` («a superseded epoch cannot commit, and cannot resurrect itself»). Но планировщик в resident controller не смонтирован, и конкурентность двух контроллеров на пути scheduler→admission не проверялась (MW-014 §7 п.4, п.12). **Усилие M** (композиция + интеграционный тест), **влияние L** (это ровно тот класс отказов, который §69 называет, но не проверяет end-to-end), **риск M**. Что делать: интеграционный тест «второй контроллер поднимается при живом первом → ни одного admission от пассивного».

**N-08. Backpressure асимметричен: у DSH типизированный отказ, у MyWork политики деградации нет.** DSH: `TEAM_MAILBOX_FULL` (`mailbox.ts:124-129`), `TEAM_MESSAGE_TOO_LARGE` (`:137-139`), `TEAM_MEMBER_LIMIT` (`roster.ts:274-276`), `TEAM_TASK_LIMIT` (`task-board.ts:49-51`), и тест «without encouraging retry after enqueue» (`tests/team.spec.ts:1304`). MyWork: §16.3 `backlog pressure` и `deadline` не реализованы, потому что в `Task` нет полей (`MW-014` §7 п.2). **Усилие M**, **влияние M**, **риск M** (нужно решение TaskGraph-владельца о полях). Что делать: карточка на `deadline`/`labels` в TaskGraph metadata + политика деградации (сначала ревью, потом новые attempt'ы).

**N-09. Дедлок «двое ждут друг друга» не покрыт нигде.** DSH: `wait_agent` не будит inactive member'ов и честно возвращает `noProgress` (`tool-agent-team/src/index.ts:244`, `:264-272`), но если два teammate'а взаимно ждут, цикл разрешается только таймаутом (10 000…3 600 000 мс, `activity.ts:23-25`). MyWork: DAG-циклы отвергаются (`task-graph.ts:54-68`), но цикл «review → changes-requested → новый attempt → снова review» — не DAG-цикл и никак не ограничен. **Усилие M**, **влияние M**, **риск M**. Что делать: счётчик попыток на задачу (§30 `maxAttempts` budget уже есть, `contracts/src/scheduler.ts:209-213`) + эскалация в `needs-attention` при исчерпании.

**N-10. «Late result после revoke» реализован, но не наблюдаем.** `execution/src/service.ts:411-418` (`STALE_FENCE`), `:865`-тест (заселение после отзыва отвергнуто), и MW-012 §8 п.7: отклонённый поздний результат **не пишет audit-строку** (осознанно: не давать неавторизованному писать в append-only журнал). **Усилие S/M**, **влияние M** (оператор не видит, кто пытался), **риск M** (любая запись на отказ — это запись от неавторизованного). Что делать: писать отказ не в audit, а в отдельный rate-limited счётчик отказов (метрика), либо в telemetry-канал, который не является журналом домена.

**N-11. Повторная доставка после restart — не только dedup, но и порядок.** DSH: `tests/persistence.spec.ts:284` («retries queued mail through cold-resume Steer after restart»), `:332`, `:439`; реализация — `recoverFor` фильтрует queued-minus-delivered и диспатчит **в durable-порядке** (`mailbox.ts:86-98`, `:212-232`). Документ §10.3 описывает dedup, но не порядок восстановления. **Усилие S** (учёт в спеке), **влияние M** (иначе после рестарта сообщения придут переставленными), **риск L**.

**N-12. Стоимость steer и прерываний в документе не оценена, а DSH её измеряет.** README:187-195 (Model Experience): каждое peer-сообщение — user-role блок, который «adds the sender prefix plus message content to the target history», а cold resume переиспользует персистентный префикс (KV-cache эффект). Документ обсуждает семантику доставки (§10.2) и бюджет контекста (§12), но не связывает их. **Усилие S**, **влияние M** (peer-chatter может съесть bucket `dependencies`), **риск L**. Что делать: в MyWork peer/handoff контент обязан идти через `dependency-result` (N-05) именно поэтому — это единственный способ удержать его в бюджете.

**N-13. Лимиты конкурентности на провайдера/маршрут отсутствуют.** `SchedulerLimits` знает `maxAttempts`, `maxConcurrentLlm`, `maxHeavyTools` (`contracts/src/scheduler.ts:214-228`), а лимитов «сколько одновременных attempt'ов на один провайдер/модель» нет ни в MyWork, ни в DSH. При этом маршрут выбирается по каталогу (`readRouteAvailability`, `core/src/scheduler.ts:176`). **Усилие M**, **влияние M** (один провайдер может стать горлышком), **риск M**. Что делать: карточка на `SchedulerLimits.providerConcurrency` + saturation-проверка по каталогу; без этого `route-unavailable` покрывает только «модель не объявлена», а не «провайдер перегружен».

**N-14. Групповых бюджетов нет ни в документе, ни в коде.** `BudgetScope`/`BudgetLimits` существуют (`contracts/src/budget.ts`), гейт читает их в `budgetVerdict` (`core/src/scheduler.ts:554`), тесты `tests/budget.test.mjs:363` («the per-day scopes are checked against their own ledgers»). Но бюджета «на команду/эпик/workspace-за-сутки» в модели нет: scope'ы привязаны к работе, не к группе. **Усилие M/L**, **влияние M**, **риск M**. Что делать: не добавлять сейчас; если понадобится — новый scope-kind на уровне workspace/epic, а не новый бюджетный движок.

**N-15. Эскалация зависшей работы не определена.** DSH не имеет детектора зависания: единственный ограничитель — таймаут ожидания (`activity.ts:23-25`) и `disposalTimeoutMs` (`lifecycle.ts:71-86`). В стороннем плагине доски (профиль `web`) есть `autoRunStallMinutes: 30` — то есть практика такая существует, но в DSH-домене её нет. В MyWork каталог триггеров `needs-attention` закрыт и полон (`contracts/src/board.ts:350-372`), но политики «когда эскалировать» нет. **Усилие M**, **влияние M**, **риск L**. Что делать: карточка «stall detection» на уровне controller: attempt без события дольше N → `needs-attention` с триггером из существующего каталога.

**N-16. Handoff дешевле mailbox ещё и по аудиту.** Handoff — артефакт с hash и метаданными (`artifact.ts:82-96`), то есть его можно проверить постфактум; peer-сообщение в DSH живёт только в логе целевой сессии (README:187). **Усилие S** (следствие N-05), **влияние M**, **риск L**.

**N-17. Пункт «повторить bundle pattern» уже выполнен, и его проверка сильнее, чем у DSH.** `packages/controller/cordis.patch.yml:12-14` + `scripts/verify-profile.mjs:27`, `:188-191`, `:210-212` проверяют не только наличие строки, но и публикационную форму: пакет в `dependencies`, пакет в `dsh.profile.bundles`, слой `# == @dsh-mywork/controller` в собранной конфигурации и разрешение строки. У DSH аналог — `agent-team-profile/cordis.patch.yml` + `tests/profile.spec.ts:46` (проверка `config: { maxMembers: 8 }`). **Усилие S** (убрать пункт из плана), **влияние L** (не делать работу дважды), **риск L**. Что делать: в §42/§43 заменить «следует повторить» на «повторено, форма проверяется `pnpm run verify:profile`».

## 5. Открытые вопросы и что я НЕ проверял

1. **Разрешённая композиция живого профиля.** Я проверил, что профиль `web` объявляет бандл `@deepseek-ai/dsh-experimental-agent-team-profile` (`C:\Users\Dmitry\.dsh\profiles\web\package.json:32`) и что профильный слой задаёт `maxMembers: 8` (`agent-team-profile/cordis.patch.yml:20`), но **не** проверял эффективную собранную композицию: `cordis.yml` профиля — пустой список (`[]`), дерево собирается из бандлов и `cordis.patch.yml`, а сторонние бандлы (`dshmarket`, `@linxin666/dsh-web-all`, `misakanet` и др.) могли смонтировать `invariants` или переопределить конфиг Team. Поэтому: (а) `maxMembers: 8` — «объявлено в слое», а не «измерено в рантайме»; (б) активность invariant companion в живом профиле — «не подтверждена». Проверять надо `plugin_manager list_plugins` / разрешённый дамп композиции, чего я не делал (действие требует расширенных прав).
2. **Живое поведение Team-инструментов не измерялось.** По условию я не вызывал `spawn_teammate` и не создавал агентов; схемы tools изучены как наблюдаемая спецификация (они совпадают с `tool-agent-team/src/index.ts:175-391`), но ни один bound (`maxMembers: 8`, `TEAM_MEMBER_LIMIT`, `TEAM_MAILBOX_FULL`) не наблюдался на живом отказе.
3. **Проверка «отвергается до append» не воспроизводилась экспериментом.** Механика подтверждена чтением (`Session.append`: callbacks до `log.push`, `packages/core/session/src/index.ts:759-761`) и комментарием `session-title/src/invariant.ts:66-67`, но я не поднимал Team-сервис с включённым `invariants` и не наблюдал `InvariantError`. Плюс не проверял экспериментально, вызывает ли `ctx.events.dispatch('emit', ...)` слушателей `internal/dispatch` до возврата — это следует из кода Cordis, а не из моего прогона.
4. **DSH-тесты Agent Teams не запускались.** Я читал `tests/team.spec.ts`, `persistence.spec.ts`, `invariant.spec.ts`, `projection-events.spec.ts` и цитирую имена тестов как заявленное покрытие, но не прогонял их (в DSH-checkout тесты требуют сборки/окружения, и это чужое дерево). Все ссылки вида `tests/team.spec.ts:235` — «тест с таким именем существует», а не «тест зелёный».
5. **MyWork-тесты прогонялись выборочно.** Зелёными получены `scheduler`, `attempt`, `lease`, `authority`, `team` (83 pass, exit 0) и `claim-saga`, `boundaries`, `storage-crash` (60 pass, exit 0). Не запускались: `plan-mutation` (2 368 строк), `beads-adapter` (23 теста требуют живого `bd`), `memory*`, `context`, `board`, `config`, `security`, `session`, `skill`, `evidence`, `adapters`, `budget`, `review`, `routing`, `runtime`, `events`, `guards`, `task`, `storage`. Утверждения о `board`/`context`/`budget` опираются на код и имена тестов, не на прогон.
6. **Живой `bd`/Beads не использовался.** Как и в MW-012 §8 п.1: поведение `bd update --claim` относительно `revision` не проверено; риск «шаг 4 устаревает на happy path» остаётся открытым и не моя зона.
7. **Стоимость (токены/деньги) не измерялась.** Ни одного платного вызова; все оценки стоимости steer/прерываний — из документации DSH (README:187-195), а не из замеров.
8. **Два контроллера end-to-end не проверялись.** Тесты lease покрывают два контроллера на одном файле (`tests/lease.test.mjs:125`, `:380`, `:455`), но композиции scheduler→admission под двумя контроллерами не существует (MW-014 §7 п.4), поэтому split-brain на уровне оркестрации не проверен никем, включая меня.
9. **Не проверял §5–§7, §18–§24, §27–§41, §47–§60, §62–§65, §71–§74** — это зона других потоков; пересечения с моими выводами (`§29 HumanGate`, `§31 security`) я упоминал только там, где они нужны для §45/§61.
10. **`HumanGate` в MyWork — это тип, а не домен.** `contracts/src/security.ts:171-193` содержит `HumanGate` и `DOMAIN_IMPLIED_GATES`; отдельного пакета/домена HumanGate нет. Полноту §29 я не оценивал (владелец §29 — не мой поток).
11. **Вопросы, на которые я не нашёл ответа в коде и не стал домысливать:** (а) есть ли у DSH механизм принудительного освобождения owner при не-`interrupt` завершении (например, при `agent/disposed`) — в `roster.ts` такого пути нет, но полный аудит подписок я не делал; (б) как поведёт себя `waitForChange`, если `notify` придёт между чтением roster и регистрацией waiter'а в `wait_agent` — комментарий `tool-agent-team/src/index.ts:260-261` утверждает, что окно закрыто синхронным интервалом, но я это не воспроизводил; (в) точный список того, что монтирует `dsh-base`/`dsh-web-app` для `sessionProjections` в web-профиле (нужно для invariant).

## 6. CLAIMS

| ID | Утверждение | Доказательство | Статус |
|---|---|---|---|
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

**Сводка по статусам:** verified — 56, unverified — 1 (B-25, плюс общая оговорка §5 п.1), refuted — 0. Опровергнутых утверждений документа в моей зоне нет: найденные неточности — это либо неполнота формулировок (§8.2 «в опубликованном profile», §15 «блокирует до изменения», §10 «message bytes» — вынесены в N-01/N-02/N-03), либо описание уже сделанного как предстоящего (§42 «install», B-56).

