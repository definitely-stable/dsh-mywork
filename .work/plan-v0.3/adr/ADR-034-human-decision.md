# ADR-034. `HumanDecision` вместо `HumanGate`: durable решение, освобождение worker-сессии, доставка ответа

- **Статус:** проект (принимается агентом; затрагивает UX-обещания — уведомить владельца)
- **Дата:** 2026-09-26
- **Решает:** агент (решение D14), конфликт K8

## Контекст

У MyWork есть каталог human-gate'ов и потребность в решении человека по ходу попытки. Имя `HumanGate` **занято** и занято не пассивно:

- `packages\contracts\src\security.ts:171` — `export type HumanGate`; `:184` — `HUMAN_GATES`; `:193` — `DOMAIN_IMPLIED_GATES`; `:280` — `readonly gate?: HumanGate` внутри `OperationRequest`;
- `packages\core\src\security.ts:102-110` **принуждает** гейт как отказ при авторизации: гейт — это категория, из-за которой операция отвергается, а не сущность, которую кто-то ждёт;
- `packages\contracts\src\index.ts` реэкспортирует контракты звёздочкой, поэтому коллизия имён проявилась бы как молчаливая подмена, а не как ошибка сборки.

Главная техническая проблема — доставка ответа. Блокирующий вопрос **держит tool call и шаг агента**:

- `ctx.userQuestions` — на момент замера единственный метод `async ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer>` (дельта 2026-10-03: рядом появился второй метод `askTimed(request, callId, timeoutMs)` — см. врезку ниже);
- `ctx.approval` — `async request(req: ApprovalRequest): Promise<ApprovalOutcome>`;

ни один из них не принимает `AbortSignal`.

> **Дельта 2026-10-03 (DSH `0.2.0-rc.2`, checkout `639ed0153`): посылка «таймаута на шве нет» снята — таймаут появился.** У `ctx.userQuestions` есть **`askTimed(request, callId, timeoutMs)`** (`packages/interaction/user-questions/src/index.ts:234`), возвращающий либо ответ, либо **`{ pending: true, callId }`** (`:43` — тип `TimedUserQuestionResult`, `:261` — исход по `ASK_TIMED_OUT`); ожидание живёт в `TimedQuestionWait` (`src/timed-wait.ts:4`), привязка требует **точного живого root-агента** (`assertLiveRoot` `:131`; вызовы `:166,217,242,295`), а поздний ответ приходит **steered-сообщением** с источником `{ kind: 'user-question-reply', callId, outcome: 'answered' }` (`:187`; kind объявлен `src/types.ts:117`, потребляется проекцией `src/projection.ts:297`). **Это срабатывание условия пересмотра №1.** Что осталось верным: `ask()` по-прежнему без `AbortSignal`, вне GUI уведомлений нет, и **решение D14 не меняется** — durable `HumanDecision` с освобождением worker-сессии и доставкой ответа (таймаут делает шов пригодным для короткого форграунд-ожидания, но не заменяет durable решение и не даёт аудита).

При этом механизм доставки уже существует в контракте контроллера: `prompt(request: { requestId, sessionId, mode: 'queue' | 'steer', content }, signal)` (`packages\controller\src\dsh-session.ts:199-207`). **Но он адресует сессию, а не попытку** (уточнено проверкой `evidence\lead-19-apis.md`): DSH-реализация — `api\session-controller\src\commands.ts:364`, `if (request.mode === 'steer') agent.steer(message) else agent.followup(message)`; контракт — «'queue' appends a turn; 'steer' interrupts the running one» (`client\contract\session.ts:82`). `steer` адресует «ближайший шаг» сессии: `core\agent\src\runtime-types.ts:225-226` — «An idle driver starts a turn; a running driver consumes it at its next step boundary», то есть на бездействующем агенте `steer` **открывает новый ход**. Ни один из `send`/`followup`/`steer`/`inject` не принимает `AbortSignal` (`:215,222,231,241`), а `signal` у `prompt` отменяет только раунд-трип допуска (`client\contract\session.ts:83`). Идемпотентность по `requestId` уже есть в платформе (`commands.ts:330`). В реализации MyWork `mode:'steer'` **не используется** — всегда `'queue'` (`dsh-session.ts:640`).

