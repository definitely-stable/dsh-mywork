# MW-004 — Добавить durable SQLite state и outbox/inbox

- Предмет: карточка доски `70113eee-e1ce-4c84-951c-a53f2e5b2066` (MW-004), этап `00-foundation`
- Исполнитель: сессия `session-aeafe6a2-ffef-4a76-a482-c96db6c25a61` (DeepSeek V4.1 Flash, DSH Web)
- Дата: `2026-09-17 23:35 – 2026-09-18 00:30 +05:00`
- Репозиторий: `H:\Repo\DSH-MyWork`, base SHA `e8b3cc226a18e58a85c02063b4afbb7360947393`, head SHA `7ebb7b8` (4 коммита этой карточки)
- Окружение: Node `v24.19.0` (`node:sqlite`, SQLite `3.53.3`), pnpm `12.4.2`, DSH `0.1.5-rc.2`
- Статус: **DONE** — работа завершена и закоммичена; ревью-статус снят решением владельца (отдельное независимое ревью не выполнялось, см. §8)

---

## 1. Проверка зависимости MW-003

| Что проверено | Результат |
|---|---|
| Отчёт `reports/MW-003-domain-contracts.md` | Существует (403 строки); на момент проверки — статус ожидания ревью, с ревью отдельного субагента (**PASS WITH FINDINGS**, 15 замечаний) и повторной независимой верификацией исправлений (**FIXES VERIFIED**, 4 новых дефекта исправлены) |
| Проверка по исходникам (не по отчёту) | `pnpm run check` на дереве MW-003 до правок этой карточки → **exit 0**, `62 pass / 0 fail`, smoke 9 `ok`; контракты `packages/contracts/src/*.ts` (9 файлов) и переходы `packages/core/src/*.ts` (7 файлов) на месте и импортируются тестами |
| Что MW-003 явно передал в MW-004 | §6.2.3 «outbox/inbox, durability и дедупликация — MW-004»; §6.2.4/§7.2 — «текущий fence задачи» хранит lease store, которого ещё нет |
| Независимое ревью MW-002 (`reports/MW-002-review.md`) | По-прежнему **отсутствует** — это унаследованный риск MW-003 §6.3, а не блокировка MW-004 |

Правило карточки «если зависимость не принята — остановись с BLOCKED» применено буквально:
собственной приёмки владельцем у MW-003 в отчёте не было (там стоял статус ожидания ревью),
поэтому вопрос был задан владельцу до начала работы, и владелец выбрал вариант «продолжать,
ревью ниже по потоку включить в финального ревьюера». Затем владелец сообщил «MW-003 завершено»
и отдельно снял ревью-статусы. Поэтому работа продолжена, **остановки с BLOCKED нет**, а
унаследованный риск (отсутствие независимого ревью MW-002) зафиксирован в §6.1.

---

## 2. Сделано

### 2.1 Новый пакет `@dsh-mywork/storage`

Пакет появился не «на будущее», а потому что его требует приёмка: `tests/boundaries.test.mjs`
запрещает `sqlite` в `contracts` и `core` (домен не должен знать про драйвер), а `core` объявлен
чистой политикой. Слой хранения — отдельная граница (`MyWork DB`/`Lease Store` в матрице §8) и
зависит только от `@dsh-mywork/contracts`.

