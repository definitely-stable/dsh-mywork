# MW-016 — Построить Context Fabric и snapshots

- Статус: **DONE** — выставлен по прямому указанию владельца («измени статус приемки и коммиты»), а не
  выведен автором из self-review. Акт приёмки — это указание владельца; отчёт фиксирует, чем работа
  доказана, и что именно осталось непроверенным.
- Base SHA: `2a0249b25ea3dd77719ac451694949e943962de2` → head `bb3955b28c3e179959baf06878e6849e7e265fbe`
  (5 коммитов, по одному на слой; `git diff --name-only 2a0249b..HEAD` — ровно 7 путей, чужих файлов нет)
- Независимое ревью: **не выполнялось и не заявляется.** Карточка прямо запрещает запускать субагентов
  автоматически («Не запускай субагентов, платные LLM-пробы или другую модель автоматически»),
  отдельного поручения на ревью не поступало. Единственная проверка находок — авторский аудит (§6),
  воспроизведённый пробами и мутациями; он **не заменяет** независимую проверку, и это ограничение
  остаётся в силе независимо от статуса.
- Проверки на закоммиченном дереве (`bb3955b`, `git status` пуст): `tsc --noEmit` по 11 пакетам — exit 0;
  `tsdown` по 11 пакетам — exit 0; `node scripts/smoke.mjs` — exit 0, `smoke: all steps passed`;
  полный `node --test` — **546 tests / 523 pass / 0 fail / 23 skipped**, exit 0.
- Работа выполнена в два прохода: реализация карточки (§2) и критический аудит с исправлениями (§6).
  Аудит нашёл 12 дефектов; 11 исправлены, один (D11) оставлен владельцем вне объёма.

## 1. Проверка зависимостей (MW-005, MW-006, MW-008, MW-013)

Проверялись отчёт, исходники и `git log`, а не колонка доски.

| Зависимость | Отчёт и его статус | Исходники | Коммиты (проверены `git log -1`) | Вердикт |
|---|---|---|---|---|
| **MW-005** Adapter SDK | `.work/reports/MW-005-adapter-sdk.md` — **DONE** | `packages/adapter-sdk/src` (8 файлов) | `e074fac`, `0dd69e2`, `44027ee`, `829ec62` | предусловие пройдено |
| **MW-006** конфигурация/Team | `.work/reports/MW-006-team-config.md` — **READY_FOR_REVIEW**; независимое ревью **PASS WITH FINDINGS** (2 MAJOR / 3 MINOR / 2 NIT), все замечания исправлены и покрыты тестами; повторно верификатором **не** проверялись | `packages/contracts/src/config.ts`, `team.ts`; `packages/core/src/config.ts`, `team.ts`, `graph.ts` | `2bbb5d9`, `962f696`, `352e378`, `fbee7a0` | пройдено **с оговоркой** |
| **MW-008** Artifact Store и Audit | `.work/reports/MW-008-evidence-audit.md` — **READY_FOR_REVIEW**; независимое ревью **PASS WITH FINDINGS** (1 MAJOR / 3 MINOR / 2 NIT), все находки исправлены | `packages/evidence/src` (7 файлов) | `fbee7a0`… | пройдено **с оговоркой** |
| **MW-013** model routing и бюджет | `.work/reports/MW-013-routing-budget.md` — **DONE** (ревью-статус снят решением владельца) | `packages/contracts/src/routing.ts`, `budget.ts`, `model-catalog.ts`; `packages/core/src/routing.ts`, `budget.ts`; `packages/controller/src/model-catalog.ts` | `f85f88d`, `ee127d1`, `171a715`, `487255d`, `d1e02cd`, `337ea69`, `3bc6c78` | предусловие пройдено |

