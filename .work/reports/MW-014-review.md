# MW-014 — независимое ревью: детерминированный Scheduler и pools

- Карточка: `.work/tasks/MW-014.md` (Board ID `fcffc0c3-f0df-42db-a07a-128fa9fd5dd5`)
- Ревьюируемый отчёт: `.work/reports/MW-014-scheduler.md`
- Base SHA = Head SHA = `3bc6c78a077174a9497488ed137082294b705a34`; работа лежит в рабочем дереве (`git status --short` на входе и на выходе совпадает с перечнем карточки)
- Режим: **review** (read-only). Живое дерево не изменено: все мутации вносились только в копии `.tmp/mw014-review/`, оригиналы восстановлены и сверены по SHA256 (§2)
- Ревьюер не является автором работы; отчёт читался как набор утверждений, каждое из которых проверялось на опровержение

---

## 1. Вердикт

**PASS WITH FINDINGS** — реализация в целом соответствует объёму и всем пяти пунктам приёмки по исходникам, но два требования приёмки держатся не так, как заявлено: `maxHeavyTools` (§15) доказуемо превышается внутри одного тика (MAJOR), а §31-гейт в планировщике вырожден — проверка «workspace/security» eligibility не может отказать (MAJOR); плюс один тест из mutation-таблицы отчёта (M6) не ловится ни одним тестом набора.

---

## 2. Проверенные команды

| Команда | Exit | Наблюдение |
|---|---|---|
| `git rev-parse HEAD` | 0 | `3bc6c78a077174a9497488ed137082294b705a34` — base SHA = head SHA, коммитов нет |
| `git status --short` (вход и выход) | 0 | 10 изменённых + 4 новых пути; **ровно** перечень карточки, незаявленных правок нет, чужие файлы не тронуты |
| `git diff --stat` | 0 | `packages/contracts/src/config.ts +8`, `index.ts +1`, `model-catalog.ts +31`, `packages/core/src/config.ts +42/−0`, `index.ts +17/−2`, `routing.ts +5/−29`, `pnpm-lock.yaml +9`, `tests/config.test.mjs +49`, `tests/lib/fixtures.mjs +4`, `tsconfig.base.json +1` — совпадает с §3 отчёта строка в строку |
| `pnpm run check` | **0** | `tests 471 / pass 448 / fail 0 / skipped 23` — **совпадает с итогом отчёта**. typecheck всех 11 workspace-пакетов (у каждого есть скрипт `typecheck`), build, smoke — зелёные |
| `node --test --test-isolation=none tests/scheduler.test.mjs` | 0 | `tests 26 / pass 26 / fail 0 / skipped 0` — 26 тестов планировщика подтверждены |
| `pnpm install --frozen-lockfile --lockfile-only` | 0 | lockfile согласован (проверено косвенно через `pnpm run check`, падающий при рассинхроне) |
| `Get-FileHash packages/core/lib/index.js, packages/scheduler/lib/index.js` | 0 | `B8795855…C44AE7` и `84D7F8F3…98F63` — **оба совпадают** с SHA256 §6.7 отчёта до и после моих мутаций |
| 6 × `node --test --test-isolation=none tests/scheduler.test.mjs` с мутациями M1–M4, M7, M8 в копии собранного `core/lib/index.js` (`.tmp/mw014-review/mutate3.ps1`) | 1 (все 6) | все шесть ловятся ожидаемыми тестами; **артефакты восстановлены, SHA256 совпал** |
| 4 × то же с M5, M9, M6 (`.tmp/mw014-review/mutate.ps1`, `mutate2.ps1`) | 1 / 1 / **0** | M5 ловится, M9 ловится, **M6 не ловится ничем** — расхождение с отчётом, см. §3 F3 |
| `node .tmp/mw014-review/probe-m6.mjs` (два тика вместо одного) | 0 | без мутации: 2-й тик даёт `agingMs = 2100000` (чтение порта победило); с мутацией M6: `agingMs = 600000` (победило чтение runtime) — проба различает обе ветви |
| `node .tmp/mw014-review/probe-fairness.mjs` | 0 | контроль P7c/P7d: оба workspace обслуживаются, когда у каждого есть своя identity — проба валидна |
| `node .tmp/mw014-review/probe-security.mjs` | 0 | `permission-missing` → `security-denied` (ветка достижима); `foreign-workspace` → **admission выдан**, отказа нет |
| `node .tmp/mw014-review/probe-gate.mjs` | 0 | `authorizeOperation` проходит для `workspaceOverlays: ['W-2']` и при `operation.workspaceId = 'W-1'`, потому что `grant.workspaceId` берётся из операции |
| `node .tmp/mw014-review/probe-f3.mjs` и `probe-f3b.mjs` | 0 | **опровержение** гипотезы «отказ одного workspace останавливает соседей»: S1/R1/R2/R5 — соседний workspace обслуживается независимо от того, идёт он первым или последним, и от того, отказывает ли брат по role-mismatch. Ложный след, в findings не попал (см. §7) |

