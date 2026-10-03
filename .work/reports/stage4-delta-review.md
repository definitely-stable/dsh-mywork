# Дельта этапа 4 — независимое ревью (режим `review`)

- **Предмет:** замороженный коммит `579e819faed19463d7402d9a8ec7765bd0584420` (ветка `stage4-execution-pipeline`), база дельты `33e6919db031fb79b9c34c0ada67d4c600b0405d`; шесть коммитов — `84eb0b8`, `5dd192a`, `16dbee4`, `1217025`, `9c15c7d`, `579e819`
- **Ревьюер:** тиммейт `stage4-reviewer` (read-only; живое дерево не правилось, `HEAD` не двигался, коммитов нет)
- **Изоляция:** отдельный worktree `.tmp/stage4-review` (`git worktree add --detach 579e819`), в него скопированы 82 собранных файла `packages/*/lib` — побайтово равные живому дереву (0 расхождений по sha256-манифесту); все мутации — только в этой копии; скрэтч — `.tmp/stage4-review/probe/`
- **Дата:** 2026-09-28

---

## 1. Вердикт

**PASS WITH FINDINGS** — пять объявленных приёмок дельты подтверждаются по исходникам и собственными прогонами (34 набора, 231/231, плюс 3/3 probe; 4 mutation-check), поведение этапов 0–3 не сломано; находки — три MINOR и один NIT, ни один не отменяет приёмку и все лежат вне путей отказа.

## 2. Проверенные команды

| Команда | Exit | Наблюдение |
|---|---|---|
| `git rev-parse HEAD`; `git status --short` | 0 | `579e819faed19463d7402d9a8ec7765bd0584420`; дерево **пусто** — заморозка держится |
| `git log --format='%h \| %an \| %ad \| %s' 33e6919..579e819` | 0 | **6 коммитов**, все `MrFr3di <ynagi-wm@mail.ru>`, 11:50:42–11:50:48 — коммитов исполнителей нет |
| `git worktree add --detach .tmp/stage4-review 579e819` | 0 | `HEAD is now at 579e819` |
| sha256-манифест 82 файлов `packages/*/lib`, живое дерево vs копия | 0 | `Compare-Object` → **0 расхождений** |
| `node --test --test-isolation=none <34 набора>` (см. §4) | **0** во всех | **tests 231 / pass 231 / fail 0**, skipped 0 (40 прогонов: первые шесть наборов прогнаны и в живом дереве, и в копии) |
| `node --test --test-isolation=none probe/empty-repository-probe.test.mjs` | 0 | tests 3 / pass 3 / fail 0 — мои пробы, вне поставки |
| Mutation A: `packages/core/lib/index.js` — в `TASK_TRANSITIONS['awaiting-review']` добавлен `"done"`; прогон `tests/worker-no-done.test.mjs` | **1** | 3 теста: 1 pass / **2 fail**; `awaiting-review must not reach done directly` (`actual: true`) |
| восстановление A: `Move-Item` бэкапа, `Get-FileHash`, повторный прогон | 0 | хеш **совпал** с манифестом; набор снова **3/3** — тест невакуумен |
| Mutation B: `packages/contracts/lib/index.js` — из `GATE_VERDICTS` убран `"timeout"`; прогон `tests/gates-contract.test.mjs` | **1** | 5 тестов: 4 pass / **1 fail** — «the five verdicts are closed» |
| восстановление B | 0 | хеш совпал; **5/5** |
| Mutation C: `packages/gate-runner/src/port.ts` — добавлен `import Database from 'better-sqlite3'`; прогон `tests/boundaries.test.mjs` | **1** | 31 тест: 30 pass / **1 fail** — `gate-runner: …port.ts must not import "sqlite" through "better-sqlite3"` — новый блок скана невакуумен |
| восстановление C | 0 | sha256 до/после совпал |
| Mutation D: `packages/execution/lib/index.js` — `if (!independent.ok)` → `if (false)`; прогон `tests/review-independence.test.mjs` | **1** | 4 теста: 1 pass / **3 fail** — «a worker cannot review its own attempt» |
| восстановление D | 0 | хеш совпал; **4/4** |
| `Select-String -Path packages/execution/src/worker.ts -Pattern "'done'"` | — | **0 совпадений** — заявление MW-022 §4 воспроизведено |
| `Test-Path 'C:\Users\Dmitry\.dsh\dsh-mywork'` | — | **False** — стор контроллера в живой профиль не писался |
| `Get-Item C:\Users\Dmitry\.dsh\task-board\ledger-v2.json` | — | mtime **2026-09-28 09:30:58** — до окна этапа 4 (11:26–11:52): доска в окне не двигалась |

