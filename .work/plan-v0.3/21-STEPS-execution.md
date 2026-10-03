# 21 — Шаги: конвейер исполнения (этап 4), worker-поверхность и provisioning saga

Файл владельца `plan-execution`. Карточки этапа 4 канона §2 брифа (`00-RECON.md:98`): **MW-021 → MW-022 → MW-023 → MW-024 → MW-025 → MW-026**, затем **MW-028**, **MW-031**, плюс кросс-шаги переноса из Agent Teams (`D13`) и переименование workflow-домена (`D03`/MW-044).

**Как читать.** Каждый шаг — одно атомарное действие по шаблону §1.2 брифа (`00-RECON.md:44-59`), с командой и ожидаемым выводом. Номера строк даны там, где проверены лично; непроверенные пути помечены `~` и вынесены в §6 «Не проверено».

**Состояние на момент написания (2026-09-26, поздний вечер) — историческое.** Тогда `git HEAD = 0c657ae1434202865bd330f0eeaf2b60eb78f6d4`, рабочее дерево грязное (`M pnpm-lock.yaml`). Соседние файлы плана (`20-STEPS-foundation.md`, `22-…`, `23-…`, `10-DECISIONS.md`) на момент написания **ещё не существуют**; ссылки на шаги `F-…` даны по теме, а не по номеру, и подлежат сверке с `plan-foundation`, когда его файл появится (§6, п. 1).

**Актуализация (2026-10-03).** `git HEAD = 2f0bcf8921cc7740e90f754b056bd1fcdf10fae7`. Платформа — DSH **`0.2.0-rc.2`** (`639ed0153`); база планирования `0.1.7-rc.2` (`c7c4c725`) — **историческая**. Дельта платформы и её следствия — `02-PLATFORM-DELTA-0.2.0-rc.2.md`; сводка базы — `01-MASTER-PLAN.md` §1.4.

---

## 1. Что уже реализовано и на что можно опереться

### 1.1. Инвентарь с якорями

| Слой | Что есть | Якорь |
|---|---|---|
| `packages/execution` | 5 файлов `src` (`errors`, `index`, `schema`, `service`, `store`); claim-сага `intent→claim→attempt→projection→complete`; журнал шагов; монотонный аллокатор fence; инвариант «не более одной живой lease на задачу» выражен **в БД**; версия схемы `6` | `packages/execution/src/service.ts:166` (`STEP_ORDER`), `:616-735` (claim), `:440-613` (attemptAndComplete), `:405-429` (порядок проверок: fence задачи → epoch → fence попытки), `:413` (`STALE_FENCE`); `packages/execution/src/schema.ts:48` (`CLAIM_SAGA_SCHEMA_VERSION = 6`), `:135` (`attempt_task_live_lease`), `:145` (`task_fence_monotonic`); `packages/execution/src/index.ts:38-71` (экспорты) |
| `packages/lease` | Лидерство контроллера CAS-ом с монотонной эпохой; **готовый жизненный цикл контроллера** с фазами, admission-гейтом, reconcile-хуком и `admissionHold`; heartbeat | `packages/lease/src/lease.ts:127` (`acquireLease`), `:192` (`expired-taken-over`), `:210-241` (`heartbeatLease`), `:253` (`releaseLease`), `:292-303` (`holdsLeadership`); `packages/lease/src/lifecycle.ts:33-45` (фазы), `:123` (`admissionHold`), `:214` (`activate`), `:281-299` (`heartbeat`); `packages/lease/src/schema.ts:22` (v4), `:48-56` (`controller_lease`) |
| `packages/planner` | Стейджинг и применение `PlanMutation` как сага с `recovery/reverted`; admission-hold по ADR024; отказ `PLANNER_SCOPE_DENIED` | `packages/planner/src/service.ts:134` (`Planner`), `:144` (`stage`), `:148` (`submit`), `:1195-1300` (решение/восстановление), `:1267` (`PLANNER_SCOPE_DENIED`); `packages/planner/src/store.ts:41` (`PLAN_MUTATION_HOLD_REASON`), `:400` (`holdAdmission`); `packages/planner/src/schema.ts:36` (v5) |
| `packages/scheduler` | Детерминированный планировщик: `start/stop/kick/reconcile/snapshot`, сериализация тиков, startup-reconcile, event-kicks, периодический safety-reconcile; чистое ядро `planSchedulerTick`; admission уходит в порт, claim планировщик не делает; виды работ `worker` и `review` | `packages/scheduler/src/service.ts:153-170` (API), `:183` (`createScheduler`), `:257-260` (`kick`), `:280-287` (сериализация), `:290-306` (`reconcileLoop`), `:309-325` (`runTick`); `packages/core/src/scheduler.ts:303-333` (чистое ядро), `:314` (виды), `:584-620` (`capacityRefusal`); `packages/contracts/src/scheduler.ts:215-227` (лимиты и дефолты 8/4/2) |
| `packages/evidence` | Неизменяемый artifact store с hash и append-only audit; маркеры неизменяемости и append-only в БД | `packages/evidence/src/store.ts:110` (`createArtifactStore`), `:125` (`createAuditLog`); `packages/evidence/src/artifacts.ts:43` (`sha256Hex`), `:132` (`putArtifact`), `:191` (`getArtifact`); `packages/evidence/src/audit.ts:127` (`appendAuditEntry`); `packages/evidence/src/schema.ts:26` (v3), `:35`, `:38` (маркеры) |
| `packages/controller` | Composition root сегодня: публикует `myworkController` + `myworkAdapters`, монтирует каталог моделей и DSH-runtime. **Store, lease/lifecycle, planner, execution, scheduler и evidence не монтируются** | `packages/controller/src/index.ts:115-128` (`apply`), `:101` (`BOUNDED_CONTEXTS = ['control']`); `packages/controller/src/dsh-session.ts:426` (`DshAgentRuntime`), `:450`/`:475`/`:500`/`:526` (start/resume/status/stop), `:613` (`/permission`), `:695` (регистрация адаптера) |
| Контракты | Полный словарь домена: `Attempt` и `WorktreeRef`, review-домен, порт рантайма агента, виды артефактов, лимиты планировщика, бюджет попыток, каталог причин `needs-attention` | `packages/contracts/src/attempt.ts:92-101` (`WorktreeRef`), `:122` (поле опционально); `packages/contracts/src/review.ts:12-48` (8 состояний), `:51-56` (`ReviewedArtifact`); `packages/contracts/src/agent-runtime.ts:223-258` (порт), `:52-64` (`AgentRunScope`), `:67-76` (`runId` — caller-owned); `packages/contracts/src/artifact.ts:31-75` (виды); `packages/contracts/src/budget.ts:104`, `:123`, `:138` (`maxAttempts`, scope `task`); `packages/contracts/src/board.ts:356-372` (причины `needs-attention`); `packages/contracts/src/security.ts:119-146` (`HarnessPolicy` и потолок) |
| Домен `core` | Машина review-переходов и **три готовых инварианта**: независимость ревьюера, read-only ревьюера, актуальность approval; платформенное ограничение пути с `worktreeRoot` | `packages/core/src/review.ts:51` (состояния, требующие findings), `:109` (`assertReviewerIndependence`), `:129` (`assertReviewerReadOnly`), `:146` (`isReviewApprovalCurrent`), `:182` (`transitionReview`); `packages/core/src/security.ts:130` (`boundaryRoot = grant.worktreeRoot ?? grant.workspaceRoot`), `:203-207` (отказ `worktree-escape`) |
| Тесты-ограничители | Границы слоёв и запрет модели внутри планировщика | `tests/boundaries.test.mjs:480-494` (собранный `execution/lib/index.js` импортирует **только** `node:crypto`), `:496-508` (доменные пакеты не импортируют execution); `tests/scheduler.test.mjs:921` (у планировщика нет порта модели), `:935-944` (текстовый сканер исходников планировщика) |

### 1.2. Чего нет (на этом строятся шаги)

| Пробел | Доказательство |
|---|---|
| **Ни одной строки worktree-исполнения**: `WorktreeRef` объявлен, но `worktree` не встречается ни в `execution`, ни где-либо как вызов git | grep `worktree` по `packages/**/*.ts`: только контракт (`contracts/src/attempt.ts:91-122`), `core` (immutability/security) и комментарии; вызовов git нет — единственные совпадения `'git'` это строки прав (`contracts/src/security.ts:36`, `:51`) |
| **Нет `AttemptRunPort`, оркестратора попытки, verification-гейтов, review-очереди, интегратора, provisioning-саги, write-intent, handoff**: в `packages/execution/src` 0 вхождений `handoff`, `writeIntent`, `verification`, `review`, `stall`, `maxAttempts`, `heartbeat`, `worktree` | инвентарь `evidence/execution-01.md` (агент 1) по `packages/execution/src/*.ts` |
| **Фазовые потолки `maxConcurrentLlm`/`maxHeavyTools` никто не исполняет**: планировщик только откладывает работу, а исполнителя потолка в дереве нет; `SchedulerInstanceObservation` никем не производится | `packages/core/src/scheduler.ts:613-616` («the runtime that starts the model call … enforces the ceiling itself»), `:617-618` (единственные чтения); `packages/contracts/src/scheduler.ts:225-227` (дефолты) |
| **Scheduler не смонтирован в runtime**: `createScheduler` вызывается только тестами | grep по репозиторию: `packages/controller/**` и `scripts/*.mjs` не упоминают `scheduler`; `evidence/execution-03.md` (агент 3), п. 6 |
| **`ControllerLifecycle` не инстанцируется нигде** — только экспортируется | `packages/lease/src/index.ts:56-63`; grep `new ControllerLifecycle` по `packages/**` — 0 совпадений (`evidence/execution-02.md`, агент 2, п. 5) |
| **Истечение lease не проверяется при settle**: `lease_expires_at` пишется, но не читается ни в одном `WHERE`; sweeper'а нет | `.work/reports/MW-012-attempt-saga.md:230` (§8 п. 3); `evidence/execution-02.md`, п. 5 |
| **Отклонённый поздний результат не наблюдаем**: отказ возвращается как `Result` до любой записи, audit-строки нет | `.work/reports/MW-012-attempt-saga.md:234` (§8 п. 7) |
| **Review-домен есть, review-**исполнения** нет**: переходы и три инварианта реализованы, но очереди/pool/сессии ревьюера и reject-flow в коде нет | `packages/core/src/review.ts:39-182` (только чистая машина); `tests/review.test.mjs` покрывает переходы, не исполнение |
| **Инструменты worker-сессии не фильтруются**: поверхность задаёт пресет, per-session allow-list в контракте порта нет; **форма фильтра — allowlist** (`restrict({ allow })`), потому что denylist невыразим (см. `E-39`) | `packages/contracts/src/agent-runtime.ts:52-59` («a session inherits the composition of its preset, and there is no per-session tool allow-list to set instead»); `core/tools/src/index.ts:1114-1118` (бросок на незарегистрированном имени), `:1202-1208` (собственные регистрации скоупа вне фильтра) — `evidence/lead-19-apis.md`, §3 |
| Инструменты worker-сессии не фильтруются: адаптер объявляет capability `scopedTools: true`, но `restrict` не вызывается ни разу | `packages/controller/src/dsh-session.ts:93` (capability), grep `.restrict(` по `packages/**/src` — 0 совпадений (`evidence/execution-07.md`); поверхность задаётся пресетом, per-session allow-list в контракте порта нет (`packages/contracts/src/agent-runtime.ts:52-64`) |
| Типа `PermissionPreset` в MyWork нет: права роли выражаются `HarnessPolicy` + `permissions` блueprint'а | grep `PermissionPreset` — 0; `packages/contracts/src/security.ts:119-146`, `packages/contracts/src/team.ts:206-208`, `:252-260` |

### 1.3. Словарь: куда переименовывается workflow-домен (решение `D03`, K4)

`00-RECON.md:188` фиксирует решение `D03`: **новое имя домена + граница с `ctx.workflowEngine` + ADR**. Пока `D03` не закрыт, шаги этого файла используют рабочее имя **`procedure`** (домен «исполняемая процедура»), а сам движок называется **execution pipeline**. Инвариант, не зависящий от выбора имени:

1. MyWork **не регистрируется** в `ctx.workflowEngine` (там ровно один движок на контекст, `00-RECON.md:157`; FINAL-REPORT §6 K4, `:280`);
2. имя домена не совпадает ни с `workflow`, ни с `workflowEngine` (шаг `E-51`);
3. ADR-запись ведёт `decision-desk` (`00-RECON.md:26`), этот файл даёт только исполнимые шаги.

### 1.4. Зависимости от Foundation, решений и соседних файлов

Точные ID шагов `F-…` появятся в `20-STEPS-foundation.md`. Ниже — темы, от которых зависят шаги этапа 4; каждая ссылка в шагах помечена как `F(тема)`.

| Тема Foundation | Зачем этапу 4 | Источник |
|---|---|---|
| `F(composition root)` — один application service: открыть `controller.sqlite` полным списком миграций, поднять lease/planner/execution/scheduler/evidence, зарегистрировать в `myworkAdapters` | без него ни один шаг этапа 4 не запускается в реальном профиле; гейт «store на версии 6» | FINAL-REPORT §10 этап 2 п. 6, `:467` |
| `F(единый реестр миграций)` — запретить открытие store без канонического списка; номер новой миграции выдаёт **единый аллокатор** (D08), литералов версий в шагах нет | новые таблицы этапа 4 (provisioning, write-intent, gates, worktree, review) добавляются миграциями с номерами от аллокатора | §10 этап 1 п. 3, `:461`; `00-RECON.md:173`; `01-MASTER-PLAN.md` §15.3 (дефект R-04) |
| `F(атомарная запись + journal)` | запись вердиктов гейтов и provisioning-шагов должна быть атомарной | RT-1, `00-RECON.md:174` |
| `F(boundary-скан)` — расширить `FORBIDDEN` до `@deepseek-ai/dsh*`, сканировать `scheduler`/`planner`/`adapter-sdk` и built-artifact'ы | новый пакет `worktree-adapter` обязан быть под сканом | FINAL-REPORT §10 этап 2 п. 8, `:469`; B-orchestration §3.4, `:336-342` |
| `F(durable jobs)` | периодические задачи (stall-сканер, retention worktree) не должны опираться на несуществующий `LocalJobRegistry` как на durable | FINAL-REPORT §9.2 п. 5, `:423` |
| `F(retention/сканеры)` | retention worktree/артефактов согласуется с общими окнами `D17` | §10 этап 2 п. 9, `:470` |
| `F(CI + тег)` | гейты этого файла предполагают прогоняемый CI | §10 этап 1 п. 4, `:462` |
| `F(производный INDEX/сверка леджеров)` | «done» без failed-исполнений — правило приёмки `D19`, на которое ссылаются гейты review/integrator | §10 этап 0 п. 4, `:454` |

Решения, от которых зависят шаги: `D03` (имя workflow-домена → `E-50`, `E-51`), `D05` (бюджет/шаги → `E-47`, `E-48`), `D11` (инъецированные часы → `E-18`, `E-46`), `D12` (порядок работ), `D13` (что переносим из Agent Teams → §2 группы G–I), `D14` (`HumanDecision` → `E-24`, `E-29`), `D15` (worker-поверхность → `E-39`, `E-40`), `D17` (retention → `E-06`), `D20` (доступность модели — вне этого файла, ссылка из `E-08`).

Соседние файлы плана (ID получены от `plan-quality` сообщением 2026-09-26; этот файл их **не дублирует**, только ссылается):

| Тема | Шаги `plan-quality` | Где ссылается у меня |
|---|---|---|
| 8 тестов session conformance (`read-only`, `danger-full-access`, «нет живого агента», 4 схлопнутых отказа → `detail.kind`, `packages/controller/src/dsh-session.ts:596-629`) | **Q-34** | `E-21`, `E-41` |
| `ModelAvailabilityPort` / `model-not-routable` (`D20`) | **Q-35** | `E-30` (отказ маршрута) |
| Инвариант worker-поверхности + тест «worker не может вызвать dynamic-путь» (**allowlist** `tools.restrict({ allow })` + монотонный `guard`; прежняя запись «`tools.restrict({deny})`» **снята как неверная** — контекстно-глобальный `restrict` бросает (`packages/core/tools/src/index.ts:1100`), а `restrictableNames` содержит только **унаследованные** имена (`:720`, `:1194-1197`), поэтому denylist динамического раннера невыразим) | **Q-37** | `E-39` (слой 1 — исполнение, слой 3 — отказ MyWork) |
| Runtime-инварианты MyWork: **свой модуль** проверок (`packages/controller/src/invariant.ts`) + **код ошибки MyWork** `INVARIANT_VIOLATED`; прежняя запись «Регистрация `./invariant` + `ctx.invariants`» **снята как неверная** — шов не смонтирован в живом профиле и удаляется в 0.2.1, `./invariant` и `ctx.invariants.register` **не используются** (дельта §2.2 D4, §5.2) | **Q-36** | `E-39` |
| «Автоматика не одобряет»: `auto-review` **смонтирован и активен** (`enabled: true`, `fiberPhase: active`), deny-only режима у пакета **нет** — это правило MyWork, а не настройка платформы | **Q-38** (инвариант + тест), механика — **F-57** (путь получает только `review.request-changes`); D15 в `01-MASTER-PLAN.md` §7.1 | `E-40` (шаг-ссылка: пиннинг политики + тест при **активном** аппрувере) |
| `HumanDecision`: доставка в живую попытку / неблокирующий шаг | **Q-17**, **Q-19** | `E-24`, `E-29` |
| Work types / finish criteria / человеческая приёмка | **Q-20**, **Q-21**, **Q-22**, **Q-23** | `E-12`, `E-17`, `E-24` |

`22-STEPS-surface.md` владеет карточками доски и носителем `NeedsAttentionReason` (`E-47` ссылается, не строит).

### 1.5. Команды, которые считаются каноническими в этой среде

Канон — `01-MASTER-PLAN.md` §15.1 («Runner») и §15.3; дефект R-06 исправлен согласованием с файлом 20 (`20-STEPS-foundation.md` F-01/F-12/F-25) — **противоречия больше нет**.

| Действие | Каноническая команда | Проверено |
|---|---|---|
| Скрипт во всех 12 пакетах | `corepack pnpm -r run <script>` — **обязательно с `-r`**: `corepack pnpm run <script>` падает за ~1 с из-за вложенного bare `pnpm` 11.7.0 из `.bin` DSH-чек-аута | `01-MASTER-PLAN.md` §15.1 («Runner»); F-01 (`-r` → EXIT=0, 12 пакетов) |
| Сборка одного пакета | `Push-Location packages/<pkg>; node ../../node_modules/tsdown/dist/run.mjs; Pop-Location` (точечный вариант канона) | `01-MASTER-PLAN.md` §15.1 («Runner», `node <tsdown-entry>`); `.work/reports/MW-019-external-memory.md:201` (`exit 0` ×12) |
| Типизация | `node_modules\.bin\tsc.cmd --noEmit -p packages/<pkg>/tsconfig.json` | `01-MASTER-PLAN.md` §15.1 («Runner»); `.work/reports/MW-017-skills.md:128` |
| Тест одного файла | `node --test --test-isolation=none "tests/<name>.test.mjs"` | `.work/reports/MW-014-…` / субагент 3: исторически записано как `node --test tests/scheduler.test.mjs` → `pass 27 / fail 0`, exit 0 (канон этого файла — **всегда** с `--test-isolation=none`, как в `package.json:16`) |
| Полный прогон | `node --test --test-isolation=none "tests/**/*.test.mjs"` | `package.json` script `test`; **выполняет Lead один раз** (`00-RECON.md:216`) |
| Baseline полного прогона | `659 tests / 636 pass / 0 fail / 23 skipped` (по отчёту MW-019, `:9`) | **не воспроизводился в этой кампании** (§18, п. 6) |

Важно: тесты грузят **собранный** `lib/` (`tests/lib/fixtures.mjs:17-21`), поэтому каждый гейт с новым тестом начинается со сборки затронутых пакетов; иначе тест падает на `existsSync`, а не на смысле. Гейт, который всегда даёт один и тот же результат из-за ошибки в самой команде (дефект R-07), считается **вакуумным**: у текстовых гейтов обязателен позитивный контроль на файле, где совпадения действительно есть.

### 1.6. Версии миграций: только единый аллокатор (D08, дефект R-04)

**Правило без исключений:** ни один шаг этого файла не пишет `version: N` литералом и не объявляет «это будет `v7`/`v8`/…». Версию выдаёт **единый аллокатор** в composition-слое (D08); причина — `validateMigrations` (`packages/storage/src/migrations.ts:111-129`) бросает на дубле или непорядке версий (`:117-119`), и store **не откроется вовсе**, причём каждый шаг по отдельности свой гейт проходит (`01-MASTER-PLAN.md` §15.3, дефект R-04).

Занято сегодня (только как **факт базы**, не как заявка): v1 kernel `OUTBOX_INBOX` (`packages/storage/src/migrations.ts:91`), v2–v3 evidence (`packages/evidence/src/schema.ts:26`), v4 lease (`packages/lease/src/schema.ts:22`), v5 planner (`packages/planner/src/schema.ts:36`), v6 execution (`packages/execution/src/schema.ts:48`).

Заявки этого файла на новые таблицы (номер получит каждая при реализации, порядок выдачи — за аллокатором; другие заявки — `background_job` F-37, триггеры retention F-40, проекция/placement B-12):

| Шаг | Таблица/изменение | Как оформляется |
|---|---|---|
| `E-04` | `attempt_worktree` | новая миграция, зарегистрированная в реестре через аллокатор |
| `E-19` | `review_claim` | то же |
| `E-28` | таблица идемпотентности интеграции (по `operationId`) | то же |
| `E-34` | `agent_instance_provisioning` + `provisioning_step` | то же |
| `E-37` | `attempt_write_intent` + индекс `(workspace_id, path)` | то же |

**Как это выглядит в шаге:** «Modify `packages/execution/src/schema.ts` — добавить миграцию, **версию которой выдаёт аллокатор** (D08), рядом с `CLAIM_SAGA_MIGRATIONS:153`», а тест читает ожидаемый набор версий **из аллокатора** и не содержит литерала `[1,2,3,4,5,6]` (`01-MASTER-PLAN.md` §15.3). Зависимость каждого такого шага — `F(единый реестр миграций + аллокатор версий, D08)`.

---

## 2. Порядок работ и карта шагов

Порядок обязателен там, где есть зависимости; внутри группы шаги можно распараллеливать по write-scope. Группы G–K — переносы из Agent Teams (`D13`), они не блокируют A–F, но `E-35` (recovery провижининга) опирается на `E-33`/`E-34`, а `E-39` (поверхность) — на `E-08` (запуск сессии).

| ID | Название | Карточка | Зависит от | Гейт (кратко) |
|---|---|---|---|---|
| E-01 | Шаг 0 + форма `WorktreePort` и место git-раннера | MW-021 | — | grep-проба: 0 вызовов git; записанное решение |
| E-02 | Контракт `WorktreePort`/`WorktreePolicy` | MW-021 | E-01 | `tests/worktree.test.mjs` → `pass 4 / fail 0` |
| E-03 | Пакет `worktree-adapter`: реальный git-раннер и preconditions | MW-021 | E-02 | `tests/worktree-adapter.test.mjs` → `pass 7 / fail 0` |
| E-04 | Pin base/head SHA и workspace binding в claim-саге | MW-021 | E-03 | `tests/worktree-binding.test.mjs` → `pass 7 / fail 0` |
| E-05 | Два attempt'а не пишут в общий checkout | MW-021 | E-04 | `tests/worktree-isolation.test.mjs` → `pass 4 / fail 0` |
| E-06 | Cleanup/retention: грязное и чужое не удаляется | MW-021 | E-05, F(retention) | `tests/worktree-cleanup.test.mjs` → `pass 6 / fail 0` |
| E-07 | Контракт `AttemptRunPort` и фейк рантайма попытки | MW-022 | E-04 | `tests/attempt-run.test.mjs` → `pass 5 / fail 0` |
| E-08 | Оркестратор: admission → worktree → frozen context → сессия → промпт | MW-022 | E-07, F(composition root) | `tests/worker-flow.test.mjs` → `pass 7 / fail 0` |
| E-09 | Frozen revisions и `context-snapshot` на попытку | MW-022 | E-08 | `tests/attempt-revisions.test.mjs` → `pass 4 / fail 0` |
| E-10 | Failure-путь: evidence сохранён, capacity освобождена | MW-022 | E-08 | `tests/worker-failure.test.mjs` → `pass 5 / fail 0` |
| E-11 | Restart и late callback не создают вторую попытку | MW-022 | E-08 | `tests/worker-restart.test.mjs` → `pass 5 / fail 0` |
| E-12 | Worker не финализирует TaskGraph `Done` | MW-022 | E-08, E-25 | `tests/worker-no-done.test.mjs` → `pass 3 / fail 0` |
| E-13 | Контракт `GateSpec`/`GateResult` и вид артефакта `gate-result` | MW-023 | E-08 | `tests/gates-contract.test.mjs` → `pass 5 / fail 0` |
| E-14 | Раннер гейтов: timeout/cancel, ошибка инструмента ≠ PASS | MW-023 | E-13 | `tests/gates-runner.test.mjs` → `pass 8 / fail 0` |
| E-15 | Пиннинг exact head: `GATE_HEAD_MOVED` | MW-023 | E-14 | `tests/gates-head.test.mjs` → `pass 4 / fail 0` |
| E-16 | Набор гейтов по workspace/task, `GATE_UNCONFIGURED` | MW-023 | E-14 | `tests/gates-policy.test.mjs` → `pass 5 / fail 0` |
| E-17 | Провал/отсутствие гейта блокирует review admission | MW-023 | E-16 (цикл с MW-024 разорван) | `tests/gates-admission.test.mjs` → `pass 5 / fail 0` |
| E-18 | Детерминизм вердикта, инъецированные часы | MW-023 | E-14, D11 | `tests/gates-determinism.test.mjs` → `pass 4 / fail 0` |
| E-19 | Review-очередь и отдельный pool `review` | MW-024 | E-08, E-17 | `tests/review-queue.test.mjs` → `pass 6 / fail 0` |
| E-20 | Независимость ревьюера: self-review отвергнут | MW-024 | E-19 | `tests/review-independence.test.mjs` → `pass 4 / fail 0` |
| E-21 | Ревьюер read-only через платформенный enforcement | MW-024 | E-20, E-41 | `tests/review-readonly.test.mjs` → `pass 4 / fail 0` |
| E-22 | Evidence package и findings-артефакт `review-verdict` | MW-024 | E-19, E-13 | `tests/review-evidence.test.mjs` → `pass 6 / fail 0` |
| E-23 | Approval привязан к `headSha`/`diffHash` | MW-024 | E-22 | `tests/review-staleness.test.mjs` → `pass 5 / fail 0` |
| E-24 | Reject-flow и лимит review-loop | MW-024 | E-23, D14 | `tests/review-reject.test.mjs` → `pass 7 / fail 0` |
| E-25 | Интегратор: только approved immutable result | MW-025 | E-23, E-04 | `tests/integrator-admission.test.mjs` → `pass 5 / fail 0` |
| E-26 | Локальный merge/rebase и trailer `Refs: mw-<hash>` | MW-025 | E-25 | `tests/integrator-commit.test.mjs` → `pass 4 / fail 0` |
| E-27 | Повтор гейтов на интегрированном head | MW-025 | E-26, E-15 | `tests/integrator-gates.test.mjs` → `pass 4 / fail 0` |
| E-28 | Идемпотентный finalize узла графа | MW-025 | E-27 | `tests/integrator-finalize.test.mjs` → `pass 5 / fail 0` |
| E-29 | Конфликт и провал verify не дают `Done` | MW-025 | E-28, D14 | `tests/integrator-conflict.test.mjs` → `pass 4 / fail 0` |
| E-30 | Task Setter как отдельная роль в fresh Session | MW-026 | E-08, F(composition root) | `tests/setter-role.test.mjs` → `pass 5 / fail 0` |
| E-31 | Additive-only и `PLANNER_SCOPE_DENIED` | MW-026 | E-30 | `tests/setter-additive.test.mjs` → `pass 5 / fail 0` |
| E-32 | Предпросмотр/Approve/Reject, пустой след отклонённого плана | MW-026 | E-31 | `tests/setter-approval.test.mjs` → `pass 6 / fail 0` |
| E-33 | Контракт provisioning-саги с pre-minted identity | MW-065 | — | `tests/provisioning-contract.test.mjs` → `pass 5 / fail 0` |
| E-34 | Durable шаги, epoch-fence, `orphan-drained` | MW-065 | E-33, F(единый реестр миграций) | `tests/provisioning-steps.test.mjs` → `pass 7 / fail 0` |
| E-35 | Recovery по 9-строчной матрице + краш между шагами | MW-065 | E-34, E-08 | `tests/provisioning-recovery.test.mjs` → `pass 10 / fail 0` |
| E-36 | Write-intent на `Attempt` + нормализация | MW-066 | E-04 | `tests/write-intent.test.mjs` → `pass 6 / fail 0` |
| E-37 | Хранение и индекс write-intent; admission его не читает | MW-066 | E-36 | `tests/write-intent-store.test.mjs` → `pass 5 / fail 0` |
| E-38 | Handoff: вид артефакта и рендер как `dependency-result` | MW-067 | E-10, F(composition root) | `tests/handoff.test.mjs` → `pass 6 / fail 0` |
| E-39 | Пресет worker'а без `cordis_*`/dynamic и `assertWorkerPreset` | MW-069 (D15) | E-08 | `tests/worker-surface.test.mjs` → `fail 0`; проверяются именованные acceptance cases, общий count не пинится |
| E-40 | «Автоматика не одобряет» при **активном** `auto-review` | MW-069 (D15) | E-39 | `tests/auto-review-policy.test.mjs` + queue-boundary regressions → `fail 0`; общий count не пинится |
| E-41 | Права роли через платформенный runtime-enforcement | MW-007/MW-015 (D13) | E-39 | `tests/role-permissions.test.mjs` → `pass 6 / fail 0` |
| E-42 | Монтирование `ControllerLifecycle` в composition root | MW-028 | E-25, F(composition root) | `tests/controller-lifecycle.test.mjs` → `pass 6 / fail 0` |
| E-43 | Heartbeat, потеря lease → passive и закрытый admission | MW-028 | E-42 | `tests/controller-heartbeat.test.mjs` → `pass 5 / fail 0` |
| E-44 | Embedded и resident режимы, внешний state dir, graceful shutdown | MW-028 | E-43 | `tests/controller-modes.test.mjs` → `pass 6 / fail 0` |
| E-45 | Reconcile до admission и `admissionHold` | MW-028 | E-44 | `tests/controller-reconcile-order.test.mjs` → `pass 4 / fail 0` |
| E-46 | Reconcile-сценарии §49 с fault injection | MW-031 | E-45 | `tests/recovery-scenarios.test.mjs` → `pass 8 / fail 0` |
| E-47 | Stall detection без LLM и `NeedsAttention` из каталога | MW-031 | E-46, D05 | `tests/stall-detection.test.mjs` → `pass 6 / fail 0` |
| E-48 | Исчерпание бюджета попыток → эскалация | MW-031 | E-47 | `tests/attempt-budget-escalation.test.mjs` → `pass 5 / fail 0` |
| E-49 | Наблюдаемость позднего отказа (счётчик, не audit) | MW-031 | E-46 | `tests/late-refusal-observability.test.mjs` → `pass 3 / fail 0` |
| E-50 | Переименование workflow-домена по `D03` | MW-044 | D03 | `tests/procedure-naming.test.mjs` → `pass 4 / fail 0` |
| E-51 | Тест-запрет: нет монтажа в `ctx.workflowEngine` | MW-044 | E-50 | `tests/procedure-boundary.test.mjs` → `pass 3 / fail 0` |
| E-52 | Наблюдаемый статус хода и выбор режима доставки (`steer`/`queue`) | MW-015 (правка) | E-08 | `tests/runtime-delivery.test.mjs` → `pass 6 / fail 0` |

