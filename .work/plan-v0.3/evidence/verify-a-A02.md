# verify-a-A02 — storage, миграции, инварианты схемы

Ревизия репозитория MyWork: `git rev-parse HEAD` = `0c657ae` (2026-09-22, H:\Repo\DSH-MyWork); `git status --short` — пусто (дерево чистое, план не устарел из-за правок).
Проверялось только чтением: `packages/storage/**`, `packages/{evidence,lease,planner,execution}/src/schema.ts`, `tests/**`, `.work/plan-v0.3/*.md`. DSH-checkout и живой профиль не требовались.
Никаких мутаций, install, build и прогонов тестов не выполнялось.

## Якорь A02-1 [B1]: 01-MASTER-PLAN.md:65 → packages/storage/src/migrations.ts:94 — «MYWORK_SCHEMA_VERSION = 1»

- **Вердикт:** ПОДТВЕРЖДЕНО
- **Что проверено:** read `packages\storage\src\migrations.ts` (строки 45-95); read `.work\plan-v0.3\01-MASTER-PLAN.md` offset 40 limit 130 (строка 65); grep `MYWORK_SCHEMA_VERSION` по `packages/**` (только `migrations.ts:94` и реэкспорт `storage/src/index.ts:46`); grep `MIGRATIONS: readonly Migration\[\]` (5 списков)
- **Фактическое значение:**
  - `:94` `export const MYWORK_SCHEMA_VERSION: number = MYWORK_MIGRATIONS[MYWORK_MIGRATIONS.length - 1]?.version ?? 0`
  - `:91` `export const MYWORK_MIGRATIONS: readonly Migration[] = Object.freeze([OUTBOX_INBOX])`, `:50` `version: 1,`
  - 01-MASTER-PLAN.md:65: «**`MYWORK_SCHEMA_VERSION = 1` не описывает базу**: 5 списков миграций / 6 версий (v1 kernel → v6 execution), склейка живёт только в тестах»
- **Оценка severity:** info
- **Комментарий:** Строка 94 — ровно та, что указана; значение производное (литерала `= 1` в коде нет), но фактически равно 1: список состоит из единственной миграции `version: 1`. Подтверждено и на уровне потребления — константа читается только тестом `tests/storage-crash.test.mjs:70` и реэкспортируется (`storage/src/index.ts:46`), в продакшн-пути её нет (`packages/storage/src/store.ts:84` берёт `options.migrations ?? MYWORK_MIGRATIONS`).

## Якорь A02-2 [B2]: 01-MASTER-PLAN.md:65 → packages/storage/src/migrations.ts — «5 списков миграций / 6 версий (v1 kernel … v6 execution)»

- **Вердикт:** ПОДТВЕРЖДЕНО
- **Что проверено:** grep `MIGRATIONS: readonly Migration[]` и `CREATE TABLE` по `packages/**/*.ts`; read `evidence/src/schema.ts:26,138-153`, `lease/src/schema.ts:22,66-74`, `planner/src/schema.ts:36,148-156`, `execution/src/schema.ts:48,153-161`; read 01-MASTER-PLAN.md:65, :294 (D08), `.work\plan-v0.3\evidence\lead-05-storage.md:8`
- **Фактическое значение:**
  - 5 списков: `MYWORK_MIGRATIONS` (migrations.ts:91, v1), `EVIDENCE_MIGRATIONS` (evidence/src/schema.ts:138, v2 `:140` + v3 `:147` при `EVIDENCE_SCHEMA_VERSION = 3`, `:26`), `LEASE_MIGRATIONS` (lease/src/schema.ts:66, `version: 4`), `PLAN_MUTATION_MIGRATIONS` (planner/src/schema.ts:148, `version: 5`), `CLAIM_SAGA_MIGRATIONS` (execution/src/schema.ts:153, `version: 6`)
  - план :65 «5 списков миграций / 6 версий (v1 kernel → v6 execution), склейка живёт только в тестах»
- **Оценка severity:** info
- **Комментарий:** Утверждение верно на уровне репозитория: пять экспортируемых списков, шесть непересекающихся версий 1…6 (проверено и по коду сборки: `validateMigrations` требует строго возрастающих версий, `migrations.ts:111-129`). Оговорка к «файлу» якоря: в самом `migrations.ts` лежит только один список и одна версия (v1 outbox-inbox); остальные четыре — в `evidence|lease|planner|execution/src/schema.ts`, что и создаёт дефект D-5 («склейка только у вызывающего»).

