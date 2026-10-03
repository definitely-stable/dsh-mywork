# MW-012 — Реализовать claim saga, Attempts, leases и fences

- Карточка: `.work/tasks/MW-012.md` (Board ID `428eb852-5339-4101-be6b-18d447abe313`)
- Этап: 01-runtime. Обязательный пункт §62: **13** (Attempts/leases/fences)
- Разделы архитектуры: §9 (строка 440), §17 (933), §18.2 (993), §48 (2409), §49 (2421)
- Base SHA: `f22dbc3b2eb97601e09fc4f341bcddd522544545`. Head SHA: `5d7b80d1e602ac9fddce1e2372a6349d13af57ab`.
- **Коммиты выполнены по отдельному поручению владельца** (см. §12). Серия из шести коммитов, по одному на слой; работа MW-011 вынесена в отдельный коммит, потому что её файлы физически переплетены с моими в общих barrel-файлах, а её состояние — это ровно тот baseline, на котором карточка начиналась. Push/merge/publish/release не выполнялись.
- Статус: **DONE** — статус переведён из `READY_FOR_REVIEW` в `DONE` по прямому указанию владельца (сессия MW-020, «поменять все карточки с подобной оговоркой»). Акт приёмки — это указание владельца, а не вывод автора. Реализовано; независимое ревью проведено (**PASS WITH FINDINGS**, 2 MAJOR + 3 MINOR + 5 NIT), все десять находок закрыты в рабочем дереве, каждая с регрессионным тестом. См. §11 и `.work/reports/MW-012-review.md`. Приёмка не отменяет §8: исправления после ревью отдельного независимого прохода не проходили.

## 0. Как читать этот отчёт

Числа воспроизводимы: §5 даёт команды и exit codes, §6 — evidence, §10 — точный порядок повторного прогона. Всё, что заявлено как «проверено», проверено командой в этом отчёте; всё, что не проверялось, названо в §8 явно.

## 1. Проверка зависимостей

| Зависимость | Как проверено | Результат |
|---|---|---|
| **MW-009** (Controller lease, epoch, lifecycle) | отчёт `reports/MW-009-controller-lease.md` (`READY_FOR_REVIEW`; независимое ревью **PASS WITH FINDINGS**, все три находки исправлены); исходники `packages/lease/src` (5 файлов), `packages/contracts/src/lease.ts`; **живой прогон** полного конвейера на baseline = exit 0, 371 / 348 pass / 0 fail | предусловие пройдено **с оговоркой** |
| **MW-010** (Beads TaskGraph adapter) | отчёт `reports/MW-010-beads-adapter.md` (**DONE** — статус переведён из `READY_FOR_REVIEW` по решению владельца); исходники `packages/beads-adapter/src/*`, `packages/contracts/src/taskgraph.ts`; суита адаптера в итоговом прогоне = 47 pass / 0 fail / 23 skip | предусловие пройдено |
| **MW-011** (Plan mutations) | отчёт `reports/MW-011-plan-mutations.md` (`READY_FOR_REVIEW`); шесть независимых проходов; исходники `packages/planner/src` (5 файлов, `service.ts` 73 874 байт), `packages/core/src/{plan,blocker,graph}.ts`; суита `tests/plan-mutation.test.mjs` в прогоне = 71 pass / 0 fail | предусловие пройдено **с оговоркой** |

### Оговорка, названная явно

1. **Формальной приёмки владельца у MW-009 и MW-011 нет** — оба отчёта в `READY_FOR_REVIEW`. Работа продолжена по проверенным артефактам (исходники + независимые ревью + зелёный конвейер), а не по колонке доски. Это решение владельца, принятое в этой сессии (§2), и оно соответствует прецеденту MW-009 (на MW-008) и MW-011 (на MW-009).
2. **Открытые находки MW-011 остаются открытыми и в объём MW-012 не входят:** MINOR-12 (пауза admission в общем `lease`), остаток MINOR-10 (ребро между двумя существующими задачами: журнал не хранит «до»), §9 п.4 (тупик принятых id без чтения `externalRef`), а также независимая проверка одиннадцати исправлений пятого прохода (§9 п.5 отчёта MW-011). Ни одна из них не касается claim/attempt/lease/fence; MW-012 их не «чинит» и не маскирует.
3. **Ловушка «файл отчёта есть — значит сделано» проверена.** Gate проверялся по исходникам, по прогону и по независимым вердиктам, а не по наличию файла.

## 2. Решения владельца, принятые в этой сессии

| Вопрос | Решение | Как отражено |
|---|---|---|
| Гейт зависимостей при `READY_FOR_REVIEW` у MW-009/MW-011 | **A — продолжить с оговоркой** | §1 выше: оговорка названа явно, открытые находки перечислены |
| Грязное дерево и слоение | **A — аддитивно дописать экспорт** | в `contracts/src/index.ts`, `core/src/index.ts`, `tests/lib/fixtures.mjs` добавлены только строки (§7.2) |
| Дефект `reconcileClaim` (см. §3) | **B — починить MW-010 внутри MW-012** | `Task.assignee` добавлен в контракт, `toTask` его проставляет, решение вынесено в `core` (§3) |

## 3. Дефект зависимости, найденный и закрытый по решению владельца

`packages/beads-adapter/src/reconcile.ts` определял владельца claim через `task.assignee`, но:

- контракт `Task` (`packages/contracts/src/task.ts`) поля `assignee` **не имел**;
- `toTask()` (`packages/beads-adapter/src/adapter.ts:269`) его **не проставлял**.

**Проба до правки** (exit 0): `reconcileClaim({ taskId:'T-1', operationId:'op-1', claimant:'worker-1', attemptExists:true, task:{id:'T-1',...} })` → `revoke-claim`, reason `the claim moved to "nobody"`. То есть на реальной форме задачи holder был невидим **всегда**, и §49 «Attempt есть, Agent не существует» неразрешим: реконсилер не мог отличить живую попытку от потерянной.

