# Q08 — карточки 02-context (MW-016…020) и 07-acceptance (MW-038…041)

Все 9 карточек имеют одинаковую структуру: 24 строки; §62 — L6, «Архитектура» — L14, «Объём» — L17, «Приёмка» — L20, отчёт — L24.
- MW-016.md: 24 стр.; цель L1 Context Fabric + snapshots; объём L17; приёмка L20; dependsOn L4 (MW-005/006/008/013); Board ID L5.
- MW-017.md: 24 стр.; цель L1 Skill Registry + Context Provider; объём L17; приёмка L20; dependsOn L4 (MW-006, MW-016).
- MW-018.md: 24 стр.; цель L1 Memory Fabric + Native Memory; объём L17; приёмка L20; dependsOn L4 (MW-005/008/016).
- MW-019.md: 24 стр.; цель L1 один внешний Memory adapter; объём L17 (OpenViking — предпочтительный кандидат); приёмка L20; dependsOn L4 (MW-018).
- MW-020.md: 24 стр.; цель L1 checkpoint/rollover/pressure; объём L17; приёмка L20; dependsOn L4 (MW-008/015/016).
- MW-038.md: 24 стр.; цель L1 Doctor + adapter conformance; объём L17; приёмка L20; dependsOn L4 (MW-010/015/019/027/029/031).
- MW-039.md: 24 стр.; цель L1 invariants/crash recovery/security; объём L17; приёмка L20; dependsOn L4 (MW-007/024/025/030/031/033/038).
- MW-040.md: 24 стр.; цель L1 upgrade/export-import/repair; объём L17; приёмка L20; dependsOn L4 (MW-004, MW-039); §62 пуст (L6).
- MW-041.md: 24 стр.; цель L1 приёмка и упаковка v0.1; объём L17; приёмка L20; dependsOn L4; Board ID не создана (L5); §63/64/66 «строка undefined» (L14).

Статусы (tasks.json): все `planned` — L410, L435, L460, L485, L509, L997, L1026, L1051, L1079; `"adrs": []` — L419, L442, L469, L492, L518, L1005, L1035, L1056, L1084.
Противоречие: отчёты MW-016…MW-020 существуют и заявляют `DONE` (строка 3 каждого; MW-020 — L6), отчётов MW-038…041 нет.

Реализация (packages/**/src, число строк — Get-Content | Measure):
- MW-016: contracts/src/context.ts 955 (ContextProviderPort L381); core/src/context.ts 1408 (discoverContext L375, materializeContextSnapshot L478, verifyContextSnapshot L670, assembleContextPrompt L775); tests/context.test.mjs 1152.
- MW-017: contracts/src/skill.ts 540 (SkillRegistryPort L388); core/src/skill.ts 1196 (createSkillRegistry L119, createSkillContextProvider L639); tests/skill.test.mjs 782.
- MW-018: contracts/src/memory.ts 1403 (MemoryFabricPort L1298); core/src/memory.ts 1698 (createMemoryFabric L170, createMemoryContextProvider L1368); memory-native/src/native.ts 354 (L84); disabled.ts 98 (L62); tests/memory.test.mjs 1236.
- MW-019: beads-adapter/src/memory.ts 815 (шапка L2 «§62 item 26», diagnostics L183/L558) — бэкенд Beads `bd kv`, не OpenViking; conformance: adapter-sdk/src/conformance.ts 1063 (memoryChecks L768); tests/memory-beads.test.mjs 1005.
- MW-020: contracts/src/session.ts 957; core/src/session.ts 1028 (checkpointSession L782, rolloverSession L831, decideContextPressure L351, applyWindowPressure L606); tests/session.test.mjs 746.
- MW-038: модуля Doctor в packages/**/src нет (glob `**/src/**/*doctor*` — 0 файлов); только порт contracts/src/taskgraph.ts L321/L406 и beads-adapter/src/adapter.ts L698; runConformance — conformance.ts L236.
- MW-039: core/src/task.ts L135 assertTaskInvariants; contracts/src/lease.ts L5-7; tests/security.test.mjs 411, tests/storage-crash.test.mjs 112.
- MW-040: не реализовано — storage/src/migrations.ts 198, L10-11 «export/import, repair, and the rollback policy are MW-040».
- MW-041: scripts/pack.mjs 62 (packController L28); controller/package.json L17-25 (`files` + `dsh.bundle.patch`); cordis.patch.yml L12-14.

Не подключено к рантайму: controller/src/index.ts 274 монтирует только mountModelCatalog L123 и mountDshRuntime L127; dsh-session.ts 817 передаёт prompt дословно (L641), Fabric не вызывается; controller/package.json L33-38 — только adapter-sdk/contracts/core (memory-native и beads-adapter вне бандла).

EVIDENCE: .work/plan-v0.3/evidence/quality-08.md
