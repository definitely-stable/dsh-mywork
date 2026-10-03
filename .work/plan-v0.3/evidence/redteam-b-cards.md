# Red Team B — сырые выводы скриптов (кампания v0.3, 2026-09-27)

Скрипты: `.tmp/plan-v03-red-b/{graph,crosschecks,crosschecks2,cedits,sidebyside,stepcards}.ps1`.
Все команды — только чтение; `.work/tasks/**` не изменялся.

## 1. `cedits.ps1` — 65 цитат «было» против фактических строк карточек

```text
   C-blocks found: 55

===== C-XX edits: quoted "было" text located in the real card =====
   C-01   MW-001  declared=20      found=      NOT-FOUND              
   C-02   MW-004  declared=17      found=      NOT-FOUND              
   C-02   MW-004  declared=20      found=      NOT-FOUND              
   C-03   MW-007  declared=17      found=      NOT-FOUND              
   C-04   MW-010  declared=21      found=      NOT-FOUND              
   C-05   MW-011  declared=21      found=      NOT-FOUND              
   C-06   MW-013  declared=17      found=      NOT-FOUND              
   C-07   MW-015  declared=17      found=      NOT-FOUND              
   C-08   MW-005  declared=20      found=      NOT-FOUND              
   C-09   MW-009  declared=        found=20    FOUND-ELSEWHERE(20)    Два Controller не становятся writer одновременно. FakeClock
   C-10   MW-016  declared=        found=17    FOUND-ELSEWHERE(17)    Реализовать discover → rank/budget → materialize, L0/L1/L2,
   C-11   MW-017  declared=17      found=17    ok                     Добавить версионируемые skills со scope/trust/compatibility/
   C-11   MW-017  declared=20      found=20    ok                     Проверки scope, version pinning и lazy loading. Неподдержива
   C-12   MW-018  declared=        found=17    FOUND-ELSEWHERE(17)    Ввести retain/recall/optional reflect, scopes/kinds/provenan
   C-13   MW-019  declared=        found=20    FOUND-ELSEWHERE(20)    Conformance: scope isolation, idempotency, invalid ref, time
   C-14   MW-020  declared=17      found=17    ok                     Fresh Session per Attempt/Review/planning. Capsule содержит
   C-15   MW-021  declared=17      found=17    ok                     Для coding Attempt pin base SHA, создать отдельную branch/wo
   C-16   MW-022  declared=17      found=17    ok                     Связать scheduler → claim → worktree → frozen context → fres
   C-17   MW-023  declared=        found=20    FOUND-ELSEWHERE(20)    Failing/missing gate блокирует review admission и Done. Gate
   C-18   MW-024  declared=17      found=17    ok                     Добавить отдельную Review очередь/pool, fresh Session, evide
   C-19   MW-025  declared=        found=      NOT-FOUND              …Нужные разделы: §9 (строка 440), §19 (строка 1036), §20 (ст
   C-20   MW-026  declared=        found=      NOT-FOUND              …Мутация с update существующей задачи отклоняется с PLANNER_
   C-21   MW-027  declared=1       found=1     ok                     НЕ ЗАПУСКАТЬ. Карточка снята с исполнения как superseded
   C-22   MW-028  declared=        found=17    FOUND-ELSEWHERE(17)    Запускать Controller от lifecycle плагина в embedded и отдел
   C-23   MW-029  declared=        found=21    FOUND-ELSEWHERE(21)    Первым шагом проверено, проходит ли http-bridge потоковый от
   C-24   MW-030  declared=17      found=17    ok                     Реализовать autonomy L0–L3 и operation gates для миграций/se
   C-25   MW-031  declared=17      found=17    ok                     Reconcile claim без Attempt, Attempt без runtime, expired le
   C-26   MW-033  declared=17      found=17    ok                     Baseline ручного/планового optimizer run по batch history: s
   C-27   MW-034  declared=17      found=17    ok                     Учитывать system/role/task/workspace/memory/skills/history/t
   C-28   MW-035  declared=1       found=1     ok                     НЕ ЗАПУСКАТЬ. Карточка снята с исполнения как superseded
   C-29   MW-036  declared=        found=      NOT-FOUND              …Нужные разделы: §6 (строка undefined), §13 (строка 611), §1
   C-30   MW-037  declared=        found=      NOT-FOUND              …Нужные разделы: §25 (строка undefined), §34 (строка 2048),
   C-31   MW-038  declared=4       found=4     ok                     Зависимости: MW-010, MW-015, MW-019, MW-027, MW-029, MW-031
   C-31   MW-038  declared=13      found=4     ok                     Зависимости: MW-010, MW-015, MW-019, MW-027, MW-029, MW-031
   C-31   MW-038  declared=17      found=17    ok                     Doctor показывает installed/contract versions, required capa
   C-32   MW-039  declared=17      found=17    ok                     Собрать deterministic интеграционные/fault/property checks д
   C-33   MW-040  declared=17      found=17    ok                     Сделать backup→migrate→verify→activate, migration journal, e
   C-34   MW-041  declared=4       found=4     ok                     Зависимости: MW-028, MW-036, MW-037, MW-038, MW-039, MW-040,
   C-34   MW-041  declared=14      found=      NOT-FOUND              …Нужные разделы: §5 (строка 242), §62 (строка 2750), §63 (ст
   C-34   MW-041  declared=18      found=17    FOUND-ELSEWHERE(17)    Сверить все 39 требований §62 с реализацией/evidence. Выполн
   C-35   MW-042  declared=18      found=      NOT-FOUND              …заменить TaskBoardPlacement на BoardPlacement. В packages/c
   C-36   MW-043  declared=4       found=4     ok                     Зависимости: MW-042, MW-011, MW-026
   C-36   MW-043  declared=13      found=13    ok                     Зависимости: MW-042, MW-011, MW-026. Проверь их результаты п
   C-36   MW-043  declared=5       found=5     ok                     Board ID: не создана — карточка принадлежит доске MyWork, а
   C-37   MW-044  declared=18      found=      NOT-FOUND              …Реализовать один engine внутри resident controller: frozen
   C-38   MW-045  declared=18      found=18    ok                     Добавить contracts/src/worktype.ts (WorkType, FinishCriteria
   C-39   MW-046  declared=4       found=4     ok                     Зависимости: MW-012, MW-022, MW-030
   C-39   MW-046  declared=18      found=18    ok                     Добавить DiscussionMessage (comment, decision, question, ste
   C-40   MW-047  declared=18      found=18    ok                     Реализовать TaskBoardPort и проектор доски в resident contro
   C-41   MW-048  declared=18      found=18    ok                     Создать packages/web (@dsh-mywork/web) с exports["./client"]
   C-42   MW-049  declared=18      found=18    ok                     Реализовать раскладку grid-3x3 по умолчанию (девять независи
   C-43   MW-050  declared=21      found=      NOT-FOUND              
   C-44   MW-051  declared=        found=21    FOUND-ELSEWHERE(21)    Редактор не может сохранить документ, который отвергает вали
   C-45   MW-052  declared=18      found=18    ok                     Реализовать представление зависимостей (DAG), calendar по du
   C-46   MW-053  declared=        found=21    FOUND-ELSEWHERE(21)    Матрица из пяти режимов проходит, и результат каждого записа
   C-47   MW-054  declared=18      found=      NOT-FOUND              
   C-48   MW-055  declared=18      found=      NOT-FOUND              …и прогнать миграцию на копии реального ledger без изменения
   C-48   MW-055  declared=21      found=21    ok                     Прогон мастера импорта на копии реального ledger из 41 карто
   C-49   MW-002  declared=17      found=      NOT-FOUND              …Использовать подтверждённый SDK и его правила публикации
   C-50   MW-003  declared=        found=17    FOUND-ELSEWHERE(17)    Описать Task/Attempt/Review, Agent Identity/Blueprint/Role,
   C-51   MW-006  declared=        found=17    FOUND-ELSEWHERE(17)    Ввести global/isolated/inherit с порядком overlays, Team, Ro
   C-52   MW-008  declared=17      found=17    ok                     Создать локальный immutable artifact store с hash/ref и appe
   C-53   MW-012  declared=        found=17    FOUND-ELSEWHERE(17)    Добавить ClaimIntent → graph claim → Attempt+lease → project
   C-54   MW-014  declared=17      found=17    ok                     Сделать event-driven kick и safety reconcile, eligibility по
   C-55   MW-032  declared=        found=20    FOUND-ELSEWHERE(20)    Candidate не меняет Role Contract/security автоматически. По

   totals: edits with quoted text = 65; ok on declared line = 31; found elsewhere = 14; NOT FOUND = 20

===== card line counts (are declared line numbers in range?) =====
   C-01   MW-001  lines=24   maxDeclaredLine=20
   C-02   MW-004  lines=24   maxDeclaredLine=20
   C-03   MW-007  lines=24   maxDeclaredLine=17
   C-04   MW-010  lines=25   maxDeclaredLine=21
   C-05   MW-011  lines=25   maxDeclaredLine=21
   C-06   MW-013  lines=24   maxDeclaredLine=17
   C-07   MW-015  lines=24   maxDeclaredLine=17
   C-08   MW-005  lines=24   maxDeclaredLine=20
   C-09   MW-009  lines=24   maxDeclaredLine=0
   C-10   MW-016  lines=24   maxDeclaredLine=0
   C-11   MW-017  lines=24   maxDeclaredLine=20
   C-12   MW-018  lines=24   maxDeclaredLine=0
   C-13   MW-019  lines=24   maxDeclaredLine=0
   C-14   MW-020  lines=24   maxDeclaredLine=17
   C-15   MW-021  lines=24   maxDeclaredLine=17
   C-16   MW-022  lines=24   maxDeclaredLine=17
   C-17   MW-023  lines=24   maxDeclaredLine=0
   C-18   MW-024  lines=24   maxDeclaredLine=17
   C-19   MW-025  lines=24   maxDeclaredLine=0
   C-20   MW-026  lines=24   maxDeclaredLine=0
   C-21   MW-027  lines=34   maxDeclaredLine=1
   C-22   MW-028  lines=24   maxDeclaredLine=0
   C-23   MW-029  lines=25   maxDeclaredLine=0
   C-24   MW-030  lines=24   maxDeclaredLine=17
   C-25   MW-031  lines=24   maxDeclaredLine=17
   C-26   MW-033  lines=24   maxDeclaredLine=17
   C-27   MW-034  lines=24   maxDeclaredLine=17
   C-28   MW-035  lines=34   maxDeclaredLine=1
   C-29   MW-036  lines=25   maxDeclaredLine=0
   C-30   MW-037  lines=24   maxDeclaredLine=0
   C-31   MW-038  lines=24   maxDeclaredLine=17
   C-32   MW-039  lines=24   maxDeclaredLine=17
   C-33   MW-040  lines=24   maxDeclaredLine=17
   C-34   MW-041  lines=24   maxDeclaredLine=18
   C-35   MW-042  lines=25   maxDeclaredLine=18
   C-36   MW-043  lines=25   maxDeclaredLine=13
   C-37   MW-044  lines=25   maxDeclaredLine=18
   C-38   MW-045  lines=25   maxDeclaredLine=18
   C-39   MW-046  lines=25   maxDeclaredLine=18
   C-40   MW-047  lines=25   maxDeclaredLine=18
   C-41   MW-048  lines=25   maxDeclaredLine=18
   C-42   MW-049  lines=25   maxDeclaredLine=18
   C-43   MW-050  lines=25   maxDeclaredLine=21
   C-44   MW-051  lines=25   maxDeclaredLine=0
   C-45   MW-052  lines=25   maxDeclaredLine=18
   C-46   MW-053  lines=25   maxDeclaredLine=0
   C-47   MW-054  lines=25   maxDeclaredLine=18
   C-48   MW-055  lines=25   maxDeclaredLine=21
   C-49   MW-002  lines=24   maxDeclaredLine=17
   C-50   MW-003  lines=24   maxDeclaredLine=0
   C-51   MW-006  lines=24   maxDeclaredLine=0
   C-52   MW-008  lines=24   maxDeclaredLine=17
   C-53   MW-012  lines=24   maxDeclaredLine=0
   C-54   MW-014  lines=24   maxDeclaredLine=17
   C-55   MW-032  lines=24   maxDeclaredLine=0

```

