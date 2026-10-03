# MW-015 — Реализовать DSH AgentRuntime и Session adapters

- Карточка: `.work/tasks/MW-015.md`, этап `01-runtime`, Board ID `122cfc2c-e60d-4e0c-abe8-23cb186ada2a`, обязательные пункты §62: **7** (DSH model/provider selection) и **22** (Task-scoped Sessions).
- Base SHA: `02e864449b9060bcfb03232b9c9694be1bc62b12`. Head SHA: `2a0249b25ea3dd77719ac451694949e943962de2` (4 коммита, §10). **Коммиты выполнены по отдельному поручению владельца.** Push/merge/publish/release не выполнялись.
- Архитектура: §21 (Context Fabric), §22 (Session/Episode), §29 (Model Routing), §31 (Security), §36 (Stable Ports), §39 (Adapter Conformance Kit). Примеры API сверялись с реальным SDK (checkout `C:\Reposit\deepseek-harness\deepseek-harness`, который и есть живой runtime) и с живым Host через Inspect.
- Статус: **DONE** — статус переведён из `READY_FOR_REVIEW` в `DONE` по прямому указанию владельца (сессия MW-020, «поменять все карточки с подобной оговоркой»). Акт приёмки — это указание владельца, а не вывод автора. Независимое ревью проведено: **PASS WITH FINDINGS** (0 BLOCKER/MAJOR, 5 MINOR + 2 NIT). Findings F1–F4, F6, F7 закрыты правками (§6), F5 закрыт до вынесения вердикта. **Приёмка не отменяет оговорку:** правки по findings независимо не перепроверялись — отдельный проход верификации владельцем не поручался. Все числа §4 сняты на закоммиченном дереве.

## 1. Проверка зависимостей (по исходникам и отчётам, а не по колонке доски)

| Зависимость | Отчёт | Артефакты в дереве | Вердикт |
|---|---|---|---|
| **MW-005** Adapter SDK, registry, conformance | `reports/MW-005-adapter-sdk.md`, статус **DONE**, независимое ревью в §8 | `packages/adapter-sdk/src` (9 файлов), коммиты `e074fac`, `0dd69e2`, `44027ee`, `829ec62`, `487255d` | предусловие пройдено |
| **MW-007** permissions/границы (§31) | `reports/MW-007-security.md`, статус **READY_FOR_REVIEW**; раунд 1 `PASS WITH FINDINGS`, раунд 2 `FIXES PARTIALLY VERIFIED`; правки V1–V11 независимо не перепроверялись | `packages/contracts/src/security.ts` (в т.ч. `HarnessPolicy`, `HARNESS_POLICIES`), `packages/core/src/security.ts`, `tests/security.test.mjs`; коммит `fadb578` | **пройдено с оговоркой** — см. ниже |
| **MW-013** routing + budget (§29, §30) | `reports/MW-013-routing-budget.md`, статус **DONE** (ревью-статус снят прямым поручением владельца), evidence — независимое ревью `PASS WITH FINDINGS` + верификация исправлений | `packages/contracts/src/routing.ts` (`ModelRoute`, `ModelPolicy`), `packages/core/src/routing.ts`, `packages/controller/src/model-catalog.ts`; коммиты `ee127d1`, `171a715`, `487255d`, `aefc5fa` | предусловие пройдено |

**Оговорка по MW-007 (зафиксирована, а не скрыта).** MW-007 не имеет формального акта приёмки владельцем: его отчёт остаётся `READY_FOR_REVIEW`. Карточка MW-015 предписывает при непринятой зависимости остановиться с `BLOCKED`. Владелец в этой сессии ответил на прямой вопрос: **продолжать и зафиксировать оговорку** — по прецеденту MW-012/MW-013, где ревьюер квалифицировал ровно эту ситуацию как «честная оговорка, не подмена приёмки» (`MW-013-routing-budget.md`, finding F9). Артефакты MW-007 при этом в дереве, закоммичены и зелёные; используется только его контрактный словарь (`HarnessPolicy`), а не его незавершённые правки. Независимый ревьюер MW-015 отдельно подтвердил это как честную оговорку (§6).

## 2. Что сделано

### 2.1. Порты (§36, §39) — `packages/contracts/src/agent-runtime.ts` (новый, 289 строк)

`AgentRuntimePort` вырос до объёма, который требует §39, и рядом объявлен `SessionPort` (в `port-contract.ts` он значился как имя, интерфейса не было):

