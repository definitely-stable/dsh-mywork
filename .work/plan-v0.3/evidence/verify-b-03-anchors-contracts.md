# verify-b-03 — Якоря контрактов (attempt / review / agent-runtime / artifact)

Режим: falsify, только чтение. Первоисточник: `packages/contracts/src/*.ts` на HEAD `0c657ae1434202865bd330f0eeaf2b60eb78f6d4`
(`git status --short -- packages/contracts/src` — пусто, дерево стабильно, гонки с писателем нет). Допуск по строке ±10.

Сверяемый текст плана: `21-STEPS-execution.md:23` (сводная строка якорей), `:39`, `:41`, `:545`, `:1051`, `:1053`, `:1090`.

## 1) `packages/contracts/src/attempt.ts:92-101` — `WorktreeRef`; `:122` — `readonly worktree?: WorktreeRef`

**ПОДТВЕРЖДЕНО.** Нижняя граница точная: `92: export interface WorktreeRef {`, закрытие блока `101: }`.
Содержимое (94 `readonly path: string`, 96 `branch`, 98 `baseSha`, 100 `headSha`) — «Git identity of one attempt's
isolated worktree (architecture §19)», `91: /** Git identity of one attempt's isolated worktree (architecture §19). */`.
`122: readonly worktree?: WorktreeRef` — точная строка, поле действительно опциональное; докблок
`121: /** Isolated worktree, when the workspace is a git repository. */` подтверждает «поле опционально»
(`21-STEPS-execution.md:23`). Файл 127 строк — границы внутри файла.

## 2) `packages/contracts/src/review.ts:12-48` — «8 состояний»; `:51-56` — `ReviewedArtifact`

**ПОДТВЕРЖДЕНО.** `12: export type ReviewState =`; членов типа ровно 8 (`14 queued, 16 claimed, 18 reviewing,
20 approved, 22 rejected, 24 needs-evidence, 26 escalated, 28 cancelled`); константа
`31: export const REVIEW_STATES` содержит те же 8 литералов (`32-39`), `43: REVIEW_TERMINAL_STATES` — 4 из них
(`approved, rejected, escalated, cancelled`, строки `44-47`). Верхняя граница `48: ])` закрывает терминальное
множество; `49` — пустая строка, `50` — докблок следующего символа. Диапазон покрывает и тип, и обе константы — «8 состояний» верно.
`:51-56` — точно `51: export interface ReviewedArtifact {` … `56: }`; поля `53 headSha`, `55 diffHash`
(«An approval is bound to the exact head SHA and diff hash the reviewer saw», `3-5`).

## 3) `packages/contracts/src/agent-runtime.ts:223-258` — «AgentRuntimePort, ровно 5 операций»; `:245-250` — `stop` неразрушающий

**ПОДТВЕРЖДЕНО.** `223: export interface AgentRuntimePort {` … `258: }`; членов ровно пять, и это ровно те операции:
`230 start`, `237 resume`, `243 status`, `250 stop`, `257 events`. Других членов в диапазоне нет.
`244-249` — докблок `stop`: «245 Stop the run's work; idempotent for an already stopped run, and never
246 destructive: the session record survives as evidence.» + сигнатура `250: stop(handle: AgentRuntimeHandle, options?: AgentCallOptions): Promise<void>`.
Цитата плана (`21-STEPS-execution.md:1051`) «the session record survives as evidence» буквально лежит на строке 246
внутри `:245-250`. Согласуется с независимым свидетельством `evidence/execution-05.md:5` (start:230 … events:257).

## 4) `agent-runtime.ts:52-64` — `AgentRunScope`, нет per-session allow-list; `:67-76`; `:87-96` — `AgentResumeRequest`

**ПОДТВЕРЖДЕНО.** `52: export interface AgentRunScope {` … `64: }`; поля `59 agentPreset`, `61 model?`, `63 permission?`.
Цитата «a session inherits the composition of its preset, and there is no per-session tool allow-list to set instead» —
буквально строки `56-57` (внутри `52-64`); якорь `:52-59` из `21-STEPS-execution.md:39,791` тоже верен.
`:67-76` — `67: export interface AgentStartRequest {` … `76: }`; `68: /** Caller-owned run identifier; the runtime
rejects a duplicate. */`, `69: readonly runId: string` — «caller-owned, rejects a duplicate» подтверждено дословно.
`:87-96` — `87: export interface AgentResumeRequest {` … `96: }`; поля `89 runId`, `91 sessionId`, `93 workspacePath`,
`95 scope?` — совпадает с описанием «restart path (§39 "process restart", §22.3)» (`81`).

## 5) `packages/contracts/src/artifact.ts:31-75` — «12 значений»; `:50-51`; `:49`; `:82-96`

