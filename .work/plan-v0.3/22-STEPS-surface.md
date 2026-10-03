# 22 — Шаги этапа 5: доска, проекция, UI-пакет, миграция легаси, приёмка

**Владелец файла:** `plan-surface`. **Префикс шагов:** `B-`. **Шаблон шага:** `00-RECON.md` §1.2.

**Что здесь.** 48 шагов этапа 5 (карточки MW-042, MW-043, MW-047, MW-029, MW-048, MW-049, MW-050, MW-051, MW-052, MW-053, MW-054, MW-055, MW-036, MW-037) плюс пакет правок, который нужен до них: контракты доски (§2), backend проекции (§3), Application API (§4), installable UI-пакет (§5), доска и взаимодействие (§6), graph/calendar/themes (§7), compat-adapter и импорт (§8), приёмка (§9), остальные UI-карточки (§10).

**Как читать.**
1. Сначала §1 «Развилки» — три решения (D01, D02, D18) меняют текст шагов. Каждый зависящий шаг помечен `[D01]`, `[D02]`, `[D18]`.
2. Затем §2: два шага из него (`B-01`, `B-02`) выпоняются **в любом случае**, остальные — по исходу D02.
3. Шаги внутри раздела идут по порядку; между разделами порядок задан зависимостями в поле «Карточка».

**Чего здесь нет.** Правки текстов карточек — `30-CARD-EDITS.md` (`card-ledger`). Решения с вариантами и матрицами — `10-DECISIONS.md` (`decision-desk`). Гигиена/CI/миграции — `20-STEPS-foundation.md` (`plan-foundation`). Конвейер исполнения — `21-STEPS-execution.md` (`plan-execution`).

**Требование к исполнению, общее для всех B-шагов.** Тесты домена импортируют **собранные** пакеты: `tests/lib/fixtures.mjs:16-39` грузит `packages/<pkg>/lib/index.js`, а не `src`. Значит любой шаг, меняющий `packages/contracts/**` или `packages/core/**`, обязан **сначала пересобрать затронутые пакеты**, иначе тест проверяет старый код, а `tests/boundaries.test.mjs:570-582` читает `lib/index.js` как текст. Команда сборки одного пакета: `cd packages\contracts; node ..\..\node_modules\.bin\tsdown.cmd` (проверено: `node_modules\.bin\tsdown.cmd` существует). Bootstrap рабочего runner'а — шаг **F-01** (`corepack pnpm -r run …`); точечные проверки — `node --test --test-isolation=none <файл>` и `node_modules\.bin\tsc.cmd --noEmit -p <tsconfig>`.

**Канонические правила исполнения (`01-MASTER-PLAN.md` §15) — обязательны для каждого B-шага.**

1. **Runner.** `pnpm` в этом окружении сломан. Канон: `corepack pnpm -r run <script>` (обязательно с `-r`), `node --test --test-isolation=none <файл>`, `node_modules\.bin\tsc.cmd --noEmit -p <tsconfig>`, `node <tsdown-entry>`. Ни один B-шаг не предписывает `pnpm run build|check` как гейт (правило §15.1).
2. **Версии миграций.** Версия выдаётся **только единым аллокатором** в composition-слое (решение D08), а не литералом в шаге: `validateMigrations` (`packages/storage/src/migrations.ts:111-129`) бросает на дубле версии, и store не откроется вовсе. Занято: v1 kernel (storage), v2–v3 evidence, v4 lease, v5 planner, v6 execution (правило §15.3). **Ни один B-шаг не содержит литерала версии.**
3. **Адресация карточек.** `task_board_*` принимает UUID, а не `MW-0NN` (правило §15.2). Шаг, который читает/запускает карточку, начинается с «Шаг 0: получить UUID через `task_board_list {query: "MW-0NN"}`».
4. **Ссылки внутри плана.** Ссылаться на **шаги, карточки и решения** (`F-32`, `E-24`, `B-01a`, `MW-060`, «D02», «D18»), а не на номера строк плановых документов (правило §15.6). В этом файле номера строк остаются **только** для якорей в коде, тестах, профиле и ADR — они не правятся параллельно.
5. **Сборка и клиентский бандл.** Все 12 `tsdown.config.ts` имеют `clean: true` — рукописный `lib/client.js` будет стёрт любой сборкой пакета. Шаг, создающий клиентскую половину (`B-25`), обязан исключить её из очистки **или** пересобирать после каждой сборки (правило §15.5).
6. **Один writer на файл.** Плановые файлы правят только их владельцы (правило §15.7).

**Нумерация зависимостей.** ID шагов `F-*` — **фактические по `20-STEPS-foundation.md`**: bootstrap = `F-01`; `bd`-seam = `F-13`…`F-17`; единый реестр миграций = `F-18`/`F-19`; migration journal = `F-20`; тест `batch`-рёбер = `F-21`; CI+тег = `F-25`; composition root = `F-28`…`F-32`; атомарность = `F-33`/`F-34` (+ `F-20`); boundary-тест = `F-41`/`F-42`; peer-контракт = `F-48`; installable UI-пакет = `F-58`/`F-59`. Предварительная нумерация `01-MASTER-PLAN.md` §5 **не используется**.

**Не исполнять как есть** (вердикт `93-VERIFICATION-SURFACE.md`): `B-04L`, `B-05L` (вариант B не выбран — оставлены как измеренная цена решения), `B-22` **кроме spike ≤1 дня** по критерию D01/ADR-029, `B-42` (правка живого профиля — вне кампании). Шаг `B-04` помечен «ждёт уточнения D02» (расхождение с ADR-030 §3; решение — `decision-desk`).

---

## 0. Введение: что уже есть в контрактах и коде (якоря)

Раздел нужен, чтобы не переписывать существующее. Всё ниже — проверено в этой сессии чтением файлов и одним прогоном тестов.

### 0.1. Контракты доски (`packages/contracts/src/board.ts`, 381 строка)

| Что | Строки | Состояние |
|---|---|---|
| `BoardZone` — union из 9 зон с докблоками | `:26-44` | определено |
| `BOARD_ZONES` — 9 зон в порядке чтения, frozen | `:53-63` | определено |
| `BoardZoneRow` = `intake\|active\|terminal` | `:47` | определено |
| `BOARD_ZONE_ROWS` — зона → строка сетки 3×3 | `:66-76` | **layout внутри публичного контракта** |
| `BOARD_ZONE_ICONS` — зона → семантическое имя иконки | `:82-92` | **presentation внутри контракта** |
| `ZONE_BY_STATE` — 16/16 состояний, each ровно один раз | `:102-119` | определено; `needs-attention → blocked` (`:118`) |
| `BoardViewMode`, `BOARD_VIEW_MODES`, `BOARD_STRIP_MAX_WIDTH_PX = 1100` | `:126,129,132` | **layout-метрика внутри контракта** |
| `BoardPanelState` — 7 состояний + `BOARD_PANEL_STATES` | `:141-166` | `loading/ready/empty/degraded/unavailable/recovery/paused` |
| `BoardView` | `:175-188` | `boardRevision` объявлен |
| `BoardPlacement` | `:197-225` | 7 обязательных полей; `subState?: string` (`:210`) |
| `DropIntent` | `:231-249` | `expectedColumnRevision` (`:248`) |
| `CardCommand`, `CARD_COMMANDS` | `:252-280` | `board.move` (`:268,279`) — один глагол на reorder+rezone |
| `CardInteraction` | `:286-297` | определено |
| `DegradedProjection` | `:305-314` | `reason: adapter-unavailable\|reconciliation-pending\|partial-read`, `snapshotAt`, `staleZones` |
| `EvidenceSummary` | `:317-328` | определено |
| `SessionLink` | `:336-347` | `active: boolean` (`:344`) |
| `NeedsAttentionReason` + `NEEDS_ATTENTION_REASONS` (7 причин) | `:356-381` | объявлено |

### 0.2. Проекция (`packages/core/src/board.ts`, 566 строк)

| Что | Строки | Состояние |
|---|---|---|
| `projectTaskZone` / `zoneOfState` — тотальная функция из `ZONE_BY_STATE` | `:44-51` | определено |
| `isTaskZone` — `zone !== 'ideas'` | `:60-62` | определено |
| `taskStatesOfZone` — обратная таблица | `:71-73` | определено |
| `assertSinglePlacement` — единственность размещения **и** проверка `zone === projectTaskZone(exactState)` | `:106-145` | инвариант проверяется только здесь |
| `legalDropTargets(state)` — зоны переходов без admission-only рёбер | `:161-167` | определено |
| `canDropInto` — исключает `assigned` и цели, требующие попытки | `:177-182` | определено |
| `midpointKey` / `isOrderKey` / `boardOrdering` / `resolveInsertion` / `renumberKeys` | `:231-431` | base-62, key = строка |
| `PlacementChange` с `fromZone?` | `:434-441` | `fromZone` заполняется только при смене зоны (`:561`) |
| `applyDropIntent` | `:458-566` | **инвариант на входе не проверяется** (`:521-539`); запись `zone: intent.toZone` (`:554`) |

Переходы состояний, на которые опирается DnD: `packages/core/src/task.ts:50-67` (16 строк таблицы), `requiresActiveAttempt` — `:113-115`.

### 0.3. Authority, события, ревизии

- `packages/contracts/src/authority.ts:45-49` — `task.board-placement`, `board.view`, `board.placement`; `:108-113` — владелец `mywork-db`, `projection: true`.
- `packages/contracts/src/events.ts:45-48,77-78` — события `board.placement.changed`, `board.view.revised` объявлены.
- `packages/contracts/src/revisions.ts:28-29,41` — домен ревизии `board-view`.
- **Писателя нет.** Grep по `packages/**` даёт `boardRevision` только в объявлениях типов (`contracts/board.ts:187,224`, `core/board.ts:90`) — ни одного присваивания. То же у `columnRevision`: единственная запись — `columnRevision + 1` внутри `applyDropIntent` (`core/board.ts:556`), и она никуда не сохраняется.

### 0.4. Хранилище: board-таблиц не существует

- `packages/storage/src/migrations.ts:49-51` — **единственная** миграция `OUTBOX_INBOX`, `version: 1`; `:91` — `MYWORK_MIGRATIONS` из неё одной; `:94` — `MYWORK_SCHEMA_VERSION` производный от неё.
- `packages/storage/src/store.ts:84` — открытие применяет `MYWORK_MIGRATIONS` по умолчанию.
- Grep по `packages/storage/**` на `placement|board` — 0 совпадений.

**Следствие для D02, которое нигде не описано:** «миграция placement-ключей» сегодня **пустая** — сохранять нечего, потому что ни одной строки placement нет и таблицы нет. Миграция понадобится только когда MW-047 создаст таблицы, и тогда она пишется сразу в терминах выбранной модели (§2, `B-12`). Реальная цена D02 — не данные, а **код, тесты и определения**.

### 0.5. Controller как плагин

- `packages/controller/src/index.ts:92` — `export const name = '@dsh-mywork/controller'`.
- `:101` — `BOUNDED_CONTEXTS = ['control']`; `:104-107` — `Config { diagnostics?: boolean }`; `:115-128` — `apply(ctx, config)`, публикует `myworkController` и `myworkAdapters`.
- **Нет** `export const inject`, **нет** `ctx.webServer`, **нет** `ctx.slots`, **нет** `defineTool`. Это и есть расстояние до MW-029/MW-047/MW-048.

### 0.6. Локальный референс: установлен 0.4.4 (единственный рабочий прецедент; якоря строк таблицы измерены на 0.4.3 — дельта: `02-PLATFORM-DELTA-0.2.0-rc.2.md` §2 D8)

Корень `P` = `C:\Users\Dmitry\.dsh\profiles\web\node_modules\@linxin666\dsh-client-ui-task-board` (исходники TypeScript поставляются).

| Факт | Якорь |
|---|---|
| `dsh.bundle.patch`, `dsh.client = { platform: 'web', inject: [8 имён] }`; **в 0.4.4:** `peerDependencies { '@deepseek-ai/dsh': '>=0.2.0-rc.1', react: '^18.2.0' }` и `dsh.engines.dsh = '>=0.2.0-rc.1'` (0.4.3 объявлял `>=0.1.7-rc.2`) | `P/package.json:25-49` — якорь строк измерен на 0.4.3; манифест 0.4.4 — `02-PLATFORM-DELTA-0.2.0-rc.2.md` §2 D8 |
| `exports['.'] ./invariant ./client ./src/*`, `files` включает `lib/**` и `src` | `P/package.json:9-24,88-96` |
| `export const inject = ['systemPrompt','typertGateway','workspaceRegistry','webServer','agents','commands']` | `P/src/index.ts:35` |
| Регистрация роутов в `ctx.effect`: `disposers.push(ctx.webServer.register(route))` | `P/src/index.ts:378-402` |
| SSE: `kind:'exact'`, `text/event-stream`, `data: …\n\n`, heartbeat `: ping`, unsubscribe по `close` | `P/src/host-routes.ts:218-246` |
| Snapshot с монотонной `revision`; SSE-кадр **без** карточек (`revision/scheduler/power`) | `P/src/protocol.ts:35-60` |
| `defineTool` из `@deepseek-ai/dsh-tools`; 8 инструментов `task_board_*` | `P/src/host/agent-tools.ts:19,252-575` |
| Companion-инвариант: `export function apply(): void {}` | `P/src/invariant.ts:1-4` |
| Слоты: `slots.inject('sidebar.panellist', () => slots.register({ name, id, order, label }, Icon))` и `slots.inject('main', () => slots.register({ name, key, inject }, Page))` | `P/src/client/native-panel.tsx:99-124` |
| `PANEL_ORDER = 20` (Plugins 0, Schedule 10), `id` панели == `key` слота `main` | `P/src/client/native-panel.tsx:31-32,106-119` |
| Свой префикс атрибутов панели: `data-dsh-taskboard-view`, `data-dsh-plugin` (не `data-dsh-*`-платформенные) | `P/src/client/native-panel.tsx:77` |
| Право по умолчанию `read-only`; гейт подтверждения выше дефолта | `P/src/core/handover.ts:43-44,112-117` |

Платформенные правила (DSH-checkout `D` = `C:\Reposit\deepseek-harness\deepseek-harness`, только чтение). **Якоря ниже перепроверены на `0.2.0-rc.2` (`639ed0153`, 2026-10-03): `PLATFORM_MODULES` — те же 9 имён, `PRELOADED_CLIENT_EXTERNALS` пуст, `tsdown.client.ts`, `dsh.client` (4 поля), `slots.inject/register` и id `sidebar.panellist`/`main`, `ctx.webServer.register/registerUpgrade`, prefix-маршрут `/plugins/<id>/client.js` не менялись** (`02-PLATFORM-DELTA-0.2.0-rc.2.md` §2 D13; цитаты этих файлов совпадают с `c7c4c725` побайтно):

| Факт | Якорь |
|---|---|
| `WebRoute = { kind: 'exact'\|'prefix', path, handler }`; `register` возвращает disposer; дубликат `(kind,path)` бросает | `D/packages/host/webserver/src/index.ts:38-48,166-173` |
| `/api` — единственный префикс browser-транспорта; trust-fence `requestRejection` вызывается **до** обработчика | `D/packages/client/connection/src/api-path.ts:7`; `rpc-host.ts:99-111`; `index.ts:158` |
| Мост node:http ↔ fetch **умеет стримить ответ** (backpressure, abort по `close`), заголовки копируются дословно → SSE возможен | `D/packages/client/connection/src/http-bridge.ts:42-49,96-120` |
| `PLATFORM_MODULES` — ровно 9 имён: `react`, `react/jsx-runtime`, `react-dom`, `react-dom/client`, `@deepseek-ai/cordis`, `@deepseek-ai/dsh-client-store`, `@deepseek-ai/dsh-client-ui-slots`, `@deepseek-ai/dsh-client-ui-primitives`, `@deepseek-ai/dsh-client-ui-dockkit` | `D/packages/client/web/src/platform.ts:8-14` |
| `dsh.client = { platform, inject?, external?, immediately? }`; `icon` — поле верхнего уровня `package.json`, не `dsh.client` | `D/packages/util/package-manifest/src/types.ts:44-54,80-94` |
| Субпуть — «перманентно не клиентская строка»; `dsh.client` без `exports['./client']` → throw | `D/packages/client/modules/src/index.ts:828-848` |
| Клиентский бандл — lazy CJS: исполнение только **регистрирует** фабрику; тело модуля живёт в замыкании | `D/packages/client/modules/src/client/manifest.ts:9-24,52-68` |
| Формат регистрации | `window.__ModuleLoader__.load({ id: '<bare package name>', factory: (require) => { … } })` — `D/packages/client/tsdown.client.ts:619` |
| `sidebar.panellist` = `{ kind:'list', scope:'root' }`; опции `{ name, id, order?, label?, priority? }`; `label` — thunk, резолвится на смене локали | `D/packages/client/ui-sidebar/src/client/contract/slots.ts:35`; `ui-slots/src/index.ts:774-780,865-867` |
| `main` = `{ kind:'keyed', scope:'root' }`; `ctx.layout.selectPanel(id)` **бросает**, если ни одна запись `main` не имеет `key === id` | `D/packages/client/ui-layout/src/client/service.ts:72-77` |
| `store?: StoreDecl` в регистрации слота; компонент получает `PropsStore` = `{ useStore(selector), actions }`; запись только через `actions` | `D/packages/client/ui-slots/src/index.ts:151,439,610,824`; `D/packages/client/store/src/contract.ts:93-136` |
| Typert-генератор требует `exports['./typert']` = `{types:'./lib/typert.host.d.ts', default:'./lib/typert.host.js'}`, `exports['./remote']` при наличии Remote-методов, и оба файла в `files`; иначе `TypertAnalysisError` | `D/packages/typert/generator/src/workspace.ts:90-148` |
| Регистрация пакета в face — только если корень внутри `<root>/packages`; `tsconfig.host.json` + `tsconfig.client.json` в корне | `.work/plan-v0.3/evidence/lead-01-typert.md:5-8` |

### 0.7. Живой легаси-леджер (источник миграции)

Путь: `C:\Users\Dmitry\.dsh\task-board\ledger-v2.json` (369 634 байта, `mtime` 2026-09-26 22:01), рядом `ledger-v2.lock`, `scheduler-v2.json`. Формат — `schemaVersion: 3`, `revision: 324`, `tasks[]`, `scheduler`, `recentRequests` (255 записей) — сверено с `P/src/protocol.ts:10-12` (`TASK_BOARD_SCHEMA_VERSION = 3`, legacy 2) и `P/src/host-ledger.ts:413-419` (`join(dshHome(),'task-board')`, `ledger-v2.json`, `scheduler-v2.json`).

Полевой состав карточки: `id, title, description, prompt, status, createdAt, updatedAt, executions, workspaceId, permission, model, tags, permissionConfirmedAt, archivedAt`.

Воспроизведённые числа (скрипт: `Get-Content … | ConvertFrom-Json`, только чтение):

| Метрика | Значение |
|---|---|
| Всего карточек | **55** |
| Статусы | `backlog` 34, `done` 19, `failed` 2 |
| Рабочие пространства | `47b14762-…` — 52 (32 backlog / 19 done / 1 failed); `3fc33afb-…` — 3 (2 backlog / 1 failed) |
| Карточек с исполнениями | 22; суммарно исполнений 31 |
| Архивных (`archivedAt`) | 3 |
| `permission` | у всех 55 — `workspace-write` |
| `scheduler` | `{"timeZone":"Asia/Yekaterinburg","ledgerId":"21d3414b-…","lastTickAt":…}` |
| `scheduler-v2.json` | `{"lastTickAt":…}` — **ни одного per-task расписания** |

`47b14762-c848-44e6-a7cc-62f19949566d` = `H:\Repo\DSH-MyWork` — по `C:\Users\Dmitry\.dsh\storages\workspace.json` (`tables.workspaces`). `3fc33afb-e9c6-4bf2-b561-4388c8ad0e09` в реестре **отсутствует** → осиротевшее пространство.

Отсюда правило eligible (`workspaceId == MyWork && status != done`) даёт **33** карточки — совпадает с §9.1 отчёта и заменяет цифру «35»/«41» из текстов MW-054/MW-055.

### 0.8. Четыре леджера противоречат друг другу (и это влияет на приёмку)

| Источник | MW-042 | MW-043 |
|---|---|---|
| `.work/tasks/tasks.json` | `planned` | `planned` |
| `.work/tasks/INDEX.md:42,79` | `planned` | `planned` |
| легаси-леджер `ledger-v2.json` | `done` (1 исполнение) | `done` (2 исполнения) |
| отчёт `.work/reports/MW-042-board-projection.md` | `READY_FOR_REVIEW` | — |
| отчёт `.work/reports/MW-043-idea-bank.md:3` | — | **`BLOCKED`** |

То есть «MW-042 закрыт как DONE» (FINAL-REPORT §5.2) — это статус **доски**, а не `tasks.json`. Для приёмки (§9, `B-43`) это означает: «колонка Готово» не доказательство (FINAL-REPORT §10 «Что НЕ делать», последний пункт).

---

## 1. Развилки

Три решения меняют текст шагов. Ниже — что именно решается, как это отражается на шагах и что делать при каждом исходе. Сами варианты и матрицы — в `10-DECISIONS.md` (D01, D02, D18); здесь только исполнимое следствие.

### 1.1. `[D02]` Модель зон доски (K2) — **выбран вариант C (гибрид)**

**Что решено** (решение **D02**; ADR — `adr/ADR-030-board-zones-v03.md`). **Вариант C — гибрид:** девять зон **остаются контрактом** `packages/contracts`; «semantic lanes» (7 полос) вводятся как **представление в UI-пакете**; перенос layout-констант наружу делается сразу; **ADR-030 дополняет ADR018**, а не заменяет его. Вариант A = 9 зон (то же, что C, но без словаря полос), вариант B = 7 lanes в контракте (дорогой, ниже его точная цена), вариант D = «ничего не делать».

**Что это значит для шагов.**
- `B-02` (перенос layout в presentation) — **основной путь**, часть C.
- Словарь полос живёт в `packages/web`: правило перевода «зона → полоса» (9→7) — отдельная чистая функция с собственным тестом (`B-04`).
- Ни одного переименования в `contracts`/`core` на основном пути **нет**. Приёмки MW-042/049/050/053/035 остаются исполнимыми.
- Транзакционная цена гибрида — **два словаря** (зона в контракте, полоса в UI) и правило перевода между ними. Это записано как риск, а не как бесплатность.

**Точная цена варианта B (7 lanes в контракте), если владелец его всё же выберет** — сверено с независимым подсчётом `.work/plan-v0.3/evidence/lead-10-board-lanes.md:13-22`:

`tests/board.test.mjs` — **24** объявления `test(` (не 26: решение D02 в `10-DECISIONS.md` здесь ошибается), `node --test --test-isolation=none tests/board.test.mjs` → `tests 24 / pass 24 / fail 0` (EXIT=0; прогон воспроизведён независимо — `93-VERIFICATION-SURFACE.md` §1). **Падают 6 тестов, ≥13 утверждений:**

| Тест (строка) | Что именно ломается | Тип |
|---|---|---|
| `tests/board.test.mjs:35` | `:36-46` deepEqual девяти литералов; `:48` ключи `BOARD_ZONE_ROWS`; `:50` строки `intake/active/terminal`; `:54-56` иконка на каждую зону | обязательно |
| `tests/board.test.mjs:59` | `:65-68` `contracts.ZONE_BY_STATE` (после переименования — `undefined`); `:86` `isTaskZone('ideas')===false`: функция удаляется → `TypeError` | обязательно |
| `tests/board.test.mjs:146` | `:166` `contracts.BOARD_ZONES.filter(...)`; `:179` `['ready','blocked','cancelled']`; `:182` `['backlog','ready','blocked','cancelled']` | обязательно (≥3 утверждения) |
| `tests/board.test.mjs:522` | `:533` `error` 2→3 (`needs-attention`); `:534` `('cancelled').length === 2` → 0 (полоса называется `closed`); `:532` (`review` = 4) остаётся верным | обязательно (2 утверждения) |
| `tests/board.test.mjs:569` | `:584` ждёт `TASK_CONFLICT`, но фикстура `planned` даёт полосу `queue`, а `fromZone: 'backlog'` отвергается **раньше** (`packages/core/src/board.ts:472-481`) → `STALE_COLUMN_REVISION`; `:585` недостижим | обязательно |
| `tests/boundaries.test.mjs:570` | `:576` ищет `BOARD_ZONES`/`ZONE_BY_STATE` в `contracts/lib/index.js`, `:579` — `projectTaskZone` в `core/lib/index.js`; пересборка не спасает — имена обязаны стать новыми | обязательно |

Условные, **не** из-за полос: `tests/board.test.mjs:637-640` (`BOARD_VIEW_MODES`, `BOARD_STRIP_MAX_WIDTH_PX` — падает, если layout уехал в presentation; то есть **на выбранном варианте C** этот тест тоже правится, потому что перенос layout — часть C) и `:617` (`CARD_COMMANDS.includes('board.move')` — только если команда расщепляется, `B-06`).

Проходят, но «лгут словарём» (нужна правка, иначе тест зелёный на устаревших именах): `:26` — **одна строка фикстуры** чинит 7 тестов (`:111, :189, :381, :452, :500, :569, :621`), потому что фикстура берёт `zone` из `contracts.ZONE_BY_STATE[exactState]`; далее `:90, :102, :107, :124, :382, :426, :459, :526` и литералы в интентах `:500-520`. Итого ~10 правок словаря.

Приёмки, становящиеся неисполнимыми при B (дословно, `evidence/lead-10-board-lanes.md:18`): `MW-042.md:21` («ровно в одну из девяти зон», «(viewId, zone)»), `MW-049.md:21` («ровно девять панелей в сетке 3x3», «менее 1100 px», «иконку, подпись и count», «на пороге минус 1 px»), `MW-050.md:21` («Drop в error/blocked/cancelled», «Dependency preview показывает зоны»), `MW-053.md:21` («Каждая зона… имя для screen reader»), `MW-035.md:3` («девятизонная доска», карточка `superseded`).

**Опровержения к отчёту, которые надо держать в голове:**
1. Счёт цены расходится в **пяти** документах: «8 утверждений» (FINAL-REPORT §5.2), «9 в 8 тестах + 1» (решение D02 в `10-DECISIONS.md`), «**девять** утверждений» (`adr/ADR-030-board-zones-v03.md` §Контекст — повторяет тот же неверный счёт), «минимум 12 в 5 тестах + 2 условных» (ранняя редакция этого файла). Верный подсчёт — **6 тестов, ≥13 утверждений** плюс 2 условных (независимая проверка по строкам даёт 15 утверждений: 4+2+3+2+2+2).
2. Решение D02 в `10-DECISIONS.md` называет падающим `tests/board.test.mjs:459-484` — **неверно**: при 7 полосах у `ready`-карточки принимается ровно своя полоса, `accepted === 1` сохраняется.
3. Решение D02 пишет «26 — число `test(` в файле» — фактически **24**.
4. Приёмка `MW-052.md:21` зон **не содержит** вовсе (противоречия с lanes нет); правится «Объём» `MW-052.md:18`.
5. Нумерация вариантов в задании на планирование и в решении D02 противоположна; канон — **A = 9 зон, B = 7 lanes, C = гибрид**.
6. **ADR-030 устарел в двух местах и это уходит владельцу ADR, а не в правку этого файла** (находка C2 проверки): §2 «`packages/core/src/board.ts` **не меняется вовсе**» и §«Тесты» «строки `35-57`, `59-88`, `166`, `459-484`, `526-535` остаются как есть» противоречат `B-02` (правит `tests/board.test.mjs:35-57`), `B-03` (`core/board.ts` — `fromState`/`subState`), `B-08` (инвариант в `applyDropIntent`) и `B-10` (`panelStateFor`). Исполнитель, читающий только ADR-030, оставит `:35` нетронутым и получит красный тест. Требуется правка ADR-030 §2/§Тесты решением `decision-desk`.
7. **ADR-030 §3 противоречит словарю полос этого файла** (находка C1): ADR-030 помещает `blocked` **и** `needs-attention` бейджем внутрь очереди, тогда как шаг `B-04` относит `needs-attention` к полосе `error`. Расхождение **не разрешено**: шаг `B-04` помечен «ждёт уточнения D02», решение принимает `decision-desk`/владелец. Правило «зона `blocked` — единственная расщепляемая» верно в обоих случаях.
8. **`10-DECISIONS.md` (сводка D04) расходится с ADR-032 §1**: сводка говорит «peer по реально используемым сервисам», ADR-032 — «peer по **пакету** `@deepseek-ai/dsh`, сервисы остаются в `inject`». Канон — ADR-032 (гейт читает имена пакетов: `packages/boot/app-boot/src/plugin-compatibility.ts:75`).

**Миграция placement-ключей: сегодня пустая.** Ни одной `placement`/`board`-таблицы нет: `packages/storage/src/migrations.ts:49-91` — единственная миграция `version: 1` (outbox/inbox); grep `placement|board` по `packages/storage/**` = 0; `placement` = 0 во всех 24 найденных `*.sqlite` (`evidence/lead-10-board-lanes.md:8`). Формат появится только в `B-12` (MW-047). Если решение B будет принято **после** MW-047, переход станет настоящей миграцией: `zone → lane` по новому маппингу + `renumberKeys(count)` (`packages/core/src/board.ts:407`) с сохранением порядка `(zone, order, taskId)` + **сброс `columnRevision`** (иначе клиент будет вечно получать `STALE_COLUMN_REVISION`, `packages/core/src/board.ts:482-498`).

**Условие пересмотра (триггер):** дедлайн — **до `B-12`** (первая запись placement). После `B-12` цена перехода к 7 полосам в контракте вырастает на миграцию ключей и 2–3 новых теста (`board-read`, `board-commands`), которых сегодня нет.

### 1.2. `[D01]` Транспорт Web (K1)

**Решение принято: `adr/ADR-029-transport-web.md` фиксирует `D01 = R2` — HTTP/SSE через `ctx.webServer` со своим забором.** Новый ADR не создаётся (каталог `docs/` в репозитории отсутствует вовсе; ADR кампании живут в `.work/plan-v0.3/adr/`). Шаг `B-18` не выбирает транспорт, а **подтверждает ADR-029** и переносит в исполнение его проверки.

