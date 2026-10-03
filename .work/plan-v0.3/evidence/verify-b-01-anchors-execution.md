# verify-b-01 — Якоря execution / scheduler / contracts (инвентарь §1.1, файл `21-STEPS-execution.md`)

Ревизия: `git rev-parse HEAD` = `0c657ae1434202865bd330f0eeaf2b60eb78f6d4` (`2026-09-22`), `git status --porcelain` → 0 строк (дерево чистое, номера строк стабильны).
Метод: первоисточник читался `read`/`grep` (первоисточник = `.ts`, НЕ текст плана). Проверяемые утверждения взяты из `21-STEPS-execution.md:17` (execution) и `:20` (scheduler). Единственная запись — этот файл; тесты/сборки не запускались.

## Якорь B01-1: `packages/execution/src/service.ts:440-613` — `attemptAndComplete`
- **Вердикт:** ПОДТВЕРЖДЕНО. **Severity:** info
- **Что проверено:** read `service.ts` offset 380 limit 260 (строки 405–613 целиком); grep `attemptAndComplete` по файлу → совпадения только `440` (объявление), `734`, `1077` (вызовы).
- **Фактические строки:** `440: async function attemptAndComplete(` … тело до `612: ),` и `613:   }` (закрытие функции). Обе границы — ровно как в плане.
- **Комментарий:** Объявленный символ — локальная функция внутри `createClaimSaga`; §9 шаги 3–5 (`createAttempt:464`, `projection:528-547`, `advanceIntent … 'projected':572`, `'completed':582`) действительно внутри диапазона. Отклонение границ: 0.

## Якорь B01-2: `packages/execution/src/service.ts:405-429` — порядок проверок fence задачи → epoch → fence попытки
- **Вердикт:** ПОДТВЕРЖДЕНО. **Severity:** info
- **Что проверено:** тот же read; grep `assertOwnership` → `405` (объявление), `785` (единственный вызов).
- **Фактические строки:** `405: function assertOwnership(`; 1-я проверка `411: if (expectedFence !== taskFence) {` (fence **задачи**, `taskFence` читается вызывающим `784: store.transaction(tx => readFence(tx, attempt.taskId))`); 2-я `419-425` epoch (`420: throw new TypeError(...)` при `undefined`, `424: assertControllerEpoch(meta.controllerEpoch, attempt.controllerEpoch, meta)`); 3-я `426: const fence = assertFence(expectedFence, attempt.fence, meta)` (собственный fence попытки); `429: }`.
- **Комментарий:** Заявленный порядок воспроизводится буквально; doc-блок `393-404` объясняет именно эту последовательность. Отклонение границ: 0. Косвенно: `785-786` показывает, что проверка реально стоит на пути `settle` (статическое чтение, без прогона).

## Якорь B01-3: `packages/execution/src/service.ts:413` — `STALE_FENCE`
- **Вердикт:** ПОДТВЕРЖДЕНО. **Severity:** info
- **Что проверено:** read строки 405–429; grep `STALE_FENCE` по `service.ts` → ровно одно совпадение (413); grep `STALE_FENCE` по `packages/contracts/src` → `operation.ts:49`, `:85`.
- **Фактические строки:** `413: new MyWorkError('STALE_FENCE', \`dsh-mywork: fence ${expectedFence} is not the current fence ${taskFence} of task "${attempt.taskId}"\`, {` — ветка `411-418`, `details` на 414 содержит `{ expected, actual, attemptId, taskId }`.
- **Комментарий:** Литерал ровно на объявленной строке; код легален — входит в закрытый словарь `contracts/src/operation.ts:49` (тип) и `:85` (рантайм-список). `21-STEPS-execution.md:334` (тест «в») и `:974` («счётчик рядом с `STALE_FENCE:413`») на тот же адрес — совместимы.

## Якорь B01-4: `packages/execution/src/index.ts:38-71` — экспорты
- **Вердикт:** ПОДТВЕРЖДЕНО. **Severity:** info
- **Что проверено:** read всего файла (1–71 строк); grep `^export` → совпадения только 38, 44, 53, 71; `Test-Path`-контроль: файл существует, 71 строка.
- **Фактические строки:** `38: export { ExecutionError, isExecutionError, type ExecutionErrorCode, type ExecutionErrorOptions } from './errors.ts'`; `44-52: export { ATTEMPT_STATE_CHECK, CLAIM_INTENT_STATE_CHECK, CLAIM_SAGA_MIGRATIONS, CLAIM_SAGA_SCHEMA_NAME, CLAIM_SAGA_SCHEMA_VERSION, CLAIM_STEP_STATE_CHECK, FENCE_NOT_MONOTONIC_MARKER } from './schema.ts'`; `53-70: export { advanceIntent, allocateFence, assertClaimSchema, insertAttempt, insertIntent, listLiveAttempts, listOpenIntents, readAttempt, readFence, readIntent, readLiveAttempt, readSagaAttempt, readSteps, settleAttempt, writeSteps, type ClaimExecutor } from './store.ts'`; `71: export { createClaimSaga, type ClaimSaga, type ClaimSagaDeps } from './service.ts'`.
- **Комментарий:** Диапазон 38–71 покрывает всю поверхность пакета: строки 1–37 — doc-комментарий модуля (внутри него есть пример `createClaimSaga`, но это не `export`), файл кончается ровно на 71 («End of file»). Отклонение границ: 0.

