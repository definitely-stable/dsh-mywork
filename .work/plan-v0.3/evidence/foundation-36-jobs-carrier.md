# foundation-36 — F-36: durable jobs, выбор носителя

- **Задача:** `task-9` · **Исполнитель:** `hygiene-ops` · **Дата:** 2026-09-27 · **Шаг:** F-36 (`20-STEPS-foundation.md:998-1025`), D09 (вариант B), MW-068
- **Статус:** `READY_FOR_REVIEW`

## Решение (D09, вариант B)

**Носитель durable-джобов — таблица `background_job` в MyWork-базе (`controller.sqlite`), заявка `background_job` в аллокаторе версий. Платформенный `jobs-local` не используется вовсе** — иначе в системе было бы два реестра джобов, из которых один теряет всё при рестарте.

Цитаты D09 (проверенные факты плана, воспроизведены по коду платформы):

- `C:\Reposit\deepseek-harness\deepseek-harness\packages\jobs\jobs-local\src\index.ts:1-11` — «Process-local provider for the background-job capability seam (`ctx.jobs`). It keeps every job — lifecycle state, the bounded output ring, and the model cursor — **in memory**…»;
- там же `:123-128` — `export class LocalJobRegistry extends JobRegistry`, `:160` — `private store = new Map<JobId, TrackedJob>()`;
- у платформы заимствованы **только размеры буфера вывода** (`:35-39` — 256 KiB живого / 16 KiB завершённого): большой вывод идёт артефактом (`artifacts`/`audit_events`), а не строкой джоба.

## Изменённые пути

| Путь | Что сделано |
|---|---|
| `packages/contracts/src/background-job.ts` | **Create** — `BackgroundJobKind`, `BACKGROUND_JOB_KINDS`, `BackgroundJobStatus`, `BACKGROUND_JOB_STATUSES`, `BACKGROUND_JOB_OPEN_STATUSES` (scope расширен Lead'ом под F-36 шаг 3; barrel `contracts/src/index.ts` — одна строка экспорта, «единственный writer» согласован) |
| `packages/storage/src/background-jobs.ts` | **Create** — `BACKGROUND_JOB_DDL`, `BACKGROUND_JOB_INDEX_DDL`, `createBackgroundJobMigration(version)` (номер даёт аллокатор; литералов `version: N` нет) |
| `packages/storage/src/index.ts` | реэкспорт |
| `tests/storage/jobs-schema.test.mjs` | **Create** — 3 теста |

## Номер миграции — только от аллокатора (R-04, §15.3)

Замер запуском на свежей базе (канонический набор = 1..6):

```text
occupied before allocating: 6 ; background_job -> 7 ; artifact-retention -> 8
extended canonical set: 1:outbox-inbox, 2:artifact-audit, 3:evidence-immutability,
  4:controller-lease, 5:plan-mutation, 6:claim-saga, 7:background-job, 8:artifact-retention
```

То есть `background_job` — одна из четырёх одновременных заявок плана (F-37, F-40, `E-04`, `B-12`); `createBackgroundJobMigration(version)` получает номер параметром, в коде и тестах литерала нет. Тест дополнительно проверяет, что две заявки получают **разные** номера и что обе выше занятого максимума.

## Команды

| Команда | Exit | Наблюдение |
|---|---|---|
| `corepack pnpm --filter @dsh-mywork/contracts run build` | 0 | `lib/index.js` собран, `BACKGROUND_JOB_KINDS` экспортируется |
| `corepack pnpm --filter @dsh-mywork/storage run typecheck` / `run build` | 0 / 0 | чисто |
| `node --test --test-isolation=none tests/storage/jobs-schema.test.mjs` | 0 | **`# pass 3` / `# fail 0`** (гейт F-36) |

Тесты: (1) таблица `background_job` есть, колонки ровно `job_id, kind, status, owner, payload, attempts, created_at, updated_at, lease_until`, версия — выданная аллокатором, запись в журнале с именем `background-job`; (2) таблица **не** наследует delete-триггеры (работы обязаны завершаться и чиститься; проверка невакуумна — у `artifacts` в той же схеме все три триггера на месте); (3) словарь kinds/статусов живёт в contracts, модуль contracts не импортирует ничего (в т.ч. платформенный `JobView`), а собранный бандл contracts не тянет `@deepseek-ai/*`.

## Что не проверено

- **Встраивание в composition root — F-29/F-31 (env-ops):** `background_job` пока не входит в канонический набор (он остаётся 1..6), потому что номер обязан выдать аллокатор в композиционном корне. До этого шага таблица появляется только в тестах.
- Конкуренция таблицы джобов с доменом за write-lock (риск плана): не измерялась; при конкуренции D09 допускает вынос в отдельный файл, но не второй реестр в памяти.
- Буферы вывода (256/16 KiB) заимствованы как решение, но в коде storage не реализованы — их место в исполняющем сервисе (`packages/controller`, F-31/F-37).
