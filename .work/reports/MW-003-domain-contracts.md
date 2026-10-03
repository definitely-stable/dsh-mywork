# MW-003 — Определить доменные контракты и переходы состояний

- Предмет: карточка доски `3729ad0f-d4e5-46ec-bb02-35ab4de992b8` (MW-003), этап `00-foundation`, обязательный пункт §62 — 32
- Исполнитель: сессия DSH Web, модель `opencode-go/deepseek-v4.1-flash`
- Репозиторий: `H:\Repo\DSH-MyWork`, base SHA `209a92d486ce71e8207349cf7ffe68ed0e2d6315`, head `e8b3cc226a18e58a85c02063b4afbb7360947393` (7 коммитов, см. §10; push/merge не выполнялись)
- Окружение: Node `v24.19.0`, pnpm `12.4.2`, DSH `0.1.5-rc.2`
- Статус: **DONE** — работа завершена и закоммичена (`28cbf2f`…`e8b3cc2`, см. §10); ревью-статус снят решением владельца. Независимое ревью и повторная верификация исправлений выполнены отдельными сессиями (§8, §8.1)

---

## 1. Проверка зависимости MW-002

| Что проверено | Результат |
|---|---|
| Отчёт `reports/MW-002-bootstrap.md` | Существует (219 строк); на момент проверки — ожидание ревью, впоследствии снятое владельцем (см. §10) |
| Независимый review MW-002 (`reports/MW-002-review.md`) | **Отсутствует.** По правилам `README.md` («нужны проверки, отчёт и независимое review для изменения кода») это ещё не приёмка |
| Проверка по исходникам | `pnpm install` → `pnpm run check` → **exit 0**; smoke 9/9 `ok`; 4 пакета собираются; `lib/index.js` контроллера импортирует только `@deepseek-ai/cordis` |
| Границы пакетов | `contracts` без зависимостей, `core` только `@dsh-mywork/contracts`, контроллер зависит вниз; обратных импортов нет (проверяется тестом `tests/boundaries.test.mjs`) |

Правило карточки «если зависимость не принята — остановись с BLOCKED» применено
буквально: единственное, чего не хватает MW-002, — независимое ревью. Вопрос
владельцу задан до начала работы; **владелец выбрал вариант «продолжить MW-003,
ревью MW-002 включить в финального ревьюера»**. Риск зафиксирован как
ограничение §6.3; остановки с BLOCKED не требуется.

---

## 2. Сделано

### 2.1 Доменные контракты (`@dsh-mywork/contracts`, типы и замороженные данные, без рантайм-логики)

| Файл | Содержимое | Раздел архитектуры |
|---|---|---|
| `ids.ts` | `Revision`, `FenceToken`, `ControllerEpoch`, `EpochMs` и идентификаторы Task/Attempt/Review/Agent/Role/Blueprint/Workspace/Session/Operation/Correlation/Event | §9, §17, §35 |
| `revisions.ts` | 8 immutable revision families, `RevisionRef`, `FrozenRevisions` | §35 |
| `operation.ts` | `OperationMeta` (operationId, correlationId, expectedRevision, controllerEpoch), `Result<T>` с `meta` в обеих ветвях, 13 кодов ошибок §42 | §9, §42 |
| `events.ts` | `MYWORK_EVENT_SCHEMA = 'mywork.event/v1'`, `EventEnvelope`, `MYWORK_ENVELOPE_FIELDS`, 6 типов событий, `DomainEvent` | §43 |
| `authority.ts` | Матрица §8: 20 доменов → владельцы (первый — писатель), признак `projection` для Task Board | §8 |
| `task.ts` | 16 состояний §18.1, `Task`, `TaskBoardPlacement` (проекция) | §8, §18.1 |
| `attempt.ts` | 11 состояний §18.2, `Lease`, `WorktreeRef`, `Attempt` с `FrozenRevisions` | §17, §18.2 |
| `review.ts` | 8 состояний §18.3, `ReviewedArtifact` (headSha + diffHash), `ReviewFindings` | §18.3, §19 |
| `team.ts` | `Role` (contract и strategy с раздельными ревизиями), `AgentBlueprint`, `AgentIdentity`, `AgentInstance`, 7 состояний §13.5 | §13.1–13.5 |