Носитель последствия тоже уже объявлен: `'human-gate-deadline-exceeded'` входит в закрытый каталог `NeedsAttentionReason` (`packages\contracts\src\board.ts:363-364,377`).

## Решение

1. **Сущность называется `HumanDecision`.** `HumanGate` не переименовывается: он остаётся каталогом категорий, и `HumanDecision` ссылается на него **полем** `gate`.
2. **`HumanDecision` durable** — строка в `controller.sqlite`, переживающая рестарт.
3. **Схема (проект):** `decisionId`, `attemptId`, `gate: HumanGate`, `question`, `state`, `answer?`, `answeredBy?`, `deadlineAt`, `createdAt`, `answeredAt?`.
4. **Состояния — закрытый список:** `'pending' | 'answered' | 'expired' | 'cancelled'`. Переходы описываются таблицей и предикатом, по образцу `SKILL_TRANSITIONS` + `isAllowedSkillTransition` (`packages\core\src\skill.ts:870-888`).
5. **Гейт освобождает worker-сессию.** Worker **завершает ход** вместо ожидания; ожидание живёт в данных, а не в стеке вызова.
6. **Ответ доставляется в живую попытку** через `prompt(..., mode)`: `steer`, если ход открыт; `queue`, если попытка уже завершила ход. Новой сессии для доставки не создаётся.
7. **Просроченный гейт даёт `needs-attention` с существующей причиной** `'human-gate-deadline-exceeded'` — новый каталог не вводится.
8. **Три потребителя не смешиваются:** сущность и дедлайн — MW-030; доставка в живую попытку — MW-046; человеческая приёмка по work type — MW-045. MW-030 **не дробится**, но получает явную ссылку на MW-046, чтобы «сущность без доставки» не сдавалась как готовая.

## Отклонённые альтернативы

| Альтернатива | Почему отклонена |
|---|---|
| **Блокирующий `ask()`** | Держит tool call и шаг агента; таймаута нет; при закрытом браузере ожидание бесконечно. Это не гипотеза, а свойство сигнатур: ни `ask`, ни `request` не принимают `AbortSignal` |
| **Ждать ответа через `ask()`, но не хранить решение** | Решение не переживает рестарт; при перезапуске гейт задаётся заново; аудит решения отсутствует |
| **Дробить MW-030 на MW-030/MW-030b** | Разрезание уже сделано по смыслу: отчёт §6 K8 распределяет сущность+дедлайн → MW-030, доставку → MW-046, приёмку → MW-045. Дополнительное дробление создаёт две карточки вместо одной без нового качества |
| **Назвать сущность `HumanGate`** | Имя занято и принуждается как отказ (`packages\core\src\security.ts:102-110`); звёздочный реэкспорт `contracts\src\index.ts` превратил бы коллизию в молчаливую подмену |

## Последствия

**Код.** Миграция с таблицей `human_decision`; сервис решений; вызов `prompt(..., mode)` при ответе; проекция получает `needs-attention` с причиной дедлайна (причина уже есть).

**Контракты.** `packages\contracts` — `HumanDecision`, `HUMAN_DECISION_STATES`. `HumanGate` остаётся как есть.

**Тесты.** (а) «ответ, пришедший после конца хода, доставляется следующим ходом»; (б) «ответ, пришедший в открытый ход, доставляется `mode:'steer'`»; (в) «просроченный гейт даёт `needs-attention` с `human-gate-deadline-exceeded`»; (г) «решение переживает рестарт».

**Карточки.** MW-030 — дописать ссылку на MW-046; MW-045, MW-046 — без изменения текста.

**Что перестаёт быть верным.** (а) «human gate можно реализовать блокирующим вопросом»; (б) предположение, что SLA «ответить за N часов» исполним без открытой вкладки; (в) представление, что имя `HumanGate` свободно.

## Условия пересмотра

