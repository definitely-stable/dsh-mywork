# 91 — Независимая верификация плана v0.3 (verifier-b)

**Роль:** `verifier-b`, состязательный верификатор (задача — **опровергнуть** план, а не подтвердить).
**Метод:** чтение первоисточников (`read`/`grep`/`glob`), точечные read-only команды `pwsh`, собственные скрипты в `.tmp/plan-v03-verify-b/`. Тесты, сборка, `pnpm install` **не запускались** (запрет задания). Профиль `~/.dsh` и DSH-чек-аут `C:\Reposit\deepseek-harness\deepseek-harness` — только чтение.
**Код-база:** `git HEAD = 0c657ae1434202865bd330f0eeaf2b60eb78f6d4`, `git status --porcelain` — пусто (код не менялся весь прогон).
**Evidence:** 25 файлов `.work/plan-v0.3/evidence/verify-b-01…44.md`.

---

## 0. Ревизия: план переписывался во время проверки

Это главный методологический факт отчёта. Файлы плана правились другими участниками **прямо в ходе** верификации (реакция на R-01…R-22). Все выводы ниже привязаны к ревизии, зафиксированной хешем; где файл сдвинулся — указано, что находка перепроверена по **содержанию** на новой ревизии.

| Файл | SHA256 (на момент финальной сверки) | Строк | Дрейф за прогон |
|---|---|---|---|
| `21-STEPS-execution.md` | `0AA13ED2A4DBF089676F40F0BC3CCB4C60E466A56CC103FD9011FC924BA2191C` | 1181 | был 1126 строк на старте → **стабилизировался** |
| `23-STEPS-quality.md` | `EB802DB3B0F8D899B715D007DC24C28C092586F9540B9F3FBB06FC8229EAB462` | 871 | был 907 → 860 → 871 (дрейф) |
| `20-STEPS-foundation.md` | `0C10CA782907FDA084E772BA5EB6B305D000EA9780F25DD9AA5CD03DA8AD1FD0` | 1899 | был 1743 → 1899 |
| `22-STEPS-surface.md` | `7392EE0E3ECBDC31E05F46A5EAB1EF30DC02954DB5315D1CE502F5BE087BB53E` | 1569 | был 714 → 1520 → 1569 (**дрейф в момент сверки**) |
| `10-DECISIONS.md` | `9E72F4A3D9933163424063039C4ED2D1585A61B858BDEF08340AAA6EB0B5A8A3` | 1893 | был 1846 → 1890 → 1893 (дрейф) |
| `30-CARD-EDITS.md` | `FF9718FA76C4…` (263 839 Б) | 1430+ | был 1384 → 1401 → 1476 → 1497 (**дрейф**) |
| `01-MASTER-PLAN.md` | `181915609036…` | 547 | был 422 |

**Следствие, которое надо принять как ограничение:** любая находка «строка N содержит X» живёт до следующей правки. Поэтому в §2 вердикты даны **по содержанию** («шаг E-04 утверждает…»), а номера строк — как подсказка на указанную ревизию. Все находки, помеченные ниже `LIVE`, перепроверены на ревизии из таблицы.

---

## 1. Сводка

### 1.1. Объём

| Что | Объём |
|---|---|
| Шагов проверено | **98** (E-01…E-51 = 51; Q-01…Q-47 = 47) — покрытие 100 % обоих файлов |
| Шагов проверено **повторно** на текущей ревизии | 11 (E-01, E-11, E-21, E-31, E-41, E-51, Q-01, Q-11, Q-21, Q-31, Q-41) |
| Якорей `файл:строка` проверено в первоисточнике | **64** (48 «плоских» + 16 групповых, покрывающих ~25 отдельных строк) |
| Правок карточек выборочно проверено | **12+** из 57 (C-15…C-48, выборочно по всем группам) |
| Новых карточек проверено | **18** (MW-056…MW-074, включая отклонённые MW-072/MW-075 и добавленные позже MW-076) |
| Граф зависимостей | 73 узла, пересчитан **своим** скриптом `.tmp/plan-v03-verify-b/graph-check.ps1` |

### 1.2. Вердикты

| Вердикт | Якорей | Шагов/карточек |
|---|---|---|
| `ПОДТВЕРЖДЕНО` | 44 | 41 |
| `ЧАСТИЧНО` | 13 | 43 |
| `НЕВЕРНАЯ_СТРОКА` | 5 | 14 |
| `НЕ_СУЩЕСТВУЕТ` | 2 | 4 |
| `НЕ_ПРОВЕРЕНО` | — | 3 |

Числа по evidence-файлам: `ПОДТВЕРЖДЕНО` 61 · `ЧАСТИЧНО` 43 · `НЕВЕРНАЯ_СТРОКА` 14 · `НЕ_СУЩЕСТВУЕТ` 4 · `НЕ_ПРОВЕРЕНО` 3 (счёт включает и промежуточные формулировки, поэтому выше суммы по якорям и шагам).

### 1.3. Что проверено **положительно** (и это важно для вердикта)

- **Якоря таблицы инвентаря `21-STEPS-execution.md` §1.1 — 8/8 подтверждены с точностью до строки** (`attemptAndComplete:440-613`, `assertOwnership:405-429`, `STALE_FENCE:413`, `index.ts:38-71`, `planSchedulerTick:303-333`, виды работ `:314`, лимиты `8/4/2` `contracts/scheduler.ts:215-227`, сериализация тиков `scheduler/service.ts:280-287`).
- **Якоря контрактов, `core` и `evidence` — подтверждены** (`attempt.ts:92-101/:122`, `review.ts:12-48/:51-56`, `agent-runtime.ts:52-64/:67-76/:87-96/:223-258`, `artifact.ts:31-75` — ровно 12 видов, `security.ts:119-146/:257-258`, `core/review.ts:109/:129/:146/:157/:182`, `core/security.ts:130/:203-207`, `evidence/artifacts.ts:43/:132/:191`, `evidence/schema.ts:26/:35/:38`).
- **Якоря платформы DSH — 8/8 подтверждены** (`core/tools/src/index.ts:736/:1095-1140/:796-800`, `plugin-compatibility.ts:68/75/76/77`, `auto-review` — deny-only режима действительно нет, `jobs-local:35-39`, `verify-package-invariants.ts:11-21`, `agent-loop:334-335`, `providerConcurrency` — 0 совпадений).
- **Инструментарий гейтов существует и форма команд воспроизводима:** `node_modules/tsdown/dist/run.mjs` — есть, `node_modules/.bin/tsc.cmd` — есть, `package.json:16` задаёт `node --test --test-isolation=none "tests/**/*.test.mjs"`.
- **Числа `pass N` совпадают с числом описанных тестов** практически во всех шагах 21- и 23-файлов (проверено скриптом по всем 98 шагам; единственное «расхождение» Q-01 — ложное срабатывание: 17 — это размер существующей сюиты `tests/runtime.test.mjs`, а не число новых тестов).
- **Разрешение ссылок:** все **161** уникальных ID `E-*`/`Q-*`/`F-*`, упомянутых в файлах плана, разрешаются в объявленный шаг; висячих ссылок — **0**.
- **Дублей ID шагов между файлами нет** (209 уникальных объявлений; «дубли» B-01/B-04/B-05 — артефакт моей регулярки: это разные шаги `B-01` и `B-01a`, `B-04` и `B-04L`, `B-05` и `B-05L`).
- **Граф новых карточек:** 73 узла, висячих ссылок 0, self-deps 0, зависимостей от `superseded` 0, **циклов 0** — пересчитано независимо (§4).

---

## 2. Таблица находок

`LIVE` — перепроверено на текущей ревизии по содержанию. Номера строк — на указанную ревизию.

### 2.1. Якоря

| # | Якорь | Утверждение | Вердикт | Фактическое значение | Severity |
|---|---|---|---|---|---|
| A1 | `packages/execution/src/service.ts:440-613` | здесь `attemptAndComplete` | `ПОДТВЕРЖДЕНО` | объявление `:440`, закрытие `:613`; смещение 0 | info |
| A2 | `packages/execution/src/service.ts:405-429` | порядок: fence задачи → epoch → fence попытки | `ПОДТВЕРЖДЕНО` | `:411` fence, `:419-425` epoch, `:426` fence попытки | info |
| A3 | `packages/execution/src/service.ts:413` | `STALE_FENCE` | `ПОДТВЕРЖДЕНО` | ровно `:413`, единственное вхождение | info |
| A4 | `packages/execution/src/index.ts:38-71` | «экспорты» | `ПОДТВЕРЖДЕНО` | файл 71 строка, экспорты только `:38`…`:71` | info |
| A5 | `packages/core/src/scheduler.ts:303-333` | чистое ядро `planSchedulerTick` | `ПОДТВЕРЖДЕНО` | `:303`…`:333`; `await/Date.now/Math.random/fs.` — 0 совпадений | info |
| A6 | `packages/core/src/scheduler.ts:314` | виды работ | `ПОДТВЕРЖДЕНО` | `for (const kind of ['worker', 'review'] as const)` | info |
| A7 | `packages/contracts/src/scheduler.ts:215-227` | лимиты и дефолты 8/4/2 | `ПОДТВЕРЖДЕНО` | `:225/:226/:227` = 8/4/2 | info |
| A8 | `packages/scheduler/src/service.ts:280-287` | сериализация тиков | `ПОДТВЕРЖДЕНО` | `enqueue` `:280`…`:287`, опора `chain` `:196` | info |
| A9 | `packages/evidence/src/artifacts.ts:43/:132/:191` | `sha256Hex`/`putArtifact`/`getArtifact` | `ПОДТВЕРЖДЕНО` | все три строки точны | info |
| A10 | `packages/evidence/src/schema.ts:26/:35/:38` | v3, маркеры | `ПОДТВЕРЖДЕНО` | маркеры реально применены в `RAISE(ABORT)` `:67,72,94,99,118,124` | info |
| A11 | `packages/controller/src/dsh-session.ts:426/450/475/500/526` | `DshAgentRuntime`, start/resume/status/stop | `ПОДТВЕРЖДЕНО` | ровно эти строки (`events` `:537` в плане не назван) | info |
| A12 | `packages/controller/src/index.ts:101/:115-128` | `BOUNDED_CONTEXTS=['control']`, `apply` | `ПОДТВЕРЖДЕНО` | обе границы точны; внутри только `mountModelCatalog`/`mountDshRuntime` | info |
| A13 | `packages/contracts/src/artifact.ts:31-75` | виды артефактов, 12 | `ПОДТВЕРЖДЕНО` | ровно 12 (`ARTIFACT_KINDS:62-74`) | info |
| A14 | `packages/contracts/src/board.ts:356-372` | `NeedsAttentionReason` | `ПОДТВЕРЖДЕНО` | верхняя граница перебегает на 1 (`:371` — закрытие, `:372` — докблок соседней константы) | info |
| A15 | `packages/contracts/src/security.ts:119-146/:257-258` | `HarnessPolicy` + потолок + `worktreeRoot` | `ПОДТВЕРЖДЕНО` | `:135-146` — `HARNESS_POLICY_CEILING`; `:258` — `worktreeRoot?` | info |
| A16 | `packages/core/src/review.ts:109/:129/:146/:157/:182/:42` | инварианты и переходы | `ПОДТВЕРЖДЕНО` | все шесть точны | info |
| A17 | `packages/core/src/security.ts:130/:203-207/:102-110/:245` | `boundaryRoot`, `worktree-escape`, гейты, `secret-material` | `ПОДТВЕРЖДЕНО` | все точны | info |
| A18 | `packages/planner/src/service.ts:134/:1036/:1185/:1267/:1195-1300/:1303` | `Planner`, stage, submit, отказ, recovery, revert | `ПОДТВЕРЖДЕНО` | все точны; `:1195-1300` — тело `resume` | info |
| A19 | `packages/planner/src/store.ts:41/:400/:435` | `PLAN_MUTATION_HOLD_REASON`, `holdAdmission`, `readOpenHold` | `ПОДТВЕРЖДЕНО` | все точны | info |
| A20 | `tests/scheduler.test.mjs:921/:935-944` | нет порта модели; текстовый сканер | `ПОДТВЕРЖДЕНО` | точны | info |
| A21 | `tests/boundaries.test.mjs:488` | `deepEqual(modules, ['node:crypto'])` | `ПОДТВЕРЖДЕНО` | команда из E-01 даёт ровно одно совпадение на `:488` | info |
| A22 | `packages/core/src/context.ts:375/:478/:775/:1100` | `discoverContext`, `materializeContextSnapshot`, `assembleContextPrompt`, `requireCandidate` | `ПОДТВЕРЖДЕНО` | все точны | info |
| A23 | `packages/core/src/skill.ts:119/:639/:870`; `core/memory.ts:170/:1036` | реестр, провайдер, переходы, fabric | `ПОДТВЕРЖДЕНО` | все точны | info |
| A24 | `packages/core/src/scheduler.ts:554/:561-568/:584-620/:613-618` | `budgetVerdict`, admission, `capacityRefusal`, «потолки никто не исполняет» | `ПОДТВЕРЖДЕНО` | точны; `SchedulerInstanceObservation` действительно никем не производится | info |
| A25 | `packages/contracts/src/agent-runtime.ts:223-258` | ровно 5 операций | `ПОДТВЕРЖДЕНО` | `start:230, resume:237, status:243, stop:250, events:257` | info |
| A26 | `packages/lease/src/lifecycle.ts:56-61` | `ReconcileReport = {operations, leases, stalls}` | **`НЕВЕРНАЯ_СТРОКА`** | полей **два**: `operations` и `leases`; третьего поля `stalls` нет ни в коде, ни в тестах (`tests/lease.test.mjs:751`, `tests/plan-mutation.test.mjs:1187`). Утверждение повторено в `21-STEPS-execution.md` («возвращает отчёт `{operations, leases, stalls}`») | **major** |
| A27 | `packages/lease/src/index.ts:56-63` + «`ControllerLifecycle` не инстанцируется нигде» | экспорт есть, инстанцирования нет | `ЧАСТИЧНО` | экспорт `:57` подтверждён; но `new ControllerLifecycle(` есть в `tests/lease.test.mjs:546,743` и `tests/plan-mutation.test.mjs:1179,1197` — верно только «нет инстанцирования в `src`-композиции» | minor |
| A28 | `packages/core/src/budget.ts:181,195` | обе строки — `modelCallCost` | `ЧАСТИЧНО` | `:181` — `modelCallCost`, но `:195` — `modelRateOf`. Рядом в том же документе: «`decideBudgetAdmission` `:450`» — фактически объявление `budget.ts:217`, а `:450` — `tokenCount` | minor |
| A29 | `packages/contracts/src/budget.ts:104/:123/:138` | `maxAttempts`, scope `task` | `ЧАСТИЧНО` | `:104` = `maxAttempts: 'task'` ✓; `:123` — поле формы, `:138` — докблок другого типа; слова «scope» в них нет | info |
| A30 | `packages/contracts/src/task.ts:23/:29/:31/:35` | состояния | `ЧАСТИЧНО` | сами строки верны, но ожидаемый вывод `Select-String` **занижен**: те же имена есть на `:52,:55,:56,:58,:66` | minor |
| A31 | `packages/contracts/src/team.ts:206-208`, `:252-260` | blueprint и grant | `ЧАСТИЧНО` | `:206-208` верны; `:252-260` в `team.ts` — `revision`/конец `AgentIdentity`, а grant (`permissions`/`harnessPolicy`) лежит в **`security.ts:248-265`** — атрибуция файла неверна | minor |
| A32 | `scripts/verify-profile.mjs:170` | «`packContract`/`packController`» | `ЧАСТИЧНО` | `packController` на `:170` ✓; **`packContract` не существует** (0 совпадений по репозиторию) | minor |
| A33 | `scripts/verify-package-invariants.ts:11-21` (как артефакт MyWork) | build-time конформанс, exit 1 | `ЧАСТИЧНО` | файла в MyWork **нет** (он в DSH-чек-ауте); сами правила отказа лежат не на `:11-21`, а в `scripts/package-invariants.ts` | minor |
| A34 | `packages/storage/src/layout.ts` + `-Pattern 'DSH_HOME\|stateDatabasePath\|dsh-mywork'` → «`:66-68` и окрестности» | ожидаемый вывод | **`НЕВЕРНАЯ_СТРОКА`** | фактический вывод: `:3,:6,:13,:14,:24,:30,:38,:45,:55,:78,:91` — **совпадений в `:66-68` нет** | major |
| A35 | `packages/planner/src/store.ts:435` → вызов `plannerStore.readOpenHold(workspaceId)` | метод объекта стора | **`НЕВЕРНАЯ_СТРОКА`** | у объекта стора метода `readOpenHold` нет: `createPlanStore` публикует `openHold`; `readOpenHold` — свободная функция, а не член порта | major |
| A36 | `core/tools/src/index.ts:736` (относительный путь) | restriction процесс-локальна | `ЧАСТИЧНО` | по смыслу верно (`ToolLayer.restrictions` — in-memory), но каталога `core/tools` в MyWork нет: путь корректен только относительно DSH-чек-аута; в E-39 полный путь указан, в E-11 — нет | minor |
| A37 | `packages/contracts/src/audit.ts:88-89` | «`AUDIT_ENTRY_FIELDS` не прочитан целиком; несёт ли актора — неизвестно» | `ПОДТВЕРЖДЕНО` | поля актора в списке нет (`agentId` — «agent the event concerns»), шаг 0 в Q-15 законен | info |
| A38 | `packages/contracts/src/context.ts:602-631` | `ContextRefusalReason` | `ПОДТВЕРЖДЕНО` | 8 причин `:603-619`; имени `CONTEXT_SNAPSHOT_MISSING` нет нигде (план помечает `~имя уточнить` — корректно) | info |

