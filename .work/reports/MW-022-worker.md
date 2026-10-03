# MW-022 — Связать Worker execution от admission до результата

- Предмет: карточка доски `1924a37d-592e-4858-a290-6d1b84c3a6f5` (MW-022), этап `03-execution`, обязательных пунктов §62 — 5
- Исполнитель: тиммейт `execution-close` команды этапа 4 над `H:\Repo\DSH-MyWork`, модель `deepseek-v4.1-flash`
- Репозиторий: `H:\Repo\DSH-MyWork`, base SHA `33e6919db031fb79b9c34c0ada67d4c600b0405d`, HEAD после работы **тот же** (коммитов нет, git-индекс не трогался)
- Окружение: Node `v24.19.0`, git `2.55.0.windows.3`, pnpm `12.4.2`
- Статус: **READY_FOR_REVIEW**

Роль этой сессии: реализация группы B уже лежала в дереве. Здесь она сверена с приёмкой карточки и шагами E-07…E-12, доказаны ключевые инварианты узкими прогонами, проведён mutation-check, а одно **неверное** утверждение, добавленное мной в тест, поймано полным прогоном `build-gate` и исправлено (см. §2.2). Реализация не переписывалась.

## 1. Проверка зависимостей

| Зависимость | Что проверено | Результат |
|---|---|---|
| MW-014 (scheduler) | `.work/reports/MW-014-scheduler.md` — есть, плюс `MW-014-review.md` и `MW-014-fixes-verification.md`; исходники `packages/scheduler`, `packages/core/src/scheduler.ts` | предусловие пройдено |
| MW-015 (DSH runtime) | `.work/reports/MW-015-dsh-runtime.md` — статус **DONE**, ревью `PASS WITH FINDINGS`, F1–F7 закрыты | предусловие пройдено |
| MW-016 (context fabric) | `.work/reports/MW-016-context-fabric.md` — `READY_FOR_REVIEW`, ревью `PASS WITH FINDINGS`, замечания исправлены | пройдено **с оговоркой** (та же цепочка, что у MW-016→MW-006/008: артефакт состоятелен, приёмка — за владельцем) |
| MW-017 (skills) | `.work/reports/MW-017-skills.md` — `READY_FOR_REVIEW`, ревью `PASS WITH FINDINGS`, находки закрыты | пройдено **с оговоркой** |
| MW-018 (native memory) | `.work/reports/MW-018-native-memory.md` — `READY_FOR_REVIEW`, ревью `PASS WITH FINDINGS`, verify-fixes `FIXES VERIFIED` | пройдено **с оговоркой** |
| MW-020 (sessions) | `.work/reports/MW-020-sessions.md` — статус **DONE**, ревью `PASS WITH FINDINGS`, 11 находок закрыты | предусловие пройдено |
| MW-021 (worktree isolation) | `.work/reports/MW-021-worktree.md` (этот же тиммейт, та же сессия): изоляция, binding, cleanup, пустой репозиторий; `tests/worktree-binding.test.mjs` 8/8 exit 0, `tests/worktree-adapter.test.mjs` 12/12 exit 0 | предусловие пройдено, отчёт — `READY_FOR_REVIEW` |

Оговорка по MW-016/017/018 названа прямо: их отчёты в статусе `READY_FOR_REVIEW`, независимое ревью пройдено, находки закрыты, исходники в дереве и зелёные. Формальной приёмки владельца нет — это решение владельца, а не вывод исполнителя; работа продолжена по тому же прецеденту, что зафиксирован в отчётах MW-016/017/018.

## 2. Сделано

### 2.1 Что уже было в дереве (не переписывалось)

- `packages/execution/src/worker.ts` (907 строк) — оркестратор `admission → claim → worktree → frozen context → сессия → settle`: `createWorker(deps)` с инъецированными `saga`/`worktrees`/`context`/`runtime`/`evidence`/`clock`, единая точка выхода `settle()` (артефакт **до** оседания), `runAttempt`/`resumeAttempt`, промпт из identity попытки (task/attempt/worktree/branch/base), детерминированный `runId = attemptRunId(attemptId)`.
- `packages/execution/src/worktree-store.ts`, `worktree-schema.ts` — durable-привязка попытки к checkout'у (E-04).
- `packages/contracts/src/attempt-run.ts` — `AttemptRunPort` и закрытый словарь исходов `COMPLETED|FAILED|CANCELLED`.
- `tests/worker-flow.test.mjs` (7), `worker-failure.test.mjs` (5), `worker-restart.test.mjs` (5), `worker-no-done.test.mjs` (3), `attempt-run.test.mjs` (5), `attempt-revisions.test.mjs` (4), `tests/lib/worker-crash-child.mjs`.
- Лог автора `.tmp/mw022-tests.txt`: 34/34 — воспроизведён (см. §4).

