# Поток F: фактическое состояние репозитория MyWork — измерения, пробелы, оптимизация

**Вердикт потока:** репозиторий в хорошем инженерном состоянии там, где он проверен машиной (12/12 пакетов проходят typecheck, 710 тестов: 687 pass / 0 fail / 23 skip, smoke 13/13, bundle собирается и пакуется), но **31,7 % исходных строк пакетов физически не подключены ни к одному runtime-пути** (`packages/controller` не импортирует 8 из 12 пакетов), **все 23 теста реального Beads-backend молча пропускаются из-за Windows-дефекта спавна**, а при их включении **2 из них падают на реальном `bd` 1.3.0**, что ставит под вопрос две объявленные capability (`batch-dep-remove`, `heartbeat`).

**Срез:** 2026-09-26, после 22:10 (Asia/Yekaterinburg). HEAD `0c657ae1434202865bd330f0eeaf2b60eb78f6d4`.
**Изоляция:** вся сборка/прогоны — в `H:\Repo\DSH-MyWork\.tmp\f-audit` (git worktree, `--detach`, HEAD). Живое дерево не изменялось (см. CLAIM F-28). Отчёт: `H:\Repo\DSH-MyWork\.work\analysis\2026-09-26\F-gaps.md`.

---

## 1. Что проверено и как

Все команды выполнялись из `H:\Repo\DSH-MyWork\.tmp\f-audit`, если не указано иное. Exit code приведён буквально; `EXIT=` — код последней команды блока.

| # | Утверждение | Как проверял (команда / файл:строка) | Результат |
|---|---|---|---|
| 1 | Изолированная копия создана | `git -C H:\Repo\DSH-MyWork worktree add --detach .tmp\f-audit HEAD` | `EXIT=0`; `Preparing worktree (detached HEAD 0c657ae)` |
| 2 | Зависимости ставятся из lockfile | `pnpm install --frozen-lockfile --prefer-offline` (полный путь к рабочему `pnpm.cmd`) | `EXIT=0`; «Scope: all 13 workspace projects… Packages: +49… Done in 7s using pnpm v12.4.2»; store `H:\.pnpm-store\v11`; «Lockfile passes supply-chain policies (69 entries)» |
| 3 | Документированный вход `pnpm` в свежем shell не работает | `pnpm --version`; `pnpm run build`; `pnpm run typecheck` | **`EXIT=1`** трижды; stderr: `'"H:\.pnpm-store\v11\links\@\pnpm\12.4.2\f6c04c51…\bin\\..\node_modules\pnpm\pnpm"' is not recognized as an internal or external command` |
| 4 | Typecheck всех пакетов проходит | `node_modules\.bin\tsc.cmd --noEmit -p tsconfig.json` в каждом из 12 `packages\*` | 12× `ok`, `TYPECHECK_FAILED_PACKAGES=0`, 20 с |
| 5 | Сборка всех пакетов проходит | `node_modules\.bin\tsdown.cmd` в порядке зависимостей (`contracts, core, storage, evidence, lease, adapter-sdk, beads-adapter, execution, planner, scheduler, memory-native, controller`) | 12× `ok`, `BUILD_FAILED=0`, 204,7 с |
| 6 | Smoke проходит | `node scripts/smoke.mjs` | `EXIT=0`; 13 шагов `ok`, `smoke: all steps passed`, 0,2 с |
| 7 | **Полный тест-набор: реальные счётчики** | `node --test --test-isolation=none --test-reporter=spec "tests/**/*.test.mjs"` | **`EXIT=0`; `tests 710`, `pass 687`, `fail 0`, `cancelled 0`, `skipped 23`, `todo 0`, `duration_ms 87615.26`** (wall 87,8 с) |
| 8 | Пропущенные тесты — только реальный `bd` | `Select-String -Path .tmp-audit\tests-full.log -Pattern '# SKIP'` | 23 строки `# SKIP`, все в `beads-adapter.test.mjs`; предупреждение в stderr: «the real-bd contract checks are SKIPPED — `bd version` could not be spawned (… EPERM on piped stdio). These are not passes.» |
| 9 | `bd` на машине ЕСТЬ и работает | `bd version` в pwsh | `EXIT=0`; `bd version 1.3.0 (f45b249ce: HEAD@f45b249ce6b4)` |
| 10 | Причина пропуска — не EPERM, а ENOENT (Windows-шим) | `node .tmp-audit\bd-probe.mjs`: `spawnSync('bd',['version'],{shell:false})` / `spawnSync('bd.cmd',…)` / `spawnSync('bd',…,{shell:true})` | `ENOENT (errno -4058)` / `EINVAL (errno -4071)` / **`status=0`, `bd version 1.3.0`**; `tests\beads-adapter.test.mjs:58` использует именно `shell:false` |
| 11 | Реальный Beads-слой при включении: 15 падений | патч только пробы `bdAvailable()`→`node bd.js` в копии worktree; `node --test tests/beads-adapter.test.mjs` | `EXIT=1`; `tests 70, pass 55, fail 15, skipped 0, duration_ms 206994`; все падения — `AdapterRefusal … no beads workspace is resolvable … code: 'ADAPTER_UNAVAILABLE'` |
| 12 | Причина — process seam адаптера (`shell:false`, binary `bd`) | `packages\beads-adapter\src\runner.ts:96,102-108`; патч `runner.ts` (на win32 → `node <bd.js>`) + пересборка `tsdown` (`EXIT=0`, 39,6 с) | `tests 70, pass 68, **fail 2**, skipped 0, duration_ms 280532` |
| 13 | Два реальных дефекта против `bd` 1.3.0 | разбор `beads-runnerfix.log` | ① `bd batch commits dep add and dep remove in one transaction (real bd)` → `AssertionError: the added edge must be present` (`tests\beads-adapter.test.mjs:1161`); ② `a heartbeat refreshes a held claim and reclaim reverts a stale one (real bd)` → `bd heartbeat mw-kmk failed (exit 1)` (`tests\beads-adapter.test.mjs:1353`) |
| 14 | Объём исходников | `Get-ChildItem packages\*\src -Recurse -Filter *.ts` + `Measure-Object -Line` | **111 файлов / 36 674 строки** (12 пакетов); tests: **32 файла / 17 449 строк** |
| 15 | Цифра брифинга 125 383 строки включает артефакты сборки | тот же подсчёт с `-Include *.ts,*.mjs,*.js` без `node_modules/.tmp/.pnpm-store/dist` — сначала без `packages\*\lib`, затем с ним | без `lib`: 161 файл / 55 481 строка; **с `lib`: 196 файлов / 126 520 строк** ≈ 190 / 125 383 из брифинга |
| 16 | Реально отслеживается git | `git ls-files` | 191 файл: 123 `.ts`, 36 `.mjs`, 26 `.json`, 2 `.yaml` + 1 `.yml`, 1 `.md`, 1 `.gitignore` |
| 17 | 8 из 12 пакетов недостижимы из runtime | скрипт `graph.mjs` (разбор `from '…'` по `packages/*/src`) | `reachable from packages/controller/src: adapter-sdk, contracts, controller, core`; **`NOT reachable: beads-adapter, evidence, execution, lease, memory-native, planner, scheduler, storage`** |
| 18 | Подтверждение по коду контроллера | `packages\controller\src\index.ts:47-48,115-128` | `apply` публикует только `MyWorkControllerService` + `MyWorkAdaptersService` и вызывает `mountModelCatalog` / `mountDshRuntime`; импортов storage/lease/execution/planner/scheduler/evidence нет |
| 19 | Нет ни одной рабочей SQLite-базы MyWork | `Test-Path C:\Users\Dmitry\.dsh\dsh-mywork`; `Get-ChildItem C:\Users\Dmitry\.dsh -Recurse -Filter *.sqlite*` | `exists=False`; второй поиск — пусто |
| 20 | Миграции и schemaVersion | `Select-String 'version: \d+,'`, `*MIGRATIONS` | kernel v1 (`storage\src\migrations.ts:49-91`), evidence v2/v3 (`evidence\src\schema.ts:138-153`), lease v4 (`lease\src\schema.ts:66`), planner v5 (`planner\src\schema.ts:148`), execution v6 (`execution\src\schema.ts:153`); максимум `user_version = 6` |
| 21 | Композиция миграций есть только в тестах | `Select-String 'MYWORK_MIGRATIONS'` по `packages`, `tests`, `scripts` | 6 попаданий в `packages` — все в JSDoc/шаблонах; 15 попаданий в `tests\*.test.mjs`; **ни одного исполняемого места вне тестов** |
| 22 | WAL включён и проверяется fail-closed | `packages\storage\src\sql.ts:127-140` | `PRAGMA foreign_keys = ON`; `PRAGMA journal_mode = WAL`; чтение обратно и `StorageError`, если режим не `wal` |
| 23 | 13 из 15 таблиц объявлены вне kernel-миграций | `Select-String 'CREATE TABLE'` по `packages/**/src/*.ts` | 15 сайтов: 2 в `storage\src\migrations.ts`, 13 в `evidence` (2), `execution` (4), `lease` (1), `planner` (6) |
| 24 | Маркеры незавершённости | `Select-String '\b(TODO\|FIXME\|HACK\|XXX)\b'` по 123 `src\*.ts` и по `tests\*.mjs` | **0 и 0**; `catch {}` — 0; `'not implemented'` — 3, все пояснительные (`beads-adapter\src\memory.ts:43,531`, `reconcile.ts:11`) |
| 25 | Гигиена git | `git status --porcelain=v1 -uall`; `git log --oneline -5`; `git tag`; `git branch -a`; `Test-Path .github` | статус **пуст** (`EXIT=0`); тегов 0; ветка одна `main`; **`.github` отсутствует** → CI нет |
| 26 | Метаданные пакетов | разбор 12 `packages\*\package.json` | у всех: `version 0.1.0`, `private: true`, `license MIT`, `files:["lib"]`, **нет `engines`**, **нет `peerDependencies`** (кроме controller: `@deepseek-ai/cordis ^4.0.2`), **нет `dependencies`**; корневой `package.json` — `private:true`, `engines.node >=22.18.0`, `packageManager pnpm@12.4.2` |
| 27 | Публикация невозможна by construction | `pnpm pack` в `packages\controller` + `tar -xzf` + чтение манифеста | `EXIT=0`; `dsh-mywork-controller-0.1.0.tgz` **225 651 байт**; внутри `cordis.patch.yml`, `lib/index.{js,d.ts,js.map,d.ts.map}`, `package.json`, `LICENSE`; **`"private": true` сохранён**; в `devDependencies` упаковки остались `@dsh-mywork/{adapter-sdk,contracts,core}@0.1.0` |
| 28 | Документированная упаковка не работает | `node scripts/pack.mjs` в worktree | **`EXIT=1`**; `Error: pack: pnpm pack exited with code 1` + тот же сломанный путь `H:\.pnpm-store\…\pnpm`; причина — `scripts\lib\process.mjs:52-58` уходит в `shell:true` + `pnpm`, потому что `npm_execpath` оканчивается на `.exe` |
| 29 | `packController` не идемпотентен | повторный `packController` при уже существующем `*.tgz` в `packages\controller` | `Error: pack: expected exactly one new tarball in …\packages\controller, found []` (`scripts\pack.mjs:44-47`) |
| 30 | Наблюдаемость | `Select-String` по 123 `src\*.ts` | `otel` 0, `opentelemetry` 0, `telemetry` 0, `prometheus` 0, `traceparent` 0, `span` 4 (не трейсинг), `metric` 1 (комментарий в `core\src\board.ts:243`); `correlationId` 90, `correlation_id` 24 |
| 31 | Стоимость/токены | `Select-String 'tokenCount\|costUsd\|tokensUsed\|estimatedCost'` | прямых счётчиков расхода нет; бюджеты объявлены декларативно (`contracts\src\budget.ts:39-129`: `maxCostPerTask`, `maxOptimizerCostPerDay`, …) |
| 32 | Секреты | regex-скан (`sk-…`, `ghp_…`, `AKIA…`, `-----BEGIN … PRIVATE KEY`, `Bearer …`, `api_key=`/`password=`) по `packages/**` и `tests/**`; затем по `.work/**` | 5 совпадений — **все синтетические фикстуры тестов** (`tests\security.test.mjs:352-359` массив `secrets`, `tests\evidence.test.mjs:290` PEM/JWT для проверки `secret-material`); **0 совпадений в `.work`**; 32 длинных токена в отчётах — это 64-символьные hex-хэши (sha256) |
| 33 | Три леджера | скрипты `ledgers.mjs` / `ledger-detail.mjs` по `INDEX.md`, `tasks.json`, `C:\Users\Dmitry\.dsh\task-board\ledger-v2.json` | INDEX.md: **55** карточек, 53 `planned` + 2 `superseded`; tasks.json: **55**, 53 `planned` + 2 `superseded`; live ledger (275 049 байт): **55** карточек, статусы `backlog 34 / done 19 / failed 2`, `revision 324`, `archivedAt` выставлен у 3 |
| 34 | Исполнения на живой доске | тот же экстрактор по `executions[]` | **31 исполнение: 20 `succeeded`, 11 `failed`**, на 22 карточках; причины: `workspace not found` ×7 (MW-003…MW-008, MW-043), `agent turn ended with an error` ×2 (MW-001, MW-016), `agent-presets: preset "standard" failed to mount` ×2 (MW-002) |
| 35 | Схема карточки доски | `Object.keys(card)` первой карточки | `id, title, description, prompt, status, createdAt, updatedAt, executions, workspaceId, permission, model, tags, permissionConfirmedAt, archivedAt`; **поля `permissionPending` в леджере нет**; `column` отсутствует (колонка выводится из `status`) |
| 36 | Диск | `Measure-Object -Property Length -Sum` | `.tmp` 3751 файл / 175,11 МБ; `node_modules` 109,69 МБ; `.pnpm-store` 72,3 МБ; `packages` 17,72 МБ; `.beads` 21 файл / 2,8 МБ; `DSH-MyWork.rar` **43 410 533 байта**, mtime 18.09.2026 |
| 37 | База Beads | `Get-ChildItem .beads -Recurse` | всего **2 940 728 байт**; крупнейший файл `embeddeddolt\mw\.dolt\noms\vvvv…` — 2 318 042 байта |

