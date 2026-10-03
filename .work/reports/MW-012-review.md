# MW-012 — независимое ревью

- Предмет ревью: карточка `MW-012` (claim saga, Attempts, leases, fences) в замороженном снимке `.tmp/mw012-review` (detached worktree на базе `f22dbc3b2eb97601e09fc4f341bcddd522544545` с артефактами MW-011 и MW-012, проверен перед выдачей: exit 0, 400 tests / 377 pass / 0 fail / 23 skip).
- Режим: **review**, read-only, отдельная сессия со свежим контекстом, мандат на состязательную проверку.
- Словарь вердикта: `PASS` / `PASS WITH FINDINGS` / `FAIL`.
- Что ревьюеру **не** передавалось: diff автора, его рассуждения и переписка. Отчёт `.work/reports/MW-012-attempt-saga.md` был единственным проводом, плюс сам снимок.

## Вердикт

**PASS WITH FINDINGS** — все три критерия приёмки подтверждены независимыми пробами, но в таблице решений §49 найдены два MAJOR-дефекта, которых суита автора не видит.

## Проверенные команды (сводка)

| Проверка | Результат |
|---|---|
| `pnpm run check` до и после всех мутаций ревьюера | exit 0, **400 / 377 pass / 0 fail / 23 skip** — числа автора воспроизводятся |
| `tests/claim-saga.test.mjs` | 26 / 26 pass |
| `tests/beads-adapter.test.mjs` | 70 tests / **47 pass** / 0 fail / 23 skip (в отчёте §1 стояло «45 pass» — устарело) |
| `{attempt,task,beads-adapter,events,boundaries}` | **124 tests / 101 pass** / 0 fail / 23 skip (в отчёте §5 стояло «121/98») |
| Mutation-батарея автора (прогнана копией с перенаправленным `$repo`) | **8/8 CAUGHT** ровно с числами автора; `RESTORE OK`; `BATTERY OK` |
| `probe-lease-invariant.mjs` | `sqlite_master.sql` содержит `WHERE settled_at IS NULL`; `PRAGMA index_list` → `unique=1 partial=1`; сырой `INSERT` второй живой попытки отвергнут SQLite; понижение fence отвергнуто триггером |
| `probe-recover-cross-saga.mjs` | **MAJOR 1 воспроизведён**: `recover(S1)` отозвал живой lease саги S2 |
| `probe-step4-5-window.mjs` | **MAJOR 2 воспроизведён**: `recover` бросил `TASK_CONFLICT illegal transition assigned → assigned` |
| `probe-recovering-deadend.mjs` | MINOR 3: `recover` вернул `ok` на неустранённой открытой саге; `advanceIntent` принял `completed → recovering` |
| `probe-concurrent-recover.mjs` | in-process гонка двух `recover` безопасна: второй attempt не создан |
| `claim-crash-child.mjs … after-claim` напрямую | exit 7, `{"phase":"claim-landed"}` — реальная смерть процесса подтверждена |
| Дополнительные мутации ревьюера R1 / R2 | R1 (revision-проверка) **CAUGHT**; R2 (проверка fence попытки) **MISSED** |

## Findings