### 2.2 Что сделано этой сессией

- **Диагностики в тестах** — числа, которые цитирует этот отчёт, печатаются там, где измерены (`t.diagnostic`), а не пересказываются:
  - `tests/attempt-revisions.test.mjs` — sha256 `context-snapshot`, замороженные revisions, строка `attempt` после попытки;
  - `tests/worker-failure.test.mjs` — строка провалившейся попытки и число попыток, всё ещё держащих lease-слот;
  - `tests/worker-restart.test.mjs` — дословный отказ позднего результата и счётчики `attempt`/`attempt_worktree` после него.
- **Исправлено неверное утверждение «оседание ровно один раз».** Я добавил в `worker-flow.test.mjs` проверку «в журнале ровно один `settle`»; полный прогон `build-gate` (`tests 1000 / pass 991 / fail 9 / exit 1`) показал красный `worker-flow.test.mjs:457` — `«the attempt must settle exactly once: 2 !== 1»`. Разбор: воркер **намеренно** спрашивает сагу повторно на уже осевшей попытке (`worker.ts:773-788`), потому что владелец fence'а — сага, и именно она отвергает поздний результат; повторный вызов воркера — это наблюдение, а не второе оседание. Ровно один раз должно происходить **durable**-оседание, и его стережёт SQL (`settleAttempt`, `WHERE … settled_at IS NULL`, `store.ts:428-453`). Утверждение переписано на durable-инвариант: строка `attempt` (state, revision, settled_at) после повторного вызова не меняется. Это находка о тесте, а не о коде; записана здесь, чтобы ревьюер видел и первую (неверную) формулировку, и причину правки.
- Никаких правок в `packages/**` по MW-022 эта сессия не делала.

## 3. Изменённые файлы этой сессией

| Файл | Что изменено |
|---|---|
| `tests/attempt-revisions.test.mjs` | 3 диагностики в тесте «the attempt reports exactly the revisions it was frozen with»; 378 строк |
| `tests/worker-failure.test.mjs` | 2 диагностики в тесте «a refused run settles the attempt as failed…»; 357 строк |
| `tests/worker-restart.test.mjs` | 2 диагностики в тесте «a result that arrives after a newer attempt is rejected with STALE_FENCE»; 673 строки |
| `tests/worker-flow.test.mjs` | неверное утверждение «ровно один `settle` в журнале» заменено на проверку durable-строки `attempt`; 560 строк |
| `.work/reports/MW-022-worker.md` | этот отчёт |
| `.tmp/execution-close/**` | скрэтч: сохранённые выводы прогонов и `mutate.ps1` (вне поставки) |

Не трогались: `packages/contracts/**`, `packages/execution/src/{index.ts,service.ts}` (зона Lead), `tests/lib/fixtures.mjs`, `tests/boundaries.test.mjs` (зона `build-gate`), `packages/controller/**`, файлы review/integrator. `git status --short` до/после и `HEAD` — см. отчёт MW-021 §3: единственные `M` в дереве принадлежат параллельной сессии (`scripts/smoke.mjs`, `tests/events.test.mjs`), `HEAD` = `33e6919…` не сдвинулся.

## 4. Команды и exit codes

| Команда | Exit | Наблюдение |
|---|---|---|
| `node --test --test-isolation=none "tests/worker-flow.test.mjs"` | 0 | tests 7 / pass 7 / fail 0 |
| `node --test --test-isolation=none "tests/worker-failure.test.mjs"` | 0 | tests 5 / pass 5 / fail 0 |
| `node --test --test-isolation=none "tests/worker-restart.test.mjs"` | 0 | tests 5 / pass 5 / fail 0 |
| `node --test --test-isolation=none "tests/worker-no-done.test.mjs"` | 0 | tests 3 / pass 3 / fail 0 |
| `node --test --test-isolation=none "tests/attempt-run.test.mjs"` | 0 | tests 5 / pass 5 / fail 0 |
| `node --test --test-isolation=none "tests/attempt-revisions.test.mjs"` | 0 | tests 4 / pass 4 / fail 0 |
| Итоговый сводный прогон 12 наборов (9 группы A/B + `security`/`attempt`/`claim-saga`) | 0 во всех | **135 pass / 0 fail**, ненулевых exit — 0 |
| `Select-String -Path packages/execution/src/worker.ts -Pattern "'done'"` | — | **0 совпадений** (гейт E-12) |
| `node scripts/with-build-lock.mjs execution node ../../node_modules/tsdown/dist/run.mjs` | 0 | `✔ Build complete in 48168ms` (после mutation-check) |
| `node_modules\.bin\tsc.cmd --noEmit -p packages/execution/tsconfig.json` | 0 | — |
| Полный набор `tests/**/*.test.mjs` (зона `build-gate`) | 1 | tests 1000 / pass 991 / fail 9 / skipped 0 / 534 c; 8 красных — зона `review-integrator-close`, 1 — моё тогда-неверное утверждение, снято правкой §2.2 |

