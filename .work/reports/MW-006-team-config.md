# MW-006 — Реализовать конфигурацию, Team и неизменяемые revisions

- Предмет: карточка доски `03c9e1e0-52d3-4f59-a4b5-ace94245a459` (MW-006), этап `00-foundation`, обязательные пункты §62 — 4, 5, 6, 29
- Исполнитель: сессия DSH Web, модель `opencode-go/deepseek-v4.1-flash`
- Репозиторий: `H:\Repo\DSH-MyWork`, base SHA `829ec627914cfe88330f92f01738edf6bac7c72b` (HEAD на старте, дерево чистое), head `fbee7a0b1d0703b5b2bdd581c05e81c3c19a2f7e`
  - 4 коммита этой карточки поверх `829ec62` (ветка `main`): `2bbb5d9`, `962f696`, `352e378`, `fbee7a0`; push/merge/rebase/publish не выполнялись (см. §9)
- Окружение: Node `v24.19.0`, pnpm `12.4.2`, DSH `0.1.5-rc.2`; Windows, pwsh
- Статус: **DONE** — конфигурация/Team/revisions реализованы в `contracts` и `core`; `pnpm run check` = exit 0, 112 pass / 0 fail, smoke 12 `ok`; независимое ревью выполнено отдельным субагентом (**PASS WITH FINDINGS**, 2 MAJOR / 3 MINOR / 2 NIT), все замечания исправлены и покрыты тестами (§8). Статус переведён из `READY_FOR_REVIEW` в `DONE` по прямому указанию владельца (сессия MW-020); акт приёмки — это указание, а не вывод автора. Оговорка сохранена: исправления после ревью повторно независимым верификатором не проверялись.

## 1. Проверка зависимостей MW-004, MW-005

| Что проверено | Результат |
|---|---|
| `.work/reports/MW-004-storage.md` | существует (336 строк), статус **DONE** (ревью-статус снят решением владельца); 4 коммита `a032a30`…`7ebb7b8` |
| `.work/reports/MW-005-adapter-sdk.md` | существует (359 строк), статус **DONE**; 4 коммита `e074fac`, `0dd69e2`, `44027ee`, `829ec62` |
| Проверка по исходникам, не по отчетам | `packages/storage/src/*.ts` и `packages/adapter-sdk/src/*.ts` на месте; коммиты обеих карточек присутствуют в `git log --oneline -10` |
| Воспроизводимость до начала правок | `git status` → пусто; `pnpm run check` на `829ec62` → **exit 0**, `98 pass / 0 fail`, smoke 12 `ok` |
| Что MW-005 оставил открытым | интерфейсы портов кроме `AgentRuntimePort`, `BOUNDED_CONTEXTS = ['control']`, вопрос о `neverBundle` — к MW-006 не относятся |
| Наследуемый риск | независимого `MW-002-review.md` в `.work/reports/` нет; владелец снял ревью-статусы MW-002/MW-003/MW-004 — к этой карточке не относится |

Остановки с BLOCKED не требуется: обе зависимости имеют отчёт, исходники и воспроизводимо зелёный конвейер.

## 2. Сделано

### 2.1 Два решения, согласованные с владельцем до начала работы

1. **`global` + конфликтующий overlay → типизированный отказ** (не игнорирование): workspace/task-слой, переопределяющий домен §6.1, получает `CONTRACT_MISMATCH`.
2. **`ConfigRevision` = fingerprint + номер из in-process реестра**: точная каноническая строка служит идентичностью, номер выдаёт `createConfigRevisionRegistry`, повторно используя его для того же fingerprint (без хеша и без новых таблиц в storage).

### 2.2 Контракты (`packages/contracts`)

