# MW-009 — Реализовать Controller lease, epoch и lifecycle

- Предмет: карточка доски `e3d28aba-c719-4b52-8ca5-1352eba96ae7` (MW-009), этап `01-runtime`, обязательные пункты §62 — 1, 3
- Исполнитель: сессия DSH Web, модель `opencode-go/deepseek-v4.1-flash`
- Репозиторий: `H:\Repo\DSH-MyWork`, base SHA `fbee7a0b1d0703b5b2bdd581c05e81c3c19a2f7e` (HEAD на старте)
  - собственных коммитов нет: коммит не поручался; head = рабочее дерево поверх `fbee7a0`
- Окружение: Node `v24.19.0`, pnpm `12.4.2`, Windows, pwsh
- Статус: **DONE** — lease/epoch/lifecycle реализованы; `pnpm run check` в изолированной копии = exit 0, **202 pass / 0 fail** (25 новых тестов карточки + 4 проверки границ). Статус переведён из `READY_FOR_REVIEW` в `DONE` по прямому указанию владельца (сессия MW-020); акт приёмки — это указание, а не вывод автора.
- Независимое ревью: **PASS WITH FINDINGS** (1 MAJOR + 1 MINOR + 1 NIT) — все три находки исправлены, см. §9. Self-review приёмкой не считается.

---

## 1. Проверка зависимостей

| Зависимость | Как проверено | Результат |
|---|---|---|
| **MW-004** (`@dsh-mywork/storage`) | отчёт `reports/MW-004-storage.md` (`DONE`); исходники `packages/storage/src` (10 файлов); коммиты `a032a30`…`7ebb7b8` в `git log`; `pnpm run check` на дереве → exit 0 | предусловие пройдено |
| **MW-008** (`@dsh-mywork/evidence`) | отчёт `reports/MW-008-evidence-audit.md` (`READY_FOR_REVIEW`, ревью `PASS WITH FINDINGS`, верификация исправлений `FIXES VERIFIED`); исходники `packages/evidence/src` (7 файлов) и `packages/contracts/src/{artifact,audit}.ts`; `pnpm run check` → exit 0, 173 pass / 0 fail | предусловие пройдено с оговоркой |

Оговорки, названные явно:

1. **Формальной приёмки владельца у MW-008 нет** — отчёт в статусе `READY_FOR_REVIEW`. Работа продолжена по проверенным артефактам (исходники + зелёный конвейер), а не по колонке доски.
2. **Ловушка «файл отчёта есть — значит сделано» проверена.** MW-008 §10 фиксирует, что предыдущий прогон этой карточки останавливался с `BLOCKED` при существующем файле отчёта. Gate проверялся по исходникам и по прогону, а не по наличию файла.
3. **MW-009 зависит от MW-004 напрямую, а не от MW-008.** MW-008 нужен как соседний слой той же формы (schema/migrations поверх kernel) и как источник паттерна; `@dsh-mywork/lease` от `evidence` не зависит и его не импортирует (проверено тестом границ).

---

## 2. Сделано

### 2.1 Контракты (§5.3, §17)

| Файл | Содержимое |
|---|---|
| `packages/contracts/src/lease.ts` (новый, 134) | `ControllerLease` — запись §5.3 дословно (`scopeId`, `instanceId`, `processId`, `epoch`, `acquiredAt`, `heartbeatAt`, `leaseUntil`); `ControllerLeadershipOutcome` (`acquired`/`renewed`/`held-by-other`/`expired-taken-over`); `ControllerLeaseResult`; `LeaseStorePort` (§36 `lease-store`) с `acquire`/`heartbeat`/`read`/`release`/`holdsLeadership`; `ControllerAcquireRequest`, `ControllerReleaseRequest` |
| `packages/contracts/src/index.ts` | `export * from './lease.ts'` (аддитивно) |

### 2.2 Новый пакет `@dsh-mywork/lease`