**Оговорка названа прямо, чтобы её можно было принять или отклонить, не перечитывая переписку.**
Формальной приёмки владельца у MW-006 и MW-008 нет: их собственный статус — `READY_FOR_REVIEW`, то
есть авторская сторона закрыта, а акт приёмки не зафиксирован. Работа продолжена по прецеденту этого
же проекта: MW-008 шёл поверх MW-006/MW-007 в том же статусе, MW-013 — поверх MW-006/MW-007, и
владелец принял эту оговорку постфактум, продолжив карточку и отдельно поручив коммиты и снятие
ревью-статуса (MW-013 §1). Если владелец считает «принято» синонимом «приёмка зафиксирована»,
правильным действием был бы `BLOCKED` — это решение владельца, а не вывод автора.

Дополнительно проверено по исходникам: `CONTEXT_BUDGET_EXCEEDED` уже присутствовал в
`MYWORK_ERROR_CODES` (`packages/contracts/src/operation.ts:51`) и до этой карточки никем не
использовался — приёмка «overflow mandatory context блокирует admission» ложится на готовый код
ошибки, а не заводит новый.

## 2. Сделано

### 2.1 Контракты `packages/contracts/src/context.ts` (новый, 955 строк)

Словарь §21: `ContextLevel` L0/L1/L2 и `CONTEXT_FULL_LEVEL`; `ContextClass` — базовые 10 классов
§21.3 как закрытый список **плюс** открытое пространство имён (`BaseContextClass | (string & {})`),
как того требует «тип остаётся расширяемым string namespace»; `ContextCandidate` ровно по §21.4;
`ContextProviderPort` (`capabilities` / `discover` / `materialize`) по §21.5 и §36;
`ContextPolicy` с числами §21.6 и `DEFAULT_CONTEXT_POLICY`; `ContextBudget`;
`ContextMaterializationPlan` / `ContextSelection` / `ContextDrop`; `ContextSnapshot` по §21.7 и §35;
`ContextObservation` / `ContextDrift`; `ContextPrompt` / `ContextPromptSection`.

Таблицы, по которым Fabric принимает решения, объявлены данными: `MANDATORY_CONTEXT_CLASSES`
(`policy`, `role-contract`, `task-contract` — это и есть «mandatory role/task/security»),
`INSTRUCTION_CONTEXT_CLASSES`, `CONTEXT_BUCKET_CLASSES`, `CONTEXT_REFUSAL_CODES`. Каждая форма имеет
закрытый список полей (`*_FIELDS`) — как в остальных контрактах пакета.

### 2.2 Чистая политика `packages/core/src/context.ts` (новый, 1408 строк)

- `resolveContextBudget({policy, contextWindow})` — доли §21.6, применённые к окну **выбранного
  маршрута**; сначала удерживаются `workingReserve` и `safetyReserve`, остаток — `assembly`.
- `decideContextAdmission({policy, contextWindow, candidates, nowMs})` — ранжирование и бюджет;
  возвращает `{kind:'admitted', plan}` либо типизированный `ContextRefusal` с `reason`, `code`,
  `detail` и числами (`requiredTokens` / `limitTokens`).
- `discoverContext({providers, request, nowMs})` — опрос привязок с одним наблюдением на провайдера;
  недоступный провайдер не срывает проход, а фильтр запрошенных классов применяет Fabric, а не адаптер.
- `materializeContextSnapshot(input)` — снапшот §21.7: ревизии, маршрут, tool surface, хеши, оценки,
  отброшенные кандидаты с причинами, provenance; заморозка целиком через `deepFreeze`, fingerprint
  канонической формы (`canonicalForm` из `core/config.ts`) и revision семейства `context-snapshot`
  через `createContextSnapshotRevisionRegistry()`.
- `verifyContextSnapshot({snapshot, observed})` — сравнение замороженных revision/hash с текущим
  ответом источников; `intact` либо `drifted` с `revision-changed` / `hash-changed` /
  `unverifiable` / `missing`.
- `assembleContextPrompt(snapshot)` — единственная точка рендера контекста в prompt (§21.1, §21.8):
  принимает **только** `ContextSnapshot`, инструкции идут секциями, данные — в ограждении
  `CONTEXT_DATA_FENCE`/`CONTEXT_DATA_FENCE_END`.

