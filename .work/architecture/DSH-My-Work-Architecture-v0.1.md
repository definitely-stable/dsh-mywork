# DSH My Work (`dsh-mywork`)
## Архитектурный проект v0.1

**Статус:** Architecture Baseline / implementation-ready draft  
**Дата фиксации:** 16 сентября 2026  
**Проект:** `DSH My Work`  
**Пакет / plugin id:** `dsh-mywork`  
**Целевая среда:** DeepSeek Harness (DSH), local-first, Windows/Linux/macOS, с возможностью resident/headless controller  
**Основная идея:** долговременная AI-команда с отдельным контуром постановки задач, событийным scheduler, эластичными пулами исполнителей и ревьюеров, короткоживущими рабочими сессиями, контекстом по запросу, многоуровневой памятью, обучаемыми ролями и универсальными API/adapter-контрактами.

---

# 1. Executive Summary

`DSH My Work` — не ещё один Agent Team, не ещё одна Task Board и не GUI для Beads. Это **control plane для долговременной AI-команды внутри DeepSeek Harness**.

Система должна позволять пользователю один раз описать команду, роли, доступные модели, лимиты и workflow, после чего работа организуется как устойчивый событийный процесс:

1. Пользователь создаёт новую цель или крупную задачу.
2. Отдельный **Task Setter / Planner** (обычно frontier-модель) запускается независимо от Team Work, анализирует workspace и текущий граф работ, формирует/изменяет DAG задач и завершает работу.
3. **Beads или другой Task Graph backend** хранит канонический граф задач, зависимости, ready/blocking state и durable project work memory.
4. **MyWork Scheduler** как обычный программный сервис наблюдает за durable state, находит готовые задачи, учитывает ограничения пула, workspace, ролей, бюджетов и провайдеров и атомарно назначает работу.
5. Нужный Worker или Reviewer «просыпается» только при наличии работы. Idle/sleeping агенты не вызывают модель и не расходуют токены.
6. Каждая попытка исполнения получает **изолированный рабочий контекст**, собственную Session и, для кодовых задач, отдельный Git worktree.
7. После исполнения задача проходит детерминированные gates, затем независимый review. Self-review по умолчанию запрещён.
8. Ревьюер либо подтверждает конкретный immutable result revision, либо возвращает структурированные findings. Повторная попытка идёт от той же Agent Identity, но не обязана продолжать старую Session.
9. Все события, версии ролей/агентов, контекстные snapshots, результаты и изменения фиксируются с provenance и audit trail.
10. Отдельный **Role Learning** контур извлекает опыт после выполненной работы, а более дорогой **Role Sleep Optimizer** периодически консолидирует опыт, skills и strategy-модули без изменения security/RBAC контрактов.
11. Интеграции с DSH, Beads, Task Board, memory backends, Agent Team и другими plugins выполняются через стабильные Ports/Adapters и capability negotiation, а не через hardcoded зависимости.

Ключевой архитектурный тезис:

> **Долговечны Identity, Role, Skills, Memory, Task Graph и Audit.  
> Короткоживущи Session, working context и model runtime.**

---

# 2. Проблема, которую решает продукт

Современные multi-agent плагины хорошо показывают отдельные части задачи: команды агентов, task DAG, роль лидера, параллельное исполнение, review, persistent sessions, Task Board или memory. Но при долговременной эксплуатации быстро появляются системные проблемы:

- Leader превращается в постоянный дорогой coordination bottleneck.
- Planning смешивается с execution.
- Агенты бесконечно копят conversation history.
- Контекст растёт быстрее полезного знания.
- Каждая новая задача получает тысячи токенов нерелевантного прошлого.
- Постоянные Session начинают требовать агрессивной compaction, summarization и recovery.
- Несколько Workers конфликтуют в одном checkout.
- Task Board, Team plugin и внешний task graph могут иметь разные версии истины.
- У ролей нет строгих полномочий; ограничения существуют только как prompt.
- Улучшение ролей либо отсутствует, либо превращается в неконтролируемый self-rewrite.
- Интеграции жёстко привязываются к одному plugin API и ломаются при изменении DSH.
- При crash/restart непонятно, кто владеет задачей, какой результат считается текущим и можно ли принимать поздний ответ старой Session.
- Нет воспроизводимого ответа на вопросы «какая версия агента это сделала?» и «какой контекст она реально видела?».

`dsh-mywork` должен закрывать эти проблемы системно.

---

# 3. Нормативные принципы

## 3.1. Task Setter не является членом Team Work

Контур постановки/декомпозиции новой работы независим от исполнителей.

Запрещённая архитектура:

```text
Planner → chat Worker → Worker → chat Reviewer → Leader решает дальше
```

Целевая архитектура:

```text
User Goal
   ↓
Task Setter / Frontier Planner
   ↓
Atomic Task Graph mutation
   ↓
Task Setter exits

Scheduler observes durable state
   ↓
Workers / Reviewers execute
```

Task Setter не обязан знать, какие Workers сейчас активны, не ведёт с ними переписку и не является runtime-координатором.

---

## 3.2. Scheduler не является LLM

Все обычные решения по:

- ready-state;
- capacity;
- assignment;
- lease;
- retry policy;
- fairness;
- timeout;
- state transition;
- wake/sleep;
- provider limit;
- budget limit

выполняются детерминированным кодом.

LLM применяется только там, где требуется семантическое рассуждение: планирование, исполнение, review, reflection, сложная эскалация.

---

## 3.3. Agent Identity не равна Session

`Backend Worker Neo-1` может существовать месяцами.

Его Session не должна существовать месяцами.

```text
Neo-1 (Identity)
├─ Task A / Attempt 1 / Session S10
├─ Task B / Attempt 1 / Session S14
├─ Task B / Attempt 2 / Session S17
└─ Task C / Attempt 1 / Session S19
```

Identity сохраняет историю производительности, роль и настройки; рабочая Session ограничена episode/attempt.

---

## 3.4. Memory не равна history

История Session — сырое эпизодическое доказательство.  
Memory — отобранное, scoped, versioned знание.  
Skill — процедурное знание.  
Task Graph — план работы.  
Artifact — сырое доказательство результата.  
Workspace Canon — каноническая проектная информация.

Ни один из этих слоёв не должен поглощать остальные.

---

## 3.5. Context формируется по запросу

Ни одна роль не должна иметь giant prompt со всем накопленным знанием.

Контекст строится отдельно для конкретного запуска:

```text
Task + Role + Model + Attempt
           ↓
       Context Plan
           ↓
Context Providers + Memory + Skills + Workspace
           ↓
      Budget / Routing
           ↓
    Immutable Snapshot
           ↓
          LLM
```

---

## 3.6. Один writer на одну authoritative область

Если task graph authority — Beads, Task Board не должен быть вторым равноправным task DB.

Если workspace memory authority — OpenViking, Hindsight не должен одновременно писать те же записи без явной replication policy.

---

## 3.7. Human UI не владеет runtime

Закрытие вкладки браузера не должно само по себе уничтожать логическую архитектуру.

UI — клиент Controller-а.  
Controller — владелец scheduler/runtime.

