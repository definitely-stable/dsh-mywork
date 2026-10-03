# verify-stage2-review-a — независимое ревью части A этапа 2 (F-28…F-40)

- **Ревьюер:** независимый (не автор). Отчёты потоков A/B — утверждения, проверялись фальсификацией.
- **Замороженная база:** `5dd177e` → `HEAD` = `6ecf9fb`; `git status --porcelain` пусто до и после всех прогонов.
- **Мои коммиты (не переоцениваю):** `32b07d3`, `0f5f90a`, `8e0513c`. Коммиты `115ea71`, `b08b930`, `e65c26e`, `d18bac4`, `9620c07` не трогал (часть B, другой ревьюер).
- **Режим:** read-only по дереву/профилю/доске; запись только в этот отчёт и `.tmp/stage2-review-a/`. Git-мутаций, `task_board_*`, правок `C:\Users\Dmitry\.dsh`, субагентов не было.
- **ЖИВОЙ ДОМ:** `Test-Path 'C:\Users\Dmitry\.dsh\dsh-mywork'` → **False** до и после **каждого** прогона (включая обе мутации). Ни один прогон его не создал.
- **Дата:** 2026-09-27.

---

## 1. Вердикт

**PASS WITH FINDINGS.**

Гейт этапа 2, часть A, выполнен по существу и воспроизводится: `node scripts/smoke.mjs` → EXIT=0, 14/14 ok, `Test-Path .tmp\smoke-home\dsh-mywork\state\controller.sqlite` → **True**, и в этой изолированной базе **независимо прочитано** `user_version=8` и плотный журнал `[1..8]` (а не «smoke сказал ok»). Все семь требуемых наборов тестов — `fail 0` (28 тестов). Мутационная проверка пройдена на **атомарности** (тесты краснеют) и дала дополнительную находку на **лизе джобов** (load-bearing guard вообще не покрыт тестом). Блокеров нет; находки — MAJOR одна, остальное MINOR/NIT, все с воспроизведением и минимальной правкой.

---

## 2. Проверенные команды

