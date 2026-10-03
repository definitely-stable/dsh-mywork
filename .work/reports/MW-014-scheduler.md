# MW-014 — Реализовать детерминированный Scheduler и pools

- Карточка: `.work/tasks/MW-014.md` (Board ID `fcffc0c3-f0df-42db-a07a-128fa9fd5dd5`)
- Этап: 01-runtime. Обязательные пункты §62: **5** (Own Team Work), **8** (Worker/Reviewer elastic pools), **12** (Event-driven Scheduler + reconciler)
- Разделы архитектуры: §14 (735), §15 (779), §16 (814), §27 (1851), §30 (1928)
- Base SHA: `3bc6c78a077174a9497488ed137082294b705a34` (HEAD на старте, дерево чистое). Head SHA: `02e864449b9060bcfb03232b9c9694be1bc62b12` — четыре коммита по слоям, выполнены **по отдельному поручению владельца** (§10). Push/merge/publish/release не выполнялись.
- Статус: **DONE** — работа завершена и закоммичена (§10); ревью-статус снят прямым поручением владельца («статус карточки изменить, и сделать коммиты»). Evidence приёмки — независимое ревью (**PASS WITH FINDINGS**: 2 MAJOR + 2 MINOR + 1 NIT, все находки разобраны и закрыты) и отдельный проход верификации фиксов (**FIXES PARTIALLY VERIFIED**, новых BLOCKER/MAJOR нет, обе его MINOR-находки N1/N2 исправлены). Детали: §8 и §9. Что осталось непроверенным, названо, а не скрыто: правки N1/N2 после второго прохода независимо не перепроверялись, третьего прохода не было (по правилу `evidence-gated-delivery` дельта-цепочка останавливается на проходе без BLOCKER/MAJOR), а финальный гейт прогнан на итоговом дереве, не на каждом промежуточном коммите. Приёмка владельцем как отдельный акт не фиксировалась: этот статус выставлен по его прямому указанию, а не выведен автором из self-review.

## 0. Как читать этот отчёт

§5 — команды и exit codes, §6 — evidence по каждому пункту приёмки, включая mutation-check собранных артефактов, §7 — принятые решения по объёму (названы, чтобы ревьюер мог их оспорить), §8 — что не проверено и что осталось за рамками. Числа воспроизводимы командами из §5.

## 1. Проверка зависимостей (MW-012, MW-013)

Проверялось по отчётам, по исходникам/git и живым прогоном, а не по колонке доски (`.work/README.md`).

| Зависимость | Отчёт | Исходники / git | Прогон | Результат |
|---|---|---|---|---|
| **MW-012** claim saga, attempts, leases, fences | `reports/MW-012-attempt-saga.md` (351 строка), статус **READY_FOR_REVIEW**; независимое ревью **PASS WITH FINDINGS** (2 MAJOR + 3 MINOR + 5 NIT), все 10 находок закрыты в дереве | `packages/execution/src` (5 файлов, mtime 2026-09-19 18:50); коммиты `d73b94e`, `5d7b80d` и серия вокруг них | baseline `pnpm run check` → exit 0 | предусловие пройдено **с оговоркой** |
| **MW-013** model routing и бюджетный admission | `reports/MW-013-routing-budget.md` (458 строк), статус **DONE** — ревью-статус снят решением владельца; Head SHA `3bc6c78` = текущий HEAD (7 коммитов) | `packages/core/src/{budget,routing}.ts`, `packages/contracts/src/{budget,routing,model-catalog}.ts`, `packages/controller/src/model-catalog.ts` (mtime 2026-09-19 21:42…22:47) | `pnpm run check` на старте → exit 0, **444 tests / 421 pass / 0 fail / 23 skipped** — совпадает с числом из отчёта MW-013 | предусловие пройдено |

**Оговорка, названная явно.** Формальной приёмки владельца у MW-012 нет: отчёт остаётся `READY_FOR_REVIEW`. Работа продолжена по тому же правилу и тому же прецеденту, что MW-012 на MW-009/MW-011 и MW-013 на MW-012: отчёт + исходники + коммиты + зелёный конвейер воспроизводимы, а MW-013 (зависимость, которая сама стоит на MW-012) переведён владельцем в `DONE`, то есть состояние дерева с работой MW-012 принято. Открытых находок, касающихся claim/attempt/lease/fence, в MW-012 не осталось.

**Чужая незавершённая работа не тронута.** На старте `git status --short` был пуст. Ни один файл другой карточки не редактировался: изменения MW-014 — только перечисленные в §3, все они либо новые, либо аддитивные строки в общих barrel/config-файлах.

## 2. Сделано

Разделение по слоям повторяет принятое в проекте: словарь — в `contracts`, детерминированная политика — в `core`, runtime с портами — в отдельном пакете.

### 2.1 `@dsh-mywork/contracts` — словарь §14/§15/§16/§27/§30

`packages/contracts/src/scheduler.ts` (новый, 546 строк):