### 2.1 Про искажение SHA256 после `pnpm run check`

Первый замер `Test-Path packages/core/lib/index.js` дал `False` — это гонка с моим же фоновым `pnpm run check` (build писал артефакты в тот момент). После завершения build оба артефакта существуют, их SHA256 **точно** совпадают с §6.7 отчёта, и повторная сверка после всех мутаций дала те же значения. Утверждение «артефакты восстановлены по SHA256» **воспроизведено**.

---

## 3. Findings

### F1 — MAJOR: один тик выдаёт больше admission'ов, чем позволяет §15 `maxHeavyTools`

- **Файл:** `packages/core/src/scheduler.ts:275-281` (тип `PlannedCharge`), `:588` (проверка `heavy-tool-limit`), `:598-617` (`admit`)
- **Что не так:** `PlannedCharge` ведёт `attempts`, `llm`, `pools`, `roles`, `workspaces` — но **не** `heavyTools`. Проверка потолка читает только наблюдённое значение и не учитывает уже выданные самим тиком admission'ы:

  ```ts
  if (occupancy.heavyTools >= tick.limits.maxHeavyTools) return 'heavy-tool-limit'
  ```

  Тогда как соседние две строки (`:586`, `:587`) читают `occupancy.X + planned.X`. В собранном `core/lib/index.js` присутствуют ровно два поля: `planned.attempts` и `planned.llm`.
- **Доказательство (команда):** `.tmp/mw014-review/probe-fairness.mjs` / `.tmp/mw014-review-probe.mjs`, P1:

  ```text
  heavyTools(observed)=1  maxHeavyTools=2  admissions=2 [T-1,T-2]  reasons=[]
  ```

  Один тяжёлый инструмент уже работает, потолок `2`, и тик всё равно выдаёт **два** admission'а. Итоговое число одновременных тяжёлых инструментов = 3 при заявленном потолке 2. Второй вызов не деградирует: следующий тик увидит уже 3 `tool-active` и остановится, то есть превышение **устойчиво**, а не транзитно.
- **Почему это важно:** это прямое опровержение пункта приёмки «concurrency не превышает caps» — не в широком смысле, а буквально, воспроизводимо, на трёх строках. Решение D3 отчёта (§4) заявляет, что admission резервирует attempt- и LLM-слот, и что насыщенный heavy-tool потолок останавливает новые admission'ы: вторая половина верна только для **наблюдённого** насыщения, первая половина про heavy tools просто не реализована. `maxHeavyTools` — единственный из трёх §15-потолков без собственного резервирования.
- **Минимальная правка:** добавить `heavyTools: number` в `PlannedCharge`, инкрементировать в `admit()` рядом с `planned.attempts += 1`, и читать `occupancy.heavyTools + planned.heavyTools >= tick.limits.maxHeavyTools`. Консервативное чтение (каждый admission считается тяжёлым инструментом) согласовано с уже принятым для LLM: `planned.llm += 1` тоже ставится на каждый admission, потому что планировщик не знает, будет ли вызов модели.

---

### F2 — MAJOR: §31-гейт в планировщике вырожден — привязка identity к workspace не проверяется

- **Файл:** `packages/core/src/scheduler.ts:496-510` (аргументы `authorizeOperation` в `agentVerdict`)
- **Что не так:** планировщик передаёт в гейт `workspaceId: workspace.workspaceId`, то есть **workspace самой операции**. Гейт (`packages/core/src/security.ts:112`) сравнивает это же значение с `operation.workspaceId`, которое планировщик формирует из того же `workspace.workspaceId`:

  ```ts
  workspaceId: workspace.workspaceId,          // grant
  ...
  { domain: 'task', action: 'transition', workspaceId: workspace.workspaceId }   // operation
  ```

  `AuthorizationContext` — закрытая форма (`security.ts:459`) и не несёт `identity.workspaceOverlays`, поэтому правило «агент не может трогать workspace, к которому не привязан» (§52, тест `security.test.mjs:139`) в планировщике сработать не может **никогда**: проверка тавтологична по построению.
