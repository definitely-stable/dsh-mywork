# foundation-18 — F-18: единый реестр миграций `MYWORK_DATABASE_MIGRATIONS`

- **Задача:** `task-6` · **Исполнитель:** `hygiene-ops` · **Дата:** 2026-09-27 (13:09)
- **Шаг плана:** F-18 (`20-STEPS-foundation.md:497-526`), D08 (вариант B), правило §15.3 / R-04
- **Статус:** `READY_FOR_REVIEW`
- **HEAD:** `0c657ae1434202865bd330f0eeaf2b60eb78f6d4` (не коммитил — коммитит Lead)

## Изменённые пути

| Путь | Что сделано |
|---|---|
| `packages/storage/src/migrations.ts` | + `MigrationSource`, `canonicalMigrations(sources)`, `assertCanonicalMigrations(list)`, `MIGRATION_ALLOCATIONS_DDL` (DDL — под F-63) |
| `packages/storage/src/index.ts` | реэкспорт новых символов + `validateMigrations` (был не экспортирован); пример JSDoc переведён на явный `migrations` |
| `packages/storage/src/errors.ts` | коды `migrations-required`, `migration-journal-inconsistent` + константы `MIGRATIONS_REQUIRED`, `MIGRATION_JOURNAL_INCONSISTENT` (F-19/F-20) |
| `tests/storage/migrations-registry.test.mjs` | **Create** — 3 теста |

## Решение D08 и границы слоёв (важно для верификатора)

План называет экспорт `MYWORK_DATABASE_MIGRATIONS` / `MYWORK_DATABASE_SCHEMA_VERSION`, но `tests/boundaries.test.mjs:217-230` запрещает `packages/storage` зависеть от доменных слоёв (разрешены только `./`, `node:`, `@dsh-mywork/contracts`), а конкретные списки живут в `evidence`/`lease`/`planner`/`execution`. Поэтому реализовано ровно то разрешение, которое план и фиксирует (F-18, шаг 4; §Риски):

- **storage экспортирует порядок и проверку** — `canonicalMigrations(sources)` (слить + отсортировать + проверить) и `assertCanonicalMigrations(list)` (проверить `1..N` без дыр);
- **списки передаёт вызывающий**; константы `MYWORK_DATABASE_MIGRATIONS` / `MYWORK_DATABASE_SCHEMA_VERSION` создаёт composition root **F-29** (в этом шаге не создаются — вне scope `task-6`). Тесты F-18/F-20/F-63 собирают набор той же функцией, что будет вызывать F-29.

Набор версий, выданный реестром (получен запуском, **не литерал в тесте**):

```text
canonical: 1:outbox-inbox, 2:artifact-audit, 3:evidence-immutability, 4:controller-lease, 5:plan-mutation, 6:claim-saga
canonicalSchemaVersion: 6
```

Совпадает с «занято» из плана: v1 kernel (storage), v2–v3 evidence, v4 lease, v5 planner, v6 execution.

## Команды

| Команда | Exit | Наблюдение |
|---|---|---|
| `corepack pnpm --filter @dsh-mywork/storage run typecheck` | 0 | `tsc --noEmit` чисто (после правки кода ошибки: первая попытка дала TS2345 — литерал `'MIGRATION_JOURNAL_INCONSISTENT'` вместо константы) |
| `corepack pnpm --filter @dsh-mywork/storage run build` | 0 | `lib/index.js` 62.43 kB; в бандле есть `canonicalMigrations`, `assertCanonicalMigrations`, `MIGRATION_ALLOCATIONS_DDL`, `MIGRATIONS_REQUIRED = "migrations-required"` |
| `node --test --test-isolation=none tests/storage/migrations-registry.test.mjs` | 0 | **`# pass 3` / `# fail 0`** (гейт F-18). Первый прогон: `fail 1` — моя неверная посылка «префикс набора не каноничен»; исправлено на «дырка в середине» (`canonical.filter((_, i) => i !== 1)`), после чего 3/3 |
| `node --test --test-isolation=none tests/storage/*` (4 файла, регресс) | 0 | 12 pass / 0 fail |

Проверки в тесте (ожидания читаются из пакетов, литерала `[1,2,3,4,5,6]` нет):
1. канонический набор = объединение списков слоёв, версии строго возрастают, дублей нет;
2. версия схемы = последняя каноническая = максимум объявленных слоями, и набор плотный (`canonical.length === version`);
3. `validateMigrations(canonical)` и `assertCanonicalMigrations(canonical)` не бросают; набор с дырой и набор с дублем — `invalid-input`. Зафиксировано явно: **префикс** (например `[1]`) каноничен — правило «`1..N` без дыры», а не «один благословенный N»; это согласуется с F-19 («явность, а не единый полный набор»).

## Что не проверено

- Полный repo-wide прогон (`pnpm run check`, smoke) — гейт Lead'а, я его не запускал.
- Cобирает ли F-29 константы под именами `MYWORK_DATABASE_MIGRATIONS`/`MYWORK_DATABASE_SCHEMA_VERSION` — решение F-29, здесь только функции.
- Пропуск версии в середине отвергается, но **пере-упорядочивание** списков слоёв не проверялось: `canonicalMigrations` сортирует сам, поэтому порядок аргументов не важен (тест это не фиксирует отдельным кейсом).