- `ResourceState` + `RESOURCE_STATE_CHARGES` (§15): семь состояний и точная таблица того, какие счётчики каждое берёт. `idle`/`sleeping` не берут ничего; `model-active`/`tool-active` взаимоисключающие (состояние — либо вызов модели, либо тяжёлый инструмент, и заряд обоих сразу стоил бы одну попытку двух лимитов).
- `SchedulerEventType` + `SCHEDULER_EVENT_TYPES` — девять событий §16.2 дословно; `SchedulerKickSource` = `event` / `reconcile` / `startup` (§16.1, §16.2).
- `SchedulerLimits` (§15: `maxAttempts`, `maxConcurrentLlm`, `maxHeavyTools`) + `DEFAULT_SCHEDULER_LIMITS` (8/4/2 — пример §15), `WorkspaceSchedulingLimits` (§16.4), `SchedulerPolicy` + `DEFAULT_SCHEDULER_POLICY`.
- Наблюдение (`SchedulerTaskCandidate`, `SchedulerReviewCandidate`, `SchedulerInstanceObservation`, `SchedulerAgent`, `SchedulerWorkspaceState`), вход тика (`SchedulerTickInput`), выход (`SchedulerRank`, `SchedulerOccupancy`, `SchedulerAdmission`, `SchedulerDeferral`, `SchedulerPlan`) и закрытый `SchedulerSkipReason` (17 причин) + `SCHEDULER_SKIP_REASONS`. `SchedulerWorkspaceState.agentIds` — ростер identity workspace'а (§6.1, `Team.agentIds`), `agent-not-in-workspace` — отказ по нему (F2, §8); ростер валидируется как массив непустых строк, иначе `TypeError` (N1, §9).

Аддитивные правки: `PoolPolicyOverlay.workspaceScheduling` (§16.4 в существующем домене `pools`, +8 строк); `CatalogOutage`/`CatalogSnapshot` переехали из `core` в `contracts/model-catalog.ts` (+31) и реэкспортируются из `core/routing.ts` — публичная поверхность `@dsh-mywork/core` не изменилась.

### 2.2 `@dsh-mywork/core` — детерминированная политика

`packages/core/src/scheduler.ts` (новый, 758 строк):

| Функция | Что делает |
|---|---|
| `planSchedulerTick(input)` | §16.3 целиком: фильтр кандидатов ∩ §16.4-раунд распределения ∩ §14/§15 caps → `SchedulerPlan` (admissions + deferrals с причиной) |
| `countSchedulerOccupancy(instances, policy)` | §15-счётчики из наблюдаемых инстансов: active attempts, LLM, heavy tools, пулы, роли, workspace |
| `schedulerRank({priority, readySince, nowMs, agingStepMs})` | §16.3 priority + целые шаги aging; score = priority + agingBonus |
| `readRouteAvailability(policy, catalog)` | §29-доступность маршрута **по данным**: preferred → fallback, escalation не рассматривается (§62 п.7) |
| `resolveSchedulerPolicy` / `resolveSchedulerLimits` | частичная политика → полная; malformed поле — `TypeError`, не тихий fallback |

Порядок гейтов одного кандидата: ростер workspace'а (§6.1, F2) → роль → контракт роли (`assertBlueprintWithinRoleContract`) → capability-пол (`requiredCapabilities ⊆ blueprint.permissions`) → §31-гейт (`authorizeOperation`) → §29-маршрут → §30-бюджет (`decideBudgetAdmission`). Причина отказа — у первого кандидата в порядке `agentId` (та же диагностика, что у `selectModelRoute`).

**Что резервирует admission, а что читает по наблюдению (F1, решение владельца — вариант A).** §15-потолки разведены по тому, кто создаёт считаемую активность: `maxAttempts` — это активность, которую создаёт сам тик, поэтому план резервирует по слоту на admission и не пропускает `occupancy.activeAttempts + planned.attempts >= maxAttempts`; `maxConcurrentLlm` и `maxHeavyTools` считают фазы, в которые попытка входит *после* admission (§18.2), поэтому тик читает наблюдение и не добавляет работу к уже насыщенному ресурсу, а потолок исполняет тот, кто запускает вызов модели или инструмент. Резервировать эти два счётчика на admission значило бы превратить их в капы на число попыток, чего §15 не утверждает: пример §15 (8/4/2) описывает фазы попытки, а §16.3 перечисляет в фильтре pool/workspace capacity и не перечисляет §15-потолки.

Правка `packages/core/src/config.ts` (+42): валидация `pools.workspaceScheduling` — закрытая форма, `weight` обязателен и положителен, неизвестное поле/секция — `TypeError`.

### 2.3 `@dsh-mywork/scheduler` — runtime §16

Новый пакет (`package.json`, `tsconfig.json`, `tsdown.config.ts`, `src/index.ts` 39 строк, `src/service.ts` 413 строк):

