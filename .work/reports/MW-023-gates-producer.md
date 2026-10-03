# MW-023 / E-17 — производитель `gate-result` в worker (доведение до проверяемого состояния)

- Предмет: карточка доски `650491a3-db89-4716-abe7-d317d89482e1` (MW-023), шаг `E-17`, половина «Modify `packages/execution/src/worker.ts` (запись `gate-result` перед `awaiting-review`)» (`21-STEPS-execution.md:455`)
- Исполнитель: тиммейт `execution-close` команды этапа 4 над `H:\Repo\DSH-MyWork`, модель `deepseek-v4.1-flash`
- Репозиторий: `H:\Repo\DSH-MyWork`, base SHA `33e6919db031fb79b9c34c0ada67d4c600b0405d`, HEAD после работы **тот же** (коммитов нет, git-индекс не трогался)
- Окружение: Node `v24.19.0`, git `2.55.0.windows.3`, pnpm `12.4.2`
- Статус: **READY_FOR_REVIEW**

Этот отчёт — только про производителя (worker). Потребительская половина (`gates-admission.ts`, отказ очереди review) сделана `review-integrator-close` и описана в `.work/reports/MW-023-gates-e17.md`; отчёт `.work/reports/MW-023-gates.md` не переписывался.

## 1. Проверка зависимостей и шва

| Что проверено | Результат |
|---|---|
| Шов объявлен Lead'ом: `AttemptGatePort`, `AttemptGateRequest`, `ATTEMPT_GATE_REQUEST_FIELDS`, `GateRunResult` | `packages/contracts/src/verification.ts:196-263` — тип заморожен, `tsc --noEmit -p packages/contracts/tsconfig.json` → exit 0 |
| Реализация порта вне `packages/execution` | `packages/gate-runner/src/port.ts:202` — `createAttemptGatePort`, в доккомментарии прямо назван как «the port the execution layer injects as `WorkerDeps.gates`» |
| Граница пакета: `execution` не может импортировать `gate-runner` | `tests/boundaries.test.mjs` → **exit 0, 31 pass / 0 fail** после правки (бандл по-прежнему импортирует только `node:crypto`) |
| Потребитель на месте и не менялся | `packages/execution/src/gates-admission.ts` (`readGateResults`, `assertGatesSatisfied`), `review-queue.ts:1656-1669` вызывает проверку при постановке review; `tests/gates-admission.test.mjs` → **exit 0, 6 pass / 0 fail** |
| MW-022 (зависимость карточки) | `.work/reports/MW-022-worker.md` — `READY_FOR_REVIEW`; `tests/worker-*.test.mjs` зелёные (см. §4) |

## 2. Сделано

### 2.1 Изменения в `packages/execution/src/worker.ts`

1. **`WorkerDeps.gates?: AttemptGatePort`** — опциональный порт. Существующие стенды воркера не переписаны: без поля поведение прежнее (и это не «зелёный свет» — см. §5.4).
2. **`gateResultArtifactId(attemptId, gateId)`** + `GATE_RESULT_ARTIFACT_PREFIX` — идентификатор вердикта выводится из попытки и id гейта (как `contextSnapshotArtifactId`), поэтому повторная запись того же вердикта — тот же артефакт, а не вторая ревизия.
3. **`collectGateVerdicts(attempt, worktree, meta)`** — вызывает `gates.run({attemptId, taskId, workspaceId, cwd: worktree.path, headSha}, meta)`, пишет **каждый** вердикт артефактом `kind: 'gate-result'` (тело — сам `GateResult`, как его читает `readGateResults`) и судит набор тем же `assertGatesSatisfied`, который вызывает очередь review. Порядок: сначала запись всех вердиктов, потом приговор — доказательство отказа переживает отказ.
4. **`gateVerdictsFor(attempt, worktree, outcome, meta)`** — гейты спрашиваются только при `outcome === 'completed'`: прогон, который не завершился, нечего верифицировать, и вердикты о незавершённой работе не должны никого допускать.
5. **Встроено в обе точки выхода** — `runAttempt` и `resumeAttempt`: после ответа сессии и **до** возможного отчёта с `outcome: 'completed'`. Отказ порта или непройденный набор уходят в существующий `refuse()`-путь: попытка оседает `failed`, причина — `REVIEW_GATES_MISSING`; живой попытки не остаётся. Уже записанные вердикты передаются в отчёт провалившейся попытки (`details.artifactRefs` → `artifactRefs` отчёта).
6. **Head — пин попытки, а не свежее чтение.** В запрос уходит `worktree.headSha` (зарегистрированный head, а при его отсутствии — пиннутый base). Общий checkout не читается нигде: у слоя нет git-порта, и это то же правило §19, по которому пин ставится до создания попытки.
7. `requestReview` воркер не вызывает — постановка review остаётся за очередью (E-19); направление зависимости не изменилось.

