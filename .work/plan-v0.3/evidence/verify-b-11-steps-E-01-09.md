# verify-b-11 — исполнимость шагов E-01…E-09 (`21-STEPS-execution.md:159-312`)

Роль: независимый верификатор-редтимер (попытка опровержения). Только чтение; записан лишь этот файл.
HEAD дерева `0c657ae`, `git status --porcelain` — пусто (0 строк), поэтому «отсутствие изменений в git status» (E-01) достижимо.
Все команды ниже запускались read-only; `pnpm`/`node --test`/сборки не запускались.

## Выполненные команды (факт, не пересказ плана)
| Команда | Вывод |
|---|---|
| `…packages -Filter *.ts … Select-String 'execFile\|spawnSync\|rev-parse\|worktree add' -SimpleMatch` | `0` (как в плане) |
| та же проба **без** `-SimpleMatch` (регекс) | `0` — вывод плана держится, но см. E-01(б) |
| `Select-String tests/boundaries.test.mjs "deepEqual\(modules, \['node:crypto'\]"` | ровно 1 совпадение на `:488` ✔ |
| `node -e "…execFileSync('git',['--version'],{shell:false})"` | `git version 2.55.0.windows.3`, exit 0; `require()` в `-e` работает вопреки `"type":"module"` ✔ |
| `Select-String packages/controller/src/index.ts 'createClaimSaga\|openStore\|ControllerLifecycle'` | 0 совпадений (как и ожидает план «до F») |
| `Select-String .work/plan-v0.3/*.md 'retentionMs\|окна хранения'` | 6 файлов, в т.ч. `20-STEPS-foundation.md` → условие E-06 выполняется |
| `Select-String packages/contracts/src/agent-runtime.ts '…AgentRuntimePort\|readonly runId\|rejects a duplicate'` | **6** строк (68,69,89,116,126,223), а план обещает «три совпадения» ✘ |
| `git worktree list` | 4 записи: main + `.tmp/f-audit`, `.tmp/mw012-review`, `.tmp/v2-boundary-demo` (все detached) |
| `Test-Path` | нет: `packages/contracts/src/worktree.ts`, `packages/worktree-adapter`, `packages/contracts/src/attempt-run.ts`, `packages/execution/src/worker.ts`, `packages/controller/src/app.ts`, `tsconfig.json`; есть: `node_modules/tsdown/dist/run.mjs`, `node_modules/.bin/tsc.cmd`, `tsconfig.base.json`, `tests/lib/fixtures.mjs` |

## E-01 (стр. 163-178) — ядро проверки
- **(а)** Карточка: `MW-021.md:1` («Реализовать изоляцию Git worktrees»), `:4` и `:12` — «Зависимости: MW-008, MW-012», `:20` — приёмка дословно ✔ (все якоря точны). `packages/contracts/src/worktree.ts` отсутствует → «Create» в E-02 верен; файл решения `evidence/execution-21-worktree-form.md` отсутствует → «Create» верен, кода не меняем ✔. `attempt.ts:122` — `readonly worktree?: WorktreeRef` ✔ точная строка; отдельная таблица для привязки обоснована: сага хранит `AttemptRecord` (`contracts/src/claim.ts:256-281`), в котором **нет** ни `worktree`, ни `revisions`.
- **(б)** Инструмент гейта сломан: `Select-String -SimpleMatch 'execFile|spawnSync|rev-parse|worktree add'` ищет **литеральную** строку с `|`, а не альтернацию, поэтому 0 гарантирован независимо от наличия вызовов git. Проба вакуумна: настоящий регекс-поиск по тем же четырём токенам тоже дал 0, то есть вывод «git в дереве нет» верен, но **доказан не той командой**. Вторая команда шага 0 (`:488`) — ровно одно совпадение на `:488` ✔. Третья проверка гейта (`.Pattern 'WorktreePort|worktree-adapter|shared checkout'`) — Select-String считает **строки**, а три ключа в шаге 2 записаны одной строкой плана (`:174`) → «3 совпадения» не выводится из формулировки, требуется разнести ключи по трём строкам.
- **(в)** «0» воспроизводится; «совпадение на :488» воспроизводится точно.
- **(г)** Решение (раннер git вне `packages/execution`) непротиворечиво: `boundaries.test.mjs:429-443` разрешает execution только `./`, `@dsh-mywork/{contracts,core,evidence,storage}`, `node:crypto`; `:474-477` фиксирует ровно 4 devDependency; `:480-493` требует в бандле только `node:crypto`. D17/E-06 (retention) и D11 (инъецированные часы) с E-01 не конфликтуют.
- **(д)** Дубля нет: grep по `.work/plan-v0.3` (WorktreePort, worktree-adapter, worktree-binding/isolation/cleanup) даёт совпадения **только** в `21-STEPS-execution.md`. Но файл решения E-01 потребляют E-14 (`:392`) и E-36 (`:383`), а в их «Зависит от» E-01 отсутствует.
- **Риск-оговорка E-01 проверена и требует действия:** boundary-скан — **явное перечисление**, не глоб (`20-STEPS:1035-1036` — сканируются шесть наборов, `:1046` — гейт «≥10 совпадений `collect(join(repoRoot, 'packages'…`»), поэтому новый пакет сам под скан не попадёт; E-03 шаг 4 пишет «без новых падений» — это вакуумно-зелёное утверждение.

