# MW-011 — адверсариальная фальсификация, пятый проход (falsify mode)

- Предмет: карточка `.work/tasks/MW-011.md`, отчёт исполнителя `.work/reports/MW-011-plan-mutations.md` —
  как объект атаки, не как источник истины.
- Репозиторий: `H:\Repo\DSH-MyWork`, base SHA = HEAD = `f22dbc3b2eb97601e09fc4f341bcddd522544545`, коммитов нет.
- Метод: сценарные пробники на **собранных** бандлах (`packages/*/lib/index.js`), затем чистые функции ядра.
  Правок в `packages/`, `tests/`, `scripts/` **нет**; мой след — только `.tmp/` и этот файл.
- Артефакт прогона: `.tmp/mw011-adv5-snap/*.js` — снимок шести бандлов, снятый при стабильном хеше, sha256
  совпадает с живыми бандлами на момент прогона (см. §6).
- Побочное наблюдение окружения: параллельная сессия **пересобирала дерево** во время моего прохода
  (`packages/planner/lib` и `packages/controller/lib` в какой-то момент отсутствовали, mtime `lib/*.js` менялся).
  Поэтому пробники ждут стабилизации хешей и читают снимок, а не живой файл; хеши снимка перечислены ниже.
- Вне объёма (не переоткрывал): 12 находок ревью, NEW-1…NEW-6, D-1…D-8, N-1…N-6; живой `bd`; `verify:profile`/`pack:local`.

## 1. ИТОГ

**Попыток: 24 — 16 сценариев на реальном сторе и журнале (`r1 r2 r3 c1 c2 c3 c4 c5 g1 g2 g3 r4 s1 b1 k1 p1`),
3 на lease (`l1 l2 l3`) и 5 групп чистых функций ядра (`shadow`, `dup`, `predicate` — 13 под-случаев, `verify`,
`parts`). Сломано: 13 находок — 2 BLOCKER, 7 MAJOR, 3 MINOR, 1 NIT.**

Одной строкой: заявленные «ни один путь не оставляет частично видимого DAG» и «revert восстанавливает
прежний набор зависимостей» **опровергнуты** — `revert` объявляет успех и снимает паузу admission, когда
часть операции легла в граф, но не попала в журнал (R1/R2/R3), а два перекрывающихся `apply()` одного
и того же operationId создают вторую задачу, которой нет ни в одном журнале (C1).

## 2. НАЙДЕННЫЕ ДЕФЕКТЫ

### BLOCKER-1 — `revert` объявляет успех и снимает паузу, когда эффект операции в графе есть, а в журнале его нет

`packages/core/src/plan.ts:1079` (`if (step.state !== 'applied') continue` — шаг, оставшийся `pending`,
молча считается «не выполнялся») + `packages/planner/src/service.ts:1133-1149` (`revert` инвертирует только
`applied`-шаги и **не делает pre-flight по графу**, в отличие от `run`), `service.ts:593-621` (`verifyInverse`
строит синтетический интент **из самой же инверсии**: если инвертировать нечего, проверять нечего →
`verified: true`), `service.ts:1189-1200` (состояние `reverted` + `releaseAdmission`).

**Сценарий** (ровно окно, ради которого написан ADR024): часть операции легла в граф, но писатель умер /
ответ потерялся до записи журнала. Это не гипотеза — тест `tests/plan-mutation.test.mjs:937-945` сам
воспроизводит это окно для создания, а BLOCKER-3/D-1 его документируют.

**Наблюдаемое.**

R2 (только рёбра, никаких созданий — «порт снял ребро, ответ потерялся»):

```text
submit.code: PLAN_MUTATION_RECOVERY
graph.edges.afterFailure: []
journal.afterFailure: steps ["remove-edge:D-1\0B-1:pending","remove-edge:D-2\0B-1:pending"]
revert.ok: true            revert.state: reverted       revert.integrity.verified: true
graph.edges.afterRevert: []          ← прежний набор зависимостей НЕ восстановлен
admissionHeld.afterRevert: false     ← пауза снята
```

R1 (с созданием):

```text
submit.code: PLAN_MUTATION_RECOVERY   journal.created: {}   admissionHeld: true
graph.tasks: ["B-1","D-1","D-2","mw-1"]      ← задача создана
revert.ok: true   revert.state: reverted   revert.integrity.verified: true   created: {}
graph.tasks.afterRevert: ["B-1","D-1","D-2","mw-1"]   ← сирота осталась
admissionHeld.afterRevert: false
journal.afterRevert: state reverted, created {}, steps все pending, report.verified TRUE
```

R3 (настоящее «убийство» писателя, не подмена порта): после переоткрытия БД — `state applying`, пауза открыта,
`blindResume` → `PLAN_MUTATION_RECOVERY` (guard BLOCKER-3 честно отказывает), **а `revert` → `ok`, `reverted`,
пауза снята, `mw-1` остаётся в графе**.