| Файл | Содержимое |
|---|---|
| `src/layout.ts` | Размещение runtime state по §7: `$DSH_HOME/dsh-mywork/state/{registry,controller}.sqlite`. Приоритет home повторяет документированное правило DSH (`explicit > $DSH_HOME > ~/.dsh`, пустой `DSH_HOME` = unset, `~` раскрывается) — зеркало `@deepseek-ai/dsh-home-paths`, без зависимости от DSH-пакета |
| `src/sql.ts` | Открытие `node:sqlite` (stdlib, без third-party драйвера), owner-only файл `0o600`, каталог `0o700`, `foreign_keys=ON`, WAL с проверкой, что режим действительно применился, `PRAGMA user_version` как версия схемы, примитив `withTransaction` (`BEGIN IMMEDIATE` → `COMMIT`, `ROLLBACK` при любом throw) |
| `src/migrations.ts` | Явные миграции §61: список, валидация (положительная версия, уникальность, порядок, наличие `up`), журнал `schema_migrations` + `PRAGMA user_version`, по одной транзакции на миграцию, повторное чтение версии под write-lock (два процесса применяют миграцию один раз), отказ открывать БД новее билда |
| `src/outbox.ts` | Транзакционный outbox §48: `append` внутри транзакции (штампует `schema/eventId/sequence/occurredAt`, `sequence` — монотонный поток на workspace, выделяется под write-lock), идемпотентный повтор по `eventId`, конфликт при переиспользовании id с другим содержимым, `markDelivered`/`markFailed` (сбой доставки не теряет событие), `pending(query)`/`get(eventId)` |
| `src/inbox.ts` | Дедупликация §48 по ключу `(consumer, eventId)`: `applyOnce` пишет строку дедупа в той же транзакции, что и эффект; повторная доставка не запускает эффект; отказ на async-эффект |
| `src/store.ts` | `openStore` + `MyWorkStore`: версия схемы, журнал миграций, `transaction(fn)`; **запись существует только на объекте транзакции** — коммит мутации без её событий невозможен по построению; отказ на вложенную транзакцию, на async-тело и на закрытие внутри транзакции |
| `src/errors.ts`, `src/payload.ts`, `src/clock.ts`, `src/index.ts` | Собственный словарь ошибок хранения (13 кодов §42 закрыты доменом, поэтому у слоя хранения свои), проверки значений и lossless-JSON payload, узкий порт часов (структурно совместим с `ClockPort` и с `FakeClock`), публичная поверхность |

Таблицы — только у реально реализованных сущностей: `schema_migrations`, `outbox`,
`inbox_dedup` (+ индекс доставки). Спекулятивных репозиториев и таблиц под будущие задачи
(`attempts`, `leases`, `artifacts`, `audit_events`, `task_bindings`, …) не создано.

### 2.2 Проверки

`tests/storage.test.mjs` (15 тестов) и `tests/storage-crash.test.mjs` (2 теста) + помощник
`tests/lib/crash-child.mjs`. Все БД — в свежих каталогах `mkdtemp`; `tests/lib/fixtures.mjs`
дополнен сборкой `storage` и `adapter-sdk/testing` (для `FakeClock`); `tests/boundaries.test.mjs`
дополнен четырьмя проверками границ нового пакета.

### 2.3 Исправление `.gitignore` (по отдельному решению владельца)

Правило `lib/` без якоря скрывало от Git не только сборку пакетов, но и `tests/lib/fixtures.mjs`
(общие фикстуры MW-003, нужны всем 8 доменным тестам), `scripts/lib/process.mjs` (нужен
`pack.mjs`, `verify-profile.mjs`) и новый `tests/lib/crash-child.mjs`. Из чистого клона
`pnpm run test` и `verify:profile` не работали бы. Заменено на `packages/*/lib/` (одна строка +
комментарий). Вопрос задан владельцу до правки, выбран вариант «исправить».

---

## 3. Изменённые и новые файлы

`git diff --name-status e8b3cc2..7ebb7b8` — 23 файла, +2296/−2. Коммиты этой карточки:

| Коммит | Содержимое |
|---|---|
| `a032a30` `feat(storage): …` | `packages/storage/**` (src + манифесты), `tsconfig.base.json`, `pnpm-lock.yaml` (только импортёр `packages/storage`; изменение lockfile для `@dsh-mywork/adapter-sdk` в импортёре контроллера принадлежит MW-005 и не закоммичено) |
| `3ad7aea` `test(storage): …` | `tests/storage.test.mjs`, `tests/storage-crash.test.mjs`, `tests/lib/crash-child.mjs`, `tests/lib/fixtures.mjs`, `tests/boundaries.test.mjs` |
| `9fa00c1` `chore(repo): …` | `.gitignore`, `scripts/lib/process.mjs` |
| `7ebb7b8` `docs(readme): …` | `README.md` |

