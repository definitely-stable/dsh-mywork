# verify-b-19 — исполнимость Q-20…Q-30 (`23-STEPS-quality.md:393-563`)

Метод: read/grep/glob по `H:\Repo\DSH-MyWork`, `rg --count-matches`/`Test-Path` (read-only), первичные источники — код, `10-DECISIONS.md`, `adr/`, `20/21/22-STEPS-*.md`, `.work/architecture/…-v0.2-decisions.md`. Допуск по строке ±10.

## СКВОЗНОЕ (все шаги диапазона) — форма гейта
- Тесты импортируют **собранные** пакеты: `tests/lib/fixtures.mjs:1-36` (entries `packages/*/lib/index.js`, бросает «missing build output … run "pnpm run build" first»). Все Q-20…Q-30 создают новые `packages/**/src/**`, значит `node --test tests/<x>.test.mjs` без пересборки не увидит новый экспорт.
- Гейты диапазона (23:416,419,428,432,443,445,456,460,477,480,490,493,504,506,517,520,530,533,543,545,555,558) — только `node --test`, без сборки и без `--test-isolation=none`; штатный вход репо — `package.json:16` (`node --test --test-isolation=none "tests/**/*.test.mjs"`). Соседний файл сборку в гейт включает: `21-STEPS-execution.md:375` (`node ../../node_modules/tsdown/dist/run.mjs`). Инструменты есть: `Test-Path node_modules\tsdown\dist\run.mjs`=True, `node_modules\.bin\tsc.cmd`=True; node v24.19.0.
- `23-STEPS-quality.md:868` (§10.1) сам признаёт: тесты не запускались, «ожидаемые выводы — прогноз».

## Q-20
- `packages/contracts/src/worktype.ts` и `tests/worktype-contract.test.mjs` — нет (glob `packages/contracts/src/*.ts`, `tests/*.mjs`) → Create верно. Реэкспорт-блок `contracts/src/index.ts:68-96` — точно (68…96) ✓.
- ADR028: `.work/architecture/…-v0.2-decisions.md:377`, таблица `:383-390` транскрибирована верно, но поле в источнике — `integrationStrategy` (:383), в шаге — `integration` (23:417).
- `pass 4` (23:419) против **двух** описанных тестов (23:415,418) — расхождение.
- Значения `humanAcceptance` таблицей не определены: у research/analysis/document/non-git-ops «да» (ADR028:386-390), значения `'always'|'on-integration'` шаг (23:418) оставляет как «'always'/'on-integration' точно по таблице».
- Work type задачи негде взять: `grep 'workType|WorkType' packages/**/*.ts` → **0**; `21-STEPS-execution.md:420` «`Task` не расширяется».

## Q-21 (проверен глубоко)
- Create `packages/core/src/worktype.ts` — файла нет ✓; `contracts/src/operation.ts:78` `MYWORK_ERROR_CODES` есть (union `:55-75`, список `:79-99`) ✓; `tests/finish-criteria.test.mjs` нет ✓. `pass 3` = 3 тестам ✓.
- **Пиннинг не в списке файлов:** `tests/events.test.mjs:172-199` — `assert.deepEqual([...MYWORK_ERROR_CODES], [20 имён])`; добавление `FINISH_CRITERIA_UNMET` красит его. Правило самого плана — правка пиннинга «в этом же коммите, иначе зелёный прогон врёт» (23:270).
- **Путь завершения выбран неверно:** `packages/execution/src/service.ts` — claim-сага (`createClaimSaga` :246; `graph.transition` → `'assigned'` :530-536), слова `'done'` в файле нет (grep). Матрица переходов — `core/src/task.ts:59`, `completedAt` `:294`; `21-STEPS-execution.md:345-350` «`done` ставит только интегратор (E-28)», E-25 создаёт `packages/execution/src/integrator.ts` (`21-STEPS:561`). У Q-21 нет «Зависит от» и не названы ни `integrator.ts`, ни `core/task.ts`.
- «Engine отказывает в done» (ADR028:392) согласуется с ADR028; `NeedsAttentionReason`/`human.override` тут не задействованы.

