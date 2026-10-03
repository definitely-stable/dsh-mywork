# lead-19-apis — три API-допущения плана v0.3 (D14, D05, D15)

Read-only по MyWork и DSH-чек-ауту; записан только этот файл. Все якоря проверены чтением/грепом в этой сессии; из команд — только read-only PowerShell (`Get-Content`, `Get-ChildItem`, `Measure-Object`). Сборки, тесты и платные прогоны не запускались.

## Допущение 1 (D14) — доставка решения человека в живую попытку — **УТОЧНЕНО**

Канал существует, но он **не адресует попытку**, и в MyWork он сегодня не подключён.

- Сигнатура порта MyWork реальна: `packages/controller/src/dsh-session.ts:199-207`, `:203` = `readonly mode: 'queue' | 'steer'`. Но `#prompt` всегда шлёт `'queue'` — `:640` (тело `:633-649`).
- DSH-реализация: `api/session-controller/src/commands.ts:364` — `if (request.mode === 'steer') agent.steer(message) else agent.followup(message)`. Контракт: `api/session-controller/src/client/contract/session.ts:82` — «'queue' appends a turn; 'steer' interrupts the running one».
- Платформенный API доставки (`core/agent/src/runtime-types.ts`): `send(message, target: InboxTarget, wakeup): void` `:215`; `followup(message): void` `:222`; `steer(message): void` `:231`; `inject(message): void` `:241`; `cancel(cause, options?): void` `:183`. **Ни один не принимает `AbortSignal`.** `steer` адресует не попытку, а «nearest step» сессии: `:225-226` «An idle driver starts a turn; a running driver consumes it at its next step boundary»; `:227-228` — отклонённый шаг оставляет steer в inbox до следующего wake, отмена/диспоуз его отбрасывают.
- `signal` у `prompt` — отмена **раунд-трипа допуска**, а не доставленного сообщения (`client/contract/session.ts:83`). Точечно отозвать доставленный steer нельзя: `cancel()` чистит очередь+steering, `{keepInbox:true}` сохраняет всё (`runtime-types.ts:176-183`).
- Идемпотентность по `requestId` уже есть в платформе: `commands.ts:330` `if (hasPromptRequest(agent, request.requestId)) return { accepted: true }`.
- Гейт `agent.status !== 'running'` (`commands.ts:477`) относится к inbox-действию, не к `prompt`: `mode:'steer'` на idle-агенте **открывает новый ход**, а не ведёт себя как `queue`. MyWork это различить не может — `DshAgent` (`dsh-session.ts:222-224`) отдаёт только `session.id`.

**Замена формулировки (ADR-034:33,98-100):** «Ответ человека доставляется в **сессию** попытки существующим `prompt(request, signal)` с `mode:'steer'`, если ход открыт, и `mode:'queue'`, если завершён. Попытка адресуется не API, а сессией: платформа кладёт сообщение на границу `next-step`, а при отсутствии активного хода `steer` **открывает новый ход** — поэтому выбор режима обязан делать MyWork по наблюдаемому статусу агента (сегодня порт его не отдаёт: требуется поле `status` в `DshAgent`). Доставленное сообщение неотзываемо; `AbortSignal` отменяет только раунд-трип допуска; идемпотентность — по `requestId` (`commands.ts:330`). В реализации MyWork `mode:'steer'` не используется (`dsh-session.ts:640`).»

## Допущение 2 (D05) — breaker поверх `ctx.tokenMeter.measure` + счётчик шагов в `scheduler.ts:568` — **УТОЧНЕНО**

Токеновая половина подтверждена; шов для шагов — нет: **якорь ведёт в другой файл и в гейт другой природы**.

