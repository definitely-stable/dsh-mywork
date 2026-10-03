# ADR-033. Отношения с Agent Teams: паттерны переносим, authority — нет

- **Статус:** проект (требует утверждения владельца)
- **Дата:** 2026-09-26
- **Решает:** агент (решение D13), конфликт K9

## Контекст

Agent Teams в DSH — работающая подсистема. Её сервис `ctx.agentTeams` даёт: `membership(agent)`, `listMembers(agent)`, `spawnTeammate(caller, request)`, `sendMessage(caller, request)`, `createTask/listTasks/getTask/updateTask(caller, …)`, `waitForChange(caller, timeoutMs, signal)`, `interrupt(caller, targetName)`, `tryMembership(agent)`. Подсистема владеет implicit-root roster, durable peer mailbox, shared task DAG и continuable-child lifecycle (`docs\subsystems\agent-team.md`).

Отчёт называет Agent Teams «главным вкладом документа» (§6 K9) и одновременно формулирует границу: паттерны переносить, authority — нет, coordination subsystem не строить. В плане v0.2 темы Agent Teams не было вовсе.

Состояние MyWork проверено: `grep -rn "mailbox\|spawnTeammate\|agentTeams\|coordination\|waitForChange\|handoff" packages/**/*.ts` → **нет совпадений**. То есть перенос означает «добавить впервые», а не «переписать существующее».

Транспорт при этом уже есть свой: `outbox` + `inbox_dedup`, записываемые **в одной транзакции** с мутацией (`packages\storage\src\migrations.ts:49-82`, `packages\storage\src\store.ts:30-39`).

## Решение

1. **`ctx.agentTeams` не используется** — ни как транспорт сообщений, ни как хранилище задач. Владелец задач остаётся один: Task Graph MyWork.
2. **Переносятся три паттерна:**
   - **provisioning saga с pre-minted identity** — `instanceId` выдаётся **до** создания попытки, шаги фиксируются, матрица recovery описывает, что делать на каждом падении (B §3.1; отчёт §10 п.7: «pre-minted `instanceId`, 5 шагов, матрица recovery из 9 строк»);
   - **advisory write scopes на Attempt** — набор путей объявляется до работы и носит рекомендательный характер (не блокировка);
   - **handoff artifact** — артефакт передачи контекста между попытками, durable, через `packages/evidence`.
3. **Приём «честный `noProgress`» переносится как свойство, а не как вызов:** ожидание обязано вернуть «изменений не будет», а не ждать вечно, если произвести изменение некому.
4. **Coordination subsystem не строится.** Никакого второго mailbox: свой транспорт (`outbox`/`inbox_dedup`) уже даёт доставку ровно один раз и в одной транзакции с мутацией.
5. **`TeamId` не отождествляется с `SessionId`; `TeamTask` не становится canonical `Task`.** Понятия MyWork (`packages\contracts\src\team.ts:390` — `Team`, `:229` — `AgentIdentity`, `:335` — `AgentInstance`) остаются своими.

## Отклонённые альтернативы

| Альтернатива | Почему отклонена |
|---|---|
| **Использовать `ctx.agentTeams` как транспорт** | Двойное владение задачами: `agentTeams.createTask/listTasks/updateTask` — это shared task DAG платформы, а MyWork владеет Task Graph. Два владельца задач на одном проекте — ровно то, от чего проект уходит весь v0.2. Плюс каждый метод требует `caller: Agent`, то есть MyWork-исполнители должны быть агентами в смысле Agent Teams |
| **Не переносить ничего** | `instanceId` будет выдаваться после создания попытки, а не до: падение между «создали» и «записали» оставит сироту без идентификатора, и восстановление станет гаданием. Контракт попытки уже отделяет «создана» от «начата» (`packages\contracts\src\board.ts:106-107`: `assigned` vs `executing`) |
| **Построить свой аналог Agent Teams (mailbox + shared task DAG)** | Дублирует существующую подсистему; запрещено отчётом; транспорт уже есть (`outbox`/`inbox_dedup`) |
| **Перенести authority тоже** (например, roster) | MyWork не управляет сессиями как roster'ом; roster платформы производен от лога лид-сессии, и владеть им из плагина нельзя |

## Последствия

**Код.** `packages\contracts\src\attempt.ts` — поле advisory write scope; provisioning saga как набор шагов в `packages\execution`; handoff artifact — запись в `packages\evidence`.

**Контракты.** `Attempt` получает write-scope (advisory). `Team`/`AgentInstance`/`AgentIdentity` не трогаются.

