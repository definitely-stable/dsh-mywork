# MW-023 · E-17 — провал или отсутствие гейта блокирует review admission

- Предмет: остаток карточки MW-023 (шаг `E-17`, план `.work/plan-v0.3/21-STEPS-execution.md:451-463`). Отчёт автора E-13…E-16, E-18 — `.work/reports/MW-023-gates.md` (READY_FOR_REVIEW), **не переписывался**; здесь только остаток.
- Исполнитель: teammate `review-integrator-close` (WS-3, shared task `task-3`)
- Репозиторий: `H:\Repo\DSH-MyWork`, base/head `33e6919db031fb79b9c34c0ada67d4c600b0405d` (незакоммиченное дерево; коммитов не делал, `git diff --cached --stat` пуст, индекс не трогал)
- Окружение: Node `v24.x`, pwsh, сборка под локом `scripts/with-build-lock.mjs`, `NODE_OPTIONS=--max-old-space-size=8192` для `packages/execution` (ограничение N-3 из отчёта автора)
- Статус: **READY_FOR_REVIEW** (остаток E-17 закрыт в `gates-admission.ts` + доказан через реальную очередь; мост `AttemptGatePort` сделан отдельно — `task-7`, `.work/reports/MW-023-gates-port.md`; вызов порта в `worker.ts` — `task-6` и не моя зона, см. §6.1)

## 1. Проверка зависимости

| Что проверено | Команда | Результат |
|---|---|---|
| `E-16` (политика гейтов) на месте | `node --test --test-isolation=none "tests/gates-policy.test.mjs"` | `tests 6 / pass 6 / fail 0`, exit 0 |
| `E-15` (exact head) на месте | `node --test --test-isolation=none "tests/gates-head.test.mjs"` | `tests 5 / pass 5 / fail 0`, exit 0 |
| Контрактный словарь отказов | `Select-String -Path packages/contracts/src/verification.ts -Pattern 'REVIEW_GATES_MISSING'` | `:93` (тип), `:102` (значение) — отказ адмиссии уже в закрытом словаре `GATE_REFUSAL_REASONS`, новый код не вводился |
| Проверка гейтов существует и вызывается | `Select-String -Path packages/execution/src/*.ts -Pattern 'assertGatesSatisfied\|readGateResults'` | `gates-admission.ts:184,248` (объявление), `review-queue.ts:1580-1593` (единственный вызов на пути адмиссии — как и требует план, `E-19` вызывает `E-17`) |
| Авторский отчёт | `.work/reports/MW-023-gates.md:256` | E-17 там помечен «не делался — ведёт WS-3»; факты §5 отчёта автора не переоткрывал |

## 2. Что сделано

### 2.1 Проверка (моя зона): `packages/execution/src/gates-admission.ts`

Модуль уже был в дереве и на момент моей работы изменений не потребовал. Проверено по исходнику:
`readGateResults(store, attemptId)` читает `gate-result` записи попытки в порядке `created_at, artifact_id` и отвергает нечитаемую/неразбираемую запись как `CONTRACT_MISMATCH` (пустой набор — это **другой факт**, «гейты не настроены», и он не подменяется); `assertGatesSatisfied(attemptId, headSha, results, options)` — чистая функция: последняя запись гейта важнее предыдущих, вердикт о другом `headSha` не считается (`head-moved`), `pass` — единственный допускающий вердикт, `error`/`timeout`/`cancelled` — отказ, отсутствие объявленного обязательного гейта — `missing`. Отказ — `TASK_CONFLICT` с `details.refusal = 'REVIEW_GATES_MISSING'` и `details.blocks`.

### 2.2 Главный пробел: E-17 не был доказан как **вызов**

Утверждение «гейты блокируют review admission» доказывалось только тестами чистой функции (`tests/gates-admission.test.mjs`, тесты 1–4) и матрицей переходов (тест 5). Удаление вызова `assertGatesSatisfied` из `requestReview` не покрасило бы **ни одного** теста — то есть E-17 держался на отсутствии вызова, а не на отказе. План (`:457`) требует именно обратного: тест (а) — «попытка без записей гейтов **не** допускается в очередь review».

Добавлен 6-й тест в `tests/gates-admission.test.mjs` (`the review queue asks the gates, and a missing gate leaves no review behind`), который гоняет **реальную** очередь (`execution.createReviewQueue` + настоящие `storage`/`evidence`/`review_claim`-миграция от аллокатора) и проверяет три состояния одного и того же вызова `requestReview`:

