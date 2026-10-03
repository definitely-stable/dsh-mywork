# MW-025 — Интегратор и завершение TaskGraph (E-25…E-29)

- Предмет: карточка `.work/tasks/MW-025.md` (этап `03-execution`, пункт §62 — 18), шаги `E-25…E-29` плана `.work/plan-v0.3/21-STEPS-execution.md:589-664`
- Исполнитель: teammate `review-integrator-close` (shared task `task-3`)
- Репозиторий: `H:\Repo\DSH-MyWork`, base/head `33e6919db031fb79b9c34c0ada67d4c600b0405d` (незакоммиченное дерево; коммитов не делал, `git diff --cached --stat` пуст, индекс не трогал)
- Окружение: Node `v24.x`, pwsh; git-тесты — во временных каталогах `$env:TEMP`; `packages/execution` собирался под `scripts/with-build-lock.mjs` с `NODE_OPTIONS=--max-old-space-size=8192`
- Статус: **READY_FOR_REVIEW** — E-25…E-29 сверены с приёмкой, один красный тест найден и закрыт (дефект стенда), пять файлов `tests/integrator-*.test.mjs` зелёные (22/22)

## 1. Проверка зависимостей

| Зависимость | Что проверено | Результат |
|---|---|---|
| MW-010 (TaskGraph-адаптер, authority графа) | `packages/contracts/src/taskgraph.ts`, `packages/core/src/review.ts` (переходы `approved → integrating → done`) — в дереве; тест `gates-admission` пинит матрицу: `done` достижим только из `integrating`, `integrating` — только из `approved`, `approved` — только из `reviewing` | подтверждено (`core.TASK_TRANSITIONS`/`REVIEW_TRANSITIONS`) |
| MW-021 (изоляция worktree, `E-04`) | `packages/worktree-adapter` собран; `GitPort` в контрактах уже без `push` (`packages/contracts/src/git.ts:8,86-140`), реализация `land`/`abortLanding` — `packages/worktree-adapter/src/git.ts:316,358` | принято как есть (не мой объём) |
| MW-024 (независимый review, `E-23`) | `review-queue.approveReview` + `isReviewApprovalCurrent`/`STALE_APPROVAL`; отчёт `.work/reports/MW-024-review.md` (READY_FOR_REVIEW) | в дереве, 32 теста review-* зелёные; приёмка — за владельцем |
| `E-04`-поля интегратора (`attempt_worktree`, `ReviewedArtifact`) | `packages/contracts/src/review.ts` (`ReviewedArtifact`), `packages/execution/src/integrator.ts:189-215` (`taskRefTrailer`, `integrationCommitMessage`) | подтверждено |

## 2. Сделано

### 2.1 Сверка реализации с E-25…E-29 (что уже лежало в дереве и проверено)

- `packages/execution/src/integrator.ts` — `integrate(operationId)`/`finalize(expectedRevision)`/`operation(operationId)`; допуск только по approved-immutable: `records.reviewOf` → `state === 'approved'` → `isReviewApprovalCurrent` → зелёные гейты для `landedHeadSha` → нет живых попыток → нет открытых review (порядок проверок `:1057-1096`); далее локальный `land` через `GitPort` (без `push` — операции нет в порту), повторный прогон гейтов на **интегрированном** head, идемпотентный `finalizeRow` с CAS по леджеру (`integration-schema.ts`: `operation_id` — первичный ключ, версия миграции от аллокАТОРА) и перевод графа `integrating → done` с `expectedRevision`; конфликт → `merge --abort` + `NeedsAttention('reconciliation-divergence')` + запрос решения человека.
- `packages/execution/src/integration-schema.ts` — леджер операции интеграции, состояния `landing|landed|gated|done|needs-attention`, детерминированные SQL-списки из контрактов, версия миграции принимается аргументом (`createIntegrationMigration(version)`), литерала версии в файле нет (проверяется тестом и позитивным контролем скана).
- Тесты `tests/integrator-{admission,commit,gates,conflict,finalize}.test.mjs` — 22 теста; состав совпадает с плановыми списками (5/4/4/4/5). Все работают в отдельных временных репозиториях (`mkdtempSync($env:TEMP)`, `git init`, ветка `main`, attempt — через `git worktree add -b attempt-1`), remote не создаётся ни в одном сценарии.

### 2.2 Найденный дефект (стенд): сценарий `landedScenario` с предустановленным live-attempt не расходовал инъекцию