| Файл | Содержимое |
|---|---|
| `src/schema.ts` (74) | Миграция **v4** `controller-lease`: таблица `controller_lease` (**STRICT**, `scope_id` — PRIMARY KEY, то есть одна строка на scope) и триггер `controller_lease_epoch_monotonic` (BEFORE UPDATE, `WHEN NEW.epoch < OLD.epoch` → `RAISE(ABORT, 'mywork.lease.epoch-not-monotonic')`). `LEASE_SCHEMA_VERSION = 4` |
| `src/lease.ts` (342) | `acquireLease` / `heartbeatLease` / `releaseLease` / `readLease` / `holdsLeadership` / `createLeaseStore`: CAS внутри одной транзакции, монотонный epoch, проверка применённой миграции (`schema-missing` в точке сборки) |
| `src/lifecycle.ts` (290) | `ControllerLifecycle`: `activate()` (acquire → openStores → reconcile → admission), `heartbeat()`, `dispose()` (admission → stores → lease), `isWriter()`, `holdsLease()`, `info()`; фазы `idle`/`activating`/`active`/`passive`/`disposing`/`disposed` |
| `src/errors.ts` (67), `src/index.ts` (63) | Свой словарь кодов (`invalid-input`, `lease-held`, `lease-lost`, `schema-missing`) и публичная поверхность |
| `package.json`, `tsconfig.json`, `tsdown.config.ts` | Манифесты; `dependencies` нет, `devDependencies` — три workspace-пакета |

Ключевые решения:

1. **CAS, а не «read then write».** `acquire` читает строку и пишет её в одной транзакции (`BEGIN IMMEDIATE` из ядра), а `WHERE` повторяет то условие, которое прочитал: `... AND epoch = ? AND lease_until <= ?`. Проигравший гонку меняет 0 строк и получает `held-by-other` — а не «тоже acquired».
2. **Epoch растёт на каждой передаче лидерства**, включая переполучение тем же инстансом после собственного истечения. Поэтому epoch вытесненного контроллера навсегда строго меньше текущего, и «старый epoch не коммитит» — это не проверка в коде вызывающего, а свойство данных.
3. **Монотонность держит база, а не слой.** Триггер запрещает понижение epoch, поэтому обойти это внутри БД нельзя. Триггер намеренно допускает **равный** epoch: heartbeat переписывает timestamps, не меняя лидерства, и это не переход. Первая редакция (`<=`) валила heartbeat — дефект найден тестом, см. §5.3.
4. **`holdsLeadership` требует и личность, и epoch.** Одного epoch недостаточно: проигравший претендент видит epoch победителя (`ControllerLeaseResult.lease`), и без проверки `instanceId` он мог бы пройти writer-gate, просто назвав чужой epoch. Это тоже найдено тестом (§5.3).
5. **Порядок dispose — часть инварианта.** Сначала закрывается admission, затем stores, и только потом отдаётся lease: иначе преемник начал бы писать, пока предшественник ещё завершает мутацию.
6. **Провалившаяся активация возвращает lease.** Лидерство без открытых stores бесполезно и блокировало бы здорового преемника до истечения; `activate()` отдаёт lease перед тем, как пробросить ошибку.
7. **Lifecycle не зависит от storage.** `openStores`/`closeStores`/`reconcile` инъектируются, поэтому lifecycle тестируется без БД, а слой не тянет драйвер в бандл (проверено тестом границ: у `packages/lease/lib/index.js` **ноль** внешних импортов).
8. **`@dsh-mywork/core` — только за чистым предикатом** `isCounter`; value-импорт `@dsh-mywork/storage` запрещён и проверяется тестом.

### 2.3 Тесты и границы

- `tests/lease.test.mjs` (новый, 25 тестов).
- `tests/boundaries.test.mjs` (+178 строк, **4 проверки**): разрешённые импорты слоя; `@dsh-mywork/storage` только как типы; отсутствие runtime-зависимостей в манифесте; домен не импортирует lease; бандл самодостаточен.
- `tests/lib/fixtures.mjs` (+8 строк): сборка lease.
- `README.md` (+90): строка структуры и раздел «Controller lease и lifecycle (§5.3, §16.1, §49)».

---

## 3. Изменённые и новые файлы

Новые (этой карточки):