**Правка (минимальная, аддитивная):**

| Файл | Что сделано |
|---|---|
| `packages/contracts/src/task.ts` | добавлено `readonly assignee?: string` — «identity the Task Graph records as holding the task», authority `task-graph` (§8) |
| `packages/beads-adapter/src/adapter.ts:280` | `toTask` проставляет `assignee` через тот же нормализующий разбор, что и `currentAssignee` (пустая строка → отсутствие поля) |
| `packages/core/src/task.ts:290` | `applyTaskTransition` **сохраняет** `assignee` рядом с `epicId`/`priority` |
| `packages/core/src/claim.ts` (новый) | чистая функция `reconcileClaim` + `assigneeOf` + `isClaimReconciliationSettled` переехали в доменный слой |
| `packages/beads-adapter/src/reconcile.ts` | решение **реэкспортируется** из `@dsh-mywork/core` вместо второй приватной копии (−84/+13) |

**Почему решение переехало, а не было продублировано:** его применяет и сага (`@dsh-mywork/execution`), и адаптер. Две копии одной правила разошлись бы, и разошлась бы именно та, что отзывает живую попытку.

**Уточнение к моей же первой оценке.** В плане я записал, что `TaskGraphClaimRef` «объявлен, но не экспортируется». Это **неверно**: тип экспортируется из `packages/contracts/src/index.ts` (виден в `lib/index.d.ts:2340`); мой runtime-пробник не мог его увидеть, потому что это тип, а не значение. Отдельной правки не потребовалось, и в §7.1 его нет.

## 4. Сделано

### 4.1 `@dsh-mywork/execution` — новый пакет (слой выше kernel)

Скаффолд скопирован с `packages/planner/` (`alwaysBundle` для contracts/core/evidence; `@dsh-mywork/storage` — type-only импорт, поэтому бандл самодостаточен).

| Файл | Строк | Что содержит |
|---|---|---|
| `src/schema.ts` | 5 865 б | миграция **version 6**, `name: 'claim-saga'`; таблицы `claim_intent`, `claim_step`, `attempt`, `task_fence` + два инварианта в базе |
| `src/store.ts` | 18 195 б / 478 строк | CAS-переходы интента, журнал шагов, аллокатор fence, вставка/заселение попытки, `assertClaimSchema` |
| `src/service.ts` | 43 775 б / 1080 строк | `createClaimSaga`: `claim`, `settle`, `recover`, `revoke` + чтения |
| `src/errors.ts` | 2 690 б | типизированные отказы слоя (`ExecutionError`, структурная проверка) |
| `src/index.ts` | 2 324 б | публичная поверхность пакета |

**Два инварианта держит база, а не код:**

```sql
-- Приёмка 3: у Task не более одного authoritative execution lease.
CREATE UNIQUE INDEX attempt_task_live_lease ON attempt (task_id) WHERE settled_at IS NULL;

-- §17: fence никогда не идёт назад.
CREATE TRIGGER task_fence_monotonic BEFORE UPDATE ON task_fence
WHEN NEW.fence < OLD.fence BEGIN SELECT RAISE(ABORT, 'mywork.execution.fence-not-monotonic'); END;
```

**Порядок `claim` (§9:456-461), durable на каждом шаге:**

1. **Intent** — отдельный коммит: строка `claim_intent` (`recorded`) + журнал шагов + outbox `claim.intent.recorded`. Граф ещё не тронут.
2. **Graph claim** — `graph.claim(...)`. `won: false` → `abandoned` + `TASK_CONFLICT` с именем holder. Проигрыш гонки — обычный исход, не ошибка (§9).
3. **Attempt + Lease** — один коммит: `allocateFence` → `insertAttempt` → `attempted`. Живая попытка того же Task переводится в `stale` (решение принял backend, выигравший claim), затем уникальный индекс не даёт двум живым lease сосуществовать.
4. **Projection** — `transition(→ assigned)` с `expectedRevision` + `expectedAssignee`. Отказ графа **не** откатывает attempt: §49 «Task Board недоступен» → execution продолжается, проекция degraded (`state: 'attempted'`, `projectionDegraded: true`).
5. **Completed** — `completed` + outbox `claim.completed` с `operationId`.

**Авторитетные callback-и** (`settle`) проверяют три оси, и порядок существенен:

- **fence сравнивается с текущим токеном *задачи*, а не с копией в самой попытке.** Попытка, которую superseded, продолжает нести свой старый fence, поэтому сравнение с её собственной копией пропустило бы ровно тот поздний результат, ради которого §17 существует.
- затем epoch (`assertControllerEpoch` → `LEASE_LOST`), затем fence попытки (`assertFence` → `STALE_FENCE`).
- revision проверяется **только для живой** попытки: уже заселившаяся попытка сдвинула revision собственным заселением, поэтому повтор — это то же самое событие, пришедшее дважды, и он отвечает записанным исходом, а не отказом.

**`recover` / `revoke` (§49):**

| Наблюдение | Действие |
|---|---|
| intent открыт, граф держит **этого** claimant | `create-attempt` → шаги 3-5 (тот же код, что и happy path) |
| intent открыт, граф держит **другого** | `revoke-claim` → попытка `revoked`, lease снят |
| intent открыт, граф не держит никого | `abandon-intent` (не `revoke`: отзывать нечего) |
| граф **нечитаем** | **ничего не решается**, intent остаётся открытым (`recovering`) |
| контроллер умер, epoch вырос | отзыв попыток старого epoch разрешён |

### 4.2 `@dsh-mywork/contracts`