### 2.2. Шаги (21-STEPS-execution.md, ревизия `0AA13ED2`, 1181 стр.)

| # | Шаг | Утверждение | Вердикт | Фактическое значение | Severity |
|---|---|---|---|---|---|
| S1 | **E-01** | негативная проба доказывает отсутствие вызовов git | `ЧАСТИЧНО` → **исправлено по R-07** | `LIVE`: шаг переписан на две команды (регулярка **без** `-SimpleMatch` + позитивный контроль `tests/beads-adapter.test.mjs` → 3). Остаточное: `E-03` всё ещё называет worktree-адаптер «первым запуском внешнего процесса в проекте», тогда как `packages/beads-adapter/src/runner.ts:19,102` уже спавнит процесс | minor |
| S2 | **E-02** | «все методы возвращают `Result<…>` как остальные порты (`attempt.ts:80-89` — образец стиля)» | **`НЕВЕРНАЯ_СТРОКА`** `LIVE` | `attempt.ts:80-89` — интерфейс `Lease`, ни `Result`, ни методов; `Result<` в `contracts/src` определён один раз (`operation.ts:115`), порты возвращают собственные типы | major |
| S3 | **E-04** | порядок `allocateFence → insertAttempt → worktrees.prepare → insertAttemptWorktree` внутри `attemptAndComplete` | `ЧАСТИЧНО` `LIVE` | `allocateFence:375`, `insertAttempt:389`, событие `:476-480` — но всё внутри `store.transaction(tx => …)` (`:453`), а `transaction<T>(fn: (tx) => T): T` **синхронна** (`storage/src/store.ts:59`). `worktrees.prepare` возвращает `Promise` → `await` в этой точке невозможен; точку вызова придётся вынести из транзакции, что меняет идемпотентность саги и в шаге не описано | **blocker** |
| S4 | **E-04** | миграция `v7` | **исправлено (R-04)** | `LIVE`: шаг переведён на «номер выдаёт единый аллокатор версий (D08, §1.6; литералов версий нет)» и сам называет дефект R-04. Остаточный след: `20-STEPS-foundation.md:1079` в строке Evidence всё ещё пишет «DDL миграции **v7**» | minor |
| S5 | **E-07** | «фейк-рантайм из `adapter-sdk/src/testing.ts:332` реализует порт без правок SDK»; шаг 0 → «три совпадения» | `ЧАСТИЧНО` `LIVE` | `FakeAgentRuntime` на `:332` есть, но его `status(handle, options)` и метод `start` не совпадают с планируемым `AttemptRunPort.status(runId): Result<…>` → без правок SDK фейк порт не реализует; ожидание шага 0 занижено (команда даёт 6 совпадений: `:68,:69,:89,:116,:126,:223`) | major |
| S6 | **E-08** | тест (а) замыкает порядок вызовом `runtime.prompt` | **`НЕ_СУЩЕСТВУЕТ`** `LIVE` | в `AgentRuntimePort` методов только `start/resume/status/stop/events`; `prompt` — **поле** `AgentStartRequest` (`:73`), которое «admits the prompt» внутри `start`. Тест на порядок с `runtime.prompt` по контракту не пишется | major |
| S7 | **E-08** | гейт шага 0 (`Select-String` по `controller/src/index.ts`) станет непустым после F(composition root) | **`НЕВЕРНАЯ_СТРОКА`** `LIVE` | composition root по D07/F-28 живёт в **`packages/controller/src/app.ts`**; ре-экспорт `app.ts` в `index.ts` слов `openStore`/`createClaimSaga`/`ControllerLifecycle` в файл не добавит → обусловленное «ожидаем непустой» недостижимо | major |
| S8 | **E-09** | «`revisions` пишутся в `attempt`-путь через существующий `settle`-путь (`store.ts:428`)» | **`НЕВЕРНАЯ_СТРОКА`** `LIVE` | `settleAttempt` делает только `UPDATE attempt SET state, revision = revision + 1, settled_at`; колонки `revisions` нет ни в DDL `attempt`, ни в `insertAttempt`, ни в `AttemptRecord` (`contracts/src/claim.ts:256-281`). «Файлы» шага (worker.ts + тест) не содержат миграции/store → цель «доказана записью в БД» недостижима | major |
| S9 | **E-13** | «Modify `tests/evidence.test.mjs` — в этом файле словарь видов артефактов уже пиннится» | **`НЕВЕРНАЯ_СТРОКА`** `LIVE` | `ARTIFACT_KINDS` не встречается ни в одном тесте (0 совпадений по `tests/`); в `tests/evidence.test.mjs` пиннится `AUDIT_EVENT_TYPES.length === 16`, а не виды артефактов. Правка не нужна, «иначе падает чужая сюита» не подтверждается | major |
| S10 | **E-14** | список файлов шага; «решение фиксируется в `E-01`-файле» | `ЧАСТИЧНО` | `package.json`/`tsconfig.json`/`tsdown.config.ts` указаны без каталога; не упомянуты `tests/lib/fixtures.mjs` (карта `entries:17-21`) и регистрация в сканере `tests/boundaries.test.mjs:188-192,484-488`, хотя шаг 4 её требует; в evidence-файле E-01 места под решение о gate-runner нет | minor |
| S11 | **E-16** | «шаг выбирает существующий корень конфигурации и не создаёт параллельный» | `ЧАСТИЧНО` | существующий корень — `ResolvedWorkspaceConfig` (`contracts/src/config.ts:195`, резолвер `core/config.ts:121`), но поля `gates` в нём нет, `CONFIG_DOMAINS` — закрытый список из 6 значений, а в «Файлах» шага нет ни `config.ts`, ни `core/config.ts`: источник политики не назван | minor |
| S12 | **E-17** | «Зависит от: E-16, **E-19**» | `ЧАСТИЧНО` `LIVE` | `E-19` принадлежит карточке **MW-024**, а `MW-024.md:4` зависит от `MW-023` и `:13` требует остановиться с BLOCKED, если MW-023 не принят. Критический путь плана тоже ставит E-17 **перед** E-19 → порядок невыполним без нарушения карточной зависимости | **blocker** |
| S13 | **E-19** | аппенд миграции `v8` в `CLAIM_SAGA_MIGRATIONS` + регрессия «`claim-saga.test.mjs` → `fail 0`» | `ЧАСТИЧНО` `LIVE` | аппенд поднимает `store.schemaVersion` до 8, тогда как `CLAIM_SAGA_SCHEMA_VERSION = 6` пиннится в `tests/claim-saga.test.mjs:1051` и `tests/lib/claim-crash-child.mjs:113`; бампа константы в «Файлах» нет → заявленная регрессия падает. (Сама нумерация после R-04 переведена на аллокатор — острота снята, но необходимость бампа константы осталась не названной) | major |
| S14 | **E-20** | подпись `assertReviewerIndependence`; два из четырёх тестов | `ЧАСТИЧНО` `LIVE` | реальная подпись — `assertReviewerIndependence({ workerAgentId, reviewerAgentId }, meta)` (`core/review.ts:109-112`), именно так её вызывает `tests/review.test.mjs:74`; формы `(review, attempt, reviewer)` не существует. Тест (а) дублирует существующий «a worker cannot approve its own attempt» (`tests/review.test.mjs:64-77`); тест (б) («та же `AgentIdentity`, другая `AgentInstance`») **невыразим**: `Review` несёт только `reviewerId: AgentId`, а `AgentId`/`AgentInstanceId` — оба `string` (`ids.ts:30-33`) | major |
| S15 | **E-22** | «Modify `tests/evidence.test.mjs`» нет; «пропущена правка реэкспорта контрактов»; шаг 0 цитирует заголовок `## Ограничения` | `ЧАСТИЧНО` `LIVE` | новый `review-verdict.ts` без строки реэкспорта в `contracts/src/index.ts` (пофайловый `export *`) не виден потребителю — E-13 и `23-` эту правку называют, E-22 нет; заголовка `## Ограничения` в `.work/reports/MW-012-review.md` **нет** (все шесть `##`: `:8,:12,:29,:44,:54,:60`); зависимость объявлена `E-19, E-13`, а реализация опирается на `gate-result` из **E-17** — E-17 в зависимостях отсутствует | major |
| S16 | **E-23 / E-25** | коды отказа `STALE_APPROVAL` и `INTEGRATION_NOT_APPROVED` | **`НЕ_СУЩЕСТВУЕТ`** `LIVE` | `MyWorkErrorCode` — закрытая юнион из 20 кодов (`contracts/src/operation.ts:35-75`), словарь пиннится `assert.deepEqual` в `tests/events.test.mjs:178-199`. Хуже: E-23 сам велит переиспользовать `isReviewApprovalCurrent`, а тот возвращает `STALE_REVISION` (`core/review.ts:164`). В «Файлах» обоих шагов нет ни `operation.ts`, ни `tests/events.test.mjs` | major |
| S17 | **E-24** | причина `review-loop-exhausted` в `needs-attention` | `НЕВЕРНАЯ_СТРОКА` `LIVE` | каталог закрыт: ровно **7** значений (`contracts/src/board.ts:356-381`), пиннится `tests/board.test.mjs:603-612` (`assert.equal(…length, 7)` + `deepEqual`). В «Файлах» и в регрессии шага нет ни `board.ts`, ни `tests/board.test.mjs` → гейт недостижим | major |
| S18 | **E-24** | счётчик петель из `BudgetLimits.maxAttempts` (`budget.ts:104,:123,:138`) | **`НЕВЕРНАЯ_СТРОКА`** `LIVE` | тест (ж) того же шага и сводка значений плана называют `maxReviewLoops`; именно он (`budget.ts:105,:125`) — лимит review-работы, и планировщик уже списывает её как `'review-loop'` (`core/scheduler.ts:560`, `budget.ts:142`) | major |
| S19 | **E-26** | порт `GitPort` | **`НЕ_СУЩЕСТВУЕТ`** `LIVE` | порт изоляции — `WorktreePort { prepare, resolve, cleanup, list }`, в нём **нет** `commit`/`merge`/`rebase`; `GitPort` не встречается ни в коде, ни в плане. `Modify packages/worktree-adapter/src/git.ts` без правки контракта порта не даёт исполнителю E-25/E-26 вызвать commit/merge | major |
| S20 | **E-22/E-23** | «`diffHash` считается функцией из `E-03`/`E-15`» | `ЧАСТИЧНО` `LIVE` | строки `diffHash` в телах E-03/E-15 нет; во всём `packages/**` `diffHash` — только тип-поле (`contracts/src/review.ts:55`) и сравнение (`core/review.ts:284`), вычисляющей функции нет. Единственный готовый примитив — `sha256Hex` (`evidence/src/artifacts.ts:43`) | major |
| S21 | **E-30** | шаг 0 и форма роли планировщика | `НЕВЕРНАЯ_СТРОКА` | роль/пресет планировщика в реестре ещё не заведён (E-30 сам это фиксирует), а E-41 (тест (б)) требует для planner политику `read-only` — зависимость E-41 → E-30 не объявлена | minor |
| S22 | **E-31** | «Тест (падающий) → FAIL»; цель «типом, а не только проверкой в рантайме» | `ЧАСТИЧНО` `LIVE` | проверяемое поведение **уже реализовано и покрыто**: `core/src/plan.ts:482-493` — рантайм-отказ `PLANNER_SCOPE_DENIED`; `tests/plan-mutation.test.mjs:319-328` (update существующей → отказ, replan → ok), `:383` (additive-only классификатор), `:2352-2367` (ребро поверх принятого id). «Падающий тест» невоспроизводим. Заявленная цель «типом» гейтом не наблюдаема: тесты импортируют собранные `lib` и типы не проверяют. Число «≈2 368 строк» устарело | major |
| S23 | **E-39** | deny-список `cordis_*` через `tools.restrict({ deny })` | `ЧАСТИЧНО` (конфликт с D15) | D15 выбирает **allowlist** и отвергает denylist; в плане после R-08 внесён allowlist в boundary + локальный гейт F-58, но формулировки E-39/E-40 в 21-файле на момент проверки оставались deny-ориентированными (см. §5, R-22) | major |
| S24 | **E-40** | «`auto-review` только deny» | **`НЕВЕРНАЯ_СТРОКА`** `LIVE` | `LIVE` на ревизии `0AA13ED2`: заголовок шага (`:838`), строка карты (`:162`) и таблица связей (`:76`) по-прежнему говорят «только deny», тогда как в `23-STEPS-quality.md:660-670` Q-38 уже переписан по **R-22** на «при **активном** `auto-review`». Режима deny-only у пакета нет (проверено в DSH: `auto-review/src/index.ts:64-67,562-587`, `denyOnly|deny-only|deny_only` → 0 совпадений) | **major** |
| S25 | **E-42** | `packages/controller/src/runtime-root.ts` как «второй composition root» | `ЧАСТИЧНО` | `runtime-root.ts` — второй сборщик того же набора (`createLeaseStore`, `ControllerLifecycle`, `createClaimSaga`, `createPlanner`, `createScheduler`, `createArtifactStore`, `createAuditLog`), тогда как D07/F-28 объявляют **единственный** composition root `controller/src/app.ts` | major |
| S26 | **E-44** | команда шага 0 про `layout.ts` | **`НЕВЕРНАЯ_СТРОКА`** `LIVE` | см. A34: вывод не содержит `:66-68` | major |
| S27 | **E-45** | `admissionHold: (stores) => plannerStore.readOpenHold(workspaceId) !== undefined` | **`НЕВЕРНАЯ_СТРОКА`** `LIVE` | см. A35: у объекта стора нет метода `readOpenHold` (есть `openHold`) | major |
| S28 | **E-50** | переименование домена | `НЕВЕРНАЯ_СТРОКА` | формулировки шага расходятся с ADR-031 (предписывает `packages/contracts/src/procedure.ts`, `ProcedureRevision`) | minor |
| S29 | **E-51** | «→ FAIL (тест создан, проверка ещё не проходит)» | `ЧАСТИЧНО` `LIVE` | все три проверки **уже зелёные** до шага: `workflowEngine` по дереву (без `node_modules`/`lib`) — 0 совпадений, кроме самого плана; заявленный охват шире фактического места правки (`tests/boundaries.test.mjs:111-114` сканирует не всё дерево); мотив «чтобы работал в общем прогоне» неверен — общий прогон забирает любой новый файл (`package.json:16`); проверка (в) читает артефакт сборки без положительного контроля (соседи такой контроль имеют — `:489-493`); сводка обещает `pass 3`, тело даёт только `fail 0` | major |
| S30 | **E-11** | «обязательно: повторно применяется и ограничение поверхности (E-39)» при «Зависит от: E-08» | `ЧАСТИЧНО` `LIVE` | E-39 тоже объявляет только E-08 и уже содержит тест (ж) «после resume ограничение переустановлено» — дубль обязательства; E-11 стоит раньше E-39 и, выполненный первым, не может переустановить несуществующий слой; обратной зависимости E-39 → E-11 нет | major |
| S31 | **E-12** | карта: «Зависит от: E-08, E-25»; шаг 0 → совпадения на `:23,:29,:31` | `ЧАСТИЧНО` `LIVE` | тело шага объявляет только E-08 (расхождение с картой); `Select-String` даёт 7 строк, а не 3 | minor |
| S32 | **E-46…E-49** | reconcile, stall-детекция, эскалация, наблюдаемость | `ЧАСТИЧНО` | якоря и счёты тестов верны; замечания уровня «гейт не доказывает заявленное» | minor |
| S33 | сквозное (E-19…E-27) | «каждый гейт с новым тестом начинается со сборки затронутых пакетов» (заявлено в §1.5) | `ЧАСТИЧНО` | **семь шагов** диапазона (E-20, E-21, E-23, E-24, E-25, E-26, E-27) правят `src/`, но шага сборки не имеют — тесты грузят именно `lib/` (`tests/lib/fixtures.mjs:15-36`), поэтому гейт «`pass N / fail 0`» проверяет стухший артефакт | major |
| S34 | сквозное (E-26, E-27) | формат шага | `ЧАСТИЧНО` | E-26 и E-27 не имеют «шага 0» — вопреки конвенции всех остальных шагов диапазона | minor |