```text
packages/contracts/src/lease.ts        134   packages/lease/src/lifecycle.ts   290
packages/lease/src/schema.ts            74   packages/lease/src/errors.ts       67
packages/lease/src/lease.ts            342   packages/lease/src/index.ts        63
packages/lease/package.json  tsconfig.json  tsdown.config.ts
tests/lease.test.mjs                   741
```

Изменённые (аддитивно, только свои строки):

```text
 packages/contracts/src/index.ts  |   1 +   (export * from './lease.ts'; всего в файле +6, остальные 5 — соседняя сессия)
 tsconfig.base.json               |   1 +   (path @dsh-mywork/lease; всего в файле +2, вторая строка — соседняя сессия)
 tests/lib/fixtures.mjs           |   8 ++  (сборка lease)
 tests/boundaries.test.mjs        | 178 ++  (+4 проверки слоя lease; файл целиком мой в этой правке)
 README.md                        |  28 ++  (раздел «Controller lease и lifecycle» + 1 строка структуры)
 pnpm-lock.yaml                   |  21 ++  (импортёры packages/lease и packages/evidence)
```

Числа — из `git diff HEAD --numstat` по этим путям; там, где в файле есть чужие добавления, это указано явно.

**Поправка после независимого ревью (F1, F3).** Первая редакция этого раздела указывала
`README.md | 90 ++ (структура + раздел lease)` и утверждала в §7.9, что `pnpm-lock.yaml` не менялся.
Оба утверждения были неверны: из 90 добавленных строк README **62 принадлежат чужой секции
`## Права и границы (§31)`** (MW-007), а моя секция — 28 строк; импортёр `packages/lease` в lockfile
**появился** (+21 строка, вместе с чужим импортёром `packages/evidence`). Исправлено выше.

**Чужие файлы не изменялись.** В дереве параллельно работала соседняя сессия (board/theme, §6.2): её незакоммиченные файлы (`packages/contracts/src/{board,theme}.ts`, `packages/core/src/{board,theme}.ts`, `packages/contracts/src/{authority,events,operation,revisions,task}.ts`) не тронуты, не откатывались и не коммитились. Мои правки в общих файлах — только добавленные строки; в `contracts/src/index.ts` рядом стоят чужие `board`/`theme`/`security`/`artifact`/`audit`, и они сохранены. Секция README §31 и импортёр `packages/evidence` в lockfile — тоже чужая работа, оставленная как есть.

---

## 4. Команды и exit codes

