# MW-011 — верификация исправлений (verify-fixes mode)

- Предмет: дельта после ревью `.work/reports/MW-011-review.md` (вердикт **FAIL**, 3 BLOCKER / 2 MAJOR / 4 MINOR / 3 NIT) и исправлений, описанных в §3 отчёта исполнителя `.work/reports/MW-011-plan-mutations.md`.
- Проверяющий: отдельная сессия, read-only по репозиторию; запись только в `.tmp/` и этот файл.
- Base SHA = HEAD = `f22dbc3b2eb97601e09fc4f341bcddd522544545` (коммитов карточки нет, HEAD не менялся).
- Окружение: Windows, pwsh, Node v24.19.0, pnpm 12.4.2. Вне объёма: живой `bd`, `verify:profile`/`pack:local`, повторный пересмотр уже подтверждённых находок и всего MW-010.
- Собственные инструменты проверки (не материалы исполнителя и не материалы ревью): `.tmp/mw011-vfix-probe.mjs`, `.tmp/mw011-vfix-classid.mjs`, `.tmp/mw011-vfix-mutate.mjs` + `.tmp/mw011-vfix-mutations.ps1`, выводы `.tmp/vfix-probe-results.txt`, `.tmp/vfix-mutation-results.txt`, `.tmp/vfix-check.log`.

---

## 1. ВЕРДИКТ

**FIXES PARTIALLY VERIFIED** — все 12 находок ревью исправлены по-настоящему (6 из них я лично подтвердил ломающими мутациями по собранным бандлам), но исправления BLOCKER-1/BLOCKER-2 внесли два дефекта достоверности журнала, а guard из BLOCKER-3 сделал необратимым ранее существовавший дефект распознавания ошибок порта: отказ «до записи» больше нельзя повторить через `apply`, а его код подменяется на `PLAN_MUTATION_RECOVERY`.

---

## 2. ТАБЛИЦА: finding → вердикт → доказательство

