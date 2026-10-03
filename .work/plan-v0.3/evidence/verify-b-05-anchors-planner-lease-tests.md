# verify-b-05 — якоря planner / lease / tests / contracts (независимая проверка плана v0.3)

Метод: чтение первоисточников (read/grep) + точечные Select-String; допуск по строке ±10.
Замечание по инструменту: `Get-Content | Measure-Object -Line` занижает длину (session.ts 876 vs факт 957, team.ts 374 vs 405, service.ts 1639 vs 1690) — для вывода «строка вне файла» не годится; ниже длины из read.

## 1) `packages/planner/src/service.ts` — ПОДТВЕРЖДЕНО (1690 строк)
- `:1036` = `async stage(intent: PlanMutationIntent): Promise<Result<StagedPlanMutation>> {` ✓
- `:1185` = `async submit(intent: PlanMutationIntent)` — 1186 `stage`, 1188 `run` ✓
- `:1267` = `'PLANNER_SCOPE_DENIED',` — внутри `resume`, ветка `adopted-id-scope-unverified` ✓
- `:1195-1300` «решение/восстановление»: метод `resume(operationId, decision, options)` объявлен `:1191-1195`, тело до `:1300` (`return run(working, decision)`, закрытие `:1301`); внутри `requireDecision` `:1196`, два `enterRecovery` `:1245`, `:1263`. Обе границы внутри метода, содержание соответствует. Нюанс: сам движок recovery — `enterRecovery` `:437` и `run` `:779` — вне диапазона.
- Попутно верны (21-STEPS-execution.md:19,632): `:134` `export interface Planner`, `:144` `stage`, `:148` `submit`.

## 2) `packages/lease/src/lifecycle.ts` — ЧАСТИЧНО (major)
- `:33-45` ✓: `:33` `export type ControllerLifecyclePhase =`, `:45` `| 'disposed'` — 6 фаз (`idle, activating, active, passive, disposing, disposed`).
- `:56-61` — символ на месте (`:56` `export interface ReconcileReport {`, `:61` `}`), НО форма содержит только `:58` `readonly operations: number` и `:60` `readonly leases: number`. Поля `stalls` нет: grep `stalls` по `packages/**` — 0 в коде (только проза budget.ts:164), тесты вызывают `reconcile: () => ({ operations: 0, leases: 0 })` (`tests/lease.test.mjs:751`, `tests/plan-mutation.test.mjs:1187`). Утверждение 21-STEPS-execution.md:933 «возвращает отчёт `{operations, leases, stalls}` (форма `ReconcileReport`, :56-61)» неверно по содержанию (третье поле не существует).
- `:281-299` ✓: `:281` `heartbeat(): ControllerLifecycleInfo {`, `:299` `}`; при ошибке `:294` `this.admissionOpen = false`, `:295` `this.phase = 'passive'`.
- Попутно верны: `:110` `readonly reconcile: (stores…) => … ReconcileReport`, `:123` `readonly admissionHold?: (stores) => Promise<boolean> | boolean`, `:214` `async activate()`, `:261` `resumeAdmission()`.