### 2.2 Чистые переходы и ownership (`@dsh-mywork/core`)

| Файл | Содержимое |
|---|---|
| `errors.ts` | `MyWorkError` (реализует контрактную форму), `isMyWorkError`, `ok()`, `fail()` |
| `guards.ts` | `defineOperationMeta`, `assertRevision` → `STALE_REVISION`, `assertFence` → `STALE_FENCE`, `assertControllerEpoch` → `LEASE_LOST`, `freezeRevisions` → `CONTRACT_MISMATCH` |
| `authority.ts` | `authorityOf`, `primaryOwnerOf`, `mayWrite`, `isProjectionDomain`, `assertWriteAuthority` → `SECURITY_DENIED` |
| `task.ts` | Таблица `TASK_TRANSITIONS`, `transitionTask`, `admitAttempt`, `resolveAttemptBinding`, `assertTaskInvariants` |
| `attempt.ts` | Таблица `ATTEMPT_TRANSITIONS`, `transitionAttempt` с правилами lease/fence/epoch, монотонность fence через `previousFence` |
| `review.ts` | Таблица `REVIEW_TRANSITIONS`, `transitionReview`, `assertReviewerIndependence` (§13.2), `assertReviewerReadOnly` (§13.2), `assertReviewApprovalCurrent` (§19) |
| `team.ts` | Таблица `AGENT_INSTANCE_TRANSITIONS`, `transitionAgentInstance` с привязкой attempt |

Все переходы — чистые функции: они не читают часы, не генерируют идентификаторы
и не обращаются к хранилищам. Время (`at`), идентификаторы и `OperationMeta`
передаёт вызывающий; результат — либо следующее состояние с событиями, либо
`Result` с типизированной ошибкой. Проверки идут в фиксированном порядке:
`expectedRevision` → связность входного агрегата → допустимость ребра → правила
владения (epoch/fence) → согласованность результата.

Три правила закрыты кодом, а не дисциплиной вызывающего:

1. **`assigned` достигается только допуском попытки.** `admitAttempt` —
   единственный путь `ready → assigned`; `transitionTask` отказывает на целевом
   `assigned` (`TASK_CONFLICT`), поэтому проверки терминальности/готовности и
   событие `task.attempt.admitted` нельзя обойти.
2. **Владение попыткой непрерывно.** Задача, уже исполняющая попытку A, не может
   подменить её на B: `resolveAttemptBinding` возвращает `TASK_CONFLICT`
   (`cannot swap attempt`). Переназначение идёт только через отзыв и `ready`.
3. **Владение арендой обязательно и разграничено по epoch.** Переход
   leased-попытки без `meta.controllerEpoch` — программная ошибка (`TypeError`),
   выпуск аренды (`created → leased`) требует epoch и сверяет его с epoch аренды.
   Свой epoch может двигать попытку по любому разрешённому ребру; строго **более
   новый** epoch может только отобрать владение (`stale`, `revoked`) — это
   supersession при failover контроллера (§3, §17); **более старый** epoch не
   может ничего (`LEASE_LOST`).

### 2.3 Проверки

`tests/` — 8 файлов тестов на `node:test` + `node:assert/strict` и общие фикстуры,
импортируют собранные `lib/*.js` (как потребитель), без LLM, сети, подпроцессов и
wall-clock. Прогон: **62 pass / 0 fail**.

| Требование приёмки | Где проверяется |
|---|---|
| Разрешённые переходы | `task.test.mjs` (главная линия `draft → … → done`, где `assigned` — через допуск попытки), `attempt.test.mjs` (`created → … → completed`), `review.test.mjs`, `team.test.mjs` |
| Запрещённые переходы | Полный перебор всех пар состояний (16×16 = 204 запрещённых, 11×11 = 94, 8×8 = 51, 7×7 = 35): каждая пара вне таблицы → `TASK_CONFLICT` |
| Завершённая Task не допускает active Attempt | `admitAttempt` для `done`/`cancelled`/`superseded` → `UNSCHEDULABLE`; `assertTaskInvariants` → `TASK_CONFLICT` для терминального состояния с попыткой; проверка «терминальное ⇒ нет исходящих рёбер» для всех трёх машин |
| Stale revision / fence — отдельная ошибка | `guards.test.mjs` (`STALE_REVISION`, `STALE_FENCE`, `LEASE_LOST` с `details {expected, actual}`), `attempt.test.mjs` (переиспользование fence → `TASK_CONFLICT`, отсутствие fence/epoch → `TypeError`) |
| Домен не импортирует DSH/Beads/конкретную память | `boundaries.test.mjs`: разбор спецификаторов импортов в `packages/*/src`, манифесты без runtime-зависимостей, точный список импортов в собранных `lib/*.js` |

