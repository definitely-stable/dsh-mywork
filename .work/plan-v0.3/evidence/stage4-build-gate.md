# Stage 4 build-gate: install, recursive build, full suite (task-1)

**Статус: `READY_FOR_REVIEW`** (своя часть — установка, сборка, smoke, полный прогон — выполнена; 9 красных тестов находятся в чужих зонах и перечислены отдельным разделом §6).
**Коммитов не делал, git-индекс не трогал** (`git rev-parse HEAD` = `33e6919db031fb79b9c34c0ada67d4c600b0405d` до и после).
**Живой профиль не тронут:** `Test-Path 'C:\Users\Dmitry\.dsh\dsh-mywork'` → `False` в 10:59, 11:07 и 11:19.

---

## 1. Что было на старте

| Факт | Значение |
|---|---|
| HEAD | `33e6919` (этап 3) |
| Изменённых/новых записей в `git status --porcelain` | 62 (10:59) → 65 (11:19) |
| Пакетов в `packages/*` | 15 (16 workspace-проектов с корнем) |
| Файлов `*.test.mjs` | 95 (из них 31 — новые, untracked, этапа 4) |
| Исходников в `packages/*/src` | 153 |
| `packages/execution/lib` на 27.09 23:10 | отсутствовал (чужое `clean:true`-окно, MW-023 §4 N-1…N-4) |
| Свободно RAM / всего | 10.7 GB / 31.9 GB |

Записи для `gate-runner`/`worktree-adapter` в `tests/lib/fixtures.mjs` (12 → 14 записей) и блоки `INFRA_PACKAGES` в `tests/boundaries.test.mjs` **уже были в дереве до моего старта** (оба файла — `M` в `git status`). Я их не переписывал, а сверил с фактическими импортами исходников (§7) и оставил как есть: они совпадают.

---

## 2. Мои правки (3 файла)

| Файл | Что | Почему |
|---|---|---|
| `pnpm-workspace.yaml` | добавлено `nodeOptions: --max-old-space-size=8192` + комментарий-обоснование | блокер 3: `packages/execution` (скрипт `build` = bare `tsdown`) падал на дефолтном heap с exit **134** (MW-023 §4 N-2). `packages/execution/package.json` вне моей зоны записи, поэтому флаг поднят на уровне workspace: pnpm экспортирует `nodeOptions` как `NODE_OPTIONS` каждому lifecycle-скрипту. По решению Lead'а (сообщение 11:0x) дублировать флаг по пакетам не нужно, `beads-adapter` не трогал |
| `pnpm-lock.yaml` | +15 строк: `importers` для `packages/gate-runner` и `packages/worktree-adapter` | блокер 4: `--frozen-lockfile` падал с `ERR_PNPM_PACKAGE_MANAGER_NO_IMPORTER`. Получено штатным `corepack pnpm install --offline` (exit 0), не ручной правкой |
| `scripts/smoke.mjs` | шаг «diagnostics config…»: ожидание 2 строк → 3, добавлен пиннинг строки reconcile | настоящая находка: этап 4 добавил в `packages/controller/src/app.ts` (порт `reconcile`, строки 674–686, весь блок — `+` в `git diff`) диагностическую строку `dsh-mywork: reconciled <path>: N staged operation(s), N open claim(s), N stale lease(s)`, которая печатается при монтировании. Smoke падал на устаревшем ожидании (`actual 3, expected 2`, exit 1); теперь пиннятся все три строки в порядке mount → reconcile → stop |

Проверено, но **не менялось**: `tests/lib/fixtures.mjs`, `tests/boundaries.test.mjs`, `package.json`, `tsconfig.base.json`, `scripts/with-build-lock.mjs`, `packages/gate-runner/{package.json,tsdown.config.ts}`, `packages/worktree-adapter/{package.json,tsdown.config.ts}`.

---

## 3. Команды и exit-коды