| Команда | Exit | Наблюдение |
|---|---|---|
| `git rev-parse HEAD` / `git status --porcelain` (старт) | 0 | `fbee7a0…`; в дереве незакоммиченная работа MW-007/MW-008 и активная соседняя сессия |
| `pnpm run check` (основное дерево, gate) | 0 | **173 pass / 0 fail** — зависимости пройдены |
| `git worktree add --detach .tmp/mw009-verify HEAD` | 0 | изолированная копия; в неё скопированы артефакты MW-007/MW-008 (без чужих `board`/`theme`) |
| `pnpm install` (изолированная копия) | 0 | 8 workspace-проектов, `Lockfile passes supply-chain policies (69 entries)` |
| `pnpm --filter @dsh-mywork/lease run typecheck` | 0 | strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` |
| `pnpm --filter @dsh-mywork/lease run build` | 0 | `tsdown` → `lib/index.js` + `.d.ts`; **внешних импортов нет** |
| `node --test --test-isolation=none tests/lease.test.mjs` | 0 | **25 pass / 0 fail** |
| `node --test --test-isolation=none tests/boundaries.test.mjs` | 0 | **18 pass / 0 fail** (в т.ч. 4 новых) |
| `pnpm run check` (изолированная копия, итог) | **0** | smoke `all steps passed`, **202 pass / 0 fail** |
| mutation-check A–J (изолированная копия, §6.4) | 1 каждая | тесты падают адресно; после `restore` — 25/25 |
| `pnpm run check` (основное дерево, финал) | **1** | **не дефект MW-009**: падает `packages/core/src/board.ts` (TS6133) — незакоммиченная работа соседней сессии, которая пишется прямо сейчас (§6.2) |

Изолированная копия: `git worktree add --detach .tmp/mw009-verify fbee7a0`, поверх скопированы артефакты зависимостей, свой `node_modules` и своя сборка.

---

## 5. Приёмка: пункт → проверка

| Пункт приёмки карточки | Тест |
|---|---|
| **Два Controller не становятся writer одновременно** | `two controllers never both become writer` (второй получает `held-by-other`, epoch не растёт, heartbeat чужого инстанса → `lease-lost`), `two controllers on one file: only one holds the lease at any instant` (два соединения к одному файлу), `a claim that loses the takeover race is refused, not granted`, `a passive controller opens nothing and admits nothing` |
| **FakeClock проверяет expiry/failover** | `a lease expires on its own, and the failover takes over at a higher epoch` (на 4 999 мс — отказ, на 6 000 мс — `expired-taken-over`, epoch 1→2), `the writer gate honours expiry directly, not only through a lifecycle` (граница 5 999/6 000 exclusive), `an expired lease cannot be heartbeated back to life`, `a live lease is renewed by its holder without moving the epoch` |
| **Старый epoch не коммитит изменения после передачи leadership** | `a superseded epoch cannot commit, and cannot resurrect itself` (writer-gate `false`; release старого epoch — no-op; понижение epoch отклонено триггером базы), `a superseded controller is no longer a writer even before it notices`, `a heartbeat after a failover closes admission before it reports the loss`, `release by the right instance is refused if the epoch is stale` |
| **Открытая вкладка не нужна для lifecycle** | `the lifecycle needs no open UI: activation and disposal are self-contained` (`typeof globalThis.document === 'undefined'`; истечение видно по durable-состоянию без события UI), `activation acquires the lease, opens stores, reconciles, then admits work` |
| Объём: acquire/heartbeat/expire/release через CAS | `the first controller acquires leadership at epoch 1 and reads it back`, `release gives leadership up, and the next controller starts a new epoch`, `a malformed acquisition is refused before the database is touched`, `the lease table is STRICT and holds one row per scope` |
| Объём: при activation открыть stores и reconcile | `activation acquires the lease, opens stores, reconciles, then admits work` (порядок и счётчики вызовов), `a failed activation gives the lease back instead of blocking a successor` |
| Объём: при dispose остановить admission и освободить ресурсы | `disposal stops admission, closes the stores, and only then releases the lease` (порядок проверяется изнутри `closeStores`), `disposal is idempotent, and safe on a controller that never activated` |
| Монотонный epoch, durable | `the lifecycle survives a restart: the lease row outlives the process`, `a database without the lease migration is refused where it is wired` |

---

## 6. Evidence

### 6.1 Полный конвейер (изолированная копия)

```text
$ pnpm install
Scope: all 8 workspace projects
✓ Lockfile passes supply-chain policies (69 entries)
INSTALL_EXIT=0

