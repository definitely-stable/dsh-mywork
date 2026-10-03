# Задачи

Версия плана: v0.2, planRevision 2. Архитектура: `.work/architecture/DSH-My-Work-Architecture-v0.1.md`, решения: `.work/architecture/DSH-My-Work-Architecture-v0.2-decisions.md`.

Карточки со статусом `superseded` не запускаются: их роль передана другим карточкам, и в файле стоит запрет на исполнение.

## Что изменилось в v0.2

- Добавлены MW-042…MW-055: контракты доски и проекции, Idea Bank, workflow engine, work types и finish criteria, обсуждение и steering, backend проекции, четыре UI-карточки, мастер импорта и приёмка доски.
- Пересмотрены MW-010 (Beads capability-aware adapter), MW-011 (staged plan mutation), MW-029 (board-поверхность Application API), MW-036 (редактор workflow вынесен), MW-037, MW-041.
- Сняты MW-027 и MW-035: их роль передана board-карточкам.
<!-- generated:begin -->
lastSyncedRevision: 325

## 00-foundation

| ID | Задача | Зависимости | Статус |
|---|---|---|---|
| [MW-001](MW-001.md) | Проверить целевой DSH и контракты интеграций | — | planned |
| [MW-002](MW-002.md) | Создать минимальный каркас Cordis-плагина | MW-001 | planned |
| [MW-003](MW-003.md) | Определить доменные контракты и переходы состояний | MW-002 | planned |
| [MW-004](MW-004.md) | Добавить durable SQLite state и outbox/inbox | MW-003 | planned |
| [MW-005](MW-005.md) | Создать Adapter SDK, registry и conformance основу | MW-003 | planned |
| [MW-006](MW-006.md) | Реализовать конфигурацию, Team и неизменяемые revisions | MW-004, MW-005 | planned |
| [MW-007](MW-007.md) | Обеспечить runtime permissions и границы workspace | MW-005, MW-006 | planned |
| [MW-008](MW-008.md) | Добавить Artifact Store и append-only Audit | MW-004, MW-007 | planned |

## 01-runtime

| ID | Задача | Зависимости | Статус |
|---|---|---|---|
| [MW-009](MW-009.md) | Реализовать Controller lease, epoch и lifecycle | MW-004, MW-008 | planned |
| [MW-010](MW-010.md) | Реализовать Beads TaskGraph adapter с capability negotiation | MW-005, MW-009 | planned |
| [MW-011](MW-011.md) | Валидировать Plan Mutation, staged activation и replanning | MW-010 | planned |
| [MW-012](MW-012.md) | Реализовать claim saga, Attempts, leases и fences | MW-009, MW-010, MW-011 | planned |
| [MW-013](MW-013.md) | Добавить model routing и бюджетный admission | MW-005, MW-006, MW-007 | planned |
| [MW-014](MW-014.md) | Реализовать детерминированный Scheduler и pools | MW-012, MW-013 | planned |
| [MW-015](MW-015.md) | Реализовать DSH AgentRuntime и Session adapters | MW-005, MW-007, MW-013 | planned |

## 01b-board

| ID | Задача | Зависимости | Статус |
|---|---|---|---|
| [MW-042](MW-042.md) | Определить board-контракты, проекцию зон и placement v2 | MW-003 | planned |

## 02-context

| ID | Задача | Зависимости | Статус |
|---|---|---|---|
| [MW-016](MW-016.md) | Построить Context Fabric и snapshots | MW-005, MW-006, MW-008, MW-013 | planned |
| [MW-017](MW-017.md) | Реализовать Skill Registry и Context Provider | MW-006, MW-016 | planned |
| [MW-018](MW-018.md) | Реализовать Memory Fabric и Native Memory | MW-005, MW-008, MW-016 | planned |
| [MW-019](MW-019.md) | Подключить один внешний Memory adapter | MW-018 | planned |
| [MW-020](MW-020.md) | Реализовать checkpoint, session rollover и context pressure | MW-008, MW-015, MW-016 | planned |

