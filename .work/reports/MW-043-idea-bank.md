# MW-043 — Idea Bank, быстрая задача и минимальный approved-plan flow

**Статус: BLOCKED.**

Причина: из трёх объявленных зависимостей наличны артефакты только **MW-042**. **MW-011
(Plan Mutation, staged activation, replanning) и MW-026 (Task Setter, Planner) не реализованы** —
ни в исходниках, ни в отчётах, ни в истории git. Объём MW-043 требует контракта `PlanMutation` и
роли Planner как его источника; без них работа упирается ровно в то, что карточка запрещает —
«не выдумывай fallback».

Карточка предписывает: «Проверь их результаты по исходникам и отчётам; **если они не приняты,
остановись с BLOCKED и точной причиной**». Это исполнено. Владелец подтвердил выбор
«BLOCKED: остановиться и написать отчёт с точной причиной» (см. §6).

Реализация не начиналась. Ни один файл исходников, тестов, карточек и леджера этой карточкой не
изменён; base SHA тот же, что и до запуска.

---

## 1. Проверка зависимостей

Дата прогона: **2026-09-18** (по mtime артефактов и `git log`). Base SHA: `fbee7a0b1d0703b5b2bdd581c05e81c3c19a2f7e`.

### 1.1 Сводка

| Зависимость | Отчёт | Исходники | Вердикт |
|---|---|---|---|
| **MW-042** board-контракты, проекция зон, placement v2 | `READY_FOR_REVIEW` (независимого ревью не было) | наличны, собираются, тесты зелёные | **предусловие пройдено** |
| **MW-011** Plan Mutation, staged activation, replanning | **отчёта нет** | **отсутствуют** | **НЕ ВЫПОЛНЕНА** |
| **MW-026** Task Setter / Planner к DSH | **отчёта нет** | **отсутствуют** | **НЕ ВЫПОЛНЕНА** |

### 1.2 Команды проверки

| Команда | Exit | Наблюдение |
|---|---|---|
| `Test-Path .work/reports/MW-011-plan-mutations.md` | — | `ABSENT` |
| `Test-Path .work/reports/MW-026-task-setter.md` | — | `ABSENT` |
| `Test-Path .work/reports/MW-042-board-projection.md` | — | `PRESENT` (17 543 байта, 18.09.2026 23:45:59) |
| `Get-ChildItem .work\reports -Filter '*.md'` | 0 | 12 отчётов; все 12 — `MW-0*.md`; для MW-010…MW-041, кроме MW-042, отчётов нет |
| `Select-String -Path packages\*\src\*.ts,tests\*.mjs -Pattern '\bPlanMutation\b','\bTaskClaims\b','\bReplanCommand\b','\bTaskSetter\b','\bPlanMutationClass\b','\bAutonomyLevel\b','\bBlockerResolutionGate\b'` | 0 | **IDENTIFIER_MATCHES = 0** — ни одного из этих объявлений в дереве нет |
| `Select-String ... -Pattern 'planner'` | 0 | 9 совпадений, **все — проза или уже существующий код**: `contracts/src/artifact.ts:48,49,65` (`'planner-dag'` и его комментарий), `contracts/src/operation.ts:62,63,86` (`PLANNER_SCOPE_DENIED`), `contracts/src/config.ts:150` и `contracts/src/team.ts:376` (комментарий про пул `planners`), `tests/events.test.mjs:179` (код ошибки в списке). Реализации Planner нет |
| `git log --all --oneline --grep='MW-011' --grep='MW-026' --grep='plan mutation' --grep='task setter' -i` | 0 | пустой вывод — в истории нет ни одного коммита по этим карточкам |
| `Get-ChildItem packages -Directory -Name` | 0 | `adapter-sdk, contracts, controller, core, evidence, lease, storage` — пакета Plan Mutation / Task Setter нет |
| `pnpm run typecheck` | **0** | 7 из 8 проектов, все `Done` |
| `pnpm run build` | **0** | `✔ Build complete`, включая `packages/controller` |
| `pnpm run test` | **1** | `# tests 231`, `# pass 230`, `# fail 1` — падение **чужое**, см. §1.4 |

### 1.3 MW-042 — предусловие пройдено, с оговоркой

