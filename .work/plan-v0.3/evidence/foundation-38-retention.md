# foundation-38 — F-38: retention — окна хранения для `outbox` / `inbox_dedup` / `audit_events`

- **Задача:** `task-9` · **Исполнитель:** `hygiene-ops` · **Дата:** 2026-09-27 · **Шаг:** F-38 (`20-STEPS-foundation.md:1049-1073`), MW-040, D17, P6/P22
- **Статус:** `READY_FOR_REVIEW`

## Изменённые пути

| Путь | Что сделано |
|---|---|
| `packages/storage/src/retention.ts` | **Create** — `pruneOutbox`, `pruneInboxDedup`, `pruneAuditEvents`, `RetentionWindow`, `PruneResult` (+ `compact` из F-39) |
| `packages/storage/src/index.ts` | реэкспорт |
| `tests/storage/retention.test.mjs` | **Create** — 3 теста |

## Шаг 0 плана: точная DDL, по которой чистим

Из `packages/evidence/src/schema.ts:75-90` (прочитано, а не выведено):

```sql
CREATE TABLE audit_events (
  position INTEGER PRIMARY KEY AUTOINCREMENT,
  audit_id TEXT NOT NULL UNIQUE, type TEXT NOT NULL,
  workspace_id TEXT NOT NULL, correlation_id TEXT NOT NULL,
  occurred_at INTEGER NOT NULL, task_id TEXT, attempt_id TEXT,
  review_id TEXT, agent_id TEXT, artifact_id TEXT, causation_id TEXT
) STRICT;
CREATE INDEX audit_events_workspace ON audit_events(workspace_id, position);
```

Колонка времени — **`occurred_at`**; для `outbox` окно идёт по `occurred_at`, для `inbox_dedup` — по `processed_at`.

## Реализация (кратко)

Три функции, каждая принимает **явное** окно `{ olderThan }` (окно — параметр, констант в коде нет, как требует D17), каждая возвращает `{ deleted, cutoff }`:

- `pruneOutbox` — `DELETE FROM outbox WHERE status = 'delivered' AND occurred_at < ?`: **`pending`-событие не удаляется никогда**;
- `pruneInboxDedup` — `DELETE FROM inbox_dedup WHERE processed_at < ?`;
- `pruneAuditEvents` — единственный явный путь: читает SQL защитного триггера `audit_events_no_delete`, снимает его, выполняет `DELETE … WHERE occurred_at < ?` и **возвращает триггер дословно тем же текстом в `finally`** (на том же executor). Единой операцией три шага делает **транзакция вызывающего**, поэтому функцию следует звать через `store.transaction` — тип «внутри транзакции» в сигнатуре невыразим, и это сказано в JSDoc. Поправка после ревью этапа 2: прежняя формулировка утверждала, что транзакция гарантирована самой функцией, — это было обещание, которого тип не держит.

Невалидное окно (`-1`, дробное, `NaN`) отвергается `StorageError` с кодом `invalid-input` до любого удаления.

## Команды

| Команда | Exit | Наблюдение |
|---|---|---|
| `corepack pnpm --filter @dsh-mywork/storage run typecheck` / `run build` | 0 / 0 | чисто |
| `node --test --test-isolation=none tests/storage/retention.test.mjs` | 0 | **`# pass 3` / `# fail 0`** (гейт F-38) |

Тесты: (1) два доставленных старых события удалены (2 deleted), `pending` со тем же штампом и свежий `delivered` остались; (2) старые строки дедупа ушли (2 deleted), свежая осталась (иначе вернулась бы дубль-доставка); (3) журнал аудита: обычный `DELETE` сначала отвергается маркером `mywork.audit.append-only`, затем `pruneAuditEvents` удаляет 2 строки, свежая остаётся, триггер `audit_events_no_delete` **снова на месте** и снова отвергает `DELETE`, а невалидные окна (`-1`, `1.5`, `NaN`) отвергаются `invalid-input`.

## Что не проверено

- **Значения окон** (сколько именно хранить) — политика владельца D17 и `23-STEPS-quality.md`; в коде их нет сознательно, в тестах они выбраны произвольно.
- Предикат сканирования **тел** артефактов/памяти на секреты — `plan-quality`, не этот шаг (план это прямо оговаривает).
- Удаление под конкурентной нагрузкой (другой писатель в транзакции) не воспроизводилось; `DELETE` идёт внутри транзакции store.
- `pruneInboxDedup` не сравнивает окно с максимальным временем повторной доставки — это обязанность вызывающего (митигация плана реализована как параметр, а не как встроенная проверка).