---

## 2. Измерения по обязательным пунктам задания

### 2.1. Прогон тестов (пункт 1)

**ПОДТВЕРЖДЕНО с оговоркой.** Набор запускается и целиком зелёный:

```text
ℹ tests 710   ℹ pass 687   ℹ fail 0   ℹ cancelled 0   ℹ skipped 23   ℹ todo 0
ℹ duration_ms 87615.2611        (EXIT=0)
```

Что нужно для запуска (измерено, а не предположено): `tests/lib/fixtures.mjs:39-72` грузит **собранные** `packages/*/lib/*.js` — значит перед тестами обязателен `tsdown` по всем 12 пакетам (у меня — `BUILD_FAILED=0`, 204,7 с). Отдельно `pnpm install` нужен только для `@deepseek-ai/cordis` и тулчейна (`tsdown`, `typescript`), сам код пакетов внешних runtime-зависимостей не имеет (см. §2.7).

Что это меняет: набор тестов — не «декоративный». 710 тестов, 0 падений, 87,6 с — это лучший показатель зрелости в репозитории. Но 23 пропуска — не «мелочь»: это ровно весь слой реального Beads (§2.6).

### 2.2. Инвентарь незавершённого (пункт 2)

**ПОДТВЕРЖДЕНО (отрицательный результат, и он значим).**

- `\b(TODO|FIXME|HACK|XXX)\b` по 123 `packages/**/src/*.ts` → **0**; по `tests/*.mjs` → **0**.
- `catch {}` (пустой блок) → **0**; всего `}` + `catch` — 71 (все именованные/с телом).
- `not implemented` → 3 вхождения, все три — осознанные пояснения, не заглушки: `beads-adapter\src\memory.ts:43` («`reflect` is **not implemented** (Beads has no reflection operation…)»), `memory.ts:531`, `reconcile.ts:11`.
- Эвристики «stub/placeholder/for now/temporary/deferred» → 0/0/1/3/4; `unsupported` — 51 (типизированные отказы), `no-op` — 12 (описания идемпотентности).

**Вывод:** незавершённость в этом репозитории не маркируется комментариями вообще — она выражена **отсутствием кода** (см. §2.3) и статусами `backlog` на доске. Это делает маркерный поиск бесполезным как инструмент аудита и повышает цену карты «карточка → код → тест».

### 2.3. Карта «карточка → отчёт → код → тест» (пункт 3)

Отчётов в `.work/reports/` — **34 файла** (`Get-ChildItem .work\reports -File` → 34). Из них картам MW соответствуют 33 + `setup-verification.json`.

**Карточки с отчётом (реализация заявлена и есть в дереве):**

| Карточка | Отчёт | Код (пакет:файл) | Тест |
|---|---|---|---|
| MW-001 | `MW-001-target-capabilities.md`, `MW-001-review.md` | — (исследование) | — |
| MW-002 | `MW-002-bootstrap.md` | `controller:index.ts`, `cordis.patch.yml` | `tests/adapters.test.mjs`, smoke |
| MW-003 | `MW-003-domain-contracts.md` | `contracts:*.ts` (30 файлов) | `tests/task.test.mjs`, `tests/authority.test.mjs` |
| MW-004 | `MW-004-storage.md` | `storage:*` (10) | `tests/storage.test.mjs`, `tests/storage-crash.test.mjs` |
| MW-005 | `MW-005-adapter-sdk.md` | `adapter-sdk:*` (8) | `tests/adapters.test.mjs` |
| MW-006 | `MW-006-team-config.md` | `core:config.ts, team.ts` | `tests/config.test.mjs`, `tests/team.test.mjs` |
| MW-007 | `MW-007-security.md` | `core:security.ts`, `contracts:security.ts` | `tests/security.test.mjs`, `tests/boundaries.test.mjs` |
| MW-008 | `MW-008-evidence-audit.md` | `evidence:*` (7) | `tests/evidence.test.mjs` |
| MW-009 | `MW-009-controller-lease.md` | `lease:*` (5), `core:authority.ts` | `tests/lease.test.mjs` |
| MW-010 | `MW-010-beads-adapter.md` | `beads-adapter:*` (10) | `tests/beads-adapter.test.mjs` — **23 теста skip** |
| MW-011 | 8 артефактов (`MW-011-*.md`) | `planner:*` (5) | `tests/plan-mutation.test.mjs` (100 КБ) |
| MW-012 | `MW-012-attempt-saga.md`, `MW-012-review.md` | `execution:*` (5) | `tests/claim-saga.test.mjs`, `attempt.test.mjs` |
| MW-013 | `MW-013-routing-budget.md` | `core:routing.ts, budget.ts` | `tests/routing.test.mjs`, `budget.test.mjs` |
| MW-014 | `MW-014-scheduler.md`, `-review`, `-fixes-verification` | `scheduler:service.ts` (425 строк) | `tests/scheduler.test.mjs` |
| MW-015 | `MW-015-dsh-runtime.md` | `controller:dsh-session.ts`, `model-catalog.ts` | `tests/runtime.test.mjs`, `session.test.mjs` |
| MW-016 | `MW-016-context-fabric.md` | `core:context.ts` | `tests/context.test.mjs` |
| MW-017 | `MW-017-skills.md` | `core:skill.ts` | `tests/skill.test.mjs` |
| MW-018 | `MW-018-native-memory.md` | `core:memory.ts`, `memory-native:*` | `tests/memory.test.mjs` |
| MW-019 | `MW-019-external-memory.md` | `beads-adapter:memory*.ts` | `tests/memory-beads.test.mjs` |
| MW-020 | `MW-020-sessions.md` | `core:session.ts`, `contracts:session.ts` | `tests/session.test.mjs` |
| MW-042 | `MW-042-board-projection.md` | `contracts:board.ts`, `core:board.ts` | `tests/board.test.mjs` |
| MW-043 | `MW-043-idea-bank.md` | `planner:*` (idea/approved-plan) | `tests/plan-mutation.test.mjs` |

**Карточки без отчёта — измеримая карта (все 22 — `backlog` на живой доске):**