| # | Severity | Суть | Статус после исправлений автора |
|---|---|---|---|
| F1 | **MAJOR** | `recover` читает живую попытку **по задаче**, а не по своей саге, и это значение уходит в `reconcileClaim.attemptExists`, хотя контракт объявляет его как «attempt for **this** claim». Проба: сага S1 (superseded) отозвала живой lease новой саги S2, `live attempts = 0`, `settle` от S2 → `TASK_CONFLICT/attempt-already-settled`, исход отдан под чужим `operationId`. §49 применён к чужой, здоровой попытке | **ИСПРАВЛЕНО**: добавлен `readSagaAttempt(operationId)`; `attemptExists` строится по своей саге; живая попытка другой саги закрывает intent как `abandoned`, не касаясь lease. Регрессионный тест `recovery never revokes another saga's live lease` |
| F2 | **MAJOR** | Окно §9 между шагом 4 (проекция легла) и шагом 5 (commit) не покрыто и неразрешимо: `recover` безусловно повторяет `transition(→assigned)`, отказ вылетает **исключением** из API, обещающего `Result`. С реальным адаптером то же окно даёт вечный `STALE_REVISION`, потому что шаг 4 передаёт `expectedRevision`, сдвинутый им же | **ИСПРАВЛЕНО** (автор нашёл то же окно своей пробой до получения ревью): проекция идемпотентна (наблюдение «задача уже `assigned`» завершает сагу), шаг 4 получил собственное состояние `projected`, `recover` доводит любой незавершённый state. Регрессионные тесты `a crash between the projection and the completion is recoverable, not stuck` и `recovery finishes a saga left in projected, and one left in recovering` |
| F3 | MINOR | `recover` доводил сагу только при `state === 'attempted'`; прочие открытые состояния возвращали `ok` и оставляли intent открытым навсегда. `advanceIntent` — CAS без таблицы переходов | **ИСПРАВЛЕНО**: ветка ключуется на «ещё не `completed`»; недостижимый остаток отвечает типизированным отказом `claim-unfinishable` вместо `ok` |
| F4 | MINOR | `tests/boundaries.test.mjs` не знал про `packages/execution` — у нового пакета не было ни одной границ-проверки | **ИСПРАВЛЕНО**: три проверки (разрешённые импорты, запрет продуктов/драйверов/чужих слоёв + манифест, самодостаточность бандла). Проверено, что они **падают** при подмене (`node:sqlite` в `src`) и зеленеют после восстановления |
| F5 | MINOR | `attempt.lease.revoked` слался при **создании** попытки, хотя контракт описывает тип как «lease was taken away»; проекция MW-047 прочитала бы выдачу lease как отзыв | **ИСПРАВЛЕНО**: добавлен `attempt.lease.granted`; `revoked` остаётся только за отзывом |
| F6 | NIT | Восстановленная попытка получала синтетический `agentId = 'recovery:<decidedBy>'` и зашитый `leaseMs = 60_000`, хотя `AttemptRecord.agentId` — «identity performing the work» | **ИСПРАВЛЕНО**: `agentId` и `leaseMs` записываются в intent на шаге 1 и используются при восстановлении; сага без них отказывает `claim-agent-missing` вместо выдумывания |
| F7 | NIT | `settle` не валидировал `command.to` и `command.meta`: `to: 'leased'` записал бы `settled_at` на нетерминальное состояние и освободил lease-слот | **ИСПРАВЛЕНО**: целевое состояние обязано быть терминальным, `meta` валидируется до чтения стора |
| F8 | NIT | Состояние `'projected'` было объявлено в контракте, CHECK и `listOpenIntents`, но не писалось нигде | **ИСПРАВЛЕНО** вместе с F2: шаг 4 теперь имеет собственное наблюдаемое состояние |
| F9 | NIT | `reconcileClaim` при нечитаемом графе возвращал `action: 'complete'`, хотя `reason` говорил «ничего не решается», а экспортированный `isClaimReconciliationSettled('complete')` возвращал `true` | **ИСПРАВЛЕНО**: введён отдельный `action: 'undecided'`; вводящий в заблуждение `isClaimReconciliationSettled` удалён как мёртвый код |
| F10 | NIT | Устаревшие числа в отчёте (§1 «45 pass», §5 «121/98», `lib/index.js` «97.45 kB») | **ИСПРАВЛЕНО**: числа обновлены по факту |

## Что ревьюер подтвердил как корректное

- **«≤1 lease на Task» держит база, а не код**: частичный уникальный индекс подтверждён через `sqlite_master` и `PRAGMA index_list`, сырой `INSERT` второй живой попытки отвергнут SQLite, слот освобождается заселением.
- **Late result отклоняется по токену задачи** (`readFence`), затем epoch, затем fence попытки; подмена сравнения (M3) валит именно late-result тест.
- **Пути ко второй попытке нет**: id попытки = `attempt-<operationId>` (PK), частичный уникальный индекс, CAS-переходы; ветки `recover` и happy path — буквально одна функция `attemptAndComplete`.
- **Нечитаемый граф** не решает сагу (`readTask` отличает отказ от отсутствия).
- **Mutation-батарея честна**: прогнана целиком, числа совпали, три добавленных теста существуют, не skipped и именно они ловят M7/M8.
- **Правка `assignee`** (вне объявленного объёма, по решению владельца) согласована, один источник правды, §8 не нарушен, чужие тесты не сломаны.
- **Вакуумных тестов не найдено**; guard-ассерты на непустоту разбора присутствуют.

## Непокрытое, названное ревьюером

1. **`assertFence(expectedFence, attempt.fence)` не покрыт**: мутация R2 (обнуление проверки) даёт MISSED — суита не отличает эту защиту от её отсутствия. Единственный известный непокрытый guard.
2. **Живой `bd` недоступен**: неизвестно, бампает ли `bd update --claim` revision. Если да, шаг 4 с `expectedRevision = baseRevision` (снятым до claim) будет устаревать на happy path. Названо главным непроверенным риском интеграции; фейк суиты revision при claim не двигает, поэтому для тестов это невидимо.
3. **Межпроцессная гонка** на одной SQLite не воспроизводилась (in-process проверена и безопасна).

## Что сделано после ревью

Все десять находок закрыты в рабочем дереве (F1, F2 — MAJOR; F3, F4, F5 — MINOR; F6–F10 — NIT), каждая с регрессионным тестом или проверяемой правкой; §11 отчёта `.work/reports/MW-012-attempt-saga.md` фиксирует соответствие. Независимая проверка исправлений — отдельный проход; вердикт ревьюера приёмкой не является, приёмка остаётся за владельцем.
