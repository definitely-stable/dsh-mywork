# MW-028 — Embedded и resident controller: жизненный цикл, heartbeat, graceful shutdown

- Предмет: карточка доски `86f92814-522a-4761-9e3c-66f8bde03dff` (MW-028), этап `04-control`,
  обязательные пункты §62 — 1, 2
- Группа: `.work/plan-v0.3/21-STEPS-execution.md` §14, шаги E-42…E-45
- Исполнитель: тиммейт Agent Team `controller-close` (DSH Web), модель `deepseek-v4.1-flash`
- Репозиторий: `H:\Repo\DSH-MyWork`, base SHA `33e6919db031fb79b9c34c0ada67d4c600b0405d`,
  head `33e6919` (**0 коммитов**, git-индекс не трогался; push/merge не выполнялись)
- Окружение: Node `v24.19.0`, pnpm `12.4.2`, DSH `0.1.7-rc.2`
- Файл отчёта: карточка называет `.work/reports/MW-028-deployment-modes.md`; по решению Lead'а
  отчёт лежит здесь, а по пути из карточки стоит файл-указатель на этот отчёт (дубля текста нет)
- Статус: **READY_FOR_REVIEW** — группа L доведена до проверяемого состояния: 8 узких прогонов
  (30 тестов) зелёные, вопрос ночной кампании о graceful shutdown закрыт с измерением и названной
  причиной (дефекта нет), mutation-check выполнен дважды (оба раза красное ровно на нужном
  утверждении), добавлены два регрессионных теста. Независимого ревью и полного прогона всех
  сюит здесь нет — это чужая зона.

## 1. Проверка зависимости MW-009, MW-014, MW-022, MW-025

| Зависимость | Как проверено | Результат |
|---|---|---|
| MW-009 (lease/`ControllerLifecycle`) | `Test-Path .work/reports/MW-009-controller-lease.md` → True (41 439 B); `Test-Path packages/lease/src/lifecycle.ts` → True; `ControllerLifecycle` теперь **инстанцируется** — `packages/controller/src/runtime-root.ts:289` (план §14 фиксировал «он нигде не инстанцируется») | принято |
| MW-014 (scheduler) | `Test-Path .work/reports/MW-014-scheduler.md` → True; `createScheduler` монтируется в `packages/controller/src/app.ts:733` | принято |
| MW-022 (worker) | `Test-Path .work/reports/MW-022-worker.md` → True (20 711 B, 28.09 11:27, «Статус: **READY_FOR_REVIEW**», 135 pass / 0 fail узкими прогонами, три mutation-check); рядом `MW-021-worktree.md` (21 598 B, READY_FOR_REVIEW); исходники `packages/execution/src/worker.ts` и сюиты `tests/worker-*.test.mjs` в дереве | принято к сведению; **независимая приёмка (ревьюер на замороженном коммите) — за Lead'ом** |
| MW-025 (integrator) | `Test-Path .work/reports/MW-025-integrator.md` → True; `packages/execution/src/integrator.ts` в дереве | принято |

Зависимости MW-009/MW-014/MW-025 приняты; MW-022 сдан (`MW-022-worker.md`, READY_FOR_REVIEW) и ждёт
независимого ревью вместе с MW-021. Группа L не вызывает worker напрямую, а монтирует подсистемы
(`packages/controller/src/app.ts:734-739`), и её гейты проверяют порядок активации/останова над
`lease`, `storage`, `planner`, `scheduler`. Но это и не заменяет приёмку: интеграционный смысл §62
п. 1–2 («браузер не останавливает resident execution», «reconcile до admission») подтверждается
здесь на уровне application-слоя, а не на живом headless-профиле.

## 2. Сделано

### 2.1 Что было в дереве и что проверено

Реализация группы L в дереве полная и соответствует шагам §14 — по исходникам, а не по отчёту:

