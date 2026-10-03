# MW-011 — дельта-верификация третьего прохода (verify-fixes mode)

Карточка: MW-011. Base SHA = HEAD = `f22dbc3b2eb97601e09fc4f341bcddd522544545`, коммитов нет, дерево не менялось
мной вне `.tmp/` и этого файла. Объём — **только дельта**: NEW-1, NEW-2, NEW-3 (плюс отчётные NEW-4/NEW-5/NEW-6)
и дефекты, внесённые этими правками. 12 находок ревью и подтверждённые ранее исправления заново не разбирались.

Инструменты прохода (все в `.tmp/`, Git их не видит): `mw011-delta-probe.mjs` (пробник через публичный API
собранных `packages/*/lib`), `mw011-delta-mutate.mjs` (ломающие мутации по бандлам + байт-точное восстановление
с проверкой sha256), `mw011-delta-mutations.ps1` (драйвер циклов), выводы: `delta-probe-results.txt`,
`delta-probe-E.txt`, `delta-probe-IJ.txt`, `delta-probe-H.txt`, `delta-mutation-results.txt`,
`delta-mut-*.log`, `delta-regression-tap.log`, `delta-check.log`.

---

## 1. ВЕРДИКТ

**FIXES PARTIALLY VERIFIED** — все шесть находок предыдущего прохода (NEW-1…NEW-6) исправлены и подтверждены
(каждая — своей ломающей мутацией, узкий прогон падает), но дельта внесла **новый дефект**: на атомарном
composite-пути добавленное чтение `graph.dependencies()` стоит **между** записью создания в граф и записью
`created` в журнал, поэтому отказ этого чтения теряет id созданных задач (операция спасена fail-closed guard'ом,
но выводится из recovery только оператором через `adoptedCreated`).

## 2. ТАБЛИЦА: NEW-1 … NEW-6

