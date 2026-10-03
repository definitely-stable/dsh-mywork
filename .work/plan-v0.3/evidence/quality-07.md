# Q07 — карточки MW-030/032/033/034/045/046 (facts, anchors; только чтение)

## Карточки (H:\Repo\DSH-MyWork\.work\tasks\)
1. MW-030.md, 24 стр.: цель «human gates, pause/cancel/retry/reassign» (:1); этап 04-control (:3); deps MW-007,MW-012,MW-020,MW-029 (:4); Board ID (:5); §62=39 (:6); «Объём» (:17) — 7 пунктов: L0–L3+operation gates; Pause/Cancel/StopAfterCurrentTool/Reassign/Retry (revoke lease, fence++, checkpoint/evidence, retention, graph transition); AutonomyLevel + переименование §21.2 в D0/D1/D2; TaskClaims{paths,labels}+PlanMutationClass; task.stop-and-cancel (3 перехода, diff→artifact, отказ при неудачной записи); каталог NeedsAttentionReason; «Приёмка» (:20) — 8 пунктов; отчёт (:24).
2. MW-032.md, 24 стр.: цель «Fast Role Learner с bounded candidates» (:1); этап 05-learning (:3); deps MW-017,MW-018,MW-024 (:4); §62=27 (:6); Объём (:17) — 2 пункта (reflection Session; No learning либо кандидат + provenance/trust/conflict); Приёмка (:20) — 3 пункта; отчёт (:24); строки «Решения»/ADR нет.
3. MW-033.md, 24 стр.: цель «Sleep Optimizer, curator и promotion» (:1); этап 05-learning (:3); deps MW-006,MW-013,MW-032 (:4); §62=28 (:6); Объём (:17) — 2 пункта (baseline optimizer run+curator; Draft→Offline Eval→Shadow→Canary→Stable, Reject/Rollback, metrics/revision history); Приёмка (:20) — 3 пункта; отчёт (:24).
4. MW-034.md, 24 стр.: цель «token/context/cost metrics и observability» (:1); этап 05-learning (:3); deps MW-013,MW-016,MW-020,MW-025,MW-032 (:4); §62=36 (:6); Объём (:17) — 2 пункта (разбивка system…output, peak, retrieval/offload/compaction/rollover; queue/utilization/latency/repair/provider + correlation IDs, estimate/actual); Приёмка (:20) — 3 пункта; отчёт (:24).
5. MW-045.md, 25 стр.: цель «work types, finish criteria и интеграторы без Git» (:1); этап 04b-board (:3); deps MW-044,MW-023,MW-025 (:4); Board ID «не создана» (:5); §62 пусто (:6); решения «ADR026, ADR028» (:15); Объём (:18) — 3 пункта: contracts/src/worktype.ts+core/src/worktype.ts для 6 типов; ARTIFACT_KINDS += manual-receipt, web-citation, design-doc; 4 интегратора git-merge/artifact-publish/manual-receipt/none; Приёмка (:21) — 6 пунктов; отчёт (:25).
6. MW-046.md, 25 стр.: цель «обсуждение карточки и безопасный steering активной попытки» (:1); этап 04b-board (:3); deps MW-012,MW-022,MW-030 (:4); Board ID «не создана» (:5); §62 пусто (:6); решения «ADR026, ADR027» (:15); Объём (:18) — 5 пунктов: DiscussionMessage (5 ролей), миграция storage, attempt.steer, ссылка на DSH-сессию+audit, маршруты /v1/tasks/{id}/discussion и /v1/attempts/{id}/steer через ctx.webServer; Приёмка (:21) — 6 пунктов; отчёт (:25).

## Статусы (grep)
7. `Select-String -Path .work\tasks\tasks.json -Pattern '"id": "MW-030"|…|"id": "MW-046"'` → строки 770, 825, 851, 875, 1171, 1198; объект команды $?=True.
8. status у всех шести = "planned": .work\tasks\tasks.json:785 (MW-030), :840 (MW-032), :864 (MW-033), :891 (MW-034), :1190 (MW-045), :1217 (MW-046); adrs: [] — :792, :847, :871, :898; adrs MW-045 — :1181-1184, MW-046 — :1208-1211.
9. Все 14 зависимостей тоже "planned" (MW-006:148, MW-007:175, MW-012:304, MW-013:330, MW-016:410, MW-017:435, MW-018:460, MW-020:509, MW-022:568, MW-023:591, MW-024:618, MW-025:646, MW-029:758, MW-044:1163) — гейт «если deps не приняты, остановись с BLOCKED» (MW-030.md:13 и аналог в каждой карточке) сейчас не проходим.
10. Ни одного отчёта нет: Test-Path .work\reports\{MW-030-human-control,MW-032-fast-learner,MW-033-sleep-optimizer,MW-034-observability,MW-045-finish-criteria,MW-046-discussion}.md → False ×6.

## Требует проверяемого кода vs намерение
11. Требует кода с точными именами: MW-045 (:18,:21 — файлы, символы, FINISH_CRITERIA_UNMET, 6 work types, 4 интегратора) и MW-046 (:18,:21 — маршруты, ctx.webServer, SESSION_NOT_FOUND, operationId-идемпотентность).
12. MW-030 (:20) — смешанно: проверяемо (STALE_FENCE, «ровно одна попытка в cancelled», «семь триггеров достижимы тестом», отказ при неудачной записи artifact), но «Pause не теряет работу» — намерение без метрики.
13. MW-032/033/034 — приёмка (:20 каждой) целиком свойства-интенты: нет ни имён файлов/символов, ни кодов ошибок, ни чисел (кроме «Daily budget» у MW-033:20); объём (:17) тоже без путей и API.
14. Объём MW-045/046 (:18) — единственный в выборке, называющий конкретные артефакты репозитория.

## Репо-якоря (состояние до работы)
15. ARTIFACT_KINDS — 12 значений, manual-receipt/web-citation/design-doc отсутствуют: packages/contracts/src/artifact.ts:62-75.
16. NEEDS_ATTENTION_REASONS — ровно 7 причин: packages/contracts/src/board.ts:373-381 (типы :356-370) — совпадает с «семью триггерами» MW-030.md:20.
17. CARD_COMMANDS уже содержит task.stop-and-cancel/task.retry/task.cancel: packages/contracts/src/board.ts:252-260, :271-280; pause/reassign там нет.
18. PlanMutationClass существует: packages/contracts/src/workflow.ts:24, :36; classifyPlanMutation — core/src/plan.ts:348; TaskClaims|AutonomyLevel|stopAndCancel — 0 совпадений (grep packages\**\*.ts).
19. WorkType|FinishCriteria|FINISH_CRITERIA|resolveFinishCriteria|assertFinishCriteriaSatisfied — 0 совпадений в packages/*.ts; packages\contracts\src\worktype.ts, packages\core\src\worktype.ts → Test-Path False.
20. DiscussionMessage|attempt.steer|webServer — 0 совпадений в packages/*.ts.
21. Дрейф путей: карточка называет contracts/src/... (MW-045.md:18), раскладка монорепо — packages/contracts/src/ (Test-Path contracts\src\worktype.ts=False; packages\contracts\src\artifact.ts=True).
22. Тестовая инфраструктура есть: package.json:16 `"test": "node --test --test-isolation=none \"tests/**/*.test.mjs\""` → приёмка принципиально проверяема, но прогон запрещён рамками задания.

EVIDENCE: .work/plan-v0.3/evidence/quality-07.md
