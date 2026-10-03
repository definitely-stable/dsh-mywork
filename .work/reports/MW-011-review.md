# MW-011 — независимое ревью (review mode)

- Карточка: `.work/tasks/MW-011.md`, этап `01-runtime`, обязательный пункт §62 — 9
- Предмет: отчёт `.work/reports/MW-011-plan-mutations.md` (`READY_FOR_REVIEW`)
- Base SHA = HEAD на входе и на выходе ревью: `f22dbc3b2eb97601e09fc4f341bcddd522544545`; коммитов карточки нет
- Ревьюер: независимая сессия; репозиторий не изменялся (правки только в `.tmp/` + этот файл)
- Дата: 2026-09-19

---

## 1. ВЕРДИКТ

**FAIL** — ключевая заявленная способность планировщика (создать задачи и провести рёбра между новыми задачами, §5.1/ADR026) не работает end-to-end: `create[].dependsOnKeys` не материализуется, форма `addDependencies` между двумя новыми ключами коммитится с рёбрами на несуществующие id при `verified: true`, а повтор `apply()` после сбоя на создании дублирует задачу и коммитит успех. Все три воспроизведены собственным пробником на публичном API планировщика (не на тестах).

Числа отчёта при этом честные: `pnpm run check` = 339/316/0/23 (exit 0), узкий прогон = 40/0, файловый список и счётчики строк совпадают. Дефекты не в арифметике, а в том, что зелёная батарея не наблюдает свойства, которым карточка меряется.

---

## 2. ПРОВЕРЕНО

Выполнено **17 команд** (таблица в §8), из них 4 — собственные мутации собранного артефакта с восстановлением и пересборкой. Все exit codes зафиксированы. Собственные артефакты ревью, не входящие в поставку:

- `.tmp/mw011-review-probe.mjs` — пробник публичного API (6 сценариев), воспроизводит BLOCKER-1/2/3 и MAJOR-4/5
- `.tmp/mw011-review-mutations.ps1` — мои 4 мутации по `packages/planner/lib/index.js`
- `node .tmp/mw011-review-probe.mjs` → exit 0; `pwsh -NoProfile -File .tmp/mw011-review-mutations.ps1` → exit 0

---

## 3. FINDINGS

Шкала одна: BLOCKER / MAJOR / MINOR / NIT.

### BLOCKER-1 — intra-plan зависимости не материализуются: частичный DAG + состояние без операторского выхода

`packages/planner/src/service.ts:355` + `packages/core/src/plan.ts:589-590,694-699`

`planMutationParts` намеренно создаёт часть `edges` ради внутриплановых ключей (`core/plan.ts:589-590`), но журнал шагов (`planSteps`, `core/plan.ts:694-699`) заводит шаги только для `addDependencies`/`removeDependencies` — для `create[].dependsOnKeys` шага нет. `runParts` пропускает часть, у которой нет ни одного не-применённого шага (`service.ts:355: if (pending.length === 0) continue`), поэтому `materializePlanPart` (`service.ts:385`) для такой части не вызывается никогда, а create-часть уже ушла с срезанными ключами (`service.ts:362 create: missing.map(withoutPlanKeys)`).

Наблюдение (пробник, часть 2b, публичный `submit`):
```
parts from core            ["create","edges"]
journaled steps from core  ["create/create/key:root","create/create/key:child"]
submit ok?                 false      code PLAN_MUTATION_RECOVERY
graph call saw             [{"mode":"atomic","creates":["root","child"],"added":[],"removed":[]}]
edges in graph             []          integrity missing ["mw-2\u0000mw-1"]
admissionHeld              true        resume → PLAN_MUTATION_RECOVERY (без изменений)
revert                     TASK_CONFLICT (irreversible-steps) → admissionHeld всё ещё true
```
Почему важно: (1) частично видимый DAG — задачи созданы и в Beads они `open`, то есть в `ready`-проекции MyWork, а внутриплановое ребро отсутствует; (2) оператор не имеет выхода из `PLAN_MUTATION_RECOVERY`: `resume` вечно повторяет тот же провал (create-часть пропускается по `missing.length === 0`, части `edges` нет в журнале), `revert` отказывает из-за необратимых созданий — admission остаётся на паузе навсегда. Это нарушает приёмку 4 («частично невидимого DAG не возникает ни в одном сценарии») и §5.2 (три операторских действия обязаны доводить/откатывать).

Мутация-доказательство: REV-D1 (`if (pending.length === 0 && part.kind !== "edges") continue`) делает ровно этот путь успешным (пробник под мутацией: `submit ok? true`, `edges in graph ["mw-2->mw-1"]`, `admissionHeld false`) — и **не ловится ни одним из 40 тестов** (exit 0). То есть свойство не закреплено вообще.

Минимальная правка: в `runParts` пропускать часть `edges` не по журналу, а по материализованной команде (`materialized.command` с непустыми `add*`/`remove*` — выполнять всегда), плюс завести символьный шаг журнала на каждый внутриплановый ключ, чтобы журнал описывал то, что часть делает. Обязательный регрессионный тест: `submit` интента `create[].dependsOnKeys` → ребро между полученными id присутствует в графе.