**Почему это нарушает инвариант.** Инвариант 2: «`revert` восстанавливает состояние или честно отказывает»;
приёмка карточки: «revert восстанавливает прежний набор зависимостей; ни один путь не оставляет частично
видимого DAG». Здесь не восстановлено и не отказано: операция помечена `reverted`, задача-сирота (или снятые
рёбра) остались, пауза снята, а `reverted` не входит в `UNSETTLED_STATES` — пути назад нет ни у `resume`, ни у
повторного `revert`. Хуже: сохранённый в журнале отчёт теперь `verified: true`, то есть evidence-of-record
утверждает то, чего граф не подтверждает. Отдельно видно асимметрию: на том же состоянии `resume` отказывает
(`PLAN_MUTATION_RECOVERY`), а `revert` — «успех».

**Минимальная правка** (две части, обе локальны):
1. `revert` перед инверсией наблюдает граф и помечает шаги из наблюдения — `markEdgeSteps` уже существует
   (`service.ts:394-406`) и отвечает ровно на вопрос «шаг лёг?»: `pending`/`failed` шаг ребра, который граф
   показывает как лёгший, обязан войти в инверсию (для снятия — обратное добавление), а не быть пропущенным;
2. при любом не-`applied` шаге **создания** — отказ (`PLAN_MUTATION_RECOVERY`, пауза остаётся): «id, который
   никто не зажурналировал, неотличим от создания, которого не было» — это дословно рассуждение самого `run`
   (`service.ts:666-700`), и для `revert` оно верно так же. Выход оператора — `resume` с `adoptedCreated`,
   после чего шаг станет `applied` и инверсия будет честной.

**Воспроизведение:** `node .tmp/mw011-adv5-staged.mjs r1 r2 r3`

### BLOCKER-2 — два перекрывающихся `apply()` одного operationId создают вторую задачу, которой нет в журнале

`packages/planner/src/service.ts:1014-1027` (`apply` принимает любое состояние из `UNSETTLED_STATES`,
включая `staged`) + `service.ts:673-724` (`run` не захватывает операцию: `readMutation` → `await verify(...)` →
безусловный `updateMutationState(..., 'applying')` на `:723`) + `service.ts:445-497` (ветка `create` заново
создаёт всё, чего нет в `working.created`).

**Сценарий (c):** два вызова `apply('op-1')` в одном тике (`Promise.all`) — например повтор после таймаута,
ретрай и reconcile рядом, или два процесса, у которых нет иного барьера: планировщик не зависит от lease и
нигде не проверяет `isWriter()`.

**Наблюдаемое (C1):**

```text
stage.ok: true
left:  {"ok":true,"state":"applied"}
right: {"ok":false,"code":"PLAN_MUTATION_RECOVERY"}
graph.calls: {"mutatePlan":4,"create":2,...}
graph.tasks: ["B-1","D-1","D-2","mw-1","mw-2"]      ← одна и та же key:n1 создана дважды
journal: state applied, created {"n1":"mw-1"}        ← mw-2 не существует ни в одном журнале
admissionHeld: false      planRevision: 1
```

**Почему это нарушает инвариант.** Инвариант 2 («повтор не создаёт дубликатов задач»), приёмка карточки
(«Повтор staged не дублирует задачи»), §6.3 отчёта («повторный `apply` не создаёт задачу заново»). `mw-2` —
это запускаемая работа, которой нет ни в плане, ни в evidence; ровно тот «частично видимый DAG», отсутствие
которого заявлено. Для контраста: два перекрывающихся `resume` после принятия id дубликата **не** дают
(B1: `calls.create === 1`) — окно открыто именно на пути, где create-часть ещё не разрешена.

**Минимальная правка.** Сделать переход в `applying` захватом операции, а не записью:
`UPDATE plan_mutation SET state='applying' WHERE operation_id = ? AND state = ?` (то состояние, что прочитано
в pre-flight) и при 0 изменённых строк вернуть `TASK_CONFLICT`/`reason: 'operation-already-running'`.
В одном процессе этого достаточно (транзакции SQLite синхронны), для нескольких — плюс in-memory набор
«в полёте» в `createPlanner`.

**Воспроизведение:** `node .tmp/mw011-adv5-staged.mjs c1`

### MAJOR-3 — ключ создания может совпасть с id существующей задачи: планировщик пишет не то ребро, рапортует `verified: true` и возвращает ложный `addedDependencies`