| # | Вердикт | Доказательство (команда / exit / фрагмент) |
|---|---|---|
| **BLOCKER-1** intra-plan зависимости | **VERIFIED** | Код: `core/plan.ts:804-814` (шаг журнала на каждый `dependsOnKeys`, ref с маркером `key:`) + `planner/service.ts:377-389` (часть `edges` выбирается по материализованной команде). Моя мутация **M1a** (шаг убран из **обеих** копий: `core/lib/index.js` и `planner/lib/index.js` — планировщик инлайнит ядро) → `exit=1, pass=49, fail=1`, ловит «a plan of new tasks with intra-plan dependencies wires them between the created ids». Мой пробник S-A: ребро `mw-2->mw-1`, шаг `applied`, `admissionHeld=false`. |
| **BLOCKER-2** рёбра между новыми ключами | **VERIFIED** | Код: `core/plan.ts:139-154` (`resolvePlanEdges`) применяется и в `materializePlanPart` (`:736-770`), и в `verifyPlanIntegrity` (`:939-950`). Мутации **M2a** (применение не резолвит) и **M2b** (верификация не резолвит) → обе `exit=1, pass=49, fail=1`, ловит «an edge between two created tasks given as addDependencies is resolved to their ids». Пробник S-B: в графе `mw-2->mw-1`, литерального `child->root` нет, `verified=true`; S-E (порт отвечает успехом, не записав ребро) → `PLAN_MUTATION_RECOVERY`, `report.missing=[<child>\0<root>]`. |
| **BLOCKER-3** повтор `apply`/`submit` | **VERIFIED** | Код: единый pre-flight `service.ts:558-598` (`damaged = unexpected \|\| cycle \|\| (!fresh && unresolvedCreates)`), `resume` — форма с `adoptedCreated` (`:866-895`). Мутация **M3** (guard снят) → `exit=1, pass=48, fail=2`, ловит «a retry through apply does not create a task whose id was never journalled» (+ существующий «a create whose id was never journalled…»). Пробник S-C: сбой после записи в граф и до журнала → `apply` = `PLAN_MUTATION_RECOVERY`, `graph.calls.create == 1`, задач по-прежнему 4; `resume(adoptedCreated)` → ok, без дубля, пауза снята. См. оговорку в NEW-3. |
| **MAJOR-4** `revert` без подтверждённой инверсии | **VERIFIED** | Код: `service.ts:954-968` (`if (!report.verified)` → `enterRecovery` + `PLAN_MUTATION_RECOVERY`, пауза остаётся). Изолированная мутация **M4** (отключён только guard после `verifyInverse`, guard в `run` не тронут) → `exit=1, pass=49, fail=1`, ловит «a revert that did not restore the graph keeps the pause and stays in recovery». Пробник S-D: `reverted.ok=false`, `code=PLAN_MUTATION_RECOVERY`, `state=recovery`, `admissionHeld=true`. Обратная сторона (нет ложной строгости) — S-D2: подтверждённая инверсия по-прежнему даёт `reverted` и снимает паузу. |
| **MAJOR-5** внешняя ссылка | **VERIFIED** | Код: `core/plan.ts:630-640` (`prepareCreateSpec`) и `:716-720` (`ensureExternalRef`, атомарная ветвь). Мутация **M5** (ссылка не проставляется, обе копии) → `exit=1, pass=49, fail=1`, ловит «a created task carries the reference an operator would search for». Пробник: S-A/S-C (staged, ссылка `mw-plan:op-1:root|child`, задача находится по ней), S-I4 (своя ссылка `jira-1` не перезаписана), S-I4b (атомарный composite тоже проставляет). |
| **MINOR-6** числа в отчёте | **VERIFIED** | `git diff --numstat` совпадает с §7 отчёта строка в строку: `8/31`, `7/0`, `9/0`, `9/0`, `2/0`, `55/0`, `33/1`, `49/0`, `15/0`, `3/0`, `4/2`, `4/0`. |
| **MINOR-7** `PlanDecision.at` | **VERIFIED** | Код: `service.ts:668-683`, `Number.isSafeInteger(at)` + имя поля в сообщении. Пробник S-I1: `resume(id,{decidedBy:'operator'})` → `TypeError`, `/needs a clock reading in "at"/`, без `SQLite`/`bind` в тексте. |
| **MINOR-8** `integrityReport` завершённой операции | **VERIFIED** | Код: `service.ts:995-1004` (settled → сохранённый отчёт) + `core/plan.ts:863-869,996` (`expectedRevision`). Пробник S-I2 (незавершённая → пересчёт, `verified=false`) и S-I3/I3b (завершённая → `verified=true`, тот же `checkedAt`, что у отчёта коммита). |
| **MINOR-9** metadata как обратимый шаг | **VERIFIED** | Код: `core/plan.ts:826-839` (`reversible: metadataKeys.length === 0` + причина). Мутация **M6** (`reversible: true`, обе копии) → `exit=1, pass=49, fail=1`, ловит «a metadata update is journalled as irreversible, and revert names it». |
| **NIT-10** нет событий | **VERIFIED** | Диффы `contracts/src/events.ts` (+`plan.mutation.staged`, `admission.paused`, `admission.resumed`) и пина `tests/events.test.mjs` (+3). Пробник S-J читает outbox: после `stage` — `['admission.paused','plan.mutation.staged']`, после `apply` — `['admission.paused','admission.resumed','plan.mutation.applied','plan.mutation.staged']`. |
| **NIT-11** `retire` переигрывался | **VERIFIED** | Код: `service.ts:425-440` (шаг пропускается, если наблюдаемое состояние равно целевому). Пробник S-K с портом, соблюдающим таблицу переходов: сбой после первого `transition`, затем `resume` → ok, второй retire применён, `admissionHeld=false`, нелегального перехода нет. |
| **NIT-12** «45 тестов» | **VERIFIED** | §1 отчёта больше не называет 45 числом тестов; в §4.4/§5 стоит «68 tests, 45 pass / 0 fail / 23 skip», что я воспроизвёл: `node --test … tests/beads-adapter.test.mjs` → `68/45/0/23`, exit 0. |