## Якорь A02-3 [B3]: 01-MASTER-PLAN.md:66 → packages/storage/src/migrations.ts:97-103,160-173 — «journal + транзакция на миграцию + BEGIN IMMEDIATE»

- **Вердикт:** ПОДТВЕРЖДЕНО
- **Что проверено:** read `migrations.ts` строки 96-103 и 142-184; read `sql.ts` строки 147-173; read 01-MASTER-PLAN.md:66
- **Фактическое значение:**
  - `:97-103` `const JOURNAL_DDL = \`\n  CREATE TABLE IF NOT EXISTS schema_migrations (\n    version    INTEGER NOT NULL PRIMARY KEY,\n    name       TEXT    NOT NULL,\n    applied_at INTEGER NOT NULL\n  ) STRICT\``
  - `:160-173` `const committed = withTransaction(connection, (): boolean => {` → `:163` `if (connection.userVersion() >= migration.version) return false` → `:165-170` `INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)` → `:171` `connection.setUserVersion(migration.version)`
  - `sql.ts:158` `connection.exec('BEGIN IMMEDIATE')` (примитив `withTransaction`, `:157-173`)
- **Оценка severity:** info
- **Комментарий:** Все три элемента на месте и в указанных строках: журнал — `:97-103`, одна транзакция на миграцию с перечитыванием `user_version` под write-lock — `:160-173`. Уточнение: сам `BEGIN IMMEDIATE` живёт не в `migrations.ts`, а в `sql.ts:158`; в цель якоря он попадает потому, что план на строке 66 ссылается на оба файла (`sql.ts:157-173` — предмет якоря A02-4), а `migrations.ts:160` вызывает этот примитив. Отказ при более новой БД (`:150-156`) и обёртка `migration-failed` (`:177-181`) подтверждают формулировку «транзакция на миграцию» буквально.

## Якорь A02-4 [B4]: 01-MASTER-PLAN.md:66 → packages/storage/src/sql.ts:157-173 — «атомарность записи / withFileLock / temp+rename как указано»

- **Вердикт:** ПОДТВЕРЖДЕНО
- **Что проверено:** read `sql.ts` строки 127-183; read 01-MASTER-PLAN.md:66; grep по репозиторию `withFileLock|flock` (0 совпадений), `\brename\b|renameSync` (только `scripts/pack.mjs:10,51` — упаковка tarball, и комментарии), `plan\.json|writeFile` в `packages/**` (только `packages/beads-adapter/src/adapter.ts:1052-1056`)
- **Фактическое значение:**
  - `sql.ts:157` `export function withTransaction<T>(connection: SqlExecutor, body: () => T): T {` / `:158` `connection.exec('BEGIN IMMEDIATE')` / `:167` `connection.exec('COMMIT')` / `:178` `connection.exec('ROLLBACK')`
  - план :66: «не хватает verify-шага, backup/rollback (MW-040) и адресата у `temp+rename`/`withFileLock` (всё состояние — один SQLite, единственная файловая запись — эфемерный `plan.json` для `bd`)»
- **Оценка severity:** info
- **Комментарий:** Диапазон 157-173 — ровно `withTransaction` (`BEGIN IMMEDIATE` → `COMMIT`, с `ROLLBACK` в обоих catch-ветках, `:162-171`), то есть «атомарность записи» подтверждена кодом. Негативная часть утверждения тоже верна и проверена поиском: `withFileLock` в репозитории не существует ни в одном файле (0 совпадений), поэтому «адресата» у него нет; единственная запись файла состояния в `packages/**` — `adapter.ts:1052-1056` (`mkdtemp` + `writeFile(join(dir, 'plan.json'))`, без `rename`), что совпадает с формулировкой плана. `renameSync` в `scripts/pack.mjs:51` перемещает собранный tarball контроллера и к состоянию store отношения не имеет.

## Якорь A02-5 [B5]: 01-MASTER-PLAN.md:66 → tests/storage-crash.test.mjs:59-93 — «kill-тест существует и проверяет прерывание миграции»