| # | Вердикт | Доказательство (команда / exit / фрагмент) |
|---|---|---|
| **NEW-1** | **VERIFIED** | `node .tmp/mw011-delta-probe.mjs A` (exit 0): `create[root,child]+addDependencies[child→root]` → `A1 {"ok":true,"mode":"staged","created":{"root":"mw-1","child":"mw-2"},"verified":true}`; `A2 edge journal {"refs":["key:child\u0000key:root"],"states":["applied"]}` (не `failed`); `A3 graph ["mw-2->mw-1"]` (id, не ключи); `A4 inverse {"irreversible":["create","create"],"removes":["mw-2->mw-1"]}` (`core.invertPlanSteps(steps, meta, 1, created)` выпускает **id**). Своя ломающая мутация M1 (`if (!ref.includes("key:")) return ref;` → `return ref;` в `packages/core/lib/index.js` **и** `packages/planner/lib/index.js`, ядро инлайнится): узкий прогон `51 pass / 3 fail` — упали «a plan of new tasks with intra-plan dependencies…», «the journal of an edge between created tasks names ids, and its inverse restores them», «a composite call marks its intra-plan edge steps as applied». Восстановлено (sha256 совпал), `pnpm run build`, снова 54/0 |
| **NEW-2** | **VERIFIED** | Пробник `C`: `requireAtomic: true` + `create[root, child(dependsOnKeys:[root])]` → `C1 {"ok":true,"mode":"atomic","verified":true,"calls":{"mutatePlan":1,...}}`, `C2 graph ["mw-2->mw-1"]`, `C3 all steps ["create/create:applied","create/create:applied","edges/add-edge:applied"]` — ни одного `pending`. Своя ломающая мутация M2 (`if (composite) steps = markEdgeSteps(` → `if (false && composite) …`): целевой тест падает, узкий прогон `53 pass / 1 fail`. Восстановлено, rebuild, 54/0 |
| **NEW-3** | **VERIFIED** | Пробник `D`: порт бросает класс с `code: 'CAPABILITY_UNSUPPORTED'`, **чуждый** бандлу планировщика — `D0 {"name":"MyWorkError","isMyWorkError":false,"instanceofCoreMyWorkError":false,"plannerOwnClass":false}` (условие чужого бандла выполнено), `D1 {"ok":false,"code":"CAPABILITY_UNSUPPORTED","details":{"missing":["batch"]}}`, `D2 {"state":"recovery","admissionHeld":true,"graph":["D-1->B-1","D-2->B-1"]}` (пауза держится, граф не тронут). Обратные случаи: `E1` конфликт из середины create-содержащей операции → `PLAN_MUTATION_RECOVERY` при `E2 created={"solo":"mw-1"}` (утверждение «ничего не написано» действительно недоказуемо), `E3` конфликт до записи без созданий → `TASK_CONFLICT` как есть (guard не «одеяло»), `E4` конфликт до записи **с** созданием → `PLAN_MUTATION_RECOVERY` (`created {}`, `appliedSteps 0`, пауза). Своя ломающая мутация M3 (`refusalShape` всегда `undefined`): целевой тест падает, узкий прогон `53 pass / 1 fail` |
| **NEW-4** | **VERIFIED** (но см. D-3) | Несуществующего якоря `service.ts:3186` в §3 больше нет: `Select-String .work/reports/MW-011-plan-mutations.md -Pattern '3186'` → 1 совпадение, и это строка §3.2 L67, **описывающая** старый дефект; §3.1 L45 цитирует `planner/src/service.ts:375-395`. Сам дефект «якорь ведёт в никуда» снят, но новая ссылка указывает не на тот код (finding D-3) |
| **NEW-5** | **VERIFIED** | §4.5 L127 `src/service.ts (1300)` = `(Get-Content packages/planner/src/service.ts).Count` = **1300**; `~1290` в отчёте не осталось; §7 L224 «1300 строк сервиса». Соседние числа §4.5 тоже верны: `schema.ts 156`, `store.ts 614`, `errors.ts 70`, `index.ts 87` |
| **NEW-6** | **VERIFIED** | `.tmp/mw011-mutations.ps1:100-101` теперь объясняет `CAUGHT` («Caught by the journal assertion of the same test, which is why the report counts it as CAUGHT»), слова `EQUIVALENT` в скрипте нет: `Select-String .tmp/mw011-mutations.ps1 -Pattern 'EQUIVALENT'` → 0 совпадений; в `mw011-mutation-results.txt` строка M11a = `CAUGHT … pass=52 fail=2 …` |

**Достоверность §7 (numstat).** Все 12 изменённых путей совпали с `git diff --numstat` до строки:
`beads-adapter/src/plan.ts +8 −31`, `contracts/{artifact +7, audit +9, events +9, index +2}`, `core/{graph +55, index +33 −1}`,
`lease/lifecycle +49`, `pnpm-lock +15`, `tests/{events +3, evidence +4 −2, lib/fixtures +4}`.
Новые файлы по числу строк: `contracts/src/plan.ts 502`, `contracts/src/workflow.ts 152`, `core/src/plan.ts 1127`,
`core/src/blocker.ts 157`, `tests/plan-mutation.test.mjs 1879 / 54 проверки`, `planner/src/×5` — всё совпало.

**Достоверность §5 (числа).** `pnpm run check` = **353 tests / 330 pass / 0 fail / 23 skip** (дважды: в начале прохода и
финально после мутаций/восстановления); узкий прогон = **54 pass / 0 fail**; объединённый регресс = **116 tests /
93 pass / 0 fail / 23 skip**; по отдельности `lease` = 25/25, `beads-adapter` = 68 tests / 45 pass / 0 fail / 23 skip.
Заявленные в §3.3/§6.2 числа M15 (`51/3`) и M16 (`53/1`) я воспроизвёл своими мутациями M1 и M3 (`51/3` и `53/1`,
те же тесты) — батарея исполнителя в этой части не «на словах».

## 3. НОВЫЕ FINDINGS

### D-1 — MINOR (внесено исправлением NEW-2): добавленное чтение графа стоит между записью создания и журналом, и его отказ теряет id созданных задач