- **Доказательство (команды):**
  - `.tmp/mw014-review/probe-gate.mjs` → `authorizeOperation` возвращает `ok: true` и для `workspaceId='W-2'`, и для `workspaceId='W-1'` при `workspaceOverlays: ['W-2']`;
  - `.tmp/mw014-review/probe-security.mjs` → кейс `foreign-workspace: identity is bound to another workspace` даёт `admissions=1, reasons=[]`;
  - `.tmp/mw014-review/probe-fairness.mjs`, P7a → identity `Neo-2` с `workspaceOverlays: ['W-2']` получает admission в `W-1`.
  - Для контраста: `permission-missing` действительно даёт `security-denied`, то есть ветка отказа не мертва — мертво именно workspace-измерение.
- **Почему это важно:** §16.3 (строка 880) называет `security policy` отдельным фильтром кандидатов, а объём карточки — «eligibility по role/capability/**workspace**/security/…». Сейчас `SchedulerAgent` не даёт планировщику никакого способа узнать, к каким workspace identity привязана: caller передаёт список идентичностей, и любая из них «привязана» к любому workspace, который тик в этот момент рассматривает. Док-комментарий `scheduler.ts:493-495` («the gate decides whether this grant may perform the operation, **in this workspace**») описывает гарантию, которой нет. Реальный риск — кросс-workspace назначение: identity, смонтированная в `W-1`, будет допущена к работе `W-2`, а отказ «вернуться» сможет только downstream-код, не планировщик.
- **Минимальная правка:** передавать в гейт привязку агента, а не целевой workspace — например `workspaceId: boundWorkspaceOf(candidate, workspace)`, где привязка читается из `identity.workspaceOverlays` (по аналогии с тем, как MW-009 строит grant при регистрации), и оставлять `operation.workspaceId` целевым. Если такой привязки в контракте нет намеренно, это надо зафиксировать явно: убрать §31-притязание из док-комментария, назвать его в §7 отчёта как принятое ограничение и не считать «security»-eligibility проверенной.

---

### F3 — MINOR: тест «a queue reading the state port states wins over the runtime's own» не может упасть

- **Файл:** `tests/scheduler.test.mjs:899-913`; расхождение — в таблице §6.7 отчёта, строка **M6**
- **Что не так:** тест делает **один** тик на **свежем** планировщике. В этот момент `this.queue` пуст, поэтому обе ветви `queueReading` — `stated ?? queue ?? nowMs` и `queue ?? stated ?? nowMs` — возвращают одно и то же `stated`, и `agingMs` совпадает. Названная в имени теста асимметрия (`stated` побеждает **собственное** чтение runtime) не исполняется ни разу.
- **Доказательство (команды):**
  - Мутация M6 в собранном `packages/scheduler/lib/index.js` (`const reading = this.queue.get(key) ?? stated ?? nowMs;`) → `node --test --test-isolation=none tests/scheduler.test.mjs` → **exit 0, 0 упавших тестов**;
  - та же мутация + проба на два тика (`.tmp/mw014-review/probe-m6.mjs`, где runtime сначала заводит своё чтение, а затем порт сообщает другое): без мутации `agingMs = 2100000`, с мутацией `agingMs = 600000` — **проба различает ветви, а тест набора — нет**;
  - в отчёте §6.7 для M6 заявлено «1 fail ✔» — не воспроизводится.
- **Почему это важно:** это ровно тот класс дефекта, который автор нашёл сам в M5 (§6.7 «побочная находка»): тест, чьё имя обещает проверку, которой нет. Заявленная граница приоритетов (`порт > собственное чтение runtime`) остаётся **непокрытой** — если кто-то перевернёт `??`-цепочку, набор останется зелёным, а aging начнёт считаться от собственного чтения runtime, а не от фактического `readySince` задачи. Заодно неверна таблица mutation-check: из девяти мутаций одна не ловится.
- **Минимальная правка:** расширить тест до двух тиков: сначала тик без `readySince` (runtime заводит чтение в `NOW`), затем `clock.advance(2 * AGING_STEP)` и тик с `readySince = NOW - 5 * AGING_STEP`; ассертить `agingMs === 5 * AGING_STEP`. И поправить строку M6 в §6.7 отчёта.