### 2.3. Шаги (23-STEPS-quality.md, ревизия `EB802DB3`, 871 стр.)

| # | Шаг | Утверждение | Вердикт | Фактическое значение | Severity |
|---|---|---|---|---|---|
| Q1 | **Q-01** | `Modify packages/execution/src/service.ts` («путь admission→attempt») | `ЧАСТИЧНО` `LIVE` | в файле **0** вхождений `prompt`, `AgentStartRequest`, `runtime`, `.start(`, `ContextSnapshot` — продюсера `AgentStartRequest.prompt` в `service.ts` нет; точка вставки не там, где заявлено | **major** |
| Q2 | **Q-01/Q-11/Q-21** | форма команды гейта | `НЕВЕРНАЯ_СТРОКА` `LIVE` | все три предписывают **голый** `node --test tests/<name>.test.mjs`, тогда как канон репозитория — `node --test --test-isolation=none "tests/<name>.test.mjs"` (`package.json:16`). Систематически: в `23-` таких команд **88**, с флагом — **1**; в `20-` — 130 и 6; в `21-` — 128 и 127; в `22-` — 156 и 153 | **major** |
| Q3 | **Q-01** | нет шага сборки перед тестом | `ЧАСТИЧНО` `LIVE` | тесты грузят собранный `lib/` (`tests/lib/fixtures.mjs:16-29`); ни в Q-01, ни в Q-11, ни в Q-21 шага сборки нет | major |
| Q4 | **Q-11** | `GATE_ALREADY_ANSWERED`; «Файлы» шага | `ЧАСТИЧНО` `LIVE` | код `GATE_ALREADY_ANSWERED` в репозитории отсутствует (0 совпадений); в «Файлах» нет `Modify packages/contracts/src/operation.ts`, где живёт `MYWORK_ERROR_CODES` (`:35-99`), хотя Q-21 такой пункт для своего кода имеет | major |
| Q5 | **Q-11** | контракт `HumanDecision` | `ЧАСТИЧНО` | `10-DECISIONS.md` (D14) и `adr/ADR-034-human-decision.md:76-97` описывают 4 состояния (`pending\|answered\|expired\|cancelled`) **без** `revision`, `originState`, `operationId` — шаг вводит больше полей, чем решение | major |
| Q6 | **Q-11** | гейт `grep -c "sqlite\|Database" packages/core/src/human-decision.ts` → 0 | **`НЕВЕРНАЯ_СТРОКА`** `LIVE` | `Get-Command grep` → не найдено (в PATH есть только ripgrep); к тому же проба вакуумна: импорт `@dsh-mywork/storage` слов `sqlite`/`Database` не содержит. Канонический хост-инструмент плана — `Select-String` | major |
| Q7 | **Q-21** | `Modify` путь завершения попытки/задачи (`packages/execution/src/service.ts`) | **`НЕВЕРНАЯ_СТРОКА`** `LIVE` | в `service.ts` 0 вхождений `TaskState`, `transitionTask`, `applyTaskCommand`, `completedAt`, `TASK_TRANSITIONS`, `integrating` — завершение задачи живёт не там | major |
| Q8 | **Q-21** | «Зависит от» | `ЧАСТИЧНО` `LIVE` | поля «Зависит от» у Q-21 **нет вовсе**, хотя шаг потребляет Q-20 (`worktype.ts`, `FINISH_CRITERIA`, `resolveFinishCriteria`) и виды артефактов (`artifact.ts:62-75` — 12 значений) | major |
| Q9 | **Q-21** | `command-receipt` в требованиях evidence | `ЧАСТИЧНО` | ADR028 относит `command-receipt` к колонке **verification**, а requiredEvidence для `non-git-ops` — `worker-report` (или `build-log`); тест зафиксирует не то | minor |
| Q10 | **Q-24** | `work_proposal` как готовый носитель | `ЧАСТИЧНО` `LIVE` | `CREATE TABLE work_proposal` (`planner/src/schema.ts:112`) есть, но полей provenance/trust/conflict в нём нет (`:113-126`), `kind` — закрытый CHECK из 5 значений | minor |
| Q11 | **Q-31** | `Modify packages/controller/src/doctor.ts` | `ЧАСТИЧНО` `LIVE` | модуля Doctor в дереве нет (`glob **/doctor*` → 0 файлов); Q-31 сам говорит `Create`, но гейт `verify-profile.mjs` работает в **изолированном** `DSH_HOME` и печатает `(isolated; the user profile is not used)` — «3 хэша реального профиля не изменились» этим гейтом не доказывается | major |
| Q12 | **Q-32** | `Modify packages/controller/src/doctor.ts` (секция backend) | `ЧАСТИЧНО` `LIVE` | «Modify» корректен только если Q-31 выполнен первым, но **«Зависит от» у Q-32 отсутствует** — порядок не объявлен | minor |
| Q13 | **Q-33** | `Modify packages/controller/src/doctor.ts`; шаг 0 «`REQUIRED_CONFORMANCE_CHECKS` (`tests/adapters.test.mjs:304`)» | `ЧАСТИЧНО` `LIVE` | зависимость от Q-31 снова не объявлена; `REQUIRED_CONFORMANCE_CHECKS` объявлен в `conformance.ts:61-92`, а в `tests/adapters.test.mjs:304` — лишь `deepEqual`-использование. `runConformance` действительно `:236`, `memoryChecks` `:768` | minor |
| Q14 | **Q-34** | восемь тестов session conformance | `НЕВЕРНАЯ_СТРОКА` | расхождение с фактическим `dsh-session.ts` и дублирование с F-44 | major |
| Q15 | **Q-37** | поверхность worker'а | `ЧАСТИЧНО` (дубль ×3) | шаг дублирует F-56/F-57 и E-39 по одному и тому же коду | major |
| Q16 | **Q-41** | шаг 3 требует `verifyContextSnapshot → missing` | `НЕВЕРНАЯ_СТРОКА` | `core/src/context.ts:670` возвращает только `intact\|drifted`; исхода `missing` у типа нет | major |
| Q17 | **Q-42** | код `MIGRATION_JOURNAL_MISMATCH` | `ЧАСТИЧНО` `LIVE` | F-20 требует `MIGRATION_JOURNAL_INCONSISTENT` — два имени для одного отказа; `MIGRATIONS_REQUIRED` отсутствует и в закрытом `StorageErrorCode` (`storage/src/errors.ts:12-37`) | major |
| Q18 | **Q-44** | «пересборка производных» | `ЧАСТИЧНО` | среди 16 таблиц, создаваемых `packages/**/src`, нет объекта «проекция доски» — пересобирать нечего, пока его не заведёт surface | minor |
| Q19 | **Q-45/Q-46** | peer-контракт, `engines`, тег | `ЧАСТИЧНО` | противоречие с F-48: F-48 требует peer `@deepseek-ai/dsh` **только** в `controller` (гейт «ровно 1 файл»), тогда как Q-45 говорит о peer-манифесте шире | major |
| Q20 | **Q-45/Q-46** | «все 10 строк имеют записанный вывод» | `ЧАСТИЧНО` | гейт невыполним; оговорка «строки 6, 8, 9 зависят от решений D04…» неточна — D04 решён, поэтому строки не «BLOCKED по решению», а неприменимы/непроверяемы | minor |
| Q21 | **Q-47** | матрица приёмки | `ЧАСТИЧНО` | «шаг 2 дублирует F-17/F-25 и сам себя опровергает»: имя переменной уже закреплено (`MYWORK_REQUIRE_BEADS=1`, `20-STEPS-foundation.md`), в тесте сегодня только проба `bd version` | minor |