**Минимум, который даёт работающий конвейер (критический путь):** `E-01 → E-04 → E-07 → E-08 → E-13 → E-14 → E-16 → E-17 → E-19 → E-22 → E-23 → E-25 → E-28 → E-42 → E-46`. Остальные шаги усиливают его (изоляция, восстановление, эскалация) и могут выполняться после первых зелёных гейтов.

---

## 3. Группа A. Изоляция Git worktree (MW-021)

Карточка: `.work/tasks/MW-021.md:1` («Реализовать изоляцию Git worktrees»), зависимости `MW-008`, `MW-012` (`:4`, `:12`); приёмка `:20`: «Параллельные attempts не пишут в общий checkout. Нельзя выйти из разрешённого worktree; cleanup не удаляет чужую/грязную работу. Для пустого Git repo — явный precondition, без скрытого первого коммита».

#### E-01 · Зафиксировать форму `WorktreePort` и место git-раннера (шаг 0 карточки)
- **Карточка:** MW-021 · **Зависит от:** — · **Усилие:** S (30–60 мин) · **Риск:** низкий · **Откат:** удалить файл решения
- **Цель:** до первой строки кода доказать, что исполнителя worktree в дереве нет, и записать два проектных решения: (а) git-раннер **не может** жить в `packages/execution`; (б) работа идёт только внутри worktree, shared checkout не трогается.
- **Файлы:** Create `.work/plan-v0.3/evidence/execution-21-worktree-form.md` (решение + проба). Кода не меняем.
- **Шаги:**
  0. Шаг 0: подтвердить, что вызовов git в дереве нет — **двумя** командами, негативной и позитивным контролем (дефект R-07: с `-SimpleMatch` ищется литерал `execFile|spawnSync|…` и гейт всегда даёт `0`; замер red-team: `0` с флагом против `3` без него).
     Негативная (регулярка, **без** `-SimpleMatch`):
     `(Get-ChildItem -Recurse packages -Filter *.ts -File | Where-Object { $_.FullName -notmatch '\\lib\\' } | Select-String -Pattern 'execFile|spawnSync|rev-parse|worktree add').Count` → ожидаем `0` (замер 2026-09-27 в этом дереве: `0`).
     Позитивный контроль — та же регулярка на файле, где совпадения **есть**:
     `(Select-String -Path tests\beads-adapter.test.mjs -Pattern 'execFile|spawnSync|rev-parse|worktree add').Count` → ожидаем `3` (замер 2026-09-27: `3`, строки `tests/beads-adapter.test.mjs:24`, `:58`, `:77`).
     **Правило гейта:** позитивный контроль, дающий `0`, означает **вакуумный** гейт — шаг не принимается.
  1. Шаг 0-b: подтвердить жёсткое ограничение сборки execution — она может импортировать **только** `node:crypto`.
     Команда: `Select-String -Path tests/boundaries.test.mjs -Pattern "deepEqual\\(modules, \\['node:crypto'\\]"` → совпадение на `tests/boundaries.test.mjs:488`.
     Вывод, который пишем в решение: реальный git-процесс запускается **вне** `packages/execution`, иначе `tests/boundaries.test.mjs` краснеет.
  2. Записать в файл решения: имя порта `WorktreePort` в `packages/contracts/src/worktree.ts`; адаптер — новый пакет `packages/worktree-adapter` (запускает `git`), `execution` зависит только от порта; политика «attempt работает только внутри своего worktree, shared checkout не трогается».
  3. Записать, что `Attempt.worktree` остаётся `readonly worktree?: WorktreeRef` (`packages/contracts/src/attempt.ts:122`) без расширения формы, а факт привязки получает отдельная таблица (см. `E-04`).
- **Гейт (готово когда):** негативная команда даёт `0`, **позитивный контроль даёт `3`** (иначе гейт вакуумный и шаг не принят), команда шага 0-b даёт совпадение на `tests/boundaries.test.mjs:488`, а файл решения содержит пункты 2–3 дословно: `Select-String -Path .work/plan-v0.3/evidence/execution-21-worktree-form.md -Pattern 'WorktreePort|worktree-adapter|shared checkout'` → 3 совпадения.
- **Evidence в отчёт:** вывод **трёх** проб (негативная, позитивный контроль, ограничение сборки), содержимое файла решения, отсутствие изменений в `git status`.
- **Риски:** решение о месте адаптера принято до `F(boundary-скан)`; при расширении сканера (`FINAL-REPORT` §10 этап 2 п. 8) новый пакет обязан попасть в список — назвать это в решении явно.

#### E-02 · Контракт `WorktreePort` и `WorktreePolicy`
- **Карточка:** MW-021 · **Зависит от:** E-01 · **Усилие:** M (1–2 ч) · **Риск:** низкий · **Откат:** revert коммита (новый файл)
- **Цель:** порт изоляции описан как контракт, а отказы — типизированы, чтобы адаптер и `execution` не договаривались прозой.
- **Файлы:** Create `packages/contracts/src/worktree.ts`; Modify `packages/contracts/src/index.ts` (один реэкспорт); Create `tests/worktree.test.mjs`.
- **Шаги:**
  1. Тест (падающий): четыре теста на форму — политика требует непустой `root`, `branchPrefix` без пробелов; `WorktreeRequest` требует `baseSha` ровно 40 hex; словарь отказов закрыт (`WORKTREE_REFUSALS.length === 6`); `resolveWorktreeRefusal` не принимает чужую строку.
     Команда: `node --test --test-isolation=none "tests/worktree.test.mjs"` → FAIL «Cannot find module …/worktree» (файл ещё не создан).
  2. Реализация: `WorktreePolicy { root, branchPrefix, retentionMs, keepDirty: true }`; `WorktreeRequest { workspaceId, taskId, attemptId, baseSha }`; `WorktreeRefusal = 'EMPTY_REPOSITORY' | 'WORKTREE_DIRTY' | 'WORKTREE_FOREIGN' | 'WORKTREE_OUTSIDE_WORKSPACE' | 'WORKTREE_ALREADY_REGISTERED' | 'WORKTREE_MISSING'`; `WorktreePort { prepare, resolve, cleanup, list }`, все методы возвращают `Result<…>` как остальные порты (`packages/contracts/src/attempt.ts:80-89` — образец стиля).
  3. Сборка и прогон: `Push-Location packages/contracts; node ../../node_modules/tsdown/dist/run.mjs; Pop-Location` → `✔ Build complete`, затем тест (см. шаг 1).
     Команда: `node --test --test-isolation=none "tests/worktree.test.mjs"` → `pass 4 / fail 0`.
  4. Регрессия границ: `node --test --test-isolation=none "tests/boundaries.test.mjs"` → без новых падений.
- **Гейт (готово когда):** `node --test --test-isolation=none "tests/worktree.test.mjs"` → `pass 4 / fail 0`, и `node_modules\.bin\tsc.cmd --noEmit -p packages/contracts/tsconfig.json` → exit 0.
- **Evidence в отчёт:** вывод теста, вывод сборки contracts, `git diff --stat packages/contracts`.
- **Риски:** `packages/contracts/src/index.ts` — общий грязный файл (в отчёте MW-012 §7.2 он назван грязным): правка строго аддитивная, одна строка реэкспорта.

#### E-03 · Пакет `worktree-adapter`: реальный git-раннер и preconditions
- **Карточка:** MW-021 · **Зависит от:** E-02 · **Усилие:** M (2–3 ч) · **Риск:** средний (первый запуск внешнего процесса в проекте) · **Откат:** удалить пакет целиком (`packages/worktree-adapter`, запись в `pnpm-lock.yaml` откатывается `git checkout pnpm-lock.yaml`)
- **Цель:** `prepare()` создаёт worktree отдельной веткой от зафиксированного `baseSha`, а пустой репозиторий даёт явный отказ вместо скрытого первого коммита.
- **Файлы:** Create `packages/worktree-adapter/{package.json,tsconfig.json,tsdown.config.ts}`, `packages/worktree-adapter/src/{index.ts,git.ts,adapter.ts,errors.ts}`; Modify `tsconfig.base.json` (path-map, аддитивно); Create `tests/worktree-adapter.test.mjs`.
- **Шаги:**
  0. Шаг 0: подтвердить, что `git` доступен и что `spawn` без shell его находит (урок `bd`: `spawnSync('bd', {shell:false})` → ENOENT на Windows, `00-RECON.md:162`).
     Команда: `node -e "const{execFileSync}=require('node:child_process');console.log(execFileSync('git',['--version'],{encoding:'utf8',shell:false}).trim())"`
     Ожидаем строку вида `git version 2.x.y` и exit 0. Если команда падает — пакет переходит на резолв абсолютного пути `git.exe` (фиксируется в решении `E-01`) и шаг продолжается с явным `GIT_NOT_FOUND`.
  1. Тест (падающий): семь тестов на временном репозитории (`git init` в `$env:TEMP`): (а) `prepare` возвращает `path` внутри `policy.root` и `baseSha` из `HEAD`; (б) пустой репозиторий → `EMPTY_REPOSITORY`; (в) повторный `prepare` с тем же `attemptId` → `WORKTREE_ALREADY_REGISTERED`; (г) `resolve` отвергает путь вне `policy.root` → `WORKTREE_OUTSIDE_WORKSPACE`; (д) `resolve` отвергает абсолютный путь-побег и `..`; (е) `cleanup` на грязном worktree → `WORKTREE_DIRTY` и каталог на месте; (ж) внешние `GIT_DIR`/`GIT_WORK_TREE` из окружения не влияют на результат.
     Команда: `node --test --test-isolation=none "tests/worktree-adapter.test.mjs"` → FAIL «Cannot find module …/worktree-adapter» .
  2. Реализация: `git.ts` — `runGit(args, cwd)` через `promisify(execFile)` с `shell:false`, `windowsHide:true` и **очищенным** окружением (`GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE` удаляются); `adapter.ts` — `prepare = git rev-parse --verify HEAD` → `git worktree add -b <branchPrefix><taskId>-<attemptId> <path> <baseSha>`; `readHead = git -C <path> rev-parse HEAD`.
  3. Сборка и прогон: `Push-Location packages/worktree-adapter; node ../../node_modules/tsdown/dist/run.mjs; Pop-Location` → `✔ Build complete`; затем тест шага 1.
     Команда: `node --test --test-isolation=none "tests/worktree-adapter.test.mjs"` → `pass 7 / fail 0`.
  4. Регрессия: `node --test --test-isolation=none "tests/boundaries.test.mjs"` → без новых падений (пакет бандлится сам, `@dsh-mywork/*` инлайнятся).
- **Гейт (готово когда):** `node --test --test-isolation=none "tests/worktree-adapter.test.mjs"` → `pass 7 / fail 0`; `node_modules\.bin\tsc.cmd --noEmit -p packages/worktree-adapter/tsconfig.json` → exit 0; `git worktree list` в тестовом репозитории не содержит лишних записей после тестов.
- **Evidence в отчёт:** вывод теста и сборки, `git --version`, список созданных worktree, `git diff --stat`.
- **Риски:** (1) тесты создают реальные репозитории — они обязаны жить в `$env:TEMP` и убираться в `finally`, иначе мусор в `.tmp`; (2) Windows-специфика `git worktree add` с длинными путями — если тест падает на пути, путь сокращается через короткий `policy.root`; (3) новый пакет не в `pnpm-workspace.yaml`-подобном списке — проверить, что `pnpm-lock.yaml` не требуется для тестов (тесты грузят `lib/` напрямую).

#### E-04 · Pin base/head SHA и workspace binding в claim-саге
- **Карточка:** MW-021 · **Зависит от:** E-03, F(единый реестр миграций + аллокатор версий, D08) · **Усилие:** M (2–3 ч) · **Риск:** средний (миграция схемы) · **Откат:** revert коммита; миграция аддитивна (номер выдан аллокатором), таблица снимается `DROP TABLE attempt_worktree` в откатном скрипте
- **Цель:** у каждой попытки durable-запись о worktree: путь, ветка, `baseSha` до работы и `headSha` после; `baseSha` фиксируется **до** любого изменения дерева.
- **Файлы:** Modify `packages/execution/src/schema.ts` — добавить миграцию, **версию которой выдаёт единый аллокатор** (D08, §1.6; литералов версий нет), рядом с `CLAIM_SAGA_MIGRATIONS:153`; Modify `packages/execution/src/store.ts` (`insertAttemptWorktree`, `readAttemptWorktree`, `settleAttemptWorktree`, рядом с `insertAttempt:360`); Modify `packages/execution/src/service.ts` (`ClaimSagaDeps:90` получает `worktrees?: WorktreePort`; вызов в `attemptAndComplete:440-613`); Modify `packages/execution/src/index.ts` (экспорт новых функций); Create `tests/worktree-binding.test.mjs`.
- **Шаги:**
  0. Шаг 0: подтвердить, что в таблице `attempt` нет колонок worktree, и зафиксировать **текущую базовую версию** как вход аллокатора (сегодня `6`), а не как номер будущей миграции.
     Команда: `Select-String -Path packages/execution/src/schema.ts -Pattern 'CLAIM_SAGA_SCHEMA_VERSION|worktree'` → `CLAIM_SAGA_SCHEMA_VERSION = 6` на `:48` и **ни одного** совпадения `worktree`.
     Команда (аллокатор существует и выдаёт номер): `Select-String -Path packages/storage/src/migrations.ts -Pattern 'validateMigrations'` → `:111`; сам аллокатор приходит из `F(единый реестр миграций + аллокатор версий, D08)` — если его ещё нет, шаг останавливается с BLOCKED, а не пишет номер сам.
  1. Тест (падающий): семь тестов на фейковом `WorktreePort` и `:memory:` БД: (а) после `claim` строка `attempt_worktree` содержит `base_sha`, равный аргументу порта; (б) `head_sha` пуст до settle и заполнен после; (в) отказ порта `EMPTY_REPOSITORY` переводит intent в `abandoned` и **не** создаёт attempt; (г) повторный `claim` с тем же `operationId` не создаёт вторую строку worktree; (д) `baseSha` читается до `prepare` (проверяется порядком вызовов фейка); (е) **прерывание между транзакциями** (процесс убит после коммита intent+attempt и до записи `base_sha`) оставляет ровно одну строку `attempt` **без** строки `attempt_worktree`, и `recover` доводит её до `abandoned` (или повторяет `prepare` с тем же `attemptId`), не создавая второй попытки; (ж) **отрицательный контроль синхронности:** `store.transaction(async () => …)` отвергается `invalid-input` — «a transaction body must be synchronous; an async body would commit before its work finished» (`packages/storage/src/store.ts:173`), то есть асинхронный git внутри транзакции невозможен by construction. Ожидаемый набор версий тест читает **из аллокатора**, литерала `[1,2,3,4,5,6]` в тесте нет (§1.6).
     Команда: `node --test --test-isolation=none "tests/worktree-binding.test.mjs"` → FAIL «no such table: attempt_worktree».
  2. Реализация — **две синхронные транзакции, асинхронный шаг между ними** (правка по верификации B: `MyWorkStore.transaction<T>(fn: (tx) => T): T` **синхронна**, `packages/storage/src/store.ts:59`, и асинхронное тело отвергается на `:173`; вложенная транзакция тоже запрещена — `transaction-conflict`, `:155`):
     - **транзакция №1 (внутри саги, синхронная):** новая миграция (номер от аллокатора) добавляется в `CLAIM_SAGA_MIGRATIONS` с DDL `CREATE TABLE attempt_worktree(attempt_id TEXT PRIMARY KEY REFERENCES attempt(attempt_id), path TEXT NOT NULL, branch TEXT NOT NULL, base_sha TEXT NOT NULL CHECK(length(base_sha)=40), head_sha TEXT, created_at INTEGER NOT NULL, settled_at INTEGER)`; затем `allocateFence → insertAttempt → insertAttemptWorktree` (path/branch ещё пусты) `→ intent: attempted (fence) → событие attempt.lease.granted` — durable intent до внешнего эффекта;
     - **вне транзакции (async):** `worktrees.prepare(request)` — единственный внешний вызов git;
     - **транзакция №2 (синхронная):** при успехе — запись `path`/`branch`/`base_sha`; при отказе порта — `settleAttempt(..., 'abandoned')` и `TASK_CONFLICT` с деталью кода порта.
     Альтернатива (отдельное соединение/двухфазная запись с компенсацией) отклонена: она даёт вторую точку записи в `controller.sqlite` и усложняет recovery без выигрыша — выбранный вариант уже соответствует дисциплине саги (`intent durable before external effect`, `packages/execution/src/service.ts:9-24`).
  3. Сборка и прогон: `Push-Location packages/execution; node ../../node_modules/tsdown/dist/run.mjs; Pop-Location` → `✔ Build complete`; тест → `pass 7 / fail 0`.
  4. Регрессия: `node --test --test-isolation=none "tests/claim-saga.test.mjs"` → не меньше прежних `32 pass / 0 fail` (все прежние тесты саги зелёные).
- **Гейт (готово когда):** `node --test --test-isolation=none "tests/worktree-binding.test.mjs"` → `pass 7 / fail 0`; `node --test --test-isolation=none "tests/claim-saga.test.mjs"` → `fail 0` при `pass >= 32`; `PRAGMA user_version` равен версии, **которую вернул аллокатор** для нового списка (не литералу).
- **Evidence в отчёт:** вывод обоих прогонов, `PRAGMA user_version` рядом с версией от аллокатора, `git diff --stat` по `packages/execution`.
- **Риски:** (1) `WorktreePort` опционален: сага без порта обязана работать как раньше — иначе падают все существующие тесты; (2) миграция версии не поднимается при повторном добавлении колонок в ту же версию (урок `.work/reports/MW-012-attempt-saga.md:238`, §8 п. 11): новая схема — только новая версия, и номер выдаёт аллокатор, а не шаг; (3) `packages/execution/src/index.ts` — публичная поверхность пакета, расширяется аддитивно; (4) дефект R-04: строковый литерал версии в шаге столкнётся с `F-36`/`F-40` (занятая `v7`) — `validateMigrations` (`packages/storage/src/migrations.ts:117-119`) бросит, и store не откроется.

#### E-05 · Два attempt'а не пишут в общий checkout
- **Карточка:** MW-021 · **Зависит от:** E-04 · **Усилие:** M (1–2 ч) · **Риск:** низкий · **Откат:** revert коммита (только тест + один guard)
- **Цель:** доказать приёмку карточки: параллельные попытки изолированы, выход из worktree отвергается платформенным ограничением, shared checkout не меняется.
- **Файлы:** Create `tests/worktree-isolation.test.mjs`; Modify `packages/execution/src/service.ts` (guard `assertAttemptWithinWorktree` перед выдачей результата, рядом с `assertOwnership:405-429`).
- **Шаги:**
  1. Тест (падающий): четыре теста во временном репозитории: (а) два параллельных `claim` разных задач дают **разные** абсолютные пути и разные ветки; (б) файл, записанный в worktree A, не виден ни в worktree B, ни в основном checkout (`git status --porcelain` в основном checkout пуст); (в) попытка записать по абсолютному пути основного checkout отвергается `packages/core/src/security.ts:203-207` с причиной `worktree-escape`; (г) `HEAD` основного checkout не изменился после обеих попыток.
     Команда: `node --test --test-isolation=none "tests/worktree-isolation.test.mjs"` → FAIL на первом assert (нет привязки к worktree).
  2. Реализация: `assertAttemptWithinWorktree(attempt, path)` — нормализует путь и требует `isWithinRoot(worktreePath, path)`; порт получает `worktreeRoot` в grant прав (`packages/contracts/src/security.ts:257-258` — поле уже есть).
  3. Прогон: `node --test --test-isolation=none "tests/worktree-isolation.test.mjs"` → `pass 4 / fail 0`.
  4. Регрессия: `node --test --test-isolation=none "tests/security.test.mjs"` → без новых падений.
- **Гейт (готово когда):** `pass 4 / fail 0`, и в отчёте приведён `git -C <основной checkout> status --porcelain` → пустая строка.
- **Evidence в отчёт:** вывод теста, две команды `git worktree list` (до/после), `git status --porcelain` основного checkout, diff.
- **Риски:** платформенное ограничение живёт в `packages/core/src/security.ts` (чужой слой для этой карточки) — правки там **не делаются**, используется существующее поведение; если его не хватает, шаг останавливается и заводится вопрос владельцу, а не «дописывается по месту».

#### E-06 · Cleanup и retention worktree: грязное и чужое не удаляется
- **Карточка:** MW-021 · **Зависит от:** E-05, F(retention), D17 · **Усилие:** M (2–3 ч) · **Риск:** средний (удаление каталогов) · **Откат:** revert коммита
- **Цель:** cleanup никогда не удаляет чужую или грязную работу; осиротевший каталог карантинится, а не стирается.
- **Файлы:** Modify `packages/worktree-adapter/src/adapter.ts` (`cleanup`); Modify `packages/worktree-adapter/src/git.ts` (`worktree remove`, `worktree prune`); Create `tests/worktree-cleanup.test.mjs`.
- **Шаги:**
  1. Шаг 0: подтвердить, что политика retention уже определена в соседнем файле плана (иначе взять дефолт и записать в решение).
     Команда: `Select-String -Path .work/plan-v0.3/*.md -Pattern 'retentionMs|окна хранения'` → совпадения в `21-STEPS-execution.md` (этот файл) и, если `20-STEPS-foundation.md` уже создан, в нём; при отсутствии — шаг идёт с `retentionMs = 7 * 24 * 3600 * 1000` и явной пометкой «значение по умолчанию до `D17`».
  2. Тест (падающий): шесть тестов: (а) чистый worktree удаляется, запись в `git worktree list` исчезает; (б) грязный (`M` файл) → `WORKTREE_DIRTY`, каталог на месте; (в) незарегистрированный в БД каталог под `policy.root` → `kept-orphan`, не удаляется; (г) путь вне `policy.root` → `WORKTREE_FOREIGN`, не удаляется; (д) два `cleanup` подряд идемпотентны (второй — `ok` без ошибки); (е) `list` показывает только worktree MyWork (по префиксу ветки), чужие ветки не возвращаются.
     Команда: `node --test --test-isolation=none "tests/worktree-cleanup.test.mjs"` → FAIL.
  3. Реализация: `cleanup` = `resolve` → проверка регистрации → `git -C <path> status --porcelain` непусто ⇒ `WORKTREE_DIRTY`; иначе `git worktree remove <path>`; `prune` вызывается **только** для записей, которые MyWork сам удалил.
  4. Прогон: `node --test --test-isolation=none "tests/worktree-cleanup.test.mjs"` → `pass 6 / fail 0`.
  5. Регрессия: `node --test --test-isolation=none "tests/worktree-adapter.test.mjs" "tests/worktree-isolation.test.mjs"` → `fail 0`.
- **Гейт (готово когда):** `pass 6 / fail 0`; отдельно в отчёте — вывод `git worktree list` после теста (в тестовом репозитории не остаётся записей MyWork).
- **Evidence в отчёт:** вывод теста, `git worktree list` до/после, перечень удалённых и сохранённых каталогов с причинами.
- **Риски:** (1) `git worktree remove` на Windows падает при открытых файлах — тест обязан закрывать хэндлы до cleanup; (2) «чужой worktree» в этом же репозитории (`git worktree list` может содержать `.tmp/mw012-review`, `.work/reports/MW-012-attempt-saga.md:240`) — cleanup не имеет права его трогать, это отдельный тест (е).

---

## 4. Группа B. Worker от admission до результата (MW-022)

Карточка: `.work/tasks/MW-022.md:1`, зависимости `MW-014, MW-015, MW-016, MW-017, MW-018, MW-020, MW-021` (`:4`, `:13`); объём `:17`: «scheduler → claim → worktree → frozen context → fresh Worker Session → evidence/checkpoint → settling. Identity остаётся долговечной; sleeping после завершения не держит модель. Worker не финализирует TaskGraph Done»; приёмка `:20`: «Один сценарий на fakes проходит end-to-end; failure сохраняет evidence и освобождает capacity. Restart и late callback не создают вторую authoritative попытку. Каждая попытка хранит использованные revisions».

#### E-07 · Контракт `AttemptRunPort` и фейк рантайма попытки
- **Карточка:** MW-022 · **Зависит от:** E-04 · **Усилие:** M (1–2 ч) · **Риск:** низкий · **Откат:** revert коммита
- **Цель:** запуск одной попытки выражен портом, а не прямым вызовом DSH, чтобы сценарий end-to-end проверялся на fakes без платной модели.
- **Файлы:** Create `packages/contracts/src/attempt-run.ts`; Modify `packages/contracts/src/index.ts` (реэкспорт); Create `tests/attempt-run.test.mjs`.
- **Шаги:**
  0. Шаг 0: подтвердить форму порта рантайма, на который опирается новый порт.
     Команда: `Select-String -Path packages/contracts/src/agent-runtime.ts -Pattern 'export interface AgentRuntimePort|readonly runId|rejects a duplicate'` → три совпадения на `:223`, `:68-69`.
  1. Тест (падающий): пять тестов: (а) `AttemptRunRequest` требует `runId`, `worktree`, `frozen` и `scope.agentPreset`; (б) `runId` совпадает с `attemptId`-производным значением (проверяется предикатом, не строкой); (в) словарь исходов закрыт: `COMPLETED|FAILED|CANCELLED`; (г) `AttemptRunOutcome.artifactRefs` — массив `ArtifactRef`, не строки; (д) фейк-рантайм из `packages/adapter-sdk/src/testing.ts` (`:332`) реализует порт без правок SDK.
     Команда: `node --test --test-isolation=none "tests/attempt-run.test.mjs"` → FAIL «Cannot find module …/attempt-run» .
  2. Реализация: `AttemptRunPort { run(request, options): Promise<Result<AttemptRunOutcome>>; resume(request, options); status(runId): Result<AttemptRunStatus> }`; `runId` — **caller-owned** и равен детерминированному значению от `attemptId` (не `randomUUID`), чтобы restart искал ровно ту сессию (урок `roster.ts:259`, `00-RECON.md` B §9 = `B-orchestration.md:76`).
  3. Сборка и прогон: `Push-Location packages/contracts; node ../../node_modules/tsdown/dist/run.mjs; Pop-Location` → `✔ Build complete`; тест → `pass 5 / fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none "tests/attempt-run.test.mjs"` → `pass 5 / fail 0`; `node_modules\.bin\tsc.cmd --noEmit -p packages/contracts/tsconfig.json` → exit 0.