`packages/core/src/plan.ts:589-611` (валидатор строит `keys` из `create[].key` и проверяет только
«endpoint существует в графе **или** в этой мутации»; коллизия ключа с чужим id не проверяется ничем) +
`plan.ts:114-127` и `plan.ts:139-154` (`resolveEndpoint`/`resolvePlanEdges` молча подменяют endpoint,
равный такому ключу, на id новой задачи) + `plan.ts:359-370` (предикат ADR026 судит по тому же множеству
ключей) + возврат результата в `service.ts:805`.

**Сценарий (e/4):** интент `create: [{key:'T-3'}]` + `addDependencies: [{from:'T-1', to:'T-3'}]`, где `T-1` и
`T-3` — существующие задачи (`T-3` в `done`), `T-1` готова.

**Наблюдаемое (S1, сквозной путь через `submit`):**

```text
intent.edge: [{"from":"T-1","to":"T-3","kind":"blocks"}]
submit.ok: true     outcome.integrity.verified: true
outcome.addedDependencies: [{"from":"T-1","to":"T-3","kind":"blocks"}]   ← то, чего в графе нет
graph.edges: ["T-1->T-3","T-1->mw-1"]                                   ← а это в графе есть
createdTask.externalRef: ["mw-plan:op-1:T-3"]                           ← ключ-тень попал в ссылку оператора
```

Вторая форма коллизии ломает именно предикат L3 (пробник ядра):

```text
create [{key:'T-2'},{key:'n2',dependsOnKeys:['T-2']}]  (T-2 существует)
viaKeys.class: additive-only      viaKeys.validate.ok: true
```

**Почему это нарушает инварианты.** (а) Инвариант 4/ADR026: решение «ребро между двумя новыми задачами»
принимается по множеству ключей, а ключ может быть чужим id, поэтому `additive-only` выдаётся мутации,
которая по собственной формулировке ADR026 («ребро к существующей задаче = modifying», отчёт §2) обязана быть
`modifying`; (б) инвариант 3: `verifyPlanIntegrity` рапортует `verified: true`, хотя набор рёбер графа не тот,
что объявлен в интенте, и `PlanMutationOutcome.addedDependencies` — единственная структурированная запись о
том, что записано, — утверждает неправду. Оператор, читающий план, видит «T-1 ждёт завершённую T-3», а граф
получил «T-1 ждёт новую пустую задачу» (T-1 заблокирована работой, которой в плане нет).

**Минимальная правка.** В `validatePlanMutation` (там же, где уже проверяются endpoints, и наблюдение графа
под рукой) отвергать ключ создания, совпадающий с существующим id: `TASK_CONFLICT`,
`reason: 'create-key-shadows-existing-task'`, `details.key`. Предикат при этом остаётся чистым: его посылка
(«ключ — новая задача») начинает гарантироваться валидатором на всех путях. Тест: `isAdditiveOnly` на таком
интенте + отказ `submit`.

**Воспроизведение:** `node .tmp/mw011-adv5-staged.mjs s1` и `node .tmp/mw011-adv5-core.mjs shadow`

### MAJOR-4 — повторное решение гейта: сырое исключение SQLite вместо структурного отказа и полное отсутствие идемпотентности по operationId

`packages/planner/src/service.ts:1374`
(`decisionId = gate-<ws>-<blocker>-<action>-<decision.at>` — часы, а не operationId) + `service.ts:1389`
(`settleGate` → `insertGateDecision`) + `packages/planner/src/schema.ts:130-142`
(`decision_id TEXT PRIMARY KEY`) + `service.ts:1314-1420` (проверки «уже решено» нет).

**Сценарий (g):** оператор повторяет то же решение (ретрай после таймаута UI, двойной клик) — `meta` новый,
`decision.at` тот же.

**Наблюдаемое (G2):**

```text
first.ok: true   first.awaitingDecision: false
second.threw: Error: UNIQUE constraint failed: blocker_gate_decision.decision_id
gateDecisions: ["gate-W-1-B-1-keep-blocking-1000"]
```

и с другим `at` — «успех» дважды, две строки решения:

```text
repeat.1: {"ok":true,"awaiting":false}   repeat.2: {"ok":true,"awaiting":false}
repeat.decisions: ["gate-W-1-B-1-keep-blocking-1001","gate-W-1-B-1-keep-blocking-1002"]
```

**Почему это нарушает инварианты.** Инвариант 7: метод, возвращающий `Result`, обязан отвечать структурно —
здесь исключение из SQLite выходит наружу. Инвариант 5: «гейт нельзя применить дважды (идемпотентность по
`operationId`)» — не реализовано ни в одну сторону: одинаковое решение с теми же часами падает, с другими —
тихо дублируется. Оба исхода наблюдаются на живой БД, а не выведены чтением кода.

**Минимальная правка.** Считать `decisionId` из `meta.operationId` (`gate-<operationId>`), перед вставкой
читать решение этой операции и возвращать его как ответ (реплей, как у `stage`); любое нарушение ограничения
переводить в `TASK_CONFLICT`/`reason: 'gate-already-decided'`.