### 2.4. Гейт карточки MW-074 и правка C-32 (задание Lead'а)

| # | Утверждение | Вердикт | Фактическое значение | Severity |
|---|---|---|---|---|
| C1 | `npx tsx scripts/verify-package-invariants.ts` → exit 0/1 (приёмка MW-074 п. 1; C-32 → MW-039) | **`НЕ_СУЩЕСТВУЕТ`** `LIVE` | Файла **нет** в `H:\Repo\DSH-MyWork`: `scripts\` = `pack.mjs`, `smoke.mjs`, `verify-profile.mjs`, `lib\`; `glob verify-package-invariants*` по репозиторию → 0 совпадений. Скрипт существует ровно в DSH-чек-ауте: `C:\Reposit\deepseek-harness\deepseek-harness\scripts\verify-package-invariants.ts` (21 строка) и сканирует **другой** корень | **major** |
| C2 | `npx tsx …` | `НЕВЕРНАЯ_СТРОКА` `LIVE` | `tsx` отсутствует во **всех 54** `package.json` вне `node_modules` и в `node_modules\.bin`; `npx tsx` потребует сетевой установки. Канон сборки в этом репозитории — `node ../../node_modules/tsdown/dist/run.mjs`, типизация — `node_modules\.bin\tsc.cmd` | major |
| C3 | владелец гейта | `ЧАСТИЧНО` | один и тот же гейт назначен двум карточкам — C-32 (→ MW-039) и MW-074 (приёмка 1); назначения владельца нет | minor |

---

## 3. Неисполнимые шаги (что именно мешает и как переписать)

### 3.1. Блокеры

**N-1 · E-04: асинхронный вызов внутри синхронной транзакции.**
Мешает: `store.transaction<T>(fn: (tx: MyWorkTransaction) => T): T` (`packages/storage/src/store.ts:59`) синхронна; `worktrees.prepare` возвращает `Promise`, поэтому предписанный порядок `allocateFence → insertAttempt → worktrees.prepare → insertAttemptWorktree → событие` внутри одной транзакции невыразим.
Как переписать: (а) вынести `worktrees.prepare` **до** транзакции, а в транзакции писать только результат (`insertAttemptWorktree`), либо (б) разбить на две транзакции с явной компенсацией (при отказе второй — `settleAttempt(..., 'abandoned')`), и назвать в шаге, что идемпотентность обеспечивается `operationId`, а не одной транзакцией. Дополнительно зафиксировать, что `baseSha` читается до `prepare` (уже есть в тесте (д)).

**N-2 · E-17: зависимость от шага чужой карточки.**
Мешает: `E-17` (карточка MW-023) требует `E-19` (карточка MW-024), а `MW-024.md:4` зависит от `MW-023`; критический путь плана сам ставит E-17 перед E-19.
Как переписать: либо понизить E-17 до проверки «гейт-результат существует и привязан к head» (без очереди ревью), а связку «провал гейта блокирует admission» перенести в шаг карточки MW-024; либо явно записать, что E-17 выполняется **после** принятия MW-023 и не является частью её приёмки (и убрать его из критического пути MW-023).

### 3.2. Шаги, у которых гейт не исполняется или не доказывает заявленное

**N-3 · `23-STEPS-quality.md`: 87 из 88 команд `node --test` — в неканонической форме.**
Мешает: `package.json:16` объявляет канон `node --test --test-isolation=none "tests/**/*.test.mjs"`; голый `node --test tests/X.test.mjs` даёт другую изоляцию и другую форму glob. Дополнительно: в `20-STEPS-foundation.md` неканонических 124 из 130.
Как переписать: механическая замена по трём файлам (`20-`, `23-`) на `node --test --test-isolation=none "tests/<name>.test.mjs"`; проверка — `Select-String -Path .work\plan-v0.3\*.md -Pattern 'node --test(?! --test-isolation=none)'` → 0.

**N-4 · Q-11 и Q-21: гейты используют `grep`/`grep -c`.**
Мешает: `grep` в этой среде не установлен (`Get-Command grep` → не найдено; в PATH только ripgrep 15.2.0).
Как переписать: заменить на `Select-String` (канон остального плана) и переформулировать пробу так, чтобы она была не вакуумной (искать `@dsh-mywork/storage`, а не слово `sqlite`).

**N-5 · E-44 / A34 и E-45 / A35: шаг 0 и реализация опираются на несуществующие факты.**
Мешает: команда `Select-String` по `layout.ts` не даёт `:66-68`; у объекта стора нет метода `readOpenHold`.
Как переписать: E-44 — заменить ожидаемый вывод на фактический (`:3,:6,:13,:14,:24,:30,:38,:45,:55,:78,:91`) и указать, какой из них несёт `dsh-mywork`; E-45 — писать `admissionHold: (stores) => openHold(stores.planner, workspaceId) !== undefined` (или как называется фактический член порта), предварительно сверившись с `planner/src/store.ts:612-629`.

**N-6 · MW-074 / C-32: гейт `npx tsx scripts/verify-package-invariants.ts`.**
Мешает: файла нет в MyWork, `tsx` не установлен, скрипт сканирует другой корень.
Как переписать: либо (а) явно добавить в объём шага «портировать `scripts/verify-package-invariants.ts` из платформы в MyWork и адаптировать корень сканирования» + добавить `tsx` в devDependencies (и назвать это изменение манифеста), либо (б) заменить гейт на собственный тест `tests/invariants.test.mjs` + `node --test`-прогон, а платформенный скрипт оставить как внешний ориентир. Назначить **одного** владельца гейта (MW-039 или MW-074).

**N-7 · E-09: цель «revisions записаны в БД» недостижима объявленными файлами.**
Мешает: колонки `revisions` нет ни в `attempt`, ни в `AttemptRecord`; «Файлы» шага — только `worker.ts` + тест.
Как переписать: добавить в «Файлы» миграцию (номер от аллокатора, R-04) + `store.ts`/`contracts/claim.ts`, либо переформулировать цель: «revisions хранятся в артефакте `context-snapshot` и в `attempt`-строке через существующий `revision`-счётчик», и привести гейт в соответствие.

**N-8 · E-13: правка `tests/evidence.test.mjs` не нужна, а её обоснование ложно.**
Мешает: словарь видов артефактов в тестах не пиннится.
Как переписать: убрать `tests/evidence.test.mjs` из «Файлов» и из Evidence; вместо этого добавить `Modify tests/events.test.mjs` (там пиннится `MYWORK_ERROR_CODES`) — если шаг вводит новый код отказа.

**N-9 · E-23/E-25: коды `STALE_APPROVAL`, `INTEGRATION_NOT_APPROVED` отсутствуют в закрытом словаре.**
Мешает: `MyWorkErrorCode` — закрытая юнион из 20 значений, пиннится `assert.deepEqual` в `tests/events.test.mjs:178-199`.
Как переписать: добавить в «Файлы» `packages/contracts/src/operation.ts` и `tests/events.test.mjs`, назвать новые коды явно и синхронно обновить пиннинг; либо переиспользовать существующий `STALE_REVISION` (его возвращает `assertReviewApprovalCurrent`).

**N-10 · E-24: причина `review-loop-exhausted` не может быть добавлена молча.**
Мешает: каталог закрыт (7 значений) и пиннится `tests/board.test.mjs:603-612`.
Как переписать: добавить в «Файлы» `packages/contracts/src/board.ts` + `tests/board.test.mjs`, явно сказать «каталог расширяется с 7 до 8, пиннинг обновляется в этом же коммите»; в регрессии шага назвать `tests/board.test.mjs`.

**N-11 · E-22: `review-verdict.ts` не будет виден потребителю.**
Мешает: `contracts/src/index.ts` реэкспортирует пофайлово.
Как переписать: добавить `Modify packages/contracts/src/index.ts` (одна строка `export * from './review-verdict.ts'`) — как это уже сделано в E-13.

**N-12 · E-31, E-51: «падающий тест» не воспроизводим — поведение уже реализовано и покрыто.**
Мешает: `core/src/plan.ts:482-493` + `tests/plan-mutation.test.mjs:319-328,383,2352-2367` (E-31); `workflowEngine` в дереве отсутствует (E-51).
Как переписать: переформулировать цель из «реализовать отказ» в «зафиксировать тип на уровне контракта + добавить положительный контроль» и заменить «Тест (падающий) → FAIL» на «тест расширяет существующее покрытие; до шага зелёный по рантайм-ветке, красный по типовой (проверяется `tsc`)». Для E-51 — снять формулировку «→ FAIL» и добавить положительный контроль невакуумности сканера.

---

## 4. Дефекты карточек и графа

### 4.1. Граф (независимый пересчёт, `.tmp/plan-v03-verify-b/graph-check.ps1`)

Пересчёт по `.work/tasks/tasks.json` + 18 новых записей + блок правок `dependsOn`:

| Метрика | Значение |
|---|---|
| Узлов | **73** (55 существующих + 18 новых) |
| Висячих ссылок `dependsOn` на несуществующий узел | **0** |
| `self`-зависимостей | **0** |
| Зависимостей от `superseded` | **0** |
| **Циклов** | **0** |
| Совпадение `depth` с заявленным в §3.20 | совпадает по всем 18 |

Вывод: **граф новых карточек корректен**; заявленный в файле цикл `MW-063 → MW-048` действительно был разорван. Это подтверждается независимо (мой скрипт + evidence `verify-b-34`).

### 4.2. Дефекты карточек

| # | Дефект | Вердикт | Факт | Severity |
|---|---|---|---|---|
| K1 | **Шапка `30-CARD-EDITS.md` противоречит телу документа** | **`НЕВЕРНАЯ_СТРОКА`** `LIVE` | строка «Выход» объявляет «**18** новых карточек `MW-056…MW-071`, `MW-073`, `MW-074` (**`MW-072` и `MW-075` отклонены** по правилу 70 %)», тогда как §3.17 определяет `MW-072` как создаваемую карточку («Каркас пакета `@dsh-mywork/web` (шаг `B-01a`)»), §3.18 добавляет `MW-076`, а §3.21 содержит записи `MW-072` и `MW-076`. Фактически новых карточек **20** | **major** |
| K2 | Владение гейтом `verify-package-invariants` раздвоено | `ЧАСТИЧНО` | C-32 (→ MW-039) и MW-074 (приёмка 1) требуют один и тот же гейт | minor |
| K3 | Карточка MW-060 закрывает половину блокера P10 | `ЧАСТИЧНО` | `FINAL-REPORT.md:368` (P10) — «`private: true` ×12, **devDeps на непубликуемые `@dsh-mywork/*`**»; в объёме MW-060 нет пункта про devDeps | major |
| K4 | Критический путь заявляет ребро, которого нет | `ЧАСТИЧНО` | §3.21/§3.3 пишут `F-20/MW-058 → MW-022` («без него MW-022 не имеет живого store»), но `MW-022.md:4` этого ребра не содержит | major |
| K5 | Устаревшие номера строк в якорях карточек | `ЧАСТИЧНО` | в §3.x систематически превышен допуск ±10 по двум источникам (`FINAL-REPORT.md`, `.work/tasks/*`) | minor |
| K6 | Правки «было → стало» в основном соответствуют фактам | `ПОДТВЕРЖДЕНО` | выборочно проверено 12+ правок (C-15…C-48): цитаты «было» находятся в карточках, шапки (Этап/Зависимости/Board ID) не ломаются; исключение — правка MW-049, где цитируемая строка не процитирована в блоке «Почему» | info |
| K7 | ID новых карточек не конфликтуют с занятыми | `ПОДТВЕРЖДЕНО` | `.work/tasks/MW-001…MW-055.md` — 55 файлов; новые ID `MW-056…MW-076` свободны, дублей внутри файла нет | info |

---

## 5. Дубли и противоречия между файлами

### 5.1. Противоречия (по содержанию)

| # | Что противоречит | Файлы | Вердикт | Severity |
|---|---|---|---|---|
| P1 | «`auto-review` **только deny**» против «`auto-review` **активен**, правило живёт в MyWork» | `21-STEPS-execution.md` (карта `:76`, `:162`, заголовок шага E-40 `:838`) **против** `23-STEPS-quality.md` (Q-38 переписан по R-22, `:660-670`) | **`НЕВЕРНАЯ_СТРОКА`** `LIVE` — правка R-22 landed **только в 23-файле** | **major** |
| P2 | Одна и та же коллизия версии миграции | было: `20-` (F-36 `background_job`, F-40 evidence retention) и `21-` (E-04 `attempt_worktree`) заявляли одну и ту же `v7` при едином `user_version` и запрете неуникальных версий (`storage/src/migrations.ts:117-119`) | **исправлено по R-04** (единый аллокатор версий); остаточный след — `20-STEPS-foundation.md:1079` «DDL миграции v7» | minor |
| P3 | Имя кода отказа journal | `23-` (Q-42) требует `MIGRATION_JOURNAL_MISMATCH`, `20-` (F-20) — `MIGRATION_JOURNAL_INCONSISTENT` | `НЕВЕРНАЯ_СТРОКА` | major |
| P4 | Peer-контракт | `20-` (F-48): peer `@deepseek-ai/dsh` **только** в `controller`, гейт «ровно 1 файл» против `23-` (Q-45/Q-46): peer-манифест шире | `ЧАСТИЧНО` | major |
| P5 | Канон команды гейта | `21-`/`22-` используют `--test-isolation=none` (127/128 и 153/156), `23-` — 1/88, `20-` — 6/130 | `НЕВЕРНАЯ_СТРОКА` | major |
| P6 | Baseline полного прогона | `01-MASTER-PLAN.md:48`, `23-STEPS-quality.md:113,854`, `README.md:22` — «**710** тестов / 687 pass / 0 fail / 23 skip»; `21-STEPS-execution.md:93,1138` — «**659** tests / 636 pass». Мой независимый подсчёт: **710** статических `test(` в 28 файлах → верна цифра 710, а 659 — устаревший снимок отчёта MW-019 | `НЕВЕРНАЯ_СТРОКА` (низкая цена: в 21-файле цифра честно помечена как «не воспроизводился», и `90-VERIFICATION-A.md:138` это уже зафиксировала) | minor |
| P7 | `ReconcileReport` | `21-` описывает `{operations, leases, stalls}`; факт — `{operations, leases}` | `НЕВЕРНАЯ_СТРОКА` | major |

### 5.2. Дубли шагов (один и тот же код в двух файлах)

| # | Дубль | Вердикт | Комментарий |
|---|---|---|---|
| D1 | **E-39 ↔ Q-37 ↔ F-56/F-57** — ограничение поверхности worker'а | `ЧАСТИЧНО` | три шага в трёх файлах описывают один и тот же слой (`tools.restrict`/allowlist/deny `cordis_*`); при этом E-39 реализует denylist, а D15/F-56 выбирают allowlist |
| D2 | **E-40 ↔ Q-38** — правило «автоматика не одобряет» | `ЧАСТИЧНО` | один и тот же инвариант, но с разными базовыми линиями (см. P1); `tests/auto-review-policy.test.mjs` назван в **обоих** шагах с **разными** ожиданиями: E-40 `pass 4`, Q-38 `pass 3` |
| D3 | **E-47 ↔ Q-40** — stall-детекция и retention внимания | `ЧАСТИЧНО` | пересечение по носителю `NeedsAttentionReason`; Q-40 сам ссылается на «механику `F-38…F-40`» |
| D4 | **E-13 ↔ Q-22** — словарь `ARTIFACT_KINDS` | `ЧАСТИЧНО` | E-13 добавляет `gate-result` (+1 к 12), Q-22 добавляет три вида (+3); порядок и итоговое число в двух шагах не согласованы (E-13 фиксирует порядок, Q-22 ждёт «15») |
| D5 | **E-24 ↔ Q-16/Q-19** — лимит петель и неблокирующий гейт | `ЧАСТИЧНО` | E-24 порождает запрос решения, Q-17/Q-19 доставляют ответ; разграничение в тексте есть, но шаг E-24 не объявляет зависимость от Q-19 |
| D6 | **E-17 ↔ Q-38/E-40** — «провал гейта блокирует review admission» | `ЧАСТИЧНО` | одна граница описана и как шаг execution, и как инвариант quality |
| D7 | **Q-34 ↔ F-44** — session conformance | `ЧАСТИЧНО` | восемь тестов заявлены дважды |
| D8 | Дублей ID шагов между файлами | **нет** | 209 уникальных объявлений; «дубли» `B-01/B-04/B-05` — артефакт регулярки (в файле `B-01` и `B-01a` и т. д.) |

### 5.3. Что разрешается корректно

- Все **161** уникальный ID `E-*`/`Q-*`/`F-*` в текстах плана разрешаются в объявленный шаг — висячих ссылок **0** (проверено скриптом по всем файлам плана).
- Таблица соответствия «предварительный ID → фактический шаг» в `30-CARD-EDITS.md` §0.6 сверена с фактическими файлами — расхождений не найдено.
- `tasks.json` ↔ `INDEX.md` согласованы (55 записей, `planRevision=2`, `planned=53`, `superseded=2`) — воспроизведено.

---

## 6. Что не удалось проверить и почему

1. **Динамическая исполнимость гейтов.** Тесты, сборка и `pnpm`-команды не запускались (запрет задания). Поэтому «команда гейта выполнима» проверено **статически**: существование пути, инструмента, формы команды. Не проверено фактическое `pass N / fail 0` ни для одного шага.
2. **`corepack pnpm -r run …` (канон R-06).** Утверждение «канонический runner» не проверено: запуск потребовал бы `pnpm`-операций, запрещённых заданием. Ранее в плане фиксировалось, что `pnpm --version` → EXIT=1 в этой среде; расхождение с новым каноном **не разрешено** и требует отдельной проверки владельцем.
3. **Рантайм-поведение платформы.** Инварианты, `tools.restrict`/`guard`, `auto-review`, `ctx.invariants` проверены **по исходникам** DSH-чек-аута (`HEAD c7c4c72`), а не запуском.
4. **Живой профиль `C:\Users\Dmitry\.dsh`** — читался только в объёме, необходимом для сверки утверждений (`ledger-v2.json`, наличие плагинов); поведение профиля при установке UI-пакета не воспроизводилось.
5. **Дрейф артефактов.** `22-STEPS-surface.md`, `10-DECISIONS.md`, `30-CARD-EDITS.md` переписывались **во время** проверки (см. §0). Все находки помечены ревизией; часть выводов первого прохода (по 21-файлу, 1126 строк) перепроверена по содержанию, но не все: шаги **E-02…E-10, E-28…E-38, E-43…E-49** в первом проходе читались на редакции 1126 строк и повторно на текущей (1181) **не** сверялись построчно — их вердикты даны по содержанию (имена файлов/символов/кодов), и по этим признакам они остаются в силе.
6. **Новые карточки `MW-072`, `MW-076`** появились уже после первого прохода; проверены только на согласованность с §3.21 и графом, но **не** на исполнимость их приёмок.
7. **`npx tsx`** — не проверено, что `npx` в этой среде вообще доступен (проверено только отсутствие `tsx` в манифестах и в `node_modules\.bin`).
8. **`90-VERIFICATION-A.md`, `92-RED-TEAM-A/B.md`, `93-VERIFICATION-SURFACE.md`** появились в ходе прогона и мной системно **не** разбирались — возможны пересечения находок (в частности, R-04/R-07/R-22 в этих файлах уже описаны).

---

## 7. Вердикт

### 7.1. Можно исполнять как есть

- **`21-STEPS-execution.md` §1 (инвентарь с якорями), §2 (карта шагов), §17–§19 (границы, «не проверено», сводка).** Якоря §1.1 подтверждены 8/8 с точностью до строки; карта шагов внутренне согласована; ссылки на `F(тема)` корректны; дублей ID нет.
- **Группы E, I, J, L, M в части шагов, у которых вердикт `ПОДТВЕРЖДЕНО`:** E-10, E-15, E-18, E-33, E-34, E-36, E-37, E-38, E-49. Их якоря, счёты тестов, формы команд и отсутствие дублей проверены.
- **`23-STEPS-quality.md` §0 (введение, границы, метод), §5 (что не делать), §6 (не проверено), §11–§12 (реестр доказательств, DoD).**
- **`30-CARD-EDITS.md` §1 (находки леджеров), §3.21 (готовый блок `tasks.json`), §4 (управление леджерами).** Граф новых карточек — 0 циклов, 0 висячих ссылок, `depth` совпадает.
- **Якоря контрактов, `core`, `evidence`, платформы DSH** — можно использовать как справочные без перепроверки.

### 7.2. Исполнять нельзя без правки

| Что | Почему |
|---|---|
| **E-04** (порядок в транзакции) | blocker N-1: async внутри синхронной `store.transaction` |
| **E-17** (зависимость от E-19) | blocker N-2: циклическая карточная зависимость MW-023 ↔ MW-024 |
| **E-08, E-09, E-13, E-20, E-22, E-23, E-24, E-25, E-26, E-31, E-39, E-40, E-42, E-44, E-45, E-51** | неверные строки/несуществующие символы/недостижимые гейты — см. §2.2 и §3 |
| **Q-01, Q-11, Q-21, Q-31, Q-32, Q-33, Q-34, Q-37, Q-41, Q-42, Q-45, Q-46** | то же для 23-файла — см. §2.3 и §3 |
| **Все гейты `23-STEPS-quality.md` (87 из 88) и 124 из 130 в `20-STEPS-foundation.md`** | неканоническая форма `node --test` (N-3) |
| **Приёмка MW-074 и правка C-32 (MW-039)** | гейт `npx tsx scripts/verify-package-invariants.ts` неисполним (N-6) |
| **Шапка `30-CARD-EDITS.md`** | противоречит собственному телу (K1) |
| **E-40 / карта шагов в `21-`** | противоречит `23-` (P1): R-22 landed только в 23-файле |

### 7.3. Итоговая оценка

План **пригоден к исполнению после адресных правок**: 44 из 64 проверенных якорей подтверждены буквально, граф карточек корректен, ссылки разрешаются, счёты тестов согласованы. Опасность сосредоточена не в архитектуре, а в **трёх классах дефектов**:

1. **Ссылки на факты, которых нет** (несуществующие коды отказа, поля, методы, `prompt` у порта, `packages/controller/src/doctor.ts`, `scripts/verify-package-invariants.ts`) — 14 находок `НЕВЕРНАЯ_СТРОКА` и 4 `НЕ_СУЩЕСТВУЕТ`.
2. **Гейты, которые не доказывают заявленное** (неканоническая форма `node --test`; отсутствие сборки перед тестом в 7 шагах; вакуумные `grep`-пробы; тесты, дублирующие уже зелёное покрытие) — 43 находки `ЧАСТИЧНО`.
3. **Расхождения между файлами плана** (P1, P3, P4, P5, P7; дубли D1–D7) — цена в том, что исполнитель двух шагов будет править один и тот же код по-разному.

**Отдельно отмечу положительную динамику:** из четырёх самых тяжёлых находок первого прохода две (коллизия версии миграции `v7` и висячая зависимость `MW-048 → MW-072`) **устранены владельцами в ходе верификации**, и обе — по содержанию, а не косметически. Это подтверждает, что цикл «red-team → правка» работает; незакрытым из этого класса остаётся только P1 (`auto-review` в 21-файле).

---

## 8. Приложение: проверка правок R-04…R-22 (по заданию Lead'а)

| Правка | Landed? | Где проверено / что осталось |
|---|---|---|
| **R-04** единый аллокатор версий вместо литералов | **ДА** | `21-`: E-04 переписан («номер выдаёт единый аллокатор (D08, §1.6; литералов версий нет)», риск (4) сам называет дефект R-04); `20-`: F-40 «`version: 7` литералом **не писать**». **Остаток:** `20-STEPS-foundation.md:1079` (Evidence) всё ещё пишет «DDL миграции **v7**» — единственный оставшийся литерал |
| **R-05** «Шаг 0» с UUID для доски | не проверял | вне моего write-scope; отдельная проверка не выполнена (§6, п. 8) |
| **R-06** канон `corepack pnpm -r run` | **внесено, но не подтверждено** | 58 упоминаний `corepack pnpm` в файлах плана. **Исполнимость не проверена**: запуск `pnpm` запрещён заданием; ранее план фиксировал `pnpm --version` → EXIT=1 в этой среде |
| **R-07** убраны `-SimpleMatch`-гейты | **ДА** | `-SimpleMatch` осталось 0 раз в шагах: 6 совпадений — в описании самого дефекта (`01-MASTER-PLAN.md:480`, `92-RED-TEAM-A.md:94,179`) и в пояснении шага (`21-`: «Негативная (регулярка, **без** `-SimpleMatch`)»). E-01 теперь двухкомандный с позитивным контролем |
| **R-08** allowlist в boundary + локальный гейт F-58 | **внесено** | в `20-` присутствует F-58; **но** формулировки E-39/E-40 в `21-` на момент проверки остались deny-ориентированными — расхождение с D15/allowlist сохраняется |
| **R-09 / R-12** циклы карточек разорваны, добавлены `MW-072`/`MW-076` | **ДА (граф) / НЕТ (шапка)** | Граф: 0 циклов, `MW-072` и `MW-076` присутствуют в JSON-блоке §3.21, `MW-048.dependsOn = ["MW-029","MW-072","MW-060"]` внесён. **Но** шапка документа (`30-CARD-EDITS.md`, строка «Выход») по-прежнему объявляет «18 новых карточек … `MW-072` и `MW-075` отклонены» → противоречие с §3.17/§3.18/§3.21 |
| **R-10** поле `failedRunAccepted` | не проверял | не входило в мой план проверок (§6, п. 8) |
| **R-13** ссылки на строки заменены ID | **ЧАСТИЧНО** | висячих `E-*`/`Q-*`/`F-*` — 0; **но** адресация «`файл:строка`» осталась в якорях шагов и карточек и систематически устаревает при правках (K5). Требование R-13 выполнено для ссылок **между шагами**, не для якорей в первоисточники |
| **R-22** `auto-review` переписан как активный | **ТОЛЬКО в `23-`** | `23-STEPS-quality.md`: Q-38 переписан («при **активном** `auto-review`», базовая линия `enabled: true`, `include: auto-review`, `fiberPhase: active`). **`21-STEPS-execution.md` не обновлён:** карта `:76`, `:162` и заголовок шага `:838` по-прежнему «`auto-review` только deny» — это **незакрытая правка**, самый ценный пункт этого приложения |

---

**Файлы evidence:** `.work/plan-v0.3/evidence/verify-b-01…06` (якоря), `verify-b-11…21` (шаги первого прохода), `verify-b-31…34` (карточки), `verify-b-41…44` (шаги на текущей ревизии).
**Скрипты:** `.tmp/plan-v03-verify-b/graph-check.ps1` (граф 73 узла, циклы, depth), `.tmp/plan-v03-verify-b/consistency-check.ps1` (дубли ID, разрешение ссылок, счёты тестов, несуществующие пути), `.tmp/plan-v03-verify-b/anchors-check2.csv` (машинная сверка 516 якорей).

---

## Дельта 0.2.0-rc.2 (2026-10-03)

### 1. Статус раздела и роль

Роль прежняя: `verifier-b`, состязательный верификатор шагов `E-01…E-52`, `Q-01…Q-47`, правок карточек и дублей/противоречий между файлами. Раздел — **продолжение** файла после актуализации плана под DSH `0.2.0-rc.2`; вердикты прохода 2026-09-27 (§0–§8) заморожены и не переписываются: где дельта их отменяет, это сказано ниже явно.

Объект проверки — `02-PLATFORM-DELTA-0.2.0-rc.2.md` и фактическое состояние плана после правок кампании 2026-10-03. **Текст дельты — объект, а не доказательство:** каждое её утверждение ниже либо воспроизведено командой, либо помечено как непроверенное. Проверка шла на чекауте `639ed0153` (проверено: `git log -1 639ed0153` → `639ed015397290b3745d163aafe02ffee4aa3f84 (HEAD -> master, tag: dsh-v0.2.0-rc.2)`) и на текущих файлах плана (`20-` 1980, `21-` 1208, `22-` 1570, `23-` 888, `01-` 593, `30-` 1427, `00-RECON.md` 241 строк).

Инструменты: `git show/grep`, `Select-String`, `rg` 15.2.0, `node scripts/check-plan-citations.mjs`, `node -e` с `semver@7.8.5` из чекаута. Сборка, тесты, `pnpm install`, полные прогоны и правки живого профиля не запускались (запрет задания); живой профиль читался только на чтение. Другие файлы не правились, новых файлов не создавалось.

### 2. Что дельта меняет в вердиктах этого файла

| Вердикт/класс (раздел этого файла) | Затронут | Новое состояние |
|---|---|---|
| **§8 R-22 → `21-` карта `:76,162,838`** | R-22/R-03 | **ЗАКРЫТО.** В `21-STEPS-execution.md` карта связей `:78`, индекс шагов `:164`, заголовок `:855`, тело `:856-864`, §18 п.19 `:1175` говорят «смонтирован и активен (`enabled: true`, `fiberPhase: active`), deny-only режима у пакета нет — это правило MyWork»; в `23-` — `:60`, `:670-671`, `:818`, `:847`, `:857`. Прежняя формулировка осталась только как цитата прежнего состояния в разборе дефекта (`21-:831`). **Остаток вне правки:** `01-MASTER-PLAN.md:193`, `:295` (см. NB-3) |
| **§7.2 «E-40 / карта шагов в `21-`»** | R-22 | Закрыто по существу, но карта `:164` обещает `pass 4 / fail 0`, тело шага `:868` — `pass 5 / fail 0`, а дублирующий Q-38 (`23-:678`) — `pass 3 / fail 0` на **тот же** `tests/auto-review-policy.test.mjs` (см. NB-7) |
| **§3.1 N-1 (E-04, blocker)** | — | **ЗАКРЫТО** (R-35): `21-:249` — «две синхронные транзакции, асинхронный шаг между ними», обоснование `store.transaction` синхронна (`packages/storage/src/store.ts:59`); `21-:1176` фиксирует закрытие |
| **§3.1 N-2 (E-17, blocker)** | — | **ЗАКРЫТО**: `21-:454-455` — «шаг **не** зависит от `E-19`», зависимость только `E-16`, разрыв цикла назван; `21-:1176` |
| **§3.2 N-3 (канон `node --test`)** | — | **ЗАКРЫТО для команд**: `20-` 138/138 с флагом, `23-` 99/99, `21-` 128/130 (2 упоминания — проза на `:93` и лог правок `:1175`), `22-` 159/162 (3 — проза `:325`, заголовок и текст `§7a` `:1224,1226`) |
| **§3.2 N-6 (приёмка MW-074 `npx tsx`)** | — | **ЗАКРЫТО** (R-33): `23-:648`, `:858`; `30-CARD-EDITS.md:1049-1056` — свой модуль + тест `tests/invariants-runtime.test.mjs` |
| **§2.2 N-7 (E-09, `revisions` в БД)** | — | **ОСТАЁТСЯ:** `21-:337` по-прежнему «`revisions` пишутся в `attempt`-путь через существующий `settle`-путь», хотя `attempt` не имеет такой колонки (`packages/execution/src/schema.ts:120-133`), а `settleAttempt` пишет только `state/revision/settled_at` (`packages/execution/src/store.ts:428-453`) |
| **§2.3 Q-01, Q-21, Q-41** | — | **ОСТАЮТСЯ:** Q-01 называет точкой вставки `packages/execution/src/service.ts`, где 0 вхождений `AgentStartRequest`/`.prompt`/`ContextSnapshot`/`runtime.start`; Q-21 — тот же файл для пути завершения (0 вхождений `TaskState`/`transitionTask`/`completedAt`); Q-41 (`23-:712`) требует исход `missing` у `verifyContextSnapshot`, у которого исходов два (`packages/core/src/context.ts:644-645`; `missing` — причина дрейфа, `:697`) |
| **§2.3 Q-31/Q-32/Q-33 (`doctor.ts`)** | — | **ЗАКРЫТО:** `23-:569` — `Create`, §593 — «**зависит от Q-31**» |
| **§2.3 Q-42 / §5.1 P3 (имя кода журнала)** | — | **ЗАКРЫТО:** в дереве только `MIGRATION_JOURNAL_INCONSISTENT` (`20-:558,561`); второе имя встречается лишь в списке «не встречается вовсе» (`23-:857`) |
| **§5.1 P4 (peer «только controller»)** | — | **ЗАКРЫТО:** `20-:1652` — «**ровно 2 файла** — `controller` и `web`»; `23-:75`, `:771` переводят Q-45/Q-46 в шаги-ссылки на `F-47…F-50` |
| **§5.1 P7 (`ReconcileReport.stalls`)** | — | **ЗАКРЫТО:** `21-:982` — «`{operations, leases}` — существующая форма; поле `stalls` не вводится» |
| **§5.1 P5 (канон команд)** | — | Закрыто (см. N-3 выше) |
| **§5.1 P6 (baseline 659 vs 710)** | — | **ОСТАЁТСЯ (minor):** `21-:95` всё ещё `659 tests / 636 pass`, но теперь честно помечено «не воспроизводился в этой кампании»; мастер `:50` и `23-:113` дают 710 |
| **§4.2 K1 (шапка `30-`)** | — | **ЗАКРЫТО** (R-34): `30-CARD-EDITS.md:5` — 20 карточек, диапазон `MW-056…MW-076`, отклонена `MW-075` |
| **§4.2 K2 / N-6 (владение гейтом)** | — | **ЗАКРЫТО:** гейт MW-074 — `tests/invariants-runtime.test.mjs` (`23-:648`), MW-039 — `tests/invariants.test.mjs` (`30-:447`); раздвоения нет |
| **§2.2 S29 (E-51 «→ FAIL»)** | — | **ОСТАЁТСЯ (смягчено):** `21-:1064` — «FAIL (тест создан, проверка ещё не проходит **по формулировке**)», при том что проверка (а) уже зелёная: `workflowEngine` в `packages/**/src` MyWork — 0 совпадений |
| **§2.2 S24 (E-40 «только deny»)** | R-22 | Закрыто; см. первую строку и NB-7 |
| **§2.2 A34/E-44 (`layout.ts:66-68`)** | — | **ЗАКРЫТО:** шаг 0 E-44 теперь ждёт `:78`, `:82-83`, `:91-93` (`21-:944`) — сверено с `packages/storage/src/layout.ts` (`DSH_HOME_ENV` `:78`, `root/stateDir` `:82-83`, `stateDatabasePath` `:91-93`) |
| **§2.2 A35/E-45 (`readOpenHold`)** | — | **ЗАКРЫТО:** `21-:960` — метод фасада `openHold` |
| **§2.2 S23 (E-39 deny vs allowlist)** | R-08 | **ЧАСТИЧНО:** заголовок `:835`, тексты `:41`, `:833`, §17.4 `:1127` — allowlist; **но** строка карты `:76` всё ещё `tools.restrict({deny})` (см. NB-3) |
| **§2.3 Q-36 (`./invariant`)** | D4 | **ЗАКРЫТО по шагу:** `23-:632-649` — шов отклонён, «`./invariant` и `ctx.invariants.register` НЕ используются»; `30-:1049-1056` то же. **Но** карта `21-:77` продолжает числить «Регистрация `./invariant` + `ctx.invariants`» (NB-3) |
| **§5.2 D1 (`E-39 ↔ Q-37 ↔ F-56/F-57`)** | R-14 | **ЧАСТИЧНО закрыто:** Q-37 `23-:652-657` и E-39 `21-:835` объявлены шагами-ссылками на `F-56`; фильтр не дублируется |
| **§2.2 S28 / Q-45/Q-46 (peer шире)** | — | Закрыто (P4 выше) |
| **D11 (права роли)** | D11 | **ЗАКРЫТО:** граница «права сессии — понятие доски» внесена `21-:879`, проверка — в шаге 0 `E-41` (`21-:888`) |
| **D1 (`askTimed`)** | D1 | **ЗАКРЫТО:** `23-:110`, вводный абзац группы B `:253` (с заменой посылки «таймаута нет»), `Q-17` `:366`, сводка `:887` |
| **D2 (23 → 25 контрибьюций)** | D2 | **ЗАКРЫТО:** `22-:867` — «статический список 25 контрибьюций (`:4-29`; монтирование `:181-188`; `$mount` `:189`)» |
| **D4 (`invariants`)** | D4 | Q-36 закрыт; остаток — карта `21-:77` |
| **D5/D6 (некумулятивный `measure`, breaker на `pre-step`)** | D5, D6 | **ЧАСТИЧНО:** закрыто в потребителе (`21-:1019`, `§17.7` `:1145`), **не закрыто** у владельцев `F-51/F-52/F-53` (`20-`) и в решении D05 (`10-DECISIONS.md:583`) — см. NB-1, NB-2 |
| **D7 (дерево подзадач)** | D7 | **ЗАКРЫТО как риск:** 0 шагов на `teamRun`; оговорка `21-:1206`, проверка `30-:1422` |
| **D10 (Inspect-дамп композиции)** | D10 | **ОСТАЁТСЯ в силе как «не проверено»** (`21-:853` риск 1, `§18` п.3 `:1159`); сам D10 **не** отменяет дамп композиции профиля — он про **клиентские** запросы (см. §3, строка про inspect) |

### 3. Что перепроверено лично

| # | Утверждение (источник) | Команда | Наблюдение | Вердикт |
|---|---|---|---|---|
| 1 | R-22 в `21-` внесён (дельта §6) | `Select-String -Path 21-STEPS-execution.md -Pattern 'deny-only\|только deny\|denyOnly'` | 11 совпадений, из них живых утверждений «только deny» — 0: `:78`, `:164`, `:855`, `:856`, `:864`, `:1175` говорят «активен»; `:831` — цитата прежнего состояния; `:76` — `restrict({deny})` (E-39) | **ПОДТВЕРЖДЕНО**: R-22 закрыт; остаток — `:76` |
| 2 | `23-` Q-38 переписан (R-22) | `Select-String 23-STEPS-quality.md -Pattern 'deny'` | `:60`, `:670`, `:671`, `:818`, `:847` — «deny-only режима нет; правило MyWork» | **ПОДТВЕРЖДЕНО** |
| 3 | Платформа: deny-only режима у пакета нет | `git show 639ed0153:packages/experimental/auto-review/src/index.ts` (`:64-67`), `git grep -E 'denyOnly\|deny-only\|deny_only' 639ed0153 -- packages` | решения — `low/allow`, `medium/allow`, `medium\|high/deny` (`:64-67`); grep → **0** совпадений (exit 1) | **ПОДТВЕРЖДЕНО** |
| 4 | `auto-review` активен, ревьюер только под пресетом `auto` | `Select-String … auto-review\src\index.ts -Pattern 'AUTO_PRESET\|overrideOf'` | `:710` — ветка `never` → `denied`; `:641` `denied`, `:657` `askUser`; `:691`, `:731` — сверка с `AUTO_PRESET`; `:24` — импорт | **ПОДТВЕРЖДЕНО** |
| 5 | F-48 «факт 6» и строка 20 таблицы опровержений исправлены | `Select-String 20-STEPS-foundation.md -Pattern '0.3.0-0\|0.2.0-rc.2'` | `:1317-1318` — диапазоны с замером semver, `^0.1.7`/`~0.1.7`/`>=0.1.7 <0.2.0` → **false**, ловушка `<0.3.0` без `-0`; `:1688` — строка 20 «ОПРОВЕРГНУТО и ИСПРАВЛЕНО 2026-10-03» | **ПОДТВЕРЖДЕНО** |
| 6 | Матрица §5.1 дельты (24 клетки) | `node -e` с `semver@7.8.5` из `packages/boot/app-boot/node_modules/semver`, `{includePrerelease:true}`, 12 ключевых клеток | все 12 совпали с таблицей: `0.2.0-rc.2`/`0.2.0`/`0.2.1-alpha.1` против `>=0.1.7-rc.2 <0.3.0-0` → true; `0.3.0-rc.1`/`0.3.0` → false; `0.2.0` против старого `<0.2.0` → false; `^0.1.7` против `0.1.7-rc.2` → false | **ПОДТВЕРЖДЕНО** (расхождений 0) |
| 7 | F-64/гейт цитат: `PASS`, findings 0, advisories 59, exit 0 (дельта §7.1 п.6) | `node scripts/check-plan-citations.mjs --dsh-checkout C:\Reposit\deepseek-harness\deepseek-harness` | `plan=H:\Repo\DSH-MyWork\.work\plan-v0.3 version=0.2.0-rc.2 commit=639ed0153`, `PASS`, advisory 59, **EXIT=0** | **ПОДТВЕРЖДЕНО** (буква в букву) |
| 8 | F-2: гейт сканирует корневой `README.md` fail-closed | `Select-String scripts/check-plan-citations.mjs -Pattern 'README\|superseded-range'` | `:299-310` — `readmePath = join(repoRoot,'README.md')`, `existsSync` → `exit`-сообщение, `scanFile(repoRoot,'README.md')` | **ПОДТВЕРЖДЕНО** (в коде) |
| 9 | D2: 25 контрибьюций, `$mount :189` | `git show 639ed0153:packages/api/remotes/src/client/index.ts` (`:181-189`) | пересчёт имён: 5+4+5+2+7+2 = **25**; список `:181-188`, `$mount` `:189`; `productAnalyticsRemote` `:182`, `userQuestionsRemote` `:187` | **ПОДТВЕРЖДЕНО** |
| 10 | D5: `totalTokens` — текущее давление, может уменьшаться | `git show … packages/llm/token-meter/src/index.ts` (`:146,158-171,187`) | `:187` — `totalTokens: Math.max(0, baseline.tokens + surfaceDeltaTokens)`; `:158-171` — baseline из usage последнего вызова либо эвристики | **ПОДТВЕРЖДЕНО** |
| 11 | D6: `agent/pre-step` — управляющий waterfall | `git show … packages/core/agent/src/runtime-types.ts` (`:112,320`) | `:320` — `'agent/pre-step'… next: () => Promise<PreStepDecision>`; `:112-119` — `PreStepDecision = {kind:'reject'} \| {kind:'enter', messages}` | **ПОДТВЕРЖДЕНО** |
| 12 | D7: `teamRun` не соблюдает пин прав подзадачи; `maxSubtaskDepth` по умолчанию 1 | `…dsh-client-ui-task-board\lib\types\core\tasks.d.ts:216-223`; `Select-String lib/client.js -Pattern 'subtaskDepth'` | `:221` — «a subtask's own permission pin cannot be honored in this mode»; `client.js:1552`, `:4090` — `?? 1` | **ПОДТВЕРЖДЕНО** |
| 13 | D7 (вторая половина): план не строит на дереве подзадач | `Select-String .work/plan-v0.3/*.md -Pattern 'teamRun'` | 6 упоминаний, все — оговорки/исторические цитаты (`21-:1206`, `30-:1422`, мастер `:102`, дельта `:52,298`); шагов, использующих `teamRun`, нет | **ПОДТВЕРЖДЕНО** |
| 14 | D4: `invariants` ещё в дереве, но шов снимается | `git show 639ed0153:packages/bundle/sdk-minimal/cordis.patch.yml` (`:101-122`) | строки `invariants` `:106-107`, `session-invariant` `:109-110`, `agent-invariant` `:112-113`, `scope-invariant` `:115-116`, `agent-loop-invariant` `:118-119` — на месте | **ПОДТВЕРЖДЕНО** |
| 15 | D11: `sessionDefaultPermission` — понятие доски, в DSH 0 совпадений | `git grep -n sessionDefaultPermission 639ed0153 -- "packages/**/src"` | **0** строк вывода | **ПОДТВЕРЖДЕНО** |
| 16 | D10: клиентский Inspect — таймаут 10 000, fail-fast без живой страницы | `git grep -n clientInspectTimeoutMs 639ed0153 -- packages` | `cordis-host-runner/src/index.ts:136` — `.default(10_000)`; `inspect-registry.ts:186` — «has no connected Harness page. Open or reconnect the Harness page, then retry»; `README.md:50` — «Host queries are unaffected by this timeout» | **ПОДТВЕРЖДЕНО**; подпункт дельты «`submit` → `{accepted}`» в указанных путях **не воспроизвёлся** (0 совпадений `submit` в `cordis-host-runner`, в `tool-cordis/src/index.ts` объявлены только `cordis_inspect_list`/`cordis_inspect_query`) |
| 17 | B-27: перемер `data-dsh-*` = 28/9/3 | `rg -o --no-filename -g "*.ts" -g "*.tsx" -g "*.css" -g "!**/lib/**" -g "!**/dist/**" "data-dsh-[a-zA-Z-]+" packages apps` (из чекаута) | 28 вхождений / 9 файлов / 3 имени: `automatic-focus` ×16, `boot` ×6, `boot-spinner` ×6 | **ПОДТВЕРЖДЕНО** — числа `22-:988` и дельты совпали |
| 18 | 22-: якоря диапазона поправлены | чтение строк `:100,241,316,318,790,926` | `:316`, `:318`, `:911`, `:926` — канон `>=0.1.7-rc.2 <0.3.0-0`; `:790` — peer контроллера; `:100` — исторический peer 0.4.4 (`>=0.2.0-rc.1`), `:241` — bare-имя, не диапазон | **ПОДТВЕРЖДЕНО** |
| 19 | 22-:971 переякорен (`ui-sidebar` сортировка) | `git show 639ed0153:packages/client/ui-sidebar/src/client/index.ts` (`:51-55`) | `:53` — `order: options.order ?? 0`; `:54` — `.sort((a, b) => a.order - b.order)`; файл 100 строк | **ПОДТВЕРЖДЕНО** (дельта называла `:53-54`) |
| 20 | 23-: вводный абзац группы B и `repair.ts` | чтение `23-:253`; `git show … packages/core/session/src/repair.ts` | `:253` несёт дельту D1 и `repair.ts:96` («файл 211 строк, класс `ToolCallRecovery` — `:105`»); на `639ed0153` — 211 строк, `:96` закрытие хода, `:105` класс | **ПОДТВЕРЖДЕНО** |
| 21 | 23-: пользовательские вопросы (`askTimed`) | `git show … packages/interaction/user-questions/src/index.ts` (`:43,138-143,187,234,261`) | `:43` — `TimedUserQuestionResult = … \| { pending: true; callId }`; `:234` — `async askTimed(`; `:261` — `ASK_TIMED_OUT` → `{pending:true, callId}`; `:187` — `source: {kind:'user-question-reply', callId, outcome:'answered'}`; `:138-142` — `DELEGATED_CALLER` | **ПОДТВЕРЖДЕНО** поштучно |
| 22 | 30-: карточки/шапка/`dependsOn` | чтение `30-:5`, `:1422`, `:3.24` (JSON-блок `:1151,1178,1181`) | шапка — 20 карточек (`MW-056…MW-076`), `MW-072` переиспользован; блок JSON содержит `MW-048.dependsOn = ["MW-029","MW-072","MW-060"]`, `MW-042` → `MW-003,MW-072`; живой `tasks.json` ещё без этих правок (ожидаемо — правит card-ledger) | **ПОДТВЕРЖДЕНО** (граф), правки леджера не применены |
| 23 | Дельта §3: три битых пути в evidence | `Get-Content evidence/foundation-58-web-package.md` `:19`; `evidence/lead-03-peer-gate.md` `:53`; `evidence/execution-05.md` `:18` + `git cat-file -e 639ed0153:<путь>` | Все три **не исправлены**: `packages/client/modules/src/manifest.ts` (реально `…/src/client/manifest.ts`, exit 0), `packages/lib/process.mjs` (реально `scripts/lib/process.mjs` — существует в **MyWork**), `apps/cli/tests/web-agent-presets-e2e.ts` (реально `apps/cli/tests/web-agent-presets.e2e.ts`, exit 0) | **НЕ ИСПРАВЛЕНО** (NB-10) |
| 24 | Дельта §3: MISSING-якорь закрыт | `Get-Content evidence/foundation-48-peer-contract.md` `:171` | строка несёт пометку «Якорь исправлен 2026-10-03, P0.5: `packages/web/package.json:42` — `:38` это скрипт сборки, Δ=4» | **ПОДТВЕРЖДЕНО** |
| 25 | §7.2 E-09 / Q-01 / Q-21 / Q-41 (мои старые находки) | `Select-String packages/execution/src/service.ts`; `schema.ts:120-133`; `store.ts:428-453`; `core/src/context.ts:644-645,697` | E-09 `21-:337` неверен (нет колонки `revisions`, `settleAttempt` пишет `state/revision/settled_at`); Q-01 — 0 вхождений `AgentStartRequest/.prompt/ContextSnapshot/runtime.start`; Q-21 — 0 вхождений `TaskState/transitionTask/completedAt`; Q-41 `23-:712` требует несуществующий исход `missing` | **НЕ ИСПРАВЛЕНО** (NB-4, NB-5, NB-6) |