---

### F4 — MINOR: насыщенный `maxHeavyTools` блокирует и работу, не являющуюся тяжёлым инструментом

- **Файл:** `packages/core/src/scheduler.ts:588`
- **Что не так:** проверка `heavy-tool-limit` стоит в `capacityRefusal` безотносительно к kind и природе работы, поэтому при насыщенном потолке §15 не выдаётся ни один admission — включая review-admission'ы, которые тяжёлых инструментов не запускают.
- **Доказательство (команда):** `.tmp/mw014-review-probe.mjs`, P4 — один `tool-active` при `maxHeavyTools: 2`, готовое ревью:

  ```text
  P4 review admission under a saturated heavy-tool ceiling: admissions=0 reasons=[heavy-tool-limit]
  ```

  (P2/P3 показывают, что при полном насыщении и при `maxHeavyTools: 0` отказ срабатывает — это ожидаемо и верно.)
- **Почему это важно:** это осознанное решение D3, и оно названо в §4 отчёта, поэтому severity низкая. Но владельцу стоит знать цену: §27-пул ревьюеров останавливается чужой нагрузкой, и один насыщенный тяжёлый инструмент делает review-очередь необслуживаемой в течение всего тика. Данные, нужные для точной проверки, в `SchedulerTickInput` есть — `SchedulerTaskCandidate` несёт сам `task`, — но признака «эта работа запустит тяжёлый инструмент» в домене нет. Если D3 сохраняется, её стоит назвать в §7 отчёта как ограничение доступности, а не только как решение о границе.
- **Минимальная правка:** либо оставить как принятое решение и записать ограничение в §7, либо считать heavy-tool-потолок насыщенным только для `kind === 'worker'`, оставив review-admission'ы свободными.

---

### F5 — NIT: `security.test.mjs:139` остаётся зелёным при вырожденном гейте планировщика

- **Файл:** `tests/security.test.mjs:139-143` в связке с F2
- **Что не так:** тест §52-правила строит grant с `workspaceId`, отличным от `operation.workspaceId`, и получает `foreign-workspace`. Это доказывает правило в `authorizeOperation`, но не то, что им пользуется вызывающий: планировщик передаёт одно и то же значение в оба места. Тест набора не может поймать F2, потому что проверяет гейт, а не его потребителя.
- **Почему это важно:** это объясняет, почему F2 не был замечен ни автором, ни mutation-check: M7 («§31-гейт перестал отказывать») ловит тесты `eligibility…` и `reviewers have their own pool…`, но обе они проверяют только `permission-missing`/`self-approval`-пути. Workspace-измерение не покрыто ни одним тестом планировщика.
- **Минимальная правка:** после исправления F2 добавить в `tests/scheduler.test.mjs` кейс «identity, привязанная к другому workspace, к работе не допускается» с ожидаемым `security-denied`.

---

## 4. Что проверено и сочтено корректным

**Приёмка, по исходникам (не через тесты, которые её заявляют):**