- `packages/llm/token-meter/src/index.ts:94-96` (`Context { tokenMeter }`), `:101` `export class TokenMeter extends Service`, `:111` `super(ctx, 'tokenMeter')`, `:146` `measure(session: Session, requestHeader?: EpochHeader): TokenMeasurement`.
- `TokenMeasurement` (`src/types.ts:22-35`): `logRevision: SessionLogOffset`, `baseline: none|estimated|usage`, `surfaceDeltaTokens`, `totalTokens`, `surfaceTokens`, `nodes`. **Ни cost, ни валюты, ни лимитов**; `TokenMeterConfig = Record<string, never>` (`:13`) — `validateConfigKeys` бросает на любой ключ.
- Кэш/ревизии: per-session `WeakMap<Session, ReplayState>` (`:108`) + eager-синк `ctx.on('session/event', …)` (`:120-122`); ревизия есть — `logRevision: state.consumedEvents` (`:184`), но результат **не мемоизируется**: каждый вызов — `deepFreeze(structuredClone(...))`, O(surface) (`:140`, `:183-190`).
- `scheduler.ts:568` — это `packages/core/src/scheduler.ts:568`: `const decision: BudgetDecision = decideBudgetAdmission({ limits: workspace.budget, ledgers, request })` внутри приватной `budgetVerdict` (`:554`), импорт `:70`. Файла `packages/scheduler/src/scheduler.ts` в MyWork **нет** (`packages/scheduler/src/{index,service}.ts`; `service.ts` — 414 строк).
- Гейт **admission-ный, не пошаговый**: `BudgetRequest` собирается из `item.budget?.charge` — заранее объявленных `tokens`/`cost` на единицу работы (`:559-563`), вызов один, до старта попытки. Определение — `core/src/budget.ts:217`; в production вызов ровно один (`:568`); ссылки `contracts/src/scheduler.ts:212`, `:304`.
- Шагов в MyWork нет: grep `maxSteps|maxRounds|stepCount|stepsUsed` по `packages/**/*.ts` → **0 совпадений**. `BUDGET_LIMIT_NAMES` (`contracts/src/budget.ts:78-87`) — 8 имён, ни одного про шаги (есть `maxAttempts` — попытки на задачу, не шаги).
- Шаги есть у DSH: durable `step/start` с payload `{ turn, step }` (`session/session-format-v3-to-v4/src/relationships.ts:10`; `session-format-v0-to-v1/src/dispositions.ts:91`), живой хук `agent/pre-step` с `{ agent, messages, turn, step, signal }` (`core/agent/src/runtime-types.ts:320`). Бюджета шагов платформа не имеет: `core/agent-loop/README.md:202` — «**No built-in turn budget** … a policy that bounds runaway turns must cancel from an existing lifecycle extension point such as `agent/turn-stopping`» (`runtime-types.ts:381`).

**Замена формулировки (`01-MASTER-PLAN.md:291`, `30-CARD-EDITS.md:208`):** «Токены breaker читает только из `ctx.tokenMeter.measure(session, requestHeader?)` (`TokenMeasurement.totalTokens`, ревизия `logRevision`); cost и лимиты `TokenMeter` не отдаёт — ставка остаётся у MyWork (`modelCallCost`). Счётчик шагов **нельзя встроить** в `scheduler.ts:568`: это `packages/core/src/scheduler.ts:568` — admission-гейт одного юнита работы, заряжающий объявленные `tokens`/`cost` до старта попытки, а не считающий живые шаги. Для шагов нужны: (а) источник — durable `step/start { turn, step }` или хук `agent/pre-step`; (б) новое имя лимита в `BUDGET_LIMIT_NAMES`; (в) обратная запись числа шагов в charge/ledger попытки. Правило «точка входа одна» сохраняется только для токенов.»

## Допущение 3 (D15) — scoped `restrict`/`guard`, context-global бросает — **ПОДТВЕРЖДЕНО (два уточнения)**

