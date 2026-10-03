# verify-a-A03 — Доска: контракты, dead contracts, AutonomyLevel

Ревизия репозитория MyWork: `git rev-parse HEAD` = `0c657ae1434202865bd330f0eeaf2b60eb78f6d4` (H:\Repo\DSH-MyWork), рабочее дерево чистое.
Проверялось только чтением: `packages/contracts/src/**`, `packages/core/src/**`, `packages/beads-adapter/src/mapping.ts`, `tests/**`, `.work/plan-v0.3/**`, `.work/tasks/MW-042.md`; использовались read/grep и read-only `git rev-parse`.
Мутаций, install, build и прогонов тестов не выполнялось; ни один файл, кроме этого, не изменён.
Методическая оговорка: инструментальный grep не сканирует gitignored-каталог `.work/**` при поиске по каталогу, поэтому «0 совпадений по репозиторию» ниже означает «0 совпадений в коде»; совпадения внутри `.work/**` проверялись отдельными чтениями по явному пути.

## Якорь A03-1: 01-MASTER-PLAN.md:73 → packages/contracts/src/board.ts (фактически packages/core/src/board.ts:161,458-566)

- **Вердикт:** ПОДТВЕРЖДЕНО (утверждение верно; символы живут в `core`, а не в `contracts` — файл в якоре неточен)
- **Что проверено:** read `packages/contracts/src/board.ts` целиком (381 строка); read `packages/core/src/board.ts` offset 427 limit 140 (строки 434-566) и offset 120 limit 80 (161-182); read `tests/board.test.mjs` offset 140 limit 62 (146-187) и offset 440 limit 80 (452-519); grep `applyDropIntent|legalDropTargets` по `packages` → только `core/src/board.ts:161` (объявление), `:458` (объявление), `core/src/index.ts:301` (реэкспорт); read `.work/plan-v0.3/22-STEPS-surface.md` (56, 363, 373, 384-387, 956-959)
- **Фактическое значение:**
  - `core/board.ts:521-522` — `const expectedZone = projectTaskZone(placement.exactState)` / `if (intent.toZone !== expectedZone && intent.toZone !== placement.zone) {` (сравнивается только цель; сравнения входа `placement.zone` с `projectTaskZone(placement.exactState)` в функции нет)
  - `tests/board.test.mjs:179` — `assert.deepEqual([...core.legalDropTargets('ready')], ['ready', 'blocked', 'cancelled'])`
  - `tests/board.test.mjs:484` — `assert.equal(accepted, 1, \`expected exactly the own-zone drop to be accepted, got ${accepted}\`)`
- **Оценка severity:** major
- **Комментарий:** Обе половины D-12 подтверждены первоисточником. (1) «Не проверяет собственный инвариант» — именно про вход: гварда `placement.zone !== projectTaskZone(placement.exactState)` нет, поэтому несогласованный вход молча «переезжает» в правильную зону (при `zone='backlog'`, `exactState='ready'`, `toZone='ready'` условие `:522` ложно и возвращается `zone:'ready'` — ровно то, что требует починить шаг B-08, `22-STEPS-surface.md:387`). Целевая согласованность при этом проверяется (`:521-539`), так что формулировка «не проверяет собственный инвариант» верна только в смысле «не проверяет инвариант на входе» — как это и уточнено в `22-STEPS-surface.md:56`. (2) `legalDropTargets('ready')` действительно рекламирует `blocked`/`cancelled` и это закреплено тестом `:179`, а write-путь их отвергает: цикл `:459-484` доказывает, что из девяти зон принимается ровно одна — собственная, т.е. отвергаются **все** чужие зоны, а не только `blocked`/`cancelled` (заявленное слабее фактического). Существенная оговорка к severity: продуктовых вызовов у `applyDropIntent` нет (grep по `packages` даёт только объявление и реэкспорт), поэтому противоречие пока латентно, но публичный API и `legalDropTargets` уже экспортированы как контракт для UI.
- **Точность ссылки:** `ref` (01-MASTER-PLAN.md:73 = строка D-12, дословно совпадает с утверждением) точен; но `legalDropTargets` — `packages/core/src/board.ts:161-167`, `applyDropIntent` — `:458-566`. В `packages/contracts/src/board.ts` лежит только словарь (`BoardPlacement:197-225`, `DropIntent:231-249`).