```text
A  packages/storage/…            (новый пакет: src/, package.json, tsconfig.json, tsdown.config.ts)
A  tests/storage.test.mjs  tests/storage-crash.test.mjs  tests/lib/crash-child.mjs
A  tests/lib/fixtures.mjs        (общие фикстуры MW-003 + сборки storage/adapter-sdk)
A  scripts/lib/process.mjs       (helper MW-002, ранее скрытый .gitignore)
M  .gitignore                    (lib/ → packages/*/lib/)
M  README.md                     (пакет storage + раздел «Runtime state»)
M  pnpm-lock.yaml                (импортёр packages/storage)
M  tests/boundaries.test.mjs     (+4 проверки границ storage)
M  tsconfig.base.json            (path @dsh-mywork/storage)
```

Коммиты `a81c2cc…e8b3cc2` (contracts/core/tests/adapter-sdk/controller/README) появились в
репозитории **во время** этой сессии извне — не этой карточкой. Пока шла эта карточка, в рабочем
дереве появилась незакоммиченная работа MW-005 (`packages/adapter-sdk/src/*`,
`packages/contracts/src/index.ts`, `packages/controller/*`, `scripts/smoke.mjs`,
`tests/adapters.test.mjs` и hunk `@dsh-mywork/adapter-sdk` в `pnpm-lock.yaml`); она не входит ни в
один из четырёх коммитов выше и осталась нетронутой в рабочем дереве.

| Категория | Файлы (строк) |
|---|---|
| Новый пакет | `packages/storage/src/{layout,sql,migrations,outbox,inbox,store,payload,errors,clock,index}.ts` — 1315 строк; манифесты: `package.json` 27, `tsconfig.json` 4, `tsdown.config.ts` 18 |
| Тесты | `tests/storage.test.mjs` 484, `tests/storage-crash.test.mjs` 112, `tests/lib/crash-child.mjs` 43 |
| Изменённые | `tests/lib/fixtures.mjs` 123 (было 115 — добавлены две сборки), `tests/boundaries.test.mjs` 242, `.gitignore` 8, `tsconfig.base.json` 37, `README.md` 94, `pnpm-lock.yaml` |

`packages/adapter-sdk`, `packages/controller`, `packages/contracts/src`, `packages/core/src`,
`scripts/*.mjs` этой карточкой не менялись (mtime и `git status` это подтверждают). Контроллер
намеренно не подключает store: открытие stores при activation — MW-009.

---

## 4. Команды и exit codes

| Команда | Exit | Что доказывает |
|---|---|---|
| `pnpm install` | 0 | 6 workspace-проектов, lockfile сходится с supply-chain политикой |
| `pnpm install --frozen-lockfile` в отдельном worktree на коммите `7ebb7b8` | 0 | закоммиченный lockfile согласован с закоммиченными манифестами |
| `pnpm run check` в том же worktree (`7ebb7b8`, чистое дерево коммита) | 0 | `smoke: all steps passed`, `tests 83 / pass 83 / fail 0` — закоммиченное состояние зелёное |
| `pnpm --filter @dsh-mywork/storage run typecheck` | 0 | `tsc --noEmit` по новому пакету (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) |
| `pnpm --filter @dsh-mywork/storage run build` | 0 | `tsdown` → `lib/index.js` + `.d.ts`; внешние импорты — только `node:*` |
| `pnpm run check` в общем рабочем дереве | 1 | **не дефект MW-004**: падает `packages/adapter-sdk` (TS4114 в `src/errors.ts`) — незакоммиченная работа MW-005, которая лежит в дереве поверх моих коммитов (см. §6.5) |
| `node --test --test-isolation=none tests/storage.test.mjs tests/storage-crash.test.mjs` | 0 | 17 новых тестов `ok` |
| `node scripts/verify-profile.mjs --dsh-bin <checkout>\apps\cli\lib\bin.js` | 0 | `verify:profile: PASS`: упаковка → `dsh plugin add` → boot → выгрузка в изолированном профиле; 3 fingerprint живого профиля не изменились |
| мутации A–I в собранном `packages/storage/lib/index.js` (§5.3) | 1 каждая | тесты падают на сломанной реализации; дерево восстановлено побайтово |
| `git check-ignore -v tests/lib/fixtures.mjs scripts/lib/process.mjs packages/storage/lib/index.js` | 0 | первые два больше не ignored, сборка пакета — ignored |
| `Get-ChildItem $env:TEMP -Directory -Filter 'dsh-mywork-*'` до/после прогона | — | 0 → 0: тесты не оставляют временных БД (в failing-прогоне `after()` сообщает об утечке, см. §6.4) |

