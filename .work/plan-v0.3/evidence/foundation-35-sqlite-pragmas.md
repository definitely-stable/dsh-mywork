# foundation-35 — F-35: SQLite-настройки открытия `synchronous` и `auto_vacuum`

- **Задача:** `task-9` · **Исполнитель:** `hygiene-ops` · **Дата:** 2026-09-27 · **Шаг:** F-35 (`20-STEPS-foundation.md:970-994`), D08
- **Статус:** `READY_FOR_REVIEW`

## Изменённые пути

| Путь | Что сделано |
|---|---|
| `packages/storage/src/sql.ts` | `configure(database, path, synchronous)`: добавлены `PRAGMA synchronous = <NORMAL|FULL>` и `PRAGMA auto_vacuum = INCREMENTAL`; `OpenSqliteOptions.synchronous?: 'NORMAL' \| 'FULL'` (по умолчанию `NORMAL`) |
| `packages/storage/src/index.ts` | реэкспорт `openSqlite` + `OpenSqliteOptions` (нужен тесту и `compact()` из F-39) |
| `tests/storage/sqlite-pragmas.test.mjs` | **Create** — 3 теста |

## Порядок прагм — важное наблюдение

`auto_vacuum` учитывается SQLite только пока в базе **нет схемы**, причём переключение `journal_mode` в WAL уже записывает страницу 1. Первая реализация ставила `auto_vacuum` после WAL — `PRAGMA auto_vacuum` возвращал `0` (тест это поймал), то есть прагма молча игнорировалась. Итоговый порядок в `configure()`: `foreign_keys` → **`auto_vacuum`** → `journal_mode = WAL` (+ fail-closed перечитывание) → `synchronous`.

## Значения PRAGMA до/после (замер запуском, не по коду)

| PRAGMA | «до» (по `evidence/foundation-12-sqlite.md`) | «после» | Ожидание теста |
|---|---|---|---|
| `journal_mode` | `wal` (уже было) | `wal` | не дефект, регрессия |
| `foreign_keys` | `1` (уже было) | `1` | не дефект, регрессия |
| `busy_timeout` | опция драйвера | `5000` | не дефект, регрессия |
| `synchronous` | `2` (FULL по умолчанию драйвера) | **`1` (NORMAL)** | исправлено |
| `auto_vacuum` | `0` | **`2` (INCREMENTAL)** | исправлено |

Строка фактического замера:

```text
F-35 journal_mode=wal foreign_keys=1 synchronous=1 auto_vacuum=2 busy_timeout=5000
F-35 explicit FULL synchronous=2
```

**Уточнение (закрытие MINOR-2 ревью этапа 2, task-16):** `auto_vacuum = INCREMENTAL` **не возвращает страницы сам** — он лишь готовит базу к инкрементальной уборке, освобождённые страницы остаются во freelist (замер ревьюера: файл не уменьшился, `freelist = 457`, `incremental_vacuum` в коде отсутствует). Освобождение делает явный `compact()` из F-39 (`wal_checkpoint(TRUNCATE)` + `VACUUM`). Формулировка в комментарии `sql.ts` исправлена; тест дополнительно фиксирует переход существующей базы `0 → 2` именно через `compact()`.

## Команды

| Команда | Exit | Наблюдение |
|---|---|---|
| `corepack pnpm --filter @dsh-mywork/storage run typecheck` | 0 | чисто |
| `corepack pnpm --filter @dsh-mywork/storage run build` | 0 | бандл собран |
| `node --test --test-isolation=none tests/storage/sqlite-pragmas.test.mjs` | 0 | **`# pass 3` / `# fail 0`** (гейт F-35) |
| `node --test --test-isolation=none tests/storage.test.mjs tests/storage-crash.test.mjs` | 0 | 17 pass / 0 fail (регрессия из шага 5 плана) |

Тесты: (1) WAL + foreign_keys + busy_timeout остались (регрессия, «не дефект»); (2) `synchronous` = 1 по умолчанию и 2 при явном `synchronous: 'FULL'` через `openSqlite`; (3) свежая база создаётся с `auto_vacuum = 2`.

## Что не проверено

- Потеря последних коммитов при крахе ОС на `NORMAL`/WAL: не воспроизводилась (это свойство SQLite, а не наша логика); значение — параметр, `FULL` доступен явно.
- База, созданная **до** F-35, остаётся в `auto_vacuum = 0` до первого `VACUUM`; режим перенимается при `compact()` (F-39) — это отдельный шаг, здесь не проверялось.
- `synchronous` через `openStore` не пробрасывается (store.ts вне scope этого шага): параметр живёт на уровне `openSqlite`.
