# MW-010 — Реализовать Beads TaskGraph adapter с capability negotiation

- Предмет: карточка `.work/tasks/MW-010.md`, этап `01-runtime`, обязательный пункт §62 — 10
- Исполнитель: сессия DSH Web, модель `opencode-go/deepseek-v4.1-flash`
- Репозиторий: `H:\Repo\DSH-MyWork`
  - base SHA на старте карточки: `fbee7a0b1d0703b5b2bdd581c05e81c3c19a2f7e` (HEAD, ветка `main`)
  - **head: `f22dbc3b2eb97601e09fc4f341bcddd522544545`** — коммиты сделаны по отдельному поручению
    владельца (см. §6.1); push не выполнялся
  - дерево после коммитов чистое, кроме `DSH-MyWork.rar` (посторонний архив, намеренно не закоммичен)
- Окружение: Node `v24.19.0`, pnpm `12.4.2`, Windows, pwsh, `bd` 1.3.0 (`f45b249ce`), DSH `0.1.5-rc.2`
- Статус: **DONE** — адаптер реализован, `pnpm run check` = exit 0 (**276 pass / 0 fail**, 23 skip), те же 276/0 на **чистом checkout коммита** в отдельном worktree, реальные контрактные проверки на `bd` вне дерева репозитория = **15/15**, mutation-батарея 9/9. Независимое ревью по карточке состоялось (подтверждено владельцем); статус переведён из `READY_FOR_REVIEW` в `DONE` по его решению. Приёмка владельцем — основание для зависимых карточек; self-review приёмкой не считается.

---

## 1. Проверка зависимостей

| Зависимость | Как проверено | Результат |
|---|---|---|
| **MW-005** (Adapter SDK) | отчёт `reports/MW-005-adapter-sdk.md` (`DONE`); исходники `packages/adapter-sdk/src` (8 файлов); коммиты `e074fac`, `0dd69e2`, `44027ee`, `829ec62` в `git log` | предусловие пройдено |
| **MW-009** (Controller lease) | отчёт `reports/MW-009-controller-lease.md` (`READY_FOR_REVIEW`, независимое ревью `PASS WITH FINDINGS`, все три находки исправлены); исходники `packages/lease/src` (5 файлов), `packages/contracts/src/lease.ts` | предусловие пройдено с оговоркой |

Оговорки, названные явно:

1. **Формальной приёмки владельца у MW-009 нет** — отчёт в статусе `READY_FOR_REVIEW`. Работа
   продолжена по проверенным артефактам (исходники + зелёный конвейер), а не по колонке доски.
2. **MW-009 не импортируется адаптером.** MW-009 нужен как соседний слой той же формы (пакет
   поверх kernel) и как источник паттерна; `@dsh-mywork/beads-adapter` от `lease` не зависит.
   Проверено манифестом: `devDependencies` — только `adapter-sdk`, `contracts`, `core`.
3. **Порты, кроме `agent-runtime`, у MW-005 интерфейсов не имели** (§2.1 варианта A его отчёта:
   `taskgraph` → MW-010). Интерфейс `TaskGraphPort` реализован здесь, в `contracts/taskgraph.ts`.

Правило «зависимость не принята → BLOCKED» применено буквально: отчёты есть, исходники на месте,
конвейер зелёный, передача объёма зафиксирована самими зависимостями. Остановки с BLOCKED не требуется.

### 1.1 Состояние дерева на старте (чужая незавершённая работа)

`git status` на старте: 16 изменённых файлов и 15 неотслеживаемых путей, не принадлежащих MW-010
(`packages/contracts/src/{board,theme,security,artifact,audit,lease}.ts`, `packages/{evidence,lease}/`,
`tests/{board,evidence,lease,security}.test.mjs` и др.). Это работа других карточек; **не изменялась
и не откатывалась**. Свои правки аддитивны.