---

## 5. Evidence

### 5.1 Полный конвейер

Прогон на дереве до появления незакоммиченной работы MW-005:

```text
$ pnpm run check
packages/contracts typecheck: Done   packages/storage typecheck: Done   packages/core typecheck: Done
packages/adapter-sdk typecheck: Done packages/controller typecheck: Done
packages/{contracts,adapter-sdk,core,storage,controller} build: ✔ Build complete
smoke: all steps passed
ℹ tests 83  ℹ pass 83  ℹ fail 0
CHECK_EXIT=0
```

Тот же конвейер на **закоммиченном** состоянии (`7ebb7b8`) в отдельном `git worktree`
(`.tmp/mw004-verify`, удалён после прогона), то есть без чужих незакоммиченных правок:

```text
$ pnpm install --frozen-lockfile        # 0: закоммиченный lockfile согласован с манифестами
$ pnpm run check
smoke: all steps passed
ℹ tests 83  ℹ pass 83  ℹ fail 0
WT_CHECK_EXIT=0
```

### 5.2 Приёмка карточки — где именно проверяется

| Требование | Проверка |
|---|---|
| Повторный event не меняет результат | `an event applied twice changes the result only once` (эффект выполнился один раз, второго события в outbox нет), `dedup is per consumer…` (у каждого потребителя свой журнал), `the outbox keeps one stream per workspace and is idempotent by event id` (повторный `append` → `duplicate: true`, строк не прибавилось) |
| Restart сохраняет данные | `a restart keeps the schema version, the queued events, and the dedup ledger` (envelope, `sequence`, журнал миграций и дедуп переживают `close()`+`openStore`), `two connections on one file share the state…`, повторное открытие в crash-тесте |
| Сбой между mutation и commit не оставляет половину изменения | `a failure between the mutation and the commit leaves no half change` (обе записи видны внутри транзакции, после throw — ни одной; повторный `applyOnce` применяется, то есть откат не оставил «половину»), `a process that dies between the mutation and the commit leaves no half change` (реальная смерть процесса: `process.exit(7)` внутри транзакции; после переоткрытия `outbox` пуст, дедуп не записан, `PRAGMA integrity_check = ok`, БД снова пишется), контрольный парный тест `a process that commits before exiting leaves the whole change` |
| Тесты в временной директории, живая БД DSH не используется | `the suite writes only into temporary directories` (путь БД под `os.tmpdir()`), `runtime state is rooted below DSH_HOME, never in the repository`, hook `after()` сравнивает состояние живого `$DSH_HOME/dsh-mywork` до и после всего файла; `openStore` требует путь явно, ин-мемори режим отклонён |
| schemaVersion, миграции, WAL | `a fresh database is stamped with the schema version, the journal, and WAL` (версия 1, журнал `[{1, outbox-inbox}]` с временем из подставленного `FakeClock`, `journal_mode = wal`, реальный `-wal`-файл, `foreign_keys = 1`), `migrations are ordered, and a failing migration leaves the previous version` (сломавшаяся миграция 2 → `migration-failed {version: 2, at: 1}`, таблицы `half` нет, версия и журнал = 1), `a database written by a newer build is refused, not downgraded` (`schema-version-unsupported {onDisk: 2, supported: 1}`), `two connections…` (миграция не применяется дважды) |
| Таблицы только под реализованное | `the tables are STRICT…` (STRICT реально включён: `cannot store TEXT value in INTEGER column`); в схеме ровно три таблицы |

### 5.3 Mutation-проверки (падают ли тесты на сломанной реализации)

Мутации вносились только в собранный `packages/storage/lib/index.js` и полностью откатывались
записью исходных байт; после отката — `17 pass / 0 fail`.