**Машинные проверки (перезапуск моего Приложения на текущей ревизии).** Скрипт `.tmp/plan-v03-verify-b/consistency-check.ps1` (без изменений) плюс отдельные прогоны:

| Проверка | Было (§1–§8) | Стало (2026-10-03) |
|---|---|---|
| Дубли ID шагов | 209 уникальных, «дубли» B-01/B-04/B-05 — артефакт регулярки | **211** уникальных ID; 5 «дублей» — те же суффиксные пары (`B-01`/`B-01a` `22-:273,295`; `B-04`/`B-04L` `:399,433`; `B-05`/`B-05L` `:475,501`; `B-30`/`B-30a` `:1055,1228`; `B-39`/`B-39a` `:1207,1243`). Реальных дублей — **0** |
| Число шагов | E-51, Q-47, F-63 (209 с B) | **E-52, Q-47, F-64, B-51 = 214** объявленных заголовков (`20-` 64, `21-` 52, `22-` 51, `23-` 47) |
| Разрешение ссылок `E-*`/`Q-*`/`F-*` | 161 уникальный ID, висячих 0 | **173** уникальных ID, висячих **0**; 10 «неразрешённых» — вне пространства шагов: `F-1…F-8` — находки ревью дельты (`02-:234-241`, `:253-260`, `:267`), `E-53`/`Q-48` — проспективные ID (`02-:136`) |
| Битые ссылки `<файл>.md:NNN` | не измерялось | 452 ссылки в `plan-v0.3`; разрешились по имени файла 440; проблемных **16**: 3 — за концом `00-RECON.md` (241 строка) в `21-:586` (`:250`), `:662`, `:666` (`:284`); 1 — `README.md:448` при 446 строках (в самой дельте, §7.3 F-2); 12 — файлы вне дерева (`v0.2-decisions.md`, `publish.md`, `adding-a-settings-card.md`) |
| Заявленные счёты тестов vs «описано N тестов» | 1 расхождение (Q-01 — ложное) | 3 флага, все — артефакты измерения: E-52 и Q-47 — последние шаги файлов, тело скрипта уходит до EOF и подхватывает `pass 7` из `21-:1176` и матрицы 23-го; Q-01 (`23-:140`) — «17 тестов» относится к существующей сюите `tests/runtime.test.mjs`, гейт `pass 3` — про новые. **Реальных расхождений 0** |
| Несуществующие пути файлов | 3 битых пути в evidence + `verify-package-invariants` | Наивная проверка даёт 171 «нет файла» из 347 — в основном цели `Create`; три битых пути в evidence **не исправлены** (NB-10), гейт MW-074 исправлен |
| Карточки (граф) | 73 узла, 0 циклов | Без изменений по графу; правки §3.24 ещё не применены к `.work/tasks/tasks.json` |