### BLOCKER-2 — `addDependencies` между двумя НОВЫМИ ключами коммитится как рёбра на несуществующие id при `verified: true`

`packages/core/src/plan.ts:632-663` (`materializePlanPart` переписывает только `dependsOnKeys`) при `packages/core/src/plan.ts:283-288,512-518` (валидатор и классификатор такую форму разрешают и зовут additive)

Наблюдение (пробник, часть 5):
```
mutation class      "additive-only"
submit ok?          true
tasks created       ["mw-1","mw-2"]        created map {"root":"mw-1","child":"mw-2"}
edges in graph      ["child->root"]        integrity verified true
```
То есть одобренная L3 (ADR026: «ребро между двумя новыми задачами») мутация коммитится успешно, а граф получает ребро между литеральными строками `child`/`root` вместо `mw-2`→`mw-1`; верификация подтверждает это же самое, потому что сравнивает ту же строку. На строгом бэкенде (реальный `bd batch` с `dep add child root`) это вместо тихой порчи дало бы `PLAN_MUTATION_RECOVERY` с таким же вечным циклом, как в BLOCKER-1.

Почему важно: это ровно тот класс дефекта, ради которого написан ADR024, и он проходит при `verified: true` — «получить `applied` без верификации» здесь выглядит как «получить верификацию, которая подтверждает несуществующую сущность».

Минимальная правка: в `materializePlanPart` резолвить в id не только `create[].dependsOnKeys`, но и любые `addDependencies`/`removeDependencies`, у которых endpoint — ключ этой мутации (иначе — отказ `TASK_CONFLICT` до применения).

### BLOCKER-3 — повтор `apply()`/`submit()` после потерянного id создания дублирует задачу и коммитит успех

`packages/planner/src/service.ts:770-789` (`apply`/`submit` → `run` без проверки `unresolvedCreates`) против `service.ts:815-837` (в `resume` эта проверка есть)

Наблюдение (пробник, часть 4 — сбой между записью в граф и записью журнала, ровно окно ADR024):
```
first submit code                PLAN_MUTATION_RECOVERY     tasks ["mw-1"]   admissionHeld true
resume (операторский путь)       PLAN_MUTATION_RECOVERY     tasks ["mw-1"]   (отказ — правильно)
apply (retry-путь)               ok                         tasks ["mw-1","mw-2"]
created map after apply-retry    {"solo":"mw-2"}            admissionHeld false
```
`run` → `runParts` → create-ветка (`service.ts:357-364`) считает `missing` как «спеки без известного id» и создаёт их заново; единственная защита живёт в `resume`. `apply` и `submit` — публичные методы, принимающие состояние `recovery` (`UNSETTLED_STATES`, `service.ts:169`), а состояние задачи после сбоя неотличимо от «ничего не создано», потому что id в журнал не попал.

Почему важно: прямое нарушение приёмки 6 («повтор staged не дублирует задачи») и теста ADR024 «repeat staged does not duplicate tasks». Дубль при этом не виден верификации (она не проверяет количество созданных задач), операция коммитится, пауза снимается.

Минимальная правка: перенести проверку `unresolvedCreates` (и `unexpected`/`cycle`/`revision`) из `resume` в `run`/`apply`/`submit` — то есть в единый вход, оставив `resume` лишь формой с `adoptedCreated`.

### MAJOR-4 — `revert` снимает паузу admission и объявляет `reverted`, игнорируя собственный отчёт целостности

`packages/planner/src/service.ts:898-905`

`const report = await verifyInverse(...)` вычисляется, сохраняется — и его вердикт не проверяется: дальше безусловно `updateMutationState('reverted')` и `releaseAdmission(...)`. Сравнить с `run` (`service.ts:569-582`), где `!report.verified` → `enterRecovery` и пауза сохраняется.

Наблюдение (пробник, часть 3 — бэкенд отвечает успехом, не записав обратное ребро):
```
revert ok? true    state "reverted"
revert report verified false   missing ["D-1\u0000B-1"]
edges after revert []          admissionHeld after revert false
```
Почему важно: приёмка 9 требует «revert восстанавливает прежний набор зависимостей; ни один путь не оставляет частично видимого DAG». Здесь набор зависимостей не восстановлен, состояние объявлено откаченным, очередь возобновлена, и пути назад нет (`UNSETTLED_STATES` не содержит `reverted`). Отчёт целостности при этом сохраняется — то есть доказательство расхождения существует, но ни на что не влияет.

Минимальная правка: после `verifyInverse` — та же ветка, что в `run`: `if (!report.verified) → enterRecovery(...) + PLAN_MUTATION_RECOVERY`, пауза остаётся.

### MAJOR-5 — внешняя ссылка созданной задачи нигде не пишется в бэкенд: операторский резолв `unresolvedCreates` неисполним

