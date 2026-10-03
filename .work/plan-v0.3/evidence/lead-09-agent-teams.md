# lead-09 — Agent Teams (DSH): паттерны к переносу в MyWork

Базы: `DSH` = `C:\Reposit\deepseek-harness\deepseek-harness` @ `c7c4c725c7` (2026-09-26T11:45+05:00). `MW` = `H:\Repo\DSH-MyWork`. Пакеты: `DSH packages/experimental/{agent-team,tool-agent-team,agent-team-profile,client-ui-agent-team}`; док `DSH docs/subsystems/agent-team.md`.

## Факты

**1. Provisioning saga.** Единица идентичности — не «instanceId», а `childId`/`SessionId`; отдельного instance-идентификатора в DSH нет.
- `DSH packages/experimental/agent-team/src/roster.ts:246-337` (`spawnAdmitted`). Порядок: чеканка id `:259` (`brandString<SessionId>(randomUUID())`) → снапшот `phase:'provisioning'` `:260-267` → durable append **внутри** `journal.transact` `:269-278` (уникальность имени `:271-273`, лимит `:274-276`, `appendAndFlush(root,'team/member')` `:277`) → **только затем** внешний эффект `ctx.subagents.startContinuable({childId,…})` `:282-291` → `checkpointInitialPrompt` `:292`,`:340-389` (flush принятого inbox-элемента до коммита `active`).
- Падение старта `:293-313`: durable `failed` через `settleProvisioning` `:464-482`, дренаж ребёнка `:301`; если recovery успел поставить `active` — `TEAM_PROVISIONING_CONFLICT` `:303-307`. Падение checkpoint после успеха `:322-335` — та же конфликтная ветка.
- Recovery `:392-434` (вход `recoverFor :192-196`, вызывается на старте агента `index.ts:108`,`:246-249`): live-ребёнок → пропуск, создатель владеет терминальным ребром `:396-398`; иначе читается персист ребёнка `:402` и `active` ставится **только** при совпадении 4 условий `:405-409` (direct parent, `mode==='continuable'`, тот же provider, принятый initial prompt); иначе `failed` `:400`,`:412`. Гонка закрыта CAS-переходом «только из `provisioning`» `:474`.
- Легальность переходов на реплее: `DSH …/agent-team/src/projection.ts:258-267` — старт обязан быть `provisioning` `:259`, name/provider/context иммутабельны `:261-262`, разрешён только `provisioning → active|failed` `:264-266`.
- Проза: `DSH …/agent-team/README.md:129`; `DSH .agents/notes/implemented/feature/2026-08-05-agent-teams.md:31-35`.