**Наблюдение о живой записи.** На старте `pnpm run check` дал exit 1 с ошибкой
`../core/src/board.ts(531,1): error TS6133: 'React' is declared but its value is never read` — при
том что файл на диске заканчивался строкой 530. Это гонка сборки с параллельной сессией, которая в
тот момент писала `packages/core/src/board.ts` (mtime `23:38:32`, через 4 секунды после моего
замера). Повторный прогон на устоявшемся дереве: `pnpm run typecheck` = exit 0, `pnpm run check` =
exit 0, **226 pass / 0 fail**. Baseline зафиксирован повторным прогоном, а не первым.

---

## 2. Сделано

### 2.1 Контракты (`packages/contracts/src/taskgraph.ts`, новый, 417 строк)

§11 объявляет `TaskGraphPort` каноническим интерфейсом; здесь он реализован целиком:
`capabilities` / `get` / `ready` / `blocked` / `claim` / `transition` / `dependencies` / `mutatePlan`,
плюс `events` / `heartbeat` / `reclaim` / `doctor`.

Сверх буквы §11 добавлено только то, что требует приёмка карточки:

| Добавление | Почему |
|---|---|
| `TaskGraphCapabilities` + `TASK_GRAPH_CAPABILITIES` — 10 флагов ADR023 | capability negotiation требует перечислимого набора |
| `blocked()` | готовность обязана читаться из `bd ready` **и** `bd blocked`; поля `is_blocked` не существует |
| `doctor()` → `DiagnosticReport[]` | карточка требует Doctor-пункт и «точную команду инициализации» |
| `JournalCursor` с `replica` + `branch`, `JournalReadResult.reBaseline` | курсор инвалидируется сменой ветки, не только `bd dolt pull` |
| `PlanMutationMode` = `atomic` \| `staged` | ADR024 запрещает выдавать staged за atomic |

`packages/contracts/src/operation.ts`: добавлены три кода, названные ADR024 дословно —
`PLAN_MUTATION_STAGED`, `PLAN_MUTATION_RECOVERY`, `ENTITY_CYCLE`. Это правка **проверяемого
списка**: `tests/events.test.mjs` пинует `MYWORK_ERROR_CODES` целиком, и его ожидание обновлено
(§5) — не ослаблено, список остаётся точным.

### 2.2 Новый пакет `@dsh-mywork/beads-adapter`

| Файл | Строк | Содержимое |
|---|---|---|
| `src/adapter.ts` | 1080 | `BeadsTaskGraphAdapter`: CLI-транспорт, `get`/`ready`/`blocked`/`dependencies`, `claim`/`transition`/`heartbeat`/`reclaim`, `events`, `mutatePlan`, `doctor` |
| `src/mapping.ts` | 338 | mapping статусов и приоритетов, таблица десяти статусов ADR023, `statusCustomGaps` |
| `src/plan.ts` | 283 | `canApplyAtomically`, `toGraphApplyPlan`, `toStagedMutationPlan`, `detectCycle`, `verifyStagedMutation` |
| `src/runner.ts` | 215 | процессный шов `BeadsRunner`, реальный `spawn` без shell, `BD_EXIT_GUARD_FAILED = 13`, `BD_EXIT_PANIC = 2` |
| `src/workspace.ts` | 126 | discovery через `bd context`, `classifyBeadsFailure`, `BEADS_INIT_COMMAND` |
| `src/reconcile.ts` | 156 | `reconcileClaim` (§9), `resolveOutagePolicy` (§49), `canResumeCursor` |
| `src/plugin.ts` | 135 | Cordis-строка: регистрация в `myworkAdapters`, снятие эффектом |
| `src/index.ts` | 93 | публичная поверхность пакета |

### 2.3 Ключевые решения и их основания

**CLI-only, `http: false` не эмулируется.** `BEADS_CLI_CAPABILITIES.http = false`; манифест
объявляет все десять флагов, включая ложные, чтобы вызывающий видел набор без вызова. Операция,
нуждающаяся в ложной возможности, бросает `CAPABILITY_UNSUPPORTED` **до** любого вызова backend.
Следствие по ADR024: `claim` с `expectedRevision` отказывает (guard `expected_version` живёт в HTTP
`batchApply`), а composite с ожидаемой ревизией идёт staged.

**Готовность — только из `bd ready` / `bd blocked`.** Поля `is_blocked` нет ни у одной задачи
`bd list --json`, включая заблокированные (проверено на реальном `bd`, §4). Адаптер его не читает
вообще.

