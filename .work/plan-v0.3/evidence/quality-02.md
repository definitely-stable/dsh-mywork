# quality-02 — Q02 HumanGate (факты v0.3)

1. Определение: `packages/contracts/src/security.ts:171-181` — `type HumanGate`, 5 значений: `'dependency-upgrade'`:173, `'schema-migration'`:175, `'security-change'`:177, `'release'`:179, `'production-access'`:181. JSDoc `:164-170` («operation-specific gate of §28 that a human decides»).
2. Таблицы: `HUMAN_GATES` `security.ts:184-190`; `DOMAIN_IMPLIED_GATES = { production: 'production-access' }` `security.ts:193-195`.
3. Использование: `OperationRequest.gate?: HumanGate` `security.ts:280`; поле объявлено закрытым `OPERATION_REQUEST_FIELDS` `security.ts:231-238` ('gate':237).
4. Принуждение (отказ, не одобрение): `packages/core/src/security.ts:102` `const gate = operation.gate ?? DOMAIN_IMPLIED_GATES[operation.domain]`; `:103-110` `denied('human-gate', …)`. Валидация значения: `core/src/security.ts:522-527`; импорт `:30`, `HUMAN_GATES`:43, `DOMAIN_IMPLIED_GATES`:39.
5. Вхождения HumanGate, packages/**: `contracts/src/security.ts:171,184,193,280`; `contracts/src/workflow.ts:103` (комментарий «deliberately **not** a `HumanGate` from §28»); `core/src/security.ts:30,102,522,524,527`. Тесты: grep `HumanGate` по `tests/**` → 0 совпадений.
6. Вхождения HumanGate, .work/tasks/**: 0. Главы: `.work/architecture/DSH-My-Work-Architecture-v0.2-decisions.md:535` (ADR: `BlockerResolutionGate` — не значение `HumanGate`); `.work/reports/MW-007-security.md:61` (отчёт MW-007 перечисляет экспорты).
7. Вхождения HumanGate, .work/analysis/2026-09-26/**: `E-human-gates.md` (поток E, §29), `CLAIMS.md:268,269,277,386`, `FINAL-REPORT.md:202,247,284,402,474,532`, `G-frontier.md:66,161,204,312,314,318,466`, `V2-verification.md:103,238`, `B-orchestration.md:172,403,404`, `00-ground-truth.md:115`, `L-lead-notes.md:85`, `verify/E-claims-verification.md:49,50,58,90`, `verify/G-claims-verification.md:57,58`.
8. .work/plan-v0.3/**: `HumanGate` — 0 совпадений; используется `HumanDecision` (`00-RECON.md:116,199`, `01-MASTER-PLAN.md:97,157,216,256`).
9. Реэкспорт: `packages/contracts/src/index.ts` — звёздочками: `export * from './security.ts'`:82, `export * from './workflow.ts'`:87 (всего 29 звёздочных реэкспортов, строки 68-96). Явных именованных реэкспортов нет.
10. Поправка к вопросу: `HumanDecision` — **не** 0 совпадений по репозиторию (41 в `.work/**`), но **0** в `packages/**` и **0** в `tests/**`. Где уже есть: `plan-v0.3/00-RECON.md:116,199`, `plan-v0.3/01-MASTER-PLAN.md:97,157,216,256`, `E-human-gates.md:186,213,220,276,290,298,305,311,313,373,376,388,389,390,391,400,401,403,417,426,466`, `FINAL-REPORT.md:202,247,284,402,413,474,554`.
11. `AUDIT_EVENT_TYPES` `packages/contracts/src/audit.ts:65-82`, 16 значений: `task.created`:66, `task.modified`:67, `attempt.assigned`:68, `attempt.revoked`:69, `review.rejected`:70, `review.approved`:71, `role.revised`:72, `skill.patched`:73, `optimizer.promoted`:74, `human.override`:75, `controller.failover`:76, `gate.decided`:77, `plan.mutation.applied`:78, `plan.mutation.recovered`:79, `claim.recorded`:80, `claim.recovered`:81.
12. Union-члены: `'human.override'` `audit.ts:50`, `'gate.decided'` `audit.ts:54`. `'gate.asked'` — 0 совпадений в `packages/**` (предлагается добавить: `E-human-gates.md:400`).
13. `gate.decided` есть и в шине событий: `contracts/src/events.ts:30` (union), `:69` (`MYWORK_EVENT_TYPES`).
14. `gate.decided` уже пишется: `packages/planner/src/service.ts:994` `insertGateDecision`, `:998` аудит `type: 'gate.decided'`, `:1005-1018` outbox-событие `gate.decided`, `:986` артефакт `kind: 'gate-decision'` (`contracts/src/artifact.ts:59` union, `:74` список).
15. Сохраняемая запись-предшественник: таблица `blocker_gate_decision` `planner/src/schema.ts:130-142` (+ индекс `:144`), `insertGateDecision` `planner/src/store.ts:527`, `readGateDecisions` `:547`. Схема-образец «производное состояние + сохраняемое решение»: `contracts/src/workflow.ts:42-152` (решение `:70-97`, гейт `:99-125`, `awaitingDecision` `:118-122`).
16. `approval.human` в authority-матрице: union-член `contracts/src/authority.ts:65`; строка `authority.ts:122` — `owners: ['mywork-db', 'mywork-audit']`, `projection: false`.
17. `NeedsAttentionReason` — 7 значений, `contracts/src/board.ts:356-370`: `'reconciliation-divergence'`:358, `'adapter-unavailable-with-live-attempt'`:360, `'budget-exhausted'`:362, `'human-gate-deadline-exceeded'`:364, `'retry-budget-exhausted'`:366, `'dependency-unresolvable-after-void'`:368, `'lease-lost-without-successor'`:370. Список: `NEEDS_ATTENTION_REASONS` `board.ts:373-381`. Тест фиксирует ровно 7: `tests/board.test.mjs:603-612`.
18. В `packages/contracts/src` `NeedsAttentionReason` объявлен только в `board.ts:356,373` — носителя (поля с этим типом) нет.
19. `CardCommand 'task.resolve-attention'`: union-член `board.ts:266`, в `CARD_COMMANDS` `board.ts:278`.
20. `ReviewState 'escalated'`: union-член `review.ts:26` («Terminal: the review was escalated to a human», `:25`), в `REVIEW_STATES` `:38`, в `REVIEW_TERMINAL_STATES` `:46` → тупик без записи, кому и без возврата.
21. Storage, список миграций: `packages/storage/src/migrations.ts:91` `MYWORK_MIGRATIONS = Object.freeze([OUTBOX_INBOX])` — ровно одна миграция (version 1, `:49-82`); `MYWORK_SCHEMA_VERSION` `:94`.
22. Пример CREATE TABLE: `outbox` `storage/src/migrations.ts:54-70` (STRICT), `inbox_dedup` `:72-78`; журнал `schema_migrations` `:97-103`.
23. Миграции по доменам: `EVIDENCE_MIGRATIONS` `evidence/src/schema.ts:138`, `LEASE_MIGRATIONS` `lease/src/schema.ts:66`, `CLAIM_SAGA_MIGRATIONS` `execution/src/schema.ts:153`, `PLAN_MUTATION_MIGRATIONS` `planner/src/schema.ts:148`. Композиция — спред у вызывающего (`planner/src/index.ts:20-23`, `execution/src/schema.ts:31-34`), единого composition root нет.
24. Все 15 таблиц: execution `claim_intent`:88, `claim_step`:111, `attempt`:120, `task_fence`:139; evidence `artifacts`:47, `audit_events`:75; storage `outbox`:54, `inbox_dedup`:72; lease `controller_lease`:48; planner `plan_revision`:60, `plan_mutation`:66, `plan_mutation_step`:87, `admission_hold`:100, `work_proposal`:112, `blocker_gate_decision`:130.
25. Таблицы `human_decisions` НЕТ: grep `human_decisions` по `packages/**` → 0. Ближайшее существующее — `blocker_gate_decision` `planner/src/schema.ts:130`. Предлагается: `E-human-gates.md:365,402`.

не проверено:
- Команды не запускались: pnpm, tsdown, typecheck, `node --test` — exit code отсутствуют.
- grep по репозиторию уважает `.gitignore`; обход `.work/**` сделан отдельным вызовом (первый прогон его пропустил).
- Файлы `packages/**/*.d.ts`, `lib/**`, `node_modules` не читались.
- Порядок/полнота строк в `E-human-gates.md` приведены по grep-выводу, не сплошным чтением.

EVIDENCE: .work/plan-v0.3/evidence/quality-02.md