Числа авторов, которые я воспроизвёл точно: `worker-flow` 11/11, `worker-no-done` 3/3, `worker-failure` 5/5, `worker-restart` 5/5, `attempt-run` 5/5, `attempt-revisions` 4/4, `worktree-adapter` 12/12, `worktree-binding` 8/8, `worktree` 4/4, `gates-admission` 6/6, `gates-port` 5/5, `boundaries` 31/31. Расхождений с отчётами **нет**.

## 3. Findings

### F1 — MINOR. Комментарий `staleApprovalCode` описывает состояние, которого уже нет, и её fallback мёртв
- `packages/execution/src/integrator.ts:144-159`
- **Что не так:** доккомментарий утверждает, что отказ отвечается `STALE_REVISION`, «пока каталог не несёт нового члена», а сам член якобы приходит с E-23. В этом коммите `STALE_APPROVAL` **уже в каталоге** — он добавлен той же дельтой (`packages/contracts/src/operation.ts:83,107`, коммит `84eb0b8`) и запинен `tests/events.test.mjs:202`. Значит `staleApprovalCode()` (строка 155) всегда возвращает `'STALE_APPROVAL'`, а ветка `'STALE_REVISION'` недостижима. Доказательство исполнением: `tests/review-staleness.test.mjs:284,315,389` сравнивает код с литералом `'STALE_APPROVAL'` и зелёный (5/5).
- **Почему важно:** следующий читатель (и следующая карточка, потребляющая E-23) будет считать, что сегодня по проводу идёт `STALE_REVISION`; недостижимая ветка выглядит как рабочая страховка. Документация, противоречащая собственному поведению модуля, — это дефект, который переживёт и код.
- **Минимальная правка:** переписать комментарий (каталог несёт член с этого коммита; поиск оставлен, чтобы модуль не сломался при удалении члена) — либо убрать `staleApprovalCode()` и поставить литерал. Поведение не меняется.

### F2 — MINOR. `GUARDED_CODES` интегратора не знает кода, который сам же интегратор и объявляет
- `packages/execution/src/integrator.ts:489-498` (список), `:508-524` (`refusalShape`), `:612-637` (`readTask`, `transition`)
- **Что не так:** `INTEGRATION_REFUSAL_CODES['stale-approval']` (строка 165) — это `STALE_APPROVAL`, но `GUARDED_CODES` его не содержит. Отказ порта с этим кодом не распознаётся как типизированный: `refusalShape` вернёт `undefined`, и `readTask`/`transition` **перебросят** его наружу вместо `Result` — то есть публичная поверхность интегратора («Result, никогда не throw») ломается ровно на том коде, который эта дельта ввела. Рядом, в том же пакете, тот же вопрос решён иначе: `worker.ts:344` читает **каталог** `MYWORK_ERROR_CODES`, а не рукописный список.
- **Почему важно:** достижимость сегодня латентна (проверку стелого одобрения интегратор делает сам, чистым предикатом ядра), но любой порт графа задач, реализующий тот же страж E-23, получит вместо кода — исключение. Стоимость правки — одна строка, стоимость диагностики в рантайме — час.
- **Минимальная правка:** добавить `'STALE_APPROVAL'` в `GUARDED_CODES` (или заменить список чтением каталога, как в `worker.ts:344`).

