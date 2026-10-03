# MW-021 — Реализовать изоляцию Git worktrees

- Предмет: карточка доски `1589a35a-91cd-41a9-930a-65293cce9f90` (MW-021), этап `03-execution`, обязательных пунктов §62 — 14
- Исполнитель: тиммейт `execution-close` команды этапа 4 над `H:\Repo\DSH-MyWork`, модель `deepseek-v4.1-flash`
- Репозиторий: `H:\Repo\DSH-MyWork`, base SHA `33e6919db031fb79b9c34c0ada67d4c600b0405d`, HEAD после работы **тот же** (коммитов нет, git-индекс не трогался; push/merge/publish не выполнялись)
- Окружение: Node `v24.19.0`, git `2.55.0.windows.3`, pnpm `12.4.2`
- Статус: **READY_FOR_REVIEW**

Роль этой сессии: ночная кампания этапа 4 оставила группы A и B в рабочем дереве. Здесь работа не переписывалась: реализация сверена с приёмкой карточки и шагами E-01…E-06, закрыты пробелы доказательств, найден и локализован один дефект (см. §2.3), проведён mutation-check. Файл решения `E-01` (`evidence/execution-21-worktree-form.md`) не переписывался — решение уже принято.

## 1. Проверка зависимостей

| Зависимость | Что проверено | Результат |
|---|---|---|
| MW-008 (Artifact Store + Audit) | `.work/reports/MW-008-evidence-audit.md` — статус **DONE**, независимое ревью `PASS WITH FINDINGS`, верификация исправлений `FIXES VERIFIED`; исходники `packages/evidence/src` в дереве | предусловие пройдено |
| MW-012 (claim saga, attempts, leases, fences) | `.work/reports/MW-012-attempt-saga.md` — статус **DONE**, ревью `PASS WITH FINDINGS`, все 10 находок закрыты; регрессия `tests/claim-saga.test.mjs` → **exit 0, 32 pass / 0 fail** (это и гейт E-04 «pass >= 32, fail 0») | предусловие пройдено |
| E-01 (форма порта) | `.work/plan-v0.3/evidence/execution-21-worktree-form.md`: порт `WorktreePort` в `packages/contracts/src/worktree.ts`, адаптер — отдельный пакет, `shared checkout` не трогается, пустой репозиторий — явный `EMPTY_REPOSITORY`; три пробы E-01 в файле | решение на месте, не переписывалось |

## 2. Сделано

### 2.1 Что уже было в дереве (не переписывалось)

- `packages/worktree-adapter/` — `src/git.ts` (383 строки, единственное место в дереве, где запускается `git`: `execFile` с `shell:false`, `windowsHide:true`, очищенное окружение от `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE`), `src/adapter.ts` (445 строк: `prepare`/`resolve`/`cleanup`/`list`), `src/errors.ts`, `src/index.ts`, манифесты.
- `packages/execution/src/worktree-schema.ts` (79 строк, миграция `attempt_worktree`), `worktree-store.ts` (217 строк: `insertAttemptWorktree`/`readAttemptWorktree`/`settleAttemptWorktree`/`listAttemptWorktrees`).
- `packages/contracts/src/worktree.ts` (`WorktreePort`, закрытый словарь из 6 отказов) и `git.ts` (`GitPort`) — зона Lead; `packages/execution/src/service.ts` (pin base/head SHA, две синхронные транзакции вокруг асинхронного `prepare`).
- `tests/worktree.test.mjs` (4 теста), `tests/worktree-adapter.test.mjs` (было 8), `tests/worktree-binding.test.mjs` (было 7).

### 2.2 Что добавлено этой сессией

- `tests/worktree-adapter.test.mjs` — 4 новых теста (стало 12), закрывают приёмку карточки на реальном git:
  - «two attempts get their own checkouts, and the shared one is never written» — E-05 (а)(б)(г): два параллельных `prepare` дают разные пути и ветки; файл, записанный в A, не виден ни в B, ни в общем checkout; `git status --porcelain` общего checkout пуст, `HEAD` не сдвинулся, ветка `main` та же. Policy root намеренно **вне** общего checkout — иначе его собственный каталог делал бы общий checkout грязным и размывал проверяемое свойство.
  - «cleanup removes a clean worktree once, and a repeated cleanup is not an error» — E-06 (а)(д).
  - «cleanup keeps an orphan directory and refuses a foreign worktree» — E-06 (в)(г): осиротевший каталог под root → `kept-orphan` и файл на месте; регистрация с путём вне root и регистрация с чужим префиксом ветки → `WORKTREE_FOREIGN`, каталоги целы.
  - «list answers only with the worktrees this policy created» — E-06 (е): чужой префикс ветки, путь вне root и другой workspace в ответ не попадают.
