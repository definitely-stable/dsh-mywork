# MW-011 — Валидировать Plan Mutation, staged activation и replanning

- Предмет: карточка `.work/tasks/MW-011.md`, этап `01-runtime`, обязательный пункт §62 — 9 (Task Setter)
- Исполнитель: сессия DSH Web, модель `opencode-go/deepseek-v4.1-flash`
- Репозиторий: `H:\Repo\DSH-MyWork`
  - base SHA: `f22dbc3b2eb97601e09fc4f341bcddd522544545` (HEAD, ветка `main`) — тот же на старте и после всех трёх независимых проходов; коммитов этой карточки нет
  - дерево: 12 изменённых и 6 новых путей карточки; посторонний `DSH-MyWork.rar` не тронут
- Окружение: Node `v24.19.0`, pnpm `12.4.2`, Windows, pwsh; живой `bd` для этой карточки не требовался (см. §8)
- Статус: **DONE** — статус переведён из `READY_FOR_REVIEW` в `DONE` по прямому указанию владельца (сессия MW-020, «поменять все карточки с подобной оговоркой»). Акт приёмки — это указание владельца, а не вывод автора. Шесть независимых проходов: ревью (**FAIL**, 12 findings), верификация исправлений (6), дельта-верификация D-1…D-8 (6), четвёртая дельта N-1…N-6 (6), пятый проход двумя агентами — дельта N-1…N-6 (**FIXES PARTIALLY VERIFIED**) и адверсариальный фальсификатор (**13 findings: 2 BLOCKER, 7 MAJOR, 3 MINOR, 1 NIT**). Закрыто 11 из 13 находок фальсификатора (оба BLOCKER'а, четыре MAJOR и четыре MINOR/NIT), каждая — тестом, наблюдавшимся падающим до правки, либо ломающей мутацией (§3.6). **Открытыми остались — и приёмка их не закрывает:** MINOR-12 (пауза admission в общем `lease` — снятие по слову вызывающего), остаток MINOR-10 (ребро между двумя существующими задачами: журнал не хранит «до», §9) и §9 п. 4 (тупик принятых id без чтения `externalRef`).
  - `pnpm run check` = exit 0: **370 tests / 347 pass / 0 fail / 23 skip** (23 skip — живой `bd`, как в baseline);
  - узкий прогон `tests/plan-mutation.test.mjs` = **71 pass / 0 fail** (60 до пятого прохода + 11 регрессионных на исправления);
  - mutation-батарея §6.2 = **23/23 CAUGHT** на 71-тестовой суите (`pass+fail=71` в каждой строке), включая три новые строки M20a/M20b/M20c на находки фальсификатора.

## 0. Как читать этот отчёт

Карточка прошла **шесть независимых проходов** другими сессиями: ревью (12 findings), верификация исправлений (NEW-1…NEW-6), дельта-верификация D-1…D-8, четвёртая дельта N-1…N-6, пятая дельта N-1…N-6 и адверсариальный фальсификатор (13 findings, пятый проход двумя агентами). Каждый находил дефекты, которых не видел зелёный конвейер, — в том числе внесённые предыдущими исправлениями. Поэтому §3 перечисляет все проходы, и по каждому: что было не так, чем исправлено, какой тест это теперь держит. Утверждения, которые проходы опровергли, в тексте исправлены, а не переписаны молча; числа — из финального прогона (§5, §7).

Пятый проход стоит отметить отдельно: он **опроверг два свойства, заявленных в §6.3** — «`revert` без подтверждённой инверсии не снимает паузу» и «ни один путь не оставляет частично видимого DAG». Формулировки исправлены в §6.3, а не оставлены рядом с зелёными числами.


Шесть проходов стоили больше, чем планировалось, и это стоит сказать прямо: **первая версия проходила 40/40 тестов и не работала** на главном сценарии карточки, а адверсариальный проход сломал ещё и два свойства, которые предыдущие проходы считали доказанными. Полезный итог не в том, что дефекты нашлись, а в том, что сквозные свойства (создать задачи и связать их рёбрами; не дублировать при повторе; не снимать паузу без подтверждённой целостности; не терять id созданных задач; не выпускать зависимую задачу, которую держит второй блокер) проверяются через публичный API и падают от мутаций, возвращающих каждый найденный дефект.

---

## 1. Проверка зависимости

| Зависимость | Как проверено | Результат |
|---|---|---|
| **MW-010** (Beads TaskGraph adapter) | отчёт `.work/reports/MW-010-beads-adapter.md` (**DONE** — статус переведён из `READY_FOR_REVIEW` по решению владельца); исходники `packages/contracts/src/taskgraph.ts`, `packages/beads-adapter/src/*`, `tests/beads-adapter.test.mjs`; **живой прогон** `pnpm run check` на baseline = exit 0, 299 tests / 276 pass / 0 fail / 23 skip | предусловие пройдено |
| Независимая проверка той же зависимости ревьюером | подтвердил staged-дефект MW-010 собственным пробником (§6.1) и объяснил, почему суита MW-010 остаётся зелёной | подтверждено |

## 2. Решения владельца, принятые в этой сессии

| Вопрос | Решение | Как отражено |
|---|---|---|
| Гейт MW-010 | «забей на оговорку, исправь ready for review — ревью был уже» | `.work/reports/MW-010-beads-adapter.md`: `READY_FOR_REVIEW` → `DONE` + примечание; содержательная часть чужого отчёта не переписана |
| Running task policy | отказ с именем легального пути | все четыре §10.3 policy при касании задачи с активной попыткой дают типизированный отказ, называющий легальную команду; взаимодействия с attempt/lease нет (MW-012) |
| Additive-only | строго ADR026 | ребро additive только между двумя задачами этой же мутации; ребро к существующей задаче = `modifying` |

## 3. Независимые проходы и исправления

### 3.1 Ревью: FAIL (12 findings)

Отдельный субагент, read-only; полный текст — `.work/reports/MW-011-review.md`.

**Вердикт: FAIL.** «Ключевая заявленная способность планировщика (создать задачи и провести рёбра между новыми задачами, §5.1/ADR026) не работает end-to-end… Числа отчёта при этом честные — дефекты не в арифметике, а в том, что зелёная батарея не наблюдает свойства, которыми карточка меряется».

| # | Severity | Что было не так | Исправление | Тест, который теперь это держит |
|---|---|---|---|---|
| BLOCKER-1 | BLOCKER | `planSteps` не заводил шаг на `create[].dependsOnKeys`, поэтому часть `edges` (созданная ради них) не имела pending-шагов и `runParts` её пропускал: задачи создавались, внутриплановые рёбра — нет, операция оставалась в `PLAN_MUTATION_RECOVERY` навсегда (`resume` повторял провал, `revert` отказывал) | журнал заводит по шагу на каждый внутриплановый ключ (`core/plan.ts:797-880`), а сама часть выбирается по **материализованной команде** (`service.ts:477-500`) | «a plan of new tasks with intra-plan dependencies wires them between the created ids» |
| BLOCKER-2 | BLOCKER | `addDependencies` между двумя **новыми** ключами (ровно аддитивная форма ADR026) не резолвился в id: коммит `ok` с рёбрами на литеральные ключи при `verified: true` | общий резолвер `resolvePlanEdges` (`core/plan.ts:139-176`) применяется и при применении, и при верификации; неразрешимый ключ — ошибка, а не запись | «an edge between two created tasks given as addDependencies is resolved to their ids» |
| BLOCKER-3 | BLOCKER | `unresolvedCreates` проверялся только в `resume`; `apply()`/`submit()` после сбоя между записью в граф и журналом переигрывали create-часть → дубликат задачи и коммит успеха | единый pre-flight в `run` (`service.ts:648-700`), через который идут все входы; `resume` остаётся формой с `adoptedCreated` | «a retry through apply does not create a task whose id was never journalled» |
| MAJOR-4 | MAJOR | `revert` сохранял отчёт инверсии, но не проверял его: при `verified: false` объявлял `reverted` и **снимал паузу** | ветка `if (!report.verified)` как в `run` (`service.ts:1105-1125`): `enterRecovery` + `PLAN_MUTATION_RECOVERY`, пауза остаётся | «a revert that did not restore the graph keeps the pause and stays in recovery» |
| MAJOR-5 | MAJOR | `planExternalRef` нигде не писался в бэкенд — операторский резолв `unresolvedCreates` был неисполним, а тест брал id из своей же in-memory карты | создаваемая задача получает `externalRef = mw-plan:<operationId>:<key>` в **обеих** ветвях: атомарная — `ensureExternalRef` (`core/plan.ts:751-756`, вызов `:698`), staged — `prepareCreateSpec` (`core/plan.ts:665-674`, вызов `:711`) | «a created task carries the reference an operator would search for» |
| MINOR-6 | MINOR | три числа изменений файлов расходились с `git diff --numstat` | заменены на фактический numstat (§7) | — |
| MINOR-7 | MINOR | `PlanDecision.at` не валидировался → ошибка биндинга SQLite вместо типизированного отказа | `requireDecision` проверяет `Number.isSafeInteger(at)` (`service.ts:723-740`) | «a decision without a clock reading is refused as a programming error» |
| MINOR-8 | MINOR | `integrityReport()` на завершённой операции всегда `verified: false` | settled-операция отвечает сохранённым отчётом (`service.ts:1152-1170`); у верификации появился `expectedRevision` (`core/plan.ts:896`) | «the integrity report of a committed operation is the one that admitted it» |
| MINOR-9 | MINOR | шаг с `setMetadata` помечался обратимым, хотя metadata не читается через порт | такой шаг журналируется `reversible: false` с причиной (`core/plan.ts:855-875`) | «a metadata update is journalled as irreversible, and revert names it» |
| NIT-10 | NIT | не было событий `plan.mutation.staged` и `admission.paused/resumed`, названных ADR024 | три типа в каталоге (`contracts/src/events.ts`), пишутся в тех же транзакциях (`service.ts:870-895`, `:560-575`, `:1127-1140`) | «staging pauses admission and resuming it are both journalled as events» |
| NIT-11 | NIT | `retire`-шаг на `resume` переигрывал `transition` без проверки состояния | шаг пропускается, если наблюдаемое состояние уже равно целевому (`service.ts:505-530`) | «a retirement that landed before the journal did is not replayed» |
| NIT-12 | NIT | «45 тестов» в §1 было числом прошедших | формулировка исправлена (68 tests / 45 pass / 23 skip) | — |

### 3.2 Верификация исправлений: FIXES PARTIALLY VERIFIED (NEW-1…NEW-6)

Полный текст — `.work/reports/MW-011-fixes-verification.md`. Все 12 находок признаны исправленными (шесть подтверждены независимыми ломающими мутациями), но проход нашёл два дефекта, внесённых исправлениями BLOCKER-1/2, и один ранее существовавший, ставший весомым из-за нового guard'а.

| # | Severity | Что было не так | Исправление | Тест |
|---|---|---|---|---|
| NEW-1 | MINOR | шаг явного `addDependencies` между созданными ключами журналировался `failed`, хотя ребро легло (ссылка шага — литеральные ключи, отметка резолвила только префикс `key:`); инверсия выпустила бы литеральные ключи | `planEdgeRef` (`core/plan.ts:779-788`) пишет endpoint-ключи как `key:<имя>`; `invertPlanSteps(steps, meta, baseRevision, created)` (`core/plan.ts:1064-1140`) резолвит ссылки, неразрешимая становится необратимой | «the journal of an edge between created tasks names ids, and its inverse restores them» |
| NEW-2 | NIT | на пути `requireAtomic && isAtomicComposite` шаги внутриплановых рёбер оставались `pending` после коммита | `markEdgeSteps` (`service.ts:394-412`) вызывается и после composite-создания | «a composite call marks its intra-plan edge steps as applied» |
| NEW-3 | MAJOR | каждый бандл несёт свою копию `MyWorkError` (`alwaysBundle`), поэтому `instanceof`-проверка не узнавала отказ порта: `CAPABILITY_UNSUPPORTED` подменялся на `PLAN_MUTATION_RECOVERY` | структурная проверка по `code` (`PRE_WRITE_CODES`/`refusalShape`, `service.ts:180-240`); guard-коды возвращаются как есть, `TASK_CONFLICT` из середины операции остаётся recovery | «a guarded refusal raised by another bundle is reported as itself» + «a conflict from the middle of an operation stays a recovery…» |
| NEW-4 | MINOR | якорь `service.ts:3186` в отчёте не существовал (строка собранного бандла) | заменён на реальный | — |
| NEW-5 | NIT | `src/service.ts (~1290)` против фактических строк | число исправлено | — |
| NEW-6 | NIT | комментарий в батарее называл M11a «EQUIVALENT», тогда как измерено CAUGHT | комментарий исправлен; M14 переименована по фактической зоне поражения | — |

### 3.3 Дельта-верификация: FIXES PARTIALLY VERIFIED (D-1…D-7)

Полный текст — `.work/reports/MW-011-delta-verification.md`. NEW-1/NEW-2/NEW-3 подтверждены (каждая — своей ломающей мутацией верификатора), отчётные NEW-4/5/6 закрыты, но дельта внесла новый дефект.

| # | Severity | Что было не так | Исправление | Тест |
|---|---|---|---|---|
| D-1 | MINOR | чтение `graph.dependencies()`, добавленное исправлением NEW-2, стояло между записью создания в граф и записью `created` в журнал: отказ чтения терял id созданных задач (выход только операторским `adoptedCreated`) | id становятся долговечными **до** любого следующего чтения (`service.ts:455-475`), пометка шагов — после | «the ids of created tasks are durable before anything else is read» |
| D-2 | MINOR | новый counter-case тест NEW-3 не наблюдал свой guard: заглушка бросала только при `removeDependencies.length > 0`, а интент был без рёбер — `PLAN_MUTATION_RECOVERY` приходил из ветки провала верификации, а не из catch | заглушка бросает всегда (`tests/plan-mutation.test.mjs`) | «a conflict from the middle of an operation stays a recovery, not a pre-write refusal» (+ M19) |
| D-3 | MINOR | якоря `core/plan.ts:800-812` и `service.ts:375-395` не содержали названного кода | заменены на фактические (§3.1, §3.2) | — |
| D-4 | NIT | неточные диапазоны в §3.2 | заменены на фактические | — |
| D-5 | NIT (было до дельты) | `resume` с `adoptedCreated` коммитил операцию, у которой **все** шаги `pending` | при известных id шаги создания помечаются `applied` (`service.ts:420-440`) | расширение теста «a create whose id was never journalled…» |
| D-6 | NIT | мутация M14 заменяла **все** вхождения одного и того же guard'а (run и revert), а §6.2 приписывала падение только revert-тесту | ярлык и комментарий называют зону поражения; добавлен тест на ветку `run` (см. ниже), теперь M14 ловят два теста | «a port that reports success without writing the edge goes to recovery, not to success» |
| D-7 | NIT | ребро, названное и в `dependsOnKeys`, и в `addDependencies`, давало два шага и дублирующий inverse-remove | `pushEdge` дедуплицирует по ссылке (`core/plan.ts:797-830`), `invertPlanSteps` дедуплицирует пары (`core/plan.ts:1076-1080`) | «an edge named twice is one journal step and one inverse command» |
| D-8 | NIT (замечено верификатором попутно) | отказ порта внутри `observe`/`stage` и в чтениях верификации выходил из `submit`/`revert` сырым исключением, хотя метод обещает `Result` | чтения графа обёрнуты: pre-flight в `run` (обёртка `service.ts:779`) отказывает **до** claim'а, поэтому операция остаётся `staged` с открытой паузой, а три чтения после первой записи (`run`: `:848`, `:872`; `revert`: `:1356`, `:1369`) уходят в `recovery` | «a port that refuses during staging answers with a typed failure, not an exception» |

**Побочный результат D-6.** Разбирая зону поражения мутации, я обнаружил настоящую дыру покрытия: ветка `run` «верификация не подтвердила план» не проверялась **ни одним** тестом — то есть случай, ради которого написан ADR024 (бэкенд ответил успехом, а ребро не легло), не наблюдался. Добавлен тест «a port that reports success without writing the edge goes to recovery, not to success»; мутация M14 теперь ловят два теста.

### 3.4 Четвёртая дельта-верификация: FIXES PARTIALLY VERIFIED (N-1…N-6)

Полный текст — `.work/reports/MW-011-delta-verification-2.md`. Семь из восьми пунктов дельты подтверждены (каждый — своей ломающей мутацией верификатора: D-1, D-2, D-3, D-4, D-6, D-7, D-8), D-5 — наполовину.

| # | Severity | Что было не так | Исправление | Тест |
|---|---|---|---|---|
| N-1 | MINOR | ветка «id уже известны» помечала `applied` только шаги создания и выходила: у операции с `verified: true` шаг внутрипланового ребра оставался `pending` (composite-часть помечает его только на пути «создавали сейчас») | общий `markCompositeEdges` (`service.ts:415-430`) вызывается в обеих ветках — и после composite-создания, и при уже известных id | «a composite create whose ids are adopted still gets its edge steps marked» |
| N-2 | MINOR | принятый оператором id не проверялся ничем: чужой или несуществующий id принимался, операция коммитилась `verified: true`, шаг помечался `applied` | `resume` проверяет принятые id через порт (существование и принадлежность ключу мутации), отвергнутые перечисляет в `rejectedAdoptions` и оставляет неразрешёнными (`service.ts:1060-1085`); факт принятия записывается в шаг (`id adopted by <актор>`), потому что порт не отдаёт `externalRef` для сверки | «an adopted id that the graph does not hold is refused instead of trusted» + расширение существующего теста |
| N-3 | MINOR (evidence-of-record) | артефакт батареи был старше тест-файла: все 20 строк имели `pass+fail=57` при 58 тестах, а M14 в отчёте значилась как `56/2` против `56/1` в артефакте | батарея перезапущена на суите того момента; артефакт и §6.2 согласованы (`pass+fail=60`). Пятый проход подтвердил согласованность, но добавил 8 тестов: батарею нужно перезапускать (§9) | — |
| N-4 | NIT | якорь D-8 указывал на строку без `return fail`, и текст не отражал, что pre-flight оставляет операцию в `staged`, а не в `recovery` | **не было исправлено** — пятая дельта это подтвердила; исправлено в этом проходе: §3.3 называет обёртку pre-flight (`service.ts:779`, остаётся `staged`) и три чтения после первой записи (`recovery`) | — |
| N-5 | NIT | якорь MAJOR-5 покрывал только атомарную ветвь | **не было исправлено**; исправлено в этом проходе: §3.1 называет обе ветви по именам — `ensureExternalRef` (атомарная, `core/plan.ts:751`, вызов `:698`) и `prepareCreateSpec` (staged, `:665`, вызов `:711`) | — |
| N-6 | NIT | ассерция `unresolvedCreates === []` в тесте D-1 вакуумна (отчёт-заглушка синтезирует пустой список) | заменена на проверку `record.created` — факт, который тест и наблюдает | — |

### 3.5 Проверка исправлений мутациями

Сломанный собранный артефакт → узкий прогон → восстановление из копии → `pnpm run build`. Полный вывод: `.tmp/mw011-mutation-results.txt`.

| Мутация | Что восстанавливает | Результат |
|---|---|---|
| M11a | ни один шаг ребра не попадает в журнал | CAUGHT — 9 тестов, включая журнальные проверки |
| M11b | BLOCKER-1 целиком: нет шага **и** часть выбирается по шагам | CAUGHT — 23 теста, включая intra-plan |
| M12 | endpoint-ключ снова не резолвится в id (BLOCKER-2) | CAUGHT — тест резолва + тест журнала |
| M13 | снят guard неразрешённых созданий (BLOCKER-3) | CAUGHT — два теста про `apply` |
| M14 | сняты оба guard'а верификации (run + revert) | CAUGHT — revert-тест + тест «порт соврал» |
| M15 | ссылки шагов с ключами снова не резолвятся (NEW-1) | CAUGHT — 4 теста |
| M16 | структурная проверка отказа снова не работает (NEW-3) | CAUGHT — 3 теста |
| M17 | id созданных задач не становятся долговечными (D-1) | CAUGHT — 5 тестов |
| M18 | отказ порта при наблюдении снова вылетает исключением (D-8) | CAUGHT — тест типизированного отказа |
| M19 | create-содержащая операция снова может заявить «ничего не написано» (D-2) | CAUGHT — тест середины операции |

**Что это меняет в честности отчёта.** Прежние формулировки §6.3 («ни один путь не оставляет частично видимого DAG», «создание без id не переигрывается») были верны для чистых функций ядра и для `resume`, но **не** для всего планировщика. Теперь каждое такое свойство вызывается через публичный API, и мутации, возвращающие любой из десяти найденных дефектов, валят конкретный тест.

### 3.6 Пятый проход двумя агентами: дельта N-1…N-6 и адверсариальный фальсификатор

Оба агента работали read-only на замороженном дереве `f22dbc3`: **дельта-верификатор** (`.work/reports/MW-011-delta-verification-3.md`) и **фальсификатор** (`.work/reports/MW-011-adversarial-2.md`, 24 попытки: 16 сценариев на реальном сторе, 3 на lease, 5 групп чистых функций).

**Дельта N-1…N-6 — FIXES PARTIALLY VERIFIED.** N-1 (composite-создание с принятыми id доводится до `applied` без pending-шагов), N-3 (артефакт батареи согласован) и N-6 (ассерция D-1 больше не вакуумна) подтверждены, каждая своей ломающей мутацией агента. N-2 — частично: проверка существования работает, но достаточной не была (F-1 ниже). N-4/N-5 — заявленных правок якорей в тексте не было; исправлено здесь (§3.1 MAJOR-5, §3.3 D-8).

**Фальсификатор — 13 находок, из них 2 BLOCKER.** Он опроверг два свойства, которыми карточка мерилась: `revert` объявлял успех и снимал паузу при эффекте в графе и отсутствии его в журнале (BLOCKER-1), а два перекрывающихся `apply` одного operationId создавали вторую задачу, не попавшую ни в один журнал (BLOCKER-2).

| # | Severity | Что сломано | Статус | Чем закрыто / воспроизведение |
|---|---|---|---|---|
| BLOCKER-1 | BLOCKER | `revert` рапортовал `reverted` и снимал паузу, когда создание или снятие ребра легло в граф, а шаг остался `pending`: инверсия строилась только по `applied`, а `verifyInverse` проверял собственную пустую инверсию (R1/R2/R3) | **исправлено** | `invertPlanSteps` считает `pending`-необратимый шаг препятствием (`core/plan.ts:1099-1130`); `revert` перед инверсией размечает шаги по графу — рёбра `markEdgeSteps` (`service.ts:452`) и ретайрменты `markRetireSteps` (`service.ts:493`, вызов `:1327`); состояние `staged` доказывает, что записи не было, и получает пустую инверсию. Тесты: «revert refuses when a create may have landed without reaching the journal», «revert maps the journal onto the graph before inverting it» |
| BLOCKER-2 | BLOCKER | два перекрывающихся `apply('op-1')`: `create=2`, вторая задача `mw-2` не существует ни в одном журнале, пауза снята | **исправлено** | claim = compare-and-set по состоянию строки (`claimMutation`, `store.ts:248`; вызов `service.ts:796`): проигравший получает `TASK_CONFLICT`/`operation-already-claimed` (`service.ts:824`) и не пишет. Тест «two overlapping callers of one operation do not both create» |
| MAJOR-3 | MAJOR | ключ создания совпадал с id существующей задачи: валидатор молчал, `resolvePlanEdges` подменял endpoint, предикат ADR026 отвечал `additive-only` (S1) | **исправлено** | отказ `create-key-shadows-existing-task` (`core/plan.ts:604`) — по наблюдаемым задачам, то есть ровно там, где ключ мог бы быть резолвлен. Тест «a create key may neither shadow an existing id nor repeat another key» |
| MAJOR-4 | MAJOR | повторное решение гейта: `decisionId` строился из часов → сырое исключение SQLite при том же `at`, конфликт артефакта при том же id и другом тексте, тихо вторая строка при другом `at`; идемпотентности по operationId нет | **исправлено** | `decisionId` = `gate-<operationId>` (`service.ts:1587`), а конфликт записи (artifact-conflict, UNIQUE) отвечает `TASK_CONFLICT`/`gate-already-decided` (`service.ts:1610-1640`) вместо исключения. Тест «a repeated gate decision is refused instead of colliding in SQLite or doubling»; мутация M20b |
| MAJOR-5 | MAJOR | `readStates` глотал **любой** отказ порта и считал задачу отсутствующей → guard §10.3 fail-open: running-задача переписывалась без policy, `verified: true` | **исправлено** | `readStates` пропускает только «задачи нет» (`TASK_CONFLICT`), прочий типизированный отказ идёт наружу (`service.ts:313-330`). Тест «a task the port cannot read is not an absent task for the running guard» |
| MAJOR-6 | MAJOR | повтор operationId с **другим** интентом отвечал `ok` исходом чужой операции; `acceptProposal` на этом пути «принимал» предложение, ничего не применив | **исправлено** | сравнение канонизированного интента при существующем `operationId` (`canonicalIntent`, `service.ts:285`; отказ `operation-id-reused`, `:1032`). Тест «an operation id reused for another mutation is refused, not answered with the first outcome» |
| MAJOR-7 | MAJOR | `reverted`-операцию можно было применить заново тем же `submit` (`run` замыкался только на `applied`), после чего `revert` отказывал | **исправлено** | та же проверка `UNSETTLED_STATES` в `run` (`service.ts:756-766`) — держит второй тест BLOCKER-1 |
| MAJOR-8 | MAJOR | `void` возвращал зависимую задачу в `ready`, хотя её держит второй frozen-блокер (G1: `D-1.ready` и одновременно открытый гейт B-2 с `dependents [D-1]`) | **исправлено** | ребро к voided-блокеру снимается у всех зависимых, а `retire → ready` получают только те, кого не держит другой открытый гейт (`service.ts:1546-1551`). Тест «void does not release a dependent a second open gate still holds»; мутация M20a |
| MAJOR-9 | MAJOR | повторный `submit` в одном тике: `UNIQUE constraint failed: plan_mutation.operation_id` наружу из `Result`-метода, операция оставалась `staged` с открытой паузой | **исправлено** | гонка вставки отвечает `TASK_CONFLICT`/`operation-already-staged` (`service.ts:1136`), а второй вызов после claim'а — `operation-already-claimed` |
| MINOR-10 | MINOR | `unexpected` считался только для пар, у которых затронуты оба конца: ребро «нетронутая → затронутая» не репортилось | **закрыто наполовину (звуковая половина)** | ребро, касающееся задачи, **созданной** этой мутацией, не может существовать до неё — такой случай теперь `unexpected` при одном конце (`core/plan.ts:1030-1040`), тест «an edge nobody asked for onto a task this mutation created is reported, not absorbed», мутация M20c. Для ребра между двумя **существующими** задачами «до» в журнале не хранится, и любое правило с одним концом давало бы ложные отказы на законных операциях — остаток назван в §9 |
| MINOR-11 | MINOR | дубликат ключа создания давал две задачи с одним `externalRef` и одним id в `created` | **исправлено** | отказ `duplicate-plan-key` (`core/plan.ts:614`) — держится тем же тестом, что MAJOR-3 |
| MINOR-12 | MINOR | `resumeAdmission()` открывает admission, не читая строку удержания; поднять паузу у живого контроллера нечем | **открыто** (§9) | `node .tmp/mw011-adv5-lease.mjs l1 l2 l3`; метод синхронный, а чтение удержания — асинхронное, поэтому правка меняет API `lease` (общий пакет) и порядок снятия паузы — решение владельца |
| NIT-13 | NIT | комментарий `acceptProposal` утверждал, что решение записывается на операцию, чего код не делал | **исправлено** | комментарий приведён к коду: решение записывается на **предложение** (`decideProposal`), операция несёт обычное решение пути `submit` (`service.ts:1483-1486`) |

**Что фальсификатор сломать не смог** (его собственный список, §3 отчёта): `resume` дважды подряд и два `resume` одновременно (дубликатов нет), авария на последнем шаге перед коммитом (пауза держится, `resume` доводит без новых созданий), вторая `stage` при открытой паузе, повтор `void` с тем же operationId, последовательные повторы `apply`/`submit`, весь список атак на предикат ADDITIVE (пустые массивы, `undefined`-поля, пустой diff, `retire → ready`, ребро на существующее ребро, self-loop, `setMetadata`), «порт соврал» с обоими затронутыми концами.

**Как доказаны исправления пятого прохода.** Восемь новых тестов написаны **до** правки и прогнаны на прежней сборке: все восемь падали (`.tmp/mw011-sixth-narrow1.txt`, 68 tests / 8 fail), после правки — 68/68 pass (`.tmp/mw011-sixth-narrow3.txt`). Четыре существующих revert-теста при первой версии правки упали и показали, что правило «любой не-applied необратимый шаг мешает revert» слишком широкое: `failed` — это установленный ответ наблюдения, а мешать должен только `pending`; это и было исправлено в `core/plan.ts:1099-1130`.

### 3.7 Шестой проход: FIXES PARTIALLY VERIFIED — и что из этого исправлено

Независимый верификатор (`.work/reports/MW-011-delta-verification-4.md`, 17 своих мутаций: 15 CAUGHT ровно целевым тестом, 2 MISSED) подтвердил девять из одиннадцати исправлений пятого прохода, опроверг BLOCKER-1 через шаг создания `failed` и нашёл регрессию в правке MAJOR-5. Все пять находок разобраны в этом проходе.

| # | Severity | Что было не так | Статус | Чем закрыто / что осталось |
|---|---|---|---|---|
| NEW-A | BLOCKER | `revert` снова объявлял `reverted`+`verified: true` и снимал паузу, когда создание попало в граф, а шаг помечен `failed` (порт ответил без id — контракт `PlanMutationResult.created` обещает только известные id, а штатный `parseGraphApplyOutput` отдаёт `{}` на неразобранный stdout) | **исправлено** | не-applied шаг **создания** теперь блокирует инверсию безусловно (`core/plan.ts:1126-1140`); `failed`-ретайрмент и `failed`-ребро по-прежнему считаются ответом наблюдения. Тест «revert refuses when a create landed but the port answered without its id»; проба верификатора `mw011-d4-probe.mjs newA` теперь даёт `TASK_CONFLICT/irreversible-steps`, журнал `recovery`, пауза удержана |
| NEW-B | MAJOR | `readStates` признавал отсутствием только `TASK_CONFLICT`, а штатный адаптер отвечает на «нет задачи» кодом `ADAPTER_UNAVAILABLE` — тем же, что и на сбой: законный путь «ребро между создаваемыми задачами по ключам» отвергался | **исправлено (с названным остатком)** | ключи созданий исключены из строгого чтения и читаются отдельно, лояльно (`service.ts:330-350`): ключ, называющий существующую задачу, по-прежнему ловится как тень, а прочие задачи читаются строго. Проба `newB`: документированный путь снова `ok`. **Остаток:** опечатка в endpoint'е на реальном адаптере даёт `ADAPTER_UNAVAILABLE`, а не `unknown-edge-endpoint`, потому что адаптер использует один код и для отсутствия, и для сбоя — на фейковом порте диагностика верна (`newF`), различать это можно лишь сигналом самого порта (§9 п. 5) |
| NEW-C | MINOR | `canonicalIntent` сравнивал и `meta.correlationId`, и порядок массивов: ретрай с новым трассировочным id отвергался как чужая мутация | **исправлено наполовину** | трассировочный id исключён, массивы канонически сортируются (`service.ts:285-305`); проба `f5`: `retry.newCorrelation` → `ok (no-op)`, `other.intent` по-прежнему `operation-id-reused`. Один вариант перестановки (`retry.reorderedArrays`) всё ещё отвергается — поведение fail-closed, разбирается в §9 п. 5 |
| NEW-D | MINOR | guard ключа-тени проверял только ключи, упомянутые в интенте ещё где-то: `create:[{key:'T-1'}]` без рёбер проходил и создавал вторую задачу под тем же операторским `externalRef` | **исправлено** | тот же лояльный проход читает **все** ключи созданий (`service.ts:337-345`), поэтому ключ-тень виден и без рёбер; проба `f3`: `untouchedShadow` → `TASK_CONFLICT/create-key-shadows-existing-task` |
| NEW-E | MINOR | MAJOR-9 и F-3 значились «исправлено» без теста и без строки батареи (обе мутации верификатора MISSED) | **принято как замечание к evidence** | поведение подтверждено пробами верификатора (`f7`, `f8` = журнал `recovery`), но **своего теста у MAJOR-9 нет** — вынесено в §9 п. 6; F-3 держится тестом «an adopted id may not become a way around the planner scope», который проверяет журнал после отказа |

Числа после этого прохода: `pnpm run check` = exit 0, **371 tests / 348 pass / 0 fail / 23 skip**; узкий прогон — **72 pass / 0 fail**. Батарея §6.2 снята до этих четырёх правок и на них не расширялась — это названо в §9 п. 6. **Второй заход пятого прохода (MAJOR-4, MAJOR-8, звуковая половина MINOR-10, NIT-13).** Три новых теста доказаны ломающей мутацией на собранных бандлах: снятие `otherHolds`-фильтра, возврат `decisionId` к часовому ключу и снятие `createdIds`-условия валят ровно три целевых теста (`.tmp/mw011-sixth-mut.txt`), после восстановления и `pnpm run build` — 71/71 pass (`.tmp/mw011-sixth-narrow6.txt`). Эти три мутации добавлены в батарею как M20a/M20b/M20c, и батарея перезапущена на 71-тестовой суите (`.tmp/mw011-mutation-results.txt`, 23 строки, все `CAUGHT`).

## 4. Сделано

### 4.1 Контракты (`packages/contracts`)

| Файл | Содержимое |
|---|---|
| `src/plan.ts` (новый, 502 строки) | `PlanMutationIntent` (origin, `runningTaskPolicy`, `requireAtomic`, `retire`), `RunningTaskPolicy`, `PlanChangeClass` (unchanged/modified/cancelled/superseded/newly-created), `PlanMutationReview`, `PlanMutationPart`, `StagedPlanMutation*`, `IntegrityReport` (в т.ч. `pendingRemovals`), `PlanMutationOutcome`, `PlanDecision`, `WorkProposal*`, `PlanResumeOptions` |
| `src/workflow.ts` (новый, 152 строки) | `PlanMutationClass` — вход предиката L3 (ADR026); `BlockerResolutionGate`, `BlockerResolutionAction`, `BlockerResolutionDecision`, `BlockerGateObservation` (§5.18) |
| `src/audit.ts` | `gate.decided`, `plan.mutation.applied`, `plan.mutation.recovered` (ADR028 §5.18): каталог 11 → 14 |
| `src/artifact.ts` | вид `gate-decision` — §34/§8 требуют хранить прозу решения в Artifact Store, audit ссылается через `artifactId` |
| `src/events.ts` | `plan.mutation.staged`, `admission.paused`, `admission.resumed` (ADR024): каталог 14 → 17 |
| `src/index.ts` | экспорт двух новых модулей |

`MYWORK_ERROR_CODES` **не менялся**: все отказы выражены существующими кодами.

### 4.2 Политика (`packages/core`)

| Файл | Содержимое |
|---|---|
| `src/plan.ts` (новый, 1149 строк) | `validatePlanMutation` (порядок проверок §6), `reviewPlanMutation`, `classifyPlanMutation`, `isAdditiveOnly`, `planMutationParts`, `materializePlanPart`, `resolvePlanEdges`, `resolvedEdgePair`, `planSteps`, `verifyPlanIntegrity`, `invertPlanSteps`, `planExternalRef`/`parsePlanExternalRef` |
| `src/blocker.ts` (новый, 157 строк) | `observeBlockerGates`, `deriveBlockerGates`, `openBlockerGates`, `gateIdOf`, `isFrozenBlocker` |
| `src/graph.ts` (+55) | `findDependencyCycle` — единственная реализация поиска цикла (её же использует адаптер) |
| `src/index.ts` | экспорт новых модулей |

Всё — чистые функции от интента и наблюдения графа: ADR026 запрещает решать безопасность плана суждением модели, поэтому класс вычисляется, а вердикт «успех/восстановление» — сравнение интента с тем, что граф реально содержит.

### 4.3 Пауза admission — общий механизм (`packages/lease`)

`src/lifecycle.ts` (+49): необязательный `admissionHold(stores)`, консультация при `activate()` после `reconcile`, `resumeAdmission()`, `info().admissionHeld`. Правки аддитивны: `assert.deepEqual(instance.reconcileReport, { operations: 2, leases: 1 })` в `tests/lease.test.mjs:584` верен, 25/25 тестов lease зелёные. Файл MW-009 затронут — названо явно.

### 4.4 Адаптер (`packages/beads-adapter`)

`src/plan.ts`: `detectCycle` делегирует `findDependencyCycle` из ядра (+8/−31, поведение то же). 68 тестов MW-010 (45 pass, 23 skip на живом `bd`) зелёные — проверка эквивалентности.

### 4.5 Новый пакет `@dsh-mywork/planner`

| Файл | Содержимое |
|---|---|
| `src/schema.ts` (156) | миграция **5** `plan-mutation`: `plan_revision`, `plan_mutation`, `plan_mutation_step`, `admission_hold` (частичный уникальный индекс на открытую паузу), `work_proposal`, `blocker_gate_decision` |
| `src/store.ts` (614) | план-ревизия с CAS, журнал операции и шагов, durable-пауза, предложения, решения гейта |
| `src/service.ts` (1429) | `createPlanner`: stage / apply / submit / resume / revert / integrityReport / pending / propose / acceptProposal / rejectProposal / gates / decideGate |
| `src/errors.ts` (70), `src/index.ts` (87) | локальные коды (`PlanError`) и публичная поверхность |

Поток staged-операции (ADR024 шаги 1–5): валидация → запись намерения и паузы **до** первого обращения к графу → раздельное применение частей (create / edges / fields / retire) → верификация результата → commit (state, бамп план-ревизии, снятие паузы, артефакт, audit, outbox) либо `PLAN_MUTATION_RECOVERY` с сохранённой паузой.

### 4.6 Тесты

`tests/plan-mutation.test.mjs` (новый, 2139 строк, 60 тестов) + `tests/lib/fixtures.mjs` (+4) + `tests/evidence.test.mjs` (+4/−2: пин каталога audit 11 → 14 со стражем невакуумности) + `tests/events.test.mjs` (+3: пин каталога событий) + `pnpm-lock.yaml` (+15: только importer `packages/planner`).

## 5. Команды и exit codes

| Команда | Exit | Наблюдение |
|---|---|---|
| `git status --short`, `git rev-parse HEAD` | 0 | baseline: чисто (кроме `DSH-MyWork.rar`), HEAD `f22dbc3` |
| `pnpm run check` **до правок** | 0 | baseline **299 / 276 pass / 0 fail / 23 skip** |
| `pnpm install` | 0 | 10 workspace-проектов, `@dsh-mywork/planner` слинкован |
| `pnpm run typecheck` | 0 | строгий `tsc` по всем 9 пакетам |
| `node --test --test-isolation=none tests/plan-mutation.test.mjs` | 0 | **71 pass / 0 fail** (было 60; +11 регрессионных на исправления пятого прохода) |
| тот же прогон **до** правки пятого прохода | 1 | 68 tests / **8 fail** — те же восемь тестов, все на найденные фальсификатором пути (`.tmp/mw011-sixth-narrow1.txt`) |
| тот же прогон с тремя снятыми правками второго захода | 1 | 71 tests / **3 fail** — ровно целевые тесты MAJOR-8, MAJOR-4, MINOR-10 (`.tmp/mw011-sixth-mut.txt`) |
| `node --test --test-isolation=none tests/lease.test.mjs` | 0 | 25 pass / 0 fail |
| `node --test --test-isolation=none tests/beads-adapter.test.mjs` | 0 | 68 tests, 45 pass / 0 fail / 23 skip |
| `node --test --test-isolation=none tests/{lease,beads-adapter,evidence,events}.test.mjs` | 0 | 116 tests, 93 pass / 0 fail / 23 skip |
| `pwsh -NoProfile -File .tmp/mw011-mutations.ps1` | 0 | **20/20 CAUGHT**, вывод `.tmp/mw011-mutation-results.txt` |
| `node .tmp/mw011-mw010-staged-probe.mjs` | 0 | находка по MW-010 подтверждена его же функциями (§6.1) |
| `pnpm run check` **после правок пятого прохода** | 0 | **370 tests / 347 pass / 0 fail / 23 skip** (`.tmp/mw011-sixth-check2.txt`) |
| `pwsh -NoProfile -File .tmp/mw011-mutations.ps1` (23 строки) | 0 | **23/23 CAUGHT** на 71-тестовой суите, `.tmp/mw011-mutation-results.txt` |

## 6. Evidence

### 6.1 Находка в MW-010 (подтверждена независимо, не исправлялась)

Staged-путь адаптера **молча теряет внутриплановые зависимости** создаваемых задач: `adapter.ts:965 createStaged()` не читает `dependsOnKeys`, `plan.ts:198 verifyStagedMutation()` сверяет только `addDependencies`/`removeDependencies`. Проба исполнителя:

```text
$ node .tmp/mw011-mw010-staged-probe.mjs
atomic composite?       false
batch lines             ["dep remove A-1 B-1"]
verification of intent  accepted the graph without the intra-plan edge
conclusion              intra-plan edges never reach the graph: the staged path drops create[].dependsOnKeys silently
```

Ревьюер подтвердил это своим пробником и объяснил, почему суита MW-010 зелёная: единственный тест с `dependsOnKeys` (`tests/beads-adapter.test.mjs:1139-1162`) идёт **атомарным** путём и **пропущен** без живого `bd` (один из 23 skip), а staged-тесты (`:451-524`, `:1164-1181`) `create[]` не передают вовсе.

**Рекомендация ревьюера (решение — за владельцем):** чинить в MW-010 (~15–20 строк в `applyStaged` + расширение `verifyStagedMutation` + 1 тест) и снять обход планировщика; если MW-010 заморожен — **fail-closed** в адаптере (отказ на staged-команду с `create[].dependsOnKeys`) плюс отдельный пункт. «Оставить как есть» не рекомендуется: дефект достижим для MW-012/014/025/043/047, которые идут через `TaskGraphPort.mutatePlan` напрямую.

### 6.2 Mutation-батарея (проверка, что тесты не вакуумны)

| # | Мутация | pass / fail | Поймал тест |
|---|---|---|---|
| M1 | ребро к существующей задаче считается additive | 70 / **1** | «the additive-only classifier…» |
| M2 | поиск цикла отключён | 69 / **2** | цикл до записи; верификация результата |
| M3 | durable-пауза не пишется | 57 / **14** | stage/hold, вторая staged-операция, kill-тест, resume, revert, lease-интеграция, apply/revert/refusal-тесты; выросло на тесты пятого прохода (полный список — в артефакте) |
| M4 | верификация игнорирует недостающее ребро | 70 / **1** | «integrity verification compares the intent…» |
| M5 | revert не отказывает при необратимых шагах | 68 / **3** | создания; metadata-шаг; выросло на тест BLOCKER-1 |
| M6 | `done`-блокер считается frozen | 68 / **3** | «a blocker in done…»; гейт на живом графе; «a gate that is not open…» |
| M7 | повтор создания задач | 68 / **3** | три теста про создания и принятые id |
| M8 | решение гейта не попадает в audit | 66 / **5** | keep-blocking/void/supersede; выросло на тесты гейтов второго захода |
| M9 | внутриплановые рёбра не материализуются | 69 / **2** | «the parts split creations from edges…»; intra-plan тест |
| M10 | снят guard идемпотентного повтора | 69 / **2** | повтор staged; повтор apply |
| M11a | ни один шаг ребра не журналируется | 60 / **11** | одиннадцать тестов, включая журнальные (полный список — в артефакте) |
| M11b | BLOCKER-1 целиком | 45 / **26** | 26 тестов, включая intra-plan |
| M12 | endpoint-ключ не резолвится в id | 69 / **2** | резолв ключей; журнал |
| M13 | снят guard неразрешённых созданий | 69 / **2** | два теста про apply |
| M14 | сняты оба guard'а верификации (run + revert) | 68 / **3** | revert; «порт соврал»; выросло на тест MINOR-10 |
| M15 | ссылки шагов с ключами не резолвятся (NEW-1) | 66 / **5** | intra-plan; журнал и инверсия; atomic; дубль ребра; принятые id |
| M16 | структурная проверка отказа не работает (NEW-3) | 62 / **9** | чужой бандл; долговечность id; типизированный отказ; чтение running-задачи; принятые id (полный список — в артефакте) |
| M17 | id созданных задач не долговечны (D-1) | 65 / **6** | повтор staged; kill-тест; долговечность id; дубль ребра; принятый id; retire-идемпотентность |
| M18 | отказ порта вылетает исключением (D-8) | 69 / **2** | типизированный отказ при staging; чтение running-задачи |
| M19 | «ничего не написано» для create-операции (D-2) | 70 / **1** | середина операции |
| M20a | `void` снова выпускает зависимую под вторым гейтом (MAJOR-8) | 70 / **1** | «void does not release a dependent a second open gate still holds» |
| M20b | ключ решения гейта снова из часов (MAJOR-4) | 70 / **1** | «a repeated gate decision is refused instead of colliding in SQLite or doubling» |
| M20c | ребро на только что созданную задачу снова не «unexpected» (MINOR-10) | 70 / **1** | «an edge nobody asked for onto a task this mutation created is reported, not absorbed» |

Все строки — с суиты **71 теста** (после одиннадцати регрессионных тестов пятого прохода): `pass + fail = 71` в каждой строке, все 23 `CAUGHT`, полный вывод — `.tmp/mw011-mutation-results.txt`. Замечание фальсификатора о том, что батарея не бьёт по найденным им путям, закрыто строками M20a/M20b/M20c; строки, чьи `fail` выросли после пятого прохода, названы с оговоркой — полный список ловящих тестов есть в артефакте.

### 6.3 Что проверено по приёмке (наблюдением, а не обещанием)

- **staged-запись раньше графа.** Тест читает строку журнала в момент вызова `mutatePlan`: строка есть, состояние `applying`, в ней полный интент.
- **пауза durable.** После «убийства» писателя в переоткрытой БД остаётся открытая пауза и операция в `applying`; новый `ControllerLifecycle.activate()` даёт `admitting: false`, `admissionHeld: true`, `isWriter() === false`.
- **верификация раньше возобновления.** История вызовов fake-порта: чтение `dependencies` идёт после последней записи, и только затем снимается пауза.
- **сквозные свойства главного пути.** Ребро между созданными задачами действительно появляется, ключ никогда не уходит в граф как id, журнал называет id и восстанавливает их при инверсии, повторный `apply` не создаёт задачу заново, отказ порта из другого бандла возвращается своим кодом, id созданных задач долговечны до всех остальных чтений.
- **`revert` и уже видимый эффект.** Прежняя формулировка («`revert` без подтверждённой инверсии не снимает паузу») верна только для инверсии, которую `revert` себе построил: при `pending`-шагах инверсия была пуста и проверялась сама собой. Теперь `revert` сначала читает граф (рёбра и состояния ретайрментов), `pending`-необратимый шаг останавливает его, и только наблюдённая инверсия снимает паузу.
- **«ни один путь не оставляет частично видимого DAG»** — формулировка снята: фальсификатор показал два пути, где это было не так (`revert` при нежурналированном эффекте и перекрывающиеся `apply` одного operationId). Оба закрыты (§3.6); в §8 перечислено, что осталось незакрытым.
- **порт, который соврал.** Бэкенд отвечает успехом, не записав ребро → `PLAN_MUTATION_RECOVERY`, состояние `recovery`, пауза держится, граф не изменён (случай, ради которого написан ADR024).
- **гейт = решение, а не состояние.** `keep-blocking` оставляет гейт открытым с `awaitingDecision: false`, причина лежит в audit-строке `gate.decided` и в артефакте `gate-decision` (байты сверены с SHA-256 через `getArtifact`); `void` снимает оба ребра staged-операцией и переводит обоих зависимых в `ready`; `supersede-dependent` — в `superseded`; `done`-блокер гейта не даёт.
- **additive-only.** Таблица true/false (create, ребро между новыми, `dependsOnKeys`, ребро к существующей, ребро от существующей, update, приоритет, removal) + `destructive` для retire/removal и `modifying` для release/update.

## 7. Изменённые и новые файлы

Числа — из `git diff --numstat`.

```text
 M packages/beads-adapter/src/plan.ts      +8  −31   (detectCycle делегирует core.findDependencyCycle)
 M packages/contracts/src/artifact.ts      +7        (вид gate-decision)
 M packages/contracts/src/audit.ts         +9        (gate.decided, plan.mutation.applied|recovered)
 M packages/contracts/src/events.ts        +9        (plan.mutation.staged, admission.paused|resumed)
 M packages/contracts/src/index.ts         +2        (экспорт plan.ts, workflow.ts)
 M packages/core/src/graph.ts             +55        (findDependencyCycle)
 M packages/core/src/index.ts             +33  −1    (экспорт plan.ts, blocker.ts, новых helper'ов)
 M packages/lease/src/lifecycle.ts        +49        (admissionHold, resumeAdmission, admissionHeld)
 M tests/events.test.mjs                   +3        (пин каталога событий)
 M tests/evidence.test.mjs                 +4  −2    (пин каталога audit 11 → 14)
 M tests/lib/fixtures.mjs                  +4        (запись planner)
 M pnpm-lock.yaml                         +15        (importer packages/planner)
?? packages/contracts/src/plan.ts          502 строки
?? packages/contracts/src/workflow.ts      152 строки
?? packages/core/src/plan.ts               1187 строк
?? packages/core/src/blocker.ts            157 строк
?? packages/planner/                       новый пакет (package.json, tsconfig.json, tsdown.config.ts, src/×5; 1628 строк сервиса, 637 строк store)
?? tests/plan-mutation.test.mjs            2400 строк, 68 проверок
```

Скрипты проверки (в `.tmp/`, исключён из Git): `mw011-mutations.ps1` (+ `mw011-mutation-results.txt`), `mw011-mw010-staged-probe.mjs`; материалы проходов — `.tmp/mw011-review-*.{mjs,ps1}`, `.tmp/mw011-vfix-*.{mjs,ps1}`, `.tmp/mw011-delta-*.{mjs,ps1}`, `.tmp/mw011-d3-probe.mjs`, `.tmp/mw011-adv5-{lib,staged,core,lease}.mjs` (+ `.txt`), прогоны шестого круга правок — `.tmp/mw011-sixth-{narrow1,narrow2,narrow3,check}.txt`.

### 7.1 Коммиты

Коммитов нет: карточка разрешает их только по отдельному поручению владельца. Base SHA = head SHA = `f22dbc3b2eb97601e09fc4f341bcddd522544545`; push, merge и publish не выполнялись. Отчёты `.work/` в Git не попадают (правило `/.work/`).

## 8. Ограничения и что осталось непроверенным

1. **Живой `bd` не использовался.** Staged-механика проверена на детерминированном fake-порте, контракт адаптера — его собственной суитой (45 pass, 23 skip) и делегированием `detectCycle`. Поведение на настоящем Beads опирается на MW-010, а не на новый прогон; частота окна, найденного как D-1, на реальном порте не измерялась.
2. **Metadata-only обновление не наблюдаемо через порт.** Такой шаг журналируется необратимым (MINOR-9), title/priority читаются обратно; верификация целостности на metadata не опирается.
3. **`revert` не отменяет создания и переводы состояний**: `create` и `retire`/`release` необратимы (у порта нет примитива удаления, §5.2 называет этот случай). Отказ называет необратимые шаги.
4. **API/CLI и доска не делались.** Операторский выход доступен как библиотечный сервис (доказано тестами без UI, DSH и доски); HTTP/CLI — MW-029, баннер recovery — MW-047/049. Cordis-строка не добавлена: она открывала бы `controller.sqlite` со своим набором миграций, что конфликтует с композицией владельца БД.
5. **Композиция миграций.** Схема карточки — версия **5** в `controller.sqlite`; хранилище открывается списком `[...MYWORK_MIGRATIONS, ...EVIDENCE_MIGRATIONS, ...LEASE_MIGRATIONS, ...PLAN_MUTATION_MIGRATIONS]` (неполный список падает fail-closed). Каноническую композицию рантайма закрепляет MW-028.
6. **Дефект MW-010 остаётся** для всех, кто вызывает `TaskGraphPort.mutatePlan` напрямую (§6.1): MW-011 его обходит, но не устраняет. Решение — за владельцем.
7. **Кросс-бандловая идентичность классов — общее свойство воркспейса** (`alwaysBundle`): `instanceof` между пакетами не работает (NEW-3). В MW-011 проверки отказов структурные по `code`; экспортируемые `isMyWorkError`/`isPlanError` остаются `instanceof`-проверками, и это стоит учесть карточкам, которые будут ловить ошибки чужих бандлов.
8. **Конкурентность покрыта частично:** вторая staged-операция на воркспейс отвергается, сдвиг план-ревизии даёт `STALE_REVISION` без записи в граф; перекрывающиеся вызовы одной операции в **одном** процессе закрыты claim'ом (BLOCKER-2), гонка двух процессов на одной SQLite-БД не воспроизводилась (свойство storage) — а claim по состоянию строки её и не закрывает: двум процессам, одновременно возобновляющим запись в состоянии `applying`, по-прежнему нужен внешний арбитр.
9. **Остаточные риски, названные открыто:** (а) единственная незакрытая находка фальсификатора — MINOR-12, пауза admission в общем `lease` (§9 п. 2); (б) строгий отказ `adopted-id-scope-unverified` делает неисполнимым путь «потеряны id + есть рёбра по этим ключам» — §9 п. 3; (в) `revert` не может доказать отсутствие *нежурналированной* записи полей (metadata не читается через порт) — `pending`-необратимый metadata-шаг его останавливает, но запись полей, которую порт выполнил и не подтвердил, при `failed`-разметке остаётся невидимой; (г) остаток MINOR-10 — ребро между двумя существующими задачами без снимка «до» (§9 п. 4); (д) независимая проверка одиннадцати исправлений пятого прохода ещё не выполнена (§9 п. 5).
10. **Ничего вне карточки не тронуто**: живой профиль DSH, доска, чужие проекты, `.beads/`, `status.custom`. Субагенты запускались только для проходов проверки (в пятом проходе — два одновременно, оба read-only); платные LLM-пробы и другая модель не использовались.

## 9. Открытые вопросы к владельцу

1. **Дефект staged-пути MW-010** (§6.1): чинить в MW-010, заводить отдельным пунктом или оставить как есть? Ревьюер рекомендует чинить в MW-010 либо сделать адаптер fail-closed.
2. **MINOR-12 — единственная незакрытая находка фальсификатора (пауза admission).** `resumeAdmission()` открывает admission по слову вызывающего, не читая строку удержания: при живом удержании `isWriter` уже `true`. Метод синхронный, а чтение удержания асинхронное, поэтому честная правка меняет API общего пакета `lease` и документированный порядок («снять строку → `resumeAdmission`» становится «снять строку → перечитать удержание»). Воспроизведение: `node .tmp/mw011-adv5-lease.mjs l1 l2 l3`. Рекомендую закрыть тем же способом, каким закрыт MAJOR-4: перечитать состояние, прежде чем объявлять его изменённым.
3. **Остаток MINOR-10 — ребро между двумя существующими задачами.** Звуковая половина закрыта (ребро, касающееся только что созданной задачи, — `unexpected`), но ребро «нетронутая → затронутая» между двумя давно существующими задачами по-прежнему неотличимо от существовавшего до операции: журнал не хранит «до». Полное закрытие требует снимка рёбер в момент staging (колонка в `plan_mutation`, миграция 5 → 6). Решение владельца: принять названное ограничение (§8 п. 9в) или заказать снимок.
*Закрыто в этом проходе: MAJOR-4, MAJOR-8, MINOR-10 (звуковая половина), MINOR-11, NIT-13 — по каждому тест и ломающая мутация в §3.6; батарея перезапущена на 71-тестовой суите (23/23 CAUGHT, §6.2).*
4. **Незакрытая лазейка принятия id (остаточный риск, назван честно).** Строгий отказ `adopted-id-scope-unverified` (`service.ts:1239-1255`) закрывает обход §5.1, но делает путь «id созданных задач потеряны в окне падения + у мутации есть рёбра по этим ключам» неисполним: `resume` отказывает, а `revert` и раньше отказывал (создания необратимы). Правильный выход — чтение `externalRef` через порт: адаптер видит `external_ref` (`beads-adapter/src/adapter.ts:139`), но `toTask` его теряет, а в контракте `Task` поля нет. Это добавка к §11-контракту, поэтому решает владелец; в атомарном пути (`requireAtomic`) проблема не возникает — там рёбра пишет сам порт и они подтверждаются наблюдением.
5. **Шестой проход: независимая проверка дельты.** Одиннадцать исправлений пятого прохода подтверждены моими же тестами и мутациями; по протоколу их должна проверить отдельная сессия — read-only, своими ломающими мутациями по восьми путям (`revert` при нежурналированном эффекте, claim операции, ключ-тень, чтение running-задачи, повтор operationId, принятый id, `void` под вторым гейтом, идемпотентность `decideGate`). Рекомендую запускать до приёмки: предыдущие проходы четырежды находили дефекты именно в свежих исправлениях.
6. **Цена процесса.** Шесть проходов нашли 23 дефекта, из них не меньше восьми — внесённых исправлениями. Если это слишком дорого для карточки такого размера, имеет смысл обсудить формат: ревью только дельты после каждого исправления вместо полного прохода.

## 10. Отклонения от утверждённого плана и от исходной реализации (названы явно)

| План / исходно | Реализовано | Почему |
|---|---|---|
| `plan_mutation` без колонки mode | добавлена `mode` | повтор должен отвечать тем же исходом |
| `blocker_gate_decision` без `operation_id` | добавлена | решение `void`/`supersede-dependent` выполняет staged-операция |
| `acceptProposal` → `Result<StagedPlanMutation>` | → `Result<PlanMutationOutcome>` (stage + apply) | решение Setter'а и есть человеческое решение; staged без владельца держал бы паузу до MW-014 |
| `gates()` → `Result<…>` | обычный массив (типизированные исключения порта) | чтение без `OperationMeta` |
| `decideGate(gateId, …)` | `decideGate({ workspaceId, blockerTaskId, … })` | `gateId` — составной ключ из двух произвольных строк |
| `IntegrityReport` без `pendingRemovals` | добавлено поле | «удаление ещё не выполнено» и «граф изменился извне» — разные факты |
| `retire.to: cancelled\|superseded` | + `ready` | `void` снимает рёбра и возвращает зависимых одной staged-операцией |
| create-часть без `externalRef` | ссылка `mw-plan:<op>:<key>` проставляется | MAJOR-5: без неё операторский резолв неисполним |
| Верификация сравнивает `addDependencies` буквально | резолвит ключи в id (и при применении, и при проверке) | BLOCKER-2 |
| Проверка отказа через `instanceof` | структурная проверка по `code` | NEW-3: бандлы несут свои копии классов |
| `stage` мог выбросить ошибку порта | отказ возвращается как `Result` | D-8: метод обещает `Result` |
| mutation-батарея 9 мутаций | 20 | добавлены M11a/M11b/M12/M13/M14 (ревью), M15/M16 (верификация), M17/M18/M19 (дельта) |
| `revert` инвертировал только `applied`-шаги | `pending`-необратимый шаг останавливает revert; рёбра и ретайрменты размечаются по графу | BLOCKER-1: иначе revert объявлял восстановление, которого не наблюдал |
| `run` не захватывал операцию | claim = compare-and-set по состоянию строки (`claimMutation`) | BLOCKER-2: перекрывающиеся вызовы дублировали задачу |
| `stage` возвращал существующую запись по одному лишь `operationId` | сверяет канонизированный интент (`operation-id-reused`) | MAJOR-6: чужой исход выдавался за применение второго интента |
| `readStates` считал любую ошибку отсутствием задачи | пропускает только `TASK_CONFLICT`, прочее — типизированный отказ наружу | MAJOR-5: guard §10.3 был fail-open |
| Ключи создания не проверялись | отказы `create-key-shadows-existing-task` и `duplicate-plan-key` | MAJOR-3/MINOR-11: ключ-тень обходил предикат ADR026 |
| `resume` принимал любой существующий id | отказ `PLANNER_SCOPE_DENIED`/`adopted-id-scope-unverified`, если ребро опирается на принятый id | F-1: принятый чужой id обходил §5.1 |

## 11. Воспроизведение

1. `pnpm install && pnpm run check` — ожидается exit 0: **370 tests, 347 pass, 0 fail, 23 skip**.
2. Узкая проверка: `node --test --test-isolation=none tests/plan-mutation.test.mjs` — 71 pass / 0 fail.
3. Mutation-батарея: `pwsh -NoProfile -File .tmp/mw011-mutations.ps1` — **23 строки `CAUGHT`** на 71-тестовой суите (`pass+fail=71`), включая M20a/M20b/M20c; восстановление подтверждается повторным `pnpm run check`.
4. Находка по MW-010: `node .tmp/mw011-mw010-staged-probe.mjs` — вывод в §6.1.
5. Независимые проходы: `.work/reports/MW-011-review.md` (FAIL), `.work/reports/MW-011-fixes-verification.md` (FIXES PARTIALLY VERIFIED, NEW-1…NEW-6), `.work/reports/MW-011-delta-verification.md` (D-1…D-7), `.work/reports/MW-011-delta-verification-2.md` (N-1…N-6), `.work/reports/MW-011-delta-verification-3.md` (пятая дельта), `.work/reports/MW-011-adversarial-2.md` (13 находок, 2 BLOCKER).
6. Воспроизведение открытых находок: `node .tmp/mw011-adv5-lease.mjs l1 l2 l3` (MINOR-12), `node .tmp/mw011-adv5-core.mjs verify` (остаток MINOR-10), `node .tmp/mw011-adv5-staged.mjs c1 c2 c3 g1 g2 r1 r2 r3` (закрытые — должны показывать исправленное поведение).
7. Приёмка по коду (не по тестам): `packages/core/src/plan.ts` (`validatePlanMutation`, `materializePlanPart`, `resolvePlanEdges`, `planSteps`, `invertPlanSteps`, `verifyPlanIntegrity`), `packages/planner/src/service.ts` (`stage`, `run` с pre-flight и claim'ом, `runParts`+`markEdgeSteps`/`markRetireSteps`, `resume`, `revert`, `decideGate`, `refusalShape`), `packages/planner/src/store.ts` (`claimMutation`), `packages/lease/src/lifecycle.ts` (`admissionHold`, `resumeAdmission`).
8. Границы для следующих карточек: `TaskClaims`, `AutonomyLevel`, `WorkflowRevision` этим пакетом **не** определяются — их добавляет MW-044 в `contracts/src/workflow.ts` и `core/src/workflow.ts`; `contracts/src/{idea,import,board}` — MW-043/054/047.

## 12. Приёмка (запись акта)

Статус переведён `READY_FOR_REVIEW` → **`DONE`** по прямому указанию владельца в сессии MW-020 («поменять все карточки с подобной оговоркой, просто забыли сделать это ранее»). Содержательная часть отчёта не переписана; перевод статуса **не** закрывает три находки, оставшиеся открытыми поимённо: MINOR-12, остаток MINOR-10 и §9 п. 4 (воспроизведение — §11 п. 6). Приёмка — акт владельца; она не является ни self-review, ни вердиктом ревьюера.
