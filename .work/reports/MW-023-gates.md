# MW-023 · Детерминированные verification gates (E-13…E-18, кроме E-17)

**Статус:** READY_FOR_REVIEW
**Исполнитель:** gates-dev (WS-2 / `task-2`)
**План:** `.work/plan-v0.3/21-STEPS-execution.md:390-480` (группа C), карточка `.work/tasks/MW-023.md`
**Пакет:** `packages/gate-runner/**` (новый), тесты `tests/gates-*.test.mjs`, пиннинг в `tests/evidence.test.mjs`

---

## 1. Зависимость

| Шаг | Зависит от | Состояние зависимости на момент работы |
|---|---|---|
| E-13 | E-08 (контракты) | **Закрыта Lead'ом до старта**: `packages/contracts/src/verification.ts` (GateSpec/GateResult/GateVerdict/GatePolicy/GateRefusalReason/isGatePassing/GATE_*), `'gate-result'` в `packages/contracts/src/artifact.ts:66,82`, реэкспорт `packages/contracts/src/index.ts:100`. Я эти файлы не правил. |
| E-14 | E-13, E-03 | E-13 закрыта; **E-03 (`packages/worktree-adapter`) отсутствует** — пакета нет в `packages/`, `task-1` в статусе `in_progress`. Следствие: чтение head инъецируется (`HeadReader`), см. §6. |
| E-15 | E-14 | закрыта этим отчётом |
| E-16 | E-14 | закрыта этим отчётом |
| E-17 | E-16 | **не делался** — ведёт WS-3 (`packages/execution/src/gates-admission.ts`, `task-3`) |
| E-18 | E-14, D11 | D11 закрыт: часы инъецируются через `ClockPort` (`packages/contracts/src/index.ts:56`), образец — `packages/scheduler/src/service.ts:312` |

Шаг 0 E-16 (где живёт конфигурация workspace) и шаг 0 E-18 (инъецированные часы) — см. §4, команды `T-1`…`T-4`.

---

## 2. Что сделано

### E-13 · Контракт `GateSpec`/`GateResult` и вид артефакта `gate-result`
- Создан `tests/gates-contract.test.mjs` — **5 тестов** пиннинга: (а) словарь видов вырос ровно на 1 и порядок прежних 12 не изменился, `gate-result` строго после `gate-decision`; (б) пять вердиктов закрыты, `isGatePassing` истинно только для `pass`, `error`/`timeout`/`cancelled` — отказ; (в) `GATE_SPEC_FIELDS`; (г) `GATE_RESULT_FIELDS` + `GIT_SHA_LENGTH = 40`; (д) `missing` выражен причиной отказа (`GATE_MISSING`), а не отсутствием записи и не шестым вердиктом.
- В `tests/evidence.test.mjs` добавлен 1 тест (35 строк): пиннинг `ARTIFACT_KINDS` + **поведенческая** проверка — запись артефакта вида `gate-result` через `createArtifactStore` проходит и читается обратно, а вид `gate-result-typo` отвергается (`EvidenceError/invalid-input`, `packages/evidence/src/metadata.ts:157` `readVocabulary`). Это доказывает, что store читает тот же закрытый словарь, а не «знает любое слово».
- Контракты не переписывались; формы хватило всем шагам (см. §6 про трактовку `exitCode` у гейтов-сравнений).