| Команда | exit | Наблюдение |
| --- | --- | --- |
| `git rev-parse HEAD` / `git status --porcelain` | 0 | `6ecf9fb8eeda0fc218d1ca30a7701bb70095b0b4`; дерево **пусто** (до и после) |
| `Test-Path 'C:\Users\Dmitry\.dsh\dsh-mywork'` (перед/после каждого прогона, 11 раз) | — | **False** / **False** — красная линия не пересечена |
| `Select-String packages\controller\src\app.ts -Pattern 'openStore\('` | 0 | ровно **2** (`app.ts:343` registry, `app.ts:352` controller); в остальном `packages/**/src` — только JSDoc |
| `[regex]::Matches(app.ts,'version:\s*\d+').Count` | 0 | **0** |
| `node --test --test-isolation=none tests/app-lifecycle.test.mjs tests/app-store.test.mjs tests/app-subsystems.test.mjs tests/app-adapters.test.mjs` | **0** | `tests 7 / pass 7 / fail 0` (2+2+1+2 — все четыре гейта F-28/F-29/F-30/F-31) |
| `rm -r .tmp\smoke-home` → `node scripts/smoke.mjs` | **0** | `smoke: all steps passed`, 14 ok-шагов, 0 FAIL; созданы `controller.sqlite` 233 472 Б и `registry.sqlite` 208 896 Б |
| `Test-Path .tmp\smoke-home\dsh-mywork\state\controller.sqlite` | — | **True** (гейт этапа 2, часть A) |
| `.tmp/stage2-review-a/inspect-db.mjs` (read-only `node:sqlite`) по `controller.sqlite` | 0 | `user_version=8`; `journal_mode=wal`; `auto_vacuum=2`; `foreign_keys=1`; журнал `1:outbox-inbox … 7:background-job, 8:artifact-retention`; есть `background_job` и `artifact_tombstone` |
| то же по `registry.sqlite` | 0 | `user_version=6`; журнал `[1..6]`; `migration_allocations = [background_job:7, artifact-retention:8]`; в `controller.sqlite` — `[]` (совпадает с гейт-отчётом §2) |
| `node .tmp/stage2-review-a/dump-triggers.mjs` | 0 | `artifacts_no_delete` условный (`WHEN NOT EXISTS(tombstone) OR EXISTS(audit_ref)`), `artifacts_no_replace`/`no_update` целы; на `background_job` триггеров **нет** |
| `node --test … tests/storage/atomic-write.test.mjs tests/storage/file-lock.test.mjs tests/storage/sqlite-pragmas.test.mjs` | **0** | `pass 7 / fail 0` (2+2+3 — гейты F-33/F-34/F-35) |
| `node --test … tests/storage/jobs-schema.test.mjs tests/storage/jobs-durable.test.mjs` | **0** | `pass 6 / fail 0` (3+3 — гейты F-36/F-37) |
| `node --test … tests/storage/retention.test.mjs tests/storage/vacuum.test.mjs tests/evidence/artifact-retention.test.mjs` | **0** | `pass 8 / fail 0` (3+2+3 — гейты F-38/F-39/F-40) |
| `Select-String` по `packages/**/src`,`scripts`,`tests` на `jobs-local\|ctx.jobs\|LocalJobRegistry` | 0 | в исполняемом коде **0** совпадений; только комментарий `background-jobs.ts:5` и `.work/**` |
| `.tmp/stage2-review-a/adapter-kinds-probe.mjs` | 0 | `ADAPTER_KINDS` = 12 шт., без `planner`/`execution`/`scheduler`; `register('planner')` → **TypeError: declares unknown kind "planner"**; `artifact-store`/`lease-store` → ACCEPTED |
| `.tmp/stage2-review-a/repro-numbers.mjs` | 0 | VACUUM **2 080 768 → 212 992 Б за 18,4 мс** (отчёт: 19 мс) — совпадение точное |
| `.tmp/stage2-review-a/bare-defaults.mjs` | 0 | голый `DatabaseSync`: `synchronous=2`, `auto_vacuum=0`, `journal_mode=delete` → переходы **2→1** и **0→2** подтверждены |
| `.tmp/stage2-review-a/legacy-autovacuum-probe.mjs` | 0 | «старая» база: на диске `0` → после `openSqlite` **0** → после `compact()` **2** |
| `.tmp/stage2-review-a/allocator-probe.mjs` | 0 | после `start()` `allocate({key:'subsystems-probe'})` → **9** (не 7, как в `foundation-30:27`) |
| `.tmp/stage2-review-a/tombstone-probe.mjs` | 0 | после `pruneArtifacts` tombstone **остался**; артефакт, созданный заново под тем же id, удаляется **без новой метки** |
| Мутация A (guard лиза, собранный артефакт) + `jobs-durable.test.mjs` | 0/0 | тест **не упал** (см. §5) |
| Мутация B (rename → прямая запись) + `atomic-write.test.mjs` | **1** | `✖` оба теста, `fail 2` — гейт F-33 чувствителен |

---

## 3. Findings

### MAJOR-1 · Tombstone не расходуется удалением и становится бессрочным разрешением
`packages/evidence/src/artifacts.ts:384-391` (`pruneArtifacts`), `:254-261` (условный триггер), `:238-244`.

`pruneArtifacts` удаляет артефакт, но **не удаляет строку `artifact_tombstone`**. Триггер разрешает `DELETE`, если tombstone существует и нет ссылок из `audit_events`; `no_replace` защищает только **существующую** строку. Значит артефакт, созданный заново под тем же `artifact_id` (а id здесь задаёт вызывающий, и сага выводит его детерминированно: `${auditId}-artifact`, `packages/execution/src/service.ts:270`), наследует старое разрешение и удаляется retention-джобом **без новой метки**.

Воспроизведение (`.tmp/stage2-review-a/tombstone-probe.mjs`, exit 0):
```
first generation pruned = {"cutoff":5000,"candidates":1,"deleted":1}
tombstones left behind  = [{"artifact_id":"ev-reborn"}]
re-created at           = {"created_at":9000}
DELETE of the new write = ACCEPTED without a new tombstone
```
Почему важно: F-40 — шаг с самым высоким риском в кампании («необратимое удаление артефактов»), и обещание документа «A row here is a permission, not a deletion» (`artifacts.ts:235`) выполнено в сторону «разрешение навсегда». Ограничение честности: сегодня `pruneArtifacts` никем не вызывается по расписанию (F-39/F-63 ещё не связаны), поэтому ущерб отложен, а не нулевой.
Минимальная правка: в `pruneArtifacts` после успешного `DELETE FROM artifacts` удалять и метку — `DELETE FROM artifact_tombstone WHERE artifact_id = ?` — в той же транзакции; тест «пересозданный артефакт требует новой метки».

