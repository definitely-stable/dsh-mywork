# F-63b — книга аллокатора и журнал, который она нумерует

- **Задача:** дефект, найденный на гейте этапа 2 (`foundation-stage2-gate.md` §6) и отложенный «в этап 3».
- **База → вершина:** `d0c97bf` → коммит F-63b (см. §5).
- **Дата:** 2026-09-27
- **Статус:** **исправлено**; заявленный в отчёте этапа 2 механизм отказа **не воспроизвёлся**, воспроизведён другой — тихий.

---

## 1. Что утверждал отчёт этапа 2 и что установлено

**Утверждение (§6):** «`registry.sqlite` удалён/пересоздан → книга пуста, журнал реестра `[1..6]` → новая заявка получит 7, который в контроллере уже занят `background_job`. Отказ будет громким (`validateMigrations` бросит на дубле и store не откроется)».

**Опровергнуто пробником** (`.tmp/probe-allocator.mjs`, замороженный пред-фиксовый артефакт `.tmp/stage3-probe-lib`, SHA256 `packages/controller/lib/index.js` = `8778B57EEE3A…`, дерево чистое):

```text
--- run 2: registry wiped, SAME build (same keys, same order)
run 2 allocations: [{"key":"background_job","version":7,...},{"key":"artifact-retention","version":8,...}]
Q1 RESULT: controller opened, schemaVersion 8 journal: 1,2,3,4,5,6,7,8
```

Номера выводятся **заново теми же** — потому что порядок заявок и базовый список не изменились, а `highestOccupied` читает журнал и штамп **реестра** (`[1..6]`). Никакого дубля не возникает, `validateMigrations` не бросает, store открывается. Механизм в отчёте назван неверно.

## 2. Настоящий отказ — тихий, и он воспроизведён

Тот же пробник, но сборка, у которой появилась **одна новая** аллоцируемая миграция **впереди** существующих:

```text
--- run 3: registry wiped, build gained ONE allocated migration ahead of the others
run 3 allocations: attempt_worktree → 7 , background_job → 8 , artifact-retention → 9
  (the controller already records 7 = background-job, 8 = artifact-retention)
run 3 controller list: 1,2,3,4,5,6,7,8,9
Q2 RESULT: controller opened, schemaVersion 9 journal: 1,2,3,4,5,6,7,8,9
```

То есть: номер **7**, который в контроллере записан как `background-job`, выдан заявке `attempt_worktree`; контроллер **открылся штатно**, штамп уехал на 9, и тело новой миграции не выполнилось, потому что её версия ≤ `user_version`. Проверка `assertJournalConsistent` (`packages/storage/src/migrations.ts:267-288`) сравнивает **только номера**, не имена, поэтому расхождение имён не видно.

Зафиксировано тестом `tests/allocator-recovery.test.mjs` («without recovery…»): `ran === false` при `schemaVersion` выше прежнего, и в одном и том же номере журнал говорит `background-job`, а сборка — `attempt-worktree`. Это **тихая потеря схемы**, а не громкий отказ.

**Окно отказа:** любая потеря книги (`registry.sqlite` удалён, восстановлен из старой копии, каталог состояния пересобран) **вместе с любым изменением списка аллоцируемых миграций**. Этап 4 создаёт это окно шагом E-04 (`attempt_worktree`), поэтому дефект не «теоретический на будущее».

## 3. Разобранные варианты правки

| Вариант | Итог |
|---|---|
| **(a) как записано в плане: «аллокатор читает `user_version`/журнал всех store'ов и берёт максимум»** | **Недостаточен.** Максимум даёт полу `8` → заявки получают `9,10,11` → `canonicalMigrations` требует **непрерывности 1..N** (`migrations.ts:184-195`) и бросает `invalid-input … found 9 where 7 was expected`. Композиция не поднимается, при том что данные целы. |
| **(b) книга переезжает в ту БД, чей журнал расширяется** | Требует открыть контроллер **базовым** набором, выделить номера, затем применить остаток — то есть второй проход миграций и промежуточное состояние, которое никто не проверяет. Отклонён: дороже и создаёт новое незащищённое окно. |
| **(c) watermark-файл рядом с `controller.sqlite`** | Ещё один файл, который можно потерять **вместе** с книгой (одно и то же действие «пересобрать состояние» сносит оба), и он дублирует факт, который уже записан в журнале. Отклонён. |
| **(a+) принято: заимствование (adoption) номеров из журналов нумеруемых БД** | Ключ→номер **восстанавливается** из `schema_migrations` той БД, куда номер был записан (`readMigrationJournal`, read-only, до `openStore`), и записывается обратно в книгу. Новая заявка получает `max(всё занятое)+1`. Это то же (a), но не «максимум», а **отображение** — потому что максимум несовместим с требованием непрерывности. |