## 03-execution

| ID | Задача | Зависимости | Статус |
|---|---|---|---|
| [MW-021](MW-021.md) | Реализовать изоляцию Git worktrees | MW-008, MW-012 | planned |
| [MW-022](MW-022.md) | Связать Worker execution от admission до результата | MW-014, MW-015, MW-016, MW-017, MW-018, MW-020, MW-021 | planned |
| [MW-023](MW-023.md) | Добавить детерминированные verification gates | MW-022 | planned |
| [MW-024](MW-024.md) | Реализовать независимый Review и reject flow | MW-015, MW-020, MW-023 | planned |
| [MW-025](MW-025.md) | Реализовать Integrator и завершение TaskGraph | MW-010, MW-021, MW-024 | planned |
| [MW-026](MW-026.md) | Подключить отдельного Task Setter к DSH | MW-011, MW-015, MW-016 | planned |

## 04-control

| ID | Задача | Зависимости | Статус |
|---|---|---|---|
| [MW-027](MW-027.md) | Реализовать Task Board production и Null adapters | MW-005, MW-010, MW-025 | superseded → MW-042, MW-047, MW-048 |
| [MW-028](MW-028.md) | Поддержать Embedded и Resident Controller | MW-009, MW-014, MW-022, MW-025 | planned |
| [MW-029](MW-029.md) | Открыть Application API, HTTP/SSE и CLI | MW-018, MW-026, MW-028, MW-043, MW-047 | planned |
| [MW-030](MW-030.md) | Добавить human gates, pause/cancel/retry/reassign | MW-007, MW-012, MW-020, MW-029 | planned |
| [MW-031](MW-031.md) | Реализовать recovery и обнаружение застрявшей работы | MW-012, MW-014, MW-020, MW-025, MW-030 | planned |

## 04b-board

| ID | Задача | Зависимости | Статус |
|---|---|---|---|
| [MW-043](MW-043.md) | Реализовать Idea Bank, быструю задачу и минимальный approved-plan flow | MW-042, MW-011, MW-026 | planned |
| [MW-044](MW-044.md) | Реализовать workflow engine поверх resident controller | MW-011, MW-014, MW-022, MW-025 | planned |
| [MW-045](MW-045.md) | Реализовать work types, finish criteria и интеграторы без Git | MW-044, MW-023, MW-025 | planned |
| [MW-046](MW-046.md) | Реализовать обсуждение карточки и безопасный steering активной попытки | MW-012, MW-022, MW-030 | planned |
| [MW-047](MW-047.md) | Реализовать backend проекции доски: snapshot, SSE, degraded, Null adapter | MW-042, MW-010, MW-011, MW-025 | planned |

## 05-learning

| ID | Задача | Зависимости | Статус |
|---|---|---|---|
| [MW-032](MW-032.md) | Добавить Fast Role Learner с bounded candidates | MW-017, MW-018, MW-024 | planned |
| [MW-033](MW-033.md) | Реализовать Sleep Optimizer, curator и promotion | MW-006, MW-013, MW-032 | planned |
| [MW-034](MW-034.md) | Добавить token/context/cost metrics и observability | MW-013, MW-016, MW-020, MW-025, MW-032 | planned |

## 06-ui