---

## 3.8. Capability seams вместо hardcoding

Core не должен знать:

```text
if provider == "hindsight"
if board == "scwlkq/dsh-task-board"
if graph == "beads"
```

Он знает только:

```text
MemoryPort
TaskGraphPort
TaskBoardPort
AgentRuntimePort
...
```

---

# 4. High-Level Architecture

```text
┌────────────────────────────────────────────────────────────────────┐
│                          DSH MY WORK                               │
├────────────────────────────────────────────────────────────────────┤
│ Application / Domain Core                                          │
│                                                                    │
│ Task Intake │ Scheduler │ Team Work │ Review │ Integration          │
│ Role Learning │ Governance │ Audit │ Observability                  │
├────────────────────────────────────────────────────────────────────┤
│ Context Fabric                                                     │
│                                                                    │
│ Planner │ Router │ Providers │ Budget │ Materializer │ Snapshot     │
├────────────────────────────────────────────────────────────────────┤
│ Session / Episode Manager                                          │
│                                                                    │
│ Identity │ Episode │ Attempt │ Session Window │ Checkpoint          │
├────────────────────────────────────────────────────────────────────┤
│ Memory Fabric                                                      │
│                                                                    │
│ Retain │ Recall │ Reflect │ Trust │ Conflict │ Lifecycle │ Routing  │
├────────────────────────────────────────────────────────────────────┤
│ Stable Ports / Contracts                                           │
│                                                                    │
│ AgentRuntime │ TaskGraph │ TaskBoard │ Memory │ Context │ Skills   │
│ Session │ ArtifactStore │ Workspace │ EventBus │ LeaseStore         │
├────────────────────────────────────────────────────────────────────┤
│ Adapters                                                           │
│                                                                    │
│ DSH │ Beads │ Task Boards │ Git │ OpenViking │ Hindsight │ Native  │
└────────────────────────────────────────────────────────────────────┘
```

---

# 5. Process / Deployment Model

## 5.1. Embedded Mode

Плагин загружается как часть обычного DSH Host:

```text
dsh web / DSH Desktop
       ↓
Cordis boots profile
       ↓
dsh-mywork plugin
       ↓
MyWork Controller
       ↓
Scheduler + Reconciler
```

UI не запускает Scheduler. Scheduler активен после lifecycle activation плагина.

---

## 5.2. Resident Mode

Для автономной работы после закрытия Web UI используется отдельный persistent Controller process:

```text
OS Startup
   ↓
dsh --profile myworkd
   ↓
MyWork Controller
   ↓
Scheduler / Agents / Beads
```

Web/Desktop/CLI подключаются к Controller как клиенты.

Resident mode является полноценным supported deployment, а не future hack.

---

## 5.3. Single-Controller Invariant

Одновременно только один Controller имеет право изменять runtime state данного MyWork installation scope.

Controller lease:

```yaml
controller:
  instanceId: "uuid"
  processId: 17432
  startedAt: "..."
  heartbeatAt: "..."
  leaseUntil: "..."
  epoch: 42
```

Получение leadership выполняется CAS/transaction механизмом `LeaseStorePort`.

Все long-running actions получают `controllerEpoch`. После failover старый Controller не может коммитить новые authoritative transitions.

---

## 5.4. UI / Controller IPC

Если UI и Controller работают в разных процессах:

```text
Web/Desktop/CLI
      ↓
Local MyWork API
      ↓
Controller
```

Рекомендуемый baseline:

- localhost HTTP API;
- versioned schema;
- SSE или WebSocket для событий;
- optional local authentication/token;
- возможный Named Pipe adapter на Windows, но не как единственный transport.

MCP не используется как внутренняя transactional шина scheduler-а.

---

# 6. Workspace Configuration Model

Поддерживаются три режима.

## 6.1. `global`

Workspace использует глобальные:

- Team;
- workflow;
- Role Blueprints;
- memory routes;
- pool policies.

## 6.2. `isolated`

Workspace получает независимую:

- Team Work;
- Beads/Task Graph namespace;
- memory namespace;
- workflow settings;
- agent revisions;
- limits.

## 6.3. `inherit` — default

```text
Platform Defaults
   ↓
Global MyWork Config
   ↓
Team Config
   ↓
Workflow Config
   ↓
Workspace Overrides
   ↓
Task Overrides
```

Любое resolved configuration состояние получает `ConfigRevision`.

---

# 7. External State Location

MyWork не требует размещения workflow/runtime данных внутри пользовательского repository.

Пример структуры:

```text
$DSH_HOME/dsh-mywork/
├─ config/
│  ├─ global.yaml
│  ├─ workflows/
│  └─ teams/
├─ state/
│  ├─ registry.sqlite
│  └─ controller.sqlite
├─ roles/
├─ skills/
├─ workspaces/
│  └─ <workspace-id>/
│     ├─ state.sqlite
│     ├─ graph/
│     ├─ artifacts/
│     ├─ memory/
│     ├─ audit/
│     └─ runtime/
└─ logs/
```

Repository-local config может существовать как optional overlay, но MyWork не должен требовать `.mywork/` в каждом repo.

---

# 8. Data Authority Matrix

Нужна строгая ownership-модель.

Baseline:

| Домен | Authority |
|---|---|
| Goal/Epic/Task description | Task Graph |
| Dependencies | Task Graph |
| Ready/Blocked semantic state | Task Graph |
| Priority | Task Graph |
| Role requirement | Task Graph metadata |
| Task UI layout/order | Task Board |
| Current execution attempt | MyWork DB |
| Lease/fence | MyWork DB / Lease Store |
| Agent/Session IDs | MyWork DB |
| Worktree/base/head SHA | MyWork DB |
| Review attempt | MyWork DB |
| Review findings | MyWork DB + Artifact |
| Human approval | MyWork DB/Audit |
| Final graph completion | Task Graph |
| Raw session events | DSH Session Store |
| Build/test/log evidence | Artifact Store |
| Long-term semantic memory | Memory Provider |
| Skills | Skill Registry |
| Role/Blueprint revisions | MyWork Registry |
| Audit | MyWork Audit Store |

Task Board является projection/control surface, а не конкурентным authority.

---

# 9. Cross-Store Transaction Model

Beads/Task Graph и MyWork DB не имеют общей ACID-транзакции. Поэтому используется saga + idempotency.

Каждая mutation получает:

```text
operationId
correlationId
expectedRevision
controllerEpoch
```

Пример claim:

```text
1. MyWork records ClaimIntent(operationId)
2. TaskGraph.claim(task, operationId)
3. MyWork creates Attempt + Lease
4. Projection updated
5. ClaimIntent → Completed
```

Crash recovery:

```text
ClaimIntent exists
TaskGraph claimed
Attempt missing
→ reconciler creates/revokes attempt according to policy
```

Ни один cross-store workflow не должен полагаться на «обычно два вызова выполнятся подряд».

---

# 10. Task Intake / Task Setter

## 10.1. Назначение

Task Setter отвечает только за:

- понимание новой цели;
- workspace research;
- decomposing;
- acceptance criteria;
- dependencies;
- required role/capabilities;
- review policy;
- approximate complexity;
- task metadata;
- plan revisions.