- `createScheduler({ state, admit, clock, policy?, limits? })` → `start()` (§16.1: startup-reconcile + взведение таймера), `stop()`, `kick(kick)` (§16.2), `reconcile()`, `snapshot()`.
- Тики сериализованы цепочкой промисов: второй тик не решает против того же состояния одновременно.
- Aging (§16.3): runtime сам ведёт очередь чтения `task:<id>` / `review:<id>`; чтение, названное портом, побеждает; работа, ушедшая из очереди, теряет чтение.
- Safety-таймер (§16.2) идёт через `ClockPort.sleep(interval, signal)`; отказ тика записывается в `lastError`, но таймер не останавливается — это и есть safety-путь.
- Runtime **не держит ни одного модельного порта**: каталог приходит внутри наблюдения, поэтому тик без адмитимых работ не делает ничего, кроме чтения состояния.

### 2.4 Тесты

`tests/scheduler.test.mjs` (новый, 1128 строк, 27 тестов) + один тест в `tests/config.test.mjs` (+49) + запись пакета в `tests/lib/fixtures.mjs` (+4) + path-мэппинг в `tsconfig.base.json` (+1) + importer в `pnpm-lock.yaml` (+9).

## 3. Изменённые файлы

Новые:

| Файл | Строк |
|---|---|
| `packages/contracts/src/scheduler.ts` | 546 |
| `packages/core/src/scheduler.ts` | 769 |
| `packages/scheduler/src/service.ts` | 413 |
| `packages/scheduler/src/index.ts` | 39 |
| `packages/scheduler/{package.json,tsconfig.json,tsdown.config.ts}` | — |
| `tests/scheduler.test.mjs` | 1128 |

Изменённые (`git diff --stat`, только аддитивные строки):

| Файл | Диф |
|---|---|
| `packages/contracts/src/config.ts` | +8 |
| `packages/contracts/src/index.ts` | +1 |
| `packages/contracts/src/model-catalog.ts` | +31 |
| `packages/core/src/config.ts` | +42/−0 |
| `packages/core/src/index.ts` | +17/−2 (экспорты + doc) |
| `packages/core/src/routing.ts` | +5/−29 (типы переехали в contracts, реэкспорт) |
| `tests/config.test.mjs` | +49 |
| `tests/lib/fixtures.mjs` | +4 |
| `tsconfig.base.json` | +1 |
| `pnpm-lock.yaml` | +9 (importer нового пакета) |

Состав карточки до коммитов (§10): `git status --short` показывал 10 изменённых + 4 новых пути (`packages/contracts/src/scheduler.ts`, `packages/core/src/scheduler.ts`, `packages/scheduler/`, `tests/scheduler.test.mjs`); суммарный `git diff --stat` по отслеживаемым файлам — 10 файлов, +168/−23. После коммитов `git status --short` пуст.

## 4. Принятые решения по объёму (оспоримы)

| # | Решение | Почему так |
|---|---|---|
| D1 | Runtime — новый пакет `@dsh-mywork/scheduler`, чистая политика — в `core`. Согласовано с владельцем до начала работы | Прецедент MW-012 (пакет `execution`); тесты не тянут cordis-бандл; ADR020 «controller владеет admission» не нарушен — монтирует контроллер в MW-022/MW-044 |
| D2 | `pools.workspaceScheduling` — в существующем домене `pools` (global-only). Согласовано с владельцем | §16.4 — тот же pool-слой, что §14; вес `0` отвергается (workspace, который никогда не планируется, — это `workspace.enabled`, а не вес) |
| D3 | Резервируется только `maxAttempts` — активность, которую создаёт тик; `maxConcurrentLlm` и `maxHeavyTools` читаются как наблюдаемое насыщение (решение владельца, вариант A по F1) | §16.3 перечисляет в фильтре pool/workspace capacity, но не §15-потолки; потолок фазы исполняет тот, кто её начинает. Резервирование обоих делало бы `maxAttempts: 8` недостижимым при `maxConcurrentLlm: 4` |
| D4 | Worker-admission авторизуется как §31-операция `task.transition`, review-admission — как `review.approve` с `reviewer: true` и `workerAgentId` | Единственная операция закрытого каталога §31, описывающая «взять задачу и двигать её»; гейт сам обеспечивает независимость и read-only ревьюера |
| D5 | Доступность маршрута читается из наблюдённого `CatalogSnapshot`, порт не вызывается; escalation не рассматривается | §3.2 (scheduler — не LLM) и §62 п.7; тик не может дёрнуть провайдера даже случайно |
| D6 | Fairness — взвешенный раунд admission'ов (weight = сколько берёт за цикл), а не слагаемое score; workspace-cap = минимум из §14 `workspace.maxWorkers` и §16.4 `maxWorkers` | Слагаемое score не ограничивает долю; «заявленный потолок никогда не расширяет другой» |
| D7 | `idle` и `sleeping` не заряжают ничего | §14: `minActive` — прогретые инстансы «пока пул простаивает», то есть не занимающие running-ёмкость |
| D8 | §15 `maxAttempts` — потолочная конкурентность, отдельно от одноимённого §30-лимита на задачу | Разные счётчики с одинаковым именем в архитектуре; различие зафиксировано в doc-комментарии контракта |
| D9 | Тай-брейк — лексикографическое сравнение идентификатора | Платформо- и локаль-независимый полный порядок; поэтому `T-10` идёт раньше `T-2` (закреплено тестом) |
| D10 | Workspace-фильтр §16.3 — это `enabled` **плюс** объявленный ростер identity (`SchedulerWorkspaceState.agentIds`); ростер отсутствует — фильтр не проверяется (конвенция «необъявленный лимит не проверяется» §30) | На admission гранта ещё нет, поэтому ветка `foreign-workspace` §31-гейта сравнивает грант с операцией, а не identity с workspace; ростер — то, что планировщик действительно может проверить (F2, §8) |
| D11 | Тест «чтение порта побеждает» делает **два** тика: первый заводит собственное чтение runtime, второй сообщает другое от порта | На свежем планировщике очередь пуста, и обе ветви `??`-цепочки дают одно значение — тест не мог упасть (F3, §8) |