### 2.2 Тесты (`tests/worker-flow.test.mjs`, 7 → 11)

Добавлен фейк `AttemptGatePort` (две «гейта» политики, `fail` по списку, отказ уровня прогона как **значение**, а не исключение — как у реального порта) и четыре теста:

- **зелёный набор** → попытка `completed`, порядок журнала `… start → gates → put:gate-result ×2 → put:worker-report → settle`, в отчёте ровно 4 ссылки (snapshot, два вердикта, report), в БД две строки `gate-result` с `task_id`/`correlation_id` попытки; в запрос уходят worktree попытки и пиннутый head;
- **`fail` обязательного гейта** → отказ `TASK_CONFLICT` + `details.refusal = 'REVIEW_GATES_MISSING'`, попытка `failed` с заполненным `settled_at`, живых попыток нет, **вердикты записаны** (2 строки) — доказательство отказа сохранено;
- **отказ прогона `GATE_HEAD_MOVED`** → тот же отказ + `details.gateRefusal = 'GATE_HEAD_MOVED'`, вердиктов нет (у отказанного прогона их и нет), попытка `failed`, живых нет;
- **незавершённый прогон и отсутствующий порт** → при `outcome: 'cancelled'` порт не спрашивается вовсе; без порта `gate-result` не пишется, и потребитель (`assertGatesSatisfied`) отказывает с `REVIEW_GATES_MISSING` — отсутствие порта читается как «проверка не проводилась», а не как успех.

## 3. Изменённые файлы

| Файл | Что изменено |
|---|---|
| `packages/execution/src/worker.ts` | импорты (`AttemptGatePort`, `assertGatesSatisfied`, `REVIEW_ADMISSION_REFUSAL`, `GateAdmission`), `GATE_RESULT_ARTIFACT_PREFIX` + `gateResultArtifactId`, поле `WorkerDeps.gates`, хелперы `gateRefusal`/`collectGateVerdicts`/`gateVerdictsFor`, встраивание в `runAttempt` и `resumeAttempt`; 907 → 1118 строк |
| `tests/worker-flow.test.mjs` | фейк `fakeGates` + `fakeVerdict`/`FAKE_GATES`, опциональный `gates` в `workerFixture`, 4 новых теста и диагностики; 7 → 11 тестов, 560 → 748 строк |
| `.work/reports/MW-023-gates-producer.md` | этот отчёт |
| `.tmp/execution-close/**` | скрэтч: выводы прогонов, `mutate.ps1` (вне поставки) |

Не трогались: `packages/contracts/**`, `packages/execution/src/{index.ts,service.ts}` (зона Lead), `packages/execution/src/{gates-admission,review-queue,integrator,integration-schema}.ts` (зона `review-integrator-close`), `packages/gate-runner/**`, `tests/lib/fixtures.mjs`, `tests/boundaries.test.mjs` (зона `build-gate`), `packages/controller/**`, отчёты `MW-023-*` других исполнителей.

Изоляция: `git status --short` до задачи (`before.txt`) и после (`after-e17.txt`) — новые записи только чужие (`M README.md`, `M scripts/smoke.mjs`, `M tests/events.test.mjs`, `?? tests/gates-port.test.mjs`); `git rev-parse HEAD` — `33e6919…` без изменений.

## 4. Команды и exit codes