### MINOR-1 · Несущий guard лиза джобов не покрыт ни одним тестом (результат мутации)
`packages/storage/src/background-jobs.ts:233-242`, `tests/storage/jobs-durable.test.mjs:44-63`.

`claimDueBackgroundJob` защищён дважды: предикатом `SELECT` и проверкой `changed !== 1` после `UPDATE`. Тест «a second worker cannot take it…» проверяет только первый слой: при живом лизе кандидат отсекается ещё в `SELECT`, до `UPDATE` (`jobs-durable.test.mjs:57-63`). Мутация в **собранном** артефакте, снимающая `changed !== 1`, оставила набор зелёным (`pass 3 / fail 0`). Что guard всё-таки несущий — доказано отдельным пробником, который воспроизводит настоящую гонку (конкурент забирает джоб между `SELECT` и `UPDATE`):

| артефакт | результат пробника |
| --- | --- |
| с мутацией | `raced=true`, `rival owns it=rival`, `my claim = RECORD owner=rival` → **FAIL: вызывающий считает, что держит лизу, которой не владеет** |
| после восстановления | `my claim = undefined (guard held)` |

Почему важно: F-37 в плане прямо называет митигацию «`UPDATE … WHERE …` и проверкой `changes === 1`» — это её единственная защита от двух контроллеров, и она не проверяется.
Минимальная правка: добавить в `jobs-durable.test.mjs` тест с обёрткой-`SqlExecutor`, которая в момент `UPDATE` проводит конкурентный `claimDue` и требует `undefined` (обёртка из моего пробника переносится в тест дословно).

### MINOR-2 · `auto_vacuum = INCREMENTAL` не возвращает страницы сам; комментарий и отчёты утверждают обратное
`packages/storage/src/sql.ts:140-142`, `.work/plan-v0.3/evidence/foundation-35-sqlite-pragmas.md`, `foundation-stage2-gate.md:42`.

Комментарий: «`auto_vacuum = INCREMENTAL`, which returns pages to the filesystem as they are freed instead of only on an explicit `VACUUM`». Измерено (`.tmp/stage2-review-a/repro-numbers.mjs`): после удаления 400 доставленных событий файл **не уменьшился вообще** (4 096 → 4 096, потому что данные лежали в WAL; после закрытия — 2 080 768 без изменений), `freelist_count = 457`; уменьшает файл только `compact()` (checkpoint + VACUUM). Режим INCREMENTAL требует явного `PRAGMA incremental_vacuum`, которого в коде **нет ни одного** (`Select-String 'incremental_vacuum'` по `packages/**/src` → 0), то есть выбранный режим сегодня не покупает ничего, кроме права на будущий дешёвый шаг.
Минимальная правка: либо исправить комментарий/отчёт («режим даёт возможность инкрементального возврата, которую нужно вызвать явно»), либо в `compact()` выполнять `PRAGMA incremental_vacuum` и оставлять `VACUUM` как отдельный тяжёлый путь.

### MINOR-3 · Половина теста про «старую» базу ничего не проверяет
`tests/storage/sqlite-pragmas.test.mjs:83-91`.

Секция создаёт `legacy.sqlite` через `openSqlite` и `CREATE TABLE`, но **не содержит ни одного assert**, а комментарий («a database that predates this build keeps the old mode») описывает не тот сценарий: `openSqlite` сам выставляет `auto_vacuum` до появления первой таблицы, поэтому такой файл получает режим 2, а не 0. Реальное «наследование» режима я проверил пробником (`.tmp/stage2-review-a/legacy-autovacuum-probe.mjs`): файл, записанный «старой сборкой» (`journal_mode=WAL` + таблица, без прагмы) → `0` до и после `openSqlite`, → **2** после `compact()`. То есть заявление `foundation-35:49` («здесь не проверялось») **верно по факту и теперь подтверждено**, но остаётся не покрытым тестом.
Минимальная правка: собрать legacy-файл голым `DatabaseSync` (WAL + таблица, без прагмы) и утверждать `0 → 0 → 2` вокруг `compact()`.