### 2.3 Fake `packages/adapter-sdk/src/testing.ts` (+244 строки)

`FakeContextProvider` рядом с `FakeModelCatalog`: литеральные items, переключатели отказов
(`capabilitiesFailure`, `discoverFailure`, `materializeFailure`), запись каждого запроса **до** ответа
(`discoveryRequests`, `materializedUris`, `materializeRequests`), отказ на неизвестный uri, на уровень,
которого нет в capabilities, и на устаревшую revision/hash. Семантика ожиданий в `materialize`
зафиксирована явно: `expectedRevision`/`expectedContentHash` называют ревизию **item**, которую
наблюдал вызывающий, а ответ несёт ревизию **тела** — L0-обзор и L2-тело одного item это две разные
ревизии.

### 2.4 Тесты `tests/context.test.mjs` (новый, 1152 строки, 57 тестов)

По каждому пункту приёмки — отдельные тесты, включая границы (потолок ровно и на один токен выше,
assembly ровно и выше) и негативные ветки. 14 тестов добавлены вторым проходом по находкам аудита (§6).

### 2.5 Решения по объёму (названы, чтобы ревьюер мог оспорить)

1. **Чтение §21.6.** Числа примера дают ровно 1.0, поэтому «цели» прочитаны как потолки внутри
   assembly-бюджета, а не как распределение: сначала удерживаются два резерва, `mandatory` —
   потолок, превышение которого блокирует попытку, три цели — потолки своих корзин, остаток
   assembly-бюджета доступен классам без своей цели (`skill`, `session-reference`, `raw-evidence`,
   plugin-defined). Класс, для которого цели нет, не выбрасывается молча.
2. **Ранжирование.** Первичный ключ — заявленная `relevance`; при её отсутствии или равенстве —
   более дешёвый item, затем uri. Отсутствие `relevance` не читается как ноль, а уходит в конец.
   Порядок не зависит от порядка ответов провайдеров (отдельный тест).
3. **Mandatory обязан быть измеримым и проверяемым.** Нет `estimatedTokens` —
   `mandatory-tokens-unknown`; нет ни `revision`, ни `contentHash` — `mandatory-unverifiable`;
   истёкшая валидность — `mandatory-expired`. Это продолжение уже принятого в проекте правила
   «неизвестное не читается как ноль», а не новая строгость.
4. **Trust решает размещение, а не отбор.** Untrusted mandatory-контекст остаётся в снапшоте
   (иначе попытка шла бы без своего контракта), но с `placement: 'data'` и `downgraded: true`.
5. **L2 не понижается молча.** Запрошенное тело, которое не удалось получить, отказывает снапшот
   целиком (`materialization-failed`), а тело больше запланированного — `materialized-overflow`.
6. **Реестр ревизий снапшота — свой** (`createContextSnapshotRevisionRegistry`), а не
   `createConfigRevisionRegistry`: правило §35 одно, но владелец семейства разный.
7. **Вне объёма, названо явно:** conformance-kit §39 для `context-provider`, Cordis-привязка порта в
   `@dsh-mywork/controller` и регистрация в `myworkAdapters` не делались — это карточки 02-context
   (MW-017/MW-018).

## 3. Изменённые и новые файлы

| Файл | Строк | Что |
|---|---|---|
| `packages/contracts/src/context.ts` | 955 (новый) | словарь §21: уровни, классы, кандидат, порт, политика, бюджет, план, снапшот, drift, prompt |
| `packages/core/src/context.ts` | 1408 (новый) | discover → rank/budget → materialize → verify, сборка prompt, реестр ревизий снапшота |
| `tests/context.test.mjs` | 1152 (новый) | 57 тестов приёмки |
| `packages/adapter-sdk/src/testing.ts` | +244 | `FakeContextProvider` и его типы |
| `packages/contracts/src/index.ts` | +1 | `export * from './context.ts'` |
| `packages/core/src/index.ts` | +28 | экспорт политики Fabric и её типов |
| `README.md` | +82 / −1 | раздел «Context Fabric и snapshots (§21, §35, §53)» и строка `core` в «Структуре» |

