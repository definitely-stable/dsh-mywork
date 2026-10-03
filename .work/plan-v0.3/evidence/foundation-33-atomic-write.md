# foundation-33 — F-33: атомарная запись состояния `writeFileAtomic`

- **Задача:** `task-9` · **Исполнитель:** `hygiene-ops` · **Дата:** 2026-09-27 · **Шаг:** F-33 (`20-STEPS-foundation.md:924-943`), RT-1/RT-10, D08
- **Статус:** `READY_FOR_REVIEW`

## Изменённые пути

| Путь | Что сделано |
|---|---|
| `packages/storage/src/atomic.ts` | **Create** — `writeFileAtomic`, `WriteFileAtomicOptions`, директивный `syncDirectory`; модульный JSDoc объясняет, почему временный файл лежит рядом с целью |
| `packages/storage/src/index.ts` | реэкспорт `writeFileAtomic` / `withFileLock` / констант и типов |
| `tests/storage/atomic-write.test.mjs` | **Create** — 2 теста |

## Реализация (кратко)

`writeFileAtomic(target, data, options?)`: временный файл `.<basename>.<pid>.<random>.tmp` **в том же каталоге** (rename атомарен только внутри тома) → `writeFile` → `handle.sync()` (fsync файла) → `rename` через инъектируемый шов `options.rename` (по умолчанию `node:fs/promises`) → best-effort fsync каталога (на Windows открытие каталога может быть отказано: ошибка глушится, запись уже атомарна). На любой ошибке временный файл удаляется, а прежнее содержимое цели остаётся.

## Команды

| Команда | Exit | Наблюдение |
|---|---|---|
| `corepack pnpm --filter @dsh-mywork/storage run typecheck` | 0 | `tsc --noEmit` чисто |
| `corepack pnpm --filter @dsh-mywork/storage run build` | 0 | `lib/index.js` собран (63+ kB), `writeFileAtomic` в бандле |
| `node --test --test-isolation=none tests/storage/atomic-write.test.mjs` | 0 | **`# pass 2` / `# fail 0`** (гейт F-33) |

Доказательство «до» (пункт evidence плана): `Select-String packages\storage\src\*.ts -Pattern 'writeFileAtomic|withFileLock'` до этой работы давал **0** совпадений — примитива в storage не было.

## Что не проверено

- Поведение на файловой системе, где `rename` **не** атомарен (сетевой том): митигация «временный в том же каталоге» реализована, но эксперимента с SMB/сетевым диском не было.
- fsync каталога на Windows фактически не выполняется (открытие каталога как файла запрещено ОС); это задокументировано в коде как best-effort.
- Одновременная запись одного файла двумя процессами — это F-34, проверено отдельно (foundation-34).