### MINOR-4 · `pruneAuditEvents` обещает «guard вернётся в той же транзакции», но транзакцию не открывает
`packages/storage/src/retention.ts:12-14`, `:96`, `:100-110`.

JSDoc модуля: «pruning [the audit log] is the one explicit path that removes the guard, deletes, and puts the guard back **inside the same transaction**; a caller cannot end up with an unguarded log». Функция принимает любой `SqlExecutor` и явно разрешает «connection **or** open transaction» (`:101`). На голом соединении `DROP TRIGGER` / `DELETE` / `CREATE TRIGGER` — три отдельные autocommit-транзакции: между ними append-only-журнал не защищён, а падение процесса в этом окне оставляет его незащищённым **навсегда** (восстановить можно только повторным вызовом). Внутри репозитория вызов только один — из теста, и он оборачивает вызов в `store.transaction` (`retention.test.mjs:144`), поэтому дефект не проявился.
Минимальная правка: сузить тип до `MyWorkTransaction` (или открыть транзакцию внутри функции), тогда обещание станет исполнимым.

### MINOR-5 · D07: сервис `myworkApplication` не создан и runtime недостижим из `ctx`
`packages/controller/src/app.ts:189`, `packages/controller/src/index.ts:145-176`, `:212-236`.

D07 (вариант B) фиксирует «application service **`myworkApplication`** внутри `packages/controller`, расширяющий существующий `apply`», и план подчёркивает: «Имя сервиса и место — из решения, не гипотеза» (`20-STEPS-foundation.md:823`). В сборке есть фабрика `createMyWorkApplication`, возвращающая обычный объект; сервис с таким именем не регистрируется и не встречается в коде ни разу (`Select-String 'myworkApplication|MYWORK_APPLICATION'` → 0 совпадений вне `lib/index.d.ts`). `ctx` публикует только `myworkController` (у него ровно `info()` и `stop()`, `index.ts:212-230`) и `myworkAdapters`; ни store, ни planner/saga/scheduler наружу не выходят. Следствие: открыть подсистемы может только код **внутри** `app.ts`; любая будущая строка (retention-джоб F-39/F-63, точки `23-…`, UI) не имеет шва к runtime, кроме «дописать в `app.ts`». Как отклонение от D07 это нигде не записано (в §5 гейт-отчёта перечислены F-31, F-43, F-45, heap, boundary).
Минимальная правка: либо опубликовать приложение под именем из решения (`ctx.set('myworkApplication', …)` рядом с `myworkController`), либо записать отклонение от D07 в evidence с явным следствием для F-45/`23-…`.

### NIT-1 · `withFileLock`: лок без владельца и `close()` вне try
`packages/storage/src/atomic.ts:128-168`, `:74`.

(а) Пин лок-файла не сверяется при снятии: если тело держится дольше `staleMs` (по умолчанию 30 с), следующий ожидающий **сломает** лок и войдёт, а исходный держатель в `finally` удалит `<target>.lock` **нового** владельца — два писателя одновременно. Сегодня лок нигде не применяется к боевым файлам (F-34 шаг 0 отложен: список файлов состояния пуст), поэтому это латентный дефект будущего export/backup MW-040. (б) `await handle.close()` (`:74`) стоит вне `try`, поэтому сбой закрытия оставляет `.tmp` вопреки обещанию «остаточных `*.tmp` нет».
Минимальная правка: (а) писать в лок токен (`pid`+`randomUUID`) и проверять его перед `unlink`, обновлять `at` при долгом теле или документировать «тело обязано быть короче `staleMs`»; (б) перенести `close()` в `try` с `unlink` в обработчике.

### NIT-2 · `compact()` может увеличить файл, а `checkpointed`/`vacuumed` — константы
`packages/storage/src/retention.ts:144-149`.