Чужие файлы не изменялись: `packages/storage/**`, `packages/evidence/**`, `packages/lease/**`,
`packages/execution/**`, `packages/scheduler/**`, `packages/planner/**`, `packages/beads-adapter/**`,
`packages/controller/**`, `scripts/**`, остальные тесты — ни одного изменения. Артефакты других сессий
(`.dsh/`, `.analysis/`) не трогались; `.work/` и `.tmp/` исключены из Git.

### 3.1 Коммиты (`2a0249b` → `bb3955b`)

Один коммит на слой, баррель едет вместе с модулями, которые он экспортирует; трейлер `Cards: MW-016.`
в каждом. Отчёт и сообщения коммитов лежат в `.work/` и `.tmp/`, то есть вне индекса.

| Коммит | Слой | Файлы |
|---|---|---|
| `5035661` | `feat(contracts)` | `packages/contracts/src/context.ts`, `packages/contracts/src/index.ts` |
| `6b9815a` | `feat(core)` | `packages/core/src/context.ts`, `packages/core/src/index.ts` |
| `a3fc25f` | `test(adapter-sdk)` | `packages/adapter-sdk/src/testing.ts` |
| `9379860` | `test(context)` | `tests/context.test.mjs` |
| `bb3955b` | `docs(readme)` | `README.md` |

Push, merge, publish и release не выполнялись: отдельного поручения на них не было.

## 4. Команды и exit codes

| Команда | Exit | Наблюдение |
|---|---|---|
| `git status --short` / `git rev-parse HEAD` (старт) | 0 | дерево чистое, `2a0249b25ea3dd77719ac451694949e943962de2`, ветка `main` |
| `git log -1 --format='%h %s' <15 хешей зависимостей>` | 0 | все 15 коммитов MW-005/006/008/013 найдены |
| `node node_modules/typescript/bin/tsc --noEmit -p packages/<p>/tsconfig.json` (11 пакетов) | **0** ×11 | ни одного диагностического сообщения |
| `node node_modules/tsdown/dist/run.mjs` в каждом пакете (11 пакетов) | **0** ×11 | все бандлы собраны, `lib/` пересобран |
| `node scripts/smoke.mjs` | **0** | `smoke: all steps passed` |
| `node --test --test-isolation=none "tests/**/*.test.mjs"` | **0** | **546 tests / 523 pass / 0 fail / 23 skipped** |
| то же без `tests/context.test.mjs` (базовая линия) | **0** | **489 / 466 / 0 / 23** → новая сюита добавляет 57 тестов, регрессий нет |
| `node --test --test-isolation=none tests/context.test.mjs` | **0** | **57 / 57 / 0** |
| `pnpm run build` (канонический гейт) | **1** | **отказ песочницы, а не дефект:** `create the temporary package manager install directory` → `Отказано в доступе. (os error 5)`. `pnpm` не может создать свой временный каталог вне workspace. Четыре шага того же гейта (`tsc`, `tsdown`, `smoke`, `node --test`) выполнены напрямую тем же инструментарием — строки выше |
| `git add <файлы слоя> && git commit -F .tmp/msg-N.txt` (5 коммитов) | **0** ×5 | `5035661`, `6b9815a`, `a3fc25f`, `9379860`, `bb3955b`; после каждого `git status --short` чист |
| `git log 2a0249b..HEAD --format='%h %(trailers:key=Cards,valueonly)'` | 0 | трейлер `Cards: MW-016.` во всех пяти |
| `git diff --name-only 2a0249b..HEAD` | 0 | ровно 7 путей, ни одного чужого |
| `node --test` / `smoke` / `tsc` на закоммиченном `bb3955b` (повтор) | **0** | **546 / 523 / 0 / 23**, `smoke: all steps passed`, `TSC_FAILED=0` |