## 5. Команды и exit codes

| Команда | Exit | Наблюдение |
|---|---|---|
| `pnpm run check` (baseline, до правок) | 0 | 444 tests / 421 pass / 0 fail / 23 skipped — совпадает с отчётом MW-013. Замер сделан **до** правок MW-014; воспроизвести его теперь можно только откатом работы |
| `pnpm run typecheck` | 0 | все 11 workspace-пакетов со скриптом `typecheck` (включая `packages/scheduler`); двенадцатый проект workspace — корневой `package.json`, у него скрипта нет. Первый прогон падал на `CatalogSnapshot` и `exactOptionalPropertyTypes` — исправлено |
| `pnpm run build` | 0 | `packages/scheduler build: Done`, `lib/index.js` + `index.d.ts` созданы |
| `node --test --test-isolation=none tests/scheduler.test.mjs` | 0 | 27 tests / 27 pass / 0 fail (26 до фиксов F1–F3) |
| тот же прогон ×15 подряд | 0 каждый | 26/26 каждый раз (до фиксов) — асинхронные тесты runtime (таймер, сериализация тиков) не флейкуют |
| `pnpm run check` (итоговый, после фиксов) | 0 | **472 tests / 449 pass / 0 fail / 23 skipped** (+28 тестов к baseline) |
| `pnpm install --lockfile-only` | 0 | +9 строк: importer `packages/scheduler`; `node_modules` не переустанавливались |
| `pnpm install --frozen-lockfile --lockfile-only` | 0 | lockfile согласован с новым пакетом |
| mutation-check M1…M13 (см. §6.7) | 13/13 | каждая мутация уронила ожидаемый тест; артефакт восстановлен до SHA256 из §6.7 |
| `git add` + `git commit -F` ×4 (см. §10) | 0 каждый | четыре коммита по слоям: `56c6866`, `aefc5fa`, `d2d02b8`, `02e8644`; push/merge/publish/release не выполнялись |
| `pnpm run check` на закоммиченном дереве | 0 | 472 tests / 449 pass / 0 fail / 23 skipped; `git status --short` пуст |

## 6. Evidence по пунктам приёмки

### 6.1 «Одинаковое состояние даёт одинаковое назначение»

