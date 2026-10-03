# MW-023 · E-17 (мост) — `AttemptGatePort` поверх `runGatePolicy`

- Предмет: shared task `task-7` (продолжение `E-17` карточки MW-023, план `.work/plan-v0.3/21-STEPS-execution.md:451-463`). Потребительская половина — `.work/reports/MW-023-gates-e17.md`, отчёт автора гейтов — `.work/reports/MW-023-gates.md` (не переписывались)
- Исполнитель: teammate `review-integrator-close`
- Репозиторий: `H:\Repo\DSH-MyWork`, base/head `33e6919db031fb79b9c34c0ada67d4c600b0405d` (незакоммиченное дерево; коммитов не делал, индекс не трогал)
- Окружение: Node `v24.x`, pwsh, сборка под `scripts/with-build-lock.mjs`
- Статус: **READY_FOR_REVIEW**

## 1. Проверка зависимости

| Что проверено | Команда | Результат |
|---|---|---|
| Порт объявлен Lead'ом и заморожен | `Select-String -Path packages/contracts/src/verification.ts -Pattern 'AttemptGatePort\|AttemptGateRequest'` | `AttemptGateRequest` — `:221`, `ATTEMPT_GATE_REQUEST_FIELDS` — `:235`, `AttemptGatePort.run` — `:256-262`. Контракт не правил |
| `runGatePolicy`/`resolveGatePolicy` на месте | `node --test --test-isolation=none "tests/gates-policy.test.mjs"` | `tests 6 / pass 6 / fail 0`, exit 0 |
| Пакет остаётся самодостаточным | `Select-String -Path packages/gate-runner/lib/index.js -Pattern '^\s*(import\|export)\s'` | только `node:child_process`, `node:crypto`, `node:path`, `node:util` + один `export {...}`; внешних пакетных импортов нет (contracts инлайнится) |
| Границы пакета | `node --test --test-isolation=none "tests/boundaries.test.mjs"` | `tests 31 / pass 31 / fail 0`, exit 0 — сканер `gate-runner` принимает новый модуль (`node:path` входит в `nodePrefix`) |

## 2. Что сделано

### 2.1 `packages/gate-runner/src/port.ts` (новый модуль, ~215 строк)

`createAttemptGatePort(options): AttemptGatePort` — единственная реализация шва, через который execution-слой получает вердикты гейтов, не умея запускать процессы. Три правила, зафиксированные в модуле:

1. **Head — из запроса, а не из worktree.** `readHead`, который видит политика, возвращает `request.headSha`; порт сам git не читает. Если вызывающий инъецировал настоящий ридер и он вернул другой commit, бросок `PinnedHeadMoved` (внутренний класс, не `GateError`) превращается в значение `{ refusal: 'GATE_HEAD_MOVED', results: [] }` — **до** первого гейта, поэтому ни один процесс не запускается и ни один лог не пишется. Дополнительно ответ отбрасывается, если сам раннер отчитался о другом head (`run.headSha !== request.headSha`).
2. **Отказ политики — значение.** `GATE_UNCONFIGURED` (нет политики у workspace), `GATE_DUPLICATE_ID` и `GATE_HEAD_MOVED` возвращаются как `{ ok: true, value: { headSha, results, refusal } }`; ни одна ветка не даёт `pass` без вердикта гейта.
3. **Бросает только дефект конфигурации.** `invalid-policy`, `invalid-spec`, `invalid-head` и недоступный head не превращаются в вердикт-подобное значение: это симптомы сломанной композиции, и прятать их за evidence нельзя. Невалидный **запрос** — исключение: он отвергается типизированно (`Result` с `ok: false`, код `CONTRACT_MISMATCH`, `details.field`/`details.reason`) до чтения политики и до любого процесса.

Валидация запроса (закрытая форма: лишнее поле отвергается, а не игнорируется; `headSha` — 40 lowercase hex; `cwd` — абсолютный и без сегмента `..`).

Часы и приёмник логов инъецируются (`clock`, `artifacts`), плюс опциональные `readHead`, `signal`, `maxBufferBytes`; чтений стеновых часов и `Math.random` в файле нет.

### 2.2 `packages/gate-runner/src/index.ts`

Добавлен `export * from './port.ts'` — `createAttemptGatePort` попадает в публичную поверхность пакета (см. `export {...}` бандла).

## 3. Изменённые файлы