Он не выполняет implementation tasks.

---

## 10.2. Изоляция от Team Work

Task Setter не читает team chat и не посылает исполнителям сообщения.

Его output — structured Plan Mutation.

```yaml
planMutation:
  baseRevision: ...
  epic:
    ...
  create:
    - task: ...
  update:
    - task: ...
  dependencies:
    - from: ...
      to: ...
```

Mutation сначала валидируется, затем атомарно/идемпотентно применяется к TaskGraphPort.

---

## 10.3. Replanning

Изменение требований создаёт новую Plan Revision.

Каждая существующая задача классифицируется:

- unchanged;
- modified;
- cancelled;
- superseded;
- newly-created.

Running task нельзя молча переписать. Policy определяет:

- continue;
- cancel;
- finish then adapt;
- require human decision.

---

## 10.4. Discovered Work

Worker не имеет права бесконтрольно перестраивать DAG.

Он может создать `WorkProposal`:

```text
blocker
follow-up
scope-change
dependency
security-risk
```

Proposal обрабатывает Task Setter или deterministic lightweight policy.

---

# 11. Task Graph и Beads

`TaskGraphPort` является каноническим интерфейсом.

Пример:

```ts
interface TaskGraphPort {
  capabilities(): Promise<TaskGraphCapabilities>
  get(id: TaskId): Promise<Task>
  ready(query: ReadyTaskQuery): Promise<TaskRef[]>
  claim(command: ClaimTaskCommand): Promise<ClaimResult>
  transition(command: TaskTransitionCommand): Promise<Task>
  dependencies(id: TaskId): Promise<TaskDependency[]>
  mutatePlan(command: PlanMutationCommand): Promise<PlanMutationResult>
}
```

Первый официальный backend: `BeadsTaskGraphAdapter`.

Но Core не знает слово Beads.

В будущем возможны:

- NativeGraphAdapter;
- GitHubIssuesGraphAdapter;
- LinearGraphAdapter;
- custom organization graph.

---

# 12. Task Board Integration

Task Board опционален.

```ts
interface TaskBoardPort {
  capabilities(): Promise<TaskBoardCapabilities>
  project(snapshot: TaskProjection): Promise<void>
  attachEvidence?(request: EvidenceProjection): Promise<void>
  requestHumanReview?(request: HumanReviewRequest): Promise<void>
  subscribe?(listener: TaskBoardListener): Disposable
}
```

Первый поддерживаемый адаптер может ориентироваться на существующий DSH Task Board, но архитектура не зависит от конкретного автора/пакета.

Если Task Board отсутствует, вкладка `My Work → Tasks` предоставляет минимальную projection из TaskGraph.

---

# 13. Team Work Domain

## 13.1. Role

Role — должность/функция.

Содержит:

- purpose;
- capability requirements;
- workflow permissions;
- prohibited actions;
- output contract;
- review contract;
- strategy modules;
- skill policy;
- model routing policy;
- learning policy.

---

## 13.2. Role Contract vs Role Strategy

### Contract — не изменяется Optimizer-ом

Примеры:

```text
Worker cannot approve own work
Reviewer cannot mutate implementation by default
Worker cannot push protected branch
```

### Strategy — эволюционируема

Примеры:

- как исследовать задачу;
- как выбирать тесты;
- как управлять контекстом;
- какие типичные ошибки избегать;
- как оформлять отчёт.

---

## 13.3. Agent Blueprint

Blueprint — конкретная конфигурация Role:

```yaml
id: backend-developer-default

role: backend-developer

modelPolicy:
  preferred: deepseek/flash
  fallback:
    - glm/...
  escalation:
    - frontier/...

reasoning: high

preset: code

permissions:
  - workspace.read
  - workspace.write
  - shell
  - tests

skills:
  - dotnet
  - git
  - testing

pool: workers
```

---

## 13.4. Agent Identity

Identity — долговечный «сотрудник»:

```text
Neo-1
role: backend-developer
blueprintRevision: b17
status: sleeping
```

Identity сохраняет:

- performance history;
- experience;
- role association;
- workspace overlays;
- session references;
- learning provenance.

---

## 13.5. Agent Instance / Runtime Handle

Runtime handle краткоживущий.

State:

```text
Sleeping
→ Waking
→ Running
→ Settling
→ Sleeping

Failure paths:
→ Failed
→ Revoked
→ Terminated
```

---

# 14. Elastic Pools

Поддерживаются отдельные pools:

```yaml
pools:
  workers:
    minActive: 0
    maxActive: 6

  reviewers:
    minActive: 0
    maxActive: 2

  planners:
    minActive: 0
    maxActive: 1

  optimizers:
    minActive: 0
    maxActive: 1
```

Дополнительно лимиты по роли:

```yaml
roles:
  backend:
    maxActive: 3

  frontend:
    maxActive: 2
```

И по workspace:

```yaml
workspace:
  maxWorkers: 4
  maxReviewers: 2
```

---

# 15. Что считается Active

Нельзя свести состояние к «agent running/idle».

Resource state:

```text
ModelActive
ToolActive
WaitingExternal
WaitingDependency
ReviewWaiting
Idle
Sleeping
```

Отдельные лимиты могут считать:

- active attempts;
- concurrent LLM calls;
- heavy tools;
- GPU/local model slots;
- provider rate-limit slots.

Например:

```yaml
limits:
  maxAttempts: 8
  maxConcurrentLlm: 4
  maxHeavyTools: 2
```

---

# 16. Scheduler

## 16.1. Lifecycle

Scheduler запускается при activation Controller-а, а не при открытии вкладки UI.

Startup:

```text
Acquire Controller Lease
→ Open stores
→ Load configuration
→ Reconcile incomplete operations
→ Reconcile leases/attempts
→ Read ready tasks
→ Fill capacity
→ Subscribe events
→ Running
```

---

## 16.2. Event-driven + Safety Reconcile

Основной путь:

```text
event
→ scheduler.kick()
```

События:

- task.created;
- task.ready;
- dependency.closed;
- review.requested;
- review.rejected;
- agent.idle;
- agent.failed;
- config.changed;
- workspace.enabled.

Дополнительно safety reconcile по таймеру для:

- пропущенных событий;
- crash;
- stale lease;
- внешних изменений TaskGraph;
- controller failover.

---

## 16.3. Assignment Function

Кандидаты фильтруются:

```text
ready task
∩ workspace enabled
∩ role eligibility
∩ capability eligibility
∩ pool capacity
∩ workspace capacity
∩ provider/model availability
∩ budget
∩ security policy
```

Затем ranking:

```text
priority
+ aging
+ workspace fairness
+ deadline
+ backlog pressure
+ locality/cache benefits
```

Algorithm обязан быть deterministic при одинаковом state.

---

## 16.4. Fairness

Глобальный Team не должен позволять одному workspace занять весь pool.

Используется weighted fair scheduling / deficit round robin или эквивалент.

Конфигурация:

```yaml
workspaceScheduling:
  z2p:
    weight: 2
    maxWorkers: 4

  muxtv:
    weight: 1
    maxWorkers: 3
```