| Карточка | Тема | Символ-признак реализации | Найдено в `packages/**/src` | Тест |
|---|---|---|---|---|
| MW-021 | Изоляция Git worktrees | `worktree` | 30 вхождений, но все — про **границу** worktree (`core/security.ts`, `boundaries.test.mjs`), не про создание изоляции | частично (`boundaries.test.mjs`) |
| MW-022 | Worker execution от admission до результата | сквозной runner | нет: `execution:service.ts` реализует claim-saga (MW-012), сквозного worker-цикла нет | нет |
| MW-023 | Детерминированные verification gates | `verificationGate`, `gate` | **0** | 0 |
| MW-024 | Независимый Review и reject flow | `review` | есть: `core/review.ts` (10 769 б), `contracts/review.ts`, 494 вхождения | `tests/review.test.mjs` |
| MW-025 | Integrator и завершение TaskGraph | `IntegratorPort`, `integrate(` | **0** | 0 |
| MW-026 | Отдельный Task Setter в DSH | `TaskSetter` | **0** в `src`; 167 «совпадений» — в `tests/plan-mutation.test.mjs`, где `const { planner: taskSetter } = …` (локальный алиас, не реализация) | нет |
| MW-028 | Embedded и Resident Controller | `resident`, `embedded` | 22 вхождения (в основном Dolt embedded) — резидентного режима контроллера нет | нет |
| MW-029 | Application API, HTTP/SSE, CLI | `listen`, `sse` | 0 серверных символов; 400 «совпадений» — шум (`import`, `http` в комментариях) | 0 |
| MW-030 | human gates, pause/cancel/retry/reassign | `pause`, `cancel` | `cancel` есть в портах (`AbortSignal`) 256 вхождений; human-gate flow отсутствует | нет |
| MW-031 | recovery и застрявшая работа | `recovery`, `stuck` | 104 вхождения — реконсиляция Beads/staged mutation, не детектор зависшей работы | нет |
| MW-032 | Fast Role Learner | `Learner` | 3 вхождения (обучение в `core/team.ts` — это MW-006) | 1 |
| MW-033 | Sleep Optimizer, curator, promotion | `optimizer` | 87 вхождений (`maxOptimizerCostPerDay` — бюджет, MW-013) | 30 (бюджет) |
| MW-034 | token/context/cost metrics и observability | `otel|metric` | **0** | 0 |
| MW-036, MW-037 | Team Work / Role Lab UI | client-пакет | **пакета `@dsh-mywork/web` в workspace нет** (12 пакетов, web отсутствует) | нет |
| MW-038 | Doctor и полный adapter conformance | `doctor` | 17 вхождений: `conformance.ts` (45 КБ) реализует **общий** conformance (MW-005); Doctor как команда отсутствует | `adapters.test.mjs` (14 проверок) |
| MW-039 | invariants, crash recovery, security | accepted | `storage-crash.test.mjs`, `boundaries.test.mjs`, `authority.test.mjs` покрывают **часть**; приёмочного набора нет | частично |
| MW-040 | upgrade, export/import, repair | `export/import` | 0 модулей export/import/repair; `migrations.ts:9-11` прямо пишет «Scope: this is the apply half of §61… Backup → migrate → verify → activate, export/import, repair… are MW-040» | 0 |
| MW-041 | операционная упаковка v0.1 | `scripts/*` | `pack.mjs`, `smoke.mjs`, `verify-profile.mjs` есть; **`pack:local` падает в этой среде** (см. §2.7) | нет |
| MW-044 | workflow engine | `workflow` | `contracts/workflow.ts` (5,8 КБ) — только контракт | 18 (контракт) |
| MW-045 | work types, finish criteria | `workType`, `finishCriteria` | **0** | 0 |
| MW-046 | обсуждение карточки и steering | `discussion`, `steering` | 1 вхождение (комментарий) | 4 |
| MW-047 | backend проекции: snapshot, SSE, degraded | `snapshot` | 237 вхождений — snapshot'ы Context Fabric (MW-016), не проекция доски | 185 (не проекция) |
| MW-048…MW-053 | UI-пакет, доска, DnD, редактор, graph view, тема | `slots`, `client` | 0: пакета web нет | 0 |
| MW-054 | DSH-web compatibility adapter и мастер импорта | `import` | 0 | 0 |
| MW-055 | приёмка доски и верификация миграции | — | — | нет |

**Итог по трём категориям (как требует приёмка). Все 31 карточка без отчёта распределены:**

- **Не реализовано** — прямых символов и тестов нет (27 карточек): MW-022, MW-023, MW-025, MW-026, MW-028, MW-029, MW-030, MW-031, MW-032, MW-033, MW-034, MW-036, MW-037, MW-038, MW-040, MW-044, MW-045, MW-046, MW-047, MW-048, MW-049, MW-050, MW-051, MW-052, MW-053, MW-054, MW-055.
  Оговорки: у MW-044 есть только контракт (`contracts\src\workflow.ts`, 5,8 КБ); у MW-024/MW-039/MW-041 (см. ниже) есть частичная база; у MW-021 — только проверка границы worktree, но не создание изоляции.
- **Реализовано частично, не проверено на полноту** (4 карточки): MW-021 (границы и запрет обхода пути — `core\src\security.ts`, `tests\boundaries.test.mjs` PASS, но изоляции worktree нет), MW-024 (`core\src\review.ts` 10 769 байт + `tests\review.test.mjs` PASS; независимого reviewer-исполнителя и reject-flow как процесса нет), MW-039 (часть инвариантов покрыта `storage-crash.test.mjs`, `boundaries.test.mjs`, `authority.test.mjs`; приёмочного набора нет), MW-041 (`smoke` PASS, `verify:profile: PASS`, bundle 225 651 байт устанавливается; но `pnpm run check`/`pack:local` падают, тега нет).
- **Реализовано и подтверждено прогоном** (22 карточки, у всех есть отчёт): MW-002…MW-009, MW-011…MW-020, MW-042, MW-043.

Отдельно от этих трёх категорий: **MW-010 — «реализовано, но не подтверждено»**, а по двум capability (`batch-dep-remove`, `heartbeat`) — **«проверено и опровергнуто»** (§2.6).

### 2.4. `packages/contracts` против `packages/core` (пункт 4)

**ПОДТВЕРЖДЕНО, риск низкий, но не нулевой.**

`contracts` — типы и замороженные константы, без поведения (`contracts\src\index.ts:5-7`). `core` — реализация политики. Скрипт `dups.mjs` собрал все `export (type|interface|const|class|function|enum)` по `src` обоих пакетов:

```text
contracts unique export names: 648
core unique export names: 255
shared names: 1
```

Единственное совпадающее имя — **`TaskTransitionCommand`, и это два РАЗНЫХ интерфейса**:

| Пакет | Файл | Поля |
|---|---|---|
| `contracts` | `contracts\src\taskgraph.ts` | `id`, `to`, `meta`, `expectedRevision?`, `assignee?` — команда порта TaskGraph |
| `core` | `core\src\task.ts` | `to`, `expectedRevision?`, `activeAttemptId?`, `at` — доменный переход состояния |

Оба реэкспортируются своими `index.ts` (`contracts\src\index.ts:59`, `core\src\index.ts:→ ./task.ts`). `packages/beads-adapter` импортирует **из обоих пакетов** (граф: `beads-adapter -> adapter-sdk, core, contracts`), поэтому неверный путь импорта даст молчаливо другую форму объекта, а не ошибку компиляции. Риск рассинхронизации оценён как **низкий по вероятности, средний по цене ошибки**: 648 экспортируемых имён `contracts` против 255 `core` при одном коллизионном — это хорошая гигиена (в `core` нет параллельных копий доменных типов; всё, что является контрактом, живёт в `contracts`).

### 2.5. Storage: миграции, WAL, outbox/inbox, crash, размер (пункт 5)

**ЧАСТИЧНО подтверждено — механика отличная, композиции нет.**

Реализовано и подтверждено:

- **Версионирование:** `PRAGMA user_version` + журнал `schema_migrations` (`storage\src\migrations.ts:97-103`). Максимум по дереву — **6** (kernel v1 `outbox-inbox`, evidence v2 `artifact-audit` / v3 `evidence-immutability`, lease v4, planner v5, execution v6 = `CLAIM_SAGA_SCHEMA_VERSION`).
- **Fail-closed на новую версию:** база новее сборки не открывается — `StorageError('schema-version-unsupported')` (`migrations.ts:150-156`); тест «a database written by a newer build is refused, not downgraded» — PASS.
- **Каждая миграция в своей транзакции**, версия перечитывается под write-lock, две параллельные миграции одной базы дают по одному применению (`migrations.ts:160-174`); тест «two connections on one file share the state and each migration runs once» — PASS.
- **WAL обязателен и проверяется обратным чтением**, отказ → `StorageError` (`storage\src\sql.ts:127-140`); `foreign_keys = ON`; `busy_timeout` по умолчанию 5 000 мс (`storage\src\store.ts:28`).
- **Транзакция mutation+outbox:** `mutation+outbox` — единая транзакция (`storage\src\index.ts:14`, `store.ts:55-60`); тест «a failure between the mutation and the commit leaves no half change» — PASS.
- **Inbox dedup:** таблица `inbox_dedup (consumer, event_id, processed_at)` (`migrations.ts:71-78`); эффект обязан быть **синхронным** — «an asynchronous effect could be recorded as processed before it finished» (`storage\src\inbox.ts:61`).
- **Crash:** `tests\storage-crash.test.mjs` (4 445 байт) — 6 тестов, все PASS, включая «a restart keeps the schema version, the queued events, and the dedup ledger» и «a closed store refuses further work, and there is no in-memory mode».

Не подтверждено / пробелы:

- **Композиция миграций существует только в тестах.** `Select-String 'MYWORK_MIGRATIONS'` даёт 6 попаданий в `packages` — все внутри JSDoc-примеров (`evidence\src\index.ts:14`, `store.ts:8,90`, `lease\src\index.ts:13`, `lease.ts:320`, `planner\src\store.ts:126`) — и 15 исполняемых в `tests\*.test.mjs`. **Ни одного runtime-сайта, который открывает `<DSH_HOME>/dsh-mywork/state/controller.sqlite`, нет** (см. §2.3, пункт 17).
- **13 из 15 таблиц живут вне kernel-миграции** (evidence 2, execution 4, lease 1, planner 6). Это осознанный дизайн («tables are added by the migration of the entity that implements them», `migrations.ts:86-90`), но он означает, что `MYWORK_SCHEMA_VERSION = 1` не описывает реальную схему базы: **одна база = конкатенация пяти независимых списков**, а порядок конкатенации задаёт вызывающий. Ошибка порядка/пропуск списка ловится только проверками вида `planner\src\store.ts:126`.
- **Базы нет ни на одной машине:** `Test-Path C:\Users\Dmitry\.dsh\dsh-mywork` → `False`; поиск `*.sqlite*` под `C:\Users\Dmitry\.dsh` — пусто. Значит: **путь, размер и рост базы не измерены — их не существует**.
- **Чистка есть, но не для растущих таблиц.** `Select-String 'VACUUM|DELETE FROM|retention|prune'` по 123 `src/*.ts` даёт 37 совпадений, из них исполняемых `DELETE FROM` — **ровно три**, и все по «рабочим» таблицам: `execution\src\store.ts:259` (`claim_step WHERE operation_id`), `lease\src\lease.ts:256` (`controller_lease WHERE scope_id … epoch`), `planner\src\store.ts:312` (`plan_mutation_step WHERE operation_id`). **Ни одного `DELETE FROM outbox`, `inbox_dedup`, `audit_events` и ни одного `VACUUM`/`incremental_vacuum`**. Остальные 34 совпадения — слово `retention`/`prune` в другом смысле (retention памяти §23.8, `pruneWindow` контекста §22.5, `pruned` префикс журнала Beads).
- Что будет расти при появлении живой базы: `outbox` (одна строка на событие, `status='delivered'` не удаляется), `inbox_dedup` (одна строка на пару consumer×event), `artifacts.bytes BLOB` (артефакты хранятся **в базе**, `evidence\src\schema.ts:60`), `audit_events` (append-only, удаление запрещено триггерами `evidence\src\schema.ts:92-100`).

### 2.6. `adapter-sdk`, `beads-adapter`, capability против реальных вызовов `bd` (пункт 6)

**ОПРОВЕРГНУТО в существенной части.** MW-010 заявлен выполненным (отчёт есть, доска `done`), но реальный backend-слой не проверен и при включении падает.

Capability-манифест (`packages\beads-adapter\src\adapter.ts:87-113`) — 10 ключей, 8 `true` / 2 `false`:

| Capability | Значение | Фактический вызов `bd` | Живая проверка |
|---|---|---|---|
| `http` | `false` | не вызывается (решение владельца: CLI-only) | не требуется |
| `graph-apply` | `true` | `create --graph <planPath> --json` (`adapter.ts:860`) | только в skip-наборе |
| `batch` | `true` | `batch` + stdin (`adapter.ts:889`) | только в skip-наборе |
| `batch-dep-remove` | `true` | тот же `batch` | **падает на реальном `bd`** |
| `guarded-batch` | `false` | `update … --if-status` вместо batch (`adapter.ts:946+`) | не требуется |
| `metadata-set` | `true` | `update <id> --metadata …` | только в skip-наборе |
| `events-journal` | `true` | `events tail --since <n> --json` (`adapter.ts:641`) | только в skip-наборе |
| `claim-lease` | `true` | `update <id> --claim --json` (`adapter.ts:498`) | только в skip-наборе |
| `heartbeat` | `true` | `heartbeat <id>` (`adapter.ts:586`) | **падает на реальном `bd`** |
| `reclaim` | `true` | `reclaim --json` (`adapter.ts:602`) | только в skip-наборе |

Прочие вызовы: `context` (`workspace.ts:120`), `show <id> --json`, `ready --json`, `list --json`, `dep list <id> --json`, `config get <key>`, `create --title`, `update --status`, `kv list --json` (memory-провайдер). **Статически манифест соответствует коду** — ни одной объявленной capability без команды и ни одной команды, не покрытой capability, не найдено.

Exit codes: `BD_EXIT_GUARD_FAILED = 13` и `BD_EXIT_PANIC = 2` декодированы явно (`runner.ts:21-25`), и это то, что требует MW-010 («распознавать такой отказ по exit code»). Fail-closed: `requireCapability` бросает до вызова (`adapter.ts:229`), отсутствие workspace → `ADAPTER_UNAVAILABLE` с точной командой инициализации (`adapter.ts:160-163`, `workspace.ts`), `classifyBeadsFailure` различает отказы. Тест «a missing workspace is refused fail-closed with the exact init command» — PASS.

**Что ломается фактически:**

1. `tests\beads-adapter.test.mjs:57-60` определяет доступность через `spawnSync('bd', …, {shell:false})`. На Windows `bd` — это `bd.cmd`/sh-шим без расширения; замер: `ENOENT (errno -4058)`; `bd.cmd` → `EINVAL (errno -4071)`; `shell:true` → `status=0`. Итог: **23 теста реального Beads-backend пропускаются, хотя `bd 1.3.0` установлен и работает**. Комментарий в коде (`beads-adapter.test.mjs:65-71`) объясняет это «EPERM под DSH file sandbox» — **объяснение неверно**: это не EPERM и не песочница, а резолвинг Windows-шима.
2. Сам адаптер использует тот же негодный способ: `runner.ts:96` (`binary = options.binary ?? 'bd'`) + `runner.ts:102-108` (`shell: false`). Значит **на Windows весь taskgraph-путь Beads неработоспособен без патча**, и конфигурацией это не лечится: `binary: 'node'` даст `node ready --json`, `binary: 'bd.cmd'` — `EINVAL`. Замер: с исправленной пробой, но без патча раннера — `fail 15` из 70, все с `code: 'ADAPTER_UNAVAILABLE'`.
3. С патчем раннера (на win32 запускать `node <…>\@beads\bd\bin\bd.js`) — **`pass 68 / fail 2`**. Оставшиеся два падения — реальные расхождения с `bd 1.3.0`:
   - `bd batch commits dep add and dep remove in one transaction (real bd)` → `AssertionError: the added edge must be present` (`tests\beads-adapter.test.mjs:1161`). Это ровно та capability `batch-dep-remove`, на которой стоит staged plan MW-011/ADR024.
   - `a heartbeat refreshes a held claim and reclaim reverts a stale one (real bd)` → `dsh-mywork: bd heartbeat mw-kmk failed (exit 1)` (`tests\beads-adapter.test.mjs:1353`). Capability `heartbeat` объявлена `true` и не работает.

Что это меняет: карточка MW-010 = «реализовано, но **не проверено**» как минимум, а по двум capability — «проверено и **опровергнуто**». Пункт 6 приёмки MW-010 («capability-манифест против фактических вызовов») формально выполнен (манифест совпадает с кодом), но функционально — нет.

### 2.7. Гигиена репозитория (пункт 7)

**ПОДТВЕРЖДЕНО с одной поправкой к брифингу.**

| Что | Измерено | Оценка |
|---|---|---|
| `git status --porcelain=v1 -uall` | **пусто, `EXIT=0`** | **расходится с брифингом** (там ` M pnpm-lock.yaml`); mtime `pnpm-lock.yaml` = 2026-09-26 22:10:16; причину изменения фиксирую как неизвестную |
| CI | `.github` отсутствует (`Test-Path` → `False`) | **нет CI вообще**: ни typecheck, ни тестов, ни сборки на push |
| Лицензия | `LICENSE` = MIT, «Copyright (c) 2026 Definitely Stable»; `license: MIT` во всех 12 `package.json` | есть |
| Версионирование | все 12 пакетов `0.1.0`; **тегов 0**; ветка одна `main` | нет ни одной точки релиза; обновление версий не автоматизировано |
| `engines` | корень — `node >=22.18.0`; **у 11 из 12 пакетов `engines` нет** (у controller тоже нет) | не блокирует установку на несовместимом Node |
| `peerDependencies` | только у `controller`: `@deepseek-ai/cordis ^4.0.2`. **Ни один пакет не объявляет peer на `@deepseek-ai/dsh*`** | ровно то, что документ называет риском: compat-gate DSH не сработает, несовместимый bundle не будет `skippedBundles` |
| `private` | **`true` у всех 12**, включая публикуемый bundle | публикация через npm-registry невозможна by construction |
| `dependencies` | **ни у одного пакета нет `dependencies`** — только `devDependencies` с `workspace:*` | корректно для self-contained bundle (tsdown `alwaysBundle`), но означает, что единственная внешняя runtime-зависимость — peer `@deepseek-ai/cordis` |
| `DSH-MyWork.rar` | 43 410 533 байта (41,4 МиБ), mtime 18.09.2026, в корне, закрыт `/*.rar` в `.gitignore` | мусор в рабочем каталоге, но не в git |
| `.tmp` | **3751 файл / 175,11 МБ**; внутри — бэкапы (`errors.ts.bak`, `index.js.backup2`, `svc.bak`), ~120 mutation-скриптов и логов, и **живой зарегистрированный worktree `.tmp/mw012-review`** (`git worktree list` показывает его как отдельный worktree) | рабочий каталог раздут в 6 раз относительно `packages` (17,72 МБ) |
| `.pnpm-store` | **72,3 МБ** в корне репозитория (в `.gitignore`) | store внутри проекта вместо общего |
| `pack:local` / `verify:profile` | `node scripts/pack.mjs` → `EXIT=1`; после обхода (`npm_execpath=<…>\pnpm.mjs`) `node scripts/verify-profile.mjs` → **`EXIT=0`, `verify:profile: PASS`, 10,5 с**, изолированный `DSH_HOME`, «user profile untouched (3 fingerprint(s) unchanged)» | сам bundle устанавливается и монтируется; ломается только слой запуска `pnpm` |

Дополнительно измерено про упаковку (пункт 27 таблицы §1): tarball `dsh-mywork-controller-0.1.0.tgz` = **225 651 байт**, содержимое `cordis.patch.yml`, `lib/index.{js,d.ts,js.map,d.ts.map}`, `package.json`, `LICENSE`; `private: true` сохраняется и в упаковке; в `devDependencies` упаковки остались `@dsh-mywork/{adapter-sdk,contracts,core}@0.1.0` — имена, которых нет ни в одном registry.

### 2.8. Наблюдаемость и стоимость (пункт 8)

**ОТСУТСТВУЕТ В ПЛАНЕ как реализация; в плане есть только карточка MW-034 (backlog).**

- Метрик нет: `otel` 0, `opentelemetry` 0, `telemetry` 0, `prometheus` 0, `traceparent` 0, `span` 4 (не трейсинг), `metric` 1 (комментарий `core\src\board.ts:243`). В DSH профиле `dsh-session-telemetry-otel` включён, но **ни одного импорта OTel/телеметрии в MyWork нет** — интеграции не существует.
- Correlation ID есть и он системный: `correlationId` 90 вхождений в `src`, `correlation_id` 24; колонка `outbox.correlation_id NOT NULL` (`storage\src\migrations.ts:59`), `causation_id` рядом; `audit_events.correlation_id` (`evidence\src\schema.ts:80`). Это лучший задел под трейсинг из имеющегося.
- Учёта расхода нет: `tokenCount`/`costUsd`/`tokensUsed`/`estimatedCost` — 0. `contracts\src\budget.ts:13-40` прямо проектирует `BudgetAmount` как `known | unknown`, то есть **бюджет без цены — легальное состояние**, и это осознанное решение, но оно же означает, что «сколько денег потрачено» система сегодня ответить не может.
- Диагностика застрявшей работы: карточка MW-031 в backlog; в коде есть только реконсиляция Beads/staged mutation (104 вхождения `recovery`/`stuck`), не детектор зависшей попытки. Единственный рабочий сигнал оператора сегодня — строка `dsh-mywork: controller mounted service=… version=… contexts=control` при `diagnostics: true` (`controller\src\index.ts:184-187`) и отказы через `AdapterRefusal`/`MyWorkError` с типизированным `code`.

### 2.9. Секреты и приватность (пункт 9)

**ПОДТВЕРЖДЕНО: утечек нет.**

Regex-скан (`sk-…`, `ghp_…`, `AKIA…`, `-----BEGIN … PRIVATE KEY`, `Bearer <JWT>`, `api_key=`/`password=`) по `packages/**` и `tests/**` дал 5 совпадений, все — **намеренные фикстуры тестов защиты**:

- `tests\security.test.mjs:352-359` — массив `secrets` (тестовый RSA-PEM, синтетический JWT, `sk-live-9f2c8b1a4d`, `aws AKIAIOSFODNN7EXAMPLE`, `password=hunter2`, base64) — вход для проверки `credential-required`/редакции;
- `tests\evidence.test.mjs:290` — `-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkq…`, ожидаемый отказ `secret-material` при `artifacts.put`.

По `.work/**` (отчёты, карточки, JSON) — **0 совпадений**. 32 «длинных токена» ≥48 символов в отчётах — это 64-символьные hex-хэши sha256 (evidence-блоки). Ни один пароль/токен живого профиля DSH в отчётность не попал.

Пробел: сканирование ручное. Ни CI, ни pre-commit, ни `.gitleaks.toml`/`.secretlintrc` в дереве нет (проверено отсутствием `.github` и содержимым корня), поэтому защита держится на дисциплине, а не на gate.

### 2.10. Расхождение трёх леджеров одного плана (пункт 10)

**ПОДТВЕРЖДЕНО; расхождение шире, чем описано в брифинге.**