| ID | Задача | Зависимости | Статус |
|---|---|---|---|
| [MW-035](MW-035.md) | Создать My Work UI: Overview и Tasks | MW-027, MW-029, MW-034 | superseded → MW-048, MW-049, MW-050, MW-053 |
| [MW-036](MW-036.md) | Создать Team Work, Roles и Settings | MW-006, MW-029, MW-030, MW-048 | planned |
| [MW-037](MW-037.md) | Создать Role Lab, Activity и Audit UI | MW-033, MW-034, MW-048 | planned |
| [MW-048](MW-048.md) | Создать @dsh-mywork/web: пакет, client bundle, native slots, theme bridge | MW-029 | planned |
| [MW-049](MW-049.md) | Реализовать доску: сетка 3x3, горизонтальная полоса, зоны, карточка | MW-048, MW-042 | planned |
| [MW-050](MW-050.md) | Реализовать взаимодействие с карточкой: выбор, bulk, клавиатура, DnD, detail panel | MW-049, MW-046 | planned |
| [MW-051](MW-051.md) | Создать визуальный редактор workflow и декларативные правила | MW-044, MW-045, MW-048 | planned |
| [MW-052](MW-052.md) | Реализовать graph/dependency view, calendar и опциональный timeline | MW-049, MW-042 | planned |
| [MW-053](MW-053.md) | Проверить тему, доступность и режимы раскладки | MW-050 | planned |

## 07-acceptance

| ID | Задача | Зависимости | Статус |
|---|---|---|---|
| [MW-038](MW-038.md) | Добавить Doctor и полный adapter conformance | MW-010, MW-015, MW-019, MW-027, MW-029, MW-031 | planned |
| [MW-039](MW-039.md) | Проверить invariants, crash recovery и security | MW-007, MW-024, MW-025, MW-030, MW-031, MW-033, MW-038 | planned |
| [MW-040](MW-040.md) | Завершить upgrade, export/import и repair | MW-004, MW-039 | planned |
| [MW-041](MW-041.md) | Проверить и упаковать полный operational v0.1 | MW-028, MW-036, MW-037, MW-038, MW-039, MW-040, MW-055 | planned |
| [MW-055](MW-055.md) | Провести приёмку доски и верификацию миграции | MW-053, MW-054, MW-031, MW-038, MW-039 | planned |

## 07-migration

| ID | Задача | Зависимости | Статус |
|---|---|---|---|
| [MW-054](MW-054.md) | Реализовать DSH-web compatibility adapter и мастер импорта | MW-047, MW-029, MW-030 | planned |
<!-- generated:end -->
## Правила приёмки

### D19 · Карточка не становится `done` при `failed`-исполнении

Карточка переводится в `done` **только если** все её исполнения имеют `result = succeeded`. При наличии `failed` карточка остаётся `todo` либо переводится в `failed`, а в отчёте появляется строка-обоснование с `sessionId` упавшего прогона.

Уточнение по факту (F-09, `.work/plan-v0.3/evidence/foundation-09-done-failed.md`): у падений, которые произошли **до создания сессии** (отказ `workspace not found` за 7–16 мс), `sessionId` не существует. В этом случае строка-обоснование обязана нести `id` упавшего исполнения, длительность и текст ошибки вместо `sessionId`.

Правило применяется **вперёд**. Ретроспективный пересмотр не делается: **19 `done`-карточек не переоткрываются**, даже если у них есть `failed`-исполнение (D19, решает владелец). Инвентаризация на момент F-09: **7** таких карточек — MW-003, MW-004, MW-005, MW-006, MW-007, MW-008, MW-043; по каждой строка-обоснование лежит в evidence F-09.

Машинная проверка (контракт для F-27): для каждой карточки `status = done` → `executions.every(e => e.result !== 'failed')`.

## Критический путь

```text
MW-009 → MW-010 → MW-011 → MW-047 → MW-029 → MW-048 → MW-049 → MW-050 → MW-053 ─┐
                                                                                  ├→ MW-055 → MW-041
MW-042 (← MW-003) ────────────────────────────────────────────────────────────────┤
MW-054 (← MW-047, MW-029, MW-030) ────────────────────────────────────────────────┘
MW-044 (← MW-011, MW-014, MW-022, MW-025) → MW-045 → MW-051
MW-046 (← MW-012, MW-022, MW-030) → MW-050
MW-052 (← MW-049, MW-042)
```

Не запускать зависимые карточки одним залпом. Перед каждым запуском проверять отчёт каждой зависимости, а не колонку доски.