`packages/planner/src/service.ts:360-364` (create-часть уходит без `externalRef`), `packages/core/src/plan.ts:691` (ссылка живёт только строкой `detail` в журнале), `packages/core/src/plan.ts:96-113` (`planExternalRef`/`parsePlanExternalRef` экспортированы, потребителей нет, кроме ре-экспорта в `core/src/index.ts`)

`createStaged` реального адаптера пишет `--external-ref`, только если поле пришло (`packages/beads-adapter/src/adapter.ts:974`), а planner его не выставляет. Единственная ссылка на созданную задачу — человекочитаемая строка в `plan_steps.detail`; в Beads такой ссылки нет, `bd list --external-ref` её не найдёт.

Почему важно: §5.2/приёмка 9 требуют операторского выхода после kill в середине применения. В окне «задача создана, id не зажурнален» единственный легальный путь — `resume(..., { adoptedCreated })`, и он требует, чтобы оператор **нашёл** задачу; тест так и пишет — `reason: 'found the task by its external ref'` (`tests/plan-mutation.test.mjs:1005`) — но тест берёт id из собственной in-memory карты фейка (`graph.tasks.keys()`), а не по ссылке. То есть тест подтверждает механизм, которого в реализации нет. Без ссылки оператор вынужден угадывать → риск дубля (§ BLOCKER-3) или вечная пауза.

Минимальная правка: в create-части (и в атомарной composite-части) проставлять `externalRef: planExternalRef(operationId, key)`; тест — что созданная задача находится по этому ref через порт.

### MINOR-6 — числа изменений файлов в отчёте не совпадают с `git diff --numstat`

`.work/reports/MW-011-plan-mutations.md:148,153,155`

| Отчёт | Факт (`git diff --numstat`) |
|---|---|
| `packages/beads-adapter/src/plan.ts  −34 +5` | `8 31` (то есть +8 −31) |
| `packages/core/src/index.ts  +32` | `31 1` (+31 −1) |
| `tests/evidence.test.mjs  ±6` | `4 2` (+4 −2) |

Остальные строки таблицы (artifact +7, audit +9, contracts/index +2, graph +55, lease +49, fixtures +4, lock +15) и все счётчики строк новых файлов (502/152/915/157/156/614/1120/70/87/1458) совпали точно. Почему важно: отчёт — evidence of record; строка «−34» для файла, про который сказано «поведение то же», читается как большее вмешательство, чем было. Правка: заменить три числа на вывод `git diff --numstat`.

### MINOR-7 — `PlanDecision.at` обязателен по типу, но не валидируется: вместо типизированного отказа — ошибка SQLite

`packages/planner/src/service.ts:613-623` (`requireDecision` проверяет только `decidedBy`/`reason`), `packages/planner/src/store.ts:247` (биндит `decision.at`)

JS-вызов `resume(id, { decidedBy: 'operator' })` даёт `TypeError: Provided value cannot be bound to SQLite parameter 3` из недр storage (воспроизведено случайно при первом прогоне пробника). Правка: проверять `Number.isSafeInteger(decision.at)` в `requireDecision` и падать `TypeError` с именем поля.

### MINOR-8 — `integrityReport()` на завершённой операции всегда возвращает `verified: false`

`packages/core/src/plan.ts:810-817` (`observedRevision === baseRevision`) + `packages/planner/src/service.ts:920-923` (пересчёт вместо сохранённого отчёта)

Наблюдение (пробник, часть 6): операция закоммичена (`commit-time verified true`), затем `integrityReport` → `verified false`, `baseRevision 0`, `observedRevision 1`, `missing []`. Причина — бамп plan-ревизии при commit. Почему важно: §5.2 даёт оператору кнопку «Открыть отчёт целостности»; на завершённой операции она скажет «не подтверждено» там, где всё в порядке (сохранённый в артефакте отчёт при этом верен). Правка: для settled-операций возвращать сохранённый `record.report`; ревизионное слагаемое применять только к незавершённым.

### MINOR-9 — метаданные помечены обратимыми, хотя откатить их нечем

`packages/core/src/plan.ts:700-712` (любой update → `reversible: true`), `:855-914` (инверсия даёт `setMetadata: {}`), `PlanTaskSnapshot` (`:59-64`) хранит только title/priority

`update: [{ id, setMetadata: {...} }]` проходит как обратимый шаг; `revert` вернёт title/priority и не вернёт metadata, но отчитается успехом. Исполнитель назвал ограничение порта («metadata-only не читается обратно»), но флаг `reversible` этого не отражает, а §5.2 читает именно флаг. Правка: помечать шаг, содержащий `setMetadata`, необратимым (или расширить snapshot и порт).

### NIT-10 — `plan.mutation.staged` не аудируется, хотя §5.9 его называет

`packages/contracts/src/audit.ts:53-58`; §5.9 v0.2 перечисляет «plan mutation staged/applied/recovered», ADR024 в migration impact называет события `plan.mutation.staged` и `admission.paused/resumed`. §5.18 (сводка контрактных добавлений) требует ровно три типа, и реализация ему соответствует; факт staged-операции не потерян (durable `plan_mutation` + `admission_hold`). Фиксирую как расхождение прозы §5.9/ADR024 с §5.18, а не как недоделку.