**ПОДТВЕРЖДЕНО.** `31: export type ArtifactKind =`, `75: ])`. Членов типа ровно 12 и столько же в
`62: ARTIFACT_KINDS` (строки `63-74`): diff, commit, build-log, test-report, screenshot, benchmark,
worker-report, review-verdict, planner-dag, context-snapshot, checkpoint, gate-decision. «12 значений» верно.
`:49:   | 'planner-dag'` — точная строка (`48` — докблок «The planner's dependency graph.»).
`:50-51` — `50: /** A snapshot of the context an attempt ran with. */`, `51: | 'context-snapshot'` — точная пара.
`:82-96` — `82: export const ARTIFACT_METADATA_FIELDS: readonly string[] = Object.freeze([` … `96: ])`, 13 полей
(schema, artifactId, kind, workspaceId, correlationId, contentType, size, hash, createdAt, taskId, attemptId, reviewId,
causationId); сам интерфейс `99: ArtifactMetadata` лежит ниже — если план имел в виду интерфейс, якорь указывает
на список имён полей, а не на форму. Для слова «метаданные» расхождение отсутствует.

## 6) `packages/contracts/src/board.ts:356-372` — `NeedsAttentionReason`; `:373-381` — список; `:359-360`

**ПОДТВЕРЖДЕНО (одна строка перебега на верхней границе, info).** `356: export type NeedsAttentionReason =`,
членов 7 (`358, 360, 362, 364, 366, 368, 370`) по докблокам `357, 359, 361, 363, 365, 367, 369`; тип закрывается на
`371: | 'lease-lost-without-successor'`, а `372` — уже докблок следующей константы («Every trigger, so "no path enters
`needs-attention` without a reason" is checkable.»). Верхняя граница `372` на 1 строку выходит за объявление —
в пределах ±10, дефектом не является; более точная форма — `356-371`. `:373-381` — точная пара
`373: export const NEEDS_ATTENTION_REASONS…` … `381: ])`, 7 литералов, `381` — последняя строка файла (всего 381).
`:359-360` — `359: /** An adapter became unavailable while an attempt was live. */`, `360: | 'adapter-unavailable-with-live-attempt'` — точно.
Согласуется с `evidence/quality-02.md:19` (те же 7 значений и те же номера 358/360/…/370).

## 7) `packages/contracts/src/security.ts:119-146` — `HarnessPolicy` и потолок; `:135-146`; `:257-258` — `worktreeRoot`

**ПОДТВЕРЖДЕНО.** `119: export type HarnessPolicy = 'read-only' | 'workspace-write' | 'danger-full-access'` (точная
строка); `122: HARNESS_POLICIES` (`123-125`) — три режима от узкого к широкому; `135: export const
HARNESS_POLICY_CEILING: Readonly<Record<HarnessPolicy, readonly Permission[]>> = Object.freeze({` … `146: })` — три ключа
ровно по `HarnessPolicy` (`136 read-only`, `137-144 workspace-write`, `145 danger-full-access` через
`HARNESS_GOVERNED_PERMISSIONS`, объявленный на `104`, что соответствует `evidence/execution-05.md:14`).
Докблок `128-134` задаёт смысл «потолка»: «A permission outside this ceiling is refused by the gate… the harness would
refuse the effect» — потолок действительно объявлен, а не только назван.
`:257-258` — `257: /** Worktree of this attempt, when it has one; it must sit inside the workspace. */`,
`258: readonly worktreeRoot?: string` — точная пара внутри `248: AuthorizationContext`.

## 8) `packages/contracts/src/budget.ts:104/:123/:138` — `maxAttempts`, scope `task`; `:59-87` — 8 лимитов

**ЧАСТИЧНО (info).** Все три строки существуют и все три действительно про `maxAttempts` (полный перебор
`grep maxAttempts packages/contracts/src/budget.ts` → 65, 81, 104, 122, 123, 138), и scope `task` для него верен:
`101: export const BUDGET_LIMIT_SCOPES … = Object.freeze({`, `104: maxAttempts: 'task',` — точная строка. Но буквально
scope заявлен только на `104`; `123: readonly maxAttempts?: number` — поле формы `117: BudgetLimits` (её докблок `113`
говорит «The §30 limits one scope declares», без привязки к task), `138: /** One attempt of a task (charges `maxAttempts`). */` —
докблок `139: | 'attempt'` из `137: BudgetRequestKind`. То есть группировка «104, 123, 138 (maxAttempts, scope task)»
(`21-STEPS-execution.md:23,545`) верна по существу, но на двух из трёх якорей слова о scope нет; читатель, открывший
только `:123`/`:138`, scope не увидит. Исправление не требуется — уточнение формулировки по желанию.
`:59-87` — **ПОДТВЕРЖДЕНО**: `59: export type BudgetLimitName =` с 8 членами (`61, 63, 65, 67, 69, 71, 73, 75`) и
`78: BUDGET_LIMIT_NAMES` с теми же 8 (`79-86`), верхняя граница `87: ])`.

## Итог

Якоря 1-7 — ПОДТВЕРЖДЕНО (ни одного несуществующего символа, ни одной строки вне файла, ни одного расхождения >±10).
Якорь 8 — ЧАСТИЧНО: под-якорь `:59-87` подтверждён, а `:123`/`:138` указывают на поле и докблок, но не на scope `task`.
Единственная геометрическая неточность — верхняя граница якоря 6 (`372` вместо `371`), в пределах допуска.
Ни один якорь не опровергнут; evidence-базис плана v0.3 в этой части выдерживает фальсификацию.