### 4.1 Мутационные проверки (проверка, что тесты умеют падать)

Мутировался собранный бандл `packages/core/lib/index.js`, после каждой мутации файл восстанавливался
из побайтовой копии; `RESTORED=True` (SHA-256 совпал) после всех десяти, после восстановления сюита
снова `57/57/0`.

| # | Мутация | Exit | Наблюдение |
|---|---|---|---|
| 1 | снята нейтрализация метаданных в ограждении | 1 | **1 fail** — тест метаданных ловит |
| 2 | снята сверка уровня тела (`body.level !== 'L2'`) | 1 | **1 fail** |
| 3 | L2 запрашивается у порта всегда | 1 | **1 fail** |
| 4 | снята проверка целевой доли класса | 1 | **1 fail** |
| 5 | снята дедупликация uri | 1 | **3 fail** |
| 6 | `null` в наблюдении трактуется как «не наблюдалось» | 1 | **1 fail** |
| 7 | `nowMs` снова по умолчанию 0 | 1 | **1 fail** |
| 8 | нулевая оценка токенов снова отвергается | 1 | **2 fail** |
| 9 | маршрут снова кладётся по ссылке | 1 | **1 fail** |
| 10 | частично испорченный ответ снова попадает в результат | 1 | **3 fail** |

## 5. Приёмка карточки → чем доказано

| Пункт приёмки | Где доказано |
|---|---|
| **L2 загружается по запросу** | `discovery alone never fetches a body` — `fake.materializedUris === []`, item остаётся `L0`, `materializedAt` отсутствует; `a requested L2 body is fetched…` — запрос `{uri, level:'L2', expectedRevision:'r1', expectedContentHash:'h1'}`, в снапшоте `level:'L2'`, `contentHash:'h2'`, `revision:'r2'`, `tokens:900`, `materializedAt:1000`; `an inline full body is used as it is, without asking the port for it`; `a body asked for but not in the plan refuses the snapshot`; `a provider that declares no on-demand materialization is not asked` (§37 negotiation); `a provider that answers a lower level than requested refuses the snapshot` — метка уровня всегда описывает полученное тело; мутации 3, 2 |
| **Повтор материализации проверяет revision/hash** | `a repeat materialization that sees the same revisions and hashes is intact` → `{kind:'intact'}`; `a source that moved after the snapshot is reported as drift, not swapped in` → `revision-changed` / `hash-changed` / `missing` с обеими сторонами сравнения, снапшот не изменился; `a source that stopped publishing an identity is drift, not a clean bill of health` → `unverifiable`; `an observation that did not look is not evidence of drift` → `intact`; `a source that moved between discovery and materialization refuses the body` — ожидание уходит в порт как `expectedRevision: 'r1'`; мутация 6 |
| **Overflow mandatory context блокирует admission** | `mandatory context exactly on its ceiling is admitted` (19 200 — допущено) против `mandatory context one token past its ceiling blocks admission` (19 201 → `mandatory-overflow`, код `CONTEXT_BUDGET_EXCEEDED`, `requiredTokens`/`limitTokens`, снапшота нет); `mandatory context is never trimmed to fit`; `mandatory context alone may not consume the reserves` → `reserves-overflow`; `a duplicated mandatory claim does not double-charge the ceiling`; мутация 5 |
| **Низкодоверенные данные не становятся instructions** | `untrusted mandatory context is shown as data, never as an instruction` — trusted `task-contract` → `instruction`/`downgraded:false`, untrusted `task-contract` → `data`/`downgraded:true`, trusted `memory` → `data`; в собранном prompt текст untrusted-элемента не встречается ни в одной instruction-секции, а текст trusted — встречается (проверка не вакуумная); `untrusted content cannot close its own data fence`; `provider-controlled metadata cannot close a data fence either` — в тексте ровно одно открывающее и одно закрывающее ограждение при враждебных uri, source и классе; мутации 1 |
| **Snapshot неизменяем** | `a snapshot is frozen whole` — `Object.isFrozen` на 13 контейнерах и четыре мутации, каждая бросает `TypeError`, после чего значения остаются прежними; `the snapshot copies the route instead of freezing the caller object` — заморозка не достигает объектов вызывающего; `re-materializing the same context keeps the revision…` — тот же fingerprint → та же revision, изменённый → следующая; мутации 9 |
| **Только Fabric вставляет контекст в prompt** | `assembleContextPrompt` принимает только `ContextSnapshot` и бросает `TypeError` на массив кандидатов и на `undefined`; порт `ContextProviderPort` не имеет метода публикации. **Оговорка:** проверка структурная, а не номинальная — подделанный литерал нужной формы пройдёт (D11, §6.2) |