---

## 3. Изменённые и новые файлы

Коммитов на момент подготовки отчёта не было (карточка запрещает без отдельного
поручения); по отдельному поручению владельца изменения закоммичены — SHA в §10.
`git status --short` относительно base SHA на тот момент:

```text
 M README.md
?? .gitignore  package.json  packages/  pnpm-lock.yaml  pnpm-workspace.yaml  scripts/  tests/  tsconfig.base.json
```

`README.md` — единственный отслеживаемый файл, изменённый в этой карточке;
`packages/` целиком untracked, потому что MW-002 не коммитился (в base-дереве
есть только `LICENSE` и `README.md`). Внутри untracked-дерева MW-003 создал и
изменил следующее:

| Категория | Файлы |
|---|---|
| Новые контракты | `packages/contracts/src/{ids,revisions,operation,events,authority,task,attempt,review,team}.ts` — 9 файлов, 980 строк |
| Новые переходы и guards | `packages/core/src/{errors,guards,authority,task,attempt,review,team}.ts` — 7 файлов, 1504 строки |
| Новые тесты | `tests/*.test.mjs` (8) + `tests/lib/fixtures.mjs` — 9 файлов, 1389 строк |
| Изменённые файлы MW-002 | `packages/contracts/src/index.ts` (+реэкспорты, актуализирован комментарий `AgentRuntimePort`), `packages/core/src/index.ts` (+реэкспорты, заголовок модуля), `packages/core/tsdown.config.ts` (+`deps.alwaysBundle`), `packages/contracts/package.json` и `packages/core/package.json` (описание), корневой `package.json` (+`scripts.test`, `check` включает тесты), `README.md` |

Объявления MW-002 (имена сервисов, `ClockPort`, `ControllerInfo`, `AgentRuntimePort`,
конфигурация, жизненный цикл, `systemClock`) сохранены дословно; изменения в
`index.ts` — только добавление реэкспортов. `packages/adapter-sdk`, `packages/controller/src`,
`scripts/`, `pnpm-lock.yaml` не менялись (mtime и `git status` это подтверждают).

---

## 4. Команды и exit codes

| Команда | Exit | Что доказывает |
|---|---|---|
| `pnpm --filter @dsh-mywork/contracts run typecheck` | 0 | `tsc --noEmit` по новым контрактам |
| `pnpm --filter @dsh-mywork/core run typecheck` | 0 | `tsc --noEmit` по доменным переходам |
| `pnpm run check` | 0 | typecheck + build + smoke (9 `ok`) + test (**62 pass / 0 fail**) |
| `pnpm run test` | 0 | `node --test --test-isolation=none "tests/**/*.test.mjs"` |
| `node --test "tests/**/*.test.mjs"` (без флага) | 1 | 8×`spawn EPERM`: обычная изоляция раннера недоступна в confined-шелле (§6.1) |
| mutation A: убрать `cancelled` из `TASK_TERMINAL_STATES` в собранном `core/lib/index.js` | 1 | падает тест «the terminal task states are exactly the architecture ones» — набор терминальных состояний закреплён |
| mutation B: убрать `completed` из `ATTEMPT_FENCE_CHECKED_STATES` | 1 | падает тест «a fence-checked transition without a fence token is a programming error» — набор fence-проверяемых состояний закреплён |
| mutation C: дописать внешний `import` в `core/lib/index.js` | 1 | падает тест «the built packages carry exactly the imports they are allowed to» — разбор импортов реально работает |
| mutation D (контрпример к разбору): шаблонная строка с `/*` + реальный `import "node:fs"` в `core/lib/index.js` | 1 | тот же тест падает — однопроходный разбор не даёт «фантомному» комментарию скрыть импорт |
| `node --test --test-isolation=none tests/boundaries.test.mjs` после восстановления сборки | 0 | мутации откатаны, дерево в исходном состоянии |