1. ~~Платформа добавит `AbortSignal`/таймаут в `userQuestions.ask`~~ — часть гейтов можно вернуть к блокирующей форме. **СРАБОТАЛО 2026-10-03:** таймаут добавлен как `askTimed(...)` (`packages/interaction/user-questions/src/index.ts:234`, `{ pending: true, callId }` — `:43,261`), но **не** через `AbortSignal` в `ask()`; решение D14 сохраняется, пересмотру подлежит только форма короткого форграунд-ожидания (см. «Дополнение 2026-10-03»).
2. Появится внешний канал уведомлений (почта, webhook) — SLA станет исполнимым, и дедлайн получит настоящий смысл.
3. Ответ придётся доставлять в **новую** сессию (если старая умерла) — тогда к этому ADR добавляется шаг пересоздания сессии.

## Что осталось неизвестным

- **Снято проверкой `lead-19`:** `steer` на бездействующем агенте **открывает новый ход** (`core\agent\src\runtime-types.ts:225-226`), поэтому «steer в открытый ход» — наша политика, а не гарантия платформы. Остаётся открытым **наблюдение статуса**: без поля `status` в `DshAgent` (`dsh-session.ts:222-224`) ветку `steer` выбрать корректно нельзя; шаг E-52 его добавляет.
- Не проверено живым прогоном: поведение `prompt(mode:'steer')` на реальной сессии (ничего не запускалось).
- Не прочитан GUI-путь доставки steer (`client/ui-conversation`, `sendSession`).
- Не проверено, годится ли континуэйшн-владелец субагента как канал доставки: `subagent\src\continuation.ts:271`, `control.ts:20` — `delivery: z.enum(['queue','steer'])`; адрес — child-сессия, а не попытка.
- Доступен ли `ctx.userQuestions` вне GUI-сессии. **Частично закрыто 2026-10-03:** `askTimed` требует точного живого root-агента (`assertLiveRoot`, `packages/interaction/user-questions/src/index.ts:131`), то есть вопрос задаётся из живого хода агента; поведение вне GUI-сессии по-прежнему не проверялось.
- Возможно ли создавать сессию без агента: `create({ cwd?, sessionId?, agentPreset? })` (`packages\controller\src\dsh-session.ts:175-179`) допускает отсутствие `agentPreset`, но поведение такой сессии не проверено.

## Схема и переходы (проект)

```
HumanDecision {
  decisionId   : string           // первичный ключ
  attemptId    : AttemptId        // попытка, которая спросила
  gate         : HumanGate        // значение из существующего каталога HUMAN_GATES
  question     : string
  state        : 'pending' | 'answered' | 'expired' | 'cancelled'
  answer?      : string
  answeredBy?  : string
  deadlineAt   : EpochMs
  createdAt    : EpochMs
  answeredAt?  : EpochMs
}
```

Разрешённые переходы (по образцу `packages\core\src\skill.ts:870-888`):

| Из | В | Условие |
|---|---|---|
| `pending` | `answered` | пришёл ответ человека (`answeredBy` обязателен) |
| `pending` | `expired` | `deadlineAt` пройден; даёт `needs-attention` с `'human-gate-deadline-exceeded'` |
| `pending` | `cancelled` | попытка отменена |
| `answered` / `expired` / `cancelled` | — | терминальные |

## Почему именно `mode: 'steer'` / `'queue'`

`prompt(request: { requestId, sessionId, mode: 'queue' | 'steer', content }, signal)` — единственный существующий канал доставки сообщения в живую сессию (`packages\controller\src\dsh-session.ts:199-207`). Выбор режима — **политика MyWork**, а не гарантия платформы:

- ход worker'а **открыт** → `steer`: сообщение доводится на границе `next-step` текущего хода (`core\agent\src\runtime-types.ts:225-226`), дополнительного хода не создаётся;
- ход worker'а **закрыт** → `queue`: сообщение станет следующим ходом.

**Различить эти два случая сегодня нельзя.** `steer` на бездействующем агенте открывает **новый ход**, а не ведёт себя как `queue` (`runtime-types.ts:225-226`); гейт `agent.status !== 'running'` относится к inbox-действию, а не к `prompt` (`commands.ts:477`). Порт MyWork отдаёт только `session.id` (`DshAgent`, `dsh-session.ts:222-224`), поэтому **до появления поля `status`** доставка идёт `queue` и всегда открывает новый ход — корректно, но на один ход медленнее. Шаг E-52 предписывает это поле; после него режим выбирается по факту.