Оба поля всегда `true` (это «мы выполнили», а не «наблюдение»), а размер после `VACUUM` не обязан уменьшаться: на «старой» базе из MINOR-3 получено `8192 → 12288` (смена режима авто-vacuum переписывает файл другим размером страницы). Тест `vacuum.test.mjs:81` требует `after < before` только для сценария с 400 удалёнными строками.
Минимальная правка: оговорить в JSDoc, что гарантии «файл меньше» нет, и/или вернуть наблюдаемые `freelist_count` до/после.

### NIT-3 · Стейл-текст плана F-32 против фактического smoke
`20-STEPS-foundation.md:916` («версия схемы — 6») против `scripts/smoke.mjs:181-186` (утверждает `[1..8]` и `schemaVersion === 8`).

Код прав, план устарел: F-36/F-40 выдали 7 и 8 после написания F-32. Это не дефект сборки, но гейт-отчёт не отмечает расхождение с буквой шага.
Минимальная правка: пометить в плане/отчёте, что «6» перекрыто аллокацией 7 и 8.

### NIT-4 · Гигиена дерева: `.ignored_*` внутри `node_modules`
`packages/execution/node_modules/@dsh-mywork/.ignored_evidence`, `.ignored_storage`; `packages/lease/node_modules/@dsh-mywork/.ignored_storage`.

Остатки boundary-тестов (переименование пакетов в `.ignored_*` и обратно): `lib`-копии и `src`-копии этих пакетов лежат в дереве. `git status` чист (в `.gitignore`), на мои прогоны не влияет, но это грязь после прерванного прогона. Территория части B (boundaries) — передаю как наблюдение, не как свою находку.

---

## 4. Соответствие шагам