Дополнительно проверено и сочтено корректным:

- **Числа совпадают все.** `pnpm run check` → exit 0, **349 tests / 326 pass / 0 fail / 23 skip**; узкий → **50 pass / 0 fail**; `lease` → 25 pass; `beads` → 68/45/0/23; `lease+beads+evidence` → 112/89/0/23; `lease+beads+evidence+events` → 116/93/0/23. Расхождений с §5 нет ни в одной строке.
- **Дерево не двигалось после отчёта.** mtimes: исходники 12:47–12:50, результаты мутаций 12:55:41, отчёт 12:57:18; ревью 12:44:18 — хронология «ревью → исправления → отчёт» согласована, после отчёта в `packages/`, `tests/`, `scripts/` никто не писал.
- **Процессная честность.** HEAD = base SHA, коммитов/push нет; `git status --short` — тот же набор 12 M + 6 новых путей карточки + посторонний `DSH-MyWork.rar`, мой прогон его не изменил; `.work/` игнорируется (`.gitignore:1:/.work/`); `.beads/` mtime 18.09 21:38:53 (раньше работ карточки) — не тронут; `~/.dsh` mtime 19.09 12:57:46 — это активность собственной сессии исполнителя через 28 с после её отчёта, карточка туда ничего не пишет (моя сессия живой профиль не трогала).
- **Методическая ловушка мутаций (важно для будущих батарей).** `packages/planner/tsdown.config.ts` (`alwaysBundle: ['@dsh-mywork/core']`) инлайнит ядро: мутация только `packages/core/lib/index.js` не меняет поведение планировщика — мой первый заход дал 50/50 глазами на M1a/M2a/M2b/M5/M6. Батарея исполнителя (.tmp/mw011-mutations.ps1:41,60,72,89,103,111,119) мутирует **обе** копии — это правильно; мои финальные мутации сделаны так же.
- **Мутация M1b (выбор части по журналу, только `planner/lib`) — NOT-CAUGHT (50/0), и это не дефект.** После фикса журнал перечисляет всю работу части (шаг на каждый внутриплановый ключ), поэтому выбор «по шагам» и выбор «по материализованной команде» эквивалентны; исполнитель зафиксировал это же в комментарии к своей M11a, а его M11b (обе половины дефекта сразу) ловится (49/1). Остаточный риск будущей правки назван, дефекта нет.

---

## 3. НОВЫЕ FINDINGS

### NEW-1 — MINOR (внесено исправлением BLOCKER-2): журнал помечает рёбра между созданными ключами как `failed`, хотя они легли

`packages/core/src/plan.ts:815-820` (шаг на явное `addDependencies` журналируется как `planEdgeKey(edge)` — без маркера `key:`) + `packages/core/src/plan.ts:166-175` (`resolvedEdgePair` резолвит только refs, содержащие `key:`) + `packages/planner/src/service.ts:390-398` (пометка шага по графу).

Что не так: ровно та форма, ради которой написан BLOCKER-2 (ADR026 «ребро между двумя новыми задачами»), теперь корректно уходит в граф резолвнутыми id — и при этом её шаг в `plan_mutation_step` навсегда записывается `failed`, потому что `resolvedEdgePair("child\0root", created)` маркера не видит и возвращает литеральную пару, которой в графе нет.

Доказательство (пробник, `node .tmp/mw011-vfix-probe.mjs`, S-B): `edge steps: [{"ref":"child\u0000root","state":"failed"}]`, при этом `graph.edgePairs() == ['mw-2->mw-1']`, `integrity.verified == true`, операция `applied`. Существующий тест «an edge between two created tasks…» проверяет граф, но не журнал, поэтому зелёный.