**Наблюдение:** `node --test --test-isolation=none "tests/integrator-finalize.test.mjs"` → exit **1**, `tests 5 / pass 4 / fail 1`: `✖ finalize refuses while an attempt is live or a review is open…`, `AssertionError: ADAPTER_UNAVAILABLE: the graph was unreachable when the task was completed`.

**Корень:** фейковый граф умеет один раз упасть на переходе в `done` (`failDoneOnce`, `tests/integrator-finalize.test.mjs:200-203`), и `landedScenario` рассчитывает, что эту инъекцию израсходует первый `integrate`. Но тест передавал `recordsOptions: { liveAttempts: ['A-1'] }` **на этапе сценария**, поэтому `integrate` отказывал по гарду `live-attempt` (`integrator.ts:1085-1092`) до попытки перехода, инъекция оставалась неизрасходованной — и её впервые ловил третий (последний, «разрешающий») вызов `finalize`, который тест ждал успешным.

**Правка** (`tests/integrator-finalize.test.mjs:487-509`, моя зона): состояния гардов выставляются **после** `landedScenario()`, то есть после того, как инъекция израсходована штатным путём. Добавлено утверждение, что отказ гарда оставляет леджер в `landed` (не двигает его). Продуктовый код не менялся — поведение интегратора в этом сценарии корректно.

### 2.3 Приёмка MW-025 → чем доказана

| Приёмка карточки | Где доказательство |
|---|---|
| Stale approval не интегрируется | `integrator-admission` (5/5): без approved → `TASK_CONFLICT` + `details.reason 'review-not-approved'`; сдвинутый артефакт → `staleApprovalCode()` + `details.reason 'stale-approval'`; `needs-evidence`/`rejected` → `TASK_CONFLICT`; текущее одобрение → допуск, landing, finalize; **каждый** отказный сценарий проверяет, что репозиторий, граф и леджер не изменились |
| failed verify / конфликт не помечают Task `Done` | `integrator-gates` (4/4): гейты идут на интегрированном head (`gate head -> 3eacdf17…`, `approved head -> 5c080e69…` — разные), провал обязательного гейта оставляет задачу в `integrating`, вердикт о другом head отбрасывается и эскалируется, повтор прогона идемпотентен (артефакты не дублируются: `artifact refs -> gate-log-1, gate-log-1`). `integrator-conflict` (4/4): текстовый конфликт → `git status` пуст (`git status after the conflict -> ""`), `needs-attention -> reconciliation-divergence`, коммит не создан; «семантический» конфликт (слияние молча свело две ветки) → та же эскалация; провал verify после слияния → `git status after the failed verify -> ""` и не `done`; в исходниках нет `--force/--ours/--theirs` |
| Повтор `finalize` безопасен | `integrator-finalize` (5/5): второй `finalize` с тем же `operationId` возвращает тот же результат, `graphRevision` и `commitSha` те же, новых переходов графа и прогонов гейтов нет, `git rev-list --count --first-parent <base>..HEAD -> 1`; устаревшая ревизия → `STALE_REVISION` и ничего не меняет (в том числе head репозитория); `done` не выставляется при красном обязательном гейте, снятом/устаревшем одобрении; `finalize` отказывает при живой попытке или открытом review и не оставляет ни того, ни другого |
| Тесты во временных репозиториях, protected remote branches не меняются | Все 22 теста — в `$env:TEMP` (`refusing to remove …`-гард в `after()`); remote отсутствует: `git config --get remote.origin.url -> exit 1, stdout ""`, `git remote` пуст, `refs/remotes` пуст (`integrator-commit`, тест «the integrator cannot push…»); ветка `main` не переписывается — `git rev-list --count --first-parent <base>..HEAD -> 1` |
| `Refs: mw-<hash>` в теле коммита интегратора, без git-хуков Beads | `integrator-commit` (4/4), тест (а): `git log -1 --format=%B -> "Integrate T-1 for MW-025\n\nRefs: mw-cba06423de5d"` — строка в **теле** коммита, созданного интегратором; источник — `taskRefTrailer(taskId)` (`integrator.ts:197-199`) и `integrationCommitMessage` (`:214`), `INTEGRATION_REF_PREFIX = 'Refs: mw-'` (`:84`); в тестовом репозитории нет ни одного хука (`.git/hooks` не настраивается), зависимость от Beads-хуков отсутствует by construction |
| Стратегия и отсутствие push by construction | `DEFAULT_LANDING_STRATEGY = 'merge-no-ff'` (локальный `merge --no-ff`), `rebase` — только по явной политике; `git config --get remote.origin.url` не настроен; grep исходников интегратора на `'push'|--force|--ours|--theirs` → **0 совпадений** |