Артефакты MW-042 наличны: `packages/contracts/src/{board,theme}.ts`,
`packages/core/src/{board,theme}.ts`, `tests/board.test.mjs`, расширения
`authority/events/operation/revisions/task/index`. Пакеты собираются (`pnpm run build` exit 0),
и в прогоне `pnpm run test` ни один тест `tests/board.test.mjs` не падает — единственное падение
приходится на `tests/adapters.test.mjs` и принадлежит чужой работе (§1.4). Это подтверждает, что
артефакты MW-042 работоспособны, но **не** является его приёмкой: приёмка — за владельцем.

Оговорки:

1. **Формальной приёмки владельца нет.** Отчёт `READY_FOR_REVIEW`; независимого ревью не было
   (отчёт, §7: «Независимого ревью не было; self-review приёмкой не считается»). Работа MW-043
   остановлена не из-за MW-042, поэтому эта оговорка на исход не влияет.
2. **Я не перепроверял acceptance MW-042 пункт за пунктом** (16/16 состояний, единственность
   размещения, `ORDER_RENUMBER_REQUIRED`, `STALE_COLUMN_REVISION`, отсутствие hex-литералов) —
   это работа ревьюера MW-042, а не MW-043. Проверено ровно то, что нужно для gate: артефакты
   существуют, собираются и их тесты зелёные.
3. **MW-042 сам оставил открытые вопросы ревьюеру** (§5.1 отчёта): где должны жить
   `AutonomyLevel`, `PlanMutationClass`, `TaskClaims`, `BlockerResolutionGate`. Отчёт MW-042 §5.1
   прямо пишет, что эти типы объявлены в контрактах, но модули `workflow.ts`, `idea.ts`,
   `import.ts` **не созданы** и принадлежат MW-044, MW-043 и MW-054. Это подтверждено проверкой
   §1.2: `IDENTIFIER_MATCHES = 0`.

### 1.4 Чужое падение в общем дереве (не дефект MW-043, не дефект MW-042)

`pnpm run test` даёт `fail 1`:

```text
✖ core and contracts keep no provider-specific branch (tests\adapters.test.mjs:382)
  AssertionError: H:\Repo\DSH-MyWork\packages\core\src\index.ts must not branch on "beads"
```

Причина — **незакоммиченная работа параллельной сессии по MW-010**, лежащая в общем дереве:

- `git status --short` показывает `?? packages/contracts/src/taskgraph.ts`, `?? packages/core/src/taskgraph.ts`;
- `packages/core/src/taskgraph.ts` существует (312 строк), но `git diff` по `packages/core/src/index.ts`
  показывает, что его реэкспорт добавлен **незакоммиченным** блоком (43 добавленные строки,
  строки 285–301 итогового файла экспортируют `BEADS_BUILTIN_STATUSES`, `beadsStatusOf`,
  `priorityToBeads` и т.д.);
- `git log -1 -- packages/core/src/index.ts` → `962f696`, то есть на коммите `fbee7a0` этих
  строк нет: добавлены после него и не закоммичены.

Это ровно тот случай, который README и карточка называют «не меняй чужую незавершённую работу»:
**эта карточка её не касалась и не исправляла**. Падение фиксируется как фоновое состояние
дерева, чтобы никто не приписал его MW-043.

**Дерево двигалось во время прогона.** `git status --short` на baseline (начало прогона) и на
конец прогона различаются: в конце добавился `?? packages/beads-adapter/` (9 файлов, mtime
19.09.2026 00:36:01), которого на baseline не было, — параллельная сессия продолжает MW-010 и
пишет в общий tree. Ключевые факты gate от этого не изменились и перепроверены **после** появления
каталога:

| Повторная проверка на конец прогона | Результат |
|---|---|
| `IDENTIFIER_MATCHES` по 7 идентификаторам Planner/PlanMutation | **0** |
| Отчётов в `.work/reports` | 12, из них `MW-011*` и `MW-026*` — по-прежнему нет |
| `packages/idea` существует | `False` |
| Файлы `idea.ts` / `idea.test.mjs` в `packages` и `tests` | нет ни одного |
| Base SHA | `fbee7a0b…` — не сдвинулся (чужая работа не закоммичена) |

То есть ни MW-011, ни MW-026 не появились в дереве за время прогона, и BLOCKED не устарел.

### 1.5 Почему MW-011 и MW-026 блокируют именно этот объём