Ни в одном случае новая сессия не создаётся, а `requestId` даёт идемпотентность (`commands.ts:330`): повторная доставка того же ответа не создаст второй ход. **Отозвать доставленное сообщение нельзя:** `cancel()` чистит очередь и steering, `{keepInbox:true}` сохраняет всё (`runtime-types.ts:176-183`).

Ни в одном случае новая сессия не создаётся, а `requestId` даёт идемпотентность: повторная доставка того же ответа не создаст второй ход.

## Дополнение 2026-10-03 (DSH `0.2.0-rc.2`, checkout `639ed0153`)

**Сработало условие пересмотра №1; решение D14 сохранено.** Платформа закрыла ровно ту дыру, из которой выросло решение: у `ctx.userQuestions` появился конечный форграунд-таймаут — `askTimed(request, callId, timeoutMs)` (`packages/interaction/user-questions/src/index.ts:234`), который по истечении окна возвращает **`{ pending: true, callId }`** (`:43` — тип `TimedUserQuestionResult`, `:261` — исход по `ASK_TIMED_OUT`), вместо бесконечного удержания вызова; ожидание живёт в `TimedQuestionWait` (`src/timed-wait.ts:4`). Поздний ответ доставляется **steered-сообщением** с источником `{ kind: 'user-question-reply', callId, outcome: 'answered' }` (`:187`), kind объявлен `src/types.ts:117` и потребляется проекцией `src/projection.ts:297`.

**Почему вывод ADR не переворачивается.**
1. Таймаут — не durable-хранение: `{ pending, callId }` живёт в памяти процесса (`waits` — `:81`), а `HumanDecision` — строка в БД; тест «решение переживает рестарт» из «Последствия» остаётся в силе.
2. Таймаут не даёт аудита решения: ответ человека приходит сообщением сессии, а не записью в `audit_events`.
3. Шов по-прежнему требует **точного живого root-агента** (`assertLiveRoot`, `:131`; вызовы `:166,217,242,295`): вопрос задаётся внутри живого хода и не покрывает случай «ход завершён, ответ приходит позже» — ровно тот, ради которого выбран `mode:'queue'`.
4. У `ask()` и `approval.request` по-прежнему нет `AbortSignal`; изменилось не их, а появление отдельного метода рядом.

**Что меняется практически.** Форграунд-ожидание можно ограничить окном вместо бесконечного `await ask(...)`, а поздний ответ приходит с `callId`/`outcome` (`src/types.ts:117`), то есть привязка к вопросу перестаёт требовать нашей собственной идентичности на этом участке. Это снимает часть эксплуатационного риска «зависший шаг агента» (K7) ещё до нашей реализации, но не отменяет ни `HumanDecision`, ни дедлайн, ни доставку в живую попытку. Посылку «таймаута нет» в шаге Q-04 (`23-STEPS-quality.md`) правит владелец того документа (`02-PLATFORM-DELTA-0.2.0-rc.2.md` §6).

**Не перепроверено здесь:** живое поведение `askTimed` на реальной сессии (в кампании ничего не запускалось — READ-ONLY); поведение при отсутствии подключённого клиента — по документации метода результат тоже `pending` (`:229-230`).

## Ссылки

- Каталог гейтов и принуждение: `packages\contracts\src\security.ts:171,184,193,280`; `packages\core\src\security.ts:102-110`; реэкспорт звёздочкой — `packages\contracts\src\index.ts`.
- Платформенные швы без `AbortSignal`: `cordis_inspect_query host/Service` → `userQuestions.ask`, `approval.request`. **Таймаут (дельта 2026-10-03):** `userQuestions.askTimed` — `packages/interaction/user-questions/src/index.ts:234,261`; `{ pending: true, callId }` — `:43`; `assertLiveRoot` — `:131`; `TimedQuestionWait` — `src/timed-wait.ts:4`; steered-ответ `{ kind: 'user-question-reply' }` — `:187`, `src/types.ts:117`, `src/projection.ts:297`.
- Доставка: `packages\controller\src\dsh-session.ts:175-179,199-207,213`.
- Носитель последствия: `packages\contracts\src\board.ts:363-364,377`.
- Отчёт: §6 K8.