- `src/claim.ts` (новый, 12 267 б / 335 строк): `ClaimIntentState` + `CLAIM_INTENT_STATES`/`_TERMINAL_STATES`/`_OPEN_STATES`, `ClaimStepKind`/`ClaimStepState`/`ClaimStep`, `ClaimIntent`, `ClaimCommand`, `AttemptAuthority`, `AttemptSettlementCommand`, `AttemptRecord`, `ClaimReconciliation`/`Action`, `ClaimRecoveryAction`/`Request`, `ClaimOutcome`, `CLAIM_EXTERNAL_REF_PREFIX`, `MAX_CLAIMANT_LENGTH`.
- `src/events.ts`: +5 типов (`claim.intent.recorded`, `attempt.lease.granted`, `claim.completed`, `claim.recovered`, `attempt.lease.revoked`). `granted` добавлен после ревью (F5): выдача lease — не отзыв, и проекция MW-047 не должна прочитать одно как другое.
- `src/audit.ts`: +2 типа (`claim.recorded`, `claim.recovered`).
- `src/task.ts`: `assignee` (§3). `src/index.ts`: `export * from './claim.ts'`.

### 4.3 `@dsh-mywork/core`

- `src/claim.ts` (новый): `reconcileClaim`, `assigneeOf` — чистые функции, без записи. Решение о нечитаемом графе — отдельное действие `undecided` (после ревью, F9): `complete` означало бы «сага разрешена» там, где ничего не наблюдалось.
- `src/task.ts`: `applyTaskTransition` сохраняет `assignee`.
- `src/index.ts`: +4 строки экспорта (аддитивно).

### 4.4 `@dsh-mywork/beads-adapter`

- `src/adapter.ts`: `toTask` проставляет `assignee`.
- `src/reconcile.ts`: решение реэкспортируется из core (−84/+13); поведение `resolveOutagePolicy` и `canResumeCursor` не тронуто.

## 5. Команды и exit codes

| Команда | Exit | Наблюдение |
|---|---|---|
| `git rev-parse HEAD`, `git status --short` (старт) | 0 | `f22dbc3…`; дерево грязное работой MW-011 (незакоммичено) |
| `node --test --test-isolation=none "tests/**/*.test.mjs"` **до правок** | 0 | baseline **371 tests / 348 pass / 0 fail / 23 skip** |
| `node --test --test-isolation=none tests/attempt.test.mjs` (до правок) | 0 | 12 pass / 0 fail |
| `pnpm run typecheck` (после каждого слоя) | 0 | строгий `tsc` по 10 пакетам; по пути пойманы 3 реальные ошибки типов (неиспользуемые импорты, `unknown` из структурного каста) |
| `pnpm install` | 0 | **11 workspace-проектов** (было 10), `Lockfile passes supply-chain policies (69 entries)` |
| `pnpm run build` | 0 | собираются 11 проектов, включая новый `packages/execution` |
| `node --test --test-isolation=none .tmp/mw012-smoke.test.mjs` | 0 | узкая проверка схемы: миграция применяется, оба инварианта держат |
| `node --test --test-isolation=none tests/claim-saga.test.mjs` | 0 | **32 pass / 0 fail** (26 до ревью + 6 регрессионных на находки) |
| `node --test --test-isolation=none tests/{attempt,task,beads-adapter,events,boundaries}.test.mjs` | 0 | **128 tests / 105 pass / 0 fail / 23 skip** — регрессия |
| `node --test --test-isolation=none tests/beads-adapter.test.mjs` | 0 | **70 tests / 47 pass / 0 fail / 23 skip** |
| `pwsh -NoProfile -File .tmp/mw012-mutations.ps1` | 0 | **12/12 CAUGHT**, `RESTORE OK` |
| `pnpm run check` **итог** | **0** | smoke `all steps passed`, **410 tests / 387 pass / 0 fail / 23 skip** |

**Замечание о числах.** Ревьюер (F10) верно указал, что первая редакция этого отчёта несла устаревшие цифры: суита адаптера была замерена до добавления трёх тестов §6.3, а размер бандла был указан в kB, которых сборка не сообщает. Числа выше сняты после всех правок; историческая строка baseline (371/348) воспроизводима только на дереве до правок и помечена как таковая.

## 6. Evidence

### 6.1 Итоговый конвейер

```
✓ Lockfile passes supply-chain policies (69 entries)
smoke: all steps passed
ℹ tests 410   ℹ pass 387   ℹ fail 0   ℹ skipped 23
```

### 6.2 Приёмка карточки: пункт → проверка

| Критерий | Как доказано |
|---|---|
| **Fault injection после каждого шага claim не приводит к двойному execution** | (а) отказ на шаге 2 с потерянным ответом: граф claim записал, MyWork — нет; `recover` создаёт попытку ровно один раз, повторный `recover` не добавляет второй (`COUNT(*) FROM attempt` = 1). (б) отказ на шаге 4 (board down): сага остаётся `attempted` с живым lease, повторный `claim` отказывает `claim-unfinished`, `attempt` по-прежнему одна строка. (в) **реальная смерть процесса** (exit 7) в окне 1→2 и 2→3: после переоткрытия БД intent виден, `attempt` = 0, `recover` доводит до `completed` с одним attempt. (г) окно **4→5** (проекция легла, completion не записан) доводится `recover` без повторного `transition`, включая случай «задача уже `assigned` тому же worker'у». (д) сага, оставленная в `projected` или `recovering`, доводится, а не висит открытой. (е) проигранный claim не создаёт ничего. |
| **Late result старой попытки отклонён** | A1 (fence 1) superseded попыткой A2 (fence 2); `settle` от A1 → `STALE_FENCE`, `details.actual = 2`; состояние не изменилось (`attemptOf('T-1')` = A2, `leased`); A1 в терминальном `stale`. Отдельно: верный fence + устаревшая revision → `STALE_REVISION`; верный fence + старый epoch → `LEASE_LOST`. |
| **У Task не более одного authoritative execution lease** | Вставка **в обход сервиса**, прямо в БД, второго живого attempt → `ExecutionError` `conflict` / `task-already-leased`. Отдельно проверено, что индекс реален: `sqlite_master.sql` совпадает с `WHERE settled_at IS NULL`. Заселённая попытка освобождает слот. **Уточнение после ревью:** инвариант говорит «не более одного lease на Task», и он же означает, что lease может принадлежать **другой** саге — поэтому ни `recover`, ни `revoke` не смеют его трогать: устаревшая сага закрывает свой intent, не касаясь чужого (`recovery never revokes another saga's live lease`, `an explicit revoke never reaches another saga's live lease`). |

