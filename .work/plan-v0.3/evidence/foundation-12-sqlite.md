ВОПРОС: какие PRAGMA выставляются при открытии SQLite в MyWork

**ПОДТВЕРЖДЕНО**
- SQLite открывается ровно в одном месте: `packages/storage/src/sql.ts:94` `new DatabaseSync(path, { timeout: options.busyTimeoutMs })`; других `new DatabaseSync` в `packages/**/src` и `tests/**` нет (grep: единственные совпадения — `sql.ts:15`, `sql.ts:94`).
- `journal_mode` = **WAL**: `packages/storage/src/sql.ts:130` `database.exec('PRAGMA journal_mode = WAL')` внутри `configure()` (`:128`).
- `foreign_keys` = **ON**: `packages/storage/src/sql.ts:129` `PRAGMA foreign_keys = ON`.
- WAL проверяется обратным чтением, fail-closed: `packages/storage/src/sql.ts:131-138` (`journal_mode !== 'wal'` → `StorageError('invalid-input', "…refused WAL…rollback journal")`); `configure()` вызывается в `try` при открытии — `sql.ts:95-100`, при throw соединение закрывается.
- `busy_timeout` задаётся **не** текстом `PRAGMA`, а опцией драйвера `{ timeout }`: `packages/storage/src/sql.ts:94`; значение по умолчанию `DEFAULT_BUSY_TIMEOUT_MS = 5_000` — `packages/storage/src/store.ts:28`; валидация «неотрицательное целое» — `store.ts:87-92`; проброс — `store.ts:93`.
- `user_version` — версия схемы: чтение `packages/storage/src/sql.ts:142-145`, запись `sql.ts:118` `PRAGMA user_version = ${Math.trunc(version)}` (`setUserVersion`, `sql.ts:117-119`); публичный геттер — `store.ts:130-133`, контракт — `sql.ts:47-50`, `store.ts:45`.
- Транзакции: `packages/storage/src/sql.ts:157-173` — `BEGIN IMMEDIATE` (`:158`), `COMMIT` (`:167`), `ROLLBACK` (`:178`).
- Тесты фиксируют факт: `tests/storage.test.mjs:119` `journal_mode === 'wal'`; `:120` `foreign_keys === 1`; `:124` наличие sidecar `-wal`.
- Проба `%TEMP%` (node v24, `node --input-type=module -e`, создан и удалён временный файл): `JOURNAL_MODE_DEFAULT={"journal_mode":"delete"}`, `synchronous={"synchronous":2}`, `foreign_keys={"foreign_keys":1}`, `auto_vacuum={"auto_vacuum":0}`, `busy_timeout={"timeout":0}`, `user_version={"user_version":0}`, `sqlite_version=3.53.3`, node-exit=0.
- Проба 2: опция `{ timeout: 5000 }` → `after_timeout_opt_busy_timeout={"timeout":5000}`; после `PRAGMA journal_mode=WAL` → `after_WAL_journal_mode={"journal_mode":"wal"}`, `after_WAL_synchronous={"synchronous":2}`; node-exit=0. Оба временных файла удалены (`cleaned=True`).

**ОПРОВЕРГНУТО / УТОЧНЕНО**
- **ОЖИДАНИЕ ОПРОВЕРГНУТО:** «`journal_mode` НЕ задаётся вообще, значит delete» — неверно. `packages/storage/src/sql.ts:130` задаёт WAL явно, а `:132-137` отказывает в открытии, если WAL не встал. Режим `delete` — только дефолт «голого» `DatabaseSync` (проба 1) до вызова `configure()`.
- `synchronous` **не выставляется** никаким кодом: `Select-String "PRAGMA\s+synchronous"` по `packages/storage/src/*.ts` → 0 совпадений; остаётся дефолт SQLite `2` (FULL) даже в WAL (проба 2). NB: `20-STEPS-foundation.md:858` предписывает добавить `synchronous = NORMAL` — это план, а не текущий код.
- `auto_vacuum` **не выставляется**: `Select-String "auto_vacuum|incremental_vacuum"` по `packages/storage/src/*.ts` → 0 совпадений; фактическое значение `0` (проба 1, 2) — т.е. утверждение `20-STEPS-foundation.md:953` («не выставляется вообще») верно.
- `VACUUM` в коде нет: 0 совпадений в `packages/storage/src/*.ts` и во всём `scripts/**` (recursive, `*.ts|*.mjs|*.ps1` → 0); упоминания `VACUUM` — только в `.work/**` (планы/отчёты), не в исполняемом коде.
- `busy_timeout` как SQL-строка отсутствует: 0 совпадений `PRAGMA\s+busy_timeout` в `packages/storage/src/*.ts`; уточнение по ключу ответа — `PRAGMA busy_timeout` возвращает колонку `timeout`, не `busy_timeout` (проба 2), т.е. поиск по имени `busy_timeout` в коде ничего не найдёт.
- `tests/**` (recursive): `journal_mode` встречается только в `tests/storage.test.mjs:119`; прочие `PRAGMA` — `integrity_check` в `tests/claim-saga.test.mjs:1059` и `tests/storage-crash.test.mjs:74`.

**НЕ ПРОВЕРЕНО**
- `scripts/` — прогнал recursive по `H:\Repo\DSH-MyWork\scripts` → 0 совпадений; отдельно «одной командой по scripts и tests» с glob `scripts\*` (нерекурсивно) тоже 0, но это не доказывает отсутствие вложенных каталогов, если `scripts/` пуст или содержит только подпапки — содержимое каталога не листал.
- Платформенные бэкенды DSH (`C:\Reposit\deepseek-harness\deepseek-harness\packages\storage\storage-sqlite`, `session-query-sqlite`) — не читал; вопрос про MyWork, но `sql.ts:5-9` ссылается на них как на образец.
- Живой профиль `C:\Users\Dmitry\.dsh\profiles\web` — не читал (в вопросе не требовалось).
- Реальные `*.sqlite` MyWork не найдены/не открывались: живых БД не искал, поэтому фактический `journal_mode` на диске подтверждён только косвенно (тест `storage.test.mjs:119` + чтение кода + проба на пустом файле).
- Намеренно не запускал: `pnpm install`, `pnpm run build`, полный прогон тестов, `node --test tests/storage.test.mjs` (разрешён, но не потребовался — доказательство уже есть в коде и тесте).