## 5. Evidence по приёмке

### 5.1 «Один сценарий на fakes проходит end-to-end» (E-08)

`tests/worker-flow.test.mjs`, 7/7, exit 0. Порядок портов — `assert.deepEqual(portCalls(journal), ['claim', 'prepare', 'materialize', 'start', 'settle'])`, полный журнал: `claim → prepare → materialize → put:context-snapshot → start → put:worker-report → settle`. Сессия открывается под `runId = attemptRunId(attemptId)` (проверяется предикатом, не строкой), `worktree.path` из порта, `scope.agentPreset = 'worker'` из роли; промпт содержит task/attempt/worktree/branch/base и **не** содержит текста общего checkout.

### 5.2 «Failure сохраняет evidence и освобождает capacity» (E-10)

`tests/worker-failure.test.mjs`, 5/5, exit 0. Диагностика прогона: `failed attempt -> {"state":"failed","settled_at":1000,"fence":1}`, `live attempts -> 0` (запрос `SELECT COUNT(*) … state IN ('created','leased','starting','running','settling')`). Порядок «evidence → оседание» проверяется журналом (`put:worker-report` раньше `settle`), а отказ записи артефакта не оставляет попытку живой (второй стенд с `refuseReport`). Fence не двигается на провале (1 → следующий admission 2), следующая задача проходит.

### 5.3 «Restart и late callback не создают вторую authoritative попытку» (E-11)

`tests/worker-restart.test.mjs`, 5/5, exit 0. Диагностика: `late result -> STALE_FENCE: dsh-mywork: fence 1 is not the current fence 2 of task "T-1"`, `attempts after the late result -> 2, worktrees -> 1`. `resume` после «рестарта» не вызывает `prepare` повторно; занятый `runId` отвергается; краш-тест через дочерний процесс (`tests/lib/worker-crash-child.mjs`, маркер в файле, не `sleep`) оставляет ровно одну строку `attempt` и одну `attempt_worktree`; повторный `resume` идемпотентен.

### 5.4 «Каждая попытка хранит использованные revisions» (E-09)

`tests/attempt-revisions.test.mjs`, 4/4, exit 0. Диагностика: `context-snapshot sha256 -> afe8247251418fbf6f29055b3f81bd5e126348f2febcaa0139684cb32a727308`, `frozen revisions -> {"config":9,"role":4,"skill":11}`, `attempt row -> {"state":"completed","revision":2,"settled_at":1000}`. Снапшот кладётся до старта сессии, несёт `task_id`/`attempt_id`/`correlation_id`, повторный прогон переиспользует тот же артефакт (hash и `createdAt` совпадают), `report.frozen` равен замороженному набору.

**Отклонение от буквы шага E-09, названное явно.** Гейт шага требует «строку `attempt.revisions`». Колонки `revisions` в таблице `attempt` нет (`packages/execution/src/schema.ts:120-133`), и `settleAttempt` её не принимает (`store.ts:428-453`) — durable-запись использованных revisions живёт в артефактах попытки: `context-snapshot` и `worker-report`, оба с `attempt_id`, тело `worker-report` несёт `frozen`. Критерий карточки («каждая попытка хранит использованные revisions») этим выполнен, но формулировка шага про колонку — нет; это отклонение, а не подмена.

### 5.5 Инварианты, названные в задании