| Шаг | Файл(ы) | Что закрывает |
|---|---|---|
| E-42 | `packages/controller/src/runtime-root.ts` (весь), `packages/controller/src/index.ts:243-279` | `apply` монтирует одно application-слойное приложение; `runtimeRoot` собирает lease → store → reconcile → admission и пишет `startupTrace` |
| E-43 | `packages/controller/src/heartbeat.ts`, `runtime-root.ts:404-417` | heartbeat на инъецированном `ClockPort` (без `setInterval`/`Date.now`), потеря lease → `passive` + закрытый admission |
| E-44 | `packages/controller/src/deployment.ts`, `runtime-root.ts:325-367` | режимы `embedded`/`resident`, клиентский слой как отдельный объект, один идемпотентный shutdown `admission → settle → release` |
| E-45 | `runtime-root.ts:302-322,421-444`, `app.ts:679-700` | reconcile до первого admission, durable `admissionHold` из строки плана, `resumeAdmission` |

Счёт тестов совпадает с гейтами плана: 6 lifecycle (E-42), 5 heartbeat (E-43), 6 modes (E-44),
4 reconcile-order (E-45) — все зелёные на собранном дереве (см. §4). Правок в
`packages/controller/src/**` я не вносил: все mtime исходников — 27.09, то есть ночная кампания;
моя работа — доказательства, два новых теста и разбор shutdown.

### 2.2 Graceful shutdown: причина, а не симптом (вопрос `.tmp/dbg-shutdown.mjs`)

**Наблюдение ночной кампании воспроизведено** (`.tmp/dbg-shutdown.mjs`, exit 0): после `stop()`
трейс `shutdownTrace` застывает на `['admission']` — 400 микротасков и один макротаск не меняют
ничего; переходит в `['admission','settle','release']` только после того, как скрипт вызывает
`finish()` (строка 32) и разрешает зарегистрированную работу.

**Измерение** (`.tmp/controller-close/shutdown-probe.mjs`, вывод — `shutdown-probe.txt` и
`shutdown-probe-after-rebuild.txt`, оба прогона на разных сборках дают одни и те же числа):

| Случай | Трейс по шагам | Итог `stop()` |
|---|---|---|
| A. `FakeClock`, работы в полёте нет | `admission` — микротаск #5, `settle` — #9, `release` — #18 | завершается за **25 микротасков, 0 макротасков**; wall 314–337 мс (закрытие SQLite, не таймеры) |
| B. `FakeClock`, одна работа в `trackWork`, не разрешена | `admission` — #5, дальше **не двигается** | 2000 микротасков + 50 макротасков не сдвигают трейс; после разрешения работы `settle`+`release` — за 21 микротаск |
| C. `systemClock`, работы нет | как A | **25 микротасков, 0 макротасков** |
| D. `systemClock`, работа не разрешена | как B | стоит на `admission`; живых `Timeout`-ресурсов после останова — 0 |

**Причина (в терминах кода).** Единственное, что держит остановку, — шаг `settle`, который ждёт
работу, зарегистрированную через `trackWork`:
`packages/controller/src/runtime-root.ts:335-340` (`await Promise.allSettled([...inFlight])`),
регистрация — `runtime-root.ts:446-458`. `.tmp/dbg-shutdown.mjs:19-23,32` регистрирует промис и
разрешает его **после** наблюдения трейса, поэтому «застрявший» трейс — это ровно то поведение,
которое задумано: остановка ждёт незавершённую работу и **никогда** не ждёт таймер. Шаг `admission`
(`runtime-root.ts:329-334`) гасит heartbeat через `abort.abort()` — `heartbeat.ts:159-163`, а
`sleep` обоих часов снимает/реджектит слипера по abort (`packages/adapter-sdk/src/testing.ts:91-97`,
`packages/core/src/index.ts:161-174`), поэтому окно ожидания не тратится.

**Вывод: это не дефект, а свойство композиции; правка исходников не требуется.** Остаток
(ограничение, не дефект): у `settle` нет дедлайна — работа, которая не завершится никогда, держит
`stop()` открытым бесконечно (случаи B/D). Это осознанный выбор: прерывать работу по таймауту
означало бы как раз «потерять незавершённую работу», которую приёмка требует сохранить. Вызывающий,
которому нужен ограниченный останов, обязан ограничить то, что он регистрирует.