| # | Команда | Наблюдение | Exit |
|---|---|---|---|
| I-1 | `corepack pnpm install --frozen-lockfile --offline` (до правок, 10:59) | `ERR_PNPM_PACKAGE_MANAGER_NO_IMPORTER`: нет `importers["packages/gate-runner"]` — блокер 4 подтверждён | **1** |
| I-2 | `corepack pnpm install --offline` (11:00) | `Scope: all 16 workspace projects`; `Already up to date`; `pnpm-lock.yaml` +15 строк | **0** |
| I-3 | `corepack pnpm install --frozen-lockfile --offline` (11:01 и повторно 11:19) | `Lockfile is up to date, resolution step is skipped` | **0** |
| B-1 | `corepack pnpm -r run build` (11:02:34 → 11:06:32, 237.6 c) | `Scope: 15 of 16 workspace projects`; 15 × `build: Done`, 15 × `Build complete in`, **0** вхождений `heap out of memory` / `Ineffective mark-compacts`; `packages/execution` собрался за 61061 ms | **0** |
| B-2 | `corepack pnpm -r exec node -p "process.env.NODE_OPTIONS"` | 15/15 строк `--max-old-space-size=8192` — флаг реально доходит до скриптов каждого пакета | **0** |
| B-3 | `corepack pnpm --filter @dsh-mywork/execution exec node -p "require('v8').getHeapStatistics().heap_size_limit/1048576"` | `ceiling_mb=8384` | **0** |
| B-4 | контроль к B-3: `node -p "…heap_size_limit…"` без pnpm | `ceiling_mb=4288` — потолок по умолчанию, тот, на котором был OOM (MW-023 N-2: лимит ~4085 MB) | **0** |
| S-1 | `node scripts/smoke.mjs` (11:07, до правки) | `AssertionError … expected exactly two diagnostic lines, received [mounted, reconciled, stopped]`; `smoke: 1 step(s) failed` | **1** |
| S-2 | `node scripts/smoke.mjs` (после правки) | `smoke: all steps passed`, 14 шагов `ok` | **0** |
| T-1 | `node --test --test-isolation=none "tests/**/*.test.mjs"` (11:08:27 → 11:17:22, 534.5 c) | `tests 1000 / pass 991 / fail 9 / cancelled 0 / skipped 0 / todo 0`; красные — только в чужих зонах, см. §6 | **1** |
| G-1 | `Test-Path 'C:\Users\Dmitry\.dsh\dsh-mywork'` | `False` (10:59, 11:07, 11:19) | — |
| G-2 | `Test-Path` всех 15 собранных точек входа | `missing=0` — дерево оставлено СОБРАННЫМ | — |

Сырые логи и манифесты: `.tmp/build-gate/{build.log,build-result.txt,smoke.log,full-test.log,full-test-result.txt,tree-state-*.txt}`.

---

## 4. Полный прогон: состояние дерева и кто писал во время

| Величина | Значение |
|---|---|
| Отпечаток дерева до прогона (310 файлов: 153 `packages/*/src`, 101 `tests`, 7 `scripts`, 49 конфигов) | `5E61CEFB7F508BB43845D0424F06264A` @ 11:08:27 |
| Отпечаток после прогона | `65E40E2C79597288F40E8CEFDE730699` @ 11:17:22 |
| Различие | **3 файла** (ниже) |
| `git rev-parse HEAD` / `git status --porcelain` | `33e6919` / 65 |

**Изменения во время прогона (11:08:27 → 11:17:22), все — в чужих зонах:**

| Файл | mtime | Кто (зона) |
|---|---|---|
| `packages/execution/src/review-queue.ts` | 11:08:30 | review-integrator-close |
| `tests/review-reject.test.mjs` | 11:10:02 | review-integrator-close |
| `tests/integrator-finalize.test.mjs` | 11:13:16 | review-integrator-close |

Плюс `packages/execution/lib/index.js` **пересобран в 11:16:30** внутри моего окна, хотя исполнители были предупреждены (по сообщению review-integrator-close — это их сборка под `scripts/with-build-lock.mjs`, см. §9.2); остальные 14 `lib/` сохранили mtime 11:02–11:04.