- **Evidence в отчёт:** вывод теста и сборки, `git diff --stat packages/contracts`.
- **Риски:** `runId` как функция от `attemptId` — контрактное решение: если позже понадобится resume с другим id, `AgentResumeRequest.runId` (`packages/contracts/src/agent-runtime.ts:87-96`) требует именно записанный id, поэтому детерминизм обязателен.

#### E-08 · Оркестратор попытки: admission → worktree → frozen context → сессия → промпт
- **Карточка:** MW-022 · **Зависит от:** E-07, E-03, F(composition root) · **Усилие:** L (4–6 ч) · **Риск:** высокий (центральный шаг конвейера) · **Откат:** revert коммита
- **Цель:** один сценарий на fakes проходит end-to-end в предписанном порядке, а повторный вызов не создаёт вторую сессию.
- **Файлы:** Create `packages/execution/src/worker.ts`; Modify `packages/execution/src/index.ts`; Modify `packages/execution/src/service.ts` (переиспользование `claim`, без дублирования саги); Create `tests/worker-flow.test.mjs`.
- **Шаги:**
  0. Шаг 0: подтвердить, что композиция store/портов появилась в composition root (иначе оркестратор проверяется только на ручной сборке, и это должно быть названо в отчёте).
     Команда: `Select-String -Path packages/controller/src/index.ts -Pattern 'createClaimSaga|openStore|ControllerLifecycle'` → ожидаем **непустой** результат после `F(composition root)`; до него — 0 совпадений, и шаг идёт на fakes с явной пометкой.
  1. Тест (падающий): семь тестов на fakes: (а) порядок вызовов портов ровно `claim → worktrees.prepare → context.materialize → runtime.start → settle` — **отдельной операции `prompt` у порта нет**: промпт входит в `AgentStartRequest.prompt` (`packages/contracts/src/agent-runtime.ts:67-76`), а `prompt(request, signal)` — это метод **адаптера** (`packages/controller/src/dsh-session.ts:199-207`), не порта (§17.4); (б) `runtime.start` получает `runId`, `workspacePath = worktree.path` и `scope.agentPreset` из роли; (в) второй вызов `runAttempt` на той же попытке не вызывает `runtime.start` повторно; (г) отказ `runtime.start` переводит попытку в `failed`, но оставляет evidence; (д) `context.materialize` вызывается **после** `claim` (то есть после того, как revisions заморожены); (е) отмена через `AbortSignal` доводит попытку до `cancelled`; (ж) промпт содержит `taskId`, `attemptId` и путь worktree, но не содержит содержимого shared checkout.
     Команда: `node --test --test-isolation=none "tests/worker-flow.test.mjs"` → FAIL «Cannot find module …/worker» .
  2. Реализация: `createWorker(deps)` c инъецированными `saga`, `worktrees`, `context`, `runtime`, `evidence`, `clock`; никакого `import` из DSH и никаких `node:*` кроме `node:crypto` (иначе `tests/boundaries.test.mjs:488` краснеет).
  3. Сборка и прогон: `Push-Location packages/execution; node ../../node_modules/tsdown/dist/run.mjs; Pop-Location` → `✔ Build complete`; тест → `pass 7 / fail 0`.
  4. Регрессия: `node --test --test-isolation=none "tests/claim-saga.test.mjs" "tests/worktree-binding.test.mjs"` → `fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none "tests/worker-flow.test.mjs"` → `pass 7 / fail 0`; журнал порядка вызовов в отчёте совпадает с (а) дословно.
- **Evidence в отчёт:** вывод теста, дамп порядка вызовов фейков, вывод `tests/boundaries.test.mjs` (границы не нарушены).
- **Риски:** (1) соблазн вызвать `claim` внутри оркестратора второй раз — сага уже идемпотентна по `operationId`, дублирование создаст вторую попытку; (2) оркестратор не должен знать про scheduler — admission приходит снаружи;
  (3) пересечение с `D10` (что отдаём платформенным швам memory/skill/context): здесь используется **порт** контекста, конкретный провайдер выбирает `plan-quality`.

#### E-09 · Frozen revisions и `context-snapshot` на попытку
- **Карточка:** MW-022 · **Зависит от:** E-08 · **Усилие:** M (1–2 ч) · **Риск:** низкий · **Откат:** revert коммита
- **Цель:** приёмка «каждая попытка хранит использованные revisions» доказана артефактом и записью в БД.
- **Файлы:** Modify `packages/execution/src/worker.ts`; Create `tests/attempt-revisions.test.mjs`.
- **Шаги:**
  0. Шаг 0: подтвердить, что revisions уже часть контракта попытки.
     Команда: `Select-String -Path packages/contracts/src/attempt.ts -Pattern 'FrozenRevisions|revisions'` → совпадения на `:119-120`.
  1. Тест (падающий): четыре теста: (а) `context-snapshot` кладётся в artifact store до `runtime.start`; (б) его метаданные несут `taskId`, `attemptId`, `correlationId` (`packages/contracts/src/artifact.ts:82-96`); (в) повторный запуск той же попытки переиспользует тот же артефакт (hash совпадает); (г) `Attempt.revisions` после попытки равен замороженному до старта.
     Команда: `node --test --test-isolation=none "tests/attempt-revisions.test.mjs"` → FAIL.
  2. Реализация: `materialize` → `putArtifact({ kind: 'context-snapshot', … })` → `artifactRef` в результат попытки; `revisions` пишутся в `attempt`-путь через существующий `settle`-путь (`packages/execution/src/store.ts:428`).
  3. Прогон: `node --test --test-isolation=none "tests/attempt-revisions.test.mjs"` → `pass 4 / fail 0`.
  4. Регрессия: `node --test --test-isolation=none "tests/evidence.test.mjs"` → без новых падений.
- **Гейт (готово когда):** `pass 4 / fail 0`; в отчёте — sha256 артефакта и строка `attempt.revisions` после попытки.
- **Evidence в отчёт:** вывод теста, `artifactId` + `sha256`, `git diff --stat`.
- **Риски:** вид `context-snapshot` уже есть в закрытом словаре (`packages/contracts/src/artifact.ts:50-51`) — новых видов не вводим.

#### E-10 · Failure-путь: evidence сохранён, capacity освобождена
- **Карточка:** MW-022 · **Зависит от:** E-08 · **Усилие:** M (1–2 ч) · **Риск:** средний · **Откат:** revert коммита
- **Цель:** провал попытки не теряет доказательств и не держит ресурс: живой lease исчезает, состояние терминальное.
- **Файлы:** Modify `packages/execution/src/worker.ts`; Create `tests/worker-failure.test.mjs`.
- **Шаги:**
  1. Тест (падающий): пять тестов: (а) провал `runtime.start` → `attempt.state = 'failed'`, `settledAt` заполнен; (б) `worker-report` артефакт существует и содержит причину; (в) `listLiveAttempts(workspaceId)` после провала пуст; (г) `task_fence` не сдвинулся (нумерация fence монотонна только на новых попытках); (д) после провала admission следующей задачи проходит (`capacity` свободна).
     Команда: `node --test --test-isolation=none "tests/worker-failure.test.mjs"` → FAIL.
  2. Реализация: единая точка выхода `finally`-пути, вызывающая `settleAttempt(..., outcome)`; артефакт пишется **до** settle, чтобы отказ записи артефакта не оставил попытку живой.
  3. Прогон: `node --test --test-isolation=none "tests/worker-failure.test.mjs"` → `pass 5 / fail 0`.
  4. Регрессия: `node --test --test-isolation=none "tests/attempt.test.mjs"` → без новых падений.
- **Гейт (готово когда):** `pass 5 / fail 0`; в отчёте — `SELECT state, settled_at FROM attempt` (одна строка `failed`) и `SELECT count(*) FROM attempt WHERE state IN ('created','leased','starting','running','settling')` → `0`.
- **Evidence в отчёт:** вывод теста и двух SQL-запросов, список артефактов попытки.
- **Риски:** истечение lease при settle сегодня **не** проверяется (`.work/reports/MW-012-attempt-saga.md:230`); этот шаг не добавляет проверку — она приходит в `E-46` (reconcile) и `E-47` (stall), а здесь фиксируется как известное ограничение.

#### E-11 · Restart и late callback не создают вторую authoritative попытку
- **Карточка:** MW-022 · **Зависит от:** E-08 · **Усилие:** M (2–3 ч) · **Риск:** высокий (восстановление после процесса) · **Откат:** revert коммита
- **Цель:** после рестарта процесса попытка продолжается, а не удваивается; поздний результат отвергается тем же fence-механизмом.
- **Файлы:** Modify `packages/execution/src/worker.ts` (`resume`-путь); Create `tests/worker-restart.test.mjs`; Create `tests/lib/worker-crash-child.mjs` (по образцу `tests/lib/claim-crash-child.mjs`).
- **Шаги:**
  0. Шаг 0: подтвердить, что порт рантайма принимает внешний id и отвергает дубликат.
     Команда: `Select-String -Path packages/contracts/src/agent-runtime.ts -Pattern 'rejects a duplicate|runId'` → совпадения на `:68`, `:89`.
  1. Тест (падающий): пять тестов: (а) `resume` после «рестарта» (новый объект рантайма поверх той же БД) не вызывает `prepare` повторно; (б) `start` с уже занятым `runId` возвращает отказ, а не создаёт вторую сессию; (в) поздний результат с чужим fence → `STALE_FENCE` (`packages/execution/src/service.ts:413`); (г) дочерний процесс, убитый между `prepare` и `start`, оставляет **ровно одну** строку `attempt` и одну `attempt_worktree`; (д) повторный `resume` идемпотентен.
     Команда: `node --test --test-isolation=none "tests/worker-restart.test.mjs"` → FAIL.
  2. Реализация: восстановление читает `attempt_worktree` и `runId`, вызывает `runtime.resume(sessionId)` и **повторно** применяет scope (idempotent-контракт `packages/contracts/src/agent-runtime.ts:87-96`), затем переигрывает промпт только если его нет в логе сессии. **Обязательно:** повторно применяется и ограничение поверхности (`E-39`) — restriction процесс-локальна и в лог сессии не сериализуется (`core/tools/src/index.ts:736`), поэтому без повторного `setup` resumed-попытка окажется **без** запрета.
  3. Прогон: `node --test --test-isolation=none "tests/worker-restart.test.mjs"` → `pass 5 / fail 0`.
  4. Регрессия: `node --test --test-isolation=none "tests/claim-saga.test.mjs"` → `fail 0`.
- **Гейт (готово когда):** `pass 5 / fail 0`; в отчёте — вывод теста (в) с дословной строкой `STALE_FENCE` и число строк `attempt` после краш-теста.
- **Evidence в отчёт:** вывод теста, лог дочернего процесса, SQL-счётчики до/после.
- **Риски:** (1) `tests/lib/worker-crash-child.mjs` использует `process.exit` между шагами — флаки по таймингу; тест обязан ждать по готовому маркеру в файле, а не по `sleep`; (2) отказ дубликата — ответственность рантайма, а не оркестратора: тест проверяет **наблюдаемое** поведение через фейк, а не внутренний флаг.

#### E-12 · Worker не финализирует TaskGraph `Done`
- **Карточка:** MW-022 · **Зависит от:** E-08 · **Усилие:** S (30–60 мин) · **Риск:** низкий · **Откат:** revert коммита
- **Цель:** граница authority закреплена тестом: после успешной работы задача попадает в `awaiting-review`, а `done` ставит только интегратор (`E-28`).
- **Файлы:** Create `tests/worker-no-done.test.mjs`.
- **Шаги:**
  0. Шаг 0: подтвердить словарь состояний, который проверяет тест.
     Команда: `Select-String -Path packages/contracts/src/task.ts -Pattern "'awaiting-review'|'done'|'integrating'"` → совпадения на `:23`, `:29`, `:31`.
  1. Тест (падающий): три теста: (а) успешный прогон на fakes переводит задачу в `awaiting-review` и **никогда** в `done`; (б) `graph.transition(..., 'done')` из попытки отвергается (проверяется, что оркестратор не имеет пути к этому вызову — `apply`-мутация только в интеграторе); (в) `changes-requested`/`failed` как боковые состояния всё ещё позволяют новую попытку.
     Команда: `node --test --test-isolation=none "tests/worker-no-done.test.mjs"` → FAIL.
  2. Реализация: оркестратор возвращает исход, а перевод задачи делает вызывающий слой; в `worker.ts` нет вызовов `graph.transition` со значением `done`.
  3. Прогон: `node --test --test-isolation=none "tests/worker-no-done.test.mjs"` → `pass 3 / fail 0`.
  4. Регрессия: `node --test --test-isolation=none "tests/authority.test.mjs"` → без новых падений (матрица authority не изменилась).
- **Гейт (готово когда):** `pass 3 / fail 0`; в отчёте — вывод `tests/authority.test.mjs` и `Select-String -Path packages/execution/src/worker.ts -Pattern "'done'"` → 0 совпадений.
- **Evidence в отчёт:** вывод тестов, результат grep, diff.
- **Риски:** переход `executing → awaiting-review` уже существует в словаре; если адаптер графа его не принимает, шаг останавливается с точной причиной (это дефект адаптера, а не повод ослабить тест).

---

## 5. Группа C. Детерминированные verification gates (MW-023)

Карточка: `.work/tasks/MW-023.md:1`, зависимость `MW-022` (`:4`, `:13`); объём `:17`: «Запускать configured build/tests/lint/policy/artifact/base/head gates в worktree до review; результаты и exit codes хранить как artifacts. Набор проверок зависит от workspace/task»; приёмка `:20`: «Failing/missing gate блокирует review admission и Done. Gates относятся к exact head и имеют bounded timeout/cancel. Нельзя превратить ошибку инструмента в PASS».

#### E-13 · Контракт `GateSpec`/`GateResult` и вид артефакта `gate-result`
- **Карточка:** MW-023 · **Зависит от:** E-08 · **Усилие:** M (1–2 ч) · **Риск:** низкий (закрытый словарь) · **Откат:** revert коммита
- **Цель:** вердикт гейта — типизированная величина с явным исходом, а не текст лога.
- **Файлы:** Create `packages/contracts/src/verification.ts`; Modify `packages/contracts/src/artifact.ts:31-75` (аддитивно `'gate-result'`); Modify `packages/contracts/src/index.ts`; Create `tests/gates-contract.test.mjs`; Modify `tests/evidence.test.mjs` (пиннинг словаря видов — в этом файле словарь уже пиннится, `.work/reports/MW-012-attempt-saga.md:218`).
- **Шаги:**
  0. Шаг 0: подтвердить, что вида `gate-result` в словаре сейчас нет и что словарь закрыт.
     Команда: `Select-String -Path packages/contracts/src/artifact.ts -Pattern "gate-result|'gate-decision'"` → только `gate-decision` на `:59`, `:74`; `gate-result` — 0 совпадений.
  1. Тест (падающий): пять тестов: (а) `ARTIFACT_KINDS.length` вырос ровно на 1 и порядок прежних не изменился (порядок сравнивается с зафиксированным списком); (б) `GateVerdict = 'pass' | 'fail' | 'error' | 'timeout' | 'cancelled'` — `error`/`timeout`/`cancelled` **не** равны `pass`; (в) `GateSpec` требует `id`, `command`, `args`, `timeoutMs > 0`; (г) `GateResult` требует `headSha` (40 hex), `exitCode: number | null`, `verdict`, `artifactRef`; (д) `missing` гейт описывается отдельным значением (`verdict: 'error'`, `reason: 'GATE_MISSING'`), а не отсутствием записи.
     Команда: `node --test --test-isolation=none "tests/gates-contract.test.mjs"` → FAIL.
  2. Реализация: словарь и типы в `verification.ts`; `'gate-result'` добавлен **после** `'gate-decision'` (порядок §32 не переинтерпретируется).
  3. Сборка и прогон: `Push-Location packages/contracts; node ../../node_modules/tsdown/dist/run.mjs; Pop-Location` → `✔ Build complete`; тесты → `pass 5 / fail 0`; `node --test --test-isolation=none "tests/evidence.test.mjs"` → без новых падений.
- **Гейт (готово когда):** `node --test --test-isolation=none "tests/gates-contract.test.mjs"` → `pass 5 / fail 0` и `tests/evidence.test.mjs` → `fail 0`.
- **Evidence в отчёт:** вывод обоих тестов, `git diff --stat packages/contracts tests/evidence.test.mjs`.
- **Риски:** словарь видов артефактов закрыт контрактом (`packages/contracts/src/artifact.ts:31-75`) — добавление аддитивно и требует правки пиннинга; иначе падает чужая сюита.

#### E-14 · Раннер гейтов: bounded timeout/cancel, ошибка инструмента ≠ PASS
- **Карточка:** MW-023 · **Зависит от:** E-13, E-03 · **Усилие:** M (2–3 ч) · **Риск:** средний (запуск процессов) · **Откат:** revert коммита
- **Цель:** ни один сбой инструмента не превращается в зелёный вердикт.
- **Файлы:** Create `packages/gate-runner/src/{index.ts,runner.ts,errors.ts}` (или `packages/worktree-adapter/src/gates.ts`, если новый пакет признан лишним — решение фиксируется в `E-01`-файле), `package.json`, `tsconfig.json`, `tsdown.config.ts`; Create `tests/gates-runner.test.mjs`.
- **Шаги:**
  1. Тест (падающий): восемь тестов: (а) `exitCode 0` → `pass`; (б) `exitCode 1` → `fail`, артефакт содержит оба потока; (в) неизвестная команда → `error` с `GATE_TOOL_MISSING`, **не** `pass`; (г) превышение `timeoutMs` → `timeout`, процесс убит; (д) `AbortSignal` → `cancelled`; (е) гейт исполняется **в каталоге worktree**, а не в корне репозитория (проверяется `cwd` процесса через `process.cwd()` в самой команде); (ж) два гейта с одинаковым `id` отвергаются; (з) результат всегда несёт `artifactRef` (даже `error`).
     Команда: `node --test --test-isolation=none "tests/gates-runner.test.mjs"` → FAIL «Cannot find module».
  2. Реализация: `runGate(spec, { cwd, signal, clock })` через `promisify(execFile)` с `shell:false`, `windowsHide:true`, `timeout`, `maxBuffer` (ограничение размера лога — иначе BLOB-артефакт вырастет неограниченно, `00-RECON.md:174` п. 7); stdout+stderr пишутся артефактом **до** возврата вердикта.
  3. Сборка и прогон: `Push-Location packages/gate-runner; node ../../node_modules/tsdown/dist/run.mjs; Pop-Location` → `✔ Build complete`; тест → `pass 8 / fail 0`.
  4. Регрессия границ: `node --test --test-isolation=none "tests/boundaries.test.mjs"` → без новых падений; новый пакет обязан быть добавлен в сканер `F(boundary-скан)`.
- **Гейт (готово когда):** `pass 8 / fail 0`; в отчёте — вывод теста (в) с `GATE_TOOL_MISSING` и теста (г) с убитым процессом.
- **Evidence в отчёт:** вывод теста и сборки, sha256 артефакта лога, `git diff --stat`.
- **Риски:** (1) запуск внешних команд из тестов должен идти только по фиксированным spec'ам, без `shell:true`; (2) на Windows `execFile('npm')` не найдётся — spec'ы обязаны называть исполняемый файл (`node`, `git`, `pnpm.cmd`) и это записывается в решении `E-01`; (3) если пакет решено не создавать, шаг переносится в `worktree-adapter` без изменения тестов.

#### E-15 · Пиннинг exact head: `GATE_HEAD_MOVED`
- **Карточка:** MW-023 · **Зависит от:** E-14 · **Усилие:** S (1 ч) · **Риск:** низкий · **Откат:** revert коммита
- **Цель:** вердикт гейтов относится к ровно тому head, который проверялся.
- **Файлы:** Modify `packages/gate-runner/src/runner.ts`; Create `tests/gates-head.test.mjs`.
- **Шаги:**
  1. Тест (падающий): четыре теста: (а) `headSha` до прогона совпадает с `headSha` после — вердикт валиден; (б) если между гейтами head изменился (`git commit --allow-empty` из теста) → `GATE_HEAD_MOVED`, все вердикты отбрасываются; (в) `GateRunResult.headSha` заполнен всегда; (г) отбрасывание не удаляет артефакты (они остаются evidence провала).
     Команда: `node --test --test-isolation=none "tests/gates-head.test.mjs"` → FAIL.
  2. Реализация: `readHead(cwd)` = `git -C <cwd> rev-parse HEAD` (использовать существующую функцию `E-03`); при расхождении — типизированный отказ и `needs-attention`-кандидат, а не `pass`.
  3. Прогон: `node --test --test-isolation=none "tests/gates-head.test.mjs"` → `pass 4 / fail 0`.
- **Гейт (готово когда):** `pass 4 / fail 0`; в отчёте — два разных `headSha` из теста (б) и код отказа.
- **Evidence в отчёт:** вывод теста, пара `headSha` до/после.
- **Риски:** определение head через git вводит второй механизм чтения репозитория; он берётся из `E-03`, а не пишется заново.

#### E-16 · Набор гейтов по workspace/task и отказ `GATE_UNCONFIGURED`
- **Карточка:** MW-023 · **Зависит от:** E-14 · **Усилие:** M (1–2 ч) · **Риск:** средний (конфигурация) · **Откат:** revert коммита
- **Цель:** «missing gate блокирует» — набор проверок берётся из конфигурации, и его отсутствие является провалом, а не пропуском.
- **Файлы:** Create `packages/gate-runner/src/policy.ts`; Modify `packages/contracts/src/verification.ts` (`GatePolicy`); Create `tests/gates-policy.test.mjs`.
- **Шаги:**
  0. Шаг 0: подтвердить, где живёт конфигурация workspace в контрактах, чтобы не завести второй источник.
     Команда: `Select-String -Path packages/contracts/src/config.ts -Pattern 'export interface|export type'` → список типов конфигурации; шаг выбирает существующий корень и не создаёт параллельный.
  1. Тест (падающий): пять тестов: (а) пустая политика → `GATE_UNCONFIGURED`, не `pass`; (б) политика с одним гейтом → ровно один прогон; (в) гейты, помеченные `required: true`, отличаются от информационных: провал информационного не блокирует, провал обязательного блокирует; (г) гейт `base`/`head` сравнивает `baseSha` попытки с текущим head и даёт `fail` при расхождении базы; (д) политика, требующая отсутствующий бинарь, даёт `error`, а не `pass`.
     Команда: `node --test --test-isolation=none "tests/gates-policy.test.mjs"` → FAIL.
  2. Реализация: `GatePolicy { gates: readonly GateSpec[], strict: boolean }`; резолвер политики по `workspaceId`, fallback — явный отказ.
  3. Прогон: `node --test --test-isolation=none "tests/gates-policy.test.mjs"` → `pass 5 / fail 0`.
- **Гейт (готово когда):** `pass 5 / fail 0`; в отчёте — вывод теста (а) с `GATE_UNCONFIGURED`.
- **Evidence в отчёт:** вывод теста, пример использованной политики (JSON), diff.
- **Риски:** «набор зависит от workspace/task» может потребовать поля в чужой сущности (`Task`) — этого не делаем: политика читается по `workspaceId` и `workType`, а `Task` не расширяется (authority `taskgraph.ts:9-14`).

#### E-17 · Провал или отсутствие гейта блокирует review admission
- **Карточка:** MW-023 · **Зависит от:** E-16 · **Усилие:** M (1–2 ч) · **Риск:** средний · **Откат:** revert коммита
- **Разрыв цикла (верификация B):** шаг **не** зависит от `E-19` (review-очередь, MW-024) — иначе получается цикл `MW-023 ↔ MW-024`. Первичен `MW-023` (`MW-024.md:4` объявляет зависимость от `MW-023`): этот шаг даёт **проверку** (`assertGatesSatisfied(attemptId, headSha)` — чистая функция + чтение `gate-result`), а `E-19` её **вызывает** при постановке review. Граф карточек правит `card-ledger` со своей стороны.
- **Цель:** приёмка «failing/missing gate блокирует review admission и Done» доказана отказом на входе в review, а не текстом в отчёте.
- **Файлы:** Create `packages/execution/src/gates-admission.ts` (`assertGatesSatisfied(attemptId, headSha)` — чистая проверка поверх записей `gate-result`); Modify `packages/execution/src/worker.ts` (запись `gate-result` перед `awaiting-review`); Create `tests/gates-admission.test.mjs`. Файл `review-queue.ts` создаёт `E-19` — он эту проверку **вызывает**, поэтому здесь он не правится (разрыв цикла).
- **Шаги:**
  1. Тест (падающий): пять тестов: (а) попытка без записей гейтов **не** допускается в очередь review (`REVIEW_GATES_MISSING`); (б) `fail` обязательного гейта → то же; (в) `error`/`timeout` → то же; (г) все `required` зелёные → review допускается; (д) `Done` недостижим из состояния без одобренного review (проверяется матрицей переходов, `packages/core/src/review.ts:39-49`).
     Команда: `node --test --test-isolation=none "tests/gates-admission.test.mjs"` → FAIL.
  2. Реализация: `assertGatesSatisfied` читает последние `gate-result` для `(attemptId, headSha)` и допускает только при полном зелёном наборе `required`; `E-19` вызывает её при постановке review (единственное направление зависимости).
  3. Прогон: `node --test --test-isolation=none "tests/gates-admission.test.mjs"` → `pass 5 / fail 0`.
- **Гейт (готово когда):** `pass 5 / fail 0`; в отчёте — `SELECT count(*) FROM artifact WHERE kind='gate-result' AND …` для успешного и провального сценария.
- **Evidence в отчёт:** вывод теста, SQL-выборка гейтов, diff.
- **Риски:** цикла с `E-19` нет (см. «Разрыв цикла» выше): этот шаг даёт проверку `assertGatesSatisfied`, `E-19` её вызывает; если очередь review ещё не готова, проверка всё равно тестируется на фейке очереди. Человеческая приёмка по work type — **не здесь**: `Q-20` (`contracts/src/worktype.ts`), `Q-21` (`FINISH_CRITERIA_UNMET`, гейт блокирует `done`), `Q-22` (`ARTIFACT_KINDS` + 4 интегратора) в `23-STEPS-quality.md`; этот шаг отвечает только за «гейты → review admission».

#### E-18 · Детерминизм вердикта и инъецированные часы
- **Карточка:** MW-023 · **Зависит от:** E-14, D11 · **Усилие:** S (1 ч) · **Риск:** низкий · **Откат:** revert коммита
- **Цель:** один и тот же head с тем же набором гейтов даёт один и тот же вердикт; вердикт не зависит от стеновых часов.
- **Файлы:** Modify `packages/gate-runner/src/runner.ts`; Create `tests/gates-determinism.test.mjs`.
- **Шаги:**
  0. Шаг 0: подтвердить, что часы в проекте инъецируются, а `Date.now` в новом коде не появляется.
     Команда: `Select-String -Path packages/scheduler/src/service.ts -Pattern 'clock.now|ClockPort'` → совпадения (образец); затем после реализации — `Select-String -Path packages/gate-runner/src/*.ts -Pattern 'Date.now|Math.random'` → 0 совпадений.
  1. Тест (падающий): четыре теста: (а) два прогона одного гейта на одном head дают одинаковые `verdict` и `exitCode`; (б) разница только во времени выполнения не меняет `verdict`; (в) `startedAt`/`settledAt` берутся из инъецированных часов (`FakeClock`) и совпадают в тесте; (г) в исходниках пакета нет `Date.now`/`Math.random`.
     Команда: `node --test --test-isolation=none "tests/gates-determinism.test.mjs"` → FAIL.
  2. Реализация: часы через `ClockPort` (`packages/contracts/src/index.ts:56`), сравнение вердиктов — на `verdict`/`exitCode`, а не на длительности.
  3. Прогон: `node --test --test-isolation=none "tests/gates-determinism.test.mjs"` → `pass 4 / fail 0`.
  4. Регрессия: `node --test --test-isolation=none "tests/gates-runner.test.mjs"` → `fail 0`.