- **«Одинаковое состояние даёт одинаковое назначение».** `planSchedulerTick` — чистая функция: время приходит в `nowMs`, часы внутри не читаются, `Math.random`/`Date.now`/`setTimeout` в `packages/core/src/scheduler.ts` и `packages/scheduler/src` отсутствуют (поиск по исходникам). Полный порядок сортировки есть: `compareWork` = score → более долгое ожидание → лексикографический идентификатор (`compareIds` — сравнение `<`, независимое от locale и платформы, D9). Порядок Map не влияет: `runFairRounds` сортирует ключи workspace (`:337`), кандидаты-агенты сортируются (`:458`), работы сортируются внутри workspace (`:311`). Независимая проверка: `.tmp/mw014-review-probe.mjs` P5 — прямой и обратный порядок входных массивов дают побайтово идентичный план.
- **«Dependency release будит ready задачу».** `service.ts:309-325` — тик читает состояние через порт и решает по нему; payload события (`event`, `taskId`, `workspaceId`) в решение не входит нигде. Тест `an event kick admits the work the event is about…` воспроизводит пробуждение после `state.release()`. Проверено чтением: `plan.kick` только эхо-переносится в результат.
- **«Sleeping/idle не вызывает LLM».** Поиск по `packages/scheduler/src` не находит ни `ModelCatalogPort`, ни `resolveModelInfo`, ни `listModels`, ни `selectModelRoute`, ни `routeModel(`, ни `AgentRuntimePort`, ни `adapter-sdk` — пакет не держит модельного порта вообще. Каталог приходит внутри наблюдения (`tickInput`, `:353-364`). Тик без работы: `runTick` делает один `state.read()`, `planSchedulerTick` с пустыми массивами не трогает `admit` (цикл по `plan.admissions` пуст). `RESOURCE_STATE_CHARGES.idle/sleeping` = `CHARGES_NOTHING`, и `countSchedulerOccupancy` выходит до `poolSlot`-ветки (`:218-221`), то есть тёплый/спящий инстанс не занимает ни пул, ни attempt, ни LLM-слот.
- **«Missed event восстанавливается reconcile».** `reconcile()` идёт тем же `runTick` с `{source:'reconcile'}`; решение читает состояние, а не payload (§16.2). Safety-петля `reconcileLoop` не завершается при ошибке тика (`:298-304`) — это и есть safety-путь. Тест на таймер воспроизводит startup-тик, пробуждение по часам и остановку.
- **«Concurrency не превышает caps».** Пул §14 (`:569`, включая границу `>=` и честный `maxActive: 0`), workspace (`min(§14 maxWorkers, §16.4 maxWorkers)` через `tighterOf`, `:576-579`), роль (`:581-583`), §15 attempts (`:586`) и LLM (`:587`) — все резервируют ёмкость через `planned`, и **единственный** путь к `admit()` (`:376`) стоит после `capacityRefusal` (`:370`) — обходных путей нет, `admissions.push` встречается в исходнике ровно один раз. Пул ревьюеров отдельный и с worker-пулом слот не делит. **Единственное исключение — heavy tools: F1.**
- **Детерминизм границ §30/§14:** включительная граница («попытка 2 из 2 допускается, третья — нет»), «объявленный лимит без ledger'а — отказ, а не ноль» — воспроизведено чтением `decideBudgetAdmission` и тестом.

**Контракты и границы:**

- **Публичная поверхность `@dsh-mywork/core` не сломана.** `CatalogOutage` и `CatalogSnapshot` присутствуют в `packages/core/lib/index.d.ts` (проверено по собранному `.d.ts`: обе записи в `export { … }`) и одновременно в `packages/contracts/lib/index.d.ts` — реэкспорт `export type { CatalogOutage, CatalogSnapshot }` в `routing.ts` сохранён, прежние потребители продолжают работать. Показательно, что реэкспорт не стал `@deprecated`-алиасом: это по-прежнему one-identity тип, объявленный в contracts.
- **Нет второго источника истины.** `workspaceScheduling` объявлен ровно в одном месте (`contracts/src/config.ts:163`), валидируется в одном (`core/src/config.ts:291-367`), и планировщик читает его из единственного входа — `SchedulerWorkspaceState.scheduling`. `readWorkspaceScheduling` закрывает форму по всем трём уровням (секция → workspace → поле), `weight` обязателен и положителен, пустой id отвергается, `weight: 0` отвергается с объяснением («это `workspace.enabled`, а не вес») — все семь malformed-кейсов покрыты новым тестом в `tests/config.test.mjs`.
- **Config-merge не теряет поле:** `mergeObjects` сливает домен `pools` как объект, `assertMergedPools` поле не срезает, `readPools` его валидирует — данные доходят до `ResolvedWorkspaceConfig.pools.workspaceScheduling`.
- **§16.2-события закрыты:** девять типов перечислены в `SCHEDULER_EVENT_TYPES` в порядке §16.2, незаявленный kick отвергается `TypeError`, `reconcile` с `event` отвергается.

**Процесс и числа:**