Почему это не рассыпает числа прогона, и где оговорка:
- Сюита шла одним процессом (`--test-isolation=none`), а `tests/lib/fixtures.mjs` импортирует собранные бандлы **один раз**; ESM-кэш держит уже прочитанные байты, поэтому подмена `packages/execution/lib/index.js` в 11:16:30 не перезагрузила модуль для уже стартовавшего процесса.
- **Оговорка:** тесты, которые импортируют бандл заново в дочернем процессе (`tests/lib/worker-crash-child.mjs` и подобные), после 11:16:30 видели уже новую сборку `execution`. Для 9 красных это ничего не меняет: проверено, что текущий `packages/execution/lib/index.js` по-прежнему несёт ту же ветку отказа (`does not fit 64 characters…`, строка 7529 бандла), что и сборка 11:06.
- Ни один файл `packages/*/src` **не менялся во время сборки** (проверено по mtime всех 153 файлов: ни одного попадания в окно 11:02:34–11:06:32), поэтому сборка 11:02–11:06 когерентна источникам на 11:02:34 — включая правку Lead'а `packages/execution/src/service.ts` (mtime 11:01:59, т.е. до старта сборки; `EMPTY_REPOSITORY` присутствует в `src` 2 раза и в собранном `lib/index.js` 4 раза).

Итог: числа `1000/991/9` описывают сборку 11:02–11:06; три файла, тронутых в середине прогона, на результаты не влияли, но сама сюита уже не является прогоном по одному замороженному состоянию — это надо учитывать при сличении с финальным гейтом Lead'а.

---

## 5. Контроли невakуумности

| # | Проверка | Наблюдение |
|---|---|---|
| C-1 | потолок heap через pnpm vs напрямую (B-3/B-4) | `8384 MB` против `4288 MB` — флаг из `pnpm-workspace.yaml` действительно поднимает потолок, а не «совпал с удачей» |
| C-2 | OOM-маркеры в логе сборки | 0 вхождений `heap out of memory` / `Ineffective mark-compacts` на 15 сборках (раньше `execution` давал **134**) |
| C-3 | правка Lead'а в сборке | `EMPTY_REPOSITORY`: 2 совпадения в `packages/execution/src/*.ts`, 4 в `packages/execution/lib/index.js` (mtime сборки 11:06) |
| C-4 | новые пакеты в `fixtures.mjs` | импортируются как `packages/gate-runner/lib/index.js` и `packages/worktree-adapter/lib/index.js`; в прогоне сюиты, грузящие `fixtures.mjs`, дошли до смысла, а не до `missing build output` |
| C-5 | новые пакеты в `INFRA_PACKAGES` | сверено с фактическими спецификаторами: gate-runner (4 файла) — `@dsh-mywork/contracts`, `node:child_process|crypto|path|util`, `./…`; worktree-adapter (4 файла) — `@dsh-mywork/contracts`, `@dsh-mywork/core`, `node:child_process|crypto|fs|path|util`, `./…`. Оба блока `min: 4` выполнимы, `expected: ['@dsh-mywork/contracts']` не вакуумен. В прогоне: `✔ every infrastructure package has sources, so no new block is vacuous` и `✔ the infrastructure packages depend on no product, no extra platform package, and no stray specifier` |
| C-6 | живой дом | `Test-Path 'C:\Users\Dmitry\.dsh\dsh-mywork'` → `False` трижды; smoke/тесты пишут в `.tmp/smoke-home` и `%TEMP%`, а не в профиль |

---

## 6. Красные сюиты полного прогона (9) — все в чужих зонах

| # | Тест (файл:строка) | Сообщение | Зона |
|---|---|---|---|
| 1 | `tests/events.test.mjs:172` «the error vocabulary is exactly the one the architecture lists» | `deepStrictEqual`: в фактическом словаре лишний `STALE_APPROVAL` | Lead (словарь ошибок в `packages/contracts`) + review-integrator-close (код добавлен их работой) |
| 2 | `tests/integrator-finalize.test.mjs:487` «finalize refuses while an attempt is live or a review is open, and leaves neither behind» | `ADAPTER_UNAVAILABLE: the graph was unreachable when the task was completed` (`false !== true`) | review-integrator-close (тест правился ими в 11:13:16, уже после его выполнения в прогоне) |
| 3 | `tests/review-reject.test.mjs:400` «the review loop is bounded and the excess needs a human» | `actual 'awaiting-review'` ≠ `expected 'needs-attention'` | review-integrator-close (тест правился в 11:10:02) |
| 4–8 | `tests/review-staleness.test.mjs:230, 261, 293, 324, 358` (5 тестов) | `dsh-mywork: the artifact id of review "R-…" does not fit 64 characters, so its approval cannot be stored` (`false !== true`) | review-integrator-close: отказ живёт в `packages/execution/src/review-queue.ts:151` (`ARTIFACT_ID_MAX_LENGTH = 64`) и `:1565`, т.е. в текущем дереве он на месте — красное не «устарело само» |
| 9 | `tests/worker-flow.test.mjs:457` «a second runAttempt on the same attempt does not start a second session» | `the attempt must settle exactly once: 2 !== 1` | execution-close (`packages/execution/src/worker.ts`) |