Объём MW-043 сформулирован через артефакты, которых нет:

| Требование карточки MW-043 | Чем оно должно быть поддержано | Состояние |
|---|---|---|
| «Разработать план» (**PlanMutation через Task Setter**) | контракт `PlanMutation`, применение через `TaskGraphPort.mutatePlan` (§10.2, §11), роль Planner и Task Setter | **нет ни контракта, ни реализации** |
| «План без claims помечается как неавтоутверждаемый под L3» | `TaskClaims`, `PlanMutationClass`, `AutonomyLevel`, предикат автоутверждения ADR026 | **нет ни одного из объявлений** (`IDENTIFIER_MATCHES = 0`) |
| «Быстрая задача проходит минимальный approved-plan flow» | путь утверждения плана Task Setter'ом | **нет** |
| «Planner обязан выдавать TaskClaims для каждой новой задачи» | роль `planner`, `planner-dag`, read-only сессия (§5.1) | **нет** |

`contracts/src/artifact.ts:48-49,65` уже объявляет `ArtifactKind = 'planner-dag'`, а
`operation.ts` — код `PLANNER_SCOPE_DENIED`. Это ровно та же ситуация, которую описала v0.2 §5.7
для `needs-attention`: **объявленный словарь без единого писателя**. MW-043 не может закрыть эту
дыру, не выдумав контракт Plan Mutation на месте MW-011.

Именно поэтому выбран BLOCKED, а не «реализовать вокруг»: спроектированный здесь на ходу
`PlanMutation` либо не совпадёт с тем, что выдаст MW-011, либо заставит MW-011 его принять —
и тогда работа MW-043 окажется переделкой, а не основой (см. режим `execute` навыка
`evidence-gated-delivery`: «a card that silently proceeds on an unaccepted dependency produces
work the owner has to discard»).

---

## 2. Сделано

**Ничего из реализации.** Ни одного файла не создано и не изменено.

Выполнена только работа, которую карточка требует **до** реализации:

1. Прочитаны `.work/README.md`, `.work/EXECUTION-PLAN.md`, `.work/tasks/MW-043.md`, `MW-042.md`,
   `MW-011.md`, `MW-026.md`; в `tasks.json` выгружены определения MW-042/MW-011/MW-026/MW-043
   (`title`, `phase`, `dependsOn`, `sections`, `scope`, `acceptance`).
2. Зафиксирован baseline: `git rev-parse HEAD`, `git status --short`, mtime отчётов.
3. Прочитана архитектура по анкорам карточки — §8 (строка 407), §9 (строка 440), §10 (строки
   476–557), §18.1–18.2 (строки 963–1013), §42 (строка 2253) — и **только** ADR019 (строка 173)
   и ADR024 (строка 284) из файла решений, плюс точечно §5.11 (строка 581), §5.18 (строка 625),
   §5.7 (строка 549), §5.8 (строка 557), ADR017 (строка 105) и ADR018 (строка 133), на которые
   ссылаются эти разделы.
4. Прочитаны исходники, задающие форму будущей сущности: `contracts/src/{authority,operation,
   events,ids,revisions,task,board,audit}.ts`, `core/src/{authority,guards,task,board,graph,
   index}.ts`, `storage/src/{migrations,store,index,payload}.ts`, `packages/evidence/src/{schema,
   store,audit}.ts`, `packages/lease/src/schema.ts`, `tests/lib/fixtures.mjs`,
   `tests/{board,storage,boundaries}.test.mjs`.
5. Спрогнозирован и согласован с владельцем способ размещения будущей сущности (см. §6): новый
   пакет `packages/idea` по образцу `packages/evidence`.

## 3. Изменённые файлы

**Нет.** Единственный записанный файл — этот отчёт (`.work/reports/MW-043-idea-bank.md`),
рабочая папка `.work/` исключена из Git правилом `/.work/`.

Отслеживаемые файлы этой карточкой не сдвинуты: `git rev-parse HEAD` на начало и на конец
прогона — один и тот же `fbee7a0b1d0703b5b2bdd581c05e81c3c19a2f7e`, а `git diff --stat` даёт
те же 17 файлов `+595/−19`, что и до запуска. Разница в `git status` между началом и концом
прогона — **чужая**: параллельная сессия MW-010 добавила незакоммиченный `packages/beads-adapter/`
(см. §1.4).