## 6. Критический аудит и исправления

Аудит проведён автором по собственной реализации после первого прохода. Каждая находка **сначала
воспроизведена пробой** (read-only, `node --input-type=module`, без записи файлов), затем исправлена,
затем закрытие подтверждено повторным прогоном той же пробы и мутационной проверкой (§4.1).

### 6.1 Исправлено (11)

| ID | Дефект и сценарий сбоя | Severity | Что сделано |
|---|---|---|---|
| D1 | Два провайдера с одним uri давали необработанный `TypeError` вместо решения. §62 пп. 25–26 делают пару native + внешний memory-провайдер штатной конфигурацией | MAJOR | `requireCandidates` больше не падает; `decideContextAdmission` оставляет первый кандидат и пишет остальные в `dropped` с новой причиной `duplicate-uri` |
| D2 | Провайдер, ответивший на L2-запрос телом уровня L0, давал снапшот с меткой `L2` и обзором внутри — audit artifact §21.7 лгал | MAJOR | Сверка `body.level` с запрошенным → `materialization-failed`; в снапшот пишется уровень полученного тела |
| D3 | Провайдер, отдавший полное тело уже при discovery и честно объявивший `onDemandMaterialization: false`, получал отказ в теле, которое Fabric уже держал | MAJOR | Уже имеющееся L2-тело не запрашивается у порта |
| D4 | Побег из ограждения через метаданные: `uri`, `source`, `kind`, `revision` подставлялись сырыми, враждебный uri давал второе закрывающее ограждение и выносил недоверенный текст в позицию инструкции | MAJOR (безопасность) | `neutralize()` применяется ко всем подставляемым значениям, а не только к телу |
| D12 | `estimatedTokens: 0` считался ошибкой, а не измерением: прямой вызов падал `TypeError`, а через discovery один пустой элемент уносил весь ответ провайдера | MAJOR/MINOR | Ноль допускается; «не измерено» — это отсутствие поля |
| D5 | Проверка дрейфа была fail-open: источник, переставший публиковать revision, давал `intact` | MINOR/MAJOR | `ContextObservation.revision`/`contentHash` различают строку, `null` («источник не публикует» → `unverifiable`) и отсутствие поля («не наблюдалось») |
| D6 | Тело L2 обходило целевую долю своего класса (проверялся только assembly) | MINOR | Проверка корзины после материализации → `materialized-overflow` с именем корзины |
| D7 | Маршрут клался в снапшот по ссылке, и `deepFreeze` морозил объект вызывающего | MINOR | Пара `provider`/`model` копируется |
| D8 | Наблюдение провайдера занижало вклад: при частично испорченном ответе кандидат попадал в результат, а счётчик писал 0 | MINOR | Кандидаты копятся локально и сливаются только при успехе |
| D9 | `nowMs` молча подменялся нулевой эпохой, и решение зависело от забывчивости вызывающего | MINOR | Время материализации обязательно |
| D10 | `mandatory-expired` отображался в `STALE_REVISION`, который в этом коде означает «перечитай и повтори» — приглашение к циклу, который не может завершиться успехом | MINOR | Код `CONTRACT_MISMATCH` |