Это **находка с доказательством, а не мой BLOCKED**: сборка, установка, smoke и сам прогон завершены; красное принадлежит зонам соседей и не мешает приёмке моей части. Финальный гейт Lead'а должен увидеть их зелёными.

---

## 7. Что не проверялось (и почему)

| Не сделано | Причина |
|---|---|
| `node scripts/verify-profile.mjs` | прямая инструкция Lead'а: гейт P делает Lead на замороженном коммите |
| `corepack pnpm -r run typecheck` по всему дереву | не входит в приёмку task-1; Lead сообщил, что типизация `packages/execution` у него `exit 0`. Полный typecheck по всем 15 пакетам я не гонял — **не проверено** |
| `packages/execution/package.json`: `node --max-old-space-size=8192 …` по паттерну `beads-adapter` | решение Lead'а: единый механизм — `nodeOptions` в `pnpm-workspace.yaml`, по пакетам не дублировать |
| Повторный полный прогон после правок соседей (11:08–11:16) | инструкция: полный набор запускается здесь **один раз**; красные сюиты перепроверяют их владельцы |
| Коммит / `git add` / `git stash` | git принадлежит Lead'у |

Оговорка о методе: первый (отброшенный) манифест состояния брал путь как `packages\*\src` и в этом pwsh не матчил ничего (150 файлов, `src = 0`); итоговые отпечатки в §4 сняты по явным каталогам и покрывают 310 файлов — файл `tree-state-before.txt` в `.tmp/build-gate/` неполный, `tree-state-presuite.txt` / `tree-state-postsuite.txt` — корректные.

---

## 8. Что осталось в дереве