- `start` / `resume` / `status` / `stop` / `events`; `AgentRunScope` (agent preset + маршрут + permission policy); `AgentRuntimeHandle` несёт **реальную** идентичность сессии и маршрут, который владелец сессии нормализовал, а не тот, который запросили.
- `SessionPort`: `create` (создание или идемпотентное усыновление явной идентичности) / `events` / `cancel`.
- `SessionEvent` (seq, type, time) — **без payload**: сырые события сессии принадлежат владельцу (§8 authority matrix, домен `session.events`), MyWork читает позиции и типы.
- Курсорная дисциплина зафиксирована в контракте: страница возвращает только позиции выше курсора, курсор не откатывается, повторная позиция не выдаётся дважды (дубликат/позднее событие), результат возрастает по позиции, `hasMore` сообщает об ограничении. Отдельно описана **оконная семантика** ограниченной страницы: владелец отдаёт своё последнее окно, поэтому невыданные позиции могут лежать ниже возвращённого курсора — это и есть то, о чём сообщает `hasMore` (правка по finding F1).

Три решения, которые стоит проверять ревьюеру:

1. **Идентичность сессии авторитетна, `runId` — метка вызывающего** (после перезапуска процесса у MyWork есть и то, и другое: домен `agent.session-ids` принадлежит `mywork-db`).
2. **`stop` = остановить работу, а не уничтожить запись** (§51, решение §6.8 отчёта MW-001): отменяется активный turn, сессия остаётся durable evidence. Hard stop со снятием очереди (`session/updateQueue`, §6.8 п.2) **не реализован** и назван в §7.
3. **Область (scope) выражается agent preset'ом** — это то, что реально нашёл MW-001 (§6.1 п.5): DSH scoped-ит system prompt, dynamic context и tool surface через пресет сессии, per-session allow-list инструментов в API нет. Preset передаётся в `session/create`; маршрут пинится `selectModel`, политика прав — командой `/permission`.

### 2.2. Conformance kit (§39) — `packages/adapter-sdk/src/conformance.ts`

`agentRuntimeChecks` покрывает теперь все семь имён §39 — `create`, `resume`, `stop`, `status`, `late event`, `cancellation`, `process restart` — плюс отказ на дубликат run id; `missing` для `agent-runtime` пуст. `process restart` требует `reopen` (фабрика рантайма над тем же durable владельцем) и **skip'ается с причиной**, если её не дали: kit не выдаёт непроверенное за pass. `scope` — необязательный: conformance против реального деплоя не может требовать выдуманного здесь пресета или маршрута. По findings F2 проверки усилены: `late event` утверждает возрастание позиций и отсутствие дубликата, а `process restart` перечитывает журнал после перезапуска и требует те же позиции (раньше заканчивался тривиальным `cursor >= cursor`, который выполнялся и пустой страницей).

### 2.3. Детерминированные fake'и — `packages/adapter-sdk/src/testing.ts`

`FakeAgentHost` — durable сторона (сессии, логи, пины); `FakeAgentRuntime` не держит состояния вообще, поэтому **второй рантайм над тем же host'ом и есть перезапуск процесса**. Host шумит намеренно (`redeliver`, `emitLate`): курсорная дисциплина — свойство, которое рантайм обязан обеспечивать, а не предполагать. Шум подаётся только в неограниченном чтении: ограниченная страница — это собственное последнее окно владельца, позиционно упорядоченное и ровно запрошенной длины, а реальный владелец не обрезает и не перемешивает одновременно (правка по finding F2).

### 2.4. DSH-привязка — `packages/controller/src/dsh-session.ts` (новый, 817 строк)

`DshSessionAdapter` (`session`) и `DshAgentRuntime` (`agent-runtime`) над тремя живыми Cordis-сервисами DSH, описанными структурно (DSH остаётся вне графа сборки пакета — тот же приём, что в `model-catalog.ts`):

- `sessionController` — `create` (свежая или идемпотентно усыновлённая сессия), `list` (реестр с `running`), `selectModel` (возвращает маршрут, который резолвил деплой), `prompt`, `cancel`, `follow` (открывающий snapshot лога);
- `agents.get(sessionId)` — живой агент, нужный команде;
- `commands.execute(agent, '/permission <preset>', [], signal)` — runtime-энфорсмент прав §31 (та же последовательность, что у production-плагина task-board на этой машине).

