# verify-b-42 · Шаги E-31, E-41, E-51 (`21-STEPS-execution.md`) — red-team, режим «только чтение»

## 0. Базис (зафиксирован pwsh до чтения; дерево правится другими агентами параллельно)

| Файл плана | SHA256 | строк |
|---|---|---|
| `.work/plan-v0.3/21-STEPS-execution.md` | `0AA13ED2A4DBF089676F40F0BC3CCB4C60E466A56CC103FD9011FC924BA2191C` | 1181 (не менялся весь прогон) |
| `.work/plan-v0.3/10-DECISIONS.md` | `0E2B860AA4D27C9AE2A9CF531053F54B1A0FEBD6CC12F29FFA1A98FC4B6CC5B8` → `9E72F4A3D9933163424063039C4ED2D1585A61B858BDEF08340AAA6EB0B5A8A3` | 1890 → 1893 (**дрейф во время проверки**) |
| `.work/plan-v0.3/20-STEPS-foundation.md` | `0C10CA782907FDA084E772BA5EB6B305D000EA9780F25DD9AA5CD03DA8AD1FD0` | 1899 |
| `.work/plan-v0.3/22-STEPS-surface.md` | `E945C9C28F42C1EB8E3FEF64E9137A57E6AC93C1FAF54B95B09DA2FAA9F7A549` → `7392EE0E3ECBDC31E05F46A5EAB1EF30DC02954DB5315D1CE502F5BE087BB53E` | 1530 → 1569 (**дрейф**) |
| `.work/plan-v0.3/23-STEPS-quality.md` | `EB802DB3B0F8D899B715D007DC24C28C092586F9540B9F3FBB06FC8229EAB462` | 871 |

Команды: `(Get-FileHash <f> -Algorithm SHA256).Hash` и `(Get-Content <f>).Count`. Якоря шагов: E-31 `:675-689`, E-41 `:860-874`, E-51 `:1034-1045`.
Репозиторий: `git rev-parse --short HEAD` → `0c657ae`; `git status --porcelain` → 0 записей. Тесты и сборка не запускались (запрет), план и код не правились.
Имён `20-STEPS-skeleton.md`, `22-STEPS-web.md`, `23-STEPS-unknown.md` в `.work/plan-v0.3/` **не существует**; проверка дублирования велась по фактическим `20-STEPS-foundation.md`, `22-STEPS-surface.md`, `23-STEPS-quality.md`.

## 1. E-31 · Additive-only и `PLANNER_SCOPE_DENIED`

- **(а) Файлы.** `packages/contracts/src/plan.ts` — есть (502 стр.) → Modify ✔. `packages/execution/src/setter.ts` — нет, но `Create` в E-30 `21-STEPS-execution.md:663` (E-31 зависит от E-30, `:676`) → Modify корректен ✔. `tests/setter-additive.test.mjs` — нет → Create ✔.
- **(б) Шаг 0 выполним ровно как написано:** `Select-String -Path packages/planner/src/service.ts -Pattern 'PLANNER_SCOPE_DENIED'` → ровно одно совпадение `:1267`; условие отказа вокруг — `:1257-1281` (over-adoption: ребро поверх id, которое мутация не может показать созданным). ✔
- **(в) Числа согласованы:** пять проверок (а)–(д) ↔ `pass 5 / fail 0` (`:685`, сводка `:153`). Команда без `pnpm`, файл-цель создаётся этим же шагом ✔.
- **(КОНТР, главное) «Тест (падающий) → FAIL» (`:683`) невоспроизводим: проверяемое поведение уже реализовано и уже покрыто.**
  - `packages/core/src/plan.ts:482-493`: `if (intent.origin === 'planner' && review.mutationClass !== 'additive-only') return fail(new MyWorkError('PLANNER_SCOPE_DENIED', …))` — то есть отказ (а) существует как **рантайм**-проверка.
  - `tests/plan-mutation.test.mjs:319-328` — тест «the planner may not touch existing work; the separate replan path may»: `update` существующей задачи → `PLANNER_SCOPE_DENIED`, `replan` → `ok`. Это ровно проверки (а) и (г/д) шага.
  - `tests/plan-mutation.test.mjs:383` — «the additive-only classifier is true only for creations and edges between them» (ребро «новое→существующее» выводит мутацию из additive-only, значит отказ уже покрыт и для (д)).
  - `tests/plan-mutation.test.mjs:2352-2367` — ребро поверх принятого id → `PLANNER_SCOPE_DENIED`, `reason: 'adopted-id-scope-unverified'`, граф не изменился («no edge was written onto the existing tasks») — покрывает (б),(в),(д).