**Воспроизведение:** `node .tmp/mw011-adv5-staged.mjs g2`

### MAJOR-5 — отказ чтения задачи гасит guard §10.3: running-задача переписывается без policy

`packages/planner/src/service.ts:259-270` (`readStates` ловит **любую** ошибку порта и трактует задачу как
отсутствующую), вызов — `service.ts:280` в `observe`, решение — `packages/core/src/plan.ts:517-552`
(`review.runningTasksTouched` пуст → policy не требуется).

**Сценарий:** порт не может прочитать задачу с активной попыткой (`ADAPTER_UNAVAILABLE`, таймаут) — ровно
тот класс отказа, ради которого делали D-8.

**Наблюдаемое (R4):**

```text
stage.ok: true                       ← прошло валидацию
submit.ok: true
commandsSentToPort: [[{"id":"T-1","title":"rewritten while running"}]]   ← T-1 в состоянии executing
journal: applied, report.verified: true, admissionHeld: false
controlWithReadableTask.code: TASK_CONFLICT   reason: running-task-policy-required
```

**Почему это нарушает приёмку.** Первый пункт приёмки: «Отклоняются … недопустимые изменения running Task».
Guard fail-open: недоступность чтения превращается в «задача не запущена». Обратная сторона того же `catch` —
ложный `TASK_CONFLICT`/`unknown-edge-endpoint` для существующей, но нечитаемой задачи. **Это не D-8**: D-8
обернул чтения на call-site (`observe`, `verifyInverse`, pre-flight), но `readStates` глотает ошибку внутри
себя, и обёртка до неё не доходит — ветка ни одним тестом не наблюдалась.

**Минимальная правка.** Различать «нет задачи» (`TASK_CONFLICT` от порта — как сейчас) и «не прочитать»
(пробрасывать): вернуть из `readStates` признак недоступности либо не глотать ошибку, а на call-site
ответить типизированным отказом через существующий `refusalShape` (обёртки в `stage`/`run` уже есть).

**Воспроизведение:** `node .tmp/mw011-adv5-staged.mjs r4`

### MAJOR-6 — повторное использование operationId с **другим** интентом даёт `ok` с исходом чужой операции; `acceptProposal` на этом пути «принимает» предложение, ничего не применив

`packages/planner/src/service.ts:909-922` (`stage` при существующем operationId возвращает `ok(existing)`,
сверяя только workspace) + `service.ts:1030-1033` (`submit`) + `service.ts:1287-1289`
(`acceptProposal` → `submit({origin:'proposal'})` → `decideProposal(..., applied.value.operationId)`).

**Сценарий (c/6):** ретрай запроса с тем же idempotency-key, но другой мутацией (или коллизия генератора id).

**Наблюдаемое (C3):**

```text
first.ok: true   graph.edges.afterFirst: []
second.ok: true  second.addedDependencies: []   second.removedDependencies: [{"from":"A-1","to":"B-1"}]
graph.edges.afterSecond: []            ← интент второго вызова (C-1→D-1) не применён
VERDICT.secondIntentApplied: false
```

**Наблюдаемое (P1):**

```text
seeded.ok: true            (op-1 применён ранее)
accept.ok: true   accept.operationId: op-1   accept.addedDependencies: []
graph.edges: []                              ← мутация предложения не применена
proposal.state: accepted                     ← предложение объявлено принятым
VERDICT.proposalMutationApplied: false
operation.decidedBy: null
```

**Почему это нарушает инвариант.** Инвариант 6: `acceptProposal` не может обходить основной путь — здесь он
обходит само применение: Worker получает `accepted`, DAG не меняется, а `operation_id` предложения указывает
на постороннюю операцию. Общее правило «успех — наблюдение, а не возвращаемое значение» нарушено на обоих
входах.

**Минимальная правка.** В `stage`, найдя существующую запись, сравнить входящий интент с записанным
(create/update/addDependencies/removeDependencies/retire) и при расхождении вернуть
`TASK_CONFLICT`/`reason: 'operation-id-reused'`; no-op оставить только для идентичного интента.

**Воспроизведение:** `node .tmp/mw011-adv5-staged.mjs c3 p1`

### MAJOR-7 — `reverted`-операцию можно применить заново тем же `submit`, и откатить её после этого уже нельзя

`packages/planner/src/service.ts:675` (`run` коротко замыкает только `applied`; `reverted` не проверяется) при
том, что `apply` (`:1018`), `resume` (`:1043`) и `revert` (`:1112`) состояние вне `UNSETTLED_STATES`
отвергают.

**Наблюдаемое (C4):**