Промежуточная итерация этой сессии (лог не сохранялся, приводится как
наблюдение): первый прогон тестов дал 54 pass / 2 fail — ожидаемое число событий
во флоу (17, а не 15) и нижняя граница перебора матрицы attempt (94 запрещённых
пары, а не 100); обе проверки исправлены как ошибки теста, не реализации.

---

## 5. Evidence

### 5.1 Полный конвейер

```text
$ pnpm run check
ok   plugin module exposes the bundle entry shape
ok   mount publishes myworkController and freezes its snapshot
ok   unload removes the service and settles the controller
ok   diagnostics config writes one line per lifecycle transition
ok   configuration resolution accepts defaults and rejects malformed rows
ok   a malformed row config fails the plugin load loudly
ok   FakeClock advances, resolves, and cancels deterministically
ok   FakeAgentRuntime records runs and fails like the port contract
ok   adapter manifests validate before registration
smoke: all steps passed
ℹ tests 62
ℹ pass 62
ℹ fail 0
FINAL_CHECK_EXIT=0
```

### 5.2 Ключевые проверки приёмки (фрагменты)

```text
✔ a completed task admits no attempt (UNSCHEDULABLE)
✔ entering assigned is possible only by admitting an attempt
✔ ownership of an attempt is continuous within a task
✔ a stale expected revision wins over the admission guard
✔ every pair outside the transition table is refused with TASK_CONFLICT     (16×16, 11×11, 8×8, 7×7)
✔ a stale expected revision fails before the transition is evaluated        STALE_REVISION {expected, actual}
✔ a mismatched fence is a dedicated STALE_FENCE error                       STALE_FENCE {expected: 18, actual: 17}
✔ a superseded controller cannot mutate the attempt                         LEASE_LOST {expected: 2, actual: 3, to: 'settling'}
✔ a failover may take ownership away but not settle an old attempt          epoch 4: stale/revoked ok, settling → LEASE_LOST
✔ leasing requires the issuing controller to declare its epoch              TypeError без epoch, LEASE_LOST при расхождении
✔ a leased attempt cannot be moved by a caller that hides its controller epoch   TypeError
✔ a late result from a superseded attempt is refused                        §17: A1 fence=17 → stale, A2 fence=18
✔ a worker cannot approve its own attempt                                   SECURITY_DENIED
✔ an approval stops being valid once the head SHA or diff moves             STALE_REVISION
✔ a write by a non-owner is refused with SECURITY_DENIED                    §8 authority
✔ no domain source imports DSH, Beads, or a concrete memory backend
✔ the built packages carry exactly the imports they are allowed to          core/contracts: none, controller: @deepseek-ai/cordis
```

Про §17 честно: отказ позднему результату даёт терминальность состояния `stale`
(`TASK_CONFLICT`), а fence-проверка сравнивает токен вызывающего с fence **этой**
попытки. Fence уровня задачи (наибольший выданный токен) принадлежит lease store
(§8) и появится в MW-004/MW-010; это описано в §7.2 и в doc-комментарии
`packages/core/src/attempt.ts`.

### 5.3 Mutation-проверки (после исправлений ревью)

Три мутации вносились только в собранные артефакты и конфиг сборки, затем дерево
восстанавливалось пересборкой (`pnpm run build`) и повторным прогоном; команды и
результаты — в §4. Это прямая проверка того, что тесты не проходят при сломанной
реализации (замечания F1–F3 независимого ревью).

### 5.4 Сверка примеров API с реальным SDK

- Примеры §42 (`Result<T>` с `meta`), §43 (envelope), §35 (revision kinds), §8
  (матрица) перенесены как контракты; ни один из них не требует DSH-API.
- Порты (`AgentRuntimePort`, `ClockPort`) подтверждены MW-002 по реальному
  `vendor/cordis` и `docs/cordis-api/*`; MW-003 их не расширяет (§6.2.1).
- `node:test` доступен как stdlib; флаг `--test-isolation=none` проверен
  эмпирически на Node 24.19.0 в этой сессии (§4, §6.1).