- **Приёмка карточки и все числа отчёта, кроме M6, воспроизведены:** `pnpm run check` → 471/448/0/23 (итог), 26 тестов планировщика, +27 тестов к baseline (26 + 1 config), все 10 diff'ов построчно, SHA256 обоих артефактов.
- **Mutation-check M1–M5, M7–M9 воспроизведён:** все восемь ловятся ожидаемыми тестами (M1 → 6 тестов, M2 → 3, M3 → 1, M4 → 13, M5 → 2, M7 → 2, M8 → 2, M9 → 2). Артефакты после каждой мутации восстановлены; итоговые SHA256 совпали с исходными. Побочная находка отчёта про M5 (первая версия теста aging проходила под мутацией) подтверждается: M5 действительно роняет и `runtime mints…`, и `a queue reading…`.
- **Чужая работа не тронута.** `git status --short` до и после ревью совпадает с перечнем карточки (10 M + 4 ??); `.work/` и `.tmp/` в `.gitignore`; живой DSH profile, доска задач и чужие проекты не открывались и не изменялись; ни одного commit/stash/checkout/reset.
- **Изменения в общих файлах — только аддитивные:** `+1` строка в `contracts/src/index.ts`, `+1` в `tsconfig.base.json`, `+4` в `tests/lib/fixtures.mjs`, `+9` в `pnpm-lock.yaml` (importer нового пакета); `routing.ts` — `+5/−29` (переезд типов, не удаление поведения).

---

## 5. Невоспроизводимые утверждения отчёта

| Утверждение отчёта | Команда | Результат |
|---|---|---|
| §6.7, **M6**: «игнорируется чтение, названное портом» → тест `a queue reading the state port states wins` → «1 fail ✔» | мутация M6 в копии собранного `packages/scheduler/lib/index.js` + `node --test --test-isolation=none tests/scheduler.test.mjs` | **exit 0, 0 упавших тестов.** Тест не ловит мутацию; см. F4. Проба на два тика (`.tmp/mw014-review/probe-m6.mjs`) различает ветви, то есть мутация реальна, а покрытие — нет |
| §6.7, **M5**: «1 fail» | та же процедура | воспроизводится как **2** fail (`runtime mints and keeps the queue reading…` и `a queue reading the state port states wins…`) — расхождение в счёте, не в выводе |
| §5, `pnpm run typecheck` → «11 из 12 workspace-проектов» | `Get-ChildItem packages -Directory` + чтение `scripts.typecheck` каждого `package.json` | typecheck-скрипт есть у **всех 11** пакетов в `packages/`; двенадцатый проект — корневой `package.json`. Формулировка неточна, поведение — то, что заявлено |
| §5, baseline «444 tests / 421 pass / 0 fail / 23 skipped» | — | **не проверял**: baseline не воспроизводим без отката работы. Итог 471/448/0/23 измерен мной напрямую. 23 skipped объясняются отсутствием бинарника `bd` (`beads-adapter.test.mjs:1003`, `:1011`), то есть к MW-014 отношения не имеют |
| §6.4 «скан исходников `packages/scheduler/src` не находит…» | `grep` по `packages/scheduler/src` на 7 запрещённых имён + `setTimeout`/`Date.now`/`Math.random`/`fetch(` | подтверждено; скан в тесте дополнительно проверяет непустоту каталога (`files.length > 0`) — это не пустой тест |

---

## 6. Что осталось непроверенным и почему

1. **Насыщенный §15 `maxAttempts`/`maxConcurrentLlm` при переполнении в одном тике.** Проверено чтением (`planned.attempts`/`planned.llm` читаются) и тестом `roomForOne`; отдельной пробы на «3 свободных attempt-слота и 5 кандидатов» не делал — F1 закрывает этот класс дефекта для heavy tools, а для двух других полей резервирование видно в исходнике и покрыто тестом `§15 … ceilings each stop the tick they are exhausted by`.
2. **Поведение под реальным resident controller и реальным Task Graph** — композиции нет, планировщик монтируется в MW-022/MW-044 (названо в §7 отчёта). Границу «кто проверяет привязку identity к workspace» (F2) окончательно решает именно эта композиция, поэтому F2 сформулирован как «планировщик не может проверить §52-привязку», а не как «данные в системе испорчены».
3. **§16.5 adaptive capacity, §16.3 deadline/backlog/locality, §27 review lanes с `when`** — вне объёма карточки, названы в §7 отчёта. Не проверял, находкой не считаю.
4. **M1–M4, M7–M9** воспроизведены по факту падения ожидаемых тестов; точное число упавших тестов на мутацию в отчёте указано только для M1/M2/M4/M5/M7/M8/M9 и мной уточнено (см. §5). Сам **характер** мутаций я воспроизводил по смыслу отчёта, а не по его точным патчам (патчи отчёт не приводит), поэтому совпадение «мутация → ожидаемый тест» проверено для моих формулировок девяти мутаций.
5. **`pnpm install --lockfile-only`** не запускал (может тронуть `node_modules`); согласованность lockfile проверена косвенно — `pnpm run check` с `pnpm -r` прошёл, а `pnpm install --frozen-lockfile --lockfile-only` указан в отчёте как exit 0.
6. **Два контроллера на одном workspace (MW-009/ADR020)** — не проверял, вне объёма.