```text
first {ok:false, code:PLAN_MUTATION_RECOVERY} → revert {ok:true, state:reverted}
submitAgain {ok:true, state:applied}          ← та же операция применена второй раз
journal.afterSubmitAgain: state applied       audit: [recovered, recovered, applied]
planRevision: 1
revertAgain: TASK_CONFLICT                    ← откатить больше нечем
```

**Почему это нарушает инварианты.** Инвариант 2 (повтор обязан отвечать тем же исходом — §10 отчёта сам
называет это причиной существования колонки `mode`: «повтор должен отвечать тем же исходом»), и решение
оператора (`revert`) молча отменяется durable-ретраем исходного запроса; после этого состояние терминально.
Три из четырёх входов защищены, четвёртый — нет.

**Минимальная правка.** Одна проверка в `run`: состояние вне `UNSETTLED_STATES` — отказ тем же кодом, что у
`apply`/`resume` (`TASK_CONFLICT`, `reason: 'operation-settled'`), либо реплей сохранённого исхода для
`reverted`.

**Воспроизведение:** `node .tmp/mw011-adv5-staged.mjs c4`

### MAJOR-8 — `void` возвращает зависимую задачу в `ready`, хотя её держит второй frozen-блокер

`packages/planner/src/service.ts:1341-1373` (интент `void`: снять рёбра зависимых и `retire → ready`, без
проверки других открытых гейтов) при том, что деривация знает о них — `packages/core/src/blocker.ts:121-145`.

**Сценарий (g):** `D-1` заблокирована двумя cancelled-задачами `B-1` и `B-2`; оператор решает `void` по `B-1`.

**Наблюдаемое (G1):**

```text
gates.before: [["B-1",true,["D-1"]],["B-2",true,["D-1"]]]
void.ok: true
graph.edges.afterVoid: ["D-1->B-2"]     ← ребро ко второму блокеру осталось
graph.D-1.state: ready                  ← задача выпущена
gates.after: [["B-2",true,true,["D-1"]]] ← и одновременно «всё ещё ждёт»
```

**Почему это нарушает приёмку.** ADR023/§5.5: `cancelled`/`superseded` не удовлетворяют зависимость — ровно
поэтому существует гейт. Здесь `void` по одному блокеру выпускает работу, которую держит другой frozen-блокер:
планировщик одновременно утверждает «D-1 выпущена» (состояние) и «D-1 ждёт B-2» (открытый гейт), а
планировщик-потребитель читает состояние.

**Минимальная правка.** В `decideGate` исключать из `retire`-списка зависимых, у которых есть другой открытый
гейт (он уже посчитан в `gates`): для них `void` снимает только ребро, состояние не трогается; либо отказывать
с перечислением конфликтующих гейтов.

**Воспроизведение:** `node .tmp/mw011-adv5-staged.mjs g1`

### MAJOR-9 — повторный `submit` в одном тике: исключение SQLite наружу из метода, обещающего `Result`

`packages/planner/src/service.ts:907-1012` (`stage` читает запись, затем `await observe(...)`, и только потом
вставляет; catch на `:992-1010` разбирает лишь `PlanError('conflict')`) + `packages/planner/src/schema.ts:66-83`
(`plan_mutation.operation_id PRIMARY KEY`).

**Наблюдаемое (C2):**

```text
threw: Error: UNIQUE constraint failed: plan_mutation.operation_id
graph.calls: {"mutatePlan":0,...,"dependencies":3}
journal: state staged, steps pending, admissionHeld: true
```

**Почему это нарушает инвариант 7.** Вызывающий не получает ни `Result`, ни кода; операция осталась
`staged` с открытой паузой, и «владельца» у неё теперь нет — только `resume`/`revert` вручную. (Первая
половина того же окна — вторая `stage` после первой: там конфликт ловится, см. «неудавшиеся попытки».)

**Минимальная правка.** Либо вставлять через `INSERT` с проверкой числа строк (или `INSERT OR IGNORE` +
`readMutation` в той же транзакции) и отвечать `TASK_CONFLICT`/`operation-already-staged`, либо перехватывать
ошибку ограничения и маппить её в тот же структурный отказ.

**Воспроизведение:** `node .tmp/mw011-adv5-staged.mjs c2`

### MINOR-10 — верификация подтверждает операцию, если в графе появилось ребро «извне» в затронутую вершину

`packages/core/src/plan.ts:995-1002`: `unexpected` считается только для пар, у которых **оба** конца в
`touchedNodes`; ребро «нетронутая → затронутая» не reported.

**Наблюдаемое (чистая функция):** интент `removeDependencies:[D-1→B-1]`, порт снял ребро и добавил `C-1→B-1`:

```text
verified: true     unexpected: []     pendingRemovals: []     missing: []
control (оба конца затронуты, B-1→D-1): verified: false, unexpected: ["B-1\0D-1"]
```