| Леджер | Карточек | Статусы | Комментарий |
|---|---|---|---|
| `.work/tasks/INDEX.md` | **55** | `planned 53`, `superseded 2` | ни одна карточка не отмечена выполненной, хотя 22 имеют отчёт и `done` на доске |
| `.work/tasks/tasks.json` | **55** | `planned 53`, `superseded 2` | `planRevision 2`, `schemaVersion` присутствует; те же 53/2 |
| живая доска `ledger-v2.json` | **55** | `backlog 34`, `done 19`, `failed 2` | `revision 324`; `archivedAt` у 3; `scheduler.timeZone = Asia/Yekaterinburg`, `lastTickAt = 2026-09-26T15:58:55Z`; `recentRequests` 255 |

Три источника согласны **только по числу карточек (55)**. По статусам расхождение полное: `INDEX.md`/`tasks.json` не отражают ни одного факта исполнения, а доска не отражает `superseded`.

Дополнительно измерено по доске:

- **31 исполнение: 20 `succeeded`, 11 `failed`**, на 22 карточках. Карточек в колонке `failed` — 2. То есть **9 исполнений упали на карточках, которые сейчас в `done`** (MW-003…MW-008 — по одному `workspace not found` каждая; MW-002 — дважды `agent-presets: preset "standard" failed to mount: 24 rows name plugins that cannot be resolved`). Это значит, что колонка `done` на этой доске **не означает «прогон прошёл»**.
- MW-001: отчёт есть, два исполнения, статус `failed`, `archivedAt` выставлен — то есть **архивированная проваленная карточка с готовым результатом** (брифинг это фиксирует, EXECUTION-PLAN тоже).
- MW-002 и MW-016: отчёты есть, статус `backlog` и `failed` соответственно.
- **Поля `permissionPending` в леджере нет.** Схема карточки: `id, title, description, prompt, status, createdAt, updatedAt, executions, workspaceId, permission, model, tags, permissionConfirmedAt, archivedAt`. Все 55 карточек имеют `permission: "workspace-write"`, у 22 выставлен `permissionConfirmedAt` — **ровно у тех 22, которые исполнялись**. Утверждение брифинга «отдельные карточки MW-044…MW-055 имеют `permissionPending: true`» **не воспроизводится**: такого поля не существует, а у MW-044…MW-055 нет ни одного исполнения и нет `permissionConfirmedAt` — то есть гейт не «не пройден», а **ни разу не запрошен**.
- MW-027 и MW-035 (`superseded`, «не запускать») **лежат в колонке `backlog`** вместе с 32 рабочими карточками и имеют `archivedAt` — но при этом остаются в `tasks`. Любой `autoRunTodo`/массовый запуск бэклога поднимет и их.

---

## 3. Правки к плану MyWork

| # | Куда | Что именно | Почему | Чем проверяется |
|---|---|---|---|---|
| 3.1 | Новая карточка **MW-056** (01-runtime, критический путь перед MW-010/011/041) | «Починить process seam `bd` и сделать реальный Beads-слой проверяемым»: (а) `runner.ts` — на win32 запускать JS-entry `@beads/bd/bin/bd.js` через `process.execPath` либо принимать явный `binary`+`argv prefix`; (б) `tests\beads-adapter.test.mjs:57-60` — проба через тот же seam, а не `spawnSync('bd', {shell:false})`; (в) 23 теста перестают быть skip | 23 теста — весь реальный контракт MW-010; без них отчёт MW-010 недоказуем | `node --test tests/beads-adapter.test.mjs` в worktree: было `pass 47 / skipped 23`, стало `pass 68 / fail 2` |
| 3.2 | Новая карточка **MW-057** (перед MW-011) | Разобрать два реальных расхождения: `bd batch` dep add+remove не создаёт ребро; `bd heartbeat <id>` → exit 1. Либо уточнить capability-манифест (`batch-dep-remove: false`, `heartbeat: false` + staged fallback), либо переделать вызовы | Объявленные `true` capability не подтверждаются на `bd 1.3.0`; на `batch-dep-remove` стоит staged plan ADR024 | те же два теста должны стать PASS **или** манифест должен измениться вместе с тестом «CLI-only: http is false and guarded-batch is false, the rest are true» |
| 3.3 | MW-010 (пересмотр) | Приёмку дополнить: «ни один тест реального backend не может быть `skipped` в CI-профиле; skip допустим только по явному `BEADS_BACKEND=absent`» | Сейчас skip выглядит как зелёный прогон и уже привёл к ложному «done» | `--test-reporter=spec` не должен содержать `# SKIP` для `beads-adapter` |
| 3.4 | Новая карточка **MW-058** (01b-board или 04-control, зависит от MW-015) | **Composition root**: один application service, который открывает `<DSH_HOME>/dsh-mywork/state/controller.sqlite` с полным списком `[...MYWORK_MIGRATIONS, ...LEASE_MIGRATIONS, ...EVIDENCE_MIGRATIONS, ...PLAN_MUTATION_MIGRATIONS, ...CLAIM_SAGA_MIGRATIONS]`, поднимает lease, planner, execution, scheduler, evidence и регистрирует их в `myworkAdapters` из `controller\src\index.ts:115-128` | 8 из 12 пакетов (11 619 строк src, 31,7 %) сегодня недостижимы ни из одной runtime-точки; `MYWORK_SCHEMA_VERSION=1` не описывает базу | новый smoke-шаг «store opened and schema at version 6»; `Test-Path $DSH_HOME\dsh-mywork\state\controller.sqlite` в изолированном профиле |
| 3.5 | MW-004 (пересмотр) | Ввести **единый** `MYWORK_DATABASE_MIGRATIONS` (конкатенация всех списков в одном месте) и запретить открывать store без него; сейчас каждый пакет документирует свою конкатенацию в JSDoc | Пять списков, склеиваемых вручную, — источник «забыл v5» при живом пользователе | тест «opening with the canonical list reaches the newest version» + проверка, что ни один пакет не экспортирует «открыть без списка» |
| 3.6 | MW-040 (пересмотр, добавить в зависимости MW-058) | Добавить в scope политику роста: retention `outbox`/`inbox_dedup`, `VACUUM`/`incremental_vacuum`, размер `artifacts.bytes` | В коде нет ни одного `DELETE`/`VACUUM` по `outbox`/`inbox_dedup`; артефакты лежат BLOB'ами в базе | тест «an outbox older than the retention window is pruned and the delivered row count stays bounded» |
| 3.7 | MW-041 (пересмотр) | Приёмку упаковки зафиксировать на **измеренном** результате: `node scripts/verify-profile.mjs` = PASS при доступном pnpm; и отдельно — «`pnpm run check` проходит в чистом shell» как обязательное условие | `pnpm run build/typecheck/test/check` в этой среде падают (`EXIT=1`) из-за сломанного глобального pnpm; сейчас это не gate, а удача | `pnpm run check` → `EXIT=0` в чистом `pwsh` без обходов |
| 3.8 | `scripts/pack.mjs` (мелкая правка) | (а) `pnpmLaunch()` не должен уходить в `shell:true` + `pnpm`, если `npm_execpath` указывает на существующий `.mjs`/`.cjs`; (б) перед `pnpm pack` удалять/игнорировать посторонние `*.tgz` | Замер: `node scripts/pack.mjs` → `EXIT=1`; повторный `packController` при оставшемся tarball → `Error: … found []` | `pnpm run pack:local` дважды подряд → `EXIT=0` и ровно один tarball |
| 3.9 | MW-034 (пересмотр, поднять приоритет) | Добавить в scope **экспорт** уже существующего `correlationId`/`causation_id` в OTel-спан (в профиле есть `dsh-session-telemetry-otel`) и счётчики расхода | correlation ID спроектирован (90 вхождений, `outbox.correlation_id NOT NULL`), но экспортёра нет; стоимость неизвестна by design (`BudgetAmount = known \| unknown`) | тест «one attempt produces one span parented by the attempt correlation id» |
| 3.10 | `INDEX.md` / `tasks.json` и правило в `.work/README.md` | Сделать INDEX.md **производным** от леджера доски (или явно объявить read-only артефактом регенерации с полем `lastSyncedRevision`), и вынести `superseded`-карточки из backlog | Сейчас 53 карточки `planned` против 19 `done` и 2 `failed`; MW-027/MW-035 могут быть запущены | `node .tmp/gen-cards.mjs`-валидатор + сверка `planRevision` и `revision` доски в отчёте |
| 3.11 | Новый gate в `.work/README.md` | Правило «карточка не переводится в `done`, если хотя бы одно её исполнение имело `result: failed`, без явной записи причины в отчёте» | 9 упавших прогонов на карточках в `done` (MW-003…MW-008 по `workspace not found`, MW-002 дважды из-за `preset "standard"`) | сверка `executions[].result` по каждой `done`-карточке |

---

## 4. Новое, чего не было в документе и в плане

### 4.1. Приоритизированные точки оптимизации

**P1. Windows-путь `bd` не работает вообще (блокер MW-010/011).**
- *Проблема:* адаптер запускает `spawn('bd', …, {shell:false})`, а на Windows `bd` — шим без `.exe`; любая команда заканчивается `ENOENT`.
- *Доказательство:* `packages\beads-adapter\src\runner.ts:96,102-108`; замер `node .tmp-audit\bd-probe.mjs` → `spawnSync("bd", …, shell:false): status=null error=ENOENT errno=-4058`; `shell:true` → `status=0`, `bd version 1.3.0`; при включённой пробе без патча раннера — 15 падений с `ADAPTER_UNAVAILABLE`.
- *Действие:* резолвить backend один раз (JS-entry через `process.execPath` на win32; `binary` + `argsPrefix` в конфиге строки) и переиспользовать в пробе, раннере и Doctor.
- *Усилие:* S. *Риск:* низкий — поведение на POSIX не меняется, если оставить `binary='bd'` по умолчанию. *Как проверить:* `node --test tests/beads-adapter.test.mjs` → `pass 70 / fail 0 / skipped 0`.

**P2. 23 «зелёных» пропуска маскируют отсутствие проверки backend.**
- *Проблема:* skip-механизм сообщает о недоступности `bd` по неверной причине и не отличает «нет бинаря» от «не смогли запустить».
- *Доказательство:* `tests\beads-adapter.test.mjs:57-73` (текст причины про EPERM) против замера ENOENT; `Select-String '# SKIP'` → 23 строки в зелёном прогоне (`EXIT=0`).
- *Действие:* заменить пробу на реальный seam; ввести `BEADS_REQUIRE_REAL=1`, при котором skip становится падением.
- *Усилие:* S. *Риск:* низкий. *Как проверить:* в CI-профиле `skipped 0`.

**P3. Две объявленные capability опровергнуты живым `bd`.**
- *Проблема:* `batch-dep-remove` (нет ребра после batch) и `heartbeat` (exit 1). На `batch-dep-remove` стоит staged plan MW-011/ADR024.
- *Доказательство:* `beads-runnerfix.log` — `AssertionError: the added edge must be present` (`tests\beads-adapter.test.mjs:1161`), `bd heartbeat mw-kmk failed (exit 1)` (`…:1353`); манифест `adapter.ts:87-98`.
- *Действие:* либо исправить вызовы (порядок/форма `bd batch`, флаги `heartbeat`), либо честно опустить флаги и включить staged fallback.
- *Усилие:* M. *Риск:* средний — смена capability меняет поведение планировщика мутаций. *Как проверить:* два теста PASS при неизменном манифесте **или** манифест + документ ADR024 согласованно изменены.