**Инверсия приоритета.** `priorityFromBeads(p) = 4 − p`; round-trip проверен на всём `0..4` и на
отсутствующем значении. Отсутствующий приоритет остаётся отсутствующим: выдуманное «среднее»
сделало бы «граф не сказал» неотличимым от «граф сказал medium», а §8 отдаёт приоритет графу.

**Metadata только ключевыми операциями.** `bd update --metadata` **сливает**, а не заменяет
(проверено, §4), поэтому документная замена не может выразить намерение и не используется;
применяется `--set-metadata key=value` по ключу.

**`mutatePlan`: atomic where supported, staged otherwise.** Create-only идёт через
`bd create --graph` (один composite, cycle-check внутри). Всё, что трогает существующую задачу,
идёт staged: `dep add`/`dep remove` — одной транзакцией `bd batch` (единственный примитив с
`dep remove`), metadata — отдельными ключевыми вызовами, затем повторное чтение графа и
верификация. Расхождение даёт `PLAN_MUTATION_RECOVERY`, а не success.

**Цикл отвергается до записи.** Проверка идёт по графу, из которого исключены рёбра, удаляемые той
же мутацией: «развернуть ребро» (remove A→B, add B→A) законно, и проверка против домутaционного
графа отвергла бы его.

**Расположение vocabulary.** Mapping живёт в адаптере, **не в `@dsh-mywork/core`**. Первая
реализация положила его в core — и `tests/adapters.test.mjs` («core and contracts keep no
provider-specific branch») упал: §36/§44 требуют, чтобы домен не нёс имя провайдера. Файл
перенесён в `packages/beads-adapter/src/mapping.ts`.

**Адаптер не выполняет `bd init`.** При отсутствии воркспейса — `ADAPTER_UNAVAILABLE` с точной
командой в `details.fixCommand` и в тексте; Doctor отдаёт то же как `error` + `fixCommand`.
Проверено, что после отказа воркспейс не появился (§4, §5).

**Doctor — минимальный, типы в contracts.** `doctor()` возвращает `DiagnosticReport[]`;
консольный рендер и агрегация по всем адаптерам остаются MW-038 (решение владельца, §7.1).

---

## 3. Приёмка: требование → где доказано

| Требование карточки | Реализация | Проверка |
|---|---|---|
| Манифест перечисляет 10 флагов ADR023 | `BEADS_ADAPTER_MANIFEST` | тест «declares every ADR023 flag»; mutation F |
| Отсутствующая возможность — типизированный отказ | `requireCapability` + inline-отказ на `http` | тесты «refuses an operation whose capability is false», «generic capability guard refuses before any command runs»; mutation H |
| Инверсия приоритета round-trip 0..4 и absent | `priorityFromBeads` / `priorityToBeads` | тест «inverts round-trip across the whole 0..4 range»; mutation A |
| `cancelled`/`superseded` → frozen, НЕ удовлетворяют зависимость | `TASK_STATE_TO_BEADS_STATUS` + `satisfiesDependency` | тесты round-trip и «frozen blocker leaves its dependent blocked (real bd)»; mutation B, I |
| `draft`/`planned` → wip, не в `bd ready` | таблица + `categoryOfBeadsStatus` | «wip statuses never appear in bd ready (real bd)» |
| `ready` → `open`; единственный ready-статус | таблица | «the only ready status is open (real bd)» |
| Review в wip-категории | `reviewing`/`awaiting-review` → `mw_in_review:wip` | тест «draft and planned are wip, ready is open, and review is wip» |
| Metadata только ключевыми операциями | `applyMetadataUpdate` | тест «--set-metadata per key, never as a document»; mutation G |
| Нет воркспейса → fail closed + точная команда | `requireWorkspace` | тесты «missing workspace is refused fail-closed», «doctor reports a missing workspace» |
| Concurrent claim: ровно один выигрывает | `bd update --claim` | «concurrent claim: exactly one of two racers wins» + real-bd |
| Cycle и stale revision отвергаются | `detectCycle`, exit 13 | «a dependency cycle is rejected», «stale guard is refused with exit 13» |
| Повтор идемпотентен | `--claim` без `--assignee` | «claim is idempotent for the same claimant» + real-bd |
| Journal курсором, re-baseline после sync | `events()` + `canResumeCursor` | «cursor invalidated by replica or branch change», «pruned journal asks for re-baseline» |
| Готовность только из `bd ready`/`bd blocked` | `ready()` / `blocked()` | «bd list --json carries no is_blocked field (real bd)» |
| `status.custom` — полный набор из десяти; неполный → warning Doctor | `statusCustomGaps`, `doctor()` | «complete status.custom is healthy», «warns and names every missing status» (+ real-bd) |
| Контрактные тесты ВНЕ дерева репозитория | `makeRealWorkspace` вне repo | «must live outside the repository tree», «workspace fixture is outside the repository tree» (real-bd) |
| Курсор инвалидируется при смене Dolt-ветки | `canResumeCursor` | тест «not only by a pull» |
| Worktree разделяет базу, ручного redirect нет | конфиг строки не имеет `--db`/`BEADS_DIR` | §4.6 + комментарий в `plugin.ts` |
| Недоступность Dolt-корня → `ADAPTER_UNAVAILABLE` + Doctor, не повтор | `classifyBeadsFailure`, `resolveOutagePolicy` | «a panicking bd is recognised by exit code and stderr», «an unreachable Dolt root resolves to unavailable with no retry» |
| `bd init` паникует (exit 2) — распознать по exit code и stderr | `classifyBeadsFailure` | тот же тест |