**Почему это дефект (и почему MINOR).** Коммит и операторский баннер `integrityReport` говорят `verified: true`
о графе, который получил зависимость, никем не запрошенную (задача, никогда не участвовавшая в плане, теперь
ждёт блокера). Комментарий в коде прямо declares это сужение, поэтому это не скрытое поведение, а граница
проверки; но приёмка формулирует свойство как «целостность DAG», а не «целостность интента».

**Минимальная правка.** Сравнивать наборы рёбер инцидентных `touchedNodes` целиком (`edge.from ∈ touched ||
edge.to ∈ touched`) и относить лишние к `unexpected`, либо явно назвать сужение в тексте баннера.

**Воспроизведение:** `node .tmp/mw011-adv5-core.mjs verify`

### MINOR-11 — дубликат ключа создания создаёт две задачи с одной ссылкой оператора

`packages/core/src/plan.ts:96-98` (`planExternalRef`), `:613-624` (валидатор не проверяет уникальность ключей),
`:821-829` (шаг на каждый `create[]`).

**Наблюдаемое:**

```text
create [{key:'a'},{key:'a'}]:  validate.ok: true   class: additive-only
steps: [["create","key:a"],["create","key:a"]]     externalRef обоих: mw-plan:op-1:a
```

**Почему это дефект.** `plan_mutation.created` хранит один id, а в графе две задачи с одинаковым `externalRef`;
операторский резолв неразрешённого создания (MAJOR-5 отчёта) становится неоднозначным, а вторая задача —
сирота. Минимальная правка: отвергать неуникальные ключи в валидаторе (`reason: 'duplicate-plan-key'`).

**Воспроизведение:** `node .tmp/mw011-adv5-core.mjs dup`

### MINOR-12 — `resumeAdmission()` снимает паузу, не спрашивая durable-удержание; поднять паузу у живого контроллера нечем

`packages/lease/src/lifecycle.ts:261-271` (`resumeAdmission` безусловно ставит `admissionOpen = true`) +
`:238-248` (удержание читается **только** при `activate`).

**Наблюдаемое (L2):** операция в `recovery`, `report.verified === false`, строка удержания открыта:

```text
activate.admitting: false   activate.admissionHeld: true
resumeAdmission.admitting: true    isWriter: true
planner.admissionHeld: true        planner.openHold.operationId: op-1
```

**Наблюдаемое (L1):** контроллер уже активен, затем появляется удержание:

```text
activate.admitting: true → stage (пауза открыта) → lifecycle.admitting: true, isWriter: true
```

**Почему это дефект (MINOR).** Инвариант 1: «ни один путь не снимает паузу без `verified: true`». Порядок
«сначала снять строку, потом `resumeAdmission`» закреплён только документацией метода; в классе нет ни
проверки, ни `suspendAdmission()`, поэтому (а) один вызов в неверном порядке снимает паузу навсегда для
процесса, (б) пауза защищает рестарт, но не живой контроллер. Композиция (Cordis-строка) в карточку не
входит — §8.4 отчёта это называет, — но отсутствие способа закрыть admission у живого контроллера это не
покрывает.

**Минимальная правка.** `resumeAdmission` перечитывает хук удержания и остаётся закрытым, пока строка
открыта (метод придётся сделать асинхронным или принимать подтверждение чтения стора); добавить
`suspendAdmission()` и тест «resumeAdmission при открытой строке не открывает admission».

**Воспроизведение:** `node .tmp/mw011-adv5-lease.mjs l1 l2 l3`

### NIT-13 — `acceptProposal` не записывает решение на операцию, хотя комментарий утверждает обратное

`packages/planner/src/service.ts:1284-1286` («with the decision that admitted it recorded on the operation
(§10.4)») против `:1287` (`planner.submit({...mutation, origin:'proposal'})` — решение не передаётся).
Наблюдение P1: `operation.decidedBy: null` при `proposal.state: accepted`. Решение сохраняется в строке
предложения, поэтому аудит не слепой; расходится только текст. Правка: либо передавать `decision` в
`run(record, decision)`, либо уточнить комментарий.

**Воспроизведение:** `node .tmp/mw011-adv5-staged.mjs p1`

## 3. ПОПЫТКИ, КОТОРЫЕ НЕ УДАЛИСЬ