**P4. 31,7 % исходных строк не подключены к runtime.**
- *Проблема:* `packages/controller` импортирует только `adapter-sdk`, `contracts`, `core`; storage/lease/evidence/planner/execution/scheduler/beads-adapter/memory-native не достигаются ниоткуда.
- *Доказательство:* `graph.mjs` → `NOT reachable: beads-adapter, evidence, execution, lease, memory-native, planner, scheduler, storage`; `controller\src\index.ts:47-48,115-128`; ни одной `*.sqlite` под `C:\Users\Dmitry\.dsh`.
- *Действие:* composition root (см. 3.4) как одна карточка с одним smoke-шагом.
- *Усилие:* L. *Риск:* высокий — первое реальное соединение пяти подсистем. *Как проверить:* smoke открывает store на версии 6 и монтирует сервисы в изолированном `DSH_HOME`.

**P5. `MYWORK_SCHEMA_VERSION = 1` не описывает базу.**
- *Проблема:* пять независимых списков миграций, склеиваемых вызывающим; композиция живёт только в тестах.
- *Доказательство:* `storage\src\migrations.ts:91-94`; `Select-String 'MYWORK_MIGRATIONS'` — 15 попаданий в тестах, 6 в JSDoc, 0 исполняемых в `packages`; максимум v6.
- *Действие:* единый `MYWORK_DATABASE_MIGRATIONS`.
- *Усилие:* S. *Риск:* низкий. *Как проверить:* тест «canonical list reaches v6; ни один пакет не открывает store без списка».

**P6. Нет ни одного ограничителя роста базы.**
- *Проблема:* `outbox`, `inbox_dedup`, `audit_events`, `artifacts.bytes` растут монотонно; чистки нет.
- *Доказательство:* `storage\src\migrations.ts:53-80`, `evidence\src\schema.ts:47-100`; в `packages/**/src` нет `DELETE FROM outbox`/`VACUUM`.
- *Действие:* retention + `VACUUM` в MW-040 + метрика размера.
- *Усилие:* M. *Риск:* средний (потеря недоставленных событий при неверной политике). *Как проверить:* тест «delivered rows older than T are pruned, pending rows are kept».

**P7. Ноль наблюдаемости при готовом correlation ID.**
- *Проблема:* нет метрик, спанов, счётчиков расхода; есть только `process.stderr` при `diagnostics: true`.
- *Доказательство:* 0 вхождений `otel|opentelemetry|telemetry|prometheus|traceparent`; `correlationId` 90 / `correlation_id` 24; `controller\src\index.ts:184-187`.
- *Действие:* MW-034: экспорт в OTel (профиль уже содержит `dsh-session-telemetry-otel`) + счётчики бюджета.
- *Усилие:* M. *Риск:* низкий (аддитивно). *Как проверить:* один attempt → один span с `correlationId` в атрибутах.

**P8. Три леджера одного плана.**
- *Проблема:* `INDEX.md`/`tasks.json` показывают 53 `planned` против 19 `done`/2 `failed` на доске; `superseded`-карточки лежат в backlog.
- *Доказательство:* экстрактор `ledgers.mjs`; `status counts {"failed":2,"backlog":34,"done":19}`, `revision 324`.
- *Действие:* INDEX.md — производный артефакт с `lastSyncedRevision`; `superseded` архивировать из backlog.
- *Усилие:* S. *Риск:* низкий. *Как проверить:* сверка `done`-множества INDEX.md и доски — расхождение 0.

**P9. «done» на доске не означает успешный прогон.**
- *Проблема:* 11 упавших исполнений на 22 карточках; 9 из них — на карточках в `done`.
- *Доказательство:* `executions[].result` → `{"succeeded":20,"failed":11}`; причины `workspace not found` ×7 (MW-003…MW-008, MW-043), `preset "standard" failed to mount` ×2 (MW-002).
- *Действие:* правило приёмки 3.11 + починить/зафиксировать `workspaceId 3fc33afb-…` (7 падений) и preset `standard` (24 неразрешимых строки плагинов).
- *Усилие:* S (правило) / M (preset). *Риск:* низкий. *Как проверить:* ни одна `done`-карточка не имеет `result: failed` без строки-обоснования в отчёте.

**P10. Публикация невозможна by construction.**
- *Проблема:* `private: true` у всех 12 пакетов, включая упаковываемый bundle; в tarball остаются `devDependencies` на `@dsh-mywork/*@0.1.0`, которых нет в registry; `engines` у пакетов нет.
- *Доказательство:* разбор 12 `package.json`; распакованный манифест tarball (225 651 байт) сохраняет `"private": true`.
- *Действие:* решить судьбу распространения (tarball/vendored vs registry) и, если registry — снять `private` только у `controller`, добавить `engines` и `publishConfig`.
- *Усилие:* S. *Риск:* низкий. *Как проверить:* `npm pack --dry-run` + документированный способ установки в чистом профиле.

**P11. Нет CI и нет ни одного релизного тега.**
- *Проблема:* `.github` отсутствует; 0 тегов; 12 пакетов на `0.1.0`.
- *Доказательство:* `Test-Path .github` → `False`; `git tag | Measure-Object` → 0; `git ls-files` → 191 файл, 0 workflow.
- *Действие:* минимальный workflow: `pnpm install --frozen-lockfile` → `tsc` по 12 пакетам → `tsdown` → `smoke` → `node --test` → `verify-profile.mjs`; тег `v0.1.0-m1` на первом зелёном прогоне.
- *Усилие:* S. *Риск:* низкий. *Как проверить:* первый зелёный прогон на push.

**P12. Документированный вход `pnpm` и слой запуска сломаны.**
- *Проблема:* `pnpm run build|typecheck|test|check` → `EXIT=1` из-за сломанного глобального `pnpm` 12.4.2; `scripts/lib/process.mjs:52-58` уходит в `shell:true`+`pnpm`, потому что `npm_execpath` оканчивается на `.exe`; `packController` не идемпотентен.
- *Доказательство:* три `EXIT=1`; `node scripts/pack.mjs` → `EXIT=1`; повторный pack → `found []`.
- *Действие:* 3.8 + записать в README проверенный способ bootstrap (путь к рабочему `pnpm`, `npm_execpath` для скриптов).
- *Усилие:* S. *Риск:* низкий. *Как проверить:* `pnpm run check` в чистом shell → `EXIT=0`; `pack:local` дважды подряд → `EXIT=0`.

**P13. Рабочий каталог раздут в 6 раз относительно кода.**
- *Проблема:* `.tmp` 3751 файл / 175,11 МБ против `packages` 17,72 МБ; внутри — `*.bak`, ~120 mutation-скриптов, и **зарегистрированный worktree `.tmp/mw012-review`**; `.pnpm-store` 72,3 МБ; `DSH-MyWork.rar` 41,4 МиБ в корне.
- *Доказательство:* `Measure-Object -Property Length -Sum`; `git worktree list` (3 записи, одна — `.tmp/mw012-review`); `Get-Item DSH-MyWork.rar` → 43 410 533 байта.
- *Действие:* политика `.tmp` (cleanup после карточки, `git worktree remove`), `store-dir` вне репозитория, `.rar` — во внешнее хранилище.
- *Усилие:* S. *Риск:* низкий (всё в `.gitignore`, git не затронут). *Как проверить:* `.tmp` < 20 МБ, `git worktree list` → 1 запись.

**P14. 710 тестов идут в одном процессе без изоляции.**
- *Проблема:* `package.json:16` — `node --test --test-isolation=none`; при 32 файлах, которые пишут во временные SQLite и подменяют `process.stderr`, любой протёкший глобальный стейт проявится как флак, а не как падение файла.
- *Доказательство:* `package.json:16`; `Get-Content tests\*.mjs` — 8 файлов используют `node:os` temp-каталоги, `scripts\smoke.mjs:66-79` подменяет `process.stderr.write`.
- *Действие:* оставить `none` для скорости, но добавить второй прогон `--test-isolation=process` в CI как gate.
- *Усилие:* S. *Риск:* низкий. *Как проверить:* оба прогона дают `fail 0`.

**P15. Одно коллизионное экспортируемое имя между `contracts` и `core`.**
- *Проблема:* `TaskTransitionCommand` — два разных интерфейса под одним именем в двух пакетах, импортируемых одним и тем же `beads-adapter`.
- *Доказательство:* `contracts\src\taskgraph.ts` (`id, to, meta, expectedRevision?, assignee?`) против `core\src\task.ts` (`to, expectedRevision?, activeAttemptId?, at`); `dups.mjs` → `shared names: 1`.
- *Действие:* переименовать доменный в `TaskStateTransition` (или портовый в `TaskGraphTransitionCommand`).
- *Усилие:* S. *Риск:* низкий (механическое переименование, tsc поймает). *Как проверить:* `dups.mjs` → `shared names: 0`; typecheck 12/12.

**P16. Точка роста метрики «строки кода» в брифинге.**
- *Проблема:* цифра 125 383 получается только при включении `packages/*/lib` (build output, gitignored).
- *Доказательство:* без `lib` — 161 файл / 55 481 строка; с `lib` — 196 / 126 520; `packages/*/src` — 111 / 36 674.
- *Действие:* во всех отчётах использовать «111 файлов / 36 674 строки src» и «32 тест-файла / 17 449 строк», отдельно указывая размер bundle (159 файлов `lib`, 444 279 строк с `.map`).
- *Усилие:* S. *Риск:* нулевой. *Как проверить:* команда из §1 строка 14/15 воспроизводится.

### 4.2. Что из найденного усиливает позиции документа

- **`verify:profile` — реально работающий end-to-end gate.** `node scripts/verify-profile.mjs` → `EXIT=0`, `verify:profile: PASS`, 10,5 с, изолированный `DSH_HOME`, «user profile untouched (3 fingerprint(s) unchanged)», в выводе обе строки `dsh-mywork: controller mounted/stopped … version=0.1.0 contexts=control`. Это подтверждает §24 документа (один bundle, несколько packages) и §33 (peer `@deepseek-ai/cordis` достаточен для монтирования). Требуется лишь рабочий `pnpm`.
- **Peer-декларации ровно те, что нужны.** Единственный peer — `@deepseek-ai/cordis ^4.0.2`; `@deepseek-ai/dsh*`-пиров нет, поэтому compat-gate DSH (§33) не может отказать, но и не может защитить: подтверждаю риск, названный в документе, но с важным уточнением — **сейчас он не срабатывает, а не «срабатывает неправильно»**.
- **Fail-closed последователен на всём Beads-слое.** `requireCapability` до вызова, `ADAPTER_UNAVAILABLE` с точной командой инициализации, `classifyBeadsFailure`, отдельные `BD_EXIT_GUARD_FAILED=13`/`BD_EXIT_PANIC=2` — это подтверждает §39-идею (типизированные отказы вместо shell) и ADR023.
- **Иммутабельность evidence проверена против `INSERT OR REPLACE`.** `evidence\src\schema.ts:114-126` добавляет `BEFORE INSERT`-триггеры именно потому, что при `recursive_triggers = 0` REPLACE не поднимает delete-триггеры. Это редкая по аккуратности защита и она подтверждена тестами.