---

## 16.5. Adaptive Capacity

Review backlog может временно уменьшать worker concurrency и увеличивать reviewer capacity в рамках разрешённых границ.

```text
if reviewQueue grows faster than service rate:
    reduce worker admissions
    increase reviewer admissions
```

Adaptive policy должна быть bounded и объяснимой.

---

# 17. Lease, Attempt и Fence

Каждая реальная работа исполняется в Attempt.

```text
Task
  ↓
Attempt
  ↓
Lease
  ↓
Fence Token
```

Fence предотвращает late-result corruption.

Пример:

```text
Attempt A1 fence=17
agent crashed
task reassigned
Attempt A2 fence=18

поздний A1 result arrives
→ rejected: stale fence
```

---

# 18. Formal State Machines

## 18.1. Task

```text
Draft
→ Planned
→ Ready
→ Assigned
→ Executing
→ AwaitingReview
→ Reviewing
→ Approved
→ Integrating
→ Done
```

Side states:

```text
Blocked
ChangesRequested
Failed
Cancelled
Superseded
NeedsAttention
```

---

## 18.2. Attempt

```text
Created
→ Leased
→ Starting
→ Running
→ Settling
→ Completed
```

Failure:

```text
Failed
TimedOut
Cancelled
Revoked
Stale
```

---

## 18.3. Review

```text
Queued
→ Claimed
→ Reviewing
→ Approved
```

Alternatives:

```text
Rejected
NeedsEvidence
Escalated
Cancelled
```

---

# 19. Git / Worktree Execution Model

Для coding workspace каждый concurrent attempt получает isolated worktree.

```text
Task
→ pin base SHA
→ create worktree
→ branch
→ execute
→ build/test
→ evidence
→ review exact head SHA
```

Review approval относится к:

```text
reviewedHeadSha
reviewedDiffHash
```

Если HEAD изменился после approve:

```text
approval invalid
→ review again
```

---

# 20. Integrator

Reviewer не равен Integrator.

Integrator выполняет максимально детерминированный процесс:

```text
Approved immutable result
→ check branch/base freshness
→ rebase/merge
→ required verification
→ finalize TaskGraph
```

LLM подключается только если:

- merge conflict требует семантического решения;
- policy разрешает AI resolution;
- otherwise human escalation.

---

# 21. Context Fabric

## 21.1. Назначение

Context Fabric — единственный владелец model-visible context MyWork.

Memory providers, TaskGraph, Skills и plugins не должны автоматически вставлять свои данные в prompt.

Они возвращают кандидаты. Context Fabric решает, что реально будет материализовано.

---

## 21.2. Progressive Disclosure: L0 / L1 / L2

Каждый большой context object желательно представлять уровнями:

```text
L0 Abstract
L1 Overview
L2 Full Content
```

Пример:

```text
Skill
L0: name + one-line purpose
L1: usage/constraints
L2: full body
```

Большинство items сначала доступны как L0/L1.

---

## 21.3. Context classes

Базовые классы:

- policy;
- role-contract;
- task-contract;
- execution-state;
- workspace-canon;
- skill;
- dependency-result;
- memory;
- session-reference;
- raw-evidence.

Тип остаётся расширяемым string namespace.

---

## 21.4. ContextCandidate

```ts
interface ContextCandidate {
  uri: string
  source: string
  kind: string
  scopes: ScopeRef[]
  level: "L0" | "L1" | "L2"

  relevance?: number
  trust?: string

  revision?: string
  contentHash?: string
  estimatedTokens?: number

  validFrom?: string
  validUntil?: string

  provenance: ProvenanceRef[]

  content?: ContextContent
  materializeRef?: string

  attributes?: Record<string, unknown>
}
```

---

## 21.5. Context Provider

```ts
interface ContextProviderPort {
  capabilities(): Promise<ContextProviderCapabilities>

  discover(
    request: ContextDiscoveryRequest
  ): Promise<ContextCandidate[]>

  materialize(
    request: ContextMaterializeRequest
  ): Promise<ContextMaterialized>
}
```

Providers:

- TaskContextProvider;
- WorkspaceCanonProvider;
- SkillContextProvider;
- MemoryContextProvider;
- DependencyResultProvider;
- DshSessionReferenceProvider;
- plugin-defined providers.

---

## 21.6. Context Budget Manager

Бюджет рассчитывается от реального model route/context window.

Пример policy:

```yaml
contextPolicy:
  mandatory:
    maxFraction: 0.15

  workspaceCanon:
    targetFraction: 0.08

  memory:
    targetFraction: 0.08

  dependencies:
    targetFraction: 0.06

  workingReserve:
    fraction: 0.45

  safetyReserve:
    fraction: 0.18
```

Это не жёсткая гарантия; mandatory context может превысить лимит и тогда execution admission блокируется с понятной ошибкой.

---

## 21.7. Context Snapshot

Перед началом Attempt создаётся immutable `ContextSnapshot`.

Содержит:

```text
taskRevision
roleRevision
blueprintRevision
workflowRevision
modelRoute
toolSurface
skillRevisions
memoryQuery
selectedContextItems
contentHashes
tokenEstimates
materialization timestamps
```

Это критический audit artifact.

---

## 21.8. Integration with DSH System Prompt

Для DSH adapter используется scoped `ctx.systemPrompt` / dynamic context механизм.

MyWork не формирует один giant system prompt.

Разделение:

```text
Role Contract → prompt section
Task/Execution Context → dynamic context
Retrieved memory → dynamic context
Workspace overlays → dynamic context
Tools → scoped tool provider
```

---

# 22. Session / Episode Architecture

## 22.1. Иерархия

```text
Agent Identity
  ↓
Task Episode
  ↓
Attempt
  ↓
Session Window(s)
```

---

## 22.2. Default Session Policy

Baseline:

```text
Worker:
fresh Session per Attempt

Reviewer:
fresh Session per Review

Task Setter:
fresh Session per planning operation

Fast Role Learner:
fresh Session per reflection

Sleep Optimizer:
fresh Session per optimization run
```

---

## 22.3. Reject Flow

После Reject:

```text
same Task
same Agent Identity (если policy не требует reassign)
same worktree
NEW Attempt
NEW Session
```

Новая Session получает checkpoint предыдущей попытки и review findings.

Не переносится весь transcript.

---

## 22.4. Task Checkpoint Capsule

Структурированный checkpoint:

```yaml
goal: ...
decisions:
  accepted: [...]
  rejected:
    - approach: ...
      reason: ...

changedArtifacts: [...]

git:
  baseSha: ...
  headSha: ...

verification:
  passed: [...]
  failed: [...]

review:
  findings: [...]

unresolved: [...]

anchors:
  paths: [...]
  commits: [...]
  issues: [...]
  errors: [...]

historyRefs:
  - dsh://session/...
  - artifact://...
```

---

## 22.5. Session Rollover

Если одна попытка сама по себе становится слишком большой:

```text
Attempt A1
  Session Window 1
      ↓ pressure
  Checkpoint
      ↓
  Session Window 2
```

Attempt остаётся тем же.