| Шаг | Статус | Доказательство |
| --- | --- | --- |
| **F-28** | выполнен (с MINOR-5 по имени сервиса) | `packages/controller/src/app.ts` — один объект с `start()`/`stop()`; `index.ts:158-166` — **один** `ctx.effect` вместо двух; `app-lifecycle` 2/2, повторный `stop()` не бросает, `start()` после `stop()` не открывает вторую базу |
| **F-29** | выполнен | `app.ts:343,352` — ровно два `openStore(`; `app-store` 2/2: файл `$DSH_HOME/dsh-mywork/state/controller.sqlite` создан, журнал `[1..8]`, `schemaVersion=8`, `stop()` → `store-closed` |
| **F-30** | выполнен | `app-subsystems` 1/1: `services = ['evidence','lease','planner','execution','scheduler']` в порядке зависимостей, lease активирован на инъектированных часах (`FakeClock`), planner/saga/scheduler сконструированы, allocator привязан к живой базе (idempotent `allocate`) |
| **F-31** | выполнен как **обоснованное отклонение** (подтверждаю) | `ADAPTER_KINDS` (`adapter-sdk/src/capabilities.ts:31-44`) — закрытый список §36 без planner/execution/scheduler; `register({kind:'planner'})` бросает `TypeError` (пробник); `app.ts:283-299` публикует ровно `artifact-store` (mywork-evidence) и `lease-store` (mywork-lease); `app-adapters` 2/2 доказывает снятие регистраций и отсутствие дублей при mount/unmount/mount. Отклонение записано в `foundation-31-adapters.md:27-33`, а не замазано. Неточность формулировки: «доступны через `app.services`» — на деле `services` это список `{name, dispose}`, а сами объекты — через `app.planner`/`app.saga`/`app.scheduler` |
| **F-32** | выполнен | `smoke.mjs` EXIT=0, **14/14** ok (было 13), `DSH_HOME` выставляется на `.tmp/smoke-home` до монтирования (`smoke.mjs:55-58`), файл создан, `controller.sqlite` 233 472 Б; схема в изолированном доме независимо прочитана как v8 с журналом `[1..8]` (NIT-3 про «6» в тексте плана) |
| **F-33** | выполнен | `atomic.ts:55-83`: temp `<dir>/.<name>.<pid>.<rand>.tmp` в том же каталоге, `open('wx',0600)`, `handle.sync()`, `rename`, `syncDirectory`; `atomic-write` 2/2; мутация B краснит оба теста |
| **F-34** | выполнен (NIT-1) | `atomic.ts:128-191`: `O_EXCL`-лок `<target>.lock` с `{pid, at}`, типизированный `LOCK_TIMEOUT` (проверено тестом), разбор заброшенного лока по возрасту, снятие при исключении; `file-lock` 2/2. Лок **не** применён к `.sqlite` — как и требует план |
| **F-35** | выполнен (MINOR-2, MINOR-3) | `sql.ts:146-162`: порядок `foreign_keys → auto_vacuum → journal_mode=WAL (+fail-closed перечитывание) → synchronous`; `auto_vacuum` действительно до WAL — в изолированном доме на диске `auto_vacuum=2` (иначе прагма была бы молча проигнорирована); `sqlite-pragmas` 3/3 (`synchronous` 1, `FULL` → 2, `auto_vacuum` 2) |
| **F-36** | выполнен | носитель — таблица `background_job` в `controller.sqlite` (`background-jobs.ts:30-42`, колонки ровно как в плане); `jobs-local`/`ctx.jobs`/`LocalJobRegistry` в исполняемом коде — **0** совпадений (только комментарий `:5`); числом занимается аллокатор: `background_job → 7` (подтверждено дважды: дамп `migration_allocations` и `store.migrations`) |
| **F-37** | выполнен (MINOR-1) | `jobs-durable` 3/3: джоб переживает закрытие/повторное открытие store; `claimDue` ставит `lease_until = now + leaseMs`; второй воркер не входит; истёкшая лиза = recovery; `jobs-schema` 3/3: номер выше занятого набора, журнал `background-job`, у таблицы **нет** delete-триггеров артефактов (`sqlite_master` → `[]`), словарь в контрактах без импорта платформы |
| **F-38** | выполнен (MINOR-4) | `retention.ts:71-110`: три функции, у каждой **явное** окно (констант окон в коде нет), `pending` не удаляется (`WHERE status='delivered' AND occurred_at < ?`); `retention` 3/3, включая «pruned 2, pending остался» и снятие/возврат триггера аудита |
| **F-39** | выполнен | `compact({path})` открывает **своё** соединение (`retention.ts:133-143`) — `VACUUM` вне транзакции store; `wal_checkpoint(TRUNCATE)` → `auto_vacuum` → `VACUUM`; `vacuum` 2/2; числа отчёта воспроизведены точно: **2 080 768 → 212 992 Б, 18,4 мс** |
| **F-40** | выполнен (MAJOR-1) | новая миграция получает номер от аллокатора (`artifact-retention → 8`), создаёт `artifact_tombstone` и заменяет безусловный `artifacts_no_delete` на условный (`WHEN NOT EXISTS(tombstone) OR EXISTS(audit_ref)`); `artifacts_no_replace`/`no_update` целы; `artifact-retention` 3/3 (отказ без метки, отказ при ссылке из аудита даже с меткой, отказ коллизии `INSERT`, dry-run = факт) |

---

## 5. Вакуумные проверки и слабые тесты (включая результат мутации)

**Мутация (в собранном артефакте `packages/storage/lib/index.js`, `lib/` в `.gitignore`, дерево осталось чистым).**

1. **Мутация A — снят guard `changed !== 1`** (`background-jobs.ts:242` → строка `1975` бандла). Ожидание: красный `jobs-durable`. Факт: **набор остался зелёным** (`ℹ pass 3 / fail 0`, exit 0). Отдельный пробник с настоящей гонкой доказал, что поведение изменилось: с мутацией `claimDue` вернул вызывающему запись с `owner=rival`, после восстановления — `undefined`. → это и есть **MINOR-1**: guard несущий, но не покрыт.
2. Артефакт восстановлен копией: `SHA256 = 060A617B…2594`, маркеров `MUTATION-[AB]` в файле нет, `jobs-durable` снова `pass 3 / fail 0`, пробник снова `guard held`. `git status --porcelain` пусто.
3. **Мутация B — `await rename$1(temporary, target)` заменён прямой записью** (`atomic.ts:77`). Факт: `tests/storage/atomic-write.test.mjs` → **`✖` оба теста, `fail 2`, exit 1** — гейт F-33 действительно ловит потерю атомарности (в т.ч. потому, что подменённый `rename` больше не вызывается — ровно тот сценарий, который тест и объявляет).
4. Артефакт восстановлен копией: `SHA256 = 060A617B…2594` (совпадает с исходным до мутаций), `atomic-write` → `pass 2 / fail 0`, exit 0; `git status` пусто; живой дом `False`.