- **Вердикт:** ЛОЖНО
- **Что проверено:** read `tests\storage-crash.test.mjs` целиком (112 строк); read `tests\lib\crash-child.mjs` целиком (43 строки); read `tests\storage.test.mjs` строки 386-480; read 01-MASTER-PLAN.md:66 и :168
- **Фактическое значение:**
  - `storage-crash.test.mjs:59` `test('a process that dies between the mutation and the commit leaves no half change', async () => {`
  - `crash-child.mjs:25-28` `const store = await openStore({ path: databasePath }); store.transaction(tx => { tx.outbox.append(…); tx.inbox.applyOnce(…) });` → `:37-39` `if (mode === 'exit') { process.exit(7) }`
  - `storage-crash.test.mjs:70-71` `assert.equal(store.schemaVersion, storage.MYWORK_SCHEMA_VERSION, 'the schema survives the crash')` / `assert.deepEqual(store.migrations.map(row => row.version), [1])`
- **Оценка severity:** major
- **Комментарий:** Файл и строки 59-93 указаны точно, и kill-тест действительно существует — но он проверяет прерывание **транзакции данных** (outbox + inbox_dedup), а не миграции: дочерний процесс успевает применить и закоммитить v1 внутри `openStore`, и убивается уже внутри второй транзакции; тест это прямо фиксирует (`migrations == [1]`). Прерывание миграции доказывает другой тест — `tests/storage.test.mjs:392-423` («a failing migration leaves the previous version»: `migration-failed`, `details.at === 1`, БД остаётся v1, таблицы `half` нет). То есть свойство «атомарность миграции доказана» верно, но приписано не тому якорю; сам план на :168 требует тест «прерывания миграции, не оставляющий пустого store» как **будущий** гейт этапа 2, что косвенно подтверждает: сегодня такого теста нет.

## Якорь A02-6 [B6]: 01-MASTER-PLAN.md:149 → tests/boundaries.test.mjs:223-229 — «запрещает storage импортировать доменные пакеты»

- **Вердикт:** НЕВЕРНАЯ СТРОКА
- **Что проверено:** read `tests\boundaries.test.mjs` строки 200-230; read 01-MASTER-PLAN.md строки 146-162 и :318; grep `boundaries.test.mjs:223-229` по `.work/plan-v0.3/*.md`
- **Фактическое значение:**
  - `boundaries.test.mjs:223-224` `assert.equal(specifier.startsWith('@dsh-mywork/') && specifier !== '@dsh-mywork/contracts', false, \`storage: ${file} must not depend on the domain layer through "${specifier}"\`)`, `:227-229` `const storage = manifestOf('storage'); assert.equal(storage.dependencies, undefined …); assert.deepEqual(Object.keys(storage.devDependencies), ['@dsh-mywork/contracts'])`
  - Фактическая строка плана — `:161` «**Место реестра:** выше `storage` — `tests/boundaries.test.mjs:223-229` запрещает `storage` импортировать доменные пакеты» (та же ссылка на `:318`)
  - Строка `:149` — другой пункт этапа 1: «`bd`-seam на Windows: резолв JS-entry через `process.execPath`…»; ни `boundaries`, ни storage в ней нет
- **Оценка severity:** minor
- **Комментарий:** Содержание утверждения верно и подтверждено первоисточником (и кодом теста, и его ссылкой в плане), но ref-строка указана не та: 149 — пункт про `bd`-seam, фактическая — 161 (повтор на 318). Побочно подтверждена и цитируемая там причина: `FORBIDDEN_FOR_STORAGE` проверяется на строках 217-226, а манифест storage фиксирует отсутствие runtime-зависимостей.

## Якорь A02-7 [B7]: 01-MASTER-PLAN.md:291 / 10-DECISIONS.md:1444 → schema.ts ×5 — «16 таблиц без ограничителей роста (DELETE/UPDATE-запреты)»

- **Вердикт:** НЕВЕРНАЯ СТРОКА
- **Что проверено:** grep `CREATE TABLE (IF NOT EXISTS )?(\w+)` по `packages/**/*.ts` → ровно 16 совпадений; read `evidence/src/schema.ts:40-101,114-153`, `execution/src/schema.ts:87-150`, `lease/src/schema.ts:47-63`, `planner/src/schema.ts:59-145`, `storage/src/migrations.ts:49-82`; read 10-DECISIONS.md строки 1387-1462 (`:1390`, `:1444`, `:1446`); read 01-MASTER-PLAN.md строки 275-306 и :67
- **Фактическое значение:**
  - 10-DECISIONS.md:1444: «ни одна из 16 таблиц не имеет ограничителя… `outbox`, `inbox_dedup`, `schema_migrations` (`packages/storage/src/migrations.ts:54,72,98`); `artifacts`, `audit_events` (`packages/evidence/src/schema.ts:47,75`); `controller_lease` (`packages/lease/src/schema.ts:48`); `claim_intent`, `claim_step`, `attempt`, `task_fence` (`packages/execution/src/schema.ts:88,111,120,139`); `plan_revision`…`blocker_gate_decision` (`packages/planner/src/schema.ts:60,66,87,100,112,130`)»
  - Фактические строки мастера: `:303` «| D17 | Окна хранения по таблицам + `VACUUM` + сканер тел; **секрет → refuse, не redact** | 16 таблиц без ограничителей роста…» и `:67` (D-7) «Нет ограничителей роста БД: `outbox`, `inbox_dedup`, `audit_events`, BLOB-артефакты под запретом DELETE/UPDATE — растут вечно»; строка `:291` — это D05 (circuit-breaker: «60 шагов и 2M токенов на попытку»), к таблицам отношения не имеет