$ pnpm run check
smoke: all steps passed
ℹ tests 201   ℹ pass 201   ℹ fail 0
WT_CHECK_EXIT=0
```

### 6.2 Живой писатель в общем дереве

Соседняя сессия писала `packages/core/src/board.ts` **во время** этой карточки: mtime 23:20:16 → 23:21:19 → 23:24:09 (замеры в трёх точках), файл untracked. На финальном прогоне основного дерева `pnpm run check` падает **в нём**:

```text
packages/core typecheck: src/board.ts(293,10): error TS6133: 'sharedPrefixLength' is declared but its value is never read.
MAIN_CHECK_EXIT=1
```

Это не дефект MW-009: `packages/lease` от `board.ts` не зависит, а его собственный typecheck в изолированной копии (где чужой файл отсутствует) — exit 0. Чужая работа не менялась и не откатывалась. По той же причине все прогоны и мутации выполнялись в `.tmp/mw009-verify`, а не в общем дереве.

### 6.3 Дефекты, найденные собственными тестами (до mutation-check)

| # | Что было | Как найдено | Исправление |
|---|---|---|---|
| **D1** | Триггер `WHEN NEW.epoch <= OLD.epoch` валил **heartbeat**: продление переписывает строку с тем же epoch | `a live lease is renewed by its holder without moving the epoch` → `mywork.lease.epoch-not-monotonic` | Условие сужено до `NEW.epoch < OLD.epoch`; равный epoch — не переход лидерства |
| **D2** | `holdsLeadership(scope, epoch, at)` не проверял личность: проигравший претендент видит epoch победителя и мог пройти writer-gate, назвав его | `two controllers on one file…` → `2 !== 1` (оба соединения проходили gate) | В сигнатуру добавлен `instanceId`; проверяются и личность, и epoch. Контракт `LeasePort` и lifecycle обновлены |
| **D3** | Тест границ `specifier.includes('lease')` ловил `./lease.ts` — контрактный модуль contracts, а не пакет | `the domain packages do not import the lease layer` → падение на `contracts/src/index.ts` | Проверка сужена до `@dsh-mywork/lease` / `packages/lease` |

### 6.4 Mutation-check (проверка, что тесты не вакуумные)

Мутации вносятся в **собранный** бандл изолированной копии, исходники не меняются; драйвер `.tmp/lease-mutate.mjs`, якоря берутся из бандла (якорь, встречающийся не ровно один раз, — отказ драйвера, а не «мутация без эффекта»).

| # | Что сломано в бандле | Результат (набор 25 тестов) |
|---|---|---|
| A | `cas-condition`: из takeover-`UPDATE` убрано `AND lease_until <= ?` | 18 pass / **7 fail** |
| B | `epoch-not-bumped`: `current.epoch + 1` → `current.epoch` | 20 pass / **5 fail** |
| C | `live-lease-stolen`: отказ живого чужого lease отключён | 19 pass / **6 fail** |
| D | `heartbeat-no-holder-check`: убрана проверка `instanceId` в heartbeat | 24 pass / **1 fail** — `heartbeat refuses an instance that is not the holder, at the same epoch` |
| E | `expiry-ignored`: `current.leaseUntil > at` → `true` | 23 pass / **2 fail** |
| F | `writer-ignores-instance`: `holdsLeadership` игнорирует `instanceId` | 22 pass / **3 fail** |
| G | `release-no-epoch-check`: из `DELETE` убрано `AND epoch = ?` | 24 pass / **1 fail** — `release by the right instance is refused if the epoch is stale` |
| H | `dispose-order`: lease освобождается **до** закрытия stores | 24 pass / **1 fail** — `disposal stops admission, closes the stores, and only then releases the lease` |
| I | `passive-admits`: пассивный контроллер открывает admission | 24 pass / **1 fail** — `a passive controller opens nothing and admits nothing` |
| J | `monotonic-guard-gutted`: `WHEN NEW.epoch < OLD.epoch` → `WHEN 0` (имя триггера сохранено) | 23 pass / **2 fail** — `the database itself refuses to lower the epoch, and the guard is not merely a name` + `a superseded epoch cannot commit…` |

После каждой мутации бандл восстанавливался из бэкапа; доказательство восстановления — **25 pass / 0 fail**.

**Числа исправлены после ревью (F2).** Первая редакция приводила «22 pass / 1 fail» для D/G/H и «17 pass / 6 fail» для A — арифметика не сходилась с размером набора (тогда 24 теста). Адресность падений была верна, числа — нет; выше приведены фактические, уже с добавленным тестом J (набор 25).

**Три мутации (A, D, G) в первой редакции оставляли набор полностью зелёным** — это были вакуумные проверки, а не пройденные тесты:

- **A** сначала формулировалась как `... OR 1=1`, но защищал оставшийся `epoch = ?`, поэтому мутация ничего не доказывала. Переформулирована в снятие именно условия истечения — и сразу вскрыла, что **гонка за истёкший lease не была покрыта тестом**.
- **D** не падала, потому что мой тест heartbeat брал другой инстанс, но барьер достигался проверкой epoch/expiry, а не личности.
- **G** не падала, потому что тест release использовал **правильный** инстанс, и `instance_id = ?` уже отсекал всё.

Исправлено добавлением трёх адресных тестов: `a claim that loses the takeover race is refused, not granted`, `heartbeat refuses an instance that is not the holder, at the same epoch` (инстанс цитирует **живой** epoch holder'а), `release by the right instance is refused if the epoch is stale` (тот же инстанс, старый epoch). После этого A/D/G валят ровно свои тесты.

**Мутация J добавлена после ревью (F2).** Независимый ревьюер указал, что §2.2 п.3 и README заявляют защиту монотонности epoch триггером базы, но в матрице §6.4 **не было ни одной мутации против триггера**. Он предложил мутацию `no-monotonic-trigger` (переименование триггера) — она набор не валит, и это правильно: переименованный триггер продолжает защищать, то есть мутация эквивалентная, а не пробел в покрытии. Честная однопризнаковая мутация — обнулить условие `WHEN`, сохранив имя: она ловится (J выше). Дополнительно добавлен именованный тест `the database itself refuses to lower the epoch, and the guard is not merely a name`, который проверяет и наличие триггера под объявленным именем, и что он **реально защищает** (а не только называется), и что равный epoch по-прежнему разрешён (это heartbeat), и что законный рост epoch не блокируется.

**Урок, который стоит сохранить.** Мутация, которая «ничего не сломала», — это не доказательство устойчивости кода, а признак, что проверяемое свойство не покрыто. Две из трёх таких мутаций указывали на реальные дыры в тестах, а не на избыточность кода. Обратная ошибка тоже возможна: мутация, которая меняет **имя**, а не **поведение**, ничего не доказывает и не является пробелом — различать эти два случая обязательно.

### 6.5 Изоляция от живого окружения

Все БД — в свежих каталогах `mkdtemp` под `os.tmpdir()` с префиксом `dsh-mywork-lease-`; `after()` удаляет **только** созданные этим набором каталоги, проверяя префикс перед удалением, и сверяет fingerprint живого `$DSH_HOME/dsh-mywork` до и после всего файла (read-only: `existsSync`/`readdirSync`, записи нет). Живой профиль DSH, доска и живой ledger не читались и не менялись; платные LLM-пробы, другие модели и субагенты не запускались.

---

## 7. Ограничения и что осталось за рамками

1. **Коммита нет** (не поручался); push/merge/publish/release не выполнялись.
2. **Рантайм не подключён.** `ControllerLifecycle` не смонтирован в `packages/controller`: карточка требует реализовать lease/epoch/lifecycle, а не заменить жизненный цикл плагина. Точка подключения — `apply()` контроллера, и это отдельная правка (следующие карточки этапа `01-runtime`). Сегодняшний `MyWorkControllerService` по-прежнему только публикует snapshot.
3. **Scheduler не реализован.** §16.1 перечисляет `Read ready tasks → Fill capacity → Subscribe events → Running`; карточка закрывает lease → stores → reconcile → admission, а планирование (§16.3–16.5) — MW-010/MW-011.
4. **Reconcile — инъектируемый колбэк, а не реализация.** §16.1 требует «Reconcile incomplete operations» и «Reconcile leases/attempts»; lifecycle вызывает `reconcile(stores)` ровно один раз при успешной активации и записывает `ReconcileReport`, но саму реконсиляцию выполняет вызывающий (её содержание — предмет карточек, владеющих attempts/operations).
5. **`lease-held` в словаре ошибок пока не бросается.** `acquire` сообщает конфликт исходом `held-by-other` (это ожидаемый результат, а не сбой), поэтому код оставлен для вызывающих, которым нужен отказ, но сам слой его не поднимает. Если владелец предпочитает один способ — это уточнение объёма, а не дефект.
6. **Heartbeat-цикл не запускается сам.** `heartbeat()` вызывается явно; фоновый таймер продления — часть scheduler-цикла (MW-010), и навязывать его здесь значило бы завести второй таймер в процессе.
7. **`scopeId` — строка, а не вычисляемый ключ.** Разделение scope'ов (по `$DSH_HOME`, по installation) не выводится слоем: его задаёт вызывающий. Для одного installation это `'local'`; политика нескольких scope'ов не выдумывалась.
8. **Общее дерево сейчас красное из-за чужой незакоммиченной работы** (§6.2). Закоммиченное состояние `fbee7a0` + мои файлы проверены в изолированной копии: exit 0, 202 pass / 0 fail.
9. **`pnpm-lock.yaml` изменён** (+21 строка): `pnpm install` добавил импортёры `packages/lease` и `packages/evidence`. Первая редакция отчёта утверждала обратное — это была ошибка (F3 ревью). У `packages/lease` нет runtime-зависимостей, поэтому в импортёре только три devDependency.

---

## 8. Как воспроизвести

```powershell
cd H:\Repo\DSH-MyWork
git rev-parse HEAD                          # fbee7a0b1d0703b5b2bdd581c05e81c3c19a2f7e