| Команда | Exit | Наблюдение |
|---|---|---|
| `node_modules\.bin\tsc.cmd --noEmit -p packages/execution/tsconfig.json` | 0 | после правки; первая версия дала exit 2 (неиспользуемый `GateRunResult`, неиспользуемый параметр `options`) — исправлено до 0 |
| `node scripts/with-build-lock.mjs execution node ../../node_modules/tsdown/dist/run.mjs` (cwd `packages/execution`) | 0 | `✔ Build complete in 45571ms`, затем повторно `44183ms` после mutation-check |
| `node --test --test-isolation=none "tests/worker-flow.test.mjs"` | 0 | tests 11 / pass 11 / fail 0 (было 7) |
| `node --test --test-isolation=none "tests/worker-failure.test.mjs"` | 0 | tests 5 / pass 5 / fail 0 |
| `node --test --test-isolation=none "tests/worker-restart.test.mjs"` | 0 | tests 5 / pass 5 / fail 0 |
| `node --test --test-isolation=none "tests/worker-no-done.test.mjs"` | 0 | tests 3 / pass 3 / fail 0 |
| `node --test --test-isolation=none "tests/attempt-run.test.mjs"` | 0 | tests 5 / pass 5 / fail 0 |
| `node --test --test-isolation=none "tests/attempt-revisions.test.mjs"` | 0 | tests 4 / pass 4 / fail 0 |
| `node --test --test-isolation=none "tests/worktree-binding.test.mjs"` | 0 | tests 8 / pass 8 / fail 0 |
| `node --test --test-isolation=none "tests/worktree-adapter.test.mjs"` | 0 | tests 12 / pass 12 / fail 0 |
| `node --test --test-isolation=none "tests/worktree.test.mjs"` | 0 | tests 4 / pass 4 / fail 0 |
| `node --test --test-isolation=none "tests/claim-saga.test.mjs"` | 0 | tests 32 / pass 32 / fail 0 |
| `node --test --test-isolation=none "tests/gates-admission.test.mjs"` | 0 | tests 6 / pass 6 / fail 0 — потребительская половина не сломана |
| `node --test --test-isolation=none "tests/boundaries.test.mjs"` | 0 | tests 31 / pass 31 / fail 0 — граница «только `node:crypto`» держится |
| Сводный прогон 10 наборов после правки | 0 во всех | **89 pass / 0 fail**, ненулевых exit — 0 |
| `Select-String -Path packages/execution/src/worker.ts -Pattern "'done'"` | — | 0 совпадений (граница E-12 не сдвинулась) |

## 5. Evidence

### 5.1 Зелёный набор: вердикты записаны до отчёта

`tests/worker-flow.test.mjs` — «a completed run records every gate verdict before it may be reported», диагностика прогона:

```
ℹ gate-result rows -> ["gate-result-attempt-op-1-lint","gate-result-attempt-op-1-unit"]
ℹ request -> cwd C:\…\dsh-mywork-worker-flow-bfOXuy\worktrees\attempt-op-1, head aaaa…aaaa
ℹ attempt -> {"state":"completed","revision":2,"settled_at":1000}
```

То есть: порт спрошен один раз, `cwd` — worktree попытки (не общий checkout), `headSha` — пиннутый base `a…a` (40 символов), два артефакта `gate-result` лежат в БД как evidence попытки, попытка осела `completed`.

### 5.2 Красный обязательный гейт: отказ и сохранённое доказательство

Тот же файл — «a failing required gate settles the attempt as failed with REVIEW_GATES_MISSING»:

```
ℹ refusal -> TASK_CONFLICT: dsh-mywork: attempt "attempt-op-1" produced no passing gate set for head aaaa…aaaa (the gate set did not pass: … has no complete passing gate set …); it is settled as failed rather than reported as completed
ℹ verdict rows despite the failure -> 2; attempt -> {"state":"failed","settled_at":1000}
```

Живых попыток не осталось (`saga.liveAttempts('W-1')` пуст), оба вердикта — в БД.

### 5.3 Отказ прогона `GATE_HEAD_MOVED`

Тот же файл — «a gate run refused with GATE_HEAD_MOVED settles the attempt as failed»: `details.refusal = 'REVIEW_GATES_MISSING'`, `details.gateRefusal = 'GATE_HEAD_MOVED'`, строк `gate-result` — 0, попытка `failed` с `settled_at`, живых нет.

### 5.4 Отсутствие порта — не «всё хорошо»

Тот же файл — «a run that did not complete asks for no verdicts, and an absent port is not a pass»: без порта строк `gate-result` 0, и `execution.assertGatesSatisfied(attemptId, head, [])` отвечает отказом `REVIEW_GATES_MISSING`. Отсутствие производителя читается как «проверка не проводилась»: очередь review такую попытку не допустит.

### 5.5 Mutation-check (собранный артефакт)