**Регрессионный тест (новый):** `tests/controller-modes.test.mjs:231-274` —
`an idle shutdown is microtask-driven and leaves no live heartbeat timer`. Утверждения:
трейс успевает стать `admission → settle → release` за 48 микротасков при **неподвижных** часах
(:253-257); после останова `clock.pendingSleeps === 0` (:262) и `beating.running === false`;
`advance(intervalMs * 10)` не добавляет ни одного удара (:264-268); `trackWork` после останова
отклоняется `not-active` (:273). Тест краснеет и на «остановка стала ждать таймер», и на «heartbeat
пережил остановку» — оба случая проверены мутациями M2 (см. §4).

### 2.3 Второй новый тест: детерминизм reconcile

`tests/controller-reconcile-order.test.mjs:262-296` — на одном каталоге состояния с durable hold:
две активации подряд дают один и тот же порядок `lease → stores → reconcile → admission`, один и
тот же `reconcileReport` (`{operations: 0, leases: 0}`), gate закрыт на обеих (`admissionHeld`),
hold переживает рестарт (`holdId`, `reason`).

### 2.4 Smoke внешнего каталога состояния (гейт E-42)

`.tmp/smoke-controller-state.mjs` на временном `DSH_HOME=.tmp/controller-close/smoke-home2`:
`mode=embedded stateDir=<scratch>\dsh-mywork\state`, `controller.sqlite schemaVersion=8
phase=active`, `startupTrace=lease -> stores -> reconcile -> admission`,
`shutdownTrace=admission -> settle -> release`; `Test-Path $DSH_HOME\dsh-mywork\state\controller.sqlite`
→ **True**. Живой профиль не адресовался ни разу.

## 3. Изменённые файлы

| Файл | Что | Строки |
|---|---|---|
| `tests/controller-modes.test.mjs` | добавлен тест «an idle shutdown is microtask-driven and leaves no live heartbeat timer» + пояснение в шапке файла | 231-274 (шапка 18-25) |
| `tests/controller-reconcile-order.test.mjs` | добавлен тест «two activations of one state directory reconcile in the same order» | 262-296 (файл 297 строк) |
| `packages/controller/src/**` | **не менялись** (mtime всех файлов — 27.09) | — |
| `packages/controller/lib/**` | пересборка под `scripts/with-build-lock.mjs` (build output, не исходник) | — |
| `.tmp/controller-close/**` | скрэтч: проба shutdown, pristine-снапшот бандла, TAP-логи мутаций | — |

`git status --porcelain` по моей зоне: `M packages/controller/src/app.ts`, `M .../index.ts`,
`?? .../{runtime-root,heartbeat,deployment,errors}.ts`, `?? tests/controller-*.test.mjs` — тот же
набор, что был до моего входа (ночная кампания); мои два теста лежат в уже untracked-файлах.

## 4. Команды и exit codes

