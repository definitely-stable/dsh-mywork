# F-29b · Подключение фабрик F-36/F-40 к каноническому набору (схема v8)

**Статус: READY_FOR_REVIEW** — гейт этапа 2 (часть A) пройден повторно, схема в изолированном доме стала **v8**.

## Что сделано

1. В `app.ts` появились:
   - `MYWORK_DATABASE_MIGRATIONS` — базовый канонический список (v1…v6, без изменений);
   - `ALLOCATED_MIGRATIONS` — заявки `background_job` и `artifact-retention` (ключ = стабильная идентичность заявки, не номер);
   - `myworkDatabaseMigrations(allocator)` — полный список: база + миграции, которым номер выдал аллокатор, в порядке выдачи (публикуется из пакета).
2. Порядок старта изменён: **сначала `registry.sqlite` (база v6), затем аллокатор на нём, затем `controller.sqlite` сразу на полном списке**. Реестр — книга учёта выданных номеров (F-63): номер решается **до** открытия базы, в которую миграция ложится, поэтому контроллер открывается сразу на финальной схеме, а `openStore(` остаётся ровно 2.
3. Тесты `tests/app-store.test.mjs` дополнены проверками: схема **v8**, журнал `[1..8]`, имена двух выделенных миграций, таблица `background_job`, таблица `artifact_tombstone`, условный триггер `artifacts_no_delete` (его тело ссылается на tombstone), книга аллокатора `background_job → 7`, `artifact-retention → 8`. `tests/app-subsystems.test.mjs` — следующий номер берётся как `schemaVersion + 1` (не литерал).
4. `scripts/smoke.mjs`: шаг схемы теперь собирает список **тем же способом, что и корень** (скретч-база → аллокатор → `myworkDatabaseMigrations`) и проверяет на реальном файле `schemaVersion === 8`, журнал `[1..8]`, наличие `background_job` и триггера `artifacts_no_delete` — без литералов версий в скрипте.
5. Живой профиль: во всех четырёх `tests/app-*.test.mjs` `process.env.DSH_HOME` выставляется на скретч-каталог под `.tmp/` **до** импорта бандла контроллера (плюс позитивная проверка, что путь внутри `.tmp/`). Локальная реализация помечена `TODO(task-14)` — заменить на `scratchDshHome`/`assertScratchHome` из `tests/lib/tmp-home.mjs`, когда его положит hygiene-ops.

## Изменённые пути

- Modify `packages/controller/src/app.ts`, `packages/controller/src/index.ts`
- Modify `tests/app-store.test.mjs`, `tests/app-subsystems.test.mjs`, `tests/app-adapters.test.mjs`, `tests/app-lifecycle.test.mjs`
- Modify `scripts/smoke.mjs`
- Create `.work/plan-v0.3/evidence/foundation-29b-migration-wiring.md`

## Таблица «команда → exit code → наблюдение»

| Команда | exit | Наблюдение |
| --- | --- | --- |
| `node --test --test-isolation=none tests/app-lifecycle.test.mjs` | **0** | `tests 2 / pass 2 / fail 0 / skipped 0` |
| `node --test --test-isolation=none tests/app-store.test.mjs` | **0** | `tests 2 / pass 2 / fail 0 / skipped 0` — включая v8, журнал `[1..8]`, `background_job`, `artifact_tombstone`, триггер, книгу аллокатора |
| `node --test --test-isolation=none tests/app-subsystems.test.mjs` | **0** | `tests 1 / pass 1 / fail 0 / skipped 0` |
| `node --test --test-isolation=none tests/app-adapters.test.mjs` | **0** | `tests 2 / pass 2 / fail 0 / skipped 0` |
| `node scripts/smoke.mjs` | **0** | `smoke: all steps passed`, `ok`-шагов **14**, FAIL **0** — **гейт этапа 2 (часть A)** |
| `Test-Path '<repo>\.tmp\smoke-home\dsh-mywork\state\controller.sqlite'` | 0 | **True**; шаг схемы в smoke утверждает `schemaVersion === 8` и журнал `[1..8]` на этом файле |
| `Select-String packages\controller\src\app.ts -Pattern 'openStore\('` | 0 | **2** (registry + controller) |
| `Select-String packages\controller\src\app.ts -Pattern 'version: \d'` | 0 | **0** — версии не литералы; числа приходят от `MigrationAllocator` (7 и 8) |
| `Test-Path 'C:\Users\Dmitry\.dsh\dsh-mywork'` до и после прогонов | 0 | **False → False** — живой профиль не тронут |
| `tsc --noEmit -p packages/controller/tsconfig.json` | 0 | ошибок типов нет |
| `corepack pnpm --filter @dsh-mywork/controller run build` | **0** | `Build complete in 58615ms` (heap 8192 из скрипта пакета); `lib/index.js` 434 506 Б |

