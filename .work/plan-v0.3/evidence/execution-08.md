# execution-08 — доставка решения человека в живую попытку (факты, reference)

Репозиторий: H:\Repo\DSH-MyWork @ 0c657ae (git rev-parse --short HEAD, exit=0)
DSH-checkout: C:\Reposit\deepseek-harness\deepseek-harness @ c7c4c725c7 (git rev-parse --short HEAD, exit=0)
Метод: только чтение (read/grep/glob), сборка и тесты не запускались.

## 1) `steer` в контрактах MyWork
- repo-wide grep 'steer' по H:\Repo\DSH-MyWork → ровно 2 совпадения, оба не механизм:
  - packages\controller\src\dsh-session.ts:203 — `readonly mode: 'queue' | 'steer'` (поле запроса `prompt(...)` интерфейса DshSessionService; модуль controller, НЕ contracts/src).
  - packages\contracts\src\context.ts:136 — слово «steering» в комментарии к `ContextPlacement`.
- Явно: в packages/contracts/src нет ни одного типа, операции, порта или поля `steer`/`steering` как контракта.
- Единственная реализация доставки в контроллере использует `mode: 'queue'`: packages\controller\src\dsh-session.ts:640 (`mode: 'queue'`), вызов `this.#api.controller.prompt(...)` :636; ветка `'steer'` в packages/** не реализована и не вызывается.

## 2) Механизмы доставки в contracts/src (реальные типы/операции)
- packages\contracts\src\agent-runtime.ts:223 `AgentRuntimePort`; :230 `start` (создать сессию + admit prompt), :237 `resume`, :243 `status`, :250 `stop`, :257 `events` — доставка возможна только на входе `start`/`resume`; операции «отправить в живую попытку» нет.
- packages\contracts\src\agent-runtime.ts:162-178 — курсор доставленных durable-событий (`SessionEventPage`, `hasMore`): чтение событий, не запись в попытку.
- packages\contracts\src\context.ts:948 `ContextPrompt`; :946 «a provider that is not in a frozen snapshot has nothing to inject» — инъекция в промпт возможна только из `ContextSnapshot`; :381 `ContextProviderPort`.
- packages\contracts\src\session.ts:525 `CheckpointPort`; :240 `CheckpointDecision` (`decisions.accepted`), :253 rejected — решение фиксируется в чекпойнте, не доставляется.
- packages\contracts\src\workflow.ts:65 `BlockerResolutionDecision`; :107 `BlockerResolutionGate`; :119-122 `awaitingDecision` — «человек ещё не ответил» хранится как доменное состояние гейта.
- packages\contracts\src\plan.ts:44-52 `'require-human-decision'`; :494-497 operator-input `resume` (§5.2) — резюме плана, не сообщение в сессию.
- packages\contracts\src\task.ts:42 — side state «a human must decide before work continues»; packages\contracts\src\board.ts:363-364 `'human-gate-deadline-exceeded'`.
- Типов `DiscussionMessage` / `notice` нет: repo-wide grep 'Discussion|discussion|notice' → только packages\lease\src\lease.ts:285 (слово «noticed» в комментарии).
- Итог: в contracts/src есть только (а) admit промпта при start/resume, (б) сборка промпта из snapshot, (в) durable-записи о решениях/гейтах; live-доставки сообщения или решения в running-попытку нет.

## 3) Как DSH доставляет steer в живую сессию
- packages/core/agent-loop/src/agent.ts:167-169 — `steer(input: UserMessage): void { this.send(input, 'next-step', true) }`.
- packages/core/agent/src/runtime-types.ts:231 — `steer(message: UserMessage): void` (порт Agent); :215 `send(message, target, wakeup)`; :222 `followup` (next-turn, wakeup); :241 `inject` (next-step, без wakeup).
- packages/core/agent/src/types.ts:39 — `export type InboxTarget = 'next-turn' | 'next-step'`.
- packages/api/session-controller/src/commands.ts:364 — `if (request.mode === 'steer') agent.steer(message) else agent.followup(message)` (RPC prompt admission, сообщение собирается на :355).
- packages/api/session-controller/src/commands.ts:495-497 — queue-action `'steer'`: `agent.inbox.remove(itemId)` + `agent.steer(message)`.
- packages/subagent/subagent/src/inbox.ts:46-54 — `deliver(message, delivery)`: `if (delivery === 'steer') this.agent.steer(message) else this.agent.followup(message)`; тип packages/subagent/subagent/src/control-types.ts:93 `delivery: 'queue' | 'steer'`; continuation.ts:58,232,271 (`delivery: 'steer'`); continuation-activation.ts:344 `if (delivery === 'steer') parent.steer(message)`.
- packages/experimental/agent-team/src/mailbox.ts:251 — `root.steer(input)`.
- packages/extensions/cordis-host-runner/src/index.ts:1048,1061,1085,1110 — `agent.steer(createUserMessage({...}))`.
- packages/core/agent/src/runtime-types.ts:365-372 (описание turn-close) — слушатель, который возражает, делает `agent.steer(...)`, и машина перечитывает inbox.

## 4) durable inbox/outbox в MyWork
- packages\storage\src\outbox.ts — экспорты: :29 `OutboxStatus = 'pending' | 'delivered'`; :32 `OutboxRecord`; :48 `OutboxAppendInput`; :65 `OutboxAppendResult`; :73 `OutboxWriter` (`append` :75, `markDelivered` :80, `markFailed` :86); :90 `OutboxQuery`; :98 `OutboxReader` (`pending` :100, `get` :102); :113 `createOutboxWriter`; :194 `createOutboxReader`. Назначение (шапка :1-9): транзакционный outbox §48 — событие домена коммитится вместе с мутацией, публикация после; запись только внутри транзакции.
- packages\storage\src\inbox.ts — экспорты: :18 `InboxApplyResult<T> = {applied:true,value} | {applied:false}`; :25 `InboxWriter` (`applyOnce(consumer, eventId, apply)` :37); :41 `InboxReader` (`isProcessed` :43); :51 `createInboxWriter`; :79 `createInboxReader`. Назначение (шапка :1-8): дедуп обработанных событий по ключу `(consumer, eventId)`; это НЕ входящие сообщения/команды.
- packages\storage\src\store.ts:34-39 `MyWorkTransaction.outbox: OutboxWriter` / `.inbox: InboxWriter`; :42-52 `MyWorkStore.outbox: OutboxReader` / `.inbox: InboxReader`; :122 `createOutboxReader`, :166-167 создания writer'ов.
- packages\storage\src\index.ts:31 `InboxApplyResult, InboxReader, InboxWriter`; :60 `OutboxWriter` (re-export типов storage).
- Call-sites append: packages\execution\src\service.ts:298; packages\planner\src\service.ts:429,741,1005,1116,1121,1418. Публикатора (вызовы `pending()`/`markDelivered`) в продуктивном коде нет: repo-wide grep 'createOutboxReader|markDelivered|markFailed' → outbox.ts:80,86,168,178,194, store.ts:23,122 и tests\storage.test.mjs:306,313,320.
- Итог: оба ledger'а — про события домена (§48), а не про доставку сообщения/решения в живую сессию.

## Команды
- `git -C C:\Reposit\deepseek-harness\deepseek-harness rev-parse --short HEAD` → c7c4c725c7 (exit=0)
- `git -C H:\Repo\DSH-MyWork rev-parse --short HEAD` → 0c657ae (exit=0)
- `Test-Path H:\Repo\DSH-MyWork\.work\plan-v0.3\evidence` → True (exit=0)

## не проверено:
- Путь доставки steer через Web GUI (UI-команда/кнопка) — не искался.
- Наличие спеки/ADR MyWork о доставке решения в живую попытку (docs/ не читались; repo-wide grep 'steer' дал 0 совпадений вне packages).
- Реализация `DshSessionService.prompt` с `mode: 'steer'` (в packages — только декларация интерфейса; ветка 'steer' нигде не вызывается).
- Кто и когда вызывает `outbox.pending()`/`markDelivered()` в проде (в репозитории такого вызова нет).
- Сборка, typecheck, тесты, install — не запускались (запрещено).
- Поведение `agent.steer()` на границах шага/отмены — по комментариям DSH, не по запуску.
