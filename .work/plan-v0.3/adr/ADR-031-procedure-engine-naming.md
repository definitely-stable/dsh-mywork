# ADR-031. MyWork procedure engine: имя, граница с `ctx.workflowEngine`, запрет регистрации

- **Статус:** проект (требует утверждения владельца)
- **Дата:** 2026-09-26
- **Решает:** владелец (рекомендация — `decision-desk`, решение D03)
- **Дополняет:** ADR020 (один resident scheduler и один workflow engine) — по существу; **меняет словарь**

## Контекст

ADR020 требует: один resident controller владеет **и** admission, **и** workflow-движком; движок **просит** admission и никогда не адмитит сам; отдельный scheduler для доски не создаётся.

Одновременно платформа DSH допускает **один** `ctx.workflowEngine` на контекст. Его контракт — единственный метод `abstract start(request: WorkflowStartRequest): WorkflowRun`, а сам «workflow» платформы — это **модельно-написанный скрипт с субагентами**: `WorkflowMeta { name, description, whenToUse?, phases? }`, фазы — «progress vocabulary only — phases group agents in observers/UIs; they impose no execution structure», `WorkflowRunId`, закрытый `WorkflowStopReason = 'completed' | 'cancelled' | 'error'` (`packages\workflow\workflow\lib\types\types.d.ts:11-17,22-31,39-48,50-55`).

MyWork-движок — противоположность: декларативный, валидируемый, без escape hatch (ADR020 и §6 K4 отчёта: «запрет shell/code, L2 по умолчанию»).

Пока движок не реализован, это спор о словах: `packages\contracts\src\workflow.ts:9` прямо говорит, что «the declarative workflow revision itself is added by the workflow-engine card» — то есть типа ещё нет. После реализации это два «workflow» в одном профиле, причём **оба доступны агенту**: платформенный — инструментом `workflow`, MyWork — своим.

## Решение

1. **Домен MyWork переименовывается в `procedure`**: `packages/contracts/src/workflow.ts` → `packages/contracts/src/procedure.ts`; будущий тип ревизии — `ProcedureRevision`; движок — «procedure engine».
2. **MyWork-движок НЕ регистрируется в `ctx.workflowEngine`** — ни как реализация, ни как потребитель. Платформенный шов остаётся платформенным.
3. **Граница формулируется одной фразой и проверяется одной командой:** MyWork-`procedure` не упоминает `workflowEngine` ни в одном пакете; проверка — `grep -rn "workflowEngine" packages/` → пусто.
4. **ADR020 остаётся в силе по существу:** один resident controller владеет admission и движком; движок просит admission и не адмитит сам; пауза admission — один механизм для staged plan mutation и ручной паузы procedure.
5. **Существующие контракты переезжают без изменения содержимого:** `PlanMutationClass` (`workflow.ts:24`), `BlockerResolutionAction` (`:49`), `BlockerResolutionDecision` (`:70`), `BlockerResolutionGate` (`:107`), `BlockerGateDependent` (`:133`), `BlockerGateObservation` (`:143`) — они про plan mutation и блокеры, а не про движок.

## Отклонённые альтернативы

| Альтернатива | Почему отклонена |
|---|---|
| **Оставить имя `workflow`, не регистрироваться в шве** | Сегодня экономит ноль строк; завтра даёт расхождение имён в двух ADR и двух карточках плюс путаницу у агента, которому доступны оба движка одновременно. Коллизия видна в каталоге Host-сервисов уже сейчас |
| **Переименовать в `pipeline`** | `pipeline` уже занят внутри MyWork: «конвейер исполнения» — это MW-021…MW-026 (`00-RECON.md:98`). Та же болезнь, от которой лечимся, но внутри проекта |
| **Сделать MyWork-движок реализацией `ctx.workflowEngine`** | Платформенный шов — единственный `start()` над **чужим** скриптом; это требует исполнять модельно-написанный код, то есть отказаться от валидации — от самого свойства, ради которого движок вводится. Плюс прямо запрещено отчётом (§10, «Что НЕ делать») |
| **Не решать до реализации движка** | Решение будет принято после того, как ADR и карточки закрепят имя; цена переименования вырастет в разы, а риск «через полгода два workflow в одном профиле» реализуется |

## Последствия

**Код.** Переименование файла и терминологии; будущий `ProcedureRevision`. Никакой логики не меняется.