Новый Attempt создаётся только при логическом retry/reject/reassignment/recovery.

---

## 22.6. Context Pressure Strategy

Порядок:

1. удалить runtime noise, не нужный модели;
2. deterministic prune oversized tool outputs;
3. offload raw output в Artifact Store;
4. заменить raw на summary + ArtifactRef;
5. dematerialize L2 context, доступный повторно;
6. сохранить exact anchors;
7. вызвать DSH compaction при необходимости;
8. сделать Session rollover при ухудшении working-set quality.

---

# 23. Memory Fabric

## 23.1. Memory не является монолитной БД

Архитектурное разделение:

```text
Task Graph       → работа
Session Store    → raw episodes
Artifact Store   → evidence
Skill Registry   → procedures
Workspace Canon  → authoritative project knowledge
Memory Fabric    → retained semantic experience/facts
Role History     → evolution
```

---

## 23.2. Memory scopes

Базовые scope types:

- global;
- team;
- workspace;
- role;
- agent;
- task;
- attempt.

Но `ScopeRef.type` остаётся string для plugins.

```ts
interface ScopeRef {
  type: string
  id: string
  parent?: ScopeRef
}
```

---

## 23.3. Memory kinds

Базовые:

- fact;
- decision;
- constraint;
- preference;
- experience;
- observation;
- procedure;
- failure-pattern;
- reference.

`kind` расширяем.

---

## 23.4. Memory lifecycle

```text
Raw Evidence
→ Candidate Extraction
→ Scope Classification
→ Source Trust
→ Deduplication
→ Conflict Detection
→ Validation
→ Active
→ Reinforce / Update / Supersede / Invalidate
→ Stale
→ Archived
```

---

## 23.5. Provenance

Каждая долговременная memory имеет provenance.

```yaml
id: mem-8291
statement: ...

scope:
  type: workspace
  id: z2p

sources:
  - uri: ...
    revision: ...
    type: repository

createdBy:
  component: role-learner
  run: ...

trust: high
confidence: ...

validity:
  from: ...
  until: null

supersedes:
  - mem-211
```

---

## 23.6. Trust classes

Минимальный baseline:

```text
Human explicit decision       → very-high
Deterministic CI/test         → very-high
Approved reviewer finding     → high
Canonical workspace config    → high
Worker observation            → medium
Generated summary             → medium
README/prose                  → low/medium
External web content          → low
Arbitrary tool output         → low
```

Низкодоверенный input не может автоматически изменить Role Contract/security policy.

---

## 23.7. Hot / Warm / Cold

```text
HOT
малый всегда релевантный слой

WARM
retrieval on demand

COLD
raw/searchable archive
```

Большинство raw session history — COLD.

---

## 23.8. Memory Provider Port

```ts
interface MemoryProviderPort {
  capabilities(): Promise<MemoryCapabilities>

  retain(
    request: MemoryRetainRequest
  ): Promise<MemoryRetainResult>

  recall(
    request: MemoryRecallRequest
  ): Promise<MemoryRecallResult>

  reflect?(
    request: MemoryReflectRequest
  ): Promise<MemoryReflectResult>

  resolve?(
    ref: MemoryRef
  ): Promise<MemoryRecord>

  health(): Promise<HealthResult>
}
```

Adapters:

- NativeMemoryAdapter;
- OpenVikingAdapter;
- HindsightAdapter;
- MCP-based adapter where acceptable;
- DisabledMemoryAdapter.

---

## 23.9. Memory routing

Один primary writer на scope.

```yaml
memoryRoutes:
  - match:
      scope: workspace
    primary: openviking

  - match:
      scope: role
    primary: native

  - match:
      scope: user
    primary: hindsight
```

Read federation возможно позже, но write ownership должен быть однозначным.

---

# 24. Skills

Skills хранят procedural knowledge.

Skill registry отделён от Memory.

Skill metadata:

```text
name
description
scope
version
trust
compatibility
usage stats
last validated
status
```

Full body загружается только при materialization.

Lifecycle:

```text
Candidate
→ Active
→ Stale
→ Archived
```

---

# 25. Role Learning Architecture

## 25.1. Два темпа обучения

```text
FAST LOOP
после значимых задач/reject

SLOW LOOP
во время idle/schedule/manual
```

---

## 25.2. Fast Learner

Запускается отдельно от Worker.

Input:

- Role revision;
- task;
- acceptance;
- trajectory/evidence;
- tests;
- reviewer findings;
- repair rounds;
- human feedback.

Output:

```text
No learning
Workspace memory candidate
Experience note
Skill create candidate
Skill patch candidate
Role strategy patch candidate
```

Fast Learner по умолчанию не изменяет Role Core напрямую.

---

## 25.3. Bounded Patches

Изменения должны быть patch-based:

```diff
- Run appropriate tests.
+ Run the smallest relevant tests first.
+ Expand to affected suite before submission.
```

Не полный prompt rewrite.

---

## 25.4. Role Sleep Optimizer

Периодический optimizer анализирует пакет исторических данных:

```text
successes
failures
review loops
cost
latency
tool usage
scope violations
model routing
```

Он может:

- consolidate skills;
- improve strategy modules;
- remove duplicates;
- propose Role Core changes;
- propose workspace overlay changes.

---

## 25.5. Modular Strategy

Role Strategy разбивается:

```text
PlanningStrategy
ContextStrategy
ToolUseStrategy
ExecutionStrategy
RecoveryStrategy
VerificationStrategy
CompletionStrategy
```

Optimizer изменяет минимальный модуль.

---

## 25.6. Curator

Role Curator:

- обнаруживает duplicate skills;
- помечает stale;
- проверяет conflicts;
- compresses;
- архивирует редко используемые;
- предлагает promotion recurring lessons.

---

## 25.7. Evaluation / Promotion

Candidate progression:

```text
Draft
→ Offline Evaluation
→ Shadow
→ Canary
→ Stable
```

или:

```text
Rejected
RolledBack
Deprecated
```

Metrics:

- first-pass acceptance;
- repair loops;
- regression;
- scope violations;
- cost;
- input tokens;
- latency;
- human intervention.

---

## 25.8. Poisoning protection

Learning candidate проходит:

```text
source classification
→ trust evaluation
→ scope check
→ conflict check
→ validation
→ apply
```

Содержимое внешних web/tool inputs само по себе не может стать high-trust permanent instruction.

---

# 26. Review Architecture

Pipeline:

```text
Deterministic Gates
→ LLM Review
→ Optional quorum
→ Approval / Rejection
```

Deterministic gates:

- build;
- tests;
- lint;
- policy;
- required artifacts;
- base/head validity.

Reviewer получает evidence package, а не обязательно весь Worker transcript.

Self-review запрещён по default.

Structured finding:

```ts
interface ReviewFinding {
  severity: string
  category: string
  message: string
  evidenceRefs: string[]
  location?: ArtifactLocation
  remediation?: string
}
```

---

# 27. Reviewer Pools

Reviewers имеют отдельный pool и concurrency.

Поддерживаются:

```text
single reviewer
quorum N
specialized review lanes
```

Например:

```yaml
review:
  lanes:
    - role: code-reviewer
    - role: security-reviewer
      when: task.labels contains "security"
```

---

# 28. Human-in-the-Loop

Workspace autonomy level:

```text
L0 manual
L1 auto execute, human review
L2 AI review, human integration
L3 autonomous through integration
```

Кроме уровня есть operation-specific gates:

- dependency upgrades;
- schema migrations;
- security changes;
- release;
- production access.

---

# 29. Model Routing

Agent Blueprint не обязан фиксировать одну модель.

```yaml
modelPolicy:
  preferred:
    provider: deepseek
    model: flash

  fallback:
    - provider: glm
      model: ...

  escalation:
    - provider: frontier
      model: ...
```

Triggers:

- repeated failure;
- review loop;
- complexity;
- context overflow;
- provider outage;
- budget policy.

Каждый actual route записывается в Attempt provenance.

---

# 30. Budgeting

Поддерживаются лимиты:

```text
maxTokensPerTask
maxCostPerTask
maxAttempts
maxReviewLoops
maxPlannerCalls
maxOptimizerCostPerDay
workspaceDailyBudget
providerDailyBudget
```

При превышении:

```text
BudgetExceeded
→ pause / escalate / human decision
```

---

# 31. Security

Role permissions — runtime enforcement, не prompt.

Domains:

```text
filesystem
shell
network
mcp
secrets
git
task transitions
review transitions
production
```

Reviewer по умолчанию:

```text
read workspace
read diff
run verification
no implementation writes
```

Blueprint хранит credential references, но не секреты.

---

# 32. Artifact Store

Artifact Store хранит immutable/append-only evidence.

Типы:

- diff;
- commit;
- build log;
- test report;
- screenshot;
- benchmark;
- worker report;
- review verdict;
- planner DAG;
- context snapshot;
- checkpoint.

```ts
interface ArtifactStorePort {
  put(request: ArtifactPutRequest): Promise<ArtifactRef>
  get(ref: ArtifactRef): Promise<Artifact>
  openStream?(ref: ArtifactRef): Promise<ReadableStream>
}
```

---

# 33. Observability

Correlation dimensions:

```text
workspaceId
taskId
attemptId
reviewId
agentId
sessionId
roleRevision
workflowRevision
controllerInstance
correlationId
causationId
```

Metrics:

- ready queue depth;
- review queue depth;
- worker utilization;
- reviewer utilization;
- task latency;
- review latency;
- first-pass acceptance;
- repair count;
- token usage;
- cost;
- context composition;
- stale attempts;
- role-learning changes;
- provider failures.

---

# 34. Audit

Audit ≠ log.

Audit append-only и не очищается обычной log rotation.

Events:

```text
task.created
task.modified
attempt.assigned
attempt.revoked
review.rejected
review.approved
role.revised
skill.patched
optimizer.promoted
human.override
controller.failover
```

---

# 35. Versioning

Immutable revisions:

```text
WorkflowRevision
RoleRevision
RoleStrategyRevision
SkillRevision
AgentBlueprintRevision
ContextSnapshotRevision
ConfigRevision
MemoryRevision
```

Running Attempt всегда frozen на resolved revisions.

Изменение Blueprint во время Running не влияет на текущую попытку.

---

# 36. Stable Ports / Adapter Architecture

Core packages не импортируют конкретные integrations.

Основные Ports:

```text
AgentRuntimePort
SessionPort
ModelCatalogPort
TaskGraphPort
TaskBoardPort
ContextProviderPort
MemoryProviderPort
SkillProviderPort
WorkspacePort
ArtifactStorePort
EventBusPort
LeaseStorePort
```

---

# 37. Adapter Capability Negotiation

Каждый adapter регистрирует manifest:

```json
{
  "adapterId": "hindsight",
  "kind": "memory",
  "contractVersion": "memory/v1",
  "capabilities": {
    "retain": true,
    "recall": true,
    "reflect": true,
    "structuredScopes": true,
    "versioning": false,
    "events": true
  }
}
```

Core не содержит provider-specific branches.

---

# 38. Adapter SDK

Пакет `@dsh-mywork/adapter-sdk` должен содержать:

- TypeScript contracts;
- registration helpers;
- compatibility helpers;
- capability schema;
- conformance tests;
- error helpers;
- observability hooks;
- test fakes.

---

# 39. Adapter Conformance Kit

Для каждого Port существует обязательный contract test suite.

Memory:

```text
retain
recall
scope isolation
idempotency
timeouts
cancellation
invalid ref
backend unavailable
version mismatch
```

TaskGraph:

```text
ready correctness
claim atomicity
dependency cycles
idempotency
revision conflict
cancel
reopen
```

AgentRuntime:

```text
create
resume
stop
status
late event
cancellation
process restart
```

---

# 40. Application API

Одна бизнес-логика обслуживает все transports.

```text
MyWorkApplication
├─ Cordis service
├─ Local HTTP API
├─ Web RPC
├─ CLI
└─ External MCP tools
```

MCP — external tool surface, не внутренний coordination protocol.

---

# 41. HTTP / Controller API

Минимальные endpoints:

```text
GET  /v1/capabilities
GET  /v1/adapters
GET  /v1/health

GET  /v1/workspaces
GET  /v1/teams
GET  /v1/roles
GET  /v1/agents

GET  /v1/tasks
GET  /v1/tasks/{id}
POST /v1/tasks/{id}/commands

GET  /v1/attempts/{id}
GET  /v1/reviews/{id}

POST /v1/context/plan
POST /v1/context/materialize

POST /v1/memory/retain
POST /v1/memory/recall
POST /v1/memory/reflect

GET  /v1/artifacts/{id}

GET  /v1/events?after=<cursor>
```

Mutation endpoints принимают idempotency key.

---

# 42. Canonical Result / Error

```ts
type Result<T> =
  | {
      ok: true
      value: T
      meta: OperationMeta
    }
  | {
      ok: false
      error: MyWorkError
      meta: OperationMeta
    }
```

Error codes:

```text
ADAPTER_UNAVAILABLE
CAPABILITY_UNSUPPORTED
CONTRACT_MISMATCH
TASK_CONFLICT
STALE_REVISION
LEASE_LOST
STALE_FENCE
CONTEXT_BUDGET_EXCEEDED
MEMORY_BACKEND_ERROR
SESSION_NOT_FOUND
BUDGET_EXCEEDED
UNSCHEDULABLE
SECURITY_DENIED
```

---

# 43. Event Envelope

```json
{
  "schema": "mywork.event/v1",
  "eventId": "...",
  "sequence": 1842,
  "workspaceId": "z2p",
  "type": "task.review.requested",
  "correlationId": "...",
  "causationId": "...",
  "occurredAt": "...",
  "payload": {}
}
```

Event stream используется UI, Scheduler, Audit, Metrics и plugins.

---

# 44. Adapter Registry

Conceptual DSH registration:

```ts
ctx.myWorkAdapters.register({
  kind: "memory",
  id: "hindsight",
  contractVersion: "memory/v1",
  create(ctx) {
    return new HindsightAdapter(ctx)
  }
})
```