- **Оценка severity:** minor
- **Комментарий:** Число и перечень подтверждены независимо: grep даёт ровно 16 `CREATE TABLE` (storage 3: outbox `:54`, inbox_dedup `:72`, schema_migrations `:98`; evidence 2: artifacts `:47`, audit_events `:75`; lease 1: controller_lease `:48`; planner 6: `:60,66,87,100,112,130`; execution 4: `:88,111,120,139`) — совпадает со списком DECISIONS:1444. Неверна ссылка на строку мастера: 291 — это D05, а 16 таблиц стоят на 303 (D17) при наличии D-7 на 67; ссылка `10-DECISIONS.md:1444` точна. Уточнение по подписи файлов: `packages/evidence/src/schema.ts:60` — не начало таблицы, а `bytes BLOB NOT NULL` (цитируется в DECISIONS:1446 как носитель секрета); DELETE/UPDATE-запреты реально существуют ровно у двух таблиц (`artifacts`, `audit_events` — триггеры `_no_update`/`_no_delete`/`_no_replace`), остальные 14 растут без ограничителя.

## Якорь A02-8 [B8]: 10-DECISIONS.md:1134 → packages/storage/src/migrations.ts:49-82 + packages/storage/src/store.ts:30-39 — «содержимое, на которое ссылается D08»

- **Вердикт:** ПОДТВЕРЖДЕНО
- **Что проверено:** read 10-DECISIONS.md строки 1076-1148 (строка 1134) и 693-766 (D08: `:696`, `:715`, `:732`); read `migrations.ts` строки 45-95; read `store.ts` строки 26-45; grep `migrations.ts:49-82|store.ts:30-39` по 10-DECISIONS.md
- **Фактическое значение:**
  - 10-DECISIONS.md:1134: «Транспорт уже есть, и он свой: `outbox` + `inbox_dedup` в одной транзакции с мутацией (`packages/storage/src/migrations.ts:49-82`, `packages/storage/src/store.ts:30-39`)»
  - `migrations.ts:49` `const OUTBOX_INBOX: Migration = {` → `:54` `CREATE TABLE outbox (` → `:72` `CREATE TABLE inbox_dedup (` → `:82` `}`; `store.ts:31-33` «One unit of work: a mutation plus, in the same commit, the events it emits and the inbox rows that record the deliveries it consumed.»
  - D08 (`:715`) — «`packages/storage/src/migrations.ts:91` — `MYWORK_MIGRATIONS = [OUTBOX_INBOX]` (одна миграция версии 1, `:49-82`)»; (`:732`) — «несколько файлов ломают одну транзакцию на мутацию+события (`packages/storage/src/store.ts:30-39`)»
- **Оценка severity:** info
- **Комментарий:** Обе ссылки точны, и описанное содержимое совпадает дословно: v1 создаёт `outbox` и `inbox_dedup` (диапазон 49-82 — ровно определение `OUTBOX_INBOX`), а `store.ts:30-39` — контракт транзакции «мутация + её события + строки dedup в одном коммите». Оговорка по атрибуции: строка 1134 лежит внутри **D13** (Agent Teams, секция начинается на `:1076`), а не D08; D08 ссылается на те же диапазоны в `:715` и `:732`, поэтому утверждение «содержимое, на которое ссылается D08» верно по сути, но номер решения у этой строки — D13, а не D08.

---

**Сводка:** подтверждено 5 (A02-1, -2, -3, -4, -8), неверная строка 2 (A02-6: 149→161; A02-7: 291→303/67), ложно 1 (A02-5: kill-тест проверяет транзакцию, не миграцию), не существует 0, устарело 0, не проверено 0. Блокеров нет; единственная содержательная ошибка — A02-5 (major), обе ошибки ссылок — minor.