| Команда | Exit | Наблюдение |
|---|---|---|
| `node --test --test-isolation=none --test-reporter=tap tests/controller-lifecycle.test.mjs` | 0 | `# tests 6 # pass 6 # fail 0` |
| `node --test --test-isolation=none --test-reporter=tap tests/controller-heartbeat.test.mjs` | 0 | `# tests 5 # pass 5 # fail 0` |
| `node --test --test-isolation=none --test-reporter=tap tests/controller-modes.test.mjs` | 0 | `# tests 7 # pass 7 # fail 0` |
| `node --test --test-isolation=none --test-reporter=tap tests/controller-reconcile-order.test.mjs` | 0 | `# tests 5 # pass 5 # fail 0` |
| то же, четыре файла одним процессом | 0 | `# tests 23 # pass 23 # fail 0 # cancelled 0 # skipped 0` |
| `tests/app-lifecycle.test.mjs` / `app-store` / `app-subsystems` / `app-adapters` | 0 / 0 / 0 / 0 | 2/2, 2/2, 1/1, 2/2 |
| `DSH_HOME=<scratch> REPO_ROOT=<repo> node .tmp/smoke-controller-state.mjs` | 0 | `schemaVersion=8 phase=active`; трейсы активации и останова как в §2.4 |
| `node .tmp/controller-close/shutdown-probe.mjs` | 0 | числа §2.2 (два прогона: до и после пересборки, совпадают) |
| **M1**: в `packages/controller/lib/index.js` `await Promise.allSettled([...inFlight])` → `await Promise.resolve()` | 1 | `tests/controller-modes.test.mjs` — `not ok 4`, падает **ровно** `tests/controller-modes.test.mjs:207` (`deepEqual(shutdownTrace, ['admission'])`, «settle still waiting»); `tests/controller-lifecycle.test.mjs` — `not ok 6`, то же утверждение (строка 286). Лог: `.tmp/controller-close/mut-M1-modes.tap` |
| **M2**: там же `await heartbeat?.stop()` → `await Promise.resolve()` | 1 | `tests/controller-modes.test.mjs` — `not ok 5 - an idle shutdown is microtask-driven and leaves no live heartbeat timer`, сообщение `no timer of the controller survives the shutdown`, `1 !== 0`, строка **262**; остальные 6 тестов зелёные. Лог: `.tmp/controller-close/mut-M2-modes.tap` |
| восстановление: `Copy-Item .tmp/controller-close/lib-index.pristine.js packages/controller/lib/index.js` | 0 | sha256 `9BE1B62B…D621` совпал с pristine-снапшотом (побайтово) |
| пересборка: `node scripts/with-build-lock.mjs controller node node_modules/tsdown/dist/run.mjs` | 0 | `✔ Build complete in 86386ms` |
| повторные прогоны после пересборки (4 controller + 4 app сюиты, агрегат, smoke) | 0 | 6/6, 5/5, 7/7, 5/5, агрегат 23/23, app 2/2+2/2+1/1+2/2, smoke exit 0 |
| `Select-String packages/controller/src/{runtime-root,heartbeat,deployment,errors}.ts -Pattern 'Date.now|setInterval'` | — | 2 совпадения, **оба в комментариях** (`heartbeat.ts:5-6`); вызовов нет |
| `Test-Path 'C:\Users\Dmitry\.dsh\dsh-mywork'` | — | **False** до работы и **False** после всех прогонов |

Замечание к mutation-check (методология, не результат): бандл контроллера **инлайнит исходники
зависимостей** — в `packages/controller/lib/index.js` есть region-метки `../contracts/src` (12),
`../core/src` (11), `../storage/src` (6), `../execution/src` (6) и т. д., внешними остаются только
`@deepseek-ai/cordis` и Node-builtins. Поэтому пересборка после восстановления дала другой sha256
(`3EA0D2C3…D1FC`, +7 строк): в 11:21:27 Lead правил `packages/contracts/src/verification.ts`
(список имён атрибутов `'attemptId','taskId','workspaceId','cwd','headSha'`, строки 236-240), а его
исходник вшит в бандл. Мутации M1/M2 ставились и проверялись на **одном и том же** снапшоте
(зелёный baseline → красный → восстановление по sha256), поэтому вывод мутаций от этого не зависит;
побайтовой воспроизводимости артефакта в движущемся дереве не заявляю.

## 5. Evidence — инвариант → чем опровергается

| Инвариант приёмки | Доказательство |
|---|---|
| Два контроллера не становятся writer одновременно | `tests/controller-lifecycle.test.mjs:158-163` (`leader.isWriter()===true`, `passive.isWriter()===false`, пассивный не открывает `controller.sqlite`); `tests/controller-modes.test.mjs:316-336` (embedded + resident на одном scope: активен один, durable row называет одного); `tests/controller-heartbeat.test.mjs:219+` (второй не допускает ни одной работы) |
| Старый epoch не коммитит после передачи leadership | `tests/controller-heartbeat.test.mjs:149-176` (`lost.isWriter()===false`, у преемника epoch **больше**, `reconcileReport.leases===1`); `:187-217` (пассивный dispose не освобождает чужую аренду) |
| Restart подхватывает состояние | `tests/controller-modes.test.mjs:276-313` (тот же путь, epoch из durable-строки, `heldEpoch >= epoch`); `tests/controller-reconcile-order.test.mjs:262-296` |
| `stop` идемпотентен | `tests/controller-modes.test.mjs:193-228` (второй `stop()` не повторяет шаги); `tests/app-lifecycle.test.mjs:50,70`; `createGracefulShutdown` мемоизирует промис (`packages/controller/src/deployment.ts:262-265`) |
| Reconcile-порядок детерминирован | `tests/controller-reconcile-order.test.mjs:136-157` (порядок §16.1 + gate закрыт внутри reconcile); новый `:262-296` (две активации — один порядок и один отчёт) |
| Остановка упорядочена и ничего не теряет | `tests/controller-lifecycle.test.mjs:270-305` и `tests/controller-modes.test.mjs:193-228` (пока работа не завершилась — трейс `['admission']`, аренда удерживается, durable-строка на месте; освобождение — последним шагом); новый `tests/controller-modes.test.mjs:231-274` (после останова нет живых таймеров и нельзя зарегистрировать работу) |
| Закрытие браузера не останавливает resident execution | `tests/controller-modes.test.mjs:161-184` — проверяется **клиентский слой**: `detach`/`detachAll` не вызывают ни одного шага останова, heartbeat продолжает биться. Браузер не поднимался, end-to-end-утверждение не делается |
| Внешний каталог состояния, профиль проверяется отдельно | smoke §2.4 (`stateDir` из `layout`, файлы в scratch-`DSH_HOME`); `Test-Path` живого профиля → False |

