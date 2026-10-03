# MW-011 — пятая дельта-верификация (N-1…N-6)

**Режим:** verify-fixes, read-only по отношению к исходникам. Пятый проход, только дельта предыдущего отчёта
`.work/reports/MW-011-delta-verification-2.md` (N-1…N-6). 12 находок ревью, NEW-1…NEW-6, D-1…D-8 заново не разбирались.
**База:** HEAD `f22dbc3b2eb97601e09fc4f341bcddd522544545`, коммитов нет, дерево заморожено; `git status --short` до и после
прохода совпадает (12 изменённых + 6 неотслеживаемых путей, включая `DSH-MyWork.rar`).
**Изменено верификатором:** только `.tmp/` (пробник `mw011-d3-probe.mjs`, скрипт мутаций `mw011-d3-mutate.mjs`,
копия сборки `.tmp/d3-backup/planner-index.js`, логи TAP) и этот файл.
**Ломающие мутации:** только по собранному `packages/planner/lib/index.js`, с восстановлением из копии и проверкой
`sha256` после `pnpm run build` (см. §5).

---

## 1. ВЕРДИКТ

**FIXES PARTIALLY VERIFIED** — N-1, N-3, N-6 и *реализованная* проверка N-2 подтверждены независимо (каждая — своей
ломающей мутацией), но достаточность N-2 имеет продемонстрированную дыру (новый **MAJOR**: обход `PLANNER_SCOPE_DENIED`
через принятый чужой существующий id), а заявленные исправления N-4/N-5 в текст отчёта (§3.1/§3.3) не внесены.

---

## 2. ТАБЛИЦА N-1…N-6

| # | Вердикт | Доказательство (команда / exit code / фрагмент) |
|---|---|---|
| **N-1** | **VERIFIED** | Пробник `.tmp/mw011-d3-probe.mjs n1` (свой store, свой fake-порт, собранные `packages/*/lib/*.js`): composite `requireAtomic` → смерть писателя → журнал `create:key:root=pending \| create:key:child=pending \| add-edge:key:child␀key:root=pending`, `state=applying`, `created={}`; `resume` с `adoptedCreated {root:'mw-1',child:'mw-2'}` → `ok=true`, `state=applied`, шаги `applied \| applied \| applied` (**`pendingCount: 0`**), в графе `mw-2->mw-1`, `report.verified=true`, пауза снята, `planRevision=1`, `calls.create=2` (повторного создания нет), `calls.get=2` (проверка существования). Своя мутация **mA** (убран вызов `markCompositeEdges` **только** в ветке «id известны», built `planner/lib/index.js`) → `node --test … tests/plan-mutation.test.mjs` exit **1**, `tests 60 / pass 59 / fail 1`, падает ровно один тест — `a composite create whose ids are adopted still gets its edge steps marked` (`tests/plan-mutation.test.mjs:1897`), сообщение `a committed operation must not leave its edge step pending`, факт `add-edge: pending`; под mA число чтений графа в `resume` падает 5 → 4, т.е. новый вызов действительно исполняется. Ветка «создаём сейчас» (`n1now`) и split-путь (`n1split`) целы. |
| **N-2** | **PARTIAL** | Реализация подтверждена: `n2` — (a) несуществующий `mw-999` → `PLAN_MUTATION_RECOVERY`, `rejectedAdoptions {root:"the task graph does not hold this id"}`, `created` не изменился (`{}`), пауза держится; (b) чужой ключ → `{not-created-here:"the mutation does not create this key"}`; (b2) пустой id → `"the id is not a non-empty string"`; (c) существующие `mw-1/mw-2` → приняты, `created {root,child}`, шаги `applied`, `detail = "external-ref mw-plan:op-1:root; id adopted by operator"`, `verified=true`, пауза снята, `calls.get=3`. Своя мутация **mB** (снято чтение `graph.get`) → exit **1**, `59 / 1`, падает ровно `an adopted id that the graph does not hold is refused instead of trusted` (`:1953`), `rejectedAdoptions: undefined`. **Достаточность — нет:** существующий, но **чужой** id принимается, и через ключевое ребро это пишет ребро на уже существующие задачи в обход `PLANNER_SCOPE_DENIED` → **F-1 (MAJOR)**. Обоснование автора «порт не отдаёт `externalRef`» проверено и **верно**: `Task` (`contracts/src/task.ts:75`) поля `externalRef` не имеет, а `toTask` (`beads-adapter/src/adapter.ts:269-292`) не переносит `external_ref`. |
| **N-3** | **VERIFIED** | Артефакт `.tmp/mw011-mutation-results.txt`: 20 строк, все `CAUGHT`, в каждой `pass+fail=60` (проверено по всем 20 строкам); строка M14 = `58/2` с `by: a revert that did not restore the graph… \| a port that reports success without writing the edge…` — совпадает с §6.2 построчно; строка M7 называет **оба** теста дельты (существуют только в текущей 60-тестовой суите), т.е. батарея действительно перезапущена. Независимая реплика: моя **mC** дала ровно строку M17 артефакта — `54 / 6` и тот же состав из шести тестов. |
| **N-4** | **NOT VERIFIED** | В отчёте правки нет. `MW-011-plan-mutations.md:86` (строка D-8) по-прежнему: «операция уходит в recovery с открытой паузой (`service.ts:648-665`, …)». Текущие `service.ts:648-663` — хвост `replay()` (`return fail` в диапазоне нет вообще), а обёртка pre-flight — `service.ts:681-688`. Формулировка «pre-flight — `staged`» встречается только внутри ячейки §3.4 (строка 99), но не в §3.3. Сам факт верен и воспроизведён пробником предыдущего прохода: `node .tmp/mw011-d2-probe.mjs s3` → `S3.applied.code ADAPTER_UNAVAILABLE`, `S3.journal.state staged`, пауза удержана. |
| **N-5** | **NOT VERIFIED** | `MW-011-plan-mutations.md:51` не изменена: `core/plan.ts:655-672`, «обе ветви: staged и атомарная». `prepareCreateSpec` (`:630`, вызов `:676`) и `ensureExternalRef` (`:716`, вызов `:663`) в §3.1 не названы — только в ячейке §3.4 (строка 100). Диапазон 655-672 по-прежнему содержит лишь атомарный вызов. |
| **N-6** | **VERIFIED** | Вакуумная ассерция удалена: `unresolvedCreates` в тестах осталось только в `:1018` и `:1583`, в тесте D-1 её нет; вместо неё `record.created` (`tests/plan-mutation.test.mjs:1817-1825`). Мутация **mC** (в built `saveMutationCreated` не пишет ничего) → exit **1**, `54 / 6`, среди падений ровно `not ok 50 - the ids of created tasks are durable before anything else is read` с `error: a failing read must not lose the ids of tasks that already exist; + actual {} - expected {child:'mw-2', root:'mw-1'}` — т.е. новая ассерция действительно наблюдает `record.created`. Вакуумность старой подтверждена источником: `enterRecovery` подставляет заглушку с захардкоженным `unresolvedCreates: Object.freeze([])` (`service.ts:377`). |