`core.planSchedulerTick(state)` вызывается дважды на одном объекте и третий раз на перемешанных массивах (`agents`, `workers`, `workspaces`): `deepEqual(JSON)` всех трёх планов совпадает. Отдельно: 12 готовых задач при `maxActive: 4` дважды дают один и тот же план (4 admission'а), а третий тик с инстансами, занявшими пул, — ноль admission'ов и `pool-capacity`. Тест «the plan is frozen…» дополнительно утверждает, что вход не мутируется (`JSON` до/после) и план заморожен.

### 6.2 «Concurrency не превышает caps»

- Пул §14: 10 задач, `maxActive: 3` → 3 admission'а, 7 `pool-capacity`; `maxActive: 0` — жёсткий стоп.
- Workspace: `min(§14 maxWorkers 4, §16.4 maxWorkers 2)` = 2; роль `maxActive: 1` → 1.
- §15 `maxAttempts` резервируется: 1 активная попытка при потолке 3 и четырёх готовых задачах → ровно 2 admission'а, дальше `attempt-limit`; при `maxAttempts: 2` и двух активных — ноль.
- §15 `maxConcurrentLlm` / `maxHeavyTools` читаются как насыщение: два `model-active` при `maxConcurrentLlm: 2` → `llm-limit`; два `tool-active` при `maxHeavyTools: 2` → `heavy-tool-limit`; один `tool-active` при потолке 2 → тик продолжает заполнять (это и есть решение владельца по F1, закреплённое тестом «§15 ceilings: the tick reserves attempts, and reads the two phase counters as saturation»).
- Отдельный тест: лимит, которого никто не объявил, не проверяется (`pools: {}`, `limits: undefined` → 2 admission'а).

### 6.3 «Dependency release будит ready задачу»

Runtime-тест с портом состояния, которым управляет тест: до закрытия зависимости `kick({source:'event', event:'task.created'})` даёт 0 admission'ов и 0 вызовов `admit`; после `state.release()` тот же runtime на `kick({source:'event', event:'dependency.closed', taskId:'T-1'})` выдаёт admission для `T-1` и ровно один вызов `admit`. Kick с событием, которого нет в §16.2, отвергается `TypeError` (не игнорируется молча).

### 6.4 «Sleeping/idle не вызывает LLM»

- Поведенчески: 9 событий §16.2 + `reconcile()` на пустом состоянии → 0 admission'ов, 0 вызовов `admit`, ровно 10 чтений состояния; `queued` = 0.
- Структурно: пакету подсунут «модельный порт» — за два тика (один с работой, один reconcile) счётчик вызовов порта равен 0; скан исходников `packages/scheduler/src` не находит ни `ModelCatalogPort`, ни `resolveModelInfo`, ни `listModels`, ни `selectModelRoute`, ни `routeModel(`, ни `AgentRuntimePort`, ни `adapter-sdk`.
- §15: `idle`/`sleeping` не заряжают ни одного счётчика — отдельный тест на таблицу `RESOURCE_STATE_CHARGES` и на `countSchedulerOccupancy` с шестью состояниями.

### 6.5 «Missed event восстанавливается reconcile»

Runtime-тест: состояние меняется (`release()`), но событие не доставляется — 0 admission'ов; следующий `reconcile()` выдаёт admission для `T-1` и `plan.kick.source === 'reconcile'`. Таймер: `start()` даёт startup-тик (§16.1), затем `clock.advance(1000)` будит safety-петлю, второй тик адмитит работу; после `stop()` дальнейшее продвижение часов не добавляет тиков.

### 6.6 §14/§16.4/§27/§30

- §16.4: веса 2 и 1 при пуле `maxActive: 3` → `['W-1','W-1','W-2']` и 7 `pool-capacity`; workspace без записи в таблице берёт `defaultWorkspaceWeight`; workspace с единственной работой не превышает свой `maxWorkers`.
- §16.3: приоритет 5 против ожидания в один шаг — приоритет побеждает; шесть шагов ожидания (score 6) обгоняют приоритет 5; ровно один шаг — это шаг; чтение из будущего не даёт отрицательного aging.
- §27: ревью адмитится только в пул `reviewers`, ревьюер ≠ producer (`reviewer-not-independent`), отсутствующий producer тоже отказ, worker-идентичность ревьюером не считается, потолок пула ревьюеров работает, `maxReviewLoops` расходуется именно review-запросом. Пулы worker/reviewer не делят слот.
- §30: отсутствие ledger для объявленного лимита — отказ, а не ноль; попытка 2 из потолка 2 допускается (включительная граница), третья — нет; неизмеренный расход при `maxTokensPerTask` — отказ (D2 из MW-013).
- §16.2-события: все девять перечислены в контракте, порядок закреплён тестом, `SCHEDULER_EVENT_TYPES.length` используется как число чтений в тесте «ничего не делать».

### 6.7 Mutation-check собранных артефактов

Каждая мутация вносилась в **собранный** артефакт (`packages/*/lib/index.js`), после прогона артефакт восстанавливался из резервной копии и сверялся по SHA256. Ни одна мутация не осталась в дереве. Таблица перемерена после фиксов F1–F3 и N1 — все 13 строк прогнаны против финальных артефактов.

Счёт упавших тестов зависит от формулировки мутации: везде использован минимальный вариант (`if (false)` вместо условия, удаление строки, перестановка `??`), поэтому число в колонке — это число тестов, которые *могли* поймать именно такую поломку, а не единственно возможное. Независимый верификатор, сформулировав M1 иначе, получил 6 падений вместо 2; оба числа верны для своих мутаций.

| # | Что сломано | Ожидаемый тест | Результат |
|---|---|---|---|
| M1 | снят потолок пула (§14) | `worker pool never admits past its §14 ceiling`, `declared ceiling of zero` | exit 1, 2 fail ✔ |
| M2 | снята сортировка работ (§16.3) | `the same state produces the same plan…` | exit 1, 1 fail ✔ |
| M3 | вес §16.4 заменён на 1 | `§16.4 weights bound what one workspace takes` | exit 1, 1 fail ✔ |
| M4 | reconcile перестал отдавать admission'ы | `…reconcile recovers a missed one`, `safety timer reconciles…` | exit 1, 2 fail ✔ |
| M5 | runtime забыл собственное чтение очереди | `queue reading` (оба теста) | exit 1, 1 fail / 1 pass ✔ |
| M6 | перевёрнут приоритет `??`-цепочки (`queue` раньше `stated`) | `queue reading` (оба теста) | exit 1, 1 fail / 1 pass ✔ — **ловится только после фикса F3** |
| M7 | §31-гейт перестал отказывать | `eligibility by role…`, `reviewers have their own pool…` | exit 1, 2 fail ✔ |
| M8 | §30-гейт перестал отказывать | те же два | exit 1, 2 fail ✔ |
| M9 | снят capability-пол | `eligibility by role…` | exit 1, 1 fail ✔ |
| M10 | снят ростер workspace'а (F2) | `rosters its identities` | exit 1, 1 fail ✔ |
| M11 | снято резервирование `maxAttempts` | `§15 ceilings: the tick reserves attempts…` | exit 1, 1 fail ✔ |
| M12 | снят heavy-tool гейт насыщения | `§15 ceilings: the tick reserves attempts…`, `reviewers have their own pool…` | exit 1, 1 fail ✔ |
| M13 | снята валидация ростера (N1) | `rosters its identities` | exit 1, 1 fail ✔ |

**Побочные находки собственных тестов (обе — до независимого ревью и по его итогам).** Первая версия теста aging проходила при мутации M5, потому что порт сам сообщал `readySince`, и путь «runtime ведёт очередь» не исполнялся: тест разделён на два, после чего M5 и M6 ловятся. Тест «чтение порта побеждает» в первой редакции делал один тик на свежем планировщике, где очередь runtime пуста, поэтому обе ветви `??`-цепочки давали одно значение и тест не мог упасть (нашёл ревьюер, F3): теперь он делает два тика, и M6 ловится. Обе находки — ровно тот случай, ради которого mutation-check и делается.

SHA256 артефактов после фиксов N1/N2 и восстановления (финальные):
`packages/core/lib/index.js` — `E97FA26857A21E9CE078C7BF374718D020AEE03C50B11400E5EFF11BBA54FA98`;
`packages/scheduler/lib/index.js` — `9B61F38035F1FA710537547A3A5036691489B67003307E3DD8D8E134FB80FEB7`.

## 7. Ограничения и что осталось за рамками

1. **§16.5 Adaptive capacity не реализован** — по объёму карточки («Advanced adaptive pools оставить за v0.1»). Никаких адаптивных коэффициентов, уменьшающих worker-concurrency, в коде нет.
2. **§16.3 `deadline`, `backlog pressure`, `locality/cache`** не реализованы: в домене нет полей, из которых они считаются (`Task` не несёт ни дедлайна, ни локальности). Реализованы `priority` + `aging` + fairness — то, что названо в объёме карточки.
3. **§27 review lanes с условием `when`** (`task.labels contains "security"`) не реализованы: у `Task` нет поля `labels`, а закрытый язык условий — deliverable MW-044/MW-051. Сейчас признак ревьюера — пул blueprint'а (`reviewers`), плюс §31-независимость.
4. **Планировщик ещё не смонтирован в resident controller (ADR020).** Runtime принимает порты (`state`, `admit`, `clock`) и не создаёт Cordis-строку: композицию с реальным Task Graph/MyWork DB владеют MW-022 (worker session) и MW-044 (workflow engine). Монтировать его сейчас, без источника состояния, было бы мёртвой проводкой.
5. **Дубликат admission не маскируется.** Тик решает против прочитанного состояния; если состояние не отражает выданный admission, следующий тик решит то же самое. Идемпотентность по задаче — свойство §9-саги (MW-012), и прятать это в планировщике значило бы завести второй источник истины. Зафиксировано тестом «an admission never exceeds the caps…» и doc-комментарием порта.
6. **§31-гейт планировщика не проверяет привязку identity к workspace, и не может.** На admission гранта ещё нет: планировщик спрашивает гейт про workspace, в котором попытка *будет* работать, поэтому ветка `foreign-workspace` (грант против операции, которая его использует) — это per-operation проверка ниже по потоку, а не утверждение об identity. Что планировщик проверяет — `workspace.enabled` и, если workspace объявил ростер, членство identity в нём (§6.1, D10). Ограничение названо явно, чтобы док-комментарий не обещал больше, чем есть (F2, §8).
7. **Насыщенный `maxHeavyTools` останавливает и review-admission'ы.** Гейт фазы общий для обоих видов работы: один работающий тяжёлый инструмент при потолке в тике не блокирует (см. §6.2), но полное насыщение потолка останавливает и очередь ревью. Это цена решения D3; точная проверка потребовала бы признака «эта работа запустит тяжёлый инструмент», которого в домене нет (F4, §8). Поведение закреплено тестом «reviewers have their own pool…» (случай `saturatedTools`).
8. **Фазовые потолки `maxConcurrentLlm`/`maxHeavyTools` сейчас не исполняет никто в дереве.** Решение A означает, что их соблюдение — обязанность того, кто запускает вызов модели или тяжёлый инструмент, то есть попыточного runtime (MW-022/MW-044), которого пока нет: `maxConcurrentLlm` и `maxHeavyTools` встречаются только в контрактах и в политике планировщика. До появления этого runtime планировщик гарантирует лишь то, что не *добавляет* работу к уже насыщенному ресурсу; полнота §15 не заявляется (N2, §9).
9. **`stop()` не отменяет тик в полёте** — он дожидается его завершения (и это же гарантирует, что после `stop()` не остаётся полу-применённого плана).
10. **Коммиты выполнены по отдельному поручению владельца** (§10); push/merge/publish/release не выполнялись. Base SHA `3bc6c78` → Head SHA `02e8644`.
11. **`pnpm install --lockfile-only` изменил `pnpm-lock.yaml`** (+9 строк, importer нового пакета) — механическое следствие добавления workspace-пакета; `--frozen-lockfile` после этого проходит (exit 0). Полная установка `node_modules` не запускалась.
12. **Не проверялось:** поведение под реальным resident controller и реальным Task Graph (нет композиции — см. п.4); конкурентность двух контроллеров (MW-009/ADR020); платные LLM-пробы не запускались вовсе.

## 8. Независимое ревью и разбор находок

Первый проход выполнен отдельным read-only исполнителем (только `.tmp/` и собственный отчёт; без субагентов и платных проб), отчёт: `.work/reports/MW-014-review.md`. Живое дерево ревьюером не изменено, артефакты после его мутаций восстановлены (SHA256 совпал).

**Вердикт первого прохода: `PASS WITH FINDINGS`** — 2 MAJOR + 2 MINOR + 1 NIT. Ревьюер воспроизвёл на состоянии **до** фиксов: `pnpm run check` 471/448/0/23, 26 тестов планировщика, 10 diff'ов построчно, SHA256 артефактов, чистоту `planSchedulerTick`, отсутствие модельного порта в runtime, целостность публичной поверхности `core`.

| # | Находка | Разбор и что сделано |
|---|---|---|
| F1 MAJOR | `PlannedCharge` не ведёт heavy tools, поэтому тик выдаёт admission'ы при насыщенном потолке (1 `tool-active`, потолок 2 → 2 admission'а) | **Принята как асимметрия, исправлена решением владельца (вариант A), а не предложенным резервированием.** Резервировать LLM- и heavy-tool-слот на каждый admission значило бы сделать `maxAttempts` недостижимым: при дефолтах 8/4/2 максимальная конкурентность попыток стала бы 2, а §14 `workers.maxActive: 6` — недостижимым. Теперь резервируется только `maxAttempts` (активность, которую создаёт тик), а два фазовых счётчика читаются как наблюдаемое насыщение; семантика зафиксирована в контракте (`SchedulerLimits`), в doc-комментарии политики, в тесте «§15 ceilings: the tick reserves attempts…» и в §6.2; цена фазового гейта названа в §7 п.7. Остаточная асимметрия снята: `planned.llm` из кода удалён |
| F2 MAJOR | §31-гейт вырожден: `workspaceId` передаётся и как грант, и как операция, привязка identity к workspace не проверяется | **Принята; исправлено ростором, а не привязкой из `workspaceOverlays`.** На admission гранта нет, поэтому «привязка» — это то, что workspace объявляет: `SchedulerWorkspaceState.agentIds` (§6.1, `Team.agentIds`), отказ `agent-not-in-workspace`, тест «a workspace that rosters its identities…» и mutation M10. Притязание в док-комментарии переписано честно; отсутствие ростера названо ограничением (§7 п.6). `workspaceOverlays` как источник проверки отвергнут: `retargetIdentity` (MW-012) *добавляет* workspace в этот список при первом admission, поэтому проверка по нему была бы круговой |
| F3 MINOR | Тест «a queue reading the state port states wins» не может упасть: один тик на свежем планировщике, очередь runtime пуста | **Принята; исправлено.** Тест делает два тика: первый заводит чтение runtime, второй сообщает чтение порта (`NOW − 5 шагов`) при сдвинутых на 2 шага часах → ожидание `7 * AGING_STEP`. Мутация M6 (перевёрнутая `??`-цепочка) теперь ловится; строка M6 в §6.7 перемерена. Расхождение в исходной таблице было настоящим: автор ломал другую мутацию (`stated` выброшен), ревьюер — перестановку приоритета |
| F4 MINOR | Насыщенный `maxHeavyTools` блокирует и review-admission'ы | **Принята как ограничение доступности, названа в §7 п.7 и закреплена тестом** (случай `saturatedTools`: worker и review вместе получают `heavy-tool-limit`). Точная проверка потребовала бы признака «эта работа запустит тяжёлый инструмент», которого в домене нет; вводить его ради этого карточка не позволяет («без speculative scaffolding») |
| F5 NIT | `tests/security.test.mjs:139` зелёный при вырожденном гейте — тест проверяет гейт, а не потребителя | **Принята к сведению, вне объёма MW-014.** Этот тест принадлежит MW-007 и не редактировался. Собственный тест планировщика теперь покрывает **workspace-фильтр** (ростер), но не ветку `foreign-workspace` §31-гейта: она остаётся проверенной только тестом MW-007, и планировщик её и не вызывает (§7 п.6) |

## 9. Верификация фиксов (второй проход, только дельта)

Отдельный read-only исполнитель, отчёт: `.work/reports/MW-014-fixes-verification.md`. Проверялись только исправления F1–F4 и то, не внесли ли они новых дефектов.

**Вердикт: `FIXES PARTIALLY VERIFIED`** — F1, F2, F3 закрыты и подтверждены мутациями; F5 закрыта как решение вне объёма; F4 была закрыта наполовину (ограничение названо, но теста на ревью под насыщенным потолком не было); фикс F2 ввёл новое поле без валидации. BLOCKER/MAJOR нет. Верификатор воспроизвёл `pnpm run check` 472/449/0/23 и 27 тестов планировщика, мутации M6/M10/M11/M12 — все совпали с §6.7.

| # | Находка второго прохода | Что сделано |
|---|---|---|
| N1 MINOR | `SchedulerWorkspaceState.agentIds` не валидировался: строковый ростер давал **подстрочное** сравнение через `String.prototype.includes` и fail-open допуск (`'xNeo-1x'` → `Neo-1`), объект падал `TypeError` из недр | **Исправлено:** `requireTickInput` требует массив непустых строк, иначе `TypeError`; в тест ростера добавлены ветви `'xNeo-1x'`, `{}`, `['']` и `[]` (объявленный пустой ростер не планирует никого — совпадает с doc-комментарием). Мутация M13 (снятая валидация) ловится |
| N2 MINOR | Doc-комментарии обещают, что фазовые потолки исполняет «runtime, который стартует активность», но такого компонента в дереве нет, и §7 этого следствия решения A не называл | **Исправлено:** §7 п.8 прямо говорит, что `maxConcurrentLlm`/`maxHeavyTools` сейчас не исполняет никто в дереве, полнота §15 не заявляется, а обязанность принадлежит попыточному runtime (MW-022/MW-044) |
| NIT | §8 по F5 обещала больше, чем покрыто; счёт падений в §6.7 зависит от формулировки мутации; ветвь `agentIds: []` не покрыта | **Исправлено:** формулировка F5 сужена (ростер ≠ ветка `foreign-workspace`), в §6.7 добавлена оговорка про формулировку мутации, `agentIds: []` покрыт тестом |

**Итог по состояниям:** F1 VERIFIED, F2 VERIFIED (после N1), F3 VERIFIED, F4 — закрыта тестом после NIT, F5 — вне объёма. Третий проход не запускался: после N1/N2 новых BLOCKER/MAJOR нет, а `evidence-gated-delivery` останавливает дельта-цепочку, когда проход не находит BLOCKER/MAJOR, и предупреждает, что четвёртый и далее — решение владельца, а не инициатива исполнителя. Повторная независимая проверка правок N1/N2 не выполнялась; это названо, а не замолчано.

## 10. Коммиты

Выполнены **по отдельному поручению владельца** («статус карточки изменить, и сделать коммиты»). Четыре коммита по слоям, `type(scope): subject`, тело объясняет «почему», трейлер `Cards: MW-014.`; push/merge/publish/release не выполнялись. Сборка и тесты (`lib/`) в git не идут — они под `packages/*/lib/` в `.gitignore`; отчёты `.work/` исключены правилом `/.work/`.

| # | SHA | Subject | Файлы |
|---|---|---|---|
| 1 | `56c6866` | `feat(contracts): add the scheduler vocabulary and the workspace fairness shares` | `contracts/src/scheduler.ts` (новый, 546), `config.ts` +8, `index.ts` +1, `model-catalog.ts` +31 |
| 2 | `aefc5fa` | `feat(core): add the deterministic scheduler policy` | `core/src/scheduler.ts` (новый, 769), `config.ts` +42, `index.ts` +17/−2, `routing.ts` +5/−29 |
| 3 | `d2d02b8` | `feat(scheduler): add the event-driven scheduler runtime` | `packages/scheduler/**` (новый пакет), `tsconfig.base.json` +1, `pnpm-lock.yaml` +9 |
| 4 | `02e8644` | `test: cover the scheduler assignment, its caps, and the reconcile path` | `tests/scheduler.test.mjs` (новый, 1128), `tests/config.test.mjs` +49, `tests/lib/fixtures.mjs` +4 |

Порядок коммитов — порядок зависимостей (contracts → core → scheduler → tests), поэтому каждый следующий слой опирается на предыдущий. **Что проверено, а что нет:** финальный гейт (`pnpm run check` → exit 0, 472/449/0/23) прогнан на закоммиченном дереве после четвёртого коммита, `git status --short` пуст; промежуточные коммиты по отдельности не гонялись через typecheck/build/test — это названо, а не подразумевается. Проверка после коммитов: `git log --oneline -5` показывает `02e8644`, `d2d02b8`, `aefc5fa`, `56c6866`, `3bc6c78`.