### 4.3. Сводная оценка зрелости по измерениям

| Свойство | Измеренное значение | Оценка |
|---|---|---|
| Типизация | 12/12 пакетов `tsc --noEmit` без ошибок, `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` (`tsconfig.base.json`) | **сильно** |
| Тесты | 710 тестов, 687 pass, **0 fail**, 23 skip, 87,6 с | **сильно**, кроме Beads-слоя |
| Smoke / bundle | smoke 13/13 (0,2 с); `verify:profile: PASS` (10,5 с); tarball 225 651 байт монтируется в изолированном профиле | **сильно** |
| Незавершённость в коде | 0 TODO/FIXME, 0 пустых `catch`, 3 пояснительных «not implemented» | **сильно** |
| Достижимость кода из runtime | 4 из 12 пакетов; 11 619 / 36 674 строк `src` (31,7 %) недостижимы | **слабо** |
| Персистентность | 6 версий миграций, WAL fail-closed, mutation+outbox в одной транзакции, inbox dedup — но ни одной живой базы и ни одной runtime-композиции | **механика сильно, подключение отсутствует** |
| Реальный backend (Beads) | 23 теста skip; при включении 15 fail → 2 fail после фикса раннера | **опровергнуто в двух capability** |
| Наблюдаемость | 0 метрик/спанов; correlation ID системный (90+24 вхождения) | **задел есть, экспорта нет** |
| Стоимость | счётчиков нет; `BudgetAmount = known \| unknown` by design | **не измеряется** |
| Секреты | 0 реальных утечек, 5 синтетических фикстур, 0 в `.work` | **чисто**, но без автоматического gate |
| Публикация | `private: true` ×12, 0 тегов, 0 CI | **отсутствует** |
| Воспроизводимость входа | `pnpm run *` падает (exit 1) в чистом shell; сборка/тесты воспроизводятся только прямыми вызовами `tsc`/`tsdown`/`node` | **слабо** |
| Целостность плана | 55 карточек в трёх леджерах, статусы согласованы только по количеству | **слабо** |

**Короткий вывод.** Репозиторий — это не «сырой прототип»: типизация, тесты, типизированные отказы, fail-closed storage и работающий install-gate находятся на уровне, который редко встречается на стадии 22/55 карточек. Но два измерения меняют картину радикально: **почти треть исходного кода не имеет ни одной runtime-точки входа** (F-17/F-18), и **единственный внешний backend не проверяется и не работает на целевой платформе** (F-11/F-12/F-13). Оба дефекта дешёвы в исправлении (S/M) и оба сегодня не видны ни одному зелёному прогону — именно поэтому они и оказались незамеченными.

---

## 5. Открытые вопросы и что я НЕ проверял



1. **Не запускал `verify-profile.mjs` на живом профиле** — только изолированный `DSH_HOME` (скрипт сам это гарантирует и хэширует 3 файла реального профиля; они не изменились). Установка `@dsh-mywork/controller` в живой профиль не выполнялась.
2. **Не запускал `pnpm run check` целиком** — из-за сломанного `pnpm` (см. §2.7); вместо него измерены его четыре шага по отдельности (tsc ×12, tsdown ×12, smoke, node --test). Эквивалентность последовательности не доказана: `check` вызывает `pnpm -r`, который может дать другой порядок сборки.
3. **Патчи в worktree не являются предложенным production-фиксом.** Я патчил `tests\beads-adapter.test.mjs` (проба и `bd()`) и `packages\beads-adapter\src\runner.ts` (win32 shim) в **изолированной копии**; оригиналы сохранены как `*.orig`. Решение о правильной форме фикса — за владельцем; я измерил только эффект.
4. **Не устанавливал, почему `pnpm-lock.yaml` был dirty на момент среза и чист на момент моего измерения.** mtime 2026-09-26 22:10:16; `git status` пуст. Возможные причины (чужой прогон `pnpm install` в живом дереве, откат, синхронизация) не проверялись. Живое дерево я не менял (CLAIM F-28).
5. **Не проверял поведение на Linux/macOS.** Вывод про `ENOENT` получен на Windows; на POSIX `bd` — исполняемый скрипт с shebang, и там `shell:false` должен работать. Проверка двух capability (`batch-dep-remove`, `heartbeat`) тоже сделана на Windows и **может** отличаться на другой платформе — это первый вопрос к P3.
6. **Не проверял `bd init`/Dolt-remote, `bd serve`, `bd events journal`.** Пункты EXECUTION-PLAN про недоступный Dolt-remote и панику `bd init` (exit 2) я не воспроизводил.
7. **Не измерял рост базы во времени** — базы не существует ни на одной машине (проверено). Утверждения о росте в §2.5 выведены из DDL и отсутствия чистки, а не из наблюдения.
8. **Не проверял содержимое `.analysis/` (33 файла, 0,49 МБ)** и `.dsh/skills/` — вне зоны потока.
9. **Не проверял `tests/lib/*-child.mjs`** (3 файла: `claim-crash-child`, `crash-child`, `mw019-restart-child`) на предмет того, действительно ли crash-сценарии воспроизводят падение процесса, а не эмулируют его; тесты, которые их вызывают, зелёные.
10. **Не проверял provider/LLM-вызовы и стоимость.** Live-проб не делал; «сколько потрачено» не измерено, потому что механизма учёта в коде нет (§2.8).
11. **Не оценивал качество архитектуры** — это зона потоков A/B/C; я ограничился измеримыми фактами о коде и прогонах.
12. **Не проверял `dsh-task-board` плагин как таковой** — читал только `ledger-v2.json` экстрактором, без загрузки в контекст и без записи.

---

## 6. CLAIMS