## Якорь B01-5: `packages/core/src/scheduler.ts:303-333` — чистое ядро `planSchedulerTick`
- **Вердикт:** ПОДТВЕРЖДЕНО. **Severity:** info
- **Что проверено:** read `scheduler.ts` offset 290 limit 60 (строки 290–349); grep `export function` по файлу → 303 ровно один раз; grep по файлу `Date\.now|Math\.random|await |process\.|fs\.` → 0 совпадений (только `import` на 36, 70–73).
- **Фактические строки:** `303: export function planSchedulerTick(input: SchedulerTickInput): SchedulerPlan {`; `304: const tick = requireTickInput(input)`; `306: countSchedulerOccupancy(tick.instances, policy)`; `314-323` цикл по видам; `325: return Object.freeze({ nowMs, kick, admissions: Object.freeze(admissions), deferrals: Object.freeze(deferrals), occupancy, limits })`; `333: }`.
- **Комментарий:** Заявленная «чистота» подтверждается статически: нет `await`, нет обращений к часам/ГСЧ/ФС, результат заморожен, doc `298-299` («reads nothing but its argument … two calls with the same input produce the same plan») соответствует телу. Границы: 0.

## Якорь B01-6: `packages/core/src/scheduler.ts:314` — виды работ
- **Вердикт:** ПОДТВЕРЖДЕНО. **Severity:** info
- **Что проверено:** read строки 310–323; сверка с типом в contracts.
- **Фактические строки:** `314: for (const kind of ['worker', 'review'] as const) {`; далее `316: for (const item of kind === 'worker' ? workerWork(tick, nowMs) : reviewWork(tick, nowMs))`; тип объявлен в `packages/contracts/src/scheduler.ts:450: export type SchedulerWorkKind =` → `452: | 'worker'`, `453: A review of a queued review, drawn from the reviewer pool (§27).` → `'review'`.
- **Комментарий:** Обе заявленные «виды работ» — здесь, на объявленной строке; порядок `['worker', 'review']` совпадает с порядком объявления в типе. Границы: 0.

## Якорь B01-7: `packages/contracts/src/scheduler.ts:215-227` — лимиты и дефолты 8/4/2
- **Вердикт:** ПОДТВЕРЖДЕНО. **Severity:** info
- **Что проверено:** read `contracts/src/scheduler.ts` offset 200 limit 50 (строки 200–249); grep `SchedulerLimits|DEFAULT_SCHEDULER_LIMITS|maxAttempts|maxConcurrentLlm|maxHeavyTools` по файлу; файл существует, 546 строк.
- **Фактические строки:** `216: readonly maxAttempts: number`, `218: readonly maxConcurrentLlm: number`, `220: readonly maxHeavyTools: number` (с doc-строками 215/217/219); `224: export const DEFAULT_SCHEDULER_LIMITS: SchedulerLimits = Object.freeze({`; `225: maxAttempts: 8,`, `226: maxConcurrentLlm: 4,`, `227: maxHeavyTools: 2,`.
- **Комментарий:** Все три поля и все три значения `8/4/2` лежат внутри 215–227. Честная придирка: сама строка `214: export interface SchedulerLimits {` и закрывающая `228: })` — за границами диапазона на ±1, т.е. диапазон сдвинут внутрь на одну строку с каждого конца; содержательное утверждение при этом верно полностью и укладывается в допуск ±10. Смысловая оговорка плана подтверждается doc `205-212`: это §15-лимиты конкурентности, а не §30-бюджет `maxAttempts`.

## Якорь B01-8: `packages/scheduler/src/service.ts:280-287` — сериализация тиков
- **Вердикт:** ПОДТВЕРЖДЕНО. **Severity:** info
- **Что проверено:** read `scheduler/src/service.ts` offset 265 limit 40 (строки 265–304); grep `enqueue|this\.chain|planSchedulerTick` по файлу.
- **Фактические строки:** `280: private enqueue<T>(work: () => Promise<T>): Promise<T> {`; `281: const next = this.chain.then(work, work)`; `282-285: this.chain = next.then(() => undefined, () => undefined)`; `286: return next`; `287: }`; опора — `196: private chain: Promise<unknown> = Promise.resolve()`; применение ко всем тикам: `228`/`231` (startup), `259: return this.enqueue(() => this.runTick(checked))` (kick), `264` (reconcile), `299` (safety-reconcile).
- **Комментарий:** Диапазон 280–287 — ровно тело `enqueue`; утверждение «сериализация тиков» подтверждается: каждый вход в `runTick` идёт через одну цепочку `this.chain`, поэтому тик не накладывается на тик. Отклонение границ: 0.

## Сводка
- Проверено 8 якорей, все 8 — **ПОДТВЕРЖДЕНО** (0 `НЕВЕРНАЯ_СТРОКА`, 0 `НЕ_СУЩЕСТВУЕТ`, 0 `ЧАСТИЧНО`). Файлы существуют, все номера строк внутри файлов, отклонение границ >±10 не найдено ни в одном случае.
- Единственное фактическое расхождение — косметическое: B01-7 не включает `interface`-строку 214 и закрывающую `})` 228 (±1, внутри допуска).
- **НЕ_ПРОВЕРЕНО / границы метода:** рантайм-поведение не проверялось — тесты и сборки запрещены заданием, поэтому «STALE_FENCE действительно бросается при чужом fence» (B01-3) и «два вызова `planSchedulerTick` дают один план» (B01-5) подтверждены только статическим чтением кода, без прогона. Опровергнуть эти 8 якорей фактами первоисточника не удалось.