- `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `scripts/smoke.mjs` — изменены мной (в рамках моей зоны), не закоммичены.
- Все 15 `lib/` на месте (проверено `Test-Path` по всем точкам входа из `fixtures.mjs` + `packages/web/lib/client.js`) — дерево оставлено собранным, как просил Lead.
- HEAD и индекс не тронуты; `.tmp/` — только мой скрэтч (`.tmp/build-gate/`).

---

## 9. Дописано после прогона (11:21; мои прогоны не повторялись)

### 9.1 Исправление: счётчики controller-тестов, названные мной в сообщении, были посчитаны на глаз и неверны

В сообщении controller-close я назвал «heartbeat 4, lifecycle 5, modes 4, reconcile-order 4» — это артефакт подсчёта по усечённому выводу job'а (33415 байт были опущены), а не измерение. Измерение по `.tmp/build-gate/full-test.log` (сопоставление объявленных заголовков `test('…')` из четырёх файлов со строками журнала; в прогоне эти файлы не менялись — mtime и манифест `tree-state-postsuite.txt`):

| Файл | Объявлено тестов | Найдено в журнале ✔ | ✖ |
|---|---|---|---|
| `tests/controller-heartbeat.test.mjs` | 5 | 5 | 0 |
| `tests/controller-lifecycle.test.mjs` | 6 | 6 | 0 |
| `tests/controller-modes.test.mjs` | 7 | 7 | 0 |
| `tests/controller-reconcile-order.test.mjs` | 4 | 4 | 0 |
| **итого** | **22** | **22** | **0** |

Строк `^not ok` / `^cancelled` в журнале — **0**. Числа совпадают с независимым агрегатом controller-close (`tests 22 / pass 22 / fail 0`), то есть в агрегированном прогоне ни один controller-тест не потерялся и расхождения нет.

### 9.2 Статус красных после 11:17:22 — по сообщениям владельцев зон, мной НЕ перепроверялось

- review-integrator-close сообщил (11:21), что закрыл п.2 (`integrator-finalize.test.mjs:487` → `5/5, fail 0`), п.3 (`review-reject.test.mjs:400` → `7/7, fail 0`) и п.4–8 (`review-staleness.test.mjs` ×5 → `5/5, fail 0`). Причина пяти: id артефакта одобрения был `review-approval:<reviewId>:<headSha>:<diffHash>` = 160 символов при пределе evidence-схемы 64 (`packages/evidence/src/metadata.ts:37-40`), id укорочен до 63 символов. Батч из 17 файлов (гейты/review/интегратор) — 91 тест, 91 pass, exit 0. Мой вывод «пять review-staleness сами не позеленеют» относился к сборке 11:06 и их причиной подтверждён: тесты грузят `lib`, а не `src`.
- Пересборку `packages/execution/lib` в 11:16:30 сделал review-integrator-close (под `scripts/with-build-lock.mjs`) — уточнение к §4, где сказано «чужим процессом».
- На момент дописывания красными по моему прогону остаются п.1 `tests/events.test.mjs:172` (ждёт решения Lead'а: пиннинг словаря `MYWORK_ERROR_CODES` не знает про аддитивно добавленный `STALE_APPROVAL`) и п.9 `tests/worker-flow.test.mjs:457` (зона execution-close).
- Итоговый список должен быть измерен заново финальным гейтом Lead'а: мой прогон 11:08–11:17 описывает сборку 11:02–11:06, а дерево после него менялось (§4 и §9.2).
- Во время дописывания controller-close проводил mutation-check с временной порчей `packages/controller/lib/index.js` (восстанавливает из `.tmp/controller-close/lib-index.pristine.js`); я в это время никаких сюит не запускал.

### 9.3 Проверка восстановления controller и измеренная усталость бандлов (11:2x–11:3x, только чтение)

- `packages/controller/lib/index.js` после «restored + rebuilt» от controller-close: sha256 = `3EA0D2C3422E98DD8C15ADCE11C358DBDBE86BF17F55E1973604ECCB121D81FC`, mtime 11:23:30 — **совпадает с заявленным ими хешем**. Расхождение с pristine-снапшотом (`9BE1B62B…`, сборка 11:06:29) объяснимо: бандл контроллера инлайнит исходники зависимостей, а Lead правил `packages/contracts/src/verification.ts` в 11:21:27, то есть пересборка 11:23:30 законно отличается.
- Измерение «новейший `src` пакета против собранной точки входа» по всем 15 пакетам: **устарел ровно один** — `contracts`: `src/verification.ts` 09-28 11:21:27 против `lib/index.js` 09-28 11:02:39.
- Доказательство усталости, а не догадка: `packages/contracts/src/verification.ts:235` объявляет `export const ATTEMPT_GATE_REQUEST_FIELDS`, а `packages/contracts/src/index.ts:101` его реэкспортирует; в `packages/contracts/lib/index.js` и `lib/index.d.ts` этого символа **0 вхождений**, тогда как `packages/gate-runner/lib/index.js` (собран 11:28:04 через alias на `packages/contracts/src/index.ts`) его содержит, потому что `packages/gate-runner/src/port.ts:34,140` его импортирует и использует. Один и тот же граф, разные байты — разница только во времени сборки.
- Практический эффект на момент замера — **латентный**: ни один тест, `src` или скрипт не читают `ATTEMPT_GATE_REQUEST_FIELDS` через собранный `contracts` (единственные потребители — `packages/gate-runner/src/port.ts`, а он собирается по alias на исходники). Поэтому полный прогон этого не поймал и поймать не мог.
- Рекомендация финальному гейту Lead'а: на замороженном коммите выполнить канонический `corepack pnpm -r run build` целиком — после правки `nodeOptions` он безопасен по памяти; тогда `contracts/lib` догонит `src` и пересоберутся бандлы, собранные до 11:21:27 и инлайнящие contracts (`evidence`, `core`, `execution` 11:16:30, `planner`, `scheduler`, `storage`, `lease`, `beads-adapter`, `adapter-sdk`, `memory-native`, `web`). Это ровно та ловушка, что описана в MW-023 §4 «B-4: устаревший `packages/evidence/lib`». Бандлы, собранные после 11:21:27 и уже несущие новую версию: `controller` 11:23:30, `worktree-adapter` 11:23:42, `gate-runner` 11:28:04.