`packages/planner/src/service.ts:445` (`steps = markEdgeSteps(steps, await graph.dependencies(), created)`) стоит
**до** `store.transaction(...)` на `service.ts:448-451`, где `saveMutationCreated` и `writeSteps` только и делают
`created` долговечным. Отказ этого чтения (реальный порт — это `bd dep list`, у него есть `ADAPTER_UNAVAILABLE`,
таймауты) превращает полностью удачное атомарное создание в recovery, где журнал утверждает, что не создано ничего.

Доказательство (`node .tmp/mw011-delta-probe.mjs J`, exit 0; порт отвечает на create штатно, а следующее чтение
`dependencies()` бросает `ADAPTER_UNAVAILABLE` — ровно так, как это делает исправление):
`J1 {"result":{"ok":false,"code":"ADAPTER_UNAVAILABLE"},"state":"recovery","created":{},"steps":["create/create:pending","create/create:pending","edges/add-edge:pending"],"tasks":["mw-1","mw-2"],"edges":["mw-2->mw-1"],"admissionHeld":true}` →
`J2 resume` → `PLAN_MUTATION_RECOVERY` с `"unresolvedCreates":["root","child"]` → выйти можно только
операторским `adoptedCreated` (`J4 {"ok":true,"verified":true}`, `J5 createsAdded: 0`).

Почему важно: до этой правки composite-путь писал журнал сразу после `mutatePlan`, и окно «создано, но не
зажурналировано» открывалось только смертью процесса. Теперь его открывает любой отказ одного дополнительного
чтения. Дублирования и порчи нет (guard BLOCKER-3 держит, `apply`/`resume` fail-closed — я это подтвердил),
поэтому MINOR, а не MAJOR.

Минимальная правка: сделать `created` долговечным **до** чтения — перенести
`store.transaction(tx => { saveMutationCreated(...); writeSteps(...) })` выше `if (composite)`, а пометку
шагов сделать после чтения отдельным `writeSteps`. Тогда отказ чтения оставляет журналу id (и `resume`
доводит операцию сам), а не требует оператора.

### D-2 — MINOR (внесено исправлением NEW-3): новый тест «a conflict from the middle of an operation stays a recovery» не наблюдает guard, ради которого написан

`tests/plan-mutation.test.mjs:1744-1771`. Заглушка порта бросает только при `command.removeDependencies.length > 0`,
а интент в тесте — `create: [{ key: 'solo' }]` без единого ребра, т.е. **исключение не бросается ни разу**.