## 4. Команды и exit codes

| Команда | Exit | Наблюдение |
|---|---|---|
| `git rev-parse HEAD` | 0 | `fbee7a0b1d0703b5b2bdd581c05e81c3c19a2f7e` |
| `git status --short` | 0 | 17 `M` + `??`; чужие in-flight: `packages/lease/`, `packages/evidence/`, `packages/beads-adapter/`, `contracts/src/{lease,security,artifact,audit,taskgraph}.ts`, `core/src/{security,taskgraph}.ts`, `tests/{lease,evidence,security}.test.mjs` |
| `Test-Path` для трёх отчётов зависимостей | — | MW-011 `ABSENT`, MW-026 `ABSENT`, MW-042 `PRESENT` |
| `Select-String` по 7 идентификаторам Planner/PlanMutation | 0 | `IDENTIFIER_MATCHES = 0` |
| `git log --all --grep` по MW-011/MW-026 | 0 | пусто |
| `pnpm run typecheck` | **0** | 7/8 проектов `Done` |
| `pnpm run build` | **0** | `Build complete` |
| `pnpm run test` | **1** | `# tests 231`, `# pass 230`, `# fail 1` — чужое падение, §1.4 |

Ни `push`, ни `merge`, ни `publish`, ни `release` не выполнялись. `commit` не создавался (не
поручался). Живой DSH profile, чужие проекты и доска разработки не тронуты. Субагенты, платные
LLM-пробы и другие модели не запускались.

## 5. Evidence по приёмке

Ни один пункт приёмки не проверялся, потому что ни один не реализован. Для полноты — почему
именно каждый невыполним без MW-011/MW-026:

| Пункт приёмки MW-043 | Блокирующая зависимость |
|---|---|
| admission для IdeaId → `UNSCHEDULABLE`, записей нет | не блокируется (можно сделать на `core/src/task.ts` + будущий admission); отложено целиком вместе с карточкой |
| «Разработать план» создаёт PlanMutation и не создаёт attempt | **MW-011** (контракт `PlanMutation`) + **MW-026** (кто его производит) |
| быстрая задача без утверждённого плана отвергается типизированной ошибкой | **MW-026** (утверждение плана как отдельный путь) |
| устаревший `expectedIdeaRevision` → `STALE_REVISION` | не блокируется (`core/src/guards.ts:assertRevision` уже есть) |
| повтор promote с тем же `operationId` идемпотентен | не блокируется |
| promote пишет строку audit | не блокируется частично: таблица `audit_events` (`packages/evidence/src/schema.ts:75`) не имеет колонки под `ideaId`/`planMutationId`, а `AuditEntry` (`contracts/src/audit.ts:89`) — под эти ссылки; расширение словаря `AuditEventType` нужно проектировать вместе с идеей |
| план без claims → неавтоутверждаемый под L3 | **MW-011** (классификатор) + **MW-026** (`TaskClaims` как выход Planner); в дереве нет ни `TaskClaims`, ни `AutonomyLevel`, ни `PlanMutationClass` |
| двойной promote → две записи и непересекающиеся наборы задач | не блокируется |
| история promote-ов append-only | не блокируется |
| dropped-идея не промоутится | не блокируется |

Иначе говоря: **4 пункта из 10 не блокированы** и могли бы быть реализованы в урезанном объёме,
но 6 остальных — включая центральные «Разработать план» и claims-гейт — требуют отсутствующих
зависимостей. Владелец выбрал не резать объём (см. §6), поэтому не реализовано ничего.

## 6. Вопрос владельцу и его решение

Задан **один** batched-вопрос до начала реализации (карточка: «При неоднозначности поведения,
architecture или security задай пользователю короткий вопрос; не выдумывай fallback»).

**Вопрос 1 — gate зависимостей.** Констатировано: MW-011 и MW-026 не реализованы.
Предложены три варианта. **Выбран: «BLOCKED: остановиться и написать отчёт с точной причиной».**

**Вопрос 2 — размещение сущности Idea.** В дереве нет слоя доменных репозиториев: есть kernel
(`packages/storage`) и слои поверх него со своими миграциями (`packages/evidence` — v2/v3,
`packages/lease` — v4). Предложены три варианта.
**Выбран: «Новый пакет `packages/idea` по образцу `packages/evidence`»** — своя миграция
`idea-bank` (следующий свободный номер **v5**), STRICT-таблицы `ideas` и `idea_promotions`,
append-only триггеры на историю promote-ов, репозиторий поверх `SqlExecutor`.