**Контракты.** Комментарии `workflow.ts:5,9,95` меняют слово; `OperationMeta.correlationId` остаётся.

**Карточки.** `.work\tasks\MW-044.md` (движок) — терминология в объёме и приёмке; `.work\tasks\MW-045.md` (finish criteria) — там, где сказано «workflow».

**Что перестаёт быть верным.** (а) «workflow» как имя домена MyWork; (б) утверждение отчёта §6 K4, что движок «не упомянут вовсе» — теперь упомянут и назван; (в) молчаливое предположение, что два движка в одном профиле различимы по контексту.

## Условия пересмотра

1. Платформа переименует свой шов или добавит второй движок.
2. MyWork понадобится исполнять модельно-написанные скрипты — тогда это уже не `procedure`, а потребитель `ctx.workflowEngine`, и нужен новый ADR.
3. Владелец потребует сохранить слово «workflow» в UI — тогда меняется только отображаемая строка, не домен.

## Что осталось неизвестным

- Не проверено, сколько строк композиции объявляют платформенный `workflowEngine`: в каталоге сервисов виден один сервис, но не видно числа объявлений.
- Не проверено, использует ли платформенный инструмент `workflow` то же слово в промпте агента (влияет на то, путается ли модель) — требует чтения `systemPrompt`-секций платформы.

## Что именно переименовывается (и что нет)

| Сущность | Было | Стало |
|---|---|---|
| Файл контрактов | `packages\contracts\src\workflow.ts` | `packages\contracts\src\procedure.ts` |
| Будущий тип ревизии | `WorkflowRevision` (не написан) | `ProcedureRevision` |
| Движок | «workflow engine» | «procedure engine» |
| `PlanMutationClass` (`workflow.ts:24`) | — | **не переименовывается** (про plan mutation) |
| `BlockerResolutionAction` / `Decision` / `Gate` / `Dependent` / `Observation` (`:49,70,107,133,143`) | — | **не переименовываются** (про блокеры) |
| `OperationMeta.correlationId` | — | **не переименовывается** |
| `ctx.workflowEngine` | — | **не используется вовсе** |

## Проверка соблюдения границы

1. `grep -rn "workflowEngine" packages/` → пусто (ни реализации, ни потребителя).
2. `grep -rn "@deepseek-ai/dsh-workflow" packages/` → пусто (нет импорта платформенного движка).
3. `grep -rn "WorkflowRevision\|WorkflowRunId\|WorkflowStopReason" packages/` → пусто (нет заимствования словаря платформы).

Все три проверки — детерминированные; они входят в границ-тест этапа 1 (`tests/boundaries.test.mjs`) и в CI-профиль.

## Ссылки

- ADR020 — `.work\architecture\DSH-My-Work-Architecture-v0.2-decisions.md:192-208`.
- Платформенный словарь — `packages\workflow\workflow\lib\types\types.d.ts:11-17,22-31,39-48,50-55`.
- Отчёт: §6 K4 (коллизия понятий), §10 «Что НЕ делать» (запрет регистрации).

## Приёмка этого ADR

| # | Проверка | Ожидание |
|---|---|---|
| 1 | Домен не упоминает платформенный шов | `grep -rn "workflowEngine" packages/` → пусто |
| 2 | Домен не импортирует платформенный движок | `grep -rn "@deepseek-ai/dsh-workflow" packages/` → пусто |
| 3 | Словарь платформы не заимствован | `grep -rn "WorkflowRevision\|WorkflowRunId\|WorkflowStopReason" packages/` → пусто |
| 4 | Файл переименован, содержимое сохранено | `packages/contracts/src/procedure.ts` существует; `PlanMutationClass`, `BlockerResolutionAction`, `BlockerResolutionDecision`, `BlockerResolutionGate`, `BlockerGateDependent`, `BlockerGateObservation` объявлены в нём |
| 5 | ADR020 не нарушен | один resident controller владеет admission и движком; движок просит admission и не адмитит сам |

## Риск, который решение не снимает

Переименование устраняет **коллизию имён**, но не устраняет **соблазн**: платформенный `ctx.workflowEngine` остаётся доступен, и любой будущий исполнитель может решить, что «раз есть шов, надо в него встроиться». Поэтому запрет записан не только в этом ADR, но и как границ-тест (проверка 1 выше) — то есть нарушение станет падением CI, а не предметом обсуждения.