## Якорь A03-2: 10-DECISIONS.md:1110 → packages/contracts/src/board.ts:106-107 и :363-364

- **Вердикт:** ПОДТВЕРЖДЕНО
- **Что проверено:** read `.work/plan-v0.3/10-DECISIONS.md` offset 1090 limit 80 (строка 1110); grep `board\.ts|team\.ts|theme\.ts` по `10-DECISIONS.md` (вторая ссылка якоря живёт в строках 1181 и 1212); read `packages/contracts/src/board.ts` (102-119, 356-381); grep `assigned|executing|TASK_STATES` по `packages/contracts/src/task.ts` (строки 19, 21, 46, 50, 51, 72)
- **Фактическое значение:**
  - `contracts/board.ts:106-107` — `assigned: 'in-progress',` / `executing: 'in-progress',`
  - `10-DECISIONS.md:1110` — «в MyWork контракт попытки уже отделяет `assigned` от `executing` (`packages/contracts/src/board.ts:106-107`), то есть состояние «создана, но не начата» существует…»
  - `contracts/board.ts:363-364` — `/** A human gate passed its deadline. */` / `| 'human-gate-deadline-exceeded'`
- **Оценка severity:** info
- **Комментарий:** Строка `:1110` процитирована в якоре дословно, и `:106-107` действительно две разные записи словаря — два разных состояния, хотя обе отображаются в одну зону `in-progress`. Неточность решения, не якоря: сами состояния объявлены в `packages/contracts/src/task.ts:19,21,50,51` (`TASK_STATES_WITH_ACTIVE_ATTEMPT = ['assigned','executing']`), т.е. «контракт попытки» здесь — словарь зон, а не контракт попытки. Вторая часть якоря (`:363-364`) к строке 1110 отношения не имеет — она цитируется в D14 (`10-DECISIONS.md:1181` и `:1212`), и там процитирована верно: это шестая из семи причин `NEEDS_ATTENTION_REASONS` (`contracts/board.ts:373-381`, длина 7 подтверждена `tests/board.test.mjs:603`).

## Якорь A03-3: 01-MASTER-PLAN.md:299 → packages/contracts/src/board.ts + repo-wide grep

- **Вердикт:** НЕВЕРНАЯ СТРОКА (фактическая строка — `01-MASTER-PLAN.md:311`; отклонение 12 > допуска ±10)
- **Что проверено:** read `01-MASTER-PLAN.md` offset 292 limit 20 (292-311); grep `AutonomyLevel` по `01-MASTER-PLAN.md` → единственное совпадение `:311`; grep `AutonomyLevel|autonomyLevel` по `H:\Repo\DSH-MyWork` → No matches; grep `AutonomyLevel` по `packages` → No matches; grep `SessionLink|autonomy` (регистрозависимо) по репозиторию → единственное совпадение `contracts/src/board.ts:336`; read `.work/plan-v0.3/10-DECISIONS.md` offset 1770 limit 12 (строка 1776, О-3); read `.work/tasks/MW-042.md` (строка 21)
- **Фактическое значение:**
  - `01-MASTER-PLAN.md:311` — «2. `AutonomyLevel`, названный в приёмке MW-042, **в репозитории отсутствует** (0 совпадений) — приёмка неисполнима как написана.»
  - `01-MASTER-PLAN.md:299` — другая строка: «| D13 | Три паттерна (provisioning saga, advisory write scopes, handoff), authority — нет, `ctx.agentTeams` не использовать | …»
