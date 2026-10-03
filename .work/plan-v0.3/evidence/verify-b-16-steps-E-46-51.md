# Evidence: verify-b-16 · исполнимость шагов E-46…E-51 (`21-STEPS-execution.md:920-1126`)

**Метод.** Только чтение: `read`/`grep`/`glob` + точечные `Select-String`/`Get-Content`; ни одной сборки, теста или правки. Проверено по (а) файлы, (б) гейт, (в) `pass N`, (г) `10-DECISIONS.md`/`adr/*`, (д) дубли.
**Среда.** `node v24.19.0`; `node --test-isolation=none -e` → exit 0, флаг объявлен в `node --help` (`--experimental-test-isolation, --test-isolation=...`); `node_modules\tsdown\dist\run.mjs` и `node_modules\.bin\tsc.cmd` существуют → форма команд гейтов исполнимо́ корректна. Канонический вид сборки — `21-STEPS-execution.md:86` (`Push-Location packages/<pkg>; node ../../node_modules/tsdown/dist/run.mjs`), `:90` запрещает `pnpm run build/check` как гейт → pnpm шагам не нужен.

## E-46 (строки 924–938) — вердикт ЧАСТИЧНО
- `packages/execution/src/reconcile.ts`, `tests/recovery-scenarios.test.mjs` отсутствуют → «Create» верен; коллизия имён: `packages/beads-adapter/src/reconcile.ts:6` уже есть (`23-STEPS-quality.md:729`).
- `packages/controller/src/runtime-root.ts` в дереве нет (`packages/controller/src` = `index.ts`, `dsh-session.ts`, `model-catalog.ts`), но его создаёт E-42 (`:865`) → «Modify» верно внутри плана, не ошибка.
- Точные якоря: `MW-012-attempt-saga.md:230` = §8 п.3 «Истечение lease не проверяется при `settle`» ✓; `B-orchestration.md:452` = B-42 с `tests/claim-saga.test.mjs:536,572,599,658` ✓, и все четыре строки — реальные тесты recovery/revoke (`:536` absent evidence, `:572` revokes an attempt, `:599` abandons an intent, `:658` never revokes another saga's live lease) ✓.
- **Дефект:** форма отчёта `{operations, leases, stalls}` приписана `ReconcileReport`, но `packages/lease/src/lifecycle.ts:56-61` объявляет **ровно два** поля (`operations`, `leases`); третье поле — правка контракта пакета `lease`, которого нет в списке Files.
- `pass 8` = 8 сценариев (а)–(з) ✓; регрессия `tests/claim-saga.test.mjs` (32 `test(`) и `tests/lease.test.mjs` (25) существуют.

## E-47 (940–953) — вердикт ЧАСТИЧНО
- Каталог причин: тип `board.ts:356-370`, список `:373-381`; план даёт `:356-372` (в допуске ±10, хвост — комментарий) ✓; `N-15` (`B-orchestration.md:387`) сам ссылается на `:350-372`, `autoRunStallMinutes: 30` подтверждён ✓.
- `packages/execution/src/stall.ts` и `tests/stall-detection.test.mjs` отсутствуют → «Create» верен; «шесть тестов (а)-(ж)» = 6 (буква «д» пропущена — косметика, число сходится с `pass 6`).
- **Дефект 1 (необъявленная зависимость):** шаг пишет `needs-attention`, но носитель причины объявлен только в `22-STEPS-surface.md:341-348` (`BoardPlacement.attention`) и в `23-STEPS-quality.md:265` (Q-10, «согласовать с `plan-surface`»); «Зависит от: E-46, D05» его не называет (он есть лишь в §19 `:1125`).
- **Дефект 2 (пустая ссылка):** порог `stallAfterMs` помечен «до `D05`», но D05 (`10-DECISIONS.md:451-470`, значения `:1791`) — про `maxStepsPerAttempt = 60`, `maxTokensPerAttempt` и cap стоимости; порога залипания в D05 нет.

## E-48 (955–969) — вердикт ЧАСТИЧНО
- Все четыре якоря `packages/contracts/src/budget.ts` точны: `:65` `| 'maxAttempts'`, `:104` `maxAttempts: 'task'`, `:123` `readonly maxAttempts?: number`, `:138` «One attempt of a task (charges `maxAttempts`)» ✓.
- `packages/core/src/scheduler.ts:554` = `function budgetVerdict(` ✓ (без `export` — модульно-приватная).
- **Дефект:** шаг 2 требует правку admission-гейта в `core/src/scheduler.ts`, но Files = только `Modify packages/execution/src/stall.ts` + новый тест → файла с проверкой в списке нет.
- `pass 5` = 5 тестов (а)–(д) ✓; регрессия `tests/budget.test.mjs` существует (15 `test(`).

## E-49 (971–984) — вердикт ПОДТВЕРЖДЕНО
- `packages/execution/src/service.ts:413` = `new MyWorkError('STALE_FENCE', …)` внутри `assertOwnership` (`:405`); вызов ровно один — `:785` `const checked = assertOwnership(attempt, taskFence, expectedFence, meta)` → «счётчик рядом с `STALE_FENCE`» — одна точка ✓; `:786` `if (!checked.ok) return fail(checked.error, meta)` — отказ **до** любых записей.
- `MW-012-attempt-saga.md:234` = §8 п.7 «Отклонённый поздний результат не оставляет audit-строки» ✓ (точное совпадение); таблица `audit_events` существует (`packages/evidence/src/schema.ts:75`).
- `00-RECON.md:158` п.3 — `product-telemetry`/`dsh-token-meter` ✓; D16 (`10-DECISIONS.md:69`) «свой audit — истина, `productTelemetry` — наружу» — счётчик-метрика решению не противоречит ✓. `pass 3` = 3 теста ✓.

## E-50 (992–1006) — вердикт НЕВЕРНАЯ_СТРОКА
- `packages/contracts/src/workflow.ts` существует: **152 строки** (план: «143» — в допуске ±10, но занижено); импортёров ровно два — `contracts/src/index.ts:87` и **`contracts/src/plan.ts:28`** (`import type { PlanMutationClass } from './workflow.ts'`), второго в Files нет → переименование без него ломает сборку `contracts`.
- `packages/core/src/index.ts` не содержит ни `workflow`, ни `procedure` (Select-String → 0) → «Modify `packages/core/src/index.ts`» и тест (в) «index.ts обоих пакетов» без предмета; `packages/core/src/plan.ts:24` берёт **тип** `PlanMutationClass`, который ADR-031 (`:63`) прямо не переименовывает.
- **Шаг 0 неверен:** команда даёт 435 совпадений как написана (заходит в `packages/*/node_modules`) и **74 совпадения в 24 `.ts`-файлах** без node_modules → «ожидаемо — единицы» не соответствует ни одному прочтению.
- **Тест (б) противоречит решениям:** нулевое вхождение `workflow/Workflow` в `packages/**/src` требует переименовать `WorkflowId` (`ids.ts:41-42`), `workflowId` (`config.ts:145,170,214,453…`), `workflowPermissions` (`team.ts:115`), событие `'workflow.revised'` (`events.ts:27-28`), вид ревизии `'workflow'` (`revisions.ts:12-13`), `ContextRevision.workflow` (`context.ts:658-659`) — то есть wire/event-словарь, против шага 2 («версия контракта не меняется») и против ADR-031:56-66; сверх того 17 вхождений остаются в `tests/*.test.mjs` (`events.test.mjs:49`, `context.test.mjs:32`, `guards.test.mjs:90`) → цель «в дереве не остаётся второго `workflow`» шагом недостижима.
- Команда сборки не дописана: `:1003` — «`tsdown` по `contracts`, `core`, `planner`» вместо канонической формы `:86`; tsdown печатает `Build complete in ${ms}` (`node_modules\tsdown\dist\build-BxT2lm9L.mjs:795`) → «✔ Build complete» правдоподобно, но не проверяемо без явной команды.

## E-51 (1008–1019) — вердикт ЧАСТИЧНО (проверен глубоко)
- (а) `tests/procedure-boundary.test.mjs` отсутствует → «Create» верен; `tests/boundaries.test.mjs:496-507` — именно тест-сканер «the domain packages do not import the execution layer» → «рядом с `:496-508`» ✓; образец `tests/scheduler.test.mjs:935-944` ✓ (точный цикл по файлам `src` с `forbidden`-списком).
- Урок `B-orchestration.md:214` ✓ — §66: «механически она сейчас не enforced полностью» + перечень пакетов, не покрытых сканером.
- **(а),(б),(в) зелёные уже сегодня:** `workflowEngine` — **0 совпадений** во всём репозитории (`*.ts`,`*.js`,`*.yml`,`*.mjs` вне node_modules), включая `tests/`; `packages/controller/lib/index.js` содержит `workflow`/`workflow.revised`/`workflowPermissions`/`workflowId` (7 строк), но не `workflowEngine`; `packages/controller/cordis.patch.yml` монтирует только `@dsh-mywork/controller` → заявленный `→ FAIL` (`:1014`) недостижим, RED у шага нет.
- **(в) опирается на gitignored артефакт:** `.gitignore` → `packages/*/lib/`; ни E-50 (сборка contracts/core/planner, `:1003`), ни E-51 (шага сборки нет) не пересобирают `controller` → на чистом чекауте файла нет (ENOENT), в текущем дереве проверка идёт по устаревшему бандлу и на отсутствие строки проходит ложно (та самая «пустая проверка», от которой предостерегает `boundaries.test.mjs:489-495`).
- **Арифметика гейта:** `:1016` запускает два файла (`procedure-boundary` + `boundaries` с 26 `test(`) → `fail 0` корректно, но сводка `:153` обещает `pass 3 / fail 0`, что для этой команды невыполнимо (вместе ≈29–30, а после правки `boundaries` — на 1 больше).
- ADR-031:74 утверждает, что три grep-проверки уже «входят в границ-тест этапа 1 (`tests/boundaries.test.mjs`)» — в `tests/` нет ни одного из `workflowEngine|@deepseek-ai/dsh-workflow|WorkflowRevision|WorkflowRunId|WorkflowStopReason` → утверждение ADR не подтверждено, и E-51 закрывает реальный пробел (это аргумент **за** шаг).
- (д) Дублей нет: ни одно из шести имён тест-файлов E-46…E-51 не встречается в `20-`/`22-`/`23-STEPS-*.md` (grep); ближайшее пересечение — Q-41 (`23-STEPS-quality.md:723-740`), который сам себя ограничивает («не трогает попытки/lease»).

**Оценка допуска строк:** все проверенные якоря E-46 (`MW-012:230`, `B:452`, `claim-saga:536/572/599/658`), E-47 (`board.ts`, `B:387`), E-48 (`budget.ts:65/104/123/138`, `scheduler.ts:554`), E-49 (`service.ts:413`, `MW-012:234`, `00-RECON:158`) лежат точно (±1); ошибочны не якоря, а описания файлов, форм и ожидаемых чисел.