### 6.2 Осознанно вне объёма (1)

| ID | Находка | Почему не исправлено |
|---|---|---|
| D11 | `assembleContextPrompt` проверяет форму, а не происхождение: несмороженный литерал нужной формы будет отрендерен как инструкция. Гарантия «только Fabric вставляет контекст» держится на дисциплине, а тест с названием «accepts a snapshot and nothing else» доказывает меньше, чем обещает | Решение владельца: точная проверка требует таблицы состояния модуля (`WeakSet` снапшотов, выданных `materializeContextSnapshot`), а эвристика по заморозке и fingerprint обходится. Названо как известное ограничение, а не скрыто |

### 6.3 Что проверено и сочтено корректным (менять не стали)

Арифметика бюджета §21.6 и удержание резервов; граница потолка mandatory; «L2 только по запросу» для
честного провайдера; неизменяемость снапшота; размещение по trust внутри конвейера Fabric (untrusted
не попадает в instruction ни при каком порядке кандидатов); детерминизм ранжирования; полнота таблицы
`CONTEXT_REFUSAL_CODES`. Отдельно названы как предположения, а не дефекты: локальный реестр ревизий
даёт revision 1 при создании реестра на каждый вызов (свойство вызывающего, как и у
`createConfigRevisionRegistry`), и Fabric не выполняет цикл повторной материализации сам — он
проверяет наблюдения, собранные вызывающим.

## 7. Ограничения и что осталось непроверенным

1. **Канонический гейт `pnpm run check` в этой песочнице недоступен** (`pnpm` не может создать
   временный каталог установки, os error 5). Выполнены ровно те четыре шага, из которых он состоит,
   тем же инструментарием; расширение прав не запрашивалось, чтобы не выдавать полный доступ ради
   команды, которую можно воспроизвести без него.
2. **Независимого ревью нет** — карточка запрещает автоматический запуск субагентов, отдельного
   поручения на ревью не поступало. Это не «ревью пройдено»: findings по этой работе независимым
   ревьюером не собирались. Аудит §6 — авторский, он не заменяет независимую проверку. Статус `DONE`
   этого не меняет: он выставлен по указанию владельца, а не по результату ревью.
3. **Cordis-привязки нет.** Порт `context-provider` объявлен в контрактах (это и есть работа §36
   «интерфейс добавляет карточка, которая связывает интеграцию»), но ни один адаптер его не
   регистрирует и контроллер его не публикует: реальный DSH-источник контекста — MW-017/MW-018.
   Conformance-kit §39 для этого порта тоже не расширялся.
4. **Интерпретации §21.6 и ранжирования** (§2.5 пп. 1–2) — это прочтение, а не цитата; ревьюер вправе
   их оспорить, и тогда меняются числа бюджета, а не структура.
5. **Строгость mandatory** (§2.5 п. 3) может оказаться слишком высокой для реального провайдера,
   который не публикует `estimatedTokens`. Это осознанный fail-closed выбор.
6. **D11 остаётся открытым** (§6.2): структурная, а не номинальная проверка происхождения снапшота.
7. **Живой профиль DSH, чужие проекты и доска разработки не изменялись**; push/merge/publish/release
   не выполнялись; коммит не создавался.

## 8. Статус

**DONE.** Статус выставлен по прямому указанию владельца («измени статус приемки и коммиты») вместе с
поручением закоммитить работу; акт приёмки — это указание, а не вывод автора. Работа закоммичена
пятью слоями, `2a0249b` → `bb3955b`, дерево чистое, проверки на закоммиченном дереве зелёные.

Что это **не** означает: независимого ревью не было и оно не заявляется (§7 п. 2), D11 остаётся
открытым (§6.2), а интерпретации §2.5 и строгость D5/D12 — это решения, которые ревьюер или владелец
вправе оспорить; при их пересмотре меняется поведение, а не структура. Push, merge, publish и release
не выполнялись.