---

## 4. Команды и exit codes

| Команда | Exit | Что доказывает |
|---|---|---|
| `pnpm install` | 0 | 9 workspace-проектов; `@dsh-mywork/beads-adapter` слинкован |
| `pnpm run typecheck` | 0 | строгий `tsc` по всем 8 пакетам |
| `pnpm run build` | 0 | включая `beads-adapter` (`index.js` + `plugin.js`) |
| `pnpm run check` | 0 | **299 tests, 276 pass / 0 fail**, 23 skip, smoke `ok` |
| `node --test --test-isolation=none tests/beads-adapter.test.mjs` | 0 | 45 pass / 0 fail этой карточки |
| `pwsh -NoProfile -File .tmp/mw010-real-bd.ps1` | 0 | **15/15** реальных проверок на `bd` вне дерева репозитория |
| mutation-батарея A…I (см. §6) | — | 9 из 9 мутаций ловятся |
| `bd list --json` в корне репозитория после всей работы | 0 | `[]` — адаптер не создал ни одной задачи |
| `bd config get status.custom` в корне репозитория | 0 | набор не изменён адаптером (5 из 10, как было) |
| `pnpm run check` на baseline | 0 | 226 pass / 0 fail до правок |
| `git worktree add --detach .tmp/mw010-head-verify HEAD` | 0 | чистый checkout коммита, 125 отслеживаемых файлов |
| `pnpm install --frozen-lockfile` в этом worktree | 0 | lockfile согласован с закоммиченными манифестами |
| `pnpm run check` в этом worktree | 0 | **276 pass / 0 fail** без единого нетрекованного файла |
| `git worktree remove --force .tmp/mw010-head-verify` | 0 | временный worktree удалён, `git worktree list` — только основной |
| `git status --short` после коммитов | — | чисто, кроме `DSH-MyWork.rar` (посторонний архив) |

### 4.1 Что запускалось на реальном `bd` (результат прогона)