| ID | Утверждение | Доказательство | Статус |
|---|---|---|---|
| F-01 | Полный тест-набор MyWork проходит: 710 тестов, 687 pass, 0 fail, 23 skip, 87 615 мс, exit 0. | `node --test --test-isolation=none --test-reporter=spec "tests/**/*.test.mjs"` в `.tmp\f-audit` → `EXIT=0`; блок `ℹ tests 710 / pass 687 / fail 0 / skipped 23 / duration_ms 87615.2611` | verified |
| F-02 | Тесты требуют предварительной сборки: `tests\lib\fixtures.mjs:39-72` импортирует `packages/*/lib/*.js`. | `Select-String 'import' tests\lib\fixtures.mjs` → `entries.* = 'packages/…/lib/index.js'`; без сборки `smoke.mjs:30-35` завершается `EXIT=1` | verified |
| F-03 | Typecheck проходит во всех 12 пакетах: 12× ok, 0 падений, 20 с. | `tsc --noEmit -p tsconfig.json` в каждом `packages\*` → `TYPECHECK_FAILED_PACKAGES=0`, `EXIT=0` | verified |
| F-04 | Сборка проходит во всех 12 пакетах: 12× ok, 204,7 с. | `tsdown` в порядке зависимостей → `BUILD_FAILED=0`, `EXIT=0` | verified |
| F-05 | Smoke: 13 шагов, все ok, exit 0, 0,2 с. | `node scripts/smoke.mjs` → `smoke: all steps passed`, `SMOKE_EXIT=0` | verified |
| F-06 | Документированные команды `pnpm run build/typecheck/test` падают с exit 1 из-за сломанного глобального pnpm 12.4.2. | `pnpm --version`, `pnpm run build`, `pnpm run typecheck` → трижды `EXIT=1`, stderr `'"H:\.pnpm-store\v11\links\@\pnpm\12.4.2\…\node_modules\pnpm\pnpm"' is not recognized…` | verified |
| F-07 | `bd` 1.3.0 установлен и работает в shell (exit 0). | `bd version` → `EXIT=0`, `bd version 1.3.0 (f45b249ce: HEAD@f45b249ce6b4)` | verified |
| F-08 | 23 теста реального Beads-backend пропускаются, хотя `bd` доступен. | `tests\beads-adapter.test.mjs:57-73`; 23 строки `# SKIP` в логе полного прогона; stderr «the real-bd contract checks are SKIPPED … These are not passes.» | verified |
| F-09 | Причина пропуска — не EPERM/песочница, а ENOENT резолвинга Windows-шима при `shell:false`. | `node .tmp-audit\bd-probe.mjs` → `spawnSync("bd", ["version"], {shell:false}): status=null error=ENOENT errno=-4058`; `bd.cmd` → `EINVAL errno=-4071`; `shell:true` → `status=0`, `bd version 1.3.0` | verified |
| F-10 | Комментарий в тесте приписывает пропуск DSH file sandbox (EPERM), то есть объяснение неверно. | `tests\beads-adapter.test.mjs:65-71` (текст про EPERM) против замера F-09 | verified |
| F-11 | Раннер адаптера использует тот же негодный способ запуска, поэтому Beads-путь на Windows неработоспособен. | `packages\beads-adapter\src\runner.ts:96` (`binary ?? 'bd'`) и `:102-108` (`shell:false`) | verified |
| F-12 | При включённой пробе, но без патча раннера — 15 падений из 70, все `ADAPTER_UNAVAILABLE`. | патч `bdAvailable()`+`bd()` в копии worktree; `node --test tests/beads-adapter.test.mjs` → `EXIT=1`, `tests 70 / pass 55 / fail 15 / skipped 0`, все с `code: 'ADAPTER_UNAVAILABLE'` | verified |
| F-13 | С патчем раннера остаётся 2 реальных падения против `bd` 1.3.0. | патч `runner.ts` + `tsdown` (exit 0, 39,6 с) → `tests 70 / pass 68 / fail 2 / skipped 0`, 280 532 мс | verified |
| F-14 | `bd batch` с dep add и dep remove в одной транзакции не оставляет добавленного ребра. | `AssertionError: the added edge must be present` на `tests\beads-adapter.test.mjs:1161` | verified |
| F-15 | `bd heartbeat <id>` возвращает exit 1, хотя capability `heartbeat` объявлена `true`. | `a heartbeat refreshes a held claim and reclaim reverts a stale one (real bd)` → `dsh-mywork: bd heartbeat mw-kmk failed (exit 1)` (`tests\beads-adapter.test.mjs:1353`); манифест `adapter.ts:96` | verified |
| F-16 | Capability-манифест статически соответствует коду: 10 ключей, 8 true / 2 false, каждая true-capability имеет свою команду `bd`. | `packages\beads-adapter\src\adapter.ts:87-98,112`; вызовы `adapter.ts:498,586,602,641,860,889,946` | verified |
| F-17 | 8 из 12 пакетов недостижимы из единственного монтируемого entry point. | `graph.mjs`: `NOT reachable: beads-adapter, evidence, execution, lease, memory-native, planner, scheduler, storage`; `controller\src\index.ts:47-48,115-128` | verified |
| F-18 | Недостижимые 8 пакетов — это 11 619 из 36 674 строк `src` (31,7 %). | суммы `Measure-Object -Line` по `packages/*/src/*.ts`: 3118+1102+1945+831+454+2534+425+1210 = 11 619; всего 36 674 | verified |
| F-19 | Ни одной рабочей базы MyWork не существует: под `C:\Users\Dmitry\.dsh` нет ни `dsh-mywork`, ни `*.sqlite*`. | `Test-Path C:\Users\Dmitry\.dsh\dsh-mywork` → `False`; `Get-ChildItem … -Filter '*.sqlite*' -Recurse` → пусто | verified |
| F-20 | Миграции: kernel v1, evidence v2/v3, lease v4, planner v5, execution v6; максимум `user_version = 6`. | `storage\src\migrations.ts:49-94`, `evidence\src\schema.ts:26,138-153`, `lease\src\schema.ts:22,66`, `planner\src\schema.ts:36,148`, `execution\src\schema.ts:48,153` | verified |
| F-21 | Композиция списка миграций существует только в тестах и JSDoc, runtime-сайта нет. | `Select-String 'MYWORK_MIGRATIONS'` → 15 попаданий в `tests\*.test.mjs`, 6 в JSDoc `packages`, 0 исполняемых | verified |
| F-22 | WAL обязателен и проверяется обратным чтением, отказ — `StorageError` (fail-closed). | `storage\src\sql.ts:127-140`; тесты storage про WAL и версии — PASS в прогоне F-01 | verified |
| F-23 | 13 из 15 таблиц объявлены вне kernel-миграций (evidence 2, execution 4, lease 1, planner 6). | `Select-String 'CREATE TABLE'` по `packages/**/src` → 15 сайтов, 2 в `storage\src\migrations.ts` | verified |
| F-24 | Чистка есть только для «рабочих» таблиц: три исполняемых `DELETE FROM` (`claim_step`, `controller_lease`, `plan_mutation_step`); `DELETE FROM outbox`/`inbox_dedup`/`audit_events` и `VACUUM` отсутствуют. | `Select-String 'VACUUM\|DELETE FROM\|retention\|prune'` по 123 `src/*.ts` → 37 совпадений, исполняемых `DELETE FROM` — 3 (`execution\src\store.ts:259`, `lease\src\lease.ts:256`, `planner\src\store.ts:312`); `VACUUM` — 0 | verified |
| F-25 | Секретов в исходниках, тестах и `.work` нет: 5 совпадений — синтетические фикстуры тестов защиты. | regex-скан; `tests\security.test.mjs:352-359`, `tests\evidence.test.mjs:290`; 0 совпадений по `.work/**` | verified |
| F-26 | Метрик и OTel-экспорта нет: 0 вхождений `otel|opentelemetry|telemetry|prometheus|traceparent`. | `Select-String` по 123 `packages/**/src/*.ts`; `metric` — 1 несвязанный комментарий `core\src\board.ts:243` | verified |
| F-27 | Correlation ID присутствует системно (90 вхождений `correlationId`, 24 `correlation_id`, `outbox.correlation_id NOT NULL`). | `Select-String`; `storage\src\migrations.ts:59`; `evidence\src\schema.ts:80` | verified |
| F-28 | Живое дерево MyWork на момент моих измерений чистое; я его не изменял. | `git -C H:\Repo\DSH-MyWork status --porcelain=v1 -uall` → пусто, `EXIT=0`; `git diff --stat` → пусто; все мои записи — в `.tmp\f-audit` и `.work\analysis\2026-09-26\F-gaps.md` | verified |
| F-29 | Живой леджер доски содержит 55 карточек: `backlog 34`, `done 19`, `failed 2`, `revision 324`; `archivedAt` у 3 (MW-001, MW-027, MW-035). | `ledgers.mjs`/`ledger2.mjs` по `C:\Users\Dmitry\.dsh\task-board\ledger-v2.json` (275 049 байт) | verified |
| F-30 | `INDEX.md` и `tasks.json` содержат 55 карточек со статусами `planned 53` + `superseded 2` и не отражают ни одного исполнения. | `ledgers.mjs`: `INDEX.md rows: 55`, `{"planned":53,"superseded → …":2}`; `tasks.json tasks: 55`, `{"planned":53,"superseded":2}` | verified |
| F-31 | Поля `permissionPending` в леджере доски не существует; схема карточки — `permission` + `permissionConfirmedAt` + `archivedAt`. | `ledger-detail.mjs`: `card keys: id, title, description, prompt, status, createdAt, updatedAt, executions, workspaceId, permission, model, tags, permissionConfirmedAt, archivedAt`; `permissionConfirmedAt` выставлен у 22 карточек | verified |
| F-32 | На 22 исполнявшихся карточках 31 исполнение: 20 succeeded, 11 failed; упавшие прогоны есть и у карточек в `done`. | `ledger2.mjs`: `execution result counts: {"succeeded":20,"failed":11}`, `executions total: 31`, `cards with >=1 execution: 22`, при `status counts {"failed":2,…,"done":19}` | verified |
| F-33 | Причины 11 упавших исполнений: `workspace not found` ×7 (MW-003…MW-008, MW-043), `agent turn ended with an error` ×2 (MW-001, MW-016), `agent-presets: preset "standard" failed to mount` ×2 (MW-002). | `ledger-detail.mjs`, блок «failed executions» | verified |
| F-34 | Ни один пакет не объявляет `dependencies`; единственная внешняя runtime-зависимость — peer `@deepseek-ai/cordis ^4.0.2` у controller. | разбор 12 `packages\*\package.json`; `packages\controller\tsdown.config.ts` (`alwaysBundle`/`neverBundle`) | verified |
| F-35 | Публикация невозможна: `private: true` у всех 12 пакетов, включая упакованный bundle. | разбор 12 манифестов; распакованный манифест tarball содержит `"private": true` | verified |
| F-36 | Loop приёмки упаковки проходит end-to-end при рабочем pnpm: `verify:profile: PASS`, exit 0, 10,5 с, реальный профиль не изменён. | `node scripts/verify-profile.mjs` с `npm_execpath=<…>\pnpm\bin\pnpm.mjs` → `EXIT=0`, `verify:profile: PASS`, `ok user profile untouched (3 fingerprint(s) unchanged)` | verified |
| F-37 | `node scripts/pack.mjs` падает с exit 1 в этой среде; `packController` не идемпотентен при оставшемся `*.tgz`. | `node scripts/pack.mjs` → `EXIT=1` (`pack: pnpm pack exited with code 1`); повторный вызов → `Error: pack: expected exactly one new tarball … found []` (`scripts\pack.mjs:44-47`) | verified |
| F-38 | Bundle пакуется корректно: 225 651 байт, содержимое `cordis.patch.yml` + `lib/{index.js,index.d.ts,index.js.map,index.d.ts.map}` + `package.json` + `LICENSE`. | `pnpm pack` в `packages\controller` → `EXIT=0`; `tar -tzf` → 7 записей | verified |
| F-39 | В репозитории 0 маркеров TODO/FIXME/HACK/XXX и 0 пустых `catch {}`; 3 вхождения «not implemented» — пояснения, не заглушки. | `Select-String` по 123 `packages/**/src/*.ts` и по `tests/*.mjs` | verified |
| F-40 | CI отсутствует: `.github` нет, ни одного workflow среди 191 отслеживаемого файла, 0 тегов, одна ветка `main`. | `Test-Path .github` → `False`; `git ls-files` → 191 файл (0 `.yml` workflow); `git tag` → 0; `git branch -a` → `main` + `origin/*` | verified |
| F-41 | Объём исходников: 111 файлов `packages/*/src` = 36 674 строки; 161 файл без `lib` = 55 481 строка; 196 файлов с `lib` = 126 520 строк; tests 32 файла / 17 449 строк. | `Get-ChildItem … -Include *.ts,*.mjs,*.js` + `Measure-Object -Line` (три фильтра); цифра брифинга 125 383 воспроизводится только с `packages/*/lib` | verified |
| F-42 | Между `contracts` и `core` ровно одно коллизионное экспортируемое имя — `TaskTransitionCommand`, и это два разных интерфейса. | `dups.mjs`: `contracts 648`, `core 255`, `shared names: 1`; сравнение `contracts\src\taskgraph.ts` и `core\src\task.ts` | verified |
| F-43 | Рабочий каталог содержит `.tmp` 3751 файл / 175,11 МБ, `.pnpm-store` 72,3 МБ и `DSH-MyWork.rar` 43 410 533 байта. | `Measure-Object -Property Length -Sum` по `.tmp`, `.pnpm-store`, `node_modules`, `packages`; `Get-Item DSH-MyWork.rar` | verified |
| F-44 | В списке worktree числится посторонний worktree `.tmp/mw012-review` (detached HEAD `f22dbc3`). | `git -C H:\Repo\DSH-MyWork worktree list` → три записи, включая `H:/Repo/DSH-MyWork/.tmp/mw012-review f22dbc3 (detached HEAD)` | verified |
| F-45 | Тест-набор запускается с `--test-isolation=none`, то есть все 710 тестов идут в одном процессе. | `package.json:16` — `"test": "node --test --test-isolation=none \"tests/**/*.test.mjs\""` | verified |
| F-46 | Рабочие материалы плана не версионируются: `.work/**` не отслеживается git, единственный `.md` в индексе — `README.md`. | `git ls-files '.work'` → 0 файлов; `git ls-files '*.md'` → `README.md` | verified |
| F-47 | Карточки MW-027 и MW-035 (`superseded`, «не запускать») физически находятся в колонке `backlog` живой доски. | `ledgers.mjs` по `ledger-v2.json`: MW-027 и MW-035 → `backlog`, `archivedAt` выставлен | verified |
| F-48 | Ни одного исполнения у MW-021…MW-041 и MW-044…MW-055 нет — на доске это ровно 34 backlog-карточки, и у них нет `permissionConfirmedAt`. | `ledger2.mjs`: `permissionConfirmedAt set: 22` при 55 карточках; `ledgers.mjs`: 34 карточки в `backlog` с `runs=0` | verified |
| F-49 | Прямых символов реализации нет для MW-023 (`verificationGate`), MW-025 (`IntegratorPort`), MW-045 (`workType`/`finishCriteria`), MW-034 (OTel/metrics), MW-040 (export/import/repair); `TaskSetter` в `src` отсутствует. | `Select-String` по `packages/**` + `tests/**`: `verificationGate` 0, `IntegratorPort` 0, `workType` 0, `finishCriteria` 0, `otel` 0, `telemetry` 0; `TaskSetter` — 0 в `src`, 167 в тестах (локальный алиас `planner`); `migrations.ts:9-11` прямо относит export/import/repair к MW-040 | verified |
| F-50 | Учёт расхода токенов/денег в коде отсутствует; бюджет спроектирован как «known или unknown». | `tokenCount`/`costUsd`/`tokensUsed`/`estimatedCost` — 0 совпадений; `contracts\src\budget.ts:13,39-40` | verified |

