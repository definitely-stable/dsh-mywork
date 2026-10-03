# MW-011 — шестая дельта-верификация (проход 6): одиннадцать исправлений, свои мутации, охота за новыми дефектами

Режим: **verify-fixes** (read-only, кроме `.tmp/` и этого файла).
Baseline: `f22dbc3b2eb97601e09fc4f341bcddd522544545`, дерево заморожено (12 изменённых + 6 новых путей карточки + `DSH-MyWork.rar`, посторонний для карточки).
Все пробы — против **собранных** бандлов (`packages/*/lib/index.js`), снятых в собственный неизменяемый снимок `.tmp/mw011-d4-snap` (хеши совпали с текущими после всех мутаций).
Мои артефакты: `.tmp/mw011-d4-probe.mjs` (+ `.txt`), `.tmp/mw011-d4-lib.mjs`, `.tmp/mw011-d4-mutations.json`, `.tmp/mw011-d4-mutate.ps1` (+ `.txt`), `.tmp/mw011-d4-single.ps1`.

## 1. ВЕРДИКТ

**FIXES PARTIALLY VERIFIED** — девять из одиннадцати исправлений подтверждены и своими ломающими мутациями, и своими пробами на прежних сценариях; **BLOCKER-1 закрыт лишь наполовину** (та же формулировка инварианта снова опровергнута через шаг создания, помеченный `failed`, — BLOCKER·NEW-A), а **правка MAJOR-5 вносит регрессию на реальном порте** (MAJOR·NEW-B). Плюс два новых MINOR (слишком строгое сравнение интента, остаток guard'а ключа-тени) и один MINOR к доказательности отчёта.

## 2. ТАБЛИЦА ОДИННАДЦАТИ ИСПРАВЛЕНИЙ

| # | Находка | Статус | Доказательство (своё) |
|---|---|---|---|
| 1 | **BLOCKER-1** `revert` при нежурналированном эффекте | **PARTIAL** | R1/R2/R3 воспроизведены: `node .tmp/mw011-d4-probe.mjs f1a f1b f1c` → R1 `revert: TASK_CONFLICT/irreversible-steps`, пауза удержана, `created {}`; R3 после переоткрытия БД — `blindResume PLAN_MUTATION_RECOVERY`, `revert TASK_CONFLICT/irreversible-steps`, `mw-1` остаётся (честный отказ); R2 (рёбра) — `revert ok verified=true`, `edges.afterRevert ["D-1->B-1","D-2->B-1"]`, пауза снята. Своя мутация **M-B1** (снят `pending`-guard, `core/plan.ts:1128`) → suite 70/1, падает ровно `revert refuses when a create may have landed without reaching the journal`. **Но:** шаг создания, помеченный `failed` (порт ответил без id), из-под guard'а выпадает — `newA`, см. NEW-A. Это тот же инвариант, ради которого писалась правка. |
| 2 | **BLOCKER-2** claim операции | **VERIFIED** | `f2`: `ok.count 1`, `loser operation-already-claimed`, `calls.create 1`, `calls.mutatePlan 1`, задачи `["mw-1"]`, журнал `applied/created {n1:mw-1}`. Своя мутация **M-B2** (`service.ts:820` обезврежен) → 64/7, целевой тест `two overlapping callers of one operation do not both create` падает. Законные пути не сломаны: `f2b` (журнал `applying` после аварии → `resume` доходит до вердикта, а не до claim'а), `f6`/`f1b` (повтор после `applied` — реплей), `f12` (`acceptProposal` ok/applied, повтор — `proposal-settled`, `mutatePlan` ровно 1). |
| 3 | **MAJOR-3 + MINOR-11** ключ-тень и дубликат ключа | **VERIFIED** | `f3`: `create-key-shadows-existing-task`, `duplicate-plan-key`, пауза не открыта. Мутации **M-M3** и **M-M11** независимо валят один и тот же тест (70/1 каждая). Остаток дыры — NEW-D (только ключ без рёбер). |
| 4 | **MAJOR-5** `readStates` пропускает только «нет задачи» | **VERIFIED (сценарий) / регрессия** | `f4`: нечитаемая running-задача → `stage ADAPTER_UNAVAILABLE`, `port.commands []`, пауза не открыта; мутация **M-M5** (вернуть проглатывание) → 70/1, падает целевой тест. НО на порте, отвечающем на отсутствие иным кодом (как это делает штатный адаптер), законный путь умирает — NEW-B. |
| 5 | **MAJOR-6** сверка интента при повторе operationId | **VERIFIED** | `f5`: идентичный повтор — `ok (no-op)`; другой интент — `TASK_CONFLICT/operation-id-reused`; `undefined` вместо отсутствующего поля — `ok`. `f5b`: перестановка полей внутри спецификации и перестановка ключей `setMetadata` — `ok (no-op)`; изменённый `title` — отказ. Мутация **M-M6** → 70/1, целевой тест падает. Слишком строгие случаи — NEW-C. |
| 6 | **MAJOR-7** `run` отказывает для состояния вне `UNSETTLED_STATES` | **VERIFIED** | `f6` (форма C4: авария → `revert ok state=reverted` → `submit` `TASK_CONFLICT/operation-settled`, `apply` `operation-not-applicable`, повторный `revert` `operation-settled`), рёбра восстановлены. Мутация **M-M7** → 70/1, падает `revert maps the journal onto the graph before inverting it` (его хвостовая проверка). |
| 7 | **MAJOR-9** гонка вставки `stage` отвечает структурно | **VERIFIED (своими пробами, теста в репозитории нет)** | `f7`: два `stage` в одном тике → `["ok","TASK_CONFLICT/operation-already-staged"]`, строк 1, пауза удержана. До/после: под мутацией **M-M9** (снят маппинг UNIQUE) тот же сценарий даёт `Error: UNIQUE constraint failed: plan_mutation.operation_id` (ровно MAJOR-9). Своя мутация на суите — **MISSED** (71/71): строки батареи этой правки не покрывают. |
| 8 | **F-1 / F-2 / F-3** принятые id | **VERIFIED (F-3 — только моей пробой)** | `f8`: F-1 `PLANNER_SCOPE_DENIED/adopted-id-scope-unverified`, журнал `recovery`, `created {}`, ребро не записано, пауза удержана; F-2 `{n1: "the task graph could not be read for this id: ADAPTER_UNAVAILABLE"}`; F-3 `journal state recovery, failure adopted-ids-rejected`. Мутации **M-F1** и **M-F2** валят свои целевые тесты (70/1); **M-F3** — MISSED (теста нет). Тупик «потеряны id + есть рёбра по ключам» — объявлен в §9 п.4, новым дефектом не считаю. |
| 9 | **MAJOR-8** `void` под вторым открытым гейтом | **VERIFIED** | `f9`: под вторым гейтом — `edges ["D-1->B-2"]`, `D-1.state blocked`, `retire []`, открытый гейт `[["B-2",["D-1"]]]`; контроль (один блокер) — оба зависимых `ready`, рёбра сняты, `retire` оба. Мутация **M-M8** → 70/1, целевой тест падает. `supersede-dependent` после `void` — `gate-not-open` (гейт закрыт законно). |
| 10 | **MAJOR-4** ключ решения гейта и конфликт записи | **VERIFIED** | `f10`: повтор тем же operationId → `TASK_CONFLICT/gate-already-decided`, строк решений 1; второй оператор с новым operationId → `ok`, строк 2, `latestDecision` = второе решение (гейт остаётся решаемым). Мутация **M-M4** (ключ снова из часов) → 70/1, целевой тест падает. |
| 11 | **MINOR-10** звуковая половина (ребро на созданную задачу) | **VERIFIED** | `f11`: чужое ребро `Z-9->mw-1` → `PLAN_MUTATION_RECOVERY`, `unexpected ["Z-9\0mw-1"]`; законные контроли — composite с внутриплановым ребром `ok verified=true`, рёбра по ключам в `addDependencies` `ok verified=true`, повторная верификация через `apply` `ok verified=true`. Мутация **B-M20c** (снято `createdIds`-условие) → 70/1, целевой тест падает. Остаток (ребро между двумя существующими) — §9 п.3, не переоткрываю. |

**NIT-13** (отдельно): комментарий `acceptProposal` (`service.ts:1483-1486`) теперь описывает код — решение записывается на предложение (`decideProposal`, `:1489`), операция несёт обычное решение пути `submit`. Расхождения текста с кодом не нашёл.

**Итог доказательности:** 15 из 17 моих мутаций пойманы, каждая — **ровно целевым тестом**; две MISSED (M-F3, M-M9) означают отсутствие теста, а не отсутствие правки — обе правки я подтвердил своими пробами и до/после-мутацией.

## 3. НОВЫЕ FINDINGS

### BLOCKER·NEW-A — `revert` снова объявляет успех и снимает паузу, когда создание попало в граф, а `failed`-шаг его скрывает

`packages/planner/src/service.ts:555-564` (шаг создания помечается `failed`, если порт не вернул id) + `packages/core/src/plan.ts:1128-1132` (guard правки BLOCKER-1 ловит только `pending`, `failed` пропускается) + `packages/beads-adapter/src/adapter.ts:1016-1033` (штатный `parseGraphApplyOutput` возвращает `{}`, когда stdout не разобран) + `packages/contracts/src/plan.ts` («Keys of created tasks mapped to their ids, **as far as they are known**»).

**Сценарий.** Композитное создание идёт атомарным путём (`adapter.ts:848-868`): `bd create --graph --json` выходит с кодом 0, но stdout не JSON (или ключ в ответе не назван — сам парсер это допускает и документирует). Адаптер возвращает `created: {}`; задачи в бэкенде **созданы**. Планировщик помечает шаг создания `failed`, `created` остаётся пустым → `verify` даёт `unresolvedCreates` → `PLAN_MUTATION_RECOVERY` (корректно). Оператор вызывает `revert`.

**Наблюдаемое:** `node .tmp/mw011-d4-probe.mjs newA`

```text
adapter.parseGraphApplyOutput("warning, not json"): {}
submit: PLAN_MUTATION_RECOVERY
graph.tasks: ["mw-1"]                       ← задача создана
journal.afterSubmit: state recovery, created {}, steps ["create:create:key:n1:failed"], verified:false
revert: ok state=reverted verified=true     ← отказ не состоялся
graph.tasks.afterRevert: ["mw-1"]           ← сирота осталась
journal.afterRevert: state reverted, report.verified TRUE
admissionHeld.afterRevert: false            ← пауза снята
```

**Почему нарушает инвариант.** Это дословно форма R1 из пятого прохода: эффект в графе, журнал его не знает, `reverted` терминален (`UNSETTLED_STATES`), пауза снята, evidence-of-record утверждает `verified: true`, а `mw-1` — запускаемая работа, которой нет ни в плане, ни в журнале, ни в аудите. Для шага **создания** `failed` не означает «не создано»: он означает «порт не назвал id», что контракт `PlanMutationResult.created` прямо разрешает («as far as they are known»). Правка BLOCKER-1 сузила правило до `pending` по верному наблюдению, что `failed` — ответ наблюдения; для создания это наблюдение отсутствует.

**Честная генеалогия:** до правки пропускались вообще все не-`applied` шаги (`core/plan.ts:1079` в прежней сборке, зафиксировано `MW-011-adversarial-2.md:30`), поэтому дверь не «внесена» правкой — но она и есть тот самый инвариант, который правка объявила закрытым, и её критерий (`pending` только) оставляет дверь открытой.

**Минимальная правка.** В `invertPlanSteps` вернуть безусловный запрет для не-`applied` шага **создания** (`step.kind === 'create' && step.state !== 'applied'` → `irreversible`), сохранив нынешнее правило `pending` для рёбер/ретайрментов/полей; в `service.ts:560` дополнительно не помечать шаг `failed`, когда порт сообщил успех без id, а оставлять `pending` (неопределённость), — вернув оператору выход через `resume` с `adoptedCreated`.

**Воспроизведение:** `node .tmp/mw011-d4-probe.mjs newA`; в сборке роль «порта без id» играет обёртка, возвращающая ровно то, что вернул вызванный штатный `parseGraphApplyOutput`.

### MAJOR·NEW-B — `readStates` считает «задачи нет» только по `TASK_CONFLICT`, а штатный порт отвечает иначе

`packages/planner/src/service.ts:313-327` (правка MAJOR-5) против `packages/beads-adapter/src/adapter.ts:298-312` и `:445-452`: адаптер бросает `ADAPTER_UNAVAILABLE` и когда задачи нет (`beads task "…" was not found`), и когда бэкенд недоступен; `TASK_CONFLICT` для отсутствия он не отвечает вообще. `planTouchedTasks` кладёт в чтение endpoints рёбер, а ими могут быть **ключи создаваемых задач** (`core/plan.ts:249-258`, `collectTouch:214-217`).

**Наблюдаемое** (порт отвечает на отсутствие как штатный адаптер): `node .tmp/mw011-d4-probe.mjs newB`

```text
plainCreate: ok
keyEdge (the suite's documented path): ADAPTER_UNAVAILABLE      ← было ok
edgeToAbsentTask (want unknown-edge-endpoint): ADAPTER_UNAVAILABLE
retireAbsentTask: ADAPTER_UNAVAILABLE
```

Контроль той же пробы на прежнем `readStates` (мутация **M-M5**): `pwsh -NoProfile -File .tmp/mw011-d4-single.ps1 -Label M-M5 -Scenarios newB` → `keyEdge: ok`, `edgeToAbsentTask: TASK_CONFLICT/unknown-edge-endpoint`. Контроль на фейковом порте (отвечает `TASK_CONFLICT`): `node .tmp/mw011-d4-probe.mjs newF` → `keyEdge ok verified=true`, `edgeToAbsentTask TASK_CONFLICT/unknown-edge-endpoint`.

**Почему нарушает инварианты.** (а) Умирает документированный и покрытый тестом путь `tests/plan-mutation.test.mjs:1528` («an edge between two created tasks given as addDependencies is resolved to their ids»): попытка связать две создаваемые задачи ребром по ключам отвергается `ADAPTER_UNAVAILABLE`. Тест зелёный только потому, что фейковый порт отвечает на отсутствие кодом `TASK_CONFLICT`, которого реальный порт не использует. (б) Оператор получает диагноз, противоположный истине: «адаптер недоступен» вместо `unknown-edge-endpoint` — ровно тот принцип D-8/N-1, ради которого делалась правка MAJOR-5.

**Минимальная правка.** Не читать у графа то, чего там быть не может, и не судить об отсутствии по одному коду: (1) исключить из `planTouchedTasks` ключи создаваемых задач (`createdKeys(intent)`) — их отсутствие уже гарантируется веткой `keys.has(endpoint)` валидатора; (2) для остальных id отсутствие подтверждать наблюдаемым признаком порта, а не списком кодов (например, `TaskGraphPort.getAbsent`/чтение `externalRef`, на которое уже указывает §9 п.4), иначе «сломанный бэкенд» и «нет задачи» остаются неразличимыми по построению.

### MINOR·NEW-C — `canonicalIntent` сравнивает трассировочный id и порядок массивов

`packages/planner/src/service.ts:285-295` + отказ `:1027-1036`.

**Сценарий (ретрай после таймаута):** тот же `operationId`, тот же интент, новый `correlationId` (обычная практика: трассировка на попытку) либо тот же набор рёбер в другом порядке.

**Наблюдаемое:** `node .tmp/mw011-d4-probe.mjs f5`

```text
identical.retry: ok (no-op)
retry.newCorrelation: TASK_CONFLICT/operation-id-reused
retry.reorderedArrays: TASK_CONFLICT/operation-id-reused
retry.explicitUndefined: ok (no-op)
```

**Почему дефект.** Канонизация сортирует ключи объектов (проверено: перестановка полей спецификации и ключей `setMetadata` — `ok`), но не массивы и не вычитает `command.meta`; `correlationId` — трассировочное поле, а не часть мутации. Ретрай, ради которого существует идемпотентность по `operationId` (ADR024, §10 отчёта: «повтор должен отвечать тем же исходом»), получает отказ, неотличимый для клиента от «вы прислали другую мутацию». Отказ fail-closed, поэтому MINOR.

**Минимальная правка.** Сравнивать `intent` без `command.meta.correlationId` (оставив `operationId`) и канонизировать массивы-множества (`addDependencies`, `removeDependencies`, `create`, `update`) сортировкой по стабильному ключу.

**Воспроизведение:** `node .tmp/mw011-d4-probe.mjs f5`

### MINOR·NEW-D — остаток guard'а ключа-тени: ключ создания, который интент больше нигде не упоминает

`packages/core/src/plan.ts:593-610` (проверка идёт по `observation.states[spec.key]`) + `core/plan.ts:249-258` (в наблюдение попадают только update/edges/removals/retire).

**Наблюдаемое:** `node .tmp/mw011-d4-probe.mjs f3` (третья стадия)

```text
untouchedShadow: ok (!) steps=["create:key:T-1"]
untouchedShadow.applied: ok created={"T-1":"mw-1"} graphTasks=T-1,T-3,mw-1
```

**Почему дефект (MINOR).** `T-1` уже существует, а мутация создаёт вторую задачу под ключом `T-1`; `externalRef` новой задачи — `mw-plan:op-3:T-1`, то есть операторский резолв по ссылке (MAJOR-5 отчёта) снова неоднозначен, и это ровно тот класс, который назван MAJOR-3. Ложных рёбер и ложного `verified` здесь нет (интент рёбер не содержит), поэтому MINOR, а не MAJOR.

**Минимальная правка.** Читать состояния всех `create[].key` (добавить `createdKeys(intent)` в наблюдение) — и там же решить проблему NEW-B, tolerating absence именно для ключей создаваемых задач.

**Воспроизведение:** `node .tmp/mw011-d4-probe.mjs f3`

### MINOR·NEW-E — две правки объявлены «исправлено» без теста и без строки батареи

`packages/planner/src/service.ts:1124-1140` (MAJOR-9) и `:1217-1222` (F-3).

Мои мутации, снимающие обе правки, суиту **не валят**: `.tmp/mw011-d4-mutate.txt` → `MISSED NO-TEST-NAMED M-F3 … pass=71 fail=0` и `MISSED NO-TEST-NAMED M-M9 … pass=71 fail=0`. Ни один из 23 тестов и ни одна строка батареи (§6.2) эти два пути не проверяют; поведение я подтвердил сам (`f7`, `f8`, до/после-мутация M-M9). §3.6 для MAJOR-9 не называет тест — то есть расхождения с кодом нет, но «исправлено» без опровергающего доказательства. **Минимальная правка:** два регрессионных теста (два `stage` в одном тике; `resume` с отвергнутым `adoptedCreated` поверх журнала `applying` → `recovery`) и две строки батареи.

## 4. ПРОВЕРЕННЫЕ КОМАНДЫ

| Команда | Exit | Наблюдение |
|---|---|---|
| `git rev-parse HEAD` | 0 | `f22dbc3b2eb97601e09fc4f341bcddd522544545` |
| `git status --short` | 0 | 12 `M` + 6 новых путей карточки + `DSH-MyWork.rar`; совпадает с baseline, источники не менялись (свежайший `service.ts` 14:42:54, старт прохода 14:50) |
| `pnpm run check` (baseline) | 0 | **370 tests / 347 pass / 0 fail / 23 skip** |
| `node --test --test-isolation=none tests/plan-mutation.test.mjs` | 0 | **71 pass / 0 fail** |
| `node --test --test-isolation=none tests/{lease,beads-adapter,evidence,events}.test.mjs` | 0 | 116 tests / **93 pass / 0 fail / 23 skip** |
| `pnpm run check` (после всех моих мутаций) | 0 | **370 / 347 / 0 / 23**; хеши шести бандлов совпали со снимком `.tmp/mw011-d4-snap/hashes.json` |
| `node .tmp/mw011-d4-probe.mjs <22 сценария>` | 0 | `.tmp/mw011-d4-probe.txt` (fix-пробы + NEW-A…NEW-F) |
| `pwsh -NoProfile -File .tmp/mw011-d4-mutate.ps1` | 0 | 17 строк: **15 CAUGHT / TARGET-FAILED**, 2 MISSED (M-F3, M-M9); `restored byte-identical: True` |
| `pwsh … -Label M-M5 -Scenarios newB` | 0 | до правки MAJOR-5 законный ключевой путь `ok`, после — `ADAPTER_UNAVAILABLE` (NEW-B) |
| `pwsh … -Label M-M9 -Scenarios f7` | 0 | до правки MAJOR-9 — `Error: UNIQUE constraint failed: plan_mutation.operation_id`, после — `TASK_CONFLICT/operation-already-staged` |
| арифметика `.tmp/mw011-mutation-results.txt` | 0 | 23 строки, **все CAUGHT**, `pass+fail=71` в каждой, дублей метки нет |
| сверка §6.2 отчёта с артефактом | 0 | 23/23 строки совпали по `pass/fail` |
| `.tmp/mw011-sixth-narrow1.txt` | — | 68 tests / 60 pass / **8 fail** — ровно восемь новых тестов, названы поимённо |
| `.tmp/mw011-sixth-narrow2.txt` | — | 68 tests / 64 pass / **4 fail** — ровно четыре revert-теста, названные в §3.6 |
| `.tmp/mw011-sixth-narrow3.txt` / `-narrow6.txt` | — | 68/68 и **71/71 pass**, 0 fail |
| `.tmp/mw011-sixth-mut.txt` | — | 71 tests / 68 pass / **3 fail** — ровно целевые MAJOR-8, MAJOR-4, MINOR-10 |
| `.tmp/mw011-sixth-check2.txt` | — | 370 / 347 / 0 / 23 |

Сверка §6.2 воспроизведена и мной: 4 строки батареи перезапущены своими руками — M12 69/2, M15 66/5, M17 65/6, M20c 70/1, что совпадает с артефактом автора и с таблицей отчёта.

## 5. ЗАМЕЧАНИЯ К ОТЧЁТУ

1. **§3.6, строка MAJOR-9 и строка F-1/F-2/F-3:** статус «исправлено» без теста и без строки батареи; мои мутации M-M9 и M-F3 остаются MISSED (71/71 при снятой правке). Поведение верное (проверено `f7`, `f8`), но доказательство отсутствует — см. MINOR·NEW-E.
2. **§3.6, строка BLOCKER-1:** формулировка «`pending`-необратимый шаг останавливает `revert`» верна, однако из текста не следует, что `failed`-шаг **создания** остановки не даёт. Именно так и появляется NEW-A. Формулировку стоит дополнить: для создания `failed` — не наблюдение, а отсутствие ответа порта.
3. **§3.6, строка BLOCKER-2:** якорь «вызов `service.ts:796`» — фактический вызов claim'а `service.ts:820`; отказ на `:824` указан верно. Аналогично «`markRetireSteps` … вызов `:1327`» — вызов на `:1325`, и «`core/plan.ts:1030-1040`» для звуковой половины MINOR-10 — логика на `:1041-1043` (доккомментарий и определение `createdIds` — `:1013-1014`). Дрейф в 2–24 строки, содержание не затронут; для карточки, где якоря уже дважды правились, стоит выровнять.
4. **§5, строка «тот же прогон до правки → 68 tests / 8 fail»** подтверждена артефактом `.tmp/mw011-sixth-narrow1.txt` поимённо; утверждение «четыре существующих revert-теста упали на первой версии правки» подтверждено `.tmp/mw011-sixth-narrow2.txt` (64/4, ровно те четыре теста). Переписанных задним числом утверждений я не нашёл.
5. **§9 (перечитан после уведомления о правке нумерации):** порядок 1) MW-010, 2) MINOR-12, 3) остаток MINOR-10, 4) тупик принятых id, 5) шестой проход, 6) цена процесса, курсив «Закрыто в этом проходе» — совпадает с тем, что описано; содержание и числа не изменились.
6. **§8 п.9д** («независимая проверка одиннадцати исправлений ещё не выполнена») закрывается этим файлом; п.9а (MINOR-12) и п.9г (остаток MINOR-10) остаются открытыми и мной не переоткрывались. В §8 п.8 честно названо, что claim по состоянию строки не закрывает гонку двух процессов — подтверждаю наблюдением: арбитр вне процесса по-прежнему нужен.

## 6. ЧТО ОСТАЛОСЬ НЕПРОВЕРЕННЫМ

- **Полная батарея из 23 строк не перезапускалась** (вне объёма): воспроизведены 4 строки своими руками, остальные сверены с артефактом по числам и поимённым ловящим тестам.
- **Живой `bd` не использовался** (вне объёма). Тезис NEW-B опирается на чтение `packages/beads-adapter/src/adapter.ts:298-312, 445-452` (код `ADAPTER_UNAVAILABLE` для «не найдено» и для сбоя команды) и на вызов штатной `parseGraphApplyOutput` для тезиса NEW-A; поведение самого `bd` не наблюдалось.
- **Гонка двух процессов на одной SQLite-БД** не воспроизводилась (свойство storage; названо в §8 п.8).
- **Открытые пункты §9 (MINOR-12, остаток MINOR-10, тупик принятых id)** не переоткрывались по условию задачи.
- **`verify:profile` / `pack:local` / живой профиль DSH / доска / `.beads/`** не трогались; коммитов, push, stash, checkout, reset не делалось; субагенты не запускались; платные модели не вызывались.
- Изменения внесены только в `.tmp/` и этот файл.