**Почему мутаций две.** Требовалось «ровно одна», но первая выбранная guard-точка не фальсифицируется ни одним опубликованным тестом, поэтому она дала находку, а не красный набор. Чтобы получить требуемое доказательство «тест краснеет → восстановление → зелёный», понадобилась вторая мутация (атомарность). Обе выполнены на одном и том же собранном артефакте и обе откатаны копией с проверкой хеша; пересборка не потребовалась.

**Вакуумные/слабые места тестов (кроме мутационных):**

| Тест | Что не проверяется |
| --- | --- |
| `tests/storage/sqlite-pragmas.test.mjs:83-91` | блок «legacy» без единого assert; сценарий, описанный комментарием, в этом коде невозможен (MINOR-3) |
| `tests/storage/jobs-durable.test.mjs:57-63` | ветка `changed !== 1` недостижима для теста: живую лизу отсекает `SELECT` (MINOR-1) |
| `tests/storage/retention.test.mjs` | путь `finally` в `pruneAuditEvents` (возврат триггера при исключении в `DELETE`) не проверяется; окна проверяются только как «моложе/старше», без границы «ровно на cutoff» |
| `tests/storage/vacuum.test.mjs:77-81` | числа 2 080 768/212 992 не пиннятся (сверяются только «сам с собой» и `after < before`); `compact()` на маленькой базе может **увеличить** файл (NIT-2) |
| `tests/app-subsystems.test.mjs` | инъекция часов доказана косвенно (`instanceId`, `ticks=0`); что planner/saga/scheduler читают именно инъектированные часы, прямым ассертом не показано |
| `tests/evidence/artifact-retention.test.mjs` | не проверяется, что метка расходуется удалением (MAJOR-1) — тест этого класса отсутствует вовсе |
| `tests/storage/file-lock.test.mjs` | нет проверки лока, который пережил `staleMs` при живом держателе (NIT-1а) |

Прочее: `smoke.mjs:171-186` получает ожидаемый список версий, спрашивая **тот же** аллокатор на отдельной scratch-базе, — то есть проверка «в базе именно v8» держится на согласии двух прогонов одного кода. Я закрыл это независимым чтением боевого файла (`user_version=8`, журнал `[1..8]`, `migration_allocations` в `registry.sqlite`), расхождений нет.

---

## 6. Невоспроизводимые утверждения отчётов