Решение по вопросу 2 сохранено здесь как вход для следующего прогона; в этом прогоне оно не
применялось, поскольку реализация не начиналась.

## 7. Ограничения и что осталось за рамками

1. **Реализация не начата осознанно.** Это не недоделка, а исполнение gate-правила карточки.
2. **MW-042 формально не принят** (нет независимого ревью). Он не был причиной остановки.
3. **Открытый вопрос MW-042 §5.1 остаётся открытым**: где должны жить `AutonomyLevel`,
   `PlanMutationClass`, `TaskClaims`, `BlockerResolutionGate` — в `workflow.ts` (как решила
   v0.2 §5.18) или иначе. MW-043 без этого решения не может объявить claims-гейт
   непротиворечиво, поэтому вопрос стоит закрыть **до** повторного запуска MW-043.
4. **Словарь audit не покрывает promote.** `AuditEventType` (`contracts/src/audit.ts:30-53`) и
   `AUDIT_EVENT_TYPES` не содержат типа для promote идеи; таблица `audit_events`
   (`packages/evidence/src/schema.ts:75-88`) не имеет колонок `idea_id`/`plan_mutation_id`.
   Пункт приёмки «Promote пишет строку audit» требует спроектированного расширения — это
   решение, влияющее на контракт `@dsh-mywork/evidence`, и его лучше принять вместе с MW-011
   (та же таблица нужна для `plan.mutation.applied` из ADR024).
5. **Чужое падение `tests/adapters.test.mjs:382`** в общем дереве принадлежит незакоммиченной
   работе MW-010. MW-043 его не касалась; чинить его — не в объёме этой карточки.
6. Коммит не создавался, не поручался. Push/merge/publish не выполнялись.
7. Владелец карточки сам указывает (§5.18, §10.1 EXECUTION-PLAN): «Колонка «Готово» сама по себе
   не доказывает приёмку». Состояние MW-011/MW-026 проверено по исходникам и истории git, а не по
   статусу на доске, — именно поэтому расхождение и обнаружилось.

## 8. Как воспроизвести

```powershell
Set-Location H:\Repo\DSH-MyWork
git rev-parse HEAD                                            # fbee7a0b1d0703b5b2bdd581c05e81c3c19a2f7e
Test-Path .work/reports/MW-011-plan-mutations.md              # False -> ABSENT
Test-Path .work/reports/MW-026-task-setter.md                 # False -> ABSENT
Test-Path .work/reports/MW-042-board-projection.md            # True  -> PRESENT

# Ключевая проверка: объявлений Plan Mutation / Planner в дереве нет
Get-ChildItem packages\*\src, tests, scripts -Recurse -File -Include *.ts,*.mjs |
  Select-String -Pattern '\bPlanMutation\b','\bTaskClaims\b','\bReplanCommand\b','\bTaskSetter\b','\bPlanMutationClass\b','\bAutonomyLevel\b','\bBlockerResolutionGate\b'
# -> 0 совпадений

git log --all --oneline --grep='MW-011' --grep='MW-026' -i  # -> пусто
pnpm run typecheck                                          # exit 0
pnpm run build                                              # exit 0
pnpm run test                                               # exit 1, 230/231 (чужое падение, §1.4)
```

## 9. Что нужно, чтобы разблокировать

По убыванию приоритета:

1. **Выполнить MW-011** (`contracts/src/workflow.ts` + `core` + путь применения через
   `TaskGraphPort.mutatePlan`), затем **MW-026** (Task Setter и Planner, `planner` из реестра
   ролей, `planner-dag`, read-only сессия).
2. **Закрыть вопрос MW-042 §5.1** о месте `AutonomyLevel` / `PlanMutationClass` / `TaskClaims` /
   `BlockerResolutionGate`, чтобы MW-043 объявил claims-гейт против уже принятого контракта.
3. **Решить расширение словаря и схемы audit** под `idea.promoted` и `plan.mutation.applied`.
4. После этого MW-043 запускается заново; решение по размещению (`packages/idea`, миграция v5,
   образец `packages/evidence`) уже принято и лежит в §6 — повторно спрашивать не нужно.
