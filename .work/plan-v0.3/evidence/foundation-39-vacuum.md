# foundation-39 — F-39: `VACUUM` и возврат места файловой системе

- **Задача:** `task-9` · **Исполнитель:** `hygiene-ops` · **Дата:** 2026-09-27 · **Шаг:** F-39 (`20-STEPS-foundation.md:1077-1093`), MW-040, D17, P6
- **Статус:** `READY_FOR_REVIEW`

## Изменённые пути

| Путь | Что сделано |
|---|---|
| `packages/storage/src/retention.ts` | + `compact(options)`, `CompactOptions`, `CompactResult` |
| `packages/storage/src/index.ts` | реэкспорт `compact`, `openSqlite` (нужен шагу и тесту) |
| `tests/storage/vacuum.test.mjs` | **Create** — 2 теста |

## Шаг 0 плана

`Select-String packages\storage\src\*.ts -Pattern 'auto_vacuum|incremental_vacuum|VACUUM'` до работы → **0** совпадений (ни `VACUUM`, ни `auto_vacuum` в исполняемом коде не было). После F-35 `auto_vacuum = INCREMENTAL` выставляется на новых базах; этот шаг добавляет возврат места.

## Как работает `compact({ path })` (подтверждено Lead'ом как решение)

1. `VACUUM` **нельзя** выполнять внутри транзакции, а `store.transaction()` всегда открывает `BEGIN IMMEDIATE`; поэтому `compact` **открывает собственное соединение** через `openSqlite({ path, busyTimeoutMs })` и закрывает его в `finally`. `store.ts` при этом не менялся.
2. Шаги: `PRAGMA wal_checkpoint(TRUNCATE)` (переносит содержимое WAL в основной файл и усекает журнал) → `PRAGMA auto_vacuum = INCREMENTAL` (база, созданная до F-35, перенимает режим при первом `VACUUM`) → `VACUUM` (перезапись файла = фактическое уменьшение).
3. `fileSizeBefore`/`fileSizeAfter` снимаются `statSync` до и после; возвращается `{ fileSizeBefore, fileSizeAfter, checkpointed: true, vacuumed: true }` (на ошибке функция бросает, поэтому «частичного» результата не бывает).
4. Риск плана (`VACUUM` берёт эксклюзивную блокировку) снят не кодом, а регламентом: функция вызывается по расписанию как durable job (F-37), никогда — на пути обработки запроса. Это зафиксировано в JSDoc.

## Фактический замер (не по коду, а запуском)

```text
F-39 pruned=400 rows ; size 2080768 -> 212992 bytes ; compact took 19 ms ; checkpointed=true vacuumed=true
```

То есть после удаления 400 доставленных событий с payload 4 КиБ файл уменьшился с **2 080 768** до **212 992** байт (в 9,8 раза), компакция заняла **19 мс**. Именно эти числа проверяет тест 1 (он снимает `statSync` до и после и сверяет с возвращёнными значениями).

## Команды

| Команда | Exit | Наблюдение |
|---|---|---|
| `corepack pnpm --filter @dsh-mywork/storage run typecheck` / `run build` | 0 / 0 | чисто |
| `node --test --test-isolation=none tests/storage/vacuum.test.mjs` | 0 | **`# pass 2` / `# fail 0`** (гейт F-39) |

Тесты: (1) после `pruneOutbox` (400 строк) файл уменьшается, возвращённые размеры совпадают с `statSync`, `vacuumed === true`; (2) после компакции база открывается снова, `schemaVersion` не изменился, `pending`-событие на месте и файл снова пишется; путь, который не является базой (`notes.txt`), отвергается — `compact` не «проглатывает» чужой файл.

## Что не проверено

- **Поведение под нагрузкой:** тест меряет пустую базу (никто не держит блокировок). На реальной базе с активным писателем `VACUUM` может получить `SQLITE_BUSY`; митигация — вызов в простое, но конкурентный сценарий не воспроизводился.
- `incremental_vacuum` как отдельное действие не используется: эксперимент показал, что `wal_checkpoint(TRUNCATE)` + `VACUUM` достаточно (минимально достаточное действие, как и просил план). Замер того, что только checkpoint без `VACUUM` не уменьшает файл, отдельно не снимался.
- Расписание компакции (durable job) — F-31/F-37 в `packages/controller`, не этот шаг.