**Тесты.** Новый: «pre-minted `instanceId` существует до создания попытки». Границ-тест: в `packages/**` нет импортов `@deepseek-ai/dsh-agent-team*`.

**Карточки.** MW-065…MW-069 (резерв: provisioning saga, write-intent на Attempt, handoff artifact).

**Что перестаёт быть верным.** Утверждение отчёта §6 K9, что «темы Agent Teams в плане нет» — теперь есть, с явной границей.

## Условия пересмотра

1. Появится требование запускать MyWork-исполнителей как teammates внутри Agent Teams — это смена владельца задач и новый ADR.
2. Платформенный `agentTeams` станет единственным способом получить durable mailbox.
3. Provisioning saga окажется избыточной, если попытка начнёт создаваться атомарно вместе с идентификатором — это и есть цель, а не повод отменить.

## Что осталось неизвестным

- Доступен ли `ctx.agentTeams` в живом профиле: в этой сессии он объявлен (что означает наличие), но строка композиции не читалась.
- Стоимость `spawnTeammate` по времени и деньгам — влияет на «мы это не используем», но не на решение.
- Есть ли у `TeamMembership` durable-состояние за пределами лога лид-сессии: документация говорит «exact live Lead Session log», то есть roster производен от лога.

## Разделение: что чьё

| Понятие | Владелец | Как используется MyWork |
|---|---|---|
| Задачи (Task Graph) | **MyWork** | Единственный владелец; `TeamTask` платформы не используется |
| `Attempt` и его состояние | **MyWork** | `packages\contracts\src\attempt.ts`, таблица `attempt` (`packages\execution\src\schema.ts:120`) |
| Доставка событий и сообщений | **MyWork** | `outbox` + `inbox_dedup` в одной транзакции с мутацией |
| Roster, peer mailbox, continuable children | платформа (`ctx.agentTeams`) | **Не используется** |
| Сессии | платформа (`ctx.agents`, `ctx.sessions`) | Через `packages\controller\src\dsh-session.ts` |
| Advisory write scopes | **MyWork** (переносится как паттерн) | Поле `Attempt`; рекомендация, не блокировка |
| Provisioning saga | **MyWork** (переносится как паттерн) | Шаги в `packages\execution`, pre-minted `instanceId` |
| Handoff artifact | **MyWork** (переносится как паттерн) | Запись в `packages\evidence\artifacts` |

## Проверка соблюдения границы

1. `grep -rn "agentTeams\|spawnTeammate\|waitForChange" packages/` → пусто.
2. `grep -rn "TeamTask" packages/` → пусто.
3. Тест «pre-minted `instanceId` существует до создания попытки» — единственная новая проверка, которую добавляет перенос паттерна.

## Ссылки

- Платформа: `cordis_inspect_query host/Service` → `agentTeams` (11 методов); `docs\subsystems\agent-team.md`.
- Транспорт MyWork: `packages\storage\src\migrations.ts:49-82`; `packages\storage\src\store.ts:30-39`.
- Отчёт: §6 K9 (что переносить и что нет), §10 п.7 (provisioning saga), §10 «Что НЕ делать» (три запрета).

## Приёмка этого ADR

| # | Проверка | Ожидание |
|---|---|---|
| 1 | Платформенный roster не используется | `grep -rn "agentTeams\|spawnTeammate\|waitForChange" packages/` → пусто |
| 2 | Задачи платформы не стали canonical | `grep -rn "TeamTask" packages/` → пусто |
| 3 | Pre-minted identity существует до попытки | тест: `instanceId` присвоен в состоянии до `executing`; падение между шагами не оставляет сироту без идентификатора |
| 4 | Ожидание честно сообщает `noProgress` | тест: ожидание, при котором изменение невозможно, возвращает `noProgress`, а не истекает по таймауту |
| 5 | Write scope носит рекомендательный характер | тест: запись вне объявленного scope **не** блокируется, но фиксируется |

## Пять шагов provisioning saga (проект)

1. Сгенерировать `instanceId` **до** любой записи о попытке.
2. Записать `agent_instance` в состоянии «создана» (в терминах состояний попытки — `assigned`).
3. Привязать сессию (создать или переиспользовать, если `reuseSession`).
4. Перевести в `executing` **одной транзакцией** с записью события в `outbox`.
5. При падении на любом шаге — матрица recovery (9 строк): что откатывать, что оставить, что считать сиротой и как её увидеть.

Именно шаг 1 отличает перенос паттерна от «просто создать попытку»: без pre-minted identity шаг 2 и шаг 5 неразличимы, и восстановление превращается в гадание по времени создания.