### NIT-11 — `retire`-шаг на resume переигрывает `transition` без проверки целевого состояния

`packages/planner/src/service.ts:421-436`: если процесс умер между `graph.transition` и `writeSteps`, шаг остаётся `pending`, и `resume` повторяет переход. Порт, который соблюдает таблицу переходов (как собственный фейк тестов, `canTransitionTask('ready','ready') === false`), вернёт `TASK_CONFLICT` → recovery → `revert` откажет (retire необратим) → тот же тупик, что в BLOCKER-1. Канонический адаптер таблицу не проверяет (`adapter.ts:536-571` — просто `bd update --status`), поэтому на реальном `bd` это, скорее всего, безвредно; живой `bd` вне объёма (§7 этого ревью), поэтому — NIT, а не MAJOR. Правка: пропускать шаг, если наблюдаемое состояние уже равно `retirement.to`.

### NIT-12 — «45 тестов» в §1 отчёта — это число прошедших, а не тестов

`.work/reports/MW-011-plan-mutations.md:17` говорит «45 тестов (23 skip)»; фактически `tests/beads-adapter.test.mjs` — 68 тестов, 45 pass, 23 skip (прогон в §8). В §4 отчёта та же цифра приведена корректно.

---

## 4. УГЛУБЛЁННЫЙ РАЗБОР `create[].dependsOnKeys`

### a) Верна ли находка MW-010? — ДА, подтверждена независимо

Staged-путь `@dsh-mywork/beads-adapter` действительно теряет внутриплановые зависимости:
- `packages/beads-adapter/src/plan.ts:138-172` (`toStagedMutationPlan`) строит `batch` только из `addDependencies`/`removeDependencies`/`update`; `command.create` не читается вообще;
- `packages/beads-adapter/src/adapter.ts:878-925` (`applyStaged`) применяет batch, metadata, затем `createStaged`; `createStaged` (`adapter.ts:965-995`) читает только title/description/priority/externalRef;
- `packages/beads-adapter/src/plan.ts:198-221` (`verifyStagedMutation`) сверяет только `addDependencies`/`removeDependencies` — отсутствие внутрипланового ребра для него невидимо;
- `canApplyAtomically` (`plan.ts:53-60`) возвращает `true` ровно для create-only, поэтому composite (`create` + `dep_remove`) гарантированно уходит в staged.

Моё воспроизведение (`.tmp/mw011-review-probe.mjs`, часть 1, на собранном пакете):
```
canApplyAtomically                 false
staged.batch                       ["dep remove A-1 B-1"]
batch mentions create?             false
serialized mentions dependsOnKeys? false
verifyStagedMutation(empty graph)  ACCEPTED — the missing intra-plan edge is invisible
canApplyAtomically(create-only)    true
graph plan deps of child           [{"target":"root","type":"blocks"}]
```
Формулировка отчёта §5.1 («идёт staged, сообщает успех — и ребра между новыми задачами в графе нет») точна, включая номера строк.

Почему тесты MW-010 зелёные: единственный тест, который реально прогоняет `dependsOnKeys` через порт, — `tests/beads-adapter.test.mjs:1139-1162`, и он идёт **атомарным** путём и помечен `{ skip: !HAS_BD }` (в этом окружении — один из 23 skip). Staged-тесты (`:451-524`, `:1164-1181`) не передают `create[]` вовсе. То есть комбинация «create с ключами + что-то ещё» не покрыта ничем — поэтому суита зелёная, а дефект живой.

### b) Корректен ли обход? — НЕТ, обход не работает на главном пути и остаётся обходимым

Что сделано верно: `planMutationParts` срезает ключи с create-части во всех ветвях, которые её строят (`core/plan.ts:553-557`, `:582`, и `service.ts:362` дополнительно), `materializePlanPart` (`core/plan.ts:632-663`) выпускает явные рёбра после получения id, `verifyPlanIntegrity` (`:766-774`) считает внутриплановые рёбра интентом независимо от того, какая часть их несла. Логика верная.

Что не работает:
- главный путь (create-часть + часть `edges` только из внутриплановых ключей) часть `edges` **пропускает** — BLOCKER-1; проверено и в прямую (пробник 2b: recovery, `missing` = ребро), и в обратную (мутация REV-D1 «выполнять часть edges всегда» делает путь успешным);
- при `requireAtomic: true` (create-only с ключами — валидатор это разрешает, `core/plan.ts:493` пропускает такой интент, тест `tests/plan-mutation.test.mjs:357-361` это подтверждает) `planMutationParts` возвращает одну create-часть (`core/plan.ts:571-573`), а `runParts` всё равно срезает ключи — части `edges` нет вообще. Пробник, часть 2a: `submit` → `PLAN_MUTATION_RECOVERY`, `edges []`, `admissionHeld true`, `resume` повторяет провал, `revert` отказывает;
- дефект MW-010 **остаётся достижимым через публичное API MW-011** — но не через планировщик, а в другую сторону: сам MW-011 добавляет две свои дыры (BLOCKER-2 и BLOCKER-3), а форма `addDependencies` между новыми ключами вообще не резолвится в id.