Почему важно: §5.2 читает именно журнал (операторская кнопка «откатить обратимые шаги», разбор что легло), и шаг «failed» на легшем ребре — ложное свидетельство. Функциональных последствий сегодня нет: откат такой операции всё равно отвергается как `irreversible-steps` (создания), что я подтвердил (S-L).

Минимальная правка: журналировать endpoint, называющий созданный ключ, с маркером `key:` (как это уже делает шаг intra-plan, `plan.ts:809`), и **заодно** резолвить refs через `created` в `invertPlanSteps` (`core/plan.ts:1034-1070`): сейчас `splitPlanEdgeKey` от `key:`-ref даёт литеральные ключи, и инверсия такого шага выпустила бы ребро на несуществующую задачу — сегодня это недостижимо только потому, что первым срабатывает запрет на необратимые создания (`service.ts:922-938`; доказано S-L: `TASK_CONFLICT/irreversible-steps`, граф не изменён).

### NEW-2 — NIT (внесено исправлением BLOCKER-1): на атомарном composite-пути шаги внутриплановых рёбер остаются `pending` после коммита

`packages/core/src/plan.ts:804-814` (шаги заводятся для всех путей) против `packages/planner/src/service.ts:347-349,377-401` (помечает их только часть `edges`, а на пути `requireAtomic && isAtomicComposite` такой части нет — `core/plan.ts:655-667`).

Доказательство (пробник S-G): `requireAtomic: true` + `create[].dependsOnKeys` → один composite-вызов, ребро в графе, `integrity.verified == true`, операция `applied`, но `atomic edge steps: ["pending"]`.

Почему важно: журнал завершённой операции описывает её неверно (шаг вечно `pending`); функциональных последствий нет (settled-операцию откатить нельзя).

Минимальная правка: в create-ветви `runParts` помечать intra-plan шаги по ответу composite-вызова, когда `intent.requireAtomic === true && isAtomicComposite(intent)`, либо не заводить их на этом пути.

### NEW-3 — MAJOR (внесено **не** исправлениями, но guard из BLOCKER-3 сделал его весомым; попутная находка вне дельты 12 findings)

`packages/planner/src/service.ts:183-192` (`isPreWriteRefusal` — `error instanceof MyWorkError`) + `packages/planner/tsdown.config.ts` (`alwaysBundle: ['@dsh-mywork/core']`; то же в `beads-adapter/tsdown.config.ts:21` и `controller/tsdown.config.ts:18`).

Что не так: каждый доменный пакет инлайнит собственную копию `MyWorkError`, поэтому `instanceof` через границу пакета всегда `false`. Ветка `isPreWriteRefusal`, единственная задача которой — вернуть вызывающему действенный код отказа (`STALE_REVISION`/`ENTITY_CYCLE`/`CAPABILITY_UNSUPPORTED`/`ADAPTER_UNAVAILABLE`/`TASK_CONFLICT`), для ошибок порта не срабатывает никогда.

Доказательство (`node .tmp/mw011-vfix-classid.mjs`, exit 0): порт бросает `core.MyWorkError('CAPABILITY_UNSUPPORTED')` → вызывающий видит `code = PLAN_MUTATION_RECOVERY`, `constructor.name = MyWorkError`, `core.isMyWorkError(error) = false`, `error instanceof core.MyWorkError = false`. Пробник S-F4: `TASK_CONFLICT` от порта до записи → `PLAN_MUTATION_RECOVERY`; следом `apply` → `PLAN_MUTATION_RECOVERY` (guard BLOCKER-3 видит неразрешённое создание и больше не даёт повторить часть), `revert` → ok, пауза снята (`admissionHeld=false`), т.е. выход есть, но он один и он выбрасывает план.