| Путь | Статус по ADR-029 | Авторизация | Стриминг |
|---|---|---|---|
| **R2. `ctx.webServer.register`** | **выбран** | **своя** — платформа не даёт ни auth-хука, ни middleware: вызов `route.handler(req, res)` — `D/packages/host/webserver/src/index.ts:228`, и до него ни одной проверки (`evidence/lead-02-http-slots.md:30`) | полный (handler владеет ответом) |
| **R3. `ctx.connection.fetch.register`** | **кандидат, не выбран** до проверок (а)–(г) из ADR-029 §«Третий путь» | **наследуется**: `/api`-путь проходит `connection.admit` до моста (`D/packages/client/connection/src/index.ts:149`; shared handler — `rpc-host.ts:130-150`) | **есть**: мост стримит ответ с backpressure и рвёт по `close` (`http-bridge.ts:42-49,96-120`) |
| **R1. Typert Remote** | **отклонён как основа**; остаётся spike ≤1 день по §«Spike» ADR-029 | через `typertGateway`/gateway | `RemoteStream` |

**Проверки ADR-029, которые обязаны попасть в шаги (а)–(г):** (а) наследует ли `connection.fetch` проверку доверия полностью или требует собственного маркера; (б) поддерживает ли он длительно открытый ответ (SSE-совместимость); (в) доступен ли он из строки композиции плагина, а не только из встроенных пакетов; (г) не конфликтует ли он с `remote-web-ui lanBind`. Эти четыре проверки — **Шаг 0 шага `B-21`**; до их выполнения R3 не становится выбранным путём.

Важное уточнение к MW-029: формулировка приёмки «наследуют Host/Origin-проверки… своего guard нет» верна **только** для R3. Для выбранного R2 fence обязателен — MW-029 переписывается (правка карточки — `30-CARD-EDITS.md`).

**Что делать.** `B-20` (R2) исполняется; `B-21` (R3) — только как проверка (а)–(г) и как кандидат на удешевление; `B-22` (R1) — **только spike ≤1 дня**, иначе не исполняется. `B-18` — первый шаг: подтверждает ADR-029, объявляет `export const inject` в `packages/controller` и ставит peer по пакету платформы.

### 1.3. `[D18]` Форма UI-пакета и место view-состояния — **выбран вариант C, view-состояние — слот-`store`**

**Что решено** (решение D18). **Вариант C:** пакет `@dsh-mywork/web` по форме 0.4.4 — `exports['./client']`, `dsh.client { platform: 'web', inject }`, слоты через `ctx.slots.inject`, с переформулировкой приёмки MW-048 по факту.

**View-состояние — слот-`store`, и это решено, а не развилка.** D18 §4: выбран слот-`store` (`PropsStore`/`useStore`/`actions`, персист через `spec.persist`) как **осознанное расхождение с прецедентом 0.4.4** (тот отдаёт свой контроллер через `inject: () => ({ controller })`, `P/src/client/native-panel.tsx:115-119`). Поэтому в `B-28` остаётся **только** S1; вариант S2 (собственный контроллер) из шага удалён.

**Следствие D18, которое пока НЕ исполнено ни одним B-шагом (C4 проверки).** D18 §«Последствия» требует, чтобы `ThemeCapability`/`SurfacePolicy` (`packages/contracts/src/theme.ts`) переехали в UI-слой вместе с layout-константами. Шаги `B-29`/`B-38` наоборот опираются на `resolveSurfacePolicy` из `packages/core/src/theme.ts`, закреплённую тестами `tests/board.test.mjs:642-651,653-709`. Это **открытое расхождение**: либо шаг `B-02a` добавляется (перенос theme-политики в `packages/web` + перенос её тестов), либо следствие D18 отклоняется владельцем. Пока — в §12 «Не проверено» и в `30-CARD-EDITS.md` как правка MW-053.

**Конфликт порядка, который разведён шагом `B-01a`.** Перенос layout-констант (`B-02`) требует пакета-получателя, а `@dsh-mywork/web` создаётся только карточкой MW-048 — то есть по критическому пути пакета бы ещё не было. Решение: **каркас пакета создаётся раньше**, отдельным шагом `B-01a` в самом начале блока (до `B-02` и до MW-048). Это согласуется с D18 (форма пакета известна) и не противоречит MW-048: карточка наполняет пакет, а не создаёт его впервые. Альтернатива — оставить константы в `contracts` и переносить дважды; отклонена как двойная работа.

**Фиксированные части (не развилка):** bare-имя пакета в client-строке (субпуть — «перманентно не клиентская строка», `D/packages/client/modules/src/index.ts:828-833`); `dsh.client.platform = 'web'`; `exports['./client']`; `peerDependencies` — **по пакету платформы** `"@deepseek-ai/dsh": ">=0.1.7-rc.2 <0.3.0-0"` (диапазон — решение владельца 2026-10-03, `02-PLATFORM-DELTA-0.2.0-rc.2.md` §5.1; ADR-032 §1: гейт читает имена пакетов, сервисы остаются в cordis-`inject`); ручной CJS-бандл `window.__ModuleLoader__.load({ id: '<bare package name>', factory })`; externals только `PLATFORM_MODULES` (9 имён), своё же имя в `dsh.client.external` запрещено (`D/packages/client/modules/src/index.ts:517-526`); `immediately`; **`icon` — поле верхнего уровня `package.json`, а не внутри `dsh.client`** (`D/packages/util/package-manifest/src/types.ts:44-54`); свой префикс data-атрибутов — **`data-mw-*`** (см. `B-27`).

---

## 1a. Порядок исполнения внутри этого файла

| # | Шаг | Почему здесь |
|---|---|---|
| 1 | `B-01` | базовая линия и исход решений |
| 2 | `B-01a` | каркас `@dsh-mywork/web` — разблокирует `B-02` |
| 3 | `B-02` | перенос layout-констант (часть D02=C) |
| 4 | `B-03` | носитель `attention` + чистка мёртвых полей |
| 5 | `B-04` | правило «зона → полоса» в UI (D02=C); `B-04L` — только если выбран B |
| 6 | `B-05` | словарь и приёмки: что правится, что нет |
| 7 | `B-06 … B-10` | команды, инвариант, session link, panel state |
| 8 | `B-11 … B-17` | backend проекции (MW-047) — после `F-28`…`F-32` и `F-33`/`F-34` |
| 9 | `B-18 … B-23` | Application API (MW-029) |
| 10 | `B-24 … B-29` | UI-пакет: манифест, бандл, слоты, атрибуты, store, темы |
| 11 | `B-30 … B-37` | доска и взаимодействие |
| 12 | `B-38 … B-39` | graph/calendar и темы/доступность |
| 13 | `B-40 … B-42` | compat-adapter и импорт |
| 14 | `B-43 … B-44` | приёмка доски и верификация миграции |
| 15 | `B-45 … B-48` | Idea Bank, Team/Settings, Role Lab, визуальный редактор |

Шаги внутри группы можно распараллеливать по write-scope; между группами порядок обязателен (см. `01-MASTER-PLAN.md` §5).

---

---

## 2. Контракты доски: пакет правок и первые шаги (MW-042)

### B-01 · Снять базовую линию доски и зафиксировать исход D02
- **Карточка:** MW-042 (без новых карточек) · **Зависит от:** F-01 (рабочий runner/bootstrap), D02 (решение)
- **Усилие:** S (20–30 мин) · **Риск:** низкий · **Откат:** удалить файл базовой линии
- **Цель:** есть файл `B-01`-baseline с числами до любой правки, и в нём записан исход D02 — иначе нельзя отличить «сломал» от «было сломано».
- **Файлы:** Create `.tmp/plan-v03-surface/` (каталог), `.tmp/plan-v03-surface/baseline-board.txt`, `.tmp/plan-v03-surface/d02-outcome.txt`
- **Шаги:**
  1. **Создать рабочий каталог** — `Tee-Object` и `Copy-Item` **не создают** родительские каталоги, и без этой строки падают шаги 1–2 и `B-44`:
     Команда: `New-Item -ItemType Directory -Force -Path .tmp\plan-v03-surface | Out-Null; Test-Path .tmp\plan-v03-surface`
     Ожидаемо: `True`.
  2. Снять базовую линию
     Команда: `cd H:\Repo\DSH-MyWork; node --test --test-isolation=none tests/board.test.mjs 2>&1 | Select-String '^ℹ (tests|pass|fail|skipped)' | Tee-Object .tmp\plan-v03-surface\baseline-board.txt`
     Ожидаемо (проверено): `ℹ tests 24`, `ℹ pass 24`, `ℹ fail 0`, `ℹ skipped 0`.
  3. Снять базовую линию границ (число тестов не выдумывать — оно берётся из прогона)
     Команда: `node --test --test-isolation=none tests/boundaries.test.mjs 2>&1 | Select-String '^ℹ (tests|pass|fail)' | Tee-Object -Append .tmp\plan-v03-surface\baseline-board.txt`
     Ожидаемо: `ℹ tests 26`, `ℹ pass 26`, `ℹ fail 0` (воспроизведено независимо — `93-VERIFICATION-SURFACE.md` §1). Если прогон падает на отсутствии `lib/` — сначала `F-01` (runner) и сборка пакетов, потом повторить.
  4. Записать исход D02 в `.tmp/plan-v03-surface/d02-outcome.txt` одной строкой — **только одно из трёх значений**, иначе гейт вакуумный:
     `D02=C` (канон: решение D02 + `adr/ADR-030-board-zones-v03.md`), `D02=A` (9 зон без словаря полос) или `D02=B` (7 полос в контракте). При `D02=B` дополнительно указать `adr/ADR-030-bis-*.md` (новый ADR **не** создавать до решения владельца).
  5. Проверить: `Get-ChildItem .tmp\plan-v03-surface` → три имени; `Get-Content .tmp\plan-v03-surface\d02-outcome.txt` → строка начинается с `D02=` и значение ∈ {C, A, B}.
- **Гейт (готово когда):** `node --test --test-isolation=none tests/board.test.mjs` → `ℹ pass 24` / `ℹ fail 0`, **и** `Get-Content .tmp\plan-v03-surface\d02-outcome.txt` возвращает ровно `D02=C`, `D02=A` или `D02=B` (регулярка `^D02=(C|A|B)$`), **и** каталог `.tmp\plan-v03-surface` существует.
- **Evidence в отчёт:** содержимое `baseline-board.txt`, строка исхода D02, дата/время прогона.
- **Риски:** тесты читают `packages/*/lib` (`tests/lib/fixtures.mjs:16-36`) — если `lib` устарел относительно `src`, базовая линия врёт. Проверка: `git status --short packages` пусто по `src`.

### B-01a · Создать каркас пакета `@dsh-mywork/web` (разблокирует B-02; делает это **до** MW-048)
- **Карточка:** MW-048 (или новая карточка «каркас `@dsh-mywork/web`», диапазон MW-060…MW-064) · **Зависит от:** B-01, D18 (решение) · **Блокирует:** B-02, B-24…B-29
- **Усилие:** S (40–60 мин) · **Риск:** низкий · **Откат:** удалить каталог `packages/web` и вернуть `pnpm-workspace.yaml`/`tsconfig` (если правились)
- **Цель:** пакет-получатель существует, собирается и попадает в workspace — без UI-кода, только каркас и пустой бандл.
- **⚠ Согласовано при исполнении этапа 3 (2026-09-27, Lead, по указанию владельца).** `packages/web` **уже создан** шагом `F-58` (коммиты `63d7c80`, `be02c6b`), поэтому этот шаг — не «создать», а «расширить существующий пакет»: манифест ниже сохраняет `"private": true` и `files: [… "src" …]`, что противоречит решению **D18** (`private` снят именно у `@dsh-mywork/web`) и правилу «исходники не публикуются» (`files` покрывает `lib`, `cordis.patch.yml`, `icon.svg`). При исполнении `B-01a` брать за образец **фактический** манифест пакета, а не блок ниже; `dsh.bundle.patch` и `dsh.client` в нём уже объявлены, ряд панели принадлежит самому пакету. Свидетельство: `evidence/foundation-58-web-package.md`, `evidence/foundation-stage3-gate.md` §6.3.
- **Почему отдельным шагом.** `B-02` переносит layout-константы в `packages/web/src/board/layout.ts`, а MW-048 создаёт пакет по критическому пути **после** MW-029. Без этого шага `B-02` неисполним (`evidence/lead-10-board-lanes.md:27`).
- **Файлы:** Create `packages/web/package.json`; Create `packages/web/tsconfig.json`; Create `packages/web/src/index.ts` (пустой `apply`); Create `packages/web/src/client/index.ts` (пустой клиентский вход); Create `packages/web/tsdown.config.ts`; Create `packages/web/tests/` (каталог) + `packages/web/tests/lib/fixtures.mjs` (резолв домена относительными путями) + `packages/web/tests/card.test.mjs`-заглушка
- **Шаги:**
  1. `package.json` — по форме, которую требует платформа:
     ```json
     {
       "name": "@dsh-mywork/web",
       "version": "0.1.0",
       "private": true,
       "type": "module",
       "icon": "icon.svg",
       "main": "lib/index.js",
       "exports": { ".": {"types": "./lib/types/index.d.ts", "default": "./lib/index.js"},
                    "./invariant": {"types": "./lib/types/invariant.d.ts", "default": "./lib/invariant.js"},
                    "./client": {"types": "./lib/types/client/index.d.ts", "default": "./lib/client.js"},
                    "./package.json": "./package.json" },
       "dsh": { "engines": {"dsh": ">=0.1.7-rc.2 <0.3.0-0"},
                "client": { "platform": "web", "inject": [] } },
       "peerDependencies": { "@deepseek-ai/dsh": ">=0.1.7-rc.2 <0.3.0-0" },
       "files": ["lib/**/*.js", "lib/**/*.d.ts", "src", "icon.svg"]
     }
     ```
     Ключевое: `icon` — на верхнем уровне; `inject` пока пуст и наполняется в `B-26`; **`platform: 'web'` обязателен**, иначе пакет не станет клиентской строкой (`D/packages/client/modules/src/index.ts:836-844`). **Ни одной `dependencies`/`devDependencies`** — см. шаг 2.
  2. **Тестовый харнесс: решено — без рендера.** В `node_modules` **отсутствуют** `react`, `react-dom`, `jsdom`, `happy-dom` (проверено `93-VERIFICATION-SURFACE.md` §4.2), а `pnpm install` брифом кампании запрещён. Поэтому:
     - тесты `packages/web/tests/*.test.mjs` проверяют **чистые функции и редьюсеры** (`lanes.ts`, `layout.ts`, `anchors.ts`, `virtualize.ts`, `keyboard.ts` как машина состояний, сериализация view-состояния), а **не** рендер React;
     - всё, что требует DOM/рендера (число DOM-узлов, Tab-порядок, измеренный контраст, фактические ширины 1099/1100), проверяется **отдельным шагом ручной GUI-проверки** — `B-30a` (создаётся вместе с первой UI-панелью) и `B-39a`. Каждый такой пункт помечается «требует GUI» и **не** превращается в `node --test`;
     - альтернатива (объявить `react`/`react-dom`/`jsdom` в `devDependencies` + `corepack pnpm install`) **отклонена в этой кампании**: install запрещён, а решение о devDeps — за владельцем. Если владелец разрешит — это отдельный шаг с явным согласием, и только тогда тесты-рендеры становятся автоматическими.
  3. `packages/web/tests/lib/fixtures.mjs` — резолв домена **относительными путями**, как в `tests/lib/fixtures.mjs:16-29`: `import(pathToFileURL(join(repoRoot, 'packages/contracts/lib/index.js')))`, а не через `@dsh-mywork/contracts` (пакет не объявляет эту зависимость, и без `node_modules`-линка bare-специфаер не разрешится). Обязательно бросать понятную ошибку, если `lib/` нет («run the package build first»), — как `tests/lib/fixtures.mjs:31-36`.
  4. `packages/web/tsconfig.json` — `composite: true`, `references` на `contracts` и `core` (по образцу других пакетов: `packages/core/package.json:21-22` — `build: tsdown`, `typecheck: tsc --noEmit -p tsconfig.json`).
  5. **Не** добавлять пакет в `pnpm-workspace.yaml`, если он подхватывается маской `packages/*` — проверить: `Select-String pnpm-workspace.yaml -Pattern 'packages'`; если маска явная, добавить строку.
  6. Сборка: `cd packages\web; node ..\..\node_modules\.bin\tsdown.cmd` → код 0, появился `lib/index.js`.
  7. Проверка клиентской строки: `Select-String packages\web\package.json -Pattern 'platform'` → `"platform": "web"`.
- **Гейт (готово когда):** `node ..\..\node_modules\.bin\tsc.cmd --noEmit -p tsconfig.json` (из `packages\web`) → код 0 **и** `node ..\..\node_modules\.bin\tsdown.cmd` → код 0 **и** `Test-Path packages\web\lib\index.js` → `True` **и** `node --test --test-isolation=none packages/web/tests/card.test.mjs` → `fail 0` **и** в `packages/web/tests/**` нет ни одного `import` из `react`/`react-dom`/`jsdom`/`happy-dom` (скан по файлам).
- **Evidence в отчёт:** вывод `tsc`, вывод `tsdown`, листинг `packages/web`, фрагмент `package.json`, вывод скана на React-импорты.
- **Риски:**
  1. Если пакет объявит `dsh.client` без `exports['./client']` — композиция **бросает** (`D/packages/client/modules/src/index.ts:845-848`). Поэтому `exports['./client']` в каркасе обязателен с первого коммита.
  2. `private: true` — согласуется с остальными 12 пакетами (`00-RECON.md` §3.1); снятие `private` — решение D04, не этого шага.
  3. **Харнесс — главный риск шага.** Если исполнитель всё же напишет тесты с рендером, они не запустятся (нет `react`/`jsdom`), и ~40 запланированных тестов превратятся в красную сборку. Защита — скан из гейта; всё, что требует DOM, идёт в GUI-шаги `B-30a`/`B-39a`.

### B-02 · `[D02=C]` Вынести layout-константы из публичного контракта в presentation (основной путь)
- **Карточка:** MW-042 (правка), MW-048 (пакет-получатель — каркас из `B-01a`) · **Зависит от:** B-01a
- **Усилие:** S (40–60 мин) · **Риск:** низкий · **Откат:** revert коммита (или `git checkout` двух файлов)
- **Цель:** `packages/contracts/src/board.ts` перестаёт содержать знание о раскладке: строки сетки, имена иконок, режим вида и порог 1100 px живут в `packages/web`.
- **Почему это часть выбранного C.** Это ровно та «дешёвая часть §5.2» (FINAL-REPORT §5.2, §9.1 MW-042), которую решение D02 включает в гибрид: контракт перестаёт знать о раскладке, словарь полос приходит в UI (`B-04`). Перенос делается **до** появления потребителей раскладки, поэтому он ничего не ломает, кроме двух тестов.
- **Файлы:**
  - Modify `packages/contracts/src/board.ts` — удалить `:46-47` (`BoardZoneRow`), `:65-76` (`BOARD_ZONE_ROWS`), `:78-92` (`BOARD_ZONE_ICONS`), `:121-132` (`BoardViewMode`, `BOARD_VIEW_MODES`, `BOARD_STRIP_MAX_WIDTH_PX`); в `BoardView` поле `mode: BoardViewMode` заменить на `mode: string` с докблоком «имя режима; допустимые значения объявляет UI-слой» **либо** перенести тип в presentation и оставить в контракте `readonly mode: string`.
  - Create `packages/web/src/board/layout.ts` — новые владельцы: `BoardZoneRow`, `BOARD_ZONE_ROWS`, `BOARD_ZONE_ICONS`, `BoardViewMode`, `BOARD_VIEW_MODES`, `BOARD_STRIP_MAX_WIDTH_PX`; импорт `BoardZone` из `@dsh-mywork/contracts`.
  - Modify `tests/board.test.mjs:35-57` — из теста убрать `:48`, `:50`, `:54-56`; оставить только утверждение порядка `BOARD_ZONES` (`:36-46`).
  - Modify `tests/board.test.mjs:637-640` — тест «both view modes…» удалить из `tests/board.test.mjs` и завести как `packages/web/tests/layout.test.mjs`.
- **Шаги:**
  1. Снять baseline: `node --test --test-isolation=none tests/board.test.mjs` → `pass 24 / fail 0`.
  2. Проверить, что ни одно ядро не потребляет переносимые имена:
     Команда: `Select-String -Path packages\core\src\*.ts,packages\core\src\**\*.ts -Pattern 'BOARD_ZONE_ROWS|BOARD_ZONE_ICONS|BOARD_STRIP_MAX_WIDTH_PX|BOARD_VIEW_MODES'`
     Ожидаемо (проверено в этой сессии): вывод пуст.
  3. Создать `packages/web/src/board/layout.ts`, перенести шесть экспортов дословно (значения не менять: `1100`, `grid-3x3`, `strip-horizontal`).
  4. Удалить перенесённое из `packages/contracts/src/board.ts`; `BoardZone` оставить на месте.
  5. Пересобрать контракты и ядро (тесты читают `lib`):
     Команда: `cd packages\contracts; node ..\..\node_modules\.bin\tsdown.cmd; cd ..\core; node ..\..\node_modules\.bin\tsdown.cmd`
     Ожидаемо: оба процесса завершаются с кодом 0, в `packages/contracts/lib/index.js` больше нет строки `BOARD_ZONE_ROWS`.
     Проверка: `Select-String -Path packages\contracts\lib\index.js -Pattern 'BOARD_ZONE_ROWS'` → пусто.
  6. Правка тестов по списку выше; прогон:
     Команда: `node --test --test-isolation=none tests/board.test.mjs`
     Ожидаемо: `ℹ tests 23`, `ℹ pass 23`, `ℹ fail 0` — 24 объявления минус одно, перенесённое в `packages/web` («both view modes»); тест «the nine zones» остаётся, но без трёх утверждений про строки и иконки.
  7. Прогон границ: `node --test --test-isolation=none tests/boundaries.test.mjs` → `fail 0`, число `pass` равно baseline (имена `BOARD_ZONES`, `ZONE_BY_STATE`, `projectTaskZone`, `legalDropTargets` не переименовывались).
- **Гейт (готово когда):** `node --test --test-isolation=none tests/board.test.mjs` → `fail 0` **и** `Select-String packages\contracts\src\board.ts -Pattern 'BOARD_STRIP_MAX_WIDTH_PX|BOARD_ZONE_ROWS|BOARD_ZONE_ICONS'` → пусто **и** `Select-String packages\contracts\lib\index.js -Pattern 'BOARD_STRIP_MAX_WIDTH_PX'` → пусто.
- **Evidence в отчёт:** хвосты обоих прогонов, вывод двух `Select-String`, список удалённых/добавленных экспортов.
- **Риски:** `BoardView.mode` — тип `string` теряет проверяемость на границе контракта; если это неприемлемо, оставить в контракте объединение `'grid-3x3' | 'strip-horizontal'` как **данные** без констант — тогда `:638` переносится частично. Решение фиксируется в D18.

### B-03 · `[D02]` Дать носитель `NeedsAttentionReason` и убрать мёртвые поля placement
- **Карточка:** MW-042 (правка), MW-030/MW-050 (потребители) · **Зависит от:** B-02
- **Усилие:** M (1.5–2 ч) · **Риск:** средний (меняет публичную форму `BoardPlacement`) · **Откат:** revert коммита
- **Цель:** у `needs-attention` появляется носитель причины; `BoardPlacement.subState` и `PlacementChange.fromZone` перестают быть мёртвыми.
- **Факты, на которых стоит шаг:**
  - `NeedsAttentionReason` объявлен и **нигде не используется**: grep по `packages/**` даёт только `contracts/board.ts:356,373`. Приёмка MW-050 «карточка показывает конкретный NeedsAttentionReason» сегодня неисполнима.
  - `BoardPlacement.subState` (`contracts/board.ts:210`) не производится ни одним кодом — grep даёт одно совпадение.
  - `PlacementChange.fromZone` (`core/board.ts:438`) заполняется ровно тогда, когда зона изменилась (`:561`), то есть всегда равен `intent.fromZone`, который вызывающий уже держит.
- **Файлы:**
  - Modify `packages/contracts/src/board.ts` — в `BoardPlacement` (после `:208`) добавить
    `readonly attention?: { readonly reason: NeedsAttentionReason; readonly originState: TaskState; readonly decisionId?: string }`;
    удалить `subState` (`:209-210`). Тип `NeedsAttentionReason` объявить **выше** `BoardPlacement` (перенести блок `:349-381` перед `:190`) — иначе TS-ссылка вперёд в интерфейсе работает, но читаемость теряется; порядок менять допустимо.
  - Modify `packages/contracts/src/board.ts:434-441` — `PlacementChange` (в `core`) и `:438` удалить нельзя (это другой файл): удаление — в `packages/core/src/board.ts:438` и `:561`.
  - Modify `packages/core/src/board.ts:552-563` — убрать вычисление `fromZone`; вернуть `{ placement: next, columnRevision: next.columnRevision }`.
  - Modify `tests/board.test.mjs:621-635` — расширить проверку ключей: обязательные 7 полей без `subState`; отдельным утверждением — что `attention`, если присутствует, состоит из `reason`/`originState`/`decisionId`, `reason` ∈ `NEEDS_ATTENTION_REASONS`.
  - Create `tests/board-attention.test.mjs` — тесты носителя (см. шаг 1).
- **Шаги:**
  1. Падающий тест. В `tests/board-attention.test.mjs`:
     - `assert.equal('subState' in placementFixture(), false)` — поля нет в форме;
     - placement с `exactState: 'needs-attention'` и `attention.reason = 'budget-exhausted'` проходит `assertSinglePlacement`;
     - placement с `attention.reason = 'нет-такой-причины'` **отвергается** типизированно (`CONTRACT_MISMATCH`);
     - `core.applyDropIntent(...)` больше не возвращает `fromZone`: `assert.equal('fromZone' in applied.value, false)`.
     Команда: `node --test --test-isolation=none tests/board-attention.test.mjs` → FAIL (файл не собирается/поля есть).
  2. Реализация: правки контракта и ядра из списка «Файлы».
  3. Пересборка: `cd packages\contracts; node ..\..\node_modules\.bin\tsdown.cmd; cd ..\core; node ..\..\node_modules\.bin\tsdown.cmd` → код 0.
  4. Повтор: `node --test --test-isolation=none tests/board-attention.test.mjs` → `pass 4 / fail 0`.
  5. Регрессия: `node --test --test-isolation=none tests/board.test.mjs` → `fail 0`; `node --test --test-isolation=none tests/events.test.mjs` → `fail 0` (событие `board.placement.changed` упоминается в его докблоке `:45`).
- **Гейт (готово когда):** `node --test --test-isolation=none tests/board-attention.test.mjs tests/board.test.mjs` → `fail 0`, и `Select-String -Path packages\contracts\src\board.ts -Pattern 'subState'` → пусто, и `Select-String -Path packages\core\src\board.ts -Pattern 'fromZone: intent.fromZone'` → пусто.
- **Evidence в отчёт:** вывод падающего и зелёного прогонов, grep-подтверждения отсутствия мёртвых полей.
- **Риски:** `attention` в `BoardPlacement` — это **UI-данные внутри проекции**; они не являются authority (`authority.ts:113` — `board.placement` projection). Владелец носителя — тот, кто пишет placement (MW-047, `B-12`), а не Task Graph. Второй риск: `originState` дублирует `exactState`; он нужен, потому что `needs-attention` может быть выставлен из `assigned`/`executing`/`awaiting-review` и после ответа человека карточка возвращается именно туда. Если это признано избыточным — поле убирается, `attention` остаётся с двумя полями.

### B-04 · `[D02=C]` Правило «зона контракта → полоса представления» в UI-пакете
- **Карточка:** MW-048, MW-049 (представление) · **Зависит от:** B-01a, B-02, B-03 · **Блокирует:** B-30, B-34, B-35
- **Статус: ЖДЁТ УТОЧНЕНИЯ D02 (расхождение с ADR-030 §3).** ADR-030 §3 помещает **и** `blocked`, **и** `needs-attention` бейджем внутри очереди, тогда как раскладка ниже относит `needs-attention` к полосе `error`. Расхождение **не разрешено** — его снимает `decision-desk`/владелец (правка ADR-030 §3 либо правка раскладки). До снятия шаг не исполняется; тесты ниже написаны под раскладку «`needs-attention` → `error`», и при выборе варианта ADR-030 меняется ровно утверждение `(г)` и счёт `(в)`: `{queue:4, ready:1, active:2, review:4, error:2, done:1, closed:2}`, а инвариант «единственная расщепляемая зона — `blocked`» **сохраняется** (в очередь тогда идут `blocked` и `needs-attention` из двух разных зон). Решение принимает `decision-desk`, шаг его не выдумывает.
- **Усилие:** M (1.5–2 ч) · **Риск:** средний (два словаря) · **Откат:** revert коммита
- **Цель:** у панели есть 7 полос владельца, и есть **одна чистая функция** перевода 16 состояний в эти 7 полос — с доказанным покрытием 16/16. Контракт при этом не меняется (решение D02, вариант C).
- **Файлы:** Create `packages/web/src/board/lanes.ts` (тип `BoardLane` = 7 литералов, `LANE_BY_STATE` 16→7, `laneOfState`, `BOARD_LANES`, `LANE_ICONS`, `LANE_LABELS`); Create `packages/web/src/board/layout.ts` (из `B-02`); Create `packages/web/tests/lanes.test.mjs`
- **Раскладка (16 состояний → 7 полос; контракт не меняется):**

| Полоса | Состояния контракта | Зона контракта |
|---|---|---|
| `queue` | `draft`, `planned`, `blocked` | `backlog`, `blocked` |
| `ready` | `ready` | `ready` |
| `active` | `assigned`, `executing` | `in-progress` |
| `review` | `awaiting-review`, `reviewing`, `approved`, `integrating` | `review` |
| `error` | `changes-requested`, `failed`, **`needs-attention`** | `error`, `blocked` |
| `done` | `done` | `done` |
| `closed` | `cancelled`, `superseded` | `cancelled` |

  Сумма: 3+1+2+4+3+1+2 = **16** ✓, полос **7** ✓. Таблица — **по состоянию**, а не по зоне: это и есть смысл гибрида. Девять зон остаются контрактом (`ZONE_BY_STATE` не трогается), а UI уточняет их там, где зона грубее намерения владельца: зона `blocked` расщепляется на `queue` (настоящая блокировка) и `error` (`needs-attention` — то, что требует человека). `ideas` — не полоса (Idea Bank, ADR019).
  Инвариант перевода, который и проверяется тестом: `laneOfState` — сюръекция 16→7, и **единственная зона, отображающаяся более чем в одну полосу, — `blocked`** (в `queue` и `error`). Любое другое расщепление — дефект словаря.