### 6.3 Mutation-батарея: 12/12 CAUGHT

Каждая мутация ломает одну защиту, пакет пересобирается, запускается узкая суита. Мутация, не давшая падения, — дефект тестов, а не «прошло». Итоговый прогон:

| # | Мутация | Файл | Результат |
|---|---|---|---|
| M1 | `attempt_task_live_lease` теряет `WHERE settled_at IS NULL` | `execution/src/schema.ts` | **CAUGHT** — 91 pass / **4 fail** |
| M2 | триггер монотонности fence выхолощен (`WHEN 0`, имя сохранено) | `execution/src/schema.ts` | **CAUGHT** — 94 / **1** |
| M3 | fence сравнивается с копией попытки, а не с токеном задачи | `execution/src/service.ts` | **CAUGHT** — 94 / **1** |
| M4 | epoch не проверяется при заселении | `execution/src/service.ts` | **CAUGHT** — 94 / **1** |
| M5 | проигранный claim трактуется как успех | `execution/src/service.ts` | **CAUGHT** — 93 / **2** |
| M6 | аллокатор fence перестаёт наращивать токен | `execution/src/store.ts` | **CAUGHT** — 93 / **2** |
| M7 | `toTask` снова теряет `assignee` | `beads-adapter/src/adapter.ts` | **CAUGHT** — 94 / **1** |
| M8 | переход задачи теряет `assignee` | `core/src/task.ts` | **CAUGHT** — 94 / **1** |
| M9 | проекция не идемпотентна (безусловный `transition`) | `execution/src/service.ts` | **CAUGHT** — 94 / **1** |
| M10 | `recover` читает попытку по задаче, а не по своей саге (**F1**) | `execution/src/service.ts` | **CAUGHT** — 94 / **1** |
| M11 | шаг проекции перестаёт писаться своим состоянием (**F2/F8**) | `execution/src/service.ts` | **CAUGHT** — 74 / **21** |
| M12 | `revoke` читает попытку по задаче, а не по своей саге | `execution/src/service.ts` | **CAUGHT** — 94 / **1** |

**Батарея дважды нашла реальные пробелы в покрытии** — это ровно то, ради чего она запускается:

- В первом прогоне **M7 и M8 дали MISSED**: правка §3 не имела ни одного теста, который проходил бы через настоящий `adapter.get()`. Существующие тесты `reconcileClaim` подавали голый объект `{ id, assignee }` — то есть проверяли функцию на входе, которого адаптер не производил, и дефект оставался невидимым. Добавлены три теста (`the holder survives the adapter read…`, `a task nobody claimed carries no assignee…`, `the holder the graph recorded survives a transition`).
- В прогоне после ревью **M9 дала MISSED**: идемпотентность проекции в `attemptAndComplete` не была достижима ни одним тестом, потому что все мои сценарии окна 4→5 шли через ветку `recover`. Добавлен тест `a claim for a task the graph already shows as assigned does not degrade the projection` — он поднимает сценарий, в котором задача уже `assigned` тому же worker'у (предыдущая попытка заселилась, не вернув задачу назад), и именно он ловит M9 адресно.

### 6.4 Восстановление доказано

`RESTORE OK exit=0 pass=32 fail=0` — после последней мутации бандлы пересобраны из нетронутых бэкапов, и узкая суита зелёная целиком.

Дополнительно проверено, что в дереве не осталось следов мутаций: `if (true) {` отсутствует, а оба чтения попытки в `recover` и `revoke` идут через `readSagaAttempt`, как и задумано.

**Найденная и закрытая ловушка процесса.** В одном из промежуточных прогонов батарея была убита по таймауту **между применением мутации и её откатом**, и оставила `packages/core/src/task.ts` мутированным (`...({{}})` вместо сохранения `assignee`). Следующий прогон снял бэкап уже с испорченного файла, из-за чего M8 в нём репортилась как `NOT-APPLIED`. Обнаружено сверкой SHA-256 с замороженным снимком, восстановлено из снимка, после чего в скрипт добавлен `trap`/`Register-EngineEvent`, гарантирующий откат при прерывании. Урок записан здесь, потому что это дефект инструмента, а не кода: батарея, которая может испортить дерево при прерывании, опаснее отсутствия батареи.

`git diff` по этим файлам показывает только мои намеренные изменения (8 вставок в `adapter.ts` и `task.ts`; `execution/*` — новый пакет). Мутационного мусора не осталось.

## 7. Изменённые и новые файлы

### 7.1 Новые

| Путь | Назначение |
|---|---|
| `packages/execution/` (package.json, tsconfig.json, tsdown.config.ts, `src/{index,errors,schema,store,service}.ts`) | пакет claim-саги |
| `packages/contracts/src/claim.ts` | лексика саги |
| `packages/core/src/claim.ts` | чистое решение реконсиляции |
| `tests/claim-saga.test.mjs` | 26 тестов карточки (899 строк) |
| `tests/lib/claim-crash-child.mjs` | дочерний процесс для краш-теста |
| `.tmp/mw012-smoke.test.mjs`, `.tmp/mw012-mutations.ps1`, `.tmp/mw012-mutation-results.txt` | узкая проверка и батарея (`.tmp/` в `.gitignore`) |