### F3 — MINOR. Замок сборки объявляет держателя мёртвым через 5 минут, но не обновляет свой mtime
- `scripts/with-build-lock.mjs:34-35` (`STALE_MS = 300_000`), `:63` (`openSync(…, 'wx')`), `:67-70` (`statSync(lockPath).mtimeMs > STALE_MS` → `unlinkSync`), `:94` (блокирующий `spawnSync`)
- **Что не так:** mtime замка выставляется один раз при создании и больше не трогается — блокирующий `spawnSync` не даёт процессу возможности «постучать». Любая сборка длиннее пяти минут считается брошенной: замок снимается, вторая сборка того же пакета с `clean: true` (это и есть причина существования скрипта, см. его же доккомментарий, строки 4-9) сносит `lib/` у живой. Измерения этого же этапа: полная сборка дерева — 190,9 с (`.work/plan-v0.3/evidence/stage4-landing-gate.md:14`) и 237,6 с (`.work/plan-v0.3/evidence/stage4-build-gate.md:44`), одна `packages/execution` — 44–48 с; запас до порога меньше двукратного, а холодный кэш и параллельные агенты его съедают.
- **Почему важно:** отказ инструмента сборки не диагностируется как отказ: следующий агент увидит `missing build output` и будет искать причину в своём коде. Это ровно тот класс тихой поломки, который замок должен был убрать.
- **Минимальная правка:** поднять/сделать настраиваемым `STALE_MS` и обновлять mtime, пока жив ребёнок (`spawn` + `setInterval(() => utimesSync(lockPath, new Date(), new Date()), …)` вместо блокирующего `spawnSync`).

### F4 — NIT. Объявленное поведение «пустой набор обязательных гейтов не допускает ничего» не запинено тестом
- `packages/execution/src/gates-admission.ts:237-239` (док), `:294`, `:311`; тесты — `tests/gates-admission.test.mjs:198,214,219`
- **Что не так:** документ обещает строжайшее чтение для `requiredGateIds: []`, в коде это так (`requiredSet` пуст → цикл отбора ничего не добавляет → `admitted.length === 0` → отказ), но ни один тест пустой список не подаёт: все три вызова передают непустые наборы. Поведение я проверил своей пробой (`.tmp/stage4-review/probe/empty-repository-probe.test.mjs`, тест «an explicitly empty required-gate set admits nothing» → отказ `REVIEW_GATES_MISSING`, `blocks: []`, 3/3 зелёные), но закреплено оно только в моём скрэтче, а не в поставке.
- **Почему важно:** это ровно тот случай, где будущая «оптимизация» (`if (requiredSet.size === 0) return ok([])`) пройдёт все зелёные тесты и превратит «ничего не проверено» в «всё хорошо» — вакуумный допуск к review.
- **Минимальная правка:** одно утверждение в `tests/gates-admission.test.mjs`: `assertGatesSatisfied(ATTEMPT, HEAD, green, { requiredGateIds: [] })` → `ok === false`.

## 4. Что проверено и сочтено корректным

**Приёмки (проверял по исходникам и своим прогоном, а не по тестам, которые их заявляют):**