| Сценарий | Что ожидал сломать | Наблюдаемое (корректное поведение) |
|---|---|---|
| **B1** `resume` дважды подряд (слепой → с принятым id → повтор) | повторное доведение операции, дубликат или «второй успех» | слепой `resume` → `PLAN_MUTATION_RECOVERY`; с `adoptedCreated` → `ok`, `calls.create` не вырос; повторный → `TASK_CONFLICT/nothing-to-resume` |
| **B1** два `resume` одновременно (id приняты) | дубликат задачи, два коммита | `left ok`, `right PLAN_MUTATION_RECOVERY`, `calls.create === 1`, ревизия 1 |
| **K1** авария на **последнем** шаге (транзакция коммита, после успешной верификации) | снятая пауза / потеря журнала / дубликат при `resume` | журнал `applying`, все шаги `applied`, пауза открыта; новый планировщик `admissionHeld: true`; `resume` → `ok`, `calls.create` +0, ревизия 1, пауза снята |
| **C5** вторая `stage` при открытой паузе (другой operationId) | вторая операция делит чужую паузу | `TASK_CONFLICT`, `details.operationId = op-1`, `pending === ["op-1"]`, `mutatePlan === 0`, удержание у `op-1` |
| **C3-контроль** последовательные повторы `apply`/`submit` той же операции | повтор применяет части заново | `apply` → реплей (`mutatePlan` не вырос), `submit` → исход из журнала |
| **G3** тот же `void`-operationId второй раз | двойное применение/исключение | `TASK_CONFLICT` (`gate-not-open`), граф не изменён, журнал один |
| **Предикат**: `update` с пустым diff | `additive-only` на пустом изменении | `modifying` |
| **Предикат**: `update` только `setMetadata` (поле, не читаемое портом) | шаг как обратимый / класс additive | `modifying`; шаг журнала `reversible: false`, причина «metadata note is not readable through the task graph port» |
| **Предикат**: `retire: [{to:'ready'}]` | `additive-only` для смены scope | `modifying`, `isAdditiveOnly === false` |
| **Предикат**: ребро на существующее ребро (`T-1→T-3` уже есть) | `additive-only` | `modifying` |
| **Предикат**: `update: []`, `retire: []`, `removeDependencies: []`, `dependsOnKeys: undefined` | ложный `modifying`/падение на `undefined` | `additive-only` (пустые массивы и `undefined` = «ничего»), без исключений при `exactOptionalPropertyTypes` |
| **Предикат**: ребро нового ключа на себя (`a→a`) | само-зависимость как additive | `ENTITY_CYCLE`, `path ['a','a']` — цикл-проверка ловит self-loop |
| **V**: интент `remove`, порт снял ребро и добавил ребро между двумя затронутыми вершинами | «порт соврал» проходит как verified | `verified: false`, `unexpected: ["B-1\0D-1"]` |
| **V**: недостающее намеренное ребро / `pendingRemovals` | `verified: true` при расхождении | `verified: false` (механизм работает в своих границах) |
| **R1-контроль**: revert, когда создание легло **и зажурналено** | снятие паузы без компенсации | `TASK_CONFLICT/irreversible-steps` с именем шага, пауза остаётся (существующий тест + мой контраст к BLOCKER-1) |
| **L3**: документированный порядок (сначала строка, потом `resumeAdmission`) | — | `admitting: false` → revert → `admissionHeld: false` → `resumeAdmission` → `isWriter: true` |

## 4. ЗАМЕЧАНИЯ К ОТЧЁТУ

1. **§6.3 «revert без подтверждённой инверсии не снимает паузу»** верно только для инверсии, которую
   `revert` себе построил. Когда инвертировать нечего (все шаги `pending`), `verifyInverse` не с чем
   сравнивать и отвечает `verified: true` — BLOCKER-1. Формулировка описывает свойство всего пути, а
   держится оно на одной ветке.
2. **§6.3 «ни один путь не оставляет частично видимого DAG»** — опровергнуто минимум двумя путями:
   BLOCKER-1 (сирота после ложного `revert`) и BLOCKER-2 (дубликат задачи при перекрывающихся `apply`).
3. **§2 «ребро к существующей задаче = modifying»** — верно только для случаев, когда id существующей задачи
   не объявлен ключом создания. Коллизия ключа с id (MAJOR-3) обходит и это правило, и предикат ADR026.
4. **§10 (отклонения): «create-часть без externalRef → ссылка `mw-plan:<op>:<key>` проставляется»** — ключ
   может быть чужим id, и тогда ссылка оператора строится из id существующей задачи (S1:
   `mw-plan:op-1:T-3` на новой задаче при живой `T-3`). Резолв «найти задачу по ссылке» становится
   неоднозначным без единого признака в данных.
5. **§8.8 «Конкурентность покрыта частично: вторая staged-операция отвергается, сдвиг ревизии даёт
   `STALE_REVISION` без записи в граф»** — занижает картину: я воспроизвёл **внутрипроцессную**
   конкурентность (второй процесс не нужен), которая создаёт дубликат задачи (BLOCKER-2) и выбрасывает
   сырое исключение SQLite из `submit` (MAJOR-9).
6. **§5/§6.2 mutation-батарея.** Ни одна из 20 мутаций не нацелена на: `revert` с нежурналированными шагами,
   перекрывающиеся `apply`/`submit`, идемпотентность `decideGate`, чтение running-задачи, коллизию ключа с
   id. Поэтому «20/20 CAUGHT» не покрывает пять путей, где сейчас живут BLOCKER-1/2 и MAJOR-3/4/5.