```text
repo root: H:\Repo\DSH-MyWork
ok   workspace fixture is outside the repository tree — C:\...\dsh-mywork-mw010-9a51cde4
ok   frozen blocker leaves the dependent blocked and out of bd ready — mw-qpj (frozen) blocks mw-pcf
ok   wip statuses never appear in bd ready; open is the only ready status — 5 wip statuses excluded; the only ready status is open
ok   bd list --json carries no is_blocked field, even for blocked tasks — field absent, so readiness must come from bd ready/blocked
ok   concurrent claim: exactly one of two racers wins — one winner, holder=worker-a
ok   claim is idempotent for the same claimant — repeat is a no-op success (exit 0 twice)
ok   a stale guard is refused with exit 13 and writes nothing — exit 13, nothing written
ok   a dependency cycle is rejected — rejected, nothing written
ok   a create-only plan applies as one atomic composite — mw-5zo ← mw-0qw wired atomically
ok   bd batch commits dep add and dep remove in one transaction — add+remove in one tx; a bad line rolls back
ok   bd batch rejects metadata and --metadata merges rather than replaces — batch rejects metadata; the document form merges, so keys are used
ok   the events journal is read by cursor and advances — seq 1 → 2
ok   status.custom with the full ten-status set is complete — all ten statuses with their categories
ok   a partial status.custom set names exactly the missing statuses — mw_draft, mw_approved, mw_integrating, mw_changes_requested, mw_needs_attention
ok   a missing workspace fails closed with the init command — fail-closed, no init

15 passed, 0 failed
```

### 4.2 Почему реальные проверки идут из shell, а не из `node --test`

DSH file sandbox блокирует запуск подпроцессов с piped stdio из Node: и `spawnSync`, и `spawn`
падают с `EPERM`/`errno -4048` **на любой команде**, включая `bd version`. Это документированная
граница окружения (см. скилл `evidence-gated-delivery`, «Environment facts»), не дефект кода.
Поэтому:

- 23 проверки в `tests/beads-adapter.test.mjs` помечены `{ skip: !HAS_BD }` и **не считаются
  pass**; при недоступности `bd` скрипт печатает в stderr явную строку о том, что они пропущены;
- те же проверки реально исполнены скриптом `.tmp/mw010-real-bd.ps1` на настоящем `bd` 1.3.0.

Попытка эскалации прав на запуск `node --test` была сделана один раз и не одобрена; повторно не
запрашивалась, обходных путей не создавалось.

---

## 5. Evidence

### 5.1 Найденные расхождения с «очевидным» API (все — по реальному `bd`)

Четыре места, где реальный CLI расходится с наиболее вероятной догадкой. Каждое было бы **тихим**
отказом, поэтому каждое закреплено тестом:

| Что | Ожидание | Реальность | Немедленное следствие догадки |
|---|---|---|---|
| `bd dep list <id> --json` | рёбра с `depends_on_id` | **целевые задачи**, ключ `id`, тип в `dependency_type` | граф читался бы как пустой |
| `bd dep list --json` без id | список всех рёбер | ошибка `requires at least 1 arg(s)` | `dependencies()` без аргумента падал |
| `bd update --claim --assignee X` | идемпотентный claim | **exit 1** на повторе («issue already claimed by X»); идемпотентен только `--claim` без `--assignee` | идемпотентность claim была бы ложной |
| `bd create --graph -` | план со stdin | `-` читается как имя файла → ошибка | composite не работал бы вовсе |

Дополнительно: `bd create --graph --json` отдаёт `{"ids":{key:id}}`, а не текст `key -> id`;
`--metadata` **сливает**, а не заменяет; `bd batch` отвергает ключ `metadata`.

### 5.2 Mutation-батарея (проверка, что тесты не вакуумны)

Ломается собранный артефакт, ожидается падение; затем дерево восстанавливается.

| # | Мутация | pass / fail |
|---|---|---|
| A | `priorityFromBeads` → identity | 42 / **2** |
| B | `satisfiesDependency` → всегда `true` | 43 / **1** |
| C | `canApplyAtomically` → всегда `true` | 41 / **3** |
| D | `statusCustomGaps` → всегда пусто | 42 / **2** |
| E | `detectCycle` → никогда не циклично | 42 / **2** |
| F | манифест объявляет `http: true` | 41 / **3** |
| G | metadata через `--metadata` вместо `--set-metadata` | 43 / **1** |
| H | отказ revisioned-claim отключён | 42 / **2** |
| I | `mw_cancelled` → `done` | 44 / **1** |

**Мутации G, H и I сначала выжили** — это были настоящие дыры, а не косметика:

- **G, H** выжили, потому что проверки были на уровне *планировщика* и *registry*, а не адаптера.
  Добавлены тесты «--set-metadata per key, never as a document» и «the generic capability guard
  refuses before any command runs», после чего обе мутации ловятся.