| Файл | Что |
|---|---|
| `packages/gate-runner/src/port.ts` | новый модуль: `createAttemptGatePort`, `AttemptGatePortOptions`, внутренние `validateRequest`/`readPinned`/`PinnedHeadMoved` |
| `packages/gate-runner/src/index.ts` | +1 строка экспорта |
| `tests/gates-port.test.mjs` | новый файл, 5 тестов (а–д из task-7) |
| `.work/reports/MW-023-gates-port.md` | этот отчёт |

`packages/gate-runner/{package.json,tsdown.config.ts}` (зона `build-gate`) не тронуты: новых зависимостей нет. `packages/contracts/**` не тронуты.

## 4. Команды и exit codes

| # | Команда | Наблюдение | Exit |
|---|---|---|---|
| B-1 | `node_modules\.bin\tsc.cmd --noEmit -p packages/gate-runner/tsconfig.json` | без диагностик | **0** |
| B-2 | `Push-Location packages/gate-runner; node ../../scripts/with-build-lock.mjs gate-runner node ../../node_modules/tsdown/dist/run.mjs` | `✔ Build complete in 17574ms`; `lib/index.js` 64 837 B; `createAttemptGatePort` в списке экспортов | **0** |
| T-1 | `node --test --test-isolation=none "tests/gates-port.test.mjs"` (первый прогон) | `tests 5 / pass 4 / fail 1`: падал тест (г) на строке 200 — `join(cwd, '..', 'elsewhere')` **нормализует** `..`, поэтому проверялся обычный каталог. Ошибка теста, не порта; путь теперь пишется через `sep` | **1** |
| G-1 | `node --test --test-isolation=none "tests/gates-port.test.mjs"` | `tests 5 / pass 5 / fail 0 / skipped 0`, `duration_ms 1316.7` | **0** |
| G-2 | `node --test --test-isolation=none "tests/gates-policy.test.mjs"` | `tests 6 / pass 6 / fail 0` | **0** |
| G-3 | `node --test --test-isolation=none "tests/gates-runner.test.mjs"` | `tests 10 / pass 10 / fail 0` | **0** |
| G-4 | `node --test --test-isolation=none "tests/gates-head.test.mjs"` | `tests 5 / pass 5 / fail 0` | **0** |
| G-5 | `node --test --test-isolation=none "tests/gates-contract.test.mjs"` | `tests 5 / pass 5 / fail 0` | **0** |
| G-6 | `node --test --test-isolation=none "tests/gates-determinism.test.mjs"` | `tests 5 / pass 5 / fail 0` | **0** |
| G-7 | `node --test --test-isolation=none "tests/gates-admission.test.mjs"` | `tests 6 / pass 6 / fail 0` | **0** |
| G-8 | `node --test --test-isolation=none "tests/boundaries.test.mjs"` | `tests 31 / pass 31 / fail 0` | **0** |
| Σ | батч из 8 файлов выше, `2026-09-28 11:27` | `TESTS=73 PASS=73 FAIL=0 NONZERO=0` | **0** (каждый) |
| Σ-2 | **финальный сводный прогон**: 20 файлов (гейты + review + интегратор + `events` + `boundaries`), `2026-09-28 11:30:53` | `FILES=20 TESTS=131 PASS=131 FAIL=0 NONZERO=0`, в том числе `gates-port 5/5` и `boundaries 31/31` | **0** (каждый) |

## 5. Evidence (что доказывает какой пункт)

| Пункт task-7 | Тест | Наблюдение |
|---|---|---|
| (а) зелёный набор, порядок политики | `a green set arrives in policy order…` | `results.id = ['tests','lint']`, `refusal === undefined`, каждый вердикт `headSha === HEAD_SHA`, `exitCode 0`, в sink ровно 2 лога, `artifactRef` вердикта указывает на свой лог |
| (б) красный обязательный гейт — вердикт, а не отказ | `a red required gate is a verdict, not a refusal` | `refusal === undefined`, вердикты `pass`/`fail`, `exitCode 1`, `isGatePassing('fail') === false`, `results.length !== 0` (отказ не маскирует провал под «ничего не настроено») |
| (в) `GATE_HEAD_MOVED` как значение, `results: []` | `a checkout that moved is refused as a value…` | `ok: true`, `refusal 'GATE_HEAD_MOVED'`, `results []`, `headSha === HEAD_SHA`; при этом файл-маркер гейта **не создан** и в sink 0 записей (процесс не стартовал); позитивный контроль: с ридером, совпадающим с пином, маркер создаётся |
| (г) невалидный запрос — типизированный отказ без запуска процесса | `a malformed request is refused before a policy is read or a process starts` | 5 случаев (`headSha: ''`, `headSha: 'not-a-sha'`, относительный `cwd`, пустой `workspaceId`, отсутствующий `attemptId`) → `ok: false`, `code 'CONTRACT_MISMATCH'`, `details.field` называет поле; абсолютный путь с сегментом `..` → `details.reason 'escapes-worktree'`; лишнее поле `strict` → `reason 'undeclared-field'`; маркер не создан, sink пуст |
| (д) порт не читает head | `the answer is pinned to the request, not to what the worktree points at` | реальный временный git-репозиторий: пин — первый commit, в репозитории уже второй; ответ без отказа, `results[0].headSha` = пин и ≠ фактический HEAD; после третьего коммита повторный прогон даёт тот же набор `[id, verdict, headSha]` |