# Изолированная копия (не соревнуется с соседней сессией за сборку):
git worktree add --detach .tmp/mw009-verify fbee7a0
# … скопировать артефакты MW-007/MW-008 и файлы этой карточки, затем:
cd .tmp\mw009-review; pnpm install; pnpm run check      # exit 0, 202 pass / 0 fail

# Только набор карточки:
node --test --test-isolation=none tests\lease.test.mjs  # exit 0, 25 pass / 0 fail

# Mutation-check:
node .tmp\lease-mutate.mjs list
node .tmp\lease-mutate.mjs apply dispose-order
node --test --test-isolation=none tests\lease.test.mjs  # ожидается 1 fail
node .tmp\lease-mutate.mjs restore
node --test --test-isolation=none tests\lease.test.mjs  # снова 25/25
```

Что перепроверить независимо:

1. **CAS по исходникам, а не по тестам:** `packages/lease/src/lease.ts` — `WHERE` в takeover-`UPDATE` повторяет условие прочитанного состояния; проигравший меняет 0 строк.
2. **Монотонность epoch** — триггер в `src/schema.ts` и его поведение на равном/меньшем epoch (равный обязан проходить: это heartbeat).
3. **Порядок dispose** — `src/lifecycle.ts`: admission → stores → lease, и что `releaseQuietly` не маскирует исходную ошибку.
4. **`holdsLeadership` требует личность** — иначе проигравший претендент проходит gate по чужому epoch.
5. Повторить мутации §6.4 (или свои) — тесты должны падать адресно.
6. Оценить решения §2.2 и ограничения §7, в первую очередь неподключённый рантайм (§7.2) и инъектируемый reconcile (§7.4).

---

## 9. Независимое ревью и исправления

### 9.1 Как проводилось

По указанию владельца запущен отдельный субагент со свежим контекстом (`725ce2a0…`), read-only, с мандатом на состязательную проверку и словарём `PASS` / `PASS WITH FINDINGS` / `FAIL`. Ему переданы: путь **замороженного снимка** `.tmp/mw009-review` (отдельный worktree на `fbee7a0` с артефактами MW-007/MW-008 и файлами MW-009, без чужих `board`/`theme`), base SHA, критерии приёмки по пунктам, разделы §5/§16/§17/§49/§8 со строчными анкорами, путь отчёта, ожидаемые числа и известные ловушки окружения. Мой diff, рассуждения и переписка ему **не** передавались — отчёт был единственным проводом.

Снимок понадобился потому, что общее дерево красное из-за параллельной сессии (§6.2): ревьюер на живом дереве получил бы 4 падения чужих тестов и не смог бы воспроизвести числа карточки. Снимок перед выдачей проверен: exit 0, 201 pass / 0 fail (на момент выдачи).

### 9.2 Вердикт

**PASS WITH FINDINGS** — все четыре критерия приёмки подтверждены **по коду и публичному API**, а не по тестам; 201/201 воспроизведено; findings касаются честности отчёта и полноты набора тестов, а не корректности lease-логики. Ревьюер выполнил 22 команды, включая 14 мутаций (4 обязательных из моего драйвера + 10 своих) с восстановлением бандла после каждой.

Что ревьюер подтвердил своими пробами (не моими тестами): гонка за истёкший lease даёт ровно одного writer'а; граница expiry строго exclusive (5999 — writer, 6000 — нет); цепочка epoch 1→2→3; переполучение своего же истёкшего lease тоже инкрементит epoch; **четыре вектора обхода `holdsLeadership` закрыты** (чужой epoch, свой старый epoch, acquire, heartbeat, release@1); через публичное API понизить epoch невозможно; порядок dispose подтверждён изнутри `closeStores`; бандл имеет 0 внешних импортов; тест границ не вакуумен. Отдельно подтвердил, что `lease-held` действительно не бросается (§7.5 честен) и что §7 — честные ограничения, а не недоделка.

### 9.3 Находки и что сделано

| # | Severity | Находка | Исправление |
|---|---|---|---|
| **F1** | **MAJOR** | §3 отчёта указывал `README.md \| 90 ++ (структура + раздел lease)`. Фактически 90 строк = **28 моих** + **62 строки чужой секции `## Права и границы (§31)`** (MW-007). Карточка присвоила себе чужой объём — при том что §3 обещал явно размечать чужие добавления | §3 исправлен: `README.md \| 28 ++ (раздел lease + строка структуры)`, добавлена явная поправка с указанием, что 62 строки — чужая работа |
| **F2** | **MINOR** | Мутация против триггера монотонности epoch отсутствовала в матрице §6.4, хотя §2.2 п.3 и README заявляют эту защиту. Ревьюер предложил `no-monotonic-trigger` (переименование) — набор остался зелёным | Разобрано: переименование — **эквивалентная** мутация (переименованный триггер продолжает защищать), а не пробел в покрытии. Добавлена честная однопризнаковая мутация **J** (`WHEN NEW.epoch < OLD.epoch` → `WHEN 0`, имя сохранено) — ловится (23 pass / 2 fail). Добавлен именованный тест `the database itself refuses to lower the epoch, and the guard is not merely a name`: проверяет наличие триггера под объявленным именем, что он **реально защищает**, что равный epoch разрешён (heartbeat) и что законный рост epoch не блокируется |
| **F2b** | MINOR | Числа в §6.4 не сходились с размером набора: «22 pass / 1 fail» для D/G/H (фактически 23) и «17 pass / 6 fail» для A (фактически 18) | §6.4 пересчитан по факту; добавлена явная пометка о поправке |
| **F3** | **NIT** | §7.9 утверждал «`pnpm-lock.yaml` не менялся мной», тогда как импортёр `packages/lease` в diff есть (+21 строка), и в §3 он не значился | §7.9 исправлен; `pnpm-lock.yaml \| 21 ++` добавлен в §3 с пометкой, что там же чужой импортёр `packages/evidence` |