| # | Мутация | Результат |
|---|---|---|
| A | снять проверку дедупа в `applyOnce` | 14 pass / **3 fail** |
| B | убрать `ROLLBACK` при throw из тела транзакции | 14 pass / **3 fail** |
| C | переиспользование `eventId` с другим содержимым не считать конфликтом | 16 pass / **1 fail** |
| D | не включать WAL | 1 pass / **16 fail** |
| E | принимать БД с более новой версией схемы | 16 pass / **1 fail** |
| F | `sequence` всегда 1 (не монотонный поток) | 9 pass / **8 fail** |
| G | штамповать версию, не выполняя `up()` | 5 pass / **12 fail** |
| H | убрать `COMMIT` | 3 pass / **14 fail** |
| I | убрать `BEGIN IMMEDIATE` | 1 pass / **16 fail** |

### 5.4 Сверка с реальным SDK/окружением (не с примером из архитектуры)

| Механизм | Источник (проверено в этой сессии) |
|---|---|
| Драйвер: `node:sqlite` (`DatabaseSync`, синхронные `prepare/run/get/all`, опция `timeout`, `PRAGMA user_version`) | собственный код DSH: `packages/storage/storage-sqlite/src/schema.ts`, `packages/session-query/session-query-sqlite/src/schema.ts` (`node:sqlite`, `foreign_keys=ON`, `journal_mode`, `user_version`, STRICT-таблицы, owner-only файл) |
| Порядок разрешения `$DSH_HOME` | `packages/util/home-paths/src/index.ts` (`resolveDshHome`), тесты `home-paths.spec.ts` |
| `PRAGMA user_version` участвует в транзакции (откатывается) | прямой probe: `BEGIN IMMEDIATE; PRAGMA user_version=7; ROLLBACK` → 0; `COMMIT` → 3 |
| WAL-файлы живут, пока соединение открыто | probe: `registry.sqlite-wal`/`-shm` есть при открытом соединении, после `close()` остаётся только `.sqlite` |
| Ошибка STRICT-нарушения | probe: `cannot store TEXT value in INTEGER column …` (использовано в тесте) |
| Повторный `BEGIN` в SQLite | probe: `cannot start a transaction within a transaction` (поэтому вложенность ловится своим кодом раньше) |
| Event envelope §43 и `MYWORK_EVENT_TYPES` | `packages/contracts/src/events.ts` (MW-003): store не изобретает свой формат, а валидирует тип по словарю домена |

### 5.5 Изоляция от живого окружения

`verify:profile` в изолированном `DSH_HOME` (`H:\Repo\DSH-MyWork\.tmp\verify-profile`) прошёл
целиком, живой профиль не перезапускался, доска и живой ledger не читались и не менялись;
`C:\Users\Dmitry\.dsh\dsh-mywork` не создан (проверено `Test-Path` → `False`).

---

## 6. Ограничения и что осталось непроверенным

### 6.1 Приёмка зависимости MW-003

Зависимость проверена по исходникам, а не по статусу: `pnpm run check` на дереве MW-003 → exit 0,
`62 pass / 0 fail`, контракты и переходы на месте. Отдельного независимого ревьюера у MW-003 не
было — ревью и повторную верификацию исправлений выполнял субагент той же карточки; независимое
ревью MW-002 (`reports/MW-002-review.md`) отсутствует. Владелец закрыл MW-003 и снял ревью-статусы,
поэтому работа продолжена. Если дефект в контрактах (envelope, коды §42, `OperationMeta`) будет
найден позже, он затронет и MW-004: store валидирует события по этим контрактам.

### 6.2 Границы объёма (сознательно не сделано)

1. **Upgrade-машинерия §61.** Реализовано применение миграций, версия схемы и журнал.
   `backup → migrate → verify → activate`, export/import, repair и rollback policy — MW-040;
   журнал `schema_migrations` для этого и оставлен расширяемым.
2. **Доменные таблицы и репозитории.** `attempts`, `leases`, `reviews`, `artifacts`,
   `audit_events`, `task_bindings`, `context_snapshots`, … не создавались: их добавят миграции
   MW-006/MW-008/MW-010 вместе с реализующими их репозиториями.
