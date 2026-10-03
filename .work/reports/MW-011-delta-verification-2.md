# MW-011 — дельта-верификация четвёртого прохода (verify-fixes mode)

**Только дельта D-1…D-8.** 12 находок ревью и NEW-1…NEW-6 заново не разбирались.

Baseline: HEAD `f22dbc3b2eb97601e09fc4f341bcddd522544545`, коммитов нет. `git status --short` / `git diff --numstat`
до и после моих ломающих проверок совпадают с baseline (12 ` M` + 7 `??`, numstat байт-в-байт) — исходники
`packages/`, `tests/`, `scripts/` не менялись. Изменено только в `.tmp/` плюс этот файл.

Материалы этого прохода (все в `.tmp/`, вне Git):

| Артефакт | Что это |
|---|---|
| `mw011-d2-probe.mjs` | мой независимый пробник (свои фикстуры, только собранные `packages/*/lib/*.js`), 10 сценариев |
| `d2-probe-A.txt`, `d2-probe-B.txt`, `d2-probe-C.txt` | его вывод (S1–S7, S8, S9–S10) |
| `mw011-d2-mutate.mjs` | мои 8 ломающих мутаций по собранным бандлам (бэкап → мутация → узкий прогон → restore по SHA-256) |
| `d2-mutation-results.txt`, `d2-mutation-MB6.txt`, `d2-mutation-MB8.txt`, `d2-mut-MB*.log` | результаты мутаций и TAP-логи |
| `d2-check.log`, `d2-check-final.log`, `d2-narrow.log`, `d2-regression.log` | числа до и после мутаций |

---

## 1. ВЕРДИКТ

**FIXES PARTIALLY VERIFIED** — семь дефектов дельты (D-1, D-2, D-3, D-4, D-6, D-7, D-8) подтверждены каждый своей
ломающей мутацией или пробником; D-5 закрыт наполовину: create-шаги помечаются `applied`, но шаги внутриплановых
рёбер в той же ветке остаются `pending` у операции, которая сама себя объявляет `verified: true` (N-1).
Новых BLOCKER/MAJOR нет: две новые MINOR (N-1, N-2) и три NIT по отчётности (N-3…N-5) плюс один NIT по силе теста (N-6).

---

## 2. ТАБЛИЦА D-1 … D-8