## E-02 (180-193)
- **(а)** `packages/contracts/src/index.ts` — 96 строк, по одному `export * from './X.ts'` на модуль (`:68-96`), правка «один реэкспорт» верна; `tsc.cmd` и `packages/contracts/tsconfig.json` есть ✔; `tests/worktree.test.mjs` отсутствует → Create ✔.
- **(б)** Гейт выполним: `node_modules\.bin\tsc.cmd --noEmit -p packages/contracts/tsconfig.json` — форма верна (`tsconfig.base.json` уже несёт `noEmit: true`).
- **(в/г) Опровергнут якорь стиля:** заявлено «все методы возвращают `Result<…>` как остальные порты (`packages/contracts/src/attempt.ts:80-89` — образец стиля)». `attempt.ts:80-89` — это интерфейс **`Lease`** (`:80-89`, поля attemptId/fence/controllerEpoch/expiresAt), ни `Result`, ни методов. В `packages/contracts/src` `Result<` встречается **один раз** — собственное определение `operation.ts:115`; порты контрактов возвращают собственные типы (`claim.ts:256`, `memory.ts:1308-1340`). Образца «как остальные порты» в названном месте нет.
- **(д)** Дубля нет.

## E-03 (195-212)
- **(а)** `packages/worktree-adapter` отсутствует → Create ✔; `tsconfig.base.json` содержит явную карту `paths`, включая `@dsh-mywork/contracts` ✔; `pnpm-workspace.yaml` = `packages/*` (список править не нужно) ✔.
- **(б)** `node_modules\tsdown\dist\run.mjs` существует; строка вывода есть в tsdown (`node_modules/tsdown/dist/build-BxT2lm9L.mjs:795`: `logger.success(… 'Build complete in …ms')`) → «✔ Build complete» реалистично. Шаг 0 воспроизведён (git 2.55.0, exit 0) ✔.
- **Опровергнута формулировка риска** «первый запуск внешнего процесса в проекте»: `packages/beads-adapter/src/runner.ts:19` (`import { spawn } from 'node:child_process'`), `:102` (`spawn(binary, …)`) — запуск внешнего процесса уже есть в дереве.
- **Реальный пробел:** внутри пакетов `@dsh-mywork/*` резолвятся через pnpm-джункшены (`packages/execution/node_modules/@dsh-mywork/contracts → H:\Repo\DSH-MyWork\packages\contracts`); у нового пакета без установки их не будет. Сам E-03 называет это риском 3 — подтверждаю как действительный, а не мнимый. Второй пробел: тесты берут сборки из фиксированной карты `tests/lib/fixtures.mjs:16-29`, которой нет в «Файлы» ни у E-03, ни у E-06.
- **(д)** Дубля нет.