`mountDshRuntime` регистрирует оба порта в `myworkAdapters` и снимает их вместе с fiber'ом; отсутствие платформы **сообщается, а не чинится** (как у `llm`-привязки). По finding F4 у портов **разные** карты возможностей: узкая у `session` (create/events/cancel) и полная у `agent-runtime` (плюс resume/status/modelSelection/scoped*), чтобы `registry.resolve('session', {capabilities:['scopedTools']})` получал отказ, а не «да» от адаптера, который этого не умеет.

### 2.5. Проверки — `tests/runtime.test.mjs` (новый, 717 строк, 17 тестов)

§39-набор над fake'ом (с `reopen`, `missing: []`, `skipped: 0`); мутация «сломанный рантайм» — точный список падающих проверок; дубликат/позднее событие на fake'е; отдельный тест на дедупликацию и порядок позиций **выше** курсора (F2); 12 проверок DSH-привязки над записывающим stand-in'ом живых сервисов: реальный session id и нормализованный маршрут, отсутствие пинов без scope, отказ до prompt'а при непровернувшемся permission-пине, resume после перезапуска с повторным пином обоих значений и рабочего каталога, идемпотентный и неразрушающий stop, `invalid-ref` против `unavailable`, отказ `cancel` не класса «нет живого агента» доходит до вызывающего как `unavailable` (F3), курсорная дисциплина и `hasMore`, durable-след пинов (`permission/preset`, `model/selection`), освобождение потока `follow`, «отменённый вызов не доходит до платформы», регистрация/снятие обоих портов и узость манифеста `session` (F4).

### 2.6. Обновлено под выросший порт

`tests/adapters.test.mjs` (набор §39 + «мёртвый» рантайм вместо частично сломанного), `scripts/smoke.mjs` (шаг FakeAgentRuntime: реальная идентичность, события, перезапуск), `packages/contracts/src/index.ts` (порт вынесен в модуль и реэкспортирован), `packages/controller/src/index.ts` (монтирование + публичный реэкспорт).

## 3. Изменённые и новые файлы

| Файл | Строк (+/−) | Что |
|---|---|---|
| `packages/contracts/src/agent-runtime.ts` | 289 (новый) | `AgentRuntimePort`, `SessionPort`, scope/route/handle/status, `SessionEvent(Page)` |
| `packages/contracts/src/index.ts` | +1/−48 | порт вынесен в модуль, добавлен реэкспорт |
| `packages/adapter-sdk/src/conformance.ts` | +158/−13 | семь проверок §39, `reopen`, необязательный scope, усиленные `late event`/`process restart` |
| `packages/adapter-sdk/src/testing.ts` | +333/−30 | `FakeAgentHost`, `FakeAgentRun`, `FakePinnedScope`, выросший `FakeAgentRuntime` |
| `packages/controller/src/dsh-session.ts` | 817 (новый) | `DshSessionAdapter`, `DshAgentRuntime`, `mountDshRuntime`, две карты возможностей, структурные типы DSH |
| `packages/controller/src/index.ts` | +35/−0 | монтирование §22/§39 и публичный реэкспорт |
| `tests/runtime.test.mjs` | 717 (новый) | 17 проверок приёмки |
| `tests/adapters.test.mjs` | +46/−25 | ожидания kit'а под §39 |
| `scripts/smoke.mjs` | +20/−4 | шаг fake-рантайма |

Итого: `6 files changed, 593 insertions(+), 120 deletions(-)` плюс три новых файла. `git status` чист от чужой работы: изменены только файлы этой карточки, `.tmp/` — gitignored scratch, живой профиль DSH, доска и чужие проекты не тронуты.

## 4. Команды и exit codes

| Команда | Exit | Наблюдение |
|---|---|---|
| `git rev-parse HEAD` | 0 | base `02e8644…` → head `2a0249b…` (4 коммита, §10) |
| `pnpm run typecheck` | 0 | 11 пакетов, 0 ошибок |
| `pnpm run build` | 0 | tsdown по всем пакетам |
| `pnpm run check` (на закоммиченном дереве) | 0 | `typecheck && build && smoke && test`; **489 tests / 466 pass / 0 fail / 23 skipped**; `smoke: all steps passed` |
| `git status --short` после коммитов | 0 | пусто — закоммичено ровно 9 путей этой карточки |
| `node --test --test-isolation=none "tests/runtime.test.mjs"` | 0 | **17 tests / 17 pass / 0 fail** |
| `node --test --test-isolation=none "tests/adapters.test.mjs"` | 0 | **15 tests / 15 pass / 0 fail** |
| мутации §5.2 (4 шт., автор) | 1 каждая | каждая ловится названным тестом; после восстановления артефакта — 0 |
| `git diff --numstat`, `Get-Content <file> \| .Count` | 0 | инвентарь §3 снят в момент записи отчёта |