- `src/config.ts` (новый, 215 строк): `WorkspaceConfigMode` (`global`/`isolated`/`inherit`, §6), `CONFIG_LAYERS` в порядке §6.3 (`platform-default → global → team → workflow → workspace → task`), `WorkspaceNamespaces` (§6.2: `teamWork`, `taskGraph`, `memory`, `runtime`), `ConfigDomain`/`GLOBAL_ONLY_CONFIG_DOMAINS` (§6.1), `ConfigLayerValues`/`ConfigLayerDocument`, `ResolvedWorkspaceConfig` (режим, `configRevision`, `fingerprint`, `appliedLayers`, `layerRevisions`, эффективные значения, namespace'ы), overlay-типы лимитов §14 (`PoolLimitOverlay`, `RoleLimitOverlay`, `PoolPolicyOverlay`).
- `src/team.ts` (+157 строк): `Team` (§6.1/§13, ростер + лимиты), `PoolLimits`/`RoleLimits`/`WorkspaceLimits`/`PoolPolicies` (§14), `REASONING_EFFORTS`, `IDENTITY_RUNTIME_FIELDS` и **закрытые схемы** §13: `IDENTITY_FIELDS`, `ROLE_FIELDS`, `ROLE_CONTRACT_FIELDS`, `ROLE_STRATEGY_FIELDS`, `MODEL_POLICY_FIELDS`, `SKILL_POLICY_FIELDS`, `LEARNING_POLICY_FIELDS`, `AGENT_BLUEPRINT_FIELDS` (исправление F1/F2, §8).
- `src/ids.ts`: `TeamId`, `WorkflowId`. `src/index.ts`: экспорт `./config.ts`.

### 2.3 Разрешение конфигурации (`packages/core/src/config.ts`, 603 строки)

- `resolveWorkspaceConfig(input, meta)`: валидация документов (неизвестный слой/домен/поле, отрицательные счётчики, дубли слоя → `TypeError`), затем policy-проверки слоёв, слияние в порядке §6.3 (независимо от порядка массива), проверка пары `minActive/maxActive` после слияния (§14) и сборка resolved-состояния.
- Слияние: скаляры (`teamId`, `workflowId`) и массивы (`memoryRoutes`) заменяются верхним слоем; объекты (`blueprints`, `pools`, `namespaces`) — по ключам, поэтому workspace-слой может переопределить один лимит и унаследовать остальные.
- Отказы по режиму: `global` + workspace/task-слой на домене §6.1 → `CONTRACT_MISMATCH`; `isolated` + `teamWork`/`taskGraph`/`memory` от любого слоя → `SECURITY_DENIED`; `runtime`-namespace от любого слоя в любом режиме → `SECURITY_DENIED` (§52 делает его workspace-scoped).
- `resolveNamespaces(mode, workspaceId, overrides)`: `isolated` → `ws:<workspaceId>` для Team Work/Task Graph/memory, `runtime` всегда `ws:<workspaceId>/runtime`; `global`/`inherit` → `global` или значение слоя.
- `createConfigRevisionRegistry()` + `canonicalForm()`: одинаковая resolved-конфигурация даёт тот же fingerprint и ту же ревизию, изменённая — следующий номер. `appliedLayers` содержит только слои, реально что-то задавшие (пустой объект домена не считается, пустой массив — считается). Merged-значения замораживаются рекурсивно (`freezeDeep`, исправление F7).

### 2.4 Team Work: Role Contract / Strategy / Blueprint / Identity (`packages/core/src/team.ts`, 695 строк)

- `assertBlueprintWithinRoleContract(role, blueprint, meta)`: контракт — потолок blueprint'а, разрешение вне `workflowPermissions` → `SECURITY_DENIED`; чужой `roleId` → `CONTRACT_MISMATCH`. Проверка повторяется при каждом admission, поэтому суженный контракт отказывает уже опубликованному blueprint'у.
- `applyStrategyLearning(role, { strategy }, meta)`: единственный вход оптимизатора; **наличие** ключа `contract`/`contractRevision` (в том числе со значением `undefined`) → `SECURITY_DENIED` (§13.2, non-goal §63). Стратегия — закрытая схема; предложение, канонически равное текущему, не минтит ревизию.
- `reviseRoleContract(role, contract, meta)` и `reviseBlueprint(blueprint, change, meta)`: публикуют следующую ревизию (§35, §62 п.29); `id`/`revision` в изменении → `CONTRACT_MISMATCH`; неизвестный ключ → `TypeError`; идентичное содержимое не минтит номер; публикация наследника замораживает предыдущую ревизию.
- `assertDurableIdentity(identity, meta)`: закрытая схема §13.4 — любое поле вне `IDENTITY_FIELDS` (в том числе переименованный runtime-дескриптор) → `CONTRACT_MISMATCH`, шесть имён `IDENTITY_RUNTIME_FIELDS` — тоже; ссылки `sessionRefs`/`workspaceOverlays` разрешены. Ретаргет identity собирается поле за полем, а не спредом.
- `resolveAttemptRevisions({ identity, role, blueprint, config }, meta)`: проверяет identity, роль, потолок контракта и пин blueprint'а из resolved-конфигурации (несовпадение → `STALE_REVISION`), затем `freezeRevisions({ config, role, 'role-strategy', 'agent-blueprint' })` (§35). Identity ретаргетится на ревизию blueprint'а и получает workspace-overlay; при неизменной паре ревизия identity не растёт.

### 2.5 Граф задач (`packages/core/src/graph.ts`, 132 строки)

`assertWorkspaceLocalEdges(nodes, meta)`: рёбра `dependsOn` внутри одного workspace принимаются, ребро между workspace'ами → `TASK_CONFLICT` (`details.reason = 'cross-workspace-edge'`, §52/§63); зависимость вне переданного набора → `unverifiable-edge` с сообщением «pass the whole graph» и `details.hint` (исправление F4), self-edge → `self-dependency`. Artifact/reference-ссылки (§52 их разрешает) не являются рёбрами зависимости и проверкой не затрагиваются.

### 2.6 Тесты и документация

- `tests/config.test.mjs` (новый, 313 строк, 6 тестов): precedence и независимость от порядка массива, namespace-изоляция по режимам, отказы режимов, идентичность `ConfigRevision`, громкие `TypeError` на 12 видах некорректной конфигурации, неизменяемость resolved-состояния, cross-workspace рёбра и artifact-ссылки.
- `tests/team.test.mjs` (12 тестов): потолок контракта, обучение стратегии против контракта, отдельные ревизии, no-op-предложения, закрытые схемы §13, неизменность опубликованного blueprint'а, frozen-ревизии при admission, влияние новой ревизии только на следующий запуск, пин blueprint'а, отсутствие runtime/session на identity.
- `tests/lib/fixtures.mjs`: фикстуры `roleFixture`, `blueprintFixture`, `identityFixture` (+69 строк).
- `README.md`: раздел «Конфигурация и Team Work» и уточнение строки структуры (+25 строк).

## 3. Изменённые и новые файлы

Работа закоммичена по слоям (§9); `git show --stat` каждого коммита:

```text
2bbb5d9 feat(contracts): add the workspace config model and the Team shapes   4 файла, +379
        packages/contracts/src/config.ts   215 строк (new)  — §6 режимы, §6.3 overlays, namespace'ы, resolved, overlay-лимиты §14
        packages/contracts/src/team.ts     +157            — Team, PoolPolicies §14, закрытые схемы §13
        packages/contracts/src/ids.ts      +6              — TeamId, WorkflowId
        packages/contracts/src/index.ts    +1              — экспорт ./config.ts

962f696 feat(core): resolve workspace configuration and freeze attempt revisions   4 файла, +1307 −9
        packages/core/src/config.ts        603 строки (new) — resolveWorkspaceConfig, ConfigRevision, namespace'ы, freezeDeep
        packages/core/src/graph.ts         132 строки (new) — assertWorkspaceLocalEdges (§52)
        packages/core/src/team.ts          +562 −9          — контракт/стратегия/blueprint/identity, frozen-ревизии
        packages/core/src/index.ts         +19              — экспорты config/graph/team

352e378 test(config): cover precedence, namespace isolation, and frozen revisions  3 файла, +634 −3
        tests/config.test.mjs              313 строк (new) — конфигурация, режимы, ConfigRevision, DAG
        tests/team.test.mjs                +255 −3          — Team Work, закрытые схемы, frozen-ревизии, identity
        tests/lib/fixtures.mjs             +69              — roleFixture, blueprintFixture, identityFixture

fbee7a0 docs(readme): document the configuration model and Team Work   1 файл, +25 −1
        README.md                          +25 −1           — раздел «Конфигурация и Team Work», строка структуры
```

Чужие файлы не изменялись: `packages/storage/**`, `packages/adapter-sdk/**`, `packages/controller/**`, `scripts/**`, `tests/boundaries.test.mjs` не входят ни в один коммит. Untracked `.dsh/`, `.analysis/` (артефакты других сессий) не добавлялись в индекс и не изменялись; `git status --short --untracked-files=no` после коммитов пуст.

## 4. Команды и exit codes

| Команда | Exit | Наблюдение |
|---|---|---|
| `git status --short` / `git rev-parse HEAD` на старте | 0 | дерево чистое, `829ec627914cfe88330f92f01738edf6bac7c72b` |
| `pnpm run check` до правок (baseline) | 0 | 98 pass / 0 fail, smoke 12 `ok` |
| `pnpm run typecheck` после контрактов, core и правок ревью | 0 | 5 проектов, strict tsc |
| `node --test --test-isolation=none tests/config.test.mjs` | 0 | tests 6 / pass 6 / fail 0 |
| `node --test --test-isolation=none tests/team.test.mjs` | 0 | tests 12 / pass 12 / fail 0 |
| `node --test --test-isolation=none tests/boundaries.test.mjs` | 0 | tests 10 / pass 10 / fail 0 (границы домена не нарушены) |
| `pnpm run check` (typecheck + build + smoke + test) | 0 | **112 pass / 0 fail**, smoke 12 `ok`, `CHECK_EXIT=0` |
| `node scripts/smoke.mjs` | 0 | 12 шагов, `smoke: all steps passed` |
| mutation-прогон §5.2 (12 мутаций), затем `pnpm run build` + `pnpm run check` | 0 | каждая мутация красная, `RESTORED=True`, дерево снова зелёное |
| `pnpm run check` на закоммиченном `fbee7a0` (§9) | 0 | **112 pass / 0 fail**, smoke 12 `ok` — закоммиченное состояние воспроизводимо |
| `git status --short --untracked-files=no` после коммитов | 0 | пусто: отслеживаемых незакоммиченных файлов нет |

## 5. Evidence

### 5.1 Приёмка карточки → чем доказано

| Требование приёмки | Реализация | Проверка |
|---|---|---|
| Тесты precedence | `mergeDocuments`/`orderDocuments` в `core/src/config.ts` | `tests/config.test.mjs` «the §6.3 overlay chain resolves by precedence, not by input order»: значения по слоям §6.3, deep-merge полей лимита, `layerRevisions`, и `deepEqual` результата при перевёрнутом массиве слоёв |
| Тесты namespace isolation | `resolveNamespaces`, policy-проверки режимов | «each mode resolves the namespaces §6.2 and §52 assign» (global делит три namespace и различает `runtime`, isolated различает все четыре, inherit пинит memory) и «a layer the mode does not delegate to is refused, never ignored» (global → `CONTRACT_MISMATCH`, isolated/runtime → `SECURITY_DENIED`) |
| Тесты frozen running revisions | `resolveAttemptRevisions` + `freezeRevisions` | «an attempt freezes the revisions it resolved, and a later blueprint only reaches the next run»: набор `{config, role, role-strategy, agent-blueprint}` заморожен, после публикации ревизии 18 у уже admitted попытки остаётся 17, следующий admission получает 18, повторный admission не двигает ревизию identity |
| Изменение Blueprint применяется лишь к будущему запуску | `reviseBlueprint` минтит ревизию, `resolveAttemptRevisions` фиксирует её на попытке | тот же тест + «a published blueprint revision leaves the previous one untouched» (предыдущая ревизия не изменилась и заморожена, мутация её поля бросает `TypeError`, `revision` от вызывающего → `CONTRACT_MISMATCH`) |
| Запрещены cross-workspace DAG edges | `assertWorkspaceLocalEdges` | «cross-workspace dependency edges are refused, artifact references are not»: локальное ребро принято, ребро W-2→W-1 → `TASK_CONFLICT`/`cross-workspace-edge`, зависимость вне набора → `unverifiable-edge` + hint, artifact-ссылка между workspace'ами разрешена |
| Role Contract отделён от обучаемой Strategy | `applyStrategyLearning` vs `reviseRoleContract`, потолок контракта | «learning evolves the strategy and can never rewrite the contract» (contract/contractRevision, в том числе `undefined`, → `SECURITY_DENIED`), «a proposal that changes nothing publishes no revision», «a published contract revision leaves the strategy where it was», «a blueprint may never exceed the ceiling of its role contract» |
| Runtime/session не хранится как Identity | `assertDurableIdentity`, `IDENTITY_FIELDS`/`IDENTITY_RUNTIME_FIELDS`, ретаргет по полям | «the durable identity carries references, never the running attempt or session»: 6 runtime-имён и 4 переименованных дескриптора (`liveAttempt`, `currentSession`, `runtimeHandle`, `pool`) → `CONTRACT_MISMATCH`, `sessionRefs` разрешены, ключи admitted identity в точности равны `IDENTITY_FIELDS` |
| ConfigRevision на resolved-состояние (§6.3) | `createConfigRevisionRegistry`, `canonicalForm` | «the resolved state keeps its ConfigRevision and a changed one mints the next»: одинаковое состояние (даже при другой ревизии документа) → та же ревизия, изменённое → следующая, `size()` = 2; другое workspace → другая ревизия |

### 5.2 Mutation-проверки (собранный `packages/core/lib/index.js`)

Каждая мутация ломает один инвариант, тест обязан упасть; после каждой артефакт восстановлен из копии (`RESTORED=True`), затем выполнен `pnpm run build` и `pnpm run check` (exit 0, 112 pass).

| Мутация | Тест | Результат |
|---|---|---|
| M1 `if (allowed.includes(permission)) continue` → `if (true)` (потолок контракта) | `tests/team.test.mjs` | exit 1, pass 10 / **fail 2** |
| M2 `if (dependencyWorkspace !== workspaceId) return fail(` → `if (false)` | `tests/config.test.mjs` | exit 1, pass 5 / **fail 1** |
| M3 запрет `runtime`-namespace → `if (false)` | `tests/config.test.mjs` | exit 1, pass 5 / **fail 1** |
| M4 `if (mode === "isolated")` в `resolveNamespaces` → `if (false)` | `tests/config.test.mjs` | exit 1, pass 5 / **fail 1** |
| M5 `return ok(Object.freeze(frozen), meta)` → `return ok(frozen, meta)` | `tests/team.test.mjs` | exit 1, pass 11 / **fail 1** |
| M6 `for (const layer of CONFIG_LAYERS)` → `[...CONFIG_LAYERS].reverse()` | `tests/config.test.mjs` | exit 1, pass 4 / **fail 2** |
| M7 `const existing = minted.get(fingerprint)` → `const existing = void 0` | `tests/config.test.mjs` | exit 1, pass 4 / **fail 2** |
| M8 `if (allowed.includes(key)) continue` в `requireClosedShape` → `continue` | `tests/team.test.mjs` | exit 1, pass 10 / **fail 2** |
| M9 скан закрытой схемы identity → `for (const field of [])` | `tests/team.test.mjs` | exit 1, pass 10 / **fail 2** |
| M10 no-op-контракт (content identity) → `if (false)` | `tests/team.test.mjs` | exit 1, pass 11 / **fail 1** |
| M11 no-op-стратегия (content identity) → `if (false)` | `tests/team.test.mjs` | exit 1, pass 11 / **fail 1** |
| M12 `Object.freeze(blueprint)` при публикации наследника → удалено | `tests/team.test.mjs` | exit 1, pass 11 / **fail 1** |

Ни одна проверка не вакуумна: каждая мутация воспроизводимо красная, а восстановленное дерево — зелёное (112 pass). Мутации M8–M12 добавлены под исправления ревью (§8) и доказывают, что новые тесты не тавтологичны.

### 5.3 Ключевые фрагменты прогона

```text
$ pnpm run check
✔ the §6.3 overlay chain resolves by precedence, not by input order
✔ each mode resolves the namespaces §6.2 and §52 assign
✔ a layer the mode does not delegate to is refused, never ignored
✔ the resolved state keeps its ConfigRevision and a changed one mints the next
✔ a malformed configuration fails loudly instead of resolving partially
✔ cross-workspace dependency edges are refused, artifact references are not
✔ a blueprint may never exceed the ceiling of its role contract
✔ learning evolves the strategy and can never rewrite the contract
✔ a proposal that changes nothing publishes no revision
✔ the closed §13 shapes refuse a field they do not declare
✔ a published contract revision leaves the strategy where it was
✔ a published blueprint revision leaves the previous one untouched
✔ an attempt freezes the revisions it resolved, and a later blueprint only reaches the next run
✔ the durable identity carries references, never the running attempt or session
smoke: all steps passed
ℹ tests 112   ℹ pass 112   ℹ fail 0   ℹ skipped 0
CHECK_EXIT=0
```

### 5.4 Сверка с архитектурой

| Механизм | Источник |
|---|---|
| `global`/`isolated`/`inherit` и что каждый режим берёт из global/своего | §6.1–6.2 (строки 334–353) |
| Порядок overlays `platform-default → global → team → workflow → workspace → task`, «любое resolved configuration состояние получает `ConfigRevision`» | §6.3 (строки 355–371) |
| Pools `minActive/maxActive`, лимиты по ролям и по workspace | §14 (строки 735–775) |
| Role contract не изменяется оптимизатором, strategy эволюционируема; Blueprint и Identity; runtime handle краткоживущий | §13.2–13.5 (строки 632–731) |
| Список неизменяемых ревизий, «Running Attempt всегда frozen на resolved revisions», «изменение Blueprint во время Running не влияет на текущую попытку» | §35 (строки 2072–2089) |
| Global Blueprint/Role переиспользуется, runtime/context/memory overlay workspace-scoped, cross-workspace рёбра запрещены, artifact/reference links разрешены | §52 (строки 2497–2510) |
| Пункты baseline 4, 5, 6, 29 | §62 (строки 2759–2761, 2784) |
| `Revision`, `Result`, коды ошибок §42 — существующие контракты MW-002/MW-003, новых абстракций не вводилось | `packages/contracts/src/{ids,operation,revisions}.ts` |

## 6. Ограничения и что осталось непроверенным

1. **`ConfigRevision` не персистентен.** Номер выдаёт in-process реестр (решение владельца, §2.1): после перезапуска процесса нумерация начнётся с 1, идентичностью остаётся fingerprint. Durable-хранилище конфигурации — вместе со стором `$DSH_HOME/dsh-mywork/config` (§7); в MW-006 таблиц под него не создавалось.
2. **Слои конфигурации не подключены к контроллеру.** Загрузка YAML из `config/global.yaml`, `config/teams/`, `config/workflows/` (§7) и публикация resolved-конфигурации в Cordis-сервис не делались: это объём карточек интеграции (MW-014/022/036).
3. **`frozen`-ревизии фиксируются, но не сохраняются.** `resolveAttemptRevisions` возвращает набор для записи в Attempt; сама запись и стор попытки — за MW-009+, поэтому «попытка хранит ревизии» доказано на уровне домена.
4. **Blueprint без пин`а принимается как передан** (замечание F5): resolved-конфигурация, которая пинит blueprint, проверяется (`STALE_REVISION`), но при отсутствии пин`а модуль не сверяет ревизию с опубликованным реестром — реестра blueprint'ов в MW-006 нет, это работа карточки, которая ими владеет. Зафиксировано в JSDoc `resolveAttemptRevisions`.
5. **Лимиты §14 только разрешаются, но не применяются.** Enforcement пулов (кто считается active, §15) — за MW-014.
6. **Интерпретация «runtime/session не хранить как Identity».** Запрещены живые поля и любые поля вне `IDENTITY_FIELDS` (§13.4); ссылки `sessionRefs`/`workspaceOverlays` оставлены, потому что §13.4 прямо называет «session references» и «workspace overlays» среди того, что identity сохраняет. Если требование читалось строже (никаких session-ссылок вовсе) — это правка контракта `AgentIdentity` из MW-003.
7. **Развилка «Result против TypeError».** Некорректная форма контракта/роли/blueprint'а (значение, которое пишет вызывающий) → `TypeError`; identity с недекларированным полем (значение, которое может вернуть стор) → `Result` с `CONTRACT_MISMATCH`. Развилка осознанная и описана в JSDoc `assertDurableIdentity`/`readContract`; если владелец предпочтёт единый стиль — это правка двух функций.
8. **Коды ошибок — решения, которые стоит подтвердить.** Cross-workspace ребро возвращает `TASK_CONFLICT` (нарушение формы графа) с `details.reason`, а не `SECURITY_DENIED`; запрет домена в режиме `global` — `CONTRACT_MISMATCH`, эскалация namespace в `isolated`/`runtime` — `SECURITY_DENIED`.
9. **Не проверено:** конкурентные вызовы одного реестра ревизий из нескольких сессий Cordis (реестр синхронный, блокировок нет), горячая перезагрузка профиля, реальные YAML-документы слоёв (валидируются JS-значения), `verify:profile` для этой карточки не запускался (долго и не требуется: контроллер не менялся).
10. **Smoke не менялся.** Новый API — доменный (`@dsh-mywork/core`), в контроллер он не подключён (п. 2), поэтому 12 шагов smoke остались прежними; работоспособность собранных пакетов проверяют тесты, импортирующие `lib/*.js`.

## 7. Статус и следующий шаг

- **DONE.** Статус переведён из `READY_FOR_REVIEW` по прямому указанию владельца (сессия MW-020, «поменять все карточки с подобной оговоркой»). Приёмка — акт владельца. Что это не означает: исправления F1–F7 вторым независимым верификатором не проверялись — `verify-fixes`-прогон остаётся доступным по желанию владельца.
- Коммиты сделаны по отдельному поручению владельца (§9); push/merge/rebase/publish/release не выполнялись.
- Следующая карточка (MW-007) не начата; доска разработки, живой профиль DSH `~/.dsh` и чужие проекты не изменялись.

## 8. Независимое ревью и исправления (F1–F7)

Ревью выполнено отдельным субагентом (read-only, без доступа к моей переписке: единственная связь — этот отчёт и карточка). Вердикт: **PASS WITH FINDINGS** — все 8 критериев приёмки выполнены по исходникам, все числа отчёта воспроизвелись независимо (check 0 / 110 pass на момент ревью, 6-10-10 по файлам, smoke 12 `ok`, 7/7 mutation-проверок с точными pass/fail), чужие пакеты не тронуты. Ревьюер также отметил, что `.forge/` появился в дереве во время ревью (активность соседней сессии), а исходники MW-006 не менялись.

| # | Severity | Замечание | Исправление | Чем проверено |
|---|---|---|---|---|
| F1 | MAJOR | `assertDurableIdentity` — denylist: переименованные runtime-поля (`liveAttempt`, `currentSession`, `runtimeHandle`) проходили и сохранялись ретаргетом-спредом | Введён `IDENTITY_FIELDS` (закрытая схема §13.4): поле вне списка → `CONTRACT_MISMATCH`; `retargetIdentity` собирает identity поле за полем, а не спредом | тест «the durable identity carries references…» (4 переименованных поля + 6 имён + сверка ключей с `IDENTITY_FIELDS`); мутации M9 |
| F2 | MAJOR | Ревизия минтилась без content identity и без проверки ключей: `reviseRoleContract(role, {...role.contract, approveOwnWork: true})` принимался, идентичный контракт давал `4 → 5` | Закрытые схемы `ROLE_FIELDS`/`ROLE_CONTRACT_FIELDS`/`ROLE_STRATEGY_FIELDS`/политики/`AGENT_BLUEPRINT_FIELDS` (неизвестный ключ → `TypeError`) и сравнение канонической формы: предложение без изменений возвращает исходное значение и не минтит номер | тесты «the closed §13 shapes refuse a field they do not declare», «a proposal that changes nothing publishes no revision»; мутации M8, M10, M11 |
| F3 | MINOR | `contract: undefined` в payload'е обучения проходил; `strategy.contract` принимался молча | Проверка наличия ключа (`Object.hasOwn`) вместо `!== undefined`; закрытая схема стратегии отвергает вложенный `contract` | тест «learning evolves the strategy…» (включая `{ contract: undefined }` и вложенный случай) |
| F4 | MINOR | Непереданный сосед давал `unverifiable-edge` без указания, как сделать ребро проверяемым | Сообщение «pass the whole graph» и `details.hint`; JSDoc модуля уточнён | тест «cross-workspace dependency edges…» (regexp по сообщению и тип `hint`) |
| F5 | MINOR | Пин blueprint'а проверяется только при наличии: admission без пин`а доверяет ревизии вызывающего | Ограничение зафиксировано в JSDoc `resolveAttemptRevisions` и в §6 п.4 этого отчёта (реестра blueprint'ов в карточке нет) | документация + §6 |
| F6 | NIT | Предыдущая ревизия blueprint'а не была заморожена, тест проверял только поля | Публикация наследника замораживает предыдущую ревизию (`Object.freeze(blueprint)`), то же для роли | тест «a published blueprint revision leaves the previous one untouched» (`Object.isFrozen` + мутация поля бросает `TypeError`); мутация M12 |
| F7 | NIT | `pools` оставался mutable на resolved-состоянии, тогда как другие секции заморожены | `freezeDeep` для merged-значений (`blueprints`, `memoryRoutes` слиянием, `pools` рекурсивно) | тест «the §6.3 overlay chain…» (`Object.isFrozen` на трёх уровнях + мутация бросает `TypeError`) |