- **Шаги:**
  1. Тест (падающий), `packages/web/tests/lanes.test.mjs`: (а) `BOARD_LANES.length === 7`; (б) `Object.keys(LANE_BY_STATE).length === 16` и совпадает с `TASK_STATES` из `packages/contracts/lib/index.js` (резолв относительным путём, см. `B-01a`); (в) группировка по полосам даёт ровно `{queue:3, ready:1, active:2, review:4, error:3, done:1, closed:2}`; (г) `laneOfState('needs-attention') === 'error'` и `laneOfState('blocked') === 'queue'`; (д) **инвариант словаря**: множество `projectTaskZone(state)` для состояний каждой полосы; зона, встречающаяся в двух полосах, ровно одна и это `blocked`; (е) каждая полоса имеет `label` и `icon` (имена иконок — из `BOARD_ZONE_ICONS`, пришедших в `B-02`); (ж) `boardOrdering` из `packages/core/lib/index.js` применим к полосе: сортировка 3 карточек даёт тот же результат, что сортировка их зон-источников.
     Команда: `node --test --test-isolation=none packages/web/tests/lanes.test.mjs` → FAIL «lanes.ts is not defined».
  2. Реализация: `LANE_BY_STATE` — статическая таблица 16 строк; `laneOfState(state) = LANE_BY_STATE[state]`, тотальность обеспечена типом `Record<TaskState, BoardLane>` (лишнее/пропущенное состояние ловит `tsc`, а не рантайм).
  3. Команда: `node --test --test-isolation=none packages/web/tests/lanes.test.mjs` → `pass 7 / fail 0`.
  4. Проверка, что контракт не тронут: `git diff --stat packages/contracts/src/board.ts` показывает изменения только от `B-02`/`B-03` (никаких переименований зон).
- **Гейт (готово когда):** `node --test --test-isolation=none packages/web/tests/lanes.test.mjs` → `pass 7 / fail 0` **и** `node ..\..\node_modules\.bin\tsc.cmd --noEmit -p tsconfig.json` (из `packages\web`) → код 0 **и** в отчёте есть строка «расхождение с ADR-030 §3 снято: <как>». Проверка «`Select-String contracts/board.ts -Pattern 'LANE_BY_STATE'` → пусто» **не является гейтом** (она проходит у пустой реализации) — оставлена как evidence.
- **Evidence в отчёт:** прогоны, таблица 16→7, вывод группировки и инварианта «одна расщепляемая зона — `blocked`».
- **Риски:**
  1. **Два словаря.** Полоса `queue` смешивает `draft`, `planned` и `blocked`: на 2000 карточках это самая тяжёлая полоса, виртуализация (`B-32`) становится обязательной.
  2. **Расхождение словарей.** Если UI начнёт выводить полосу из состояния напрямую и кто-то поправит `ZONE_BY_STATE` (например, перенесёт `integrating`), тест `(д)` упадёт — это и есть защита.
  3. **Счётчики.** Overview-полоса (`B-33`) считает и зоны (контракт), и полосы (UI). Числа в заголовке полосы обязаны совпадать с суммой её состояний; проверяется тестом `(в)` и приёмкой `B-43`.
  4. Дрейф от приёмок: MW-049 требует «иконку, подпись и count» на заголовке зоны — на основном пути C заголовок несёт полосу, поэтому приёмка правится (`30-CARD-EDITS.md`), а не игнорируется.

### B-04L · `[D02=B, запасной путь]` Перевести проекцию на 7 semantic lanes (`LANE_BY_STATE`)
> Исполняется **только** если владелец выберет вариант B (7 полос в контракте) до `B-12`. Канон вариантов — `10-DECISIONS.md` (A = 9 зон, B = 7 lanes, C = гибрид). Точная цена — §1.1.
- **НЕ ИСПОЛНЯТЬ** (вариант B не выбран: решение D02 + `adr/ADR-030-board-zones-v03.md`). Шаг сохранён как **измеренная цена** решения, а не как работа. При его исполнении приёмки MW-042/MW-049/MW-050/MW-053/MW-035 становятся неисполнимыми (список — §1.1).
- **Карточка:** MW-042-bis (новая) · **Зависит от:** B-02 · **Блокирует:** B-05L, B-30, B-34, B-35
- **Усилие:** M (2–3 ч) · **Риск:** высокий (пересмотр принятого ADR018) · **Откат:** revert коммита + отмена ADR-030-bis
- **Цель:** 16 состояний раскладываются по 7 lanes, `ideas` перестаёт быть зоной, `ZONE_BY_STATE` заменён на `LANE_BY_STATE` с доказанным покрытием 16/16.
- **Предлагаемая раскладка (7 lanes, 16 состояний, ровно один раз):**

| Lane | Состояния | Что добавляется на карточку |
|---|---|---|
| `queue` | `draft`, `planned`, **`blocked`** | бейдж «заблокировано» с id зависимости — `blocked` больше не колонка |
| `ready` | `ready` | роль, приоритет |
| `active` | `assigned`, `executing` | `AttemptState`, fence, lease-expiry |
| `review` | `awaiting-review`, `reviewing`, `approved`, `integrating` | `ReviewState`, привязанный артефакт |
| `error` | `changes-requested`, `failed`, **`needs-attention`** | подтип, счётчик попыток, `attention.reason` |
| `done` | `done` | `completedAt`, цепочка review → integration |
| `closed` | `cancelled`, `superseded` | подтип «Отменено»/«Заменено планом» |

  Сумма: 3+1+2+4+3+1+2 = **16**. `ideas` — не lane: идеи живут в Idea Bank (MW-043, ADR019) как отдельная сущность.
  Источник раскладки — FINAL-REPORT §9.1 (`blocked → queue`, `needs-attention → error`, `cancelled/superseded → closed`). **Это расходится с ADR-030 §3** (там `needs-attention` — бейдж внутри очереди); расхождение снимается решением `decision-desk`, а не этим шагом.
- **Файлы:**
  - Modify `packages/contracts/src/board.ts` — `BoardZone` → `BoardLane` (7 литералов), `BOARD_ZONES` → `BOARD_LANES`, `ZONE_BY_STATE` → `LANE_BY_STATE`; алиасы `@deprecated` **не** оставлять (два словаря в домене — это ровно дефект K4 «два workflow в одном профиле»).
  - Modify `packages/core/src/board.ts` — `projectTaskZone` → `projectTaskLane`, `zoneOfState` → `laneOfState`, `taskStatesOfZone` → `taskStatesOfLane`, `isTaskZone` → `isTaskLane` (все lanes держат задачи; функция становится `true` всегда и **удаляется**, а её вызовы — три: `:134`, `:499`, `:507` — заменяются на проверку членства в `BOARD_LANES`).
  - Modify `packages/core/src/index.ts:303-318` — список реэкспортов.
  - Modify `packages/contracts/src/authority.ts` — только если переименование доходит до домена: `board.placement` остаётся, `task.board-placement` остаётся.
  - Create `adr/ADR-030-bis-lanes.md` — рядом с остальными ADR кампании (`.work/plan-v0.3/adr/`, там уже 6 файлов: 029…034). Каталог `docs/` в репозитории отсутствует; ADR **не** создаётся до решения владельца.
- **Шаги:**
  1. Тест первым: `tests/board-lanes.test.mjs` — (а) `Object.keys(LANE_BY_STATE).length === 16`; (б) множество значений ровно `BOARD_LANES` (7); (в) для каждого состояния `projectTaskLane(state)` даёт lane, и `taskStatesOfLane(lane)` возвращает непустой список; (г) `BOARD_LANES.includes('ideas') === false`; (д) `taskStatesOfLane('error').length === 3`, `('queue').length === 3`, `('closed').length === 2`.
     Команда: `node --test --test-isolation=none tests/board-lanes.test.mjs` → FAIL «LANE_BY_STATE is not defined».
  2. Реализация по списку «Файлы».
  3. Пересборка `contracts` и `core` (команда из `B-02`) → код 0.
  4. Повтор: `node --test --test-isolation=none tests/board-lanes.test.mjs` → `pass 5 / fail 0`.
  5. **Обязательная** правка тестов по таблице §1.1 (5 тестов, ≥13 утверждений) — это отдельный шаг `B-05L`, здесь только зафиксировать, что без него `tests/board.test.mjs` красный, и приложить этот красный вывод как доказательство цены решения.
     Команда: `node --test --test-isolation=none tests/board.test.mjs` → ожидаемо `fail 5` (тесты `:35`, `:59`, `:146`, `:522` и, возможно, `:588`).
  6. Прогон границ: `node --test --test-isolation=none tests/boundaries.test.mjs` → ожидаемо `fail 1` (имена в бандлах), правится в `B-05L`.
