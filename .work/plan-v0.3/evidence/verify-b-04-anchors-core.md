# verify-b-04 · якоря core (review/security/scheduler/budget/board/context/skill/memory)

Метод: read/grep по первоисточникам `packages/core/src/*.ts`, плану не верил. Все 8 файлов существуют
(review 302, security 592, scheduler 769, budget 472, board 566, context 1408, skill 1196, memory 1698 строк).
Номера сверены 1:1, для диапазонов проверены обе границы. Изменён только этот файл.

## 1. review.ts — ПОДТВЕРЖДЕНО (6/6)
- `:109` `export function assertReviewerIndependence(` — докблок `:104-108` «Refuse a review performed by the agent that produced the work (§13.2)», отказ `self-*` при `workerAgentId === reviewerAgentId` `:113-120`.
- `:129` `export function assertReviewerReadOnly(permissions: readonly Permission[], meta)` — «Refuse a reviewer that can mutate the implementation it reviews (§13.2)» `:124-128`; отказ на `'workspace.write'` `:130-137`.
- `:146` `export function isReviewApprovalCurrent(review: Review, artifact: ReviewedArtifact): boolean` — `:147` `state === 'approved' && sameArtifact(...)`.
- `:157` `export function assertReviewApprovalCurrent(` (`:157-161`), `:162` переиспользует `isReviewApprovalCurrent`, иначе `STALE_REVISION` `:163-173`. Якорь `21-STEPS-execution.md:457,527` верен.
- `:182` `export function transitionReview(review, command, meta): Result<ReviewTransition>` — CAS-ревизия `:187-188`, матрица `:190-197`.
- `:42` `reviewing: ['approved', 'rejected', 'needs-evidence', 'escalated', 'cancelled'],` — команда `21-STEPS-execution.md:542` (`-Pattern "reviewing: \["` → `:42`) точна.
- Бонус: `REVIEW_TRANSITIONS` `:39-48` (план `:39-49` ✓), `REVIEW_STATES_REQUIRING_FINDINGS` `:51` ✓. Машина — `:39-197`, «чистая» (без store/clock) — верно.
- Оговорка (info): Select-String по `isReviewApprovalCurrent|assertReviewApprovalCurrent` даёт **три** строки — `:146`, `:157` и вызов `:162`; `21-STEPS-execution.md:527` называет только две.

## 2. security.ts — ПОДТВЕРЖДЕНО (4/4)
- `:130` `const boundaryRoot = grant.worktreeRoot ?? grant.workspaceRoot` — дословно совпадает с `21-STEPS-execution.md:24`; `:220` кладёт `boundaryRoot` в результат.
- `:203-207` отказ `worktree-escape`: `:203` условие `grant.worktreeRoot !== undefined && !isWithinRoot(...)`, `:205` код `'worktree-escape'`, `:206` текст «§60 worktree escape», `:207` детали. Обе границы верны.
- `:102-110` `DOMAIN_IMPLIED_GATES`: `:102` `const gate = operation.gate ?? DOMAIN_IMPLIED_GATES[operation.domain]`, `:103-110` `denied('human-gate', …)` — гейт принуждается как **отказ** (совпадает с `23-STEPS-quality.md:243`, `10-DECISIONS.md:1210`). Импорт каталога — `:39`.
- `:245` `'secret-material'` — код отказа внутри `assertCredentialReference` (`:240`), «must not carry secret material … §60 secret exfiltration»; якорь `.work/analysis/2026-09-26/D-context.md:382` верен.

## 3. scheduler.ts — ПОДТВЕРЖДЕНО (4/4)
- `:554` `function budgetVerdict(item, kind, workspace): { admitted; scopes }` — ровно как в `21-STEPS-execution.md:964`.
- `:561-568` — диапазон точки admission: `:559-563` сборка `BudgetRequest`, `:564-567` `ledgers`, `:568` `const decision: BudgetDecision = decideBudgetAdmission({...})`. Ссылка верна (вызов внутри диапазона), но **объявление** `decideBudgetAdmission` — в `budget.ts:217`, импорт — `scheduler.ts:70`; см. `23-STEPS-quality.md:552,560`.
- `:584-620` `function capacityRefusal(` — `:584` объявление, `:620` закрывающая скобка; `:594` `pool-capacity`, `:604` `workspace-capacity`, `:608` `role-capacity`, `:612` `attempt-limit`. Границы диапазона точны (`21-STEPS-execution.md:20`).
- `:613-618` «потолки никто не исполняет»: `:613-616` комментарий «…the runtime that starts the model call or the tool enforces the ceiling itself» (цитата в `21-STEPS-execution.md:33` дословна), `:617-618` — `if (occupancy.llmCalls >= tick.limits.maxConcurrentLlm) return 'llm-limit'` и то же для `heavyTools`. «Единственные чтения» подтверждаю: в `packages/**` (кроме `lib/` и `.tmp/`) `maxConcurrentLlm/maxHeavyTools` встречаются только в `contracts/src/scheduler.ts` (тип/дефолты) и `core/src/scheduler.ts:25,155,613,617`; `SchedulerInstanceObservation` нигде не производится — только контракт (`contracts:278`), интерфейс `read()` (`scheduler/src/service.ts:102`) и pass-through `:358`. Исполнителя потолка в дереве нет.
- Бонус: `planSchedulerTick` `:303-333` ✓, виды `['worker','review']` `:314` ✓.