## 3) `packages/lease/src/index.ts:56-63` — ЧАСТИЧНО (minor)
- `:56-63` ✓ — блок `export { ControllerLifecycle, type ControllerLifecycleInfo, type ControllerLifecycleOptions, type ControllerLifecyclePhase, type ControllerStores, type ReconcileReport } from './lifecycle.ts'`; `ControllerLifecycle` на `:57`. «Экспортируется» — верно.
- Парное утверждение 21-STEPS-execution.md:35 «не инстанцируется **нигде** — только экспортируется» неверно: `new lease.ControllerLifecycle(` есть в тестах — `tests/lease.test.mjs:546`, `:743`, `tests/plan-mutation.test.mjs:1179`, `:1197` (4 шт.). По `packages/**` совпадение ровно одно и оно в doc-примере (`index.ts:14`), т.е. «grep → 0 совпадений» тоже неточно. Существо (в src-композиции wiring'а нет) подтверждается.

## 4) `packages/planner/src/store.ts` — ПОДТВЕРЖДЕНО (641 строка)
- `:41` `export const PLAN_MUTATION_HOLD_REASON = 'plan-mutation-staged'` ✓
- `:400` `export function holdAdmission(executor: SqlExecutor, input: AdmissionHoldInput): AdmissionHold` ✓ (INSERT в `admission_hold` `:401-408`)
- `:435` `export function readOpenHold(executor: SqlExecutor, workspaceId?: WorkspaceId): AdmissionHold | undefined` ✓
- Совместимо с `service.ts:1026-1030` (`admissionHeld`/`admissionHold` → `readOpenHold`) и `lifecycle.ts:123` (hook → boolean, 21-STEPS-execution.md:911).

## 5) `packages/contracts/src/task.ts` — ЧАСТИЧНО (minor; 107 строк)
- Объявления состояний на месте: `:23` `| 'awaiting-review'`, `:29` `| 'integrating'`, `:31` `| 'done'`, `:35` `| 'changes-requested'` (union `:11-43`; `TASK_STATES` `:46-63` = 16 значений) ✓.
- Но ожидаемый вывод команд занижен: `Select-String … -Pattern "'awaiting-review'|'done'|'integrating'"` (21-STEPS-execution.md:349) даст ещё `:52`, `:55`, `:56` и `:66` (`TASK_TERMINAL_STATES`); `Select-String … "'changes-requested'"` (там же `:542`) — ещё `:58`. «Совпадения на :23, :29, :31» / «→ :35» — неполный, а не исчерпывающий список.

## 6) `packages/contracts/src/session.ts:945` + `packages/contracts/src/team.ts` — ЧАСТИЧНО (minor)
- session.ts (факт 957 строк): `:945` `readonly carriesTranscript: boolean` ✓, док `:944` «False always: §22.3 forbids carrying the whole transcript» → «fresh, `carriesTranscript: false`» ✓.
- team.ts:47 — это док-строка `/** Approve a review. A worker never holds this for its own attempt (§13.2). */`; сам член `| 'review.approve'` на `:48` (в допуске ±10; смысл инварианта стоит именно на :47) ✓.
- team.ts:206-208 ✓ — `AgentBlueprint`: `:206` `readonly preset: string`, `:208` `readonly permissions: readonly Permission[]` (в `AGENT_BLUEPRINT_FIELDS` `:223`).
- Голый `:252-260` после `team.ts:206-208` (21-STEPS-execution.md:41): в team.ts это `:253` `readonly revision: Revision`, конец `AgentIdentity` и док `IDENTITY_RUNTIME_FIELDS` — НЕ grant. Заявленный «grant (permissions+harnessPolicy)» лежит в `security.ts:248-265` (`permissions` `:252`, `harnessPolicy` `:260`). Как написано — атрибуция файла неверна; по смыслу якорь существует, но в другом файле.

## 7) `tests/scheduler.test.mjs` — ПОДТВЕРЖДЕНО (1128 строк)
- `:921` `test('the scheduler holds no model port: an injected one is never called, and no source names one', …)` ✓; `:927-933` — ошибочно переданный `llm`-порт игнорируется (`listProviders`/`listModels` не вызываются, `modelCalls` пуст).
- `:935-944` ✓ дословно: `:935` `join(repoRoot,'packages','scheduler','src')`, `:936` список `forbidden` (7 подстрок), `:937-938` `readdirSync` + непустота, `:939-943` чтение текста и `assert.equal(text.includes(needle), false)`, `:944` `}`. Это текстовая проверка, не разбор импортов.
- Попутно верны ссылки того же ряда (21-STEPS-execution.md:25): `tests/boundaries.test.mjs:480-494` (единственный модуль — `node:crypto`, `:488`) и `:496-508` (доменные пакеты не импортируют `@dsh-mywork/execution`).

## 8) `contracts/context.ts` / `authority.ts` / `audit.ts` — ПОДТВЕРЖДЕНО
- context.ts (955 строк): `:602-631` ✓ — док `:602`, `export type ContextRefusalReason` `:603-619` (8 причин), `CONTEXT_REFUSAL_REASONS` `:622-631`; коды причин — `CONTEXT_REFUSAL_CODES` `:639-648`. Имени `CONTEXT_SNAPSHOT_MISSING` нет нигде в репо (grep — 0): план помечает его «~имя уточнить», то есть это новое имя, а причины «снапшота нет вовсе» среди 8 существующих нет (все — бюджет/маршрут/материализация).
- `:805` `readonly toolSurface: readonly string[]` ✓ (док `:804`); в `CONTEXT_SNAPSHOT_FIELDS` `'toolSurface'` на `:836`. Писатели — только тесты (`tests/context.test.mjs:78,124,433,695,946`, `tests/skill.test.mjs:137,739`, `tests/memory.test.mjs:717,1132`) и `packages/core/src/context.ts:487` (принимает из входа), `:613` (кладёт в снапшот) → тезис «живой рантайм его не заполняет» согласуется.
- authority.ts (135 строк): `:122` `'approval.human': { domain: 'approval.human', owners: ['mywork-db', 'mywork-audit'], projection: false }` ✓.
- audit.ts (135 строк): `:88-89` ✓ — `export const AUDIT_ENTRY_FIELDS … = Object.freeze([` / `'schema',`; «прочитано только начало» верно (список `:88-101`). Актора-поля там нет: `agentId` `:98` — «Agent the event concerns» (`:124`), т.е. вопрос шага 0 Q-15 законен. Попутно ✓: `AUDIT_EVENT_TYPES` `:65-82` (16 значений), `human.override` `:50`, `gate.decided` `:54`.

## Итог
Подтверждены все 4 якоря planner/service.ts, 3 из 3 в store.ts, 2 из 3 диапазонов lifecycle.ts (третья — форма отчёта), index.ts, task.ts (с оговоркой по выводу Select-String), session.ts:945, scheduler.test.mjs и вся группа context/authority/audit. Опровергнуто: поле `stalls` в `ReconcileReport` (21-STEPS-execution.md:933) и «не инстанцируется нигде» (там же `:35`); атрибуция `:252-260` к team.ts.