| Инвариант | Доказательство |
|---|---|
| Worker никогда не переводит задачу в `done` | `tests/worker-no-done.test.mjs` 3/3 exit 0: успешный прогон отдаётся вызывающему, который переводит задачу в `awaiting-review`; переход в `done` отвергается из каждого состояния, которое может произвести попытка; боковые состояния (`changes-requested`/`failed`) по-прежнему допускают новую попытку. Плюс `Select-String packages/execution/src/worker.ts -Pattern "'done'"` → 0 |
| Каждый выход оседает ровно один раз | durable-строка `attempt` не меняется на повторном вызове (`worker-flow`, §2.2); провал оседает в `failed` с заполненным `settled_at` (`worker-failure`); отменённый прогон — в `cancelled` (`worker-flow`) |
| Повторный запуск не открывает вторую сессию | `worker-flow`: счётчик `start:` остаётся 1, `reused === true`, тот же `sessionId` |
| Поздний результат отвергается `STALE_FENCE` | `worker-restart` + mutation-check §5.6 |
| Привязка worktree и очистка не трогают общий checkout | отчёт MW-021 §5.1 (реальный адаптер + реальный репозиторий, общий checkout чист, `HEAD` не сдвинулся) |
| Пустой репозиторий → `EMPTY_REPOSITORY`, а не скрытый коммит | отчёт MW-021 §5.3 (уровень адаптера и уровень саги) |

### 5.6 Mutation-check

| Инвариант | Поломка собранного артефакта | Красный прогон | Восстановление |
|---|---|---|---|
| `STALE_FENCE` для позднего результата | в `packages/execution/lib/index.js` отключён сторож воркера `if (expectedFence !== taskFence)` | **exit 1**; `worker-restart.test.mjs:526`: `actual: 'TASK_CONFLICT'`, `expected: 'STALE_FENCE'` | байты идентичны бэкапу → `tests/worker-restart.test.mjs` **exit 0, 5/5** |
| Пустой репозиторий → `EMPTY_REPOSITORY` из саги (правка Lead'а в `service.ts`) | снята трансляция `details.reason === 'no-head'` → `EMPTY_REPOSITORY` | **exit 1**; `worktree-binding.test.mjs:356`: `actual: undefined`, `expected: 'EMPTY_REPOSITORY'` | восстановлено, пересборка `packages/execution` exit 0 → **exit 0, 8/8** |

Дополнительно: та же поломка сторожа воркера **вместе** со стороже `assertFence` в саге даёт тот же красный на том же утверждении (`TASK_CONFLICT` vs `STALE_FENCE`) — то есть тест различает именно инвариант «поздний результат отвергнут», а не одну конкретную реализацию. Тестов, зелёных при поломке, не обнаружено.

## 6. Ограничения и что осталось непроверенным

1. **E-17 (производитель `gate-result` в `worker.ts`) в объём MW-022 не входит.** План `21-STEPS-execution.md:455` кладёт правку `worker.ts` в E-17/MW-023; по решению Lead она вынесена в отдельную задачу `task-6` (отчёт `.work/reports/MW-023-gates-producer.md`). Здесь фиксируется как согласованный остаток: сейчас `worker.ts` не пишет `gate-result`, и потребитель (`assertGatesSatisfied`) на попытке без записей отказывает — это и есть защита от «зелёного света без проверки».
2. **Истечение lease при оседании не проверяется** — известное ограничение, названное в шаге E-10; проверка приходит в `E-46`/`E-47`. Здесь ничего не добавлялось.
3. **Повторное применение ограничения worker-поверхности при `resume` (E-39)** не проверялось: ограничение процесс-локально и в лог сессии не сериализуется. В объёме этой сессии доказан только идемпотентный `resume` без второй сессии.
4. **Композиция** (`packages/controller/**`, сборка `store`+портов) не проверялась: сценарии группы B идут на fakes и на ручной сборке (`tests/lib/fixtures.mjs` — зона `build-gate`), не через композиционный корень.
5. **Сканер границ** (`tests/boundaries.test.mjs`: бандл `execution` импортирует только `node:crypto`) — зона `build-gate`; отдельно мной не прогонялся. Ограничение «никаких `node:*`, кроме `node:crypto`, в `worker.ts`» соблюдено по исходникам.
6. **`tests/lib/fixtures.mjs`** (общий стенд) не трогался; все новые порты и правки объёма MW-022 в него не вносились.
7. Прогоны сняты на незакоммиченном дереве (`33e6919` + рабочее дерево), после окна полной пересборки `build-gate` (окно закрыто в 11:1x, `lib/` всех 15 пакетов на месте). Числа воспроизводимы командами из §4.

## 7. Статус и следующий шаг

**READY_FOR_REVIEW.** Приёмку не объявляю. Следующая карточка — `task-6` (E-17: производитель `gate-result` в `worker.ts`, отчёт `.work/reports/MW-023-gates-producer.md`), взята после `complete` по этой задаче по прямому указанию Lead.