## 2. `sidebyside.ps1` — объявленная строка против фактической

```text
===== C-01  MW-001  (card file: 24 lines) =====
   declared: MW-001, строка 20 (текст приёмки).
   real:20  Матрица supported/unsupported/unverified содержит ссылки на исходники или результаты безопасных проб. Отсутствующие критические capabilities явно блокируют соответствующи…
   БЫЛО:  - **Было (строка 20):**
   СТАЛО: - **Стало (строка 20, добавлено в конец):**

===== C-04  MW-010  (card file: 25 lines) =====
   declared: MW-010, строка 21 (текст приёмки, ~2 200 символов).
   real:21  AdapterCapabilityManifest перечисляет http, graph-apply, batch, batch-dep-remove, guarded-batch, metadata-set, events-journal, claim-lease, heartbeat, reclaim, и отсутств…
   БЫЛО:  - **Было (строка 21, дословная цитата, ключевой фрагмент):**
   СТАЛО: - **Стало (строка 21, добавлено в конец):**

===== C-05  MW-011  (card file: 25 lines) =====
   declared: MW-011, строка 21.
   real:21  Отклоняются cycles, stale revisions и недопустимые изменения running Task: running task меняется только по явной policy. Composite-мутация с dep_remove проходит через sta…
   БЫЛО:  - **Было (строка 21, ключевой фрагмент):**
   СТАЛО: - **Стало (добавлено в конец строки 21):**

===== C-06  MW-013  (card file: 24 lines) =====
   declared: MW-013, строка 17 (объём), строка 20 (приёмка).
   real:17  Использовать реальный DSH model catalog: preferred/fallback/escalation, provider availability и context window. Добавить limits tokens/cost/attempts/review loops/planner/…
   real:20  FakeProvider проверяет лимит ровно на границе, outage и отсутствие маршрута. Неизвестные cost/usage не выдаются за ноль. Исчерпание бюджета останавливает admission и выда…
   БЫЛО:  - **Было (строка 17):**
   СТАЛО: - **Стало (строка 17):**
   СТАЛО: - **Стало (строка 20, добавлено):**

===== C-10  MW-016  (card file: 24 lines) =====
   declared: MW-016, строка 17 (объём).
   real:17  Реализовать discover → rank/budget → materialize, L0/L1/L2, mandatory role/task/security и working/safety reserve от выбранной модели. Snapshot фиксирует revisions, route…
   БЫЛО:  - **Было:** `Реализовать discover → rank/budget → materialize, L0/L1/L2, mandatory role/task/security и working/safety reserve от выбранной модели. Snapshot фиксирует revisions, route, tools, hashes, …
   СТАЛО: - **Стало (добавлено в конец):** `Тяжёлые L2-блоки offload'ятся через платформенный ctx.spillStore (SpillStore.saveText → SpillRef; реализация @deepseek-ai/dsh-…

===== C-15  MW-021  (card file: 24 lines) =====
   declared: MW-021, строка 17 (объём), строка 20 (приёмка).
   real:17  Для coding Attempt pin base SHA, создать отдельную branch/worktree, хранить base/head/diff hash и workspace binding. Cleanup/retention только по policy, с проверкой resol…
   real:20  Параллельные attempts не пишут в общий checkout. Нельзя выйти из разрешённого worktree; cleanup не удаляет чужую/грязную работу. Для пустого Git repo — явный precondition…
   БЫЛО:  - **Было (строка 17):** `Для coding Attempt pin base SHA, создать отдельную branch/worktree, хранить base/head/diff hash и workspace binding. Cleanup/retention только по policy, с проверкой resolved p…
   СТАЛО: - **Стало (добавлено):** `writeScopes/fs-write-intent — диагностика и предупреждение, а не lock: пересечение scope не блокирует запись, а фиксируется событием. …

===== C-16  MW-022  (card file: 24 lines) =====
   declared: MW-022, строка 17 (объём), строка 20 (приёмка).
   real:17  Связать scheduler → claim → worktree → frozen context → fresh Worker Session → evidence/checkpoint → settling. Identity остаётся долговечной; sleeping после завершения не…
   real:20  Один сценарий на fakes проходит end-to-end; failure сохраняет evidence и освобождает capacity. Restart и late callback не создают вторую authoritative попытку. Каждая поп…
   БЫЛО:  - **Было (строка 17):** `Связать scheduler → claim → worktree → frozen context → fresh Worker Session → evidence/checkpoint → settling. Identity остаётся долговечной; sleeping после завершения не держ…
   СТАЛО: - **Стало (добавлено в конец):** `Поверхность Worker Session не содержит cordis_* (dynamic-инструментов), plugin_manager и инструментов самостоятельного approve…
   СТАЛО: - **Стало (строка 20, добавлено):** `Тест проверяет список инструментов собранной сессии и падает при появлении cordis_-инструмента, dynamic-плагина или plugin_…