- **Оценка severity:** minor
- **Комментарий:** Утверждение по сути верно и проверено независимо: `AutonomyLevel` (и `autonomyLevel`) не встречаются ни в `packages/**`, ни в `tests/**`, ни в `scripts/**` — приёмка `MW-042.md:21` («AutonomyLevel, PlanMutationClass, TaskClaims, BlockerResolutionGate, NeedsAttentionReason и BoardPanelState объявлены в контрактах») неисполнима ровно в части `AutonomyLevel`, что и записано в `10-DECISIONS.md:1776` (О-3). Уточнение к слову «в репозитории»: в `.work/**` (gitignored) слово есть — в самих плановых документах (`01-MASTER-PLAN.md:311`, `10-DECISIONS.md:1776`) и в тексте карточки `MW-042.md:21`, поэтому «0 совпадений» верно только для кода. Дефект якоря — исключительно номер строки: 299 занята строкой таблицы решений D13.

## Якорь A03-4: 01-MASTER-PLAN.md:73 → packages/contracts/src/board.ts (одно поле — в packages/core/src/board.ts)

- **Вердикт:** ПОДТВЕРЖДЕНО (с уточнением по `PlacementChange.fromZone`: у него есть производитель и читатель-тест, но нет продуктового потребителя)
- **Что проверено:** grep `NeedsAttentionReason|NEEDS_ATTENTION_REASONS|subState|fromZone` по репозиторию (23 совпадения); grep `SessionLink` по репозиторию → 1 совпадение (объявление); grep `attention` по `packages`; read `packages/contracts/src/board.ts` (197-225, 336-347, 350-381); read `packages/core/src/board.ts` (1-45, 434-441, 552-565); read `tests/board.test.mjs` (202-232, 600-615); read `tests/boundaries.test.mjs:575`; grep `idempot|dedup|replay` по `packages`
- **Фактическое значение:**
  - `contracts/board.ts:210` — `readonly subState?: string` (единственное вхождение во всём репозитории); `:344` — `readonly active: boolean` при том, что `SessionLink` (`:336`) не упоминается больше нигде
  - `core/board.ts:438` — `readonly fromZone?: BoardZone` / `:561` — `...(intent.fromZone === intent.toZone ? {} : { fromZone: intent.fromZone }),`
  - `contracts/board.ts:356` — `export type NeedsAttentionReason =` (использование — только константа `:373` и два теста)
- **Оценка severity:** major
- **Комментарий:** «Без носителя» подтверждено для трёх из четырёх: `NeedsAttentionReason` объявлен (`:356`) и продублирован константой (`:373`), но ни одного поля-носителя во всём коде нет — ближайшее `mw_needs_attention` в `packages/beads-adapter/src/mapping.ts:62` это имя ярлыка WIP-категории, а не причина, и объявленная инвариантом «`needs-attention` не входит без причины» (`:354`) нигде не поддержана (подтверждает `22-STEPS-surface.md:956`); `BoardPlacement.subState` (`:210`) — буквально одно вхождение в репозитории; `SessionLink.active` (`:344`) мёртв вместе со всем `SessionLink` — интерфейс объявлен один раз и не используется ни в коде, ни в тестах. Четвёртое поле — исключение, и это важно для честности вердикта: `PlacementChange.fromZone` имеет и объявление (`core/board.ts:438`), и производителя (`:561`), и читателя (`tests/board.test.mjs:229` `assert.equal(applied.value.fromZone, undefined, 'a same-zone move is a reorder, not a rezone')`), т.е. «без носителя» для него неверно — верно «без продуктового потребителя» (в v0.3 поле планируется удалить, `22-STEPS-surface.md:276`). «`operationId` игнорируется» подтверждено: `applyDropIntent(..., meta: OperationMeta)` передаёт `meta` только в `ok`/`fail`, `meta.operationId` в `packages/core/src/board.ts` не читается ни разу, механизма дедупликации placement-команд в `packages/**` нет (grep `idempot|dedup|replay` не даёт ни одного попадания в board-путь), а модульный докблок прямо фиксирует «Nothing here reads a clock, generates an id, or touches a store» (`:16-18`); отсутствие таблицы размещений подтверждает `10-DECISIONS.md:233`.