3. **Fence уровня задачи.** MW-003 §6.2.4/§7.2 откладывал «наибольший выданный для задачи
   токен» до MW-004/MW-010. В MW-004 он не появился: lease store — это домен/попытки (§8),
   а карточка MW-004 ограничена kernel'ом хранения (schemaVersion, миграции, WAL, outbox/inbox).
   Если владелец считает иначе, это уточнение объёма, а не дефект кода.
4. **Publisher/consumer-циклы.** Store даёт `pending`/`markDelivered`/`markFailed` и `applyOnce`,
   но фоновой доставки и реконсиляции нет — это scheduler/reconciler (MW-012/§9).
5. **Интеграция с контроллером.** `openStore` не вызывается из плагина; открытие stores при
   activation и освобождение при dispose — MW-009.
6. **Доска, живой профиль, чужие проекты не затрагивались**; платные LLM-пробы, другие модели
   и субагенты не запускались.

### 6.3 Платформенная зависимость `node:sqlite`

Драйвер — stdlib Node (`node:sqlite`, в типах Node помечен experimental), как и в собственных
SQLite-пакетах DSH. Third-party зависимости не добавлены (`packages/storage` не имеет
`dependencies`; в сборке внешними остаются только `node:*`). Если целевой платформой станет
Node без `node:sqlite`, потребуется отдельное решение о драйвере.

### 6.4 Эксплуатационные свойства, которые стоит знать владельцу

1. **WAL обязателен.** Если файловая система отказывает в WAL, открытие падает
   (`invalid-input` с `journalMode` в деталях), а не деградирует молча до rollback-journal.
2. **Ин-мемори режима нет.** `:memory:` отклоняется: карточка требует durable state, а тесты —
   временные каталоги, поэтому «недолговечного» режима у store нет.
3. **Один писатель.** Все записи идут через `transaction()` (`BEGIN IMMEDIATE`, `busy_timeout`
   5000 мс по умолчанию). Долгая транзакция блокирует других писателей до таймаута — это
   осознанный выбор в пользу §9 (saga + idempotency), но его нужно учитывать планировщику.
4. **Утечка временных каталогов при падении теста.** Если тест падает, оставив открытый
   handle, каталог в `%TEMP%` может не удалиться; `after()` теперь сообщает об этом явно
   (`temporary databases were left behind: …`) вместо молчаливой утечки. В обычном прогоне
   временных каталогов не остаётся (проверено 0 → 0).
5. **Один тест запускает процесс-потомок.** `tests/storage-crash.test.mjs` — единственное
   место, где тесты выходят за пределы процесса; spawn идёт с файловым stdio (тот же приём,
   что в `scripts/lib/process.mjs`), поэтому работает и в confined-шелле.

### 6.5 Общее рабочее дерево сейчас красное из-за чужой незакоммиченной работы

После моих четырёх коммитов в рабочем дереве осталась незакоммиченная работа MW-005
(`packages/adapter-sdk/src/*`, `packages/contracts/src/index.ts`, `packages/controller/*`,
`scripts/smoke.mjs`, `tests/adapters.test.mjs` и hunk `@dsh-mywork/adapter-sdk` в
`pnpm-lock.yaml`). На этом дереве `pnpm run check` падает в `packages/adapter-sdk`:

```text
packages/adapter-sdk typecheck: src/errors.ts(69,10): error TS4114: This member must have an 'override' modifier …
packages/adapter-sdk typecheck: src/errors.ts(120,10): error TS4114: This member must have an 'override' modifier …
CHECK_EXIT=1
```

Это не дефект MW-004: закоммиченное состояние `7ebb7b8` проверено отдельно в чистом worktree и
зелёное (§5.1). Чужая работа не менялась, не откатывалась и не коммитилась.

---

## 7. Открытые решения (по коду карточки)

1. **Кто штампует envelope.** §43 говорит, что identity (`eventId`, `sequence`, `occurredAt`)
   ставит event bus при добавлении в поток. В MW-004 это делает `outbox.append`: `eventId`
   генерируется (или принимается явно), `sequence` выделяется атомарно под write-lock.
   Если будущий bus (MW-012) захочет штамповать сам, ему достаточно передавать `eventId`
   и не позволять store выделять `sequence` — это правка в одном месте.