- **(а) `done` недостижим без review и гейтов.** `packages/execution/src/integrator.ts:1102` — единственная точка перехода графа в `done`, и она стоит после `records.reviewOf` + `isReviewApprovalCurrent` (:1057-1078) и `gatesAllPass(parseGates(record.gates))` (:1079), где `gatesAllPass` (:562-564) требует **непустой** список и `verdict === 'pass'` у каждого. Плюс `admit` (:686-769) требует состояние задачи `approved`, одобренный review и совпадение артефакта с записанным. Скан таблицы переходов в `tests/worker-no-done.test.mjs:274-284` и `tests/gates-admission.test.mjs:227-250` подтверждает: в `done` ведёт ровно ребро `integrating → done`, а `integrating` достижим только из `approved`. Мутация A показала, что эти пиннинги невакуумны.
- **(б) Поздний результат отвергается именно `STALE_FENCE`.** `packages/execution/src/service.ts:516-529` (`assertOwnership`) сравнивает токен вызывающего с fence'ом **задачи**, а не попытки, и отвечает кодом `STALE_FENCE`; воркер не подменяет ответ своим сторожем (`worker.ts:597-599`: «the saga decides … a superseded attempt is refused with `STALE_FENCE` here and not by a check of ours»). Положительное доказательство исполнением — `tests/worker-restart.test.mjs:526`: `assert.equal(late.error.code, 'STALE_FENCE')` на реальном вызове (набор 5/5, прогнан мной). Дополнительно автор сообщает (MW-022 §5.6, **сам я эту мутацию не повторял**), что снятие сторожа даёт на том же утверждении `TASK_CONFLICT` вместо `STALE_FENCE`, то есть тест различает инвариант, а не одну реализацию.
- **(в) `EMPTY_REPOSITORY` достижим в продакшн-пути.** Своя проба (`.tmp/stage4-review/probe/empty-repository-probe.test.mjs`, 3/3): реальный `git init`-репозиторий без коммитов → реальный `createGitPort().resolveHead` отвечает `TASK_CONFLICT` + `details.reason === 'no-head'` (`packages/worktree-adapter/src/git.ts:240-244`) → реальная сага (`packages/execution/src/service.ts:591-604`) отказывает `TASK_CONFLICT` с `details.refusal === 'EMPTY_REPOSITORY'`, `details.reason === 'worktree-precondition'`, **без строки `attempt` и без вызова `prepare`**. Тест `tests/worktree-binding.test.mjs:339` пинует только трансляцию (там `headFailure` собран руками) — я закрыл вторую половину контракта сам. Уровень адаптера отдельно проверен реальным репозиторием в `tests/worktree-adapter.test.mjs:148-163` (12/12).
- **(г) Ревьюер с тем же `agentId` отвергается.** `packages/execution/src/review-queue.ts:1476` вызывает `assertReviewerIndependence` (`packages/core/src/review.ts:119-132`, `SECURITY_DENIED`) на входе в claim, до записи чего-либо; сам `claim.workerAgentId` берётся из попытки (`review-queue.ts:1719`), а не от вызывающего. Дополнительно `admitReviewer` (:1484-1493) отказывает ревьюеру с `git.write`/`shell`/`workspace.write`, и `approve` (:1991) требует, чтобы актёр был держателем claim'а. Мутация D (снятие проверки в собранном бандле) красит 3 из 4 тестов.
- **(д) Интегратор не закрывает граф без гейтов.** `finalizeRow` (:1079-1084) отказывает `gate-not-passed`, не трогая граф; `runGates` (:978-1032) при незелёном наборе пишет состояние `gated` и возвращает отказ, а вердикты о чужом head уходят в `needs-attention` через `settleWithHuman` (:999-1004). `tests/integrator-gates.test.mjs:415` проверяет **состояние графа** (`integrating`), а не только код отказа; я прогнал 5 наборов интегратора (22/22).

**Процессная часть:**