1. нет ни одной `gate-result` записи → отказ `TASK_CONFLICT` / `REVIEW_GATES_MISSING`, `blocks: []`, и `SELECT COUNT(*) FROM review_claim` = **0** (отказ не оставляет очереди);
2. записан `fail` обязательного гейта на этом head → отказ с `blocks: [{ id: 'tests', reason: 'not-passing', verdict: 'fail' }]`, в очереди по-прежнему **0**;
3. та же запись гейта перекрыта зелёной на том же head → `requestReview` **допускает**: `claim.state = 'queued'`, `gates = ['tests']`, в очереди **1**, при этом `transition` графа не вызывался ни разу (`deepEqual(graph.transitions, [])`).

Позитивный контроль (3) — это то, что делает отказы (1) и (2) утверждениями о гейтах, а не о стенде. Дополнительно тест запрашивает SQL-выборку, которую план требует в evidence: `SELECT COUNT(*) FROM artifacts WHERE kind='gate-result' AND attempt_id = ?` → **2** (оба вердикта лежат как evidence; для провального сценария на шаге 2 — 1).

### 2.3 Наблюдаемость отказа и «живая попытка»

- Отказ наблюдаем: типизированный `Result` с кодом, `details.refusal`, `details.blocks` и `details.headSha`; ничего не бросается (обёртка `try/catch` вокруг чистой функции в `review-queue.ts:1582-1592` превращает нарушения контракта в `CONTRACT_MISMATCH`, а не в исключение).
- Живой попытки отказ не оставляет **на стороне очереди**: `requestReview` не переводит задачу (проверено `transitions = []`), не пишет `review_claim` и не трогает попытку. Переход попытки в терминальное состояние при провале гейтов — это producer-половина в `worker.ts`, которой сегодня нет вовсе (§6.1): пока её нет, схема fail-closed, потому что отсутствие `gate-result` само по себе отказ (случай 1), а не «пропуск».

## 3. Изменённые файлы

| Файл | Что изменилось |
|---|---|
| `tests/gates-admission.test.mjs` | +1 тест (6-й) и его стенд: `graphPort(state)`, `queued(store)`, `queueFixture()`, импорт `repoRoot`/`pathToFileURL`, аллокатор миграций из `packages/controller/src/migration-allocator.ts`. Правки только в этом файле; 5 авторских тестов не тронуты |
| `packages/execution/src/gates-admission.ts` | не менялся (проверен по исходнику) |
| `packages/execution/src/review-queue.ts` | не менялся под E-17: вызов `assertGatesSatisfied` уже был на `:1580-1593` (мои правки в этом файле — MW-024, см. `.work/reports/MW-024-review.md`) |

## 4. Команды и exit codes

Все прогоны — `node --test --test-isolation=none "<file>"`, pwsh, из корня репозитория.

| # | Команда | Наблюдение | Exit |
|---|---|---|---|
| T-1 | `Select-String -Path packages/execution/src/*.ts -Pattern 'assertGatesSatisfied\|readGateResults'` | 4 совпадения: объявления `gates-admission.ts:184,248` + вызов `review-queue.ts:1580,1584` | 0 |
| T-2 | `Select-String -Path packages/contracts/src/verification.ts -Pattern 'REVIEW_GATES_MISSING'` | `:93`, `:102` — словарь отказов закрыт контрактом | 0 |
| B-1 | `node_modules\.bin\tsc.cmd --noEmit -p packages/execution/tsconfig.json` | без диагностик | **0** |
| R-1 | `node --test --test-isolation=none "tests/gates-admission.test.mjs"` (до нового теста, 5 тестов) | `tests 5 / pass 5 / fail 0` — зелено **и без** доказательства вызова (в этом и был пробел) | 0 |
| R-2 | тот же файл с новым тестом, первая версия | `fail 1`: `blocks` был `[]` вместо `[{id:'tests',…}]` — в тесте гейт записывался без `attemptId` и попадал в другую попытку (ошибка теста, исправлена) | 1 |
| G-1 | `node --test --test-isolation=none "tests/gates-admission.test.mjs"` (после исправления) | `tests 6 / pass 6 / fail 0 / skipped 0`, `duration_ms 287.5` | **0** |
| G-2 | `node --test --test-isolation=none "tests/gates-policy.test.mjs"` | `tests 6 / pass 6 / fail 0` | **0** |
| G-3 | `node --test --test-isolation=none "tests/gates-runner.test.mjs"` | `tests 10 / pass 10 / fail 0` | **0** |
| G-4 | `node --test --test-isolation=none "tests/gates-head.test.mjs"` | `tests 5 / pass 5 / fail 0` | **0** |
| G-5 | `node --test --test-isolation=none "tests/gates-determinism.test.mjs"` | `tests 5 / pass 5 / fail 0` | **0** |
| G-6 | `node --test --test-isolation=none "tests/gates-contract.test.mjs"` | `tests 5 / pass 5 / fail 0` | **0** |
| B-2 | `Push-Location packages/execution; $env:NODE_OPTIONS='--max-old-space-size=8192'; node ../../scripts/with-build-lock.mjs execution node ../../node_modules/tsdown/dist/run.mjs` | `✔ Build complete in 61611ms`, `lib/index.js` 1.70 MB (4 файла) | **0** |

