# foundation-40 — F-40: BLOB-артефакты под триггерами, механика удаления

- **Задача:** `task-9` · **Исполнитель:** `hygiene-ops` · **Дата:** 2026-09-27 · **Шаг:** F-40 (`20-STEPS-foundation.md:1097-1128`), MW-008/040, D17, P22
- **Статус:** `READY_FOR_REVIEW`

## Шаг 0 плана (выполнен ранее субагентом, здесь воспроизведён по коду)

Шесть триггеров в `packages/evidence/src/schema.ts`: `artifacts_no_update` (`:65-68`), `artifacts_no_delete` (`:70-73`), `audit_events_no_update` (`:92-95`), `audit_events_no_delete` (`:97-100`), `artifacts_no_replace` (`:115-119`, `BEFORE INSERT … WHEN EXISTS`), `audit_events_no_replace` (`:121-125`). Маркеры: `mywork.artifact.immutable`, `mywork.audit.append-only`. `DELETE FROM artifacts` в коде не было ни одного.

## Изменённые пути

| Путь | Что сделано |
|---|---|
| `packages/evidence/src/artifacts.ts` | + `createArtifactRetentionMigration(version)`, `ARTIFACT_TOMBSTONE_DDL`, `ARTIFACT_DELETE_GUARD_DDL`, `markArtifactForDeletion`, `listArtifactDeletionCandidates`, `pruneArtifacts`, `dropArtifactDeleteGuard`, `cutoffOf` |
| `packages/evidence/src/index.ts` | **одна** строка экспорта (scope расширен Lead'ом; barrel — единственный writer на этап) |
| `tests/evidence/artifact-retention.test.mjs` | **Create** — 3 теста (новая директория `tests/evidence`) |

## Механика (как реализовано)

**Не снятие триггеров, а условный запрет** (`Не делать: не снимать триггеры целиком`):

```sql
CREATE TRIGGER artifacts_no_delete BEFORE DELETE ON artifacts
WHEN NOT EXISTS (SELECT 1 FROM artifact_tombstone WHERE artifact_id = OLD.artifact_id)
  OR EXISTS (SELECT 1 FROM audit_events WHERE artifact_id = OLD.artifact_id)
BEGIN
  SELECT RAISE(ABORT, 'mywork.artifact.immutable');
END;
```

- новый томбстоун-стол `artifact_tombstone (artifact_id PK, marked_at, reason) STRICT` создаётся той же миграцией;
- удаление разрешено **только** когда артефакт помечен И на него не ссылается append-only аудит (митигация (а) плана — в самой базе, а не в коде вызывающего);
- `artifacts_no_update` и `artifacts_no_replace` не тронуты: артефакт по-прежнему нельзя перезаписать, а `INSERT` с существующим `artifact_id` отвергается;
- `dropArtifactDeleteGuard(executor)` существует как **аварийный** путь (им пользуется тест шага 2 плана): он снимает только delete-триггер и возвращает его SQL, чтобы его можно было вернуть; ретенция им не пользуется.

**Dry-run** (митигация (б)): `listArtifactDeletionCandidates(executor, { olderThan })` возвращает `{ cutoff, candidates }` и ничего не удаляет; `pruneArtifacts` вызывает ту же выборку, удаляет **поимённо** найденные id и возвращает `{ cutoff, candidates, deleted }`. Порядок «сначала dry-run» зафиксирован в JSDoc: удаление необратимо.

**Номер миграции** — только от аллокатора (F-63), литерала нет: `createArtifactRetentionMigration(version)`; тест получает номер из `migration_allocations`. Фактический замер:

```text
occupied before allocating: 6 ; background_job -> 7 ; artifact-retention -> 8
extended canonical set: 1:outbox-inbox, …, 6:claim-saga, 7:background-job, 8:artifact-retention
triggers after F-40 migration: artifacts.artifacts_no_delete, artifacts.artifacts_no_replace,
  artifacts.artifacts_no_update, audit_events.*(3), controller_lease.controller_lease_epoch_monotonic,
  task_fence.task_fence_monotonic
```

## Команды

| Команда | Exit | Наблюдение |
|---|---|---|
| `corepack pnpm --filter @dsh-mywork/evidence run typecheck` | 0 | чисто |
| `corepack pnpm --filter @dsh-mywork/evidence run build` | 0 | `lib/index.js` собран (19,9 с) |
| `node --test --test-isolation=none tests/evidence/artifact-retention.test.mjs` | 0 | **`# pass 3` / `# fail 0`** (гейт F-40) |

Тесты: (1) обычный `DELETE` отвергается маркером; после `dropArtifactDeleteGuard` удаление проходит, а `UPDATE` всё ещё отвергается (снят только delete-триггер); версия схемы = выданная аллокатором. (2) артефакт, названный в аудите, не удаляется **даже с томбстоуном**; `INSERT` с существующим `artifact_id` отвергается (no_replace жив). (3) dry-run до пометки пуст, после пометки предсказывает ровно `['ev-old-free']` (свежий — вне окна, названный в аудите — исключён); реальный запуск удаляет 1, остаются `ev-fresh` и `ev-old-referenced`, защита после удаления на месте, невалидное окно отвергается `invalid-input`.

## Что не проверено / открытые пункты

- **Миграция F-40 не добавлена в `EVIDENCE_MIGRATIONS`** (канонический набор остаётся 1..6): номер обязан выдать аллокатор в composition root — это работа F-29/F-31 (env-ops). Пока этого нет, условный триггер существует только в тестах; боевая база продолжает жить с безусловным запретом, то есть **ретенция артефактов ещё не включена**.
- Политика «что считать секретом в теле» — `23-STEPS-quality.md` (D17: `refuse`, не `redact`); здесь только механика, как и требует план.
- Прогон dry-run на **реальной** базе перед первым боевым запуском не делался (боевой запуск не выполнялся вовсе).
- Конкурентная пометка/удаление из двух процессов не воспроизводились.
- Восстановление снятого аварийного триггера реализовано через возвращённый SQL; автоматического `restoreArtifactDeleteGuard` в API нет — при аварийном снятии SQL надо выполнить вручную (кандидат на уточнение в F-29).

---

## Закрытие находок ревью этапа 2 (task-16)

Ревью `verify-stage2-review-a.md` — PASS WITH FINDINGS; в файлах этого шага один **MAJOR** и **MINOR-4** (MINOR-1/2/3 закрыты в `foundation-37`, `foundation-35` и в тестах storage).

### MAJOR — tombstone не расходовался

**Было:** `pruneArtifacts` удалял артефакт и **оставлял** строку `artifact_tombstone`. Артефакт, созданный заново под тем же `artifact_id` (сага выводит id детерминированно), наследовал старую метку и удалялся ретенцией без новой авторизации.

**Стало:** в том же цикле, **после** успешного `DELETE FROM artifacts`, удаляется и метка (`if (removed === 1) DELETE FROM artifact_tombstone WHERE artifact_id = ?`). Порядок несущий: триггер `artifacts_no_delete` требует метку **в момент** удаления артефакта, поэтому «сначала метка» сломала бы саму операцию. Оба удаления идут в одной транзакции вызывающего.

**Регрессионный тест** (4-й в `tests/evidence/artifact-retention.test.mjs`, «a tombstone is spent with the artifact, so a reused id is not deleted again»): метка → `pruneArtifacts` удалил 1 → в `artifact_tombstone` 0 строк → пересоздание того же id → сухой прогон **не** показывает кандидата → повторный `pruneArtifacts` удаляет 0 → новый артефакт по-прежнему под guard (`ARTIFACT_IMMUTABLE_MARKER`).

**Доказательство невакуумности (мутация на моём же коде; hash до `A3A7BAD831A107DAD7ACE2A98F7B3D2BE8704BE500F91C6D78411362981BFFEC`, после restore — совпал):**

| Прогон | Exit | Наблюдение |
|---|---|---|
| до-фиксовый код (расход метки откачен) | 1 | `pass 3 / fail 1` — падает именно новый тест: `AssertionError: the mark is spent with the artifact it authorized` |
| после restore + пересборка evidence | 0 | **`pass 4 / fail 0`** (гейт) |

### MINOR-4 — контракт `pruneAuditEvents`

Комментарий обещал «guard вернётся в той же транзакции», хотя параметр — любое соединение. Формулировка сужена до фактического контракта: функция гарантирует **восстановление guard в `finally` на том же executor**, а единой операцией три шага делает транзакция вызывающего — `store.transaction(tx => pruneAuditEvents(tx, window))`; на голом соединении каждый стейтмент автокоммитится, поэтому «внутри транзакции» типом невыразимо и зафиксировано в JSDoc. Поведение не изменилось (`tests/storage/retention.test.mjs` 3/0). Отчёт `foundation-38` в этом шаге вне write-scope — его формулировка не поправлена (вопрос Lead'у).

## Гейты после закрытия находок

| Команда | Exit | Наблюдение |
|---|---|---|
| `node --test … tests/evidence/artifact-retention.test.mjs` | 0 | **pass 4 / fail 0** |
| `node --test … tests/storage/jobs-durable.test.mjs` | 0 | **pass 4 / fail 0** |
| `node --test … tests/storage/sqlite-pragmas.test.mjs` | 0 | **pass 3 / fail 0** |
| `node --test … tests/storage/retention.test.mjs` | 0 | **pass 3 / fail 0** |
| 12 сьютов storage+evidence вместе | 0 | **pass 35 / fail 0** |
| регресс storage/storage-crash/evidence/lease | 0 | **pass 61 / fail 0** |
| `Test-Path 'C:\Users\Dmitry\.dsh\dsh-mywork'` | — | **False** (живой дом не адресовался) |