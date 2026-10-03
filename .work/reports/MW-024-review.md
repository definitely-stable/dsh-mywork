# MW-024 — Независимый review и reject-flow (E-19…E-24)

- Предмет: карточка `.work/tasks/MW-024.md` (этап `03-execution`, пункты §62 — 8, 16, 17), шаги `E-19…E-24` плана `.work/plan-v0.3/21-STEPS-execution.md:483-585`
- Исполнитель: teammate `review-integrator-close` (shared task `task-3`)
- Репозиторий: `H:\Repo\DSH-MyWork`, base/head `33e6919db031fb79b9c34c0ada67d4c600b0405d` (незакоммиченное дерево; коммитов не делал, `git diff --cached --stat` пуст)
- Окружение: Node `v24.x`, pwsh; сборка только под `scripts/with-build-lock.mjs`, `NODE_OPTIONS=--max-old-space-size=8192` для `packages/execution`
- Статус: **READY_FOR_REVIEW** — реализация E-19…E-24 сверена с приёмкой, три красных файла были найдены и закрыты (плюс один в MW-025), 12 файлов review-*/*gates-admission* зелёные (91/91 в общем батче 17 файлов)

## 1. Проверка зависимостей

| Зависимость | Что проверено | Результат |
|---|---|---|
| MW-015 (порт рантайма, `D14`) | `packages/contracts/src/agent-runtime.ts`, `packages/controller/src/dsh-session.ts` — в дереве; тесты `session.test.mjs`/`runtime.test.mjs` не трогались | принято как есть (не мой объём) |
| MW-020 (сессии) | `packages/execution/src/review-queue.ts:1472-1473` — scope несёт `fresh: true`, `carriesTranscript: false`; проверяется `tests/review-readonly.test.mjs:197-198` | подтверждено тестом |
| MW-023 (гейты), **E-17** | `readGateResults`+`assertGatesSatisfied` вызываются из `requestReview` (`review-queue.ts:1580-1593`); отказ `REVIEW_GATES_MISSING` доказан новым тестом (`tests/gates-admission.test.mjs`, 6-й). Подробно — `.work/reports/MW-023-gates-e17.md` | закрыто (остаток producer-половины в `worker.ts` вынесен на согласование, там же §6) |
| Контракт `review-verdict.ts` | `packages/contracts/src/review-verdict.ts` (`REVIEW_VERDICT_*`, `REVIEW_APPROVAL_SCHEMA`/`_CONTENT_TYPE`, `ReviewApprovalRecord`) — создан Lead'ом; я его не правил | принято |

## 2. Сделано

### 2.1 Что уже лежало в дереве (сверено с приёмкой, не переписывалось)

- `packages/execution/src/review-queue.ts` — очередь `review_claim` (CAS по `revision`), постановка из `awaiting-review`, идемпотентный повтор `(attemptId, headSha)`, `claimReview`/`beginReviewing`/`verdict`/`needs-evidence`/`escalation`/`rejectReview`/`approveReview`, `scopeOf`, handoff findings+checkpoint в новую попытку, лимит петель из бюджета задачи и числа `rejected`.
- `packages/execution/src/review-schema.ts` — миграция `review_claim` с версией **от аллокатора** (`REVIEW_CLAIM_ALLOCATION_KEY`), CAS-поля, `approval`, `handoff`, `escalation`.
- Инварианты взяты из `core`, а не переписаны: `assertReviewerIndependence` (`packages/core/src/review.ts:119`), `assertReviewerReadOnly` (`:139`), `isReviewApprovalCurrent`/`assertReviewApprovalCurrent` (`:156`,`:167`), `REVIEW_STATES_REQUIRING_FINDINGS`.
- Тесты `tests/review-{queue,independence,readonly,evidence,staleness,reject}.test.mjs` — 32 теста, состав совпадает с плановыми списками (6/4/4/6/5/7).

### 2.2 Дефект 1 (SECURITY): ревьюеру выдавали `git.write`/`shell`

**Наблюдение:** `node --test --test-isolation=none "tests/review-readonly.test.mjs"` → exit **1**, `✖ a reviewer granted a write permission is refused before the claim`, `AssertionError: git.write must not be held by a reviewer`.

**Корень:** `admitReviewer` вызывал только доменный инвариант `packages/core/src/review.ts:139-149`, который отказывает **лишь** на `workspace.write`. Грант с `git.write` (коммит в проверяемый worktree) или `shell` (запись чем угодно) проходил проверку — приёмка «Reviewer не редактирует implementation» держалась на одном из трёх способов изменения.

**Правка** (`packages/execution/src/review-queue.ts`, мой файл): после доменного инварианта грант отвергается, если держит любую из `contracts.IMPLEMENTATION_WRITE_PERMISSIONS` (`packages/contracts/src/security.ts:212-216` = `workspace.write`, `git.write`, `shell`), отказом `SECURITY_DENIED` с `details.permissions` (полный набор) и `details.refused`. Точка — `admitReviewer`, то есть **до** CAS-записи и до любой смены состояния; действует на `claimReview`, `approveReview`, `rejectReview`, `needs-evidence` и `escalation` одинаково. Контракты не правились (словарь уже существовал).

### 2.3 Дефект 2 (BLOCKER): approval не записывался вообще

**Наблюдение:** `review-staleness` → exit **1**; в выводе падения на тестах `:287` и `:318` с `AssertionError: … the artifact "review-approval:<reviewId>:<headSha>:<diffHash>" of review "R-…" could not be stored (invalid-input)`, и на `:358` — `expected 'STALE_APPROVAL', actual 'STALE_REVISION'`. Красными были 5 из 5 (тесты `:230`/`:261` делают тот же вызов `approveReview`).

**Корень:** artifactId одобрения собирался как `review-approval:${reviewId}:${headSha}:${diffHash}` — 160 символов, а evidence-схема принимает идентификатор не длиннее 64 (`packages/evidence/src/metadata.ts:37-40`: `ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/`, `MAX_ID_LENGTH = 64`). `putArtifact` отвечал `invalid-input`, `approveReview` превращал это в `TASK_CONFLICT` — то есть **ни одно одобрение не записывалось**, а интегратор не мог получить approved-работу. Предел 64 — чужой закрытый контракт, понижать его нельзя; подстраивать обязан писатель.

**Правка:** `approvalArtifactId(reviewId, artifact)` в `review-queue.ts` — префикс `review-approval:<reviewId>:` плюс отпечаток `sha256(reviewId:headSha:diffHash)`, обрезанный по остатку бюджета (для 38-символьного `R-…` это 9 hex; итог 63 символа). Свойства: детерминизм по (reviewId, headSha, diffHash) — идемпотентный повтор одобрения читает ту же запись (`created: false`); смена head или diff даёт другой id и потому либо новый артефакт, либо честный `artifact-conflict`, но никогда не подмену. Если места на отпечаток не остаётся, `recordApproval` отказывает типизированно (`TASK_CONFLICT`), а не бросает.

**Правки в тесте (моя зона):** `tests/review-staleness.test.mjs:245` вместо дословного 160-символьного id проверяет префикс `review-approval:<reviewId>:`, длину ≤64 и форму идентификатора (причина названа ссылкой на `metadata.ts:40`); тест `:358` теперь получает CAS-ревизию из результата успешного одобрения (`approved.value.claim.revision`) вместо жёсткого `2` — иначе `STALE_REVISION` маскировал `STALE_APPROVAL` (после успешного approve claim уходит на ревизию+1, `review-queue.ts:1988-2001`).

### 2.4 Дефект 3: тест лимита петель предполагал чужие имена попыток

**Наблюдение:** `review-reject` → exit **1**, `✖ the review loop is bounded and the excess needs a human`: `AssertionError: dsh-mywork: attempt "A-2" does not exist, so it cannot be reviewed`.

**Корень (стенд, не продукт):** цикл теста брал `attemptId = 'A-<cycle>'`, тогда как очередь чеканит новую попытку как `A-${randomUUID()}` (`review-queue.ts:2119`). После первой правки цикла обнаружен второй слой: тест сбрасывал состояние задачи в `awaiting-review` после **каждой** итерации, включая терминальную, и тем самым затирал `needs-attention`, который выставляла очередь (`actual 'awaiting-review', expected 'needs-attention'`).

**Правка:** цикл несёт `attemptId` из `next.attempt.id` (тот, что вернула очередь), и сброс задачи/сеттлмент делаются только когда попытка создана, то есть когда цикл продолжается. Продуктовый код не менялся: лимит и `retry-budget-exhausted` уже были реализованы верно.

### 2.5 Приёмка MW-024 → чем доказана

| Приёмка карточки | Где доказательство |
|---|---|
| Self-review запрещён | `review-independence` (4/4): тот же `agentId` → `SECURITY_DENIED`, отказ не меняет состояние (`queued`, `revision 1`), другая `AgentInstance` той же идентичности тоже отвергается, независимый допускается |
| Reviewer не редактирует implementation | `review-readonly` (4/4): scope пинит `permission: 'read-only'`, `agentPreset: mywork-reviewer`, `carriesTranscript: false`; грант с `workspace.write`/`git.write`/`shell` отвергается **до** claim; запись файла из review-сессии отвергается `authorizeOperation` (`permission-missing`/`workspace.write`), чтение того же пути разрешено (позитивный контроль); self-approval отвергается `reason: 'self-approval'` |
| Изменение SHA/diff отменяет approval | `review-staleness` (5/5): новый commit → `isReviewApprovalCurrent === false` и отказ `STALE_APPROVAL` с `details.reviewed/current`; пересборка diff при том же head — тот же отказ; повтор approve идемпотентен (`created: false`, тот же `artifactId`/`hash`, ревизия не меняется, второго артефакта нет); словарь `MYWORK_ERROR_CODES` вырос ровно на 1 и сохранил порядок |
| Reject/NeedsEvidence/Escalated переходят в следующий state | `review-reject` (7/7): reject → `changes-requested` (не `ready`); новая попытка с тем же `agentId`/worktree и растущим fence; fresh-сессия `carriesTranscript: false`; findings и checkpoint видны через контекст-порт; `needs-evidence` → `reviewing` без попытки; `escalated` создаёт запрос решения человека + `needs-attention` (не терминально молча) |
| Превышение loops требует решения | `review-reject` тест 7: три цикла → `needs-attention` с `retry-budget-exhausted`, `loopLimit 3`, `rejected 3`, четвёртая попытка не создаётся, fence растёт `[1,2,3]`, три `review_claim` в состоянии `rejected`; с бюджетом задачи `maxAttempts: 2` лимит берётся из бюджета (`loopLimit 2`) |
| «Ошибка инструмента ≠ согласие», отказ автоматики | `review-queue` (6/6): постановка/идемпотентность/CAS/`STALE_REVISION`/занятость пула ревьюеров числами/«живая попытка и живое review одной задачи не сосуществуют». Автоматический актор на approve отвергается (`refuseAutomatic`, D15) внутри `review-queue.ts` |

## 3. Изменённые файлы

| Файл | Что |
|---|---|
| `packages/execution/src/review-queue.ts` | `+IMPLEMENTATION_WRITE_PERMISSIONS` в импорт; в `admitReviewer` — отказ на implementation-write права; константы `ARTIFACT_ID_MAX_LENGTH`/`APPROVAL_ARTIFACT_PREFIX`/`APPROVAL_FINGERPRINT_CHARS`/`APPROVAL_FINGERPRINT_MIN_CHARS`; функция `approvalArtifactId`; `recordApproval` использует её и отказывает типизированно, если места нет. ~30 строк |
| `tests/review-staleness.test.mjs` | Пиннинг id одобрения переписан на (префикс, длина ≤64, форма) + комментарий с адресом предела; тест словаря берёт ревизию из результата approve |
| `tests/review-reject.test.mjs` | Цикл лимита петель несёт `attemptId` из `next.attempt.id`; сброс состояния задачи — только на продолжающейся итерации |
| `tests/gates-admission.test.mjs` | +1 тест (E-17 на реальной очереди) — см. `.work/reports/MW-023-gates-e17.md` |

Не менялись: `packages/contracts/**`, `packages/execution/src/{index,service,worker}.ts`, `tests/lib/fixtures.mjs`, `tests/boundaries.test.mjs`, `packages/controller/**`, `packages/execution/src/{integrator,integration-schema,gates-admission}.ts`.

## 4. Команды и exit codes

Прогон после окна сборки `build-gate` (все 15 `lib` на месте; последний — `controller` 11:06:29; моя пересборка `packages/execution` под локом в 11:16:30, sha256 `9BDE4CEA…13EC8D`). Батч — 17 файлов, окно `2026-09-28 11:17:54`.

| # | Команда | Наблюдение | Exit |
|---|---|---|---|
| D-1 | `node --test --test-isolation=none "tests/review-readonly.test.mjs"` (до правки) | `✖ a reviewer granted a write permission is refused before the claim`; `AssertionError: git.write must not be held by a reviewer` | **1** |
| D-2 | `node --test --test-isolation=none "tests/review-staleness.test.mjs"` (до правки) | падения `:287`, `:318` — `could not be stored (invalid-input)`; `:358` — `actual 'STALE_REVISION' / expected 'STALE_APPROVAL'` | **1** |
| D-3 | `node --test --test-isolation=none "tests/review-reject.test.mjs"` (до правки) | `✖ the review loop is bounded…`; `attempt "A-2" does not exist`, затем `actual 'awaiting-review' / expected 'needs-attention'` | **1** |
| B-1 | `node_modules\.bin\tsc.cmd --noEmit -p packages/execution/tsconfig.json` | без диагностик | **0** |
| B-2 | `Push-Location packages/execution; $env:NODE_OPTIONS='--max-old-space-size=8192'; node ../../scripts/with-build-lock.mjs execution node ../../node_modules/tsdown/dist/run.mjs` | `✔ Build complete in 61611ms` (первый), затем `60981ms` (после mutation-check) | **0** |
| G-1 | `node --test --test-isolation=none "tests/review-queue.test.mjs"` | `tests 6 / pass 6 / fail 0 / skipped 0` | **0** |
| G-2 | `node --test --test-isolation=none "tests/review-independence.test.mjs"` | `tests 4 / pass 4 / fail 0 / skipped 0` | **0** |
| G-3 | `node --test --test-isolation=none "tests/review-readonly.test.mjs"` | `tests 4 / pass 4 / fail 0 / skipped 0` | **0** |
| G-4 | `node --test --test-isolation=none "tests/review-evidence.test.mjs"` | `tests 6 / pass 6 / fail 0 / skipped 0` | **0** |
| G-5 | `node --test --test-isolation=none "tests/review-staleness.test.mjs"` | `tests 5 / pass 5 / fail 0 / skipped 0` (перепроверено отдельно после сводки `build-gate`) | **0** |
| G-6 | `node --test --test-isolation=none "tests/review-reject.test.mjs"` | `tests 7 / pass 7 / fail 0 / skipped 0` | **0** |
| G-7 | `node --test --test-isolation=none "tests/gates-admission.test.mjs"` | `tests 6 / pass 6 / fail 0 / skipped 0` | **0** |
| G-8 | батч 17 файлов (гейты + review + интегратор), см. §4 отчёта MW-025 | `TESTS=91 PASS=91 FAIL=0 NONZERO=0` | **0** (каждый файл) |
| G-9 | **финальный сводный прогон**: 20 файлов (гейты + `gates-port` + review + интегратор + `events` + `boundaries`), `2026-09-28 11:30:53` | `FILES=20 TESTS=131 PASS=131 FAIL=0 NONZERO=0` — в том числе `review-staleness 5/5`, `review-reject 7/7`, `review-readonly 4/4`, `events 4/4`, `boundaries 31/31` | **0** (каждый файл) |
| M-1…M-7 | mutation-check на собранном `packages/execution/lib/index.js` (снятие блокировки гейтов) | мутация → `5 pass / 1 fail`, `AssertionError: admission must be refused`; восстановление и пересборка дают байт-в-байт прежний `lib` (`9BDE4CEA…`), батч снова 91/91 | мутация **1**, восстановление **0** |

## 5. Evidence (наблюдения из вывода)

- Одобрение и его идентичность (тест `review-staleness`): `artifactId` = `review-approval:R-<uuid>:<9 hex>` (63 символа), `created: true`, `claim.state: 'approved'`, `settledAt` из FakeClock; повтор → `created: false`, тот же `artifactId`/`hash`, ревизия не изменилась, `SELECT COUNT(*) FROM artifacts WHERE review_id = ?` = 1.
- Отказ чужому праву (тест `review-readonly`): для `workspace.write`, `git.write`, `shell` — `SECURITY_DENIED`, `details.permissions` содержит нарушителя, после отказов строка `review_claim` остаётся `queued`/`revision 1` (SQL-строка в тесте).
- Лимит петель (тест 7 `review-reject`): `['changes-requested','changes-requested','needs-attention']`, `attention.reason = 'retry-budget-exhausted'`, `loopLimit 3`, `rejected 3`, `dbAttempts 3`, fence `[1,2,3]`, `SELECT state FROM review_claim … = ['rejected','rejected','rejected']`; при `maxAttempts: 2` — `loopLimit 2`, `dbAttempts 2`.
- Отказ адмиссии по гейтам (тест 6 `gates-admission`): `TASK_CONFLICT` + `details.refusal = 'REVIEW_GATES_MISSING'`, `blocks` именуют гейт, `COUNT(*) FROM review_claim` = 0 после отказа и 1 после зелёного гейта, `graph.transitions = []`.

## 6. Ограничения и что осталось непроверенным

1. **E-21 проверен на уровне политики сессии, а не смонтированного пресета.** Константа `REVIEW_AGENT_PRESET = 'mywork-reviewer'` объявлена (`review-queue.ts:130`), но пакета-пресета в дереве нет (`Select-String -Path packages\*\src\*.ts,packages\*\package.json -Pattern 'mywork-reviewer'` → только это объявление). Тест «запись файла из review-сессии отвергается» идёт через реальный `core.authorizeOperation` с `harnessPolicy: 'read-only'` и грантом из `REVIEWER_DEFAULT_PERMISSIONS`, то есть проверяет платформенный ограничитель, но не живой пресет. Это ровно риск, названный планом (`:535`) и относящийся к `E-41`/`Q-37`.
2. **Доставка ответа человека не в этом шаге.** `escalated` создаёт запрос решения (`escalation.requestDecision`) и `needs-attention`, но **не ждёт** ответа: форма — `D14`/`MW-030`, доставка — `Q-17`, неблокирующий шаг — `Q-19` (план `:584-585`). Проверено тестом, что блокирующего `ask()` нет.
3. **Producer-половина E-17 не реализована** (`worker.ts` не запускает гейты и не пишет `gate-result`): файл принадлежит `execution-close`; решение Lead'а — `task-6` (вызов порта в воркере), мост `createAttemptGatePort` сделан отдельно (`task-7`, `.work/reports/MW-023-gates-port.md`). Очередь при отсутствии гейтов отказывает (fail-closed), поэтому «гейты не запускались» сегодня неотличимо от «гейтов нет» — но не превращается в допуск.
4. **`tests/events.test.mjs:172` был красным и исправлен Lead'ом** (его зона: контракты): пиннинг словаря `MYWORK_ERROR_CODES` не знал про аддитивно добавленный `STALE_APPROVAL` (E-23, `packages/contracts/src/operation.ts:83,107`). Проверено с моей стороны после правки: `node --test --test-isolation=none "tests/events.test.mjs"` → `tests 4 / pass 4 / fail 0`, exit **0**. Правку делал не я.
5. **Полный набор тестов не гонялся** — зона `build-gate`; в его прогоне 11:08–11:17 из моих файлов красными были ровно те, что закрыты в §2, остальные падения — зона `execution-close` (`tests/worker-flow.test.mjs:457`).
6. Коммитов не делал, индекс не трогал, живой профиль/доску не трогал, скрэтч — `.tmp/review-integrator-close/`.

## 7. Статус и следующий шаг

**READY_FOR_REVIEW.** E-19…E-24 сверены с приёмкой карточки, три найденных дефекта закрыты, 32 теста review-* зелёные, mutation-check для E-17 пройден (красное на снятии блокировки, зелёное после восстановления и пересборки). Приёмку не объявляю — нужен независимый ревьюер; отдельно требуют решения Lead'а: (а) правка `tests/events.test.mjs` (§6.4), (б) рамка для producer-половины E-17 в `worker.ts` (§6.3). Следующая карточка не начата.