- **(КОНТР) Заявленная цель «типом, а не только проверкой в рантайме» (`:677`, `:684`) не наблюдаема объявленным гейтом.** Тесты импортируют собранные `lib` (`tests/plan-mutation.test.mjs:32`: `from './lib/fixtures.mjs'`), типы после сборки стёрты; в `tests/**` нет ни `tsc --noEmit`, ни `@ts-expect-error` (grep → 0). Файл `tests/setter-additive.test.mjs` (`.mjs`) физически может увидеть только рантайм-отказ, который уже есть. Дополнительно: в **Файлах** (`:678`) отсутствует `packages/core/src/plan.ts`, где живёт и классификатор, и сам отказ.
- **(КОНТР, minor) Число строк устарело:** `≈2 368 строк, B-orchestration.md:399 п. 5` (`:689`). Атрибуция верна (`.work/analysis/2026-09-26/B-orchestration.md:399` буквально: «`plan-mutation` (2 368 строк)»), но фактически `tests/plan-mutation.test.mjs` = **2514 строк / 100 664 байта / 72 теста**. Там же признано, что файл **не прогонялся** → регрессия «без новых падений» (`:686`) идёт без базовой линии.

## 2. E-41 · Политики ролей через `HarnessPolicy` и платформенные ограничители

- **(а) Файлы.** `packages/controller/src/presets.ts` — нет в дереве, но `Create` в E-39 `:822` (`assertWorkerPreset`, `assertSurfaceRestricted`); E-41 объявляет `Зависит от: E-39` (`:861`) → Modify корректен ✔. `packages/execution/src/worker.ts` — нет (`packages/execution/src` = `errors/index/schema/service/store.ts`), но `Create` в E-08 `:308` → Modify корректен ✔. `tests/role-permissions.test.mjs` — нет → Create ✔.
- **(б)+(в) Шаг 0 подтверждён построчно:** `packages/contracts/src/security.ts:122` `HARNESS_POLICIES` и `:135` `HARNESS_POLICY_CEILING` (заявлено `:119-146` ✔; `:119` — `export type HarnessPolicy`, `:146` — закрытие объекта), `:258` `readonly worktreeRoot?: string` (заявлено `:257-258` ✔). `packages/core/src/security.ts:130` `const boundaryRoot = grant.worktreeRoot ?? grant.workspaceRoot` (заявлено `:130` ✔) и `:205` `'worktree-escape'` (заявлено `:203-207` ✔).
- **(в) Числа согласованы:** шесть проверок (а)–(е) ↔ `pass 6 / fail 0` (`:870`, сводка `:163`); регрессия `tests/security.test.mjs` существует (411 стр.) ✔. Команды без `pnpm` ✔.
- **Риск шага подтверждён в первопричиннике:** `C:\Reposit\deepseek-harness\deepseek-harness\packages\fs\fs-observation-policy\src\index.ts:74-82` — «unseen rejects with `FS_NOT_OBSERVED`» (`throw new FsError(…, 'FS_NOT_OBSERVED')`); `packages\sandbox\sandbox-policy\src\session-mode.ts:42` — `SANDBOX_MODES = ['read-only','workspace-write','danger-full-access']`. Методическое замечание (е) в `:874` верно: тест (д) обязан прочитать файл до записи.
- **(minor) Пробел в списке зависимостей:** тест (б) `:867` требует `read-only` для **planner**, но роль/пресет планировщика заводит E-30 (`:665` прямо фиксирует, что роли планировщика в реестре ещё нет; `RoleId = string` — `packages/contracts/src/ids.ts:36`), а E-41 объявляет зависимость только от E-39.