===== C-19  MW-025  (card file: 24 lines) =====
   declared: MW-025, строка 14.
   real:14  Архитектура: .work/architecture/DSH-My-Work-Architecture-v0.1.md. Нужные разделы: §9 (строка 440), §19 (строка 1036), §20 (строка 1067), §26 (строка undefined), §28 (стро…
   БЫЛО:  - **Было:** `…Нужные разделы: §9 (строка 440), §19 (строка 1036), §20 (строка 1067), §26 (строка undefined), §28 (строка 1875)…`
   СТАЛО: - **Стало:** `…Нужные разделы: §9 (строка 440), §19 (строка 1036), §20 (строка 1067), §26 (строка 1812), §28 (строка 1875)…`

===== C-29  MW-036  (card file: 25 lines) =====
   declared: MW-036, строка 14.
   real:14  Архитектура: .work/architecture/DSH-My-Work-Architecture-v0.1.md. Нужные разделы: §6 (строка undefined), §13 (строка 611), §14 (строка undefined), §28 (строка 1875), §54 …
   БЫЛО:  - **Было:** `…Нужные разделы: §6 (строка undefined), §13 (строка 611), §14 (строка undefined), §28 (строка 1875), §54 (строка 2548), §55 (строка 2567)…`
   СТАЛО: - **Стало:** `…Нужные разделы: §6 (строка 330), §13 (строка 611), §14 (строка 735), §28 (строка 1875), §54 (строка 2548), §55 (строка 2567)…`

===== C-30  MW-037  (card file: 24 lines) =====
   declared: MW-037, строка 14.
   real:14  Архитектура: .work/architecture/DSH-My-Work-Architecture-v0.1.md. Нужные разделы: §25 (строка undefined), §34 (строка 2048), §54 (строка 2548), §56 (строка undefined). Не…
   БЫЛО:  - **Было:** `…Нужные разделы: §25 (строка undefined), §34 (строка 2048), §54 (строка 2548), §56 (строка undefined)…`
   СТАЛО: - **Стало:** `…Нужные разделы: §25 (строка 1648), §34 (строка 2048), §54 (строка 2548), §56 (строка ~).…`

===== C-31  MW-038  (card file: 24 lines) =====
   declared: MW-038, строка 4 (шапка) и строка 17 (объём).
   real:4   Зависимости: MW-010, MW-015, MW-019, MW-027, MW-029, MW-031
   real:17  Doctor показывает installed/contract versions, required capabilities, connectivity/authentication, scopes/events/timeout/recovery по каждому adapter. Прогнать обязательны…
   БЫЛО:  - **Было (строка 4):** `Зависимости: MW-010, MW-015, MW-019, MW-027, MW-029, MW-031 `
   БЫЛО:  - **Было (строка 13, синхронная строка prompt'а):** `Зависимости: MW-010, MW-015, MW-019, MW-027, MW-029, MW-031. Проверь их результаты по исходникам и отчётам; если они не приняты, остановись с BLOCK…
   БЫЛО:  - **Было (строка 17):** `Doctor показывает installed/contract versions, required capabilities, connectivity/authentication, scopes/events/timeout/recovery по каждому adapter. Прогнать обязательные sui…
   СТАЛО: - **Стало (строка 4):** `Зависимости: MW-010, MW-015, MW-019, MW-042, MW-047, MW-029, MW-031 `
   СТАЛО: - **Стало (строка 13):** `Зависимости: MW-010, MW-015, MW-019, MW-042, MW-047, MW-029, MW-031. Проверь их результаты по исходникам и отчётам; если они не принят…
   СТАЛО: - **Стало (строка 17):** `Doctor показывает installed/contract versions, required capabilities, connectivity/authentication, scopes/events/timeout/recovery по к…
   СТАЛО: - **Стало (строка 20, добавлено):** `Прогон Doctor на живом профиле не мутирует его: проверка mtime/хэшей read-only, а любое исправление — отдельная явная коман…

===== C-35  MW-042  (card file: 25 lines) =====
   declared: MW-042, строка 18 (объём), строка 21 (приёмка).
   real:18  Добавить packages/contracts/src/board.ts (BoardZone, BOARD_ZONES, ZONE_BY_STATE, BoardViewMode, BoardView, BoardPlacement, DropIntent, CardCommand, CardInteraction, Degra…
   real:21  Каждый из 16 TaskState отображается ровно в одну из девяти зон, и property-тест перебирает все 16. projectTaskZone не может вернуть зону done для состояния, отличного от …
   БЫЛО:  - **Было (строка 18, ключевой фрагмент):** `…заменить TaskBoardPlacement на BoardPlacement. В packages/core добавить чистые board.ts (projectTaskZone, zoneOfState, assertSinglePlacement, legalDropTarg…
   СТАЛО: - **Стало (добавлено):** `Решение D02 = вариант C (гибрид). Девять зон остаются контрактом: BOARD_ZONES, BOARD_ZONE_ROWS (packages/contracts/src/board.ts:66), Z…
   СТАЛО: - **Стало (строка 21, добавлено):** `Правка текста приёмки по MW-042 решением D02 не требуется: формулировка «каждый из 16 TaskState отображается ровно в одну и…

===== C-36  MW-043  (card file: 25 lines) =====
   declared: MW-043, строка 4 (шапка), строка 5 (Board ID), строка 13 (prompt), строка 21 (приёмка).
   real:4   Зависимости: MW-042, MW-011, MW-026
   real:5   Board ID: не создана — карточка принадлежит доске MyWork, а не legacy ledger
   real:13  Зависимости: MW-042, MW-011, MW-026. Проверь их результаты по исходникам и отчётам; если они не приняты, остановись с BLOCKED и точной причиной.
   real:21  Идея не может получить attempt ни через API, ни через bulk: вызов admission для IdeaId возвращает UNSCHEDULABLE и не создаёт записей. «Разработать план» создаёт PlanMutat…
   БЫЛО:  - **Было (строка 4):** `Зависимости: MW-042, MW-011, MW-026 `
   БЫЛО:  - **Было (строка 13):** `Зависимости: MW-042, MW-011, MW-026. Проверь их результаты по исходникам и отчётам; если они не приняты, остановись с BLOCKED и точной причиной.`
   БЫЛО:  - **Было (строка 5):** `Board ID: не создана — карточка принадлежит доске MyWork, а не legacy ledger `
   СТАЛО: - **Стало (строка 4):** `Зависимости: MW-042, MW-011 `
   СТАЛО: - **Стало (строка 13):** `Зависимости: MW-042, MW-011. Проверь их результаты по исходникам и отчётам; если они не приняты, остановись с BLOCKED и точной причино…
   СТАЛО: - **Стало (строка 5):** строка удаляется (см. §1.1 и §5.2). На переходный период: `Board ID: не создана (проверено на снапшоте леджера 2026-09-16; соответствие …
   СТАЛО: - **Стало (строка 21, добавлено):** `Действие «Разработать план» возвращает типизированный PLANNER_UNAVAILABLE и не меняет состояние идеи, пока MW-026 не закрыт…

===== C-37  MW-044  (card file: 25 lines) =====
   declared: MW-044, строка 18 (объём).
   real:18  Добавить декларативный WorkflowRevision (contracts/src/workflow.ts) и core/src/workflow.ts: типизированные узлы (start, step, verify, ai-review, human-approval, integrate…
   БЫЛО:  - **Было (строка 18, ключевой фрагмент):** `…Реализовать один engine внутри resident controller: frozen workflow revision на attempt, L2 по умолчанию, L3 с авто-утверждением только additive-планов, hu…
   СТАЛО: - **Стало (добавлено):** `Движок не регистрируется в ctx.workflowEngine: на один контекст приходится один workflowEngine, и коллизия имён даёт вторую authority.…

===== C-41  MW-048  (card file: 25 lines) =====
   declared: MW-048, строка 18 (объём), строка 21 (приёмка).
   real:18  Создать packages/web (@dsh-mywork/web) с exports["./client"], манифестом dsh.client (platform web) и собственной сборкой lazy-CJS формата (banner window.__ModuleLoader__.…
   real:21  Bundle загружается страницей без пересборки web-приложения и без правок DSH. Выгрузка плагина убирает панель, иконку, маршруты и CSS; повторный mount/unmount не оставляет…
   БЫЛО:  - **Было (строка 18, ключевой фрагмент):** `Создать packages/web (@dsh-mywork/web) с exports["./client"], манифестом dsh.client (platform web) и собственной сборкой lazy-CJS формата (banner window.__M…
   СТАЛО: - **Стало (добавлено):** `Client-строка объявляется bare-именем пакета (@dsh-mywork/web) без пути; панель помечается dsh.client.immediately, чтобы монтироваться…
   СТАЛО: - **Стало (строка 21, добавлено):** `Тест/проверка регистрации: панель видна после refresh без ручного действия, иконка отрисована; ни один якорь панели не начи…

===== C-42  MW-049  (card file: 25 lines) =====
   declared: MW-049, строка 18 (объём), строка 21 (приёмка).
   real:18  Реализовать раскладку grid-3x3 по умолчанию (девять независимых панелей с sticky-заголовком, count, collapse и overflow) и strip-horizontal как альтернативу, включаемую в…
   real:21  По умолчанию рендерятся ровно девять панелей в сетке 3x3, и ни одна карточка не появляется в двух зонах. При ширине панели менее 1100 px раскладка переключается на strip-…
   БЫЛО:  - **Было (строка 18, ключевой фрагмент):** `Реализовать раскладку grid-3x3 по умолчанию (девять независимых панелей с sticky-заголовком, count, collapse и overflow) и strip-horizontal как альтернативу…
   СТАЛО: - **Стало (строка 18, заменено):** `Реализовать раскладку grid-3x3 по умолчанию — девять независимых панелей по числу зон контракта — и strip-horizontal как аль…
   СТАЛО: - **Стало (строка 21, ключевые фрагменты):** `По умолчанию рендерятся ровно девять панелей в сетке 3x3 — формулировка сохраняется решением D02, — и ни одна карт…

===== C-43  MW-050  (card file: 25 lines) =====
   declared: MW-050, строка 18 (объём), строка 21 (приёмка).
   real:18  Реализовать selection и multi-select, bulk-команды с per-card результатом, полную клавиатурную модель, drag-and-drop с подсветкой только легальных целей и обязательной пр…
   real:21  Keyboard-only проход выполняет все действия: выбор, перемещение, bulk, открытие detail, поиск. DnD не пишет board state напрямую и подсвечивает только легальные цели. Dro…
   БЫЛО:  - **Было (строка 21, четыре пункта дословно):**
   СТАЛО: - **Стало (заменено на исполнимые формулировки):**
   СТАЛО: - **Стало (строка 18, добавлено):** `Подсветка целей, причина drop'а и ссылка на сессию опираются на резолвер (MW-064) и на существующие контракты; UI не вводит…

===== C-47  MW-054  (card file: 25 lines) =====
   declared: MW-054, строка 18 (объём), строка 21 (приёмка).
   real:18  Реализовать read-only legacy adapter с preview, выбором карточек и commit, сохранением source ID, истории, execution links и provenance. Источник — файл ledger-v2.json, ч…
   real:21  Ни одной записи в legacy-ledger: хеш файла до и после мастера совпадает. done-карточки не выбираются и не появляются в колонке «Готово». Открытый execution блокирует comm…
   БЫЛО:  - **Было (строка 18, три ошибочных фрагмента дословно):**
   СТАЛО: - **Стало:**

===== C-48  MW-055  (card file: 25 lines) =====
   declared: MW-055, строка 18 (объём), строка 21 (приёмка).
   real:18  Прогнать матрицу из 33 сценариев приёмки доски и миграции, зафиксировать evidence с командой и тестом на каждый сценарий, проверить инварианты (нет false Done, нет исполн…
   real:21  Каждый из 33 сценариев имеет evidence с командой, exit code и наблюдаемым результатом; сценарий без evidence считается непройденным. Инвариант «нет false Done до review и…
   БЫЛО:  - **Было (строка 18, ключевой фрагмент):** `…и прогнать миграцию на копии реального ledger без изменения оригинала.`
   БЫЛО:  - **Было (строка 21, ключевой фрагмент):** `Прогон мастера импорта на копии реального ledger из 41 карточки не изменил оригинальный файл.`
   СТАЛО: - **Стало (добавлено):** `Число карточек в копии реального ledger берётся на момент прогона и печатается; «41» из текста карточки — это состояние снапшота 2026-…
   СТАЛО: - **Стало:** `Прогон мастера импорта на копии реального ledger (число карточек зафиксировано выводом команды) не изменил оригинальный файл — хеш до и после совп…
   СТАЛО: - **Стало (строка 4, зависимости):** `Зависимости: MW-053, MW-054, MW-031, MW-038, MW-039, MW-071, MW-073 `

===== C-49  MW-002  (card file: 24 lines) =====
   declared: MW-002, строка 17 (объём), строка 20 (приёмка).
   real:17  Создать dsh-mywork: package manifest, TypeScript build, plugin activation/dispose и минимальные команды проверок. Сохранить границы contracts/core/adapters/controller; пр…
   real:20  Плагин собирается, упаковывается локально и активируется/выгружается в изолированном тестовом профиле. Есть один воспроизводимый smoke и основа для FakeClock/FakeRuntime …
   БЫЛО:  - **Было (строка 17, ключевой фрагмент):** `…Использовать подтверждённый SDK и его правила публикации.`
   СТАЛО: - **Стало (добавлено):** `Манифест сразу объявляет peerDependencies по реально используемым сервисам (сегодня — только @deepseek-ai/cordis) с диапазоном >=0.1.7…
   СТАЛО: - **Стало (строка 20, добавлено):** `Проверка манифеста: peer-гейт установки не даёт отказов, а отсутствие обязательного peer'а даёт явную ошибку установки, а н…

===== C-52  MW-008  (card file: 24 lines) =====
   declared: MW-008, строка 17 (объём), строка 20 (приёмка).
   real:17  Создать локальный immutable artifact store с hash/ref и append-only audit. Сохранять verification/review/context/checkpoint evidence с workspace/task/attempt/correlation …
   real:20  Повторная запись с иным содержимым не перезаписывает artifact; хеш проверяется при чтении; секреты не попадают в метаданные. Audit переживает restart и log rotation.
   БЫЛО:  - **Было (строка 17):** `Создать локальный immutable artifact store с hash/ref и append-only audit. Сохранять verification/review/context/checkpoint evidence с workspace/task/attempt/correlation IDs; …
   СТАЛО: - **Стало (добавлено):** `Артефакты в BLOB не удаляются и не переписываются (запрет DELETE/UPDATE), поэтому рост ограничивается только окнами retention и VACUUM…
   СТАЛО: - **Стало (строка 20, добавлено):** `Повторная запись с иным содержимым не перезаписывает artifact (уже есть) и не считается ротацией; тест кладёт секрет-маркер…

===== C-54  MW-014  (card file: 24 lines) =====
   declared: MW-014, строка 17 (объём), строка 20 (приёмка).
   real:17  Сделать event-driven kick и safety reconcile, eligibility по role/capability/workspace/security/budget/provider, отдельные Worker/Reviewer pools, лимиты attempts/LLM/heav…
   real:20  Одинаковое состояние даёт одинаковое назначение; concurrency не превышает caps; dependency release будит ready задачу. Sleeping/idle не вызывает LLM; missed event восстан…
   БЫЛО:  - **Было (строка 17):** `Сделать event-driven kick и safety reconcile, eligibility по role/capability/workspace/security/budget/provider, отдельные Worker/Reviewer pools, лимиты attempts/LLM/heavy too…
   СТАЛО: - **Стало (добавлено):** `Время приходит только через инъецированные часы (ClockPort): Date.now() в домене запрещён, иначе расхождение с платформенным time-cont…

===== C-21  MW-027  (card file: 34 lines) =====
   declared: MW-027, строка 1 (шапка) и запись в `tasks.json`.
   real:1   > **НЕ ЗАПУСКАТЬ.** Карточка снята с исполнения как superseded.
   БЫЛО:  - **Было (строка 1):** `> **НЕ ЗАПУСКАТЬ.** Карточка снята с исполнения как superseded.`
   СТАЛО: - **Стало (строка 1, добавлено):** `> **НЕ ЗАПУСКАТЬ.** Карточка снята с исполнения как superseded. **Архивирована в v0.3:** в живом леджере доски карточка лежа…

===== C-28  MW-035  (card file: 34 lines) =====
   declared: MW-035, строка 1 (шапка).
   real:1   > **НЕ ЗАПУСКАТЬ.** Карточка снята с исполнения как superseded.
   БЫЛО:  - **Было (строка 1):** `> **НЕ ЗАПУСКАТЬ.** Карточка снята с исполнения как superseded.`
   СТАЛО: - **Стало (строка 1, добавлено):** `> **НЕ ЗАПУСКАТЬ.** Карточка снята с исполнения как superseded. **Архивирована в v0.3:** в живом леджере доски лежала в `bac…

===== C-33  MW-040  (card file: 24 lines) =====
   declared: MW-040, строка 17 (объём), строка 20 (приёмка).
   real:17  Сделать backup→migrate→verify→activate, migration journal, export/import и безопасный repair с документированной rollback policy. Проверять schema/adapter contract versio…
   real:20  Фикстуры прежней/текущей/повреждённой схемы: проверяемая миграция и явный отказ без потери оригинала. Export/import round-trip сохраняет IDs/revisions/audit; прерванная м…
   БЫЛО:  - **Было (строка 17):** `Сделать backup→migrate→verify→activate, migration journal, export/import и безопасный repair с документированной rollback policy. Проверять schema/adapter contract versions; и…
   СТАЛО: - **Стало (строка 17):** `Сделать backup→migrate→verify→activate, migration journal, export/import и безопасный repair с документированной rollback policy. Атом…
   СТАЛО: - **Стало (строка 20, добавлено):** `Прерывание процесса между migrate и verify не оставляет частично применённую схему: journal содержит шаг, а состояние восст…

===== C-34  MW-041  (card file: 24 lines) =====
   declared: MW-041, строка 4 (зависимости), строка 14 (якоря), строка 18 (объём), строка 21 (приёмка).
   real:4   Зависимости: MW-028, MW-036, MW-037, MW-038, MW-039, MW-040, MW-055
   real:14  Архитектура: .work/architecture/DSH-My-Work-Architecture-v0.1.md. Нужные разделы: §5 (строка 242), §62 (строка 2750), §63 (строка undefined), §64 (строка undefined), §66 …
   real:18  
   real:21  
   БЫЛО:  - **Было (строка 4):** `Зависимости: MW-028, MW-036, MW-037, MW-038, MW-039, MW-040, MW-055 `
   БЫЛО:  - **Было (строка 14):** `…Нужные разделы: §5 (строка 242), §62 (строка 2750), §63 (строка undefined), §64 (строка undefined), §66 (строка undefined)…`
   БЫЛО:  - **Было (строка 18):** `Сверить все 39 требований §62 с реализацией/evidence. Выполнить isolated install/activate/upgrade и сценарий goal→planner→worker→gates→reject/repair→approve→integrate→Done плю…
   СТАЛО: - **Стало (строка 4):** `Зависимости: MW-028, MW-036, MW-037, MW-038, MW-039, MW-040, MW-055, MW-060, MW-063 `
   СТАЛО: - **Стало (строка 14):** `…Нужные разделы: §5 (строка 242), §62 (строка 2750), §63 (строка ~), §64 (строка ~), §66 (строка 2880)…`
   СТАЛО: - **Стало (добавлено):** `Приёмка выполняется на CI-прогоне (install --frozen-lockfile → typecheck ×12 → tsdown → smoke → node --test → verify-profile.mjs) и на…
   СТАЛО: - **Стало (строка 21, добавлено):** `Пакет воспроизводится из tarball'а на чистой машине по инструкции: изолированный профиль, панель видна в GUI после refresh …

===== C-40  MW-047  (card file: 25 lines) =====
   declared: MW-047, строка 18 (объём), строка 21 (приёмка).
   real:18  Реализовать TaskBoardPort и проектор доски в resident controller: производный snapshot с монотонной boardRevision и курсором, SSE-инвалидация, деградированная проекция пр…
   real:21  Повторная проекция не дублирует карточки. Потеря проекции не изменяет Task Graph: удаление и пересборка snapshot даёт тот же граф. SSE-кадр не содержит карточек, только r…
   БЫЛО:  - **Было (строка 18, ключевой фрагмент):** `Реализовать TaskBoardPort и проектор доски в resident controller: производный snapshot с монотонной boardRevision и курсором, SSE-инвалидация, деградированн…
   СТАЛО: - **Стало (добавлено):** `Писатель boardRevision назван явно: ревизию двигает проектор при каждом изменении снапшота, а не клиент и не команда карточки; конкуре…
   СТАЛО: - **Стало (строка 21, добавлено):** `Тест различает empty и degraded: пустая доска не отдаёт degraded, а недоступность Beads не отдаёт empty. Ревизия колонки дв…

===== C-55  MW-032  (card file: 24 lines) =====
   declared: MW-032, строка 20 (приёмка).
   real:20  Candidate не меняет Role Contract/security автоматически. Повтор события не создаёт duplicate learning. Malicious tool/web content остаётся low-trust; learner ограничен б…
   БЫЛО:  - **Было:** `Candidate не меняет Role Contract/security автоматически. Повтор события не создаёт duplicate learning. Malicious tool/web content остаётся low-trust; learner ограничен бюджетом и не рабо…
   СТАЛО: - **Стало (добавлено):** `Бюджет learner'а — из общего circuit-breaker (MW-061), носитель запуска — durable job на собственной БД MyWork (MW-068); jobs-local не…


```