## E-04 (213-227) — два блокера
- **(а)** Все якоря точны: `schema.ts:48` = `CLAIM_SAGA_SCHEMA_VERSION = 6`, `:153` `CLAIM_SAGA_MIGRATIONS`, `store.ts:360` `insertAttempt`, `service.ts:90` `ClaimSagaDeps`, `attemptAndComplete` — `service.ts:440` (закрывается на `:613`) ✔; `worktree` в `schema.ts` не встречается ✔; `'abandoned'` — легальное состояние intent (`schema.ts:58`, `service.ts:712`) ✔; `PRAGMA user_version` действительно версия БД (`storage/src/sql.ts:118,143-144`) ✔.
- **Блокер 1 — версия 7 занята трижды в одной БД.** E-04 берёт `v7`, но `v7` уже заявлена F-36 (`20-STEPS:888`, таблица `background_job`) и F-40 (`20-STEPS:993`), плюс D09 (`10-DECISIONS:798`). Композируется **один** список и один `user_version` (`execution/src/index.ts:18-26`; `storage/src/migrations.ts:4,149-174`), а `validateMigrations` бросает `invalid-input` при неуникальной версии (`:117-119`: «migrations must be ordered by unique version»). Текущие версии: 1 (`storage/migrations.ts:50`), 2 (`evidence/schema.ts:140`), 3 (`:26`), 4 (`lease/schema.ts:22`), 5 (`planner/schema.ts:36`), 6 (`execution/schema.ts:48`) → свободна ровно 7, и её берут три шага. Гейт «`PRAGMA user_version` = 7» после F-36/F-40 не выполним. Сам план уже ловит этот класс конфликта ниже (`21-STEPS:473`: «миграцию `v8` не смешивать с `v7` (E-04)»), но столкновение с foundation не разрешено.
- **Блокер 2 — async-вызов внутри синхронной транзакции.** Предписанный порядок «`allocateFence → insertAttempt → worktrees.prepare → insertAttemptWorktree → событие attempt.lease.granted`»: `allocateFence` (`service.ts:375`), `insertAttempt` (`:389`) и `record({type:'attempt.lease.granted'})` (`:476-480`) находятся внутри `store.transaction(tx => …)` (`:453`), а сигнатура транзакции синхронна — `transaction<T>(fn: (tx: MyWorkTransaction) => T): T` (`storage/src/store.ts:59`). `worktrees.prepare` по контракту возвращает `Promise`, поэтому `await` в этой точке невозможен: точку вызова придётся выносить до транзакции, что меняет идемпотентность саги (и не описано).
- **(в)** `pass 5` соответствует пяти описанным тестам; регрессия `claim-saga.test.mjs` — 32 top-level `test(` (сосчитано в файле) → «`pass >= 32`» реалистично ✔. **(д)** Дубля нет; `attempt_worktree` в E-11 (`:334`) и E-19 (`:567`) — потребители.

## E-05 (229-241)
`packages/core/src/security.ts:203-207` — `worktreeRoot !== undefined && !isWithinRoot(...)` → код `'worktree-escape'` на `:205` ✔ (строки 203-207 точны). `packages/contracts/src/security.ts:257-258` — комментарий + `readonly worktreeRoot?: string` ✔. `assertOwnership` — `service.ts:405-429` ✔ точно. `isWithinRoot` экспортируется из core (`core/src/index.ts:299`), а execution вправе импортировать `@dsh-mywork/core` (`boundaries.test.mjs:438`) → реализация выполнима без правок чужого слоя, как и требует риск шага ✔. Дубля нет.

## E-06 (243-257)
F(retention) существует: `20-STEPS:925-947` — `packages/storage/src/retention.ts`, три функции с явным окном, гейт `pass 3` ✔; команда шага 0 даёт совпадения в 6 файлах, включая `20-STEPS-foundation.md` (план предусматривает этот случай). Якорь `.work/reports/MW-012-attempt-saga.md:240` точeн: `.tmp/mw012-review` действительно зарегистрирован — `git worktree list` показывает его вместе с `.tmp/f-audit` и `.tmp/v2-boundary-demo`, то есть чужих worktree **три**, а не один; фильтр по префиксу ветки их отсекает (все detached), поэтому тест (е) реалистичен. Дубля нет.