- Сборка: tsdown инлайнит воркспейс-пакеты (проверено двумя сборками — с
  `deps.alwaysBundle` и без него `core/lib/index.js` не имеет внешних импортов);
  `alwaysBundle` оставлен как явная гарантия рядом с комментарием.

---

## 6. Ограничения и что осталось непроверенным

### 6.1 `node --test` без `--test-isolation=none` в confined-сессии падает (environmental)

Обычный режим поднимает по процессу-потомку на файл и получает `spawn EPERM` —
та же документированная граница sandbox-шелла, что у esbuild в `verify:profile`
(MW-002 §6.1/6.2, MW-001 §8.1). Штатная команда `pnpm run test` использует
`--test-isolation=none` (тесты в процессе раннера). Утверждение «вне sandbox
работает и обычный режим» в этом окружении проверить нечем — это ожидание, а не
измеренный факт.

### 6.2 Границы объёма (сознательно не сделано)

1. **Порты §36 не расширялись.** В `contracts` остались два порта MW-002
   (`ClockPort`, `AgentRuntimePort`). Adapter SDK, реестр, capability negotiation
   и контракт-чеки — предмет MW-005. Домен уже не зависит от интеграций:
   переходы чисты, взаимодействие идёт только через значения контрактов.
2. **Resolved revisions при admission.** Введены тип `FrozenRevisions` и
   валидатор `freezeRevisions`, но сопоставление Identity/Blueprint/Role →
   набор ревизий и его фиксация — MW-006.
3. **Хранилище и идемпотентность.** `OperationMeta` определён, но outbox/inbox,
   durability и дедупликация — MW-004; reconciler §9 — MW-011/MW-012.
4. **Fence уровня задачи.** Наибольший выданный для задачи токен хранит lease
   store (§8), которого ещё нет; до MW-004/MW-010 защита от позднего результата
   держится на переводе попытки в терминальное `stale` (§5.2, §7.2).
5. **Политики, требующие конфигурации.** «Worker cannot push protected branch»
   выражено данными (`RoleContract.prohibitedActions`) и не исполняется:
   enforcement прав — §31 и пункт 39 §62, отдельная задача безопасности.
6. **Доска не читалась и не менялась**; живой профиль DSH не затрагивался;
   платные пробы и другие модели не запускались.

### 6.3 Зависимость MW-002 не имеет независимого ревью

См. §1: работа продолжена по явному решению владельца из этой сессии. Если
ревьюер MW-002 найдёт дефект в каркасе (пакеты, сборка, публикационная форма),
это затронет и MW-003.

### 6.4 Иммутабельность вложенных значений — контрактная

`Object.freeze` применяется к верхнему уровню возвращаемых агрегатов;
`dependsOn`, `revisions`, `lease`, `worktree`, `artifact`, `findings` сохраняют
идентичность и в рантайме не заморожены. Это осознанное решение: домен не копирует
чужие структуры, а документация модулей прямо говорит, что вложенная
иммутабельность — контракт домена, а не гарантия рантайма.

---

## 7. Открытые решения (для ревьюера и владельца)

1. **Рёбра side-состояний §18.1.** Архитектура задаёт только главную линию;
   боковые переходы (`revoked` attempt → `ready`, reject → `changes-requested` →
   `ready`, `superseded` из состояний без активной попытки, `blocked` только до
   назначения попытки) выведены из §10.3, §17, §18.3 и собраны в одной таблице
   `TASK_TRANSITIONS` с обоснованием в комментарии.
2. **Два уровня fence.** Переходы проверяют epoch аренды (обязательно) и fence
   этой попытки; «текущий fence задачи» — данные lease store. Если требуется
   проверять предъявленный токен против текущего токена задачи уже в домене,
   это отдельное решение (потребует поля текущего fence у задачи или lease-записи).
3. **Правило epoch при failover контроллера (требует подтверждения владельца).**
   Свой epoch может двигать попытку по любому разрешённому ребру; строго более
   новый epoch может только отобрать владение (`stale`, `revoked`), но не
   завершить чужую попытку; более старый — ничего. Это выведено из §3 (controller
   lease/failover) и §17 (reassign после падения) и закрывает разрыв, найденный
   верификацией: без него новая эпоха не могла легально supersede-нуть попытку
   предыдущей. Если владелец предпочитает модель «supersession выполняет только
   издатель аренды», правило меняется в одном месте (`assertOwnershipEpoch`).