## 6. Ограничения и что осталось непроверенным

1. **`stop()` не ограничен по времени.** Работу, зарегистрированную в `trackWork` и не
   завершающуюся никогда, он ждёт бесконечно — цена требования «не терять незавершённую работу»
   (§16.1); таймаут — решение владельца развёртывания, а не компонента. Измерение: при
   неразрешённой работе трейс стоит на `['admission']` **2000 микротасков + 50 макротасков** без
   сдвига, и лишь разрешение работы доводит `settle`+`release` за 21 микротаск (случаи B/D в §2.2,
   вывод `.tmp/controller-close/shutdown-probe.txt`). Таймаут без политики, что делать с бросаемой
   работой, превратил бы наблюдаемое ожидание в тихую потерю — поэтому код здесь не менялся:
   остаток назван и измерен, решение оставлено развёртыванию.
2. **«Закрытие браузера» проверено на клиентском слое, а не в браузере.** Тест пинит единственное
   звено, которое могло бы сломать обещание (клиент не владеет жизненным циклом контроллера).
3. **`resident` — это application-слой с `mode: 'resident'`, а не запущенный headless-профиль.**
   Реальный отдельный DSH-профиль (без UI-сессии, с процессом-демоном) в этой сессии не поднимался:
   запуск контроллера на живом профиле запрещён заданием, а профильная проверка — зона
   `scripts/verify-profile.mjs` и Lead'а.
4. **MW-022 сдан отчётом, но независимой приёмки ещё нет:** `.work/reports/MW-022-worker.md` и
   `MW-021-worktree.md` — READY_FOR_REVIEW; ревью на замороженном коммите делает отдельный ревьюер
   (часть Lead'а). Интеграционная сторона §62 остаётся за Lead'ом.
5. **Полный прогон всех сюит не делался** — это зона `build-gate` (их отчёт
   `.work/plan-v0.3/evidence/stage4-build-gate.md`). Здесь узкие прогоны по 8 файлам + агрегат по
   четырём controller-файлам.
6. **Побайтовая воспроизводимость бандла не заявляется**: контроллер инлайнит исходники
   зависимостей, поэтому артефакт меняется от правок соседних пакетов (см. §4, замечание к
   mutation-check).
7. `tests/app-*.test.mjs` (вымонтированные адаптеры/подсистемы) не менялись и прогонялись как
   регрессия; их глубокая проверка — вне группы L.

## 7. Статус и следующий шаг

**READY_FOR_REVIEW.** Готово: реализация E-42…E-45 сверена с приёмочными критериями и шагами §14;
graceful shutdown воспроизведён, измерен и объяснён (дефекта нет, остаток зафиксирован); ключевые
инварианты доказаны узкими прогонами (30 тестов в 8 файлах, exit 0); mutation-check выполнен дважды
с восстановлением и пересборкой (M1 — красное на `tests/controller-modes.test.mjs:207` и
`tests/controller-lifecycle.test.mjs:286`; M2 — красное на `tests/controller-modes.test.mjs:262`);
добавлены два регрессионных теста; живой профиль не адресован (`Test-Path` → False).

Следующий шаг (не мой): независимое ревью этой группы (read-only, отдельный worktree), затем —
по отдельному указанию владельца — коммит; самоприёмку не объявляю. Следующая карточка не начата.