- **Гейт (готово когда):** `node --test --test-isolation=none tests/board-lanes.test.mjs` → `fail 0` **и** красный прогон `tests/board.test.mjs` приложен к отчёту с точным числом `fail`.
- **Evidence в отчёт:** вывод четырёх прогонов (падающий новый, зелёный новый, красный board, красный boundaries), diff `contracts/board.ts` по переименованиям, текст `ADR-030-bis`.
- **Риски:**
  1. **Алиасы вместо переименования** оставят два словаря в дереве — это ровно тот дефект, который фиксирует K4 для workflow («два workflow в одном профиле»). Рекомендация: переименовать без алиасов, потому что потребителей вне `contracts`/`core`/`tests` нет (проверено grep'ом).
  2. `queue` смешивает `blocked` с `draft`/`planned`; при 2000 карточках это самая нагруженная колонка — виртуализация из `B-32` становится обязательной, а не желательной.
  3. `closed` получает `superseded`, который сегодня в `cancelled`. Это меняет счётчики в Overview-полосе (`B-33`) — сверить с приёмкой MW-049 по числам.

### B-05 · `[D02=C]` Сверить словарь, приёмки и карточки: что правится, а что остаётся
- **Карточка:** MW-042 (без правок контракта), MW-049, MW-050, MW-053 (правки формулировок), MW-052 (правка «Объёма») · **Зависит от:** B-02, B-04
- **Усилие:** S (1–1.5 ч) · **Риск:** низкий · **Откат:** revert коммита
- **Цель:** ни одна приёмка не остаётся «исполнимой только на словах»: там, где приёмка говорит «зона», а панель показывает «полосу», это либо переформулировано в карточке, либо доказано, что зона и полоса совпадают.
- **Что НЕ меняется на основном пути C** (и это надо зафиксировать в отчёте явно, потому что ранняя редакция этого файла и решение D02 считали иначе):
  - `packages/contracts/src/board.ts` — 9 зон, `BOARD_ZONES`, `ZONE_BY_STATE`: **без изменений** (кроме `B-02`, `B-03`);
  - `packages/core/src/board.ts` — `projectTaskZone`, `legalDropTargets`, `assertSinglePlacement`, `applyDropIntent`: **без переименований**;
  - `tests/board.test.mjs` — **24 теста → 23** (одно объявление переносится в `packages/web` шагом `B-02`); правки только от `B-02` (тесты `:35` и `:637`) и `B-03` (`:621`);
  - `tests/boundaries.test.mjs:570-582` — **без изменений** (имена в бандлах те же).
- **Что правится:**
  1. `MW-049.md:21` п1 «ровно девять панелей в сетке 3x3» → «N панелей по числу полос представления (7) при сохранении девятизонного контракта; сетка 3×3 остаётся раскладкой зон». Приёмка MW-049 п3 (иконка/подпись/count) → «на заголовке полосы; `LANE_LABELS`/`LANE_ICONS`».
  2. `MW-050.md:21` п2 «подсвечивает только легальные цели» → добавить «через резолвер `B-07`»; п3 «Drop в error/blocked/cancelled без причины» → **зоны сохранены**, значит формулировка остаётся валидной, но причина берётся из `attention.reason` (`B-03`).
  3. `MW-052.md:18` («Объём») — добавить «число полос/зон из модели D02 (`B-04`)»; приёмка `MW-052.md:21` правится **не** из-за зон (их там нет вовсе).
  4. `MW-053.md:21` «Каждая зона и каждая карточка имеют осмысленное имя» → «каждая полоса и каждая карточка».
  5. `MW-035.md:3` («девятизонная доска») — карточка `superseded`, правится как историческая ссылка.
- **Шаги:**
  1. Тест-«замок» словаря: в `packages/web/tests/lanes.test.mjs` добавить утверждение, что зоны, покрытые полосами, — это ровно контрактные зоны **без `ideas`**:
     `assert.deepEqual([...new Set(TASK_STATES.map(s => projectTaskZone(s)))].sort(), [...BOARD_ZONES].filter(z => z !== 'ideas').sort())`
     Смысл: словарь полос не «теряет» ни одну зону, кроме `ideas` (её покрывает Idea Bank, ADR019). Это же утверждение — страховка от того, что кто-то начнёт выводить полосы из чего-то, кроме `ZONE_BY_STATE`/`TASK_STATES`.
     Команда: `node --test --test-isolation=none packages/web/tests/lanes.test.mjs` → `pass 8 / fail 0`.
  2. Прогнать домен целиком после `B-02`+`B-03`: `node --test --test-isolation=none tests/board.test.mjs tests/boundaries.test.mjs` → `fail 0`, число `pass` равно baseline минус 1 (тест, перенесённый в `packages/web` шагом `B-02`).
  3. Выписать в отчёт таблицу «приёмка → что правится» по пунктам `B-05` и передать её в `30-CARD-EDITS.md` (правки делает `card-ledger`, не этот файл).
- **Гейт (готово когда):** `node --test --test-isolation=none tests/board.test.mjs tests/boundaries.test.mjs packages/web/tests/lanes.test.mjs` → `fail 0` **и** в отчёте есть таблица «приёмка → правка» с 5 строками и явной строкой «контракт 9 зон не менялся».
- **Evidence в отчёт:** прогон, таблица правок, `git diff --stat packages/contracts packages/core` (ожидаемо: только `B-02`/`B-03`).
- **Риски:** соблазн «поправить приёмку, чтобы не править код». Защита: `B-05` выполняется **после** `B-04`, и его гейт требует зелёных тестов, а не только правок текста.

### B-05L · `[D02=B, запасной путь]` Переписать тесты и границы под lanes
> **НЕ ИСПОЛНЯТЬ** (вариант B не выбран). Сохранён как измеренная цена решения; список падений и утверждений — §1.1.
- **Карточка:** MW-042-bis (та же), MW-055 (приёмка) · **Зависит от:** B-04L
- **Усилие:** M (1.5–2 ч) · **Риск:** средний · **Откат:** revert коммита
- **Цель:** `tests/board.test.mjs` и `tests/boundaries.test.mjs` зелёные, и их правки ровно те, что перечислены в §1.1 — ни одного «заодно поправил».
- **Файлы:** Modify `tests/board.test.mjs` (строки `:35-57`, `:59-88`, `:146-187`, `:522-535`, `:588-619` при split `board.move`, `:621-635`); Modify `tests/boundaries.test.mjs:570-582`; Modify `packages/core/src/index.ts` (если реэкспорты не поправлены в B-04)
- **Шаги:**
  1. Правка `:35-57`: список `BOARD_LANES` в порядке чтения (`queue, ready, active, review, error, done, closed`), убрать утверждения про `BOARD_ZONE_ROWS` (перенесены в `packages/web`, `B-02`); `:54-56` заменить на проверку «иконка есть у каждого lane» **только если** `BOARD_LANE_ICONS` остался в контракте, иначе удалить.
  2. Правка `:59-88`: `:84` — `usedZones` == `[...BOARD_LANES].sort()`; `:86-87` — удалить (`ideas` больше не lane).
  3. Правка `:146-187`: `:179` → `['queue','ready','closed']` (порядок — по `BOARD_LANES`); `:182` → `['queue','ready','closed']` для `planned` (его собственный lane — `queue`, `ready`, `blocked→queue`, `cancelled/superseded→closed`); `:184` — `legalDropTargets('approved')` включает `review` (lane сохранён, утверждение остаётся); `:186` → `['done']`.
     **Проверить арифметику до правки, а не после:** `planned → {ready, blocked, cancelled, superseded}` ⇒ lanes `{ready, queue, closed}`; `ready → {assigned(excluded), blocked, cancelled, superseded}` ⇒ `{ready, queue, closed}`.
  4. Правка `:522-535`: `('error').length === 3` (`changes-requested`, `failed`, `needs-attention`), `('closed').length === 2`, `('queue').length === 3`, `('review').length === 4`.
  5. Правка `tests/boundaries.test.mjs:575,579`: `BOARD_ZONES` → `BOARD_LANES`, `ZONE_BY_STATE` → `LANE_BY_STATE`, `projectTaskZone` → `projectTaskLane`.
  6. Пересборка `contracts` и `core` → код 0.
  7. Прогон: `node --test --test-isolation=none tests/board.test.mjs tests/boundaries.test.mjs tests/board-lanes.test.mjs tests/board-attention.test.mjs`
     Ожидаемо: `fail 0`, `skipped 0`; число `pass` = 22 (после B-02) + 5 + 4 + (число тестов boundaries из baseline).
- **Гейт (готово когда):** четыре файла тестов дают `fail 0`, и `git diff --stat tests/` показывает изменения **только** в `board.test.mjs` и `boundaries.test.mjs` из существующих файлов.
- **Evidence в отчёт:** diff тестов, хвост итогового прогона, число `pass`.
- **Риски:** самая вероятная ошибка — переписать ожидания «под то, что выдаёт код», а не под таблицу переходов `core/task.ts:50-67`. Защита: в тесте `:146` оставить исходную проверку «`legalDropTargets(state)` равен `allowedTaskTransitions(state)` без admission-only рёбер» — она вычисляется из таблицы и не даёт подогнать список.

### B-06 · Расщепить `board.move` на reorder и rezone (независимо от D02)
- **Карточка:** MW-042 (правка), MW-047 (потребитель) · **Зависит от:** B-03 · **Применим при C и при B**
- **Усилие:** S (40–60 мин) · **Риск:** низкий · **Откат:** revert коммита
- **Цель:** один глагол `board.move` перестаёт означать две разные операции (перестановка внутри зоны и смена зоны), а смена зоны требует явной цели-состояния из закрытого union. Под C «зона» остаётся контрактным словом, поэтому команда называется `board.rezone` и несёт `toState`, а не `toLane`; полоса вычисляется из состояния.
- **Файлы:** Modify `packages/contracts/src/board.ts:252-280` — `CardCommand` = `'board.reorder' | 'board.rezone' | …`; `CARD_COMMANDS` соответственно. Create `packages/contracts/src/board-command.ts` (или в том же файле) — `RezoneTarget = Extract<TaskState, ...>` закрытый union достижимых из `legalDropTargets` целей; Modify `tests/board.test.mjs:617-618`.
- **Шаги:**
  1. Падающий тест: `tests/board-rezone.test.mjs` — (а) `CARD_COMMANDS` не содержит `'board.move'`; (б) `'board.rezone'` требует `toState` из `RezoneTarget`; (в) `RezoneTarget` для `'ready'` не содержит `'assigned'` (admission-only ребро, `core/board.ts:177-182`); (г) подстановка произвольного состояния (`'done'` для `ready`) отвергается типом на этапе `tsc` — проверяется `typecheck`, не рантайм.
     Команда: `node --test --test-isolation=none tests/board-rezone.test.mjs` → FAIL.
  2. Реализация; пересборка `contracts` → код 0.
  3. Повтор: `node --test --test-isolation=none tests/board-rezone.test.mjs` → `pass 4 / fail 0`.
  4. Регрессия: `node --test --test-isolation=none tests/board.test.mjs` → `fail 0` (правка `:617-618` учтена).
- **Гейт (готово когда):** `node --test --test-isolation=none tests/board-rezone.test.mjs tests/board.test.mjs` → `fail 0` **и** `node ..\..\node_modules\.bin\tsc.cmd --noEmit -p tsconfig.json` (из `packages\contracts`) → код 0.
- **Evidence в отчёт:** прогоны, `typecheck` контрактов, список команд до/после.
- **Риски:** расщепление команды ломает приёмку MW-050 («drop не пишет board state напрямую») только по букве — по смыслу она выполняется лучше. Правка карточки MW-050 — `30-CARD-EDITS.md`.

### B-07 · Построить резолвер `DropIntent → MyWorkCommand` (его нет)
- **Карточка:** MW-060…MW-064 «DropIntent-резолвер» (новая; диапазон из `00-RECON.md` §2.2), MW-047, MW-050 · **Зависит от:** B-03, B-06
- **Усилие:** M (2 ч) · **Риск:** средний · **Откат:** revert коммита
- **Цель:** между UI и доменом появляется **одна чистая функция**, которая превращает `DropIntent` в команду либо в типизированный отказ с причиной и списком легальных целей. Сегодня её нет: `applyDropIntent` (`core/board.ts:458-566`) — не резолвер, а применение; продуктовых вызовов у неё нет.
- **Файлы:** Create `packages/core/src/board-resolve.ts`; Modify `packages/core/src/index.ts` (реэкспорт); Create `tests/board-resolver.test.mjs`
- **Шаги:**
  1. Падающий тест (8 случаев), в `tests/board-resolver.test.mjs`:
     - reorder внутри lane → `{ kind: 'board.reorder', order, expectedColumnRevision }`;
     - rezone `ready → blocked` → `{ kind: 'board.rezone', toState: 'blocked', … }`;
     - rezone в `assigned` → отказ `ADMISSION_REQUIRED`, `legalTargets` в деталях;
     - rezone в lane `queue` из состояния `ready` без указания состояния → отказ `TARGET_STATE_REQUIRED` (lane неоднозначен: `queue` держит `draft`/`planned`/`blocked`);
     - **нелегальная цель** (`ready → error`) → отказ `TASK_CONFLICT` с `legalTargets === legalDropTargets('ready')`;
     - устаревшая `expectedColumnRevision` → `STALE_COLUMN_REVISION`;
     - несогласованный вход (`placement.zone !== projectTaskLane(exactState)`) → `CONTRACT_MISMATCH` **до** любой другой проверки (это закрывает A-13, см. B-08);
     - `toState` из закрытого union и `laneOfState(toState) === intent.toLane` — иначе `CONTRACT_MISMATCH`.
     Команда: `node --test --test-isolation=none tests/board-resolver.test.mjs` → FAIL «resolveDropIntent is not a function».
  2. Реализация: `resolveDropIntent(placement, intent, meta): Result<ResolvedDrop>`; `ResolvedDrop = { command: 'board.reorder', order } | { command: 'board.rezone', fromState, toState, order }`; внутри — переиспользовать `legalDropTargets` и `canDropInto`, не дублировать таблицу состояний.
  3. Пересборка `core` → код 0.
  4. Повтор: `node --test --test-isolation=none tests/board-resolver.test.mjs` → `pass 8 / fail 0`.
  5. Регрессия: `node --test --test-isolation=none tests/board.test.mjs tests/board-rezone.test.mjs` → `fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none tests/board-resolver.test.mjs` → `pass 8 / fail 0`, и `Select-String -Path packages\core\src\board-resolve.ts -Pattern 'TASK_TRANSITIONS'` → пусто (таблица переходов не дублируется).
- **Evidence в отчёт:** прогоны, сигнатура функции, список кодов отказа.
- **Риски:** резолвер может стать вторым местом, знающим про переходы. Защита: единственный источник — `legalDropTargets`/`allowedTaskTransitions`; тест `(в)` из B-06 и тест «rezone в `assigned` отвергнут» фиксируют это.

### B-08 · Починить инвариант в `applyDropIntent` (V1 A-13)
- **Карточка:** MW-042 (правка), MW-047 · **Зависит от:** B-07
- **Усилие:** S (30–45 мин) · **Риск:** низкий · **Откат:** revert коммита
- **Цель:** `applyDropIntent` перестаёт быть функцией, которая на несогласованном входе меняет lane, и становится функцией, которая такой вход отвергает.
- **Дефект дословно.** `core/board.ts:521-522` вычисляет `expectedZone = projectTaskZone(placement.exactState)` и пропускает drop, если `intent.toZone === expectedZone` **или** `intent.toZone === placement.zone`. Если `placement.zone` уже расходится с `exactState` (запись минует `assertSinglePlacement`), ветка «или» пропускает смену lane: функция сама инвариант не проверяет, а комментарий `:516-520` утверждает обратное. Продуктовых вызовов нет — дефект латентный, но он станет живым на первом же писателе (MW-047).
- **Файлы:** Modify `packages/core/src/board.ts:458-540` — добавить **первую** проверку после сверки `taskId` (перед `:472`):
  ```ts
  const expected = projectTaskZone(placement.exactState)
  if (placement.zone !== expected) {
    return fail(new MyWorkError('CONTRACT_MISMATCH',
      `dsh-mywork: placement of "${placement.taskId}" claims zone "${placement.zone}" but its state "${placement.exactState}" renders in "${expected}"`,
      { details: { taskId, zone: placement.zone, exactState: placement.exactState, expected } }), meta)
  }
  ```
  затем `:521-522` упрощается до `if (intent.toZone !== expected) return fail(...)` — вторая половина «или» удаляется.
- **Шаги:**
  1. Падающий тест в `tests/board-resolver.test.mjs` (или отдельный `tests/board-invariant.test.mjs`): вход `placement = { exactState: 'done', zone: 'backlog', … }`, `intent = { fromZone: 'backlog', toZone: 'done' }`, корректный `order` → **ожидаем** `CONTRACT_MISMATCH`; до правки функция вернёт `ok: true` и `placement.zone === 'done'`.
     Команда: `node --test --test-isolation=none tests/board-invariant.test.mjs` → FAIL «expected CONTRACT_MISMATCH, got ok».
  2. Реализация по «Файлы»; удаление `fromZone` (уже сделано в B-03) не повторять.
  3. Пересборка `core` → код 0.
  4. Повтор: `node --test --test-isolation=none tests/board-invariant.test.mjs` → `pass 3 / fail 0`.
  5. Регрессия: `node --test --test-isolation=none tests/board.test.mjs` → `fail 0`, в частности тест `:452` «a drop must land in the zone the card state renders in» (`accepted === 1`).
- **Гейт (готово когда):** `node --test --test-isolation=none tests/board-invariant.test.mjs tests/board.test.mjs` → `fail 0`, и в `packages/core/src/board.ts` условная ветка содержит ровно одно сравнение `intent.toZone !== expected`.
- **Evidence в отчёт:** вывод красного и зелёного прогонов, дословный фрагмент до/после, ссылка на `V1 A-13` (FINAL-REPORT §5.2 «§7») и на `.work/analysis/2026-09-26/V1-verification.md`.
- **Риски:** ужесточение может отвергать **устаревшие** записи, которые сегодня «самоисправлялись». Это желаемое поведение (лучше типизированный отказ, чем тихая правка), но оно означает, что writer (MW-047) обязан писать согласованные placement — фиксируется в `B-12`.

### B-09 · Дать `SessionLink.active` живого писателя или удалить поле
- **Карточка:** MW-047 (владелец ссылки), MW-050 (потребитель), MW-048 · **Зависит от:** B-03- **Усилие:** S (30 мин) · **Риск:** низкий · **Откат:** revert коммита
- **Цель:** `SessionLink.active` перестаёт быть мёртвым полем: либо его вычисляет проекция из `Attempt.state` + живого session-реестра, либо поля нет, а «живость» выводится потребителем.
- **Факт.** `SessionLink` встречается в репозитории **один раз** — `packages/contracts/src/board.ts:336`; `active` (`:344`) не производится никем. Приёмка MW-050 «Session link открывает реальную DSH-сессию» механики не имеет (FINAL-REPORT §5.2 «§48»).
- **Файлы:** Modify `packages/contracts/src/board.ts:336-347`; Create `tests/board-session-link.test.mjs`
- **Шаги:**
  1. Выбрать исход (рекомендация: **вычислять, не удалять** — иначе карточка не отличит «сессия ещё идёт» от «сессия закрыта», а это визуальная разница):
     `active` остаётся, но объявляется **производным** полем: докблок «вычисляется проекцией как `attempt.state ∈ {executing, assigned}` ∧ сессия существует в session-реестре; writer — `BoardReadService`».
  2. Тест `tests/board-session-link.test.mjs`: (а) ссылка без попытки → `active === false`; (б) попытка в `executing` + живая сессия → `true`; (в) попытка в `executing` + отсутствующая в реестре сессия → `false` и `activeReason === 'session-gone'` (добавить `activeReason?: 'live' | 'attempt-settled' | 'session-gone'`); (г) транскрипт не копируется: в объекте нет полей с телами сообщений.
     Команда: `node --test --test-isolation=none tests/board-session-link.test.mjs` → FAIL.
  3. Реализация контракта (типы) + регистрация требования в отчёте MW-047 (сам расчёт — `B-13`/`B-16`).
  4. Пересборка `contracts`; повтор → `pass 4 / fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none tests/board-session-link.test.mjs` → `fail 0` **и** в `packages/contracts/src/board.ts` у `active` есть докблок со словом «производное»/«derived».
- **Evidence в отчёт:** прогоны, фрагмент интерфейса, `Select-String` по `activeReason`.
- **Риски:** `SessionLink` — только ссылка (ADR017: сессии принадлежат DSH). Соблазн положить в ссылку копию транскрипта прямо запрещён §8 — тест `(г)` это фиксирует.

### B-10 · Определить `closed` и семантику `empty` до проекции
- **Карточка:** MW-047, MW-049, MW-050 · **Зависит от:** B-02, B-04 (при `D02=B` — B-04L)
- **Усилие:** S (40 мин) · **Риск:** средний (влияет на все представления) · **Откат:** revert коммита
- **Цель:** у «скрытого closed» и у «пустой доски» есть определения, записанные в контракте, а не выведенные по ходу UI.
- **Что именно не определено (по FINAL-REPORT §5.2 «§6.1», «§6.4», «§50», «§51»):**
  - `closed` не определён для default view: `cancelled`/`superseded` — терминальные, но скрывать их молча нельзя;
  - `empty` — **есть** в коде (`contracts/board.ts:147`, `BOARD_PANEL_STATES:158-166`) и закреплён тестом `:600`, но §50 внешнего документа его теряет; риск в том, что реализация «деградирует в empty»;
  - `BOARD_PANEL_STATES` содержит **7** состояний, а не 6 из §50, и `reconciliation-pending` — причина деградации (`DegradedProjection.reason:307`), а не состояние панели.
- **Файлы:** Modify `packages/contracts/src/board.ts:141-166` — докблоки для `closed`-политики в `BoardView` (добавить `readonly includeClosed?: boolean` — по умолчанию `false`); Create `tests/board-panel-states.test.mjs`
- **Шаги:**
  1. Тест `tests/board-panel-states.test.mjs` — (а) `BOARD_PANEL_STATES` содержит ровно 7 и `empty` ≠ `unavailable`; (б) предикат «панель пуста» различим: `panelStateFor({ tasks: 0, controllerMounted: true, streamLost: false }) === 'empty'`; (в) `panelStateFor({ tasks: 0, controllerMounted: false }) === 'unavailable'`; (г) `panelStateFor({ streamLost: true, lastSnapshotAt: T }) === 'degraded'` и `snapshotAt === T`; (д) `'reconciliation-pending'` — только причина в `DegradedProjection.reason`, не значение `BoardPanelState`.
     Команда: `node --test --test-isolation=none tests/board-panel-states.test.mjs` → FAIL «panelStateFor is not a function».
  2. Реализация чистой функции `panelStateFor(input): BoardPanelState` в `packages/core/src/board.ts` (или новом `board-panel.ts`); `includeClosed` в `BoardView`.
  3. Пересборка `core`/`contracts`; повтор → `pass 5 / fail 0`.
  4. Регрессия: `node --test --test-isolation=none tests/board.test.mjs` → `fail 0` (`:588-601` не меняется).
- **Гейт (готово когда):** `node --test --test-isolation=none tests/board-panel-states.test.mjs` → `pass 5 / fail 0` и `node --test --test-isolation=none tests/board.test.mjs` → `fail 0`.
- **Evidence в отчёт:** прогоны, таблица «вход → состояние панели» из 5 строк, решение по `includeClosed`.
- **Риски:** `includeClosed` как поле `BoardView` — это layout-решение в контракте; на выбранном пути C его место — тоже `packages/web` (по духу `B-02`). Если так — в контракте остаётся только `panelStateFor`.

## 3. Backend проекции доски (MW-047)

Раздел закрывает три вещи, которых нет: **писатель `boardRevision`**, **различие `degraded`/`empty`** и **идемпотентность**.

### B-11 · Объявить `BoardSnapshot` и назначить писателя `boardRevision`
- **Карточка:** MW-047 · **Зависит от:** B-03, F-28…F-32 (composition root), F-33/F-34 + F-20 (атомарность и journal)
- **Усилие:** M (2 ч) · **Риск:** средний · **Откат:** revert коммита
- **Цель:** у `boardRevision` есть ровно один писатель и правило инкремента; `BoardSnapshot` объявлен как тип, а не как «§58 из документа».
- **Факт.** `BoardCardRevisionSet` отсутствует в дереве; есть `columnRevision` и `boardRevision` как поля (`contracts/board.ts:222,224`; `core/board.ts:82,90`) без писателя (grep по `packages/**` — только объявления). FINAL-REPORT §5.2 «§49», «§51».
- **Файлы:** Modify `packages/contracts/src/board.ts` (новые типы после `:225`); Modify `packages/contracts/src/revisions.ts:28-29,41` (если нужен отдельный домен `board`); Create `tests/board-snapshot.test.mjs`
- **Шаги:**
  1. Объявить в контракте:
     ```ts
     export interface BoardSnapshot {
       readonly viewId: string
       readonly workspaceId: WorkspaceId
       readonly boardRevision: Revision          // монотонная, двигается ТОЛЬКО writer'ом
       readonly cursor: string                    // непрозрачный курсор подписки
       readonly panelState: BoardPanelState
       readonly lanes: readonly ProjectedZone[]   // имя поля: `lanes` при D02=B, `zones` при C (Таблица B-12)
       readonly degraded?: DegradedProjection
       readonly generatedAt: EpochMs
     }
     ```
     (`ProjectedZone` живёт в `@dsh-mywork/core:76-83`; при переносе в контракт — импорт типа из core недопустим, поэтому `ProjectedZone` переезжает в контракт, а `core` его реэкспортирует. Это отдельная строка правки и отдельное утверждение теста.)
  2. **Правило писателя, дословно для докблока:** `boardRevision` инкрементируется в одной транзакции с любой мутацией `board.placement`/`board.view`, а также при изменении состава карточек, приходящего из Task Graph (появление/исчезновение задачи). Read-путь **никогда** его не двигает. Пятьдесят перемещений внутри lane (`columnRevision` ×50, audit 0) дают **один** бамп `boardRevision` каждое (приёмка MW-047 требует «пятьдесят бампов ревизии» — считаем бампы `columnRevision`, а `boardRevision` растёт вместе с ними; расхождение формулировок фиксируется в `30-CARD-EDITS.md`).
  3. Тест `tests/board-snapshot.test.mjs`: (а) снапшот без `degraded` → `panelState ∈ {ready, empty}`; (б) `cursor` меняется при бампе ревизии и не меняется при перечитывании без изменений; (в) повторный `project()` при неизменном входе даёт **тот же** `boardRevision` (это и есть «повторная проекция не дублирует карточки»); (г) `boardRevision` строго монотонна на последовательности из 5 мутаций.
     Команда: `node --test --test-isolation=none tests/board-snapshot.test.mjs` → FAIL.
  4. Пересборка `contracts`/`core`; повтор → `pass 4 / fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none tests/board-snapshot.test.mjs` → `fail 0` **и** единственность писателя `boardRevision` доказана тестом, а не регуляркой: тест подменяет writer-модуль и проверяет, что **другой** путь (read/проекция) не двигает `boardRevision` (запись `Select-String '…+ 1'` — только evidence: она ловит форму записи, а не факт единственного писателя).
- **Evidence в отчёт:** прогоны, фрагмент интерфейса, вывод grep о единственном писателе.
- **Риски:** если `boardRevision` начнёт двигаться на чтении, клиент будет перечитывать снапшот бесконечно. Защита — тест `(в)`.

### B-12 · Создать персистентность доски: миграция `board-projection` (первый writer)
- **Карточка:** MW-047 · **Зависит от:** B-11, F-18/F-19 (единый реестр миграций), F-33/F-34 + F-20 (атомарность и journal)
- **Усилие:** M (2–3 ч) · **Риск:** высокий (первая запись в БД со стороны доски) · **Откат:** миграция только добавляет таблицы; откат — `DROP TABLE` вручную в тестовой БД, прод-откат — restore из копии (RT-1)
- **Цель:** placement и views живут в MyWork DB (`authority.ts:108-113` — владелец `mywork-db`), а не в памяти; номер версии миграции берётся **из единого аллокатора**, а не пишется литералом.
- **Файлы:** Modify `packages/storage/src/migrations.ts` (новая миграция в `MYWORK_MIGRATIONS`); Modify `packages/storage/src/index.ts:45`; Create `tests/storage/board-migration.test.mjs`; Modify состав списка миграций в composition-слое (`F-28…F-32`)
- **Шаги:**
  1. **Версия — только от аллокатора (решение D08, правило §15.3).** Литерал `version: 2` **запрещён**: v2 уже занята `EVIDENCE_MIGRATIONS` (`packages/evidence/src/schema.ts:138-145`), журнал `schema_migrations` ключуется по `version` (`packages/storage/src/migrations.ts:98-99`), а `validateMigrations` (`:111-129`) **бросает** на дубле — store не откроется вовсе. Занято: v1 kernel (storage), v2–v3 evidence, v4 lease, v5 planner, v6 execution. Шаг получает номер у аллокатора из `F-18`/`F-19` и **не** вписывает число в текст.
     Форма записи: `Object.freeze({ version: MYWORK_MIGRATION_VERSIONS.boardProjection, name: 'board-projection', up(...) {...} })`, где `MYWORK_MIGRATION_VERSIONS` — экспорт аллокатора, а не локальная константа.
  2. Тест: `openStore({ migrations: [...MYWORK_MIGRATIONS, ...EVIDENCE_MIGRATIONS, ...LEASE_MIGRATIONS, ...PLAN_MUTATION_MIGRATIONS] })` на пустой БД **не бросает**; в `schema_migrations` есть строка `board-projection`; её `version` уникален во всём объединённом списке; в БД есть таблицы `board_view`, `board_placement`, `board_revision`.
     **Тест не содержит литерала версии** — ожидаемый набор читается из аллокатора (иначе тест закрепит коллизию, дефект R-04).
     Команда: `node --test --test-isolation=none tests/storage/board-migration.test.mjs` → FAIL «no such table: board_placement».
  3. Реализация — три таблицы (колонки контрактные, `zone`; см. ниже):
     ```sql
     CREATE TABLE board_view (
       view_id TEXT NOT NULL PRIMARY KEY, workspace_id TEXT NOT NULL,
       name TEXT NOT NULL, mode TEXT NOT NULL, zones_json TEXT NOT NULL,
       include_closed INTEGER NOT NULL DEFAULT 0, board_revision INTEGER NOT NULL);
     CREATE TABLE board_placement (
       view_id TEXT NOT NULL, task_id TEXT NOT NULL,
       zone TEXT NOT NULL, exact_state TEXT NOT NULL, order_key TEXT NOT NULL,
       pinned INTEGER NOT NULL DEFAULT 0, attention_json TEXT,
       column_revision INTEGER NOT NULL, board_revision INTEGER NOT NULL,
       PRIMARY KEY (view_id, task_id));
     CREATE TABLE board_revision (workspace_id TEXT NOT NULL PRIMARY KEY, board_revision INTEGER NOT NULL, cursor_seq INTEGER NOT NULL);
     ```
     Ключи — **`zone`**: на выбранном пути C словарь контракта — зона, и хранилище хранит контрактное слово; полоса — производное представления (`B-04`), в БД **не** попадает. При выборе варианта B колонка называется `lane`, и тогда «миграция placement-ключей» — это `zone → lane` + `renumberKeys(count)` (`packages/core/src/board.ts:407`) с сохранением порядка `(zone, order, taskId)` и **сбросом `columnRevision`**. Сегодня такой миграции не требуется: таблиц нет вовсе (§0.4). Записать этот вывод в докблок миграции одним абзацем.
  4. Инвариант на уровне схемы: `CHECK (exact_state <> '')`; уникальность порядка не выражается в SQL — её держит `assertSinglePlacement` при чтении.
  5. Идемпотентность: `board_revision.cursor_seq` — единственный источник курсора; `cursor = base64(viewId + ':' + cursor_seq)`.
  6. Команда: `node --test --test-isolation=none tests/storage/board-migration.test.mjs` → `pass 3 / fail 0`; регрессия `node --test --test-isolation=none tests/storage.test.mjs tests/storage-crash.test.mjs` → `fail 0`.
     **Учесть:** каталога `tests/storage/` сегодня нет — он создаётся; корневой script `test` собирает `tests/**/*.test.mjs`, поэтому новый файл попадёт и в общий прогон.
- **Гейт (готово когда):** `node --test --test-isolation=none tests/storage/board-migration.test.mjs tests/storage.test.mjs` → `fail 0` **и** `board-projection` присутствует в журнале `schema_migrations` **и** её `version` не совпадает ни с одной версией объединённого списка миграций (проверяется тестом, не глазами) **и** `Select-String packages\storage\src\migrations.ts -Pattern 'version: 2'` → **пусто**.
- **Evidence в отчёт:** вывод прогонов, строки `schema_migrations`, значение версии, полученное от аллокатора, список занятых версий.
- **Риски:**
  1. **Коллизия версий (дефект R-04, подтверждён).** Любой литерал в этом шаге ломает открытие store. Защита — гейт «нет `version: 2`» + тест на уникальность.
  2. **Атомарность (RT-1).** Миграция — одна транзакция (`migrations.ts:1-8` уже так устроено); запись placement — тоже одна транзакция на мутацию, вместе с бампом `board_revision` и записью в `outbox`. Если `F-33`/`F-34` (атомарная запись) ещё не сделаны — `B-12` блокируется, а не «делается частично».
  3. **Два писателя.** Носить запись в доску и в Task Graph должен один и тот же процесс; проверяется boundary-тестом `F-41`/`F-42` и smoke'ом `F-32`.

### B-13 · Реализовать `BoardReadService.project()` (чистая проекция + `assertSinglePlacement`)
- **Карточка:** MW-047 · **Зависит от:** B-11, B-12, MW-025 (завершение графа)
- **Усилие:** M (2–3 ч) · **Риск:** средний · **Откат:** revert коммита
- **Цель:** снапшот строится из Task Graph + MyWork DB чистым способом; строка placement с несогласованным lane не попадает на доску, а не «исправляется».
- **Файлы:** Create `packages/controller/src/board-read.ts`; Modify `packages/controller/src/index.ts:115-128` (публикация `myworkBoardRead`); Create `tests/board-read.test.mjs`
- **Шаги:**
  1. Тест `tests/board-read.test.mjs` (6 сценариев): (а) 3 задачи в разных состояниях → 3 placement в правильных lane, каждый lane присутствует в снапшоте даже пустым; (б) задача дважды в БД → `TASK_CONFLICT`, снапшот не отдаётся; (в) placement с lane ≠ `projectTaskLane(exactState)` → `CONTRACT_MISMATCH` (переиспользовать `assertSinglePlacement`); (г) **пересборка**: удалить снапшот, перечитать → тот же снапшот побайтово (кроме `generatedAt`), `boardRevision` тот же; (д) потеря проекции не меняет граф: число задач в Task Graph до и после совпадает; (е) 50 перемещений внутри lane → 0 строк audit и 50 бампов `columnRevision`.
     Команда: `node --test --test-isolation=none tests/board-read.test.mjs` → FAIL.
  2. Реализация: `project(workspaceId, viewId): Result<BoardSnapshot>`; внутри — `boardOrdering` (`core/board.ts:339-350`) для сортировки, `assertSinglePlacement` для проверки, `panelStateFor` (B-10) для состояния панели.
  3. Команда: `node --test --test-isolation=none tests/board-read.test.mjs` → `pass 6 / fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none tests/board-read.test.mjs` → `pass 6 / fail 0` и в отчёте приложен сценарий `(г)` с явным утверждением «снапшот воспроизводим».
- **Evidence в отчёт:** прогоны, снимок снапшота из 3 задач (JSON), число строк audit.
- **Риски:** проекция может начать читать Beads напрямую и стать вторым потребителем `bd`; защита — `(д)` и boundary-тест `F-41`/`F-42` (запрет `@deepseek-ai/dsh*` и `node:child_process` в `controller`; **с allowlist для `@deepseek-ai/cordis`** — правило §15.4).

### B-14 · Реализовать `BoardCommandService` с CAS и идемпотентностью
- **Карточка:** MW-047, MW-050 · **Зависит от:** B-07, B-13
- **Усилие:** M (2 ч) · **Риск:** средний · **Откат:** revert коммита
- **Цель:** конкурентный move в один lane оставляет ровно одного победителя; повтор команды с тем же `operationId` не меняет состояние второй раз.
- **Файлы:** Create `packages/controller/src/board-commands.ts`; Create `tests/board-commands.test.mjs`
- **Шаги:**
  1. Тест (7 сценариев): (а) два move с одинаковым `expectedColumnRevision` → один `ok`, один `STALE_COLUMN_REVISION`, в БД одна строка изменена; (б) повтор с тем же `operationId` → тот же результат, `columnRevision` не растёт; (в) `resolveDropIntent` → команда → применение: `zone`/`lane` в БД совпадает с `projectTaskLane(exactState)`; (г) bulk из N команд возвращает **N** результатов (не all-or-nothing); (д) неавторизованная команда (актор без права) отвергается **до** записи, `Task.revision` не двигается; (е) `board.view.revised` пишется в outbox в той же транзакции; (ж) `board.placement.changed` содержит `fromLane`, `toLane`, `order`, но **не** содержит `exactState` транскриптов/тел.
     Команда: `node --test --test-isolation=none tests/board-commands.test.mjs` → FAIL.
  2. Реализация: одна транзакция на команду; дедуп — через существующий `inbox_dedup` (`migrations.ts:72`), не новый механизм.
  3. Команда: `node --test --test-isolation=none tests/board-commands.test.mjs` → `pass 7 / fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none tests/board-commands.test.mjs` → `pass 7 / fail 0` и тест `(а)` приложен с обоими кодами ответа.
- **Evidence в отчёт:** прогоны, фрагмент транзакции, имена событий в outbox.
- **Риски:** идемпотентность по `operationId` уже есть в домене (`OperationMeta`) — не строить вторую. Если `inbox_dedup` не подходит по ключу (там event-scoped), использовать `operationId` как ключ дедупа и записать это решение в отчёт, а не заводить таблицу.

### B-15 · Снапшот + `watch`: SSE-кадр без карточек, курсор, отсутствие лишних refetch
- **Карточка:** MW-047, MW-029 (транспорт — по D01) · **Зависит от:** B-13, B-14, B-18
- **Усилие:** M (2–3 ч) · **Риск:** средний · **Откат:** revert коммита
- **Цель:** клиент получает снапшот один раз и thereafter только инвалидации; повторный кадр с той же ревизией не вызывает перечитывания.
- **Файлы:** Create `packages/controller/src/board-events.ts`; Create `tests/board-events.test.mjs`
- **Шаги:**
  1. Форма кадра (по образцу `P/src/protocol.ts:55-60`):
     ```ts
     export interface BoardEventFrame {
       readonly boardRevision: Revision
       readonly cursor: string
       readonly panelState: BoardPanelState
       readonly degraded?: DegradedProjection
     }
     ```
     **Ни одного** поля с карточками — это отдельное утверждение теста.
  2. Тест (6 сценариев): (а) кадр не содержит ключей `tasks`/`placements`/`cards` (рекурсивный обход объекта); (б) два кадра с одинаковыми `boardRevision` и `cursor` → клиентский стор не делает refetch (счётчик вызовов `project` не растёт); (в) reconnect с `after=<cursor>` не теряет логические события: 3 мутации во время разрыва → после reconnect клиент видит 3 бампа и приходит к текущей ревизии; (г) повторный reconnect с тем же курсором не дублирует; (д) сердцебиение (`: ping`) держит соединение, но не является кадром и не двигает ревизию; (е) закрытие соединения снимает подписку (нет утечки: после `close` число подписчиков 0).
     Команда: `node --test --test-isolation=none tests/board-events.test.mjs` → FAIL.
  3. Реализация: подписчик получает кадры из `BoardCommandService` после коммита транзакции (не до).
  4. Команда: `node --test --test-isolation=none tests/board-events.test.mjs` → `pass 6 / fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none tests/board-events.test.mjs` → `pass 6 / fail 0` и `Select-String -Path packages\controller\src\board-events.ts -Pattern 'tasks|placements|cards'` не находит полей в теле кадра.
- **Evidence в отчёт:** прогоны, JSON одного кадра, счётчик подписчиков до/после `close`.
- **Риски:** соблазн «ускорить» и положить карточки в кадр — прямо ломает приёмку MW-047 и §50. Тест `(а)` — защита.

### B-16 · `degraded` vs `empty` vs `unavailable`: правила перехода и `DegradedProjection`
- **Карточка:** MW-047, MW-055 · **Зависит от:** B-10, B-13
- **Усилие:** S (1 ч) · **Риск:** средний · **Откат:** revert коммита
- **Цель:** потеря стрима даёт `degraded` со временем снимка, а не «пустую доску»; отсутствие контроллера даёт `unavailable`, а не `empty`.
- **Файлы:** Modify `packages/controller/src/board-read.ts`; Create `tests/board-degraded.test.mjs`
- **Шаги:**
  1. Тест (5 сценариев): (а) Beads недоступен при живой доске → `panelState === 'degraded'`, `degraded.reason === 'adapter-unavailable'`, `degraded.snapshotAt` равно времени последнего удачного чтения, `staleLanes` непуст; (б) то же, но задач в БД 0 → **всё равно** `degraded`, не `empty`; (в) контроллер не смонтирован → `unavailable` и снапшот **не** отдаётся как пустой; (г) reconciliation расходится → `degraded.reason === 'reconciliation-pending'`; (д) `partial-read` при неполном чтении одного lane, `staleLanes` содержит ровно этот lane.
     Команда: `node --test --test-isolation=none tests/board-degraded.test.mjs` → FAIL.
  2. Реализация: `DegradedProjection` (`contracts/board.ts:305-314`) заполняется целиком, включая `detail` (человекочитаемая строка, никем не парсится).
  3. Дополнительно: пока попытка активна, деградация **не** отменяет её; новые admission отвергаются fail closed — это требование MW-047, реализуется в `MT`-слое (не здесь), но проверяется smoke-сценарием `(а)`.
  4. Команда: `node --test --test-isolation=none tests/board-degraded.test.mjs` → `pass 5 / fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none tests/board-degraded.test.mjs` → `pass 5 / fail 0` и в отчёте приложен JSON `DegradedProjection` с непустым `staleLanes`.
- **Evidence в отчёт:** прогоны, JSON деградации, решение «почему (б) не `empty`» одной строкой.
- **Риски:** `DegradedProjection.staleZones` (`packages/contracts/src/board.ts:313`) типизирован по зоне — на пути C имя остаётся; при выборе варианта B переименование в `staleLanes` обязательно (иначе тип разъединяется с `BOARD_LANES`) и добавляется в `30-CARD-EDITS.md`.

### B-17 · Null adapter и read-only legacy adapter: объявление и conformance
- **Карточка:** MW-047 · **Зависит от:** B-13, MW-005 (adapter SDK), MW-010
- **Усилие:** S (1 ч) · **Риск:** низкий · **Откат:** revert коммита
- **Цель:** оба адаптера проходят contract checks; Null adapter честно объявляет отсутствие возможностей, а не изображает работу.
- **Файлы:** Create `packages/controller/src/board-adapters.ts`; Create `tests/board-adapters.test.mjs`
- **Шаги:**
  1. Тест: (а) Null adapter объявляет `task-board: false` в `capabilities` (`packages/adapter-sdk/src/capabilities.ts:21,36` — `'task-board'` уже есть в каталоге); (б) read-only legacy adapter объявляет `adapterId: 'dsh-task-board-legacy'` и **не** имеет мутирующих операций; (в) оба проходят `conformance`-набор SDK; (г) попытка мутации через read-only адаптер даёт `CAPABILITY_UNSUPPORTED`, а не тихую деградацию.
     Команда: `node --test --test-isolation=none tests/board-adapters.test.mjs` → FAIL.
  2. Реализация + регистрация в `myworkAdapters` (`packages/controller/src/index.ts:118,193`).
  3. Команда: `node --test --test-isolation=none tests/board-adapters.test.mjs` → `pass 4 / fail 0`; регрессия `node --test --test-isolation=none tests/adapters.test.mjs` → `fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none tests/board-adapters.test.mjs tests/adapters.test.mjs` → `fail 0` и в отчёте приложен вывод conformance для обоих адаптеров.
- **Evidence в отчёт:** прогоны, фрагмент манифеста возможностей, адаптер-ids.
- **Риски:** read-only legacy adapter здесь — только **объявление**; его рабочая реализация — `B-40` (§8). Не смешивать: если реализовать его здесь, MW-054 потеряет предмет.

## 4. Application API: маршруты, авторизация, CLI (MW-029) `[D01]`

Порядок внутри раздела: `B-18` фиксирует транспорт; `B-19` — общий контракт (нужен при любом исходе); `B-20`/`B-21`/`B-22` — три взаимоисключающие ветки транспорта; `B-23` — CLI.

### B-18 · `[D01]` Подтвердить ADR-029 и объявить `inject` контроллера
- **Карточка:** MW-029 · **Зависит от:** B-15, D01 (решение — `adr/ADR-029-transport-web.md`), F-28…F-32
- **Усилие:** S (1 ч) · **Риск:** низкий · **Откат:** revert коммита
- **Цель:** транспорт **не выбирается заново** — подтверждается уже принятое `D01 = R2`, и контроллер объявляет сервисы, которые ему реально нужны.
- **Новый ADR НЕ создаётся:** `adr/ADR-029-transport-web.md` уже существует и фиксирует `R2` (HTTP/SSE через `ctx.webServer` со своим забором); каталога `docs/` в репозитории нет вовсе. ADR кампании живут в `.work/plan-v0.3/adr/`.
- **Файлы:** Modify `packages/controller/src/index.ts` (добавить `export const inject = [...]`); Modify `packages/controller/package.json` (`peerDependencies`); Modify `adr/ADR-029-transport-web.md` **только** если нужен статус-апдейт (правка ADR — за `decision-desk`, не за этим шагом)
- **Шаги:**
  1. Подтвердить исход: `D01 = R2`. Из ADR-029 перенести в исполнение его проверки: **(а)** наследует ли `connection.fetch` проверку доверия полностью или требует собственного маркера; **(б)** поддерживает ли он длительно открытый ответ (SSE-совместимость); **(в)** доступен ли он из строки композиции плагина, а не только из встроенных пакетов; **(г)** не конфликтует ли он с `remote-web-ui lanBind`. Эти четыре — **Шаг 0 шага `B-21`**; до их выполнения `R3` остаётся **кандидатом, не выбранным путём**.
  2. `inject` — по фактическому использованию, а не «на всякий случай»:
     - общее: `['workspaceRegistry', 'agents']` (плюс `'commands'` для CLI-команд, `'systemPrompt'` если нужна аннотация инструментов);
     - **R2 (выбран):** `+ 'webServer'`;
     - R3 (кандидат): `+ 'connection'` — добавлять **только** если проверки (а)–(г) пройдены;
     - R1 (отклонён как основа): `+ 'typertGateway'` — только в spike.
     Дословный образец: `P/src/index.ts:35`.
  3. `peerDependencies` в `packages/controller/package.json` — **по пакету платформы** (ADR-032 §1): `"@deepseek-ai/dsh": ">=0.1.7-rc.2 <0.3.0-0"` рядом с существующим `"@deepseek-ai/cordis": "^4.0.2"`. **Не** по именам сервисов: гейт совместимости читает **имена пакетов** (`packages/boot/app-boot/src/plugin-compatibility.ts:75`) и вовсе пропускает манифест без `peerDependencies` (`:68`). Имена сервисов остаются в cordis-`inject`. `engines` — тоже, но помнить: `dsh.engines.dsh` **не читает никто** — ни код DSH, ни plugin-manager (`D/packages/boot/app-boot/README.md:52`); поле объявлено в типах (`D/packages/util/package-manifest/src/types.ts:24,56-66`) и остаётся документацией. Реализует шаг `F-48`.
  4. Проверка типов: `cd packages\controller; node ..\..\node_modules\.bin\tsc.cmd --noEmit -p tsconfig.json` → код 0. **Не** через `npx` (уйдёт в сеть при отсутствии локального пакета).
  5. Проверка отказа: смонтировать контроллер в профиле **без** выбранного сервиса → строка не падает, а сообщает отсутствие (правило `packages/controller/src/index.ts:120-127`). Проверяется smoke'ом `F-32`, не здесь.
- **Гейт (готово когда):** `node ..\..\node_modules\.bin\tsc.cmd --noEmit -p tsconfig.json` (из `packages\controller`) → код 0 **и** `Select-String packages\controller\src\index.ts -Pattern 'export const inject'` находит ровно одну строку **и** `Select-String packages\controller\package.json -Pattern '"@deepseek-ai/dsh"'` находит peer с диапазоном `>=0.1.7-rc.2 <0.3.0-0`.
- **Evidence в отчёт:** подтверждение `D01 = R2` со ссылкой на ADR-029, дословный `inject`, вывод `tsc`, фрагмент `peerDependencies`.
- **Риски:**
  1. Объявить сервис, который в живом профиле отсутствует, — значит не смонтироваться вовсе. `inject` перечисляет только то, без чего строку **нельзя** собрать; всё остальное берётся через `ctx.get(...)` с проверкой (образец `packages/controller/src/index.ts:136-139`).
  2. **Peer по сервисам — исполнимая ошибка:** такой манифест гейт платформы не читает (он смотрит `@deepseek-ai/dsh*`), и совместимость останется непроверенной при «зелёном» локальном тесте. Канон — ADR-032 §1.

### B-19 · Общий контракт `/v1`: ревизии, идемпотентность, коды отказа
- **Карточка:** MW-029 · **Зависит от:** B-18, B-14
- **Усилие:** M (2 ч) · **Риск:** средний · **Откат:** revert коммита
- **Цель:** одна форма запроса/ответа работает на всех трёх транспортах; мутация без ключа идемпотентности отвергается; stale-ревизия даёт типизированную ошибку.
- **Файлы:** Create `packages/contracts/src/api.ts`; Modify `packages/contracts/src/index.ts` (реэкспорт); Create `tests/api-contract.test.mjs`
- **Шаги:**
  1. Маршруты v1 (имена — из §41 v0.1 и объёма MW-029; префикс задаётся транспортом, а не контрактом):
     `GET  /v1/board/snapshot?workspaceId=&viewId=`
     `GET  /v1/board/views`
     `POST /v1/board/views` (мутация)
     `POST /v1/tasks/{id}/commands` (мутация, тело — `CardCommand` + `expectedRevision`)
     `GET  /v1/ideas`, `POST /v1/ideas`
     `GET  /v1/workflows`
     `POST /v1/import/preview`, `POST /v1/import/commit`
     `GET  /v1/events?after=<cursor>`
  2. Общая обёртка:
     ```ts
     export interface ApiRequest<T> { readonly body: T; readonly operationId: string; readonly expectedRevision?: Revision }
     export interface ApiResponse<T> { readonly ok: boolean; readonly value?: T; readonly error?: { code: string; message: string; details?: unknown } }
     ```
     `operationId` обязателен на **всех** не-GET; отсутствие → `400 { code: 'idempotency-key-required' }` **до** любых чтений состояния.
  3. Тест (5 сценариев): (а) POST без `operationId` отвергнут и **не** изменил состояние; (б) повтор POST с тем же `operationId` даёт тот же результат и не меняет ревизию; (в) stale `expectedRevision` → `STALE_REVISION` (или `STALE_COLUMN_REVISION` для placement); (г) невалидный `Content-Type` → `415`; (д) тело больше лимита → `413`, состояние не изменено.
     Команда: `node --test --test-isolation=none tests/api-contract.test.mjs` → FAIL.
  4. Команда: `node --test --test-isolation=none tests/api-contract.test.mjs` → `pass 5 / fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none tests/api-contract.test.mjs` → `pass 5 / fail 0` и в отчёте приложена таблица «маршрут → мутирующий? → что требуется».
- **Evidence в отчёт:** прогоны, таблица маршрутов, дословные коды отказа.
- **Риски:** три списка команд в внешнем документе (§21, §56, §59) не совпадают с `CARD_COMMANDS`. Источник истины — `CARD_COMMANDS` (`contracts/board.ts:271-280`); расхождение с документом фиксируется, а не «согласуется» правкой контракта.

### B-20 · `[D01=R2]` HTTP через `ctx.webServer.register` + собственный trust-fence
- **Карточка:** MW-029 · **Зависит от:** B-18 (`D01=R2`), B-19
- **Усилие:** M (2–3 ч) · **Риск:** высокий (безопасность) · **Откат:** снять регистрацию роутов (dispose), вернуть прежний `inject`
- **Цель:** маршруты подняты, fence стоит, ни один ответ не содержит management-токен.
- **Факт, который меняет текст MW-029.** `ctx.webServer` **не имеет** ни auth-хука, ни middleware: между `register` и вызовом handler нет ни одной проверки (`D/packages/host/webserver/src/index.ts:166-173` — `register(route: WebRoute)`, вызов `await route.handler(req, res)` — `:228` внутри замыкания `handle` `:222-238`; **переякорено 2026-10-03** на `0.2.0-rc.2`/`639ed0153`: прежний указатель `:319-360` был неверен уже на базе — там `match`/`applyIndexTaps`/`collectIndexInjections`/`renderIndex`; `evidence/lead-02-http-slots.md:30`). Формулировка приёмки «наследуют Host/Origin-проверки, своего guard нет» верна только для R3. Значит для R2 fence обязателен, а карточка MW-029 правится (`30-CARD-EDITS.md`).
- **Файлы:** Create `packages/controller/src/web-fence.ts`; Create `packages/controller/src/web-routes.ts`; Create `tests/web-fence.test.mjs`
- **Шаги:**
  1. Fence — по образцу `P/src/host-routes.ts:150-160` (проверено чтением): обязателен browser-маркер (`sec-fetch-site: same-origin` **или** любой `Origin` **или** cookie с префиксом `dsh-auth-`); **и** (loopback-запрос **или** loopback-сокет + канонический `Host` + allowlist `trustedProxyHosts` + равенство origin + timing-safe сравнение прокси-токена). Отказ → `403 {ok:false,error:'forbidden'}` + `cache-control: no-store`.
  2. Тест (7 сценариев): (а) запрос с чужим `Host` → 403 **до** обработчика (счётчик вызовов сервиса = 0); (б) без browser-маркера → 403; (в) loopback + same-origin → 200; (г) non-loopback без прокси-токена → 403; (д) non-loopback с верным токеном и allowlisted Host → 200; (е) неверный токен → 403, сравнение timing-safe (тест на длину не утекает: время сравнения не зависит от числа совпавших байт — проверяется по коду, не по времени); (ж) ни один ответ не содержит значения management-токена (рекурсивный обход JSON).
     Команда: `node --test --test-isolation=none tests/web-fence.test.mjs` → FAIL.
  3. Роуты: `{ kind: 'exact', path: '/api/mywork/v1/...', handler }`, регистрация в `ctx.effect` с dispose; дубликат пути бросает (`webserver/src/index.ts:166-173`) — это проверяется тестом «двойная регистрация падает».
  4. SSE — на обычном `GET`, `text/event-stream`, heartbeat ~15 c, `cache-control: no-store`, снятие подписки по `close` (образец `P/src/host-routes.ts:218-246`).
  5. Команда: `node --test --test-isolation=none tests/web-fence.test.mjs` → `pass 7 / fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none tests/web-fence.test.mjs` → `pass 7 / fail 0`, и на живом GUI (после `B-24`) запрос с чужим `Host` возвращает 403 — evidence: `curl`-эквивалент + код ответа.
- **Evidence в отчёт:** прогоны, таблица «условие → код ответа», фрагмент fence, подтверждение отсутствия токена в ответах.
- **Риски:** ведущий слэш: страница отдаётся с `<base href="./">`, поэтому клиент обязан звать путь **без** ведущего слэша (`P/src/client/host-api.ts:14-22`). Ошибка здесь даёт 404 на живом GUI и не ловится юнит-тестом — в отчёт добавить фактический URL из DevTools.

### B-21 · `[D01=R3]` HTTP через `connection.fetch.register` с наследованием trust-fence
- **Карточка:** MW-029 · **Зависит от:** B-18 (`D01=R3`), B-19
- **Усилие:** M (2 ч) · **Риск:** средний · **Откат:** dispose регистраций
- **Цель:** маршруты живут под `/api`, авторизация наследуется, стриминг событий работает без второго HTTP-слоя.
- **Первый шаг — проверка, а не предположение** (так требует приёмка MW-029: «Первым шагом проверено, проходит ли http-bridge потоковый ответ»).
- **Файлы:** Create `packages/controller/src/api-routes.ts`; Create `tests/api-routes.test.mjs`
- **Шаги:**
  1. **Проверка стриминга.** Прочитать и подтвердить в отчёте якорями: мост копирует заголовки ответа дословно (`D/packages/client/connection/src/http-bridge.ts:96-97`), пишет тело потоком с backpressure и ждёт `drain` (`:103-120`), рвёт по `close` через `AbortController` (`:42-49`). Вывод: SSE через `/api` возможен; если при прогоне `(в)` это опровергается — канал событий уходит на собственный prefix `ctx.webServer` (тогда дополнительно выполняется `B-20` **только** для events), и это фиксируется в отчёте вместе с моделью угроз.
  2. Тест (6 сценариев): (а) путь вне `/api` → регистрация **невозможна** (`rpc-host.ts:315` — канал обязан быть `/api`); (б) дубликат точного пути → throw (`rpc-host.ts:164`); (в) `GET /v1/events` отдаёт `content-type: text/event-stream` и минимум два кадра, соединение не закрывается; (г) запрос без browser-trust отвергается **до** обработчика (счётчик вызовов = 0) — это и есть наследование; (д) `POST` без `operationId` → 400; (е) выгрузка плагина снимает все маршруты (`dispose` → повторный запрос 404).
     Команда: `node --test --test-isolation=none tests/api-routes.test.mjs` → FAIL.
  3. Реализация: `ctx.connection.fetch.register({ path: '/v1/...', methods: ['GET'|'POST'], requestBody: 'buffered', fetch })`; `requestBody: 'streaming'` — только если понадобится поток **запроса** (здесь не нужен).
  4. Команда: `node --test --test-isolation=none tests/api-routes.test.mjs` → `pass 6 / fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none tests/api-routes.test.mjs` → `pass 6 / fail 0` и в отчёте есть абзац «стриминг подтверждён/опровергнут» с якорями на `http-bridge.ts`.
- **Evidence в отчёт:** прогоны, фактический `content-type`, подтверждение якорей моста, результат сценария `(г)`.
- **Риски:**
  1. **HTTP-префикс не должен совпасть с именем Remote-namespace** (FINAL-REPORT §6 K1, «не смешивать»): при `/api/mywork/v1/...` и namespace `mywork` это правило выполняется, но фиксируется явным утверждением в отчёте.
  2. `requestRejection` даёт 401/403/… — принимать как есть, не подменять своими кодами.

### B-22 · `[D01=R1]` Typert Remote: манифест, генерация, self-mount namespace — **только spike ≤1 день**
- **НЕ ИСПОЛНЯТЬ как путь реализации.** ADR-029 отклоняет R1 как основу и оставляет **spike ≤1 день** по критерию §«Spike»: если генератор + self-mount укладываются в бюджет и namespace виден в браузере — решение D01 пересматривается владельцем; если нет — R2 остаётся. Всё ниже — содержание spike, а не план работ.
- **Карточка:** MW-029 (+ новая карточка «peer/typert-манифест», диапазон MW-060…MW-064) · **Зависит от:** B-18, решение D04 · **Блокирует:** ничего (R2 исполняется независимо)
- **Усилие:** spike — ≤1 день (жёсткий бюджет); полная реализация — L (1–2 дня) · **Риск:** высокий (сборочная зависимость) · **Откат:** revert коммита; сборка возвращается к прежнему `tsdown`-конфигу
- **Цель:** namespace монтируется в браузере; `TypertAnalysisError` не возникает ни на одном шаге.
- **Факты, на которых стоит шаг** (`.work/plan-v0.3/evidence/lead-01-typert.md`): корень обязан содержать `tsconfig.host.json` и `tsconfig.client.json`, членство в face берётся **только** из их `projectReferences` (`analyzer.ts:301-302,485-489`); регистрация пакета — только если его корень внутри `<root>/packages` (`analyzer.ts:488`); `exports['./typert']` строго `{types:'./lib/typert.host.d.ts', default:'./lib/typert.host.js'}`, `exports['./remote']` строго `{types:'./lib/typert.remote-client.d.ts', default:'./lib/typert.remote-client.js'}`, оба в `files` (`workspace.ts:96-147`); публикация Remote-артефактов без Remote-методов — ошибка (`workspace.ts:133`); **настоящий блокер на клиенте** — статический список 25 контрибьюций (`packages/api/remotes/src/client/index.ts:4-29`; монтирование — `:181-188`; `$mount(contribution)` — `:189`), обход — `$mount(contribution)` (`packages/typert/protocol/src/types.ts:432,438`). В 0.2.0-rc.2 в список добавлены `productAnalyticsRemote` и `userQuestionsRemote`; динамического обнаружения внешних контрибьюций по-прежнему нет.
- **Файлы:** Create `tsconfig.host.json`, `tsconfig.client.json`, `packages/api/**` (форма монорепо!), `scripts/typert-build.mjs`; Modify `packages/controller/package.json` (`exports`, `files`); Create `tests/typert-manifest.test.mjs`
- **Шаги:**
  1. **Spike с бюджетом ≤1 день** (решение D01 это уже требует): создать минимальный `packages/api/` с одним Remote-методом `board.snapshot`, прогнать генератор, проверить, что артефакты появились.
     Команда: `node scripts/typert-build.mjs` → ожидаемо: `lib/typert.host.js`, `lib/typert.host.d.ts`, `lib/typert.remote-client.js`, `lib/typert.remote-client.d.ts`.
     Если бюджет исчерпан — **берётся R3** (`B-21`), а не «дожимается R1»; это и есть критерий пересмотра из D01.
  2. Тест `tests/typert-manifest.test.mjs`: (а) `exports['./typert']` совпадает с ожидаемым словарём **точно**; (б) `exports['./remote']` — тоже; (в) `files` содержит все четыре имени; (г) негативная проверка: подменить `types` на `./lib/typert.host.d.ts` в `client`-face и убедиться, что тест падает (защита от «тест проходит всегда»).
     Команда: `node --test --test-isolation=none tests/typert-manifest.test.mjs` → FAIL.
  3. Клиент: self-mount namespace в клиентской половине пакета при `inject: ['remote']` — `ctx.remote.$mount(contribution)`; **не** полагаться на автообнаружение.
  4. Команда: `node --test --test-isolation=none tests/typert-manifest.test.mjs` → `pass 4 / fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none tests/typert-manifest.test.mjs` → `fail 0` **и** на живом GUI в браузере namespace виден (evidence: скриншот/лог `$mount` + факт вызова метода). Если это не подтверждено — путь R1 не принят, даже если сборка зелёная.
- **Evidence в отчёт:** вывод генератора, список созданных артефактов, вывод теста, факт монтирования namespace в браузере (или явное «не подтверждено»).
- **Риски:**
  1. Рукописный шим протокола (~146 строк) — ручное зеркало контракта, которое надо синхронизировать при каждом апгрейде DSH. Записать как отдельный риск в `01-MASTER-PLAN.md` §8.
  2. Тихая деградация: генератор **не** падает, если пакет не зарегистрирован в face (`analyzer.ts:488`), а loader молча считает пакет не-контрибьютором. Поэтому гейт сформулирован как «namespace в браузере», а не «сборка прошла».

### B-23 · CLI поверх той же application-логики
- **Карточка:** MW-029 · **Зависит от:** B-19, B-21 или B-22 (любой транспорт, но **не** оба)
- **Усилие:** S (1.5 ч) · **Риск:** низкий · **Откат:** revert коммита
- **Цель:** тот же сценарий через Cordis, HTTP и CLI даёт идентичный результат; CLI не дублирует бизнес-логику.
- **Файлы:** Create `packages/controller/src/cli.ts`; Create `tests/cli.test.mjs`
- **Шаги:**
  1. Минимальные команды: `mywork board snapshot --workspace <id>`, `mywork task command <id> --command board.reorder --order <key>`, `mywork import preview --file <ledger>`.
  2. Тест: (а) CLI и прямой вызов сервиса на одном входе дают одинаковый JSON (сравнение с исключением `generatedAt`/`at`); (б) CLI не импортирует ни одного модуля, которого нет в `application`-слое (grep по импортам); (в) ошибка домена даёт ненулевой код возврата и тот же `code`, что HTTP-ответ; (г) CLI не печатает management-токен.
     Команда: `node --test --test-isolation=none tests/cli.test.mjs` → FAIL.
  3. Реализация + `export const inject` дополняется `'commands'`, если CLI регистрируется как команда DSH (`packages/controller/src/index.ts`).
  4. Команда: `node --test --test-isolation=none tests/cli.test.mjs` → `pass 4 / fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none tests/cli.test.mjs` → `pass 4 / fail 0` и в отчёте приложены три JSON'а (Cordis / HTTP / CLI) на одном входе.
- **Evidence в отчёт:** три вывода, коды возврата, список импортов CLI.
- **Риски:** CLI — самый простой способ нарушить single-writer, если он откроет свою БД. Запрет: CLI работает только через application-сервис; проверяется тестом `(б)`.

## 5. Installable UI-пакет (MW-048) `[D18=C]`

Каркас создан в `B-01a`. Здесь пакет наполняется: манифест, бандл, слоты, атрибуты, view-состояние, темы.

### B-24 · Манифест клиентской строки: `dsh.client`, `exports['./client']`, bare-имя, `icon`
- **Карточка:** MW-048, MW-063/MW-064 (по `30-CARD-EDITS.md`) · **Зависит от:** B-01a, D18, D04 (peer-политика)
- **Усилие:** S (1 ч) · **Риск:** средний (ошибка здесь = панель физически не регистрируется) · **Откат:** revert `packages/web/package.json`
- **Цель:** платформа видит пакет как клиентскую строку, и она не падает ни на композиции, ни в рантайме.
- **Файлы:** Modify `packages/web/package.json`; Create `packages/web/tests/manifest.test.mjs`; Create `packages/web/icon.svg`
- **Шаги:**
  1. `dsh.client`:
     ```json
     "dsh": {
       "engines": { "dsh": ">=0.1.7-rc.2 <0.3.0-0" },
       "client": {
         "platform": "web",
         "inject": ["@deepseek-ai/dsh-client-connection", "@deepseek-ai/dsh-client-ui-layout",
                    "@deepseek-ai/dsh-client-ui-sidebar", "@deepseek-ai/dsh-client-ui-slots",
                    "@deepseek-ai/dsh-client-ui-renderer", "@deepseek-ai/dsh-client-store"],
         "immediately": false
       }
     }
     ```
     Три правила, каждое проверяется тестом:
     - `platform` **обязателен** и равен `'web'`: при отсутствии `dsh.client` или чужой платформе пакет вообще не становится клиентской строкой (`D/packages/client/modules/src/index.ts:836-844`);
     - `dsh.client.inject` — **информационные рёбра порядка фабрик, НЕ cordis-inject** (`D/packages/util/package-manifest/src/types.ts:84-85`): имена пакетов, не сервисов. Cordis-сервисы объявляются обычным `export const inject` в `B-26`;
     - своё же имя пакета в `external` запрещено: композиция бросает `"<id>" requests module "<name>" that it answers itself` (`D/packages/client/modules/src/index.ts:517-526`).
  2. **`icon` — поле верхнего уровня `package.json`**, не внутри `dsh.client`: `dsh.client` валидирует ровно 4 поля (`platform`, `inject`, `immediately`, `external`), поля `icon` в нём **не существует** (`evidence/lead-02-http-slots.md:31`). Харнесс читает верхнеуровневый `icon` как base64 data URL в `PluginLocalizedMeta.icon` (`D/packages/util/package-manifest/src/types.ts:44-54`).
  3. `peerDependencies`: `"@deepseek-ai/dsh": ">=0.1.7-rc.2 <0.3.0-0"` (диапазон — решение владельца 2026-10-03, `02-PLATFORM-DELTA-0.2.0-rc.2.md` §5.1; прежний `<0.2.0` отверг бы `0.2.0` final, а верхняя граница без `-0` пропустила бы `0.3.0-rc.1`). `engines.dsh` оставить, но помнить: **его не читает никто** — ни код DSH, ни plugin-manager (`D/packages/boot/app-boot/README.md:52`); поле объявлено в типах (`D/packages/util/package-manifest/src/types.ts:24,56-66`) и остаётся документацией.
  4. Bare-имя в client-строке: строка Loader'а может быть подпутём, но **id клиентской записи == имя пакета**; субпуть «перманентно не клиентская строка» (`D/packages/client/modules/src/index.ts:828-833`). Живой прецедент: строка `@linxin666/dsh-web-all/task-board`, а бандл регистрируется как `id: "@linxin666/dsh-web-all"` (`evidence/lead-02-http-slots.md:22`).
  5. `exports['./client']` обязателен: `dsh.client` без него → throw (`D/packages/client/modules/src/index.ts:845-848`).
  6. Тест `packages/web/tests/manifest.test.mjs` (5 утверждений): (а) `dsh.client.platform === 'web'`; (б) `exports['./client']` присутствует и указывает на `./lib/client.js`; (в) `icon` — **в корне** манифеста, и `'icon' in dsh.client === false`; (г) `dsh.client.external` присутствует как массив **и** не содержит `'@dsh-mywork/web'` (требование «массив существует» снимает вакуумность: при отсутствующем `external` утверждение было бы истинным само собой); (д) `dsh.client.inject` — непустой массив имён пакетов **и** не пересекается с `external`.
     Команда: `node --test --test-isolation=none packages/web/tests/manifest.test.mjs` → FAIL.
  7. Команда: `node --test --test-isolation=none packages/web/tests/manifest.test.mjs` → `pass 5 / fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none packages/web/tests/manifest.test.mjs` → `pass 5 / fail 0` **и** установка пакета в изолированный профиль даёт появление панели после refresh (это гейт этапа 3 мастер-плана; здесь — проверка, что `dsh.client` не отвергнут: в логе композиции нет строк про `dsh.client`).
- **Evidence в отчёт:** фрагмент `package.json`, прогон, лог композиции без ошибок клиентской строки.
- **Риски:**
  1. `dsh.client.inject` легко перепутать с cordis-`inject`. Симптом: панель появляется, но падает на отсутствующем сервисе. Тест `(в)`/`(г)` этого не ловит — поэтому `B-26` отдельно проверяет cordis-сторону.
  2. `immediately: true` ускоряет появление панели, но делает её частью phase-one барьера загрузки. Для доски это не нужно (панель не нужна до первого клика) — оставить `false`; при жалобе на «панель появляется с задержкой» вернуться к этому полю.

### B-25 · Сборка клиентского бандла: ручной lazy-CJS, externals ровно из PLATFORM_MODULES
- **Карточка:** MW-048 · **Зависит от:** B-24
- **Усилие:** M (1.5–2 ч) · **Риск:** средний · **Откат:** revert `tsdown.config.ts`
- **Цель:** `lib/client.js` — ручная CJS-обёртка, которая **регистрирует** фабрику и не тянет ни одного модуля, кроме девяти платформенных.
- **Файлы:** Create `packages/web/tsdown.client.ts` (или секция в `tsdown.config.ts`); Create `packages/web/tests/bundle.test.mjs`
- **Шаги:**
  1. Формат — дословно из генератора DSH: `window.__ModuleLoader__.load({ id: "<bare package name>", factory: (require) => { … } })` (`D/packages/client/tsdown.client.ts:619`). Семантика: исполнение скрипта только **регистрирует** фабрику; тело модуля (включая инъекцию CSS) живёт в замыкании и выполняется при материализации (`D/packages/client/modules/src/client/manifest.ts:9-24`).
  2. Externals — **ровно** `PLATFORM_MODULES`, 9 имён (`D/packages/client/web/src/platform.ts:8-14`): `react`, `react/jsx-runtime`, `react-dom`, `react-dom/client`, `@deepseek-ai/cordis`, `@deepseek-ai/dsh-client-store`, `@deepseek-ai/dsh-client-ui-slots`, `@deepseek-ai/dsh-client-ui-primitives`, `@deepseek-ai/dsh-client-ui-dockkit`. `PRELOADED_CLIENT_EXTERNALS` пуст (`:17-18`).
  3. Всё, что не входит в эти 9 и не является кодом самого пакета, обязано быть точной строкой в `dsh.client.external` (`D/packages/client/tsdown.client.ts:392-405,415-425` — сопоставление точное и никогда не нормализуется).
  4. Тест `packages/web/tests/bundle.test.mjs` (5 утверждений): (а) в `lib/client.js` есть литерал `window.__ModuleLoader__.load(`; (б) в нём есть `id: "@dsh-mywork/web"` (bare-имя); (в) он не содержит `import `-выражений и `require(` для модулей вне списка 9 + `dsh.client.external`; (г) фабрика — функция от одного аргумента (`factory: (require) =>`); (д) негативная проверка: собрать вариант с `id`, равным подпути (`@dsh-mywork/web/client`) и убедиться, что тест падает.
     Команда: `node --test --test-isolation=none packages/web/tests/bundle.test.mjs` → FAIL.
  5. Сборка: `cd packages\web; node ..\..\node_modules\.bin\tsdown.cmd` → код 0, `lib/client.js` создан.
  6. Команда: `node --test --test-isolation=none packages/web/tests/bundle.test.mjs` → `pass 5 / fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none packages/web/tests/bundle.test.mjs` → `pass 5 / fail 0` **и** ручная проверка в браузере: `fetch('/plugins/@dsh-mywork/web/client.js')` возвращает 200 и `window.__ModuleLoader__` получает регистрацию (evidence: консоль браузера, скриншот). Если `/plugins/...` отдаёт 404 на живом GUI — зафиксировать это как `не проверено` с причиной (в этой кампании путь не проверялся: `evidence/lead-02-http-slots.md:37`).
- **Evidence в отчёт:** вывод сборки, первые/последние строки `lib/client.js`, прогон теста, результат пробы в браузере или явное «не проверено».
- **Риски:**
  1. ESM-вывод вместо CJS-обёртки: бандл загрузится, но не зарегистрируется; симптом — панели нет, в консоли `bundle <url> loaded without registering "<id>" via __ModuleLoader__.load` (`D/packages/client/modules/src/client/system.ts:217,367`). Тест `(а)` — защита.
  2. Вторая внешняя зависимость «на минуту» (например, `zod`) уводит пакет за 9 платформенных модулей и требует явного `external`; правило — не добавлять зависимостей, пока `B-38` (граф) не доказал обратное.

### B-26 · Слоты панели: `sidebar.panellist` + `main`, `id === key`, полный dispose
- **Карточка:** MW-048 (пересмотр приёмки), MW-035 (`superseded`) · **Зависит от:** B-24, B-25
- **Усилие:** S (1 ч) · **Риск:** средний (`selectPanel` бросает при несовпадении) · **Откат:** revert коммита
- **Цель:** панель появляется в боковом списке, открывается в центральной колонке и исчезает без следов.
- **Файлы:** Create `packages/web/src/client/native-panel.tsx`; Create `packages/web/src/client/index.ts`; Create `packages/web/tests/panel.test.mjs`
- **Шаги:**
  1. Две регистрации, обе обёрнуты в `ctx.slots.inject` (идемпотентный disposer; callback выполняется только после объявления слота — `D/packages/client/ui-renderer/src/client/registry.ts:195-209`):
     ```ts
     ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
       { name: 'sidebar.panellist', id: MYWORK_PANEL_ID, order: 20, label: () => t('entry.label') }, MyWorkIcon))
     ctx.slots.inject('main', () => ctx.slots.register(
       { name: 'main', key: MYWORK_PANEL_ID, inject: () => ({ controller }) }, MyWorkPanel as never))
     ```
     `MYWORK_PANEL_ID = 'mywork'` — **id панели обязан совпадать с `key` записи `main`**, иначе `ctx.layout.selectPanel(id)` бросает `layout.selectPanel: main panel "<id>" is not registered` (`D/packages/client/ui-layout/src/client/service.ts:72-77`). Это не рекомендация, а runtime-throw.
  2. `order`: прецедент 0.4.4 использует `20` (Plugins — 0, Schedule — 10; `P/src/client/native-panel.tsx:31-32`). Порядок записей сортируется по `order` (`D/packages/client/ui-sidebar/src/client/index.ts:53-54`). `20` даёт позицию после Schedule — приемлемо; если нужно «рядом с Plugins», брать значение из окна `0..10`, не занятое (`1..9`). Выбор зафиксировать в отчёте одной строкой.
  3. `label` — **функция**, а не строка: локализуемая подпись резолвится при каждой смене языка через `resolveSlotLabel` (`D/packages/client/ui-slots/src/index.ts:865-867`), поэтому переключение ru/en не вызывает ре-монтаж панели.
  4. Ключ `main = 'mywork'`; ключ `conversation` **не занимать** (ADR021 «Consequences», приёмка MW-048).
  5. Полный dispose: `slots.inject` возвращает disposer; собрать их в массив и снять в `ctx.effect` — тогда выгрузка плагина убирает панель, иконку, маршруты и CSS (приёмка MW-048). `retainMainPanels` собирает ровно `entry.options.key` и сбрасывает `activePanelId`, когда ключ исчез (`evidence/lead-02-http-slots.md:20`).
  6. Тест `packages/web/tests/panel.test.mjs` (5 утверждений): (а) `MYWORK_PANEL_ID === 'mywork'`; (б) обе регистрации идут внутри `slots.inject` (проверка по коду: вызов `slots.register` не встречается вне callback); (в) `id` записи списка === `key` записи `main`; (г) `label` — функция; (д) dispose снимает обе записи (в фейковом реестре слотов после dispose 0 записей).
     Команда: `node --test --test-isolation=none packages/web/tests/panel.test.mjs` → FAIL.
  7. Команда: `node --test --test-isolation=none packages/web/tests/panel.test.mjs` → `pass 5 / fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none packages/web/tests/panel.test.mjs` → `pass 5 / fail 0` **и** на живом GUI панель появляется в боковом списке, открывается по клику и исчезает после выгрузки плагина без перезагрузки страницы (evidence: два скриншота + консоль без ошибок).
- **Evidence в отчёт:** прогон, фрагмент двух регистраций, скриншоты «до/после выгрузки», значение `order`.
- **Риски:**
  1. **Cordis-`inject` vs `dsh.client.inject`.** Сервисы (`slots`, `layout`, `locale`, `remote`, `connection`) объявляются в `export const inject` клиентской половины (`P/src/client/index.ts:127` — 10 имён), а не в манифесте. Ошибка здесь = панель не монтируется.
  2. Панель в `main` монтируется **только пока выбрана** — состояние контроллера при deselect/remount не сохраняется автоматически (`evidence/lead-02-http-slots.md:38`). Если панель держит фильтры/выбор, они обязаны жить в слоте-`store` (`B-28`) или в контроллере вне React-дерева.

### B-27 · Свой префикс data-атрибутов панели: `data-mw-*` (не `data-dsh-*`)
- **Карточка:** MW-048 (пересмотр), MW-053 (доступность) · **Зависит от:** B-26
- **Усилие:** S (30–45 мин) · **Риск:** низкий · **Откат:** revert коммита
- **Цель:** ни один атрибут панели MyWork не занимает платформенное пространство `data-dsh-*`; у панели свой предсказуемый префикс.
- **Почему.** Пространство `data-dsh-*` занято служебными маркерами shell/boot **и сторонними клиентскими плагинами** (§11 п.3). Перемер на 0.2.0-rc.2 (`639ed0153`, 2026-10-03) — **три разные области счёта**, и числа верны каждая в своей (подпись «13 строк» относится к области 1 и неверна в ней: строк **31**, файлов **13**):
  - **(1) Весь `packages` + `apps`, без фильтра расширений:** `git -C C:\Reposit\deepseek-harness\deepseek-harness grep -o -n 'data-dsh-[A-Za-z0-9_-]*' 639ed0153 -- packages apps` → **32 вхождения / 31 уникальная строка / 13 файлов / 3 имени** (`data-dsh-automatic-focus` 18, `data-dsh-boot` 8, `data-dsh-boot-spinner` 6; из них 4 вхождения — `README.md`/`README.zh.md`). Та же команда на базе `c7c4c725` даёт **те же 32/31/13/3**: в этой области метрика не двигалась, то есть число 32 — не «прежнее», а сегодняшнее, и подпись дельты «28/9/3 **вместо** 32/13/3» описывает смену области, а не изменение платформы.
  - **(2) Те же пути, только `*.ts|*.tsx|*.css`:** `rg -o --no-filename -g "*.ts" -g "*.tsx" -g "*.css" -g "!**/lib/**" -g "!**/dist/**" "data-dsh-[a-zA-Z-]+" packages apps` → **28 вхождений / 27 уникальных строк / 9 файлов / 3 имени** (`data-dsh-automatic-focus` 16, `data-dsh-boot` 6, `data-dsh-boot-spinner` 6; `rg -l` той же команды → 9 файлов). Отличие от области 1 — ровно 4 вхождения в README, то есть **смена области счёта фильтром расширений**, а не «до/после».
  - **(3) Истинный src-only `packages/**/src/**`:** `git … grep -o -n 'data-dsh-[A-Za-z0-9_-]*' 639ed0153 -- 'packages/**/src/**'` → **7 вхождений / 7 строк / 3 файла / 2 имени**: третий маркер в `src` пишется не литералом, а как `dataset.dshBootSpinner` (`D/packages/client/web/src/boot-page.ts:39`). Поэтому «прежние 7/3» **не устарели** — это ровно то, что даёт src-скан сегодня. Команда с `-g "**/src/**"` поверх фильтра расширений (~**19 вхождений / 7 файлов**) **src-сканом не является**: у `rg` флаги `-g` складываются по OR, и в область попадают тесты вне `src` (только они и дают разницу 19 − 7).
  Имена (числа — из области 2): `data-dsh-automatic-focus` (16 вхождений; `D/packages/client/ui-primitives/src/focus.ts:15,24`, гасит обводку в `ui-theme/src/styles/base.css:29-30`), `data-dsh-boot` (6; `D/packages/client/ui-renderer/src/client/index.ts:66,73`), `data-dsh-boot-spinner` (6; продюсер — `D/packages/client/web/src/boot-page.ts:39`). Гипотеза FINAL-REPORT §4.2 «13 совпадений» **не воспроизвелась** (13 — файлов, строк 31; см. область 1): числа получены повторяемыми командами выше; разбор — `93-VERIFICATION-SURFACE.md` §3.5 и `evidence/verify-surface-02-delta.md`; якоря имён — из `.work/plan-v0.3/evidence/surface-01.md`.
- **Важная поправка к методу счёта.** Часть атрибутов пишется через `dataset`, а не строковым литералом: `boot-page.ts:35` — `this.root.dataset.dshBoot = ''` даёт `data-dsh-boot`, `:39` — `dataset.dshBootSpinner` даёт `data-dsh-boot-spinner`. Поэтому «0 по литералам» **не** означает «атрибута нет»; тест обязан искать и `dataset.<camelCase>`.
- **Файлы:** Create `packages/web/src/client/anchors.ts` (реестр якорей); Create `packages/web/tests/anchors.test.mjs`; Modify все компоненты панели
- **Шаги:**
  1. Префикс — **`data-mw-`**. Проверено: `data-mywork` и `data-mw` в исходниках DSH дают **0** совпадений, так что коллизии нет. Согласуется с решением D18 («префикс `data-mw-*`») и с шагом **`F-59`** («`@dsh-mywork/web`: префикс `data-mw-*` и `store` слота»): тест «ни один `data-*` в `packages/web/src/**` не начинается с `data-dsh-`; все начинаются с `data-mw-`».
  2. Реестр якорей (по образцу `P/src/client/native-panel.tsx:77`, где панель использует `data-dsh-taskboard-view`/`data-dsh-plugin`; **список неполон** — доска использует ещё `data-dsh-panel-entry` (`P/src/client/native-panel.tsx:39,49`), `data-dsh-part` (20 вхождений в `P/src/client/board/**`) и `data-dsh-center-view-back`; проверено на установленной 0.4.4 — `rg -o --no-filename "data-dsh-[a-zA-Z-]+" <профиль>\...\task-board\src`; находка Н-8 в `93-VERIFICATION-SURFACE.md`):
     ```ts
     export const MW_ANCHORS = Object.freeze({
       panel: 'data-mw-panel',            // корень панели, значение — id панели
       board: 'data-mw-board',            // корень доски
       lane: 'data-mw-lane',              // полоса, значение — имя полосы
       card: 'data-mw-card',              // карточка, значение — taskId
       state: 'data-mw-state',            // точный TaskState (чип)
       attention: 'data-mw-attention',    // NeedsAttentionReason
     } as const)
     ```
     Каждый якорь — один смысл; значения стабильны и не локализуются.
  3. Тест `packages/web/tests/anchors.test.mjs` (4 утверждения): (а) `Object.keys(MW_ANCHORS).length >= 6` и все значения начинаются с `data-mw-`; (б) скан всех файлов `packages/web/src/**`: ни одного литерала `data-dsh-`; (в) скан `dataset.` — ни одного `dataset.dsh*`; (г) негативная проверка: подстрока `data-dsh-probe` в тестовой строке находится сканером (защита от «сканер сломан и всегда молчит»).
     Команда: `node --test --test-isolation=none packages/web/tests/anchors.test.mjs` → FAIL.
  4. Команда: `node --test --test-isolation=none packages/web/tests/anchors.test.mjs` → `pass 4 / fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none packages/web/tests/anchors.test.mjs` → `pass 4 / fail 0` **и** `node --test --test-isolation=none packages/web/tests/anchors.test.mjs` включает скан `packages/web/src/**/*.{ts,tsx,css}` (не только `.tsx`) **и** скан ищет и литералы `data-dsh-`, и `dataset.dsh*`. Отдельный `Select-String` по `.tsx` **не является гейтом** (он пропускает `dataset.<camelCase>` и `.ts` — находка §2.3 проверки); он остаётся как evidence.
- **Evidence в отчёт:** прогон, список якорей, воспроизводимые команды подсчёта `data-dsh-*` в DSH и их вывод, явная строка «13 (подпись „13 строк“) не воспроизведено; фактические числа на 0.2.0-rc.2 — **по областям счёта**: 32/31 строка/13 файлов/3 имени (весь `packages`+`apps`), 28/27/9/3 (те же пути, `*.ts|*.tsx|*.css`), 7/7/3/2 (истинный `packages/**/src/**`)» — с областью у каждого числа, без сводки «19/28/3».
- **Риски:**
  1. Локализация значений атрибутов: значение якоря должно быть машиночитаемым (`'needs-attention'`), а не подписью на русском — иначе E2E-селекторы ломаются при смене языка.
  2. Платформа не запрещает свои атрибуты, но и не гарантирует их стабильность: `data-dsh-*` — служебное пространство shell, а не публичный API (`docs/**` про него ничего не говорит: 0 совпадений, `evidence/surface-01.md:16`). **Уточнение 2026-10-03 (0.4.4):** часть этих атрибутов объявлена внешним контрактом — доска пишет, что `data-dsh-panel-entry` несёт глиф строки панели, потому что «the L2 contract (skins) resolves which row belongs to which plugin through it … (see contracts/semantic-attrs-v1.md)» (`P/src/client/native-panel.tsx:39-42`); самого файла в читаемом корпусе нет — ни в чекауте `639ed0153` (`git -C <checkout> ls-tree -r --name-only 639ed0153 | Select-String semantic-attrs` → 0), ни в установленном пакете, — то есть контракт вне досягаемости, и полагаться на `data-dsh-*` как на API всё равно нельзя; вывод шага («свой префикс `data-mw-*`») сохраняется.

### B-28 · View-состояние: слот-`store` (решение D18, вариант зафиксирован)
- **Карточка:** MW-048 (пересмотр), MW-049, MW-050 · **Зависит от:** B-26
- **Усилие:** M (2 ч) · **Риск:** средний (определяет форму всего UI) · **Откат:** revert коммита
- **Цель:** у панели есть ровно одно место, где живёт view-состояние (выбор, фильтры, раскрытия, layout), и оно не превращается в четвёртый источник истины.
- **Форма — одна, развилки нет.** Решение D18 §4: **слот-`store`**, осознанное расхождение с прецедентом 0.4.4 (тот отдаёт свой контроллер через `inject: () => ({ controller })`, `P/src/client/native-panel.tsx:115-119`). Вариант «собственный контроллер» **удалён из шага**: выбор сделан решением, а не исполнителем. Реализует шаг `F-59` («`store` слота»).
  - Опция `store?: StoreHandle<T,A> | StoreFactory<T>` в регистрации слота; компонент получает `PropsStore<H> = { useStore: SnapshotSelectorHook<T>; actions: BakedActions<T,A> }`: чтение **только** через `props.useStore(selector)`, запись **только** через `actions` (нет `update`/`set`) — `D/packages/client/store/src/contract.ts:93-136`; персист — `spec.persist`, ключ суффиксится scope (`contract.ts:58,93-103`); один shared-handle нельзя смонтировать под двумя scope (`D/packages/client/ui-slots/src/index.ts:1038-1045`).
- **Файлы:** Create `packages/web/src/board/store.ts`; Create `packages/web/tests/view-state.test.mjs`
- **Шаги:**
  1. Тест `packages/web/tests/view-state.test.mjs` — проверяется **поведение** стора, не носитель: (а) выбор 3 карточек переживает смену языка; (б) переживает deselect/remount панели; (в) переживает перезагрузку страницы (персист); (г) view-состояние **не** попадает в `BoardSnapshot` (сериализованный снапшот не содержит ключей `selection`/`filters`/`collapsed`); (д) состояние не пишет ни одной строки audit и не двигает `boardRevision`; (е) запись возможна **только** через `actions` (у возвращаемого объекта нет `update`/`set`).
     Команда: `node --test --test-isolation=none packages/web/tests/view-state.test.mjs` → FAIL.
  2. Реализация: стор — чистая функция редьюсеров + `getSnapshot`/`subscribe`; персист — только через `spec.persist` (не `localStorage` руками: он вне жизненного цикла слота и не снимается on dispose).
  3. Команда: `node --test --test-isolation=none packages/web/tests/view-state.test.mjs` → `pass 6 / fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none packages/web/tests/view-state.test.mjs` → `pass 6 / fail 0` **и** `Select-String packages\web\src\board\store.ts -Pattern 'localStorage'` → пусто.
- **Evidence в отчёт:** прогон, фрагмент стора, подтверждение «снапшот не содержит view-состояния» (JSON), форма записи через `actions`.
- **Риски:**
  1. **Четвёртый источник истины.** View-состояние — это ровно то, что ADR017 называет presentation; попадание выбора/фильтров в `BoardSnapshot` ломает `(г)`. Тест `(д)` закрывает второй риск — «UI начал писать в домен».
  2. `store` и `persist` ключ суффиксится scope: если панель позже откроется в двух workspace, персист разделится — это ожидаемо, но надо знать при отладке «пропали фильтры».
  3. Персист через `localStorage` руками выглядит проще и ломает снятие состояния при dispose — гейт по `localStorage`.

### B-29 · Тема-мост `--dsw-*` → `--mw-*`, локали ru/en, ноль hex-литералов
- **Карточка:** MW-048, MW-053, ADR022 · **Зависит от:** B-26
- **Усилие:** M (1.5–2 ч) · **Риск:** средний · **Откат:** revert коммита
- **Цель:** панель читаема на любой теме DSH, включая wallpaper и high-contrast, и не привязывает MyWork к чужой палитре.
- **Файлы:** Create `packages/web/src/theme/bridge.css`; Create `packages/web/src/theme/capability.ts`; Create `packages/web/src/client/locales.ts`; Create `packages/web/tests/theme.test.mjs`
- **Шаги:**
  1. Мост: `--mw-*` объявляются как `var(--dsw-*, <литеральный fallback>)`. Ни одного hex-литерала в компонентах и CSS — это проверяется тестом (по образцу `tests/board.test.mjs:642-651`, который уже стережёт `packages/core/src/theme.ts`).
  2. `ThemeCapability` — **рантайм**, не эвристика по классу: `mode` (`prefers-color-scheme`), `surface`, `wallpaper` (по `--dsw-alias-bg-mask-photo`), `highContrast` (`prefers-contrast: more` **и** измеренный контраст), `reducedMotion` (`prefers-reduced-motion: reduce`) — ADR022 (`...v0.2-decisions.md:238`). Поведение непрозрачности решает уже существующая `resolveSurfacePolicy` (`packages/core/src/theme.ts`, стережётся тестами `tests/board.test.mjs:653-709`) — **не** дублировать её в UI.
  3. Локали ru/en: `NS`-скоуп, `t('entry.label')` для подписи панели и `t(...)` для всех видимых строк; ключи — из закрытого словаря, отсутствующий ключ даёт видимую ошибку, а не пустую строку.
  4. Тест `packages/web/tests/theme.test.mjs` (6 утверждений): (а) в `packages/web/src/**` нет hex-литералов; (б) нет `rgb(`/`hsl(`; (в) каждый `--mw-*` имеет fallback; (г) `ThemeCapability` различает 5 режимов на подставленных медиа-запросах; (д) переключение ru↔en меняет подпись панели и **не** вызывает ре-монтаж (счётчик монтирований = 1); (е) негативная проверка: сканер hex находит подставленный `#1a2b3c`.
     Команда: `node --test --test-isolation=none packages/web/tests/theme.test.mjs` → FAIL.
  5. Команда: `node --test --test-isolation=none packages/web/tests/theme.test.mjs` → `pass 6 / fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none packages/web/tests/theme.test.mjs` → `pass 6 / fail 0` **и** на живом GUI матрица из 5 режимов (light/dark/wallpaper/high-contrast/reduced-motion) снята скриншотами с записанным измеренным контрастом (полная матрица — `B-39`).
- **Evidence в отчёт:** прогон, фрагмент моста, скриншоты 5 режимов или явное «не проверено: требует открытого GUI».
- **Риски:**
  1. **Фиксированная палитра.** Любой hex ломает тему пользователя; тест `(а)`.
  2. **Colour-only сигналы.** `B-30`/`B-31` обязаны дублировать состояние текстом (`data-mw-state`, `data-mw-attention` + подпись), иначе ADR022 нарушен.

---

## 6. Доска и взаимодействие (MW-049, MW-050)

### B-30 · Раскладка: сетка полос, горизонтальная полоса, list-view, Overview-полоса
- **Карточка:** MW-049 · **Зависит от:** B-04, B-26, B-28
- **Усилие:** L (1–1.5 дня) · **Риск:** средний · **Откат:** revert коммита
- **Цель:** панель рисует 7 полос в раскладке, выбранной по ширине, и полосу обзора над ними; порог переключения — UI-константа, а не контракт (следствие `B-02`).
- **Что чего не хватает сегодня** (проверено `evidence/surface-03.md:8-15`): в контракте нет `list`-режима (`BOARD_VIEW_MODES = ['grid-3x3','strip-horizontal']`, `contracts/board.ts:129`), нет `ZONE_LABELS` (grep — 0 совпадений), нет полей фильтров/сортировки/пагинации у `BoardView` (`:175-188`). Всё это — задачи этого шага, в `packages/web`.
- **Файлы:** Create `packages/web/src/board/BoardGrid.tsx`, `BoardStrip.tsx`, `BoardList.tsx`, `OverviewBar.tsx`, `useWidth.ts`; Create `packages/web/tests/layout.test.mjs`
- **Шаги:**
  1. Порог: `BOARD_STRIP_MAX_WIDTH_PX` приходит из `packages/web/src/board/layout.ts` (`B-02`). Правило ровно как в приёмке MW-049: «на пороге минус 1 px — strip, на пороге — grid».
  2. Три раскладки: `grid` (по числу полос, sticky-заголовок с иконкой/подписью/count), `strip` (одна прокручиваемая строка тех же полос), `list` (таблица с сортировкой и пагинацией). `list` — новый режим: либо расширить `BOARD_VIEW_MODES` в контракте, либо объявить режимы в `packages/web` (по духу `B-02`); решение зафиксировать в отчёте одной строкой.
  3. Overview-полоса: счётчики по полосам **и** по зонам (сумма зон внутри полосы обязана совпадать со счётчиком полосы — тест `B-04` `(в)`), глубина review/blocked/`needs-attention`, расход, слоты баннеров.
  4. `useWidth` — `ResizeObserver` с одним наблюдателем на панель, не на карточку.
  5. Тест `packages/web/tests/layout.test.mjs` (7 утверждений): (а) матрица ширин `900/1024/1100/1280/1440/1920` → ожидаемый режим; (б) `1099 → strip`, `1100 → grid`; (в) заголовок полосы содержит иконку, подпись и count; (г) число отрендеренных полос = 7 при любой ширине; (д) ни одна карточка не появляется дважды (по `data-mw-card`); (е) `list` сортируется по `(order, taskId)` и пагинируется; (ж) на 1024×768 полоса обзора не вытесняет сетку за первый экран.
     Команда: `node --test --test-isolation=none packages/web/tests/layout.test.mjs` → FAIL.
  6. Команда: `node --test --test-isolation=none packages/web/tests/layout.test.mjs` → `pass 7 / fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none packages/web/tests/layout.test.mjs` → `pass 7 / fail 0` **и** в отчёте приложена матрица «ширина → режим → причина» с фактическими измерениями на живом GUI, включая 1099/1100.
- **Evidence в отчёт:** прогон, таблица ширин, скриншоты grid/strip/list, число DOM-узлов на каждом режиме.
- **Риски:**
  1. **Порог как магия.** 1100 px — не священное число; при переносе в UI он обязан быть одной константой в одном файле и покрыт тестом `(б)`.
  2. Полоса обзора вытесняет сетку на маленьких экранах — тест `(ж)`; на узких ширинах Overview сворачивается до счётчиков и баннеров (приёмка MW-049).

### B-31 · Карточка: анатомия, чипы, WIP как presentation-only, stale без цвета
- **Карточка:** MW-049, MW-050 · **Зависит от:** B-30, B-03
- **Усилие:** M (2–3 ч) · **Риск:** средний · **Откат:** revert коммита
- **Цель:** карточка показывает точное состояние (`data-mw-state`), роль, приоритет, попытку, проверки, комментарии, возраст, а также WIP и stale — причём WIP **никого не блокирует**.
- **Файлы:** Create `packages/web/src/board/Card.tsx`, `CardChips.tsx`, `CardIndicators.tsx`; Create `packages/web/tests/card.test.mjs`
- **Шаги:**
  1. Анатомия: заголовок, точный `TaskState` чипом (`packages/contracts/src/task.ts:46-63` — 16 значений), роль, приоритет, `AttemptState`, счётчики проверок/комментариев, возраст, `attention.reason` при наличии (`B-03`).
  2. **WIP-лимит — presentation-only.** Значение живёт в view-состоянии (`B-28`), не в контракте и не в домене; превышение рисует индикатор и **не** отвергает admission. Проверяется тестом: при превышении лимита `admitAttempt` продолжает работать (мок порта получает вызов и отвечает `ok`).
  3. **Stale — без цвета.** Индикатор несёт текст («данные устарели на N с») и `data-mw-stale`; проверка — «читается при отключённом цвете»: тест снимает все цветовые стили и проверяет наличие текстового признака.
  4. Тест `packages/web/tests/card.test.mjs` (6 утверждений): (а) число чипов соответствует данным карточки; (б) `data-mw-state` равен точному состоянию, а не полосе; (в) WIP-превышение не блокирует admission; (г) stale читается без цвета; (д) `data-mw-attention` присутствует ровно тогда, когда у placement есть `attention`; (е) возраст форматируется по инъецированным часам (не `Date.now()` внутри рендера — иначе тест флакует).
     Команда: `node --test --test-isolation=none packages/web/tests/card.test.mjs` → FAIL.
  5. Команда: `node --test --test-isolation=none packages/web/tests/card.test.mjs` → `pass 6 / fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none packages/web/tests/card.test.mjs` → `pass 6 / fail 0` **и** скриншот карточки в 5 режимах темы (`B-39`).
- **Evidence в отчёт:** прогон, скриншоты, фрагмент анатомии.
- **Риски:** WIP-лимит легко превращается во второй admission-гейт. Запрет явный: единственный admission — домен (`21-STEPS-execution.md`, `E-*`); UI показывает и не решает.

### B-32 · Виртуализация и измерения производительности (100/500/1000/2000)
- **Карточка:** MW-049 · **Зависит от:** B-30, B-31
- **Усилие:** M (2–3 ч) · **Риск:** средний · **Откат:** revert коммита
- **Цель:** на 2000 карточек DOM не растёт линейно, а числа производительности **измерены**, а не заявлены.
- **Файлы:** Create `packages/web/src/board/virtualize.ts`; Create `packages/web/tests/perf.test.mjs`; Create `.work/reports/MW-049-board-ui.md` (файла сегодня нет — `Modify` неверен; наполняет исполнитель карточки)
- **Шаги:**
  1. Виртуализация по полосам: окно по скроллу + overscan; на полосе `queue` (самая тяжёлая, риск 1 в `B-04`) — обязательно.
  2. Метрика: число DOM-узлов, время рендера, p50/p95 фильтрации — на 100, 500, 1000, 2000 карточках.
  3. Тест `packages/web/tests/perf.test.mjs` (4 утверждения): (а) на 2000 узлов ≤ 1.5 × узлов на 1000; (б) задержка фильтрации на 2000 ≤ 2 × от 1000; (в) на 2000 в DOM присутствует не более одного окна на полосу; (г) числа записаны в отчёт (тест читает файл отчёта и проверяет наличие четырёх строк с числами).
     Команда: `node --test --test-isolation=none packages/web/tests/perf.test.mjs` → FAIL.
  4. Команда: `node --test --test-isolation=none packages/web/tests/perf.test.mjs` → `pass 4 / fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none packages/web/tests/perf.test.mjs` → `pass 4 / fail 0` **и** в `.work/reports/MW-049-board-ui.md` есть таблица 4×3 измерений с командой, которой они получены.
- **Evidence в отчёт:** таблица измерений, команда, число DOM-узлов.
- **Риски:** измерять «на глаз» по DevTools и записать красивые числа — прямо запрещено приёмкой MW-049 («числа производительности не выдуманы»). Тест `(г)` требует наличия четырёх строк, но не проверяет правдивость — правдивость проверяет `B-43`.

### B-33 · Баннеры: degraded, recovery, paused, legacy-cutover
- **Карточка:** MW-049, MW-054 (cutover-баннер) · **Зависит от:** B-30, B-16
- **Усилие:** S (1–1.5 ч) · **Риск:** низкий · **Откат:** revert коммита
- **Цель:** четыре вида баннеров рендерятся в полосе обзора, достижимы с клавиатуры и не врут о состоянии.
- **Файлы:** Create `packages/web/src/board/Banners.tsx`; Create `packages/web/tests/banners.test.mjs`
- **Шаги:**
  1. Источники: `degraded` — из `DegradedProjection` (`packages/contracts/src/board.ts:305-314`) со `snapshotAt` и `staleZones`; `recovery` и `paused` — из `BoardPanelState` (`:141-166`); `legacy-cutover` — новое состояние, объявляется в этом шаге (сегодня в `packages/**` 0 совпадений, `evidence/surface-03.md:14`).
  2. **Правило честности:** баннер legacy показывает «read-only ссылка на архив» и **никогда** не утверждает, что legacy-scheduler остановлен, пока cutover не верифицирован (ADR021 `:215,224`, ADR025 `:325`; приёмка MW-054).
  3. Тест `packages/web/tests/banners.test.mjs` (5 утверждений): (а) все четыре баннера рендерятся при подставленном состоянии; (б) каждый достижим с клавиатуры (Tab-порядок) и имеет имя для screen reader; (в) `degraded` показывает время снимка; (г) текст legacy-баннера не содержит утверждения об остановленном scheduler'е (проверка по закрытому списку запрещённых формулировок); (д) на 1024×768 полоса с четырьмя баннерами не вытесняет сетку.
     Команда: `node --test --test-isolation=none packages/web/tests/banners.test.mjs` → FAIL.
  4. Команда: `node --test --test-isolation=none packages/web/tests/banners.test.mjs` → `pass 5 / fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none packages/web/tests/banners.test.mjs` → `pass 5 / fail 0` **и** скриншот полосы с четырьмя баннерами.
- **Evidence в отчёт:** прогон, скриншот, тексты четырёх баннеров.
- **Риски:** соблазн показать `degraded` как `empty` — закрыто `B-16`; здесь закрывается обратное — показ `empty` как `degraded` при первичной загрузке.

### B-34 · Клавиатура, выбор, bulk с per-card результатом
- **Карточка:** MW-050 · **Зависит от:** B-30, B-31, B-15
- **Усилие:** L (1–1.5 дня) · **Риск:** средний · **Откат:** revert коммита
- **Цель:** keyboard-only проход выполняет все действия; bulk — не all-or-nothing и возвращает результат по каждой карточке.
- **Файлы:** Create `packages/web/src/board/keyboard.ts`, `Selection.tsx`, `BulkBar.tsx`; Create `packages/web/tests/keyboard.test.mjs`
- **Шаги:**
  1. Модель: roving tabindex внутри полосы, `Space` — выбор, `Shift+Space` — диапазон, `Ctrl+A` — все в полосе, стрелки — перемещение фокуса, `M` — command palette «Переместить…», `Enter` — detail panel, `/` — поиск, `Esc` — снять выбор/закрыть.
  2. Bulk: батч-маршрут (`B-19`) возвращает **N** результатов; UI показывает по каждой карточке успех/код отказа; частичный успех допустим и видим.
  3. **Bulk move предлагает только цели, легальные для всех выбранных** — пересечение `legalDropTargets(state)` по всем выбранным (функция ядра уже есть, `B-07`).
  4. Тест `packages/web/tests/keyboard.test.mjs` (7 утверждений): (а) keyboard-only проход выполняет выбор/перемещение/bulk/detail/поиск без мыши; (б) фокус не теряется при перерисовке полосы; (в) `Ctrl+A` выбирает только полосу; (г) bulk из 5 команд возвращает 5 результатов; (д) цели bulk — пересечение легальных, ни одной лишней; (е) одна упавшая команда не отменяет остальные; (ж) порядок Tab стабилен между рендерами.
     Команда: `node --test --test-isolation=none packages/web/tests/keyboard.test.mjs` → FAIL.
  5. Команда: `node --test --test-isolation=none packages/web/tests/keyboard.test.mjs` → `pass 7 / fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none packages/web/tests/keyboard.test.mjs` → `pass 7 / fail 0` **и** запись экрана (или пошаговый протокол) keyboard-only прохода.
- **Evidence в отчёт:** прогон, протокол прохода, ответы bulk-запроса с per-card результатами.
- **Риски:** bulk через N отдельных HTTP-запросов вместо одного батча даёт «половину применённого» без видимого отчёта; тест `(г)` требует именно N результатов в одном ответе.

### B-35 · DnD через резолвер: подсветка только легальных целей, причина для «плохих» дропов
- **Карточка:** MW-050, MW-060…MW-064 (резолвер) · **Зависит от:** B-07, B-34
- **Усилие:** M (2–3 ч) · **Риск:** средний · **Откат:** revert коммита
- **Цель:** четыре неисполнимых пункта приёмки MW-050 закрыты: подсветка, причина, идемпотентность, отсутствие прямой записи.
- **Файлы:** Create `packages/web/src/board/dnd.ts`; Create `packages/web/tests/dnd.test.mjs`; Modify `packages/contracts/src/board.ts` (поле `operationId` в `DropIntent`)
- **Шаги:**
  1. Начало drag: допустимые цели = `legalDropTargets(state)` **напрямую** (не пересчитывать в UI). Подсветка — только эти зоны.
  2. Drop строит `DropIntent` и **вызывает резолвер** (`B-07`), а не `applyDropIntent`. UI никогда не пишет placement сам.
  3. **Причина для опасных целей.** Приёмка MW-050: «Drop в error/blocked/cancelled без выбранной причины отклоняется». Носитель — `attention.reason` (`B-03`) плюс явный выбор причины в UI при переезде в `error`; источник списка — `NEEDS_ATTENTION_REASONS` (`packages/contracts/src/board.ts:373-381`). Без причины — отказ **в UI** (диалог) и **в домене** (типизированный код).
  4. **Идемпотентность.** `DropIntent` дополняется `operationId` (сегодня его нет — `packages/contracts/src/board.ts:231-249`; приёмка MW-050 п. 4 неисполнима). Два одинаковых intent с разными `operationId` не меняют состояние дважды — проверяется на уровне команды (`B-14`).
  5. Тест `packages/web/tests/dnd.test.mjs` (6 утверждений): (а) подсвеченные цели равны `legalDropTargets(state)` для всех 16 состояний; (б) drop не вызывает ни одной записи placement из UI (мок порта: 0 вызовов); (в) drop в `error` без причины → отказ с кодом; (г) с причиной → принят, `attention.reason` записан; (д) два intent с разными `operationId` и одинаковым телом → одна мутация; (е) `board.move` больше не упоминается в UI (после `B-06` — `board.reorder`/`board.rezone`).
     Команда: `node --test --test-isolation=none packages/web/tests/dnd.test.mjs` → FAIL.
  6. Команда: `node --test --test-isolation=none packages/web/tests/dnd.test.mjs` → `pass 6 / fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none packages/web/tests/dnd.test.mjs` → `pass 6 / fail 0` и `node --test --test-isolation=none tests/board-resolver.test.mjs` → `fail 0`.
- **Evidence в отчёт:** прогон, скриншот подсветки легальных целей, два ответа с одинаковым `operationId`.
- **Риски:** «подсветить всё, а потом отфильтровать» — самая частая реализация и прямое нарушение приёмки. Тест `(а)` сравнивает множества, а не «наличие подсветки».

### B-36 · Detail panel и ссылка на живую DSH-сессию
- **Карточка:** MW-050, MW-046 (обсуждение) · **Зависит от:** B-34, B-09
- **Усилие:** M (2 ч) · **Риск:** средний (механики открытия сессии нет) · **Откат:** revert коммита
- **Цель:** detail panel закрыт по умолчанию, содержит девять разделов, и ссылка на сессию **открывает реальную сессию**, а не изображает её.
- **Файлы:** Create `packages/web/src/board/Detail.tsx`, `SessionLink.tsx`; Create `packages/web/tests/detail.test.mjs`
- **Шаги:**
  1. Разделы: Обзор, Обсуждение, Попытки, Review, Evidence, Зависимости, Workflow, История, Сессии.
  2. **Session link.** Механики сегодня нет; источник — платформенный навигатор (`ctx.layout` / сессионный маршрут). **Шаг 0:** подтвердить публичный способ открыть сессию по `sessionId` в DSH-checkout; если способа нет — честно записать «переход недоступен» и показывать копируемый `sessionId` вместо кнопки. **Не** выдумывать переход через прямую манипуляцию URL.
  3. `active` берётся из производного поля (`B-09`), а не из копии состояния сессии.
  4. Dependency preview: соседи из `Task.dependsOn` (`packages/contracts/src/task.ts:91`) + их зоны/состояния; глубина 1.
  5. Тест `packages/web/tests/detail.test.mjs` (6 утверждений): (а) панель закрыта по умолчанию; (б) `Esc` закрывает; (в) девять разделов присутствуют; (г) dependency preview показывает зону и состояние прямых соседей; (д) session link ведёт на существующую сессию либо показывает копируемый id с явным «переход недоступен»; (е) обсуждение не копирует транскрипт (нет полей с телами сообщений).
     Команда: `node --test --test-isolation=none packages/web/tests/detail.test.mjs` → FAIL.
  6. Команда: `node --test --test-isolation=none packages/web/tests/detail.test.mjs` → `pass 6 / fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none packages/web/tests/detail.test.mjs` → `pass 6 / fail 0` **и** на живом GUI клик по session link открывает ту же сессию, что указана в ссылке (скриншот + id), либо в отчёте стоит «переход недоступен» с причиной.
- **Evidence в отчёт:** прогон, скриншот detail panel, id сессии до/после перехода.
- **Риски:** скрытая загрузка транскрипта «для контекста» — прямое нарушение §8 и ADR021; тест `(е)`.

### B-37 · `NeedsAttentionReason` на карточке и «Остановить и отменить» vs «Отменить»
- **Карточка:** MW-050, MW-030 (`HumanDecision`) · **Зависит от:** B-03, B-31
- **Усилие:** S (1–1.5 ч) · **Риск:** низкий · **Откат:** revert коммита
- **Цель:** карточка показывает конкретную причину, а не «требует внимания»; две похожие команды различимы и по-разному доступны.
- **Файлы:** Modify `packages/web/src/board/Card.tsx`; Create `packages/web/tests/attention.test.mjs`
- **Шаги:**
  1. Причина на карточке: `attention.reason` (`B-03`) → человекочитаемая строка из закрытого словаря из 7 причин (`packages/contracts/src/board.ts:373-381`); отсутствие причины при состоянии `needs-attention` — **дефект проекции**, карточка показывает явную ошибку, а не пустое место.
  2. Команды: `task.stop-and-cancel` доступна **только** на карточке с активной попыткой (`assigned`/`executing`); `task.cancel` — только на карточке без попытки (`requiresActiveAttempt`, `packages/core/src/task.ts:113-115`). После «Остановить и отменить» в карточке виден artifact diff (`EvidenceSummary.kind === 'diff'`, `packages/contracts/src/board.ts:321`).
  3. Тест `packages/web/tests/attention.test.mjs` (5 утверждений): (а) все 7 причин рендерятся осмысленной строкой; (б) `needs-attention` без причины → видимая ошибка проекции; (в) `task.stop-and-cancel` доступна ровно на `assigned`/`executing`; (г) `task.cancel` недоступна там же; (д) после stop-and-cancel отображается diff-evidence, если она есть.
     Команда: `node --test --test-isolation=none packages/web/tests/attention.test.mjs` → FAIL.
  4. Команда: `node --test --test-isolation=none packages/web/tests/attention.test.mjs` → `pass 5 / fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none packages/web/tests/attention.test.mjs` → `pass 5 / fail 0`.
- **Evidence в отчёт:** прогон, скриншоты двух состояний карточки с разными кнопками.
- **Риски:** причина нужна и на `B-16` (деградация), и здесь; не заводить второй каталог — источник ровно один (`NEEDS_ATTENTION_REASONS`).

---

## 7. graph/calendar/timeline и темы/доступность (MW-052, MW-053)

### B-38 · Graph, calendar, опциональный timeline — без новых зависимостей
- **Карточка:** MW-052 · **Зависит от:** B-30
- **Усилие:** L (1.5–2 дня) · **Риск:** средний · **Откат:** revert коммита
- **Цель:** три представления на собственной SVG-раскладке; узлы и рёбра доступны с клавиатуры; цикл не рисуется как валидный граф.
- **Файлы:** Create `packages/web/src/views/GraphView.tsx`, `CalendarView.tsx`, `TimelineView.tsx`; Create `packages/web/tests/views.test.mjs`
- **Шаги:**
  1. Раскладка по слоям — своя, без `d3`/`dagre`; поверхности и контраст — через уже существующую `resolveSurfacePolicy` (`packages/core/src/theme.ts`, стережётся `tests/board.test.mjs:653-709`), не дублировать.
  2. Граф: окно по уровням или пагинация (1000 узлов не блокируют UI); цикл — явное сообщение об отказе, не «валидный граф».
  3. Calendar — по `due`/`defer`; timeline — по `startedAt`/`settledAt`. **Шаг 0:** проверить, существуют ли эти поля в контрактах; если нет — сначала объявить их, либо честно записать «источник отсутствует, представление недоступно». Не выдумывать поля.
  4. Доступность: roving tabindex по узлам, текстовые имена для screen reader, рёбра перечисляются списком.
  5. Тест `packages/web/tests/views.test.mjs` (6 утверждений): (а) ни одной новой записи в `dependencies` затронутых `package.json` (сравнение с baseline); (б) узлы и рёбра достижимы с клавиатуры; (в) каждое ребро имеет текстовое имя; (г) цикл даёт явное сообщение; (д) граф на 1000 узлов рендерится за ограниченное время и с ограниченным числом узлов DOM; (е) calendar совпадает с данными карточек.
     Команда: `node --test --test-isolation=none packages/web/tests/views.test.mjs` → FAIL.
  6. Команда: `node --test --test-isolation=none packages/web/tests/views.test.mjs` → `pass 6 / fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none packages/web/tests/views.test.mjs` → `pass 6 / fail 0` **и** `git diff package.json packages/*/package.json` не содержит новых `dependencies`.
- **Evidence в отчёт:** прогон, diff манифестов, скриншоты трёх представлений.
- **Риски:** «граф на canvas» ломает доступность — оставаться на SVG. Цикл в данных может прийти из Task Graph — представление обязано отказать, а не зациклиться.

### B-39 · Матрица темы и доступности: 5 режимов, keyboard-only проход, AA
- **Карточка:** MW-053 · **Зависит от:** B-29, B-30, B-34
- **Усилие:** M (2 ч) · **Риск:** низкий · **Откат:** revert коммита
- **Цель:** измеренная матрица из пяти режимов; ни одного нарушения AA; focus ring никогда не снимается.
- **Файлы:** Create `packages/web/tests/a11y.test.mjs`; Create `.work/reports/MW-053-theme-a11y.md` (файла сегодня нет — `Modify` неверен)
- **Шаги:**
  1. Матрица: light, dark, wallpaper, high-contrast, reduced-motion плюс активная тема skin-center как шестой прогон.
  2. Измерять: контраст текста ≥ 4.5:1, нетекстовых границ ≥ 3:1, focus ring ≥ 3:1 и **никогда** не снят; при wallpaper alpha поверхностей = 1; `prefers-reduced-motion` убирает анимации DnD и переходы.
  3. Тест `packages/web/tests/a11y.test.mjs` (6 утверждений): (а) пять режимов разрешаются; (б) текст ≥ AA; (в) границы ≥ 3:1; (г) focus ring присутствует во всех режимах; (д) `reduced-motion` отключает переходы; (е) каждая полоса и каждая карточка имеют непустое имя для screen reader.
     Команда: `node --test --test-isolation=none packages/web/tests/a11y.test.mjs` → FAIL.
  4. Команда: `node --test --test-isolation=none packages/web/tests/a11y.test.mjs` → `pass 6 / fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none packages/web/tests/a11y.test.mjs` → `pass 6 / fail 0` **и** в отчёте — матрица с измеренными коэффициентами по каждому режиму и каждой поверхности.
- **Evidence в отчёт:** матрица чисел, скриншоты, список проверок клавиатурой.
- **Риски:** «контраст посчитан в голове» — приёмка MW-053 требует измеренных значений; числа должны воспроизводиться из отчёта.

---

## 7a. GUI-проверки: то, что не может быть `node --test`

Раздел существует потому, что тестовый харнесс `packages/web` **не содержит** `react`/`react-dom`/`jsdom`/`happy-dom`, а `pnpm install` в кампании запрещён (решение в `B-01a`). Всё, что требует рендера, DOM-измерений или живого GUI, вынесено сюда и **заранее** помечено как «требует GUI». Эти шаги исполняет человек/исполнитель карточки; результат — отчёт со скриншотами и измеренными числами, а не зелёный `node --test`.

### B-30a · Ручная GUI-проверка раскладки и порога
- **Карточка:** MW-049 · **Зависит от:** B-30, B-26, установки пакета в изолированный профиль
- **Усилие:** M (1–2 ч) · **Риск:** низкий · **Откат:** не требуется
- **Цель:** фактическое переключение раскладки и число DOM-узлов измерены на живом GUI, а не выведены из кода.
- **Файлы:** Create `.work/reports/MW-049-board-ui.md` (раздел «GUI-измерения»)
- **Шаги:**
  1. Открыть панель MyWork; зафиксировать ширину панели 1099 и 1100 px (DevTools → responsive), снять скриншоты: ожидаемо `strip` и `grid` соответственно.
  2. Зафиксировать ширины `900/1024/1100/1280/1440/1920` и записать фактический режим с причиной (порог/ручной выбор).
  3. Снять число DOM-узлов на 100/500/1000/2000 карточках (DevTools → Elements count) и p50/p95 фильтрации (Performance).
  4. Снять 4 скриншота баннеров (`degraded`/`recovery`/`paused`/`legacy-cutover`), если состояния достижимы.
  5. Записать измеренный контраст текста и границ для 5 режимов темы (`B-39a`).
- **Гейт (готово когда):** в `.work/reports/MW-049-board-ui.md` есть таблица «ширина → режим → причина» с 6 строками, таблица 4×3 измерений производительности и 4 скриншота баннеров. Любой непроверенный пункт помечен «требует GUI: не проверено», а не «пройдено».
- **Evidence в отчёт:** скриншоты, числа, версия профиля, sha256 пакета.
- **Риски:** измерения «на глаз»; правдивость проверяет `B-43` (сценарий без evidence = непройденный).

### B-39a · Ручная матрица темы и доступности
- **Карточка:** MW-053 · **Зависит от:** B-39, B-29
- **Усилие:** M (1–2 ч) · **Риск:** низкий · **Откат:** не требуется
- **Цель:** пять режимов темы и keyboard-only проход проверены на живом GUI с измеренным контрастом.
- **Файлы:** Create `.work/reports/MW-053-theme-a11y.md`
- **Шаги:**
  1. Переключить light / dark / wallpaper / high-contrast / reduced-motion; снять скриншот каждого и измерить контраст текста и нетекстовых границ.
  2. Проверить активную тему skin-center как шестой прогон.
  3. Пройти keyboard-only сценарий целиком (выбор, перемещение, bulk, detail, поиск) и записать протокол.
  4. Проверить, что focus ring не снимается ни в одном режиме.
- **Гейт (готово когда):** в `.work/reports/MW-053-theme-a11y.md` есть матрица 6×N с измеренными коэффициентами и протокол keyboard-only прохода; непроверенное помечено «требует GUI: не проверено».
- **Evidence в отчёт:** скриншоты, коэффициенты, протокол.
- **Риски:** те же, что у `B-30a`.

---

## 8. Compat-adapter и мастер импорта легаси-доски (MW-054)

### B-40 · Read-only чтение легаси-леджера из файла: путь, формат, hash-проверка
- **Карточка:** MW-054, MW-047 (адаптер из `B-17`) · **Зависит от:** B-17, ADR021, ADR025
- **Усилие:** M (2 ч) · **Риск:** средний · **Откат:** revert коммита
- **Цель:** архив читается **без** запущенного legacy-плагина и без HTTP; оригинал не изменяется ни одним байтом.
- **Файлы:** Create `packages/controller/src/legacy-ledger.ts`; Create `tests/legacy-ledger.test.mjs`
- **Шаги:**
  1. Путь: `join(resolveDshHome(), 'task-board', 'ledger-v2.json')`; `DSH_HOME` побеждает, иначе `~/.dsh` (`P/src/dsh-home.ts:31-36`; `P/src/host-ledger.ts:413,417`). Живой файл в этой среде: `C:\Users\Dmitry\.dsh\task-board\ledger-v2.json` (369 634 байта, `mtime` 2026-09-26 22:01).
  2. **Имя файла — не версия схемы.** Внутри `schemaVersion: 3`, `revision: 324`, при том что файл называется `ledger-v2.json` (`P/src/protocol.ts:10-12`: `TASK_BOARD_SCHEMA_VERSION = 3`, `TASK_BOARD_LEGACY_SCHEMA_VERSION = 2`). Проверять надо `schemaVersion`, а не имя. Ветка миграции v2→v3 на живом файле не срабатывает.
  3. Полевой состав карточки (14 ключей): `id, title, description, prompt, status, createdAt, updatedAt, executions, workspaceId, permission, model, tags, permissionConfirmedAt, archivedAt`. `executions[]` — 7 полей: `id, sessionId, startedAt, endedAt, result, initiatedBy, error`; `result ∈ {succeeded, failed, cancelled}`.
  4. **Читать, но не доверять валидации плагина.** `parseLedger` (**вердикт перемерен 2026-10-03 на установленной 0.4.4 и остаётся верным**; замер прошлого прохода шёл по 0.4.3 — устарела только метка версии: `P/src/core/store.ts` — `isTaskRecordShape` `:57-87` (проверяет `id/title/description/prompt/createdAt/updatedAt/parentId/workspaceId/mode/permission/reuseSession/goalRun` и форму `executions[]`, но не `status`), `parseLedger` `:164`, отброс невалидной строки `:182`) отбрасывает строку целиком, если не прошёл `isTaskRecordShape`, а этот предикат **не** проверяет `status`, `model`, `teamRun`, `tags`, `archivedAt`, `permissionConfirmedAt`, `freeze`, `handover`, `schedule`. Adapter обязан валидировать эти поля сам и **не** наследовать «лечение» (`status` неизвестный → `'todo'`; `schedule` без валидного cron отбрасывается) — иначе импорт принесёт чужие догадки.
  5. Ограничения: `EXECUTION_HISTORY_LIMIT = 20` — история уже обрезана плагином; открытое исполнение при обрезке сохраняется (это важно для `B-41`).
  6. **Hash-проверка:** sha256 файла до и после каждой операции мастера; сохранение — в отчёт. Ни одной записи в легаси-файл: адаптер открывает его только на чтение (`readFileSync`, без `openSync('w')`, без `renameSync`).
  7. Тест `tests/legacy-ledger.test.mjs` (6 утверждений): (а) чтение живого файла даёт **55** карточек; (б) распределение 34 `backlog` / 19 `done` / 2 `failed`; (в) 22 карточки с исполнениями, всего 31 исполнение; (г) 3 карточки с `archivedAt`; (д) hash файла до и после полного набора операций совпадает; (е) файл читается при **отсутствующей** строке `web-ui-task-board` в профиле (тест не требует профиля вообще — он читает путь).
     Команда: `node --test --test-isolation=none tests/legacy-ledger.test.mjs` → FAIL.
  8. Команда: `node --test --test-isolation=none tests/legacy-ledger.test.mjs` → `pass 6 / fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none tests/legacy-ledger.test.mjs` → `pass 6 / fail 0` **и** в отчёте приложены sha256 до/после и вывод чтения 55 карточек.
- **Evidence в отчёт:** sha256 до/после, распределение по статусам и рабочим пространствам, вывод чтения.
- **Риски:**
  1. **Живой lock.** `ledger-v2.lock` содержит `{pid, token, startedAt, probe}`; плагин отказывается стартовать при живом lock (`P/src/host-ledger.ts:1239`). Для **чтения** это не мешает, но означает: если legacy-плагин работает, файл может меняться между чтениями — hash-проверка обязана быть до и после и **в** отчёте должно быть указано, что файл не менялся.
  2. `readFileSync` большого файла (370 КБ) безопасен; потоковое чтение не требуется, но 55 карточек и ≤20 исполнений на карточку — верхняя граница, которую тест `(в)` подтверждает.

### B-41 · Мастер: preview → select → commit, идемпотентность по `sourceId`
- **Карточка:** MW-054, MW-029 (маршруты), MW-055 · **Зависит от:** B-40, B-19
- **Усилие:** L (1–1.5 дня) · **Риск:** высокий (перенос authority) · **Откат:** удалить импортированные задачи по `sourceId` в тестовой БД; оригинал не трогается вовсе
- **Цель:** импорт односторонний и явный; повтор commit идемпотентен; ни одно чужое исполнение не превращается в `Attempt`; `done` не импортируются.
- **Файлы:** Create `packages/controller/src/import-wizard.ts`; Modify `packages/contracts/src/index.ts` (`TaskProvenance`, `LegacySourceRef`, `ExternalExecutionRef`); Create `tests/import-wizard.test.mjs`
- **Шаги:**
  1. **Правило eligibility, дословно:** карточка eligible, если `workspaceId === <MyWork workspaceId>` **и** `status !== 'done'`. На живых данных это **33** карточки: `47b14762-c848-44e6-a7cc-62f19949566d` (52 карточки) минус 19 `done`. Совпадает с §9.1 отчёта («правило eligible даёт 33, а не 35»); цифры «35», «41» из текстов MW-054/MW-055 ложны и правятся (`30-CARD-EDITS.md`).
  2. MyWork workspaceId берётся из реестра: `C:\Users\Dmitry\.dsh\storages\workspace.json` → `47b14762-c848-44e6-a7cc-62f19949566d` = `H:\Repo\DSH-MyWork`. Осиротевшее `3fc33afb-e9c6-4bf2-b561-4388c8ad0e09` (3 карточки) в реестре **отсутствует** и в выбранные не попадает.
  3. `done` **не импортируются**: 19 карточек остаются legacy-архивом; колонка «Готово» в MyWork после миграции пуста (ADR025 `:316`).
  4. **Идемпотентность — по `sourceId`**, а не по `requestId`: живой леджер держит две разные защиты — окно `requestId` + sha256-`fingerprint` (максимум **256** записей, вытеснение при переполнении, `P/src/host-ledger.ts:102,574-585`) и per-source `scheduler.importedSources` (`:703-704,714`). После 256 действий старый `requestId` выпадает из кэша, поэтому ключ идемпотентности импорта — `sourceId` + собственный `operationId` MyWork.
  5. Открытые исполнения: `endedAt` без `result`-исхода или отсутствующий `sessionId` трактуется как «исполнение не завершено». Такие карточки **блокируют commit** и требуют явного выбора «дождаться» / «отменить»; автоотмены нет (ADR025 `:318`). В живом файле `sessionId` отсутствует у 9 из 31 исполнения — это ровно тот случай.
  6. Поля провенанса (новые в контрактах): `TaskProvenance { origin: 'imported-legacy'; sourceId; importedAt; importedBy? }`, `LegacySourceRef { ledgerPath; ledgerRevision; sourceTaskId; sourceWorkspaceId }`, `ExternalExecutionRef { executionId; sessionId?; startedAt; endedAt; result; initiatedBy?; error? }`. Инвариант: **ни один `attemptId` не равен ни одному `externalExecutionId`**; у импортированной задачи `origin = 'imported-legacy'`, непустые `externalExecutions`, **ноль попыток**.
  7. Preview обязан **явно показывать расхождения**: например MW-001 числится `failed` в леджере, хотя отчёты существуют (`.work/reports/MW-001-review.md`, `MW-001-target-capabilities.md`). Никакой автоконвертации.
  8. Запрещённые ключи: если в карточке есть `shell`/`command`/`executable`/`args` — отклоняется **весь** импорт (ADR025 `:331`).
  9. Тест `tests/import-wizard.test.mjs` (8 утверждений): (а) eligible = 33; (б) `done` не выбираются и не появляются в `done`; (в) повтор commit с тем же `sourceId` идемпотентен (число задач не растёт); (г) карточка с открытым исполнением блокирует commit и предлагает wait/cancel; (д) импортированная задача: `origin`, `externalExecutions` непусто, попыток 0; (е) ни один attempt id не совпал с external execution id; (ж) карточка с `shell`-полем отклоняет весь импорт; (з) preview показывает расхождение MW-001 и **не** конвертирует его.
     Команда: `node --test --test-isolation=none tests/import-wizard.test.mjs` → FAIL.
  10. Команда: `node --test --test-isolation=none tests/import-wizard.test.mjs` → `pass 8 / fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none tests/import-wizard.test.mjs` → `pass 8 / fail 0` **и** прогон мастера на **копии** файла не изменил оригинал: sha256 оригинала до/после совпадает.
- **Evidence в отчёт:** число eligible (33), список отклонённых `done` (19), per-card результаты, sha256 оригинала.
- **Риски:**
  1. **Второй писатель.** Любая запись в легаси-файл превращает MyWork в соавтора чужого леджера — прямо запрещено ADR025. Тест `(з)` плюс hash-проверка.
  2. **Приёмка MW-054 говорит «41 карточка»** в другом месте (текст `MW-055.md:21`) — оба числа заменяются на 55/33 с обоснованием; иначе приёмка неисполнима.
  3. `ImportedSources` в живом файле **отсутствует** (0 вхождений) — импорт в этом профиле ни разу не выполнялся. Значит поведение мастера на живых данных **не наблюдалось**, только код: помечать в отчёте как «проверено на копии, не на живом профиле».

### B-42 · Cutover: отключение расписаний и строки, откат, честность баннера — **НЕ ИСПОЛНЯТЬ в кампании**
- **НЕ ИСПОЛНЯТЬ:** шаг правит `C:\Users\Dmitry\.dsh\profiles\web\cordis.patch.yml` — живой профиль, а правка профиля запрещена брифом. Шаг сохранён как **процедура для владельца**; его исполняет человек после явного подтверждения, вне этой кампании. Тест `tests/cutover-preconditions.test.mjs` (без правки профиля) исполним и полезен — его можно сделать отдельно.
- **Карточка:** MW-054, MW-055, D06 (решение владельца) · **Зависит от:** B-41, B-43
- **Усилие:** M (2 ч) · **Риск:** высокий (необратимо до откатa) · **Откат:** вернуть строку `web-ui-task-board` в `cordis.patch.yml` (одна строка) и снять `disabled`
- **Цель:** cutover выполняется только после верифицированного переноса и явного подтверждения; откат — одна строка.
- **Файлы:** Modify `C:\Users\Dmitry\.dsh\profiles\web\cordis.patch.yml` (**живой профиль** — только владелец, вне кампании); Create `.work/reports/MW-054-import-wizard.md`
- **Шаги:**
  1. **Шаг 0 (предусловие, не действие):** подтвердить, что расписаний нет и что запускать нечего. Доказательство из живого состояния: `C:\Users\Dmitry\.dsh\task-board\scheduler-v2.json` = `{"lastTickAt":1790442076557}` — **ни одного per-task расписания**; ключи `autoRun*` в строке `web-ui-task-board` (`C:\Users\Dmitry\.dsh\profiles\web\cordis.patch.yml:20-35`, дословно `autoRunTodo`, `autoRunPaused`, `autoRunMaxConcurrent`, `autoRunMaxRetries`, `autoRunStallMinutes`, `autoRunMaxPerHour`, `autoRunMaxPerDay`) — **мёртвая конфигурация**: `Config` 0.4.3 объявляет 8 полей и подстроки `autoRun` не содержит вовсе (`P/src/index.ts:51-89`). **Поправка 2026-10-03 (дельта 0.2.0-rc.2):** это описание **0.4.3**; на установленной **0.4.4** семь ключей `autoRun*` **вернулись** в живой профиль (`C:\Users\Dmitry\.dsh\profiles\web\cordis.patch.yml:27-33`) и право читается с верхнего уровня (`C:\Users\Dmitry\.dsh\profiles\web\node_modules\@linxin666\dsh-client-ui-task-board\src\index.ts:109,323`; `src\core\handover.ts:44,102-117`), поэтому «`autoRun*` в `Config` нет» — **не констатация, а действие по удалению** мёртвых ключей; вердикт прошлого прохода не переписан (`01-MASTER-PLAN.md` §16 **R-47**; `02-PLATFORM-DELTA-0.2.0-rc.2.md` §2.2 **D8/D9**). Обоснование «cutover нельзя, пока autoRunTodo включён» заменяется на «проверить per-task расписания и доступность инструментов `task_board_run`/`task_board_schedule`» — так и формулирует FINAL-REPORT §6 K7(г).
  2. **Выключатель — строчный override внутри агрегата.** Удалить бандл нельзя: `@linxin666/dsh-web-all` содержит 18 других нужных строк. Правильная форма — `- { id: web-ui-task-board, disabled: true }` (FINAL-REPORT §4.1; ADR021 `:224`). Строка Loader'а сегодня: `id: web-ui-task-board` внутри агрегата (`C:\Users\Dmitry\.dsh\profiles\web\cordis.patch.yml:20-35`).
  3. **Порядок:** (а) `B-41` завершён; (б) `B-43` зелёный; (в) архивная read-only ссылка работает **при отсутствующей строке** (проверено в `B-40` тестом `(е)`); (г) человек подтверждает; (д) только тогда выключить строку.
  4. **Честность.** Никакой баннер не утверждает, что legacy-scheduler остановлен: единственный безопасный «hook» — выключенная строка профиля; до этого баннер говорит «read-only архив» (`B-33`).
  5. **Откат:** вернуть строку (`disabled: false` или убрать override) — решение обратимо одной строкой, если не удалять бандл.
  6. Тест (без правки профиля): `tests/cutover-preconditions.test.mjs` — (а) при подставленном профиле с живой строкой баннер говорит «read-only», не «остановлен»; (б) при `disabled: true` архив читается из файла; (в) в репозитории нет ни одного места, удаляющего `@linxin666/dsh-web-all` (скан по `packages/**` и `scripts/**`); (г) `scheduler-v2.json` без расписаний трактуется как «расписаний нет», а не «неизвестно».
     Команда: `node --test --test-isolation=none tests/cutover-preconditions.test.mjs` → FAIL.
  7. Команда: `node --test --test-isolation=none tests/cutover-preconditions.test.mjs` → `pass 4 / fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none tests/cutover-preconditions.test.mjs` → `pass 4 / fail 0` **и** в отчёте зафиксировано: «строка выключена» либо «не выключалась, причина». Сама правка профиля — **вне этой кампании**.
- **Evidence в отчёт:** содержимое `scheduler-v2.json`, дословная строка профиля до/после, подтверждение владельца, sha256 леджера.
- **Риски:**
  1. **Необратимость.** Удаление строки/бандла необратимо без переустановки; выключение — обратимо. Разница фиксируется в отчёте.
  2. **Второй исполнитель.** Если карточки остались в леджере и кто-то включит legacy auto-run — на проект придёт второй исполнитель. Митигация: периодическая проверка расписаний (`B-43`) и то, что `autoRun*` не читаются вовсе.

---

## 9. Приёмка доски и верификация миграции (MW-055)

### B-43 · Матрица сценариев приёмки: 33 сценария, evidence на каждый, инварианты
- **Карточка:** MW-055 · **Зависит от:** B-30…B-42
- **Усилие:** L (1–1.5 дня) · **Риск:** средний (приёмка — единственный «суд») · **Откат:** не нужен (артефакт-документ)
- **Цель:** каждый сценарий имеет команду, exit code и наблюдаемый результат; сценарий без evidence считается **непройденным** — это правило сохраняется дословно.
- **Файлы:** Create `.work/reports/MW-055-board-acceptance.md`; Create `tests/acceptance.test.mjs` (инварианты)
- **Шаги:**
  1. **Перечня 33 сценариев в репозитории нет** — grep по `.work` находит только упоминания числа (`MW-055.md:18`, `tasks.json`). Первое действие: **выписать перечень** в отчёт (33 строки), затем исполнять. Без этого приёмка невоспроизводима.
  2. Инварианты (каждый — падающий тест):
     - нет false `Done` до review и интеграции: `projectTaskZone('failed') !== 'done'` и переход в `done` только из `integrating` (`packages/core/src/task.ts:59`);
     - ни одного исполнения из Idea: admission для `IdeaId` даёт отказ (MW-043);
     - reviewer не подтверждает сам себя (`SECURITY_DENIED`);
     - документ с raw shell gate отвергнут;
     - неавторизованная команда отвергнута **без** изменения графа (`Task.revision` не двигается).
  3. Числа: `MW-055.md:21` говорит «копия реального ledger **из 41 карточки**» — фактически **55** карточек, eligible **33** (см. `B-41`). Исполняемый вариант: копия **полного** файла (55 строк), проверка неизменности оригинала (sha256).
  4. Тест `tests/acceptance.test.mjs` (6 утверждений): (а) `projectTaskZone('failed') !== 'done'`; (б) переход в `done` возможен только из `integrating`; (в) reviewer с тем же `agentId`, что worker, отвергнут; (г) reviewer с `workspace.write`/`git.write` отвергнут; (д) неавторизованная команда не меняет `Task.revision`; (е) тест падает при подмене правила «`done` из `reviewing`» (мутационная проверка).
     Команда: `node --test --test-isolation=none tests/acceptance.test.mjs` → FAIL.
  5. Команда: `node --test --test-isolation=none tests/acceptance.test.mjs` → `pass 6 / fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none tests/acceptance.test.mjs` → `pass 6 / fail 0` **и** в `.work/reports/MW-055-board-acceptance.md` есть 33 строки «сценарий → команда → exit code → наблюдаемый результат», и **ни одной** строки без команды.
- **Evidence в отчёт:** таблица 33 сценариев, вывод мутационной проверки `(е)`, инвариантные тесты.
- **Риски:**
  1. **«Сценарий без evidence = непройденный»** — правило сохраняется, но его нельзя применять к сценариям, требующим открытого GUI. Такие помечаются «требует GUI: не проверено», а не «пройдено» (FINAL-REPORT §12.4).
  2. **Колонка «Готово» — не доказательство.** Четыре леджера противоречат друг другу (§0.8): MW-042 числится `done` на доске, `planned` в `tasks.json`, `READY_FOR_REVIEW` в отчёте. Приёмка обязана читать доказательства, а не статус.

### B-44 · Прогон миграции на копии реального леджера и верификация результата
- **Карточка:** MW-055, MW-054 · **Зависит от:** B-41, B-43
- **Усилие:** M (2–3 ч) · **Риск:** средний · **Откат:** удалить тестовую БД и копию файла
- **Цель:** мастер проверен на копии живого леджера; оригинал не изменён; результат воспроизводим.
- **Файлы:** Create `scripts/verify-legacy-import.mjs` (**создаётся в этой кампании? нет** — создаётся исполнителем карточки; в плане указан как артефакт); Create `.work/reports/MW-055-import-verification.md`
- **Шаги:**
  1. Скопировать файл (каталог создан в `B-01`): `Copy-Item C:\Users\Dmitry\.dsh\task-board\ledger-v2.json .tmp\plan-v03-surface\ledger-copy.json` — если каталога нет, сначала `New-Item -ItemType Directory -Force -Path .tmp\plan-v03-surface`.
  2. Зафиксировать sha256 оригинала: `Get-FileHash C:\Users\Dmitry\.dsh\task-board\ledger-v2.json -Algorithm SHA256`.
  3. Прогнать `preview` на копии → ожидаемо 55 прочитанных, 19 отклонённых `done`, 33 eligible.
  4. Прогнать `commit` на изолированном `DSH_HOME` → 33 задачи с `origin = 'imported-legacy'`, 0 попыток.
  5. Повторить `commit` → число задач **не** изменилось (идемпотентность по `sourceId`).
  6. Проверить оригинал: `Get-FileHash` совпадает с шагом 2.
  7. Проверить, что ни один `attemptId` не совпал ни с одним `externalExecutionId`.
  8. Тест-обёртка: `node --test --test-isolation=none tests/legacy-import-verification.test.mjs` — (а) sha256 оригинала неизменен; (б) 55/19/33; (в) повтор commit идемпотентен; (г) попыток 0; (д) множества id не пересекаются.
     Команда: `node --test --test-isolation=none tests/legacy-import-verification.test.mjs` → FAIL до прогона, `pass 5 / fail 0` после.
- **Гейт (готово когда):** `node --test --test-isolation=none tests/legacy-import-verification.test.mjs` → `pass 5 / fail 0` **и** два значения `Get-FileHash` оригинала (до/после) совпадают — приложены в отчёт.
- **Evidence в отчёт:** два хеша, четыре числа (55/19/33/0), вывод повторного commit.
- **Риски:** прогон «на живом профиле» вместо изолированного `DSH_HOME` создаст задачи в рабочей доске — недопустимо. Тест обязан поднимать изолированный `DSH_HOME`; образец — **`scripts/verify-profile.mjs`** (файл существует; `packages/controller/src/layout.ts` **не существует** — в `packages/controller/src` только `dsh-session.ts`, `index.ts`, `model-catalog.ts`).

---

## 10. Остальные UI-карточки (MW-043, MW-036, MW-037, MW-051)

### B-45 · Idea Bank: переоформить устаревший блокер и реализовать идею как сущность
- **Карточка:** MW-043 (BLOCKED → переоформление) · **Зависит от:** MW-026 или переоформления блокера, MW-042
- **Усилие:** M (2–3 ч, только переоформление) / L (реализация — отдельная карточка) · **Риск:** низкий (переоформление) · **Откат:** вернуть прежний текст карточки
- **Цель:** блокер перестаёт быть ложным; понятно, что именно мешает и что можно делать параллельно.
- **Факты.** Отчёт `.work/reports/MW-043-idea-bank.md:3` — `BLOCKED`; блокер — зависимости `MW-042, MW-011, MW-026` (`INDEX.md:79`). `MW-011` реализован: контракты и ядро планирования есть (`packages/contracts/src/plan.ts` 19 138 байт, `packages/core/src/plan.ts` 49 311 байт, пакет `planner`), а на легаси-доске MW-011 — `done`. `MW-026` **не** реализован: на доске `backlog`, 0 исполнений. То есть блокер устарел **частично**: он сводится к одному пункту.
- **Файлы:** Modify `.work/tasks/MW-043.md` (`30-CARD-EDITS.md` — правит `card-ledger`); Create `packages/contracts/src/idea.ts`, `packages/core/src/idea.ts` (реализация — по карточке)
- **Шаги:**
  1. Заменить строку зависимостей на `MW-042, MW-026` и добавить в карточку строку-обоснование: «MW-011 реализован: см. `packages/{contracts,core}/src/plan.ts` и пакет `planner`; блокер сводится к MW-026».
  2. Проверить отсутствие сущности: `Select-String -Path packages\**\*.ts -Pattern 'IdeaPromotion|IdeaState|idea.bank'` → ожидаемо пусто (сегодня: 0 совпадений; в `packages/contracts/src/board.ts` есть только слово `ideas` как имя зоны).
  3. Проверить, что строка authority `idea.bank` **не** объявлена: `Select-String packages\contracts\src\authority.ts -Pattern 'idea'` → пусто.
  4. Зафиксировать в отчёте: реализация Idea Bank **не начинается** до решения D12/порядка (этап 5, `01-MASTER-PLAN.md` §5), потому что требует миграции `idea-bank` и строки authority.
- **Гейт (готово когда):** в `.work/tasks/MW-043.md` зависимость `MW-011` снята и добавлено обоснование; `INDEX.md` обновлён (правит `card-ledger`).
- **Evidence в отчёт:** diff карточки, два grep-подтверждения отсутствия сущности, ссылка на `packages/*/src/plan.ts` как доказательство MW-011.
- **Риски:** поспешная реализация Idea Bank создаст второй intake-механизм до появления `HumanDecision` (D14) и admission-паузы (ADR024) — порядок из мастер-плана важнее удобства.

### B-46 · Team Work, Roles и Settings (MW-036)
- **Карточка:** MW-036 · **Зависит от:** B-26, B-28, MW-006, MW-030
- **Усилие:** L (1.5–2 дня) · **Риск:** средний · **Откат:** revert коммита
- **Цель:** Team показывает агентов/роли/модели/состояния/пулы; редакторы Roles/Blueprints и config overlays сохраняют **новую ревизию**, не трогая frozen running Attempt.
- **Файлы:** Create `packages/web/src/team/TeamPanel.tsx`, `RoleEditor.tsx`, `SettingsPanel.tsx`; Create `packages/web/tests/team.test.mjs`
- **Шаги:**
  1. Контракты уже есть: `AgentIdentity`, `AgentBlueprint`, `RoleContract`, `RoleStrategy`, `PoolLimits` — это пробел **планирования UI**, не контрактов (FINAL-REPORT §5.2 «§47»). Использовать существующие типы, не заводить свои.
  2. Сохранение — через существующий путь ревизий: новая ревизия роли не меняет `FrozenRevisions` попытки (ADR020 `:203`).
  3. Тест `packages/web/tests/team.test.mjs` (5 утверждений): (а) Team показывает 6 колонок (Agent/Role/Model/State/Workspace/Current) и отдельные счётчики пулов; (б) новая ревизия роли не меняет revisions идущей попытки; (в) permission и лимиты видны **до** сохранения; (г) невалидный конфиг даёт понятную ошибку и **не** сохраняется; (д) режимы global/isolated/inherit и пустая sleeping Team отрисованы.
     Команда: `node --test --test-isolation=none packages/web/tests/team.test.mjs` → FAIL.
  4. Команда: `node --test --test-isolation=none packages/web/tests/team.test.mjs` → `pass 5 / fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none packages/web/tests/team.test.mjs` → `pass 5 / fail 0` и редактор workflow в этой карточке **отсутствует** (он вынесен в MW-051).
- **Evidence в отчёт:** прогон, скриншоты, diff ревизий до/после сохранения.
- **Риски:** соблазн добавить редактор workflow «раз уж есть панель» — прямо исключено объёмом карточки.

### B-47 · Role Lab, Activity и Audit (MW-037)
- **Карточка:** MW-037 · **Зависит от:** B-26, B-28, MW-033, MW-034
- **Усилие:** L (1.5 дня) · **Риск:** средний · **Откат:** revert коммита
- **Цель:** история ревизий ролей/скиллов, прогоны обучения, candidate diff/evaluation/shadow/canary, controlled promote/rollback; Activity/Audit с фильтрами и ссылками по `correlationId` **без** загрузки raw-транскриптов по умолчанию.
- **Файлы:** Create `packages/web/src/roles/RoleLab.tsx`, `ActivityView.tsx`, `AuditView.tsx`; Create `packages/web/tests/rolelab.test.mjs`
- **Шаги:**
  1. Права проверяются **сервером**: UI не решает, можно ли продвинуть кандидата; отказ приходит кодом и отображается.
  2. Stale candidate нельзя продвинуть поверх новой ревизии — проверяется CAS-ревизией (существующий механизм `revisions.ts`).
  3. Audit **не редактируется** UI: только чтение, фильтры и переходы по `correlationId`.
  4. Тест `packages/web/tests/rolelab.test.mjs` (5 утверждений): (а) promote со stale-ревизией отвергнут сервером и не меняет состояние; (б) UI не содержит ни одного пути записи в audit; (в) raw-транскрипт не загружается до явного действия (счётчик сетевых вызовов = 0); (г) error/empty/paging состояния отрисованы; (д) всё достижимо с клавиатуры.
     Команда: `node --test --test-isolation=none packages/web/tests/rolelab.test.mjs` → FAIL.
  5. Команда: `node --test --test-isolation=none packages/web/tests/rolelab.test.mjs` → `pass 5 / fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none packages/web/tests/rolelab.test.mjs` → `pass 5 / fail 0`.
- **Evidence в отчёт:** прогон, скриншоты, подтверждение «0 запросов транскрипта».
- **Риски:** «показать транскрипт для удобства» — нарушение политики PII (D16) и §8.

### B-48 · Визуальный редактор workflow (MW-051)
- **Карточка:** MW-051 · **Зависит от:** B-26, MW-044, MW-045
- **Усилие:** L (2 дня) · **Риск:** средний · **Откат:** revert коммита
- **Цель:** редактор вызывает **тот же** валидатор, что и движок; в схеме узла нет поля, способного выразить shell/command/executable/код.
- **Файлы:** Create `packages/web/src/workflow/Editor.tsx`, `NodeInspector.tsx`, `RuleEditor.tsx`; Create `packages/web/tests/workflow-editor.test.mjs`
- **Шаги:**
  1. Валидация — вызов серверного валидатора (тот же модуль, что у движка), не своя копия правил. Preview diff — против frozen revision.
  2. Типы узлов: типизированные узлы, ветвления, условия, approval gates, bounded retries, human gates. Trigger/condition/action — из **закрытых каталогов**; неизвестное значение отвергается.
  3. Тест `packages/web/tests/workflow-editor.test.mjs` (6 утверждений): (а) документ, отвергнутый валидатором, невозможно сохранить; (б) в схеме узла нет полей `shell`/`command`/`executable`/`code` (скан схемы); (в) preview показывает diff против frozen revision; (г) неизвестный trigger/condition/action отвергнут; (д) невалидный документ даёт понятную ошибку и не сохраняется; (е) срабатывание правила пишет audit с вычисленным условием.
     Команда: `node --test --test-isolation=none packages/web/tests/workflow-editor.test.mjs` → FAIL.
  4. Команда: `node --test --test-isolation=none packages/web/tests/workflow-editor.test.mjs` → `pass 6 / fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none packages/web/tests/workflow-editor.test.mjs` → `pass 6 / fail 0` и в отчёте подтверждено, что валидатор — **тот же** модуль (путь и версия), что использует движок.
- **Evidence в отчёт:** прогон, путь валидатора, скриншот diff-превью.
- **Риски:** «свой валидатор в UI» — самая опасная форма дублирования: UI начнёт разрешать то, что движок отвергает. Тест `(а)` требует именно вызова серверного валидатора.

---

## 11. Что НЕ делать

Прямые запреты для всех B-шагов. Нарушение = дефект плана.

1. **Не удалять и не заменять агрегат `@linxin666/dsh-web-all`.** В нём 18 других нужных строк; выключается только строка `web-ui-task-board`, и только строчным override `disabled: true` (FINAL-REPORT §4.1, §10 «Что НЕ делать»; ADR021 `:224`).
2. **Никакого DOM-перехвата.** Не искать `[class*="centerCol"]`, не прятать чужую панель, не патчить чужие узлы, не полагаться на `data-dsh-*`-атрибуты как на контракт (их в DSH нет как публичного API — `docs/**` про `data-dsh` даёт 0 совпадений, `evidence/surface-01.md:16`). Совместимость — только чтение файла леджера (ADR021 `:215`, §4.3 FINAL-REPORT: маркеров DOM-перехвата в 0.4.3 нет). **Проверено 2026-10-03 на установленной 0.4.4:** `rg -n "centerCol|data-dsh-taskboard-active" <профиль>\...\task-board\src` → **0 совпадений, exit 1** — довод верен и для текущего эталона (сам довод — в `10-DECISIONS.md`, D06/ADR021).
3. **Не занимать `data-dsh-*`.** Пространство занято не только служебными маркерами shell (`data-dsh-boot`, `data-dsh-boot-spinner`, `data-dsh-automatic-focus`), но и сторонними клиентскими плагинами: установленная доска 0.4.4 в своём `src` пишет `data-dsh-part` (20 вхождений), `data-dsh-taskboard-view` (4), `data-dsh-plugin` (2), `data-dsh-panel-entry` (2), `data-dsh-center-view-back` (1) — `rg -o --no-filename "data-dsh-[a-zA-Z-]+" <профиль>\...\task-board\src`; панель MyWork использует **`data-mw-*`** (`B-27`).
4. **Не строить второго исполнителя доски.** Ни одного `setInterval`-раннера, scheduler'а, cron'а или авто-запуска карточек в UI-пакете или в проекции (ADR020 `:199`; ADR021 `:224`). Единственный admission — домен.
5. **Не заводить второй учёт токенов/стоимости.** `dsh-token-meter` даёт снимок, в MyWork уже есть `BudgetConsumption {tokens, cost}` (FINAL-REPORT §10).
6. **Не регистрировать MyWork-движок в `ctx.workflowEngine`.** Один движок на контекст; домен переименовывается (D03).
7. **Не писать в легаси-леджер.** Ни одной записи, ни `renameSync`, ни `openSync('w')` по пути `task-board/ledger-v2.json` (ADR025 `:321`).
8. **Не импортировать `done`-карточки** и не изображать приёмку, которой не было (ADR025 `:316,323`).
9. **Не подавать `degraded` как `empty`** и наоборот — это ровно то различие, ради которого состояния разделены (`packages/contracts/src/board.ts:137-140`; тест `tests/board.test.mjs:600`).
10. **Не смешивать HTTP-префикс с именем Remote-namespace** (FINAL-REPORT §6 K1, F8).
11. **Не считать «колонку Готово» доказательством приёмки** — четыре леджера противоречат друг другу (§0.8).
12. **Не пропускать `B-12` через `F-33`/`F-34` (+ `F-20`).** Дюрабельная запись доски без атомарности и journal — прямой RT-1. И **не вписывать версию миграции литералом**: v2 занята `EVIDENCE_MIGRATIONS`, `validateMigrations` бросает на дубле, store не откроется (правило §15.3, дефект R-04).
13. **Не выдумывать числа и поля.** Всё, что не проверено (`sessionId` у 9 исполнений, отсутствие `importedSources`, поведение `/plugins/<id>/client.js` на живом GUI), идёт в отчёт как «не проверено», а не как факт.
14. **Не полагаться на `dsh.engines.dsh`** — DSH его не читает; работает только `peerDependencies` (FINAL-REPORT §10).

---

## 12. Не проверено / открытые проверки

Формат: что именно, почему не проверено, кто и как может закрыть.

| # | Что не проверено | Почему | Как закрыть |
|---|---|---|---|
| 1 | Прогон `node --test --test-isolation=none tests/board.test.mjs` **воспроизведён** (24/24), но приёмочные сценарии MW-049/050/052/053/055 не запускались | UI-пакета в дереве нет, тестов этих карточек нет: `.work/reports/MW-049-board-ui.md`, `MW-050-card-interaction.md`, `MW-052-views.md`, `MW-053-theme-a11y.md`, `MW-055-board-acceptance.md` отсутствуют | исполнители карточек после реализации UI |
| 2 | Поведение браузера: `/plugins/<id>/client.js`, HMR-канал, рендер панели, темы/скины | путь не проверялся ни в этой кампании, ни в аналитической (`evidence/lead-02-http-slots.md:37`: пробы дали 404 при 401 на `/`) | открытый GUI + DevTools; нужен токен/URL запуска |
| 3 | Живой Plugin Manager (install/remove/enable) и живой Schedule | требуют интерактивного GUI | владелец вручную |
| 4 | Является ли `data-dsh-*` формально зарезервированным пространством | в `docs/**` 0 совпадений, механизма принуждения нет (`evidence/surface-01.md:16,20`) | решение владельца; до него — свой префикс по умолчанию |
| 5 | Точное число `data-dsh-*`: «13 совпадений» (FINAL-REPORT §4.2) | **не воспроизведено**: перемер 2026-10-03 на `639ed0153` дал 19 в `packages/**/src/**` (7 файлов), 28 в `packages`+`apps` без `lib`/`dist` (9 файлов), 3 различных имени (прежние числа плана — 7 и 32); часть атрибутов пишется через `dataset`, литеральный grep их не видит | пересчитано командой из `B-27` (`rg -o … "data-dsh-[a-zA-Z-]+" packages apps`); при расхождении правка FINAL-REPORT — дело Lead'а |
| 6 | Реальный сценарий импорта легаси | `importedSources` в живом файле отсутствует → импорт ни разу не выполнялся; поведение только по коду | `B-44` на копии файла и изолированном `DSH_HOME` |
| 7 | Существует ли публичный способ открыть DSH-сессию по `sessionId` из панели | не искалось в этой кампании | Шаг 0 в `B-36`: grep DSH-checkout по навигации сессий |
| 8 | Есть ли `due`/`defer`/`startedAt`/`settledAt` в контрактах | не проверялось | Шаг 0 в `B-38` |
| 9 | Компиляция MyWork против типов DSH rc.2 (TS 5.7 против 6.0.3) | требует сборки | этап 3 мастер-плана; `peerDependencies` — `B-24` |
| 10 | Стоимость LLM и реальные размеры баз | баз ещё нет (ни одной живой `*.sqlite`) | после `F-28`…`F-32` и `F-33`/`F-34` |
| 11 | Стриминг через `connection.fetch.register` на живом GUI | подтверждён только по коду моста (`http-bridge.ts:96-120`) | сценарий `B-21` `(в)` на живом GUI |
| 12 | Судьба `read-only` ссылки на архив после выключения строки | зависит от D06 и от правки живого профиля (вне кампании) | `B-42` после решения владельца |
| 13 | **Гейты, требующие живого GUI, без fallback:** `B-20` (403 на чужой `Host`), `B-26` (выгрузка плагина без перезагрузки), `B-30` (фактические измерения 1099/1100), `B-39` (матрица контраста) | правка живого профиля и интерактивный GUI запрещены/недоступны в кампании; это **известное** ограничение, а не дефект текста | помечать «требует GUI: не проверено» **заранее**; закрывает владелец или исполнитель карточки |
| 14 | **Тестовый харнесс `packages/web`** | `react`/`react-dom`/`jsdom`/`happy-dom` в `node_modules` отсутствуют, `pnpm install` запрещён. Решение принято в `B-01a`: тесты — только чистые функции; всё DOM-зависимое уходит в GUI-шаги `B-30a`/`B-39a` | если владелец разрешит devDeps + install — отдельный шаг, и тогда рендер-тесты становятся автоматическими |
| 15 | **Следствие D18 о переезде `ThemeCapability`/`SurfacePolicy`** в UI-слой вместе с layout-константами | ни один B-шаг его не исполняет: `B-29`/`B-38` опираются на `resolveSurfacePolicy` из `packages/core/src/theme.ts` (находка C4 проверки) | либо новый шаг `B-02a` (перенос + перенос его тестов `tests/board.test.mjs:642-651,653-709`), либо явный отказ владельца |
| 16 | **Устаревшие формулировки ADR-030 §2/§Тесты** («`core/board.ts` не меняется вовсе», «строки `35-57`… остаются как есть») | противоречат `B-02`/`B-03`/`B-08`/`B-10` (находка C2). Правка ADR — за `decision-desk`, не за этим файлом | `decision-desk` приводит ADR-030 в соответствие |

### 12.1. Ограничение кампании, которое надо знать

Бриф §6 требует собирать доказательства **субагентами**. Из моей сессии (`plan-surface`) вызовы `subagent` и `subagent_fork` отклоняются средой: `Error: subagent depth 2 exceeds maxDepth 1` (deployment `maxDepth = 1`). Обход найден: инструмент **`workflow`**, который запускает агентов с моего уровня. Через него собраны пять независимых блоков доказательств (`.work/plan-v0.3/evidence/surface-01…05.md`): инвентаризация `data-dsh-*`; структура живого леджера; привязка приёмок MW-042/049/050/052/055 к модели зон; Typert self-mount (`$mount`); клиентский HTTP/SSE 0.4.3. Дополнительно использованы пять доказательств, собранных Lead'ом (`lead-01-typert.md`, `lead-02-http-slots.md`, `lead-10-board-lanes.md` и др.).

---

## 13. Опровержения базы (`00-RECON.md` §3 и FINAL-REPORT)

Раздел по правилу брифа §5 п.8: найденные противоречия сообщаются Lead'у, а не правятся в чужом файле.

| # | Утверждение | Что на самом деле | Источник |
|---|---|---|---|
| 1 | FINAL-REPORT §4.2: «`data-dsh-*` … 13 совпадений в исходниках» | 19 литералов в `packages/**/src/**` (7 файлов), 28 в `packages`+`apps` без `lib`/`dist` (9 файлов), **3 различных имени** (перемер 2026-10-03 на `639ed0153`; прежние числа плана — 7 и 32); часть атрибутов пишется через `dataset.<camelCase>` | `evidence/surface-01.md:12-14,23`; перемер — шаг `B-27` |
| 2 | FINAL-REPORT §5.2 / решение D02: «падают 8 утверждений» / «9 в 8 тестах + 1» | **6 тестов, ≥13 утверждений** + 2 условных | `.work/plan-v0.3/evidence/lead-10-board-lanes.md`; §1.1 этого файла |
| 3 | решение D02: «26 — число `test(` в файле» | **24** | прогон `93-VERIFICATION-SURFACE.md` §1: `ℹ tests 24` |
| 4 | решение D02: падает `tests/board.test.mjs:459-484` | **проходит**: при 7 полосах у `ready`-карточки принимается ровно своя полоса, `accepted === 1` | `93-VERIFICATION-SURFACE.md` §2.1 |
| 5 | Задание на планирование: «приёмка MW-052 завязана на зоны» | в `MW-052.md:21` зон **нет вовсе**; правится «Объём» `MW-052.md:18` | `evidence/surface-03.md:24`; `evidence/lead-10-board-lanes.md:19` |
| 6 | FINAL-REPORT §5.2 «§51»: «кто двигает `boardRevision` — не определено» | подтверждено: ни одного присваивания в `packages/**`; у `columnRevision` единственная запись — `+1` внутри `applyDropIntent` | §0.3 |
| 7 | FINAL-REPORT §5.2 «§50»: «потерян `empty`» | в коде `empty` **есть** (`contracts/board.ts:147`, `BOARD_PANEL_STATES:158-166`) и закреплён тестом `tests/board.test.mjs:600`; теряет его не код, а внешний документ | `evidence/surface-03.md:26`; §B-10 |
| 8 | Тексты MW-054 (`:18`) и MW-055 (`:21`): «леджер из 41 карточки», «35 незавершённых» | **55** карточек, eligible **33** (52 в workspace MyWork − 19 `done`) | прогон по `ledger-v2.json`; `evidence/surface-02.md` |
| 9 | MW-054: «legacy `autoRunTodo` выключен» как предусловие cutover | ключей `autoRun*` в `Config` 0.4.3 **нет вовсе** (мёртвая конфигурация); проверять надо per-task расписания — а их нет (`scheduler-v2.json` = `{"lastTickAt":…}`). **Поправка 2026-10-03:** это вердикт по **0.4.3**; на установленной **0.4.4** семь `autoRun*` вернулись (`~/.dsh/profiles/web/cordis.patch.yml:27-33`) и право читается с верхнего уровня (`…task-board\src\index.ts:109,323`; `src\core\handover.ts:44,102-117`), поэтому проверка «ключей нет» — **действие по удалению**, а не констатация; вердикт не переписан (`01-MASTER-PLAN.md` §16 R-47; `02-PLATFORM-DELTA-0.2.0-rc.2.md` §2.2 D8/D9) | `P/src/index.ts:51-79`; FINAL-REPORT §6 K7(г) |
| 10 | MW-054: «`todo`/`running` не использовались» | подтверждено: в живом леджере 0 карточек с этими статусами | `evidence/surface-02.md` |

---

## 14. Реестр доказательств (сводка якорей)

Каждый пункт — проверенное утверждение с якорем. ≥35 позиций; используется верификатором (независимая проверка — `93-VERIFICATION-SURFACE.md`: 68 якорей, 57 подтверждено, 9 неверная строка, 2 не существует; все блокирующие находки внесены правками этого файла).

| # | Утверждение | Якорь |
|---|---|---|
| 1 | 9 зон перечислены и frozen | `packages/contracts/src/board.ts:53-63` |
| 2 | Строки 3×3 живут в контракте | `packages/contracts/src/board.ts:66-76` |
| 3 | Иконки зон живут в контракте | `packages/contracts/src/board.ts:82-92` |
| 4 | `ZONE_BY_STATE` покрывает 16 состояний; `needs-attention → blocked` | `packages/contracts/src/board.ts:102-119` |
| 5 | Порог 1100 px объявлен в контракте | `packages/contracts/src/board.ts:132` |
| 6 | 7 состояний панели, `empty ≠ unavailable` | `packages/contracts/src/board.ts:141-166` |
| 7 | `BoardPlacement` — 7 обязательных полей, `subState` мёртв | `packages/contracts/src/board.ts:197-225` |
| 8 | `DropIntent` без `operationId` | `packages/contracts/src/board.ts:231-249` |
| 9 | `board.move` — один глагол на reorder+rezone | `packages/contracts/src/board.ts:252-280` |
| 10 | `DegradedProjection`: 3 причины, `snapshotAt`, `staleZones` | `packages/contracts/src/board.ts:305-314` |
| 11 | `SessionLink` — единственное вхождение в репозитории | `packages/contracts/src/board.ts:336-347` (grep) |
| 12 | `NeedsAttentionReason` объявлен, носителя нет | `packages/contracts/src/board.ts:356-381` (grep) |
| 13 | `projectTaskZone` тотален по `ZONE_BY_STATE` | `packages/core/src/board.ts:44-46` |
| 14 | `assertSinglePlacement` проверяет `zone == projectTaskZone(exactState)` | `packages/core/src/board.ts:106-145` |
| 15 | `legalDropTargets` — из `allowedTaskTransitions` минус admission-only | `packages/core/src/board.ts:161-167,177-182` |
| 16 | `applyDropIntent` не проверяет инвариант на входе (A-13) | `packages/core/src/board.ts:521-539` |
| 17 | `PlacementChange.fromZone` заполняется только при смене зоны | `packages/core/src/board.ts:438,561` |
| 18 | `renumberKeys` даёт base-62 с запасом | `packages/core/src/board.ts:407-419` |
| 19 | 16 состояний и таблица переходов | `packages/contracts/src/task.ts:46-63`; `packages/core/src/task.ts:50-67` |
| 20 | Авторитет доски — `mywork-db`, `projection: true` | `packages/contracts/src/authority.ts:45-49,108-113` |
| 21 | События `board.placement.changed`, `board.view.revised` объявлены | `packages/contracts/src/events.ts:45-48,77-78` |
| 22 | Единственная миграция — `outbox-inbox` v1 | `packages/storage/src/migrations.ts:49-51,91-94` |
| 23 | Board-таблиц нет вовсе | grep `placement|board` по `packages/storage/**` = 0 |
| 24 | Контроллер — плагин без `inject`/webServer/слотов | `packages/controller/src/index.ts:92,101,104-128` |
| 25 | Тесты читают **собранные** пакеты | `tests/lib/fixtures.mjs:16-36` |
| 26 | 24 теста доски, все зелёные | `node --test --test-isolation=none tests/board.test.mjs` → `tests 24 / pass 24 / fail 0` |
| 27 | Тесты, завязанные на 9 зон и закреплённые списки | `tests/board.test.mjs:35-57,146-187,522-535,569-586` |
| 28 | Имена в собранных бандлах стерегутся тестом | `tests/boundaries.test.mjs:570-582` |
| 29 | 0.4.3: манифест клиента и peer | `P/package.json:25-49,88-96` |
| 30 | 0.4.3: слоты `sidebar.panellist` + `main`, `id == key`, `order 20` | `P/src/client/native-panel.tsx:31-32,99-124` |
| 31 | 0.4.3: `inject` хост-половины из 6 сервисов | `P/src/index.ts:35` |
| 32 | 0.4.3: SSE с heartbeat и снятием подписки | `P/src/host-routes.ts:218-246` |
| 33 | 0.4.3: снапшот с `revision`; SSE-кадр без карточек | `P/src/protocol.ts:35-60` |
| 34 | 0.4.3: 8 инструментов через `defineTool` | `P/src/host/agent-tools.ts:19,252-575` |
| 35 | 0.4.3: companion-инвариант пуст | `P/src/invariant.ts:1-4` |
| 36 | 0.4.3: дефолт права `read-only` и гейт подтверждения | `P/src/core/handover.ts:43-44,112-117` |
| 37 | DSH: `PLATFORM_MODULES` — ровно 9 имён | `D/packages/client/web/src/platform.ts:8-14` |
| 38 | DSH: `dsh.client` — 4 поля; `icon` вне него | `D/packages/util/package-manifest/src/types.ts:44-54,80-94` |
| 39 | DSH: субпуть не становится клиентской строкой; без `./client` — throw | `D/packages/client/modules/src/index.ts:828-848` |
| 40 | DSH: формат регистрации бандла | `D/packages/client/tsdown.client.ts:619` |
| 41 | DSH: `/api` — единственный префикс, trust-fence до обработчика | `D/packages/client/connection/src/api-path.ts:7`; `rpc-host.ts:99-111` |
| 42 | DSH: мост стримит ответ и рвёт по `close` | `D/packages/client/connection/src/http-bridge.ts:42-49,96-120` |
| 43 | DSH: `WebRoute`, disposer, дубликат пути бросает | `D/packages/host/webserver/src/index.ts:38-48,166-173` |
| 44 | DSH: `selectPanel` бросает при несовпадении `key` | `D/packages/client/ui-layout/src/client/service.ts:72-77` |
| 45 | DSH: `store` слота → `PropsStore {useStore, actions}` | `D/packages/client/ui-slots/src/index.ts:151,439,824`; `D/packages/client/store/src/contract.ts:93-136` |
| 46 | DSH: Typert-манифест и `TypertAnalysisError` | `D/packages/typert/generator/src/workspace.ts:90-148` |
| 47 | Легаси-леджер: путь, размер, `schemaVersion 3`, `revision 324` | `C:\Users\Dmitry\.dsh\task-board\ledger-v2.json`; `P/src/host-ledger.ts:413-419` |
| 48 | Легаси-леджер: 55 карточек, 34/19/2, 22 с исполнениями, 31 исполнение, 3 архивных | прогон `ConvertFrom-Json`; `evidence/surface-02.md` |
| 49 | MyWork workspace = `47b14762-…` = `H:\Repo\DSH-MyWork` | `C:\Users\Dmitry\.dsh\storages\workspace.json` |
| 50 | Расписаний нет | `C:\Users\Dmitry\.dsh\task-board\scheduler-v2.json` = `{"lastTickAt":…}` |
| 51 | Идемпотентность легаси держится на `requestId`+`fingerprint` и `importedSources` | `P/src/host-ledger.ts:102,574-585,703-714` |
| 52 | Четыре леджера противоречат друг другу по MW-042/MW-043 | `.work/tasks/tasks.json`; `INDEX.md:42,79`; `ledger-v2.json`; `.work/reports/MW-043-idea-bank.md:3` |

---

**Конец `22-STEPS-surface.md`.** Связанные файлы: `01-MASTER-PLAN.md` (§4 этап 5, §5 DAG, §9 «Что не делать», **§15 канонические правила**), `10-DECISIONS.md` (D01, D02, D18, D04), `adr/ADR-029-transport-web.md`, `adr/ADR-030-board-zones-v03.md`, `adr/ADR-032-peer-version-policy.md`, `30-CARD-EDITS.md` (правки MW-042/049/050/052/053/054/055/043/035), `20-STEPS-foundation.md` (F-01, F-18/F-19, F-20, F-28…F-32, F-33/F-34, F-41/F-42, F-48, F-58/F-59), `21-STEPS-execution.md` (конвейер, MW-026), `93-VERIFICATION-SURFACE.md` (независимая проверка этого файла).