## Q-22
- `ARTIFACT_KINDS` — 12 значений, `packages/contracts/src/artifact.ts:62-75` (diff…gate-decision); manual-receipt/web-citation/design-doc отсутствуют; «15 значений» (23:446) арифметически верно ✓.
- **Нет файла реализации интеграторов:** `21-STEPS-execution.md:433` прямо передаёт «Q-22 (`ARTIFACT_KINDS` + 4 интегратора)» в 23-STEPS, но E-25…E-29 строят только git-интегратор (merge/rebase/`Refs: mw-<hash>`, `21-STEPS:561-621`), а файлы Q-22 — лишь `Modify artifact.ts` + тест (23:440), усилие S; тест шага 2 (`manual-receipt` без `headSha` против `git-merge`, 23:444) класть некуда.
- Кросс-файловые пиннинги: E-13 требует «`ARTIFACT_KINDS.length` вырос ровно на 1, порядок сравнивается с зафиксированным списком» (`21-STEPS:372`), E-38 — то же (`21-STEPS:777`); тестовые файлы E-13/E-38 в списке Q-22 не значатся. `packages/evidence/src/metadata.ts` из «Рисков» существует ✓.

## Q-23
- «Modify `core/src/worktype.ts`» = Create Q-21 (23:425) ✓ по порядку файла; «Modify `core/src/human-decision.ts`» = Create Q-11 (23:278) ✓ по порядку файла. `trigger {kind:'work-acceptance', workType}` совпадает с размеченным объединением Q-09 (23:255) ✓; `originState` объявлен Q-09 (23:250) и тестом Q-11 (23:280) ✓; self-review → `SECURITY_DENIED` подтверждён (`tests/review.test.mjs:64-77`) ✓; `pass 4` = 4 тестам ✓.
- **Порядок противоречит §0.5:** граф (23:83) рисует «Q-09…Q-19 → Q-23 → Q-20…Q-22», а сам Q-23 зависит от Q-20/Q-21 (23:451) и правит файл, созданный Q-21.
- **Цель против риска:** цель требует `answered` для всех типов с `humanAcceptance !== 'never'` (23:452), риск признаёт, что для `code` приёмка привязана к слиянию (23:462) — при 'on-integration' завершение попытки либо блокируется, либо нет.

## Q-24
- `packages/planner/src/schema.ts:112` — `CREATE TABLE work_proposal` ✓; `kind` — закрытый CHECK `:115` (`blocker|follow-up|scope-change|dependency|security-risk`), `state` `:120`, поля `:113-126` — **нет** provenance/trust/conflict; `PLAN_MUTATION_SCHEMA_VERSION = 5` (`:36`). Файлы шага — только `planner/src/service.ts` (23:474) → носитель кандидата (таблица/миграция) не объявлен, а тест шага 2 требует структурных provenance/trust/конфликта. `pass 3` = 3 ✓.

## Q-25 / Q-26
- `budget.ts:59-87` `BUDGET_LIMIT_NAMES` c `maxOptimizerCostPerDay` (`:71`, `:84`) ✓. `pass 3`/`pass 2` = 3/2 описанным тестам ✓.
- Носитель: F-36/F-37 дают таблицу `background_job` (миграция 7) и `packages/storage/src/background-jobs.ts` (`20-STEPS:944,954,973`), а шаги пишут только «Modify место durable-job» (23:487,501) — файл не назван.
- Цитата `packages/jobs/jobs-local/src/index.ts:1-11` (23:495) в MyWork **не существует** (`Test-Path False`; в MyWork 12 пакетов, `packages\jobs` нет) — это путь DSH-чек-аута (`C:\Reposit\…\packages\jobs\jobs-local\src\index.ts`=True); F-36:946 префикс чек-аута указывает, Q-25 — нет.

## Q-27
- Create `controller/src/observability.ts` ✓ (в `packages/controller/src` только index/model-catalog/dsh-session); Modify `index.ts` согласуется с швом F-31 (`20-STEPS:822` правит `app.ts` и `index.ts:118-127`) ✓. `pass 3` = 3 ✓.
- **Дубль:** F-54 (`20-STEPS:1408-1438`) — тот же экспортёр D16, но файл `packages/controller/src/telemetry.ts` и тест `tests/telemetry.test.mjs`; F-55 правит `telemetry.ts` (`20-STEPS:1447`). Два файла и два теста на один результат.
- **Противоречие:** F-54:1431-1432 при отсутствии сервиса — «ничего не делать… `{emitted:false}`» (fail-open), Q-27:518 — «отсутствие сообщается, а не молча теряется».
- Факты верны: `otel|telemetry` по MyWork packages = **0** (rg); `product-telemetry-otel/src/index.ts` в чек-ауте существует; `correlationId` repo-wide **172 в 35** файлах, `correlation_id` 28/10 (мой пересчёт совпал; `quality-04:19`), но D16:1311 и F-54:1415 говорят «90» — дрейф прозы. Ни один из двух шагов не называет, откуда события попадают в `emit` (подписка на audit/outbox).