## 3. E-51 · Тест-запрет: нет монтажа в `ctx.workflowEngine`

- **(а) Файлы.** `tests/boundaries.test.mjs` — есть (584 стр.), заявленный сосед `:496-508` существует и является boundary-тестом («the domain packages do not import the execution layer») ✔. `tests/procedure-boundary.test.mjs` — нет → Create ✔. Образец сканера подтверждён: `tests/scheduler.test.mjs:935-944` действительно читает `src` и требует отсутствия подстрок ✔.
- **(КОНТР, главное) Все три проверки уже зелёные до шага → «→ FAIL (тест создан, проверка ещё не проходит по формулировке)» (`:1040`) ложно.** `workflowEngine` по дереву (packages/tests/apps/scripts, без `node_modules` и `lib`) — **0 совпадений**; по `packages/**/src` — 0; по `cordis*.yml` — 0 (в репозитории их один: `packages\controller\cordis.patch.yml`); в собранном `packages\controller\lib\index.js` (существует, 3414 стр.) — 0. Тест не может быть «падающим» и не может упасть при текущем дереве: это вакуумный гейт, а не красная фаза.
- **(minor) Заявленный охват шире фактического места правки:** (а) требует «ни один исходник `packages/**/src`», но модифицируемый файл сканирует не всё дерево — `tests/boundaries.test.mjs:111-114` `const sources = { contracts, core }` (+ отдельные `storageSources:117`, `evidenceSources:124`); planner/controller/execution/scheduler/lease в карту не входят.
- **(minor) Мотив правки boundaries.test.mjs неверен:** «добавляется также … чтобы работал в общем прогоне» (`:1041`) — общий прогон уже забирает любой новый файл: `package.json` → `"test": "node --test --test-isolation=none \"tests/**/*.test.mjs\""`. Получается дубль одной проверки в двух файлах с разным охватом.
- **(minor) Проверка (в) читает артефакт сборки без положительного контроля:** `packages/*/lib/` в `.gitignore:14`, а образцы-соседи такой контроль имеют — `tests/boundaries.test.mjs:489-493` («Guard against the scan being vacuous on the wrong file»: `bundle.includes('claim_intent')`) и `tests/scheduler.test.mjs:938` (`files.length > 0`). При устаревшем или чужом `lib` проверка (в) пройдёт, ничего не доказав.
- **(minor) Таблица против тела:** сводка `:173` обещает `tests/procedure-boundary.test.mjs` → `pass 3 / fail 0`, тело `:1042` даёт только `fail 0`, гейт `:1043` — «оба файла зелёные». `fail 0` не доказывает регистрацию трёх тестов: `node --test` на файле без тестов тоже не падает.

## 4. Противоречия с `10-DECISIONS.md` / `adr/*.md` и дублирование шагов

- Противоречий **не найдено**. `ADR-031-procedure-engine-naming.md:20,61` предписывает `packages/contracts/src/procedure.ts` и `ProcedureRevision` — E-51 им не противоречит; `:70,:86` уже содержит критерий «`grep -rn "workflowEngine" packages/` → пусто», то есть E-51 переводит готовый критерий в тест (полезно как регрессия, но красной фазы не даёт). `packages/contracts/src/workflow.ts` существует (152 стр.), `procedure.ts` — нет: состояние согласовано с E-50.
- Grep по `10-DECISIONS.md` (SHA `9E72F4A3…`): `PLANNER_SCOPE_DENIED|additive|AdditivePlanMutation` → 0; `sandbox-policy|fs-observation-policy|danger-full-access` → только `:1292` про `plugin_manager`, по существу — 0.
- Дублирования шагов в `20/22/23` **нет**: grep `procedure-boundary|procedure-naming|setter-additive|role-permissions|presets\.ts|AdditivePlanMutation` по трём файлам → 0 совпадений (единственные упоминания `workflowEngine` — декларации «что НЕ строим»: `20-STEPS-foundation.md:1841`, `22-STEPS-surface.md:1448`, `23-STEPS-quality.md:806`).