### c) Окно между частями — severity

Строго: в обходе создание идёт отдельной частью, и до выполнения части `edges` задачи уже существуют. В Beads они `open`, то есть попадают в `ready`-проекцию MyWork, а внутриплановых рёбер ещё нет.

- Как замысел (ADR024 шаг 3): окно осознанно объявлено ценой («Есть окно паузы — это осознанная цена за честность»), и admission на паузе, поэтому **ни один зависимый не стартует**. Сам факт окна приёмку 4 буквально не нарушает: критерий про старт и про частичную видимость в момент, когда операция доводима.
- Как реализация: окно **не закрывается никогда** — часть `edges` недостижима на этом пути (BLOCKER-1), операция навсегда в `PLAN_MUTATION_RECOVERY`, `resume` не доводит, `revert` отказывает из-за необратимых созданий. Это уже не «цена за честность», а частично видимый DAG без операторского выхода. **Severity: BLOCKER** (это и есть BLOCKER-1).

Минимальная правка (проверена мутацией REV-D1): выполнять часть `edges`, если её материализованная команда несёт рёбра, независимо от наличия шагов журнала; завести символьный шаг на каждый внутриплановый ключ; добавить тест «после `submit` ребро между созданными id присутствует, `verified === true`». После этого окно остаётся ровно тем, что описано в ADR024 (одна пауза, никогда не дольше операции), и не превращается в терминальное состояние.

### d) Достижимость для других карточек

MW-012/014/025/043/047 идут через `TaskGraphPort.mutatePlan` напрямую, минуя планировщик, — значит они упираются в дефект MW-010 (пункт a) в его исходном виде: composite с `create[].dependsOnKeys` + `dep_remove` вернёт `mode: 'staged'` и успех, потеряв рёбра между новыми задачами. Планировщик их не защищает: его обход — его собственный код, а не свойство адаптера.

Рекомендация владельцу, по приоритету:
1. **Чинить в MW-010** (лучший вариант). Объём — один метод: в `applyStaged` (`adapter.ts:878-925`) после `createStaged` выпустить внутриплановые рёбра из полученных id, и расширить `verifyStagedMutation` (`plan.ts:198-221`) их проверкой. ~15-20 строк + 1 тест. После этого снимается причина существования обхода в MW-011.
2. Если MW-010 заморожен — **отдельным пунктом + fail-closed**: адаптер должен **отказывать** staged-команде, несущей `create[].dependsOnKeys` (`PLAN_MUTATION_STAGED`/`TASK_CONFLICT`), чтобы ни один вызывающий не терял DAG молча. Тихая потеря DAG — ровно тот режим отказа, который ADR024 запрещает обещать.
3. «Оставить как есть» — не рекомендую: дефект не локален для планировщика и проявится на первой же карточке, которая делает composite с созданиями.

### e) Альтернатива: правка адаптера против обхода

Выбор «не менять чужой код» процедурно защитим — карточка прямо говорит «не меняй чужую незавершённую работу». Но контекст ослабляет защиту: MW-010 в этой же сессии переведён владельцем из `READY_FOR_REVIEW` в `DONE`, то есть на момент обхода это уже принятая зависимость, а не чужая незавершённая работа; и карточка разрешает задать владельцу короткий вопрос при неоднозначности.

Цена вариантов:
- **Правка адаптера:** ~15-20 строк в двух функциях + тест в чужой суите; риск — затронуть пакет, у которого своё ревью уже закрыто; выигрыш — дефект исчезает для всех вызывающих, а планировщику не нужен разрез «create / edges» и вся связанная машинерия.
- **Обход (сделан):** ~60 строк в `core/plan.ts` + ветка в `service.ts`, новый класс отказа (часть без шагов), и — как показало ревью — три собственных дефекта: BLOCKER-1 (обход не работает на главном пути), BLOCKER-2 (другая форма рёбер не резолвится) и BLOCKER-3 (retry дублирует создание, потому что обход изменил форму create-части). Плюс дефект MW-010 остаётся живым для остальных карточек.

Вывод: сам обход **дороже и надёжнее не оказался**. При повторном заходе правильный порядок — сначала правка адаптера (или явный fail-closed в нём), затем — при необходимости — снятие обхода из планировщика.

---

## 5. ЧТО ПРОВЕРЕНО И СОЧТЕНО КОРРЕКТНЫМ