### 4. Новые находки

**NB-1 · D5/D6 закрыты у потребителя и не закрыты у владельца бюджета (major).** Дельта §6 адресует бюджетный мост в `F-51/F-52` (`20-`), но правки D5/D6 внесены только в `21-STEPS-execution.md:1019` (E-48) и `§17.7` `:1145`. В `20-STEPS-foundation.md` **0 вхождений** «накоп», «некумулятив», «давление», «pre-step»; F-51 (`20-:1390-1418`) в шаге 1 строит `BudgetCharge` как `tokens: knownAmount(totalTokens)`, то есть берёт **снимок давления** за накопленный расход — ровно то, от чего предостерегает D5. Итог: шаги-владельцы канона «2M токенов на попытку» (`F-52` `:1438`) не содержат правила «накапливать положительные дельты», а потребитель на него ссылается.

**NB-2 · Открытый вопрос D05 закрыт дельтой, но не в решении (major).** `10-DECISIONS.md:583` перечисляет как неизвестное «даёт ли `agent/pre-step` управляющий возврат (отказ/остановка) или он только наблюдательный — от этого зависит, можно ли остановить…». D6 отвечает: waterfall управляющий (`runtime-types.ts:320`, `PreStepDecision` `:112`, ветка `{kind:'reject'}`) — проверено мной лично (строка 11 §3). Карта §6 дельты не назначила правку владельцу D05, F-53 (`20-:1447-1467`) тоже не называет точку монтажа breaker'а.