- `tests/worktree-binding.test.mjs` — 1 новый тест (стало 8): «two isolated claims never share a checkout, and the shared one stays clean». Это единственный тест в наборе, который гоняет **реальный** адаптер и **реальный** репозиторий под сагой: два параллельных `claim` двух задач → две строки `attempt_worktree` с разными путями и ветками, обе от пиннутого base, работа одной попытки не видна второй и общему checkout, общий checkout чист, его `HEAD` не сдвинулся.

### 2.3 Дефект, найденный и закрытый по ходу

`tests/worktree-binding.test.mjs` в дереве был **красным** (exit 1, pass 6 / fail 1) на тесте «a port that refuses an empty repository abandons the claim without an attempt»: `claimed.error.details.refusal` был `undefined`, ожидался `EMPTY_REPOSITORY`.

- Причина: сага (`service.ts:571` до правки) читала отказ git-порта через `refusalOfFailure`, который понимает **только** `details.refusal`, а `GitPort.resolveHead` при `rev-parse --verify HEAD` != 0 отдаёт собственный документированный ответ `details.reason === 'no-head'` (`git.ts:240-244`). Токен `refusal` от `GitPort` не приходит никогда ⇒ ветка `EMPTY_REPOSITORY` в саге была недостижима. В продакшене пустой репозиторий уходил в ветку `'recovering'` и возвращал сырой `TASK_CONFLICT`; попытка не создавалась (скрытого первого коммита нет), но intent оставался в `claimed`.
- Дефект найден этой сессией и передан Lead; **правка сделана Lead'ом в его зоне** (`service.ts`, хелпер `isolationRefusalOfFailure`), `WorktreeRefusal` в `GitPort` при этом не протёк. Прецедент чтения `no-head` уже был в `adapter.ts:266`.
- Доказательство, что правка закрывает именно это: mutation-check №1 в §5.4.

## 3. Изменённые файлы этой сессией

| Файл | Что изменено |
|---|---|
| `tests/worktree-adapter.test.mjs` | шапка-доккомментарий (+9 строк), импорт `mkdirSync`, 4 новых теста в конце файла; 8 → 12 тестов, 477 строк |
| `tests/worktree-binding.test.mjs` | шапка (+6 строк), импорты `spawnSync`/`existsSync`/`writeFileSync` и пакета `worktree-adapter`, хелперы `gitIn`/`realRepository`, 1 новый тест; 7 → 8 тестов, 554 строки |
| `.work/reports/MW-021-worktree.md` | этот отчёт |
| `.tmp/execution-close/**` | скрэтч: сохранённые выводы прогонов, `mutate.ps1` для mutation-check (вне поставки) |

Правок в `packages/**` эта сессия не делала: реализация групп A и B принята как есть, единственная правка исходников по этому дефекту — в `packages/execution/src/service.ts` и сделана Lead'ом. `packages/contracts/**`, `packages/execution/src/index.ts`, `tests/lib/fixtures.mjs`, `tests/boundaries.test.mjs`, `packages/controller/**` не трогались.

Изоляция чужой работы: `git status --short` до работы (`.tmp/execution-close/before.txt`) и после (`.tmp/execution-close/after.txt`) — `Compare-Object` даёт только две строки `M`, обе не мои (`scripts/smoke.mjs`, `tests/events.test.mjs`, правки параллельной сессии); `git rev-parse HEAD` до и после — `33e6919…` без изменений. Все мои файлы в статусе `??` (новые), поэтому в diff не появляются.

## 4. Команды и exit codes

Канонический узкий прогон: `node --test --test-isolation=none "<файл>"`; сборка — под локом `node scripts/with-build-lock.mjs <pkg> node ../../node_modules/tsdown/dist/run.mjs` (иначе чужие `clean:true`-окна удаляют `lib/`).