### E-14 · Раннер гейтов: bounded timeout/cancel, ошибка инструмента ≠ PASS
- Создан пакет `packages/gate-runner/**` (`src/{index,runner,policy,errors}.ts`).
- `runGate(spec, {workspaceId, cwd, headSha, clock, artifacts, signal?, maxBufferBytes?})` — `execFile` без shell (`shell:false`, `windowsHide:true`), обязательные `timeout: spec.timeoutMs` и `maxBuffer` (по умолчанию `GATE_LOG_MAX_BYTES = 1 MiB`), `encoding: 'utf8'`.
- Классификация исхода (порядок важен и зафиксирован в коде): `signal.aborted → cancelled` → `ERR_CHILD_PROCESS_STDIO_MAXBUFFER → error (усечение в логе)` → `killed → timeout` → `code: string (ENOENT/EACCES/…) → error + GATE_TOOL_MISSING` → `code: number → fail` → иначе `error`. **Ни одна ветка не даёт `pass`**; `pass` возможен только при отсутствии ошибки процесса.
- Лог (stdout+stderr+exit+причина) пишется в sink **до** возврата вердикта; `artifactRef` есть у всех вердиктов, включая `error`/`timeout`/`cancelled`.
- `tests/gates-runner.test.mjs` — **10 тестов**: 8 плановых (а–з) + 2 добавленных: усечение при `maxBuffer` (вердикт `error`, не `pass`) и отказ невалидного spec/head до запуска (`invalid-spec`, `invalid-head`, ноль записей в sink).
- Границы каталога: `spec.cwd` обязан быть относительным и без `..`; `resolveGateCwd` дополнительно проверяет, что итоговый путь внутри worktree.

### E-15 · Пиннинг exact head: `GATE_HEAD_MOVED`
- `runGatePolicy` читает head **до первого гейта, между гейтами и после последнего**; расхождение → `{headSha: <пиннутый>, results: [], refusal: 'GATE_HEAD_MOVED'}`. Артефакты не удаляются (sink — единственный след того, что гейты реально отработали).
- `tests/gates-head.test.mjs` — **5 тестов**: (а) неподвижный head → вердикты валидны и каждый несёт `headSha`; (б) расхождение между гейтами (второй гейт не запускается) и расхождение после последнего (оба вердикта отброшены) + печать пары head'ов; (в) `GateRunResult.headSha` заполнен и при отказах `GATE_UNCONFIGURED`/`GATE_DUPLICATE_ID`; (г) артефакты отброшенных вердиктов на месте (2 лога, sha256 каждого сходится); (д) `createGitHeadReader` на отдельном временном репозитории: head до/после `git commit --allow-empty` различается, ридер следует за ним.
- Тест (б) не коммитит в рабочий репозиторий: head двигает **инъецированный** ридер (`scriptedHead`), а реальный git проверяется в throwaway-репозитории в `$env:TEMP`.

### E-16 · Набор гейтов по workspace/task и отказ `GATE_UNCONFIGURED`
- `policy.ts`: `GatePolicySource`/`defineGatePolicySource` (замороженный lookup по `workspaceId`), `resolveGatePolicy` (нет политики → `GateError/gate-unconfigured`, что вызывающий отображает в `GATE_UNCONFIGURED`).
- Пустая политика → `{refusal: 'GATE_UNCONFIGURED', results: []}` (не «пропуск» и не `pass`); дубли id → `{refusal: 'GATE_DUPLICATE_ID'}` до запуска процессов.
- `isBlockingGate` = `policy.strict === true || gate.required !== false`; `blockingGateIds`/`gatesSatisfied` — чистые функции (опциональный `headSha` ограничивает учёт вердиктов одним head).
- Резервные id `base`/`head` — сравнения без процесса: `base` сверяет `attemptBaseSha` с проверяемым head, `head` — `expectedHeadSha`. Расхождение → `fail`; незаданное значение → `error` + `GATE_MISSING`; `exitCode` всегда `null` (процесс не запускался — вердикт и есть носитель исхода).
- `tests/gates-policy.test.mjs` — **6 тестов**: (а) пустая политика + отказ резолвера + отказ на двойную конфигурацию workspace; (б) политика с одним гейтом → ровно один прогон и один лог; (в) информационный гейт не блокирует, обязательный блокирует, `strict` расширяет правило; (г) `base`-гейт: совпадение → `pass`, расхождение → `fail`, отсутствие base → `error/GATE_MISSING`; (д) отсутствующий бинарь → `error` и блокировка; (е) набор берётся из workspace и задача его не расширяет.