---

## 3. НОВЫЕ FINDINGS

**F-1 — MAJOR (остаток N-2: достаточность проверки не достигнута).**
`packages/planner/src/service.ts:1054-1077` (принятие id) вместе с `:499-517` (часть `edges` материализуется через
`working.created`).
Принятый id проверяется **только на существование**. Если мутация создаёт `a`,`b` и содержит ребро между ними
(`addDependencies [b→a]` — на стадии это `additive-only`, `origin: 'planner'` разрешён), а оператор после падения писателя
аттестует `a := X-1`, `b := Y-1` (существующие, но чужие задачи), то `materializePlanPart` резолвит ключи в чужие id и
часть `edges` пишет ребро **на уже существующие задачи** — ровно то, что запрещает `PLANNER_SCOPE_DENIED`
(`core/plan.ts:482-498`). Пробник `n2foreign`:
- контроль: тот же интент с литеральными id (`addDependencies [Y-1→X-1]`, `origin: 'planner'`) → `stage` отвечает
  `PLANNER_SCOPE_DENIED`, `mutationClass: modifying`;
- обход: `resume` с `adoptedCreated {a:'X-1', b:'Y-1'}` → `ok=true`, `state=applied`, `report.verified=true`,
  `planRevision=1`, пауза снята, в графе появилось `Y-1->X-1`, а реально созданные `mw-1`,`mw-2` остались сиротами
  (`journal.created = {a:"X-1",b:"Y-1"}`; в графе `["X-1","Y-1","mw-1","mw-2"]`).