Почему важно: транзиентная недоступность бэкенда (`ADAPTER_UNAVAILABLE`) или неподдержанная возможность (`CAPABILITY_UNSUPPORTED`) выглядят как «граф не совпал с интентом», операция уходит в recovery с паузой admission, а до фикса BLOCKER-3 её можно было просто повторить через `apply`. Ни один тест ветку не пинует: фейки бросают `core.MyWorkError`, который планировщик тоже не узнаёт, поэтому ветка не наблюдалась ни разу.

Минимальная правка: распознавать отказ структурно (`error instanceof Error && typeof error.code === 'string' && PRE_WRITE_CODES.has(error.code)`, либо сделать `isMyWorkError` брендовой проверкой по коду, а не `instanceof`) и добавить тест, где порт бросает ошибку из `core`-бандла. Отдельно решить с владельцем, нужен ли операторский «retry» для операции, чьё создание доказуемо не выполнялось.

### NEW-4 — MINOR (отчётность): несуществующий якорь в §3

`.work/reports/MW-011-plan-mutations.md:41` — «`service.ts:3186`». В `packages/planner/src/service.ts` **1201** строка, такой строки нет; цитируемый код — `service.ts:377-389`. §3 назван в отчёте главным, поэтому битый якорь в строке про BLOCKER-1 — дефект evidence-of-record (класс MINOR-6).
Минимальная правка: заменить на `service.ts:377-389`.

### NEW-5 — NIT (отчётность): число строк `planner/src/service.ts`

`.work/reports/MW-011-plan-mutations.md:106` — «`src/service.ts` (~1290)»; фактически **1201** строка (отчёт изменился после правок, «~» на 7 % не спасает).
Минимальная правка: поставить 1201 (или снять число).

### NEW-6 — NIT (scratch-скрипт): комментарий к M11a противоречит измеренному результату

`.tmp/mw011-mutations.ps1:100-102` объявляет M11a «записанной как EQUIVALENT, not missed», тогда как `.tmp/mw011-mutation-results.txt:11` и §3/§6.2 отчёта фиксируют `CAUGHT (49/1)` — и мой собственный M1a это воспроизводит (49/1, ловит проверка журнала в новом тесте). Отчёт прав, комментарий устарел.
Минимальная правка: поправить комментарий (файл вне Git, влияния на репозиторий нет).

---

## 4. ПРОВЕРЕННЫЕ КОМАНДЫ