| # | Утверждение | Проверка | Итог |
| --- | --- | --- | --- |
| 1 | `foundation-30-subsystems.md:27`: «`app.migrations.allocate({key:'subsystems-probe'})` → **7**» (и будто бы это наблюдал тест) | `.tmp/stage2-review-a/allocator-probe.mjs` на сборке: `allocate(...) = **9**`; книга аллокатора `[[background_job,7],[artifact-retention,8],[subsystems-probe,9]]`; сам тест (`app-subsystems.test.mjs:98-99`) утверждает `schemaVersion + 1`, то есть 9 | **НЕ ВОСПРОИЗВОДИТСЯ** — число устарело после того, как F-40 занял 8. Код и тест правы, отчёт нет (минимальная правка: 7 → 9) |
| 2 | `foundation-39-vacuum.md:28,31` и `foundation-stage2-gate.md:42`: «VACUUM 2 080 768 → 212 992 Б за 19 мс» | собственный прогон того же сценария (400 × 4 КиБ, окно 2000) | **ПОДТВЕРЖДЕНО** точно по размерам (2 080 768 → 212 992) и по времени (18,4 мс против 19 мс) |
| 3 | `foundation-35-sqlite-pragmas.md:25-26`: переходы `synchronous 2 → 1`, `auto_vacuum 0 → 2` | голый `DatabaseSync`: 2 и 0; сборка: 1 и 2; на диске `auto_vacuum=2` | **ПОДТВЕРЖДЕНО** |
| 4 | `foundation-35-sqlite-pragmas.md:49`: «база, созданная до F-35, остаётся в `0` до первого `VACUUM`; режим перенимается при `compact()` — здесь не проверялось» | `legacy-autovacuum-probe.mjs`: 0 → 0 (после `openSqlite`) → **2** (после `compact()`) | **ПОДТВЕРЖДЕНО** (в отчёте честно помечено как непроверенное; теперь проверено) |
| 5 | `foundation-stage2-gate.md:27-28`: `controller.sqlite allocations=[]`, `registry.sqlite allocations=[{background_job:7},{artifact-retention:8}]` | дамп `migration_allocations` read-only | **ПОДТВЕРЖДЕНО** дословно |
| 6 | `foundation-stage2-gate.md:14`: «14 ok-шагов, 0 FAIL» | `Select-String 'await step\('` = 14; прогон = 14 `ok` | **ПОДТВЕРЖДЕНО** |
| 7 | `foundation-31-adapters.md:31`: «`defineAdapterManifest` бросает `TypeError` на неизвестный kind» | `capabilities.ts:75-77` + пробник `register({kind:'planner'})` → `TypeError: declares unknown kind "planner"` | **ПОДТВЕРЖДЕНО** |
| 8 | Набор версий 1..8 плотный, `background_job→7`, `artifact-retention→8` | журнал `schema_migrations` боевой изолированной базы: `1:outbox-inbox, 2:artifact-audit, 3:evidence-immutability, 4:controller-lease, 5:plan-mutation, 6:claim-saga, 7:background-job, 8:artifact-retention` | **ПОДТВЕРЖДЕНО** |
| 9 | Отчёт F-28 не упоминает, что D07-имя `myworkApplication` не реализовано (см. MINOR-5) | grep: сервиса нет; `ctx` публикует только `myworkController`/`myworkAdapters` | **УМОЛЧАНИЕ**, не ложь: отклонение от решения нигде не зафиксировано |

---

## 7. Что осталось непроверенным и почему

1. **Пересборка вместо копии.** Мутации откатывались копией (хеш совпал), а не `corepack pnpm --filter @dsh-mywork/storage run build`: сборка тяжёлая, а копия бит-в-бит доказуема. Что `lib/` соответствует `src/` на HEAD — не проверял (это отдельный шаг «build из чистого дерева»).
2. **Реальное поведение `withFileLock` при двух процессах** — не проверял: гонка воспроизводится только межпроцессно, а F-34 шаг 0 честно откладывает применение (список файлов состояния пуст).
3. **`pruneAuditEvents` на голом соединении** (MINOR-4) — вывод из кода, не из прогона: `MyWorkStore` не отдаёт соединение наружу, а собирать сценарий с `openSqlite` вручную я счёл избыточным.
4. **Поведение `start()` при отказе `openStore` в середине** (каталог только для чтения, занятый файл) — помечено как непроверенное самим отчётом F-28; я не проверял, чтобы не создавать файлы вне `.tmp`.
5. **Часть B этапа 2** (boundaries F-41/F-42, adapters, model availability F-43, session conformance F-44, reachability F-45, `routing`/`adapters`-тесты, CI) — вне моего мандата, другой ревьюер.
6. **Этапы 0–1 и 3+** — вне мандата; `tests/**` целиком повторно не гонял (только перечисленные гейты и регрессионный `jobs-durable`/`atomic-write` после мутаций).
7. **Живой профиль и доска** — только `Test-Path` по красной линии; внутрь `C:\Users\Dmitry\.dsh` и в `task_board_*` не ходил.

---

### Приложение: артефакты проверки (scratch, не часть поставки)

`.tmp/stage2-review-a/`: `inspect-db.mjs`, `dump-triggers.mjs`, `allocations-dump.mjs`, `repro-numbers.mjs`, `bare-defaults.mjs`, `legacy-autovacuum-probe.mjs`, `adapter-kinds-probe.mjs`, `allocator-probe.mjs`, `tombstone-probe.mjs`, `lease-guard-probe.mjs`, `mutate.mjs`, `mutate2.mjs` (и два бэкапа `packages/storage/lib/index.js`).
Бэкап-файлы: `storage-lib-index.js.bak`, `storage-lib-index.js.bak2` — оба SHA256 `060A617BFACBBA8867E0A3EDA1B073EF0A21319970CE0B40DB23E0E781082594`, равны текущему собранному артефакту.
