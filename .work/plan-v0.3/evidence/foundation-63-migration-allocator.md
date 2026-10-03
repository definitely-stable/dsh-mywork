# foundation-63 — F-63: аллокатор версий миграций в composition-слое

- **Задача:** `task-6` · **Исполнитель:** `hygiene-ops` · **Дата:** 2026-09-27 (13:09)
- **Шаг плана:** F-63 (`20-STEPS-foundation.md:759-794`), D07/D08, дефект R-36, §15.3
- **Статус:** `READY_FOR_REVIEW`

## Изменённые пути

| Путь | Что сделано |
|---|---|
| `packages/storage/src/migrations.ts` | `MIGRATION_ALLOCATIONS_DDL` (таблица заявок рядом с журналом) + `connection.exec(...)` в bootstrap-блоке `runMigrations` (до первой миграции) |
| `packages/storage/src/index.ts` | реэкспорт `MIGRATION_ALLOCATIONS_DDL` |
| `packages/controller/src/migration-allocator.ts` | **Create** — единый аллокатор версий (composition-слой по D07) |
| `tests/storage/migration-allocator.test.mjs` | **Create** — 5 тестов |

## Интерфейс (как реализован)

```ts
interface MigrationRequest { readonly key: string }                 // 'background_job', 'retention-triggers', …
interface Allocation { readonly key: string; readonly version: number; readonly requestedAt: number }
interface MigrationAllocator { allocate(request: MigrationRequest): number; allocated(): readonly Allocation[] }
createMigrationAllocator(store: AllocationStore, options?: { now?: () => number }): MigrationAllocator
```

`allocate` целиком в одной транзакции store: `SELECT version WHERE key` → при отсутствии `max(занятые)+1` → `INSERT … ON CONFLICT(key) DO NOTHING` → `SELECT version WHERE key`. `max` = максимум из (а) `MAX(schema_migrations.version)`, (б) `PRAGMA user_version`, (в) `MAX(migration_allocations.version)`. **Ни одного номера литералом** — гейт `version: \d` = 0 совпадений.

Таблица заявок (`key TEXT PRIMARY KEY, version INTEGER NOT NULL UNIQUE, requested_at INTEGER NOT NULL`, STRICT) создаётся bootstrap-DDL до первой миграции — поэтому у аллокатора нет собственной версии (цикличность разорвана, факт 1 плана).

## Команды

| Команда | Exit | Наблюдение |
|---|---|---|
| `node --test --test-isolation=none tests/storage/migration-allocator.test.mjs` | 0 | **`# pass 5` / `# fail 0`** (гейт F-63) |
| `Select-String packages/controller/src/migration-allocator.ts -Pattern 'version: \d'` | — | **0 совпадений** (номер не литерал) |
| `corepack pnpm --filter @dsh-mywork/controller run typecheck` | 0 | `tsc --noEmit` чисто (файл в `src`, `include: ["src", …]`) |
| `corepack pnpm --filter @dsh-mywork/storage run typecheck` / `run build` | 0 / 0 | бандл содержит `MIGRATION_ALLOCATIONS_DDL` и `connection.exec(MIGRATION_ALLOCATIONS_DDL)` |
| `node --test … tests/storage/*` (регресс 4 файлов) | 0 | 12 pass / 0 fail |
| evidence-скрипт (TEMP, вне репозитория) | 0 | см. ниже |
| evidence-скрипт «существующая база» (TEMP) | 0 | `DROP TABLE migration_allocations` → переоткрытие: `table recreated = true` (факт 2 плана подтверждён эмпирически) |

Наблюдаемые числа (получены запуском, не литералом в тестах):

```text
canonical: 1:outbox-inbox, 2:artifact-audit, 3:evidence-immutability, 4:controller-lease, 5:plan-mutation, 6:claim-saga
highest occupied before allocating: 6
allocate background_job    -> 7   (повторный вызов -> 7)
allocate retention-triggers -> 8
allocated(): [{"key":"background_job","version":7,"requestedAt":1700000000000},{"key":"retention-triggers","version":8,…}]
PASS  allocated set validates; versions = 1,2,3,4,5,6,7,8
REFUSED gapped set: invalid-input | dsh-mywork: the canonical migration set must be gapless from version 1; found 8 where 7 was expected…
```

Пять тестов: (1) идемпотентность по заявке + отказ на пустой ключ (`invalid-request`); (2) разные заявки — разные номера, оба строго выше занятого максимума, прочитанного из БД; (3) перезапуск store не выдаёт заново уже выданное и не переиспользует номера; (4) удаление строки заявки не освобождает номер; (5) канонический набор + миграция с выданным номером проходит `validateMigrations`, а дубль номера отвергается `invalid-input`.

## Решения и отклонения (для верификатора)

1. **Тест импортирует `packages/controller/src/migration-allocator.ts` напрямую** (Node 24 стрипает типы). Причина: у controller один entry — `src/index.ts`, а мой write-scope — ровно один файл `src/migration-allocator.ts`; встраивание в публичную поверхность controller — работа **F-29** (composition root), туда и вынесено. `import type` из `@dsh-mywork/storage` стирается на рантайме и не создаёт зависимости.
2. **DDL таблицы заявок продублирован в аллокаторе** (`CREATE TABLE IF NOT EXISTS`): `packages/controller/node_modules/@dsh-mywork/` содержит только `adapter-sdk`, `contracts`, `core` — value-импорт storage из controller **не разрешится в рантайме**, поэтому аллокатор обязан быть самодостаточным. На любой базе этого билда таблица уже создана bootstrap'ом → `IF NOT EXISTS` = no-op (проверено evidence-скриптом).
3. **Известное ограничение «сгорания»:** номер помнит только живые строки `migration_allocations` + журнал + `user_version`. Если удалить строку заявки с **максимальным** номером, этот номер может быть выдан снова — формула `max(а,б,в)+1` из шага 6 плана иного не позволяет. Тест 4 проверяет то, что план формулирует буквально (удаление строки не освобождает номер: следующий `allocate` берёт следующий за максимумом). Открытый вопрос для владельца, если нужно «сгорание» навсегда — понадобится отдельный watermark.
4. Код ошибки аллокатора — локальный `MigrationAllocatorError` с `code: 'invalid-request'` (класс `StorageError` нельзя импортировать значением, см. п. 2).

## Что не проверено

- Гонка двух процессов на `allocate`: защита держится на одной транзакции store + `UNIQUE(key)` + `UNIQUE(version)`, но двухпроцессный эксперимент не ставился.
- Встраивание аллокатора в `packages/controller/src/index.ts` и пересборка бандла — F-29 (вне scope). `packages/controller/lib/index.js` не изменялся, `tests/boundaries.test.mjs` (26 pass / 0 fail) это подтверждает.
- `allocated()` на закрытом store (должен падать `store-closed` силами store) — отдельным тестом не покрыто.
- Полный repo-wide прогон `pnpm run check` — гейт Lead'а.
