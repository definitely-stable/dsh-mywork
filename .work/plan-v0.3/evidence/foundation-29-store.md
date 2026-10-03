# F-29 · Composition root: открыть `controller.sqlite` полным списком миграций

**Статус: READY_FOR_REVIEW**

## Что сделано

1. В `app.ts` объявлен канонический список: `MYWORK_DATABASE_MIGRATIONS = canonicalMigrations([MYWORK_MIGRATIONS, EVIDENCE_MIGRATIONS, LEASE_MIGRATIONS, PLAN_MUTATION_MIGRATIONS, CLAIM_SAGA_MIGRATIONS])` — порядок ровно тот, что подтвердил Lead (`storage v1 → evidence v2,v3 → lease v4 → planner v5 → execution v6`).
2. `start()` создаёт `stateDir` (`mkdirSync(..., { recursive: true })`) и открывает **две** базы через `openStore` (единственный путь к SQL; сырого `node:sqlite` в app.ts нет): `registry.sqlite` и `controller.sqlite`, обе на полном списке.
3. Создан `tests/app-store.test.mjs` — 2 теста (гейт F-29).

## Изменённые пути

- Modify `packages/controller/src/app.ts`
- Create `tests/app-store.test.mjs`

## Таблица «команда → exit code → наблюдение»

| Команда | exit | Наблюдение |
| --- | --- | --- |
| `node --test --test-isolation=none tests/app-store.test.mjs` | **0** | `ℹ tests 2 / ℹ pass 2 / ℹ fail 0 / ℹ skipped 0` — **гейт F-29** |
| Тест 1 | 0 | до `start()` каталога `dsh-mywork/state` нет; после — есть `controller.sqlite` **и** `registry.sqlite` |
| Тест 2 | 0 | `store.migrations.map(m => m.version)` = `[1,2,3,4,5,6]`; `store.schemaVersion` = **6**; `store.migrations.length` = 6; `store.path` = `<home>\dsh-mywork\state\controller.sqlite` |
| Тест 2 (шаг 5 плана) | 0 | после `stop()` повторный `store.transaction(...)` бросает ошибку с `code === 'store-closed'` — утечки handle нет |
| `Select-String packages\controller\src\app.ts -Pattern 'openStore\('` | 0 | **2** (гейт F-30, он же доказывает, что база открыта через storage, а не сырым SQL) |
| `Select-String packages\controller\src\app.ts -Pattern 'sqlite\|DatabaseSync'` | 0 | 3 совпадения — **все** в именах файлов в комментариях (`controller.sqlite`, `registry.sqlite`); импорта `node:sqlite` нет |

## Канонический порядок — почему именно он

`openStore` → `runMigrations` → `validateMigrations` требует строго возрастающих уникальных версий. Порядок «lease до evidence» (из `FINAL-REPORT` §10) даёт `StorageError invalid-input: 2 follows 4`; здесь список идёт по версиям, и ни один номер не написан литералом — все шесть приходят из пакетов-владельцев, а любые **новые** таблицы обязаны спрашивать номер у `MigrationAllocator` (F-63), который привязан к этой же базе (`app.migrations`).

## Ограничения

- Обе базы открываются полным списком (в `registry.sqlite` появляются доменные таблицы). Это следует тексту шага F-30 («два store, оба на `MYWORK_DATABASE_MIGRATIONS`») и JSDoc `storage/src/index.ts:6`, где пример адресует именно две базы.
- `reconcile` у lease возвращает `{ operations: 0, leases: 0 }` — это ровно тот пример, что стоит в JSDoc `packages/lease/src/index.ts:19`; настоящий reconcile — отдельная карточка.
- Тесты обязаны передавать `dshHome` явно (и передают): иначе база создалась бы в живом доме.

## Что НЕ проверено

- Поведение на базе, созданной более старой версией (миграция «снизу вверх» от v1): тесты всегда создают базу с нуля.
- Поведение при одновременном открытии базы двумя процессами (WAL + busy_timeout) — вне шага.