## Якорь A03-5: 10-DECISIONS.md:1142 → packages/contracts/src/team.ts:229-349

- **Вердикт:** НЕВЕРНАЯ СТРОКА (диапазон 229-349 не содержит `Team`)
- **Что проверено:** read `10-DECISIONS.md` offset 1090 limit 80 (строка 1142); read `packages/contracts/src/team.ts` offset 220 limit 135 (220-354) и grep `^export (interface|type|const|function)` по этому файлу (30 объявлений с номерами строк)
- **Фактическое значение:**
  - `10-DECISIONS.md:1142` — «- Контракты: `Attempt` получает write-scope (advisory, не блокировка); `Team`/`AgentInstance` (`packages/contracts/src/team.ts:229-349`) не трогаются.»
  - `team.ts:229` — `export interface AgentIdentity {`; `:335` — `export interface AgentInstance {`; `:349` — `export interface PoolLimits {`; `:390` — `export interface Team {`
- **Оценка severity:** minor
- **Комментарий:** Ссылка `ref` (`10-DECISIONS.md:1142`) точна, цитата дословна, и половина диапазона верна: `AgentInstance` действительно `:335-346`, внутри 229-349 (там же `AgentIdentity:229-254`, `AgentInstanceState:297-311` и списки полей). Но `Team` в указанный диапазон не попадает — он объявлен на `:390-405`, а `:349` открывает `PoolLimits`. Фактический диапазон для названной пары — `team.ts:229-346` + `:390-405` (либо `:229-405`); файл указан верно. Само действие («не трогаются») — намерение плана, из кода не подтверждается и не опровергается (в v0.3 `Attempt` действительно ещё без write-scope: поля нет ни в `packages/contracts/src/attempt.ts`, ни в `claim.ts`).

## Якорь A03-6: 10-DECISIONS.md:1566 → packages/contracts/src/theme.ts

- **Вердикт:** ПОДТВЕРЖДЕНО
- **Что проверено:** read `10-DECISIONS.md` offset 1540 limit 50 (1540-1589) + grep `^## D\d+` по `10-DECISIONS.md` (D18 открывается на `:1477`, D19 — на `:1576`, значит `:1566` внутри D18); read `packages/contracts/src/theme.ts` целиком (114 строк); `Get-ChildItem packages -Directory` (12 пакетов, `web` отсутствует)
- **Фактическое значение:**
  - `10-DECISIONS.md:1566` — «- Контракты: `ThemeCapability`/`SurfacePolicy` (`packages/contracts/src/theme.ts`) переезжают в UI-слой вместе с layout-константами зон (D02).»
  - `theme.ts:42` — `export interface ThemeCapability {`; `:96` — `export interface SurfacePolicy {`; `:4-5` — «DSH exposes its own `--dsw-*` token set; MyWork bridges those tokens to `--mw-*` and never ships a palette of its own.»
- **Оценка severity:** info
- **Комментарий:** Строка, файл и оба названных символа совпадают; строка действительно лежит внутри D18 (`:1477-1575`). Смежная ссылка на «layout-константы зон (D02)» тоже корректна: `BOARD_VIEW_MODES`/`BOARD_STRIP_MAX_WIDTH_PX` — `packages/contracts/src/board.ts:126-132`, а их переезд в UI-слой записан в D02 (`10-DECISIONS.md:275`). Плановая часть («переезжают в UI-слой») — намерение, а не факт: пакета `packages/web` в репозитории нет (12 каталогов), проверять нечего. Токенный тезис («своей палитры нет, только мост `--dsw-*` → `--mw-*`») подтверждён докблоком `theme.ts:4-6` и полным отсутствием hex-литералов в модуле.