Полный батч из 17 файлов (гейты + review + интегратор) — 91 тест, 91 pass, 0 fail, 0 ненулевых exit; см. §4 отчёта `.work/reports/MW-024-review.md` (тот же прогон, одно окно, `2026-09-28 11:17:54`).

Окно пересборки: `build-gate` объявил полную пересборку 15 пакетов; прогоны делались **после** появления всех `packages/*/lib` (последний — `controller`, 11:06:29). Состояние дерева на момент прогонов: все 15 `lib/index.js` на месте, `packages/execution/lib` пересобран мной под локом.

## 5. Mutation-check (обязательный для этого инварианта)

Цель: доказать, что тест краснеет именно на снятии блокировки, а не «потому что что-то упало».

| # | Действие | Наблюдение | Exit |
|---|---|---|---|
| M-1 | `Copy-Item packages\execution\lib\index.js .tmp\review-integrator-close\execution-lib-index.js.bak` | sha256 бэкапа и `lib` совпадают: `9BDE4CEA5DD85C8F339E6CA33C65206D3C854312276320904E400BC45713EC8D` | 0 |
| M-2 | `([regex]::Matches($src,'if \(!gates\.ok\) return fail\(gates\.error, meta\);')).Count` в `lib/index.js` | `1` — точка мутации единственная | 0 |
| M-3 | замена этой строки на `if (!gates.ok) gates = ok(Object.freeze({ attemptId: attempt.value.id, headSha: reviewed.value.headSha, results: Object.freeze([]) }), meta);` | оригинал: `0` совпадений, мутация: `1`; sha256 `lib` = `D8BC5B18DC1256FAD2E02B7EBA6327C401B19A6C41D60F20DD93487D892E6850` (блокировка снята, значение `gates.value` сохранено, чтобы замена была ровно «снятие блокировки») | 0 |
| M-4 | `node --test --test-isolation=none "tests/gates-admission.test.mjs"` на мутированном артефакте | `tests 6 / pass 5 / fail 1`; падает **только** новый тест, на утверждении `AssertionError: admission must be refused` (строка `refusalOf`), 5 «чистых» тестов остаются зелёными — то есть детектор вызова, а не детектор функции | **1** |
| M-5 | `Copy-Item .tmp\...\execution-lib-index.js.bak packages\execution\lib\index.js -Force` | восстановленный sha256 = `9BDE4CEA…13EC8D` — байт-в-байт исходный | 0 |
| M-6 | пересборка `packages/execution` под локом (`--max-old-space-size=8192`) | `✔ Build complete in 60981ms`, exit **0**, sha256 пересобранного `lib/index.js` = `9BDE4CEA…13EC8D` — совпадает с бэкапом (сборка детерминирована, следов мутации нет) | **0** |
| M-7 | повторный батч 17 файлов после восстановления и пересборки | `91/91 pass`, `fail 0`, `NONZERO=0` (11:17:54) | **0** |

Скрэтч: `.tmp/review-integrator-close/execution-lib-index.js.bak` (gitignored). Живой `$DSH_HOME`, доска и чужие пакеты не трогались; `packages/contracts/**`, `packages/execution/src/{index,service,worker}.ts` не изменялись.

## 6. Ограничения и что осталось непроверенным

