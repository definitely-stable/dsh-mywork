# execution-01 — факты по packages/execution (v0.3)

1. Файлы packages/execution/src (заданная команда; в скобках — `@(Get-Content).Count`, т.е. с пустыми строками):
   packages/execution/src/errors.ts 67 (72)
   packages/execution/src/index.ts 70 (71)
   packages/execution/src/schema.ts 145 (161)
   packages/execution/src/service.ts 1186 (1238)
   packages/execution/src/store.ts 477 (505)
   Пакет: package.json 30, tsconfig.json 4, tsdown.config.ts 19; `packages/execution/lib/index.js` — существует.
2. Экспорты packages/execution/src/index.ts (index.ts:38-71):
   - errors.ts: ExecutionError, isExecutionError, ExecutionErrorCode, ExecutionErrorOptions
   - schema.ts: ATTEMPT_STATE_CHECK, CLAIM_INTENT_STATE_CHECK, CLAIM_SAGA_MIGRATIONS, CLAIM_SAGA_SCHEMA_NAME, CLAIM_SAGA_SCHEMA_VERSION, CLAIM_STEP_STATE_CHECK, FENCE_NOT_MONOTONIC_MARKER
   - store.ts: advanceIntent, allocateFence, assertClaimSchema, insertAttempt, insertIntent, listLiveAttempts, listOpenIntents, readAttempt, readFence, readIntent, readLiveAttempt, readSagaAttempt, readSteps, settleAttempt, writeSteps, type ClaimExecutor
   - service.ts: createClaimSaga, type ClaimSaga, type ClaimSagaDeps
   Не реэкспортированы из store.ts: requireCounter store.ts:480, requireText store.ts:487, requireObject store.ts:497, type StoredEpoch store.ts:505.
3. Порты: собственных `*Port` в пакете нет. ClaimExecutor = SqlExecutor store.ts:139. ClaimSagaDeps: store MyWorkStore service.ts:92, graph TaskGraphPort service.ts:97 (объявлен contracts/src/taskgraph.ts:343), clock ClockPort service.ts:99 (объявлен contracts/src/index.ts:56).
4. Понятия в packages/execution/src (case-sensitive подсчёт вхождений):
   Attempt — ЕСТЬ (90): store.ts:360 insertAttempt, store.ts:395 readLiveAttempt, store.ts:428 settleAttempt, service.ts:119 attemptOf, service.ts:123 openIntents, contracts/src/claim.ts:256 AttemptRecord, contracts/src/attempt.ts:21 AttemptState.
   handoff — НЕТ (0). writeIntent/writeScope — НЕТ (0). verification — НЕТ (0). review — НЕТ (0). gate — НЕТ (0). stall — НЕТ (0). maxAttempts — НЕТ (0). heartbeat — НЕТ (0). worktree — НЕТ (0).
   reject — только в комментариях service.ts:24, service.ts:399, идентификаторов нет; ближайшее рабочее понятие — revoke: service.ts:117, service.ts:1159, schema.ts:58, schema.ts:62.
5. Тесты: tests/claim-saga.test.mjs (1116 строк, 32 вызова `test()`), tests/lib/claim-crash-child.mjs (117), фикстуры tests/lib/fixtures.mjs:26 (`execution: 'packages/execution/lib/index.js'`) и :66.
   Команда прогона одного файла: `node --test --test-isolation=none "tests/claim-saga.test.mjs"`. Полный набор (package.json:test): `node --test --test-isolation=none "tests/**/*.test.mjs"`.
   Тесты импортируют собранный lib (fixtures.mjs:31 проверяет existsSync), т.е. нужен предварительный build.
6. Потребитель `@dsh-mywork/execution`: рантайм-импортов нет ни в одном пакете. Есть только: tsconfig.base.json:35 (path map), tests/lib/fixtures.mjs:66, tests/lib/claim-crash-child.mjs:27, tests/boundaries.test.mjs:490-501, комментарии packages/core/src/claim.ts:10, packages/contracts/src/claim.ts:10, packages/beads-adapter/src/reconcile.ts:13, tests/events.test.mjs:62. Импорт execution доменными пакетами запрещён тестом tests/boundaries.test.mjs:496.

не проверено:
- Команды не запускались: pnpm, tsdown, typecheck, node --test (exit code отсутствуют).
- service.ts прочитан только 28-142, schema.ts — 1-145 и 125-161; остальное — по grep.
- Концепты (п.4) грепались только по packages/execution/src/*.ts; handoff/gate/stall в тестах не искались.
- Содержимое packages/execution/lib/*.js не читалось (только факт существования файла).
- Потребители в apps/, plugins/, .dsh/ — grep по репозиторию уважает .gitignore, полнота не гарантирована.