- **Гейт (готово когда):** `pass 4 / fail 0`; в отчёте — вывод grep `Date.now` (0 совпадений).
- **Evidence в отчёт:** вывод теста, вывод grep, diff.
- **Риски:** таймаут гейта зависит от машины — тест не должен утверждать конкретную длительность, только вердикт.

---

## 6. Группа D. Независимый review и reject-flow (MW-024)

Карточка: `.work/tasks/MW-024.md:1`, зависимости `MW-015, MW-020, MW-023` (`:4`, `:13`); объём `:17`: «отдельная Review очередь/pool, fresh Session, evidence package и structured findings. Approval привязать к reviewedHeadSha/diffHash. Reject возвращает ту же Identity/worktree с новой Attempt и checkpoint/findings; лимитировать review loops»; приёмка `:20`: «Self-review запрещён; Reviewer не редактирует implementation. Изменение SHA/diff отменяет approval. Reject/NeedsEvidence/Escalated корректно переходят в следующий state; превышение loops требует решения».

**Что уже есть и не строится заново:** машина переходов и **три готовых инварианта** — `assertReviewerIndependence` (`packages/core/src/review.ts:109`), `assertReviewerReadOnly` (`:129`), `isReviewApprovalCurrent`/`assertReviewApprovalCurrent` (`:146`, `:157`); состояния, требующие findings, — `REVIEW_STATES_REQUIRING_FINDINGS` (`:51`). Шаги ниже подключают их к исполнению, а не переписывают.

#### E-19 · Review-очередь и отдельный pool `review`
- **Карточка:** MW-024 · **Зависит от:** E-08, E-17 (проверка гейтов вызывается отсюда; обратного ребра нет) · **Усилие:** M (2–3 ч) · **Риск:** средний · **Откат:** revert коммита
- **Цель:** review — отдельная работа со своим pool и своим claim, не продолжение worker-попытки.
- **Файлы:** Create `packages/execution/src/review-queue.ts`; Modify `packages/execution/src/schema.ts` — новая миграция с версией **от аллокатора** (D08, §1.6), таблица `review_claim`; Modify `packages/execution/src/index.ts`; Create `tests/review-queue.test.mjs`.
- **Шаги:**
  0. Шаг 0: подтвердить, что вид работ `review` уже существует в планировщике и что review-состояния — контракт.
     Команда: `Select-String -Path packages/core/src/scheduler.ts -Pattern "'worker','review'|'review'"` → совпадение на `:314`; `Select-String -Path packages/contracts/src/review.ts -Pattern "REVIEW_STATES"` → `:31`.
  1. Тест (падающий): шесть тестов: (а) постановка review из `awaiting-review` создаёт запись `queued` с `revision = 1`; (б) повторная постановка по тому же `(attemptId, headSha)` идемпотентна; (в) `claimReview` переводит `queued → claimed` только при `expectedRevision`; (г) устаревшая revision → `STALE_REVISION`; (д) review-работы считаются занятостью вида `review` в `countSchedulerOccupancy` (проверяется числом, не текстом); (е) worker-попытка и review-попытка на одну задачу не могут быть живыми одновременно.
     Команда: `node --test --test-isolation=none "tests/review-queue.test.mjs"` → FAIL «no such table: review_claim».
  2. Реализация: таблица `review_claim(review_id PK, attempt_id, task_id, head_sha, diff_hash, state, revision, reviewer_id, requested_at, settled_at)` с CAS по `revision`, в том же `controller.sqlite`, что fence/attempt (`.work/reports/MW-012-attempt-saga.md:241`).
  3. Сборка и прогон: `Push-Location packages/execution; node ../../node_modules/tsdown/dist/run.mjs; Pop-Location` → `✔ Build complete`; тест → `pass 6 / fail 0`.
  4. Регрессия: `node --test --test-isolation=none "tests/claim-saga.test.mjs" "tests/scheduler.test.mjs"` → `fail 0`.
- **Гейт (готово когда):** `pass 6 / fail 0`; в отчёте — `PRAGMA user_version` (равен версии от аллокатора) и SQL-выборка очереди.
- **Evidence в отчёт:** вывод тестов, дамп строк `review_claim`, diff.
- **Риски:** (1) вторая очередь — риск второй authority: `review_claim` владеет **только** claim ревью, а состояние задачи по-прежнему в графе (`packages/contracts/src/taskgraph.ts:9-14`); (2) номер миграции берётся **только** у аллокатора (§1.6): если шаг и `E-04` получат одинаковый номер, `validateMigrations` (`packages/storage/src/migrations.ts:117-119`) бросит и store не откроется — при этом каждый шаг по отдельности свой гейт пройдёт (дефект R-04).

#### E-20 · Независимость ревьюера: self-review отвергнут
- **Карточка:** MW-024 · **Зависит от:** E-19 · **Усилие:** S (1 ч) · **Риск:** низкий · **Откат:** revert коммита
- **Цель:** приёмка «Self-review запрещён» доказана отказом на входе в claim ревью.
- **Файлы:** Modify `packages/execution/src/review-queue.ts`; Create `tests/review-independence.test.mjs`.
- **Предусловие сборки:** тесты грузят собранный `lib/` (`tests/lib/fixtures.mjs:17-21`); перед прогоном — `Push-Location packages/execution; node ../../node_modules/tsdown/dist/run.mjs; Pop-Location` (канон для всех 12: `corepack pnpm -r run build`), иначе тест увидит старый бандл.
- **Шаги:**
  0. Шаг 0: подтвердить существование инварианта и его сигнатуру.
     Команда: `Select-String -Path packages/core/src/review.ts -Pattern 'assertReviewerIndependence' -Context 0,6` → объявление на `:109` и текст причины отказа.
  1. Тест (падающий): четыре теста: (а) ревьюер, равный `attempt.agentId`, отвергается типизированным отказом; (б) ревьюер из той же `AgentIdentity`, но другой `AgentInstance` — **тоже** отвергается (тест на подмену instance); (в) независимый ревьюер принимается; (г) отказ не меняет состояние review (остаётся `queued`).
     Команда: `node --test --test-isolation=none "tests/review-independence.test.mjs"` → FAIL.
  2. Реализация: `claimReview` вызывает `assertReviewerIndependence(review, attempt, reviewer)` **до** CAS-записи; отказ возвращается как `Result`, без записи.
  3. Прогон: `node --test --test-isolation=none "tests/review-independence.test.mjs"` → `pass 4 / fail 0`.
- **Гейт (готово когда):** `pass 4 / fail 0`; в отчёте — код отказа из (а) и SQL-состояние review после отказа.
- **Evidence в отчёт:** вывод теста, SQL-строка, diff.
- **Риски:** «тот же агент» определять по durable identity, а не по живому владельцу сессии: в DSH границу решает live-владелец (`00-RECON.md` §5.4 §28, `:246`) — здесь граница проверяется на MyWork-сущностях.

#### E-21 · Ревьюер read-only через платформенный enforcement
- **Карточка:** MW-024 · **Зависит от:** E-20, E-41 · **Усилие:** S (1 ч) · **Риск:** низкий · **Откат:** revert коммита
- **Цель:** приёмка «Reviewer не редактирует implementation» обеспечена правами сессии, а не просьбой в промпте.
- **Файлы:** Modify `packages/execution/src/review-queue.ts` (scope ревью-сессии); Create `tests/review-readonly.test.mjs`.
- **Предусловие сборки:** тесты грузят собранный `lib/` (`tests/lib/fixtures.mjs:17-21`); перед прогоном — `Push-Location packages/execution; node ../../node_modules/tsdown/dist/run.mjs; Pop-Location` (канон для всех 12: `corepack pnpm -r run build`), иначе тест увидит старый бандл.
- **Шаги:**
  0. Шаг 0: подтвердить сигнатуру инварианта и потолок политик.
     Команда: `Select-String -Path packages/core/src/review.ts -Pattern 'assertReviewerReadOnly' -Context 0,8` → объявление на `:129`; `Select-String -Path packages/contracts/src/security.ts -Pattern 'HARNESS_POLICY_CEILING'` → `:135-146`.
  1. Тест (падающий): четыре теста: (а) scope ревью-сессии несёт `permission: 'read-only'`; (б) попытка выдать ревьюеру `workspace-write` отвергается инвариантом; (в) `Permission[]` ревьюера не содержит `review.approve` для собственной попытки (`packages/contracts/src/team.ts:47`); (г) запись файла из review-сессии отвергается платформенным ограничением (проверяется через `packages/core/src/security.ts:130-207`).
     Команда: `node --test --test-isolation=none "tests/review-readonly.test.mjs"` → FAIL.
  2. Реализация: `reviewScope = { agentPreset: 'mywork-reviewer', permission: 'read-only' }`; инвариант вызывается перед `runtime.start`, а не после.
  3. Прогон: `node --test --test-isolation=none "tests/review-readonly.test.mjs"` → `pass 4 / fail 0`.
- **Гейт (готово когда):** `pass 4 / fail 0`; в отчёте — вывод теста (г) с причиной отказа политики.
- **Evidence в отчёт:** вывод теста, `scope` ревью-сессии, diff.
- **Риски:** зависимость от `E-41` (платформенный enforcement): если пресет `mywork-reviewer` не смонтирован, тест (г) проверяется через политику сессии, а не через реальный пресет — это названо в отчёте.