Проверки после исправлений: `pnpm run check` → exit 0, **112 pass / 0 fail** (было 110; добавлены 2 теста), smoke 12 `ok`; 12 мутаций (M1–M12) красные, артефакт восстановлен (`RESTORED=True`) и пересобран. Независимое ревью исправлений (режим `verify-fixes`) не выполнялось — это единственный незакрытый шаг, если владелец сочтёт его нужным.

## 9. Коммиты

Сделаны по отдельному поручению владельца («коммиты сделай»). Один коммит на слой, только свои файлы, ветка `main`, сообщение через файл (`.tmp/msg-*.txt`), trailer `Cards: MW-006.`:

| SHA | Сообщение | Содержимое |
|---|---|---|
| `2bbb5d9` | `feat(contracts): add the workspace config model and the Team shapes` | 4 файла, +379: `contracts/src/{config.ts,team.ts,ids.ts,index.ts}` |
| `962f696` | `feat(core): resolve workspace configuration and freeze attempt revisions` | 4 файла, +1307 −9: `core/src/{config.ts,graph.ts,team.ts,index.ts}` |
| `352e378` | `test(config): cover precedence, namespace isolation, and frozen revisions` | 3 файла, +634 −3: `tests/{config.test.mjs,team.test.mjs,lib/fixtures.mjs}` |
| `fbee7a0` | `docs(readme): document the configuration model and Team Work` | 1 файл, +25 −1: `README.md` |

Base → head: `829ec627914cfe88330f92f01738edf6bac7c72b` → `fbee7a0b1d0703b5b2bdd581c05e81c3c19a2f7e`. Проверки на закоммиченном дереве: `pnpm run check` → exit 0, 112 pass / 0 fail, smoke 12 `ok`; `git status --short --untracked-files=no` → пусто. Push, merge, rebase, publish и release не выполнялись; `.work/` исключён из Git по замыслу проекта, поэтому отчёт в коммиты не попадает.
