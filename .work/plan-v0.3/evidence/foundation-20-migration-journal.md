# foundation-20 — F-20: журнал миграций проверяется при открытии

- **Задача:** `task-6` · **Исполнитель:** `hygiene-ops` · **Дата:** 2026-09-27 (13:09)
- **Шаг плана:** F-20 (`20-STEPS-foundation.md:550-568`), MW-040, D08
- **Статус:** `READY_FOR_REVIEW`

## Изменённые пути

| Путь | Что сделано |
|---|---|
| `packages/storage/src/migrations.ts` | `runMigrations` в конце вызывает `assertJournalConsistent(connection, migrations, connection.userVersion())`; новый приватный `assertJournalConsistent` |
| `packages/storage/src/errors.ts` | код `migration-journal-inconsistent` + константа `MIGRATION_JOURNAL_INCONSISTENT` |
| `tests/storage/migration-journal.test.mjs` | **Create** — 2 теста |

Журнал **не переизобретался**: таблица `schema_migrations` (`migrations.ts:96-103`), запись строки в транзакции миграции и `listAppliedMigrations` остались как были; добавлена только **верификация**.

## Правило проверки (как реализовано)

После цикла применения набор версий журнала сравнивается с `{ m.version | m ∈ migrations, m.version <= userVersion }`:

- `PRAGMA user_version` говорит, докуда база дошла; `schema_migrations` — какие миграции её туда привели; пишутся они в одной транзакции, поэтому расхождение = повреждённое состояние;
- расхождение → `StorageError` с кодом `migration-journal-inconsistent`, детали `{ userVersion, journal, expected }`; в тексте — точная причина и способ починки (MW-040);
- проверка выполняется и когда ничего не применялось (идемпотентное переоткрытие), и на пустой базе (`userVersion = 0`, журнал пуст → согласовано, ложного отказа нет);
- «строгость только для баз этого билда» (митигация плана) реализована как отсутствие спец-случая: база с `userVersion = 0` и пустым журналом согласована by construction.

## Команды

| Команда | Exit | Наблюдение |
|---|---|---|
| `node --test --test-isolation=none tests/storage/migration-journal.test.mjs` | 0 | **`# pass 2` / `# fail 0`** (гейт F-20) |
| `node --test --test-isolation=none tests/storage.test.mjs tests/storage-crash.test.mjs` | 0 | 17 pass / 0 fail — в том числе `a database written by a newer build is refused, not downgraded` → `schema-version-unsupported` **не сломан** (шаг 5 плана) |
| `node --test --test-isolation=none tests/storage/*` (4 файла) | 0 | 12 pass / 0 fail |

Тесты F-20:
1. открыть базу каноническим набором → удалить строку журнала для **третьей** миграции (`migrations[2]`, версия не литерал) → переоткрытие даёт `migration-journal-inconsistent` с `details.userVersion` = последняя версия и `details.journal` без удалённой; затем строка восстанавливается через `node:sqlite` и база **снова открывается** — проверка точная, а не «отказывать всегда»;
2. журнал содержит версию **больше** `user_version` (`last.version + 1`, вставлена вручную) → тот же типизированный отказ, при этом `schemaVersion` базы остаётся прежним; плюс проверка, что здоровую базу можно открыть дважды без ложного отказа.

## Что не проверено

- Базы, созданные **до** появления журнала (v1 без строк): при `userVersion >= 1` и пустом журнале такой файл теперь **отвергается**. Это соответствует плану («строгость для баз этого билда», риск зафиксирован в F-20), но реального такого файла в репозитории нет и эксперимент не ставился.
- Полный repo-wide прогон — гейт Lead'а.
- Конкурентное открытие двумя процессами (журнал проверяется после цикла, под тем же write-lock) отдельным тестом не покрыто; покрыто в `tests/storage.test.mjs` («two connections on one file share the state and each migration runs once», 17 pass).