- Все девять отчётов исполнителей в статусе `READY_FOR_REVIEW` (включая `MW-023-gates.md:3` в форме `**Статус:** READY_FOR_REVIEW`); слов приёмки («ПРИНЯТО», «DONE», «приёмка объявлена») нет ни в одном; `stage4-landing-gate.md:39` прямо говорит «Приёмка карточек не объявлена». Употребления «принято» в отчётах MW-024/025/028 относятся к **зависимостям** («принято как есть (не мой объём)»), причём MW-028 откладывает приёмку на Lead'а явным текстом.
- Коммитов авторов нет: все 6 — Lead'а, одним окном 11:50:42–11:50:48, по слою на коммит, `HEAD` совпадает с замороженным.
- Живой профиль не тронут: `Test-Path 'C:\Users\Dmitry\.dsh\dsh-mywork'` → False; стор контроллера пишется только в изолированном доме (подтверждает и `verify-profile` из гейта Lead'а).
- Доска задач в окне не двигалась: mtime `task-board\ledger-v2.json` = 09:30:58, окно этапа 4 — 11:26–11:52.
- Скопы соблюдены: правки в `packages/contracts/**`, `packages/execution/src/{index.ts,service.ts}`, `tests/events.test.mjs`, `README.md` объявлены зоной Lead'а (`stage4-landing-gate.md:33`), и по диффу именно там; исполнители своих зон не пересекали.

**Названные исполнителями остатки — проверил, названо честно:**

- Строгое чтение набора гейтов (`MW-023-gates-producer.md:122`): подтверждается — `assertGatesSatisfied` вызывается из воркера и из очереди без `requiredGateIds`, то есть каждый записанный гейт обязателен, и информационный гейт с `required: false` блокирует наравне с обязательным. Направление — в сторону отказа.
- `AttemptGatePort.run` без `signal` (:123): подтверждается типом (`packages/contracts/src/verification.ts`, `ATTEMPT_GATE_REQUEST_FIELDS` не несёт отмены).
- `attempt_worktree.head_sha` пишется только в тестах (:124): подтверждается — `settleAttemptWorktree` (`packages/execution/src/worktree-store.ts:158`) не вызывается из продакшн-кода, а `WorktreeRegistration` реального `prepare` head не несёт (`packages/worktree-adapter/src/adapter.ts:317-324`). Следствие, которое автор называет там же и которое я подтверждаю по коду: воркер пинует вердикты к `registration.headSha ?? baseSha` (`packages/execution/src/worker.ts:395`), поэтому при коммитах в worktree пин и checkout расходятся, и при инъецированном `readHead` прогон гейтов отказывает `GATE_HEAD_MOVED` (`packages/gate-runner/src/port.ts:229-234`) — направление отказа безопасное (fail-closed), ложного «зелёного» не возникает. **Находкой не считаю:** названо в отчёте явно, а сам факт — в списке вне объёма.
- `stop()` контроллера без дедлайна, B1/F-5/R-26 этапа 3, отсутствие композиции воркера/гейтов/интегратора, первый запуск CI — не проверял по этой же причине (вне объёма); `stage4-landing-gate.md:35-41` называет их сам.

**Сборка и изоляция:** 82 файла `packages/*/lib` из живого дерева совпали с копией в `.tmp/stage4-review` по sha256 (0 расхождений); все четыре мутации откатаны побайтово (сравнение `Get-FileHash` с манифестом `match=True`) и перепроверены зелёным прогоном. Мутаций, оставшихся в дереве, нет; живое дерево после ревью — `git status --short` пусто, `HEAD = 579e819`.

## 5. Невоспроизводимые утверждения отчётов

**Не найдено.** Все числа, которые я целенаправленно перепроверял, воспроизвелись: посерийные счётчики (§2), `Select-String … -Pattern "'done'"` → 0 (MW-022 §4), 12/12 и 8/8 (MW-021 §4, строки 65-66), 11/11 (MW-023-gates-producer §4), 31/31 `boundaries` (MW-023-gates-port §4), 5/5 `gates-port`.

Одно расхождение **внутреннее и объяснённое**, не находка: `stage4-build-gate.md:50` приводит `tests 1000 / pass 991 / fail 9` (11:17:22), а `stage4-landing-gate.md:16` — `1010 / 1010 / 0` (после 11:38). Первое — промежуточный срез с красными в чужих зонах, перечисленными там же в §6 и закрытыми владельцами до гейта приземления; второго числа я не воспроизводил (мандат: полный прогон не гонять) — см. §6.

## 6. Что осталось непроверенным и почему

1. **Полный набор `tests/**/*.test.mjs` (1010/1010, 423,9 с) не перегонялся** — по прямому указанию Lead'а; вместо него свои 34 набора (231/231, все в дельте или прямо её касающиеся) плюс проба. Остаются непрогнанными мной наборы этапов 0–3 и часть дельты вне моего списка (в их числе `claim-saga`, `security`, `planner-*`, `web-*`); регрессий я там не искал и не нашёл по построению.
2. **`pnpm run typecheck` / `pnpm -r run build` не запускал**: сборка в этом окружении идёт под локом и трогает `lib/` живого дерева; наличие собранных артефактов (82 файла, сверены по хешу) и зелёные тесты, которые грузят именно `packages/*/lib`, — это косвенное подтверждение сборки, а не запуск компилятора.
3. **`scripts/smoke.mjs` (3 диагностические строки) и `verify-profile`** не запускал: они в гейте Lead'а и в гейте сборки, а их повтор — цена без новой информации. Заявление о третьей строке `reconcile` проверено только по коду (`packages/controller/src/app.ts`, порт `reconcile`) и по диффу.
4. **Композиция `controller` → воркер/гейты/интегратор** не проверялась как поведение: её в дереве нет (названо Lead'ом), поэтому вопрос «сходятся ли пин гейтов и head попытки в живом профиле» остаётся открытым по построению, а не по недосмотру — см. §4.
5. **CI на GitHub** не проверялся: запуск этого PR будет первым, удалённого прогона у меня нет.
6. **Доску задач** я не читал и не трогал (запрет мандата): вывод «доска не двигалась» опирается на mtime леджера и на отсутствие изменений в дереве, а не на содержимое доски.
7. **`EMPTY_REPOSITORY` на реальном `createWorktreePort().prepare`** (не только `resolveHead` + сага) я не гонял отдельно: это делает `tests/worktree-adapter.test.mjs:148` на реальном репозитории, и я ограничился воспроизведением этого набора (12/12) плюс своей пробой на порту git.
