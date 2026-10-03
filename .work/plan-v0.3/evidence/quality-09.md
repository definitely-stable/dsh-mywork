# Q09 worktype/retention — evidence

1. `rg -c -e 'WorkType|FinishCriteria|FINISH_CRITERIA|FINISH_CRITERIA_UNMET|humanAcceptance' packages` (glob packages/**/src, !node_modules,!lib) → 0 совпадений, **exit=1**.
2. Тот же шаблон по `tests/` → 0 совпадений, **exit=1**.
3. `packages/contracts/src/worktype.ts` — **нет** (Test-Path False); `packages/contracts/src/` содержит 31 файл, worktype.ts отсутствует. Аналогично нет `core/src/worktype.ts`.
4. ADR028: `.work/architecture/DSH-My-Work-Architecture-v0.2-decisions.md:377` «ADR028. Work-type-specific finish criteria».
5. Таблица work types → requiredEvidence/verification/integrationStrategy/human acceptance: строки **383–390** (шапка 383, разделитель 384, 6 типов 385–390), дословно:
   `code` → `diff`,`test-report`; build,test,boundary; `git-merge`; приёмка «на интеграции».
   `research` → `worker-report`,`review-verdict`; source-citation,claim-support; `artifact-publish`; приёмка «да».
   `analysis` → `worker-report`,`review-verdict`; claim-support,data-provenance; `artifact-publish`; «да».
   `document` → `worker-report`,`design-doc`; structure,terminology,link-check; `artifact-publish`; «да».
   `manual` → `manual-receipt` (или `screenshot`); operator-attested checklist; `manual-receipt`; «всегда».
   `non-git-ops` → `worker-report` (или `build-log`); command-receipt; `none`; «да».
6. `FINISH_CRITERIA_UNMET` встречается только в прозе: документ строки 392, 403; в `packages/**/src` и `tests/**` — 0 (см. п.1–2).
7. Migration impact (строка 401) обещает `contracts/src/worktype.ts`, `core/src/worktype.ts` и расширение `ARTIFACT_KINDS` — файлов нет (п.3).
8. Retention-проверка в `packages` (!node_modules,!lib), по одному шаблону: `DELETE FROM outbox` **exit=1**, `DELETE FROM inbox_dedup` **exit=1**, `DELETE FROM audit_events` **exit=1**, `VACUUM` **exit=1** — кода ретенции/очистки нет.
9. Запрет DELETE/UPDATE на artifacts есть: `packages/evidence/src/schema.ts:65` `artifacts_no_update`, `:70` `artifacts_no_delete` (RAISE ABORT), плюс REPLACE-guard `:115` `artifacts_no_replace`.
10. То же для audit_events: `packages/evidence/src/schema.ts:92`, `:97`, `:121` (append-only).
11. Схема artifacts.bytes: `packages/evidence/src/schema.ts:60` — `bytes BLOB NOT NULL` (таблица `:47`).
12. Неограниченные DELETE по операционным таблицам: `packages/planner/src/store.ts:312` `DELETE FROM plan_mutation_step`, `packages/execution/src/store.ts:259` `DELETE FROM claim_step`, `packages/lease/src/lease.ts:256` `DELETE FROM controller_lease`.
13. Кода retention/prune/vacuum нет: grep `retention|prune|vacuum|garbage|expire|ttl|cleanup` даёт только прозу `packages/beads-adapter/src/adapter.ts:622` («A pruned prefix…»), GC отсутствует.
14. Сканер секретов живёт в `packages/evidence/src/metadata.ts`: `:55` `SECRET_PATTERNS` (8 шаблонов: pem, AKIA, gh*_, sk-, sk_live/test_, xox*, JWT, credential-assignment `:70`), функция `:178` `assertNoSecretMaterial`.
15. Сканируется **только метадата** (строковые поля): вызовы `assertNoSecretMaterial` — `metadata.ts:111` (readId) и `:213` (readContentType); тела не сканируются: `bytes` проходит лишь проверку типа `metadata.ts:244-247`, далее только SHA-256 `artifacts.ts:137`.
16. В `packages/memory-native/src` нет сканирования: grep `secret|redact|scan|sanitiz` → 0, **exit=1**.
17. Invariants как механизм отсутствуют: `InvariantRegistry` **exit=1**, `runtime-invariants` **exit=1**, `assertInvariant` **exit=1** (совпадений нет). Слово «invariant» встречается только в комментариях: `execution/src/schema.ts:12`, `execution/src/index.ts:14`, `lease/src/index.ts:5`, `core/src/board.ts:4`.
18. Crash recovery (MW-031) не реализован: `.work/tasks/tasks.json:796` id, `:812` `"status": "planned"`, `:815` ожидаемый отчёт; `.work/tasks/INDEX.md:73` planned; файл `.work/reports/MW-031-recovery.md` отсутствует (Test-Path False).
19. Существующий recovery-код других карточек: `packages/execution/src/service.ts:115` и `:878` (`recover`), `packages/beads-adapter/src/reconcile.ts:6`, `packages/planner/src/service.ts:436`; в `packages/storage/src` recovery/GC нет (grep exit=1).
20. Списка запрещённых инструментов worker'а нет: `workerSurface` **exit=1**, `allowedTools` **exit=1**, `toolAllowList` **exit=1**, `forbiddenTools` **exit=1**, `cordis_` **exit=1**.
21. Архитектура прямо отрицает per-session allow-list: `packages/contracts/src/agent-runtime.ts:57` «there is no per-session tool allow-list to set instead», `packages/controller/src/dsh-session.ts:20`; скоуп задаётся agent preset'ом (`agent-runtime.ts:48,54`).
22. `cordis` в MyWork — только зависимость/бандл/patch: `package.json:22` `"@deepseek-ai/cordis": "4.0.2"`, `packages/controller/package.json:19,23`, `packages/controller/src/index.ts:7`; запреты в тестах — про зависимости, не про инструменты (`tests/adapters.test.mjs:405`, `tests/boundaries.test.mjs:18`).

EVIDENCE: .work/plan-v0.3/evidence/quality-09.md