### 7.2 Изменённые мной (включая аддитивные правки общих грязных файлов)

| Путь | Характер |
|---|---|
| `packages/contracts/src/{task,events,audit}.ts` | аддитивно |
| `packages/contracts/src/index.ts` | **+1 строка** (грязный файл MW-011: строки `plan`/`workflow` не тронуты) |
| `packages/core/src/{task,index}.ts` | `task.ts` — 3 строки; `index.ts` — **+4 строки** экспорта (грязный файл MW-011) |
| `packages/beads-adapter/src/{adapter,reconcile}.ts` | `adapter.ts` — 5 строк; `reconcile.ts` был чистым до моей правки |
| `tests/{beads-adapter,task,events,evidence}.test.mjs` | новые тесты; в `events.test.mjs` и `evidence.test.mjs` обновлены пиннинги словарей |
| `tests/lib/fixtures.mjs` | **+2 блока** (грязный файл MW-011) |
| `tsconfig.base.json` | **+1 строка** `paths` |
| `pnpm-lock.yaml` | дописан `pnpm install` (11-й проект) |

**Чужая незавершённая работа MW-011 сохранена.** Правки в общие грязные файлы — только добавленные строки; ни одна существующая строка MW-011 не изменена и не удалена. Изменения `reconcile.ts` — мои (файл был чистым).

## 8. Ограничения и что осталось непроверенным

1. **Живой `bd` не использовался.** Сага проверена на детерминированном fake-порте; контракт адаптера — его собственной суитой (49 pass / 23 skip) и тремя новыми тестами на `assignee`. Поведение на настоящем Beads опирается на MW-010, а не на новый прогон. `tests/beads-adapter.test.mjs` содержит 23 skip там, где нужен реальный `bd`.
   **Названный ревьюером риск интеграции:** неизвестно, бампает ли `bd update --claim` поле `revision`. Если да, шаг 4 с `expectedRevision = baseRevision` (снятым **до** claim) будет устаревать на happy path. Фейк суиты revision при claim не двигает, поэтому для тестов это невидимо; проверяется только живым `bd`.
2. **Гонка двух процессов на одной SQLite-БД не воспроизводилась.** CAS по состоянию строки закрывает перекрытие внутри одного процесса (проверено и мной, и ревьюером: второй `recover` не создаёт ни второй попытки, ни порчи); межпроцессную гонку закрывает уникальный индекс + `BEGIN IMMEDIATE` (свойство storage, проверено его собственной суитой). Утверждается именно это, а не «гонка двух процессов проверена».
3. **Истечение lease не проверяется при `settle`.** `leaseExpiresAt` записывается и читается, но просроченный lease не отвергает заселение: политика истечения и переприобретения — это scheduler/reconciler (MW-014), и §49 отвечает на «Controller умер» через смену epoch, а не через часы. Названо как ограничение, а не как незамеченный пробел.
4. **Retry/backoff не реализованы** — вне объёма (MW-014).
5. **Cordis-строка не добавлена.** Пакет не монтируется в профиль: каноническую композицию миграций закрепляет MW-028. Живой профиль DSH не тронут.
6. **Открытые находки MW-011 остаются открытыми** (§1.2). MW-012 их не касается.
7. **Отклонённый поздний результат не оставляет audit-строки.** В плане (§4.2) я записал, что отклонение пишет audit и артефакт. Реализация **не** пишет: отказ возвращается как `Result` до любой записи. Это осознанное упрощение — писать audit на каждый отказ значит дать неавторизованному вызывающему писать в append-only журнал, — но оно расходится с планом, поэтому названо здесь, а не умолчано.
8. **Неточность имени в `tests/events.test.mjs`.** Мои пять типов событий добавлены в список `DECLARED_BUT_NOT_YET_PRODUCED`, хотя они **производятся** — пакетом `execution`. Имя списка унаследовано и означает «не производятся чистыми переходами, которые проверяет эта суита»; я добавил поясняющий комментарий на месте, но само имя осталось прежним, чтобы не расширять диффу чужого теста. Проверка на исчерпываемость словаря от этого не страдает (она сравнивает объединение двух списков), но имя вводит в заблуждение и его стоит переименовать в отдельной правке.
9. **Один guard остаётся непокрытым.** Мутация ревьюера R2 (обнуление `assertFence(expectedFence, attempt.fence)`) даёт MISSED: суита не отличает эту защиту от её отсутствия. Она избыточна по отношению к проверке токена задачи (M3 её ловит), но это избыточность, а не покрытие. Названо честно, а не спрятано за зелёным прогоном.
10. **Исправления после ревью не проходили отдельный независимый проход.** F1–F10 закрыты моими тестами и мутациями (11/11, затем 12/12 CAUGHT), но независимая проверка исправлений — это следующий шаг, а не выполненный факт. Ревьюер сам рекомендовал закрыть F1 и F2 до того, как MW-014 начнёт звать `recover` в цикле.
11. **Версия схемы не поднималась при добавлении `agent_id`/`lease_ms`.** Обе колонки добавлены в миграцию v6, а не в новую v7: v6 — часть этой же, ещё не принятой карточки, и баз с ней в обращении нет. Если к моменту приёмки появится база со схемой v6 «до правки», понадобится v7.
12. **В общем дереве работала параллельная сессия — это обнаружено и названо, а не умолчано.** На старте карточки дерево не содержало правок, кроме работы MW-011, и записей за последние минуты не было; ближе к концу сессии появились изменения, которые **не мои**: `.gitignore` (17:09, добавлены шаблоны `/*.rar`, `/*.zip`, `/*.7z`), `.analysis/report-window-1.md` и `.analysis/portfolio-v2-freeze.json` (17:16), `.dsh/skills/*/CHANGELOG.md` (17:16). Я их не трогал и **не откатывал** — они принадлежат другой сессии. Проверено, что путь зависимостей MW-012 не затронут: за последние 40 минут в `packages/` и `tests/` изменялись только мои собственные файлы, а все пять мутировавшихся исходников совпадают с замыслом (нет следа `if (true)`, `readSagaAttempt` на месте, `assignee` сохраняется). Числа §5–§6 сняты в этом дереве.
13. **Замороженный снимок оставлен намеренно.** `.tmp/mw012-review` — это detached worktree с артефактами ревьюера (`probe-*.mjs`, `review-mutation-*.txt`) и снимком, с которым сверялись SHA-256. Он в `.gitignore`, но зарегистрирован в `.git/worktrees`; чтобы убрать его, нужен `git worktree remove .tmp/mw012-review`. Оставлен как evidence, а не как мусор.
8. **`fence` и `attempt` живут в `controller.sqlite`** рядом с plan-mutation. Обоснование: state change, audit, artifact и outbox обязаны коммититься вместе (§48). Альтернатива (отдельная БД) отвергнута по этой причине; окончательную композицию закрепляет MW-028.
9. **Ничего вне карточки не тронуто**: живой профиль DSH, доска разработки, `.beads/`, `status.custom`, чужие проекты, файлы незавершённой работы MW-011. Платные LLM-пробы и другая модель не запускались. Субагенты — только финальное независимое ревью (§11).
## 9. Отклонения от утверждённого плана (названы явно)