**NB-3 · Остатки «deny» и `./invariant` вне правленых мест (major).** (а) `01-MASTER-PLAN.md:193` и `:295` несут живые формулировки «`auto-review` — только deny» без оговорки R-22, которая есть в том же файле на `:150`, `:322`, `:396`; (б) карта связей `21-STEPS-execution.md:76` описывает слой E-39 как `tools.restrict({deny})`, тогда как `:41`, `:833`, `:835`, `:1127` того же файла требуют **allowlist**; (в) карта `21-STEPS-execution.md:77` числит тему Q-36 как «Регистрация `./invariant` + `ctx.invariants`» — то, что сам Q-36 (`23-:636`) после дельты D4 **запрещает**.

**NB-4 · E-09: запись `revisions` в `attempt` невозможна (major, старая находка не закрыта).** `21-:337` — «`revisions` пишутся в `attempt`-путь через существующий `settle`-путь (`packages/execution/src/store.ts:428`)». Факт: в `CREATE TABLE attempt` (`packages/execution/src/schema.ts:120-133`) колонки `revisions` нет, а `settleAttempt` (`store.ts:428-453`) выполняет `SET state = ?, revision = revision + 1, settled_at = ?`. Контракт (`packages/contracts/src/attempt.ts:120` — `readonly revisions: FrozenRevisions`) существует, но шаг 2 описывает несуществующий путь записи.