## 5. Evidence

### 5.1. Приёмка карточки → где доказано

| Требование карточки | Доказательство |
|---|---|
| create / resume / stop / status / events | `agentRuntimeChecks` (7/7 имён §39), `tests/runtime.test.mjs`: «the §39 agent-runtime suite covers …», «resume after a process restart …», «stop cancels the turn, is idempotent, and never disposes the session» |
| stop/cancel | там же: `stop` + `cancellation` в наборе; `session.cancel` вызывается дважды идемпотентно; `sessions.has(sessionId) === true` после stop; отказ не класса «нет живого агента» доходит как `unavailable` |
| missing Session | «a session the platform does not know is an invalid reference, not an outage»: `status`/`stop`/`events` → `invalid-ref`; платформенный `gateway/internal` → `unavailable` |
| duplicate/late event | «a duplicate and a late delivery are absorbed by the cursor the port reports» и «a page deduplicates and orders positions the caller has not seen yet» (шум выше курсора); fake-тест с `redeliver`/`emitLate`; `late event` в kit'е утверждает возрастание |
| restart | «resume after a process restart re-asserts the scope on the same real session» + проверка `process restart` в наборе §39 (перечитывает тот же журнал после перезапуска) |
| scoped permissions сохраняются | повторный `/permission workspace-write` на resume; журнал пинов владельца `[model, permission, model, permission]`; durable-событие `permission/preset` в логе сессии |
| model binding сохраняется | `selectModel` вызван дважды с одним маршрутом; handle несёт **нормализованный владельцем** маршрут (`deepseek-v4.1-flash-2026` + `reasoningEffort: max` вместо запрошенного `deepseek-v4.1-flash`); durable-событие `model/selection` |
| реальные session IDs и route | handle.sessionId = `session-dsh-1` (идентичность, которую выдал владелец), route = ответ `selectModel` |
| scoped system prompt / dynamic context / tool surface | scope.agentPreset уходит в `session/create` и переутверждается на resume; ограничение интерпретации названо в §7 |
| FakeRuntime и keyless probe | `FakeAgentHost`/`FakeAgentRuntime` в `adapter-sdk/testing`; живая проба §5.3 |
| платных проверок нет | ни один тест не зовёт модель; живая проба не создавала сессий (`mutations: 0`) |

### 5.2. Мутационные проверки (проверка, которая не умеет падать, — дефект)

Артефакт (`packages/*/lib/*.js`) ломался по одному месту, запускался `tests/runtime.test.mjs`, артефакт восстанавливался из побайтовой копии, и прогон повторялся. После правок по findings повторно прогнаны все четыре мутации — включая те, что раньше **не** ловились:

| Мутация | До правок | После правок |
|---|---|---|
| M1a: снять дедуп/сортировку в `pageOf` (контроллер) | ловится: 1 тест | ловится: тот же тест |
| M1b: снять дедуп в `normaliseEvents` (fake) | **не ловилась: 487/464 зелёные** (finding F2) | ловится: «a page deduplicates and orders positions the caller has not seen yet» |
| M1c: снять `fresh.sort` (fake) | **не ловилась** (finding F2) | ловится: тот же тест |
| M2: заменить охранное условие `cancel` на безусловный `return` | **не ловилась: 487/464 зелёные** (finding F3) | ловится: «stop surfaces a real cancellation outage instead of reading it as "already stopped"» |
| M3: ранний `return` в `#assertScope` | ловится: 4 теста | ловится: 5 тестов |

После каждой мутации артефакт восстанавливался, финальный `pnpm run check` (с пересборкой из исходников) — exit 0. Независимый ревьюер, кроме того, подтвердил восстановление **побайтовым совпадением** со свежей сборкой (`sha256`), а M1a и M3 воспроизвёл на финальном артефакте.