2. **Словарь ошибок хранения.** Введены собственные коды (`invalid-input`, `not-found`,
   `conflict`, `schema-version-unsupported`, `migration-failed`, `transaction-conflict`,
   `store-closed`), потому что 13 кодов §42 закрыты доменом и не описывают сбой схемы или
   транзакции. Маппинг в §42-коды — задача репозитория. Если владелец предпочитает один
   словарь, это отдельное решение (правка §42).
3. **Ключ дедупа `(consumer, eventId)`.** Выбран потому, что поток читают несколько
   потребителей (проекция, планировщик, audit) и у каждого свой журнал. Альтернатива —
   глобальный дедуп по `eventId` — потеряла бы независимость потребителей.
4. **Идемпотентность `append` по `eventId`.** Повтор с тем же id и тем же содержимым — no-op
   (`duplicate: true`), с другим содержимым — `conflict` («event id никогда не переиспользуется»).
   Это защищает от тихой потери события при ретрае саги (§9), но означает, что вызывающий
   обязан сохранять id между попытками.
5. **`sequence` выделяется в store, а не вызывающим.** Так монотонность потока workspace
   обеспечивается одной транзакцией; UNIQUE `(workspace_id, sequence)` — страховка.
6. **Порт часов узкий** (`{ now(): number }` вместо `ClockPort`): store никогда не спит,
   а структурная типизация позволяет передать и `systemClock` из `core`, и `FakeClock`.
7. **`markFailed` оставляет событие `pending`** (attempts+1, lastError, обрезка сообщения до
   1000 символов). Терминального `failed`/dead-letter нет: политика повторов — предмет
   планировщика.
8. **Новый пакет, а не расширение `core`.** Требуется границей `tests/boundaries.test.mjs`
   (домен не импортирует sqlite) и матрицей §8 (`MyWork DB` — отдельный authority).
9. **Исправление `.gitignore`.** Сделано по прямому решению владельца (§2.3) и затрагивает
   файл MW-002; эффект: `tests/lib/`, `scripts/lib/` стали видимыми для Git, сборка пакетов
   осталась ignored.

---

## 8. Как воспроизвести и что перепроверить

Статус карточки — **DONE**: работа закоммичена (`a032a30`, `3ad7aea`, `9fa00c1`, `7ebb7b8`),
ревью-статус снят решением владельца, отдельное независимое ревью не выполнялось — то есть
приёмка владельцем заявлена без него.

1. Воспроизвести на чистом коммите: `git worktree add --detach <path> 7ebb7b8`, затем
   `pnpm install --frozen-lockfile && pnpm run check` (ожидается exit 0: smoke 9 `ok`,
   `83 pass / 0 fail`, из них 17 новых). На общем рабочем дереве проверка сейчас красная
   из-за незакоммиченной работы MW-005 (§6.5).
2. Воспроизвести crash-тест отдельно: `node --test --test-isolation=none
   tests/storage-crash.test.mjs` (ожидается 2 `ok`, временных каталогов после прогона нет).
3. Повторить mutation-проверки §5.3 (или свои) — тесты должны падать.
4. Проверить транзакционную семантику по коду, а не по тестам: `src/sql.ts`
   (`withTransaction`), `src/store.ts` (запрет вложенности/async/закрытия внутри),
   `src/inbox.ts` (порядок «эффект → строка дедупа»), `src/outbox.ts` (выделение `sequence`,
   идемпотентность, конфликт).
5. Проверить, что таблицы создаются только миграцией и что схема STRICT; что миграция
   применяется ровно один раз при двух процессах (повторное чтение версии под write-lock).
6. Проверить, что тесты не касаются живого `$DSH_HOME` и живой БД DSH: `after()`-fingerprint,
   `openStore` требует явный путь, `:memory:` отклонён.
7. Оценить решения §7 (штамповка envelope, словарь ошибок, ключ дедупа, обязательный WAL,
   отсутствие ин-мемори режима) и ограничения §6.
8. Отдельно: оценить правку `.gitignore` (§2.3) и то, что теперь в Git видны `tests/lib/`
   и `scripts/lib/` (в том числе `scripts/lib/process.mjs` из MW-002 и `tests/lib/fixtures.mjs`
   из MW-003 — они ранее не попадали в репозиторий).