| Команда | Exit | Наблюдение |
|---|---|---|
| `git rev-parse HEAD` | 0 | `f22dbc3b2eb97601e09fc4f341bcddd522544545` = base SHA, до и после моей работы |
| `git status --short` | 0 | 12 M + 6 новых путей карточки + `DSH-MyWork.rar`; набор не изменился за мою сессию, коммитов нет |
| `pnpm run check` | 0 | `349 tests / 326 pass / 0 fail / 23 skip` — совпадает с §5 и с ожиданием задания |
| `node --test --test-isolation=none tests/plan-mutation.test.mjs` | 0 | `50 pass / 0 fail` (1024→1334 мс на разных прогонах) — совпадает |
| `node --test --test-isolation=none tests/lease.test.mjs` | 0 | `25 pass / 0 fail` |
| `node --test --test-isolation=none tests/beads-adapter.test.mjs` | 0 | `68 tests / 45 pass / 0 fail / 23 skip` |
| `node --test --test-isolation=none tests/lease.test.mjs tests/beads-adapter.test.mjs tests/evidence.test.mjs` | 0 | `112 tests / 89 pass / 0 fail / 23 skip` — воспроизводит §5 |
| `node --test --test-isolation=none tests/lease.test.mjs tests/beads-adapter.test.mjs tests/evidence.test.mjs tests/events.test.mjs` | 0 | `116 tests / 93 pass / 0 fail / 23 skip` — регрессии чистые |
| `node .tmp/mw011-vfix-probe.mjs` (мой пробник, 41 проверка, публичный API) | 1 | `38/41`: проходят все сценарии блокеров (S-A, S-B-граф, S-C, S-D/S-D2, S-E/S-E2, S-F1/F2/F2b/F3/F3b, S-I, S-J, S-K, S-L); падают ровно три находки — S-B (журнал), S-F4 (код отказа), S-G (атомарный журнал) |
| `node .tmp/mw011-vfix-classid.mjs` | 0 | порт `CAPABILITY_UNSUPPORTED` → `PLAN_MUTATION_RECOVERY`; `core.isMyWorkError(error)=false` при `constructor.name=MyWorkError` |
| `pwsh -NoProfile -File .tmp/mw011-vfix-mutations.ps1` | 0 | M1a 49/1 CAUGHT · M1b 50/0 NOT-CAUGHT (эквивалентна) · M2a 49/1 · M2b 49/1 · M3 48/2 · M4 49/1 · M5 49/1 · M6 49/1; восстановление из копии и `pnpm run build` дают SHA-256 бандлов, идентичный исходному |
| `git diff --numstat` | 0 | совпадает с §7 отчёта по всем 12 строкам |
| Подсчёт строк новых файлов (`Get-Content … .Count`) | 0 | `contracts/plan.ts` 502, `contracts/workflow.ts` 152, `core/plan.ts` 1094 (~1090 в отчёте), `core/blocker.ts` 157, `planner/store.ts` 614, `tests/plan-mutation.test.mjs` 1732/50 тестов; `planner/service.ts` 1201 (в отчёте ~1290 — NEW-5) |
| `node --test … tests/plan-mutation.test.mjs` после restore+rebuild | 0 | `50 pass / 0 fail` — дерево зелёное после breaking-проверок |
| `pnpm ls -r --depth -1` | 0 | 9 пакетных проектов + корень = 10 workspace-проектов, `@dsh-mywork/planner` слинкован (§5) |

**Границы изменения файлов.** Ломались только собранные `packages/{core,planner}/lib/index.js`; оба восстановлены из копии (SHA-256 совпал), затем `pnpm run build` воспроизвёл исходные байты (SHA-256 совпал снова). Исходники `packages/`, `tests/`, `scripts/` не менялись; вне `.tmp/` создан только этот файл.

---

## 5. ЧТО ОСТАЛОСЬ НЕПРОВЕРЕННЫМ И ПОЧЕМУ

1. **Живой `bd`** — вне объёма задания: staged-механика и BLOCKER-2 проверены на собственных детерминированных портах, а не на реальном Beads; вывод NEW-3 про реальный адаптер следует из инлайна ядра в его бандле (прочитан конфиг), но не из живого прогона.
2. **`pnpm run verify:profile`, `pack:local`** — вне объёма (публикационный путь).
3. **Полная батарея исполнителя (15 мутаций)** — не перезапускалась: я прочитал `.tmp/mw011-mutations.ps1` и его вывод `.tmp/mw011-mutation-results.txt` (15/15 CAUGHT, числа совпадают с §6.2) и прогнал **свои** 8 мутаций по тем находкам, которые задание назвало самыми рискованными, плюс MAJOR-5 и MINOR-9.
4. **`tests/plan-mutation.test.mjs` не читался построчно** — прочитаны харнесс (строки 1-270, 665-704), все 10 новых тестов и участки, релевантные находкам; секции о гейтах и предложениях — только по именам.
5. **Поведение `isPreWriteRefusal` с настоящим адаптером** — измерено только на порте-фейке, бросающем `core.MyWorkError` (и на planner-produced ошибке); для Beads-адаптера вывод сделан по конфигу бандла, а не наблюдением.
6. **Содержимое `~/.dsh`** — не читалось (ограничение «не трогать живой профиль»): проверены только mtime и отсутствие карточки среди записанных путей; отличить сессионные записи самой сессии DSH от чего-либо ещё я не мог.
7. **Первоначальные 12 находок не переразбирались** по существу — проверялась дельта: реальность исправления, его удержание тестами и отсутствие новых дефектов.