| План | Реализовано | Почему |
|---|---|---|
| `TaskGraphClaimRef` «не экспортируется», добавить экспорт | **не требовалось** — тип уже экспортирован | моя оценка в плане была неверной: пробник не видел тип, потому что это тип, а не значение |
| `reconcileClaim` переносится в core | перенесён, адаптер реэкспортирует | иначе две копии одного правила |
| `transitionAttempt` «расширяется» (§4.3) | не тронут | существующей машины Attempt достаточно; новый код не вводился |
| `claim` вызывает `graph.claim` с `expectedRevision` | **не передаёт** revision в порт | `bd update --claim` не принимает precondition (ADR023, `adapter.ts:474`); revision проверяется на шаге 4 через `graph.transition`, который его принимает |
| Артефакт саги: `kind: 'planner-dag'` | `kind: 'worker-report'` | `planner-dag` — вид планировщика; словарь видов закрыт в контрактах, тринадцатый не выдумывается |
| Отклонённый поздний результат пишет audit | не пишет | см. §8.7 |
| `settle` возвращает `state: 'recovered'` | возвращает **фактическое** состояние саги | заселение попытки не равно завершению claim; сообщить второе, когда случилось первое, значит завысить наблюдение |

## 10. Воспроизведение

```powershell
cd H:\Repo\DSH-MyWork
git rev-parse HEAD                      # f22dbc3b2eb97601e09fc4f341bcddd522544545

pnpm install                            # 11 workspace-проектов
pnpm run check                          # exit 0: 410 tests / 387 pass / 0 fail / 23 skip

# Узкая проверка карточки:
node --test --test-isolation=none tests/claim-saga.test.mjs    # 32 pass / 0 fail

# Схема и её два инварианта:
node --test --test-isolation=none .tmp/mw012-smoke.test.mjs    # 1 pass / 0 fail

# Mutation-батарея (пересобирает пакеты; ~14 мин):
pwsh -NoProfile -File .tmp/mw012-mutations.ps1                 # 12/12 CAUGHT, RESTORE OK
```

**Замечание для будущих прогонов.** Скрипт батареи жёстко адресует `$repo = 'H:\Repo\DSH-MyWork'`, поэтому запускать его на снимке нельзя без перенаправления `$repo`/`$backup`/`$log` — ревьюер делал именно так. И батарею нельзя убивать: в промежуточном прогоне таймаут оставил мутацию применённой (см. §6.4). Откат теперь зарегистрирован на выход процесса, но `job_kill` его всё равно не выполняет — при прерывании сверяйте SHA-256 с `.tmp/mw012-review`.

**Приёмка по коду, а не по тестам:** `packages/execution/src/schema.ts` (оба инварианта, `attempt_task_live_lease`, `task_fence_monotonic`), `packages/execution/src/service.ts` (`claim` — пять шагов, `attemptAndComplete`, `assertOwnership` — порядок fence→epoch, `settle`, `recover`, `revoke`), `packages/execution/src/store.ts` (`allocateFence`, `settleAttempt`, `insertAttempt`), `packages/core/src/claim.ts` (`reconcileClaim`), `packages/core/src/task.ts` (сохранение `assignee`), `packages/beads-adapter/src/adapter.ts` (`toTask`).

**Границы для следующих карточек:** scheduler/pools — MW-014; DSH AgentRuntime — MW-015; worktree isolation — MW-021; steering активной попытки — MW-046 (потребляет `attemptOf`/`liveAttempts`); проекция доски — MW-047 (потребляет `openIntents`).

## 11. Независимое ревью и исправления

Проведено отдельным субагентом со свежим контекстом, read-only, по замороженному снимку (`.tmp/mw012-review` — detached worktree на базе с артефактами MW-011 и MW-012, проверен перед выдачей: exit 0, 400/377/0/23). Мандат — состязательная проверка: критерии приёмки по исходникам (а не через суиту, что их заявляет), попытка опровергнуть инвариант «≤1 lease» прямой вставкой в БД, собственные ломающие мутации против каждого fault-injection теста. Словарь `PASS` / `PASS WITH FINDINGS` / `FAIL`. Мои diff, рассуждения и переписка ревьюеру **не** передавались — отчёт был единственным проводом. Полный разбор — `.work/reports/MW-012-review.md`.