**2. Advisory write scopes** (не lock, не permission, не запрет claim).
- Объявление: `CreateTeamTaskRequest.writeScopes?` `types.ts:198`; durable `TeamTaskSnapshot.writeScopes` `types.ts:82`; view `types.ts:93` + `writeScopeWarnings` `types.ts:96`.
- Нормализация `task-board.ts:235-237` + `validation.ts:26-34`: `\`→`/`, срез ведущего `./` и хвостовых `/`, отказ на пустое/абсолют/`C:`/`.`/`..` (`TEAM_INVALID_WRITE_SCOPE`).
- Хранение: только в снапшоте задачи, аппенд `team/task` `task-board.ts:66`,`:208`; реплей-safe схема `projection.ts:85`,`:327-330`.
- Чтение: `task-view.ts:37-61`; overlap по компонентам пути `:14-16` (`left===right || left.startsWith(right+'/') || right.startsWith(left+'/')`); сравнение **только с `status==='in_progress'`** `:45`; предупреждения выводятся на чтение и не хранятся `:43`,`:60`; текст `write scopes overlap with <id>` `:47`.
- При пересечении не блокируется ничего: `claim` поле не читает вовсе `task-board.ts:129-137`. Явные оговорки `README.md:139`,`:207`.
- Не путать с одноимённым `fs/write-intent` — это waterfall политики ФС `DSH packages/fs/fs/src/index.ts:59`, `packages/fs/tool-fs/src/write.ts:115`; к Team-скоупам отношения не имеет.

**3. Handoff artifact в DSH отсутствует.** grep `handoff artifact|handoff_artifact|handoffArtifact` → 0 в agent-team; слово `handoff` встречается лишь как «гонка передачи abort-сигнала» `DSH packages/subagent/subagent-in-process-driver/src/index.ts:155`,`:174`. Ближайшие реальные механизмы передачи — initial prompt континуации `roster.ts:286-291` и durable peer-сообщение (`DSH docs/subsystems/agent-team.md:32-39`). Handoff Artifact — собственная идея MyWork (`.work/analysis/2026-09-26/B-orchestration.md:314-334`), не заимствование.

**4. Durable mailbox** `DSH …/src/mailbox.ts`.
- Queue-before-delivery: всё внутри `journal.transact` `:117`; счётчик pending `:122-129` (`TEAM_MAILBOX_FULL`); размер `:137-139` — `Buffer.byteLength(JSON.stringify(this.deliveryContent(queued)),'utf8') > maxMessageBytes`; append `team/message/queued` `:140-144`; **регистрация dispatch до выхода из транзакции** `:145-147` (комментарий там же); ответ `{status:'accepted'|'queued'}` `:149-150` (`types.ts:188-191`) — durable в обоих случаях.
- Лимиты по умолчанию `index.ts:43-44` (64 / 65 536), схема `:62-63`.
- Dedup по логу **самой цели**: `targetRecorded` `:301-306`; для не-live — персист `:317-331`, при ошибке чтения `undefined` → сообщение остаётся queued `:256`. Реплей-инварианты `projection.ts:292-297` (двойная постановка), `:299-301` (delivered раньше queued).
- Ack-after-durability: `checkpointDelivered` `:273-282` — `await sessions.flush(target)` → проверка receipt → `markDelivered`; идемпотентно `:285-298`.
- Порядок: per-target хвосты `serializeDispatch :193-209`; доставка всех pending до целевого сообщения `dispatchThrough :212-232`; `inFlightMessages` `:154-170`; recovery `recoverFor :86-98` доставляет queued-minus-delivered.
- Кадр доставки `deliveryContent :309-314` — `Team message <id> from <name>:`.

**5. waitForChange / noProgress.**
- `activity.ts:22-66`: таймаут только 10 000…3 600 000 (`TEAM_INVALID_TIMEOUT` `:23-25`); waiter'ы живут только в памяти `:12`, прошлое не реплеится; abort → `TEAM_WAIT_ABORTED` `:45-52`; результат `{timedOut: !changed}` `:65`; `notify :72-77`; `close :79-86`, а до закрытия `wait` отдаёт `{timedOut:false}` `:27`. Фасад `index.ts:210-213`.
- Честное «нет прогресса» живёт на уровне tool, а не сервиса: `DSH packages/experimental/tool-agent-team/src/index.ts:39-40` (`ACTIVE_WAIT_STATUSES={running,provisioning}`); `:260-272` — чтение roster и регистрация waiter'а обязаны быть одним синхронным интервалом, и если других активных нет, немедленно возвращается `{timedOut:false,noProgress:{reason:'no-active-peer',message}}`; валидация таймаута сохраняется до короткого пути `:255-259`; схема `:105-120`; текст политики `:37`.

**6. Что у MyWork уже есть** (чтобы не строить второе).
- Транзакционный outbox: `MW packages/storage/src/outbox.ts:2-9`; идемпотентность по `eventId` с флагом `duplicate` `:57-69`.
- Inbox dedup: `MW packages/storage/src/inbox.ts:1-8`; `applyOnce` `:37`,`:51-73` с требованием синхронного эффекта `:58-63`.
- Claim-сага: три правила в заголовке `MW packages/execution/src/service.ts:1-26`; `STEP_ORDER=['intent','claim','attempt','projection','complete']` `:166`; `initialSteps` `:169-179`; `claim_intent` `MW packages/execution/src/schema.ts:88-109`, `claim_step` `:111`.
- `Attempt` без write-intent: `MW packages/contracts/src/attempt.ts:104-127`.
- `AgentInstance` уже есть, включая `waking` и активные состояния: `MW packages/contracts/src/team.ts:296-311`,`:314-322`,`:325-329`,`:335-346`; `AgentInstanceId` `MW packages/contracts/src/ids.ts:33`; scheduler уже носит `instanceId` `MW packages/contracts/src/scheduler.ts:280`.
- Runtime отвергает дубликат `MW packages/contracts/src/agent-runtime.ts:68`; `stop` недеструктивен `:246`.
- Peer-канала/mailbox нет — подтверждено `B-orchestration.md:98`.

## Матрица recovery provisioning

Формальной матрицы нет ни в коде, ни в доке DSH: recovery — один предикат `roster.ts:405-409`, а не таблица «шаг × состояние мира». Таблица в `B-orchestration.md:280-291` — авторская (MyWork), не первоисточник. Реально кодифицированы лишь: live-ребёнок → создатель владеет терминальным ребром `roster.ts:396-398`; 4 условия совпадения → `active`, иначе `failed` `:405-413`; терминальный переход только из `provisioning` `:474` + `projection.ts:264-266`; легальные фазы `types.ts`/док `docs/subsystems/agent-team.md:24` («каждый member стартует в `provisioning` и достигает ровно одной терминальной фазы»).

## Опровержения/неожиданное

1. **`instanceId` в DSH отдельно не чеканится** — чеканится `childId`(SessionId) `roster.ts:259`; AgentInstance-идентификатора в Agent Teams нет. `B-orchestration.md:276` верен по существу (id до внешнего эффекта), но термин взят из MyWork.
2. **`handoff` в Agent Teams не существует** (Факт 3) — переносить нечего; §3.3 плана — новая работа, не заимствование.
3. **Матрицы recovery в первоисточнике нет** — ожидание задания не подтвердилось.
4. **`writeScopes` действительно не влияют на claim** `task-board.ts:129-137`, и предупреждения считаются на чтение, а не хранятся.
5. **`noProgress` — свойство tool, а не сервиса**: `waitForChange` сам «нет прогресса» не умеет и может провисеть час.
6. **Граница сообщения — по sender-framed доставке** `mailbox.ts:137-139` + `:309-314`: полезная нагрузка меньше объявленных 65 536 байт на длину id и имени.

## Не проверено

- Композиция живого профиля: смонтирован ли `agent-team/invariant` в каком-либо `cordis*.yml` (утверждение N-01 `B-orchestration.md:359` не перепроверял).
- Содержимое `DSH packages/experimental/agent-team-profile` и `client-ui-agent-team` (видел только имена файлов).
- `DSH packages/experimental/agent-team/tests/team.spec.ts` (77 КБ): номера строк оттуда приняты как цитаты, файл не открывал.
- `DSH docs/subsystems/subagent.md:462` (сбалансированный fork-префикс) и `MW packages/controller` (где жил бы реестр provisioning-записей).
- Поведение `AgentRuntimePort.start/resume` в MyWork за пределами двух процитированных строк `agent-runtime.ts:68`,`:246`.

## Что переносим / что не переносим

**Переносим:** (1) сага провижининга с чеканкой id **до** внешнего эффекта (`roster.ts:259`,`:269-291`) и recovery-by-artifact-match (`:392-434`,`:405-409`) — в `AgentInstanceProvisioning`, идемпотентность + fence берутся из `service.ts:166`. (2) Advisory write-intent на уровне `Attempt`: нормализация `validation.ts:26-34`, overlap по компонентам `task-view.ts:14-16`, предупреждения только против активных и **вывод на чтение** `:43-49`, admission поля не читает. (3) Честный `noProgress` в wait-эквиваленте `tool-agent-team/src/index.ts:39-40`,`:260-272` — с названной причиной и проверкой «есть ли кому менять состояние».
**Не переносим:** (a) сам mailbox/peer-канал — у MyWork нет peer-сообщений, а durability уже дают `outbox.ts:2-9` + `inbox.ts:51-73`; берём только дисциплину queue-before-delivery / ack-after-durability / per-target order. (b) блокировки и семантическое взаимоисключение на write-скоупах — DSH отвергает прямо (`2026-08-05-agent-teams.md:71`). (c) `fork` как default для worker-Attempt (`B-orchestration.md:164-168`). (d) invariant-companion «отказ до append» как готовую гарантию (`:152`). (e) peer-контент как user-message — MyWork доставляет классом `dependency-result` (`:106-108`). (f) плоский иммутабельный ростер и «failed съедает имя и слот» (`DSH …/agent-team/README.md:208`) — декомпозиция в MyWork принадлежит TaskGraph.