4. **Порядок проверок.** `expectedRevision` проверяется раньше состояния и
   владения (включая ранний отказ на `assigned`), поэтому устаревший вызывающий
   получает `STALE_REVISION` даже если переход в принципе запрещён; поздний
   результат уже `stale`-попытки получает `TASK_CONFLICT` (ребро), а не
   `STALE_FENCE`. Решение принято как более безопасное для оптимистичной блокировки.
5. **Терминальный статус `failed`.** `failed` — боковое состояние с ребром в
   `ready` (retry), а не терминальное: пункт 17 §62 требует «reject → new attempt».
6. **`details` в `MyWorkError`** — расширение сверх эскиза §42 (там только `code` и
   `message`); нужно для диагностики `{expected, actual, to}` у stale-ошибок.
7. **`occurredAt` в envelope — epoch ms** (согласовано с `ClockPort.now()`), а не
   ISO-строка из примера §43. Правка локализована в `events.ts`.
8. **`STALE_REVISION` для «артефакт уехал».** §42 определяет код как расхождение
   ревизии агрегата, а `assertReviewApprovalCurrent` использует его для смены
   `headSha`/`diffHash` (§19). Подходящего отдельного кода в §42 нет; если нужен
   свой код, это правка §42 и словаря ошибок.
9. **Словарь событий замкнут и расширяемый.** 6 generic-типов покрывают текущие
   переходы; audit-имена (§34: `attempt.revoked`, `review.approved`, …) выводятся
   из `*.state.changed` либо добавятся при MW-008 с расширением
   `MYWORK_EVENT_TYPES`.
10. **`retryable` сознательно не введён**: политика повторов — предмет
    планировщика (MW-010).
11. **`AgentIdentity.performanceRefs` / `experienceRefs`** — ссылки, а не записи:
    форму записей определят обучающие задачи (MW-032/33).
12. **Отмена выполняющейся задачи — через отзыв попытки.** `assigned`/`executing`
    не имеют ребра в `cancelled`: сначала `revoked` у попытки, затем `ready` →
    `cancelled`. Так задача не может остаться «отменённой с живой попыткой».
13. **`TASK_TRANSITIONS.ready` содержит `assigned`.** Таблица полная, поэтому
    `canTransitionTask('ready','assigned') === true` и `allowedTaskTransitions`
    рекламирует ребро, которое `transitionTask` отвергает. Потребителям
    (диагностика, UI) следует звать `admitAttempt`; это оговорено в doc-комментарии
    таблицы.

---

## 8. Независимое ревью и исправления

Ревью выполнено отдельным ревьюером-субагентом (собственный контекст, автор
изменений в нём не участвовал), по исходникам, с воспроизведением команд и
собственными mutation-экспериментами в `.tmp/`. Вердикт: **PASS WITH FINDINGS**
(все четыре критерия приёмки выполнены по исходникам; 15 замечаний).

Исправлено в этой карточке:

| # | Замечание | Что сделано |
|---|---|---|
| F1 (MAJOR) | Тест «self-contained bundle» не мог упасть: регулярка искала только одинарные кавычки | Разбор импортов переписан (снимаются комментарии и шаблонные строки, поддержаны оба вида кавычек и динамический импорт), добавлена защита от «пустого» совпадения и точное сравнение списка импортов `contracts`/`core`/`controller`; проверено мутацией (§4) |
| F2 | Набор fence-проверяемых состояний не закреплён | Явный `deepEqual` набора + кейс «`failed` без fence → `TypeError`»; проверено мутацией |
| F3 | Терминальные наборы Task/Attempt/Review не закреплены | Явные `deepEqual` трёх наборов + проверка согласованности «терминальное ⇒ нет исходящих рёбер»; проверено мутацией |
| F4 | `admitAttempt` не был единственным путём в `assigned` (терялось событие допуска) | `transitionTask` отказывает на целевом `assigned`; общий внутренний `applyTaskTransition`; тест на эксклюзивность |
| F5 | Привязку попытки можно было подменить, минуя `ready` | `resolveAttemptBinding`: смена попытки → `TASK_CONFLICT`, отсутствие id сохраняет текущую попытку; тест |
| F6 | Маскировка ошибок и область действия fence не описаны | Doc-комментарий `core/src/attempt.ts` переписан: два уровня проверки, роль `stale`, принадлежность «текущего fence» lease store; §5.2 и §7.2 отчёта уточнены |
| F7 | `LEASE_LOST` обходился необъявлением epoch | Для перехода leased-попытки epoch обязателен (`TypeError` без него), для `created → leased` — сверка, если epoch указан; тест |
| F8, F9 | Неверные коды изменений и счётчики строк в отчёте | §3 переписан по фактическому `git status`; числа строк пересчитаны |
| F10 | Тест конверта проверял собственный литерал | Добавлен рантайм-контракт `MYWORK_ENVELOPE_FIELDS`; тест сравнивает поля конверта с контрактом и покрывает `causationId` |
| F11, F12, F13, F14, F15 | Неоговорённый `STALE_REVISION` для артефакта, словарь событий, неточные ссылки на разделы, вложенная иммутабельность, устаревшие описания пакетов | Добавлены §7.7, §7.8, §6.4 и исправленные ссылки; обновлены `description` пакетов `contracts` и `core` |

Что ревью подтвердило как корректное: матрица §8 построчно, составы и терминальность
состояний, дискриминант и `meta` в `Result`, 13 кодов §42 без выдуманных, envelope
§43, `OperationMeta` §9, разделение Role Contract/Strategy §13.2, независимость
ревьюера и read-only ревьюера §13.2/§31, JSON-lossless события, отсутствие
импортов DSH/Beads/памяти и ветвлений по имени провайдера, соответствие объёма
карточке.

Не проверено ревьюером: независимая приёмка MW-002 (`verify:profile` и реальный
`dsh plugin add`), динамика §43/§35 (event bus, outbox, фиксация resolved
revisions — предмет MW-004/MW-006), API DSH/Cordis (вне объёма карточки),
процессные утверждения без артефактов в репозитории (§4 итерация, вопрос
владельцу, отсутствие `MW-002-review.md` подтверждено).

### 8.1 Повторная независимая верификация исправлений

Исправления проверены вторым независимым верификатором (отдельный контекст,
37 probe-проверок семантики, мутации в собранных артефактах с побайтовым
восстановлением). Вердикт: **FIXES VERIFIED** — все 15 замечаний подтверждены
(F1–F7, F10, F15, F8/F9 и F11–F14 — `VERIFIED`), регрессий нет
(`pnpm run check` → exit 0, 59 pass / 0 fail на тот момент, `git status`
идентичен исходному).

Верификатор нашёл четыре новых не-блокирующих дефекта; они исправлены в этой же
карточке:

| # | Дефект | Что сделано |
|---|---|---|
| N1 (MEDIUM) | Контроллер с более новым epoch не мог терминализировать чужую попытку: `stale`/`revoked` давали `LEASE_LOST`, то есть легального пути supersession после failover не было | Введено правило epoch в `assertOwnershipEpoch` и константа `ATTEMPT_OWNERSHIP_LOSS_STATES`: новый epoch может **только** отобрать владение (`stale`, `revoked`), завершить чужую попытку не может; тест «a failover may take ownership away but not settle an old attempt»; решение вынесено владельцу в §7.3 |
| N2 (LOW) | `created → leased` принимал аренду с произвольным epoch, если вызывающий не объявлял свой (асимметрия с F7) | Выпуск аренды требует `meta.controllerEpoch` (`TypeError` без него) и сверяет его с epoch аренды (`LEASE_LOST` при расхождении); тест «leasing requires the issuing controller to declare its epoch» |
| N3 (LOW) | Ранний отказ на `assigned` шёл до проверки ревизии, вопреки документированному порядку и §7.4 | `assertRevision` выполняется первым и в `transitionTask`; тест «a stale expected revision wins over the admission guard» |
| N4 (LOW) | Разбор импортов в `boundaries.test.mjs` снимал блочные комментарии раньше шаблонных строк, поэтому `/*` внутри шаблона открывал «фантомный» комментарий и мог скрыть реальный импорт (ложный PASS) | `scrub` переписан как однопроходный сканер (строки/шаблоны/комментарии обрабатываются в одном лево-правом проходе); проверено контрпримером верификатора — mutation D в §4 |