**Вердикт: PASS WITH FINDINGS** — все три критерия приёмки подтверждены независимыми пробами, но в таблице решений §49 найдены два MAJOR-дефекта, которых суита не видела.

| # | Severity | Что было не так | Чем закрыто |
|---|---|---|---|
| F1 | **MAJOR** | `recover` читал живую попытку **по задаче**, а не по своей саге, и это значение уходило в `reconcileClaim.attemptExists`. Проба ревьюера: сага S1 (superseded) отозвала **живой lease новой саги S2**; `live attempts = 0`, `settle` от S2 → `TASK_CONFLICT`, исход отдан под чужим `operationId`. §49 «attempt есть, агент не существует» применён к чужой здоровой попытке | `readSagaAttempt(operationId)`: `attemptExists` строится по своей саге, а живая попытка **другой** саги закрывает intent как `abandoned`, не касаясь lease. Тест `recovery never revokes another saga's live lease` |
| F2 | **MAJOR** | Окно §9 между шагом 4 и шагом 5 было неразрешимо: `recover` безусловно повторял `transition(→assigned)`, отказ вылетал **исключением** из API, обещающего `Result`. С реальным адаптером то же окно давало вечный `STALE_REVISION` | Найдено мной **независимо** пробой до получения ревью и уже исправлено к моменту вердикта: проекция идемпотентна по наблюдению, шаг 4 получил собственное состояние `projected`, `recover` доводит любой незавершённый state. Тесты `a crash between the projection and the completion is recoverable, not stuck`, `recovery finishes a saga left in projected, and one left in recovering` |
| F3 | MINOR | `recover` доводил сагу только из `attempted`; прочие открытые состояния возвращали `ok` и оставляли intent открытым навсегда | Ветка ключуется на «ещё не `completed`»; недостижимый остаток отвечает `claim-unfinishable` вместо `ok` |
| F4 | MINOR | `tests/boundaries.test.mjs` не знал про `packages/execution` — у нового пакета не было ни одной границ-проверки | Три проверки слоя (импорты, запрет продуктов/драйверов/чужих слоёв + манифест, самодостаточность бандла); проверено, что они **падают** при подмене и зеленеют после восстановления |
| F5 | MINOR | `attempt.lease.revoked` слался при **создании** попытки, хотя контракт описывает тип как «lease was taken away»; MW-047 прочитал бы выдачу lease как отзыв | Добавлен `attempt.lease.granted`; `revoked` остаётся только за отзывом |
| F6 | NIT | Восстановленная попытка получала синтетический `agentId = 'recovery:<decidedBy>'` и зашитый `leaseMs = 60_000` | `agentId` и `leaseMs` записываются в intent на шаге 1 и используются при восстановлении; сага без них отказывает `claim-agent-missing` |
| F7 | NIT | `settle` не валидировал `command.to` и `command.meta`: `to: 'leased'` записал бы `settled_at` на нетерминальное состояние и освободил lease-слот | Целевое состояние обязано быть терминальным; `meta` валидируется до чтения стора |
| F8 | NIT | Состояние `'projected'` было объявлено в контракте, CHECK и `listOpenIntents`, но не писалось нигде | Закрыто вместе с F2: шаг 4 имеет собственное наблюдаемое состояние |
| F9 | NIT | `reconcileClaim` при нечитаемом графе возвращал `action: 'complete'`, хотя `reason` говорил «ничего не решается»; экспортированный `isClaimReconciliationSettled('complete')` возвращал `true` | Введён отдельный `action: 'undecided'`; вводящий в заблуждение хелпер удалён как мёртвый код. Тест `an unreadable task resolves nothing rather than guessing` уточнён с вакуумного `notEqual` до точного `equal` |
| F10 | NIT | Устаревшие числа в отчёте (суита адаптера, регрессия, размер бандла) | Числа пересняты после всех правок; §5 несёт явное замечание |

**Сверх находок ревьюера**, по его же подсказке о классе дефекта F1, закрыт тот же дефект в `revoke`: он тоже читал попытку по задаче и мог отозвать чужой здоровый lease. Тест `an explicit revoke never reaches another saga's live lease`, мутация M12.

**Что ревьюер подтвердил как корректное:** инвариант «≤1 lease» держит база (подтверждено `sqlite_master`, `PRAGMA index_list` и сырым `INSERT`); late result отклоняется по токену задачи в правильном порядке; пути ко второй попытке после сбоя нет (одна функция `attemptAndComplete` на оба входа); нечитаемый граф не решает сагу; mutation-батарея честна (прогнана целиком, числа совпали, добавленные тесты существуют и не skipped); правка `assignee` согласована и не нарушает §8; вакуумных тестов не найдено.

**Непокрытое, оставшееся названным** (см. §8): проверка `assertFence(expectedFence, attempt.fence)` не отличается суитой от её отсутствия (мутация R2 ревьюера → MISSED); живой `bd` недоступен, поэтому неизвестно, бампает ли `bd update --claim` revision.

**Приёмка: DONE** — статус переведён из `READY_FOR_REVIEW` по прямому указанию владельца (сессия MW-020). Self-review приёмкой не считается, и вердикт ревьюера — тоже: это evidence, которое читает владелец. Исправления после ревью проверены моими тестами и мутациями, но **не** прошли отдельный независимый проход — это названное ограничение, и приёмка его не отменяет.

## 12. Коммиты