## 3. Изменённые файлы

| Файл | Что |
|---|---|
| `tests/integrator-finalize.test.mjs` | Тест «finalize refuses while an attempt is live or a review is open…»: состояния гардов выставляются после `landedScenario()`; +assert, что отказ гарда оставляет леджер в `landed` |
| `packages/execution/src/integrator.ts` | не менялся (сверен по исходнику) |
| `packages/execution/src/integration-schema.ts` | не менялся (сверен по исходнику; версия миграции — от аллокатора) |

## 4. Команды и exit codes

Прогон после окна пересборки `build-gate` (все 15 `lib` на месте; `packages/execution` пересобран мной под локом в 11:16:30, sha256 `9BDE4CEA…13EC8D`).

| # | Команда | Наблюдение | Exit |
|---|---|---|---|
| D-1 | `node --test --test-isolation=none "tests/integrator-finalize.test.mjs"` (до правки) | `tests 5 / pass 4 / fail 1`; `✖ finalize refuses while an attempt is live or a review is open…`; `AssertionError: ADAPTER_UNAVAILABLE: the graph was unreachable when the task was completed` | **1** |
| G-1 | тот же файл после правки | `tests 5 / pass 5 / fail 0 / skipped 0`, `duration_ms 14.4s` | **0** |
| G-2 | `node --test --test-isolation=none "tests/integrator-admission.test.mjs"` | `tests 5 / pass 5 / fail 0 / skipped 0` | **0** |
| G-3 | `node --test --test-isolation=none "tests/integrator-commit.test.mjs"` | `tests 4 / pass 4 / fail 0 / skipped 0`; диагностика: `git log -1 --format=%B -> "Integrate T-1 for MW-025\n\nRefs: mw-cba06423de5d"`; `git config --get remote.origin.url -> exit 1, stdout ""` | **0** |
| G-4 | `node --test --test-isolation=none "tests/integrator-gates.test.mjs"` | `tests 4 / pass 4 / fail 0 / skipped 0`; диагностика: `gate head -> 3eacdf17…`, `approved head -> 5c080e69…`, `gate verdicts -> gate-1:pass, gate-2:fail`, `needs-attention reason -> reconciliation-divergence` | **0** |
| G-5 | `node --test --test-isolation=none "tests/integrator-conflict.test.mjs"` | `tests 4 / pass 4 / fail 0 / skipped 0`; диагностика: `git status after the conflict -> ""`, `needs-attention -> reconciliation-divergence`, `git status after the failed verify -> ""` | **0** |
| G-6 | батч 17 файлов (гейты + review + интегратор), `2026-09-28 11:17:54` | `FILES=17 TESTS=91 PASS=91 FAIL=0 NONZERO=0` | **0** (каждый файл) |
| G-7 | **финальный сводный прогон**: 20 файлов (+ `gates-port`, `events`, `boundaries`), `2026-09-28 11:30:53` | `FILES=20 TESTS=131 PASS=131 FAIL=0 NONZERO=0`; в том числе `integrator-admission 5/5`, `integrator-commit 4/4`, `integrator-gates 4/4`, `integrator-conflict 4/4`, `integrator-finalize 5/5` | **0** (каждый файл) |
| S-1 | `$hits = @(Select-String -Path packages\execution\src\integrator.ts -Pattern "'push'\|--force\|--ours\|--theirs\|\bforce\b"); $hits.Count` | `hits=0` | 0 |
| S-2 | `Select-String -Path packages\contracts\src\git.ts -Pattern 'push'` | единственное совпадение — докблок «There is no `push`» (`:8`); операции в порту нет, поэтому её отсутствие выражено типом | 0 |
| B-1 | `node_modules\.bin\tsc.cmd --noEmit -p packages/execution/tsconfig.json` | без диагностик | **0** |
| B-2 | `Push-Location packages/execution; $env:NODE_OPTIONS='--max-old-space-size=8192'; node ../../scripts/with-build-lock.mjs execution node ../../node_modules/tsdown/dist/run.mjs` | `✔ Build complete in 61611ms` (и `60981ms` после mutation-check) | **0** |