## 4. Что изменено

| Файл | Что |
|---|---|
| `packages/storage/src/journal-file.ts` (новый) | `readMigrationJournal(path)`: журнал БД **без** открытия store (read-only `DatabaseSync`), `[]` для отсутствующего файла/таблицы, типизированный `state-unreadable` — если файл есть, а журнал не читается (молчаливое «журнала нет» — это ровно тот путь, которым номер перенумеровывается). |
| `packages/storage/src/errors.ts` | новый код `state-unreadable` (в `StorageErrorCode` и `STORAGE_ERROR_CODES`). |
| `packages/storage/src/index.ts` | экспорт `readMigrationJournal`, `JOURNAL_TABLE`, `STATE_UNREADABLE`. |
| `packages/controller/src/migration-allocator.ts` | `AllocationAdoption` + опция `adopt`; заимствованный номер сохраняется и записывается в книгу; `highestOccupied` учитывает заимствования; `occupiedBySchema` отделён от «занято заявками» (иначе более поздняя заявка ложно конфликтует с заимствованием); новый код `version-conflict` + `MigrationAllocatorErrorOptions.cause`. |
| `packages/controller/src/app.ts` | у аллоцируемых миграций появилось явное `journalName`; `adoptedAllocations(journal)`; в `start()` журнал контроллера читается **до** его открытия и передаётся в аллокатор. |
| `packages/controller/src/index.ts` | экспорт `adoptedAllocations`, `AllocationAdoption`, `MigrationAllocatorErrorCode`. |
| `tests/allocator-recovery.test.mjs` (новый) | 4 теста: опровержение заявленного механизма; воспроизведение тихой потери; восстановление; восстановление через композиционный корень. |
| `tests/storage/migration-allocator.test.mjs` | +3 теста: заимствование возвращается и пишется в книгу; противоречие книге → `version-conflict`; испорченное заимствование → `invalid-request` до транзакции. |

## 5. Команды и результаты

| Команда | Exit | Наблюдение |
|---|---|---|
| `node .tmp\probe-allocator.mjs` | 0 | §1 и §2: отчёт этапа 2 опровергнут, тихий отказ воспроизведён |
| `corepack pnpm --filter @dsh-mywork/storage --filter @dsh-mywork/controller run typecheck` | **0** | `Scope: 2 of 13 workspace projects` |
| `node --test --test-isolation=none tests/allocator-recovery.test.mjs` | **0** | **tests 4 / pass 4 / fail 0** |
| `node --test --test-isolation=none tests/storage/migration-allocator.test.mjs` | **0** | **tests 8 / pass 8 / fail 0** |
| `node --test --test-isolation=none tests/app-*.test.mjs tests/storage.test.mjs tests/storage-crash.test.mjs "tests/storage/*.test.mjs" tests/runtime.test.mjs tests/adapters.test.mjs tests/boundaries.test.mjs tests/reachability.test.mjs` | **0** | **tests 122 / pass 122 / fail 0** |
| `Test-Path 'C:\Users\Dmitry\.dsh\dsh-mywork'` | — | **False** до и после каждого прогона |

**Мутация.** «Без восстановления» — не отдельная мутация, а **штатное поведение до правки**, воспроизведённое внутри того же файла на настоящем API (`createMigrationAllocator` без `adopt`): новый ключ получает чужой номер, store открывается, тело миграции не выполняется (`ran === false`). После правки тот же сценарий даёт `ran === true` и сохранённые имена строк журнала. То есть доказаны обе стороны: пред-фиксовое поведение и его отсутствие после.

## 6. Что НЕ сделано и остаётся открытым

1. **`assertJournalConsistent` по-прежнему сравнивает номера, а не имена** (`migrations.ts:267-288`). Это и позволило тихой перенумерации пройти. Осознанно не менял: имена — метки, и ужесточение глобальной проверки сделало бы отказом любое законное переименование миграции в будущей сборке. После adoption расхождение для заимствованных ключей невозможно by construction; для ключа, **удалённого** из сборки, отказ остаётся громким (непрерывность/`schema-version-unsupported`).
2. **Двухпроцессная гонка** вокруг `readMigrationJournal` → `openStore` не проверена (тесты однопроцессные). Наблюдение из этапа 2 (§8.5) остаётся в силе.
3. **Тест «апгрейд существующей v6-базы контроллера»** (второй кандидат из §8.4 отчёта этапа 2) не входил в эту правку — остаётся открытым.
4. Дефект из §9.5 отчёта этапа 2 (метка tombstone не называет поколение) **не трогался**.