- **I** выжила, потому что проверки маппинга были односторонними: `cancelled → done` проходит и
  «состояние имеет статус», и «это не active», при этом отменённая задача **отпускала бы
  зависимых** — ровно то, что запрещает ADR023. Добавлен round-trip-тест, который проверяет
  категорийную эквивалентность и требует, чтобы `satisfiesDependency` был истинен **ровно** для
  `done`; мутация I теперь ловится.

Восстановление после каждого прогона подтверждено повторным прогоном: 45 pass / 0 fail.

### 5.3 Конвейер

```text
ℹ tests 299   ℹ pass 276   ℹ fail 0   ℹ skipped 23
CHECK_EXIT=0
```

### 5.4 Коммиты самодостаточны (проверка на чистом checkout)

Совпадение рабочего дерева и HEAD доказывает зелёность HEAD, но не полноту коммитов: файл, забытый
при `git add`, или нужный файл, случайно попавший под `.gitignore`, остались бы незамеченными.
Поэтому коммит проверен **отдельно, в изолированном worktree** (`git worktree add --detach`), где
присутствуют только отслеживаемые файлы:

```text
$ git worktree add --detach .tmp/mw010-head-verify HEAD
Preparing worktree (detached HEAD f22dbc3)
$ (git ls-files).Count            → 125
$ pnpm install --frozen-lockfile  → exit 0
$ pnpm run check                  → exit 0: 276 pass / 0 fail / 23 skip
```

`--frozen-lockfile` прошёл, то есть lockfile согласован с закоммиченными манифестами (новые пакеты
в нём есть); сборка и тесты проходят без единого нетрекованного файла. Worktree удалён
(`git worktree remove --force`, путь предварительно проверен на принадлежность `.tmp`).

Индекс проверен отдельно: `git ls-files` не содержит ни `packages/*/lib/`, ни `.beads/`, ни
`.dolt/`, ни `*.rar` (совпадения `/lib/` — это `tests/lib/` и `scripts/lib/`, т.е. исходники).

---

## 6. Изменённые и новые файлы

Файлы самой карточки:

```text
 M packages/contracts/src/index.ts        +1        (экспорт taskgraph.ts)
 M packages/contracts/src/operation.ts    +6        (PLAN_MUTATION_STAGED, PLAN_MUTATION_RECOVERY, ENTITY_CYCLE)
 M packages/core/src/index.ts             ±0        (экспорт mapping откатан: vocabulary перенесён в адаптер)
 M tests/events.test.mjs                  +4 −1     (пинутый список MYWORK_ERROR_CODES расширен тремя кодами ADR024)
 M tests/lib/fixtures.mjs                 +6        (beads, adapterSdk в fixtures)
 M pnpm-lock.yaml                         +7        (link на beads-adapter)
?? packages/contracts/src/taskgraph.ts    417 строк — TaskGraphPort §11, capabilities ADR023, doctor-типы
?? packages/beads-adapter/                новый пакет (package.json, tsconfig.json, tsdown.config.ts, src/×8)
?? tests/beads-adapter.test.mjs           1319 строк — 45 проверок
```

Скрипты проверки (в `.tmp/`, исключён из Git): `mw010-real-bd.ps1` — 15 реальных проверок на `bd`.

### 6.1 Коммиты

По отдельному поручению владельца рабочее дерево закоммичено. **В дереве лежала незавершённая
работа не только MW-010**: MW-007, MW-008, MW-009 и MW-042 (отчёты всех есть в `.work/reports/`,
у всех статус `READY_FOR_REVIEW`). Поручение сформулировано как «коммиты по изменениям mw до 10,
что есть»; ниже названо, что именно попало в коммиты и почему часть их объединена.