### 5.3. Keyless probe в живом Host (без модели, без ключа, без мутаций)

Проба выполнена динамическим Cordis-плагином **только с Host-половиной** (одобрение не требовалось), в процессе живого DSH; после пробы плагин снят (`cordis_undefine`, «Removed dynamic Plugin probe-1 and all of its Packages»). Проба не вызывала `create`/`selectModel`/`prompt`/`cancel` — `mutations: 0`.

**Это одноразовый self-report автора, а не воспроизводимый артефакт:** JSON доставлен диагностикой Run (динамическая Host-половина не имеет ни `AbortController`, ни записываемого `fs`), плагин удалён, перечитать нечего. Независимый ревьюер отметил это отдельно; содержательно форма подтверждается исходниками деплоя.

```json
{"services":{"sessionController":"object","agents":"object","commands":"object","llm":"object","sessions":"object","fs":"object"},
 "controllerMethods":{"create":"function","list":"function","selectModel":"function","prompt":"function","cancel":"function","follow":"function"},
 "roster":{"sessions":84,"running":1,"fields":"blank,cwd,projections,running,sessionId,updatedAt"},
 "agentsGet":"function","firstSessionAgent":"live","coldSessionAgent":"undefined",
 "commandsExecute":"function","providers":["deepseek-official","opencode-go"],
 "failures":[],"mutations":0}
```

**Воспроизводимая часть той же проверки** — Inspect-запрос каталога живых сервисов Host (`Service.listService`), который можно повторить в любой момент: `sessionController` присутствует и несёт `create`, `list(_request, signal)`, `selectModel(request)`, `prompt(request, signal)`, `cancel(request)`, `follow(request, signal)`; `commands.execute(agent, line, submittedAttachments, signal)`; `agents.get(id)`; `llm.listProviders()` → `deepseek-official`, `opencode-go`. Именно эта сверка (а не проба) поймала дефект §5.4.

### 5.4. Что проверка поймала в коде

1. **Обязательный сигнал у `prompt`.** Живой `sessionController.prompt` начинается с `signal.throwIfAborted()` (`packages/api/session-controller/src/index.ts:347`), а привязка вызывала `prompt(request)` без сигнала — на живом Host это `TypeError`, а не сессия. Исправлено (`NEVER_ABORTED` вместо отсутствующего аргумента), и stand-in в тестах теперь сам требует `AbortSignal` (`requireSignal`). **Уточнение по finding F6:** для `list` отсутствие сигнала терпимо (`list.ts:127` — `signal?.throwIfAborted()`), так что `TypeError` относится именно к `prompt`; сигнал туда всё равно передаётся — ради единообразия и отмены.
2. **Нормализация страницы** не дедуплицировала и не сортировала позиции — нашли тесты.
3. **Синхронный отказ `follow`** уходил наружу сырой платформенной ошибкой вместо `invalid-ref`/`unavailable` — нашли тесты.

## 6. Независимое ревью: вердикт и правки по findings

Ревью проведено отдельным read-only субагентом (по отдельному разрешению владельца), полный текст — `.tmp/MW-015-review.md`. **Вердикт: PASS WITH FINDINGS** (0 BLOCKER/MAJOR). Ревьюер подтвердил: HEAD = base SHA, коммитов и stash нет, `git status` — ровно 9 заявленных путей, доска и живой профиль не тронуты; §39 покрыт невакуумно (`REQUIRED_CONFORMANCE_CHECKS['agent-runtime']` = ровно семь имён архитектуры, `missing: []`, `skipped: 0`, каждая из восьми проверок умеет падать); `route` — ответ владельца, а не эхо запроса; область переутверждается по значению; `stop` идемпотентен и не разрушает запись; числа §4 воспроизводятся; `NEVER_ABORTED` и освобождение потока `follow` корректны; проглатывание `session/not-found` в `cancel` — **корректная семантика**, а не fallback (ревьюер проверил по исходникам деплоя, что живой `cancel` бросает его ровно тогда, когда `agents.get(sessionId) === undefined`, а `running` в реестре выводится из того же обращения, и случая маскировки не нашёл).