## Q-28
- `core/src/budget.ts` есть ✓ (`chargeConsumption` :122, `modelCallCost` :181, `modelRateOf` :195 — якоря шага 23:535 верны); `controller/src/metrics.ts` и `tests/metrics-counters.test.mjs` отсутствуют ✓. `pass 3` = 3 ✓.
- Тест 2 («число вызовов `chargeConsumption` = число расходов») как написан не исполним: подсчёт вызовов функции из собранного ESM требует мокинга модуля (`node:test` `mock.module` — за флагом `--experimental-test-module-mocks`; в репо `grep mock\.` по `tests/` → 0), иного способа нет, а `core/budget.ts` объявлен «только чтение» (23:527).
- Гейт `grep -c "BudgetConsumption" …/metrics.ts → 0` (23:534) не отличает «нет второго типа расхода» от «файла нет/опечатка» (grep по отсутствующему файлу — exit 1).

## Q-29
- Create `packages/core/src/concurrency.ts` ✓ отсутствует. «Modify путь вызова модели» — без имени файла.
- **Точки вызова модели в MyWork нет:** `grep 'ctx\.llm|llm/stream' packages/**/*.ts` → 0; единственное обращение к модели — `packages/controller/src/dsh-session.ts:636` (`#prompt` → `api.controller.prompt`, `mode:'queue'` :640), т.е. файл контроллера, а контракт `core` не может импортировать контроллер (`controller/src/index.ts:46` импортирует `@dsh-mywork/core`).
- D05:515 прямо относит счётчик параллелизма к circuit-breaker'у («единственное место, где такой счётчик осмысленно живёт») — это scheduler/budget, а не обёртка вызова. `providerConcurrency` в DSH-чек-ауте = 0 (rg) ✓, аналоги есть (maxParallelToolCalls — 10 файлов, maxParallelSubCalls — 6, imageCompressionConcurrency — 4). `pass 2` = 2 ✓.

## Q-30
- `core/src/scheduler.ts`: `budgetVerdict` :554-575, `decideBudgetAdmission` вызывается **ровно один раз** — :568 ✓ (план писал `:561-568`; иных вызовов нет: `core/budget.ts:217` объявление, `core/index.ts:334` реэкспорт); `'budget-exhausted'` есть (`contracts/src/board.ts:362,376`), `'human.override'` есть (`contracts/audit.ts:50,75`) ✓; `pass 3` = 3 ✓.
- **Лимит шагов живёт в F-53** (`20-STEPS:1384-1404`: `packages/core/src/step-breaker.ts`, `tests/step-breaker.test.mjs`, имя лимита `maxSteps`), но Q-30 не имеет «Зависит от» и его файлы — только `core/scheduler.ts` + тест; при этом D05:528-529 требует правок `BUDGET_LIMIT_NAMES` (`contracts/src/budget.ts`), `chargeOf`/`usedOf` и `BudgetConsumption`. Имя в D05:520 — `maxStepsPerAttempt`, в F-53 — `maxSteps`.
- Тест 1 требует durable `HumanDecision` из бюджетного пути, но ни один файл списка Q-30 её не открывает (открытие — Q-11 `core/human-decision.ts`, стор — Q-13).

## Итог
- Подтверждены: `Create`-пути (worktype.ts ×2, concurrency.ts, metrics.ts, observability.ts, 11 тестов), якоря `budget.ts:59-87,122,181,195`, `artifact.ts:62-75`, `operation.ts:78`, `scheduler.ts:568`, `schema.ts:112`, `index.ts:68-96`, ADR028:377/383-390, D05/D16/D17/D20, счётчики `pass N` (кроме Q-20).
- Дефекты: Q-21 (не тот файл завершения; пиннинг `MYWORK_ERROR_CODES`), Q-22 (нет файла интеграторов), Q-24 (нет носителя кандидата), Q-25 (путь без префикса чек-аута), Q-27 (дубль F-54 + противоречие о «молчании»), Q-28 (недоказуемый тест 2), Q-29 (нет точки вызова модели; конфликт с D05:515), Q-30 (зависимость от F-51…F-53 и имя лимита), сквозное — гейты без сборки.