## E-07 (265-278)
**(а)** `agent-runtime.ts:223` `export interface AgentRuntimePort` ✔, `:68-69` ✔, `:87-96` `AgentResumeRequest` ✔, `testing.ts:332` `export class FakeAgentRuntime implements AgentRuntimePort` ✔ — якоря точны. `attempt-run.ts` отсутствует → Create ✔. **(в)** `pass 5` = пяти описанным тестам ✔.
**Опровергнуто (д):** «фейк-рантайм реализует порт без правок SDK». Поверхность порта — `start/resume/status/stop/events` (`:230,237,243,250,257`), причём `status(handle: AgentRuntimeHandle, options): Promise<AgentRuntimeStatus>` (`:243`, фейк `testing.ts:390`), тогда как планируемый `AttemptRunPort` объявлен как `run(...)`, а `status(runId): Result<AttemptRunStatus>` — другие и имя метода, и форма аргумента, и канал результата. Без правок SDK фейк этот порт не реализует. **Ожидаемый вывод шага 0 завышен:** 6 совпадений вместо «трёх». Дубля нет.

## E-08 (280-295)
**(а)** `packages/execution/src/worker.ts` отсутствует → Create ✔; `index.ts` — явный список экспортов (71 строка) → Modify применим ✔.
**Гейт шага 0 не станет непустым.** `packages/controller/src/index.ts` (274 строки) не содержит ни `openStore`, ни `createClaimSaga`, ни `ControllerLifecycle` (проверено командой) — но composition root по D07/F-28 живёт в **`packages/controller/src/app.ts`** (`20-STEPS:696` — «единственный composition root», `:744` — гейт грепает `packages\controller\src\app.ts` по `openStore(`); файла `app.ts` сегодня нет (`Test-Path` = False). Даже после F(composition root) греп по `index.ts` останется нулевым, а ре-экспорт `app.ts` в `index.ts` слова `openStore` в файл не добавляет.
**Тест (а) требует несуществующего вызова.** Порядок замкнут на `runtime.prompt`, но в `AgentRuntimePort` (`:223-258`) метода `prompt` нет: промпт — поле `AgentStartRequest.prompt` (`:73`), который «admits the prompt» внутри `start` (`:225,230`). Тест нельзя написать по контракту без изобретения метода.
**(г)** Ограничение шага 2 согласовано с `boundaries.test.mjs:436-441` и `:474-477` ✔. **(в)** `pass 7` = семи тестам ✔. **(д)** Дубля нет.

## E-09 (297-311)
**(а)** `attempt.ts:119-120` — часть контракта `Attempt` ✔ (но команда даёт ещё и `:18`, импорт `FrozenRevisions` — ожидание «:119-120» неполно). `artifact.ts:50-51` (`context-snapshot` на `:51`) и список метаданных `:82-96` (`correlationId:87`, `taskId:92`, `attemptId:93`) ✔; `putArtifact` есть (`evidence/src/artifacts.ts:132`) и идемпотентен при тех же байтах (`:153-158`), поэтому тесты (а)-(в) реалистичны.
**Опровергнуто:** «`revisions` пишутся в `attempt`-путь через существующий `settle`-путь (`store.ts:428`)». `settleAttempt` (`:428-453`) выполняет `UPDATE attempt SET state, revision = revision + 1, settled_at` — колонки `revisions` там нет и быть не может: в DDL `attempt` (`schema.ts:120-133`) **нет** колонки revisions, `insertAttempt` (`:363-366`) её не пишет, `toAttempt` (`:111-126`) её не читает, а `AttemptRecord` (`claim.ts:256-281`) её не имеет (поле `revisions` есть только у доменного `Attempt`, `attempt.ts:120`). «Файлы» E-09 (worker.ts + тест) не содержат миграции/правки store, поэтому цель шага («доказана артефактом **и записью в БД**») в описанном объёме недостижима. **(д)** Дубля нет.

## Итог по (д)
Ни один из E-01…E-09 не описан повторно в `20/22/23-STEPS-*.md` (grep по WorktreePort, worktree-adapter, worktree-binding/isolation/cleanup, AttemptRunPort, attempt-run, worker-flow, attempt-revisions — совпадения только в `21-STEPS-execution.md`).
