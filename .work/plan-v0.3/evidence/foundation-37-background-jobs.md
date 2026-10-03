# foundation-37 — F-37: реестр durable-джобов поверх таблицы `background_job`

- **Задача:** `task-9` · **Исполнитель:** `hygiene-ops` · **Дата:** 2026-09-27 · **Шаг:** F-37 (`20-STEPS-foundation.md:1027-1045`), MW-068, D09
- **Статус:** `READY_FOR_REVIEW`

## Изменённые пути

| Путь | Что сделано |
|---|---|
| `packages/storage/src/background-jobs.ts` | + реестр: `enqueueBackgroundJob`, `listBackgroundJobs`, `claimDueBackgroundJob`, `settleBackgroundJob` и типы записей/фильтров |
| `packages/storage/src/index.ts` | реэкспорт |
| `tests/storage/jobs-durable.test.mjs` | **Create** — 3 теста |

## Реализация (кратко)

Все четыре функции — чистые функции над `SqlExecutor`, то есть вызываются **внутри** транзакции store: регистрация работы коммитится вместе с изменением состояния, которое её запланировало (та же дисциплина, что у outbox).

`claimDueBackgroundJob`: сначала `SELECT job_id … WHERE status IN ('pending','running') AND (lease_until IS NULL OR lease_until < ?)` (плюс фильтр по `kind`), затем `UPDATE … SET status='running', owner=?, lease_until=?, attempts=attempts+1` **с тем же предикатом** и проверкой `changes === 1` — это ровно та митигация, которую требует план против двух контроллеров. `lease_until = now + leaseMs`, и работа с истёкшей лизой снова доступна (recovery после падения процесса). `settleBackgroundJob` переводит в терминальный статус или возвращает в пул (`pending`) и снимает лизу.

## Команды

| Команда | Exit | Наблюдение |
|---|---|---|
| `corepack pnpm --filter @dsh-mywork/storage run typecheck` / `run build` | 0 / 0 | чисто |
| `node --test --test-isolation=none tests/storage/jobs-durable.test.mjs` | 0 | **`# pass 3` / `# fail 0`** (гейт F-37) |

Тесты: (1) `enqueue` → `list()` содержит джоб со `status='pending'`, `attempts=0`, `lease_until=null`; после закрытия и повторного открытия store джоб на месте и всё ещё `pending` (доказательство переживания рестарта — переоткрытие того же файла, вторая проверка схемы при этом тоже проходит); (2) `claimDue` ставит `status='running'`, `owner`, `lease_until = now + leaseMs` и `attempts=1`, а второй `claimDue` до истечения лизы возвращает `undefined`; (3) лиза, истёкшая между вызовами, снова доступна (второй воркер забирает джоб, `attempts=2`), а завершённый джоб больше не забирается и виден в `list({ status: 'succeeded' })`.

## Что не проверено

- **Два процесса-контроллера** одновременно: сценарий воспроизведён двумя вызовами в одной транзакции/процессе. Межпроцессная защита держится на `BEGIN IMMEDIATE` (`withTransaction`) + `changes === 1`, но двухпроцессного эксперимента не было.
- **Сервис-исполнитель** (кто вызывает `claimDue` по расписанию, как обрабатывается `failed`, где живут буферы вывода) — это `packages/controller` (F-31), вне моего scope; в storage только реестр.
- Ретенция завершённых джобов (сколько хранить `succeeded`/`failed`) не реализована: план её в этом шаге не требует, а политика — D17/`23-…`.
- Дочерний процесс `tests/lib/mw019-restart-child.mjs`, упомянутый в плане как готовая инфраструктура рестарта, не использовался: рестарт здесь доказывается переоткрытием store, а не смертью процесса.

---

## Закрытие находок ревью этапа 2 — MINOR-1 (task-16)

**Было:** guard `changed !== 1` в `claimDueBackgroundJob` возвращал `undefined` и не был покрыт тестом: ревьюер снял его мутацией, и `jobs-durable` остался зелёным, хотя пробник с гонкой показал, что без guard вызывающий получает запись с чужим `owner`.

**Стало:** нулевое число изменённых строк — это `StorageError` с кодом **`conflict`** (`… was claimed by another worker before this lease landed`, детали `{ jobId, owner, changed }`). Внутри одной транзакции предикаты чтения и записи совпадают, поэтому 0 изменённых строк означает, что строка ушла из-под нас: отдавать запись нельзя.

**Новый тест** (4-й в `tests/storage/jobs-durable.test.mjs`): исполнитель-обёртка возвращает 0 для `UPDATE background_job …` — ожидается типизированный отказ `conflict` с `details.changed === 0`, джоб остаётся `pending`/`owner = null`, а следующий настоящий `claimDue` его забирает.

**Доказательство невакуумности (мутация; hash до `196271D4809D2D42F7C899D94D14173A3BF9D31B87441379525ECD45706F3D5F`, после restore — совпал):**

| Прогон | Exit | Наблюдение |
|---|---|---|
| guard обезврежен (`changed !== 1 && changed !== 0`) | 1 | `pass 3 / fail 1` — падает именно новый тест: `Missing expected exception: zero changed rows is a conflict…` |
| после restore + пересборка storage | 0 | **`pass 4 / fail 0`** (гейт) |

Гейт `tests/storage/jobs-durable.test.mjs` после правок: **pass 4 / fail 0**; два процесса по-прежнему не воспроизводились (см. «Что не проверено» выше).