## Решения, которые стоит знать

- **Реестр остаётся на базовой схеме (v6)**, контроллер — на v8. Это следствие того, что книга аллокатора открывается первой: реестру нужны только kernel (v1) и lease (v4), а `background_job`/ретенция относятся к контроллеру. Если реестр когда-нибудь понадобится на v8 — это отдельное решение (и оно упрётся в те же 2 сайта `openStore(`).
- **Нумерация самовосстанавливающаяся:** номера детерминированы от базового списка, поэтому даже потеря книги (`migration_allocations` в реестре) выдаст те же 7 и 8 и совпадёт с журналом контроллера.
- **Smoke создаёт скретч-базу** `.tmp/smoke-home/migration-numbers.sqlite` только чтобы получить номера тем же путём, что корень; на проверяемый файл она не влияет.

## Ограничения

- Порядок аллокации фиксирован порядком `ALLOCATED_MIGRATIONS` (background_job, затем artifact-retention) — при добавлении новой заявки она получит следующий номер, но **в конец** списка; «вставить в середину» нельзя, и это правильно (номера не переиспользуются).
- Тесты создают базы с нуля; апгрейд существующей v6-базы проверяется косвенно (аллокатор + `runMigrations` применяют 7 и 8 при открытии), отдельного теста на «база уже была v6» нет.
- Локальная установка `DSH_HOME` в четырёх тестах — временная (см. `TODO(task-14)`); после появления общего хелпера строки надо заменить.

## Что НЕ проверено

- Прогон `tests/adapters.test.mjs` и `tests/routing.test.mjs` (не мои файлы; они всё ещё монтируют контроллер без своего `DSH_HOME` — заявка владельцам).
- Поведение при одновременном открытии реестра двумя процессами (аллокатор транзакционен, но конкурентный сценарий не воспроизводился).
- Прогон `verify:profile` и repo-wide гейт F-46 — за Lead'ом.

## Доработка: переход на общий хелпер `tests/lib/tmp-home.mjs`

Локальная установка `DSH_HOME` (с пометкой `TODO(task-14)`) заменена на общий хелпер hygiene-ops во всех четырёх файлах:

```js
import { assertScratchHome, scratchDshHome } from './lib/tmp-home.mjs'

// до динамического импорта бандла контроллера
scratchDshHome('app-lifecycle')
assertScratchHome()
```

`assertScratchHome()` вызывается **на уровне модуля, до импорта бандла** — то есть строже, чем «в начале теста»: он падает раньше, чем что-либо откроет состояние, и проверяет именно положительное свойство («дом внутри `<repo>/.tmp/`»), а не отсутствие совпадения с живым профилем. Локальные `mkdirSync` + самодельный `startsWith`-ассерт удалены (вместе с неиспользуемым импортом `mkdirSync`).

| Команда | exit | Наблюдение |
| --- | --- | --- |
| `node --test --test-isolation=none tests/app-lifecycle.test.mjs` | **0** | `tests 2 / pass 2 / fail 0` |
| `node --test --test-isolation=none tests/app-store.test.mjs` | **0** | `tests 2 / pass 2 / fail 0` |
| `node --test --test-isolation=none tests/app-subsystems.test.mjs` | **0** | `tests 1 / pass 1 / fail 0` |
| `node --test --test-isolation=none tests/app-adapters.test.mjs` | **0** | `tests 2 / pass 2 / fail 0` |
| `node scripts/smoke.mjs` | **0** | `ok`-шагов 14, FAIL 0 |
| `Test-Path 'C:\Users\Dmitry\.dsh\dsh-mywork'` до и после | 0 | **False → False** |
| `Get-ChildItem .tmp -Directory -Filter 'app-*-dsh-home'` | 0 | 4 каталога: `app-adapters-dsh-home`, `app-lifecycle-dsh-home`, `app-store-dsh-home`, `app-subsystems-dsh-home` — то есть переменная действительно указывала внутрь `.tmp` |

Замечание: каталог, который тест передаёт приложению как `dshHome`, остался отдельным (`mkdtemp` на тест) — он должен быть **чистым** в каждом тесте (первый тест `app-store` утверждает, что каталога состояния ещё нет). Хелпер управляет переменной окружения; изоляция самих баз — по-прежнему на тест.