## 4. budget.ts — ЧАСТИЧНО (2 из 3 строк верны)
- `:122` `export function chargeConsumption(consumption: BudgetConsumption, charge: BudgetCharge): BudgetSettlement` ✓ (`20-STEPS-foundation:1263` `:122-140` ✓, `23-STEPS-quality:468,851` `:122` ✓).
- `:181` `export function modelCallCost(route, rate, tokens): BudgetAmount` ✓; `unknown` при отсутствии тарифа `:182-184`, `:185-186` неизвестные токены — утверждение «возвращает unknown, если тарифа нет» верно.
- `:195` — **не** `modelCallCost`, а `export function modelRateOf(table: ModelRateTable, route: ModelRoute): ModelRate | undefined`. `23-STEPS-quality.md:535` пишет «цена уже считается `modelCallCost` … (`packages/core/src/budget.ts:181,195`)» — вторая строка приписана чужому символу.
- Дополнительно (в том же документе): `23-STEPS-quality.md:468` — «`decideBudgetAdmission` `:450`». Фактически `:450` — `function tokenCount(value, label)`, а `decideBudgetAdmission` объявлен на `:217`. Верная ссылка — `budget.ts:217-239` (`20-STEPS-foundation:1263,1291`, `10-DECISIONS:473`). Severity minor: путь правки шага указывает на чужую функцию.

## 5. board.ts — ПОДТВЕРЖДЕНО (2/2)
- `:4` ` * Two invariants drive everything here, and both are properties of pure` — оба инварианта перечислены `:7-14`: (1) карточка рендерится ровно в одной зоне (`projectTaskZone` тотален, `assertSinglePlacement`), (2) порядок тотален и insert-only. Живой строки «Two invariants» в `packages/**` только две (`board.ts:4`, `execution/src/schema.ts:12`).
- `:458` `export function applyDropIntent(placement, intent, order, meta): Result<PlacementChange>` — тело `:458-566` (план `22-STEPS-surface:56,363`, `30-CARD-EDITS:581,956` — верно); `:482-498` отказ `STALE_COLUMN_REVISION` по `columnRevision` (ADR-030:18 ✓), `:554` `zone: intent.toZone`, `:556` `columnRevision: placement.columnRevision + 1` (единственная запись, `22-STEPS-surface:65` ✓).
- Оговорка (info): ни один документ `plan-v0.3` не ссылается на `board.ts:4` — якорь проверен по первоисточнику, но его «потребителя» в плане нет.

## 6. context.ts / skill.ts / memory.ts — ПОДТВЕРЖДЕНО (9/9)
- context: `:375` `export async function discoverContext(input): Promise<ContextDiscovery>`; `:478` `export async function materializeContextSnapshot(input): Promise<ContextSnapshotDecision>`; `:775` `export function assembleContextPrompt(snapshot): ContextPrompt`; `:1100` `function requireCandidate(candidate: unknown): ContextCandidate`. Все четыре — ровно как в `23-STEPS-quality.md:19,126`; бонус `verifyContextSnapshot` `:670` ✓.
  - Нюанс: `requireCandidate` валидирует uri/source/kind/level/scopes/provenance/relevance/estimatedTokens/validFrom/validUntil и **не** смотрит содержимое (content уходит в `freezeContent`, `:1140`), но `trust` в нём **не проверяется** — `:1133` переносит `value.trust` как есть. Формулировка `D-context.md:382` «про trust/level/revision» неточна по `trust`.
- skill: `:119` `export function createSkillRegistry(options: SkillRegistryOptions = {}): SkillRegistryPort`; `:639` `export function createSkillContextProvider(options): SkillContextProvider`; `:870` `const SKILL_TRANSITIONS: Readonly<Record<SkillStatus, readonly SkillStatus[]>> = Object.freeze({` (тело `:870-875`), `isAllowedSkillTransition` `:882-884` — план `:870-888` ✓. Бонус: `SKILL_REGISTRY_AUTHORITY = 'skill-registry'` `:855` ✓, `SERVED_STATUSES` `:861` ✓ (`10-DECISIONS.md:877`).
- memory: `:170` `export function createMemoryFabric(options: MemoryFabricOptions = {}): MemoryFabricPort`; `:1036` `function normalizeProposal(proposal: MemoryProposal): NormalizedProposal` (тело `:1036-1092`; `D-context.md:382` даёт `1036-1089` — недобор 3 строки на закрывающих скобках). Утверждение «`statement` — только непустая строка» верно: `:1038` `requireText(statement, 'a memory statement')`, сканирования содержимого нет. Бонус: `createMemoryContextProvider` `:1368` ✓.

## Итог
- Неверных/несуществующих якорей в списке нет: **24 из 25** строк точны, единственный дефект — `:195` в группе budget (`modelCallCost` вместо `modelRateOf`); рядом, в том же `23-STEPS-quality.md`, есть вторая ошибка строки — `decideBudgetAdmission` `:450` вместо `:217`.
- Ни один файл из списка не отсутствует, ни один номер не вышел за пределы файла и не разошёлся с символом более чем на ±10.