- `restrict(filter: ToolRestriction): () => void` — `packages/core/tools/src/index.ts:1097`; тип `ToolRestriction { allow?: readonly string[]; deny?: readonly string[] }` (`:700`). Context-global бросает дословно: `:1099-1101` «tools.restrict() requires a scoped context (agent.ctx): a context-global restriction would mask every agent — deny the tool for the intended agent instead». Пустой фильтр бросает (`:1104-1106`), `run_code` бросает (`:1111-1113`).
- Незарегистрированный инструмент: `:1114` `const known = this.view(scope).restrictableNames`, `:1115-1118` — throw со списком известных имён. `restrictableNames` (`:719-720`) собирается на `:1194-1197` только из **унаследованных** (global + ancestors); собственные регистрации скоупа исключены из фильтра (`:1202-1208`). Следствие: deny не может назвать ещё не зарегистрированный (динамический `cordis_*`) инструмент — вызов бросит; резолв «из `restrictableNames` в рантайме» fail-open для зарегистрированного позже. Это подтверждает выбор D15 в пользу allowlist.
- `guard(guard: ToolGuard): () => void` — `:1136`; `ToolGuard = (execution: Readonly<ToolExecution>) => string | undefined` (`:731`), монотонный: «no guard can force-allow a call another guard denied» (`:1126-1130`); порядок — global layer, затем цепочка скоупа (`:1145-1154`). **Уточнение 1:** scoped-контекст обязателен только для `restrict`; `guard` на plain-ctx применяется **глобально ко всем агентам** (`:1128-1129`) — для worker-поверхности он обязан ставиться через `agent.ctx`.
- Применение в MyWork: `dsh-session.ts:93` объявляет `scopedTools: true`, вызовов нет — grep `\.restrict\(|\.guard\(|scopedTools` по `packages/**/*.ts` даёт **одно** совпадение, и это сама декларация. Окно — `setup` при create и resume: `core/agent/src/index.ts:100-118` (setup ждут после минта `agentCtx`, до `session/created`/`agent/created`/первой сборки промпта; `restrict()` назван явно), `ResumeAgentOptions.setup` `:134-143`, проброс `api/session-controller/src/agent.ts:440` `setup: composition.setup`; прецедент — `subagent/subagent/src/child-agent.ts:218`.
- **Уточнение 2 (путь):** `packages/execution/src/agent-runtime.ts` **не существует** (`packages/execution/src/` = `errors/index/schema/service/store.ts`); контракт scope — `packages/contracts/src/agent-runtime.ts:52-59`, и он подтверждает посылку D15: «a session inherits the composition of its preset, and there is no per-session tool allow-list to set instead».

**Замена формулировки (D15):** «Per-agent ограничение поверхности — `agent.ctx.tools.restrict({ allow })` (scoped-контекст обязателен: context-global бросает, `core/tools/src/index.ts:1100`) плюс `agent.ctx.tools.guard(...)` (монотонный запрет; **без** `agent.ctx` guard становится глобальным, `:1128-1129`). Форма — **allowlist**: `restrict` отвергает незарегистрированные и scope-local имена (`:1114-1118`) и не фильтрует собственные регистрации скоупа (`:1202-1208`), поэтому denylist динамического раннера невыразим и fail-open. Ставится в окно `setup` и **повторно** на resume; в MyWork сегодня не вызывается ни разу.»

## Опровержения/неожиданное

1. Путей `packages/execution/src/agent-runtime.ts` и `packages/scheduler/src/scheduler.ts` в MyWork нет.
2. `scheduler.ts:568` — admission-гейт (`core/src/scheduler.ts`), считающий объявленные tokens/cost один раз до попытки; счётчик живых шагов туда не встраивается.
3. Противоречие в плане, подтверждённое исходником: шаг `E-39` (`21-STEPS-execution.md:805`) предписывает `restrict({ deny: FORBIDDEN })`, тогда как D15 выбрал allowlist и отверг denylist; deny-форма невыразима для незарегистрированных имён (`:1114-1118`) — это дефект решения, не стиля.
4. `steer` на idle-агенте открывает новый ход (`runtime-types.ts:225-226`): «steer в открытый ход / queue в закрытый» — политика MyWork, а не гарантия платформы, и порт не отдаёт `agent.status`.

## Не проверено

- Живой прогон: ничего не запускалось; поведение `prompt(mode:'steer')` на реальной сессии не наблюдалось.
- GUI-путь доставки steer (`client/ui-conversation`, `sendSession`) не читал.
- Доставка в конкретную **попытку** через континуэйшн-владельца/`send_message` субагента (`subagent/src/continuation.ts:271`, `control.ts:20` `delivery: z.enum(['queue','steer'])`) — читал только сигнатуры; адрес — child-сессия, не попытка.
- `tool-ralph` (`workflow/tool-ralph/src/index.ts:151`) как единственный найденный счётчик раундов — не изучал, годится ли как образец.