1. **Воспроизводимость evidence отчёта.** `pnpm run check` → exit 0, `339 tests / 316 pass / 0 fail / 23 skip` — ровно как в §4/§10 отчёта. Узкий прогон `tests/plan-mutation.test.mjs` → exit 0, `40 pass / 0 fail`. `pnpm run typecheck` → exit 0. `pnpm run build` → exit 0.
2. **Список файлов.** `git status --short` совпадает с §6 отчёта: 10 изменённых путей + 6 новых путей карточки; посторонний `DSH-MyWork.rar` не закоммичен (`git log --all -- DSH-MyWork.rar` пуст). Ничего вне объявленного набора не тронуто.
3. **Счётчики строк** всех новых/изменённых файлов совпали с §3/§6 отчёта точно (502/152/915/157/156/614/1120/70/87/1458).
4. **`MYWORK_ERROR_CODES` не менялся**: каталог живёт в `packages/contracts/src/operation.ts:77+`, файл отсутствует в `git status` — то есть не изменён; все отказы карточки выражены существующими кодами.
5. **Пин audit-каталога не ослаблен**: `tests/evidence.test.mjs` — `assert.equal(contracts.AUDIT_EVENT_TYPES.length, 11 → 14)` остался, комментарий-страж «на пустом словаре цикл не проверял бы ничего» сохранён, цикл по-прежнему прогоняет все типы (проверено диffом: `+4 −2`).
6. **`pnpm-lock.yaml`** — `+15`, единственный импортёр `packages/planner`, как и заявлено.
7. **Приёмка 1 (cycles / stale / running).** По исходникам: `validatePlanMutation` (`core/plan.ts:385-550`) — порядок «пустая → scope planner → stale revision → running task → cycle → requireAtomic → неизвестный endpoint → неизвестный ключ»; `hasActiveAttempt` работает по каталогу `assigned|executing` (`contracts/src/task.ts:72`), каждая из четырёх policy (`RUNNING_TASK_POLICIES`) даёт типизированный `TASK_CONFLICT` с именем легального пути (`core/plan.ts:355-366`). Отдельные коды различимы: `ENTITY_CYCLE`, `STALE_REVISION`, `TASK_CONFLICT` (+reason), `PLANNER_SCOPE_DENIED`.
8. **Приёмка 2/3 для composite-пути.** `stage` пишет журнал и durable-паузу одной транзакцией до первого обращения к графу (`service.ts:741-760`), `run` снимает паузу только в `commit` после `verify` (`service.ts:569-582,492-503`), recovery сохраняет паузу (`enterRecovery`, `service.ts:313-342`). Воспроизведение механизма подтверждено: мой пробник 2c даёт `submit ok, edges ["mw-2->mw-1"], admissionHeld false` — обход для composite действительно работает, потому что там есть явный шаг `remove-edge`.
9. **Приёмка 5 (additive-only) по ADR026.** `classifyPlanMutation` (`core/plan.ts:271-295`): removal → `destructive`, retire в frozen → `destructive`, retire → `modifying`, update (в т.ч. priority) → `modifying`, нет созданий → `modifying`, ребро не между двумя созданными ключами → `modifying`, внутриплановый ключ вне созданий → `modifying`; `true` только для create / рёбер между новыми. Совпадает с ADR026 дословно, включая «отсутствие claims — отказ» как чужую половину предиката (её здесь и не должно быть).
10. **Приёмка 7 (отдельный путь принятия Proposal).** `propose` только пишет запись и не трогает граф (`service.ts:925-949`), `acceptProposal` требует решения и идёт через stage+apply; предложение с чужим/закрытым состоянием отвергается (тест «an accepted proposal is one operation, and a second decision on it is refused»).
11. **Приёмка 8 (гейт).** `core/blocker.ts` — чистая производная функция: гейт открыт ровно при frozen-блокере с неудовлетворённым зависимым, `done` гейта не даёт (`:58-90`), персистится только решение (`blocker_gate_decision`), `keep-blocking` оставляет гейт открытым с `awaitingDecision: false` и кладёт причину в audit + артефакт `gate-decision` (`service.ts:640-684`), `void`/`supersede-dependent` идут staged-операцией. Это ровно §5.5.
12. **Authority не переносится.** Plan-ревизия — агрегат MyWork (`commitPlanRevision` в commit, CAS в `run`/`revert`), у графа ревизии нет; `PLANNER_SCOPE_DENIED` держит §5.1; графу не отдаётся ни одного решения о безопасности плана.
13. **Staged не выдаётся за atomic.** Режим понижается по ответу бэкенда (`service.ts:365,388,409`), сохраняется в журнал (`saveMutationMode` в `commit`) и возвращается в исходе; `requireAtomic` при невыразимой атомарности даёт `PLAN_MUTATION_STAGED`, а не эмуляцию (`core/plan.ts:493-508`).
14. **`revert` честно отказывает** при необратимых шагах, перечисляя их (`service.ts:866-882`), и это соответствует §5.2 — но см. MAJOR-4 про отсутствие проверки вердикта при обратимой инверсии.
15. **Тесты не сплошь тавтологичны.** Моя контрольная мутация REV-B1 (снятие пре-проверки в `resume`) поймана (`1 fail`, тест «a create whose id was never journalled needs the operator to resolve it») — батарея имеет зубы там, где свойство заявлено. Kill-тест (`tests/plan-mutation.test.mjs:909-961`) — настоящая имитация окна ADR024: переоткрытие БД, проверка durable-паузы, отсутствие повторного создания, `verified true` у resume.
16. **Процессная честность.** Коммитов нет (HEAD = base SHA до и после), `.beads/` не тронут (mtime 18.09 19:55-21:41 против работы карточки 19.09 11:50-11:54, каталог исключён через `.git/info/exclude`), `DSH-MyWork.rar` не закоммичен, `pnpm-lock.yaml` изменён только импортёром planner. Живой профиль DSH и доска мной не читались и не трогались (см. §7).