Выполнены по отдельному поручению владельца. Один коммит на слой, `type(scope): subject`, тело отвечает на «почему», трейлер `Cards: MW-0XX.` — по конвенции, снятой с истории (`git log --format=%B`).

| SHA | Коммит | Содержимое |
|---|---|---|
| `d0b0cbc` | `feat(planner): add the staged plan mutation and the derived blocker gate` | **работа MW-011** — 25 файлов: `packages/planner/`, `contracts/src/{plan,workflow}.ts`, `core/src/{plan,blocker}.ts`, barrel-файлы, `tests/plan-mutation.test.mjs` |
| `e3ae3fb` | `feat(contracts): add the claim saga vocabulary and the graph holder` | `contracts/src/{claim,task,events,audit,index}.ts` + **пиннинги словарей** `tests/events.test.mjs`, `tests/evidence.test.mjs` |
| `5cddd27` | `feat(core): add the claim reconciliation decision` | `core/src/{claim,task,index}.ts` |
| `0c56dd0` | `fix(beads-adapter): carry the claim holder through the adapter read` | `beads-adapter/src/{adapter,reconcile}.ts` |
| `d73b94e` | `feat(execution): add the claim saga, attempts, leases, and fences` | `packages/execution/` (8 файлов), `tsconfig.base.json`, `pnpm-lock.yaml` |
| `5d7b80d` | `test: cover the claim saga, the claim holder, and the execution boundaries` | `tests/claim-saga.test.mjs`, `tests/lib/claim-crash-child.mjs`, `fixtures.mjs`, `boundaries`, `beads-adapter`, `task` |

### История проверена на самосогласованность (измерена, а не заявлена)

Каждый коммит прогнан `pnpm run check` в **изолированном worktree** — не в общем дереве, где работает параллельная сессия и где checkout коммитов на месте разрушителен:

| Коммит | Вердикт | Тесты |
|---|---|---|
| `d0b0cbc` (MW-011) | **GREEN** | 371 / 348 / 0 / 23 |
| `e3ae3fb` | **GREEN** | 371 / 348 / 0 / 23 |
| `5cddd27` | **GREEN** | 371 / 348 / 0 / 23 |
| `0c56dd0` | **GREEN** | 371 / 348 / 0 / 23 |
| `d73b94e` | **GREEN** | 371 / 348 / 0 / 23 |
| `5d7b80d` | **GREEN** | **410 / 387 / 0 / 23** |

Числа 371 на коммитах 2–5 — не ошибка: новые тесты приходят последним коммитом (+39).

### Два дефекта в собственной серии коммитов, найденные и исправленные

**Первый: четыре из шести коммитов были красными.** Первая редакция серии отделяла объявление словарей (contracts) от их пиннинга (tests). Суита утверждает, что объявленный словарь событий и аудита **точно** равен произведённому множеству плюс список «объявлено, но ещё не производится»; объявление без пиннинга валило `every declared event type is produced by the domain` на коммитах 2–5, и `git bisect` указал бы на них ложно. Исправлено переносом обоих пиннингов в коммит contracts, серия пересобрана через `git reset --soft` и повторные коммиты, затем измерена заново (таблица выше).

**Второй: два способа случайно воздействовать на общее дерево.** Скрипт проверки сначала использовал `pnpm run check --dir <path>` — эта форма **не** перенаправляет pnpm: флаг дописывается в строку скрипта и достаётся самой внутренней команде, поэтому проверка шла в общем дереве и давала бессмысленные вердикты. Затем `git -C <path>`, где `<path>` оказался обычным каталогом (worktree не зарегистрировался), **поднялся вверх** до объемлющего репозитория и выполнил `checkout --detach` в **основном** дереве — из-за чего `main` оказался в detached HEAD. Оба случая закрыты: worktree теперь входится через `Push-Location`, а перед каждым checkout стоит проверка `rev-parse --show-toplevel`, отказывающаяся работать, если путь не зарегистрирован как worktree. Последствия проверены и устранены: коммиты не потеряны (`main` и HEAD указывали на один коммит), `.work/` и `.tmp/` целы, ветка возвращена через `git switch main`, дерево снова зелёное. Записано здесь потому, что это дефекты инструмента, а не кода.

### Почему MW-011 отдельным коммитом

Его файлы **физически переплетены** с моими в общих файлах: `contracts/src/{index,audit,events}.ts`, `core/src/index.ts`, `tests/lib/fixtures.mjs`, `tests/events.test.mjs`, `tests/evidence.test.mjs`, `pnpm-lock.yaml`. `tests/evidence.test.mjs` — показательный случай: он ассертит `AUDIT_EVENT_TYPES.length === 16`, а это 11 (§34) + 3 (типы MW-011) + 2 (мои), поэтому коммит только моего хунка не мог бы быть самосогласованным.

Порядок был такой: снять мои правки, **проверить восстановление** MW-011-состояния прогоном и закоммитить, затем вернуть моё и коммитить послойно. Проверка восстановления — не формальность: реконструированное состояние дало **ровно baseline 371 tests / 348 pass / 0 fail / 23 skip**, тот же, что измерялся в начале сессии. Совпадение до последней цифры и есть доказательство, что MW-011 выделен точно, а не «примерно».

### Что осталось незакоммиченным и почему

- `.gitignore` — **не моя правка**: она появилась в 17:09 от параллельной сессии (добавлены `/*.rar`, `/*.zip`, `/*.7z`). Я её не коммитил и не откатывал; она остаётся в рабочем дереве как чужая незавершённая работа. Побочный эффект её правки — `DSH-MyWork.rar` перестал показываться в `git status` (теперь игнорируется).
- `.work/` и `.tmp/` — по правилу репозитория исключены из Git; отчёты и артефакты ревью лежат там и в коммиты не входят.
- Push, merge, publish, release не выполнялись.