| Finding | Severity | Disposition |
|---|---|---|
| **F1** контракт курсора обещал «never past a position the page did not deliver», а ограниченная страница отдаёт последнее окно | MINOR | **исправлено**: оконная семантика описана на `cursor` и в модульном доке `SessionEventPage`, ложная фраза снята; добавлена ассерция на курсор и на пропуск нижних позиций в ограниченном чтении |
| **F2** дедуп/сортировка fake'а и часть ассерций kit'а не покрыты (M1b/M1c зелёные) | MINOR | **исправлено**: новый тест подаёт шум **выше** курсора и в непозиционном порядке (ловит и дедуп, и сортировку); `late event` в kit'е утверждает возрастание; `process restart` перечитывает журнал; fake не смешивает шум с ограниченным окном |
| **F3** класс ошибки, который проглатывает `cancel`, ничем не закреплён (M2 зелёная) | MINOR | **исправлено**: stand-in получил `cancelFails`, новый тест требует `unavailable` для отказа не класса «нет живого агента» |
| **F4** порт `session` объявлял возможности agent-runtime | MINOR | **исправлено**: две карты (`DSH_SESSION_CAPABILITIES` / `DSH_AGENT_RUNTIME_CAPABILITIES`); тест требует отказа `resolve('session', {capabilities:['scopedTools']})` |
| **F5** числа §2/§3 отчёта не воспроизводились | MINOR | **закрыто до вердикта**: ревьюер читал снимок до правки; текущие §2/§3 сняты из `git diff --numstat` и `Get-Content \| .Count` и воспроизводятся |
| **F6** §5.4 приписывал `list` то, что верно только для `prompt` | NIT | **исправлено** в §5.4 |
| **F7** `cancel` типизирован как Promise при синхронном живом методе; `DshFollowSnapshot.cursor` не читается | NIT | **исправлено**: тип стал честным (`{accepted} \| Promise<{accepted}>`), а в `pageOf` описано, почему `header` и `cursor` кадра сознательно не читаются |

Что ревьюер назвал непроверенным и что осталось таким же: живой прогон сессии; `AbortController`/`AbortSignal.any` в контексте установленного плагина; факт монтирования `agents`/`commands` в рабочем профиле; доска и живой профиль (вне рабочего пространства). Правки по F1–F4/F6/F7 **не проходили отдельную верификацию** — это следующий возможный шаг, решение владельца (§8).

## 7. Ограничения и что осталось непроверенным

1. **Живой запуск сессии не выполнялся.** Привязка ни разу не создавала реальную сессию и не отправляла prompt: это либо платная операция, либо изменение живого состояния Host. Всё, что можно было проверить без этого, проверено (§5.3).
2. **`AbortController` недоступен динамической Host-половине** (ограничение песочницы динамических плагинов, не рантайма DSH). Поэтому чтение реестра в пробе шло с duck-typed сигналом. В реальном установленном плагине `AbortController`/`AbortSignal.any` — глобали Node (≥22, `engines` пакета), но это **не подтверждено живьём**.
3. **Запись файла из динамической Host-половины не работает** (`fs.resolve`/`writeText` падают с `Cannot read properties of undefined (reading 'trim')`), поэтому отчёт пробы доставлен диагностикой Run и является одноразовым self-report'ом (§5.3). Причину не копал: вне объёма карточки.
4. **Hard stop передан в MW-031 (решение владельца, эта сессия).** `stop` отменяет активный turn (`session/cancel`), но не снимает ещё не отправленные queue-элементы (`session/updateQueue`, §6.8 п.2 отчёта MW-001): для этого нужен snapshot очереди из потока `session/control` с `itemId`. Это работа по recovery/§51 — карточка **MW-031** «recovery и обнаружение застрявшей работы» (§16, §49–§51) уже существует и является её естественным домом; там же и `MW-001` §6.8 п.5 ссылается на MW-031/MW-012. Вход для неё: `DshAgentRuntime.stop` (`packages/controller/src/dsh-session.ts`) — единственное место, где это добавляется, и `session/control` в структурном интерфейсе `DshSessionController`. Текст самой карточки MW-031 генерируется из `tasks/tasks.json`, поэтому строка про hard stop в неё не дописывалась этой карточкой (это создало бы расхождение markdown и JSON — дефект по правилам `.work/README.md`); решение зафиксировано здесь и в §8.
5. **Ограниченная страница — окно, а не префикс** (§6, F1): позиции ниже возвращённого курсора могут быть не выданы, о чём сообщает `hasMore`. Это свойство платформы, теперь описанное контрактом.
6. **Чтение маршрута и прав после перезапуска** идёт не через `status` (в реестре сессий нет поля маршрута/пресета), а через переутверждение области на `resume` и durable-события `model/selection`/`permission/preset`. `status` возвращает ровно то, что отвечает реестр владельца.
7. **`SessionPort` пока без потребителя в MyWork**: его потребители — работа §22.4/22.5 (checkpoint/rollover) в других карточках. Порт опубликован, потому что §36 его объявляет, а эта карточка — та, что связывает интеграцию.
8. **Ревью-статус:** MW-007 остаётся `READY_FOR_REVIEW` (см. §1); правки по findings MW-015 независимо не верифицированы (§6).
9. **Не делалось:** коммит, push, merge, publish, release; изменения доски, живого профиля DSH и чужих проектов; платные LLM-пробы; следующая карточка (MW-016 и далее) не начата.