7. **§6.3 «пауза durable … новый `ControllerLifecycle.activate()` даёт `admitting: false`»** — воспроизвёл,
   но это свойство рестарта: у живого контроллера пауза не поднимается вовсе, а `resumeAdmission` её снимает
   без чтения строки (MINOR-12).

## 5. ЧТО ОСТАЛОСЬ НЕПРОВЕРЕННЫМ

1. **Живой `bd`** — как и в отчёте, не использовался: все находки воспроизведены на детерминированном порте.
   Для BLOCKER-1 существенно лишь то, что порт может применить изменение и не ответить (таймаут/`bd batch`,
   упавший после коммита); это свойство канала, не адаптера.
2. **Полный прогон суиты.** Не запускал: параллельная сессия пересобирала дерево во время прохода (см. §6),
   и любой прогон в тот момент относится к артефакту, который менялся под ним. Числа отчёта (§5) я не
   перепроверял и не оспариваю.
3. **Многопроцессная гонка на одной SQLite** (свойство storage) — не воспроизводил; BLOCKER-2 получен
   внутрипроцессно.
4. **Композиция рантайма** (Cordis-строка, `controller.sqlite`, миграции) — вне карточки (§8.4 отчёта);
   MINOR-12 сформулирован как дефект класса `ControllerLifecycle`, а не как дефект композиции.
5. **L3-предикат целиком** (claims, work type, human gates) — вне объёма MW-011; проверял только
   классификационную половину, которую карточка и требует.
6. **`verifyPlanIntegrity` с `expectedRevision = base+1`** (путь коммита) — не атаковал: коммит вызывает
   верификацию до бампа ревизии, и подменить ожидание извне нечем.
7. **Значения `setMetadata` через порт** — классификация и необратимость шага проверены (§3), но фактическое
   применение/откат metadata не проверял: `TaskGraphPort` не отдаёт metadata обратно, и MINOR-9 отчёта это
   уже фиксирует.

## 6. КОМАНДЫ, АРТЕФАКТЫ, EXIT CODES

| Команда | Exit | Наблюдение |
|---|---|---|
| `git rev-parse HEAD` | 0 | `f22dbc3b2eb97601e09fc4f341bcddd522544545` |
| `git status --porcelain` | 0 | набор baseline не изменился: 12 `M` + 6 новых путей карточки + `DSH-MyWork.rar`; мой след — только `.tmp/` и этот файл |
| `node --test --test-isolation=none tests/plan-mutation.test.mjs` | — | **не запускал** (см. §5.2) |
| `node .tmp/mw011-adv5-core.mjs` | 0 | §2 (MAJOR-3 предикат, MINOR-10, MINOR-11) и таблица §3; вывод — `.tmp/mw011-adv5-core.txt` (56 строк) |
| `node .tmp/mw011-adv5-staged.mjs r1 r2 r3 c1 c2 c3 c4 c5 g1 g2 g3 r4 s1 b1 k1 p1` | 0 | §2 (BLOCKER-1/2, MAJOR-3…9) и §3; вывод — `.tmp/mw011-adv5-staged.txt` (197 строк) |
| `node .tmp/mw011-adv5-lease.mjs l1 l2 l3` | 0 | MINOR-12 и контроль L3; вывод — `.tmp/mw011-adv5-lease.txt` (27 строк) |

Строки-вердикты полного прогона (их же печатает `Select-String -Path .tmp/mw011-adv5-staged.txt -Pattern VERDICT`):

```text
VERDICT.orphanTasksLeftInGraph ["mw-1"]        (R1)
VERDICT.previousDependencySetRestored false    (R2)
VERDICT.orphanTasksAfterRevert ["mw-1"]        (R3)
VERDICT.tasksCreatedForOneKey 2                (C1)
VERDICT.secondIntentApplied false              (C3)
VERDICT.revertedOperationReApplied true        (C4)
VERDICT.releasedWhileStillBlocked true         (G1)
VERDICT.edgeWrittenDiffersFromOutcome true     (S1)
VERDICT.proposalMutationApplied false          (P1)
```

**Идентичность артефакта.** Хеши снимка совпали с живыми бандлами на момент прогонов:

```text
contracts e77e24e6d192e4da   core  bfc0c31892707bb4   storage 293417e41ffd5bc2
evidence  6a13745986b82883   lease 0f8383570c6ccefa   planner b7fc1c68ab26d2dd
```

В снимке присутствует названный в находках код: `core.js:3573` (`if (step.state !== "applied") continue;`),
`planner.js:3823/3854` (оба guard'а revert), `planner.js:3241` (ветка «create с ключами»).