Верификатор также отметил две особенности без дефекта (перенесены в §7.12 и §7.13):
отмена выполняющейся задачи идёт через отзыв попытки и `ready`, а полная таблица
`TASK_TRANSITIONS` рекламирует ребро `ready → assigned`, которое `transitionTask`
отвергает по построению.

---

## 9. Как воспроизвести проверки

Работа завершена и закоммичена (§10); ниже — воспроизводимые проверки на этом дереве.

Фокус проверки:

1. Воспроизвести `pnpm install && pnpm run check` (ожидается exit 0: 9 `ok` в
   smoke и 62 pass / 0 fail в тестах).
2. Проверить полноту матрицы §8: 20 доменов, владельцы и `projection` — против
   таблицы архитектуры (тест `authority.test.mjs` транскрибирует §8).
3. Проверить, что таблицы переходов не шире архитектуры, что каждая пара вне
   таблицы отказывает и что исправления F4/F5/N1 (только допуск в `assigned`,
   непрерывность владения попыткой, правило epoch при failover) не сузили
   обязательные сценарии.
4. Проверить инвариант «терминальная Task не держит active Attempt» по коду
   (`core/src/task.ts`: `admitAttempt`, `assertTaskInvariants`,
   `resolveAttemptBinding`), а не по тестам.
5. Проверить, что домен не тянет интеграции: `boundaries.test.mjs` разбирает
   импорты и манифесты; независимо — `git grep -n "cordis\|beads\|hindsight" -- packages/contracts/src packages/core/src`.
6. Повторить mutation-проверки §5.3 (или свои) — тесты должны падать.
7. Оценить решения §7 (набор рёбер side-состояний, два уровня fence, порядок
   проверок) и ограничения §6.
8. Отдельно: оценить границы MW-002 (§6.3) — ревью каркаса независимым
   исполнителем всё ещё не выполнялось.

---

## 10. Коммиты

По отдельному поручению владельца («сделать коммиты») изменения закоммичены
локально: base `209a92d` → head `e8b3cc2`, 7 коммитов, разбитых по пакетам так,
чтобы историю можно было читать по слоям. Push, merge и release не выполнялись.

| SHA | Коммит | Содержимое |
|---|---|---|
| `869cfe1` | `chore(workspace): bootstrap the pnpm workspace, build, and check scripts` | корневые манифесты, `tsconfig.base.json`, `pnpm-lock.yaml`, `.gitignore`, `scripts/` |
| `28cbf2f` | `feat(contracts): add domain contracts, revisions, and the authority matrix` | `packages/contracts/**` (MW-002: имена сервисов и порты; MW-003: домен) |
| `a81c2cc` | `feat(core): add pure domain state machines and ownership guards` | `packages/core/**` |
| `64d89fa` | `test(domain): add the acceptance suite for transitions and boundaries` | `tests/**` |
| `55632ac` | `feat(adapter-sdk): add capability manifests, adapter errors, and fakes` | `packages/adapter-sdk/**` |
| `b299f41` | `feat(controller): add the Cordis plugin bundle` | `packages/controller/**` |
| `e8b3cc2` | `docs(readme): document the domain layer and the verification commands` | `README.md` |

Проверка после коммитов: `git status --short --untracked-files=all` пуст (53
записи рабочего дерева ушли в коммиты, `.work/`, `.tmp/`, `lib/`, `node_modules/`
остаются игнорируемыми), `git ls-files` = 54 файла, `pnpm run check` на
закоммиченном дереве → **exit 0** (smoke 9 `ok`, 62 pass / 0 fail).

Оговорка о гранулярности: MW-002 и MW-003 частично правили одни и те же файлы
(`packages/*/src/index.ts`, корневой `package.json`, `README.md`), а снимка
состояния MW-002 в Git не было, поэтому разделить историю на «сначала MW-002,
потом MW-003» без реконструкции невозможно. Коммиты сгруппированы по пакетам, и
принадлежность карточкам указана в теле каждого сообщения; промежуточные коммиты
1–2 ещё не собирают весь workspace (скрипты проверок ссылаются на все пакеты).
