# foundation-19 — F-19: запрет открытия store без явного набора миграций

- **Задача:** `task-6` · **Исполнитель:** `hygiene-ops` · **Дата:** 2026-09-27 (13:09)
- **Шаг плана:** F-19 (`20-STEPS-foundation.md:529-546`), D08 (вариант B)
- **Статус:** `READY_FOR_REVIEW`

## Изменённые пути

| Путь | Что сделано |
|---|---|
| `packages/storage/src/store.ts` | `OpenStoreOptions.migrations` — **обязательное** поле (+JSDoc «почему нет дефолта»); в `openStore` — runtime-отказ `MIGRATIONS_REQUIRED` до открытия файла; импорт `MYWORK_MIGRATIONS` убран |
| `packages/storage/src/errors.ts` | код `migrations-required` + константа `MIGRATIONS_REQUIRED` |
| `packages/storage/src/index.ts` | реэкспорт констант |
| `tests/storage/migrations-required.test.mjs` | **Create** — 2 теста |
| `tests/storage.test.mjs`, `tests/storage-crash.test.mjs`, `tests/lease.test.mjs`, `tests/lib/crash-child.mjs` | механические правки: у каждого вызова `openStore(` появился явный `migrations:` (файлы правились **по письменному разрешению Lead** — вне исходного write-scope `task-6`) |

Сообщение об отказе: `dsh-mywork: openStore requires an explicit migration list; pass MYWORK_DATABASE_MIGRATIONS`.
Проверка стоит **до** `openSqlite`, поэтому отказ не создаёт файл БД (проверено ассертом `existsSync(path) === false`).

## Канон кода ошибки (согласовано с Lead)

Значения в `STORAGE_ERROR_CODES` — в repo-стиле **kebab-case** (`migrations-required`, `migration-journal-inconsistent`); при этом экспортированы именованные константы `MIGRATIONS_REQUIRED` и `MIGRATION_JOURNAL_INCONSISTENT` с этими же значениями, чтобы буквальные идентификаторы плана/верификатора существовали. Согласование зафиксировано здесь одной строкой по просьбе Lead'а.

## Вызовы `openStore(` — что обновлено

| Где | Было без `migrations` | Что добавлено |
|---|---|---|
| `tests/storage.test.mjs` | 16 вызовов | `migrations: storage.MYWORK_MIGRATIONS` (набор ядра: тесты проверяют v1 и `MYWORK_SCHEMA_VERSION`) |
| `tests/storage-crash.test.mjs` | 3 вызова | то же |
| `tests/lease.test.mjs:97` | 1 вызов (`plain.sqlite`) | то же — тест проверяет отсутствие lease-схемы, набор ядра и есть корректный вход |
| `tests/lib/crash-child.mjs` | 1 вызов | `MYWORK_MIGRATIONS` из бандла storage |
| `tests/evidence.test.mjs`, `tests/claim-saga.test.mjs`, `tests/plan-mutation.test.mjs`, `tests/lib/claim-crash-child.mjs` | 0 | уже передавали явный набор — правок не потребовалось |

**Аудит `packages/**/src/*.ts` (ответ на вопрос Lead'а):** в исходниках пакетов **0** вызовов `openStore(` без явного `migrations`. Всего 11 совпадений: 10 — внутри JSDoc-примеров (во всех есть `migrations: [...]`), 11-е — само определение `packages/storage/src/store.ts:91`. Ни один вызов не требует нового владельца.

## Команды

| Команда | Exit | Наблюдение |
|---|---|---|
| `node --test --test-isolation=none tests/storage/migrations-required.test.mjs` | 0 | **`# pass 2` / `# fail 0`** (гейт F-19) |
| аудит `openStore(` по `packages/**/src/*.ts` (скрипт выше) | 0 | 0 вызовов без явного `migrations` |
| `node --test --test-isolation=none tests/storage.test.mjs tests/storage-crash.test.mjs` | 0 | 17 pass / 0 fail |
| `node --test --test-isolation=none tests/evidence.test.mjs tests/lease.test.mjs` | 0 | 44 pass / 0 fail |
| `node --test --test-isolation=none tests/claim-saga.test.mjs tests/plan-mutation.test.mjs` | 0 | 104 pass / 0 fail |
| `node --test --test-isolation=none tests/boundaries.test.mjs` | 0 | 26 pass / 0 fail (манифест storage без runtime-зависимостей не тронут) |
| `corepack pnpm --filter @dsh-mywork/storage run typecheck` / `run build` | 0 / 0 | см. foundation-18 |

Тесты F-19: (1) `openStore({ path })` → `StorageError` с `code === MIGRATIONS_REQUIRED`, файл не создан; (2) `openStore({ path, migrations: [] })` → тот же отказ, а **явный короткий набор** (`[MYWORK_MIGRATIONS[0]]`) открывается и даёт ровно то, что названо (`schemaVersion === 1`, одна строка журнала).

## Что не проверено

- Полный repo-wide прогон тестов и `pnpm run smoke` — гейт Lead'а.
- Прочие тесты, не запускавшиеся точечно (adapters/runtime/board/…): они не вызывают `openStore` (аудит), но repo-wide прогон их не подтверждал в этом шаге.
- Компиляционная половина запрета (обязательное поле) проверена только внутри монорепо (`tsc` пакетов storage/controller). Внешний JS-потребитель получит runtime-отказ — это и есть проверенный путь.