### E-18 · Детерминизм вердикта и инъецированные часы
- `startedAt`/`settledAt` берутся из `ClockPort` и передаются в sink; в контракте `GateResult` полей времени нет намеренно, поэтому вердикт не зависит от часов. В исходниках пакета нет чтения стеновых часов и генераторов случайности (тест (г)).
- Лог — чистая функция от того, что сделала команда (без отметок времени), поэтому один head + один гейт + тот же вывод дают один digest.
- `tests/gates-determinism.test.mjs` — **5 тестов**: (а) два прогона → одинаковые `verdict`/`exitCode`/`reason`/`headSha`; (б) разные длительности (25 ms vs 400 ms, замер напечатан) → одинаковый `verdict`/`exitCode`; (в) `startedAt === settledAt === clock.now()` (FakeClock); (г) скан `packages/gate-runner/src/*.ts` на `Date.now|Math.random|new Date|performance.now` → 0 совпадений + положительный контроль внутри теста; (д) одинаковый digest лога у двух прогонов.

---

## 3. Файлы

| Файл | Строк | Что |
|---|---|---|
| `packages/gate-runner/package.json` | 27 | манифест пакета (`@dsh-mywork/gate-runner`, devDep `@dsh-mywork/contracts`) |
| `packages/gate-runner/tsconfig.json` | 4 | extends `../../tsconfig.base.json` |
| `packages/gate-runner/tsdown.config.ts` | 25 | сборка в `lib/`, `alias` + `alwaysBundle` для contracts |
| `packages/gate-runner/src/index.ts` | 14 | реэкспорт модулей |
| `packages/gate-runner/src/errors.ts` | 67 | `GateError`, `GATE_ERROR_CODES`, `isGateError` |
| `packages/gate-runner/src/runner.ts` | 516 | `runGate`, `settleLocalGate`, `renderGateLog`, `sha256OfLog`, `createGitHeadReader`, валидаторы, константы |
| `packages/gate-runner/src/policy.ts` | 302 | `runGatePolicy`, `resolveGatePolicy`, `defineGatePolicySource`, `blockingGateIds`, `gatesSatisfied` |
| `packages/gate-runner/lib/{index.js,index.d.ts,+maps}` | — | собранный вывод (сборка под локом Lead'а) |
| `tests/gates-contract.test.mjs` | 108 | 5 тестов (E-13) |
| `tests/gates-runner.test.mjs` | 259 | 10 тестов (E-14) |
| `tests/gates-head.test.mjs` | 175 | 5 тестов (E-15) |
| `tests/gates-policy.test.mjs` | 191 | 6 тестов (E-16) |
| `tests/gates-determinism.test.mjs` | 142 | 5 тестов (E-18) |
| `tests/evidence.test.mjs` | +35 | 1 тест: пиннинг словаря + приём `gate-result` store'ом (E-13) |

Итого **31 новый тест** в 5 файлах + 1 тест в `tests/evidence.test.mjs` (20 в файле).

---

## 4. Команды и exit-коды

Канон: pwsh, только точечная сборка под локом, тесты — `node --test --test-isolation=none "<file>"`.

### Шаг 0 (evidence плана) и текстовые гейты

Текстовые гейты обёрнуты в условие, которое **само выставляет код**: `$hits = @(Select-String …); if (<ожидание>) { exit 0 } else { exit 1 }` — иначе у cmdlet'а `$LASTEXITCODE` не выставляется вовсе (дефект R-07: гейт, всегда дающий один и тот же результат).

| # | Команда | Наблюдение | Exit |
|---|---|---|---|
| T-1 | `$t = @(Select-String -Path packages/contracts/src/config.ts -Pattern 'export interface\|export type'); $r = @(Select-String … 'export interface ResolvedWorkspaceConfig'); if ($t.Count -ge 10 -and $r.Count -eq 1) { exit 0 } else { exit 1 }` | `declarations=10 ResolvedWorkspaceConfig=1 line=195` — корень конфигурации workspace существует; своего второго источника не заводил, `GatePolicy` ключуется по `workspaceId` (`:197`) | **0** |
| T-2 | `…verification.ts -Pattern 'export interface GatePolicy'` + `'readonly workspaceId: WorkspaceId'` | `GatePolicy=1 workspaceId=1 lines=176,178` — политика уже привязана к workspace | **0** |
| T-3 | `…scheduler/src/service.ts -Pattern 'clock\.now\|ClockPort'` | `hits=4 lines=29,129,191,312` — образец инъекции часов (`this.clock.now()`) | **0** |
| T-4 | `$h = @(Select-String -Path packages/gate-runner/src/*.ts -Pattern 'Date\.now\|Math\.random'); if ($h.Count -eq 0) { exit 0 } else { exit 1 }` | `wall-clock matches=0` — гейт E-18 | **0** |
| T-5 | `git status --short` | `packages/gate-runner/` — untracked; `packages/worktree-adapter/` отсутствует (E-03 не готова) | 0 |

### RED (до реализации)

| # | Команда | Наблюдение | Exit |
|---|---|---|---|
| R-1 | `node --test --test-isolation=none "tests/gates-contract.test.mjs"` | `pass 5 / fail 0` — **зелёный с первого прогона**, т.к. контракты созданы Lead'ом до старта (см. §1); невakуумность доказана контролем F-1 | 0 |
| R-2 | `node --test --test-isolation=none "tests/gates-runner.test.mjs"` | `ERR_MODULE_NOT_FOUND: file:///H:/Repo/DSH-MyWork/packages/gate-runner/lib/index.js` | **1** |
| R-3 | то же для `gates-head` / `gates-policy` / `gates-determinism` | тот же `ERR_MODULE_NOT_FOUND` | **1** (каждый) |

### Сборка и типизация

| # | Команда | Наблюдение | Exit |
|---|---|---|---|
| B-1 | `node_modules\.bin\tsc.cmd --noEmit -p packages/gate-runner/tsconfig.json` | без диагностик | **0** |
| B-2 | `Push-Location packages/gate-runner; node ../../scripts/with-build-lock.mjs gate-runner node ../../node_modules/tsdown/dist/run.mjs; Pop-Location` | `✔ Build complete in 24868ms`; `lib/index.js` 57 038 B; внешних импортов, кроме `node:child_process`/`node:crypto`/`node:path`/`node:util`, нет | **0** |
| B-3 | `Select-String -Path packages/gate-runner/lib/index.js -Pattern '^\s*(import\|export)\s'` | только 4 `node:*` импорта + `export {...}` — пакет самодостаточен | 0 |

### GREEN (после реализации)

Финальный непрерывный прогон (23:05:38, все 12 собранных точек входа на месте; см. N-1…N-4 о чужих окнах сборки):

| # | Команда | Наблюдение | Exit |
|---|---|---|---|
| G-1 | `node --test --test-isolation=none "tests/gates-contract.test.mjs"` | `tests 5 / pass 5 / fail 0 / skipped 0` | **0** |
| G-2 | `node --test --test-isolation=none "tests/gates-runner.test.mjs"` | `tests 10 / pass 10 / fail 0 / skipped 0` | **0** |
| G-3 | `node --test --test-isolation=none "tests/gates-head.test.mjs"` | `tests 5 / pass 5 / fail 0 / skipped 0` | **0** |
| G-4 | `node --test --test-isolation=none "tests/gates-policy.test.mjs"` | `tests 6 / pass 6 / fail 0 / skipped 0` | **0** |
| G-5 | `node --test --test-isolation=none "tests/gates-determinism.test.mjs"` | `tests 5 / pass 5 / fail 0 / skipped 0` | **0** |
| G-6 | `node --test --test-isolation=none "tests/evidence.test.mjs"` | `tests 20 / pass 20 / fail 0 / skipped 0` | **0** |
| G-7 | `node --test --test-isolation=none "tests/boundaries.test.mjs"` | `tests 31 / pass 31 / fail 0 / skipped 0` — новых падений нет (пакет пока не в сканере `INFRA_PACKAGES`, см. §6.5) | **0** |

### Аудит стиля пакета

| # | Проверка | Наблюдение | Exit |
|---|---|---|---|
| A-1 | `Select-String packages/gate-runner/src/*.ts -Pattern 'TODO\|FIXME\|XXX\|HACK'` | 0 совпадений | 0 |
| A-2 | `Select-String … -Pattern '[\u0400-\u04FF]'` (кириллица в исходниках) | 0 совпадений — код и комментарии английские, отчёт русский | 0 |
| A-3 | `Select-String … -Pattern 'Date\.now\|Math\.random\|new Date\|performance\.now'` | 0 совпадений | 0 |
| A-4 | скан `export (const\|function\|class\|interface\|type\|async function)` без предшествующего JSDoc | `exported declarations checked=37 without-jsdoc=0` | **0** |
| A-5 | скан полей интерфейсов без JSDoc | `interface fields checked=51 undocumented=0` | **0** |

### Контроль невakуумности (фальсификация)

| # | Команда | Наблюдение | Exit |
|---|---|---|---|
| F-1 | `node --input-type=module -e "…assert.deepEqual([...c.ARTIFACT_KINDS], withoutGateResult)…"` | `assertion-without-gate-result-throws=true` — утверждение пиннинга действительно может упасть | **0** (контроль пройден) |
| F-2 | внутри `tests/gates-determinism.test.mjs` (г) | `/Date\.now/.test("const t = Date.now()") === true` — скан невakуумный | 0 |

### Отдельная находка: устаревший `packages/evidence/lib`

| # | Команда | Наблюдение | Exit |
|---|---|---|---|
| B-4 | `Push-Location packages/evidence; node ../../scripts/with-build-lock.mjs evidence node ../../node_modules/tsdown/dist/run.mjs; Pop-Location` | `✔ Build complete in 27030ms`; `gate-result hits in packages/evidence/lib/index.js: 0` → `1`. **Причина:** `packages/evidence` инлайнит `ARTIFACT_KINDS` из contracts в свой бандл, а шаг E-13 плана пересобирает только `packages/contracts`. До пересборки `artifacts.put({kind:'gate-result'})` отвергался (`readVocabulary`), т.е. `tests/evidence.test.mjs` падал (`fail 1`). Исходники `packages/evidence/src` не менялись — только сгенерированный `lib/` | **0** |

Проверено, что та же усталость есть у остальных бандлов (`gate-result hits in lib: contracts 1; evidence 0→1; core/planner/execution/controller/scheduler/storage/lease 0`): их нужно пересобрать полным прогоном Lead'а, иначе любой потребитель `ARTIFACT_KINDS` из этих пакетов не примет новый вид. **Источники не правились.**

### Состояние регрессионных прогонов на момент сдачи (след чужой сборки)

| # | Команда | Наблюдение | Exit |
|---|---|---|---|
| N-1 | `Select-String packages/execution/lib/index.js` / `Test-Path` | в конце работы `packages/execution/lib/index.js` **отсутствует**: чужой `clean:true`-прогон удалил `lib/`, после чего любые тесты, грузящие `tests/lib/fixtures.mjs`, падают на импорте: `domain tests: missing build output: packages/execution/lib/index.js`. Мои шесть файлов от этого не зависят (грузят только `packages/gate-runner/lib` и `packages/contracts/lib`), поэтому G-1…G-5 остаются зелёными | — |
| N-2 | `Push-Location packages/execution; node ../../scripts/with-build-lock.mjs execution node ../../node_modules/tsdown/dist/run.mjs; Pop-Location` | **OOM**: `FATAL ERROR: Ineffective mark-compacts near heap limit … JavaScript heap out of memory` (лимит ~4085 MB) | **134** |
| N-3 | та же команда с `NODE_OPTIONS=--max-old-space-size=8192` под локом | `✔ Build complete in 40527ms`, `EXIT=0`, `packages/execution/lib/index.js` восстановлен (памяти на машине 32 GB, свободно ~11.6 GB). Правок в исходники `execution` я не вносил — только пересборка чужого `lib/` | **0** |
| N-4 | повторный прогон батча через несколько минут | `execution/lib` **снова отсутствует**: параллельная чужая сборка с `clean:true` удаляет `lib/` на время своей сборки, поэтому все сюиты, грузящие `tests/lib/fixtures.mjs`, падают на импорте (у `fixtures.mjs:31` проверяются **все** 12 собранных точек входа, включая чужие). Лок сериализует сборки, но не закрывает окно между `clean` и записью файлов | — |
| N-5 | `while (missing libs) { sleep 10 }` + прогон батча целиком, с повтором при потере окна | финальный непрерывный прогон (§4 GREEN) прошёл полностью: `5/10/5/6/5` в моих файлах, `20/20` evidence, `31/31` boundaries; до этого — несколько прерванных попыток на чужих окнах сборки | **0** |

**Следствие для Lead'а (не мой дефект, но блокирует общий прогон):** сборка `packages/execution` на дефолтном heap падает по памяти (**134**), а её `clean:true`-окно обнуляет `packages/execution/lib`. Лечится `NODE_OPTIONS=--max-old-space-size=8192` (проверено, `EXIT=0`) и/или прогоном сборок до тестов в одном шаге. Дополнительно: `tests/lib/fixtures.mjs:31-36` проверяет существование всех пакетов сразу, поэтому чужая сборка валит и мои сюиты — точечный импорт (`repoRoot`/`adapterTesting` без общего пре-чек) развязал бы их.

---

## 5. Evidence (наблюдения)

### 5.1 Отображение «что произошло» → вердикт (проба на собранном `lib/`, head `0123…4567`)

```
exit 0         -> verdict=pass      exitCode=0    reason=-                 artifact=probe-1 sha256=61f30bff18670f34d75891d95f9831b70c44eb4b87f61ef93ddc7b9084ac5e91
exit 1         -> verdict=fail      exitCode=1    reason=-                 artifact=probe-2 sha256=134cf7b6044d6fe74737a56fd1e2eb141562ea894b79a6f5af6f7441bca920df
missing tool   -> verdict=error     exitCode=null reason=GATE_TOOL_MISSING artifact=probe-3 sha256=1c1f856a4844eb5ac189dc37dba31f4f031ad3ab1e8cab915b535cc35fb77ed2
timeout 250ms  -> verdict=timeout   exitCode=null reason=-                 artifact=probe-4 sha256=f800c99ae62c8d584579842c928f04ae44fc8f98420314d9ff9948df5aaf0c24
aborted        -> verdict=cancelled exitCode=null reason=-                 artifact=probe-5 sha256=ee39d14a6c9fc9cf93a11ddaf2c204944d3ad0300a581113a6f095d5f18ded53
isGatePassing: pass=true fail=false error=false timeout=false cancelled=false
```

Требование «ошибка инструмента/таймаут/отмена ≠ PASS» выполнено и **на каждом** вердикте есть `artifactRef` (в т.ч. у `error`, который вообще не запускался).

### 5.2 Убийство процесса по таймауту (E-14, тест «г»)

```
verdict=timeout exitCode=null reason=- pid=36996 alive-immediately-after=false alive-after-1s=false
log lines: verdict timeout | killed true | truncated false
```

Процесс, переживший `timeoutMs` (300 ms, ребёнок спал 30 s), убит: `process.kill(pid, 0)` сразу после возврата вердикта и через 1 s даёт `ESRCH`.

### 5.3 Пример лога артефакта (E-14, тест «б», гейт с exit 1)

```
gate tests
head 0123456789abcdef0123456789abcdef01234567
command C:\Program Files\nodejs\node.exe
args ["-e","process.exit(1)"]
cwd C:\Users\Dmitry\AppData\Local\Temp\dsh-mywork-gate-probe-HTNbvC
timeoutMs 10000
verdict fail
exitCode 1
reason -
killed false
truncated false
--- stdout ---

--- stderr ---
```

Оба потока присутствуют (в тесте «б» проверяются маркеры `OUT-MARK` и `ERR-MARK`); `sha256` этого лога — `134cf7b6…20df`. В логе нет отметок времени — поэтому digest детерминирован (тест E-18 «д»).

### 5.4 Exact head (E-15, тест «б»)

```
GATE_HEAD_MOVED head-before=1111111111111111111111111111111111111111 head-after=2222222222222222222222222222222222222222
```

Отказ `GATE_HEAD_MOVED`, `results: []`, `headSha` — **пиннутый** (`1111…`), в sink остаются 1 лог (расхождение между гейтами: второй гейт не запускался) или 2 лога (расхождение после последнего гейта). Кандидат в `needs-attention` этот отказ даёт на уровне вызывающего слоя (словарь `NeedsAttentionReason` — не моя область, я его не расширял).

### 5.5 Пример политики и admission (E-16)

```
policy        = {"workspaceId":"W-1","strict":false,"gates":[{"id":"build",…,"timeoutMs":10000},{"id":"benchmark",…,"timeoutMs":10000,"required":false}]}
policy run    = results[build=pass benchmark=fail] head=0123…4567 refusal=none
admission     = blocking[] satisfied=true
unconfigured  = GateError/gate-unconfigured
```

Информационный `benchmark` красный, но не блокирует; отсутствие политики — типизированный отказ, а не дефолтный набор.

### 5.6 Часы (E-18, тест «в»)

`startedAt === settledAt === 7_654` — оба чтения из `FakeClock`, стеновые часы в исходниках отсутствуют (T-4: 0 совпадений).

### 5.7 Реальные дефекты, найденные тестами до их исправления

Первый прогон после реализации дал `fail 1` в `gates-runner`, `fail 1` в `gates-head`, `fail 2` в `gates-policy`; тесты не были вакуумными:
- (тест) `CWD=`-маркер вычитывался из строки `args` лога, а не из секции stdout → заменено на извлечение секции (`capturedStdout`);
- (тест) `git init --quiet -c user.email=…` — `-c` обязан идти до подкоманды → исправлен порядок аргументов;
- (тест) ожидался `exitCode: 0` у гейта-сравнения → по контракту процесса не было, `exitCode: null`; утверждение приведено в соответствие с контрактом и снабжено пояснением;
- (тест) `gates.GATE_POLICY_FIELDS` — реэкспорта словаря из пакета нет by design → тест читает словарь из `contracts`.

---

## 6. Ограничения

1. **E-03 не готова — head читается инъекцией (главное ограничение E-15).** `packages/worktree-adapter` отсутствует, поэтому `runGatePolicy` требует `readHead: HeadReader` (`(cwd) => Promise<string>`) и **сам git не вызывает**. Для продакшена в пакете есть `createGitHeadReader()` — фиксированный spec `git -C <cwd> rev-parse HEAD` без shell, с `timeout`/`maxBuffer`; он проверен на отдельном временном репозитории (тест «д»). Когда E-03 доставит `GitPort.resolveHead` (`packages/contracts/src/git.ts:94`, `Promise<Result<string>>`), подключение в composition-слое — одна строка:
   ```ts
   const readHead = async (cwd: string) => {
     const result = await git.resolveHead(cwd, meta)
     if (!result.ok) throw new GateError('head-unavailable', result.error.message, { cause: result.error })
     return result.value
   }
   ```
   (или `createGitHeadReader()`, если гейт-раннер запускается там, где `GitPort` недоступен). Сам `GitPort` я не импортирую: `packages/gate-runner` намеренно не зависит от `worktree-adapter`.
2. **E-17 не сделан** (другая область записи): `assertGatesSatisfied`/запись `gate-result` перед `awaiting-review` живут в `packages/execution/src/gates-admission.ts` и `worker.ts` — их пишет WS-3. Мой вклад в эту связку — `gatesSatisfied`/`blockingGateIds` (чистые функции с опциональным `headSha`) и `GateRunResult.refusal`.
3. **`exitCode` у гейтов-сравнений равен `null`** (в т.ч. у `pass`): процесса не было, и контракт прямо говорит «`null`, когда ни один процесс не сообщил код». Носитель исхода — `verdict`. Если E-17 ожидает числовой код у `base`/`head`, это надо решить на уровне карточки, а не подделкой кода.
4. **`tests/lib/fixtures.mjs` не трогал** (по указанию): свои тесты грузят пакет через `pathToFileURL(join(repoRoot, 'packages/gate-runner/lib/index.js'))`. Lead'у для полноты нужна строка `gateRunner: 'packages/gate-runner/lib/index.js'` в `entries`.
5. **`tests/boundaries.test.mjs` пакет ещё не сканирует** (файл вне моей области записи). Предлагаемая вставка в `INFRA_PACKAGES` (после `beads-adapter`):
   ```js
   {
     key: 'gate-runner',
     sources: collect(join(repoRoot, 'packages', 'gate-runner', 'src'), ['.ts']),
     min: 4,
     allowed: ['@dsh-mywork/contracts'],
     expected: ['@dsh-mywork/contracts'],
     nodePrefix: true,
   },
   ```
   Это соответствует факту: `src` импортирует только `@dsh-mywork/contracts` и `node:child_process|crypto|path|util`.
6. **Установка workspace не выполнялась** (`pnpm-lock.yaml` трогать запрещено). Пакет собирается без `node_modules`-линка благодаря `alias` в `tsdown.config.ts`, который резолвит contracts через путь tsconfig. `pnpm -r run build` должен подхватить пакет по глобу `packages/*`; `tsdown` резолвится из корневого `node_modules/.bin` — так же, как у `execution`/`scheduler` (у них тоже нет собственного `node_modules/.bin`). Проверить это на полном прогоне может только Lead (я `-r` не запускал по канону); при необходимости — `pnpm install` для записи импортёра в lock.
7. **`with-build-lock.mjs` не умеет запускать `.cmd`-шимы** (`spawnSync corepack ENOENT`), поэтому проверка «сборка через pnpm-скрипт пакета» осталась невыполненной: сборка делалась канонической прямой командой tsdown под локом (B-2). Это ограничение инструмента, не пакета.
8. **`packages/evidence/lib` пересобран** (генерированный вывод, исходники не менялись) — иначе `tests/evidence.test.mjs` не проходит из-за инлайна старого словаря (B-4). Остальные бандлы потребителей `ARTIFACT_KINDS` требуют пересборки в финальном прогоне Lead'а.
9. **Отмена на Windows проверена только для одиночного процесса**: `execFile` убивает прямого ребёнка (тест «г»/«д»), но не дерево процессов. Спеки гейтов обязаны называть исполняемый файл (`node`, `git`); `.cmd`-шимы (`pnpm.cmd`) с `shell:false` в Node ≥ 18.20 не запускаются вовсе, поэтому в spec'ах их быть не должно — это записано здесь как решение вместо `E-01`-файла.
10. Внешних сетевых/платных вызовов нет; все процессы — фиксированные spec'ы с `shell:false`, `windowsHide:true`, явными `timeout` и `maxBuffer`. Временные каталоги удаляются в `after()` каждого файла, живой `$DSH_HOME` не читается и не пишется.

---

## 7. Статус

**READY_FOR_REVIEW.**

Гейты E-13…E-16, E-18 пройдены: финальный непрерывный прогон — `pass 5 / 10 / 5 / 6 / 5`, `fail 0`; `tests/evidence.test.mjs` — `pass 20 / fail 0` (в нём +1 мой тест); `tests/boundaries.test.mjs` — `pass 31 / fail 0`; типизация — `EXIT=0`; сборка пакета под локом — `EXIT=0`; аудит стиля — 0 `TODO`, 0 кириллицы, 0 чтений стеновых часов, JSDoc `37/37` экспортов и `51/51` полей.

Приёмку не объявляю. Ревьюеру: §4 (R-1…R-3, G-1…G-7, B-2, B-4, F-1, A-1…A-5) и §6. Действия, ожидающие Lead'а: (4) строка `gateRunner` в `tests/lib/fixtures.mjs`; (5) запись `gate-runner` в `INFRA_PACKAGES`; (6) `pnpm install` для импортёра нового пакета в lock и полный прогон; (8) пересборка остальных потребителей `ARTIFACT_KINDS`; плюс N-3/N-4 — heap для сборки `packages/execution` (`NODE_OPTIONS=--max-old-space-size=8192`) и её `clean:true`-окно, валящее `fixtures.mjs`.