## 6. Mutation-check

| # | Действие | Наблюдение | Exit |
|---|---|---|---|
| M-1 | `Copy-Item packages\gate-runner\lib\index.js .tmp\review-integrator-close\gate-runner-lib-index.js.bak` | sha256 `66C917ED85E034D5D5C33DE21E2F094C160CB1ADF7B4C4341325E7F14EEE6129` | 0 |
| M-2 | поиск точки мутации в бандле: `if \(observed !== pinned\.headSha\)[^\r\n]*` | `occurrences: 1` — `if (observed !== pinned.headSha) throw new PinnedHeadMoved(pinned.headSha, observed);` | 0 |
| M-3 | замена на `/* mutation: the moved-head refusal is gone */` | оригинал: 0 совпадений, мутация: 1 — порт перестал замечать уехавший head | 0 |
| M-4 | `node --test --test-isolation=none "tests/gates-port.test.mjs"` на мутации | `tests 5 / pass 4 / fail 1`; падает **только** тест (в) на `assert.equal(answered.value.refusal, 'GATE_HEAD_MOVED')`: `+ actual undefined / - expected 'GATE_HEAD_MOVED'` (строка `159`) — детектор именно снятия отказа, остальные четыре теста зелёные | **1** |
| M-5 | восстановление из бэкапа | sha256 = `66C917ED…E6129` — байт-в-байт | 0 |
| M-6 | пересборка под локом | `✔ Build complete in 18698ms`, exit **0**, sha256 пересобранного `lib/index.js` = `66C917ED…E6129` (сборка детерминирована, следов мутации нет) | **0** |
| M-7 | повторный прогон после восстановления и пересборки | `tests 5 / pass 5 / fail 0`, затем батч 8 файлов `73/73`, `NONZERO=0` | **0** |

## 7. Ограничения и что осталось непроверенным

1. **Производителя по-прежнему нет: `worker.ts` не вызывает порт.** Эта задача дала мост, но не вызов: `WorkerDeps.gates` и запись `gate-result` — `task-6` (исполнитель `execution-close`, файл `packages/execution/src/worker.ts`). Пока вызова нет, схема остаётся fail-closed: очередь отказывает при отсутствии `gate-result` (`.work/reports/MW-023-gates-e17.md`).
2. **`attemptBaseSha` порту не передаётся**: в `AttemptGateRequest` (контракт Lead'а) его нет, поэтому резервный гейт `base` получит `error`/`GATE_MISSING`, если политика его настроит. `head`-гейт работает: порт передаёт `expectedHeadSha = request.headSha`. Расширять контракт — решение Lead'а, не моё.
3. **`invalid-policy`/`invalid-spec` бросают, а не возвращаются значением** — сознательно (см. §2.1 п. 3); тестами эти ветки не покрыты, потому что они не про порт, а про композицию. Если Lead'у нужен отказ-значение и для них, это правка решения, а не дефект.
4. **Тест загружает пакеты по путям (`gate-runner`, `contracts`, `adapter-sdk/lib/testing.js`), а не через `tests/lib/fixtures.mjs`** — сознательно: иначе чужие окна `clean:true` валили бы сюиту на «missing build output» (находка N-1…N-5 отчёта MW-023). Обратная сторона: тест не проверяет, что `fixtures.mjs` знает `gateRunner` — это уже проверено прогонами `tests/gates-runner.test.mjs`.
5. **Полный набор тестов не гонялся** — зона `build-gate`; здесь 73 теста восьми файлов.

## 8. Статус и следующий шаг

**READY_FOR_REVIEW.** Мост реализован, 5 тестов task-7 зелёные, mutation-check пройден (красное ровно на снятии отказа о уехавшем head, зелёное после восстановления и пересборки). Приёмку не объявляю: нужен независимый ревьюер. Следующий шаг — `task-6` (вызов порта в `worker.ts`), после него цепочка E-17 замкнута: воркер запускает гейты → пишет `gate-result` → очередь допускает review только по полному зелёному набору. Коммитов не делал.