---

## 6. НЕВОСПРОИЗВОДИМЫЕ УТВЕРЖДЕНИЯ ОТЧЁТА

1. **§6, три строки чисел** — `−34 +5` / `+32` / `±6` против `8 31` / `31 1` / `4 2` в `git diff --numstat` (MINOR-6). Все остальные числа отчёта воспроизвелись.
2. **§5.3, «ни один путь не оставляет частичного DAG без записи»** — опровергнуто: пробники 2b/2a/4 дают созданные задачи без внутриплановых рёбер (и, в случае 4, дубль) при `PLAN_MUTATION_RECOVERY`/успехе. Утверждение верно только для composite-пути с явными рёбрами.
3. **§5.2, строка M9** — «внутриплановые рёбра не материализуются» действительно ловится, но только если ломать чистую функцию ядра (тест «the parts split creations from edges…», `tests/plan-mutation.test.mjs:436-462`, зовёт `materializePlanPart` напрямую). Тот же разрыв **в использовании** этой функции планировщиком (моя мутация REV-C1: `const command = part.command`) не ловится ничем: `40 pass / 0 fail`. То есть заявление «тесты это ловят» верно для ядра и неверно для интеграции.
4. **§5.2, полная батарея 10/10** — не перепроверялась целиком (вне бюджета ревью): я прогнал 4 свои мутации (1 поймана, 3 нет). Это не опровержение, а граница проверки.
5. **§5.1, «Планировщик снимает `dependsOnKeys` с create-части и после получения id выпускает их явными рёбрами»** — верно про намерение кода, но неверно про поведение: на пути, где единственные рёбра — внутриплановые, часть `edges` не выполняется (BLOCKER-1), и рёбра не выпускаются.
6. **§5.3, «создание без id не переигрывается»** — верно для `resume`, неверно для `apply`/`submit` (BLOCKER-3).

---

## 7. ЧТО ОСТАЛОСЬ НЕПРОВЕРЕННЫМ И ПОЧЕМУ

1. **Живой `bd`** — вне объёма по заданию (нужен отдельный воркспейс). Следствие: поведение BLOCKER-2 на строгом бэкенде предсказано по коду (`bd batch` с `dep add child root` отвергнет неизвестный id → recovery), но не наблюдалось; NIT-11 по той же причине оставлен NIT.
2. **Полная mutation-батарея исполнителя (10 мутаций, ~10 минут)** — заменена 4 собственными, нацеленными на найденные риски; остальные 9 заявлений §5.2 я не воспроизводил.
3. **`pnpm run verify:profile` и `pnpm run pack:local`** — вне объёма (публикационный путь).
4. **Живой профиль DSH (`~/.dsh`) и доска разработки** — не читались и не трогались по ограничениям ревью; «не тронуто» в §5.16 подтверждается только отсутствием посторонних путей в `git status` и временами `.beads/`, а не прямым осмотром `~/.dsh`.
5. **MQTT/гонка двух процессов на одной SQLite** — не воспроизводилась (свойство storage, §47), как и указано в отчёте.
6. **`tests/plan-mutation.test.mjs` (1458 строк) прочитан выборочно** — секции A–C и все тесты, релевантные найденным дефектам; секции о гейтах и предложениях просмотрены по именам и по ключевым утверждениям, не построчно.

---

## 8. ПРОВЕРЕННЫЕ КОМАНДЫ

