# verify-b-12 — исполнимость шагов E-10…E-18 (`21-STEPS-execution.md:313-452`)

READ-ONLY. Прочитан весь диапазон (read 300-469), первоисточники — в H:\Repo\DSH-MyWork и в чек-ауте DSH.
Допуск по строке ±10. Вердикт по каждому шагу — в конце.

## Общие факты (проверено инструментами, не по тексту плану)
- `packages/execution/src/worker.ts`, `packages/contracts/src/verification.ts`, `packages/gate-runner/**`, `packages/worktree-adapter/**`, `tests/worker-*.test.mjs`, `tests/gates-*.test.mjs` — **нет на диске**; worker.ts создаётся в E-08 (`:283`), gate-runner — в E-14, verification.ts — в E-13. «Modify» в E-10…E-12/E-15/E-16/E-18 относится к артефактам более ранних шагов — внутренне согласовано, сейчас не существует.
- Инструменты существуют: `node_modules\tsdown\dist\run.mjs` (bin tsdown = `./dist/run.mjs`), `node_modules\.bin\tsc.cmd`, `packages/contracts/tsdown.config.ts`; `pnpm` ни в одной гейт-команде диапазона не используется (единственное упоминание — как имя файла внутри spec'а гейта, `:392`).
- Регрессии ссылаются на существующие файлы: `tests/attempt.test.mjs`, `tests/claim-saga.test.mjs`, `tests/authority.test.mjs`, `tests/evidence.test.mjs`, `tests/boundaries.test.mjs` — все есть; `tests/lib/claim-crash-child.mjs` есть (`tests/lib/` = crash-child, claim-crash-child, fixtures, mw019-restart-child).
- Числа `pass N` совпадают с числом описанных тестов во ВСЕХ шагах диапазона: E-10 5/5, E-11 5/5, E-12 3/3, E-13 5/5, E-14 8/8, E-15 4/4, E-16 5/5, E-17 5/5, E-18 4/4.
- Дублей нет: grep по `.work/**` по именам `worker-failure|worker-restart|worker-no-done|worker-crash-child|gates-contract|gates-runner|gates-head|gates-policy|gates-admission|gates-determinism` — совпадения только в `21-STEPS-execution.md` (карта `:112-120` + тела).
- Ссылки на решения в «Зависит от» — принятая конвенция файла: E-06 D17 (`:244`), E-24 D14 (`:537`), E-47 D05 (`:941`), E-50 D03 (`:993`) → E-18 «D11» аномалией не является; D11 (`10-DECISIONS.md:64`) = инъецированные часы/`ClockPort`, что и делает E-18.

## E-10 · Failure-путь — ПОДТВЕРЖДЕНО
- `settleAttempt` = `packages/execution/src/store.ts:428`, `listLiveAttempts` = `:401` — оба существуют; `worker-report` в `ARTIFACT_KINDS` (`packages/contracts/src/artifact.ts:45`).
- Гейтовые SQL валидны: `attempt.settled_at` есть (`packages/execution/src/schema.ts:132`), состояния `created|leased|starting|running|settling` — валидный словарь (`packages/contracts/src/attempt.ts:46-51`), таблица `task_fence` и триггер монотонности — `schema.ts:139-149`.
- Риск-якорь `.work/reports/MW-012-attempt-saga.md:230` («Истечение lease не проверяется при `settle`») — точное совпадение.

## E-11 · Restart и late callback — ЧАСТИЧНО (см. findings 3, 4)
- Шаг 0: `Select-String -Pattern 'rejects a duplicate|runId'` по `packages/contracts/src/agent-runtime.ts` даёт **5** строк: 68 (`rejects a duplicate`), 69, 89, 116, 126 (`runId`). План называет 2 (`:68`, `:89`) — строки верны, ожидаемый вывод неполон.
- `STALE_FENCE` на `packages/execution/src/service.ts:413` — точное совпадение (тот же код в `errors.ts:7` в комментарии).
- `attempt_worktree` сейчас не существует (grep по `packages/**` = 0), но создаётся миграцией v7 в E-04 (`:222`) — тест (г) опирается на артефакт более раннего шага, это не ошибка. Требование «ровно одна строка» при убийстве между `prepare` и `start` таймингово-хрупко ровно так, как сказано в рисках (`:341`).
- idempotent-контракт `agent-runtime.ts:87-96` — реальный `AgentResumeRequest` с докблоком «workspace and the scope are re-asserted rather than assumed» (`:83-85`), но ни `scope`, ни `workspacePath` не названы «идемпотентными»; формулировка плана сильнее контракта.
- Ограничение поверхности: `AgentResumeRequest` живёт в контракте, но `core/tools/src/index.ts:736` **как написан не существует** — в чек-ауте DSH есть только `packages\core\tools\src\index.ts`, где `:736` = `readonly restrictions = new AnonymousEntries<CompiledToolRestriction>()` (in-memory слой `ToolLayer`), что подтверждает «процесс-локально, не в логе сессии». E-39 в шаге 0 использует полный путь (`:799`) — расхождение формы записи внутри одного файла.
- `tests/claim-saga.test.mjs` существует ✓, `pass 5` = пяти описанным тестам ✓.

## E-12 · Worker не финализирует Done — ЧАСТИЧНО (см. finding 6)
- Шаг 0: строки `:23` (`'awaiting-review'`), `:29` (`'integrating'`), `:31` (`'done'`) — все верны, но команда возвращает **7** строк: ещё 52, 55, 56 (`TASK_STATES`) и 66 (`TASK_TERMINAL_STATES`), т.е. «совпадения на :23, :29, :31» неполно.
- Карта (`:114`) объявляет зависимость `E-08, E-25`, тело (`:344`) — только `E-08`.
- Гейт `Select-String -Path packages/execution/src/worker.ts -Pattern "'done'"` → 0 совпадений — выполним только после E-08; `tests/authority.test.mjs` существует ✓.

## E-13 · Контракт GateSpec/GateResult — ЧАСТИЧНО (см. findings 2, 5)
- Шаг 0 выполняется дословно: `Select-String -Pattern "gate-result|'gate-decision'"` по `artifact.ts` → только `:59`, `:74`; `gate-result` — 0 совпадений. Словарь закрыт (`ArtifactKind` `:31-59`, `ARTIFACT_KINDS` `:62-75`, валидация по нему — `packages/evidence/src/metadata.ts:249,283`).
- Сборка: `Push-Location packages/contracts; node ../../node_modules/tsdown/dist/run.mjs` — путь и bin tsdown существуют, `tsdown.config.ts` у контрактов есть. `tests/evidence.test.mjs` существует ✓.
- **Ложная посылка:** «в этом файле словарь [видов артефактов] уже пиннится» — `ARTIFACT_KINDS` не встречается ни в одном тесте (grep по `tests/` = 0); в `tests/evidence.test.mjs:408` пиннится `AUDIT_EVENT_TYPES.length === 16`, `:149-171` — журнал миграций и триггеры. Отчёт `MW-012-attempt-saga.md:218` говорит про «пиннинги словарей» в `events.test.mjs`/`evidence.test.mjs` — это словарь событий аудита, а не виды артефактов. Добавление `'gate-result'` не требует правки `evidence.test.mjs`; «иначе падает чужая сюита» (`:378`) не подтверждается.
- Пересечение с Q-22 (`23-STEPS-quality.md:436-447`): тот же закрытый словарь, +3 вида, гейт ждёт «15 значений» (`:446`), факты — «12 значений» (`:439`). При порядке E-13 → Q-22 выйдет 16, а «порядок сравнивается с зафиксированным списком» (`:372`) сломается, если Q-22 вставит виды не в конец.

## E-14 · Раннер гейтов — ЧАСТИЧНО (см. finding 7)
- `packages/gate-runner` и `packages/worktree-adapter` не существуют → «Create» верен, альтернатива «в worktree-adapter» возможна только после E-03.
- Гейт-команды выполнимы: `node ../../node_modules/tsdown/dist/run.mjs` (bin tsdown), `node --test --test-isolation=none "tests/gates-runner.test.mjs"`, `"tests/boundaries.test.mjs"` (есть, сканер перечисляет пакеты явно: `:188-192`, `:484-488`).
- Не проверено (нельзя запускать сборку): соберётся ли **новый** пакет без `pnpm install` — у `packages/scheduler` (с `workspace:*`-зависимостями) нет `node_modules`, но `lib/index.js` собран → разрешение идёт через `paths` из `tsconfig.base.json:29-39`, а не через pnpm-ссылки; для gate-runner это означает, что `@dsh-mywork/contracts` резолвится, но `tsdown.config.ts` обязан инлайнить workspace-слои (как `packages/scheduler/tsdown.config.ts`, `alwaysBundle`).

## E-15 · Пиннинг exact head — ПОДТВЕРЖДЕНО с оговоркой
- `runner.ts` создаётся в E-14, тест Create — нет на диске ✓; 4 теста = `pass 4` ✓; `readHead` действительно заложен в E-03 (`:205`, `adapter.ts`: `readHead = git -C <path> rev-parse HEAD`), но в списке файлов E-15 (`:397`) нет зависимости gate-runner → worktree-adapter (импорт + бандлинг), т.е. переиспользование «существующей функции» потребует правок вне списка.

## E-16 · Набор гейтов — ЧАСТИЧНО (см. finding 8)
- Шаг 0 выполним: `packages/contracts/src/config.ts` содержит 10 объявлений типов (17, 36, 70, 90, 131, 139, 150, 167, 182, 195). Существующий корень — `ResolvedWorkspaceConfig` (`:195`), резолвер — `packages/core/src/config.ts:121`.
- Но `gates`-поля в корне нет, `CONFIG_DOMAINS` — закрытый список из 6 (`:105-112`), а список файлов шага — только `policy.ts`, `verification.ts`, тест. Якорь authority `taskgraph.ts:9-14` точен (task graph owns completion, MyWork — attempt/lease/review).

## E-17 · Гейты блокируют review admission — ЧАСТИЧНО (см. finding 1)
- `packages/core/src/review.ts:39-49` — матрица `REVIEW_TRANSITIONS` (39-48) + `:51 REVIEW_STATES_REQUIRING_FINDINGS`; цитата «:39-49» верна. `worker.ts` — из E-08, `review-queue.ts` — из E-19 ✓. 5 тестов = `pass 5` ✓.
- Блокер: E-19 принадлежит MW-024, а `.work/tasks/MW-024.md:4` зависит от MW-023 и `:13` требует остановиться с BLOCKED, если MW-023 не принят; `MW-023.md:4` зависит от MW-022. Критический путь `21-STEPS-execution.md:155` тоже ставит E-17 **перед** E-19. Оговорка в рисках (`:433`) «выполняется последним в группе C» не снимает карточную зависимость.

## E-18 · Детерминизм и часы — ПОДТВЕРЖДЕНО
- `ClockPort` = `packages/contracts/src/index.ts:56` (точное совпадение); `packages/scheduler/src/service.ts` даёт 4 совпадения `clock.now|ClockPort` — `:29`, `:129`, `:191`, `:312` ✓; D11 = «Инъецированные часы … убить `Date.now()`» (`10-DECISIONS.md:64`) ✓; 4 теста = `pass 4` ✓, регрессия `tests/gates-runner.test.mjs` создаётся в E-14 ✓.

## Вердикты
E-10 ПОДТВЕРЖДЕНО · E-11 ЧАСТИЧНО · E-12 ЧАСТИЧНО · E-13 ЧАСТИЧНО · E-14 ЧАСТИЧНО · E-15 ПОДТВЕРЖДЕНО (оговорка в тексте) · E-16 ЧАСТИЧНО · E-17 ЧАСТИЧНО · E-18 ПОДТВЕРЖДЕНО.
НЕ_ПРОВЕРЕНО: сборка нового пакета без `pnpm install` (запрещено условием) — влияет на гейт E-14 «✔ Build complete».