| Команда | Exit | Наблюдение |
|---|---|---|
| `node --test --test-isolation=none "tests/worktree.test.mjs"` | 0 | tests 4 / pass 4 / fail 0 |
| `node --test --test-isolation=none "tests/worktree-adapter.test.mjs"` | 0 | tests 12 / pass 12 / fail 0 |
| `node --test --test-isolation=none "tests/worktree-binding.test.mjs"` | 0 | tests 8 / pass 8 / fail 0 (до правки Lead'а тот же файл: **exit 1**, 6/7) |
| `node --test --test-isolation=none "tests/security.test.mjs"` | 0 | tests 38 / pass 38 / fail 0 — чужая зона, прогнана как evidence для E-05 (в) |
| `node --test --test-isolation=none "tests/claim-saga.test.mjs"` | 0 | tests 32 / pass 32 / fail 0 — гейт E-04 «pass >= 32, fail 0» |
| `node --test --test-isolation=none "tests/attempt.test.mjs"` | 0 | tests 12 / pass 12 / fail 0 — регрессия E-10 |
| `node_modules\.bin\tsc.cmd --noEmit -p packages/contracts/tsconfig.json` | 0 | гейт E-02 |
| `node_modules\.bin\tsc.cmd --noEmit -p packages/worktree-adapter/tsconfig.json` | 0 | гейт E-03 |
| `node_modules\.bin\tsc.cmd --noEmit -p packages/execution/tsconfig.json` | 0 | правка Lead'а в `service.ts` типчек проходит |
| `node scripts/with-build-lock.mjs worktree-adapter node ../../node_modules/tsdown/dist/run.mjs` (cwd `packages/worktree-adapter`) | 0 | `✔ Build complete in 24559ms` |
| `node scripts/with-build-lock.mjs execution node ../../node_modules/tsdown/dist/run.mjs` (cwd `packages/execution`) | 0 | `✔ Build complete in 48168ms` |
| Итоговый сводный прогон 12 наборов (9 моих + 3 регрессии) | 0 во всех | **135 pass / 0 fail**, ненулевых exit — 0 |
| `git rev-parse HEAD` | 0 | `33e6919db031fb79b9c34c0ada67d4c600b0405d` — не сдвинулся |

Полный набор (`tests/**/*.test.mjs`) не дублировался — это зона `build-gate`; его прогон на этом дереве: tests 1000 / pass 991 / fail 9 / exit 1 (9 красных — 8 в зоне `review-integrator-close` и 1 в моём `worker-flow.test.mjs`, см. отчёт MW-022 §2.2).

## 5. Evidence по приёмке

### 5.1 «Параллельные attempts не пишут в общий checkout»

- `tests/worktree-adapter.test.mjs` — «two attempts get their own checkouts, and the shared one is never written» (реальный git): разные пути/ветки, файл A не виден в B и в общем checkout, `git status --porcelain` общего checkout = пустая строка, `HEAD` не сдвинулся, `main` на месте, в `git worktree list` три записи (общий + два).
- `tests/worktree-binding.test.mjs` — «two isolated claims never share a checkout, and the shared one stays clean»: то же через сагу с реальным адаптером; `new Set(paths).size === 2`, `new Set(branches).size === 2`, обе строки `base_sha` = HEAD репозитория, общий checkout чист, `HEAD` не сдвинулся.
- `tests/worktree-binding.test.mjs` — «the base commit is read before the checkout is created» (порядок `resolveHead` → `prepare`, фейки).

### 5.2 «Нельзя выйти из разрешённого worktree»

- Платформенный ограничитель — `packages/core/src/security.ts:203-207` (причина `worktree-escape`), доказан в `tests/security.test.mjs` (38/38, exit 0; строки 96-109: границы с `worktreeRoot` и отказ `worktree-escape`). Файл — зона `build-gate`, правок в нём не делалось, только прогон.
- Со стороны порта: `tests/worktree-adapter.test.mjs` — «resolve refuses a worktree registered outside the policy root» (`WORKTREE_OUTSIDE_WORKSPACE`) и «resolve refuses an absolute escape and a path that climbs out with ..» (три формы побега, каждая с положительным контролем внутри root).

### 5.3 «Cleanup не удаляет чужую/грязную работу» и «пустой репозиторий — явный precondition»

- Чистый удаляется один раз, повторный `cleanup` идемпотентен, запись уходит из `git worktree list`: «cleanup removes a clean worktree once…» (`removed`, каталога нет, записей в списке 1).
- Грязный: «cleanup refuses a dirty worktree and leaves the directory in place» — `WORKTREE_DIRTY`, каталог и файл на месте, запись в `git worktree list` остаётся.
- Осиротевший и чужой: «cleanup keeps an orphan directory and refuses a foreign worktree» — `kept-orphan` / два `WORKTREE_FOREIGN`, все файлы целы.
- Только свои: «list answers only with the worktrees this policy created».
- Пустой репозиторий: `tests/worktree-adapter.test.mjs` — «an empty repository is refused instead of being committed to»: `EMPTY_REPOSITORY` (код `TASK_CONFLICT`), `git rev-parse --verify HEAD` по-прежнему падает, `git branch --list` пуст, каталога policy root нет — скрытого первого коммита не появилось. Со стороны саги: `tests/worktree-binding.test.mjs` — «a port that refuses an empty repository abandons the claim without an attempt»: `details.refusal === 'EMPTY_REPOSITORY'`, `details.reason === 'worktree-precondition'`, 0 строк `attempt`, 0 строк `attempt_worktree`, `prepare` не вызывался, intent `abandoned`, шаг `attempt` — `failed`.

### 5.4 Mutation-check (3 штуки, все на собранных артефактах)

Механика: `.tmp/execution-close/mutate.ps1` копирует бандл в бэкап, делает ровно одну текстовую замену (скрипт отказывается работать, если якорь встречается не один раз), прогон, затем восстановление байт-в-байт и пересборка канонической командой.

| Инвариант | Поломка | Красный прогон | Восстановление |
|---|---|---|---|
| Пустой репозиторий → `EMPTY_REPOSITORY` из саги (правка Lead'а) | в `packages/execution/lib/index.js` снята трансляция `no-head` → `EMPTY_REPOSITORY` | **exit 1**, 1 тест, 0 pass / 1 fail; падение ровно на `worktree-binding.test.mjs:356`: `actual: undefined`, `expected: 'EMPTY_REPOSITORY'` — то есть на утверждении про `details.refusal` | байты идентичны бэкапу, пересборка `packages/execution` exit 0 → `tests/worktree-binding.test.mjs` **exit 0, 8/8** |
| Поздний результат → `STALE_FENCE` (сторож воркера) | в `lib/index.js` отключён `if (expectedFence !== taskFence)` | **exit 1**; падение на `worker-restart.test.mjs:526`: `actual: 'TASK_CONFLICT'`, `expected: 'STALE_FENCE'` — с отключённым сторожем сага отвечает другим отказом, значит сторож воркера несущий, а не дублирующий | восстановлено; `tests/worker-restart.test.mjs` **exit 0, 5/5** |
| `cleanup` не удаляет грязное | в `packages/worktree-adapter/lib/index.js` отключён `if (!clean.value)` | **exit 1**; падение на `worktree-adapter.test.mjs:246`: `actual: undefined`, `expected: 'WORKTREE_DIRTY'` | байты идентичны, пересборка `worktree-adapter` exit 0 → `tests/worktree-adapter.test.mjs` **exit 0, 12/12** |

Тестов, зелёных при поломке, не обнаружено: все три краснеют именно на том утверждении, которое заявлено.

## 6. Ограничения и что осталось непроверенным

1. **Композиция в controller не проверялась.** Реестр адаптера, поднятый из `attempt_worktree`, и расписание retention (`retentionMs`, значение по умолчанию `7 суток` до `D17`) — это `packages/controller/**` (зона `controller-close`) и шаг `F(composition root)`. Здесь адаптер проверен напрямую и под сагой, но не через композиционный корень.
2. **Файлов `tests/worktree-isolation.test.mjs` и `tests/worktree-cleanup.test.mjs` из списка шагов E-05/E-06 в дереве нет.** Их критерии закрыты внутри `tests/worktree-adapter.test.mjs` и `tests/worktree-binding.test.mjs` (перечислено в §2.2 и §5); это отклонение от буквы шага, а не пропуск критерия. Отдельные файлы не создавались, чтобы не плодить дубли и не выходить за согласованную зону записи.
3. **Пустой репозиторий на реальном адаптере через сагу end-to-end не прогонялся**: на уровне адаптера он покрыт реальным git-тестом, на уровне саги — фейком, чей ответ (`TASK_CONFLICT` + `details.reason === 'no-head'`) дословно совпадает с ответом `git.ts:240-244`. Проверка «реальный пустой репозиторий → `prepare` сагой» осталась непроверенной.
4. **Сканер границ** (`tests/boundaries.test.mjs`, включая запрет импортов кроме `node:crypto` в бандле `execution`) — зона `build-gate`; отдельно мной не прогонялся, риск назван в файле решения E-01 §3 (новый пакет обязан попасть в список сканируемых).
5. **`pnpm-lock.yaml` и сборочные манифесты** `packages/worktree-adapter/{package.json,tsdown.config.ts}` — зона `build-gate` (по прямому указанию Lead); пакет собирается канонической командой и тесты грузят `lib/` напрямую, но запись пакета в lock-файл этой сессией не проверялась.
6. **Уборка за тестами**: все репозитории создаются в `%TEMP%` и удаляются в `after` с проверкой префикса; живые workspace, доска и профиль DSH не трогались.
7. Прогоны сняты на незакоммиченном дереве (`33e6919` + рабочее дерево). После коммита числа следует перепроверить — они воспроизводимы командами из §4.

## 7. Статус и следующий шаг

**READY_FOR_REVIEW.** Приёмку не объявляю: отчёт, исходники, тесты и mutation-check переданы независимому ревьюеру. Следующая карточка в этой сессии не начиналась; по решению Lead после закрытия MW-021/MW-022 берётся `task-6` (производитель `gate-result` в `worker.ts`, E-17/MW-023).