1. **Producer-половина E-17 не реализована: `worker.ts` не запускает гейты.** Проверено по исходнику: `Select-String -Path packages/execution/src/worker.ts -Pattern 'gate\|Gate\|review\|awaiting-review'` → **0 совпадений**; `runGatePolicy` из `packages/gate-runner` не вызывается нигде в `packages/*/src`. Значит, сегодня в дереве нет пути, который порождает `gate-result` в реальном прогоне попытки: план (`:455`) требует «Modify `worker.ts` (запись `gate-result` перед `awaiting-review`)». Файл принадлежит `execution-close`, поэтому мной не правился; минимальная правка описана и отправлена Lead'у и `execution-close` (§6.2), решение Lead'а — `task-6` (вызов порта в воркере). **Мост со стороны гейтов уже есть**: `createAttemptGatePort` в `packages/gate-runner/src/port.ts` (shared task `task-7`, отчёт `.work/reports/MW-023-gates-port.md`, 5 тестов + mutation-check) — остаётся только вызов. До него схема **fail-closed**: очередь отказывает при отсутствии гейтов (доказано тестом), но «гейты не запускались» и «гейты провалились» различимы только по `blocks`.
2. **`exitCode` у гейтов-сравнений (`base`/`head`) равен `null`** — ограничение автора (`MW-023-gates.md:257`); для E-17 несущественно: носитель исхода — `verdict`, а `error`/`timeout` отказ так же, как `fail`.
3. **Чужие пакеты не пересобирались мной**, кроме `packages/execution` (мои правки) — кроме случая, когда полную пересборку сделал `build-gate`. Усталость бандлов потребителей `ARTIFACT_KINDS` (находка B-4 автора) закрывается его прогоном, не моим.
4. **Полный набор тестов не гонялся** — это зона `build-gate`; здесь только 17 файлов моего батча.
5. **E-13…E-16, E-18 не перепроверялись заново**: их прогоны (`gates-*`, 31 тест) воспроизведены как регрессия (G-2…G-6, все зелёные), факты отчёта автора не переоткрывались.

### 6.2 Предлагаемая минимальная правка в `worker.ts` (для `execution-close` + Lead)

1. Порт (в `worker.ts` или в контрактах, решает владелец):
   ```ts
   /** Запуск настроенных гейтов попытки и их вердикты (§19, E-17). */
   export interface AttemptGatePort {
     run(request: { attemptId: AttemptId; taskId: TaskId; workspaceId: WorkspaceId; cwd: string; headSha: string },
         meta: OperationMeta): Promise<Result<readonly GateResult[]>>
   }
   ```
2. `WorkerDeps.gates?: AttemptGatePort` — **опциональный**, чтобы существующие тесты воркера не меняли стенд; отсутствие порта = фича не сконфигурирована, а не «работаем без гейтов» (это отдельное решение владельца).
3. В `runAttempt`/`resumeAttempt`, **после** успешного завершения сессии и **до** возврата отчёта с `outcome: 'completed'`: вызвать `deps.gates.run({ cwd: worktree.cwd, headSha: <frozen head>, … })`, записать каждый вердикт артефактом `gate-result` (той же формой, что читает `readGateResults`), и если прогон вернул `refusal !== undefined` или обязательный гейт не `pass` — провести попытку через существующий `refuse()`-путь (`outcome: 'failed'`, reason `REVIEW_GATES_MISSING`) до возврата, чтобы живой попытки не оставалось.
4. `requestReview` воркер не вызывает — постановка review остаётся за очередью (`E-19`), направление зависимости не меняется.

## 7. Статус и следующий шаг

**READY_FOR_REVIEW.**

Остаток E-17 в моей зоне закрыт: проверка `assertGatesSatisfied` есть, **вызывается** из `requestReview` и доказана тестом, который краснеет при снятии блокировки (mutation M-4) и снова зелён после восстановления и пересборки (M-5…M-7). Мост `AttemptGatePort` — `task-7`, отчёт `.work/reports/MW-023-gates-port.md` (5 тестов, mutation-check). Приёмку не объявляю: нужен независимый ревьюер. Остаток — вызов моста в `worker.ts` (`task-6`, исполнитель `execution-close`); MW-024 и MW-025 — в `.work/reports/MW-024-review.md` и `.work/reports/MW-025-integrator.md`. Коммитов не делал.
