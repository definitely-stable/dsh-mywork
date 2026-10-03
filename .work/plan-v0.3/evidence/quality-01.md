# quality-01 — Q01 reachability: экспорты, импортёры, точки входа, фабрики

1. Экспорты index.ts (подсчёт read-only pwsh-скриптом по файлам, exit 0; `export *`/`export default` в этих 4 файлах отсутствуют — Select-String: 0 совпадений):
   - packages/memory-native/src/index.ts — 8 имён (5 значений, 3 типа): блоки :19-24, :25-30.
   - packages/planner/src/index.ts — 44 (34/10): :36-42 (5), :43-48 (4), :49-79 (29), :80-87 (6).
   - packages/evidence/src/index.ts — 25 (16/9): :25-31 (5), :32-39 (6), :40 (4), :41 (4), :42-49 (6).
   - packages/core/src/index.ts — 262 (187 значений / 75 типов): 13 inline (14,20,32,55,65,75,88,100,106,120,137,147,159) + 249 в блоках :177-448 (старты 177,178,187,195,208,220,234,253,261,262,287,294,299,300,319,320,330,343,354,382,403,420); дублей имён нет (262 distinct).
2. Импортёры @dsh-mywork/evidence в src — ровно 3: packages/planner/src/store.ts:35 (EVIDENCE_SCHEMA_NAME), packages/planner/src/service.ts:69 (appendAuditEntry, putArtifact), packages/execution/src/service.ts:63 (appendAuditEntry, putArtifact); объявлен зависимостью в packages/planner/package.json:27 и packages/execution/package.json:27.
3. Импортёров @dsh-mywork/planner — НЕТ нигде: только самоописание packages/planner/package.json:2, packages/planner/src/index.ts:2, :33 (и комментарий packages/core/src/plan.ts:12).
4. Импортёров @dsh-mywork/memory-native — НЕТ нигде: только packages/memory-native/package.json:2, packages/memory-native/src/index.ts:4, :16.
5. tests/** не содержит спецификаторов `@dsh-mywork/*` (grep: 0); тесты грузят собранные lib по путям — tests/lib/fixtures.mjs:20 (evidence), :25 (planner), :28 (memoryNative), :31 (existsSync-проверка).
6. scripts/** спецификаторов пакетов не имеет; @dsh-mywork/controller — только строки: scripts/verify-profile.mjs:27, scripts/smoke.mjs:85, :139.
7. Точка входа DSH-плагина: packages/controller/src/index.ts — name :92, apply :115; строка монтирования — packages/controller/cordis.patch.yml:12-14, bundle-поле package.json dsh.bundle.patch=./cordis.patch.yml.
8. Импорты контроллера: :25 @dsh-mywork/adapter-sdk, :33 @dsh-mywork/contracts, :46 @dsh-mywork/core, :47 ./model-catalog.ts, :48 ./dsh-session.ts; локальные модули тянут только adapter-sdk+contracts (model-catalog.ts:24-31, dsh-session.ts:36-54).
9. Достижимо от контроллера из 4 пакетов: только @dsh-mywork/core (index.ts:34-46); сам core импортирует лишь @dsh-mywork/contracts во всех src-модулях (core/src/index.ts:11 и т.д.).
10. НЕ достижимы от контроллера: evidence, planner, memory-native — ни index.ts, ни model-catalog.ts, ни dsh-session.ts их не импортируют.
11. Прочие плагин-энтрипоинты: packages/beads-adapter/src/plugin.ts (name :28, apply :80) и :memory-plugin.ts (name :36, apply :83); их импорты — contracts/adapter-sdk/локальные (:15-25, :22-33), core приходит транзитивно через ./adapter.ts:25; evidence/planner/memory-native не тянутся; package.json beads-adapter без dsh.bundle.
12. Монтирование подтверждено тестом: tests/runtime.test.mjs:27 (entry packages/controller/lib/index.js), :655 `ctx.plugin(controller, { diagnostics: false })`; scripts/verify-profile.mjs:27 BUNDLE='@dsh-mywork/controller'.
13. Фабрики CF/SR/MF объявлены ТОЛЬКО в core/src: context.ts:105, skill.ts:78, :119, :639, memory.ts:111, :170, :1368.
14. Вызовы в src — только внутренние дефолты: core/src/memory.ts:184 (createMemoryRevisionRegistry), core/src/skill.ts:120 (createSkillRevisionRegistry); остальное — реэкспорт core/src/index.ts:359, :387-389, :408-410.
15. Все внешние вызовы фабрик — исключительно tests/**: context.test.mjs:81,127,436,699,947,976; skill.test.mjs:68,99,140,167,176,213,259,285,329,369,376,539,742,750; memory.test.mjs:81,349,652,682,698,744,768,778,792,798,808,881,891,945,1042,1097,1113; memory-beads.test.mjs:416,498,612,697,714; tests/lib/mw019-restart-child.mjs:56. В scripts/** — 0.
16. tsconfig.base.json:30-38 не содержит path-алиасов planner и memory-native (есть contracts, core, storage, evidence, lease, execution, scheduler, adapter-sdk, adapter-sdk/testing).
17. Итог: planner, evidence, memory-native (как и execution, scheduler) не имеют ни одного рантайм-импортёра в packages/**/src и не достижимы ни от одной смонтированной плагин-строки; их покрывает только тестовый слой.

не проверено:
- pnpm/tsdown/typecheck/node --test не запускались; exit code есть только у read-only pwsh/grep.
- packages/*/lib/** в .gitignore:15 — собранные бандлы не анализировались (файлы lib/index.js существуют у 7 пакетов).
- .work/, .tmp/, .dsh/, .analysis/ в .gitignore:1-5 → grep по ним не покрыт.
- Каталогов apps/ и plugins/ в репозитории нет; динамические import() вне packages/*/src, tests/, scripts/ не искались.

EVIDENCE: .work/plan-v0.3/evidence/quality-01.md