#### E-22 · Evidence package и findings-артефакт `review-verdict`
- **Карточка:** MW-024 · **Зависит от:** E-19, E-13 · **Усилие:** M (2–3 ч) · **Риск:** средний · **Откат:** revert коммита
- **Цель:** вердикт ревьюера — структурированная запись, пригодная и человеку, и приёмке; формат совпадает с уже принятой в проекте формой отчёта ревью.
- **Файлы:** Create `packages/contracts/src/review-verdict.ts` (схема payload'а `mywork.review-verdict/v1`); Modify `packages/execution/src/review-queue.ts`; Create `tests/review-evidence.test.mjs`.
- **Шаги:**
  0. Шаг 0: подтвердить форму «домашнего» отчёта ревью, чтобы схема не расходилась с практикой.
     Команда: `Select-String -Path .work/reports/MW-012-review.md -Pattern '^##|Словарь вердикта'` → заголовки `## Вердикт` (`:8`), `## Проверенные команды (сводка)` (`:12`), `## Findings` (`:29`), `## Непокрытое, названное ревьюером` (`:54`), `## Ограничения` — и строка словаря вердикта `PASS` / `PASS WITH FINDINGS` / `FAIL` (`:5`).
  1. Тест (падающий): шесть тестов: (а) payload требует `verdict` из закрытого словаря `PASS|PASS WITH FINDINGS|FAIL`; (б) `findings[]` требует `severity` (`MAJOR|MINOR|NIT`), `summary`, `status`; (в) артефакт `review-verdict` связан с `reviewId` и `attemptId`; (г) `ReviewedArtifact` заполняется из фактических `headSha`/`diffHash`; (д) `reviewing → rejected` без findings отвергается (`REVIEW_STATES_REQUIRING_FINDINGS`, `packages/core/src/review.ts:51`); (е) `reviewing → needs-evidence` также требует findings.
     Команда: `node --test --test-isolation=none "tests/review-evidence.test.mjs"` → FAIL.
  2. Реализация: сборка evidence package перед сессией ревьюера: `diff` + `gate-result` записи (`E-17`) + `worker-report` + `context-snapshot`; вердикт пишется артефактом `review-verdict` **до** перехода состояния.
  3. Сборка и прогон: `Push-Location packages/contracts; node ../../node_modules/tsdown/dist/run.mjs; Pop-Location`, затем `Push-Location packages/execution; node ../../node_modules/tsdown/dist/run.mjs; Pop-Location` → `✔ Build complete` ×2; тест → `pass 6 / fail 0`.
  4. Регрессия: `node --test --test-isolation=none "tests/review.test.mjs"` → без новых падений.
- **Гейт (готово когда):** `pass 6 / fail 0`; в отчёте — JSON вердикта PASS и JSON вердикта FAIL с findings.
- **Evidence в отчёт:** вывод тестов, два payload'а, diff.
- **Риски:** схема повторяет структуру `.work/reports/*-review.md` намеренно (перенос практики в код), но не обязана совпадать дословно: в отчёте назвать расхождения.

#### E-23 · Approval привязан к `headSha`/`diffHash`
- **Карточка:** MW-024 · **Зависит от:** E-22 · **Усилие:** S (1–2 ч) · **Риск:** низкий · **Откат:** revert коммита
- **Цель:** приёмка «Изменение SHA/diff отменяет approval» доказана отказом интегратора (`E-25`) и проверкой `isReviewApprovalCurrent`.
- **Файлы:** Modify `packages/execution/src/review-queue.ts`; Create `tests/review-staleness.test.mjs`.
- **Предусловие сборки:** тесты грузят собранный `lib/` (`tests/lib/fixtures.mjs:17-21`); перед прогоном — `Push-Location packages/contracts; node ../../node_modules/tsdown/dist/run.mjs; Pop-Location` (код отказа добавляется в контракты) и `Push-Location packages/execution; …` (канон для всех 12: `corepack pnpm -r run build`), иначе тест увидит старые бандлы.
- **Шаги:**
  0. Шаг 0: подтвердить, что проверка актуальности уже реализована и её не надо писать заново.
     Команда: `Select-String -Path packages/core/src/review.ts -Pattern 'isReviewApprovalCurrent|assertReviewApprovalCurrent'` → `:146`, `:157`.
  1. Тест (падающий): пять тестов: (а) approval с текущими `headSha`/`diffHash` валиден; (б) новый commit после approval делает его недействительным (`isReviewApprovalCurrent === false`); (в) изменение только `diffHash` (пересборка diff) тоже отменяет; (г) повторный approve на том же артефакте идемпотентен и не создаёт второй артефакт; (д) словарь `MYWORK_ERROR_CODES` содержит **новое** значение `STALE_APPROVAL`, вырос ровно на 1 и сохранил порядок прежних значений (`packages/contracts/src/operation.ts:77-95`).
     Команда: `node --test --test-isolation=none "tests/review-staleness.test.mjs"` → FAIL.
  2. Реализация: `approveReview` читает `git -C <worktree> rev-parse HEAD` и пересчитывает `diffHash` от `baseSha` попытки; при расхождении — отказ `STALE_APPROVAL`, а не тихое обновление. **Код отказа создаётся в этом шаге явно:** `STALE_APPROVAL` добавляется **аддитивно** в `MyWorkErrorCode` и `MYWORK_ERROR_CODES` (`packages/contracts/src/operation.ts:40-95`) — сегодня такого кода нет (проверено: в списке только `STALE_REVISION`, `STALE_FENCE`, `STALE_COLUMN_REVISION`); это единственный новый код, вводимый файлом.
  3. Сборка и прогон: `Push-Location packages/contracts; node ../../node_modules/tsdown/dist/run.mjs; Pop-Location`, затем `Push-Location packages/execution; node ../../node_modules/tsdown/dist/run.mjs; Pop-Location` → `✔ Build complete` ×2; тест → `pass 5 / fail 0`.
- **Гейт (готово когда):** `pass 5 / fail 0`; в отчёте — пара (старый `headSha`, новый `headSha`), код отказа `STALE_APPROVAL` и вывод теста (д) о росте словаря ровно на 1.
- **Evidence в отчёт:** вывод теста, два sha, diff.
- **Риски:** `diffHash` считается функцией из `E-03`/`E-15` — не третьим алгоритмом; иначе два ревью на один diff будут сравниваться по-разному.

#### E-24 · Reject-flow: новая Attempt на той же Identity/worktree, лимит loops
- **Карточка:** MW-024 · **Зависит от:** E-23, E-52, D14 · **Усилие:** L (3–5 ч) · **Риск:** высокий · **Откат:** revert коммита
- **Цель:** `reject` возвращает работу в исполнение с сохранением идентичности и передачей findings/checkpoint; превышение лимита петель требует решения человека.
- **Файлы:** Modify `packages/execution/src/review-queue.ts`; Modify `packages/execution/src/worker.ts` (приём findings/checkpoint в новую попытку); Create `tests/review-reject.test.mjs`.
- **Предусловие сборки:** тесты грузят собранный `lib/` (`tests/lib/fixtures.mjs:17-21`); перед прогоном — `Push-Location packages/execution; node ../../node_modules/tsdown/dist/run.mjs; Pop-Location` (канон для всех 12: `corepack pnpm -r run build`), иначе тест увидит старый бандл.
- **Шаги:**
  0. Шаг 0: подтвердить, что переходы `reviewing → rejected` и `changes-requested → ready` допустимы и что боковое состояние существует.
     Команда: `Select-String -Path packages/core/src/review.ts -Pattern "reviewing: \[" -Context 0,3` → `:42`; `Select-String -Path packages/contracts/src/task.ts -Pattern "'changes-requested'"` → `:35`.
  1. Тест (падающий): семь тестов: (а) `reject` переводит задачу в `changes-requested`, а не в `ready` напрямую; (б) новая попытка получает **тот же** `agentId` (identity) и тот же worktree-каталог; (в) новая попытка получает **новую** сессию (fresh, `carriesTranscript: false`, `packages/contracts/src/session.ts:945`); (г) findings прошлого ревью и `checkpoint`-артефакт видны новой попытке через порт контекста; (д) `needs-evidence` переводит review в `reviewing` (не терминально) и не создаёт новую попытку; (е) `escalated` **не** завершает работу молча: создаётся запрос решения человека (`D14`, `HumanDecision`), задача в `needs-attention`; (ж) после `maxReviewLoops` (по умолчанию 3) новый reject даёт `needs-attention` с причиной **`retry-budget-exhausted`** — существующее значение закрытого каталога (`packages/contracts/src/board.ts:366`, `:378`; «The retry budget for the task is exhausted»), а четвёртая попытка не создаётся; новых значений в каталог этот шаг **не** добавляет.
     Команда: `node --test --test-isolation=none "tests/review-reject.test.mjs"` → FAIL.
  2. Реализация: счётчик петель читается из бюджета задачи (`BudgetLimits.maxAttempts`, scope `task`, `packages/contracts/src/budget.ts:104`, `:123`, `:138`) и из числа `review_claim` со `state='rejected'`; новый attempt создаётся тем же путём, что `E-04` (identity и worktree переиспользуются, fence растёт — `packages/execution/src/store.ts:289-319`).
  3. Прогон: `node --test --test-isolation=none "tests/review-reject.test.mjs"` → `pass 7 / fail 0`.
  4. Регрессия: `node --test --test-isolation=none "tests/claim-saga.test.mjs" "tests/budget.test.mjs"` → `fail 0`.
- **Гейт (готово когда):** `pass 7 / fail 0`; в отчёте — последовательность `rejected → changes-requested → assigned` с номерами fence (каждый следующий больше) и SQL-выборка трёх `review_claim`.
- **Evidence в отчёт:** вывод тестов, номера fence по попыткам, список артефактов, переданных в новую попытку.
- **Риски:** (1) цикл «review → reject → attempt → review» не является DAG-циклом и ничем не ограничен (`B-orchestration.md:375`, N-09) — лимит петель обязателен, иначе это залипание очереди (RT-7); (2) `escalated` в DSH-родственном контексте терминален и не связан с решением человека (`00-RECON.md:250`, E §32) — в MyWork это **не** копируется: эскалация обязана порождать запрос решения; форма доставки ответа — **Q-17**, неблокирующий шаг — **Q-19**, человеческая приёмка по work type — **Q-23** (`23-STEPS-quality.md`); этот шаг только порождает запрос и не ждёт его.
- **Доставка ответа человека — механика (уточнено по `evidence/lead-19-apis.md`, §1; правка по замечанию Lead'а):** доставка адресует **сессию**, а не попытку: `api/session-controller/src/commands.ts:364` вызывает `agent.steer(message)` (граница `next-step`), а `steer` на **idle**-агенте **открывает новый ход** (`core/agent/src/runtime-types.ts:225-226`: «An idle driver starts a turn; a running driver consumes it at its next step boundary»). Ни один из `send/followup/steer/inject` не принимает `AbortSignal` (`:215`, `:222`, `:231`, `:241`), а `signal` у `prompt` отменяет **только раунд-трип допуска**, не доставленное сообщение; отозвать доставленный steer точечно нельзя (`cancel()` чистит очередь и steering, `:176-183`). Идемпотентность уже есть и **не изобретается заново**: `commands.ts:330` — `if (hasPromptRequest(agent, request.requestId)) return { accepted: true }`. **Следствие — выбор режима делает MyWork по наблюдаемому статусу хода** (открыт → `steer`, завершён → `queue`); сегодня порт этого не позволяет: `packages/controller/src/dsh-session.ts:199-207` объявляет `mode: 'queue' | 'steer'`, но `#prompt` всегда шлёт `'queue'` (`:640`), а `DshAgent` отдаёт только `session.id` (`:222-224`). **Блокер шага:** до реализации доставки обязателен `E-52` (поле статуса хода в `DshAgent` + выбор режима + тест на доставку в открытый/закрытый ход); без него `E-24` ограничивается `queue`-веткой и это фиксируется в отчёте.

---

## 7. Группа E. Интегратор и завершение TaskGraph (MW-025)

Карточка: `.work/tasks/MW-025.md:1`, зависимости `MW-010, MW-021, MW-024` (`:4`, `:13`); объём `:17`: «Интегрировать только approved immutable result: проверить base/head freshness, локально rebase/merge по policy, повторить необходимые gates, затем идемпотентно финализировать graph. Семантический conflict → human decision или явно разрешённый маршрут»; приёмка `:20`, в том числе: «Интегратор пишет ссылку на задачу в тело коммита строкой `Refs: mw-<hash>`… связь не зависит от установленных git-хуков Beads, которые в этом воркспейсе сознательно не ставились».

#### E-25 · Интегратор: только approved immutable result
- **Карточка:** MW-025 · **Зависит от:** E-23, E-04 · **Усилие:** M (2–3 ч) · **Риск:** средний · **Откат:** revert коммита
- **Цель:** stale approval не интегрируется — отказ на входе, а не «интегрировали и заметили».
- **Файлы:** Create `packages/execution/src/integrator.ts`; Modify `packages/execution/src/index.ts`; Create `tests/integrator-admission.test.mjs`.
- **Предусловие сборки:** тесты грузят собранный `lib/` (`tests/lib/fixtures.mjs:17-21`); перед прогоном — `Push-Location packages/execution; node ../../node_modules/tsdown/dist/run.mjs; Pop-Location` (канон для всех 12: `corepack pnpm -r run build`), иначе тест увидит старый бандл.
- **Шаги:**
  0. Шаг 0: подтвердить, что approval-проверка берётся из `core`, а не пишется заново.
     Команда: `Select-String -Path packages/core/src/review.ts -Pattern 'isReviewApprovalCurrent'` → `:146`; и `Select-String -Path packages/contracts/src/review.ts -Pattern 'ReviewedArtifact'` → `:51-56`.
  1. Тест (падающий): пять тестов: (а) попытка интегрировать без `approved` review → **`TASK_CONFLICT`** (существующий код, `packages/contracts/src/operation.ts:43`, `:82`) с деталью `review-not-approved` — нового кода здесь не вводится; (б) `approved`, но head попытки изменился → `STALE_APPROVAL` (код введён в `E-23`); (в) `approved` и head совпадает → допуск; (г) `needs-evidence`/`rejected` → `TASK_CONFLICT`; (д) отказ не создаёт коммит и не меняет граф.
     Команда: `node --test --test-isolation=none "tests/integrator-admission.test.mjs"` → FAIL.
  2. Реализация: `integrate(operationId)` читает approved review + `attempt_worktree`, сверяет `headSha`/`diffHash`, проверяет, что целевая ветка не ушла (freshness базы), и только затем выполняет слияние.
  3. Прогон: `node --test --test-isolation=none "tests/integrator-admission.test.mjs"` → `pass 5 / fail 0`.
- **Гейт (готово когда):** `pass 5 / fail 0`; в отчёте — коды отказов (а) и (б) и `git log --oneline` целевой ветки без новых коммитов в отказных сценариях.
- **Evidence в отчёт:** вывод теста, `git log`/`git status` тестового репозитория, diff.
- **Риски:** «immutable result» — это diff конкретного head; любое действие внутри worktree после approval обязано инвалидировать approval (проверяется `E-23`).

#### E-26 · Локальный merge/rebase и trailer `Refs: mw-<hash>`
- **Карточка:** MW-025 · **Зависит от:** E-25 · **Усилие:** M (2–3 ч) · **Риск:** средний · **Откат:** revert коммита
- **Цель:** приёмка про `Refs: mw-<hash>` доказана тестом на коммите, созданном интегратором; push/merge в чужие ветки невозможны by construction.
- **Файлы:** Modify `packages/execution/src/integrator.ts`; Create `packages/contracts/src/git.ts` (порт `GitPort`); Modify `packages/worktree-adapter/src/git.ts` (`commit`, `merge --no-ff`, `rebase`); Create `tests/integrator-commit.test.mjs`.
- **Предусловие сборки:** тесты грузят собранный `lib/` (`tests/lib/fixtures.mjs:17-21`); перед прогоном — `Push-Location packages/contracts; node ../../node_modules/tsdown/dist/run.mjs; Pop-Location`, затем то же в `packages/worktree-adapter` и `packages/execution` (канон для всех 12: `corepack pnpm -r run build`), иначе тест увидит старые бандлы.
- **Шаги:**
  1. Тест (падающий): четыре теста во временном репозитории: (а) коммит интегратора содержит строку `Refs: mw-<hash>` в теле (проверка `git log -1 --format=%B`); (б) интегратор не выполняет `git push` (проверка — отсутствие remote-конфигурации в `git config --get remote.origin.url` и отсутствие вызовов `push` в исходниках пакета); (в) стратегия по умолчанию — `merge --no-ff` локально, `rebase` только при явной политике; (г) защищённая ветка (`main`) не изменяется тестом.
     Команда: `node --test --test-isolation=none "tests/integrator-commit.test.mjs"` → FAIL.
  2. Реализация: `commitMessage = <summary>\n\nRefs: mw-<taskHash>`; `<taskHash>` берётся детерминированно от `taskId` (та же функция, что в `E-07` для `runId`); порт `GitPort` **вводится в этом шаге** (`packages/contracts/src/git.ts`: `resolveHead`, `diffHash`, `commit`, `merge`, `rebase` — операции `push` в порту **нет**, поэтому её отсутствие выражено типом, а не дисциплиной); реализация — в `packages/worktree-adapter` рядом с git-раннером `E-03`.
  3. Прогон: `node --test --test-isolation=none "tests/integrator-commit.test.mjs"` → `pass 4 / fail 0`.
  4. Регрессия: `node --test --test-isolation=none "tests/worktree-adapter.test.mjs"` → `fail 0`.
- **Гейт (готово когда):** `pass 4 / fail 0`; в отчёте — дословный `git log -1 --format=%B` с `Refs: mw-…` и вывод `git branch --show-current`.
- **Evidence в отчёт:** вывод теста, тело коммита, `git log --graph --oneline -5`.
- **Риски:** связь задачи и коммита **не** должна опираться на git-хуки Beads (приёмка карточки, `.work/tasks/MW-025.md:20`) — это прямо проверяется тестом (а).

#### E-27 · Повтор гейтов на интегрированном head
- **Карточка:** MW-025 · **Зависит от:** E-26, E-15 · **Усилие:** S (1–2 ч) · **Риск:** средний · **Откат:** revert коммита
- **Цель:** успех слияния не считается приёмкой: гейты прогоняются заново на новом head.
- **Файлы:** Modify `packages/execution/src/integrator.ts`; Create `tests/integrator-gates.test.mjs`.
- **Предусловие сборки:** тесты грузят собранный `lib/` (`tests/lib/fixtures.mjs:17-21`); перед прогоном — `Push-Location packages/execution; node ../../node_modules/tsdown/dist/run.mjs; Pop-Location` (канон для всех 12: `corepack pnpm -r run build`), иначе тест увидит старый бандл.
- **Шаги:**
  1. Тест (падающий): четыре теста: (а) после слияния гейты запускаются на новом `headSha`; (б) провал обязательного гейта оставляет задачу в `integrating`/`failed`, но **не** в `done`; (в) вердикты гейтов привязаны к новому head (`E-15`); (г) повторный прогон гейтов на том же head идемпотентен (артефакты не дублируются по hash).
     Команда: `node --test --test-isolation=none "tests/integrator-gates.test.mjs"` → FAIL.
  2. Реализация: вызов `E-16`-политики с `cwd = основной checkout` (после слияния) и `strict = true`.
  3. Прогон: `node --test --test-isolation=none "tests/integrator-gates.test.mjs"` → `pass 4 / fail 0`.
- **Гейт (готово когда):** `pass 4 / fail 0`; в отчёте — два набора `gate-result` (до и после слияния) с разными `headSha`.
- **Evidence в отчёт:** вывод теста, SQL-выборка гейтов по двум head, diff.
- **Риски:** гейты в основном checkout могут быть дорогими — политика обязана ограничивать набор `required` (иначе интеграция станет узким местом).

#### E-28 · Идемпотентный finalize узла графа
- **Карточка:** MW-025 · **Зависит от:** E-27 · **Усилие:** M (1–2 ч) · **Риск:** средний · **Откат:** revert коммита
- **Цель:** повтор `finalize` безопасен: один коммит, один перевод в `done`, никаких вторых записей.
- **Файлы:** Modify `packages/execution/src/integrator.ts`; Create `tests/integrator-finalize.test.mjs`.
- **Предусловие сборки:** тесты грузят собранный `lib/` (`tests/lib/fixtures.mjs:17-21`); перед прогоном — `Push-Location packages/execution; node ../../node_modules/tsdown/dist/run.mjs; Pop-Location` (канон для всех 12: `corepack pnpm -r run build`), иначе тест увидит старый бандл.
- **Шаги:**
  1. Тест (падающий): пять тестов: (а) первый `finalize` переводит задачу в `done` через `graph.transition` с `expectedRevision`; (б) второй `finalize` с тем же `operationId` возвращает тот же результат без нового коммита; (в) устаревшая revision графа → `STALE_REVISION`, состояние не меняется; (г) после `done` нет живых попыток и активных review; (д) `done` не выставляется, если хотя бы один `required` гейт не зелёный или review не `approved`.
     Команда: `node --test --test-isolation=none "tests/integrator-finalize.test.mjs"` → FAIL.
  2. Реализация: `operationId` уникален (CAS в таблице интеграции; миграция с версией **от аллокатора**, D08/§1.6), перевод графа — ровно один раз, идемпотентность чтением результата по `operationId`.
  3. Прогон: `node --test --test-isolation=none "tests/integrator-finalize.test.mjs"` → `pass 5 / fail 0`.
- **Гейт (готово когда):** `pass 5 / fail 0`; в отчёте — `git rev-list --count <base>..<head>` = 1 после двух вызовов и SQL-строка состояния задачи.
- **Evidence в отчёт:** вывод теста, число коммитов, SQL-строка, diff.
- **Риски:** правило приёмки `D19` («карточка не переводится в `done`, если хотя бы одно исполнение `failed`, без строки-обоснования», `00-RECON.md:204` п. 19, FINAL-REPORT §10 этап 0 п. 4) — тест (д) его не заменяет; строка-обоснование проверяется в `F(производный INDEX/сверка леджеров)`.

#### E-29 · Конфликт и провал verify не дают `Done`
- **Карточка:** MW-025 · **Зависит от:** E-28, D14 · **Усилие:** M (2–3 ч) · **Риск:** высокий (конфликты) · **Откат:** revert коммита
- **Цель:** семантический конфликт не разрешается автоматически: он превращается в решение человека, а не в тихую потерю чужой работы.
- **Файлы:** Modify `packages/execution/src/integrator.ts`; Create `tests/integrator-conflict.test.mjs`.
- **Предусловие сборки:** тесты грузят собранный `lib/` (`tests/lib/fixtures.mjs:17-21`); перед прогоном — `Push-Location packages/execution; node ../../node_modules/tsdown/dist/run.mjs; Pop-Location` (канон для всех 12: `corepack pnpm -r run build`), иначе тест увидит старый бандл.
- **Шаги:**
  1. Тест (падающий): четыре теста в двух временных репозиториях: (а) текстовый конфликт → `merge --abort`, состояние задачи `needs-attention`, коммит не создан; (б) «семантический» конфликт (две ветки меняют один и тот же инвариант в разных файлах, тест-гейт красный) → `needs-attention` с причиной **`reconciliation-divergence`** — существующее значение закрытого каталога (`packages/contracts/src/board.ts:358`); новых значений здесь не вводится; (в) провал verify после слияния не помечает `done` (пересечение с `E-27`, но проверяется отдельным сценарием); (г) `--force`/`--ours`/`--theirs` не используются: в исходниках интегратора нет этих флагов.
     Команда: `node --test --test-isolation=none "tests/integrator-conflict.test.mjs"` → FAIL.
  2. Реализация: конфликт → `merge --abort` (или отказ rebase) → запись NeedsAttention с причиной → запрос `HumanDecision` (`D14`, ведёт `MW-030`) — **без** ожидания в блокирующем `ask()` (`00-RECON.md:284`).
  3. Прогон: `node --test --test-isolation=none "tests/integrator-conflict.test.mjs"` → `pass 4 / fail 0`.
- **Гейт (готово когда):** `pass 4 / fail 0`; в отчёте — `git status` после конфликта (чистое дерево) и запись NeedsAttention с причиной.
- **Evidence в отчёт:** вывод теста, `git status`, `git log`, SQL-строка причины.
- **Риски:** (1) тесты работают только во временных репозиториях, protected remote branches не меняются (приёмка карточки `:20`); (2) `HumanDecision` как сущность — не этот файл: здесь только создание запроса, форма — `D14`/`MW-030`, доставка ответа в живую попытку — **Q-17**, неблокирующий шаг — **Q-19** (`23-STEPS-quality.md`; `00-RECON.md:284` требовал именно «гейт обязан освобождать worker-сессию»).

---

## 8. Группа F. Task Setter к DSH (MW-026)

Карточка: `.work/tasks/MW-026.md:1`, зависимости `MW-011, MW-015, MW-016` (`:4`, `:13`); объём `:17`: «Planner получает goal/workspace/current graph, запускается в fresh Session, выдаёт validated Plan Mutation и завершает работу. Task Setter не состоит в Worker pool и не общается с исполнителями… Planner выдаёт только additive… изменение существующей задачи — отдельная ReplanCommand со своим approval, и смешение запрещено типом»; приёмка `:20`: «Невалидный/устаревший output не меняет graph… Мутация с update существующей задачи отклоняется с `PLANNER_SCOPE_DENIED` и граф не меняется. Сессия Planner не может писать в workspace. Отклонённый план не оставляет ни задач, ни artifact planner-dag в применённом состоянии».

**Что уже есть:** `packages/planner` реализует стейджинг и применение мутаций как сагу (`packages/planner/src/service.ts:134`, `:1036`, `:1185`), валидацию формы (`validatePlanMutation`, импорт `:66`), отказ `PLANNER_SCOPE_DENIED` (`:1267`) и admission-hold (`packages/planner/src/store.ts:41`, `:400`). Тогда `MW-011` (зависимость карточки) закрыт: `packages/{contracts,core,planner}` существуют (FINAL-REPORT §7.4 п. 7, `:329`). Шаги ниже добавляют **роль и сессию**, а не движок мутаций.

#### E-30 · Task Setter как отдельная роль в fresh Session
- **Карточка:** MW-026 · **Зависит от:** E-08, F(composition root) · **Усилие:** M (2–3 ч) · **Риск:** средний · **Откат:** revert коммита
- **Цель:** планировщик работает в собственной сессии, не состоит в worker-pool и не остаётся runtime-координатором.
- **Файлы:** Create `packages/execution/src/setter.ts`; Modify `packages/contracts/src/team.ts` (роль `planner` в реестре — аддитивно) или переиспользовать существующую роль, если она уже есть; Create `tests/setter-role.test.mjs`.
- **Шаги:**
  0. Шаг 0: подтвердить, что роль планировщика в реестре ролей ещё не заведена, и что модель выбирается политикой workspace.
     Команда: `Select-String -Path packages/contracts/src/team.ts -Pattern "planner|modelPolicy"` → совпадения только по `modelPolicy` (`:206-208` и окрестности), роли `planner` нет; `Select-String -Path packages/contracts/src/team.ts -Pattern "RoleId|ROLE_IDS"` → словарь ролей.
  1. Тест (падающий): пять тестов: (а) сессия планировщика создаётся `context: 'fresh'` (без транскрипта) и не переиспользует worker-сессию; (б) занятость планировщика **не** считается видом `worker` в `countSchedulerOccupancy` (число, а не текст); (в) модель берётся из `ModelPolicy` workspace, а не из аргумента вызова; (г) права сессии — `read-only`; (д) выход планировщика — `planner-dag` артефакт + `PlanMutation`; после выхода сессия завершена (`stop`), планировщик не остаётся координатором.
     Команда: `node --test --test-isolation=none "tests/setter-role.test.mjs"` → FAIL.
  2. Реализация: `runSetter({ goal, workspaceId, graph, modelPolicy })` → `runtime.start({ scope: { agentPreset: 'mywork-planner', permission: 'read-only', model }, runId })` → приём `PlanMutation` → `planner.stage(intent)` → останов сессии.
  3. Прогон: `node --test --test-isolation=none "tests/setter-role.test.mjs"` → `pass 5 / fail 0`.
- **Гейт (готово когда):** `pass 5 / fail 0`; в отчёте — scope сессии планировщика и SQL-строка staged-мутации.
- **Evidence в отчёт:** вывод теста, scope, artifactId `planner-dag`, diff.
- **Риски:** «route настраиваемый; тесты fake/keyless, без обязательной frontier модели» (приёмка карточки) — тесты не должны требовать реальной модели; при недоступности модели шаг даёт типизированный отказ, а не молчаливый пропуск (связь с `D20`, `23-STEPS-quality.md`).

#### E-31 · Additive-only и `PLANNER_SCOPE_DENIED`
- **Карточка:** MW-026 · **Зависит от:** E-30 · **Усилие:** M (1–2 ч) · **Риск:** средний (тип против рантайма) · **Откат:** revert коммита
- **Цель:** мутация с изменением существующей задачи отклоняется **типом**, а не только проверкой в рантайме; граф при отказе не меняется.
- **Файлы:** Modify `packages/contracts/src/plan.ts` (аддитивно: `AdditivePlanMutation` и `ReplanCommand` как разные типы); Modify `packages/execution/src/setter.ts`; Create `tests/setter-additive.test.mjs`.
- **Шаги:**
  0. Шаг 0: подтвердить, что отказ `PLANNER_SCOPE_DENIED` уже существует и где он бросается.
     Команда: `Select-String -Path packages/planner/src/service.ts -Pattern 'PLANNER_SCOPE_DENIED' -Context 6,2` → совпадение на `:1267` и условия отказа вокруг.
  1. Тест (падающий): пять тестов: (а) мутация, содержащая `update` существующей задачи, не проходит типизацию/валидацию и отклоняется с `PLANNER_SCOPE_DENIED`; (б) граф после отказа имеет ту же revision, что до; (в) число задач не изменилось; (г) аддитивная мутация (новые задачи + рёбра только между новыми) принимается; (д) ребро от новой задачи к существующей отвергается (иначе планировщик расширяет чужой план «сбоку»).
     Команда: `node --test --test-isolation=none "tests/setter-additive.test.mjs"` → FAIL.
  2. Реализация: тип `AdditivePlanMutation` допускает только `create` + `edge(new, new)`; `ReplanCommand` — отдельный тип со своим approval; смешение запрещено на уровне union'а, а не runtime-проверкой.
  3. Прогон: `node --test --test-isolation=none "tests/setter-additive.test.mjs"` → `pass 5 / fail 0`.
  4. Регрессия: `node --test --test-isolation=none "tests/plan-mutation.test.mjs"` → без новых падений.
- **Гейт (готово когда):** `pass 5 / fail 0`; в отчёте — код отказа и сравнение `graphRevision` до/после.
- **Evidence в отчёт:** вывод тестов, две revision графа, diff.
- **Риски:** `tests/plan-mutation.test.mjs` большой (≈2 368 строк, `B-orchestration.md:399` п. 5) — прогон только узкий, полный — за Lead'ом; правка `plan.ts` строго аддитивная.

#### E-32 · Предпросмотр, Approve и Reject; отклонённый план не оставляет следа
- **Карточка:** MW-026 · **Зависит от:** E-31 · **Усилие:** M (2–3 ч) · **Риск:** средний · **Откат:** revert коммита
- **Цель:** утверждение идёт предпросмотром структуры (задачи, рёбра, claims, work type, класс мутации) с тремя действиями; отклонённый план не оставляет ни задач, ни применённого артефакта.
- **Файлы:** Modify `packages/planner/src/service.ts` (форма предпросмотра — без изменения логики саги); Modify `packages/execution/src/setter.ts`; Create `tests/setter-approval.test.mjs`.
- **Шаги:**
  1. Тест (падающий): шесть тестов: (а) предпросмотр содержит задачи, рёбра, claims, work type и вычисленный класс мутации (`additive`/`replan`); (б) `Comment` не меняет состояние; (в) `Approve` применяет мутацию ровно один раз; (г) `Reject` оставляет ноль новых задач и **ноль** применённых `planner-dag`; (д) после `Reject` повторный `Approve` той же мутации невозможен (состояние `reverted`); (е) правка плана в этой форме отсутствует (нет операции `edit`).
     Команда: `node --test --test-isolation=none "tests/setter-approval.test.mjs"` → FAIL.
  2. Реализация: предпросмотр — чистая функция от staged-мутации; действие `Reject` → `planner.revert(operationId, decision)` (существующая операция, `packages/planner/src/service.ts:1303`).
  3. Прогон: `node --test --test-isolation=none "tests/setter-approval.test.mjs"` → `pass 6 / fail 0`.
- **Гейт (готово когда):** `pass 6 / fail 0`; в отчёте — `SELECT count(*) FROM artifact WHERE kind='planner-dag'` после `Reject` и число задач графа до/после.
- **Evidence в отчёт:** вывод теста, JSON предпросмотра, SQL-счётчики, diff.
- **Риски:** артефакт `planner-dag` уже есть в словаре (`packages/contracts/src/artifact.ts:49`), но «применённое состояние» артефакта определяется staging-записью: тест (г) читает именно её, а не наличие файла.

---

## 9. Группа G. Provisioning saga с pre-minted identity (MW-065, перенос `D13`)

Источник: `B-orchestration.md` §3.1 (`:250-294`) — новая карточка, структура записи (`:254-274`) и **матрица recovery из 9 строк** (`:280-291`). Ключевое заимствование из DSH — **чеканить `instanceId` до вызова runtime** (`roster.ts:259`, подтверждено независимо: `evidence/execution-04.md`, агент 4, п. 2). Уточнение, важное для честности: **готовой markdown-матрицы recovery в DSH нет** — grep `recovery matrix` по DSH-checkout и по MyWork дал 0 совпадений (`evidence/execution-04.md`, п. 4); 9 строк — это конструкция отчёта `B`, и в шагах она используется как проектное требование, а не как «скопированное из DSH».

#### E-33 · Контракт provisioning-саги с pre-minted identity
- **Карточка:** MW-065 (новая) · **Зависит от:** — · **Усилие:** M (1–2 ч) · **Риск:** низкий · **Откат:** revert коммита
- **Цель:** форма записи провижининга зафиксирована до реализации, и идентичность чеканится вызывающим до внешнего эффекта.
- **Файлы:** Create `packages/contracts/src/provisioning.ts`; Modify `packages/contracts/src/index.ts`; Create `tests/provisioning-contract.test.mjs`.
- **Шаги:**
  0. Шаг 0: подтвердить, что `start()` принимает внешний id и отвергает дубликат (иначе pre-minted identity невозможна).
     Команда: `Select-String -Path packages/contracts/src/agent-runtime.ts -Pattern 'runId|duplicate' -Context 1,1` → `:68` («Caller-owned run identifier; the runtime rejects a duplicate»).
  1. Тест (падающий): пять тестов: (а) `ProvisioningStep = 'intent'|'session-created'|'scope-pinned'|'prompt-enqueued'|'active'` — закрытый кортеж ровно из 5 значений; (б) `ProvisioningState = 'planned'|'provisioning'|'active'|'failed'|'revoked'|'orphan-drained'` — ровно 6; (в) `AgentInstanceProvisioning` требует `operationId`, `controllerEpoch`, `agentId`, `instanceId`, `requested`; (г) `attemptId`/`sessionId` опциональны; (д) шаг описывается тройкой `{kind, state: 'pending'|'applied'|'failed', detail?}`.
     Команда: `node --test --test-isolation=none "tests/provisioning-contract.test.mjs"` → FAIL «Cannot find module».
  2. Реализация: типы переносятся **дословно** из `B-orchestration.md:256-273` (структура уже согласована с дисциплиной журнала `STEP_ORDER`, `packages/execution/src/service.ts:166`).
  3. Сборка и прогон: `Push-Location packages/contracts; node ../../node_modules/tsdown/dist/run.mjs; Pop-Location` → `✔ Build complete`; тест → `pass 5 / fail 0`.
- **Гейт (готово когда):** `pass 5 / fail 0`; `node_modules\.bin\tsc.cmd --noEmit -p packages/contracts/tsconfig.json` → exit 0.
- **Evidence в отчёт:** вывод теста и сборки, `git diff --stat packages/contracts`.
- **Риски:** карточка `MW-065` — новая, её номер из резерва `00-RECON.md:115` (диапазон MW-065…MW-069: «Provisioning saga, write-intent, handoff, durable jobs, ограничения worker-поверхности») — закрепляет `card-ledger` в `30-CARD-EDITS.md`.

#### E-34 · Durable шаги, epoch-fence и `orphan-drained`
- **Карточка:** MW-065 · **Зависит от:** E-33, F(единый реестр миграций) · **Усилие:** L (3–5 ч) · **Риск:** высокий · **Откат:** revert коммита + `DROP TABLE agent_instance_provisioning`
- **Цель:** сага durable на каждом шаге, старый контроллер не продолжает чужую сагу, осиротевшая запись не воскрешается.
- **Файлы:** Create `packages/execution/src/provisioning.ts`; Modify `packages/execution/src/schema.ts` — новая миграция с версией **от аллокатора** (D08, §1.6), таблицы `agent_instance_provisioning` + `provisioning_step`; Modify `packages/execution/src/index.ts`; Create `tests/provisioning-steps.test.mjs`.
- **Шаги:**
  0. Шаг 0: подтвердить, что epoch контроллера доступен как fence-величина и что его понижение запрещено БД.
     Команда: `Select-String -Path packages/lease/src/schema.ts -Pattern 'epoch-not-monotonic|EPOCH_NOT_MONOTONIC_MARKER'` → `:28`, `:58-62`.
  1. Тест (падающий): семь тестов: (а) запись `provisioning` коммитится **до** вызова рантайма (проверяется порядком вызовов фейка); (б) каждый из 5 шагов получает ровно одну строку в `provisioning_step`; (в) шаг `applied` не может быть записан без наблюдения (мутация: пропуск наблюдения → отказ); (г) запись с `controllerEpoch` меньше текущего не продолжается: состояние `orphan-drained`; (д) `orphan-drained` не вызывает рантайм (счётчик вызовов фейка не растёт); (е) повторная запись с тем же `operationId` идемпотентна; (ж) `requested.preset/model` сверяется с фактическим scope сессии, и расхождение даёт `needs-attention`, а не тихое исправление (девятая строка матрицы, `B-orchestration.md:290`).
     Команда: `node --test --test-isolation=none "tests/provisioning-steps.test.mjs"` → FAIL «no such table: agent_instance_provisioning».
  2. Реализация: таблицы и функции в стиле claim-саги (`packages/execution/src/store.ts:151-273` — образец), транзакция на шаг, событие на переход.
  3. Сборка и прогон: `Push-Location packages/execution; node ../../node_modules/tsdown/dist/run.mjs; Pop-Location` → `✔ Build complete`; тест → `pass 7 / fail 0`.
  4. Регрессия: `node --test --test-isolation=none "tests/claim-saga.test.mjs" "tests/lease.test.mjs"` → `fail 0`.
- **Гейт (готово когда):** `pass 7 / fail 0`; в отчёте — `PRAGMA user_version` (равен версии от аллокатора) и дамп строк `provisioning_step` для успешной и осиротевшей саги.
- **Evidence в отчёт:** вывод тестов, дамп таблиц, diff.
- **Риски:** (1) 5 шагов × отдельные транзакции — соблазн «одной большой транзакции», которая держит БД на время внешнего вызова; запрещено: внешний эффект **никогда** внутри транзакции (принцип «intent durable before external effect», `packages/execution/src/service.ts:9-24`); (2) `orphan-drained` — не удаление: запись остаётся evidence.

#### E-35 · Recovery по 9-строчной матрице и краш между шагами
- **Карточка:** MW-065 · **Зависит от:** E-34, E-08 · **Усилие:** L (3–5 ч) · **Риск:** высокий · **Откат:** revert коммита
- **Цель:** каждая строка матрицы recovery (`B-orchestration.md:280-291`) — отдельный тест; процесс, убитый между шагами, не создаёт вторую сессию.
- **Файлы:** Create `packages/execution/src/provisioning-recovery.ts`; Create `tests/provisioning-recovery.test.mjs`; Create `tests/lib/provisioning-crash-child.mjs`.
- **Шаги:**
  1. Тест (падающий, 10 проверок): девять строк матрицы — по одному тесту каждая: `planned` без `intent` → `failed`; `intent` без сессии → повтор `start()` с тем же `instanceId` (рантайм отвергает дубликат); `session-created` без scope → `resume` + повторное применение scope; `scope-pinned` без промпта → `resume` + admit с тем же `runId` после чтения лога; `prompt-enqueued` без `active` → дописать `active`; `active`, но instance исчез → `failed` через attempt-путь, сессия остаётся evidence; шаг `failed` + живой `attemptId` → `revoke` попытки; чужой epoch → `orphan-drained`; расхождение preset/model → `needs-attention` (человек). Десятый тест — краш между `intent` и `session-created`: ровно одна запись, ноль вторых сессий.
     Команда: `node --test --test-isolation=none "tests/provisioning-recovery.test.mjs"` → FAIL.
  2. Реализация: `recoverProvisioning(operationId)` читает запись и **независимо** проверяет мир (как `reconcileProvisioning`, `roster.ts:392-434`, `B-orchestration.md:78`, п. 4): сессия ищется по заранее вычеканенному id, а не эвристикой; живой ребёнок пропускается (терминальный edge принадлежит создателю).
  3. Прогон: `node --test --test-isolation=none "tests/provisioning-recovery.test.mjs"` → `pass 10 / fail 0`.
  4. Регрессия: `node --test --test-isolation=none "tests/provisioning-steps.test.mjs"` → `fail 0`.
- **Гейт (готово когда):** `pass 10 / fail 0`; в отчёте — таблица «строка матрицы → имя теста → результат» на 9 строк + отдельная строка краш-теста.
- **Evidence в отчёт:** вывод теста, лог дочернего процесса, SQL-дампы до/после recovery.
- **Риски:** (1) recovery, вызывающий `start()` повторно, обязан передавать **тот же** `instanceId` — иначе появится вторая сессия и отказ дубликата не сработает; (2) единый человек-гейт только в последней строке: любое расширение «человеческих» строк матрицы — предмет решения владельца, а не правки по месту.

---

## 10. Группа H. Advisory write-intent на уровне `Attempt` (MW-066, перенос `D13`)

Источник: `B-orchestration.md` §3.2 (`:296-312`). Семантика копируется у DSH буквально: нормализация префикса с запретом абсолютных путей, `..` и пустых сегментов (`validation.ts:26-34`); пересечение по компонентам пути (`task-view.ts:14-16`); предупреждение только против **активных** attempt'ов; claim/admission **не читает** поле вовсе (`task-board.ts:133`); форма/генераторы обходят проверку (`README:207`). Правильный уровень — `Attempt`, а не `Task`: `Task` — чужая authority (`packages/contracts/src/taskgraph.ts:9-14`, `tests/authority.test.mjs:61`).

#### E-36 · Тип write-intent и нормализация путей
- **Карточка:** MW-066 (новая) · **Зависит от:** E-04 · **Усилие:** M (1–2 ч) · **Риск:** низкий · **Откат:** revert коммита
- **Цель:** write-intent существует как тип на попытке (не на задаче) и не принимает небезопасные пути.
- **Файлы:** Modify `packages/contracts/src/attempt.ts` (аддитивно `WorkIntentScope`, `writeIntents?`); Create `packages/core/src/write-intent.ts` (нормализация и пересечение — рядом с чистыми правилами `packages/core/src/review.ts`); Modify `packages/core/src/index.ts`; Create `tests/write-intent.test.mjs`.
- **Шаги:**
  0. Шаг 0: подтвердить, что поля нет ни в `Task`, ни в `Plan`, ни в `Attempt` (иначе шаг дублирует существующее).
     Команда: `Select-String -Path packages/contracts/src/task.ts,packages/contracts/src/plan.ts,packages/contracts/src/attempt.ts -Pattern 'writeIntent|writeScope'` → 0 совпадений.
  1. Тест (падающий): шесть тестов: (а) `WorkIntentScope = { path, mode: 'read'|'write' }`; (б) абсолютный путь отвергается; (в) `..` отвергается; (г) пустой сегмент/двойной слэш нормализуется и не проходит как отдельный префикс; (д) префиксы дедуплицируются; (е) пересечение считается **по компонентам пути** (`a/b` не пересекается с `a/bc`, но пересекается с `a/b/c`).
     Команда: `node --test --test-isolation=none "tests/write-intent.test.mjs"` → FAIL.
  2. Реализация: чистая функция `normalizeWriteIntent(path)` и `overlapsWriteIntent(a, b)` в `core` (тестируется без БД).
  3. Сборка и прогон: `Push-Location packages/contracts; node ../../node_modules/tsdown/dist/run.mjs; Pop-Location`, затем `Push-Location packages/core; …` → `✔ Build complete` ×2; тест → `pass 6 / fail 0`.
  4. Регрессия: `node --test --test-isolation=none "tests/authority.test.mjs"` → без новых падений (в `Task` ничего не добавлено).
- **Гейт (готово когда):** `pass 6 / fail 0`; в отчёте — вывод grep шага 0 (0 совпадений **до** правки) и перечень отвергнутых путей.
- **Evidence в отчёт:** вывод тестов, diff по `attempt.ts` (только добавленные строки), `git diff --stat packages/contracts/src/task.ts` → пусто.
- **Риски:** если поля захочется добавить в `Task` — падает `tests/authority.test.mjs:61`; это и есть защита от второго писателя в чужую сущность.

#### E-37 · Хранение, индекс и предупреждения на чтение
- **Карточка:** MW-066 · **Зависит от:** E-36 · **Усилие:** M (1–2 ч) · **Риск:** низкий · **Откат:** revert коммита
- **Цель:** предупреждения о пересечении **выводятся на чтение** и не влияют на admission.
- **Файлы:** Modify `packages/execution/src/schema.ts` — новая миграция с версией **от аллокатора** (D08, §1.6), таблица `attempt_write_intent` + индекс `(workspace_id, path)`; Modify `packages/execution/src/store.ts`; Modify `packages/execution/src/worker.ts` (передача intents при создании попытки); Create `tests/write-intent-store.test.mjs`.
- **Шаги:**
  1. Тест (падающий): пять тестов: (а) intents пишутся вместе с попыткой в одной транзакции; (б) `listWriteIntentConflicts(workspaceId)` возвращает предупреждения только против **активных** попыток; (в) предупреждение исчезает после завершения соседа (запрос на чтение, не хранимая строка); (г) два attempt'а с пересечением **оба стартуют** — admission не читает поле; (д) индекс используется: `EXPLAIN QUERY PLAN` для выборки по `(workspace_id, path)` не содержит `SCAN attempt_write_intent`.
     Команда: `node --test --test-isolation=none "tests/write-intent-store.test.mjs"` → FAIL.
  2. Реализация: таблица `attempt_write_intent(attempt_id, workspace_id, path, mode)`; предупреждения — результат запроса, ничего не сохраняется (как в DSH: `task-view.ts:43-49`).
  3. Прогон: `node --test --test-isolation=none "tests/write-intent-store.test.mjs"` → `pass 5 / fail 0`.
- **Гейт (готово когда):** `pass 5 / fail 0`; в отчёте — вывод `EXPLAIN QUERY PLAN` и SQL двух предупреждающих записей.
- **Evidence в отчёт:** вывод теста, план запроса, SQL-выборка, diff.
- **Риски:** предупреждение не должно превратиться в блокировку: приёмка DSH-механики — «advisory», а `writeScopes` **не** isolation primitive (`B-orchestration.md:244`); тест (г) фиксирует это формально.

---

## 11. Группа I. Handoff artifact (MW-067, перенос `D13`)

Источник: `B-orchestration.md` §3.3 (`:314-334`) и §46 (`:200-206`): вид артефакта `handoff` добавляется аддитивно, payload `mywork.handoff/v1` — шесть полей из §46 плюс `nextAction`, рендер в контекст классом `dependency-result` (не mandatory, не instruction, свой bucket и лимит — `packages/contracts/src/context.ts:108-129`, `:452-456`, `:476-477`).

#### E-38 · Handoff: вид артефакта, payload и рендер как данные
- **Карточка:** MW-067 (новая) · **Зависит от:** E-10, F(composition root) · **Усилие:** M (2–3 ч) · **Риск:** низкий · **Откат:** revert коммита
- **Цель:** передача работы между попытками/ролями структурирована, проверяема по hash и доставляется как данные.
- **Файлы:** Modify `packages/contracts/src/artifact.ts:31-75` (аддитивно `'handoff'`); Create `packages/contracts/src/handoff.ts` (`mywork.handoff/v1`); Modify `packages/core/src/context.ts` (провайдер контекста, класс `dependency-result`, L1/L2 через `ArtifactRef`, без полного текста); Create `tests/handoff.test.mjs`.
- **Шаги:**
  0. Шаг 0: подтвердить, что класс `dependency-result` не mandatory и не instruction — иначе handoff станет инструкцией для преемника.
     Команда: `Select-String -Path packages/contracts/src/context.ts -Pattern 'dependency-result' -Context 0,2` → вхождения, не попадающие в `MANDATORY_CONTEXT_CLASSES`/`INSTRUCTION_CONTEXT_CLASSES` (`:108-129`).
  1. Тест (падающий): шесть тестов: (а) `ARTIFACT_KINDS` содержит `handoff` и длина выросла ровно на 1; (б) payload требует ровно шесть полей (`summary`, `changedFiles`, `assumptions`, `unresolvedQuestions`, `evidenceRefs`, `nextAction`); (в) handoff рендерится как data, а не instruction (по образцу `tests/context.test.mjs:791`); (г) handoff не превышает bucket `dependencies` (по образцу `:771`); (д) handoff без `evidenceRefs` отвергается; (е) метаданные несут `taskId` (кому), `attemptId` (от кого) и `causationId` (чей запрос).
     Команда: `node --test --test-isolation=none "tests/handoff.test.mjs"` → FAIL.
  2. Реализация: `ArtifactKind` расширяется **после** `'gate-result'` (`E-13`) с сохранением порядка прежних значений; схема payload'а — новый файл, существующие виды не переинтерпретируются.
  3. Сборка и прогон: `Push-Location packages/contracts; …`, `Push-Location packages/core; …` → `✔ Build complete`; тесты → `pass 6 / fail 0`; `node --test --test-isolation=none "tests/context.test.mjs"` → без новых падений.
- **Гейт (готово когда):** `pass 6 / fail 0`; в отчёте — «до/после» `ARTIFACT_KINDS` (только добавление) и вывод `tests/context.test.mjs`.
- **Evidence в отчёт:** вывод тестов, два списка видов, JSON payload'а, diff.
- **Риски:** (1) handoff без `evidenceRefs` = пустая передача, выглядит как результат — тест (д) обязателен; (2) доставка handoff преемнику зависит от `D10` (что отдаём платформенным швам) — провайдер регистрируется как MyWork-провайдер контекста, а не как новый класс доверия.

---

## 12. Группа J. Ограничения worker-поверхности (MW-069, `D15`)

Решение `D15` (`00-RECON.md:200`; `01-MASTER-PLAN.md` §7.1, вариант **B**) и находки `G-S4/S5` (FINAL-REPORT §7.3, `:315`): «Negative requirements: `cordis_*`/dynamic вне поверхности worker'а; `auto-review` только deny». **Уточнение R-22/R-03 (внесено 2026-09-27):** `auto-review` **смонтирован и активен** (`enabled: true`, `fiberPhase: active`), а режима deny-only у пакета **нет** — «только deny» это **правило MyWork**, а не режим платформы; механика правила живёт в `F-57` (путь `auto-review` получает только `review.request-changes`), инвариант и тест — в `Q-38` (`23-STEPS-quality.md:60`, `:660`). Правка адресована карточкам **MW-022/MW-024** (FINAL-REPORT §9.1, `:406`). **Дедупликация (R-14):** механизм allowlist — `F-56` (`20-STEPS-foundation.md:1480`, `ctx.tools.restrict`, константы `packages/contracts/src/security.ts:201-216`); этот файл даёт **исполнение на стороне execution/controller** и fail-closed проверки, а не второй механизм.

**Ключевое ограничение платформы (проверено лично; уточнено по `evidence/lead-19-apis.md`):** в контракте MyWork per-session allow-list отсутствует — «a session inherits the composition of its preset, and there is no per-session tool allow-list to set instead» (`packages/contracts/src/agent-runtime.ts:52-59`). Платформа даёт per-agent ограничение только через **scoped-контекст агента**: `tools.restrict(filter)` (`C:\Reposit\deepseek-harness\deepseek-harness\packages\core\tools\src\index.ts:1097`) требует именно `agent.ctx` («a context-global restriction would mask every agent — deny the tool for the intended agent instead», `:1100`), а `tools.guard(guard)` (`:1136`) монотонен («no guard can force-allow a call another guard denied», `:1126-1130`). Форма ограничения — **allowlist, не denylist**: `restrict` бросает на незарегистрированном имени (`:1114-1118`), `restrictableNames` содержит только **унаследованные** имена (`:719-720`, `:1194-1197`), а собственные регистрации скоупа вне фильтра (`:1202-1208`) — то есть denylist динамического раннера невыразим и был бы fail-open; это и зафиксировало решение `D15` в пользу allowlist. Два уточнения: (1) `guard` **без** `agent.ctx` действует глобально ко всем агентам (`:1128-1129`) — как scoped-средство он не годится; (2) ограничение ставится в окно `setup` (`core/agent/src/index.ts:100-118`) и **повторно на resume** (`api/session-controller/src/agent.ts:440`), потому что оно процесс-локально. Граница с инвариантом и тестом «worker не может вызвать dynamic-путь» — шаг **Q-37** файла `23-STEPS-quality.md` (согласовано с `plan-quality`); runtime-инварианты MyWork — **свой модуль** и код `INVARIANT_VIOLATED`, а прежняя запись «регистрация `./invariant` + `ctx.invariants`» **снята как неверная**: шов не смонтирован в живом профиле и удаляется в 0.2.1 (дельта §2.2 D4, §5.2) — **Q-36**.

#### E-39 · Allowlist worker-поверхности: исполнение и fail-closed проверка (шаг-ссылка на `F-56`)
- **Тип:** шаг-ссылка (R-14). **Механизм** allowlist (`ctx.tools.restrict({ allow })`, константы) — `F-56` (`20-STEPS-foundation.md:1480-1501`, `evidence/foundation-16-tools-restrict.md`); **инвариант и тест** «worker не может вызвать dynamic-путь» — `Q-37`. Этот шаг даёт **исполнение на стороне execution/controller**: пресет, окно `setup`, receipt и fail-closed отказ запуска. Второго механизма не вводится.
- **Карточка:** MW-069 (новая), правка MW-022 · **Зависит от:** E-08, F-56 · **Усилие:** L (4–6 ч) · **Риск:** средний (каталог инструментов платформы) · **Откат:** revert коммита + удалить пакет пресета
- **Цель:** worker-сессия видит **только** явно разрешённые инструменты; инструмент, зарегистрированный позже (dynamic-путь), отвергается монотонным guard'ом; отсутствие подтверждённого фильтра означает отказ запуска, а не «работаем без фильтра».
- **Файлы:** Create `packages/worker-preset/{package.json,cordis.patch.yml}` (по образцу профильного слоя Agent Teams, `agent-team-profile/cordis.patch.yml:16-33`); **не** создавать свой фильтр — механизм `restrict({ allow })` и константа allowlist приходят из `F-56` (`packages/core/src/worker-surface.ts` или константа в `packages/contracts`, `20-STEPS-foundation.md:1485`); Create `packages/controller/src/presets.ts` (`assertWorkerPreset`, `assertSurfaceRestricted`, receipt); Modify `packages/controller/src/dsh-session.ts` (проброс `setup` в создание/резюм агента — сейчас capability `scopedTools: true` объявлена на `:93`, но `.restrict(`/`.guard(` в MyWork не вызываются **ни разу**: grep даёт одно совпадение — саму декларацию); Modify `packages/execution/src/worker.ts` (обе проверки до `runtime.start`); **Modify** канонический `tests/worker-surface.test.mjs`, созданный F-56 — второй файл и второй счёт не вводить.
- **Шаги:**
  0. Шаг 0: подтвердить обе механики платформы, окно применения и точку подключения.
     Команда: `Select-String -Path C:\Reposit\deepseek-harness\deepseek-harness\packages\core\tools\src\index.ts -Pattern 'restrict\(filter|guard\(guard|force-allow|requires a scoped context'` → `:1097`, `:1136`, `:1130`, `:1100`.
     Команда: `Select-String -Path C:\Reposit\deepseek-harness\deepseek-harness\packages\subagent\subagent\src\child-agent.ts -Pattern 'toolFilter'` → `:218` (`childCtx.tools.restrict(composition.toolFilter)` внутри `applyChildComposition`, окно создания ребёнка; докблок `:178-199`).
     Команда: `Select-String -Path C:\Reposit\deepseek-harness\deepseek-harness\packages\core\agent\src\index.ts -Pattern 'setup' | Select-Object -First 8` → окно `setup` (`:100-118`: вызывается после минта agent-ctx и **до** `session/created`, `agent/created` и первой сборки промпта; `restrict()` назван явно), на resume — `ResumeAgentOptions.setup` (`:134-143`).
     **Не проверено:** точные имена инструментов динамического раннера (`cordis-host-runner`); литералов в его `src` нет — имена приходят из генератора (известные литералы: `cordis_inspect_list`, `cordis_inspect_query` — `extensions/tool-cordis/src/index.ts:23`, `:42`). **Именно поэтому форма — allowlist:** она не требует знать имена того, что появится позже, а guard закрывает дыру «собственные регистрации скоупа вне фильтра» (`core/tools/src/index.ts:1202-1208`).
  1. Тест (падающий): восемь тестов: (а) `mywork-worker` пресет существует и его `cordis.patch.yml` **не** содержит `tool-cordis`, `cordis-host-runner`, `cordis-client-runner`, `plugin-manager` (текстовая проверка по образцу `agent-team-profile/tests/profile.spec.ts:46`); (б) allowlist worker'а равен ожидаемому набору и зафиксирован в тесте дословно — **шесть** имён: `read`, `write`, `edit`, `glob`, `grep`, `pwsh` (правка файлов в своём worktree и запуск тестов; ничего больше); (в) **негативный тест:** ни один инструмент вне allowlist недоступен воркеру — проверяются как минимум `plugin_manager`, `cordis_inspect_list`, `spawn_teammate`, `ask_user_question`, `task_board_run`, отказ с причиной ограничения; (г) фильтр ставится в окне `setup` (порядок: `setup` → `session/created` → первый промпт), а не в `agent/created`; (д) `guard`, зарегистрированный **в этом же** `agent.ctx`, отвергает инструмент, зарегистрированный в скоупе **после** `setup` (та самая дыра allowlist, `:1202-1208`); при этом `guard` без `agent.ctx` (глобальный, `:1128-1129`) в MyWork не вызывается вовсе; (е) `assertSurfaceRestricted(receipt)` без receipt'а отвергает запуск попытки `WORKER_SURFACE_UNVERIFIED`, а отсутствие любого из шести разрешённых имён в `restrictableNames` даёт `WORKER_SURFACE_INCOMPLETE` (fail-closed, `:1115-1118`); (ж) `assertWorkerPreset('standard')` (и любой пресет вне allow-list) отвергается `WORKER_PRESET_NOT_ALLOWED`; (з) после resume ограничение **переустановлено** (restriction процесс-локальна и не сериализуется в лог сессии — `core/tools/src/index.ts:736`; на resume её ставит `setup`, `api/session-controller/src/agent.ts:440`).
     Команда: `node --test --test-isolation=none "tests/worker-surface.test.mjs"` → FAIL.
  2. Реализация: слой (1) — `worker-surface.ts` возвращает `setup(agentCtx)`-колбэк, который внутри окна создания вызывает `agentCtx.tools.restrict({ allow: WORKER_TOOLS })` и `agentCtx.tools.guard(exec => WORKER_TOOLS.includes(exec.name) ? undefined : 'инструмент вне allowlist worker-поверхности')`; guard обязателен из-за собственных регистраций скоупа (`:1202-1208`) и ставится **только** через `agent.ctx`; disposer'ы сохраняются вместе с попыткой; receipt фиксирует allowlist и порядок применения. Слой (2) — пресет-пакет. Слой (3) — `assertSurfaceRestricted` **до** `runtime.start`, отказ при отсутствии receipt'а (fail-closed). Образец durable-фильтра у continuable-ребёнка: `subagent/subagent/src/descriptor.ts:85`, `:122`, `:143` и повторное применение при cold resume (`subagent/subagent/src/continuation.ts:425-427`, `:447`).
  3. Прогон: `node --test --test-isolation=none "tests/worker-surface.test.mjs"` → `fail 0`; восемь acceptance cases E-39 проверяются по именам/утверждениям, а не по общему числу тестов файла.
  4. Регрессия: `node --test --test-isolation=none "tests/runtime.test.mjs"` → без новых падений (в нём уже есть ветки `unknown preset`, `agent-preset/conflict`, `permission/preset`, `tests/runtime.test.mjs:137-180`).
- **Гейт (готово когда):** `tests/worker-surface.test.mjs` → `fail 0` и все именованные acceptance cases E-39 присутствуют; общий pass-count не является контрактом. В отчёте — текст `cordis.patch.yml` пресета, allowlist из шести имён дословно, вывод негативного теста (в) с причиной отказа, порядок «setup → session/created → промпт» из лога теста (г) и вывод grep по `packages/**/src` на `cordis_` (0 совпадений в MyWork).
- **Evidence в отчёт:** вывод теста, содержимое пресета, allowlist, лог отказа по инструменту вне списка, фрагмент лога порядка, diff.
- **Риски:** (1) **тест читает файл пресета, а не собранную композицию** — расхождение с живым профилем ловится только ручным шагом «снять дамп композиции» с **непроверенной** командой (§18, п. 3); (2) `node scripts/verify-profile.mjs` проверяет упаковку и строку бандла (`:187-191`, `:195-213`), но **не** состав инструментов/пресетов (`evidence/execution-09.md`, п. 4) — на него нельзя ссылаться как на доказательство фильтра; (3) restriction процесс-локальна и **снимается** собственным disposer'ом (`core/tools/src/index.ts:1119-1123`; прецедент `scoped.spec.ts:165-170`), поэтому снятие ограничения до завершения попытки — дефект, и тест (з) обязан это ловить; (4) allowlist требует, чтобы все шесть имён были зарегистрированы как **унаследованные** к моменту `setup`: иначе `restrict` бросает (`:1115-1118`) — это `WORKER_SURFACE_INCOMPLETE` (fail-closed), а не «пропустить фильтр»; (5) `guard` без `agent.ctx` становится **глобальным** и замаскировал бы все агенты (`:1128-1129`) — вызов вне scoped-контекста в коде MyWork запрещён и проверяется тестом (д); (6) `context.toolSurface` (`packages/contracts/src/context.ts:805`) — **описание** поверхности для аудита, а не её источник: живой рантайм его не заполняет (писатели — только тесты, `evidence/execution-09.md`, п. 2), поэтому receipt не может опираться на это поле; (7) **опровержение (зафиксировать, чтобы не искали):** пути `packages/execution/src/agent-runtime.ts` **не существует** (`packages/execution/src/` = `errors/index/schema/service/store.ts`), контракт scope живёт в `packages/contracts/src/agent-runtime.ts:52-59`, и фильтр поверхности в нём **не** выражается — его место в `packages/controller` (`evidence/lead-19-apis.md`, §3 «Опровержения» п. 1).

#### E-40 · «Автоматика не одобряет» при **активном** `auto-review` (шаг-ссылка на `F-57`/`Q-38`)
- **Тип:** шаг-ссылка (R-14). Механика правила — `F-57` (`20-STEPS-foundation.md:1518-1543`: `auto-review` **смонтирован и активен**, `enabled: true`, `fiberPhase: active`; путь получает только `review.request-changes`); инвариант и тест — `Q-38` (`23-STEPS-quality.md:60`, `:660`: «автоматика не одобряет»). Этот шаг даёт исполнение на стороне execution/controller: пиннинг политики ролей и тест **при активном** аппрувере. «Только deny» — **не режим платформы** (deny-only режима у пакета нет), а правило MyWork.
- **Карточка:** MW-069 (новая), правка MW-024 · **Зависит от:** E-39, F-57 · **Усилие:** S (1–2 ч) · **Риск:** средний (обходит review) · **Откат:** revert коммита
- **Цель:** ни один путь MyWork не запрашивает авто-одобрение вызова инструмента **при активном** аппрувере, а отказ авто-ревьюера нельзя «переспросить», чтобы он стал согласием.
- **Файлы:** Modify `packages/controller/src/presets.ts` (политика approval для пресетов ролей); **E-40 владеет** `tests/auto-review-policy.test.mjs` как тестом именно session/preset policy. Core deny-only vocabulary остаётся в каноническом `tests/auto-review-deny-only.test.mjs` (F-57), а production review-decision boundary — в `tests/review-staleness.test.mjs` / `tests/review-reject.test.mjs`; Q-38 эти носители только переиспользует.
- **Шаги:**
  0. Шаг 0: подтвердить, что пакет **активен** и что при политике `never` отказ авто-ревьюера финален и не превращается в вопрос.
     Команда: `Select-String -Path C:\Reposit\deepseek-harness\deepseek-harness\packages\experimental\auto-review\src\index.ts -Pattern "overrideOf\(agent.session\) === 'never'|function denied|function askUser"` → `:710` (ветка `never` → `denied(exec, reason)`), `:641` (`denied`), `:657` (`askUser`).
     Команда (область действия ревьюера, дельта §2.2): `Select-String -Path C:\Reposit\deepseek-harness\deepseek-harness\packages\experimental\auto-review\src\index.ts -Pattern 'AUTO_PRESET|AutoReviewDecision|REVIEW_POLICY'` → `:24` (импорт `AUTO_PRESET`), `:691` и `:731` (**ревью включается только при пресете сессии `auto`**), `:40-67` (политика ревьюера и объединение решений).
     Вывод, который идёт в отчёт: **`auto-review` смонтирован и активен** (`enabled: true`, `fiberPhase: active` — `F-57`/`Q-38`, дефект R-03/R-22; подтверждено на `0.2.0-rc.2`), **deny-only режима у пакета нет** (объединение решений — `low/allow`, `medium/allow`, `medium|high/deny`: `auto-review\src\index.ts:64-67`); поэтому «автоматика не одобряет» — правило MyWork, а ближайшая достижимая механика — пинить `approval: 'never'`, при которой ветка вопроса (`askUser`) для отказа недостижима, и ограничить путь до `review.request-changes`. **Область действия:** ревьюер вмешивается только тогда, когда пресет сессии равен `auto` (`:691`, `:731`), поэтому вне `auto` он не является ни защитой, ни угрозой — пиннинг `approval: 'never'` в пресетах ролей закрывает и ветку `ask`.
  1. Тест (падающий): пять тестов: (а) пресеты ролей MyWork пинят `approval: 'never'` (проверка по конфигурации пресета); (б) при политике `never` отказ ревьюера не порождает `ask` (проверяется на фейке решения: тип решения остаётся `deny`); (в) **тест при активном аппрувере:** правило проверяется независимо от наличия плагина — решение `approve` отвергается и когда `auto-review` смонтирован; (г) в исходниках `packages/controller`/`packages/execution` нет вызовов, приводящих к `approve` (grep по словарю `approve` вне review-домена); (д) approval ревью — только доменное решение (`packages/core/src/review.ts:182`), авто-одобрения не существует ни в одном пути.
     Команда: `node --test --test-isolation=none "tests/auto-review-policy.test.mjs"` → FAIL.
  2. Реализация: явная политика `approval: 'never'` в пресетах ролей и путь `review.request-changes` для решений аппрувера; MyWork не предлагает «approve на будущее» (`requiresApproval`/`approveFutureVersions` по умолчанию false — `00-RECON.md` §7.3, `:315`).
  3. Прогон: `node --test --test-isolation=none "tests/auto-review-policy.test.mjs" "tests/auto-review-deny-only.test.mjs" "tests/review-staleness.test.mjs" "tests/review-reject.test.mjs"` → `fail 0`; общий pass-count не пинится.
- **Гейт (готово когда):** четыре канонических носителя E-40/F-57/R-42 выше дают `fail 0`; в отчёте — вывод grep на `approve` с объяснением каждого совпадения (review-домен, тест или имя политики), строка конфигурации пресета и явная запись «`auto-review` активен».
- **Evidence в отчёт:** вывод теста, фрагмент конфигурации пресета, grep-вывод, diff.
- **Риски:** `auto-review` — per-call политика одобрения вызовов, а не ревью кода (FINAL-REPORT §5.4 §32, `:250`); смешение трёх гейтов (permission / доменное решение / приёмка) названо там же ошибкой UI — в этом файле они разделены явно. **Не делать:** не полагаться на «плагин не смонтирован» (он активен) и не выключать его конфигурацией профиля как способ защиты (`F-57`, «Не делать»). (2) **Не переоценивать область действия:** ревьюер работает только под пресетом `auto` (`auto-review\src\index.ts:691,731`), поэтому «при активном аппрувере» в цели шага означает «если сессия окажется в `auto`»; при `approval: 'never'` ветка `ask` недостижима (`:710`), а ветка `allow` у пакета существует (`:64-67`) — тест (в) обязан проверять **оба** состояния (смонтирован / отсутствует) и не ветвиться на наличие плагина (`F-57`, мутация M3).

---

## 13. Группа K. Права роли через платформенный runtime-enforcement

Правка адресована карточкам **MW-007/MW-015** (FINAL-REPORT §9.1, `:408`): «Права роли → платформенный runtime-enforcement (`sandbox-policy` + `fs-observation-policy`), а не свой слой». Платформа уже умеет: режимы `SANDBOX_MODES = ['read-only','workspace-write','danger-full-access']` (`C:\Reposit\deepseek-harness\deepseek-harness\packages\sandbox\sandbox-policy\src\session-mode.ts:42`, дефолт `read-only` — `sandbox-policy\src\index.ts:71-79`), а `fs-observation-policy` ограничивает мутации prior-observation CAS'ом (`packages\fs\fs-observation-policy\src\index.ts:65-80`).

**Граница «права сессии» — платформа и доска (дельта 0.2.0-rc.2, `02-PLATFORM-DELTA-0.2.0-rc.2.md` §2.2 D11).** `sessionDefaultPermission` — понятие **доски**, а не платформы: в DSH это имя не встречается в `packages/**/src` **ни разу** (0 совпадений; проверка — `E-41`, шаг 0). Правило «привязка выше дефолта сессии требует подтверждения человеком» живёт в доске: `…\@linxin666\dsh-client-ui-task-board\src\core\handover.ts:44` (fail-safe дефолт `read-only`), `:102-117` (`exceedsSessionDefault`, `requiresPermissionConfirmation`), а само значение дефолта приходит из конфига строки профиля (`…task-board\src\index.ts:109,323`). Платформенный гейт — **per-call**: пресеты `read-only | workspace-write | danger-full-access` (`packages/interaction/permission-presets/src/index.ts:116-118`, таблица дефолтов `:189-195`) плюс одноразовая эскалация `sandbox_permissions` на retry с одобрением. Поэтому «права роли/сессии» в `E-39`/`E-41` — это политика сессии и ограничение пути; **платформенной гарантии** «выше дефолта сессии нельзя без человека» они не дают — её даёт только гейт доски (и только для сессий, запущенных доской).

#### E-41 · Политики ролей через `HarnessPolicy` и платформенные ограничители
- **Карточка:** MW-007/MW-015 (правка), `D13`/`G-S1` · **Зависит от:** E-39 · **Усилие:** M (2–3 ч) · **Риск:** средний · **Откат:** revert коммита
- **Цель:** права роли — это политика сессии плюс ограничение пути, а не собственный слой проверок в MyWork.
- **Файлы:** Modify `packages/controller/src/presets.ts` (политика на роль); Modify `packages/execution/src/worker.ts` (передача `permission` и `worktreeRoot`); Create `tests/role-permissions.test.mjs`.
- **Шаги:**
  0. Шаг 0: подтвердить, что потолок политик уже выражен в контрактах и что `worktreeRoot` — часть grant'а.
     Команда: `Select-String -Path packages/contracts/src/security.ts -Pattern 'HARNESS_POLICIES|HARNESS_POLICY_CEILING|worktreeRoot'` → `:119-146`, `:257-258`; и `Select-String -Path packages/core/src/security.ts -Pattern 'boundaryRoot|worktree-escape'` → `:130`, `:203-207`.
     Команда (граница «права сессии»): `Select-String -Path C:\Reposit\deepseek-harness\deepseek-harness\packages\**\src\*.ts -Pattern 'sessionDefaultPermission'` → **0 совпадений** (имя принадлежит доске, не платформе); `Select-String -Path C:\Reposit\deepseek-harness\deepseek-harness\packages\sandbox\sandbox-policy\src\index.ts -Pattern "mode: 'read-only'|fail-safe"` → `:66-79` (fail-safe дефолт `read-only`).
     Команда (гейт доски, если шаг ссылается на запуск через доску): `Select-String -Path C:\Users\Dmitry\.dsh\profiles\web\node_modules\@linxin666\dsh-client-ui-task-board\src\core\handover.ts -Pattern 'DEFAULT_SESSION_PERMISSION|exceedsSessionDefault|requiresPermissionConfirmation'` → `:44`, `:103`, `:112`.
  1. Тест (падающий): шесть тестов: (а) worker получает `workspace-write` **и** `worktreeRoot = worktree.path`; (б) reviewer и planner получают `read-only`; (в) worker не может получить `danger-full-access` (потолок политики); (г) запись вне worktree отвергается с причиной `worktree-escape`; (д) запись внутри worktree разрешена; (е) отказ не зависит от текста промпта (проверяется вызовом домена с пустым промптом).
     Команда: `node --test --test-isolation=none "tests/role-permissions.test.mjs"` → FAIL.
  2. Реализация: таблица «роль → политика» в одном месте; никакого второго слоя проверок прав в MyWork не заводится (иначе два источника истины).
  3. Прогон: `node --test --test-isolation=none "tests/role-permissions.test.mjs"` → `pass 6 / fail 0`.
  4. Регрессия: `node --test --test-isolation=none "tests/security.test.mjs"` → без новых падений.
- **Гейт (готово когда):** `pass 6 / fail 0`; в отчёте — таблица «роль → политика → путь ограничения» и вывод теста (г).
- **Evidence в отчёт:** вывод тестов, таблица политик, diff.
- **Риски:** `fs-observation-policy` даёт **prior-observation CAS** (`FS_NOT_OBSERVED`), а не проверку прав: тест (д) обязан читать файл перед записью, иначе получит ложный отказ — это фиксируется в отчёте как особенность платформы. (2) **Не читать «права роли/сессии» как платформенную гарантию:** `sessionDefaultPermission` и правило «выше дефолта → подтверждение человеком» — гейт **доски** (`…task-board\src\core\handover.ts:44,102-117`), а не DSH; платформенный гейт — per-call эскалация `sandbox_permissions` с одобрением. Тест (в) («worker не может получить `danger-full-access`») проверяет **потолок политики MyWork**, а не платформенный запрет: тест обязан называть это явно, иначе в отчёте появится несуществующая гарантия (дельта §2.2 D11).

---

## 14. Группа L. Embedded и resident controller (MW-028)

Карточка: `.work/tasks/MW-028.md:1`, зависимости `MW-009, MW-014, MW-022, MW-025` (`:4`, `:13`); объём `:17`: «Запускать Controller от lifecycle плагина в embedded и отдельном поддерживаемом DSH profile в resident/headless. Один application слой, внешний state directory, graceful shutdown и reconnect клиентов»; приёмка `:20`: «Закрытие браузера не останавливает resident execution. Два deployment не нарушают single-controller invariant. Restart делает reconcile до admission; профиль проверяется отдельно от живой установки пользователя».

**Что уже есть:** `ControllerLifecycle` (`packages/lease/src/lifecycle.ts:134`) с фазами (`:33-45`), activation-порядком (`:214`), heartbeat'ом (`:281-299`) и `admissionHold` (`:123`); он **нигде не инстанцируется** (`evidence/execution-02.md`, п. 5). Шаги группы — монтирование, а не новый жизненный цикл.

#### E-42 · Монтирование `ControllerLifecycle` в composition root
- **Карточка:** MW-028 · **Зависит от:** E-25, F(composition root) · **Усилие:** L (4–6 ч) · **Риск:** высокий · **Откат:** revert коммита
- **Цель:** один application-слой владеет лидерством, открывает store каноническим списком миграций и только затем допускает работу.
- **Файлы:** Modify `packages/controller/src/index.ts` (в `apply`, рядом с `mountModelCatalog:123`); Create `packages/controller/src/runtime-root.ts`; Create `tests/controller-lifecycle.test.mjs`.
- **Шаги:**
  0. Шаг 0: подтвердить, что текущий `apply` не открывает store и не поднимает lifecycle.
     Команда: `Select-String -Path packages/controller/src/index.ts -Pattern 'openStore|ControllerLifecycle|createClaimSaga|createScheduler'` → **0 совпадений** (проверено лично: в `apply` вызываются только `mountModelCatalog` и `mountDshRuntime`).
  1. Тест (падающий): шесть тестов: (а) активация в изолированном `$DSH_HOME` открывает `controller.sqlite`, и `user_version` равен версии, **которую вернул аллокатор** для полного списка миграций (ожидаемый набор читается из аллокатора, литерала `[1,2,3,4,5,6]` в тесте нет — §1.6); (б) пассивный контроллер (второй инстанс на том же файле) не допускает ни одной работы; (в) `lifecycle.info().admitting === true` только у активного; (г) store открывается **после** получения лидерства (порядок вызовов); (д) ошибка открытия store переводит lifecycle в отказ и не оставляет lease; (е) `dispose` закрывает admission, дожидается settle и только потом освобождает lease (`packages/lease/src/lifecycle.ts:21-25`).
     Команда: `node --test --test-isolation=none "tests/controller-lifecycle.test.mjs"` → FAIL.
  2. Реализация: `runtimeRoot` собирает: канонический список миграций (`F(единый реестр миграций)`), `createLeaseStore`, `ControllerLifecycle`, `createClaimSaga`, `createPlanner`, `createScheduler`, `createArtifactStore`, `createAuditLog`; публикует их одним сервисом вместо набора разрозненных.
  3. Прогон: `node --test --test-isolation=none "tests/controller-lifecycle.test.mjs"` → `pass 6 / fail 0`.
  4. Регрессия: `node --test --test-isolation=none "tests/lease.test.mjs"` → без новых падений (в том числе «two controllers on one file: only one holds the lease at any instant», `tests/lease.test.mjs:380`).
- **Гейт (готово когда):** `pass 6 / fail 0`; smoke-проверка `Test-Path $DSH_HOME\dsh-mywork\state\controller.sqlite` → `True` (формулировка гейта этапа 2 FINAL-REPORT §10 п. 6, `:467`).
- **Evidence в отчёт:** вывод тестов, `PRAGMA user_version`, `Test-Path` в изолированном `DSH_HOME`, diff.
- **Риски:** (1) живой профиль пользователя **не трогается**: тесты работают в изолированном `$DSH_HOME` (создаётся в `$env:TEMP`); (2) сервис-локатор: если `runtimeRoot` публикуется новым сервисом, `myworkController` остаётся совместимым (аддитивно).

#### E-43 · Heartbeat, потеря lease → passive и закрытый admission
- **Карточка:** MW-028 · **Зависит от:** E-42 · **Усилие:** M (2–3 ч) · **Риск:** высокий (два контроллера) · **Откат:** revert коммита
- **Цель:** пока жив лидер, второй не работает; при потере lease первый немедленно закрывает admission.
- **Файлы:** Modify `packages/controller/src/runtime-root.ts` (таймер heartbeat); Create `tests/controller-heartbeat.test.mjs`.
- **Шаги:**
  0. Шаг 0: подтвердить, что heartbeat закрывает admission при ошибке и что интервал задаёт вызывающий.
     Команда: `Select-String -Path packages/lease/src/lifecycle.ts -Pattern 'heartbeat|admitting' -Context 0,4` → `:281-299`, включая закрытие admission при ошибке (`:294`); `Select-String -Path packages/lease/src/lifecycle.ts -Pattern 'leaseMs'` → `:101` («окно задаёт вызывающий»).
  1. Тест (падающий): пять тестов с `FakeClock`: (а) heartbeat вызывается с интервалом `< leaseMs` (проверяется по числу вызовов при прокрутке часов); (б) потеря lease → `phase = 'passive'`, `admitting === false`; (в) после потери lease ни один admission не проходит; (г) повторная активация после восстановления лидерства возвращает `active`; (д) второй контроллер за время, пока первый жив, не допускает **ни одной** работы (проверка счётчика admission у второго).
     Команда: `node --test --test-isolation=none "tests/controller-heartbeat.test.mjs"` → FAIL.
  2. Реализация: таймер через `clock.sleep`-совместимый интерфейс (как `reconcileLoop`, `packages/scheduler/src/service.ts:290-306`), а не `setInterval` — иначе тест недетерминирован; `dispose` очищает таймер.
  3. Прогон: `node --test --test-isolation=none "tests/controller-heartbeat.test.mjs"` → `pass 5 / fail 0`.
- **Гейт (готово когда):** `pass 5 / fail 0`; в отчёте — число admission'ов активного и пассивного контроллера (второй — `0`).
- **Evidence в отчёт:** вывод теста, лог фаз, diff.
- **Риски:** `setInterval` + `Date.now` сделают тест флаки; запрет на `Date.now` в новых файлах проверяется `E-18`-стилем (`Select-String -Pattern 'Date.now|setInterval'` → 0).

#### E-44 · Embedded и resident режимы, внешний state dir, graceful shutdown
- **Карточка:** MW-028 · **Зависит от:** E-43 · **Усилие:** L (3–5 ч) · **Риск:** высокий · **Откат:** revert коммита
- **Цель:** закрытие браузера не останавливает резидентное исполнение; состояние живёт вне профиля; выключение упорядочено.
- **Файлы:** Modify `packages/controller/src/runtime-root.ts`; Create `packages/controller/src/deployment.ts`; Create `tests/controller-modes.test.mjs`.
- **Шаги:**
  0. Шаг 0: подтвердить существующий резолвер пути состояния (внешний state dir) и его переменные.
     Команда: `Select-String -Path packages/storage/src/layout.ts -Pattern 'DSH_HOME_ENV|MYWORK_DIR_NAME|stateDatabasePath'` → `:78`, `:82-83` (`resolveMyWorkLayout`), `:91-93` (`stateDatabasePath`); **корректный якорь — `:76-84`, а не `:66-68`** (там `defaultDshHome`), уточнено по верификации B; ту же форму проверяет `scripts/verify-profile.mjs:127-134` (`00-RECON.md:168` п. 10).
  1. Тест (падающий): шесть тестов: (а) `embedded` активируется внутри процесса хоста, state dir — тот же внешний; (б) `resident` активируется без UI-сессии (нет ни одного клиента) и продолжает heartbeat; (в) «закрытие браузера» (dispose клиентского слоя) **не** вызывает `dispose` контроллера; (г) graceful shutdown идёт в порядке admission → settle → release lease (порядок вызовов); (д) reconnect клиента после рестарта находит тот же state и ту же эпоху; (е) два deployment (embedded + resident) на одном scope не нарушают single-controller: активен один.
     Команда: `node --test --test-isolation=none "tests/controller-modes.test.mjs"` → FAIL.
  2. Реализация: режим — параметр монтирования; состояние — только через `layout`; shutdown — единая функция, идемпотентная.
  3. Прогон: `node --test --test-isolation=none "tests/controller-modes.test.mjs"` → `pass 6 / fail 0`.
- **Гейт (готово когда):** `pass 6 / fail 0`; в отчёте — путь state dir (изолированный `$DSH_HOME`) и порядок вызовов при shutdown.
- **Evidence в отчёт:** вывод теста, путь состояния, порядок вызовов, diff.
- **Риски:** (1) тест «закрытие браузера» не поднимает настоящий браузер: он проверяет, что `dispose` клиентского слоя не связан с lifecycle контроллера — формулируется явно, чтобы не выдавать частичную проверку за полную; (2) профиль пользователя не изменяется: всё в `$env:TEMP`.

#### E-45 · Reconcile до admission и `admissionHold`
- **Карточка:** MW-028 · **Зависит от:** E-44 · **Усилие:** M (2–3 ч) · **Риск:** средний · **Откат:** revert коммита
- **Цель:** активация всегда сначала восстанавливает состояние, потом допускает работу; незавершённая стадия плана держит admission закрытым.
- **Файлы:** Modify `packages/controller/src/runtime-root.ts` (`reconcile`, `admissionHold`); Create `tests/controller-reconcile-order.test.mjs`.
- **Шаги:**
  1. Тест (падающий): четыре теста: (а) `reconcile` вызывается **до** первого admission (порядок вызовов); (б) провал `reconcile` оставляет lifecycle неактивным (admission закрыт), lease не удерживается; (в) незавершённая staged-мутация плана (`PLAN_MUTATION_HOLD_REASON`, `packages/planner/src/store.ts:41`) держит `admissionHeld === true`; (г) после `resumeAdmission` (мутация завершена) admission открывается.
     Команда: `node --test --test-isolation=none "tests/controller-reconcile-order.test.mjs"` → FAIL.
  2. Реализация: `admissionHold: (stores) => plannerStore.openHold(workspaceId) !== undefined` — метод фасада **`openHold`** (`packages/planner/src/store.ts:596`, реализация `:622-623`), а не свободная функция `readOpenHold` (`:435`, executor-уровень).
  3. Прогон: `node --test --test-isolation=none "tests/controller-reconcile-order.test.mjs"` → `pass 4 / fail 0`.
  4. Регрессия: `node --test --test-isolation=none "tests/controller-lifecycle.test.mjs"` → `fail 0`.
- **Гейт (готово когда):** `pass 4 / fail 0`; в отчёте — вывод `admissionHeld` до и после снятия hold.
- **Evidence в отчёт:** вывод теста, JSON `ControllerLifecycleInfo` в двух состояниях, diff.
- **Риски:** reconcile здесь — композиция чужих reconciler'ов (плана, claim-саги, lease); полнота сценариев §49 — в группе M, этот шаг проверяет только порядок.

---

## 15. Группа M. Recovery и обнаружение застрявшей работы (MW-031)

Карточка: `.work/tasks/MW-031.md:1`, зависимости `MW-012, MW-014, MW-020, MW-025, MW-030` (`:4`, `:13`); объём `:17`: «Reconcile claim без Attempt, Attempt без runtime, expired leases, Controller failover, lost events, Board/Memory outage. Выявлять unschedulable/review loop/repeated failure/orphan/budget/provider blockers и выдавать NeedsAttention с причиной»; приёмка `:20`: «Fault injection/restart для каждого сценария §49. Reconcile повторяем и не дублирует запуск. Detector не расходует LLM в цикле; восстановление memory лишь по explicit degraded policy».

#### E-46 · Reconcile-сценарии §49 с fault injection
- **Карточка:** MW-031 · **Зависит от:** E-45 · **Усилие:** L (4–6 ч) · **Риск:** высокий · **Откат:** revert коммита
- **Цель:** каждый сценарий §49 восстановим и **повторяем**: второй прогон reconcile не создаёт второй работы.
- **Файлы:** Create `packages/execution/src/reconcile.ts`; Modify `packages/controller/src/runtime-root.ts`; Create `tests/recovery-scenarios.test.mjs`.
- **Шаги:**
  0. Шаг 0: подтвердить, какие сценарии §49 уже покрыты claim-сагой, чтобы не строить заново.
     Команда: `Select-String -Path .work/reports/MW-012-attempt-saga.md -Pattern 'recover|revoke' | Select-Object -First 12` → существующие тесты recovery/revoke (`tests/claim-saga.test.mjs:536`, `:572`, `:599`, `:658` — по `B-orchestration.md:452`).
  1. Тест (падающий): восемь тестов, по одному на сценарий: (а) claim без Attempt; (б) Attempt без runtime (сессии нет); (в) истёкшая lease (часы прокручены вперёд); (г) failover контроллера (смена epoch); (д) потерянные события (outbox не доставлен); (е) недоступность Board; (ж) недоступность Memory (только по explicit degraded policy); (з) повторный reconcile идемпотентен и не дублирует запуск.
     Команда: `node --test --test-isolation=none "tests/recovery-scenarios.test.mjs"` → FAIL.
  2. Реализация: `reconcile(stores)` возвращает отчёт **`{operations, leases}`** — существующая форма `ReconcileReport` (`packages/lease/src/lifecycle.ts:56-61`); поле `stalls` **не вводится** (уточнено по верификации B): результат сканера зависаний живёт в `detectStalls` (`E-47`) и не расширяет `ReconcileReport`. Вызывается из `E-42`/`E-45`; истечение lease проверяется **здесь**, а не в `settle` (известное ограничение `.work/reports/MW-012-attempt-saga.md:230`).
  3. Прогон: `node --test --test-isolation=none "tests/recovery-scenarios.test.mjs"` → `pass 8 / fail 0`.
  4. Регрессия: `node --test --test-isolation=none "tests/claim-saga.test.mjs" "tests/lease.test.mjs"` → `fail 0`.
- **Гейт (готово когда):** `pass 8 / fail 0`; в отчёте — таблица «сценарий → тест → наблюдение до/после», и число запусков рантайма в сценарии (з) — `1`.
- **Evidence в отчёт:** вывод теста, отчёт reconcile для каждого сценария, SQL-счётчики, diff.
- **Риски:** (1) §49 не читался целиком в этой кампании — список сценариев взят из объёма карточки (`MW-031.md:17`); если в §49 есть строки сверх восьми, они добавляются тестом, а не пропускаются; (2) reconcile не должен вызывать модель — это проверяется в `E-47`.

#### E-47 · Stall detection без LLM и `NeedsAttention` из закрытого каталога
- **Карточка:** MW-031 · **Зависит от:** E-46, D05 · **Усилие:** L (3–5 ч) · **Риск:** средний · **Откат:** revert коммита
- **Цель:** застрявшая работа обнаруживается детектором событий (не циклом модели) и эскалируется причиной из закрытого каталога — новое значение каталога вводится **явно и с тестом**.
- **Файлы:** Create `packages/execution/src/stall.ts`; Modify `packages/contracts/src/board.ts` (**аддитивно** новое значение `attempt-stalled` в `NeedsAttentionReason` и `NEEDS_ATTENTION_REASONS`, `:356-381`); Modify `packages/controller/src/runtime-root.ts` (запуск детектора по расписанию); Create `tests/stall-detection.test.mjs`.
- **Шаги:**
  0. Шаг 0: подтвердить каталог причин и то, что подходящего значения в нём **нет** (иначе новое не вводится).
     Команда: `Select-String -Path packages/contracts/src/board.ts -Pattern 'NeedsAttentionReason|NEEDS_ATTENTION_REASONS' -Context 0,3` → `:356-381`; текущие 7 значений: `reconciliation-divergence`, `adapter-unavailable-with-live-attempt`, `budget-exhausted`, `human-gate-deadline-exceeded`, `retry-budget-exhausted`, `dependency-unresolvable-after-void`, `lease-lost-without-successor` — ни одно не описывает «попытка без событий дольше порога». Носитель причины — карточка доски (`22-STEPS-surface.md`), здесь только запись причины и перехода в `needs-attention`.
  1. Тест (падающий): семь тестов: (а) попытка без события дольше `stallAfterMs` даёт `needs-attention`; (б) причина — `attempt-stalled`, и она входит в `NEEDS_ATTENTION_REASONS`; (в) словарь причин вырос **ровно на 1** и порядок прежних 7 значений не изменился; (г) детектор **не** обращается к порту модели (фейк порта фиксирует 0 вызовов); (д) детектор не тратит бюджет попыток (счётчик бюджета не меняется); (е) свежая попытка не эскалируется (защита от ложных срабатываний); (ж) повторный прогон детектора не создаёт вторую запись эскалации для той же попытки.
     Команда: `node --test --test-isolation=none "tests/stall-detection.test.mjs"` → FAIL.
  2. Реализация: `detectStalls({ now, attempts, events })` — чистая функция от наблюдений; порог `stallAfterMs` по умолчанию `30 * 60 * 1000` (практика стороннего плагина доски: `autoRunStallMinutes: 30`, `B-orchestration.md:387`, N-15), значение помечено как «до `D05`»; значение `attempt-stalled` добавляется в конец каталога.
  3. Сборка и прогон: `Push-Location packages/contracts; node ../../node_modules/tsdown/dist/run.mjs; Pop-Location`, затем `Push-Location packages/execution; …` → `✔ Build complete` ×2; тест → `pass 7 / fail 0`.
  4. Регрессия: `node --test --test-isolation=none "tests/board.test.mjs"` → без новых падений (тест словаря причин обновляется аддитивно; если он пиннит полный список — пиннинг расширяется на одно значение, и это фиксируется в отчёте).
- **Гейт (готово когда):** `pass 7 / fail 0`; в отчёте — 0 вызовов модельного порта, значение `attempt-stalled` из каталога дословно и подтверждение «прежние 7 причин не изменились».
- **Evidence в отчёт:** вывод теста, наблюдения до/после, значение причины, diff по `board.ts` (только добавленные строки).
- **Риски:** (1) порог 30 минут — **не** решение владельца, а заимствованная практика; при `D05` значение меняется; (2) детектор обязан быть дешёвым: если он начнёт читать артефакты целиком, это нарушит (г); тест это фиксирует; (3) новое значение каталога — **единственное** в этом файле, вводимое в `NeedsAttentionReason`; при конфликте с `22-STEPS-surface.md` приоритет у владельца контракта, и тогда шаг переиспользует ближайшее существующее значение (`reconciliation-divergence`).

#### E-48 · Исчерпание бюджета попыток → эскалация
- **Карточка:** MW-031 · **Зависит от:** E-47, D05 · **Усилие:** M (1–2 ч) · **Риск:** средний · **Откат:** revert коммита
- **Цель:** «repeated failure» и «review loop» превращаются в решение человека, а не в бесконечный цикл.
- **Файлы:** Modify `packages/execution/src/stall.ts`; Create `tests/attempt-budget-escalation.test.mjs`.
- **Шаги:**
  0. Шаг 0: подтвердить, что бюджет попыток существует и его scope — задача.
     Команда: `Select-String -Path packages/contracts/src/budget.ts -Pattern "maxAttempts|'task'"` → `:65`, `:104` (`maxAttempts: 'task'`), `:123`, `:138` («One attempt of a task (charges `maxAttempts`)»).
  1. Тест (падающий): пять тестов: (а) исчерпание `BudgetLimits.maxAttempts` даёт `needs-attention` с причиной **`budget-exhausted`** — существующее значение закрытого каталога (`packages/contracts/src/board.ts:362`, «A budget ran out with no retry allowed»); нового значения здесь не вводится; (б) новая попытка после исчерпания не создаётся; (в) счётчик берётся из бюджета задачи, а не из числа строк `attempt` (проверяется на задаче с ручным бюджетом); (г) тот же механизм срабатывает для исчерпания review-loop (`E-24`, причина `retry-budget-exhausted`) — один путь эскалации, разные существующие причины; (д) эскалация идемпотентна.
     Команда: `node --test --test-isolation=none "tests/attempt-budget-escalation.test.mjs"` → FAIL.
  2. Реализация: проверка бюджета — на входе в admission (`packages/core/src/scheduler.ts:554` `budgetVerdict`), а не постфактум; при отказе — `needs-attention`.
  3. Прогон: `node --test --test-isolation=none "tests/attempt-budget-escalation.test.mjs"` → `pass 5 / fail 0`.
  4. Регрессия: `node --test --test-isolation=none "tests/budget.test.mjs"` → без новых падений.
- **Гейт (готово когда):** `pass 5 / fail 0`; в отчёте — число попыток до и после исчерпания и запись причины.
- **Evidence в отчёт:** вывод теста, SQL бюджета, diff.
- **Риски:** лимит шагов агентского цикла (RT-2) — **не** этот шаг: он про попытки задачи; глобальный cap стоимости — `D05` и `23-STEPS-quality.md`. Мост бюджета (`ctx.tokenMeter.measure(...)`) и счётчик шагов живут в `F-51`/`F-52` (`20-STEPS-foundation.md`), а исполнение breaker'а — на **управляющем** `agent/pre-step` (`packages/core/agent/src/runtime-types.ts:320`, `PreStepDecision = {kind:'reject'} | {kind:'enter', messages}` `:112`): своего цикла шагов не строить, у платформы своего потолка шагов нет (дельта §2.2 D6). **Учёт токенов некумулятивен** (дельта §2.2 D5): `measure(session, requestHeader?)` (`packages/llm/token-meter/src/index.ts:146`) отдаёт **текущее давление запроса**, а не накопленный расход — `totalTokens = max(0, baseline.tokens + surfaceDeltaTokens)` (`:187`), `baseline` — usage **последнего успешного** вызова (`:158-171`), поэтому значение может **уменьшаться** (сжатие поверхности, image-offload: в живом профиле `compaction-basic`/`tool-result-pruner` — `enabled: false`, `image-offload` — active). Бюджет 2M токенов на попытку обязан накапливать **положительные дельты** снимка и не выдавать снимок за накопленный расход; иначе лимит недосчитывается.

#### E-49 · Наблюдаемость позднего отказа (счётчик, не audit)
- **Карточка:** MW-031 · **Зависит от:** E-46 · **Усилие:** S (1–2 ч) · **Риск:** средний (запись от неавторизованного) · **Откат:** revert коммита
- **Цель:** оператор видит, что кто-то пытался заселиться в отозванную попытку, но неавторизованный вызов не получает права писать в append-only журнал.
- **Файлы:** Modify `packages/execution/src/service.ts` (счётчик рядом с `STALE_FENCE:413`); Modify `packages/controller/src/runtime-root.ts` (экспорт счётчика в наблюдаемость); Create `tests/late-refusal-observability.test.mjs`.
- **Шаги:**
  0. Шаг 0: подтвердить, что отказ сегодня не оставляет следа (иначе шаг не нужен).
     Команда: `Select-String -Path .work/reports/MW-012-attempt-saga.md -Pattern 'audit-строки|поздний результат'` → `:234` (§8 п. 7).
  1. Тест (падающий): три теста: (а) поздний результат даёт `STALE_FENCE` и **увеличивает** счётчик отказов; (б) в `audit_events` при этом **не** появляется строка (append-only не пишется неавторизованным); (в) счётчик ограничен по частоте (rate-limited): 1 000 отказов подряд не создают 1 000 записей.
     Команда: `node --test --test-isolation=none "tests/late-refusal-observability.test.mjs"` → FAIL.
  2. Реализация: счётчик в памяти + периодический сброс в метрику (не в доменный журнал); форма метрики согласуется с `D16` (наблюдаемость).
  3. Прогон: `node --test --test-isolation=none "tests/late-refusal-observability.test.mjs"` → `pass 3 / fail 0`.
- **Гейт (готово когда):** `pass 3 / fail 0`; в отчёте — `SELECT count(*) FROM audit_events` до/после (не изменился) и значение счётчика.
- **Evidence в отчёт:** вывод теста, SQL-счётчик audit, diff.
- **Риски:** «метрика» сейчас живёт в `product-telemetry`/`dsh-token-meter` (`00-RECON.md:158` п. 3) — точный канал выбирает `D16`; до решения счётчик остаётся внутренним и это названо в отчёте.

---

## 16. Группа N. Переименование workflow-домена (MW-044, `D03`/ADR020)

Источник: `00-RECON.md:188` (решение `D03`) и FINAL-REPORT §6 K4 (`:280`): «не регистрироваться в платформенный шов, переименовать домен (например, «execution pipeline»/«procedure») и записать границу в ADR, иначе через полгода это будет два «workflow» в одном профиле». Имя домена выбирает `decision-desk`; шаги ниже исполняют **любое** выбранное имя и не зависят от него.

#### E-50 · Переименование домена по решению `D03`
- **Карточка:** MW-044 · **Зависит от:** D03 · **Усилие:** M (2–3 ч) · **Риск:** средний (публичный словарь) · **Откат:** revert коммита
- **Цель:** в дереве не остаётся второго «workflow»; имена домена MyWork не пересекаются с платформенным `ctx.workflowEngine`.
- **Файлы:** Modify `packages/contracts/src/workflow.ts` (переименование в `<имя из D03>.ts`); Modify `packages/core/src/*` и `packages/planner/src/*` (импорты и типы); Modify `packages/contracts/src/index.ts`, `packages/core/src/index.ts`; Create `tests/procedure-naming.test.mjs`.
- **Шаги:**
  0. Шаг 0: подтвердить текущее состояние и число вхождений, подлежащих переименованию (числа фиксируются до правки).
     Команда: `(Get-ChildItem -Recurse packages -Filter *.ts -File | Where-Object { $_.FullName -notmatch '\\lib\\' } | Select-String -Pattern 'workflow|Workflow' -CaseSensitive).Count` → записать число; ожидаемо — единицы (файл `packages/contracts/src/workflow.ts` 143 строки и его потребители).
     **Условие остановки:** если среди совпадений есть регистрация в `ctx.workflowEngine`, шаг останавливается и вопрос уходит владельцу — это другой объём.
  1. Тест (падающий): четыре теста: (а) модуль домена называется по решению `D03` и экспортирует тип ревизии (бывший `WorkflowRevision`); (б) в исходниках `packages/**/src` не остаётся идентификатора `workflow`/`Workflow` вне комментариев, объясняющих границу; (в) публичный API (`index.ts` обоих пакетов) экспортирует новое имя; (г) `tests/plan-mutation.test.mjs` и `tests/guards.test.mjs` зелёные после переименования.
     Команда: `node --test --test-isolation=none "tests/procedure-naming.test.mjs"` → FAIL.
  2. Реализация: механическая замена имени + правка комментариев-заголовков модулей; версия контракта не меняется, потому что имя не является wire-форматом (если `D03` решит иначе — версия поднимается и это отдельный шаг).
  3. Сборка и прогон: `tsdown` по `contracts`, `core`, `planner` → `✔ Build complete` ×3; тест → `pass 4 / fail 0`.
- **Гейт (готово когда):** `pass 4 / fail 0`; в отчёте — число вхождений до/после и список переименованных файлов.
- **Evidence в отчёт:** вывод теста и сборки, два числа из шага 0 и после, `git diff --stat`, `git status --porcelain` (renames).
- **Риски:** (1) переименование в публичном словаре ломает `.work/architecture/**`-ссылки — архитектурные документы **не правятся**, расхождение называется в отчёте и уходит в `30-CARD-EDITS.md`; (2) `D03` не закрыт на момент исполнения — шаг не начинается (жёсткая зависимость).

#### E-51 · Тест-запрет: нет монтажа в `ctx.workflowEngine`
- **Карточка:** MW-044 · **Зависит от:** E-50 · **Усилие:** S (30–60 мин) · **Риск:** низкий · **Откат:** revert коммита
- **Цель:** граница с платформенным движком закреплена тестом, а не дисциплиной (урок boundary-теста, `B-orchestration.md:214`).
- **Файлы:** Modify `tests/boundaries.test.mjs` (новый тест рядом с `:496-508`); Create `tests/procedure-boundary.test.mjs`.
- **Шаги:**
  1. Тест (падающий): три теста: (а) ни один исходник `packages/**/src` не содержит `workflowEngine`; (б) ни один `cordis*.yml` в репозитории не монтирует платформенный движок; (в) собранный `packages/controller/lib/index.js` не содержит строки `workflowEngine`.
     Команда: `node --test --test-isolation=none "tests/procedure-boundary.test.mjs"` → FAIL (тест создан, проверка ещё не проходит по формулировке).
  2. Реализация: тест текстовый, по образцу сканера `tests/scheduler.test.mjs:935-944` (читает `src` и требует отсутствия подстроки); добавляется также в `tests/boundaries.test.mjs`, чтобы работал в общем прогоне.
  3. Прогон: `node --test --test-isolation=none "tests/procedure-boundary.test.mjs" "tests/boundaries.test.mjs"` → `fail 0`.
- **Гейт (готово когда):** оба файла зелёные, и в отчёте — вывод grep `workflowEngine` по репозиторию (0 совпадений вне теста).
- **Evidence в отчёт:** вывод тестов, grep-вывод, diff.
- **Риски:** тест текстовый и обходится строковой конкатенацией — это принято как достаточная мера (та же природа, что у существующих сканеров), и названо в отчёте.

---

## 16-bis. Группа O. Наблюдаемый статус хода в порту рантайма (MW-015, правка; `D14`)

Шаг добавлен по замечанию Lead'а (`evidence/lead-19-apis.md`, §1): доставка решения человека адресует **сессию**, а не попытку, и выбор режима (`steer`/`queue`) обязан делать MyWork по наблюдаемому статусу хода. Сегодня порт этого не отдаёт, поэтому шаг — **блокер** доставки в `E-24` и опора для **Q-17**.

#### E-52 · Наблюдаемый статус хода в порту рантайма и выбор режима доставки
- **Карточка:** MW-015 (правка), `D14` · **Зависит от:** E-08 · **Блокирует:** `E-24` (доставка ответа), `Q-17` · **Усилие:** M (2–3 ч) · **Риск:** средний · **Откат:** revert коммита
- **Цель:** MyWork наблюдает, открыт ли ход, и сам выбирает режим доставки — `steer` в открытый ход, `queue` в завершённый, — не угадывая и не полагаясь на платформенное поведение.
- **Файлы:** Modify `packages/controller/src/dsh-session.ts` (поле `status` у `DshAgent`; выбор режима в `#prompt`); Create `tests/runtime-delivery.test.mjs`.
- **Шаги:**
  0. Шаг 0: подтвердить четыре исходных факта.
     Команда: `Select-String -Path packages/controller/src/dsh-session.ts -Pattern "mode: 'queue'|readonly id" | Select-Object -First 6` → `:203` (`mode: 'queue' | 'steer'`), `:222-224` (`DshAgent` отдаёт только `session.id`).
     Команда: `Select-String -Path C:\Reposit\deepseek-harness\deepseek-harness\packages\api\session-controller\src\commands.ts -Pattern "mode === 'steer'|hasPromptRequest"` → `:364` (`steer`), `:330` (идемпотентность по `requestId`).
     Команда: `Select-String -Path C:\Reposit\deepseek-harness\deepseek-harness\packages\core\agent\src\runtime-types.ts -Pattern 'An idle driver|next step boundary'` → `:225-226` (idle → новый ход).
  1. Тест (падающий): шесть тестов: (а) `DshAgent.status` сообщает наблюдаемый статус хода; (б) при открытом ходе доставка идёт `mode: 'steer'`; (в) при завершённом — `mode: 'queue'`; (г) при неизвестном статусе — отказ `TURN_STATE_UNKNOWN`, а не «молча queue»; (д) повторный запрос с тем же `requestId` возвращает `accepted: true` и **не** доставляет второй раз (идемпотентность платформы, `commands.ts:330` — не изобретается заново); (е) `signal` у `prompt` отменяет только раунд-трип допуска: после отмены сообщение не доставлено, состояние сессии не испорчено, а уже доставленное сообщение отозвать нельзя (проверяется отсутствием такой операции в API).
     Команда: `node --test --test-isolation=none "tests/runtime-delivery.test.mjs"` → FAIL.
  2. Реализация: `status` берётся из наблюдаемого статуса агента платформы; режим выбирает `#prompt` по нему; `AgentRuntimePort` **не** расширяется (§17.4) — поле живёт в адаптере `DshAgent`, транспортом остаётся существующий `prompt(request, signal)`.
  3. Прогон: `node --test --test-isolation=none "tests/runtime-delivery.test.mjs"` → `pass 6 / fail 0`.
  4. Регрессия: `node --test --test-isolation=none "tests/runtime.test.mjs"` → без новых падений.
- **Гейт (готово когда):** `pass 6 / fail 0`; в отчёте — лог обоих режимов (`steer` в открытый ход, `queue` в закрытый), `accepted: true` на повторный `requestId` и отказ `TURN_STATE_UNKNOWN`.
- **Evidence в отчёт:** вывод теста, лог доставки в двух режимах, `requestId` повторного запроса, diff.
- **Риски:** (1) `steer` адресует **сессию**, а не попытку, и на idle открывает новый ход — поэтому «доставка в попытку» здесь означает «доставка в сессию попытки», а не создание нового attempt; (2) поле `status` — расширение **адаптера**, а не контракта порта: если владелец захочет видеть статус в контракте, это отдельное решение (сегодня `AgentRuntimePort` — ровно пять операций, §17.4); (3) живой прогон `mode: 'steer'` не наблюдался (`lead-19-apis.md`, «Не проверено» п. 1) — первый реальный прогон делается в рамках шага, его вывод идёт в evidence, а расхождение с платформенным поведением эскалируется, а не обходится.

---

## 17. Границы: что НЕ строим

Каждый пункт — не мнение, а следствие уже принятой authority-модели или подтверждённой находки. Если шаг из §3–§16 начинает требовать что-то из этого списка — шаг останавливается и уходит на решение владельцу, а не «достраивается по месту».

### 17.1. Coordination subsystem и peer mailbox — не строим

- Потребителя нет: сам отчёт называет mailbox «не prerequisite Board» (`B-orchestration.md:198`, §45), а `B §11` подтверждает отсутствие mailbox в MyWork (`:98`).
- Durability-примитив уже есть и не требует нового журнала: транзакционный `outbox` (`packages/storage/src/outbox.ts:2`) и `inbox_dedup` с `applyOnce(consumer, eventId)` (`packages/storage/src/inbox.ts:51-73`).
- Новый пакет добавил бы в основном **новую authority**, а fencing контроллера уже есть (`packages/lease/src/lease.ts:292-303`) — дублировать его в coordination-домене значит получить два источника истины (`B-orchestration.md:194`).
- **Что делаем вместо:** передача работы — `handoff` артефактом (`E-38`) классом `dependency-result`; ожидание — не блокирующее, а эскалация в `needs-attention` (`E-47`). Отдельно фиксируем: у DSH `wait_agent` возвращает `noProgress`, когда нет активного peer'а (`tool-agent-team/src/index.ts:252-274`, `B-orchestration.md:128`), поэтому «блокирующее ожидание до изменения» в MyWork не проектируется.

### 17.2. Вторая authority — не создаём (ни одна из четырёх форм)

| Соблазн | Почему нет | Что делаем вместо |
|---|---|---|
| Write-intent на `Task` | `Task` — чужая authority: TaskGraph владеет описанием, зависимостями, readiness и финальным завершением (`packages/contracts/src/taskgraph.ts:9-14`); `tests/authority.test.mjs:61` фиксирует «доска — проекция, а не конкурирующая authority» | `E-36`: тип только на `Attempt` |
| Состояние review в отдельной таблице как «второй статус задачи» | Состояние задачи живёт в графе; таблица `review_claim` (`E-19`) владеет **только** claim ревью | `E-19`, `E-22`: переходы задачи — через `graph.transition` |
| Provisioning как второй планировщик | Admission — один: планировщик передаёт admission в порт, claim делает сага (`packages/scheduler/src/service.ts:105-120`, `B-orchestration.md:62`) | `E-33`–`E-35`: провижининг — сага вокруг `start()`, без собственного admission |
| Прямой writer в `TaskGraph` из интегратора в обход `expectedRevision` | `tests/authority.test.mjs` + CAS-контракт графа | `E-28`: `graph.transition` с `expectedRevision` |

### 17.3. Event sourcing — не переписываем

- У MyWork **транзакция**, а не реплей-проекция: эквивалент «invariant companion» — валидация внутри той же транзакции (`packages/execution/src/store.ts:219-256` CAS `claim_intent`, уникальные индексы `packages/execution/src/schema.ts:88-115`), и это «и проще, и строже: отказ не требует не публиковать событие, потому что запись ещё не произошла» (`B-orchestration.md:230`, §68).
- Whole-snapshot события DSH не переносятся; вывод §68 — «только локально» (`00-RECON.md:237`, строка §68).
- Журнал шагов claim-саги и `provisioning_step` (`E-34`) — это **журнал шагов саги**, а не event store: из него не восстанавливается состояние реплеем.

### 17.4. `AgentRuntimePort` не заменяем и не расширяем

- Порт — ровно пять операций `start/resume/status/stop/events` (`packages/contracts/src/agent-runtime.ts:223-258`), `stop` неразрушающий («the session record survives as evidence», `:245-250`), conformance-кит — `packages/adapter-sdk/src/conformance.ts:419-438`.
- Замена потребовала бы переписать `tests/runtime.test.mjs` (643 строки) и кит (`B-orchestration.md:224`).
- **Следствие для этого файла:** ограничение поверхности (`E-39`) реализуется **не** полем порта (в `AgentRunScope` его нет, `packages/contracts/src/agent-runtime.ts:52-64`) и не в «порту рантайма» вообще — метода `restrict` в контрактах MyWork нет; он применяется платформенным `agentCtx.tools.restrict({ allow })` + scoped `guard` из `packages/controller`, а MyWork отказывается запускать попытку без подтверждённого фильтра.
- **Опровержение пути:** файла `packages/execution/src/agent-runtime.ts` **не существует** (`evidence/lead-19-apis.md`, §3 «Опровержения» п. 1; в `packages/execution/src/` только `errors/index/schema/service/store.ts`). Контракт scope — `packages/contracts/src/agent-runtime.ts`. Аналогично не существует `packages/scheduler/src/scheduler.ts` (гейт бюджета живёт в `packages/core/src/scheduler.ts:568`, тот же файл-опровержение, п. 2) — на этот файл в 21-… ссылок нет, но при чтении соседних файлов плана это стоит проверить.

### 17.5. TeamTask не становится canonical Task; `TeamId` ≠ `SessionId`

- `TeamTask` — 4 состояния против 16 (`contracts/src/task.ts:11-63`), `TeamId` — root `SessionId` (`agent-team/src/types.ts:15-17`), system of record — лог Lead (`B-orchestration.md:68`, §8.1).
- Переносим **эргономику** (CAS + DAG), не сущность (`00-RECON.md:232`, §13).
- **Следствие:** `E-07`–`E-12` работают с `TaskGraphPort`, а не с Team-доской; `E-24` не наследует 4-состоянийный lifecycle.

### 17.6. Не регистрируемся в `ctx.workflowEngine`

- Платформа допускает **один** движок на контекст; MyWork-движок — декларативный и валидируемый, без escape hatch (`00-RECON.md:157`, `:188`; FINAL-REPORT §6 K4, `:280`).
- Исполнение — `E-50` (переименование по `D03`) и `E-51` (тест-запрет на `workflowEngine`).

### 17.7. Прочее, что не строим в этом файле

| Не строим | Почему | Где это живёт |
|---|---|---|
| Второй учёт токенов/стоимости | `dsh-token-meter` даёт **некумулятивный** снимок текущего давления запроса (`packages/llm/token-meter/src/index.ts:146,158-171,187`); в MyWork уже есть `tokenCount`/`BudgetConsumption`, и накопление положительных дельт — на стороне `F-51`/`F-52` | `D05`, `23-STEPS-quality.md` |
| Собственный слой прав роли | платформенное ограничение режима и пути (`sandbox-policy`, `fs-observation-policy`) действительно есть, но **платформенной гарантии** «выше дефолта сессии нельзя без человека» нет: `sessionDefaultPermission` — понятие **доски** (в DSH во всём `packages/**` 0 совпадений), а платформенный гейт — per-call эскалация `sandbox_permissions` с одобрением (дельта §2.2 D11); прежняя запись «платформа уже умеет» **снята как неверная** | `E-41` использует платформенное ограничение; гейт «выше дефолта» остаётся за доской |
| Детектор залипания на LLM | «Detector не расходует LLM в цикле» — приёмка `MW-031.md:20` | `E-47` (чистая функция) |
| Процедура разрешения конфликта автоматически (`--force`/`--ours`) | приёмка `MW-025` требует human decision при семантическом конфликте | `E-29` |
| Правка архитектурных документов при переименовании | `.work/architecture/**` — чужой write-scope | `E-50` называет расхождение, `30-CARD-EDITS.md` фиксирует |
| Новая карточка на mailbox/coordination | `B §45`: «строить не нужно» | — |
| Замена/расширение `AgentRuntimePort` под tool-allow-list | см. §17.4 | `E-39` через scoped restrict |

---

## 18. Не проверено / открытые проверки

1. **ID шагов `F-…` не зафиксированы.** `20-STEPS-foundation.md` на момент написания отсутствует (в `.work/plan-v0.3/` только `00-RECON.md`). Ссылки вида `F(composition root)`, `F(единый реестр миграций)` — по теме; сверить номера, когда `plan-foundation` создаст файл, и при расхождении поправить §1.4 и строки «Зависит от».
2. **ID шагов `Q-…` получены сообщением, но файла `23-STEPS-quality.md` ещё нет** — проверить, что `Q-17`, `Q-19`–`Q-23`, `Q-34`–`Q-38` действительно означают то, что указано в §1.4 (получено от `plan-quality` 2026-09-26).
3. **Команда снятия дампа разрешённой композиции живого профиля не проверена.** Гейт `E-39` опирается на файл пресета; проверка **собранной** композиции требует команды платформы, которой я не проверял (в отчёте `B` та же оговорка, `B-orchestration.md:395` п. 1). Кто и как проверит: владелец/`plan-surface` через `plugin_manager list_plugins` или дамп композиции — действие требует расширенных прав.
4. **Доступен ли `agent.ctx` (scoped-контекст) для сессий, которые стартует MyWork** — **отвечено** (`evidence/execution-07.md`): окно `setup` (`core/agent/src/index.ts:100-118`, `ResumeAgentOptions.setup:134-143`) вызывается после минта agent-ctx и до `session/created`/`agent/created`/первой сборки промпта; `restrict()` назван там явно, а у continuable-ребёнка тот же приём уже применён (`subagent/subagent/src/child-agent.ts:218`). Остаётся непроверенным: доступно ли `setup` **именно** через MyWork-адаптер `packages/controller/src/dsh-session.ts` (сегодня адаптер объявляет `scopedTools: true` на `:93`, но нигде не вызывает `restrict`), и сохраняется ли ограничение при HMR-перезагрузке плагина. Если доступ недоступен — `E-39` обязан быть fail-closed и вопрос эскалируется владельцу.
5. **Точные имена инструментов динамического раннера** (`cordis-host-runner`) в `src` отсутствуют — литералов нет, имена приходят из генератора. `E-39` поэтому использует **allowlist** (`restrict({ allow: WORKER_TOOLS })`), а не список запретов: разрешённые шесть имён известны и стабильны, а неизвестное будущее имя отсекается allowlist'ом и монотонным scoped `guard`'ом; denylist был бы fail-open (`core/tools/src/index.ts:1114-1118`, `:1202-1208`).
6. **Baseline полного прогона не воспроизводился.** Число `659 tests / 636 pass / 0 fail / 23 skipped` взято из `.work/reports/MW-019-external-memory.md:9`, а не из прогона в этой кампании; полный прогон по правилу `00-RECON.md:216` делает Lead один раз. Все гейты этого файла поэтому узкие (по файлу теста).
7. **§49 архитектуры не читался целиком.** Восемь reconcile-сценариев `E-46` взяты из объёма карточки `MW-031.md:17`; если в §49 есть строки сверх восьми, они добавляются тестом, а не пропускаются.
8. **Поведение `git worktree` на этой Windows-машине не проверялось.** `E-03` начинается с пробы `git --version` и предусматривает резолв абсолютного пути `git.exe` (урок `bd`: `00-RECON.md:162`).
9. **Носитель `NeedsAttention` ещё не реализован** (`contracts/src/board.ts:356-372` — только словарь причин; «`NeedsAttentionReason` без носителя» назван дефектом, `00-RECON.md:178` п. 11). `E-31`/`E-47`/`E-48` записывают причину и переход в `needs-attention`, но отображение — карточка доски (`22-STEPS-surface.md`).
10. **Значения по умолчанию, которые я выбрал сам и которые обязан утвердить владелец:** `maxReviewLoops = 3` (`E-24`), `stallAfterMs = 30 * 60 * 1000` (`E-47`, заимствовано из практики стороннего плагина доски, `B-orchestration.md:387`, N-15), `retentionMs = 7 дней` (`E-06`). Все три помечены как «до `D05`/`D17`».
11. **`Refs: mw-<hash>` и отказ от git-хуков Beads** — требование взято из текста карточки (`MW-025.md:20`); кодом оно не проверялось (хуки в этом воркспейсе не ставились).
12. **Стоимость (токены/деньги) не измерялась** — ни одного платного вызова в кампании; оценки усилий/рисков — проектные, не измеренные.
13. **Тесты, которые будут созданы этими шагами, не запускались** — ни один из `tests/*.test.mjs` из §3–§16 не существует; ожидаемые числа `pass N / fail 0` заданы конструкцией шага (в шаге создаётся ровно N тестов), а не прогоном.
14. **Проверка «два контроллера на одном файле» end-to-end** через композицию scheduler→admission не воспроизводилась никем, включая автора анализа (`B-orchestration.md:402` п. 8); `E-42`/`E-43`/`E-44` её добавляют, но их гейты тоже ещё не прогонялись.
15. **Живой `steer` и наблюдаемый статус хода не проверялись** (`evidence/lead-19-apis.md`, «Не проверено» п. 1 и 4): поведение `prompt(mode:'steer')` на реальной сессии не наблюдалось, а GUI-путь доставки (`client/ui-conversation`, `sendSession`) не читался. `E-52` добавляет поле статуса и тест на два режима, но первый реальный прогон состоится только при исполнении шага — до него «открыт/закрыт ход» остаётся проектным допущением, а не измеренным фактом.
16. **Правки по `evidence/lead-19-apis.md` внесены 2026-09-27** (три замечания Lead'а): `E-39` переведён с denylist на **allowlist** (`restrict({ allow })` + scoped `guard`, негативный тест на инструмент вне списка); добавлен шаг `E-52` (наблюдаемый статус хода и выбор режима доставки) как блокер доставки в `E-24`; в `E-24` уточнена механика (`steer` адресует сессию, idle открывает новый ход, `AbortSignal` только на раунд-трип допуска, идемпотентность по `requestId`). Дополнительно зафиксированы два опровержения путей: `packages/execution/src/agent-runtime.ts` и `packages/scheduler/src/scheduler.ts` в MyWork **не существуют** (§17.4).
17. **Правки по red-team (R-04, R-06, R-07) внесены 2026-09-27:** все шаги переведены на **единый аллокатор версий** (D08, §1.6) — литералов `version: N` в файле нет, тесты читают ожидаемый набор версий из аллокатора; §1.5 согласован с каноном `01-MASTER-PLAN.md` §15.1 (`corepack pnpm -r run <script>` с обязательным `-r`, точечные `node --test --test-isolation=none <файл>`, `node_modules\.bin\tsc.cmd -p <tsconfig>`, `node <tsdown-entry>`) — противоречия с файлом 20 больше нет; гейт `E-01` переписан на регулярку **без** `-SimpleMatch` и получил позитивный контроль.
18. **Аллокатора версий в `20-STEPS-foundation.md` пока нет** (grep «аллокатор» по файлу на 2026-09-27 → 0 совпадений; в мастер-плане §15.3 он предписан как D08, дефект R-04 отправлен `plan-foundation`). Пока его нет, `E-04`, `E-19`, `E-28`, `E-34`, `E-37` **блокированы**: шаг не имеет права выбрать номер сам. Уточнить ID шага-аллокатора, когда `plan-foundation` его добавит.
19. **Правки по верификации B внесены 2026-09-27:** (а) R-22 — формулировки «`auto-review` только deny» заменены на «**активен** (`enabled: true`, `fiberPhase: active`), deny-only режима нет; «автоматика не одобряет» — правило MyWork» в §1.4, §2 (индекс), §12 (интро), `E-40` (шаг-ссылка на `F-57`/`Q-38`); (б) `E-39` помечен шагом-ссылкой на `F-56` (дедупликация R-14), свой фильтр не вводится; (в) канон тестов: все командные вхождения `node --test` в файле — с `--test-isolation=none` (измерено: 128 из 128 команд; два прозаических упоминания в §18 исправлены); (г) сборка перед тестами добавлена явным «Предусловие сборки» в `E-20`, `E-21`, `E-23`, `E-24`, `E-25`, `E-26`, `E-27`, `E-28`, `E-29`; (д) несуществующие сущности заменены или сделаны явными: `runtime.prompt` → промпт внутри `AgentStartRequest` (`E-08`); `INTEGRATION_NOT_APPROVED` → существующий `TASK_CONFLICT` (`E-25`); `STALE_APPROVAL` → **явно создаётся** в `E-23` (аддитивно в `MYWORK_ERROR_CODES` + тест на рост словаря); `review-loop-exhausted` → существующий `retry-budget-exhausted` (`E-24`), а исчерпание попыток — `budget-exhausted` (`E-48`); `attempt-stalled` → **явно создаётся** в `E-47` (аддитивно в `NEEDS_ATTENTION_REASONS` + тест); `GitPort` → **вводится** в `E-26` (`packages/contracts/src/git.ts`); `readOpenHold` → метод фасада `openHold` (`packages/planner/src/store.ts:596`); `ReconcileReport.stalls` → поле **не вводится** (`Е-46`); якорь `layout.ts:66-68` → `:76-84`/`:91-93`; `packages/controller/src/doctor.ts` и код `GATE_ALREADY_ANSWERED` в этом файле **не встречаются** (0 совпадений — они принадлежат другим файлам плана).
20. **Блокеры исполнения из верификации B закрыты:** (а) `E-04` — асинхронный `worktrees.prepare` вынесен **между двумя синхронными транзакциями** (`store.transaction` синхронна: `packages/storage/src/store.ts:59`, асинхронное тело отвергается на `:173`, вложенность — на `:155`), добавлен тест на прерывание между транзакциями и отрицательный контроль синхронности (гейт — `pass 7 / fail 0`); (б) цикл карточек `MW-023 ↔ MW-024` разорван: `E-17` больше не зависит от `E-19`, проверка вынесена в `packages/execution/src/gates-admission.ts`, а `E-19` её вызывает (Один writer; граф карточек правит `card-ledger`).

### 18.1. Как собирались доказательства (правило §6 брифа)

Правило `00-RECON.md:222-230` (≥5 субагентов на участника) **выполнено через инструмент `workflow`**: `subagent` с моего уровня недоступен (`Error: subagent depth 2 exceeds maxDepth 1`), поэтому факты собраны шестью параллельными агентами `workflow` (job `execution-facts`) и тремя дополнительными (job `surface-facts`). Каждый агент писал отчёт в `.work/plan-v0.3/evidence/execution-0N.md` и возвращал выжимку ≤40 строк с `файл:строка`. Решения агентам не отдавались — только вопросы-факты.

| Файл | Тема | Автор |
|---|---|---|
| `evidence/execution-01.md` | инвентарь `packages/execution/src`: файлы, экспорты, порты, отсутствие понятий, тесты, потребители | агент 1 (workflow) |
| `evidence/execution-02.md` | claim-сага, fences/epoch, heartbeat/истечение lease, таблицы SQLite, тесты | агент 2 |
| `evidence/execution-03.md` | tick планировщика, фазовые потолки (кто исполняет), тесты и сканер | агент 3 |
| `evidence/execution-04.md` | Agent Teams: `roster.ts:259`, 5 шагов provisioning, mailbox, `maxMembers`, teardown, **отсутствие** recovery-матрицы | агент 4 |
| `evidence/execution-05.md` | `AgentRuntimePort`/scope, поверхность инструментов, `sandbox-policy`, `fs-observation-policy`, `auto-review` | агент 5 |
| `evidence/execution-06.md` | структура `.work/reports/*-review.md`, требования карточек, зависимости MW-021…MW-031, `tasks.json` | агент 6 |
| `evidence/execution-07.md` | scoped `agent.ctx`/`tools.restrict`/`guard`: реальные вызовы, наследование, монотонность | агент 7 (workflow `surface-facts`) |
| `evidence/execution-08.md` | доставка решения в живую попытку: `steer`, outbox/inbox | агент 8 |
| `evidence/execution-09.md` | `toolSurface` в контексте, `verify-profile.mjs`, тесты пресетов | агент 9 |

**Что изменили агенты 7–9 в этом файле (правки внесены, а не просто приложены):** `E-39` переписан с «пресет + фильтр MyWork» на трёхслойную схему с платформенным `tools.restrict`/`guard` в окне `setup` (агент 7: `subagent/subagent/src/child-agent.ts:218`, `core/agent/src/index.ts:100-118`, `ResumeAgentOptions.setup:134-143`); в `E-11` добавлено обязательное повторное применение ограничения при resume (агент 7: `core/tools/src/index.ts:736` — restriction процесс-локальна); в `E-24` зафиксировано, что доставки в живую попытку сегодня нет (агент 8: `packages/controller/src/dsh-session.ts:203`, `:636`, `:640`); в `E-39` (риск 2) снята неверная опора на `verify-profile.mjs` как на доказательство состава инструментов (агент 9: `scripts/verify-profile.mjs:170-241` — 8 проверок упаковки, инструменты не проверяются) и добавлен факт, что `context.toolSurface` — описание для аудита, а не источник (агент 9: `packages/contracts/src/context.ts:805`; писатели только в тестах). Пункт §18.4 переведён из «не проверено» в «отвечено» с остатком неизвестного.

**Проверено лично** (первый источник, не по пересказу агентов): `git HEAD` и состояние дерева; список файлов `packages/execution/src`, `packages/contracts/src`, `tests/*.test.mjs`; `packages/execution/src/{index,errors}.ts` целиком и `service.ts` по grep (`:166` `STEP_ORDER`, `:413` `STALE_FENCE`); `packages/lease/src/{index,lifecycle}.ts`; `packages/contracts/src/{attempt,review,artifact,agent-runtime,task,scheduler,budget}.ts` в указанных фрагментах; `packages/controller/src/index.ts` целиком; `tests/boundaries.test.mjs:478-517`; `.work/reports/MW-012-attempt-saga.md:185-254`; `B-orchestration.md` §3–§5 по якорям; `C:\Reposit\deepseek-harness\deepseek-harness\packages\core\tools\src\index.ts:1088-1147` и `packages\experimental\auto-review\src\index.ts:636-665`, `:698-715`.

---

## 19. Сводка

- **52 шага** (`E-01`…`E-52`) на 8 карточках конвейера (`MW-021`…`MW-026`, `MW-028`, `MW-031`), 5 новых карточках из резерва (`MW-065`–`MW-069`) и 3 правках существующих (`MW-007`/`MW-015` — права роли и наблюдаемый статус хода `E-52`, `MW-044` — имя домена).
- **Критический путь:** `E-01 → E-04 → E-07 → E-08 → E-13 → E-14 → E-16 → E-17 → E-19 → E-22 → E-23 → E-25 → E-28 → E-42 → E-46`.
- **Ни одного шага вида «реализовать worker»:** каждый шаг — один тест-файл, один гейт и один откат; шаги, зависящие от непроверенного API/файла, начинаются с «Шаг 0» и точной команды.
- **Пять кросс-тем переноса из Agent Teams закрыты шагами:** provisioning saga с pre-minted identity — `E-33`–`E-35`; write-intent на `Attempt` — `E-36`–`E-37`; handoff artifact — `E-38`; ограничения worker-поверхности — `E-39`–`E-40`; права роли через платформенный runtime-enforcement — `E-41`. Переименование workflow-домена — `E-50`–`E-51`. MW-045 (work types/finish criteria) — **не дублируется**, ведёт `plan-quality` (`Q-20`–`Q-23`).
- **Оговорка по Agent Teams (дельта 0.2.0-rc.2, §2.2 D7):** контракты Teams **не менялись** (`packages/experimental/agent-team/src/index.ts:78,131-230`; `agent-team`/`tool-agent-team` — только version bump), а `teamRun` — фича **доски**, не платформы (в `packages/**/src` DSH — 0 совпадений) и она **не соблюдает пин прав подзадачи** (`…task-board\lib\types\core\tasks.d.ts:216-224`); `maxSubtaskDepth` живого профиля = **1**. Ни один шаг этого файла не опирается на дерево подзадач и не использует `teamRun` (0 совпадений) — переносы `D13` здесь идут через `E-33`–`E-41`, а не через каскад доски.
- **Что нужно от других участников до старта исполнения:** `D03` (имя домена — блокирует `E-50`), `D05` (значения `maxReviewLoops`/`stallAfterMs`), `D11` (форма часов), `D13` (утверждение списка переносов), `D14` (`HumanDecision`), `D15` (список запрещённых инструментов), `D17` (окно retention); `F(composition root)` и `F(единый реестр миграций)` — блокируют `E-08`, `E-42`; `plan-surface` — носитель `NeedsAttention` для `E-47`.