Последствие необратимо: операция `applied`, поэтому `revert` отказывает (`UNSETTLED_STATES`, `service.ts:1112-1119`), и
ложное ребро остаётся в DAG; сироты-задачи планировщику неизвестны (повтор плана создаст дубликаты).
Отличие от прошлого прохода: там дыра оценивалась как MINOR «ложный `verified: true` при документированной аттестации
оператора»; здесь показано, что она ещё и **снимает policy-guard §5.1** и оставляет неустранимое ребро на существующей
работе — это другой класс последствий, поэтому MAJOR.
*Минимальная правка:* после принятия id пере-проверять **материализованную** команду политикой планировщика — в ветке
`edges` (или в `resume` перед `run`) отказывать (`PLANNER_SCOPE_DENIED` либо recovery со своим кодом), если резолв
опёрся на id из `adoptedCreated`, а не на то, что вернул порт в `result.created`; более строгий вариант — запретить
материализацию `edges`/`dependsOnKeys` через принятые id, пока порт не подтвердит `externalRef`.

**F-2 — MINOR (внесено кодом N-2).** `packages/planner/src/service.ts:1071-1076`.
`catch {}` превращает **любой** отказ порта в «the task graph does not hold this id». Пробник `n2down`: `graph.get`
бросает `ADAPTER_UNAVAILABLE` (бэкенд недоступен) → оператор получает `PLAN_MUTATION_RECOVERY` +
`rejectedAdoptions {root: "the task graph does not hold this id"}` — сообщение называет причину, которой нет. Поведение
fail-closed (ничего не записано, пауза удержана, состояние не изменено, повтор после восстановления бэкенда проходит), но
именно принцип D-8/N-1 («оператору не сообщают противоположное истине») здесь нарушен.
*Почему локальная правка не полная:* адаптер использует `ADAPTER_UNAVAILABLE` и для «не найдено» (`adapter.ts:305`), и для
сломанного бэкенда (`adapter.ts:433-437`), т.е. по коду их не различить.
*Минимальная правка:* переносить исходный отказ в причину (`rejected[key] = \`could not be read: ${code} — ${message}\``)
либо возвращать типизированный отказ порта, когда он не является «не найдено».

**F-3 — NIT (внесено кодом N-2).** `packages/planner/src/service.ts:1078-1087`.
Отказ принятия возвращает `PLAN_MUTATION_RECOVERY`, но журнал остаётся в `applying` (нет `enterRecovery`): пробник `N2a`
— `state: applying`, тогда как все прочие пути с этим кодом оставляют `recovery`. Ничего не записано и пауза удержана,
поэтому это только расхождение отчётности (мониторинг «операции в recovery» такую не увидит). *Правка:* вызвать
`enterRecovery` либо явно писать в `details`, что журнал не тронут.

Новых BLOCKER нет. Проверенные гипотезы о дефектах дельты **не подтвердились**: (i) `markCompositeEdges` не помечает
шаги вслепую — порт, «забывший» внутриплановое ребро, даёт `add-edge=failed`, `verified=false`, `missing ["mw-2␀mw-1"]`,
`PLAN_MUTATION_RECOVERY`, пауза удержана, ревизия 0 (`n1lie`), и тот же результат на пути с принятыми id (`n1lieadopt`);
(ii) ветка «создаём сейчас» и split/staged-путь не сломаны (`n1now`, `n1split`, 60/60); (iii) путей снятия паузы без
`verified: true` не появилось (во всех recovery-сценариях `admissionHeld: true`, `planRevision 0`); (iv) `submit`/`apply`/
`resume`/`revert` на легальных сценариях целы (60/60 + 116/93/0/23 + пробники). Новое чтение в ветке «id известны»
обёрнуто: свип `n1edgeread` (отказ на чтениях 1…7) — во всех семи случаях исключение **не** вылетает (`threw: no`),
код `ADAPTER_UNAVAILABLE`, пауза удержана; чтения 1-3 оставляют `applying`, чтения 4-5 — `recovery`.

---

## 4. ПРОВЕРЕННЫЕ КОМАНДЫ