## 8. Открытые вопросы к владельцу

1. ~~**Hard stop (снятие очереди)**~~ — **решено владельцем: в MW-031** (§7 п.4). Вход для той карточки зафиксирован здесь.
2. **Scoped prompt/context/tools через preset** — подтвердить, что для v0.1 это принятая интерпретация требования карточки «scoped system prompt/dynamic context и tool surface» (MW-001 §6.1 п.5: произвольного per-session allow-list инструментов в API DSH нет).
3. **Верификация правок по findings** — владельцем не поручалась; findings F1–F4/F6/F7 закрыты правками, но независимо не перепроверялись. Отдельный проход (fixes-verification) остаётся доступным по запросу.
4. **Приёмка MW-007** — оговорка §1 закрывается только актом владельца; до него статус MW-015 остаётся `READY_FOR_REVIEW`.

## 9. Коммиты

| SHA | Коммит | Содержимое |
|---|---|---|
| `0a4a4df` | `feat(contracts): add the agent runtime and session port vocabulary` | `packages/contracts/src/agent-runtime.ts` (новый), `packages/contracts/src/index.ts` |
| `65311f7` | `feat(adapter-sdk): cover every runtime conformance check and grow the fakes` | `packages/adapter-sdk/src/conformance.ts`, `packages/adapter-sdk/src/testing.ts` |
| `ceb8534` | `feat(controller): bind the DSH session controller as the runtime and session ports` | `packages/controller/src/dsh-session.ts` (новый), `packages/controller/src/index.ts` |
| `2a0249b` | `test: cover the DSH runtime and session adapters` | `tests/runtime.test.mjs` (новый), `tests/adapters.test.mjs`, `scripts/smoke.mjs` |

Разбивка по слоям, как в истории репозитория: каждый коммит несёт свой barrel (`contracts/src/index.ts`, `controller/src/index.ts`) вместе с модулем, который он экспортирует, — «общий файл двигается одним шагом». Каждый коммит несёт трейлер `Cards: MW-015.`; тело объясняет, **почему** изменение сделано. Отчёт (`.work/`) в git не попадает — каталог исключён правилом `/.work/`. Push/merge/publish/release не выполнялись.

## 10. Итог

- Объём карточки выполнен: порты §36/§39 объявлены и покрывают семь имён §39; DSH-привязка реализует create/resume/stop/status/events, выбор модели с реальным маршрутом, scoped prompt/context/tools через agent preset и runtime-энфорсмент прав; реальные session id сохраняются в handle.
- Проверки: `pnpm run check` на закоммиченном дереве → exit 0 (489/466/0/23), новый набор 17/17, четыре мутации ловятся тестами, keyless-проба подтвердила поверхность живого Host без единой мутации.
- Независимое ревью: **PASS WITH FINDINGS**, 0 BLOCKER/MAJOR; F1–F4, F6, F7 закрыты правками, F5 закрыт до вердикта.
- Коммиты (по поручению владельца): `0a4a4df`, `65311f7`, `ceb8534`, `2a0249b`; base `02e8644` → head `2a0249b`, рабочее дерево чистое.
- Не сделано и названо: живой прогон сессии, hard stop (передан в MW-031), чтение пинов через `status`, верификация правок, приёмка MW-007.
- **Статус: DONE** — переведён из `READY_FOR_REVIEW` по прямому указанию владельца (сессия MW-020). Приёмка — акт владельца; оговорки §7 остаются в силе (живой прогон сессии не выполнялся, правки по findings независимо не верифицированы, hard stop передан в MW-031).