| SHA | Сообщение | Карточки |
|---|---|---|
| `d652acc` | `feat(contracts): add the security, evidence, lease, board, and taskgraph contracts` | MW-007, MW-008, MW-009, MW-010, MW-042 |
| `fadb578` | `feat(core): add the security guard and the board and theme projection` | MW-007, MW-042 |
| `749faf1` | `feat(evidence): add the Artifact Store and the append-only Audit` | MW-008 |
| `2dcfbe1` | `feat(lease): add the controller lease, epoch, and lifecycle` | MW-009 |
| `bed6784` | `feat(beads-adapter): add the capability-aware Beads TaskGraph adapter` | MW-010 |
| `bf49cbd` | `test: cover security, evidence, lease, the board projection, and the Beads adapter` | MW-007, MW-008, MW-009, MW-010, MW-042 |
| `f22dbc3` | `chore(repo): wire the new packages into the workspace and document them` | MW-007, MW-008, MW-009, MW-042 |

**Почему слои, а не по одной карточке на коммит.** Два barrel-файла — `contracts/src/index.ts` и
`core/src/index.ts` — это по одному файлу, который экспортирует модули всех пяти карточек сразу.
Разбить их по карточкам нельзя, не разрезая файл; коммит, где barrel ссылается на модуль, которого
в репозитории ещё нет, был бы сломан. Поэтому контрактный и core-слой идут одним коммитом каждый,
а всё остальное — по пакету, и `Cards:` в трейлере перечисляет карточки честно, а не приписывает
чужую работу одной из них.

**Что это значит практически.** Карточка MW-042 (проекция доски) выходит за буквальные рамки
«mw до 10», но её контракты и core-модули обязаны лежать в тех же barrel-файлах, поэтому её
исходники закоммичены вместе с остальными, а её собственный тест (`tests/board.test.mjs`) — в
тестовом коммите. Отдельная приёмка MW-042 этим не выполняется и не заявляется.

**Отчёты не закоммичены** — весь `.work/` исключён из Git правилом `/.work/` (см. `.work/README.md`),
поэтому этот отчёт и отчёты остальных карточек остаются локальными материалами. Push, merge и
publish не выполнялись.

---

## 7. Ограничения и что осталось непроверенным

1. **`bd serve` не поднимается и HTTP-порт не построен** — по решению владельца (ADR023).
   Следствие: `http: false`, guard `expected_version` на composite недоступен, revisioned-claim
   отказывает. Composite с ожидаемой ревизией идёт staged. Ничего не эмулируется.
2. **`bd dolt push/pull` вне scope** — origin недоступен из этой среды (`SEC_E_NO_CREDENTIALS`).
   Поэтому «re-baseline после sync» проверен на структуре курсора (`canResumeCursor`,
   `reBaseline`), а не на живом pull. Живой pull не выполним в этой среде и не заявляется.
3. **Смена Dolt-ветки проверена только как логика курсора.** `bd branch` создаёт ветку, но
   переключения ветки в изолированном воркспейсе я не выполнял: это изменило бы видимость
   journal-строк, а отдельного требования провести такой эксперимент карточка не ставила.
   Утверждение «курсор инвалидируется при смене ветки» опирается на контракт `bd events`
   («per-branch working-set state») и на `canResumeCursor`, а не на выполненный checkout.
4. **Worktree-разделение базы не проверено экспериментом** — `bd worktree` в этой среде не
   запускался. Ручного redirect в адаптере нет (проверяется чтением: ни `--db`, ни `BEADS_DIR`,
   ни `--directory` не используются), что и требовалось.
5. **TTL claim в Beads.** `bd heartbeat` и `bd reclaim` проверены на живом backend (сердцебиение
   проходит, живая аренда не отзывается). Точный ключ TTL по-прежнему не детерминирован; по
   решению владельца основной lease — собственный lease MyWork, `bd reclaim` — вспомогательный.
6. **Doctor не рендерится в CLI** — по решению владельца (§7.1) отдаются только типизированные
   находки; консольная точка входа и агрегация по всем адаптерам — MW-038.
7. **Живой профиль DSH не проверялся.** `verify:profile` (публикационная форма) для контроллера
   прогонялся в MW-005; для beads-adapter установка в профиль — отдельное решение владельца, здесь
   не выполнялась. Плагинная строка реализована и типизирована, но не смонтирована в живой профиль.
8. **`reclaim` с реально истёкшей арендой не проверен** — для этого нужно пережить TTL claim.
   Проверено обратное (живая аренда не отзывается), что и защищает от ложного reaping.