**Эквивалентные мутации, признанные не-дефектами** (зафиксировано для полноты): `heartbeat-wrong-epoch` — `ControllerAcquireRequest` вообще не несёт epoch, слой перечитывает строку, поэтому `epoch = ?` в heartbeat-`UPDATE` недостижим через порт (belt-and-braces); `dispose-keeps-epoch` — строка уже удалена `releaseQuietly()`, наблюдаемо лишь `heldEpoch ≠ undefined` после dispose, поведенчески безвредно.

### 9.4 Что осталось непроверенным (по заключению ревьюера)

- **Интеграция с `packages/controller`** — в снимке её нет; §7.2 подтверждён чтением отчёта и отсутствием кода, но не прогоном. Осознанное ограничение.
- `pnpm run verify:profile` — запрещён заданием.
- **Истинная межпроцессная гонка** — проверялась двумя соединениями в одном процессе плюс CAS внутри одного `BEGIN IMMEDIATE`; два реальных процесса на одном файле не воспроизводились.
- §17 архитектуры (строка 933) говорит про *Attempt* lease/fence, а не про controller lease; реализация опирается на §5.3, пересечение с attempt-fence относится к другим карточкам.

### 9.5 Состояние после исправлений

`pnpm run check` в снимке → **exit 0, 202 pass / 0 fail** (25 тестов карточки + 4 проверки границ). Мутации A–J — все падают адресно; после `restore` — 25/25. Бандл восстановлен (hash `03D4DA91…`). Исходники и общий репозиторий ревьюером не тронуты; писал только в `.tmp/mw009-review/.tmp/`.

**Статус: DONE** — переведён из `READY_FOR_REVIEW` по прямому указанию владельца (сессия MW-020). Приёмка — акт владельца; ревьюер дал `PASS WITH FINDINGS`, а не `PASS`, и это не меняется: self-review и ревью-вердикт приёмкой не являются.