MyWork автоматически обнаруживает compatible adapters.

---

# 45. Package Layout

Предлагаемое разбиение:

```text
@dsh-mywork/contracts
@dsh-mywork/core
@dsh-mywork/adapter-sdk
@dsh-mywork/controller
@dsh-mywork/dsh-adapter
@dsh-mywork/beads-adapter
@dsh-mywork/taskboard-adapter-*
@dsh-mywork/memory-native
@dsh-mywork/memory-openviking
@dsh-mywork/memory-hindsight
@dsh-mywork/artifact-local
@dsh-mywork/web
@dsh-mywork/cli
```

---

# 46. Suggested Internal Bounded Contexts

```text
control/
work/
team/
scheduler/
execution/
review/
integration/
context/
session/
memory/
learning/
governance/
adapters/
audit/
observability/
```

Границы должны совпадать с ownership, а не просто быть папками.

---

# 47. Storage Model

Минимальные MyWork entities:

```text
controllers
workspaces
teams
roles
role_revisions
skills
skill_revisions
agent_blueprints
agent_blueprint_revisions
agent_identities
workflow_revisions
task_bindings
attempts
leases
reviews
context_snapshots
checkpoints
artifacts
memory_routes
learning_runs
optimizer_runs
audit_events
outbox
inbox_dedup
```

Для SQLite рекомендуется WAL, transactional outbox и explicit schema migrations.

---

# 48. Outbox / Inbox

Для межпроцессных/adapter events:

- mutation + outbox event коммитятся вместе;
- publisher асинхронно доставляет event;
- consumer хранит eventId dedup.

Это снижает риск «state обновили, событие потеряли».

---

# 49. Recovery Scenarios

## Claim прошёл, Attempt не создался

Reconciler обнаруживает claim без attempt и завершает saga.

## Attempt есть, Agent не существует

Lease revocation → new attempt/recovery policy.

## Agent вернулся после revoke

Fence mismatch → result ignored.

## Controller умер

Lease expires → другой controller получает epoch → reconcile.

## Task Board недоступен

Execution продолжается; projection marked degraded.

## Memory backend недоступен

Core execution не должен останавливаться, если memory policy допускает degraded mode.

---

# 50. Deadlock / Livelock Detection

Health detector ищет:

```text
dependency cycle
no eligible agent
review loop
repeated failure
budget loop
provider unavailable
task stuck
orphan attempt
```

Результат:

```text
NeedsAttention
```

с диагностикой.

---

# 51. Cancellation / Preemption

Команды:

```text
Pause
Cancel
StopAfterCurrentTool
Reassign
Retry
```

Cancel:

- revoke lease;
- increment fence;
- stop runtime;
- keep worktree according to policy;
- persist checkpoint/evidence;
- update TaskGraph.

---

# 52. Cross-Workspace Isolation

Global Blueprint/Role может переиспользоваться.

Но runtime instance/context/memory overlay — workspace scoped.

```text
Backend Role
├─ Z2P runtime namespace
├─ MuxTV runtime namespace
└─ Toolchain runtime namespace
```

Cross-workspace dependency edges в v0.1 запрещены; разрешены только artifact/reference links.

---

# 53. Token / Context Accounting

Каждый model call должен учитывать:

```text
system
role
task
workspace
memory
skills
history
tools
cached
output
```

Attempt metrics:

```text
initial input
peak input
retrieval count
offloaded tool bytes/tokens
compactions
rollovers
total input/output
cost
```

Это позволяет измерять реальную выгоду MyWork.

---

# 54. UI Architecture

Основные разделы:

```text
Overview
Tasks
Team Work
Workflows
Roles
Role Lab
Activity
Audit
Diagnostics
Settings
```

---

# 55. Team Work UI

Показывать:

| Agent | Role | Model | State | Workspace | Current |
|---|---|---|---|---|---|
| Neo-1 | Backend | Flash | Working | Z2P | BD-125 |
| Argus-1 | Reviewer | Sol | Reviewing | Z2P | BD-120 |
| Atlas | Planner | Astra | Sleeping | — | — |

Header:

```text
Workers      3 / 6 active
Reviewers    1 / 2 active
Planners     0 / 1 active
Optimizers   0 / 1 active

Ready        7
Review       3
Blocked      2
Sleeping     8
```

---

# 56. Role Lab UI

Показывает:

```text
Role revision history
Skill history
Failure clusters
Optimizer runs
Candidate diffs
Eval metrics
Shadow/canary progress
Promote
Rollback
```

---

# 57. Diagnostics / Doctor

Каждый adapter проверяется:

```text
installed version
contract version
required capabilities
connectivity
authentication
workspace isolation
events
timeouts
recovery
```

Пример:

```text
DSH Runtime
✓ agents
✓ sessions
✓ systemPrompt
✓ status events

Beads
✓ ready
✓ claim
✓ deps

OpenViking
✓ recall
✓ retain
✗ reflect
```

Если critical capability отсутствует, MyWork не должен «угадывать».

---

# 58. Testing Architecture

С первого дня:

```text
FakeDshRuntime
FakeTaskGraph
FakeMemory
FakeClock
FakeTaskBoard
FakeArtifactStore
FakeProvider
```

Test cases:

```text
crash after claim
duplicate event
late agent result
lease expiry
controller failover
task revision conflict
review reject
model outage
dependency release
memory outage
board outage
worktree conflict
context rollover
```

---

# 59. Property / Invariant Tests

Минимальные invariants:

```text
Task has at most one authoritative active execution lease.

Stale fence cannot mutate current task.

Done Task cannot have active Attempt.

Worker cannot approve own output.

Approval is invalid when reviewed revision changes.

Running Attempt keeps frozen revisions.

Workspace memory never leaks to another workspace unless explicitly shared.

Task Board outage cannot corrupt TaskGraph authority.

Duplicate event is idempotent.
```

---

# 60. Security Tests

Обязательные:

- filesystem escape;
- worktree escape;
- secret exfiltration attempts;
- permission escalation;
- malicious memory content;
- prompt injection → learning poisoning;
- stale reviewer approval;
- fake adapter capabilities;
- forged event/fence.

---

# 61. Migration / Upgrade

Каждый persistent schema имеет `schemaVersion`.

Upgrade:

```text
backup
→ migrate
→ verify
→ activate
```

Нужны:

- migration journal;
- export/import;
- repair command;
- rollback policy;
- adapter contract version checks.

---

# 62. `dsh-mywork v0.1` Scope

v0.1 не должен быть demo. Он должен давать законченный operational core.

Обязательно:

1. Embedded Controller.
2. Resident Controller mode.
3. Controller lease/failover baseline.
4. Global / isolated / inherit workspace modes.
5. Own Team Work.
6. Role + Agent Blueprint + Agent Identity.
7. DSH model/provider selection.
8. Worker/Reviewer elastic pools.
9. Task Setter.
10. Beads TaskGraph adapter.
11. One production Task Board adapter + Null adapter.
12. Event-driven Scheduler + reconciler.
13. Attempts/leases/fences.
14. Worktree isolation.
15. Deterministic verification gates.
16. Independent Reviewer.
17. Reject → new attempt flow.
18. Integrator baseline.
19. Context Fabric.
20. L0/L1/L2 support.
21. Context budgets/snapshots.
22. Task-scoped Sessions.
23. Session checkpoint/rollover.
24. Memory Fabric interfaces.
25. Native Memory provider.
26. At least one external Memory adapter.
27. Fast Role Learner.
28. Role Sleep Optimizer baseline.
29. Immutable Role/Blueprint revisions.
30. Append-only Audit.
31. Artifact Store.
32. Stable Ports/Adapter SDK.
33. Capability negotiation.
34. Adapter conformance tests.
35. Diagnostics/Doctor.
36. Token/context metrics.
37. Crash recovery.
38. Budget guards.
39. Security permission enforcement.

---

# 63. Non-Goals v0.1

Не включать как обязательный baseline:

- distributed multi-machine scheduler;
- cross-workspace dependency DAG;
- arbitrary remote untrusted adapters;
- auto-modification of security/RBAC contracts;
- fully autonomous production deployment;
- unrestricted self-modifying scheduler;
- requirement to use any one memory backend;
- requirement to use any one Task Board.

---

# 64. Future Extensions

После v0.1:

- multi-host/distributed controller;
- remote workers;
- artifact caching across workspaces;
- advanced adaptive pools;
- multi-reviewer consensus;
- per-task model bidding;
- cost-aware route optimizer;
- organization-wide memory;
- workflow evolution experiments;
- additional TaskGraph adapters;
- standardized ecosystem ABI for third-party MyWork modules.

---

# 65. Architectural Decision Summary

## ADR-001
Task Setter независим от Team Work.

## ADR-002
Scheduler — deterministic resident service.

## ADR-003
Beads/TaskGraph — canonical work graph; Task Board — projection.

## ADR-004
Agent Identity долговечна; Session краткоживущая.

## ADR-005
Fresh Session per Attempt — default.

## ADR-006
Context формируется через Context Fabric.

## ADR-007
Memory не равна Session history.

## ADR-008
Role Contract immutable для optimizer; Strategy/Skills эволюционируют.

## ADR-009
Review независим от Worker.

## ADR-010
Concurrent coding execution изолируется worktrees.

## ADR-011
Approval привязан к immutable result revision.

## ADR-012
Core зависит от Ports, не от конкретных plugins.

## ADR-013
Adapters объявляют capabilities и проходят conformance.

## ADR-014
MCP не используется как внутренняя scheduler bus.

## ADR-015
Все критические changes имеют provenance/version/audit.

---

# 66. Полный end-to-end workflow

```text
USER
 │
 ▼
CREATE GOAL
 │
 ▼
Task Setter
 │  fresh session
 │  frontier model
 │
 ▼
Validate Plan Mutation
 │
 ▼
TaskGraph Commit
 │
 └── Task Setter exits
          │
          ▼
   Scheduler event
          │
          ▼
   Select READY task
          │
          ▼
 eligibility/capacity/budget/security
          │
          ▼
 Claim + Attempt + Lease + Fence
          │
          ▼
 Worktree prepare
          │
          ▼
 Context Plan
          │
          ▼
 Context Snapshot
          │
          ▼
 Wake Worker
          │
          ▼
 Execute
          │
          ├─ context pressure → prune/offload/rollover
          │
          ▼
 Evidence + Checkpoint
          │
          ▼
 Worker sleeps
          │
          ├──────────────► Fast Role Learner
          │
          ▼
 Deterministic Gates
          │
          ▼
 Review Queue
          │
          ▼
 Wake Reviewer
          │
      ┌───┴───────────┐
      │               │
    REJECT          APPROVE
      │               │
      ▼               ▼
 new Attempt       Integrator
 fresh Session         │
 same Identity         ▼
 same worktree     merge/verify
      │               │
      └──── review     ▼
                     DONE
                       │
                       ├─ metrics
                       ├─ memory capture
                       ├─ audit
                       └─ future Role Sleep optimization
```

---

# 67. Ключевой продуктовый результат

Пользователь должен воспринимать систему так:

> Я настраиваю собственную AI-команду: роли, модели, количество одновременно работающих исполнителей и ревьюеров, правила review и автономности. Я создаю цель или задачу. Отдельный планировщик строит работу. Дальше `DSH My Work` сам видит готовые задачи, будит нужных агентов, изолирует их работу, проверяет результат, отправляет на независимый review, возвращает исправления, ведёт память и постепенно улучшает навыки ролей. Агенты не висят постоянно и не тащат месяцы chat history — каждая работа получает ровно тот контекст, который ей нужен.

---

# 68. Использованные архитектурные ориентиры

При формировании этого baseline учтены идеи и текущие на сентябрь 2026 подходы из:

- DeepSeek Harness: Cordis capability seams, Agent/Session lifecycle, scoped system prompt/context, Skills, compaction, tool-result pruning, durable events.
- существующих DSH Agent Team / Task Board решений: durable members, ready-task wake-up, scheduler patterns, task review/reject, status/event integration.
- Beads: durable task graph, ready/claim, dependencies, project memory.
- Hermes Agent: isolated subagent context, searchable session history, dual compression, lean live context, background skill/memory learning, pluggable context engines.
- OpenViking: context database, L0/L1/L2 progressive disclosure, session-to-memory extraction, workspace isolation, shared integration core + thin host adapters.
- Hindsight: retain/recall/reflect, memory banks, scoped durable memory.
- Letta-style memory: small hot memory + larger external/searchable memory, durable/versioned knowledge.
- SkillOpt / SkillOpt-Sleep: bounded skill edits, offline consolidation/evaluation.
- modular self-improvement research: optimize functional strategy modules rather than monolithic prompts.
- Codex-style parallel work: isolated Git worktrees and immutable result review.
- workflow автора видео: отдельная сильная модель для постановки/структурирования задач; рольвая команда, которая не обязана постоянно работать; Beads/task tracker как durable coordination layer; минимизация orchestration/context overhead.

Видео, обсуждавшееся при проектировании, имеет релевантные главы примерно:
- 50:24 — команда ролей;
- 59:00 — Beads / task tracker;
- 1:07:30 — orchestration overhead;
- 1:16:01 — отдельный Harness / большое количество subagents;
- 1:30:21 — минимальный режим и agent channel.

---

# 69. Финальный architectural stance

`DSH My Work` должен проектироваться не как «умный чат с несколькими персонажами», а как **надёжная локальная orchestration platform**.

В ней:

- работа существует независимо от разговоров;
- planning отделён от execution;
- scheduler отделён от LLM;
- Identity отделена от Session;
- context отделён от memory;
- memory отделена от raw history;
- review отделён от implementation;
- UI отделён от Controller;
- Core отделён от integrations;
- Role learning отделён от security contracts;
- долговременное состояние всегда versioned, scoped и audit-able.

Если эти границы соблюдены, `dsh-mywork` сможет переживать изменение конкретных DSH plugins, task boards, memory systems и моделей без переписывания ядра и сможет стать не ещё одним плагином, а **универсальным orchestration/control-plane слоем для экосистемы DSH**.