## 5. Evidence (наблюдения)

- Тело коммита интегратора (тест (а) `integrator-commit`): `Integrate T-1 for MW-025` + пустая строка + `Refs: mw-cba06423de5d`; хеш задачи детерминирован (`taskRefTrailer`), связь не зависит от git-хуков.
- Разные head до и после интеграции (тест (а) `integrator-gates`): `gate head -> 3eacdf1774516e4d70ef449455d70808c1780f09`, `approved head -> 5c080e6981cb9c0f14d91841e6e070113653febe` — гейты относятся к интегрированному head (E-15), а не к одобренному.
- Идемпотентность гейтов (тест (г) `integrator-gates`): `artifact refs -> gate-log-1, gate-log-1` — повторный прогон переиспользует тот же артефакт по hash.
- Конфликт (тест (а) `integrator-conflict`): после `merge --abort` — `git status` пуст, состояние задачи `needs-attention`, причина `reconciliation-divergence` (существующее значение закрытого каталога, новых не вводилось), коммит не создан.
- Повтор `finalize` (тест (б) `integrator-finalize`): `git rev-list --count --first-parent 8acc9f3..HEAD -> 1` — два вызова `finalize`, один коммит; `transition:T-1->integrating:3, transition:T-1->done:4, transition:T-1->done:4` — второй переход идёт с той же наблюдённой ревизией и не создаёт второго коммита.

## 6. Ограничения и что осталось непроверенным

1. **Порт интегратора в тестах инъектируется; продакшн-проводка — composition-слой (зона Lead'а).** Реализация `land`/`abortLanding` существует (`packages/worktree-adapter/src/git.ts:316,358`), но кто и как передаёт `GitPort`, `TaskGraphPort`, `IntegrationRecordPort`, `IntegrationGatePort` и `IntegrationEscalationPort` в `createIntegrator`, в моём объёме не проверялось: тесты передают собственные порты, включая `records` (approved review) и `gates` (раннер политики). Это же место, где `E-27`-гейты получают `cwd` основного checkout.
2. **Реальный `push`/remote не проверялся — и не может быть проверен этим шагом by construction:** операции `push` нет в `GitPort`, ни один тестовый репозиторий не имеет remote (`git remote` пуст). «Protected remote branches не меняются» доказано отсутствием remote, а не попыткой в него не писать.
3. **`HumanDecision` как сущность — не этот шаг:** создаётся только запрос решения (`escalation.requestDecision`) и `NeedsAttention`; форма — `D14`/`MW-030`, доставка ответа — `Q-17`, неблокирующий шаг — `Q-19` (план `:664`). Блокирующего ожидания нет.
4. **Правило `D19` (карточка не переводится в `done` при `failed`-исполнении без строки-обоснования) тестом `(д)` не покрывается** — план прямо это оговаривает (`:650`); проверка принадлежит `F(производный INDEX/сверка леджеров)`.
5. **`tests/events.test.mjs:172` был красным и исправлен Lead'ом** (его зона — контракты): пиннинг словаря ошибок не знал про аддитивный `STALE_APPROVAL` из `E-23`. Проверено после правки: `node --test --test-isolation=none "tests/events.test.mjs"` → `tests 4 / pass 4 / fail 0`, exit **0**.
6. **Полный набор тестов не гонялся** (зона `build-gate`); в его прогоне 11:08–11:17 из моих файлов красным был только `tests/integrator-finalize.test.mjs:487`, закрытый в §2.2.
7. Коммитов не делал, индекс не трогал; всё, что создавалось, — во временных каталогах `$env:TEMP` и в `.tmp/review-integrator-close/`; живой профиль и доска не трогались.

## 7. Статус и следующий шаг

**READY_FOR_REVIEW.** E-25…E-29 сверены с приёмкой карточки, включая `Refs: mw-<hash>` в теле коммита интегратора (проверено `git log -1 --format=%B`), «stale approval не интегрируется», «конфликт/failed verify не дают `done`» и безопасный повтор `finalize`; 22 теста `integrator-*` зелёные, найденный дефект был в стенде и закрыт. Приёмку не объявляю — нужен независимый ревьюер. Открытые пункты: проводка портов интегратора в composition-слое (§6.1) и вызов моста гейтов в `worker.ts` (`task-6`, §6.5-контекст). Следующая карточка не начата.