Доказательства: (1) повтор той же сцены в пробнике (`E2 replay of the repo test`) даёт
`{"stubThrewTimes":0, "result":{"ok":false,"code":"PLAN_MUTATION_RECOVERY", "message":"…integrity verification did not confirm the plan…"}, "stepStates":["create:failed"]}`
— код приходит из ветки провала верификации (`service.ts:709-720`), а не из catch с `refusalShape`;
(2) ломающая мутация M4 (`if (GUARDED_CODES.includes(refusal.code) || nothingLanded && !createsTasks) …` →
`… || nothingLanded)`, т.е. снята половина guard'а про создания) оставляет этот тест **зелёным** (`1 pass / 0 fail`),
тогда как мой пробник на той же сборке переключает `E4` с `PLAN_MUTATION_RECOVERY` на `TASK_CONFLICT`;
(3) это же объясняет строку M14 батареи исполнителя (§6.2): `Set-Text` заменяет **все** вхождения
(`.tmp/mw011-mutations.ps1:22`), а `if (!report.verified) {` встречается в бандле дважды — L3490 (`run`) и
L3747 (`revert`), поэтому «середина операции» падала от выключенной ветки `run`, а не от revert.

Почему важно: у NEW-3 два предмета — «чужой отказ возвращается как есть» и «отказ из середины create-содержащей
операции остаётся recovery». Первый пиннут и падает от M3; второй не пиннут вовсе: удаление `createsTasks`
не заметит ни один тест.

Минимальная правка (одна строка): в `tests/plan-mutation.test.mjs:1751` сделать заглушку бросающей на самом деле —
`graph.port.mutatePlan = async () => { throw foreign }` (или добавить `if ((command.create ?? []).length > 0) throw foreign`
в начало заглушки). Проверено, что такой тест ловит регрессию: под M4 мой `E4` меняет код, и тест обязан упасть.

### D-3 — MINOR (отчётность): два новых якоря §3.1/§3.2 не содержат кода, который называют

- `.work/reports/MW-011-plan-mutations.md:45` и `:64` — `core/plan.ts:800-812` для `planEdgeRef` и для «журнал заводит
  по шагу на каждый внутриплановый ключ». Фактически: `planEdgeRef` — `packages/core/src/plan.ts:779-784` (док 772-778),
  шаги внутриплановых рёбер — `:819-829`; диапазон 800-812 — это `push` и цикл create-шагов, названного кода в нём нет.
- `.work/reports/MW-011-plan-mutations.md:45` — `planner/src/service.ts:375-395` (это и есть замена по NEW-4) для
  «сама часть выбирается по **материализованной команде**, а не по шагам». Фактически это `service.ts:454-471`
  (`materializePlanPart` + `hasWork`); 375-395 — хвост `enterRecovery` (375-383) и начало `markEdgeSteps` (386-395).

Почему важно: §3 назван в отчёте главным разделом, а NEW-4 был ровно про это; замена несуществующего якоря на
якорь, ведущий в другое место, оставляет дефект evidence-of-record живым.

Минимальная правка: `core/plan.ts:779-784` (для `planEdgeRef`) и `core/plan.ts:819-829` (для шага), `service.ts:454-471`
(для выбора части).

### D-4 — NIT (отчётность): три диапазона §3.2 начинаются/кончаются вне названного кода

`:64` `core/plan.ts:1032-1085` → функция `invertPlanSteps` = `1038-1119` (док 1038-1051, тело 1052-1119);
`:65` `service.ts:397-417` → `markEdgeSteps` = `386-406` (в диапазон попадает лишь хвост 397-406, дальше уже `runParts`);
`:66` `service.ts:186-222` → `refusalShape` = `205-232` (187-203 — константы `PRE_WRITE_CODES`/`GUARDED_CODES`).
Правка: поставить точные диапазоны.

### D-5 — NIT (существовало до дельты, но того же класса, что NEW-2): resume через `adoptedCreated` коммитит операцию, у которой **все** шаги так и остались `pending`

`service.ts:426-427` (`if (missing.length === 0) continue`) пропускает не только повтор создания, но и пометку
шагов. Пробник `J`: `J4 {"ok":true,"verified":true}` → `J5 {"state":"applied","steps":["create/create:pending","create/create:pending","edges/add-edge:pending"],"admissionHeld":false}`
— завершённая операция описывает себя полностью незавершённой. Тест `tests/plan-mutation.test.mjs:976` доходит до
`resolved.value.created` и состояния шагов не проверяет. Проверил по сохранённому добанному бандлу
(`.tmp/vfix-backup/planner.js:3154-3155`): `missing`/`continue` существовали до правок NEW-1…NEW-3, т.е. это не
регрессия дельты, а непокрытая часть того же класса, что NEW-2. Правка (если владелец сочтёт нужным): помечать
create-шаги из `working.created` (и вызывать `markEdgeSteps` при `composite`) до `continue`.

### D-6 — NIT (scratch-скрипт): мутация M14 имеет более широкую зону поражения, чем её ярлык, и это меняет столбец «Поймал тест»

`.tmp/mw011-mutations.ps1:130`: `Set-Text $plannerBundle 'if (!report.verified) {' 'if (false) {'` — `Set-Text`
(`:19-23`) использует `$content.Replace`, т.е. заменяет оба вхождения (L3490 `run`, L3747 `revert`). Поэтому
§6.2/§3.3 приписывают мутации `revert` падение теста «a conflict from the middle of an operation stays a recovery»,
который происходит от выключенной ветки `run`. Правка: либо якорь только для revert-ветки, либо пометка в таблице.

### D-7 — NIT (граничный ввод, не функциональный дефект): одно и то же ребро, названное дважды, даёт два одинаковых шага и дублирующий inverse

`core/src/plan.ts:819-835`: если ребро задано и как `create[].dependsOnKeys`, и как явный `addDependencies`,
журнал получает два шага с одинаковым ref. Пробник `I`: `{"ok":true,"verified":true,"edgeSteps":["key:child\u0000key:root:applied","key:child\u0000key:root:applied"],"graph":["mw-2->mw-1"],"inverseRemoves":["mw-2->mw-1","mw-2->mw-1"]}`.
Сегодня безвредно (операция с созданиями необратима, `revert` отказывает), но дубль в инверсии — лишний.
Правка: дедуплицировать шаги рёбер по ref или отвергать такой интент как противоречивый.

## 4. ПРОВЕРЕННЫЕ КОМАНДЫ

| Команда | Exit | Наблюдение |
|---|---|---|
| `git status --short` (до и после) | 0 | набор не изменился: 12 `M` + 6 новых путей карточки + `DSH-MyWork.rar`; мой след — только `.tmp/` |
| `git rev-parse HEAD`, `git stash list` | 0 | `f22dbc3b2eb97601e09fc4f341bcddd522544545`; 0 stash; коммитов/push/checkout не делал |
| `pnpm run check` (до мутаций) | 0 | **353 tests / 330 pass / 0 fail / 23 skip** |
| `node --test --test-isolation=none tests/plan-mutation.test.mjs` | 0 | **54 pass / 0 fail** |
| `node .tmp/mw011-delta-probe.mjs` (A B C D E E2 F G H I J) | 0 | §2 и findings; тяжёлые ветки: F (порт игнорирует `dependsOnKeys`) → `edges/add-edge:failed`, `PLAN_MUTATION_RECOVERY`, пауза, граф пуст; G (повтор `apply`/`submit`) → задач/рёбер/созданий не прибавилось; H (убийство писателя до части `edges`) → `resume` ok, `verified:true`, `edges/add-edge:applied`, `createsAdded 0` |
| `node .tmp/mw011-delta-mutate.mjs backup/M1/M2/M3/M4/restore/verify` | 0 | sha256 бандлов до/после восстановления совпали (`fa017463169086d0`, `f02b1aef7750be32`) |
| `pwsh .tmp/mw011-delta-mutations.ps1` | 0 | узкий прогон: M1 → `51 pass / 3 fail`, M2 → `53 / 1`, M3 → `53 / 1`; M4 → целевой тест **1 pass / 0 fail** (см. D-2) |
| `pnpm run build` | 0 | пересборка из исходников; `verify` после неё — бандлы идентичны сохранённым |
| `node --test --test-isolation=none tests/{lease,beads-adapter,evidence,events}.test.mjs` | 0 | **116 tests / 93 pass / 0 fail / 23 skip**, ни одного `not ok` |
| `node --test … tests/lease.test.mjs` / `tests/beads-adapter.test.mjs` | 0 / 0 | 25/25 и 68 tests / 45 pass / 0 fail / 23 skip (§5 подтверждён пофайлово) |
| `pnpm run check` (финал, после restore+rebuild) | 0 | **353 tests / 330 pass / 0 fail / 23 skip** |
| `git diff --numstat` | 0 | 12 строк, совпадают с §7 до числа |
| `Select-String` по `3186` / `EQUIVALENT`; `.Count` файлов | 0 | NEW-4/NEW-5/NEW-6 закрыты (§2); счётчики строк §4.5/§7 совпали |
| `Select-String packages/*/lib -Pattern 'if (false && composite)\|return void 0; if (typeof error\|nothingLanded) return fail'` | 1 (нет совпадений) | следов мутаций в собранных артефактах не осталось |

## 5. ЧТО ОСТАЛОСЬ НЕПРОВЕРЕННЫМ

1. **Полная батарея 17 мутаций исполнителя не перезапускалась** (вне объёма прохода). Сверены только её артефакты:
   `mw011-mutation-results.txt` = 17 `CAUGHT` / 0 `EQUIVALENT` / 0 `MISSED`, числа §6.2 совпадают с файлом; независимо
   воспроизведены M15 (мой M1: `51/3`, те же три теста) и M16 (мой M3: `53/1`, тот же тест).
2. **Историческое число §5 «`pnpm run check` до правок = 299 / 276»** проверить нельзя без отката дерева — принимаю
   как заявление автора, не как факт.
3. **Доисходное состояние `service.ts` (1201 строка) недоступно**, поэтому я не мог восстановить, куда указывал якорь
   `377-389` в старой нумерации; якоря D-3/D-4 оценены по текущему файлу. Поведение до/после дельты я сравнивал по
   сохранённому добанному бандлу `.tmp/vfix-backup/planner.js` (13:03), а не по исходникам.
4. **Живой `bd` не запускался** (вне объёма): частота окна D-1 на реальном порте не измерялась, вывод сделан на
   fake-порте, который воспроизводит контракт `TaskGraphPort` (включая «`bd create --graph` сам проводит
   внутриплановые ключи»). `verify:profile`/`pack:local`, доска, UI и профиль DSH не трогались.
5. **Двенадцать находок ревью и их исправления не переразбирались**; опираюсь на подтверждённый вердикт второго прохода.
6. Побочно замечено (вне дельты, отдельно не проверялось): отказ порта внутри `observe`/`stage` (например,
   `ADAPTER_UNAVAILABLE` от `dependencies()` на валидации) выходит из `submit` **сырым исключением**, а не `Result`-ом;
   путь правками NEW-1…NEW-6 не менялся, новое ли это — не выяснял.

## 6. ПРОВЕРЕНО И СОЧТЕНО КОРРЕКТНЫМ (что лицензирует вердикт)

- **NEW-1, NEW-2, NEW-3 исправлены по существу**, а не только описаны: каждый пиннут тестом, который падает от моей
  ломающей мутации, и каждая мутация воспроизводит ровно заявленный эффект (включая то, что ядро инлайнится и
  мутировать нужно оба бандла).
- **`invertPlanSteps` с `created` не стал тише**: при пустом или частичном `created` шаг уходит в `irreversible`,
  parts не строится вовсе (`B empty created`/`B partial created`: `{"irreversible":[…,"add-edge:key:child\u0000key:root"],"parts":[]}`),
  а `revert` отказывает при непустом `irreversible` (`service.ts:1021-1036`) — «успешного» revert, который ничего
  не восстановил, из этого состояния не получается.
- **`markEdgeSteps` не ослабил отметку**: порт, молча теряющий внутриплановое ребро, даёт `edges/add-edge:failed`,
  `PLAN_MUTATION_RECOVERY`, сохранённую паузу и пустой граф (сценарий F) — ложных `applied` не появилось.
- **Новых путей дублирования задач нет**: повтор `apply`/`submit` идемпотентен (сценарий G: задач, рёбер и
  `calls.create` не прибавилось), `adoptedCreated` тоже не создаёт второй раз (`J5 createsAdded: 0`).
- **Пауза не снимается без подтверждённой целостности**: во всех отказах (D, E, E4, F, J) `admissionHeld === true`,
  `state === 'recovery'`; снятие происходит только на commit/revert с `verified: true`.
- **`requireAtomic`-путь и легальный `resume` целы**: C1 (`mode: 'atomic'`), H2 (`resume` после смерти писателя →
  `ok`, `verified: true`, шаг `applied`, без повторных созданий), плюс зелёные тесты «atomicity is refused rather than
  emulated…», «a controller killed mid-apply comes back paused…», «a retry through apply…» в узком прогоне.
- **Все потребители `step.ref` рёбер резолвят префикс `key:`** (`service.ts:402` — `markEdgeSteps`; `invertPlanSteps`
  через `resolvedEdgePair`); других мест, читающих ref шага буквально, в планировщике нет — смена формата ссылки в
  NEW-1 не оставила необработанного потребителя.
- **Состояние дерева после мутаций**: бандлы восстановлены байт-в-байт (sha256), пересобраны из исходников, финальный
  `pnpm run check` зелёный, `git status` и HEAD не изменились.