| Команда | Exit | Наблюдение |
|---|---|---|
| `git rev-parse HEAD` | 0 | `f22dbc3b2eb97601e09fc4f341bcddd522544545` — совпадает с base SHA отчёта, до и после ревью |
| `git status --short` | 0 | 10 M + 7 `??` = 6 путей карточки + `DSH-MyWork.rar`; совпадает с §6 отчёта |
| `pnpm run check` | 0 | `339 tests / 316 pass / 0 fail / 23 skip` — числа отчёта воспроизведены |
| `node --test --test-isolation=none tests/plan-mutation.test.mjs` | 0 | `40 pass / 0 fail`, 1024 мс — совпадает |
| `node --test --test-isolation=none tests/beads-adapter.test.mjs` | 0 | 68 tests, `45 pass / 0 fail / 23 skip` (в §1 отчёта 45 названо числом тестов — NIT-12) |
| `pnpm run typecheck` | 0 | все пакеты, включая новый `planner` |
| `pnpm run build` | 0 | после восстановления мутированного артефакта |
| `git diff --numstat` | 0 | 10 файлов; расхождения с §6 отчёта по 3 строкам — MINOR-6 |
| `git diff -- packages/beads-adapter/src/plan.ts` | 0 | только делегирование `detectCycle` → `core.findDependencyCycle`, сигнатура и `CycleCheck` те же |
| `git diff -- pnpm-lock.yaml` | 0 | `+15`, единственный импортёр `packages/planner` |
| `git diff -- tests/evidence.test.mjs` | 0 | пин 11 → 14 с сохранённым стражем невакуумности |
| `node -e "... canTransitionTask ..."` | 0 | `ready→ready = false`, `blocked→ready = true` — основание для NIT-11 |
| `node .tmp/mw011-review-probe.mjs` | 0 | 6 сценариев; BLOCKER-1/2/3, MAJOR-4, MINOR-8 воспроизведены на собранных пакетах |
| `pwsh -NoProfile -File .tmp/mw011-review-mutations.ps1` | 0 | REV-B1 поймана (39/1); REV-A1, REV-C1, REV-D1 — `40 pass / 0 fail`; SHA-256 артефакта восстановлен бит-в-бит |
| `pnpm run check` (финальный, после restore+rebuild) | 0 | `339 / 316 / 0 / 23` — дерево зелёное |
| `git status --short` (после ревью) | 0 | тот же набор; посторонних файлов ревью в репозитории нет |
| `git log --oneline --all -- DSH-MyWork.rar` | 0 | пусто — архив никогда не коммитился |

---

## Приложение A. Окна отказа (по коду)

Разбор точек, где процесс может умереть между записью в граф и записью журнала. Граф — Beads, журнал — `plan_mutation`/`plan_mutation_step`/`plan_mutation.created` в MyWork DB; общей транзакции нет (§9).

| № | Окно | Что на диске | Стартует ли зависимый | `resume` | `revert` | Дубликат |
|---|---|---|---|---|---|---|
| A1 | до первого обращения к графу (после `stage`) | журнал `staged` + durable-пауза, граф чист | нет | verifies → применяет всё заново | инверсии нет (`parts` пуст) → «успех» без изменений, пауза снята | нет |
| A2 | внутри create-части, между созданием k-й и (k+1)-й задачи (`createStaged`, `adapter.ts:970-993`) | часть задач создана, `created` в журнале пуст/частичен | нет (пауза) | отказ `unresolvedCreates` — правильно | отказ (create необратим) | **да, через `apply()`/`submit()` — BLOCKER-3**; через `resume` — нет |
| A3 | между возвратом create-части и `saveMutationCreated` (`service.ts:378-381`) | то же, что A2 | нет | то же | то же | то же |
| A4 | после части `edges`, до `writeSteps` (`service.ts:389-397`) | рёбра в графе, шаги `pending` | нет | переигрывает ту же команду (идемпотентно для add/remove) → сходится | инверсия по `applied`-шагам может не увидеть незажурналенное ребро (журнал — единственный источник), верификация инверсии этого не ловит | нет |
| A5 | внутри части `edges`, если её единственное содержимое — внутриплановые ключи | задач созданы, рёбер нет, шагов для части нет | нет | **вечный провал (BLOCKER-1)** | отказ (создания) | нет |
| A6 | после части `fields`, до `writeSteps` (`service.ts:415-416`) | поля записаны, шаг `pending` | нет | переигрывает update; шаг помечается `applied` по ответу бэкенда (metadata не читается — MINOR-9) | инверсия восстановит title/priority; metadata — нет | нет |
| A7 | внутри `retire`-части, после `transition` до `writeSteps` (`service.ts:421-437`) | состояние задачи изменено, шаг `pending` | нет | переигрывает `transition`; на порту, соблюдающем таблицу переходов, — `TASK_CONFLICT` → тупик (NIT-11); на реальном адаптере, вероятно, no-op | отказ (retire необратим) | нет |
| A8 | между `verify` (успех) и `commit` (`service.ts:569-582`) | все части в графе, журнал полный, пауза стоит | нет | verifies → `commit` | применим (если все шаги обратимы) | нет |
| A9 | внутри `commit` (одна транзакция: state, revision, артефакт, audit, outbox) | всё или ничего (SQLite-транзакция) | нет | replay по записанному исходу | отказ (`applied` вне `UNSETTLED_STATES`) | нет |
| A10 | после `releaseAdmission` в `commit` | операция `applied`, пауза снята | да (штатно) | replay | — | нет |
| A11 | в `revert`, после применения инверсии, до её проверки | граф частично восстановлен | пауза ещё стоит | `resume` доведёт (или откажет по `unexpected`/`cycle`) | — | нет |
| A12 | в `revert`, **после** `verifyInverse` с `verified: false` | граф не восстановлен, пауза **снята**, операция `reverted` | да — очередь возобновлена на неверном графе | невозможен (`reverted` вне `UNSETTLED_STATES`) | невозможен | нет (MAJOR-4) |

A12 — единственное окно, где пауза снимается без подтверждённой целостности; A11/A12 различаются ровно одной отсутствующей веткой (`if (!report.verified)`).