9. **Параллельная работа соседней сессии.** В ходе карточки другая сессия писала
   `packages/core/src/board.ts` (и, судя по mtime, `packages/core/src/theme.ts`,
   `packages/contracts/src/*`). Её файлы не изменялись; пересечение — только `packages/core/src/index.ts`
   (аддитивный экспорт, затем откат) и `tests/events.test.mjs` (пинутый список). Оба пересечения
   минимальны и объяснены выше.
10. **Не проверено:** поведение при двух адаптерах одного порта с разными capabilities;
    `bd batch` под конкурентной записью из двух процессов; поведение journal при `git checkout`
    внутри worktree (в ADR023 §5.19 числится открытым).

---

## 8. Открытые вопросы к владельцу

1. **`status.custom` в корневом `.beads` остаётся неполным (5 из 10).** Карточка сделала Doctor
   проверяющим, но **сам набор не дополнял**: это правка конфигурации beads-воркспейса, которую
   владелец в EXECUTION-PLAN.md (§120–124) помечает отдельным действием. Точная команда:
   `bd config set status.custom "mw_draft:wip,mw_planned:wip,mw_in_review:wip,mw_approved:wip,mw_integrating:wip,mw_changes_requested:wip,mw_failed:wip,mw_needs_attention:wip,mw_cancelled:frozen,mw_superseded:frozen"`.
   Выполнять ли её сейчас — решение владельца.
2. **`bd init` в `packages/beads-adapter` не бандлится в контроллер.** Адаптер — отдельный пакет,
   который регистрируется через `myworkAdapters`. Нужно ли добавлять его строку в публикуемый
   bundle контроллера, или он ставится независимо (как в §44), — не решено этой карточкой.

---

## 9. Воспроизведение проверок

1. `pnpm install && pnpm run check` — ожидается exit 0: 276 pass, 0 fail, 23 skip.
2. Реальные проверки: `pwsh -NoProfile -File .tmp/mw010-real-bd.ps1` — 15/15.
   Требует `bd` 1.3.0 в `PATH`; воркспейсы создаются вне дерева репозитория и удаляются в конце.
3. Приёмка по коду (не по тестам): `packages/beads-adapter/src/adapter.ts`
   (`requireCapability`, `claim`, `transition`, `mutatePlan`, `doctor`), `src/mapping.ts`
   (`TASK_STATE_TO_BEADS_STATUS`, `priorityFromBeads`, `satisfiesDependency`).
4. Mutation-проверки §5.2: ломать собранный `packages/beads-adapter/lib/adapter-*.js`
   по указанным строкам, ожидать падение, восстанавливать из копии.
5. «Домен не знает имя провайдера» независимо:
   `node --test --test-isolation=none tests/adapters.test.mjs` — проверка «core and contracts keep
   no provider-specific branch» сравнивает **код после снятия комментариев** и проходит.
   Прямой grep по сырому тексту даёт **шесть вхождений слова `beads` в комментариях и примерах**
   (`contracts/src/authority.ts:11`, `config.ts:72` — из прежних карточек;
   `taskgraph.ts:4,87,148,282` — мои). Ни одно не является идентификатором или ветвлением: после
   снятия комментариев не остаётся ни одного. Названо честно — grep по сырому тексту здесь не пуст,
   значим только отфильтрованный скан.
6. Что адаптер не тронул воркспейс:
   `bd list --json` в корне репозитория → `[]`; `bd config get status.custom` → исходное значение.
7. Полнота коммитов (§5.4), воспроизводимо:
   ```text
   git worktree add --detach .tmp/verify HEAD
   cd .tmp/verify && pnpm install --frozen-lockfile && pnpm run check
   cd ../.. && git worktree remove --force .tmp/verify
   ```
   Ожидается exit 0 и 276 pass / 0 fail на дереве, где нет ни одного нетрекованного файла.
8. Состав индекса: `git ls-files | Select-String '/lib/|\.beads/|\.dolt/|\.rar$'` — совпадения
   только `tests/lib/*` и `scripts/lib/*`, то есть исходники; собранных `packages/*/lib/` и
   состояния Beads в индексе нет.