Механика: `.tmp/execution-close/mutate.ps1` снимает бэкап бандла, делает ровно одну замену (отказ, если якорь встречается не один раз), прогон, восстановление байт-в-байт и пересборка.

| Инвариант | Поломка `packages/execution/lib/index.js` | Красный прогон | Восстановление |
|---|---|---|---|
| Красный гейт не даёт `completed` | `if (!admitted.ok) return fail(gateRefusal(` → `if (false) …` | **exit 1**, 1 тест, 0 pass / 1 fail; `worker-flow.test.mjs:680`: `actual: true`, `expected: false` — то есть попытка **была** отчитана `completed` при красном гейте, и тест это ловит ровно на утверждении `refused.ok === false` | байты идентичны бэкапу, пересборка exit 0 → `worker-flow.test.mjs` **exit 0, 11/11** |
| Отказ прогона гейтов не даёт `completed` | `if (run.value.refusal !== void 0) return fail(gateRefusal(` → `if (false) …` | **exit 1**; `worker-flow.test.mjs:703`: `actual: true`, `expected: false` | то же восстановление и пересборка → **exit 0, 11/11** |

Тестов, зелёных при поломке, нет.

## 6. Ограничения, отклонения и что осталось непроверенным

1. **Судьба набора — строгое чтение.** `GateRunResult` не несёт флагов `required` политики, поэтому воркер судит так же, как очередь review по умолчанию: **каждый записанный гейт обязателен**, любой не-`pass` блокирует `completed`. Для политики с информационными гейтами (`required: false`) это означает отказ там, где очередь, получив список `requiredGateIds`, допустила бы. Направление безопасное (в сторону отказа), но это отклонение от «непройденный **обязательный** гейт» из постановки; чтобы его снять, контракту нужен флаг required в результате или параметр у порта — правка чужой зоны (`packages/contracts/**`), здесь не делалась.
2. **Отмена не доходит до гейтов.** `AttemptGatePort.run(request, meta)` не принимает `signal` (тип заморожен Lead'ом), поэтому `AbortSignal` вызывающего на прогон гейтов не влияет: отмена во время гейтов не прерывает их. Названо, а не спрятано.
3. **Наблюдение на стыке с E-19/E-23 (не дефект этого шага).** Воркер пинует вердикты к head попытки, который он может назвать без чтения git: `WorktreeRef.headSha` (зарегистрированный head, иначе пиннутый base). Очередь review судит гейты против `evidence.reviewed.headSha`, который передаёт вызывающий. В текущем дереве **ничто в продакшене не записывает `attempt_worktree.head_sha`** (`settleAttemptWorktree` не вызывается нигде, кроме тестов), а `WorktreeRegistration` из `prepare` head не несёт, — значит, пока worktree попытки не сдвинулся с base, два head'а совпадают, а после коммитов в worktree совпадение обеспечивает вызывающий (композиция/E-23), а не воркер. Это место для проверки на шагах очереди review и интегратора; здесь оно только названо.
4. **`gateResultArtifactId`/`GATE_RESULT_ARTIFACT_PREFIX` экспортированы из модуля, но не добавлены в barrel `packages/execution/src/index.ts`** (зона Lead): потребителям они не нужны — очередь читает артефакты по `kind` из БД. Если ревьюер хочет публичный хелпер, это аддитивная строка экспорта за Lead'ом; запроса на неё нет.
5. **Повторное применение ограничения worker-поверхности при `resume` (E-39)** и прочие пункты `MW-023` (`E-13`…`E-18`, кроме потребителя и производителя) в этом отчёте не проверялись.
6. **`requestReview` воркером не вызывается** — постановка review остаётся за очередью; сквозной сценарий «гейты → очередь review» на реальном порте (`gate-runner`) не прогонялся: производитель проверен на фейке порта, потребитель — своим набором (`tests/gates-admission.test.mjs`), а склейка обоих на реальном `createAttemptGatePort` — задача шага `E-19`/композиции.
7. Прогоны сняты на незакоммиченном дереве (`33e6919` + рабочее дерево); дерево оставлено **собранным** (все 15 `lib/` на месте, `packages/execution/lib` пересобран последним). Числа воспроизводимы командами из §4.

## 7. Статус и следующий шаг

**READY_FOR_REVIEW.** Приёмку не объявляю. Задача `task-6` закрывается этим отчётом; следующая карточка в этой сессии не начиналась.