| Команда | Exit | Наблюдение |
|---|---|---|
| `git rev-parse HEAD` / `git status --short` | 0 | `f22dbc3b2eb97601e09fc4f341bcddd522544545`; 12 `M` + 6 `??`, тот же набор, что в начале прохода; коммитов нет |
| `pnpm run check` | 0 | `tests 359 / pass 336 / fail 0 / skipped 23` — совпадает с §5 отчёта |
| `node --test --test-isolation=none tests/plan-mutation.test.mjs` | 0 | `60 pass / 0 fail` (до мутаций и повторно после восстановления сборки) |
| `node --test --test-isolation=none tests/lease.test.mjs tests/beads-adapter.test.mjs tests/evidence.test.mjs tests/events.test.mjs` | 0 | `tests 116 / pass 93 / fail 0 / skipped 23` — совпадает с §5 |
| `node .tmp/mw011-d3-probe.mjs n1 n1now n1split n1lie n1lieadopt n1edgeread n2 n2partial n2down n2foreign` | 0 | наблюдения §2 и §3; свой store, свой fake-порт, собранные `packages/*/lib/*.js` |
| `node .tmp/mw011-d3-mutate.mjs mA` + узкий прогон | 1 | `59 / 1`, единственное падение — целевой тест N-1 (`:1897`), `add-edge: pending`; чтений графа 5 → 4 |
| `node .tmp/mw011-d3-mutate.mjs mB` + узкий прогон | 1 | `59 / 1`, единственное падение — целевой тест N-2 (`:1953`), `rejectedAdoptions: undefined` |
| `node .tmp/mw011-d3-mutate.mjs mC` + узкий прогон | 1 | `54 / 6`, включая целевой тест D-1/N-6 (`:1787`) с падением на `record.created` |
| `node .tmp/mw011-d3-mutate.mjs restore` → `pnpm run build` → `node .tmp/mw011-d3-mutate.mjs verify` | 0 | `sha256 b7fc1c68ab26d2dd8aa72aa32590aa1d2a6c41a4788eb3ef769b33a954bc30d9` — сборка побайтово равна копии до мутаций (`IDENTICAL to backup`) |
| `node .tmp/mw011-d2-probe.mjs s2 s3` | 0 | `S3.journal.state staged` (pre-flight), `S2.journalAbsent true` (stage) — факт для N-4 |
| артефакт `.tmp/mw011-mutation-results.txt` (чтение) | — | 20 строк `CAUGHT`, в каждой `pass+fail=60`; M14 `58/2` = §6.2; M7 называет оба теста дельты |

---

## 5. ВОССТАНОВЛЕНИЕ ПОСЛЕ ЛОМАЮЩИХ ПРОВЕРОК

Мутации применялись к `packages/planner/lib/index.js` (ядро инлайнится планировщиком; все три мутации — код самого
планировщика, поэтому `packages/core/lib/index.js` не трогался). Копия — `.tmp/d3-backup/planner-index.js`, sha256
`b7fc1c68…`. После каждой мутации — `restore`, затем `pnpm run build`, затем `verify`: sha256 совпал с копией
побайтово, узкий прогон снова `60 pass / 0 fail`, `git status --short` не изменился. Исходники `packages/`, `tests/`,
`scripts/` не изменялись.

---

## 6. ЧТО ОСТАЛОСЬ НЕПРОВЕРЕННЫМ

- **Полная батарея 20 мутаций не перезапускалась** (вне объёма прохода: артефакт и числа проверяет параллельный агент).
  Сверено: 20 строк, арифметика `pass+fail=60`, строка M14 против §6.2, состав строки M7 (называет оба теста дельты);
  независимо воспроизведена одна строка (M17 ≡ mC) и поставлены три собственные мутации дельты (mA/mB/mC).
- **Живой `bd` и реальный адаптер.** Проверка принятых id на настоящем бэкенде не запускалась (пробники работают на
  детерминированном fake-порте); в частности не измерялось, как `bd show --json` отдаёт `external_ref` — утверждение
  «порт не отдаёт `externalRef`» проверено **по исходникам контракта и адаптера**, а не по живому ответу.
- **Достижимость F-1 на реальном адаптере:** продемонстрирована на планировщике (логика порт-независима) с
  предсуществующими `X-1`/`Y-1`; на живом `bd` не воспроизводилась.
- `verify:profile`, `pack:local`, находка по MW-010 (§6.1) — вне объёма.
- N-4/N-5 — правка уровня отчётности; якоря проверены против замороженного дерева, при новых правках кода строки снова
  сдвинутся.

---

## 7. ЧЕСТНОСТЬ §3.4/§5/§6.2 В ЧАСТИ ЭТОЙ ДЕЛЬТЫ

- §5 (числа) — воспроизведены все три строки, доступные наблюдению: `359/336/0/23`, `60/0`, `116/93/0/23`.
- §6.2 против артефакта — совпадает во всех 20 строках (`pass+fail=60`, M14 `58/2`, перечень ловящих тестов).
- §3.4: приписывание падений конкретным тестам **точно** для N-1 (`:1897`), N-2 (`:1953`) и N-6 (D-1, `:1787`) —
  подтверждено собственными мутациями; якоря `service.ts:415-430` (helper) и `:1060-1085` (проверка id) попадают в
  названный код.
- §3.4 **не соответствует телу отчёта для N-4 и N-5**: обе строки утверждают правку §3.3/§3.1, которой там нет (см. §2).
  Это единственное расхождение честности, найденное в дельте; оно уровня NIT (отчётность), но заявленное исправление
  считать исполненным нельзя.