---

## 7. Опровергнутые гипотезы (что искал и не нашёл)

Раздел ведётся по правилу «если находок нет — перечисли, что искал», и он же фиксирует два ложных следа, чтобы следующий проход не платил за них снова.

**Опровергнуто: «отказ одного workspace останавливает раунд для остальных».** Первая версия пробы давала `admissions=0` для всех workspace, и я собирался записать это как MINOR. Проба была невалидна: у фикстурных identity был пустой `workspaceOverlays` и `role.workflowPermissions` без `task.transition`, поэтому **все** кандидаты падали на §31-гейте по `permission-missing`. После привязки identity к своим workspace и выдачи `task.transition` гипотеза не подтвердилась:

| Сценарий | Ожидание | Наблюдение (`probe-f3.mjs`, `probe-f3b.mjs`) |
|---|---|---|
| S1: `role-capacity` в W-1, W-2 свободен | W-2 обслужен | `["W-1/T-1","W-2/T-3"]`, `W-1/T-2:role-capacity` ✔ |
| S2: общий пул 2, W-1 берёт 1, W-2 просит 2 | W-2 тоже не может превысить общий пул | `["W-1/T-1","W-2/T-3"]`, `pool-capacity` × 2 ✔ |
| R1/R2: W-1 не может взять работу (role-mismatch), W-2 может | W-2 обслужен | `["W-2/T-2"]`, `W-1/T-1:role-mismatch` ✔ |
| R5: тот же случай, но W-1 переименован в `Z-1` и идёт последним | W-2 обслужен | `["W-2/T-2"]` ✔ |

Механизм, который меня смутил, реален (`taken` растёт только на пути admission, `progressed` взводится только admission'ом), но его следствие безобидно: внутренний `while (taken < weight)` обходит `list.shift()`-пути **без** роста `taken`, поэтому отказывающая работа не съедает вес, а работа соседа обрабатывается в том же проходе.

**Проверено и не подтвердилось (следы, которые я закрыл):**

- **Прямое чтение часов/random внутри решения** — `Date.now`, `performance.now`, `Math.random`, `setTimeout`, `fetch(` в `packages/core/src/scheduler.ts` и `packages/scheduler/src/*` отсутствуют; время приходит только через `nowMs` и `ClockPort`.
- **Неполный порядок сортировки** — `compareWork` даёт полный порядок (score → `readySince` → идентификатор), `compareIds` не зависит от locale; проверено прогоном на прямом и обратном порядке входа.
- **Обход `capacityRefusal`** — `admissions.push` в исходнике встречается ровно один раз, и он стоит после `capacityRefusal`; других путей к `admit()` нет.
- **Второй источник истины для веса §16.4** — `workspaceScheduling` объявлен, валидируется и читается ровно в одном месте каждое; планировщик берёт вес только из `SchedulerWorkspaceState.scheduling`.
- **Пустой тест в скане исходников** — тест `the scheduler holds no model port…` проверяет `files.length > 0` перед сканом, то есть не может пройти на пустом каталоге; сам скан подтверждён независимым `grep`.
- **Тесты, asserted на собственные экспорты** — `SCHEDULER_EVENT_TYPES.length` используется как число чтений состояния (то есть проверяет поведение рантайма, а не константу), а `RESOURCE_STATE_CHARGES` проверяется `deepEqual` против литеральной таблицы §15 плюс отдельно против `countSchedulerOccupancy` на шести инстансах.
- **Утечка публичной поверхности из `core`** — новый модуль экспортирует шесть функций и три типа; `readPoolLimit`/`capacityRefusal`/`compareIds` и прочие внутренности в `packages/core/src/index.ts` не попали.