| # | Вердикт | Доказательство (команда / exit / фрагмент) |
|---|---|---|
| **D-1** — id становятся долговечными до следующего чтения | **VERIFIED** | Источник: `service.ts:462-465` (persist) стоит **до** `service.ts:466-475` (`markEdgeSteps(await graph.dependencies())`). Пробник S1: composite-create `root+child`, чтение `dependencies()` отказывает (`ADAPTER_UNAVAILABLE`) ровно на 3-м чтении, уже после записи задач → `node .tmp/mw011-d2-probe.mjs s1`, exit 0: `S1.threw: no`, `S1.code: ADAPTER_UNAVAILABLE`, `S1.journal.created: {"root":"mw-1","child":"mw-2"}`, `createStepStates: ["applied","applied"]`, `state: recovery`, `admissionHeld: true`, `graph.tasks: ["mw-1","mw-2"]`. Мои мутации: MB1 (`saveMutationCreated` → no-op) → узкий прогон `pass=53 fail=5`, среди упавших именно `the ids of created tasks are durable before anything else is read`; MB7 (persist перенесён **после** чтения, т.е. ровно до-D-1-порядок) → `pass=57 fail=1`, падает **только** тот же тест. Follow-through S10: `resume` после этой recovery → `ok=true`, `state=applied`, `calls.create=2` (дубликата нет), ребро `mw-2->mw-1` одно, `admissionHeld=false`, `planRevision=1`. |
| **D-2** — заглушка counter-case теста бросает всегда | **VERIFIED** | Источник: `tests/plan-mutation.test.mjs:1760-1762` — `graph.port.mutatePlan = async () => { throw foreign }`, безусловно. Пробник S9 (свой интент create-only, счётчик вызовов): `S9.stub.calls: 1` (заглушка действительно сработала), `S9.applied.code: PLAN_MUTATION_RECOVERY`, `journal.state: recovery`, `created: {}`, `createStepStates: ["pending"]`, `admissionHeld: true`. Моя мутация MB3 (снята половина guard'а: `nothingLanded && !createsTasks` → `nothingLanded`) → `pass=57 fail=1`, падает **только** `a conflict from the middle of an operation stays a recovery, not a pre-write refusal` (код переключается на `TASK_CONFLICT`) — т.е. тест наблюдает именно этот guard. |
| **D-3** — якоря, названные предыдущим проходом, приведены к фактическим | **VERIFIED** | Оба названных якоря теперь содержат тот код, который называют: `core/plan.ts:779-788` содержит `planEdgeRef` (779-784); `core/plan.ts:797-880` содержит цикл шагов внутриплановых рёбер (833-841); `service.ts:477-500` содержит `materializePlanPart` (:483) и `hasWork` (:486-488) — это ровно то, что предыдущий проход предлагал как `service.ts:454-471` (+23 строки сдвига от правки D-1). |
| **D-4** — три диапазона §3.2 приведены к фактическим | **VERIFIED** (с остаточным NIT) | `invertPlanSteps` назван как `core/plan.ts:1064-1140` — функция 1064-1148, диапазон внутри тела ✓; `markEdgeSteps` `service.ts:394-412` — функция 394-406, диапазон содержит её целиком ✓ (хвост +6 строк — N-3); `refusalShape`/`PRE_WRITE_CODES` `service.ts:180-240` содержит 187-194, 197-203, 216-232 ✓. |
| **D-5** — известные id помечают шаги создания `applied` | **PARTIAL** | Что сделано: `service.ts:427-442` помечает create-шаги `applied` при известном id. Пробник S8 (своя crashable-обёртка, свой fake-порт): blind-resume → `PLAN_MUTATION_RECOVERY`, `unresolvedCreates ["n1"]`, `calls.create` остаётся 1; resume с `adoptedCreated {n1:'mw-1'}` → `ok=true`, `journal.created {"n1":"mw-1"}`, `createStepStates ["applied"]`, `state applied`, `admissionHeld false`, `calls.create=1`. Моя мутация MB6 (снята пометка) → `pass=57 fail=1`, падает **только** `a create whose id was never journalled needs the operator to resolve it`. **Чего не сделано:** предыдущий проход просил в той же ветке «и вызывать `markEdgeSteps` при `composite`»; шаги внутриплановых рёбер так и остались `pending` — N-1. |
| **D-6** — ярлык M14 + тест на ветку `run` | **VERIFIED** | Тест добавлен и наблюдает именно `run`: моя мутация MB4 (сломан **только** guard в `run`, `if (false)` перед `integrity-verification-failed`) → `pass=57 fail=1`, падает `a port that reports success without writing the edge goes to recovery, not to success`, а `a revert that did not restore the graph keeps the pause and stays in recovery` остаётся зелёным. Полная реплика M14 (обе ветки, как в `.tmp/mw011-mutations.ps1:130-131`) → MB8: `tests 58 / pass 56 / fail 2` — ровно `revert`-тест и «порт соврал». Ярлык в батарее (`M14 verification guards removed (run + revert)`) называет реальную зону поражения. |
| **D-7** — одно ребро = один шаг и один inverse | **VERIFIED** | Источник: `core/plan.ts:811-820` (`pushEdge`, дедуп по ref), `core/plan.ts:1076-1077` + `:1093-1096`/`:1105-1108` (дедуп пар в инверсии). Пробник S7 (ребро названо и через `dependsOnKeys`, и дважды в `addDependencies`): `S7.applied.ok: true`, `journal.addEdgeSteps: ["key:child\u0000key:root"]` (один), `inverse.removeDependencies: [{"from":"mw-2","to":"mw-1"}]` (один), `graph.edgePairs: ["mw-2->mw-1"]`. Моя мутация MB5 (снят дедуп в planner- и core-бандле) → `pass=57 fail=1`, падает **только** `an edge named twice is one journal step and one inverse command`. |
| **D-8** — отказ чтения = типизированный ответ, а не исключение | **VERIFIED** | Пробник S2–S6 (свой порт, отказ `ADAPTER_UNAVAILABLE`): `stage` → `S2.threw: no`, `code ADAPTER_UNAVAILABLE`, `admissionHeld false`, строки журнала нет; pre-flight `run` (`apply`) → `S3.threw: no`, `code ADAPTER_UNAVAILABLE`, `journal.state staged`, `admissionHeld true`, граф не тронут; пост-верификация `run` → `S4.threw: no`, `code ADAPTER_UNAVAILABLE`, `state recovery`, `report.verified false`, `admissionHeld true`, ребро снято и шаг `applied`; `verifyInverse` в `revert` → `S5.threw: no`, `code ADAPTER_UNAVAILABLE`, `state recovery`, `failure: revert-unreadable: …`, `admissionHeld true`, граф восстановлен (`A-1->B-1`), `planRevision 0`; `integrityReport` → `S6.threw: no`, `code ADAPTER_UNAVAILABLE`, состояние не меняется. Моя мутация MB2 (снята обёртка `observe`/`stage`) → `pass=57 fail=1`, падает **только** `a port that refuses during staging answers with a typed failure, not an exception`. |

**Числа совпадают с заявленными** (§1 и §5 отчёта исполнителя):

| Прогон | Заявлено | Измерено |
|---|---|---|
| `pnpm run check` | 357 / 334 pass / 0 fail / 23 skip | **357 / 334 / 0 / 23**, exit 0 (до мутаций и повторно после восстановления) |
| `node --test --test-isolation=none tests/plan-mutation.test.mjs` | 58 pass / 0 fail | **58 / 0**, exit 0 (дважды: до и после мутаций) |
| `… tests/lease.test.mjs` | 25 pass | **25 / 0**, exit 0 |
| `… lease + beads-adapter + evidence + events` | 116 tests / 93 pass / 0 fail / 23 skip | **116 / 93 / 0 / 23**, exit 0 (дважды) |
| §7 numstat и счётчики строк | 12 файлов + 6 новых | совпадает построчно (`502`, `152`, `157`, `1149`, `2020`, `1366`, 5 файлов в `src/planner`) |

---

## 3. НОВЫЕ FINDINGS

### N-1 — MINOR (D-5 закрыт наполовину: шаги внутриплановых рёбер остаются `pending` у `verified: true`)

`.work/reports/MW-011-plan-mutations.md:83` + `packages/planner/src/service.ts:427-443`.

Ветка «известные id» (`missing.length === 0`) помечает `applied` только create-шаги и делает `continue`; вызов
`markEdgeSteps`, который есть в обычной composite-ветке (`service.ts:466-475`), здесь отсутствует. Предыдущий проход
просил именно оба действия (`MW-011-delta-verification.md:123-124`).

Наблюдение (пробник S10, atomic composite, `requireAtomic: true`, resume после D-1-recovery):

```text
S10.resume.ok: true            S10.resume.state: applied
S10.journal.report.verified: true
S10.journal.edgeStepStates: ["key:child\u0000key:root=pending"]   ← ребро реально есть: S10.graph.edgePairs ["mw-2->mw-1"]
S10.calls: {"mutatePlan":1,"create":2,"dependencies":5,"get":0,"transition":0}
```

Почему важно: журнал — это evidence-of-record и вход `invertPlanSteps` (§5.2); здесь он описывает часть операции
противоречиво (`applied` + `verified: true` + шаг `pending`). Сегодня исхода это не меняет (операция с созданиями
необратима, `revert` отказывает по `irreversible-steps`, а завершённая — по `operation-settled`), поэтому MINOR,
а не MAJOR; но если у `revert` появится путь для завершённых операций, недопомеченный шаг станет дырой.

Минимальная правка (3 строки, не нарушает правило D-1 — чтение после persist): в конце ветки `missing.length === 0`,
если команда несёт внутриплановые ключи (`(command.create ?? []).some(spec => (spec.dependsOnKeys ?? []).length > 0)`),
выполнить `markEdgeSteps(working.steps, await graph.dependencies(), working.created)` и `writeSteps` — как в
`service.ts:466-475`; тест — расширить `tests/plan-mutation.test.mjs:1817` проверкой шага ребра.

### N-2 — MINOR (принятый id не проверяется ничем: `applied` и `verified: true` для задачи, которой нет)

`packages/planner/src/service.ts:1033-1037` (`adoptedCreated` сливается в `record.created` и пишется в журнал) +
`packages/core/src/plan.ts:1004-1007` (`unresolvedCreates` проверяет только наличие ключа в карте) + пометка
`service.ts:431-436`.

Вопрос задания («можно ли принять неверный id и получить `applied` без доказательства») — **да, можно**; проверено
эмпирически (пробник S8, два дополнительных под-сценария с той же crashable-схемой):

```text
S8.wrongId.resume.ok: true    S8.wrongId.journal.created: {"n1":"unrelated-1"}
S8.wrongId.journal.state: applied   S8.wrongId.journal.createStepStates: ["applied"]
S8.wrongId.journal.report.verified: true
S8.ghostId.resume.ok: true    S8.ghostId.journal.created: {"n1":"mw-999"}   ← такой задачи в графе нет вообще
S8.ghostId.journal.state: applied
```

То есть: оператор, назвавший чужой id, переводит операцию в `applied` с `verified: true`, журнал объявляет создание
состоявшимся, а реально созданная задача остаётся сиротой (в первом под-сценарии `graph.tasks` = `B-1, D-1, mw-1,
unrelated-1`, в журнале — `unrelated-1`).

**Приемлемо ли это.** Механизм `adoptedCreated` — задокументированная аттестация оператора, и решение с `decidedBy`/
`reason` пишется в audit (`recordMutationDecision`), т.е. путь прослеживаем; поэтому это не BLOCKER. Но `verified: true`
здесь — утверждение, которое планировщик не может подтвердить, а `externalRef` создаваемой задачи детерминирован
(`planExternalRef(operationId, key)`, пишется обеими ветвями), так что проверка дешёвая. **Дополнительный контроль
нужен**, минимальный: на `resume` с `adoptedCreated` читать каждый принятый id через порт и требовать, чтобы задача
существовала (а если порт отдаёт `externalRef` — чтобы он совпал с ожидаемым); неподтверждённый id оставлять
неразрешённым → `PLAN_MUTATION_RECOVERY`. Альтернатива без чтения: помечать в отчёте/audit принятые id отдельно
(`adopted`), чтобы `verified: true` не выдавался за наблюдение.

### N-3 — MINOR (evidence-of-record: артефакт батареи устарел, и §6.2/§3.4 противоречат ему в строке M14)

`.work/reports/MW-011-plan-mutations.md:100` и `:210` против `.tmp/mw011-mutation-results.txt:15`.

`tests/plan-mutation.test.mjs` имеет mtime `13:34:17`, а `mw011-mutation-results.txt` — `13:34:07`: батарея
прогонялась против суиты из **57** тестов, до добавления теста «порт соврал». Отсюда:

- артефакт пишет `M14 … pass=56 fail=1 by: a revert that did not restore the graph…` (одна падавшая проверка), тогда
  как §6.2 печатает `56 / 2` и `revert; «порт соврал»`, а §3.4 — «M14 ловят два теста». Само утверждение **верно**:
  моя реплика M14 (MB8) дала `tests 58 / pass 56 / fail 2` с ровно этими двумя тестами, но артефакт этого не
  показывает — числа строки M14 в отчёт попали без перезапуска батареи;
- все остальные 19 строк имеют пары `pass+fail = 57` при текущих 58 тестах, т.е. устарели на +1 pass. Мои
  независимые реплики совпали по составу падавших тестов и дали ровно +1 pass: M17 (`52/5` → мои `53/5`,
  MB1), M18 (`56/1` → `57/1`, MB2), M19 (`56/1` → `57/1`, MB3), M7 (`56/1` → `57/1`, MB6).

Минимальная правка: перезапустить `.tmp/mw011-mutations.ps1`, перезаписать `.tmp/mw011-mutation-results.txt` и
обновить числа §6.2 (или явно указать в §3.4, что строка M14 досчитана отдельным прогоном против 58-тестовой суиты).

### N-4 — NIT (якорь и формулировка строки D-8)

`.work/reports/MW-011-plan-mutations.md:86`. Диапазон `service.ts:648-665` для pre-flight обёртки: сама обёртка —
`660-668`, а её типизированный `return fail(refusal, meta)` — строка **666**, т.е. вне названного диапазона.
Формулировка «операция уходит в recovery с открытой паузой» верна для трёх из четырёх названных мест
(`:740-760`, `:1100-1115`, `:1152-1170` — но последнее вообще не про recovery, а про `Result`), а на pre-flight
операция остаётся в `staged` с открытой паузой (пробник S3) — это корректно (ничего не записано, повтор возможен),
но текст это не отражает. Правка: `service.ts:660-668` и уточнение про pre-flight.

### N-5 — NIT (якорь §3.1 MAJOR-5)

`.work/reports/MW-011-plan-mutations.md:51`: «создаваемая задача получает `externalRef … (core/plan.ts:655-672),
обе ветви: staged и атомарная». В диапазон 655-672 попадает только атомарная ветвь (`ensureExternalRef`, :663);
staged-ветвь — `prepareCreateSpec` (`core/plan.ts:638`, вызов :676). Правка: `core/plan.ts:661-676` или назвать обе
строки. (Сам код исправления проверен: `externalRef` действительно ставится в обеих ветвях.)

### N-6 — NIT (сила одной ассерции теста D-1)

`tests/plan-mutation.test.mjs:1819-1823` проверяет `record.report.unresolvedCreates === []`, но этот отчёт
синтезируется `enterRecovery` с **захардкоженным** `unresolvedCreates: Object.freeze([])`
(`packages/planner/src/service.ts:377`), т.е. ассерция выполняется по построению и ничего не доказывает.
Несущая проверка в этом тесте — `record.created` (`:1812-1816`), и мои MB1/MB7 валят тест именно через неё, так что
тест **не** вакуумен; лишняя ассерция лишь создаёт видимость доказательства. Правка: убрать её либо проверять
`unresolvedCreates` там, где отчёт считается настоящим `verifyPlanIntegrity`.

---

## 4. ПРОВЕРЕННЫЕ КОМАНДЫ

| Команда | Exit | Наблюдение |
|---|---|---|
| `git status --short`, `git rev-parse HEAD`, `git diff --numstat` | 0 | baseline и после мутаций идентичны (12 ` M` + 7 `??`); HEAD `f22dbc3b…`; numstat совпал с §7 |
| `pnpm run check` (до мутаций) | 0 | **357 tests / 334 pass / 0 fail / 23 skip** |
| `node --test --test-isolation=none tests/plan-mutation.test.mjs` | 0 | **58 / 58 pass / 0 fail** |
| `node --test --test-isolation=none tests/lease.test.mjs` | 0 | 25 pass / 0 fail |
| `node --test --test-isolation=none tests/lease.test.mjs tests/beads-adapter.test.mjs tests/evidence.test.mjs tests/events.test.mjs` | 0 | 116 tests / 93 pass / **0 fail** / 23 skip |
| `node .tmp/mw011-d2-probe.mjs s1 s2 s3 s4 s5 s6 s7` | 0 | D-1 и четыре обёртки D-8 держат (см. §2) |
| `node .tmp/mw011-d2-probe.mjs s8` | 0 | D-5 работает; чужой и несуществующий id принимаются (N-2) |
| `node .tmp/mw011-d2-probe.mjs s9 s10` | 0 | D-2 guard наблюдается; resume после D-1 не дублирует создание |
| `node .tmp/mw011-d2-mutate.mjs` (MB1–MB7) | 0 | 7 мутаций: каждой падает ожидаемый тест; snapshot-restore подтверждён SHA-256 (`restored=true` во всех) |
| `node .tmp/mw011-d2-mutate.mjs MB8` (реплика M14) | 0 | 58 tests / 56 pass / **2 fail** — revert + «порт соврал» |
| `node .tmp/mw011-d2-mutate.mjs MB6` (после починки якоря) | 0 | `fail=1`, падает только `a create whose id was never journalled…` |
| `pnpm run build` (восстановление) | 0 | пересборка из `src`, все пакеты ✔ |
| `node --test … tests/plan-mutation.test.mjs` (после восстановления) | 0 | 58 / 58 pass / 0 fail |
| `pnpm run check` (после восстановления) | 0 | **357 / 334 / 0 / 23** — дерево вернулось к baseline-состоянию |

Замечание по одной ошибке процесса: первый прогон MB6 был невалидной мутацией (мой якорь обрезал выражение и дал
`SyntaxError` в бандле) — мутация переписана целиком, результат в таблице выше. Это дефект моего скрипта, не кода.

---

## 5. ЧТО ОСТАЛОСЬ НЕПРОВЕРЕННЫМ

- **Полная батарея 20 мутаций не перезапускалась** (вне объёма). Сверен артефакт `.tmp/mw011-mutation-results.txt`
  построчно против §6.2 (совпадает, кроме строки M14 — N-3) и независимо воспроизведены 5 рядов: M7, M17, M18, M19
  (мои MB6/MB1/MB2/MB3 — совпал состав падавших тестов) и M14 (MB8). Остальные 15 рядов приняты по артефакту, их
  числа не перемерялись (кроме арифметического вывода про 57-тестовую суиту).
- **§5 отчёта, строка «`pnpm run check` до правок = 299 / 276 pass»**: историческое число, снимка baseline-суиты у
  меня нет — воспроизвести нельзя; текущее состояние (357/334/0/23) воспроизведено дважды.
- **§6.1 (находка в MW-010, staged-путь теряет `dependsOnKeys`)** и `.tmp/mw011-mw010-staged-probe.mjs` — вне объёма.
- **Формы fixed-id для N-2**: не проверял, отдаёт ли живой `bd`-адаптер `externalRef` через `get` (живой `bd` вне
  объёма), поэтому рекомендация опирается на контракт `TaskGraphPort`, а не на проверку адаптера.
- **D-8 на путях, где отказ приходит не от `dependencies()`** (например `transition`, `get`): обёрнуты только чтения
  графа; поведение `readStates`/`snapshots` (они глотают отказ и молча теряют состояние) не пересматривалось — это
  существующее поведение, а не дельта.
- `verify:profile`, `pack:local`, UI/API-карточки, живая доска и `.beads/` — вне объёма.