**NB-5 · Q-21: точка вставки по-прежнему не в том файле (minor).** `23-:437` — «Modify путь завершения попытки/задачи (`packages/execution/src/service.ts` ~)»; в файле (1461 строка) 0 вхождений `TaskState`, `transitionTask`, `applyTaskCommand`, `completedAt`, `TASK_TRANSITIONS`, `integrating`. Тильда смягчает формулировку, но файл назван неверно. То же у Q-01 (`23-:129`): `service.ts` содержит 0 вхождений `AgentStartRequest`, `.prompt`, `ContextSnapshot`, `runtime.start`; `assembleContextPrompt`/`materializeContextSnapshot` не встречаются ни в одном файле `packages/execution/src/*.ts`.

**NB-6 · Q-41: исход `missing` у `verifyContextSnapshot` не существует (minor).** `23-:712` требует «`verifyContextSnapshot` → `missing`, и это типизированный результат». Тип (`packages/core/src/context.ts:644-645`) — `{kind:'intact'} | {kind:'drifted', drift}`; `missing` — это `reason` внутри `ContextDrift` (`:697`). Дельта правила только якорь `repair.ts`, поэтому находка осталась.

**NB-7 · Счёт одного и того же теста расходится в трёх местах (major).** Файл `tests/auto-review-policy.test.mjs` создаётся двумя шагами, и счёт «pass» у него трёхзначный: карта `21-:164` — `pass 4 / fail 0`, тело E-40 `21-:868` — `pass 5 / fail 0` (в теле «пять тестов», `:865`), Q-38 `23-:678` — `pass 3 / fail 0` («шаги» перечисляют три). Это остаток дубля E-40 ↔ Q-38 (`§5.2` D2): после правок R-22/R-14 разошлись и числа, и ни один из двух шагов не объявил владельца теста. Третий участник той же темы — `F-57` (`20-:1564-1590`): он создаёт **другой** файл `tests/auto-review-deny-only.test.mjs` с гейтом `pass 3 / fail 0` (`:1584`) и сохраняет в названии правила слово «deny-only» (сама посылка при этом исправлена по R-22 — `:1570-1571`). Итог: один инвариант («автоматика не одобряет») обслуживают три шага в трёх файлах, два разных имени теста и три разных счёта.

**NB-8 · Три ссылки за конец `00-RECON.md` (minor).** `21-STEPS-execution.md:586` → `00-RECON.md:250`, `:662` и `:666` → `00-RECON.md:284`; фактическая длина файла — **241** строка. Класс «якорь был неверен уже на базе»; дельта его не касается.

**NB-9 · Ссылка на строку в самой дельте не воспроизводится (minor).** `02-PLATFORM-DELTA-0.2.0-rc.2.md:254` (F-2 VERIFIED) приводит вывод мутации `superseded-range: README.md:448`; корневой `README.md` содержит **446** строк, поэтому номер проверяем только при известном числе вставленных мутацией строк (в тексте не названо).

**NB-10 · Три битых пути в evidence остались (minor).** `evidence/foundation-58-web-package.md:19` — `packages/client/modules/src/manifest.ts` (реально `packages/client/modules/src/client/manifest.ts`); `evidence/lead-03-peer-gate.md:53` — `packages/lib/process.mjs:52-58` (реально `scripts/lib/process.mjs` **в MyWork**); `evidence/execution-05.md:18` — `apps/cli/tests/web-agent-presets-e2e.ts` (реально `apps/cli/tests/web-agent-presets.e2e.ts`). Дельта §3 назвала их «правятся владельцы evidence»; на 2026-10-03 не исправлен ни один.

**NB-11 · Два пространства имён `F-N` и проспективные ID (info).** Находки ревью дельты названы `F-1…F-8` (`02-:234-241`, `:253-260`), а шаги фундамента — `F-01…F-64`; машинный резолвер ссылок считает `F-1…F-8` висячими. Там же `02-:136` объявляет будущие ID `E-53+`, `Q-48+`, `B-49+` — до их появления они тоже выглядят висячими. На корректность плана не влияет, но ослабляет автоматическую проверку ссылок.

### 5. Что осталось непроверенным

1. **Динамика.** Ни один тест, сборка, `pnpm`-команда и полный прогон не запускались (запрет задания). Все гейты шагов проверены статически; заявленные `pass N / fail 0` плана не воспроизводились.
2. **Гейты дельты §7.1 пп. 1–5, 7–9** (`corepack pnpm -r run build`, `pack.mjs`, `verify:profile`, `tests/peer-gate.test.mjs`, `typecheck`, `smoke`, полный прогон 1031/1031) — не перезапускались; воспроизведён только п.6 (гейт цитат).
3. **Правки 2026-09-27 в `21-` §18.19** проверены выборочно (E-04, E-08, E-09, E-13, E-17, E-22, E-23, E-24, E-25, E-26, E-42, E-44, E-45, E-51). Не перечитаны построчно: E-10…E-12, E-18…E-21 (кроме E-20), E-27…E-41, E-46…E-50, E-52 — их вердикты в §2.2 остаются в силе по содержанию, но не подтверждены на текущей ревизии.
4. **`23-` §10.2 (закрытые замечания) пп. 21–23** — проверены частично: канон тестов и приёмка MW-074 подтверждены, полный список несуществующих сущностей — нет.
5. **Подпункт дельты D10 «`submit` → `{accepted}`»** — в указанных дельтой путях не найден; возможно, относится к другому пакету (не установлено).
6. **Живой профиль.** `maxSubtaskDepth` = 1 и `teamRun` подтверждены по типам/коду доски, но поведение доски (гейт подтверждения прав, каскад подзадач) не воспроизводилось; леджер и карточки не менялись.
7. **Правки леджера** §3.24 `30-CARD-EDITS.md` (`MW-048.dependsOn`, `MW-042`) в `.work/tasks/tasks.json` не применены — проверено только соответствие блока JSON заявленному графу.
8. **Матрица semver** проверена в 12 клетках из 24; полный перебор включая `0.1.8-rc.1` и `0.2.0-rc.1` не повторялся.
9. **`§4` дельты (внутренние ссылки плана)** — числа висячих `§`-ссылок (133/65/55/31) не перемерялись независимо; мастер `:103` их приводит со ссылкой на замер верификатора правок.

### 6. Вердикт раздела

**Дельта 0.2.0-rc.2 подтверждена по фактам и закрывает R-22 в `21-`/`23-`, оба блокера §3.1 и большинство пунктов §7.2 (`P3`–`P5`, `P7`, `K1`–`K2`, приёмка MW-074), но `§7.2` не пуст: остаются E-09, Q-01, Q-21, Q-41, E-51 (смягчён), baseline P6 — и дельта вносит три новых содержательных разрыва (NB-1/NB-2: правки D5/D6 у потребителя, а не у владельцев `F-51…F-53`/D05; NB-3: остатки «только deny» в мастере `:193,:295` и карте `21-:76,77`; NB-7: три разных счёта одного теста).**
