# 30 — Правки карточек и определения новых карточек (v0.3)

**Владелец:** `card-ledger` · **Кампания:** v0.3 (старт 2026-09-26)
**Вход:** `.work/tasks/MW-001.md`…`MW-055.md`, `.work/tasks/tasks.json`, `.work/tasks/INDEX.md`, легаси-леджер доски, `.work/reports/**`, `00-RECON.md`, `01-MASTER-PLAN.md`, `FINAL-REPORT.md` §7.4/§9.1, evidence-файлы кампании.
**Выход:** (1) правки **55** существующих карточек (57 правок); (2) определения **20** новых карточек — диапазон `MW-056`…`MW-076`, заняты `MW-056`…`MW-074` и `MW-076`; **отклонены по правилу 70 %:** `MW-075` (инвентаризация `done`-карточек — в `MW-071`, упаковка v0.1 — в `MW-041`), номер `MW-072` переиспользован под каркас `packages/web` вместо отклонённой карточки `HumanDecision` (её работа — в `MW-030`); (3) правила управления леджерами.
**Ни один файл `.work/tasks/**` этим документом не изменён** — только описаны правки (границы `00-RECON.md` §1.1).

---

## 0. Метод и что именно проверено

### 0.1. Как читались карточки

Все 55 карточек прочитаны одним структурированным дампом: из каждого файла выведены все содержательные строки с номерами (заголовок, `Этап:`, `Зависимости:`, `Board ID:`, `Обязательные пункты §62:`, строка `Архитектура:` с якорями `§NN (строка N)`, строка `Решения: ADR0NN`, `Объём:`, `Приёмка:`, путь отчёта). Шаблонный текст (строки «Выполни только…», «Проект:…», «Сначала прочитай…», «Ограничения исполнения:…», «Не выполняй push/merge/publish/release») исключён как идентичный во всех 55 файлах — это проверено, а не принято на веру (см. §0.3, п. 4).

Команда: `pwsh .tmp/plan-v03-cards/dump-substantive.ps1` → `wrote .tmp/plan-v03-cards/cards-substantive.txt bytes=142080`, `total chars=98284`.
Скрипты кампании: `.tmp/plan-v03-cards/{overview,inventory,board-cross,actions,dump-substantive,check-deps}.ps1`.

### 0.2. Формат карточки (проверен, а не предположен)

| Строка | Содержимое | Вариативность |
|---|---|---|
| 1 | `# MW-0NN — <title>` | всегда |
| 3 | `Этап: <phase>` | у MW-027/035 дописано `   (superseded)` |
| 4 | `Зависимости: <MW-… \| нет>` | всегда |
| 5 | `Board ID: <uuid>` или `Board ID: не создана — карточка принадлежит доске MyWork, а не legacy ledger` | 34 uuid / 21 «не создана» |
| 6 | `Обязательные пункты §62: <список \| пусто>` | пусто у 20 карточек |
| 8 | `## Prompt для агента` | всегда |
| 14 | `Архитектура: …Нужные разделы: §NN (строка N)…` | **4 карточки содержат `(строка undefined)`** |
| 15 | `Решения: ADR0NN…` | только у 15 карточек |
| 16/17 | `Объём:` + текст | всегда |
| 19/20 | `Приёмка:` + текст | всегда; **отдельного заголовка `## Приёмка` нет ни в одной карточке** |
| 22–24 / 23–25 | ограничения исполнения + путь отчёта | идентичны во всех 55 |

Следствие: проверка «нет раздела `## Приёмка`» дала ложные 55/55 — приёмка есть, но оформлена как строка внутри `## Prompt для агента`. В плане это надо знать, чтобы не «чинить» несуществующий дефект.

### 0.3. Проверки, выполненные скриптами (числа воспроизводимы)

1. **`tasks.json` согласован с `INDEX.md`.** `pwsh .tmp/plan-v03-cards/inventory.ps1` → секции «INDEX.md STATUS VS tasks.json STATUS (mismatches)», «dependsOn: tasks.json vs INDEX.md (normalized)», «titles json vs index» — **все три пусты**. Итог: 55 записей, `planRevision=2`, `schemaVersion=1`, `planned=53`, `superseded=2` (MW-027, MW-035).
2. **Числа приёмки новых карточек расходятся с леджером.** `.work/tasks/tasks.json` — 55 задач; ФИНАЛ-отчёт и карточки MW-054/055 говорят о «41 карточке реального ledger» — это **другой** леджер (легаси-доска), не `tasks.json`. Смешивать их в одной формуле нельзя.
3. **7 карточек врут про Board ID.** `pwsh .tmp/plan-v03-cards/board-cross.ps1`: `board-export.json` содержит 41 задачу, `revision=82`, `ledgerId=21d3414b-…`, `workspaceId=3fc33afb-…`, все 41 в `backlog`, `executions` пуст. При этом **34 карточки** называют UUID, который в этом леджере есть, а **7 карточек** (`MW-010, MW-011, MW-025, MW-029, MW-036, MW-037, MW-041`) пишут «Board ID: не создана», хотя их задачи в леджере **есть** — под другими UUID. Обратная сверка «задачи леджера, на которые не ссылается ни одна карточка» даёт ровно эти 7 (см. §1.1).
5. **Битые якоря.** `Select-String -Path '.work\tasks\MW-*.md' -Pattern 'строка undefined'` → 4 файла, 8 якорей: MW-025 (§26), MW-036 (§6, §14), MW-037 (§25, §56), MW-041 (§63, §64, §66). Это прямое нарушение правила `00-RECON.md` §1.2 («номера строк указываются, только если проверены»).
6. **Разрыв в графе зависимостей.** MW-038 (`planned`) зависит от MW-027 — карточки в статусе `superseded`. Единственный такой случай среди запускаемых карточек (второй — MW-035 → MW-027, но MW-035 сам `superseded`). Проверено скриптом (§0.3 п. 1 + `check-deps.ps1`).
7. **Пакеты реализованы, отчёты есть.** `Test-Path` → все 12 каталогов `packages/*` существуют; отчёты есть у 22 карточек (MW-001…MW-020, MW-042, MW-043; 34 файла). У MW-011 — 8 отчётов, у MW-026 — **ни одного**.
8. **`autoRun*` и колонки `todo`/`running` в легаси-леджере отсутствуют.** `pwsh .tmp/plan-v03-cards/actions.ps1` по `board-actions.json` (214 448 Б) и `board-export.json` (193 386 Б): `'autoRun' x0`, `'"todo"' x0`, `'"running"' x0`, `backlog x41`, `failed x2` (оба вхождения — в прозе `description`/`prompt`, а не как статус). Живой леджер не знает ни `todo`, ни `running`, ни `autoRun` — это подтверждает правку MW-054 (см. §2.9).

### 0.4. Ограничение по субагентам (не выполнено требование §6 брифа)

`00-RECON.md` §6 требует минимум 4 субагента. **Не выполнено:** `subagent` из сессии участника падает с `Error: subagent depth 2 exceeds maxDepth 1` (участник на глубине 1 при `maxDepth=1`). Lead подтвердил ограничение и разрешил вариант (б): инвентаризация выполнена самим участником скриптами и выборочным чтением; каждое утверждение снабжено командой. Причина зафиксирована здесь, а не спрятана; компенсация — `.work/plan-v0.3/evidence/cards-01.md`.

### 0.5. Раздел «Опровержения базы» (`00-RECON.md` §3)

| Утверждение брифа | Что найдено | Источник |
|---|---|---|
| §3.1: «`tasks/` (55 карточек + `tasks.json` + `INDEX.md` + легаси-JSON доски)» | Верно, но легаси-JSON — **три** файла разного назначения: `board-export.json` (193 386 Б, снапшот леджера), `board-actions.json` (214 448 Б, план действий), `board-before.json` (438 Б). Считать их одним источником нельзя | `Get-ChildItem .work\tasks` |
| §3.4 п. 4 / §7.4: «9 падений на `done`-карточках» | В снапшоте леджера от 2026-09-16 **все 41 задача в `backlog`, `executions` пуст** → 9 падений относятся к состоянию **позже** снапшота; снапшот их не подтверждает и не опровергает. Проверка — за живым леджером (evidence Lead'а), а не за этим файлом | `board-cross.ps1` |
| §9.1 (MW-013/034): «`providerConcurrency`» | `providerConcurrency` в платформе **не существует**: 0 совпадений во всём DSH-checkout; в `packages/llm/llm/src` нет `concurren|inFlight|semaphore`. Аналоги: `maxParallelToolCalls` (`packages/core/agent-loop/src/index.ts:334-335`, `tool-calls.ts:132,200`), `maxParallelSubCalls` (`packages/core/tools/src/index.ts:796-800`) | `evidence/quality-04.md:13` |
| §9.1 (MW-024/D15): «`auto-review` — только deny» | Режима «только deny» у `experimental-auto-review` **нет**: решения — `low+allow`, `medium+allow|deny`, `high+deny`; `rg 'denyOnly|deny-only|deny_only'` по `packages` → нет совпадений. Корректная формулировка: **не монтировать `auto-review` вовсе** (совпадает с `01-MASTER-PLAN.md`) | `evidence/quality-05.md:47-51` |
| §3.1: «12 пакетов, все `private: true`» | Подтверждено; дополнительно: `planner`, `evidence`, `memory-native`, `execution`, `scheduler` **не имеют ни одного рантайм-импортёра** в `packages/**/src`; `tsconfig.base.json:30-38` не содержит path-алиасов для `planner` и `memory-native` | `evidence/quality-01.md:9-10,16-17,22` |

### 0.6. Адресация: только символьные ID (правило §15.6 мастер-плана)

**Ни одна ссылка в этом файле не указывает на номер строки живого документа.** Все ссылки — на ID: решение `D01…D20`, шаг `F-NN`/`E-NN`/`B-NN`/`Q-NN`, карточку `MW-0NN`, ADR-0NN. Это требование канонического правила 6 мастер-плана («ссылаться на **шаги и карточки**, а не на номера строк: план правится параллельно, и 32 из 32 ссылок вида `10-DECISIONS.md:NNN` уже устарели»). Номера строк сохранены только там, где они относятся к **неизменяемым** объектам: исходный код (`packages/...:NN`), карточки `.work/tasks/MW-0NN.md:NN`, замороженный `FINAL-REPORT.md:NNN` и evidence-файлы кампании.

**Источники фактической нумерации шагов:** `20-STEPS-foundation.md` §0.1 («Сводная карта шагов»), `21-STEPS-execution.md` §2 («Порядок работ и карта шагов»), `22-STEPS-surface.md` §1a, `23-STEPS-quality.md` §0.5 («Порядок и зависимости»).

| Предварительный ID мастер-плана | Фактический шаг |
|---|---|
| `F`-гейт прав профиля (этап 0) | `F-04` (+ доказательство `F-06`); `F-01` — bootstrap `pnpm`, `F-02`/`F-03` — копия и восстановление профиля |
| `F`-правило `done` | `F-08` (правило) → `F-09` (инвентаризация) → `F-27` (сверка `done`-множеств) |
| `F`-`bd`-seam | `F-13`, `F-14`, `F-15`, `F-16`; тест `batch`-рёбер — `F-21`, актор `heartbeat` — `F-22` |
| `F`-миграции и состояние | реестр — `F-18`, запрет открытия без него — `F-19`, journal — `F-20`, атомарность — `F-33`/`F-34`, WAL — `F-35` |
| `F`-CI, тег, `pack.mjs` | `F-23`, `F-24`, `F-25` |
| `F`-леджеры и производный `INDEX.md` | `F-26` |
| `F`-composition root | `F-28`…`F-32` |
| `F`-durable jobs, retention, boundary | `F-36`/`F-37`; `F-38`/`F-39`/`F-40`; `F-41`/`F-42` |
| `F`-model availability, session conformance | `F-43`; `F-44`; достижимость — `F-45` |
| `F`-peer, публикуемость, бюджет, OTel, worker, UI-пакет | `F-47`…`F-50`; `F-51`…`F-53`; `F-54`/`F-55`; `F-56`/`F-57`; `F-58`/`F-59` |
| Doctor по профилю и `bd`-seam | `Q-31`, `Q-32` |
| Инсталлируемость UI-пакета | `F-58`, `F-59`; каркас пакета — `B-01a` (карточка `MW-072`) |
| Архивация `superseded` | `F-07` — совпадает |

**Поправка, требующая решения владельца:** шаги `F-57` (`20-STEPS-foundation.md`) и `E-40` (`21-STEPS-execution.md`) названы «`auto-review` только deny», но такого режима у пакета не существует, а сам плагин **активен** в живом профиле (`enabled: true`, `fiberPhase: active`). Корректная формулировка применена в правке C-18 и в карточке `MW-069`: авто-вердикт `allow` не является review-approval, а «выключить `auto-review`» — отдельное решение владельца, а не предпосылка приёмки.

---

## 1. Находки леджеров, требующие решений (сводка)

### 1.1. `Board ID:` — производный факт, записанный в карточку руками

`Board ID:` в шапке карточки — это копия факта из живого леджера. Копия разошлась:

- 34 карточки: записанный UUID **есть** в `board-export.json` → копия верна на момент снапшота.
- 7 карточек (`MW-010`, `MW-011`, `MW-025`, `MW-029`, `MW-036`, `MW-037`, `MW-041`): написано «не создана», а задача в леджере **есть** (сверка «задачи леджера без карточки» вернула ровно эти 7: `352f3912-…` MW-010, `261037d9-…` MW-011, `da617bd1-…` MW-025, `025a73a1-…` MW-029, `cccb16bb-…` MW-036, `82c39792-…` MW-037, `d61d6871-…` MW-041).
- 14 карточек (`MW-042`…`MW-055`): «не создана» — верно, в леджере их нет.
- 3 расхождения **заголовков**: MW-011 «…staged activation и replanning» против леджера «…replanning и WorkProposal»; MW-036 «Team Work, Roles и Settings» против «Team Work, Roles, Workflows и Settings».

**Решение (часть 3):** `Board ID:` удаляется из карточек; соответствие «карточка ↔ задача доски» живёт в производном артефакте (`INDEX.md` + поле `boardTaskId`), а не в двух местах. До введения производного артефакта — правило «при расхождении истина у леджера, карточка правится».

### 1.2. Четыре источника статуса — фактическое состояние на момент проверки

| Источник | Что говорит | Команда проверки |
|---|---|---|
| `.work/tasks/tasks.json` | 55 задач: `planned=53`, `superseded=2` | `inventory.ps1` |
| `.work/tasks/INDEX.md` | то же (0 расхождений по title/status/deps) | `inventory.ps1` |
| `.work/reports/*` | отчёты есть у 22 карточек; 21 отчёт содержит «Статус: **DONE**», `MW-043-idea-bank.md:3` — «**Статус: BLOCKED.**» | `reports`-скрипт (§3.1) |
| живой леджер доски (снапшот 2026-09-16) | 41 задача, все `backlog`, `executions` пуст | `board-cross.ps1` |

**Вывод:** «done» существует **только** в отчётах. В леджере доски и в `tasks.json` ни одна карточка не `done`. Это и есть «тихое расхождение двух authority» (§7.3 RT-8) в чистом виде, и это же объясняет, почему «9 падений на `done`-карточках» невозможно воспроизвести по снапшоту: отчёты говорят `DONE`, леджер говорит `backlog`, а падения жили в третьем состоянии, не сохранённом в файле экспорта.

### 1.3. Найденные дефекты карточек (не мнения)

| # | Дефект | Карточки | Доказательство |
|---|---|---|---|
| 1 | Зависимость от `superseded`-карточки | MW-038 | `tasks.json`: `MW-038.dependsOn` содержит `MW-027`; `MW-027.status='superseded'` |
| 2 | `(строка undefined)` в якорях архитектуры | MW-025, MW-036, MW-037, MW-041 | `Select-String 'строка undefined'` → 4 файла, 8 якорей |
| 3 | `Board ID` противоречит леджеру | MW-010, 011, 025, 029, 036, 037, 041 | §1.1 |
| 4 | Числа приёмки не воспроизводятся | MW-054, MW-055 | §2.9, §2.10 |
| 5 | Приёмка требует механики, которой нет в контрактах | MW-050 (4 пункта), MW-049 (9 панелей), MW-042 (9 зон при D02) | `evidence/quality-02.md:20` (`ReviewState 'escalated'` — тупик), `board.ts:356,373` (`NeedsAttentionReason` без носителя) |
| 6 | Устаревший блокер | MW-043 | 8 отчётов MW-011 против 0 отчётов MW-026 |

---

## 2. Часть (1) — правки существующих карточек MW-001…MW-055

Формат каждой правки: **`ID · что меняется (дословно: было → стало) · почему (источник) · приёмка до/после`**.
Номера строк — из фактических файлов на момент проверки (`.tmp/plan-v03-cards/cards-substantive.txt`).

### 2.1. Foundation: MW-001…MW-009

#### C-01 · MW-001 — закрыть вопрос `failed` при двух отчётах (D19)

- **Карточка:** MW-001, строка 20 (текст приёмки).
- **Было (строка 20):**
  `Матрица supported/unsupported/unverified содержит ссылки на источники или результаты безопасных проб. Отсутствующие критические capabilities явно блокируют соответствующие задачи. Не запускать платные LLM-пробы и не чинить чужие проекты.`
- **Стало (строка 20, добавлено в конец):**
  `Статус карточки в леджере не может оставаться failed при наличии двух отчётов (.work/reports/MW-001-target-capabilities.md и .work/reports/MW-001-review.md): карточка закрывается как done-with-report либо перепрогоняется; решение и обоснование фиксируются строкой в отчёте.`
- **Почему:** `01-MASTER-PLAN.md` («MW-001 — закрыть как `done-with-report` (два отчёта есть) или перепрогнать»); `FINAL-REPORT.md:396` (MW-054 preview: «MW-001 помечен failed, хотя отчёты существуют»); два отчёта подтверждены `Get-ChildItem .work/reports -Filter 'MW-001*'` → `MW-001-review.md` 25 739 Б, `MW-001-target-capabilities.md` 48 011 Б. Решение D19.
- **Приёмка до:** «Матрица supported/unsupported/unverified содержит ссылки…».
- **Приёмка после:** то же + строка про `failed`/`done-with-report`; гейт: `Select-String '.work/reports/MW-001-*.md' -Pattern 'Статус'` → ровно одна строка с итоговым статусом, и она совпадает со статусом в леджере.

#### C-02 · MW-004 — канонический список миграций, journal, атомарность, retention

- **Карточка:** MW-004, строка 17 (объём) и строка 20 (приёмка).
- **Было (строка 17):**
  `Хранить runtime state вне пользовательского репозитория под DSH_HOME/dsh-mywork. Ввести schemaVersion, миграции, WAL, транзакции mutation+outbox и inbox event dedup. Добавлять таблицы по реально реализованным сущностям, не создавать speculative repositories.`
- **Стало (строка 17):**
  `Хранить runtime state вне пользовательского репозитория под DSH_HOME/dsh-mywork. Ввести schemaVersion, единый реестр MYWORK_DATABASE_MIGRATIONS и запрет открытия store без него, WAL, транзакции mutation+outbox и inbox event dedup, атомарную запись производных данных (temp+rename; withFileLock там, где писателей больше одного). Канонический список миграций и журнал с verify-шагом — предмет MW-059; карточка обязана его использовать, а не собирать спред у вызывающего. Добавлять таблицы по реально реализованным сущностям, не создавать speculative repositories.`
- **Было (строка 20):**
  `Повторный event не меняет результат; restart сохраняет данные; сбой между mutation и commit не оставляет половину изменения. Тесты работают в временной директории и не используют живую DSH БД.`
- **Стало (строка 20):**
  `Повторный event не меняет результат; restart сохраняет данные; сбой между mutation и commit не оставляет половину изменения. Тесты работают в временной директории и не используют живую DSH БД. store открывается только через канонический список миграций: openStore без него падает типизированной ошибкой MIGRATIONS_REQUIRED, а не поднимает частичную схему. Прерывание между migrate и verify не даёт silent empty-state: состояние восстанавливается по journal. Атомарность записи проверяется тестом, который убивает процесс между temp-записью и rename и не теряет предыдущую версию.`
- **Почему:** `evidence/quality-02.md:21-26` (`MYWORK_MIGRATIONS = Object.freeze([OUTBOX_INBOX])` — ровно одна миграция, `storage/src/migrations.ts:91`; журнал `schema_migrations` там же `:97-103`; миграции по доменам `EVIDENCE_MIGRATIONS`, `LEASE_MIGRATIONS`, `CLAIM_SAGA_MIGRATIONS`, `PLAN_MUTATION_MIGRATIONS`; «Композиция — спред у вызывающего (`planner/src/index.ts:20-23`, `execution/src/schema.ts:31-34`), единого composition root нет»); `01-MASTER-PLAN.md` (шаги F-21/F-22); D08; `FINAL-REPORT.md:407`; RT-1/RT-10; §8.2 P5.
- **Приёмка до:** 3 пункта (идемпотентность, restart, половинчатый commit).
- **Приёмка после:** 6 пунктов; новый гейт `node --test tests/storage/migrations-registry.test.mjs` → `pass 1 / fail 0`, и `openStore({migrations: []})` → `MIGRATIONS_REQUIRED`.

#### C-03 · MW-007 — runtime-enforcement прав через платформенные швы

- **Карточка:** MW-007, строка 17 (объём), строка 20 (приёмка).
- **Было (строка 17):**
  `Применять полномочия роли к filesystem/shell/network/MCP/secrets/git/task/review transitions в runtime. Reviewer по умолчанию read-only для implementation; credential references вместо секретов. Использовать штатную авторизацию DSH.`
- **Стало (строка 17):**
  `Применять полномочия роли к filesystem/shell/network/MCP/secrets/git/task/review transitions в runtime. Enforcement выполняется платформенными швами: ctx.sandboxPolicy.resolve(request) и события fs-observation-policy (fs/write-intent, fs/edit-intent, fs/observed; правка без предшествующего чтения → FS_NOT_OBSERVED); свой параллельный слой прав не строится. Reviewer по умолчанию read-only для implementation; credential references вместо секретов. Использовать штатную авторизацию DSH (ctx.approval, ctx.credentials, ctx.authorization).`
- **Стало (строка 20, добавлено):**
  `Отказ приходит из платформы, а не из собственной проверки: тест фиксирует событие платформенного слоя и отсутствие второго (собственного) запрета. Права роли не расширяются ни prompt'ом, ни памятью, ни learning'ом.`
- **Почему:** D15 (`01-MASTER-PLAN.md`); `FINAL-REPORT.md:408` (G-S1); `evidence/quality-05.md:39-40,42` (`sandboxPolicy.resolve`, `overrideOf`; `fs-observation-policy` — event-only, сервиса не регистрирует, `FS_NOT_OBSERVED`; `approval` policy `'ask'|'never'`).
- **Приёмка до:** path/worktree escape, self-approval, чужой workspace, эскалация; prompt/memory не расширяют права; неизвестная capability не даёт разрешение.
- **Приёмка после:** то же + явный пункт «источник отказа — платформенный шов»; гейт: тест на запрещённое действие проверяет событие платформы, а не коды собственного модуля.

#### C-04 · MW-010 — запрет `skipped` в CI-профиле и разбор двух capability

- **Карточка:** MW-010, строка 21 (текст приёмки, ~2 200 символов).
- **Было (строка 21, дословная цитата, ключевой фрагмент):**
  `…Доказано экспериментом: frozen-блокер оставляет зависимого заблокированным, wip-статусы не появляются в bd ready, единственный ready-статус — open. Контрактные тесты работают на воркспейсе ВНЕ дерева репозитория: bd отказывается создавать вложенный воркспейс, а любая команда из подкаталога репозитория попадает в воркспейс предка.`
- **Стало (строка 21, добавлено в конец):**
  `Ни один тест реального backend не может быть skipped в CI-профиле: skipped-тест считается падением, а причина скипа обязана называть отсутствующую capability. Две capability, объявленные как available, но не подтверждённые пробой, переводятся в unverified до подтверждения — иначе AdapterCapabilityManifest лжёт. Разрешение двух оставшихся capability — предмет MW-056 и MW-057; карточка обязана приложить их результат, а не объявлять по имени.`
- **Почему:** `FINAL-REPORT.md:410` («Дополнить приёмку: „ни один тест реального backend не может быть skipped в CI-профиле“; разобраться с двумя capability. Ложное done уже случилось»); `F 3.2/3.3, P2/P3`; `01-MASTER-PLAN.md` (гейт этапа 1: `pass 70 / fail 0 / skipped 0`), `:348` (23 skip → 0); MW-010 собственный отчёт: «`pnpm run check` = exit 0 (**276 pass / 0 fail**, 23 skip)» — то есть 23 скипа уже зафиксированы.
- **Приёмка до:** объявляет `bd ready`/`bd blocked` единственным источником готовности и запрещает `is_blocked`, но допускает skip.
- **Приёмка после:** то же + `skipped 0` в CI-профиле; гейт `node --test tests/beads-adapter.test.mjs` → `pass 70 / fail 0 / skipped 0`.

#### C-05 · MW-011 — тот же запрет `skipped` + границы staged-мутации

- **Карточка:** MW-011, строка 21.
- **Было (строка 21, ключевой фрагмент):**
  `…После kill контроллера в середине применения recovery и пауза admission сохраняются; resume доводит план с пройденной integrity verification; revert восстанавливает прежний набор зависимостей; ни один путь не оставляет частично видимого DAG.`
- **Стало (добавлено в конец строки 21):**
  `Ни один тест staged-мутации не может быть skipped в CI-профиле: `batch-dep-remove`, на котором держится staged-план (ADR024), обязан быть подтверждён живой пробой, а не объявлен по имени. Пока MW-056 не закрыт, карточка остаётся READY_FOR_REVIEW и не переводится в done: 23 скипа в прогоне MW-010 означают, что основание staged-пути не доказано.`
- **Почему:** `FINAL-REPORT.md:410`; `01-MASTER-PLAN.md` («без этого MW-010/MW-011 остаются недоказуемыми, а на `batch-dep-remove` стоит staged-план MW-011/ADR024»); отчёт MW-011 сам перечисляет открытыми MINOR-12 (пауза admission в общем `lease`), остаток MINOR-10 (ребро между двумя существующими задачами) и §9 п. 4 (тупик принятых id без чтения `externalRef`) — приёмка их не закрывает.
- **Приёмка до:** staged-мутация, integrity verification, recovery, идемпотентность, отсутствие частично видимого DAG.
- **Приёмка после:** то же + `skipped 0` и явный список трёх открытых пунктов, которые приёмка не закрывает.

#### C-06 · MW-013 — бюджетный circuit-breaker поверх `dsh-token-meter`

- **Карточка:** MW-013, строка 17 (объём), строка 20 (приёмка).
- **Было (строка 17):**
  `Использовать реальный DSH model catalog: preferred/fallback/escalation, provider availability и context window. Добавить limits tokens/cost/attempts/review loops/planner/optimizer/workspace/provider; route записывать в provenance. Для разработки default — OpenCode Go Flash без автоматического перехода на платную frontier-модель.`
- **Стало (строка 17):**
  `Использовать реальный DSH model catalog: preferred/fallback/escalation, provider availability и context window. Добавить limits tokens/cost/attempts/review loops/planner/optimizer/workspace/provider; route записывать в provenance. Circuit-breaker поверх платформенного @deepseek-ai/dsh-token-meter (TokenMeter.measure(session, requestHeader), ctx.tokenMeter) + счётчик шагов агентского цикла; второй учёт токенов не строится — используется существующий packages/core/src/budget.ts (knownAmount/addAmounts/chargeConsumption/decideBudgetAdmission). Лимит провайдерной параллельности заводится в BUDGET_LIMIT_NAMES: providerConcurrency в платформе отсутствует (0 совпадений), аналоги — maxParallelToolCalls и maxParallelSubCalls. Для разработки default — OpenCode Go Flash без автоматического перехода на платную frontier-модель.`
- **Стало (строка 20, добавлено):**
  `Бюджетный учёт не является мёртвым кодом: chargeConsumption/readCallTokens/modelCallCost вызываются на production-пути, а не только из тестов; тест доказывает, что снятие вызова меняет вердикт admission. Превышение лимита шагов и стоимости даёт типизированную остановку с эскалацией в needs-attention, а не молчаливое продолжение.`
- **Почему:** D05 (`01-MASTER-PLAN.md`, `:313`); F-33; RT-2 (`FINAL-REPORT.md:432`); `evidence/quality-04.md:12-13,18-21` (у `TokenMeter` нет cost/валюты и лимитов, `validateConfigKeys` бросает на любой ключ; `providerConcurrency` — 0 совпадений; **production-запись бюджета ровно одна** — `core/src/scheduler.ts:568`; `chargeConsumption/readCallTokens/modelCallCost` в production не вызываются).
- **Приёмка до:** FakeProvider проверяет лимит на границе, outage, отсутствие маршрута; неизвестные cost/usage не ноль; исчерпание останавливает admission.
- **Приёмка после:** то же + «учёт не мёртв» и «превышение шагов → needs-attention»; гейт `node --test tests/budget.test.mjs` → pass, плюс тест-мутация удаления вызова `chargeConsumption` ловится.

#### C-07 · MW-015 — session conformance и runtime-enforcement прав сессии

- **Карточка:** MW-015, строка 17 (объём), строка 20 (приёмка).
- **Было (строка 17):**
  `По MW-001 реализовать create/resume/stop/status/events, model selection, scoped system prompt/dynamic context и tool surface. Использовать публичные DSH API; сохранять реальные session IDs и route.`
- **Стало (строка 17):**
  `По MW-001 реализовать create/resume/stop/status/events, model selection, scoped system prompt/dynamic context и tool surface. Использовать публичные DSH API; сохранять реальные session IDs и route. Scoped permissions обеспечиваются платформенным runtime-enforcement (sandboxPolicy.resolve + fs-observation-policy, см. MW-007), а не собственным реестром. Отказы маршрутизации не схлопываются в один unavailable: типизированный RouteRefusalReason, включая model-not-routable, — предмет MW-070.`
- **Стало (строка 20, добавлено):**
  `Session conformance покрывает восемь политик, включая read-only, danger-full-access и «нет живого агента»; четыре разных отказа маршрутизации различимы в коде и в отчёте, а не сведены к unavailable.`
- **Почему:** F-28 (`01-MASTER-PLAN.md`: «`ModelAvailabilityPort`, `RouteRefusalReason: model-not-routable`, 8 тестов политик (`read-only`, `danger-full-access`, «нет живого агента»), перестать схлопывать 4 отказа в `unavailable`»); D15; D20; `evidence/quality-05.md:39-40`.
- **Приёмка до:** contract checks на stop/cancel, missing Session, duplicate/late event, restart; scoped permissions и model binding сохраняются.
- **Приёмка после:** то же + 8 политик и различимость отказов; гейт — таблица «политика → ожидаемый типизированный отказ» в отчёте.

#### C-08 · MW-005 — необязательность «пакета на каждый пункт» и boundary-проверка

- **Карточка:** MW-005, строка 20 (приёмка).
- **Было (строка 20):**
  `Несовместимая версия и ложная/отсутствующая required capability дают явный отказ. Совместимый fake регистрируется/удаляется. Core не ветвится по имени провайдера.`
- **Стало (строка 20, добавлено):**
  `Boundary-проверка распространяется на adapter-sdk: ни один пакет ядра не импортирует @deepseek-ai/dsh*, bd, http и react, и проверка сканирует scheduler, planner и adapter-sdk, а не только contracts/core (сейчас planner не сканируется вовсе).` **Проверено на 0.2.0-rc.2 (2026-10-03):** утверждение верно и версионно-независимо — `tests/boundaries.test.mjs:26-34` банит `@deepseek-ai/` по префиксу, `:41` разрешает только `@deepseek-ai/cordis`; при этом расширение F-25 в дереве **уже реализовано**: сканируются `scheduler`, `planner`, `adapter-sdk`, `memory-native`, `gate-runner`, `worktree-adapter`, `controller`, `beads-adapter` (`tests/boundaries.test.mjs:671-695,716-778`), а не только `contracts`/`core`, — правку C-08 применять как уточнение формулировки приёмки, а не как новую работу.
- **Почему:** F-25 (`01-MASTER-PLAN.md`: «Boundary-тест: расширить `FORBIDDEN` до `@deepseek-ai/dsh*`, сканировать `scheduler`/`planner`/`adapter-sdk` (сейчас дыра подтверждена экспериментом)»); `FINAL-REPORT.md:383` (P25); `evidence/quality-01.md:16-17` (`tsconfig.base.json:30-38` без алиасов planner/memory-native).
- **Приёмка до:** 3 пункта.
- **Приёмка после:** 4 пункта; гейт — `node --test tests/boundaries.test.mjs` падает при искусственном DSH-импорте в `scheduler/src`.

#### C-09 · MW-009 — lease/epoch как опора single-writer, а не второй слой

- **Карточка:** MW-009, строка 20 (приёмка).
- **Было:** `Два Controller не становятся writer одновременно. FakeClock проверяет expiry/failover; старый epoch не коммитит изменения после передачи leadership. Открытая вкладка не нужна для lifecycle.`
- **Стало (добавлено):** `Epoch контроллера участвует в CAS каждой мутации, включая новые сущности HumanDecision и DropIntent-резолвер: мутация со stale epoch отвергается типизированно и не пишет ни одной строки.`
- **Почему:** D14 (`01-MASTER-PLAN.md`: «CAS по `expectedRevision`+`controllerEpoch`»); `FINAL-REPORT.md:402`; единый механизм вместо второго слоя (принцип 1, `01-MASTER-PLAN.md`).
- **Приёмка до:** 3 пункта. **После:** 4 пункта; гейт — тест на мутацию со stale `controllerEpoch` → `STALE_EPOCH`, `revision` не изменён.

### 2.2. Context: MW-016…MW-020

#### C-10 · MW-016 — L2 через `ctx.spillStore`, промпт через `systemPrompt.section`

- **Карточка:** MW-016, строка 17 (объём).
- **Было:** `Реализовать discover → rank/budget → materialize, L0/L1/L2, mandatory role/task/security и working/safety reserve от выбранной модели. Snapshot фиксирует revisions, route, tools, hashes, estimates и provenance. Только Fabric вставляет контекст в prompt.`
- **Стало (добавлено в конец):** `Тяжёлые L2-блоки offload'ятся через платформенный ctx.spillStore (SpillStore.saveText → SpillRef; реализация @deepseek-ai/dsh-spill-local), а не собственной файловой свалкой. Вставка секции в системный промпт идёт через ctx.systemPrompt.section (PromptSection, scoped shadowing), а не строковой склейкой: одна точка вставки, один владелец.`
- **Почему:** D10 (`01-MASTER-PLAN.md`); принцип 1 (`:105`); `evidence/quality-05.md:36,44` (`SpillStore.saveText(input): Promise<SpillRef>`; `ctx.systemPrompt.section(section): () => void`, «scoped shadowing, non-finite order throws»).
- **Приёмка до:** L2 по запросу, revision/hash, overflow mandatory → блок admission, low-trust не instructions, snapshot неизменяем.
- **Приёмка после:** то же + spillStore как носитель L2 и `systemPrompt.section` как единственная точка вставки; гейт — тест, что выгрузка плагина снимает секцию (`dispose` возвращает функцию снятия).

#### C-11 · MW-017 — `SkillProvider` вместо собственного реестра discovery

- **Карточка:** MW-017, строка 17 (объём), строка 20 (приёмка).
- **Было (строка 17):** `Добавить версионируемые skills со scope/trust/compatibility/status и lifecycle Candidate/Active/Stale/Archived. Discover отдаёт L0/L1; body — только по materialize. Связать SkillContextProvider с Fabric.`
- **Стало (добавлено):** `Discovery и инвентарь skills отдаются платформенному шву SkillProvider там, где он покрывает требование; MyWork остаётся владельцем durable-версий, provenance и lifecycle Candidate/Active/Stale/Archived. Второй инвентарь skills не строится.`
- **Было (строка 20):** `Проверки scope, version pinning и lazy loading. Неподдерживаемый skill не активируется; обновление не меняет running Attempt. Не превращать memory records в skills автоматически.`
- **Стало (добавлено):** `Тест доказывает отсутствие второго инвентаря: список skills приходит из одного источника, и расхождение с платформенным швом даёт типизированную диагностику, а не тихое дублирование.`
- **Почему:** D10 (`01-MASTER-PLAN.md`); `FINAL-REPORT.md:307,425` (§7.2, §9.2(7)); принцип 1 и 7 (`:105,111`).
- **Приёмка до:** 3 пункта. **После:** 4 пункта; гейт — `Select-String packages -Pattern 'SkillProvider'` непусто, и ни один модуль не ведёт свой список skills.

#### C-12 · MW-018 — `MemoryProvider` как шов, MyWork как владелец durable-памяти

- **Карточка:** MW-018, строка 17 (объём).
- **Было:** `Ввести retain/recall/optional reflect, scopes/kinds/provenance/trust/validity, dedup/conflict/supersede lifecycle и один primary writer на scope. Реализовать Native и Disabled providers, MemoryContextProvider и явную degraded policy.`
- **Стало (добавлено):** `Провайдеры реализуются как реализации платформенного шва MemoryProvider, а не как параллельная фабрика: MyWork владеет durable-записями и provenance, платформа — точкой подключения. Тела memory-записей попадают под retention и сканер секретов (MW-062), а не только метаданные.`
- **Почему:** D10 (`01-MASTER-PLAN.md`); D17 (`:259`); `FINAL-REPORT.md:307,380` (§8.2 P22: «сканер секретов только по метаданным, не по телам»).
- **Приёмка до:** 4 пункта (изоляция workspace, idempotent retain, конфликт/устаревание, invalid ref/timeout, degraded policy, raw transcripts не в prompt).
- **Приёмка после:** то же + «тела записей проходят сканер и retention»; гейт — тест кладёт в тело memory-записи тестовый секрет-маркер и получает запись в отчёте сканера.

#### C-13 · MW-019 — второй внешний backend не добавлять; тела под сканер

- **Карточка:** MW-019, строка 20 (приёмка).
- **Было:** `Conformance: scope isolation, idempotency, invalid ref, timeout/cancel, backend unavailable, contract mismatch. Не имитировать unsupported reflect; не добавлять второй внешний backend ради списка.`
- **Стало (добавлено):** `Внешний backend обязан отдать тела записей для сканирования и не хранить секреты в метаданных; при отсутствии такой возможности карточка не закрывается. Выбор backend'а фиксируется ссылкой на результат MW-001, а не переизбирается.`
- **Почему:** D17; `FINAL-REPORT.md:380` (P22); `01-MASTER-PLAN.md`.
- **Приёмка до:** 4 пункта. **После:** 6 пунктов; гейт — таблица «capability backend'а → подтверждено пробой/нет».

#### C-14 · MW-020 — checkpoint через платформенные швы, без второго хранилища

- **Карточка:** MW-020, строка 17 (объём), строка 20 (приёмка).
- **Было (строка 17):** `Fresh Session per Attempt/Review/planning. Capsule содержит decisions, artifacts, base/head, verification/findings, unresolved и exact anchors. Реализовать prune/offload/dematerialize/compaction/rollover; окно меняется внутри той же Attempt.`
- **Стало (добавлено):** `Offload капсулы идёт через ctx.spillStore; поиск по прошлым сессиям — через ctx.sessionQuery (@deepseek-ai/dsh-session-query-sqlite, FTS5), а не собственным индексом транскриптов. Компакция опирается на события платформы (compaction/start|summary|end|prune) и её порог thresholdTokens, а не на свою эвристику.`
- **Стало (строка 20, добавлено):** `Retention капсул подчиняется окнам MW-062; прогон, удаляющий старые капсулы, уменьшает размер БД и не теряет ссылки на evidence.`
- **Почему:** D10, D17; `evidence/quality-05.md:35-36` (`session-query-sqlite` → `SqliteSessionQueryEngine extends SessionQueryEngine`, FTS5; `spillStore`); `evidence/quality-04.md:15` (`compaction/start|summary|end|prune`, `thresholdTokens=floor(min(contextWindow*thresholdRatio, pressureBudgetTokens))`, `compaction-basic/src/config.ts:191-194`).
- **Приёмка до:** 3 пункта. **После:** 4 пункта; гейт — тест retention уменьшает `controller.sqlite` после удаления старых капсул.

### 2.3. Execution: MW-021…MW-026

#### C-15 · MW-021 — `writeScopes` как диагностика, worktree-гигиена `.tmp`

- **Карточка:** MW-021, строка 17 (объём), строка 20 (приёмка).
- **Было (строка 17):** `Для coding Attempt pin base SHA, создать отдельную branch/worktree, хранить base/head/diff hash и workspace binding. Cleanup/retention только по policy, с проверкой resolved paths и dirty evidence.`
- **Стало (добавлено):** `writeScopes/fs-write-intent — диагностика и предупреждение, а не lock: пересечение scope не блокирует запись, а фиксируется событием. Worktree создаются только под .tmp/ с проверкой, что каталог не является посторонним зарегистрированным worktree (.tmp/mw012-review на момент анализа — 3 751 файл / 175 МБ, включая его).`
- **Почему:** RT-6 (`FINAL-REPORT.md:436`: «`writeScopes` — диагностика, не lock»); `01-MASTER-PLAN.md` (R-6); `FINAL-REPORT.md:330` (§7.4(8): `.tmp` раздут, посторонний worktree `.tmp/mw012-review`); `evidence/quality-05.md:40` (`fs/write-intent`, `fs/edit-intent` — события).
- **Приёмка до:** 3 пункта. **После:** 4 пункта; гейт — тест: пересечение writeScopes даёт событие и **не** отказ.

#### C-16 · MW-022 — запрет `cordis_*`, dynamic-инструментов и `plugin_manager` в поверхности worker'а

- **Карточка:** MW-022, строка 17 (объём), строка 20 (приёмка).
- **Было (строка 17):** `Связать scheduler → claim → worktree → frozen context → fresh Worker Session → evidence/checkpoint → settling. Identity остаётся долговечной; sleeping после завершения не держит модель. Worker не финализирует TaskGraph Done.`
- **Стало (добавлено в конец):** `Поверхность Worker Session не содержит cordis_* (dynamic-инструментов), plugin_manager и инструментов самостоятельного approve: список инструментов фильтруется при сборке сессии, а не по договорённости. Права роли обеспечиваются платформенным enforcement (MW-007).`
- **Стало (строка 20, добавлено):** `Тест проверяет список инструментов собранной сессии и падает при появлении cordis_-инструмента, dynamic-плагина или plugin_manager; попытка самостоятельной приёмки отвергается типизированно.`
- **Почему:** D15 (`01-MASTER-PLAN.md`); принцип 5 (`:109`); `FINAL-REPORT.md:406,415,433` (§9.1, §9.2(3), RT-3/RT-4); `evidence/quality-05.md:18-20` (`plugin_manager` — 8 действий, каждое эскалирует `danger-full-access`); новый носитель — MW-069.
- **Приёмка до:** 3 пункта. **После:** 4 пункта; гейт — тест состава инструментов воркера (белый список).

#### C-17 · MW-023 — гейты исполняются в CI, а не «где получилось»

- **Карточка:** MW-023, строка 20 (приёмка).
- **Было:** `Failing/missing gate блокирует review admission и Done. Gates относятся к exact head и имеют bounded timeout/cancel. Нельзя превратить ошибку инструмента в PASS.`
- **Стало (добавлено):** `Ни один гейт не может быть skipped в CI-профиле: skipped-гейт считается failed и называет причину. Гейт, чья команда не воспроизводится в CI (например, требует живого профиля), обязан объявить это как route-refusal, а не молча пропустить шаг.`
- **Почему:** R-9 (`01-MASTER-PLAN.md`); принцип 3 (`:107`); `FINAL-REPORT.md:410`; `01-MASTER-PLAN.md` (этап 1: `skipped 0`).
- **Приёмка до:** 3 пункта. **После:** 4 пункта; гейт — искусственный skip даёт failed в CI-профиле.

#### C-18 · MW-024 — `auto-review` не монтируется; человеческая приёмка по work type

- **Карточка:** MW-024, строка 17 (объём), строка 20 (приёмка).
- **Было (строка 17):** `Добавить отдельную Review очередь/pool, fresh Session, evidence package и structured findings. Approval привязать к reviewedHeadSha/diffHash. Reject возвращает ту же Identity/worktree с новой Attempt и checkpoint/findings; лимитировать review loops.`
- **Стало (добавлено):** `Автоматический аппрувер не является приёмкой и не может её заменить. Факты: experimental-auto-review **активен** в живом профиле (`enabled: true`, `fiberPhase: active`), и режима «только deny» у него не существует — решения `low+allow` / `medium+allow|deny` / `high+deny`. Поэтому «в профиле нет строки auto-review» не может быть требованием приёмки. Проверяемым является правило: вердикт `allow` от авто-аппрувера **не** переводит карточку в `done` и **не** считается review-approval — решение приходит только от независимого Reviewer (MW-024) или человека (MW-030). Выключение `auto-review` — отдельное решение владельца (D15), а не предпосылка этой карточки. Человеческая приёмка по work type (ADR028) — предмет MW-045.`
- **Стало (строка 20, добавлено):** `Тест: при вердикте auto-review `allow` карточка не становится `done`, и в леджере не появляется `review.approved`; approve выдаёт только независимый Reviewer или человек. `ReviewState 'escalated'` как терминальное состояние без возврата не считается закрытием: эскалация обязана назвать, кому передано и каким действием снимается. Остаточный риск активного auto-review фиксируется в отчёте с решением владельца (выключить или принять).`
- **Почему:** D15 (`01-MASTER-PLAN.md`), `:317` («не монтировать, пока не решён D15»); RT-4 (`FINAL-REPORT.md:434`); `evidence/quality-05.md:47-51` (нет deny-only; `AUTO_PRESET='auto'`); `evidence/quality-02.md:20` (`ReviewState 'escalated'`: `review.ts:26,38,46` — «тупик без записи, кому и без возврата»).
- **Приёмка до:** 3 пункта. **После:** 5 пунктов; гейт — `Select-String` по живому профилю не находит `auto-review`, и тест эскалации требует имя получателя.

#### C-19 · MW-025 — починка якоря `§26 (строка undefined)`

- **Карточка:** MW-025, строка 14.
- **Было:** `…Нужные разделы: §9 (строка 440), §19 (строка 1036), §20 (строка 1067), §26 (строка undefined), §28 (строка 1875)…`
- **Стало:** `…Нужные разделы: §9 (строка 440), §19 (строка 1036), §20 (строка 1067), §26 (строка 1812), §28 (строка 1875)…`
- **Почему:** `00-RECON.md` §1.2 (номера строк — только проверенные); `1812` подтверждён совпадением у двух независимых карточек: `MW-023.md:14` и `MW-024.md:14` → `§26 (строка 1812)`. `Select-String 'строка undefined'` → 4 файла (§0.3 п. 5).
- **Приёмка до:** якорь нерабочий. **После:** гейт `Select-String '.work/tasks/MW-*.md' -Pattern 'строка undefined'` → 0 совпадений.

#### C-20 · MW-026 — единственный оставшийся блокер ветки планирования MW-043

- **Карточка:** MW-026, строка 20 (приёмка).
- **Было (ключевой фрагмент):** `…Мутация с update существующей задачи отклоняется с PLANNER_SCOPE_DENIED и граф не меняется. Сессия Planner не может писать в workspace. Отклонённый план не оставляет ни задач, ни artifact planner-dag в применённом состоянии.`
- **Стало (добавлено):** `Карточка — единственный незакрытый блокер действия «Разработать план» в MW-043: MW-011 реализован (8 отчётов, включая независимое ревью и четыре дельта-верификации), MW-026 — нет (0 отчётов). До закрытия MW-026 действие «Разработать план» возвращает типизированный PLANNER_UNAVAILABLE и не меняет состояние идеи; действие «Создать быструю задачу» работает.`
- **Почему:** `FINAL-REPORT.md:329` (§7.4(7): «MW-011 с тех пор реализован (`packages/{contracts,core,planner}`), MW-026 — нет. Отчёт BLOCKED формально устарел частично»); проверки: `Test-Path packages\planner` → `True`; `Get-ChildItem .work/reports -Filter 'MW-011*'` → 8 файлов; `-Filter 'MW-026*'` → 0 файлов; R-15 (`01-MASTER-PLAN.md`).
- **Приёмка до:** 6 пунктов. **После:** 6 пунктов + явная связь с MW-043 и поведение `PLANNER_UNAVAILABLE`.

### 2.4. Control и learning: MW-027…MW-035

#### C-21 · MW-027 — перевод из «superseded в backlog» в архив

- **Карточка:** MW-027, строка 1 (шапка) и запись в `tasks.json`.
- **Было (строка 1):** `> **НЕ ЗАПУСКАТЬ.** Карточка снята с исполнения как superseded.`
- **Стало (строка 1, добавлено):** `> **НЕ ЗАПУСКАТЬ.** Карточка снята с исполнения как superseded. **Архивирована в v0.3:** в живом леджере доски карточка лежала в `backlog` и была формально запускаемой (Board ID e5bdbc44-0dfe-4e0c-ab26-2b526d3d3861, status backlog); архивация — обязательный шаг этапа 0.`
- **Почему:** `FINAL-REPORT.md:325` (§7.4(3): «`superseded`-карточки (MW-027, MW-035) лежат в backlog и формально запускаемы»); `01-MASTER-PLAN.md` (F: «архивировать `superseded` MW-027/MW-035»); `board-cross.ps1`: MW-027 `onBoard=True status='backlog'`.
- **Приёмка до:** карточка не запускается по тексту, но запускаема в леджере. **После:** `task_board_list --includeArchived=false` не содержит MW-027; гейт — обе карточки отсутствуют в активной колонке.

#### C-22 · MW-028 — provisioning saga и изолированный профиль

- **Карточка:** MW-028, строка 17 (объём).
- **Было:** `Запускать Controller от lifecycle плагина в embedded и отдельном поддерживаемом DSH profile в resident/headless. Один application слой, внешний state directory, graceful shutdown и reconnect клиентов.`
- **Стало (добавлено):** `Resident-профиль проверяется на изолированном DSH_HOME, а не на живом профиле пользователя. Одноразовая инициализация попытки (admission → durable-запись → runtime → settlement с компенсацией) переносится из Agent Teams как provisioning saga — предмет MW-065; сам coordination/mailbox не строится.`
- **Почему:** D13 (`01-MASTER-PLAN.md`); §9(1) (`:292` — не строить coordination subsystem); RT-6; `evidence/execution-04.md:5-11` (пять шагов `spawnAdmitted`, частичная компенсация `roster.ts:293-313`, reconcile `:392-434`, `maxMembers` 16 в домене / 8 в профиле).
- **Приёмка до:** браузер не останавливает resident execution; два deployment не нарушают single-controller; restart reconcile до admission; профиль отдельно от живого.
- **Приёмка после:** то же + явная ссылка на MW-065 и запрет работы на живом профиле.

#### C-23 · MW-029 — транспорт по D01, префикс, доставка (MW-063)

- **Карточка:** MW-029, строка 21 (приёмка).
- **Было (ключевой фрагмент):** `Первым шагом проверено, проходит ли http-bridge потоковый ответ: если нет, канал событий уходит на собственный prefix webServer и это зафиксировано вместе с моделью угроз.`
- **Стало (добавлено):** `Первым шагом — spike D01 (бюджет ≤1 день): либо Typert Remote доводится до потокового ответа, либо канал событий уходит на собственный prefix webServer и это фиксируется вместе с моделью угроз. Префиксы не смешиваются. Установка браузерной половины и peer-манифест — предмет MW-063.`
- **Почему:** D01 (`01-MASTER-PLAN.md`, `:310`; R-12 `:283`); `1|` FINAL-REPORT §6 K1.
- **Приёмка до:** 12 пунктов (маршруты через `connection.fetch.register` с префиксом `/api/mywork/...`).
- **Приёмка после:** те же + явное решение D01 и ссылка на MW-063.

#### C-24 · MW-030 — `HumanDecision` вместо блокирующего `ask()`

- **Карточка:** MW-030, строка 17 (объём), строка 20 (приёмка).
- **Было (строка 17, ключевой фрагмент):** `Реализовать autonomy L0–L3 и operation gates для миграций/security/release/production. Команды Pause/Cancel/StopAfterCurrentTool/Reassign/Retry: revoke lease, fence++, stop runtime, checkpoint/evidence, retention и graph transition.`
- **Стало (добавлено):** `HumanDecision встраивается сюда, в эту карточку, и карточка не дробится (D14: вариант B по существу, вариант C по форме — «не дробить MW-030 дополнительно: три потребителя уже разведены по MW-030/MW-045/MW-046»). Схема: decisionId, attemptId, gate: HumanGate (значение существующего каталога; HumanGate не переименовывается), question, state: pending|answered|expired|cancelled, answer?, answeredBy?, deadlineAt, createdAt, answeredAt?. Переходы — по образцу SKILL_TRANSITIONS/isAllowedSkillTransition (packages/core/src/skill.ts:870-888). Блокирующий ask() не используется: userQuestions.ask/approval.request не принимают AbortSignal, поэтому гейт обязан освобождать worker-сессию. Доставка ответа — шаг MW-046, человеческая приёмка — MW-045; в карточку дописывается явная ссылка на MW-046, чтобы «сущность без доставки» не сдавалась как готовая.`
- **Стало (строка 20, добавлено):** `Аудит: gate.decided и human.override существуют (contracts/src/audit.ts:75,77), gate.asked добавляется (шаг Q-10). Просроченный гейт даёт needs-attention с причиной human-gate-deadline-exceeded — причина уже объявлена (contracts/src/board.ts:363-364,377). Ни один тест не удерживает шаг агента в ожидании ответа человека.`
- **Почему:** `FINAL-REPORT.md:402`; D14 (`10-DECISIONS.md §D-1223`; ADR-034, файл `adr/ADR-034-human-decision.md`); шаги `Q-09`…`Q-19` (`23-STEPS-quality.md`); `evidence/quality-02.md:1-3,13,17,25-27`; `packages/controller/src/dsh-session.ts:203` (`prompt(..., mode: 'queue' | 'steer')`).
- **Приёмка до:** 7 пунктов (cancel/pause/retry, human override, stop-and-cancel, 7 триггеров needs-attention).
- **Приёмка после:** те же + 4 пункта HumanDecision (durable, CAS по `expectedRevision`+`controllerEpoch`, идемпотентность по `operationId`, аудит с актором) + явная ссылка на MW-046; гейт — 9 тестов без UI (`Q-16`) и три теста доставки (`Q-17`), ни одного блокирующего ожидания.

#### C-25 · MW-031 — инъецированные часы и различение застоя

- **Карточка:** MW-031, строка 17 (объём), строка 20 (приёмка).
- **Было (строка 17):** `Reconcile claim без Attempt, Attempt без runtime, expired leases, Controller failover, lost events, Board/Memory outage. Выявлять unschedulable/review loop/repeated failure/orphan/budget/provider blockers и выдавать NeedsAttention с причиной.`
- **Стало (добавлено):** `Время входит в детекторы только через инъецированные часы (ClockPort): Date.now() в домене запрещён, иначе расхождение scheduler с платформенным time-context невоспроизводимо (условие воспроизведения изменилось: строк time-context/schedule/ui-schedule в дефолтной web-композиции 0.2.0-rc.2 больше нет — они приходят только с бандлом @deepseek-ai/dsh-experimental-schedule-bundle, `packages/boot/app-boot/src/profile.ts:213-218` OPTIONAL_BUNDLES; живой профиль этот бандл включает — `profiles/web/package.json:39`, поэтому риск воспроизводится только на профиле с включённым Schedule, а на 0.2.1 загрузчик профиля снимает бандл сам — `02-PLATFORM-DELTA-0.2.0-rc.2.md` §2.1 G1, §5.2). Причина застоя — именованная NeedsAttentionReason, а не свободный текст.`
- **Почему:** D11 (`01-MASTER-PLAN.md`); RT-11 (`FINAL-REPORT.md:441`); R-8 (`:279`); `evidence/quality-02.md:17-18` (7 значений `NeedsAttentionReason`, `contracts/src/board.ts:356-370,373`; **носителя поля нет** — его заводит MW-064).
- **Приёмка до:** 3 пункта. **После:** 4 пункта; гейт — `Select-String packages -Pattern 'Date\.now'` в домене пусто; тест с `FakeClock` воспроизводит застой детерминированно.

#### C-26 · MW-033 — носитель durable jobs для optimizer'а

- **Карточка:** MW-033, строка 17 (объём), строка 20 (приёмка).
- **Было (строка 17):** `Baseline ручного/планового optimizer run по batch history: small strategy/skill diffs, dedup/stale/conflict curator. Реализовать Draft→Offline Evaluation→Shadow→Canary→Stable и Reject/Rollback, сохранять metrics и revision history.`
- **Стало (добавлено):** `Optimizer run — задача durable-планировщика на собственной БД MyWork (MW-068): jobs-local не годится, потому что он in-memory и process-local («Every record disappears when the harness process exits»). Расписание не запускает LLM на idle-тиках.`
- **Почему:** D09 (`01-MASTER-PLAN.md`); `FINAL-REPORT.md:423` (§9.2(5): «`LocalJobRegistry` — **не durable** (in-memory, process-local: `jobs-local/src/index.ts:123-128`, `docs/subsystems/jobs.md:331,398`)»); `evidence/quality-05.md:27-30` (цитаты README jobs-local); §9.1 (MW-033/040).
- **Приёмка до:** 3 пункта. **После:** 4 пункта; гейт — тест «перезапуск процесса не теряет запланированный optimizer run».

#### C-27 · MW-034 — OTel-экспорт `correlationId` и поправка про `providerConcurrency`

- **Карточка:** MW-034, строка 17 (объём), строка 20 (приёмка).
- **Было (строка 17):** `Учитывать system/role/task/workspace/memory/skills/history/tools/cached/output, input peak, retrieval/offload/compaction/rollover. Добавить queue/utilization/latency/repair/provider metrics с correlation IDs и раздельными estimate/actual.`
- **Стало (добавлено):** `Экспорт — через OTel: существующий correlationId выносится в спаны, плюс продуктовые события через ctx.productTelemetry (явные OTLP/HTTP-события, без авто-сбора). providerConcurrency как готовая метрика платформы не существует (0 совпадений в DSH-checkout): либо метрика строится из maxParallelToolCalls/maxParallelSubCalls, либо из собственного лимита BudgetLimits — выбор фиксируется в карточке. Политика PII: в телеметрию попадают только явные поля, тела prompt'ов и memory-записей — никогда.`
- **Стало (строка 20, добавлено):** `В спанах виден correlationId конкретной Attempt: тест находит его по идентификатору попытки. Секретов и полного prompt в метриках нет — проверяется сканером по экспортируемому объёму.`
- **Почему:** D16 (`01-MASTER-PLAN.md`); `evidence/quality-04.md:13,22-24` (`providerConcurrency` — 0 совпадений; `otel|telemetry` по `packages/**` → 0 совпадений, rg-exit=1; `correlationId` — 172 совпадения в 35 файлах, объединённо 200 в 39 файлах); `evidence/quality-05.md:38` (`product-telemetry` — `ctx.productTelemetry`, «explicit OTLP/HTTP log events only, no auto collection»); §0.5.
- **Приёмка до:** 3 пункта. **После:** 5 пунктов; гейт — `Select-String packages -Pattern 'correlationId'` в экспортёре непусто и тест находит correlationId по Attempt.

#### C-28 · MW-035 — перевод из «superseded в backlog» в архив

- **Карточка:** MW-035, строка 1 (шапка).
- **Было (строка 1):** `> **НЕ ЗАПУСКАТЬ.** Карточка снята с исполнения как superseded.`
- **Стало (строка 1, добавлено):** `> **НЕ ЗАПУСКАТЬ.** Карточка снята с исполнения как superseded. **Архивирована в v0.3:** в живом леджере доски лежала в `backlog` (Board ID d66573e0-720f-419f-ba72-a8a0bfe2d50f, status backlog) и была формально запускаемой.`
- **Почему:** `FINAL-REPORT.md:325`; `01-MASTER-PLAN.md`; `board-cross.ps1`: MW-035 `onBoard=True status='backlog'`.
- **Приёмка до:** не запускается по тексту, запускаема в леджере. **После:** отсутствует в активной колонке.

### 2.5. UI и приёмка: MW-036…MW-041

#### C-29 · MW-036 — починка двух якорей `(строка undefined)`

- **Карточка:** MW-036, строка 14.
- **Было:** `…Нужные разделы: §6 (строка undefined), §13 (строка 611), §14 (строка undefined), §28 (строка 1875), §54 (строка 2548), §55 (строка 2567)…`
- **Стало:** `…Нужные разделы: §6 (строка 330), §13 (строка 611), §14 (строка 735), §28 (строка 1875), §54 (строка 2548), §55 (строка 2567)…`
- **Почему:** `00-RECON.md` §1.2; значения подтверждены совпадением у трёх независимых карточек: `MW-006.md:14` → `§6 (строка 330)` и `§14 (строка 735)`; `MW-013.md:14` и `MW-014.md:14` → `§14 (строка 735)`.
- **Приёмка до:** два якоря нерабочие. **После:** гейт `Select-String '.work/tasks/MW-*.md' -Pattern 'строка undefined'` → 0 совпадений.

#### C-30 · MW-037 — починка якоря `§25` и замена непроверяемого `§56`

- **Карточка:** MW-037, строка 14.
- **Было:** `…Нужные разделы: §25 (строка undefined), §34 (строка 2048), §54 (строка 2548), §56 (строка undefined)…`
- **Стало:** `…Нужные разделы: §25 (строка 1648), §34 (строка 2048), §54 (строка 2548), §56 (строка ~).…`
- **Почему:** `§25 → 1648` подтверждён двумя независимыми карточками (`MW-032.md:14`, `MW-033.md:14`). Для `§56` **аттестации нет**: `Select-String -Pattern '§56'` по всем 55 карточкам даёт единственное вхождение — `MW-037.md:14`; по правилу §1.2 брифа номер пишется как `~` и попадает в «Открытые проверки». Для `§13/§14` MW-036 (C-29) то же правило применено с положительным результатом.
- **Приёмка до:** два якоря нерабочие. **После:** один якорь восстановлен, один честно помечен `~` и вынесен в §6.

#### C-31 · MW-038 — разрыв зависимости от `superseded` и Doctor по профилю и `bd`-seam

- **Карточка:** MW-038, строка 4 (шапка) и строка 17 (объём).
- **Было (строка 4):** `Зависимости: MW-010, MW-015, MW-019, MW-027, MW-029, MW-031  `
- **Стало (строка 4):** `Зависимости: MW-010, MW-015, MW-019, MW-042, MW-047, MW-029, MW-031  `
- **Было (строка 13, синхронная строка prompt'а):** `Зависимости: MW-010, MW-015, MW-019, MW-027, MW-029, MW-031. Проверь их результаты по исходникам и отчётам; если они не приняты, остановись с BLOCKED и точной причиной.`
- **Стало (строка 13):** `Зависимости: MW-010, MW-015, MW-019, MW-042, MW-047, MW-029, MW-031. Проверь их результаты по исходникам и отчётам; если они не приняты, остановись с BLOCKED и точной причиной.`
- **Было (строка 17):** `Doctor показывает installed/contract versions, required capabilities, connectivity/authentication, scopes/events/timeout/recovery по каждому adapter. Прогнать обязательные suites для TaskGraph, Runtime, Memory и остальных реализованных Ports.`
- **Стало (строка 17):** `Doctor показывает installed/contract versions, required capabilities, connectivity/authentication, scopes/events/timeout/recovery по каждому adapter. Отдельно проверяются: (а) целостность живого профиля — mtime и хэши файлов C:\Users\Dmitry\.dsh против сохранённой внешней копии (единственный невосстановимый ресурс); (б) работоспособность bd-seam — резолв JS-entry и отсутствие ENOENT errno -4058 на Windows. Doctor — собственная поверхность MyWork: примитива Doctor в платформе нет (rg по packages/apps/docs/scripts → 0 совпадений), ближайшие опоры — ctx.invariants и scripts/verify-package-invariants.ts. Прогнать обязательные suites для TaskGraph, Runtime, Memory и остальных реализованных Ports.` **Оговорка от 2026-10-03 (дельта D4):** `ctx.invariants` в живом профиле не смонтирован и в `0.2.1` снимается вместе с `InvariantError` и всеми `<pkg>/invariant`-субпутями, поэтому опорой для Doctor быть не может; остаётся только build-time скрипт платформы в DSH-чек-ауте, который гейтом MyWork не является (§3.19).
- **Стало (строка 20, добавлено):** `Прогон Doctor на живом профиле не мутирует его: проверка mtime/хэшей read-only, а любое исправление — отдельная явная команда с dry-run в .tmp. Диагностика bd-seam называет точную команду и ожидаемый exit code, а не «backend недоступен».`
- **Почему:** разрыв — `tasks.json`: `MW-038.dependsOn` содержит `MW-027`, `MW-027.status='superseded'` (единственный такой случай среди запускаемых, §0.3 п. 6); RT-9 (`FINAL-REPORT.md:439`: «MyWork знает путь (`verify-profile.mjs`, `layout.ts`), а state живёт внутри `$DSH_HOME`»); `FINAL-REPORT.md:412` («Doctor: сверка mtime/хэшей профиля; диагностика `bd`-seam»); R-3 (`01-MASTER-PLAN.md`, шаг F-38); «примитива Doctor нет» — `evidence/quality-05.md:14`.
- **Приёмка до:** критически неподдерживаемый контракт блокирует admission; отчёт машиночитаем и доступен в Diagnostics UI/CLI; optional degradation отличима от pass; без LLM-токенов.
- **Приёмка после:** те же 4 пункта + read-only проверка профиля и диагностика `bd`-seam; гейт — `node .work/tools/doctor.mjs --profile-check` не изменяет mtime ни одного файла профиля.

#### C-32 · MW-039 — тестовая половина инвариантов §59 и retention в приёмке

- **Карточка:** MW-039, строка 17 (объём), строка 20 (приёмка).
- **Было (строка 17):** `Собрать deterministic интеграционные/fault/property checks для всех invariants §59 и угроз §60. Использовать FakeClock/Runtime/Provider, временные DB/repos и реальные adapter contract suites; устранить найденные нарушения в пределах задач.`
- **Стало (добавлено):** `Владение инвариантами не раздвоено: эта карточка проверяет инварианты §59/§60 **тестами** (deterministic интеграционные/fault/property checks); runtime-регистрация инвариантов — не эта карточка, а MW-074 (её механика и приёмка описаны там, §3.19, шаг Q-36 у plan-quality). Таблица «инвариант §59 → носитель проверки» — общая и живёт у владельца runtime-половины, то есть в MW-074 (§3.19); в матрице Q-47 со стороны шагов ей соответствует строка **6** (`tests/invariants-runtime.test.mjs`), а тестовой половине этой карточки — строка **6а** (`tests/invariants.test.mjs`). Retention, VACUUM и сканирование тел артефактов и памяти проверяются здесь (механизм — MW-062).`
- **Стало (строка 20, добавлено):** `Проверка сканирования тел: тестовый секрет-маркер, положенный в тело артефакта и в тело memory-записи, находится сканером; удаление сканера ломает тест.`
- **Почему:** `evidence/quality-05.md:5-11` (реестр `InvariantRegistry`, `InvariantError` код `INVARIANT`, конвенция companion-модуля, build-time конформанс `scripts/verify-package-invariants.ts:11-21`); D17; §9.2(4) (`FINAL-REPORT.md:422`); P6/P22.
- **Приёмка до:** 9 инвариантов + security cases.
- **Приёмка после:** то же + сканер тел; гейт — `node --test --test-isolation=none tests/invariants.test.mjs` → `pass / fail 0`, причём искусственно нарушенный инвариант §59 валит тест (`MW-074` владеет runtime-проверками MyWork — собственным модулем, без платформенного шва `./invariant`, см. §3.19 и дельту D4; `scripts/verify-package-invariants.ts` из DSH-чек-аута гейтом не является).

#### C-33 · MW-040 — атомарная запись, единый реестр миграций, durable jobs, `private`

- **Карточка:** MW-040, строка 17 (объём), строка 20 (приёмка).
- **Было (строка 17):** `Сделать backup→migrate→verify→activate, migration journal, export/import и безопасный repair с документированной rollback policy. Проверять schema/adapter contract versions; исключить silent empty-state recovery.`
- **Стало (строка 17):** `Сделать backup→migrate→verify→activate, migration journal, export/import и безопасный repair с документированной rollback policy. Атомарная запись производных данных (temp+rename, withFileLock при нескольких писателях) и единый реестр миграций — предмет MW-059; миграция, import, repair и optimizer исполняются как durable jobs на собственной БД MyWork (MW-068), а не в процессе UI. Проверять schema/adapter contract versions; исключить silent empty-state recovery.`
- **Стало (строка 20, добавлено):** `Прерывание процесса между migrate и verify не оставляет частично применённую схему: journal содержит шаг, а состояние восстанавливается. Признак публикуемости (снятие private там, где это нужно для доставки) — предмет MW-060, а не этой карточки.`
- **Почему:** D08, D09 (`01-MASTER-PLAN.md`); `F-21/F-22/F-23`; RT-1/RT-10 (`FINAL-REPORT.md:431,440`); §9.2(5) (`:423` — `LocalJobRegistry` не durable); §9.1 (MW-004/039/040, MW-033/040, MW-040/041).
- **Приёмка до:** 3 пункта (фикстуры схем, export/import round-trip, восстановление по journal).
- **Приёмка после:** 5 пунктов; гейт — тест «kill между migrate и verify» → восстановление по journal, состояние не пустое.

#### C-34 · MW-041 — починка трёх якорей, CI, тег, peer-контракт, `pack.mjs`

- **Карточка:** MW-041, строка 4 (зависимости), строка 14 (якоря), строка 17 (объём), строка 20 (приёмка).
- **Было (строка 4):** `Зависимости: MW-028, MW-036, MW-037, MW-038, MW-039, MW-040, MW-055  `
- **Стало (строка 4):** `Зависимости: MW-028, MW-036, MW-037, MW-038, MW-039, MW-040, MW-055, MW-060, MW-063  `
- **Было (строка 14):** `…Нужные разделы: §5 (строка 242), §62 (строка 2750), §63 (строка undefined), §64 (строка undefined), §66 (строка undefined)…`
- **Стало (строка 14):** `…Нужные разделы: §5 (строка 242), §62 (строка 2750), §63 (строка ~), §64 (строка ~), §66 (строка 2880)…`
- **Было (строка 17):** `Сверить все 39 требований §62 с реализацией/evidence. Выполнить isolated install/activate/upgrade и сценарий goal→planner→worker→gates→reject/repair→approve→integrate→Done плюс restart/closed UI. Подготовить локальный пакет, README и инструкции Embedded/Resident для Windows/Linux/macOS.`
- **Стало (добавлено):** `Приёмка выполняется на CI-прогоне (install --frozen-lockfile → typecheck ×12 → tsdown → smoke → node --test → verify-profile.mjs) и на артефакте, собранном scripts/pack.mjs: `pnpm run build|typecheck|check` и `node scripts/pack.mjs` обязаны давать EXIT=0, а не воспроизводиться только прямыми вызовами. CI-пин платформы — `.github/workflows/ci.yml:131` (`npm install -g @deepseek-ai/dsh@0.2.0-rc.2`), и он в дереве **уже актуален**: решение владельца 2026-10-03 исполнено коммитом `d0b1f07`, прежнее значение `0.1.7-rc.2` — историческое, в дереве его нет; тег v0.1.0-m1, peer-диапазон `>=0.1.7-rc.2 <0.3.0-0` и точечное снятие private — предмет MW-060.`
- **Стало (строка 20, добавлено):** `Пакет воспроизводится из tarball'а на чистой машине по инструкции: изолированный профиль, панель видна в GUI после refresh (проверка — MW-063). Матрица §62 не содержит пунктов, подтверждённых только self-review.`
- **Почему:** `FINAL-REPORT.md:331` (§7.4(6): «`pnpm run build|typecheck|check` и `node scripts/pack.mjs` → EXIT=1 (битый глобальный pnpm-линк); сборка и тесты воспроизводятся только прямыми вызовами»), `:411` (§9.1: «`private: true` → решение о распространении; `engines`; CI; тег `v0.1.0-m1`; починить `pack.mjs`»); F-15/F-16, `01-MASTER-PLAN.md`; §9(7) (`:298`).
- **Приёмка до:** матрица §62 без скрытых gaps; pack без секретов; не публиковать без разрешения.
- **Приёмка после:** те же + CI-прогон и tarball как обязательные гейты; гейт `git tag -l v0.1.0-m1` непусто.

### 2.6. Board: MW-042…MW-055

#### C-35 · MW-042 — девять зон под условием D02, layout-константы и boundary-тест

- **Карточка:** MW-042, строка 18 (объём), строка 21 (приёмка).
- **Было (строка 18, ключевой фрагмент):** `…заменить TaskBoardPlacement на BoardPlacement. В packages/core добавить чистые board.ts (projectTaskZone, zoneOfState, assertSinglePlacement, legalDropTargets, boardOrdering) и theme.ts (resolveSurfacePolicy).`
- **Стало (добавлено):** `Решение D02 = вариант C (гибрид). Девять зон остаются контрактом: BOARD_ZONES, BOARD_ZONE_ROWS (packages/contracts/src/board.ts:66), ZONE_BY_STATE и ZONE_ICONS не меняются, packages/core/src/board.ts не меняется вовсе. Из контракта уезжает только presentation-часть — BOARD_VIEW_MODES и BOARD_STRIP_MAX_WIDTH_PX (там же :126-132) переезжают в packages/web; тип из семи полос BoardLaneView объявляется в UI-пакете, не в contracts. Семь semantic lanes — представление, а не контракт: 16 TaskState по-прежнему отображаются ровно в одну из девяти зон. Мёртвые поля SubState (board.ts:210) и PlacementChange.fromZone (board.ts:434,463) либо получают носителя, либо удаляются; SessionLink.active — то же (B-09). Формулировка «переименовать зоны в полосы» отклонена: миграция placement-ключей при columnRevision на (viewId, zone) оставила бы клиентов в STALE_COLUMN_REVISION.`
- **Стало (строка 21, добавлено):** `Правка текста приёмки по части зон не требуется (D02): формулировка «каждый из 16 TaskState отображается ровно в одну из девяти зон» сохраняется. Меняется только tests/board.test.mjs:637-640 (константы переехали в packages/web); блоки :35-57 и :59-88 остаются как есть. Boundary-тест расширяется на scheduler, planner, adapter-sdk, controller и memory-native (шаги F-41/F-42). **Из гейта карточки снимаются два чужих артефакта:** `data-mw-*` (это шаг B-27 внутри MW-048) и «носитель `NeedsAttentionReason`» (это карточка MW-064) — иначе MW-042 требует результат своих же зависимых, и скрытые циклы `MW-042 → MW-064 → MW-042` и `MW-042 → MW-048 → MW-029 → MW-047 → MW-042` не разрываются. В гейте MW-042 остаётся только то, что она производит сама: контракты зон и property-тест на 16 состояний. **Отдельный дефект исполнимости приёмки:** пункт «`AutonomyLevel`, `PlanMutationClass`, `TaskClaims`, `BlockerResolutionGate`, `NeedsAttentionReason` и `BoardPanelState` объявлены в контрактах и покрыты проверкой исчерпываемости» переписывается на «`PlanMutationClass` (7 вхождений), `BlockerResolutionGate` (11) и `BoardPanelState` (2) присутствуют и покрыты проверкой исчерпываемости; `AutonomyLevel` и `TaskClaims` объявляются в MW-030 и проверяются там» — потому что `AutonomyLevel` и `TaskClaims` в репозитории отсутствуют (0 совпадений; §7.2 мастер-плана), и на текущих контрактах этот пункт неисполним.`
- **Почему:** D02 = вариант C (`10-DECISIONS.md`, ADR-030 «Девять зон остаются контрактом, семь полос — представление», файл `adr/ADR-030-board-zones-v03.md`); `FINAL-REPORT.md:393`; шаги `B-01`…`B-03`, `B-09` (`22-STEPS-surface.md`); `F-41`/`F-42` (`20-STEPS-foundation.md`); §7.2 мастер-плана (опровержение про несуществующие типы); `grep`-проверка `AutonomyLevel`/`TaskClaims`/`PlanMutationClass`/`BlockerResolutionGate`/`BoardPanelState` по `packages/**/*.ts` → 0 / 0 / 7 / 11 / 2.
- **Приёмка до:** 16 TaskState → ровно одна из **девяти** зон; `projectTaskZone`; порядок карточек; `(viewId, zone)` ревизия.
- **Приёмка после:** та же (D02 = C), плюс: ни одной layout-константы в `packages/contracts`; `BoardLaneView` живёт в `packages/web`; гейт `node --test --test-isolation=none tests/board.test.mjs` → `pass 26 / fail 0` (26 — число `test(` в файле; прогоняет Lead) и `Select-String packages/contracts -Pattern 'BOARD_STRIP_MAX_WIDTH_PX'` → 0.

#### C-36 · MW-043 — устаревший блокер переоформлен на один пункт

- **Карточка:** MW-043, строка 4 (шапка), строка 5 (Board ID), строка 13 (prompt), строка 21 (приёмка).
- **Было (строка 4):** `Зависимости: MW-042, MW-011, MW-026  `
- **Стало (строка 4):** `Зависимости: MW-042, MW-011  `
- **Было (строка 13):** `Зависимости: MW-042, MW-011, MW-026. Проверь их результаты по исходникам и отчётам; если они не приняты, остановись с BLOCKED и точной причиной.`
- **Стало (строка 13):** `Зависимости: MW-042, MW-011. Проверь их результаты по исходникам и отчётам; если они не приняты, остановись с BLOCKED и точной причиной. Блокер по MW-026 снят с уровня карточки и переоформлен на уровень действия: MW-011 реализован (8 отчётов, packages/{contracts,core,planner} существуют), MW-026 не реализован (0 отчётов).`
- **Было (строка 5):** `Board ID: не создана — карточка принадлежит доске MyWork, а не legacy ledger  `
- **Стало (строка 5):** строка удаляется (см. §1.1 и §5.2). На переходный период: `Board ID: не создана (проверено на снапшоте леджера 2026-09-16; соответствие ведёт INDEX.md)  `
- **Стало (строка 21, добавлено):** `Действие «Разработать план» возвращает типизированный PLANNER_UNAVAILABLE и не меняет состояние идеи, пока MW-026 не закрыт; действие «Создать быструю задачу» работает без MW-026. Карточка не блокируется целиком из-за одного незакрытого действия.`
- **Почему:** `FINAL-REPORT.md:394` (§9.1 MW-043: «Перепроверить блокер: MW-011 реализован (`packages/{contracts,core,planner}`), MW-026 — нет. Либо закрыть MW-026, либо переоформить блокер на один пункт»), `:329` (§7.4(7)); R-15 (`01-MASTER-PLAN.md`); проверки: `Test-Path packages\{contracts,core,planner}` → `True`×3; отчётов MW-011 — 8, MW-026 — 0.
- **Приёмка до:** 9 пунктов, включая «Быстрая задача без утверждённого плана отвергается типизированной ошибкой».
- **Приёмка после:** те же + точка отказа только у плановой ветки; гейт — тест: при незакрытом MW-026 «Разработать план» → `PLANNER_UNAVAILABLE`, состояние идеи не изменилось, а «Создать быструю задачу» проходит.

#### C-37 · MW-044 — граница с `ctx.workflowEngine` и переименование домена

- **Карточка:** MW-044, строка 18 (объём).
- **Было (строка 18, ключевой фрагмент):** `…Реализовать один engine внутри resident controller: frozen workflow revision на attempt, L2 по умолчанию, L3 с авто-утверждением только additive-планов, human gates, bounded retries, timeout, escalation, recovery после restart, идемпотентные node generations, отсутствие дубля старта после SSE reconnect.`
- **Стало (добавлено):** `Движок не регистрируется в ctx.workflowEngine: на один контекст приходится один workflowEngine, и коллизия имён даёт вторую authority. Домен переименовывается (execution pipeline / procedure) и граница записывается ADR'ом — решение D03.`
- **Почему:** D03 (`01-MASTER-PLAN.md`); K4 (`00-RECON.md`: «Один `ctx.workflowEngine` на контекст — коллизия с доменом MyWork (K4)»); §9(4) (`01-MASTER-PLAN.md`: «Не регистрировать MyWork-движок в `ctx.workflowEngine`»).
- **Приёмка до:** 10 пунктов. **После:** те же + гейт `Select-String packages -Pattern 'ctx\.workflowEngine'` → 0 совпадений.

#### C-38 · MW-045 — человеческая приёмка по work type

- **Карточка:** MW-045, строка 18 (объём), строка 21 (приёмка).
- **Было (строка 18):** `Добавить contracts/src/worktype.ts (WorkType, FinishCriteria, FINISH_CRITERIA) и core/src/worktype.ts (resolveFinishCriteria, assertFinishCriteriaSatisfied) для типов code, research, document, manual, analysis, non-git-ops. Расширить ARTIFACT_KINDS на manual-receipt, web-citation, design-doc. Реализовать стратегии интегратора git-merge, artifact-publish, manual-receipt и none.`
- **Стало (добавлено):** `Человеческая приёмка — часть finish criteria там, где её требует ADR028: для типов, у которых приёмка не выводится из evidence, переход в done без решения человека отвергается типизированной ошибкой, а не «проходит по умолчанию». Связь с HumanDecision: запись решения — та же durable-сущность, объявленная в MW-030 (правка C-24, решение D14).`
- **Стало (строка 21, добавлено):** `Для каждого из шести типов зафиксировано, нужна ли человеческая приёмка; тест доказывает, что для типов, требующих её, переход в done без записи решения даёт FINISH_CRITERIA_UNMET с именем отсутствующего условия.`
- **Почему:** `FINAL-REPORT.md:404` (§9.1 MW-045: «Добавить человеческую приёмку по work type: `WorkType`/`FinishCriteria`/`FINISH_CRITERIA_UNMET` в коде 0 совпадений»; «ADR028 требует human acceptance для 4 из 6 типов»); ADR028; D14; проверка: `Select-String packages/**/*.ts -Pattern 'WorkType|FinishCriteria|FINISH_CRITERIA_UNMET'` → **0 совпадений** (подтверждено).
- **Приёмка до:** 5 пунктов (FINISH_CRITERIA_UNMET, шесть наборов, non-git-ops без worktree, manual требует receipt, artifact-publish пишет получателя, ArtifactKind сохраняют значение).
- **Приёмка после:** те же + человеческая приёмка для 4 из 6 типов; гейт — таблица «work type → нужна ли человеческая приёмка → тест».

#### C-39 · MW-046 — доставка ответа человека в живую попытку

- **Карточка:** MW-046, строка 4 (зависимости), строка 18 (объём), строка 21 (приёмка).
- **Было (строка 4):** `Зависимости: MW-012, MW-022, MW-030  `
- **Стало (строка 4):** `Зависимости: MW-012, MW-022, MW-030  `
- **Было (строка 18, ключевой фрагмент):** `Добавить DiscussionMessage (comment, decision, question, steer, system), миграцию storage discussion, типизированную команду attempt.steer для безопасного направления активной попытки, ссылку на полную DSH-сессию и audit для решений.`
- **Стало (добавлено):** `Ответ человека на gate доставляется в живую попытку тем же механизмом, что и обсуждение: prompt(..., mode: 'steer') внутри открытого хода и mode: 'queue', если попытка уже закончила ход (packages/controller/src/dsh-session.ts:203); DiscussionMessage(kind='decision') фиксирует решение в обсуждении, идемпотентность — по operationId. Блокирующий ask(), удерживающий шаг агента, не используется как шлюз: userQuestions.ask/approval.request не принимают AbortSignal.`
- **Стало (строка 21, добавлено):** `Доставка ответа не блокирует шаг: агент продолжает работу, а решение приходит сообщением; повтор с тем же operationId даёт один эффект. Ответ, пришедший после конца хода, доставляется следующим ходом — это отдельный тест; сессия, завершившаяся до ответа, не получает steer, и решение становится исходным для новой Attempt.`
- **Почему:** `FINAL-REPORT.md:403` (§9.1 MW-046); D14 (`10-DECISIONS.md §D-1222`: механизм `prompt(..., mode)`, тесты «ответ в открытый ход» / «ответ после конца хода» / «просроченный гейт»); шаги `Q-17`, `Q-18`, `Q-19` (`23-STEPS-quality.md`).
- **Приёмка до:** 6 пунктов. **После:** 8 пунктов; гейт — тест «ответ приходит во время исполнения и не останавливает шаг» + тест «ответ после конца хода доставляется следующим ходом».

#### C-40 · MW-047 — кто двигает `boardRevision`, и `degraded` против `empty`

- **Карточка:** MW-047, строка 18 (объём), строка 21 (приёмка).
- **Было (строка 18, ключевой фрагмент):** `Реализовать TaskBoardPort и проектор доски в resident controller: производный snapshot с монотонной boardRevision и курсором, SSE-инвалидация, деградированная проекция при недоступности Beads, per-card результат для bulk-операций, Null adapter и read-only legacy adapter как объявление.`
- **Стало (добавлено):** `Писатель boardRevision назван явно: ревизию двигает проектор при каждом изменении снапшота, а не клиент и не команда карточки; конкурентная запись ревизии идёт через CAS. Degraded и empty — разные состояния: empty означает «проекция построена, карточек нет», degraded — «проекция неполна, причина и время снимка приложены»; §50 теряет empty, если эти два состояния слить.`
- **Стало (строка 21, добавлено):** `Тест различает empty и degraded: пустая доска не отдаёт degraded, а недоступность Beads не отдаёт empty. Ревизия колонки двигается только проектором — команда карточки её не пишет.`
- **Почему:** `FINAL-REPORT.md:397` (§9.1 MW-047: «Согласуется; уточнить: курсор/`boardRevision` (кто двигает), `degraded` vs `empty`. Нет писателя `boardRevision`; §50 теряет `empty`»); A §3.4.
- **Приёмка до:** 12 пунктов (включая «Ревизия колонки проверяется CAS»).
- **Приёмка после:** те же + явный писатель ревизии и различие empty/degraded; гейт — два теста: пустой снапшот → `empty`; недоступный backend → `degraded` с причиной.

#### C-41 · MW-048 — client-строка, `immediately`, `icon`, формат бандла, `store`, свой префикс data-атрибутов

- **Карточка:** MW-048, строка 18 (объём), строка 21 (приёмка).
- **Было (строка 18, ключевой фрагмент):** `Наполнить каркас packages/web (@dsh-mywork/web), созданный карточкой MW-072 (шаг B-01a), — exports["./client"], манифест dsh.client (platform web) и собственная сборка lazy-CJS формата (banner window.__ModuleLoader__.load). Сама карточка пакет НЕ создаёт: сегодня Test-Path packages/web → False, и до MW-072 исполнитель не найдёт пакета.`
- **Стало (добавлено):** `Client-строка объявляется bare-именем пакета (@dsh-mywork/web) без пути; панель помечается dsh.client.immediately, чтобы монтироваться без ручного клика; задаётся icon панели; бандл собирается вручную в CJS-формате (banner window.__ModuleLoader__.load), а не «как получится у сборщика»; view-состояние живёт в store слота, а не в модульных переменных. Якоря панели используют собственный префикс data-mw-*: пространство data-dsh-* занято платформой.`
- **Стало (строка 21, добавлено):** `Тест/проверка регистрации: панель видна после refresh без ручного действия, иконка отрисована; ни один якорь панели не начинается с data-dsh-. Установка пакета в изолированный профиль и peer-манифест — предмет MW-063.`
- **Почему:** `FINAL-REPORT.md:398` (§9.1 MW-048: «Добавить: bare-имя пакета в client-строке, `dsh.client.immediately` для панели, `icon`, ручной CJS-формат бандла, `store` слота для view-состояния, **свой префикс для data-атрибутов панели** (`data-dsh-*` занят платформой)»); §3.3 п. 5 (`00-RECON.md`: «Пространство `data-dsh-*` занято платформой»); D18 (`01-MASTER-PLAN.md`); §9(9) (`:300`).
- **Приёмка до:** 8 пунктов. **После:** 10 пунктов; гейт — `Select-String packages/web -Pattern 'data-dsh-'` → 0 совпадений.

#### C-42 · MW-049 — «ровно девять панелей», порог 1100 px, WIP-лимит

- **Карточка:** MW-049, строка 18 (объём), строка 21 (приёмка).
- **Было (строка 18, ключевой фрагмент):** `Реализовать раскладку grid-3x3 по умолчанию (девять независимых панелей с sticky-заголовком, count, collapse и overflow) и strip-horizontal как альтернативу, включаемую вручную и автоматически при ширине панели менее 1100 px.`
- **Стало (строка 18, заменено):** `Реализовать раскладку grid-3x3 по умолчанию — девять независимых панелей по числу зон контракта — и strip-horizontal как альтернативу, включаемую вручную и автоматически по порогу ширины; **порог и список режимов — UI-константы presentation-пакета, а не контракт** (BOARD_VIEW_MODES/BOARD_STRIP_MAX_WIDTH_PX переезжают из packages/contracts/src/board.ts:126-132 в packages/web, шаг B-02). Семь полос (BoardLaneView) — представление над девятью зонами внутри UI-пакета; в контракте не появляются.`
- **Стало (строка 21, ключевые фрагменты):** `По умолчанию рендерятся ровно девять панелей в сетке 3x3 — формулировка сохраняется решением D02, — и ни одна карточка не появляется в двух зонах. Порог переключения берётся из presentation-константы packages/web, а не из контракта, и измеряется с реальным содержимым.` и `WIP-индикатор — presentation-only: отображается, но не блокирует admission и не пишется в граф.`
- **Почему:** D02 = вариант C (`10-DECISIONS.md`), последствия `:278` («`.work/tasks/MW-049.md:21` — формулировка «ровно девять панелей» **сохраняется**, но порог 1100 переезжает в UI»); шаги `B-02`, `B-10` (`22-STEPS-surface.md`); `FINAL-REPORT.md:395`.
- **Приёмка до:** 9 панелей, 1100 px, WIP не блокирует, 2000 карточек ≤1.5× DOM от 1000, измерение порога.
- **Приёмка после:** 9 панелей сохраняются; порог и режимы — presentation-константы `packages/web`; WIP presentation-only; гейт — `Select-String packages/contracts -Pattern 'BOARD_STRIP_MAX_WIDTH_PX|BOARD_VIEW_MODES'` → 0.

#### C-43 · MW-050 — четыре неисполнимых пункта приёмки

- **Карточка:** MW-050, строка 18 (объём), строка 21 (приёмка).
- **Было (строка 21, четыре пункта дословно):**
  1. `DnD не пишет board state напрямую и подсвечивает только легальные цели.`
  2. `Drop в error/blocked/cancelled без выбранной причины отклоняется.`
  3. `Два одинаковых DropIntent с разными operationId не меняют состояние дважды.`
  4. `Session link открывает реальную DSH-сессию.`
- **Стало (заменено на исполнимые формулировки):**
  1. `DnD не пишет board state напрямую: подсветка целей приходит из резолвера легальных целей (legalDropTargets/applyDropIntent), а не из локального предиката компонента; нелегальная цель не подсвечивается. Резолвер и его инвариант — предмет MW-064.`
  2. `Drop в error/blocked/cancelled без выбранной причины отклоняется типизированной ошибкой; причина хранится в поле-носителе NeedsAttentionReason (сегодня тип есть, носителя нет — его заводит MW-064) и видна в карточке.`
  3. `Повтор DropIntent идемпотентен по operationId: две команды с разными operationId и одинаковым эффектом не применяются дважды, если резолвер свёл их к одной операции; проверяется тестом на два вызова подряд.`
  4. `Session link открывает полную DSH-сессию по существующему идентификатору; ссылка на несуществующую сессию даёт SESSION_NOT_FOUND и ничего не открывает.`
- **Стало (строка 18, добавлено):** `Подсветка целей, причина drop'а и ссылка на сессию опираются на резолвер (MW-064) и на существующие контракты; UI не вводит собственных правил легальности.`
- **Почему:** `FINAL-REPORT.md:396` (§9.1 MW-050: «Четыре неисполнимых пункта: „подсвечивает только легальные цели“ (нужен резолвер), „drop без причины отклоняется“ (нет поля и хранения), „два DropIntent с разными operationId“ (нет идемпотентности), „Session link открывает сессию“ (нет механики)»); `:178` (§3.4 п. 11); `evidence/quality-02.md:18,20` (`NeedsAttentionReason` без носителя; `ReviewState 'escalated'` — тупик); символы: `applyDropIntent` → `packages/core/src/board.ts:458`, `legalDropTargets` → `contracts/src/board.ts:161,533`.
- **Приёмка до:** 4 пункта невыполнимы на текущих контрактах. **После:** 4 пункта выполнимы и привязаны к MW-064/носителю причины; гейт — тест на каждый из четырёх.

#### C-44 · MW-051 — редактор вызывает тот же валидатор, что движок

- **Карточка:** MW-051, строка 21 (приёмка).
- **Было:** `Редактор не может сохранить документ, который отвергает валидатор, потому что вызывает тот же валидатор. В схеме узла нет поля, способного выразить shell, command, executable или код.`
- **Стало (добавлено):** `Редактор не вводит собственных правил: и легальность, и предпросмотр — те же функции, что у движка (MW-044); при переименовании домена (D03) редактор переименовывается вместе с ним, чтобы не осталось двух имён одного домена.`
- **Почему:** D03; §9(4); `FINAL-REPORT.md:406` (запрет dynamic-инструментов в поверхности).
- **Приёмка до:** 5 пунктов. **После:** 6 пунктов; гейт — тест «документ, отвергнутый валидатором, не сохраняется» остаётся, плюс проверка единого имени домена.

#### C-45 · MW-052 — новые зависимости не добавляются, привязка к модели зон

- **Карточка:** MW-052, строка 18 (объём), строка 21 (приёмка).
- **Было (строка 18):** `Реализовать представление зависимостей (DAG), calendar по due/defer и опциональный timeline по startedAt/settledAt на собственной SVG-раскладке по слоям, без новых npm-зависимостей. Доступность узлов и рёбер для клавиатуры и для assistive technology.`
- **Стало (добавлено):** `Раскладка по слоям опирается на представление, а не на контракт: девять зон остаются домом (D02 = C), семь полос BoardLaneView — представление в UI-пакете; graph view не переименовывает зоны и не вводит собственной таблицы состояний.`
- **Почему:** `FINAL-REPORT.md:399` (§9.1 MW-053/052: «Мелкие правки по lanes; graph view без новых зависимостей — сохранить»); D02 = вариант C (`10-DECISIONS.md`: `BoardLaneView` добавляется **в UI-пакет**, не в `contracts`); §9(10) (`01-MASTER-PLAN.md`).
- **Приёмка до:** 5 пунктов (ни одной новой зависимости, клавиатура, цикл, calendar, 1000 узлов).
- **Приёмка после:** те же + раскладка берёт представление из UI-пакета; гейт — `git diff --stat package.json` по затронутым пакетам пуст.

#### C-46 · MW-053 — тема, доступность и режимы раскладки

- **Карточка:** MW-053, строка 21 (приёмка).
- **Было:** `Матрица из пяти режимов проходит, и результат каждого записан с измеренным коэффициентом контраста. При wallpaper alpha поверхностей равна 1, и фоновое изображение не видно внутри карточек и sticky-заголовков.`
- **Стало (добавлено):** `Проверка выполняется для обеих форм представления: сетка девяти зон (контракт) и семь полос BoardLaneView (UI) — имена для screen reader называют зону/полосу, а не внутренний идентификатор; контраст и focus проверяются на каждой панели обеих раскладок.`
- **Почему:** D02 = вариант C (`10-DECISIONS.md`); `FINAL-REPORT.md:399`; §9.1 (MW-053/052: «Мелкие правки по lanes»).
- **Приёмка до:** 7 пунктов. **После:** 8 пунктов; гейт — замер контраста на каждой зоне и каждой полосе с записанным числом.

#### C-47 · MW-054 — три фактические ошибки в числах и терминах леджера

- **Карточка:** MW-054, строка 18 (объём), строка 21 (приёмка).
- **Было (строка 18, три ошибочных фрагмента дословно):**
  `а) «в реальном леджере эти два критерия совпадают (6 done-карточек лежат в отдельном воркспейсе 47b14762, 35 незавершённых — в 3fc33afb)»;`
  `б) «Перед cutover проверяется, что legacy autoRunTodo выключен и расписаний на мигрированных карточках нет, иначе проект получит двух исполнителей»;`
  `в) (в приёмке) «Cutover не начинается, пока legacy autoRunTodo не выключен и на мигрированных карточках нет расписаний».`
- **Стало:**
  `а) `Правило выбора карточек: карточка eligible, если её workspaceId равен workspaceId MyWork И статус не done. Числа: в снапшоте леджера 41 задача, все в backlog, executions пуст; числа done/незавершённых и распределение по воркспейсам берутся из живого леджера на момент cutover и печатаются в отчёт, а не зашиваются в карточку. Если правило eligible даёт 33 карточки (а не 35), это фиксируется как расхождение, а не подгоняется.``
  `б) `Перед cutover проверяется, что в строке web-ui-task-board не осталось ключей autoRun* и что на мигрированных карточках нет per-task расписаний; иначе проект получит двух исполнителей. В 0.4.3 ключей не было, но в установленной 0.4.4 семь ключей autoRun* вернулись в живой профиль (`profiles/web/cordis.patch.yml:25,27-33`; регрессия D8 — `02-PLATFORM-DELTA-0.2.0-rc.2.md` §2.2), причём читателей у них нет ни в одной версии: `Select-String -SimpleMatch 'autoRun'` по `src/**` и `lib/**` даёт 0 в 0.4.3 и 0 в 0.4.4 (единственное совпадение в агрегате `dsh-web-all` — чужой клиентский метод `autoRun(kind, …)`, не конфиг — `.tmp/board-delta/REPORT.md` §3), поэтому проверка — это действие по их удалению, а не констатация отсутствия; в снапшоте леджера MyWork их не было ('autoRun' x0 в board-export.json и board-actions.json). Отсутствие ключа — не то же самое, что «выключен».``
  `в) `Cutover не начинается, пока не доказано отсутствие ключей autoRun* и per-task расписаний; доказательство — вывод команды, а не утверждение. Колонок todo/running в легаси-леджере не было ни в одном действии ('todo' x0, 'running' x0 в board-actions.json), поэтому миграция не может на них опираться. г) Леджер живого профиля (`%USERPROFILE%\.dsh\task-board\ledger-v2.json`) — уже `schemaVersion` 4: установленная доска 0.4.4 объявляет `TASK_BOARD_SCHEMA_VERSION = 4`, `LEGACY = 3`, `OLDER = 2` (`…dsh-client-ui-task-board\src\protocol.ts:11,13,15`), а 0.4.3 объявляла `= 3` и `LEGACY = 2` (её `src/protocol.ts:10,12`; распакованный tarball — `.tmp/board-delta/v043/package`); v4 добавляет `ScheduleRule.timeZone`, и миграция v2/v3 штампует в правила без зоны зону хоста (0.4.4 `src/host-ledger.ts:1181-1194`). Следствие для отката: сборка 0.4.3 леджер v4 **не читает** — `load()` бросает `unsupported ledger schema` (0.4.3 `src/host-ledger.ts:1038`), `recoverCorrupt()` (`:1088-1097`) переименовывает файл в `ledger-v2.json.corrupt-<ts>-<pid>-<uuid>` и поднимает доску с **пустым** леджером: данные не удаляются, но UI пуст. Поэтому копия леджера входит в процедуру отката (MW-073), а «понизить версию доски» — не способ вернуть прежнее поведение; канон фактов 0.4.4 — `02-PLATFORM-DELTA-0.2.0-rc.2.md` §8 п. 6, сырые замеры — `.tmp/board-delta/REPORT.md` §3-§4.``
- **Почему:** `FINAL-REPORT.md:400` (§9.1 MW-054: «Три фактические ошибки: числа леджера (52/3, 32-19-1), „autoRunTodo выключен“ → „нет ключей `autoRun*` и нет per-task расписаний“, `todo/running` не использовались. Плюс: правило eligible даёт 33, а не 35; архив читается из файла — верно»); мои проверки: `'autoRun' x0` в обоих легаси-JSON, `'"todo"' x0`, `'"running"' x0`, `backlog x41` (§0.3 п. 8); `01-MASTER-PLAN.md` («удалить мёртвые ключи `autoRun*` (7 штук)»); схема леджера — проверено только чтением: живой `%USERPROFILE%\.dsh\task-board\ledger-v2.json` даёт `"schemaVersion": 4`, 0.4.4 объявляет `4`/`3`/`2`, 0.4.3 — `3`/`2`, и путь отказа 0.4.3 на v4 (`unsupported ledger schema` → `recoverCorrupt()` → `.corrupt-…`) подтверждён по распакованному tarball'у 0.4.3 (`.tmp/board-delta/REPORT.md` §3-§4 — отчёт §8.6, которым §8 п. 6 дельты закрыт 2026-10-03).
- **Приёмка до:** включает «Cutover не начинается, пока legacy autoRunTodo не выключен…».
- **Приёмка после:** приёмка требует вывода команды про отсутствие `autoRun*` и расписаний; числа вынесены из карточки в отчёт.

#### C-48 · MW-055 — «41 карточка» и сценарии без evidence

- **Карточка:** MW-055, строка 18 (объём), строка 21 (приёмка).
- **Было (строка 18, ключевой фрагмент):** `…и прогнать миграцию на копии реального ledger без изменения оригинала.`
- **Стало (добавлено):** `Число карточек в копии реального ledger берётся на момент прогона и печатается; «41» из текста карточки — это состояние снапшота 2026-09-16, а не константа. Приёмка доски дополняется сценариями разделов empty/degraded (MW-047) и cutover (MW-073). Копия живого леджера — документ **v4**, а не v3: 0.4.4 подняла `TASK_BOARD_SCHEMA_VERSION` 3 → 4, поэтому мастер импорта обязан читать v4-документ и не объявлять копию «нечитаемой» из-за устаревшего ожидания схемы; копия снимается до cutover (`.tmp/board-delta/REPORT.md` §3; `02-PLATFORM-DELTA-0.2.0-rc.2.md` §8 п. 6). Копия сверяется по хешу сразу: доска обрезает историю исполнений до `EXECUTION_HISTORY_LIMIT = 20` на каждой загрузке (`src/core/tasks.ts:65,73-77`; `src/host-ledger.ts:1226`), поэтому «хеш до и после» — утверждение о копии на момент прогона, а не о неизменном леджере (red-team B, «Дельта 0.2.0-rc.2», N-1(б): то же ограничивает срок жизни условия «`executionId` существует в леджере»).`
- **Было (строка 21, ключевой фрагмент):** `Прогон мастера импорта на копии реального ledger из 41 карточки не изменил оригинальный файл.`
- **Стало:** `Прогон мастера импорта на копии реального ledger (число карточек зафиксировано выводом команды) не изменил оригинальный файл — хеш до и после совпадает.`
- **Стало (строка 4, зависимости):** `Зависимости: MW-053, MW-054, MW-031, MW-038, MW-039, MW-071, MW-073  `
- **Почему:** `FINAL-REPORT.md:401` (§9.1 MW-055: «„41 карточка“ → актуальные числа; сценарии без evidence считать непройденными — сохранить»); снапшот леджера содержит 41 задачу (§0.3 п. 3), но это состояние на 2026-09-16; правило «сценарий без evidence не пройден» сохраняется как есть (не правится).
- **Приёмка до:** 5 пунктов, один из них с числом 41.
- **Приёмка после:** 6 пунктов; гейт — отчёт приёмки содержит команду, которой получено число карточек.

### 2.7. Массовые правки (применяются ко всем 55 карточкам)

#### M-1 · Строка `Board ID:`: исправить ложные «не создана», удалять **после** cutover

- **Было (строка 5, два варианта):** `Board ID: <uuid>  ` (34 карточки) либо `Board ID: не создана — карточка принадлежит доске MyWork, а не legacy ledger  ` (21 карточка).
- **Стало (две отдельные правки, в разное время):**
  1. **Сейчас (до `MW-073`):** строка **сохраняется** во всех 55 карточках. У 34 карточек UUID верный — он нужен cutover'у (`MW-073`) и сверке `boardTaskId` (§4.7), поэтому удалять его заранее нельзя. Исправляются только **7 ложных** «не создана» (`MW-010`, `011`, `025`, `029`, `036`, `037`, `041`): в них подставляется фактический UUID задачи из леджера (`352f3912-…`, `261037d9-…`, `da617bd1-…`, `025a73a1-…`, `cccb16bb-…`, `82c39792-…`, `d61d6871-…`). У 14 карточек `MW-042…MW-055` текст «не создана» верен и не меняется.
  2. **После `MW-073` (cutover завершён):** отдельным шагом строка заменяется на `Board ID: см. INDEX.md (boardTaskId)` во всех 55 карточках — когда производный `INDEX.md` (`MW-071`) уже ведёт это поле. Массовое удаление **не входит** в тот же пакет правок, что и работа этапов 0–1.
- **Почему:** §1.1 — 7 карточек из 21 утверждают «не создана», хотя их задача в леджере есть. Red-team B (находка по M-1): массовое удаление 34 рабочих UUID «уничтожает связь легаси-леджера с карточками до cutover». Копия производного факта в 55 файлах гарантированно расходится; мастер-план: принцип 2 («Один authority на факт»).
- **Приёмка до:** `Board ID:` в шапке считается источником истины о принадлежности доске; 7 значений ложны.
- **Приёмка после:** гейт `Select-String '.work/tasks/MW-*.md' -Pattern '^Board ID: не создана'` → ровно **14** совпадений (только `MW-042…MW-055`); после cutover — отдельный гейт `^Board ID: (?!см\. INDEX\.md)` → 0 совпадений.

#### M-2 · Противоречие «не запускай субагентов» между карточками и брифом кампании

- **Было (строки 22–23 всех 55 карточек, идентичны):** `…Не запускай субагентов, платные LLM-пробы или другую модель автоматически. Не меняй живой DSH profile, чужие проекты или доску разработки…`
- **Было (`00-RECON.md` §6):** `Каждый участник обязан использовать субагентов для сбора доказательств (правило владельца: «множество субагентов»).`
- **Стало (предложение, требует решения владельца):** ограничение карточки остаётся в силе **для исполнения карточки** (поверхность worker'а, D15/MW-069), а в шапке кампании явно записывается, что кампания планирования им не связана: это разные поверхности с разными правами. Формулировка карточки при этом не меняется — меняется только явность области действия.
- **Почему:** обнаружено при инвентаризации (фактические строки прочитаны у всех 55 файлов, §0.1); следствие подтверждено на практике: `subagent` из сессии-участника падает с `subagent depth 2 exceeds maxDepth 1`, и §6 брифа оказался неисполнимым (§0.4). Молча «не заметить» противоречие нельзя: оно влияет на доказательную базу всего плана.
- **Приёмка до:** два документа противоречат друг другу без указания области действия.
- **Приёмка после:** в `00-RECON.md` §6 или в `01-MASTER-PLAN.md` §11 есть строка об области действия; гейт — `Select-String 'plan-v0.3' -Pattern 'субагент'` находит разрешение, а не только запрет.

### 2.8. Дополнение: 7 карточек, которые иначе остались бы без правок

#### C-49 · MW-002 — peer-гейт объявляется на этапе каркаса

- **Карточка:** MW-002, строка 17 (объём), строка 20 (приёмка).
- **Было (строка 17, ключевой фрагмент):** `…Использовать подтверждённый SDK и его правила публикации.`
- **Стало (добавлено):** `Манифест сразу объявляет peerDependencies по реально используемым сервисам (сегодня — только @deepseek-ai/cordis) с диапазоном >=0.1.7-rc.2 <0.3.0-0 (решение владельца 2026-10-03; верхняя граница обязана нести `-0`, иначе `0.2.0` final платформы отвергается, а `0.3.0-rc.1` проходит — `02-PLATFORM-DELTA-0.2.0-rc.2.md` §5.1) и поле engines; engines DSH не читает — ни код, ни Plugin Manager (`packages/boot/app-boot/README.md:52`: «these checks use peer declarations, not `engines.dsh`»), тип объявлен, но не enforced, поэтому engines не подменяет peerDependencies. Полное решение о распространении — MW-060.`
- **Стало (строка 20, добавлено):** `Проверка манифеста: peer-гейт установки не даёт отказов, а отсутствие обязательного peer'а даёт явную ошибку установки, а не тихую работу.`
- **Почему:** §3.3 п. 1 брифа («Peer-compat gate — новый обязательный контракт публикации плагинов; MyWork объявляет только `@deepseek-ai/cordis`»); D04 (`01-MASTER-PLAN.md`); §9(7) (`:298`: «Не полагаться на `dsh.engines.dsh` (DSH его не читает)»).
- **Приёмка до:** 4 пункта. **После:** 5 пунктов; гейт — установка в изолированный профиль без предупреждений peer-гейта.

#### C-50 · MW-003 — типы аудита и состояний решений человека

- **Карточка:** MW-003, строка 17 (объём).
- **Было:** `Описать Task/Attempt/Review, Agent Identity/Blueprint/Role, revisions, operation/correlation IDs, Result/Error и event envelope. Реализовать валидируемые чистые state transitions и ownership из матрицы authority; интеграции только через Ports.`
- **Стало (добавлено):** `В AUDIT_EVENT_TYPES добавляется gate.asked (сегодня есть только gate.decided и human.override: contracts/src/audit.ts:75,77) — иначе вопрос человека неотличим от ответа. Состояния решения человека (pending/answered/expired/cancelled/superseded) объявляются в контрактах; сущность и переходы — MW-030 (правка C-24, решение D14). Тип HumanGate (5 значений, contracts/src/security.ts:171-181) не переиспользуется под новую сущность.`
- **Почему:** `evidence/quality-02.md:3,13` (`HUMAN_GATES` 5 значений; `gate.asked` — 0 совпадений в `packages/**`), `:20` (`ReviewState 'escalated'` — тупик); `FINAL-REPORT.md:402`; D14.
- **Приёмка до:** проверки переходов, ownership, отсутствие импортов DSH/Beads/памяти.
- **Приёмка после:** то же + `gate.asked` в типизированном наборе; гейт — тест исчерпываемости `AUDIT_EVENT_TYPES` и компиляция без `any`.

#### C-51 · MW-006 — швы промпта и конфигурации без второго слоя

- **Карточка:** MW-006, строка 17 (объём).
- **Было:** `Ввести global/isolated/inherit с порядком overlays, Team, Role Contract/Strategy, Blueprints, Identity и ConfigRevision. Зафиксировать resolved revisions при admission Attempt; runtime/session не хранить как Identity.`
- **Стало (добавлено):** `Порядок секций системного промпта не дублируется собственным реестром: конфигурация секции кладётся в ctx.systemPrompt.section с конечным order (нечисловой order бросает). Организация адаптеров идёт через ctx.storageDomain там, где это не создаёт вторую authority (D08).`
- **Почему:** D10, D08; `evidence/quality-05.md:44` («scoped shadowing, non-finite order throws; `SECTION_ORDERS` каталог»), `:34` (`storage-domain`: `DomainFacility.open(spec)`, `ctx.storageDomain`).
- **Приёмка до:** 3 пункта (precedence, namespace isolation, frozen revisions). **После:** 4 пункта; гейт — тест нечислового `order` → типизированная ошибка.

#### C-52 · MW-008 — retention и сканирование тел в Artifact Store

- **Карточка:** MW-008, строка 17 (объём), строка 20 (приёмка).
- **Было (строка 17):** `Создать локальный immutable artifact store с hash/ref и append-only audit. Сохранять verification/review/context/checkpoint evidence с workspace/task/attempt/correlation IDs; отделить audit от обычной ротации логов.`
- **Стало (добавлено):** `Артефакты в BLOB не удаляются и не переписываются (запрет DELETE/UPDATE), поэтому рост ограничивается только окнами retention и VACUUM — их задаёт MW-062; тела артефактов сканируются на секреты, а не только метаданные.`
- **Стало (строка 20, добавлено):** `Повторная запись с иным содержимым не перезаписывает artifact (уже есть) и не считается ротацией; тест кладёт секрет-маркер в тело артефакта и получает запись сканера.`
- **Почему:** `FINAL-REPORT.md:380` (§8.2 P22: «артефакты в BLOB с запретом DELETE/UPDATE триггерами; `outbox`/`inbox_dedup` не чистятся; сканер секретов только по метаданным, не по телам»); D17; §1.3 п. 7 брифа.
- **Приёмка до:** 3 пункта. **После:** 4 пункта; гейт — тест сканера на теле артефакта.

#### C-53 · MW-012 — атомарность и write-intent на Attempt

- **Карточка:** MW-012, строка 17 (объём).
- **Было:** `Добавить ClaimIntent → graph claim → Attempt+lease → projection → completed с operationId. Все authoritative callbacks проверяют task revision, epoch и fence; определить recover/revoke для незавершённой saga.`
- **Стало (добавлено):** `Шаги saga пишутся атомарно (temp+rename, withFileLock при нескольких писателях; механизм — MW-059), а намерение записи в рабочее дерево фиксируется advisory-событием (write-intent) и не является блокировкой — перенос паттерна из Agent Teams, предмет MW-066.`
- **Почему:** D13 (`01-MASTER-PLAN.md`); RT-1; RT-6 (`:277`: «write-intent как диагностика, не как lock»); `evidence/execution-04.md:5-11` (провенанс five-step saga).
- **Приёмка до:** 3 пункта (fault injection после каждого шага, late result, один lease).
- **Приёмка после:** те же + атомарность шага и advisory-природа write-intent; гейт — kill между шагами не оставляет половины saga-записи.

#### C-54 · MW-014 — детерминизм через инъецированные часы

- **Карточка:** MW-014, строка 17 (объём), строка 20 (приёмка).
- **Было (строка 17):** `Сделать event-driven kick и safety reconcile, eligibility по role/capability/workspace/security/budget/provider, отдельные Worker/Reviewer pools, лимиты attempts/LLM/heavy tools. Добавить priority+aging и ограниченную fairness между workspace.`
- **Стало (добавлено):** `Время приходит только через инъецированные часы (ClockPort): Date.now() в домене запрещён, иначе расхождение с платформенным time-context невоспроизводимо (строк time-context/schedule/ui-schedule в дефолтной web-композиции 0.2.0-rc.2 нет — они приходят только с бандлом @deepseek-ai/dsh-experimental-schedule-bundle, `packages/boot/app-boot/src/profile.ts:217`; живой профиль его включает, `profiles/web/package.json:39`; на 0.2.1 бандл снимается загрузчиком сам — `02-PLATFORM-DELTA-0.2.0-rc.2.md` §2.1 G1, §5.2). Лимит провайдерной параллельности — из BudgetLimits (providerConcurrency как платформенной метрики не существует).`
- **Почему:** D11 (`01-MASTER-PLAN.md`); RT-11; R-8; `evidence/quality-04.md:13`.
- **Приёмка до:** одинаковое состояние → одинаковое назначение; concurrency ≤ caps; sleeping/idle не вызывает LLM.
- **Приёмка после:** те же + `Select-String packages -Pattern 'Date\.now'` в домене планировщика пусто; гейт — два прогона с одинаковым `FakeClock` дают идентичный порядок.

#### C-55 · MW-032 — learner ограничен бюджетом и durable-носителем

- **Карточка:** MW-032, строка 20 (приёмка).
- **Было:** `Candidate не меняет Role Contract/security автоматически. Повтор события не создаёт duplicate learning. Malicious tool/web content остаётся low-trust; learner ограничен бюджетом и не работает на idle ticks.`
- **Стало (добавлено):** `Бюджет learner'а — из общего circuit-breaker (MW-061), носитель запуска — durable job на собственной БД MyWork (MW-068); jobs-local не используется как носитель, потому что он in-memory и process-local.`
- **Почему:** D05, D09; `FINAL-REPORT.md:423`; `evidence/quality-05.md:27-30`.
- **Приёмка до:** 3 пункта. **После:** 4 пункта; гейт — перезапуск процесса не теряет запланированное обучение, а превышение бюджета даёт типизированную остановку.

### 2.9. Сводная таблица: карточка → этап → зависимости → правка → гейт

«Этап» — этап плана по канону §2 `00-RECON.md`; «phase» — текущий `phase` из `tasks.json`. Гейт — минимальная проверка, доказывающая правку. **Колонка `dependsOn` показывает состояние до правок red-team B** (добавлены 8 потерянных рёбер, 14 обратных и развёрнута `MW-070`); авторитетная копия — §3.24.

| ID | phase (`tasks.json`) | Этап плана | dependsOn | Правка | Гейт |
|---|---|---|---|---|---|
| MW-001 | 00-foundation | 1 | нет | C-01 | статус совпадает с отчётом; `done-with-report` |
| MW-002 | 00-foundation | 1 | MW-001 | C-49 | установка без предупреждений peer-гейта |
| MW-003 | 00-foundation | 1 | MW-002 | C-50 | `gate.asked` в `AUDIT_EVENT_TYPES` |
| MW-004 | 00-foundation | 2 | MW-003 | C-02, C-53* | `MIGRATIONS_REQUIRED`; kill между migrate/verify |
| MW-005 | 00-foundation | 1 | MW-003 | C-08 | boundary-тест ловит DSH-импорт в `scheduler/src` |
| MW-006 | 00-foundation | 1 | MW-004, MW-005 | C-51 | нечисловой `order` секции → ошибка |
| MW-007 | 00-foundation | 3 | MW-005, MW-006 | C-03 | отказ приходит из `sandboxPolicy`/fs-observation |
| MW-008 | 00-foundation | 2 | MW-004, MW-007 | C-52 | сканер находит маркер в теле артефакта |
| MW-009 | 01-runtime | 1 | MW-004, MW-008 | C-09 | stale `controllerEpoch` → `STALE_EPOCH`, ревизия не менялась |
| MW-010 | 01-runtime | 1 | MW-005, MW-009 | C-04 | `pass 70 / fail 0 / skipped 0` |
| MW-011 | 01-runtime | 1 | MW-010 | C-05 | `skipped 0` на staged-мутации |
| MW-012 | 01-runtime | 4 | MW-009, MW-010, MW-011 | C-53 | kill между шагами saga не оставляет половины записи |
| MW-013 | 01-runtime | 3 | MW-005, MW-006, MW-007 | C-06 | удаление вызова бюджета ломает тест |
| MW-014 | 01-runtime | 2 | MW-012, MW-013 | C-54 | два прогона с `FakeClock` дают один порядок |
| MW-015 | 01-runtime | 2 | MW-005, MW-007, MW-013 | C-07 | 8 политик сессии различимы в отказе |
| MW-016 | 02-context | 3 | MW-005, MW-006, MW-008, MW-013 | C-10 | `dispose` снимает секцию промпта и L2 из spillStore |
| MW-017 | 02-context | 3 | MW-006, MW-016 | C-11 | один источник списка skills |
| MW-018 | 02-context | 3 | MW-005, MW-008, MW-016 | C-12 | секрет-маркер в теле memory-записи найден сканером |
| MW-019 | 02-context | 3 | MW-018 | C-13 | таблица capability backend'а с пробами |
| MW-020 | 02-context | 3 | MW-008, MW-015, MW-016 | C-14 | retention уменьшает `controller.sqlite` |
| MW-021 | 03-execution | 4 | MW-008, MW-012 | C-15 | пересечение `writeScopes` даёт событие, не отказ |
| MW-022 | 03-execution | 4 | MW-014…MW-021 | C-16 | в инструментах сессии нет `cordis_*`/`plugin_manager` |
| MW-023 | 03-execution | 4 | MW-022 | C-17 | искусственный skip гейта → failed |
| MW-024 | 03-execution | 4 | MW-015, MW-020, MW-023 | C-18 | `auto-review` отсутствует в профиле; эскалация называет получателя |
| MW-025 | 03-execution | 4 | MW-010, MW-021, MW-024 | C-19 | якорь `§26 (строка 1812)` |
| MW-026 | 03-execution | 4 | MW-011, MW-015, MW-016 | C-20 | `PLANNER_UNAVAILABLE` без MW-026 |
| MW-027 | 04-control | 0 | MW-005, MW-010, MW-025 | C-21 | отсутствует в активной колонке доски |
| MW-028 | 04-control | 4 | MW-009, MW-014, MW-022, MW-025 | C-22 | resident-профиль на изолированном `DSH_HOME` |
| MW-029 | 04-control | 3 | MW-018, MW-026, MW-028, MW-043, MW-047 | C-23 | решение D01 зафиксировано; префиксы не смешаны |
| MW-030 | 04-control | 3 | MW-007, MW-012, MW-020, MW-029 | C-24 | 9 тестов `HumanDecision` без UI, нет блокирующего ожидания |
| MW-031 | 04-control | 4 | MW-012, MW-014, MW-020, MW-025, MW-030 | C-25 | `Date.now()` в детекторах отсутствует |
| MW-032 | 05-learning | 5 | MW-017, MW-018, MW-024 | C-55 | перезапуск не теряет обучение |
| MW-033 | 05-learning | 5 | MW-006, MW-013, MW-032 | C-26 | перезапуск не теряет optimizer run |
| MW-034 | 05-learning | 3 | MW-013, MW-016, MW-020, MW-025, MW-032 | C-27 | `correlationId` виден в спане по Attempt |
| MW-035 | 06-ui | 0 | MW-027, MW-029, MW-034 | C-28 | отсутствует в активной колонке доски |
| MW-036 | 06-ui | 5 | MW-006, MW-029, MW-030, MW-048 | C-29 | `строка undefined` → 0 |
| MW-037 | 06-ui | 5 | MW-033, MW-034, MW-048 | C-30 | `§56` помечен `~` и вынесен в открытые проверки |
| MW-038 | 07-acceptance | 5 | MW-010, MW-015, MW-019, **MW-042, MW-047**, MW-029, MW-031 | C-31 | Doctor не меняет mtime профиля; диагностика `bd`-seam |
| MW-039 | 07-acceptance | 5 | MW-007, MW-024, MW-025, MW-030, MW-031, MW-033, MW-038 | C-32 | инвариант §59 нарушен → `node --test --test-isolation=none tests/invariants.test.mjs` падает |
| MW-040 | 07-acceptance | 2 | MW-004, MW-039 | C-33 | kill между migrate/verify восстанавливается по journal |
| MW-041 | 07-acceptance | 5 | MW-028, MW-036, MW-037, MW-038, MW-039, MW-040, MW-055, **MW-060, MW-063** | C-34 | `git tag -l v0.1.0-m1` непусто; `pack.mjs` exit 0 |
| MW-042 | 01b-board | 3 | MW-003, **MW-072** | C-35 | property-тест на 16 состояний (без `data-mw-*` и без носителя причины) |
| MW-043 | 04b-board | 5 | MW-042, MW-011 (**MW-026 снят**) | C-36 | `PLANNER_UNAVAILABLE` только для плановой ветки |
| MW-044 | 04b-board | 4 | MW-011, MW-014, MW-022, MW-025 | C-37 | `ctx.workflowEngine` не используется |
| MW-045 | 04b-board | 4 | MW-044, MW-023, MW-025 | C-38 | таблица «work type → человеческая приёмка» |
| MW-046 | 04b-board | 5 | MW-012, MW-022, MW-030 | C-39 | ответ приходит в живую попытку, шаг не блокируется |
| MW-047 | 04b-board | 5 | MW-042, MW-010, MW-011, MW-025 | C-40 | `empty` ≠ `degraded`; ревизию двигает проектор |
| MW-048 | 06-ui | 3 | MW-029, **MW-072**, **MW-060** | C-41 | `data-dsh-` в `packages/web` → 0; панель видна после refresh |
| MW-049 | 06-ui | 5 | MW-048, MW-042, **MW-064** | C-42 | число панелей = числу зон D02; порог измерен |
| MW-050 | 06-ui | 5 | MW-049, MW-046, **MW-064** | C-43 | 4 пункта приёмки исполнимы и покрыты тестами |
| MW-051 | 06-ui | 5 | MW-044, MW-045, MW-048 | C-44 | редактор отвергает то же, что валидатор |
| MW-052 | 06-ui | 5 | MW-049, MW-042 | C-45 | `package.json` затронутых пакетов не изменён |
| MW-053 | 06-ui | 5 | MW-050 | C-46 | матрица пяти режимов на выбранной раскладке |
| MW-054 | 07-migration | 5 | MW-047, MW-029, MW-030 | C-47 | вывод команды про отсутствие `autoRun*` и расписаний |
| MW-055 | 07-acceptance | 5 | MW-053, MW-054, MW-031, MW-038, MW-039, **MW-071** | C-48 | хеш оригинального ledger не изменён; число карточек — из вывода |
| 001–055 | — | 0 | — | M-1 | `^Board ID:` → 0 или `см. INDEX.md` |
| 001–055 | — | — | — | M-2 | область действия запрета субагентов зафиксирована |

\* C-53 указан у MW-004 и MW-012: правка касается общей атомарности записи (MW-004 владеет механизмом, MW-012 — применением в saga).

**Итог части (1):** просмотрены все 55 карточек; **правок — 57**: 55 индивидуальных (`C-01`…`C-55`, по одной на каждую карточку — C-01…C-48 закрывают MW-001…MW-055 в порядке групп, C-49…C-55 закрывают MW-002, 003, 006, 008, 012, 014, 032) плюс 2 массовых (`M-1`, `M-2`, применяются ко всем 55). Требуемый минимум ≥20 превышен более чем вдвое.

---

## 3. Часть (2) — новые карточки MW-056…MW-074

### 3.0. Правило отбора и что проверено

**Правило §2.2 брифа:** если ≥70 % работы попадает в существующую карточку — правим существующую; иначе новая карточка + явная ссылка из правки старой.

**Тематический резерв §2.2 соблюдён:**

| Диапазон §2.2 | Что создано |
|---|---|
| MW-056…MW-059: `bd`-seam, тест/адаптер Beads, composition root, реестр миграций + journal + атомарность | MW-056, MW-057, MW-058, MW-059 |
| MW-060…MW-064: публикуемость/peer/CI, бюджет и шаги, retention и сканеры, installable UI-пакет, DropIntent-резолвер | MW-060, MW-061, MW-062, MW-063, MW-064 |
| MW-065…MW-069: provisioning saga, write-intent, handoff artifact, durable jobs, ограничения worker-поверхности | MW-065, MW-066, MW-067, MW-068, MW-069 |
| MW-070…MW-075: model availability, леджеры, HumanDecision, cutover, invariants+doctor, упаковка | MW-070, MW-071, MW-073, MW-074 + **MW-072 переиспользован** под каркас `packages/web` (шаг `B-01a`, red-team B §3.1) и **MW-076** под повторный прогон гейта этапа 2 | **MW-075 не создаётся** (упаковка — в MW-041; инвентаризация — в MW-071, см. §3.19) |

**Почему `MW-075` (упаковка) не создаётся:** работа «упаковать operational v0.1» на ≥90 % попадает в существующую MW-041 (`Этап: 07-acceptance`, объём «Сверить все 39 требований §62… Подготовить локальный пакет, README и инструкции Embedded/Resident»), а публикуемость вынесена в MW-060. По правилу 70 % — правим MW-041 (правка C-34), новую карточку не заводим. Диапазон MW-075…MW-080 остаётся свободным.

**Проверка отсутствия циклов и висячих ссылок** (скрипт `.tmp/plan-v03-cards/verify-final.ps1`, 75 узлов: 55 существующих + 20 новых, с учётом предлагаемых правок `dependsOn` из §2):

```
nodes = 75  (55 существующих + 20 новых)   problems = 1 (ожидаемое ребро MW-035 → MW-027) ; cycles = 0
deps pointing to unknown ids = 0            self-deps = 0                 duplicates = 0
sinks among new cards = 0                   id gap = 75 (отклонена осознанно)
```

Первый прогон нашёл **один цикл** — `MW-063 -> MW-048` — из-за ошибочного предложения добавить `MW-063` в `dependsOn` карточки MW-048. Предложение снято: зависимость идёт в одну сторону (`MW-063` зависит от `MW-048`), повторный прогон даёт 0 циклов. Значения `depth` (длина longest path от корней) приведены у каждой карточки.

**Важно про имя поля:** в задании и `00-RECON.md` §1.4 запись для леджера описана как `stage`, но **в фактическом `tasks.json` поля `stage` нет** — есть `phase` (проверено: `tasks.json` → `id, phase, title, sections, dependsOn, status, scope, acceptance, report, baselineItems, adrs, supersededBy`). Ниже в записях используется `phase`; если решено перейти на `stage`, это отдельная миграция леджера, а не побочный эффект добавления карточек.


**Статус готовности после правок red-team B.** К созданию готовы **`MW-056`…`MW-060`** (red-team признал их безопасными, и правки их не касались): зависимости существуют, приёмки проверяемы командами, скрытых циклов нет. Остальные 15 карточек **приведены в исполнимый вид** правками §3.22 и §7 (разорваны циклы, добавлены 8 потерянных и 14 обратных рёбер, развёрнута `MW-070`, заведены `MW-072` и `MW-076`), но требуют повторной проверки независимым верификатором до создания — их статус: **«ждёт ре-верификации»**, а не «можно создавать».
### 3.1. MW-056 · Починить `bd`-seam на Windows и сделать backend проверяемым

- **phase:** `01-runtime` · **Этап плана:** 1 · **dependsOn:** нет · **adrs:** `ADR023`, `ADR024` · **depth:** 0
- **Цель:** ни один тест реального backend не может быть `skipped` в CI-профиле; `bd` резолвится на Windows без `ENOENT`.
- **Объём:** резолв JS-entry через `process.execPath` во всех местах, где сегодня вызывается `spawnSync('bd', …, {shell:false})` (проба, `runner.ts:96,102-108`, адаптер); одна функция `resolveBdCommand()` на весь пакет; CI-профиль, в котором `skipped` считается `failed`; явная типизированная ошибка с точной командой инициализации вместо тихого скипа.
- **Приёмка:**
  1. `node --test tests/beads-adapter.test.mjs` → `pass 70 / fail 0 / skipped 0`. 2. `resolveBdCommand()` на Windows даёт `process.execPath` + путь к JS-entry; прямой `spawnSync('bd', {shell:false})` из теста даёт `ENOENT` (то есть тест действительно ловит дефект, а не обходит его). 3. В CI-профиле тест, помеченный `skip`, валит прогон и печатает причину. 4. Поведение на Linux/macOS не меняется: тот же резолвер, тот же exit code. 5. Прежний номер `errno -4058` воспроизводится на старом коде и отсутствует на новом — то есть доказательство падающего-до/зелёного-после приложено.
- **Что не делать:** не поднимать `bd serve` (HTTP-транспорт остаётся `http=false`); не выполнять `bd init`; не менять воркспейс `.beads`; не чинить Dolt-remote (`bd dolt push/pull` вне scope); не переписывать адаптер.
- **`tasks.json`:** запись **MW-056** — в сводном блоке §3.24 (единственная копия; дублировать JSON в описании карточки не нужно).
- **`INDEX.md`:** новый раздел `## 01c-bd-seam` **или** строка в существующем `## 01-runtime` (рекомендуется второе, чтобы не плодить разделы): `| [MW-056](MW-056.md) | Починить bd-seam на Windows и сделать backend проверяемым | — | planned |`. При выборе отдельного раздела — вставить перед `## 02-context`.
- **Критический путь:** **вне** критического пути, но блокирует доказуемость MW-010/MW-011 (`01-MASTER-PLAN.md`: `F-10 bd-seam → F-11 → F-12 → MW-010/MW-011 доказуемы`). Обязателен до приёмки этапа 1.
- **Источник шага:** `F-10` (`01-MASTER-PLAN.md`), `FINAL-REPORT.md:413` (§9.1 «Новые карточки» п. 1), `FINAL-REPORT.md:162` (§3.3 п. 7: «`spawnSync('bd', {shell:false})` → ENOENT (errno -4058) в пробе и раннере; 23 теста реального backend молча `skipped`»), `01-MASTER-PLAN.md`.

### 3.2. MW-057 · Починить тест batch-рёбер и актора `heartbeat`

- **phase:** `01-runtime` · **Этап плана:** 1 · **dependsOn:** `MW-056` · **adrs:** `ADR023` · **depth:** 1
- **Цель:** тесты адаптера проверяют то, что заявлено: поля batch-рёбер читаются правильно, а `heartbeat` шлёт того же актора, что `claim`.
- **Объём:** исправить тест batch-рёбер так, чтобы он читал `id`/`dependency_type` (а не `depends_on_id`); исправить вызов `bd heartbeat` в адаптере, чтобы актор передавался так же, как в `claim` (`adapter.ts:583-590` против `:495-500`); добавить тест, который падает на старом коде.
- **Приёмка:**
  1. Тест batch-рёбер падает до правки и проходит после; в отчёте — вывод обоих прогонов. 2. В журнале `bd events` актор `heartbeat` совпадает с актором `claim` для той же задачи. 3. `node --test tests/beads-adapter.test.mjs` → `skipped 0` (зависит от MW-056). 4. Ни один тест не проходит «случайно»: мутация возврата старого поля ловится тестом.
- **Что не делать:** не менять `AdapterCapabilityManifest`; не добавлять новых `bd`-команд; не трогать `reclaim`/`claim`-логику, кроме передачи актора.
- **`tasks.json`:** запись **MW-057** — в сводном блоке §3.24 (единственная копия; дублировать JSON в описании карточки не нужно).
- **`INDEX.md`:** `| [MW-057](MW-057.md) | Починить тест batch-рёбер и актора heartbeat | MW-056 | planned |` — сразу после MW-056.
- **Критический путь:** вне критического пути; часть блока `F-11`/`F-12` (`01-MASTER-PLAN.md,188`).
- **Источник шага:** `F-11`, `F-12`; `FINAL-REPORT.md:413` (§9.1 «Новые карточки» п. 2).

### 3.3. MW-058 · Composition root: одна точка сборки приложения

- **phase:** `04-control` · **Этап плана:** 2 · **dependsOn:** `MW-004`, `MW-009`, `MW-059` · **adrs:** — (оформляется записью D07) · **depth:** 8
- **Цель:** все 12 пакетов достижимы из runtime; изолированный `DSH_HOME` после smoke содержит `controller.sqlite` ожидаемой версии схемы.
- **Объём:** выбрать форму по D07 (application service в `controller` против отдельного пакета `app`) по критерию «тестируемость + отсутствие циклов»; одна точка сборки открывает `controller.sqlite` полным списком миграций, поднимает `lease/planner/execution/scheduler/evidence` и регистрирует их; добавить path-алиасы `planner` и `memory-native` в `tsconfig.base.json`; smoke-тест на изолированном `DSH_HOME`.
- **Приёмка:**
  1. Runtime-достижимость 12/12 пакетов: у каждого есть импортёр в `packages/**/src` или регистрация в composition root (сегодня `planner`, `evidence`, `memory-native`, `execution`, `scheduler` не имеют ни одного рантайм-импортёра). 2. `Test-Path "$env:DSH_HOME\dsh-mywork\state\controller.sqlite"` → `True` после smoke. 3. Версия схемы в файле совпадает с версией из единого реестра (MW-059), а не с константой в коде. 4. Граф импортов пакетов ацикличен; `tsconfig.base.json` содержит алиасы `planner` и `memory-native`. 5. Smoke не работает на живом профиле пользователя.
- **Что не делать:** не переносить бизнес-логику в composition root; не создавать второй DI-контейнер; не заменять `AgentRuntimePort`; не строить coordination subsystem.
- **`tasks.json`:** запись **MW-058** — в сводном блоке §3.24 (единственная копия; дублировать JSON в описании карточки не нужно).
- **`INDEX.md`:** строка в `## 04-control` перед MW-027 (чтобы чтение шло в порядке этапов): `| [MW-058](MW-058.md) | Собрать composition root: одна точка сборки приложения | MW-004, MW-009, MW-059 | planned |`.
- **Критический путь:** **внутри.** `01-MASTER-PLAN.md`: `… F-13 → F-20 → MW-022 …`, где `F-20` — это MW-058. Без него MW-022 не имеет живого store.
- **Источник шага:** `F-20` (`01-MASTER-PLAN.md`), D07 (`:249`), §8.1/§8.2 P4 (`FINAL-REPORT.md:172,177`), `evidence/quality-01.md:9-10,16-17,23`.

### 3.4. MW-059 · Единый реестр миграций, migration journal и атомарная запись

- **phase:** `00-foundation` · **Этап плана:** 2 · **dependsOn:** `MW-004` · **adrs:** — (D08) · **depth:** 4
- **Цель:** открыть store без канонического списка миграций невозможно; прерывание между `migrate` и `verify` не даёт silent empty-state; запись состояния атомарна.
- **Объём:** `packages/storage/src/migrations.ts:91-94` — собрать `MYWORK_DATABASE_MIGRATIONS` из `storage` + `EVIDENCE_MIGRATIONS` (`evidence/src/schema.ts:138`) + `LEASE_MIGRATIONS` (`lease/src/schema.ts:66`) + `CLAIM_SAGA_MIGRATIONS` (`execution/src/schema.ts:153`) + `PLAN_MUTATION_MIGRATIONS` (`planner/src/schema.ts:148`); убрать спред у вызывающего (`planner/src/index.ts:20-23`, `execution/src/schema.ts:31-34`); `openStore()` без явного списка → `MIGRATIONS_REQUIRED`; journal с обязательным verify-шагом; `writeFileAtomic` (temp+rename) и `withFileLock`.
- **Приёмка:**
  1. `openStore({ migrations: [] })` → типизированная ошибка `MIGRATIONS_REQUIRED`; тест `node --test tests/storage/migrations-registry.test.mjs` → `pass 1 / fail 0`. 2. `MYWORK_SCHEMA_VERSION` выводится из реестра, а не задаётся рядом. 3. Тест «kill между migrate и verify» не оставляет пустого store: состояние восстанавливается по journal. 4. Тест атомарности: убийство процесса между temp-записью и rename не теряет предыдущую версию. 5. Ни один вызывающий не собирает список миграций сам (`Select-String packages -Pattern 'MIGRATIONS\]'` в композиции пусто).
- **Что не делать:** не переписывать схему и не менять существующие таблицы; не вводить event sourcing; не дублировать журнал (он уже есть — `schema_migrations`, `storage/src/migrations.ts:97-103`).
- **`tasks.json`:** запись **MW-059** — в сводном блоке §3.24 (единственная копия; дублировать JSON в описании карточки не нужно).
- **`INDEX.md`:** строка в `## 00-foundation` после MW-008: `| [MW-059](MW-059.md) | Ввести единый реестр миграций, journal и атомарную запись | MW-004 | planned |`.
- **Критический путь:** **внутри.** `01-MASTER-PLAN.md`: `F-01 → F-13 → F-20 → …`; `F-13` — это MW-059, и `F-20` (MW-058) от него зависит.
- **Источник шага:** `F-13`, `F-21`, `F-22`; D08; RT-1/RT-10; §8.2 P5 (`FINAL-REPORT.md:173`); `evidence/quality-02.md:21-26`.

### 3.5. MW-060 · Публикуемость: peer-контракт, engines, CI, тег `v0.1.0-m1`, `pack.mjs`

- **phase:** `07-acceptance` · **Этап плана:** 1 (CI и тег) + 3 (peer и распространение) · **dependsOn:** нет · **adrs:** — (D04) · **depth:** 0
- **Цель:** проект собирается и проверяется одной командой входа в CI; пакет устанавливается как плагин; публикация возможна by construction.
- **Объём:** минимальный CI (`install --frozen-lockfile` → `tsc` ×12 → `tsdown` → `smoke` → `node --test` → `verify-profile.mjs`); тег `v0.1.0-m1`; `peerDependencies` по реально используемым сервисам с `@deepseek-ai/dsh: >=0.1.7-rc.2 <0.3.0-0` (решение владельца 2026-10-03; замер трёх диапазонов — `02-PLATFORM-DELTA-0.2.0-rc.2.md` §5.1; эталон-плагин доски 0.4.4 объявляет `peerDependencies`/`dsh.engines.dsh = >=0.2.0-rc.1`); CI-пин платформы живёт в `.github/workflows/ci.yml:131` и в дереве **уже равен** `@deepseek-ai/dsh@0.2.0-rc.2` (правка кампании 2026-10-03, коммит `d0b1f07`) — предмет этой карточки не «сменить пин», а закрепить его гейтом; поле `engines` (декоративно: читателей нет); идемпотентность `packController`; починка `scripts/pack.mjs`; точечное снятие `private` там, где это нужно для доставки.
- **Приёмка:**
  1. CI-прогон на чистом клоне зелёный; `node scripts/pack.mjs` → `EXIT=0`; прежний `EXIT=1` воспроизведён и объяснён (битый глобальный pnpm-линк). 2. `git tag -l v0.1.0-m1` → тег существует и указывает на коммит с зелёным CI. 3. `peerDependencies` манифеста перечисляют реально используемые сервисы; peer-гейт установки не выдаёт отказов. 4. `engines.node` соответствует обещанию платформы `^22.19.0 || >=24.0.0` (`tests/peer-gate.test.mjs:51,199`; то же значение у DSH `0.2.0-rc.2` — с базы не менялось), а не более широкому корневому `>=22.18.0`; отдельно зафиксировано, что `dsh.engines.dsh` не читается платформой и не подменяет `peerDependencies`. 5. Решение по `private` принято точечно: снят только у того, что реально публикуется, и это записано в отчёте.
- **Что не делать:** не публиковать в npm/GitHub без отдельного разрешения владельца; не снимать `private` со всех 12 пакетов «для симметрии»; не заменять CI полным локальным прогоном.
- **`tasks.json`:** запись **MW-060** — в сводном блоке §3.24 (единственная копия; дублировать JSON в описании карточки не нужно).
- **`INDEX.md`:** строка в `## 07-acceptance` перед MW-055: `| [MW-060](MW-060.md) | Обеспечить публикуемость: peer-контракт, CI, тег и pack.mjs | — | planned |`.
- **Критический путь:** вне критического пути, но **гейт для всех последующих этапов** (`01-MASTER-PLAN.md`: «`F-15 CI+тег` ────→ все последующие этапы»).
- **Источник шага:** `F-15`, `F-16`, `F-30…F-32`; D04; R-12? нет — §8.2 P10/P11/P12 (`FINAL-REPORT.md:176`); §9.1 (MW-040/041); §7.4(5)(6).

### 3.6. MW-061 · Бюджет и лимит шагов: circuit-breaker поверх `dsh-token-meter`

- **phase:** `01-runtime` · **Этап плана:** 3 · **dependsOn:** `MW-013`, `MW-034` · **adrs:** — (D05) · **depth:** 17
- **Цель:** runaway-стоимость невозможна: превышение лимита стоимости или шагов останавливает работу с типизированной причиной и эскалацией.
- **Объём:** circuit-breaker поверх платформенного `@deepseek-ai/dsh-token-meter` (`ctx.tokenMeter`, `TokenMeter.measure(session, requestHeader)`); счётчик шагов агентского цикла; лимиты на attempt/workspace/сутки через существующие `BUDGET_LIMIT_NAMES`/`BudgetLimits`; оживление мёртвых вызовов `chargeConsumption`/`readCallTokens`/`modelCallCost`; журнал срабатываний; лимит провайдерной параллельности (в платформе метрики `providerConcurrency` нет — источник выбирается из `maxParallelToolCalls`/`maxParallelSubCalls` или из собственного лимита).
- **Приёмка:**
  1. Бюджет-тест обрывает прогон по лимиту шагов и по лимиту стоимости; причина типизирована и попадает в `needs-attention`. 2. `chargeConsumption`/`readCallTokens`/`modelCallCost` вызываются на production-пути; удаление вызова ломает тест (мутация ловится). 3. Второй учёт токенов не заведён: источник данных — `tokenMeter`, а не собственный счётчик из событий. 4. Неизвестная стоимость остаётся `unknown`, а не нулём (существующее свойство `budget.ts` сохраняется). 5. Журнал срабатываний читается и показывает, какой лимит и в какой Attempt сработал.
- **Что не делать:** не строить второй учёт (`dsh-token-meter` + `packages/core/src/budget.ts` уже есть, §9(6)); не вводить глобальный cap вне модели лимитов; не подменять `contextWindow` синтетическим окном.
- **`tasks.json`:** запись **MW-061** — в сводном блоке §3.24 (единственная копия; дублировать JSON в описании карточки не нужно).
- **`INDEX.md`:** строка в `## 01-runtime` после MW-015.
- **Критический путь:** вне критического пути; гейт этапа 3 (`01-MASTER-PLAN.md`: «бюджет-тест обрывает прогон по лимиту шагов/стоимости»).
- **Источник шага:** `F-33`; D05; RT-2 (`FINAL-REPORT.md:432`); §7.3; `evidence/quality-04.md:12-13,18-21`.

### 3.7. MW-062 · Retention, VACUUM и сканирование тел артефактов и памяти

- **phase:** `00-foundation` · **Этап плана:** 2 · **dependsOn:** `MW-004`, `MW-008`, `MW-059` · **adrs:** — (D17) · **depth:** 7
- **Цель:** у БД есть ограничители роста; секреты находятся в телах, а не только в метаданных.
- **Объём:** окна хранения по типу данных для `outbox`, `inbox_dedup`, `audit_events`, артефактов и memory-записей; `VACUUM`; сканирование тел артефактов и тел памяти; политика PII для экспорта; тесты на удаление старых записей и на уменьшение файла.
- **Приёмка:**
  1. Retention-тест удаляет старые записи и уменьшает размер файла БД. 2. Сканер находит тестовый секрет-маркер в теле артефакта и в теле memory-записи; удаление сканера ломает тест. 3. `VACUUM` выполняется по расписанию и не блокирует живой трафик (или блокирует в объявленном окне). 4. Артефакты по-прежнему неизменяемы: retention не переписывает и не подменяет тела (запрет DELETE/UPDATE сохраняется), удаление идёт только целыми записями по окну. 5. Ни одно окно не задано «на глаз»: каждое число в отчёте привязано к команде.
- **Что не делать:** не удалять audit-события произвольно (append-only — свойство, которое сохраняется); не сканировать только метаданные; не чистить БД вне транзакции.
- **`tasks.json`:** запись **MW-062** — в сводном блоке §3.24 (единственная копия; дублировать JSON в описании карточки не нужно).
- **`INDEX.md`:** строка в `## 00-foundation` после MW-059.
- **Критический путь:** вне критического пути; гейт этапа 2 («retention-тест удаляет старые записи и уменьшает файл», `01-MASTER-PLAN.md`).
- **Источник шага:** `F-24`; D17; §8.2 P6/P22 (`FINAL-REPORT.md:174,380`); §9.2(4)(5).

### 3.8. MW-063 · Installable UI-пакет и peer-манифест: установка в изолированный профиль

- **phase:** `06-ui` · **Этап плана:** 3 · **dependsOn:** `MW-029`, `MW-048`, `MW-060` · **adrs:** `ADR016`, `ADR021`, `ADR022` · **depth:** 19
- **Цель:** собранный пакет ставится в изолированный профиль, и панель MyWork видна в GUI после refresh — без пересборки web-приложения и без правок DSH.
- **Объём:** `packages/web` собирается в tarball; установка в изолированный `DSH_HOME`; проверка формы записи client-манифеста (bare-имя, `dsh.client`-манифест, `immediately`, `icon`); проверка, что бандл физически регистрируется платформой; выгрузка плагина снимает панель, иконку, маршруты и CSS; матрица проверок совместимости с платформой; фиксация неизвестности «поведение браузера: `/plugins/<id>/client.js`, HMR, темы».
- **Приёмка:**
  1. Установка tarball'а в изолированный профиль → панель видна в GUI **после refresh**; в отчёте — скриншот/дамп DOM-якоря панели. 2. Выгрузка плагина убирает панель, иконку, маршруты и CSS без перезапуска web-приложения. 3. Peer-гейт при установке не выдаёт отказов; при искусственном занижении диапазона — выдаёт. 4. Ни один модуль не резолвится через `dsh.client.inject` (externals берутся из `PLATFORM_MODULES` и `dsh.client.external`). 5. Повторный mount/unmount не оставляет следов (проверяется двумя циклами).
- **Что не делать:** не пересобирать web-приложение платформы; не править DSH; не публиковать в реестр; не занимать пространство `data-dsh-*`.
- **`tasks.json`:** запись **MW-063** — в сводном блоке §3.24 (единственная копия; дублировать JSON в описании карточки не нужно).
- **`INDEX.md`:** строка в `## 06-ui` после MW-048.
- **Критический путь:** вне критического пути; исключение из правила D12 («инсталлируемость делается в этапе 3, до конвейера», `01-MASTER-PLAN.md`). Гейт этапа 3.
- **Источник шага:** `F-39`; D18; §8.2 P23 (`FINAL-REPORT.md:381`); §13 открытые вопросы 4 и 5 (`01-MASTER-PLAN.md`) — закрываются этой карточкой.

### 3.9. MW-064 · Резолвер `DropIntent` и носитель `NeedsAttentionReason`

- **phase:** `01b-board` · **Этап плана:** 3 · **dependsOn:** `MW-042` · **adrs:** `ADR017`, `ADR018` · **depth:** 4
- **Цель:** drop разрешается одной функцией, которая проверяет собственный инвариант; причина «требует внимания» хранится в поле, а не только в типе.
- **Объём:** довести `applyDropIntent` (`packages/core/src/board.ts:458`, реэкспорт `core/src/index.ts:301`) до проверки собственного инварианта; убрать из `legalDropTargets` (`contracts/src/board.ts:161,533`) цели, недостижимые из состояния; объявить носитель для `NeedsAttentionReason` (`contracts/src/board.ts:356,373` — тип есть, поля нет); убрать или наделить носителем мёртвые поля `SubState` (`board.ts:210`), `PlacementChange.fromZone` (`board.ts:434,463`), `SessionLink.active`; типизовать причину отказа drop'а.
- **Приёмка:**
  1. `legalDropTargets(state)` не содержит ни одной цели, для которой `applyDropIntent` отвергает переход; property-тест перебирает все состояния. 2. `applyDropIntent` проверяет собственный инвариант: тест, ломающий инвариант, падает. 3. `NeedsAttentionReason` имеет носителя: `Select-String packages -Pattern 'NeedsAttentionReason'` находит не только `board.ts:356,373`, и тест читает причину из состояния. 4. Мёртвых полей нет: каждое из `SubState`, `PlacementChange.fromZone`, `SessionLink.active` либо имеет носителя и тест, либо удалено. 5. Drop без причины в `error/blocked/cancelled` отвергается типизированной ошибкой с именем отсутствующего поля.
- **Что не делать:** не переписывать модель зон (это D02/MW-042); не вводить UI-правила легальности; не менять `assertSinglePlacement` и порядок карточек.
- **`tasks.json`:** запись **MW-064** — в сводном блоке §3.24 (единственная копия; дублировать JSON в описании карточки не нужно).
- **`INDEX.md`:** строка в `## 01b-board` после MW-042.
- **Критический путь:** через MW-049/MW-050 (§2.9), то есть перед UI-доской; вне основного пути `MW-009 → … → MW-041`.
- **Источник шага:** §3.4 п. 11 брифа; `FINAL-REPORT.md:178` (§8.2 P17/P18), `:396` (§9.1 MW-050, п. 1–2); `evidence/quality-02.md:18-21`.

### 3.10. MW-065 · Provisioning saga для инициализации попытки

- **phase:** `04-control` · **Этап плана:** 4 · **dependsOn:** `MW-012`, `MW-028`, `MW-031`, `MW-059` (ребро `MW-059` добавлено как «потерянное» `E-34`, §3.22; канон — §3.24) · **adrs:** — (D13) · **depth:** 20
- **Цель:** инициализация попытки либо доходит до `active`, либо оставляет после себя согласованное состояние с компенсацией; краш в середине восстанавливается.
- **Объём:** перенести паттерн Agent Teams (пять шагов: admission → валидация → durable-запись → runtime → settlement) на инициализацию Attempt: идентификатор чеканится **до** запуска runtime (`randomUUID`, а не вывод из имени), snapshot `provisioning` пишется durable, при ошибке — компенсация (failed-snapshot, остановка запущенного, типизированный конфликт, если запись уже стала `active`), reconcile для краш-пути; журнал append-only, поэтому уже записанный `provisioning` не откатывается.
- **Приёмка:**
  1. Fault injection на каждом из пяти шагов: попытка не оказывается «наполовину созданной»; либо `active`, либо `failed` с причиной. 2. Краш между durable-записью и стартом runtime восстанавливается `reconcile` и не создаёт вторую попытку. 3. Конфликт «запись уже `active`» даёт типизированную ошибку, а не вторую параллельную попытку. 4. Идентификатор чеканится до runtime и не выводится из имени: два одинаковых имени дают два разных идентификатора, занятость имени проверяется отдельно. 5. Ни одна компенсирующая операция не удаляет append-only запись.
- **Что не делать:** **не строить mailbox/coordination subsystem** (§9(1)); не отождествлять TeamId с SessionId; не переносить весь Agent Teams — только пять шагов, компенсацию и reconcile.
- **`tasks.json`:** запись **MW-065** — в сводном блоке §3.24 (единственная копия; дублировать JSON в описании карточки не нужно).
- **`INDEX.md`:** строка в `## 04-control` после MW-031.
- **Критический путь:** внутри этапа 4 (параллельная ветка `MW-021 → MW-022`, не блокирует последовательность `MW-021→026`).
- **Источник шага:** D13 (`01-MASTER-PLAN.md`, `:168`); §8.2 P24 (`FINAL-REPORT.md:382`); §9.2(3); `evidence/execution-04.md:5-11` (пять шагов `roster.ts:246-337`, компенсация `:293-313`, reconcile `:392-434`, чеканка id `:259`, `maxMembers` домен 16 / профиль 8).

### 3.11. MW-066 · Write-intent на Attempt: диагностика, не блокировка

- **phase:** `01-runtime` · **Этап плана:** 4 · **dependsOn:** `MW-012`, `MW-021` · **adrs:** — (D13) · **depth:** 12
- **Цель:** намерение записи в рабочее дерево фиксируется до записи и видно в диагностике; оно никогда не блокирует исполнение.
- **Объём:** advisory-событие write-intent на попытку (какие пути предполагается менять), сопоставление с реально изменёнными путями, отчёт о пересечениях между попытками; отсутствие какой-либо блокировки на основании write-intent; журнал намерений доступен в диагностике и не пишется в граф задач.
- **Приёмка:**
  1. Пересечение write-intent двух попыток даёт **событие и предупреждение**, но не отказ; тест доказывает, что запись выполнена вопреки пересечению. 2. Write-intent пишется до первой записи и сопоставляется с фактическим diff; расхождение видно в отчёте. 3. Ни один путь исполнения не ждёт write-intent: тест с искусственной задержкой не меняет результат. 4. Намерения не попадают в TaskGraph и не влияют на admission.
- **Что не делать:** не превращать write-intent в lock или в мьютекс; не блокировать чужой checkout — изоляция обеспечивается worktree (MW-021).
- **`tasks.json`:** запись **MW-066** — в сводном блоке §3.24 (единственная копия; дублировать JSON в описании карточки не нужно).
- **`INDEX.md`:** строка в `## 01-runtime` после MW-021-соседних (в конце раздела).
- **Критический путь:** вне критического пути.
- **Источник шага:** D13; RT-6 (`FINAL-REPORT.md:436`: «`writeScopes` — диагностика, не lock»); §8.2 P24; `evidence/quality-05.md:40` (`fs/write-intent`, `fs/edit-intent` — события платформы).

### 3.12. MW-067 · Handoff Artifact: передача работы между попытками и ролями

- **phase:** `03-execution` · **Этап плана:** 4 · **dependsOn:** `MW-022`, `MW-025`, `MW-058`, `MW-066` (ребро `MW-058` — потерянное `E-38`, §3.22; `MW-066` — обратное ребро, иначе новая карточка `MW-066` остаётся стоком; канон — §3.24) · **adrs:** — (D13) · **depth:** 16
- **Цель:** между попытками, а также между worker'ом и reviewer'ом/интегратором передаётся не транскрипт, а artifact с решениями, якорями и незакрытым.
- **Объём:** типизированный Handoff Artifact (решения, изменённые пути, base/head, результаты гейтов, открытые вопросы, точные якоря `файл:строка`), запись в Artifact Store с hash/ref, привязка к Attempt и к evidence; запрет на передачу полного транскрипта.
- **Приёмка:**
  1. Новая Attempt после reject получает Handoff Artifact, а не транскрипт: тест не находит тела сессии в передаваемых данных. 2. Артефакт неизменяем и проверяется по hash при чтении. 3. Handoff Artifact несёт `base/head` и результат гейтов; интегратор без него не начинает работу (типизированный отказ). 4. Артефакт переживает restart и retention по окну (MW-062).
- **Что не делать:** не переносить полный transcript (сохраняется как ссылка на сессию); не строить собственный формат вместо Artifact Store (MW-008); не заменять checkpoint (MW-020) — это разные артефакты.
- **`tasks.json`:** запись **MW-067** — в сводном блоке §3.24 (единственная копия; дублировать JSON в описании карточки не нужно).
- **`INDEX.md`:** строка в `## 03-execution` после MW-025.
- **Критический путь:** вне критического пути, внутри этапа 4.
- **Источник шага:** D13; §9.2; `FINAL-REPORT.md:382` (P24), `:413` (п. 8 «Handoff Artifact»).

### 3.13. MW-068 · Durable jobs на собственной БД MyWork

- **phase:** `04-control` · **Этап плана:** 2 · **dependsOn:** `MW-058`, `MW-059` · **adrs:** — (D09) · **depth:** 9
- **Цель:** запланированная работа (optimizer, миграция, импорт, repair) переживает перезапуск процесса.
- **Объём:** носитель durable-задач на собственной БД MyWork (таблица + состояния + идемпотентность по operationId + повторный запуск после краха); применение к optimizer (MW-033), миграции/upgrade (MW-040), импорту (MW-054), repair (MW-040); `jobs-local` допускается только как внутрипроцессная оркестрация и **не** используется как носитель.
- **Приёмка:**
  1. Перезапуск процесса не теряет запланированную работу: задача продолжается или повторяется по journal. 2. Повторный запуск с тем же operationId не дублирует эффект. 3. Ни одна из четырёх точек применения не держит работу только в памяти. 4. `jobs-local` не значится носителем: `Select-String docs` и отчёт показывают, что durable-часть на своей БД.
- **Что не делать:** не использовать `LocalJobRegistry` как durable (in-memory, process-local: `jobs-local/src/index.ts:123-128`, README: «Every record disappears when the harness process exits»); не строить второй планировщик рядом с `scheduler` (MW-014).
- **`tasks.json`:** запись **MW-068** — в сводном блоке §3.24 (единственная копия; дублировать JSON в описании карточки не нужно).
- **`INDEX.md`:** строка в `## 04-control` после MW-031 (рядом с MW-065).
- **Критический путь:** вне критического пути; гейт этапа 2.
- **Источник шага:** `F-23`; D09 (`01-MASTER-PLAN.md`); `FINAL-REPORT.md:423` (§9.2(5) с поправкой верификатора); §9.2(5) (`:194`); `evidence/quality-05.md:27-30`.

### 3.14. MW-069 · Ограничения worker-поверхности

- **phase:** `03-execution` · **Этап плана:** 3 · **dependsOn:** `MW-015`, `MW-022` · **adrs:** — (D15) · **depth:** 13
- **Цель:** исполнитель не может менять сам harness и не может сам себя принимать.
- **Объём:** белый список инструментов Worker/Reviewer-сессии; запрет `cordis_*` (dynamic-плагины), `plugin_manager` и любых инструментов самостоятельного approve; отдельное правило для `auto-review`; права роли — через платформенный runtime-enforcement (MW-007); проверка, что инструменты не появляются «по имени» из промпта или памяти.
- **Приёмка:**
  1. Состав инструментов собранной сессии не содержит `cordis_`-инструмента, `plugin_manager` и инструмента approve; тест падает при добавлении любого из них. 2. `plugin_manager` недоступен и через прямое обращение: попытка даёт типизированный отказ, а не эскалацию прав (в платформе каждое его действие эскалирует `danger-full-access` — это и есть риск). 3. Авто-аппрувер не выдаёт приёмку: `experimental-auto-review` **активен** (`enabled: true`, `fiberPhase: active`) и режима «только deny» не имеет, поэтому приёмка формулируется как правило — вердикт `allow` не переводит карточку в `done` и не пишет `review.approved`; тест это проверяет. Остаточный риск активного плагина зафиксирован с решением владельца (выключить или принять), а не выдан за «смонтирован в deny-режиме». 4. Prompt, память и learning не добавляют инструментов: тест с враждебным текстом в контексте не расширяет белый список. 5. Права роли приходят из платформенного enforcement, а не из собственного реестра (см. C-03).
- **Что не делать:** не заявлять «auto-review только deny» — такого режима нет; не строить второй слой прав; не отключать `plugin_manager` глобально для человека (ограничение касается поверхности агента).
- **`tasks.json`:** запись **MW-069** — в сводном блоке §3.24 (единственная копия; дублировать JSON в описании карточки не нужно).
- **`INDEX.md`:** строка в `## 03-execution` после MW-026.
- **Критический путь:** вне критического пути; гейт этапа 3.
- **Источник шага:** D15 (`01-MASTER-PLAN.md`); §9(5) (`:294`); `FINAL-REPORT.md:406,433-434` (§9.1, RT-3/RT-4); `evidence/quality-05.md:18-20,47-51`; **поправка §0.5** (режима deny-only нет).

### 3.15. MW-070 · Model availability и `RouteRefusalReason: model-not-routable`

- **phase:** `01-runtime` · **Этап плана:** 2 · **dependsOn:** `MW-058` (снято как устаревшее: `MW-013`, `MW-015` — до разворота §3.22; канон — §3.24) · **adrs:** — (D20) · **depth:** 8
- **Цель:** отсутствие маршрута — типизированный отказ, а не `unavailable` и не синтетическое окно.
- **Объём:** порт доступности моделей `ModelAvailabilityPort`; `RouteRefusalReason: model-not-routable`; поведение при пустом `listModels`; восемь тестов политик сессии (`read-only`, `danger-full-access`, «нет живого агента» и остальные); прекращение схлопывания четырёх разных отказов в один `unavailable`.
- **Приёмка:**
  1. Пустой `listModels` даёт типизированную деградацию с `model-not-routable`, а не выдуманное окно контекста. 2. Четыре разных отказа маршрутизации различимы в коде и в отчёте: тест проверяет каждый по отдельности. 3. Восемь политик сессии покрыты; каждая даёт ожидаемый типизированный результат. 4. `contextWindow` берётся из реального каталога моделей (`LlmModelContext`), а не из константы.
- **Что не делать:** не подменять `AgentRuntimePort`; не заводить собственный каталог моделей вместо DSH-каталога; не выдавать неизвестное окно за известное.
- **`tasks.json`:** запись **MW-070** — в сводном блоке §3.24 (единственная копия; дублировать JSON в описании карточки не нужно).
- **`INDEX.md`:** строка в `## 01-runtime` после MW-061.
- **Критический путь:** вне критического пути; влияет на MW-013/MW-022 (`01-MASTER-PLAN.md`).
- **Источник шага:** `F-27`; D20 (`01-MASTER-PLAN.md`); §8.2 P20 (`FINAL-REPORT.md:378`); `evidence/quality-04.md:14` (`contextWindow` обязателен в `LlmModelContext`).

### 3.16. MW-071 · Леджеры: правило `done`, производный `INDEX.md`, reconciliation-тест

- **phase:** `07-acceptance` · **Этап плана:** 0 (правило и инвентаризация) → 1 (производный `INDEX.md`) · **dependsOn:** нет · **adrs:** — (D19) · **depth:** 0
- **Цель:** четыре источника статуса больше не расходятся молча; `INDEX.md` перестаёт быть рукописью; падения инвентаризированы до введения правила.
- **Объём:** (0) **инвентаризация** `done`-карточек с `failed`-исполнениями и отчёт `reconciliation-<дата>.md` — шаг `F-09`, выполняется первым, `dependsOn` пуст, потому что фактическая цепочка правила — `F-08` → `F-09` → `F-27` (правило → сверка), а не CI; (1) правило «`done` = прогон гейта + отчёт + review; `done` с `failed`-исполнением допустимо только с записью `failedRunAccepted`» (фиксируется в `.work/README.md`), поле и его формат описаны в §4.3; (2) `INDEX.md` становится производным артефактом с полем `lastSyncedRevision` и генерируется из леджера; (3) сверка множеств `done` между `tasks.json`, `INDEX.md` и живым леджером; reconciliation-тест, падающий при искусственном расхождении; (4) политика для падений — §4.4, число берётся из списка Lead'а (`N`, не константа).
- **Приёмка:**
  1. Отчёт `reconciliation-<дата>.md` существует и содержит по каждой карточке: `executionId`, карточку, исход, результат перепрогона (или пометку «перепрогон отложен до `MW-056`»). Число записей равно числу падений из списка Lead'а, а не «9». 2. Reconciliation-тест падает при искусственном расхождении `done`-множеств и проходит на согласованном состоянии; **первый прогон обязан пройти**, поэтому до него выполняется переклассификация 21 «DONE по отчёту» против 55 `planned` в леджере (§4.4). 3. `INDEX.md` содержит `lastSyncedRevision`, и повторная генерация без изменений леджера не меняет файл (идемпотентность). 4. Правило `done` записано в `.work/README.md` дословно и содержит условие «запись `failedRunAccepted` или строка-обоснование». 5. Карточка, у которой `done` и `failed`-исполнение без обоснования, не проходит сверку и попадает в `needs-attention`.
- **Что не делать:** не делать `INDEX.md` вторым источником истины; не «подчинять» леджер доске; не править `.work/tasks/**` руками в обход генератора; не вводить правило в действие раньше инвентаризации — иначе число падений останется выдуманным.
- **`tasks.json`:** запись **MW-071** — в сводном блоке §3.24 (единственная копия; дублировать JSON в описании карточки не нужно).
- **`INDEX.md`:** строка в `## 07-acceptance` первой.
- **Критический путь:** вне критического пути, но гейт для всех карточек (`01-MASTER-PLAN.md`: «леджеры ───→ правило приёмки для всех карточек»).
- **Источник шага:** `F-08` (правило), `F-09` (инвентаризация), `F-26` (производный `INDEX.md`), `F-27` (сверка `done`-множеств) — фактическая нумерация по §0.6; D19; §7.4(1)(2); R-4/R-9/R-10; §16 мастер-плана.

### 3.17. MW-072 · Каркас пакета `@dsh-mywork/web` (шаг `B-01a`)

- **phase:** `06-ui` · **Этап плана:** 3 · **dependsOn:** нет · **adrs:** `ADR-030` (косвенно: принимает layout-константы) · **depth:** 0
- **Цель:** пакет-получатель существует до того, как в него переезжают layout-константы; исполнитель `MW-042`/`MW-048` не ищет несуществующий каталог.
- **Объём:** создать `packages/web` (`@dsh-mywork/web`): `package.json` с `name`, `exports["./client"]`, `dsh.client`-манифестом-заглушкой и peer-полями по `MW-060`; `tsconfig`/`tsdown.config.ts` по образцу остальных 12 пакетов; пустой/минимальный entry, который собирается; запись в `pnpm-workspace`/корневые скрипты, если требуется; `tsconfig.base.json` получает path-алиас `web`. **Никакой UI-логики:** только каркас, из которого `B-02` (перенос layout-констант) и `MW-048` (бандл, слоты, темы) берут готовое место.
- **Приёмка:**
  1. `Test-Path packages/web` → `True`; сегодня `False` (в репозитории 12 пакетов, `web` среди них нет). 2. `corepack pnpm -r run build` (канонический runner, §15.1 мастер-плана) → EXIT=0, число пакетов 13. 3. `packages/web/package.json` содержит `name: "@dsh-mywork/web"`, `exports["./client"]` и `dsh.client`-манифест; peer-поля совпадают с решением D04. 4. Пустой каркас не ломает boundary-тест: `node --test tests/boundaries.test.mjs` → `pass / fail 0`. 5. `MW-042` и `MW-048` объявляют зависимость от этой карточки, поэтому `check-deps` больше не отвечает `ready` на карточку, чей пакет-получатель отсутствует.
- **Что не делать:** не переносить сюда layout-константы (это `B-02` внутри `MW-042`); не реализовывать слоты, бандл, темы и экраны (это `MW-048`); не занимать пространство `data-dsh-*`; не добавлять npm-зависимостей.
- **`tasks.json`:** запись **MW-072** — в сводном блоке §3.24.
- **`INDEX.md`:** строка в `## 06-ui` **первой** (до `MW-048`).
- **Критический путь:** **внутри** ветки UI: `MW-072` → `MW-042` (перенос layout) → `MW-047` → `MW-029` → `MW-048` → `MW-063`. Без неё `MW-048.md:18` («Создать `packages/web`…») ссылается на несуществующий пакет, а `MW-042` переносит константы «в никуда».
- **Источник шага:** `B-01a` (`22-STEPS-surface.md` §2 — «Создать каркас пакета `@dsh-mywork/web` (разблокирует `B-02`; делает это **до** MW-048)»); red-team B §3.1 (блокер: пакет-получатель без карточки-владельца); `Test-Path packages/web` → `False`.

### 3.18. MW-073 · Cutover легаси-доски: heartbeat, выключатель, read-only адаптер

- **phase:** `07-migration` · **Этап плана:** 5 · **dependsOn:** `MW-047`, `MW-054` · **adrs:** `ADR021`, `ADR025` · **depth:** 20
- **Цель:** после верифицированного cutover легаси-плагин выключен строкой, heartbeat имеет политику, архив остаётся читаемым.
- **Объём:** момент выключения строки `web-ui-task-board` (только после верифицированного cutover, `01-MASTER-PLAN.md`: «не удалять агрегат `@linxin666/dsh-web-all` — только строчный override»); политика heartbeat **0.4.4** — установленной версии доски (план цитировал 0.4.3; у 0.4.4 `peerDependencies`/`dsh.engines.dsh = >=0.2.0-rc.1`, и в неё вернулись 7 ключей `autoRun*` — `02-PLATFORM-DELTA-0.2.0-rc.2.md` §2.2 D8; выключателя у версии нет — решение принимает владелец; прочие семантические отличия 0.4.4 от 0.4.3 — per-task `goalRun` (включён по умолчанию), Lead-вердикт для `teamRun`, действие `settle` у `task_board_manage`, IANA-`timeZone` в cron-правиле и переиспользование `TASK_BOARD_OLDER_SCHEMA_VERSION` — политику выключения не меняют, источник — `.tmp/board-delta/REPORT.md` §3); судьба read-only legacy-адаптера; процедура отката, включающая копию леджера (живой леджер уже `schemaVersion` 4: 0.4.4 подняла схему v3 → v4, а 0.4.3 леджер v4 не читает — `unsupported ledger schema` → `recoverCorrupt()` переименовывает файл в `.corrupt-<ts>-<pid>-<uuid>` и доска поднимается пустой, данные не удаляются, но UI пуст; поэтому «откат = понижение версии» без копии прежнее поведение не возвращает); проверка, что после cutover legacy-исполнения не превращаются в Attempt'ы; сохранение архива в читаемом виде.
- **Приёмка:**
  1. Строка `web-ui-task-board` переопределена строчно, агрегат цел: `18 нужных строк` не затронуты (§9(5)). 2. Cutover не начинается без верифицированного MW-054 и без доказанного удаления вернувшихся в 0.4.4 ключей `autoRun*` и отсутствия расписаний. 3. Heartbeat установленной 0.4.4 либо покрыт политикой (окно + наблюдатель), либо явно оставлен с записанным риском и сроком пересмотра. 4. Откат описан и проверен на копии профиля **и на копии леджера**: возврат строки возвращает прежнее поведение, пока версия доски не понижена; понижение ниже 0.4.4 описано честно — леджер v4 не читается (`unsupported ledger schema` → карантинный `.corrupt-<ts>-<pid>-<uuid>`, доска пуста), и восстановление идёт из снятой копии, а не «само». 5. Архив читается без работающего legacy-плагина.
- **Что не делать:** не удалять агрегат `@linxin666/dsh-web-all`; не выключать строку до верифицированного cutover; не переносить legacy-исполнения в Attempt'ы.
- **`tasks.json`:** запись **MW-073** — в сводном блоке §3.24 (единственная копия; дублировать JSON в описании карточки не нужно).
- **`INDEX.md`:** строка в `## 07-migration` после MW-054.
- **Критический путь:** завершает ветку миграции; MW-055 зависит от неё (§2.9).
- **Источник шага:** D06 (`01-MASTER-PLAN.md`), `:314`; RT-5 (`FINAL-REPORT.md:435`: «heartbeat 0.4.3 жив, выключателя нет» — цитата историческая: версия на 2026-10-03 = **0.4.4**, см. `02-PLATFORM-DELTA-0.2.0-rc.2.md` §2.2 D8); §9.1; §9(5) (`:296`).

### 3.19. MW-074 · Runtime-инварианты: свои проверки MyWork, без платформенного шва (дельта `0.2.0-rc.2`, D4)

- **phase:** `07-acceptance` · **Этап плана:** 2 · **dependsOn:** `MW-058` · **adrs:** — · **depth:** 9
- **Цель:** нарушение инварианта падает в рантайме с атрибуцией пакету, а не тихо портит состояние; механизм — **собственный, не платформенный** (дельта D4: `ctx.invariants` в живом профиле не смонтирован, а в `0.2.1` шов `@deepseek-ai/dsh-invariants` и все `<pkg>/invariant`-субпути удаляются). Владение не раздвоено с `MW-039`.
- **Объём:** собственный модуль проверок MyWork — `packages/controller/src/invariant.ts` (и, при необходимости, для `execution`/`planner`): обычные функции, **без** `inject: ['invariants']`, **без** `ctx.invariants.register` и **без** заявления субпутя `./invariant` в `exports`/`files`; новый код `INVARIANT_VIOLATED` в реестре `MYWORK_ERROR_CODES` (`packages/contracts/src/operation.ts`, по образцу Q-09); таблица «инвариант §59 → носитель проверки». **Разделение владения:** эта карточка владеет **runtime-проверками MyWork**; тестовые, fault- и property-проверки §59/§60 остаются за `MW-039` (её объём — «deterministic интеграционные/fault/property checks»). Build-time конформанс `scripts/verify-package-invariants.ts` живёт **в DSH-чек-ауте** (`C:\Reposit\deepseek-harness\deepseek-harness\scripts\verify-package-invariants.ts`), в MyWork такого файла нет (`Test-Path` → `False`), и он **не является гейтом этой карточки** — после отказа от шва он не нужен даже теоретически.
- **Приёмка:**
  1. `node --test --test-isolation=none tests/invariants-runtime.test.mjs` → `pass 4 / fail 0`, включая падающий на пустом месте тест «намеренное нарушение даёт ошибку MyWork» и тест «шов не используется» (шаги 1–2 шага `Q-36`).
  2. Искусственно нарушенный инвариант даёт ошибку MyWork с кодом `INVARIANT_VIOLATED` (код **создаётся здесь**, в реестре `MYWORK_ERROR_CODES`) и сообщением с именем пакета/инварианта; снятие проверки валит тест (мутация ловится).
  3. Тест «шов не используется» (проверка отказа от снимаемого контракта): ни один манифест MyWork не объявляет companion-субпуть `./invariant`, и ни один исходник не вызывает `ctx.invariants.register` — `Select-String` даёт **0 совпадений**.
  4. Субпуть `./invariant` не заявлен ни в `files`, ни в `exports` ни одного манифеста MyWork, и `node scripts/pack.mjs` его в tarball не приносит; возврат субпутя или вызова шва валит тест п. 3.
  5. Таблица «инвариант §59 → тест (`MW-039`) или runtime-проверка MyWork (`MW-074`)» приложена; ни один инвариант не проверяется дважды и ни один не остался без носителя.
- **Что не делать:** не объявлять гейтом `scripts/verify-package-invariants.ts` — файла в MyWork нет, а `tsx` не значится ни в одном из 54 `package.json` (`Select-String -Pattern '"tsx"'` → 0 совпадений), то есть команда неисполнима; **не заявлять companion-субпуть `./invariant` и не вызывать `ctx.invariants.register`** — шов снимается в `0.2.1` (дельта D4), и зависимость от него пришлось бы удалять в том же релизе; не строить обобщённую систему инвариантов сверх проверок v0.1 и не «проверять наличие сервиса» (проверять авторитетные потоки событий и мутируемые данные); не дублировать проверки `MW-039`; не регистрировать инварианты «на будущее».
- **`tasks.json`:** запись **MW-074** — в сводном блоке §3.24 (единственная копия).
- **`INDEX.md`:** строка в `## 07-acceptance` после `MW-039`.
- **Критический путь:** вне критического пути; гейт этапа 2 (вместе с `MW-058`).
- **Источник шага:** §9.2(4); `Q-36` (`23-STEPS-quality.md`, владелец `plan-quality` — переписан после дельты на «свой модуль, без платформенного шва»; половина «runtime-проверки MyWork» согласована с ней); `02-PLATFORM-DELTA-0.2.0-rc.2.md` §2.2 D4, §5.2; `evidence/quality-05.md:5-11`.
### 3.20. MW-075 — **не создаётся** (инвентаризация поглощена `MW-071`)

Инвентаризация `done`-карточек с `failed`-исполнениями — шаг `F-09`, и её владельцем назначена **`MW-071`** (§3.16, шаг 0 объёма), а не отдельная карточка: это 100 % работы того же правила (`F-08` → `F-09` → `F-27`), а лимит «новых карточек ≤ 20» уже выбран. Гейт инвентаризации — существование отчёта `reconciliation-<дата>.md` (§3.16, приёмка 1). Идентификатор `MW-075` остаётся свободным.

### 3.21. MW-076 · Повторный прогон гейта этапа 2 после поздних миграций

- **phase:** `07-acceptance` · **Этап плана:** 2 (повторный прогон — после этапа 4) · **dependsOn:** `MW-058`, `MW-059`, `MW-021`, `MW-047`, `MW-065` · **adrs:** — (D08) · **depth:** 20
- **Цель:** гейт этапа 2 («`controller.sqlite` версии схемы из единого реестра») доказывает **текущее** состояние, а не то, которое было до добавления поздних миграций.
- **Объём:** три карточки добавляют миграции **после** закрытия этапа 2 — `B-12` (`board-projection`, `MW-047`), `E-04` (`attempt_worktree` v7, `MW-021`), `E-34` (`agent_instance_provisioning`, `MW-065`). Карточка: заново собрать канонический список, проверить уникальность версий единым аллокатором (`validateMigrations`, `packages/storage/src/migrations.ts:111-129`; без этого store не откроется), перепрогнать smoke в изолированном `DSH_HOME`, подтвердить, что `controller.sqlite` создаётся с версией из реестра, и что ни один тест не содержит литерала `[1,2,3,4,5,6]`.
- **Приёмка:**
  1. `validateMigrations` не бросает: версии уникальны, поздние миграции (v7 и далее) входят в реестр. 2. Smoke в изолированном `DSH_HOME` создаёт `controller.sqlite` версии из **текущего** реестра, а не из состояния до `MW-047`/`MW-021`/`MW-065`. 3. Тест миграций читает ожидаемый набор из аллокатора, а не из литерала; искусственное добавление дубля версии валит прогон. 4. Отчёт фиксирует число миграций и их версии на момент прогона.
- **Что не делать:** не выделять версии литералами в шагах (только единый аллокатор, §15.3 мастер-плана); не переписывать уже применённые миграции; не трогать живую БД — прогон на изолированном `DSH_HOME`.
- **`tasks.json`:** запись **MW-076** — в сводном блоке §3.24.
- **`INDEX.md`:** строка в `## 07-acceptance` после `MW-074`.
- **Критический путь:** вне основного пути, но **обязательный гейт перед `MW-041`**: без него приёмка operational v0.1 подтверждает схему, которой уже нет.
- **Источник шага:** red-team B §3.3 (H-13: «гейт этапа 2 становится недействительным в момент добавления v7, а карточки, которая перепрогоняет гейт, в плане нет»); §15.3 мастер-плана (версии миграций); `F-18`/`F-19`/`F-20`; `B-12`, `E-04`, `E-34`.

### 3.22. Развязка циклов, потерянные рёбра и границы ID (правки по red-team B)

**Разорванные рёбра (работа не удаляется — меняется владелец и направление).**

| Что было | Чем разорвано | Почему |
|---|---|---|
| Скрытый цикл `MW-042 → MW-064 → MW-042`: гейт `MW-042` требовал носитель `NeedsAttentionReason`, который создаёт `MW-064` | Из гейта `MW-042` убраны `data-mw-*` и «носитель `NeedsAttentionReason`» (правка C-35, строка гейта в §2.9). Осталось: контракты зон + property-тест на 16 состояний | Гейт карточки не может требовать результат её собственной зависимости |
| Скрытый цикл `MW-042 → MW-048 → MW-029 → MW-047 → MW-042`: гейт `MW-042` требовал `data-mw-*` (шаг `B-27` внутри `MW-048`) | То же снятие `data-mw-*`; `data-mw-*` принадлежит `MW-048` и проверяется там | То же |
| Буквальный `B-42 ↔ B-43` и его карточный слепок `MW-055 ↔ MW-073` | `MW-073` **снята** из `MW-055.dependsOn`; шаг «`B-43` зелёный» — предусловие `MW-073`, а не наоборот (`MW-073` уже зависит от `MW-047` и `MW-054`) | `MW-055` не может требовать результат cutover'а, который сама же и проверяет |
| Пакет-получатель `packages/web` без владельца: `MW-048` писала «Создать», `B-01a` жил только в шагах | Заведена карточка **`MW-072`** (каркас `packages/web`, шаг `B-01a`); `MW-048` переписана на «**Наполнить** каркас… Сама карточка пакет НЕ создаёт» (правка C-41); `MW-042` зависит от `MW-072` | `check-deps` отвечал `ready` на карточку, чей пакет-получатель не существует (`Test-Path packages/web` → `False`) |

**Потерянные рёбра (объявлены в шагах, отсутствовали в `tasks.json`).** Добавлены все восемь:

| Карточка | Добавлено в `dependsOn` | Источник |
|---|---|---|
| `MW-021` | `MW-059` | `E-04`: «F (единый реестр миграций)» |
| `MW-022` | `MW-058` | `E-08`: «F (composition root)» |
| `MW-026` | `MW-058` | `E-30`: то же |
| `MW-028` | `MW-058` | `E-42`: то же |
| `MW-030` | `MW-059` | `Q-12`: «её номер — из реестра `F-18`» |
| `MW-065` | `MW-059` | `E-34`: «F (единый реестр миграций)» |
| `MW-067` | `MW-058` | `E-38`: «F (composition root)» |
| `MW-048` | `MW-060` | `F-58`: «Зависит: F-49» (публикуемость) |

**Разворот `MW-070`.** Было: `MW-070.dependsOn = [MW-013, MW-015]` — модель-доступность ждала тех, кого сама разблокирует. Стало: `MW-070.dependsOn = [MW-058]`, а `MW-070` добавлена в `dependsOn` карточек `MW-013` и `MW-022` — как в DAG мастер-плана (`model availability ──→ MW-013/MW-022`).

**Направление `MW-047`/`MW-029` — одно, без развилок.** Каноническая цепочка: `MW-072 → MW-042 → MW-064 → MW-047 → MW-029 → MW-048 → MW-049 → MW-050 → MW-053 → MW-055 → MW-041`. Утверждение «`MW-047` зависит от `MW-029`» неверно и в плане не используется; `MW-047.dependsOn = [MW-042, MW-010, MW-011, MW-025]`, `MW-029.dependsOn = [MW-018, MW-026, MW-028, MW-043, MW-047]`.

**Границы «два ID на одно действие» — кто владеет чем.** Каждая пара разведена явно, чтобы приёмку нельзя было сдать дважды:

| Тема | Владелец | Что делает вторая карточка |
|---|---|---|
| `bd`-seam / skip-гейт | `MW-056` (резолвер и CI-профиль) | `MW-057` — тест `batch`-рёбер и актор `heartbeat`; `MW-010`/`MW-011` — приёмка «`skipped 0`» |
| Реестр миграций / retention / durable jobs | `MW-059`, `MW-062`, `MW-068` (механизмы) | `MW-004` — хранение и таблицы; `MW-039`/`MW-040` — проверка, upgrade и repair; `MW-033` — optimizer; `jobs-local` не используется вовсе (D09) |
| Бюджет / peer-CI-тег | `MW-061`, `MW-060` | `MW-013` — admission и маршрутизация, `MW-034` — метрики; `MW-041` — упаковка v0.1 |
| UI-пакет / worker / model availability | `MW-072` (каркас), `MW-048` (наполнение), `MW-063` (установка), `MW-069` (allowlist), `MW-070` (порт) | `MW-022` — путь попытки, `MW-024` — review, `MW-007` — права роли, `MW-013`/`MW-015` — маршрутизация и сессии; три разные приёмки UI: `Test-Path`, бандл и слоты, панель в GUI |
| Runtime invariants / леджеры | `MW-074`, `MW-071` | `MW-039` — тестовые и fault-проверки; `MW-006`/`MW-029` свои леджеры не заводят |

**Дефект «гейт этапа 2 доказывает устаревшее состояние»** закрыт карточкой `MW-076`: три миграции (`B-12`/`MW-047`, `E-04`/`MW-021`, `E-34`/`MW-065`) добавляются после гейта, и его нужно перепрогнать.
### 3.23. Сводка новых карточек: этап, зависимости, гейт

| Карточки | phase | Этап плана | dependsOn | Гейт |
|---|---|---|---|---|
| MW-056, MW-057 | 01-runtime | 1 | MW-056 → MW-057 | `pass 70 / fail 0 / skipped 0`; тест падает до правки |
| MW-058, MW-059, MW-062, MW-068, MW-070, MW-074 | 04-control / 00-foundation / 01-runtime / 07-acceptance | 2 | MW-004 → MW-059 → MW-058 → MW-068/MW-062/MW-074/MW-070 | `controller.sqlite` из единого реестра; `MIGRATIONS_REQUIRED`; файл БД уменьшается; нарушение инварианта → ошибка MyWork с кодом `INVARIANT_VIOLATED` (платформенный шов `ctx.invariants` не используется — дельта D4, §3.19) |
| MW-060, MW-063, MW-069, MW-061 | 07-acceptance / 06-ui / 03-execution / 01-runtime | 3 | MW-060 → MW-063; MW-015+MW-022 → MW-069; MW-013+MW-034 → MW-061 | `pack.mjs` exit 0 и тег `v0.1.0-m1`; панель видна после refresh; в инструментах нет `cordis_*`/`plugin_manager`; бюджет-тест обрывает прогон |
| MW-064, MW-065, MW-066, MW-067 | 01b-board / 04-control / 01-runtime / 03-execution | 3–4 | MW-042 → MW-064; MW-012+MW-028+MW-031 → MW-065; MW-012+MW-021 → MW-066; MW-022+MW-025 → MW-067 | property-тест на все состояния; fault injection на 5 шагах; пересечение `writeScopes` → событие, не отказ; транскрипт не передаётся |
| MW-071, MW-072, MW-073, MW-076 | 07-acceptance / 06-ui / 07-migration | 0–5 | MW-072 → MW-042; MW-047+MW-054 → MW-073; MW-047+MW-021+MW-065 → MW-076; MW-071 без зависимостей | отчёт `reconciliation-*.md`; `Test-Path packages/web` и сборка 13 пакетов; откат cutover проверен; `validateMigrations` не бросает |
| MW-075 | — | — | — | **не создаётся** (инвентаризация — в `MW-071`, упаковка — в `MW-041`) |

Полный `dependsOn` каждой карточки — в §3.24 (единственная авторитетная копия) и в §2.9. Колонка `dependsOn` в таблице §3.23 — **сводка**: у `MW-065` в ней не показано добавленное ребро `MW-059`, у `MW-067` — `MW-058` и `MW-066` (канон — §3.24).
### 3.24. Готовый блок для `tasks.json`

Вставить **20 записей** в массив `tasks` файла `.work/tasks/tasks.json` (порядок в массиве не влияет на чтение; рекомендуется после MW-055). `planRevision` поднять с `2` до `3` — иначе производный `INDEX.md` (MW-071) не отличит новую ревизию от старой.

```json
[
  { "id": "MW-056", "phase": "01-runtime",    "title": "Починить bd-seam на Windows и сделать backend проверяемым",              "dependsOn": [],                                     "status": "planned", "adrs": ["ADR023","ADR024"] },
  { "id": "MW-057", "phase": "01-runtime",    "title": "Починить тест batch-рёбер и актора heartbeat",                            "dependsOn": ["MW-056"],                             "status": "planned", "adrs": ["ADR023"] },
  { "id": "MW-058", "phase": "04-control",    "title": "Собрать composition root: одна точка сборки приложения",                  "dependsOn": ["MW-004","MW-009","MW-059"],            "status": "planned", "adrs": [] },
  { "id": "MW-059", "phase": "00-foundation", "title": "Ввести единый реестр миграций, journal и атомарную запись",               "dependsOn": ["MW-004"],                             "status": "planned", "adrs": [] },
  { "id": "MW-060", "phase": "07-acceptance", "title": "Обеспечить публикуемость: peer-контракт, CI, тег и pack.mjs",             "dependsOn": [],                                     "status": "planned", "adrs": [] },
  { "id": "MW-061", "phase": "01-runtime",    "title": "Ввести бюджетный и шаговый circuit-breaker поверх dsh-token-meter",       "dependsOn": ["MW-013","MW-034"],                    "status": "planned", "adrs": [] },
  { "id": "MW-062", "phase": "00-foundation", "title": "Ввести retention, VACUUM и сканирование тел артефактов и памяти",         "dependsOn": ["MW-004","MW-008","MW-059"],           "status": "planned", "adrs": [] },
  { "id": "MW-063", "phase": "06-ui",         "title": "Установить UI-пакет в изолированный профиль и проверить peer-манифест",   "dependsOn": ["MW-029","MW-048","MW-060"],           "status": "planned", "adrs": ["ADR016","ADR021","ADR022"] },
  { "id": "MW-064", "phase": "01b-board",     "title": "Довести резолвер DropIntent и завести носитель NeedsAttentionReason",    "dependsOn": ["MW-042"],                             "status": "planned", "adrs": ["ADR017","ADR018"] },
  { "id": "MW-065", "phase": "04-control",    "title": "Перенести provisioning saga на инициализацию Attempt",                   "dependsOn": ["MW-012","MW-028","MW-031","MW-059"],  "status": "planned", "adrs": [] },
  { "id": "MW-066", "phase": "01-runtime",    "title": "Ввести advisory write-intent на Attempt",                                "dependsOn": ["MW-012","MW-021"],                    "status": "planned", "adrs": [] },
  { "id": "MW-067", "phase": "03-execution",  "title": "Ввести Handoff Artifact для передачи работы между попытками",            "dependsOn": ["MW-022","MW-025","MW-058","MW-066"], "status": "planned", "adrs": [] },
  { "id": "MW-068", "phase": "04-control",    "title": "Построить durable jobs на собственной БД MyWork",                        "dependsOn": ["MW-058","MW-059"],                    "status": "planned", "adrs": [] },
  { "id": "MW-069", "phase": "03-execution",  "title": "Ограничить поверхность worker: запрет cordis_*, plugin_manager и самоодобрения", "dependsOn": ["MW-015","MW-022"],            "status": "planned", "adrs": [] },
  { "id": "MW-070", "phase": "01-runtime",    "title": "Ввести ModelAvailabilityPort и model-not-routable",                      "dependsOn": ["MW-058"],                             "status": "planned", "adrs": [] },
  { "id": "MW-071", "phase": "07-acceptance", "title": "Ввести правило done, инвентаризацию и производный INDEX",                   "dependsOn": [],                                     "status": "planned", "adrs": [] },
  { "id": "MW-072", "phase": "06-ui",         "title": "Создать каркас пакета @dsh-mywork/web (шаг B-01a)",                        "dependsOn": [],                                     "status": "planned", "adrs": ["ADR-030"] },

  { "id": "MW-073", "phase": "07-migration",  "title": "Выполнить cutover легаси-доски с проверяемым откатом",                   "dependsOn": ["MW-047","MW-054"],                    "status": "planned", "adrs": ["ADR021","ADR025"] },
  { "id": "MW-074", "phase": "07-acceptance", "title": "Зарегистрировать runtime-инварианты (свой модуль MyWork)",               "dependsOn": ["MW-058"],                             "status": "planned", "adrs": [] },
  { "id": "MW-076", "phase": "07-acceptance", "title": "Перепрогнать гейт этапа 2 после поздних миграций",                        "dependsOn": ["MW-058","MW-059","MW-021","MW-047","MW-065"], "status": "planned", "adrs": [] }
]
```

Только **существующие** записи `tasks.json`, у которых меняется `dependsOn` (правки §2), — 22 записи. Множества ID двух блоков **не пересекаются**: блок выше — только вставки (`MW-056`…`MW-076`), этот — только изменения (`MW-010`…`MW-055`). Поэтому ни одна карточка не определена дважды, порядок применения блоков на граф не влияет, и граф один при любом чтении.

```json
[
  { "id": "MW-010", "dependsOn": ["MW-005","MW-009","MW-057"] },
  { "id": "MW-011", "dependsOn": ["MW-010","MW-057"] },
  { "id": "MW-013", "dependsOn": ["MW-005","MW-006","MW-007","MW-070"] },
  { "id": "MW-021", "dependsOn": ["MW-008","MW-012","MW-059"] },
  { "id": "MW-022", "dependsOn": ["MW-014","MW-015","MW-016","MW-017","MW-018","MW-020","MW-021","MW-058","MW-070"] },
  { "id": "MW-024", "dependsOn": ["MW-015","MW-020","MW-023"] },
  { "id": "MW-026", "dependsOn": ["MW-011","MW-015","MW-016","MW-058"] },
  { "id": "MW-028", "dependsOn": ["MW-009","MW-014","MW-022","MW-025","MW-058","MW-069"] },
  { "id": "MW-030", "dependsOn": ["MW-007","MW-012","MW-020","MW-029","MW-059"] },
  { "id": "MW-031", "dependsOn": ["MW-012","MW-014","MW-020","MW-025","MW-030","MW-061"] },
  { "id": "MW-033", "dependsOn": ["MW-006","MW-013","MW-032","MW-068"] },
  { "id": "MW-038", "dependsOn": ["MW-010","MW-015","MW-019","MW-042","MW-047","MW-029","MW-031"] },
  { "id": "MW-039", "dependsOn": ["MW-007","MW-024","MW-025","MW-030","MW-031","MW-033","MW-038","MW-062","MW-067","MW-074"] },
  { "id": "MW-040", "dependsOn": ["MW-004","MW-039","MW-068"] },
  { "id": "MW-041", "dependsOn": ["MW-028","MW-036","MW-037","MW-038","MW-039","MW-040","MW-055","MW-060","MW-063","MW-073","MW-076"] },
  { "id": "MW-042", "dependsOn": ["MW-003","MW-072"] },
  { "id": "MW-043", "dependsOn": ["MW-042","MW-011"] },
  { "id": "MW-046", "dependsOn": ["MW-012","MW-022","MW-030"] },
  { "id": "MW-048", "dependsOn": ["MW-029","MW-072","MW-060"] },
  { "id": "MW-049", "dependsOn": ["MW-048","MW-042","MW-064"] },
  { "id": "MW-050", "dependsOn": ["MW-049","MW-046","MW-064"] },
  { "id": "MW-055", "dependsOn": ["MW-053","MW-054","MW-031","MW-038","MW-039","MW-071"] }
]
```

**Почему у `MW-065`/`MW-067`/`MW-070` здесь больше нет записей (снято как неверное, 2026-10-03).** Эти три карточки — **новые**: их полное определение живёт в блоке выше, и дублирующая запись здесь создавала **второй граф**. У `MW-070` конфликт был жёстким (`[MW-013, MW-015]` против `[MW-058]`): буквальное чтение («блок 2 — только существующие карточки») сохраняло рёбра `MW-070 → MW-013` и `MW-070 → MW-015` при добавленном тем же документом ребре `MW-013 → MW-070` и давало **два цикла** — `MW-013 ↔ MW-070` и `MW-013 → MW-070 → MW-015 → MW-013` (в базе `MW-015.dependsOn = [MW-005, MW-007, MW-013]`). Конфликтующие рёбра сведены к одному значению и влиты в определения блока выше:

| Карточка | Канонический `dependsOn` | Почему именно он |
|---|---|---|
| `MW-065` | `MW-012`, `MW-028`, `MW-031`, `MW-059` | база блока 1 плюс «потерянное ребро» `E-34` (§3.22): сага провижининга пишет через единый реестр миграций |
| `MW-067` | `MW-022`, `MW-025`, `MW-058`, `MW-066` | база блока 1 плюс потерянное ребро `E-38` (`MW-058`) и обратное ребро `MW-066`: без него новая карточка `MW-066` остаётся единственным стоком среди новых, а §3.22 обещает «sinks среди новых = 0» |
| `MW-070` | `MW-058` | разворот §3.22: «модель-доступность ждала тех, кого сама разблокирует». `MW-070` добавлена в `dependsOn` карточек `MW-013` и `MW-022`; значение `[MW-013, MW-015]` **снято как неверное** — именно оно было источником обоих циклов |

Проверка канона скриптом, который читает **оба** блока из этого документа (не хардкод): `node .tmp/card-graph/graph.mjs` → оба блока разбираются `JSON.parse`; при обоих порядках применения (`блок 2 → блок 1` и `блок 1 → блок 2`) `nodes = 75`, `edges = 222`, дублей ID 0, `self-deps = 0`, висячих ссылок 0, `cycles = 0`, стоков среди 20 новых карточек 0, критический путь `MW-041 = 24`. Объявленные `depth` у 8 из 20 новых карточек расходятся с пересчётом (находка red-team B, LOW, к этому дублю отношения не имеет): канон — пересчёт по этому разделу, выравнивание объявленных значений — отдельная правка.

### 3.25. Готовые строки для `INDEX.md` и обновление критического пути

**`## 00-foundation`** (после MW-008): MW-059, MW-062.
**`## 01-runtime`** (после MW-015): MW-056, MW-057, MW-061, MW-066, MW-070.
**`## 01b-board`** (после MW-042): MW-064.
**`## 03-execution`** (после MW-026): MW-067, MW-069.
**`## 04-control`** (после MW-031): MW-058, MW-065, MW-068.
**`## 06-ui`** (первой): MW-072; (после MW-048): MW-063.
**`## 07-acceptance`** (первой): MW-071; (после MW-039): MW-074; (перед MW-055): MW-060; (после MW-074): MW-076.
**`## 07-migration`** (после MW-054): MW-073.

Раздел `## Критический путь` в `INDEX.md` (строки 123–135) заменяется на согласованный с `01-MASTER-PLAN.md`:

```text
F-01 (гейт прав) → F-13/MW-059 → F-20/MW-058 → MW-022 → MW-023 → MW-024 → MW-025
   → MW-047 → MW-029 → MW-048 → MW-049 → MW-050 → MW-053 → MW-055 → MW-041

Параллельные ветки:
  MW-056 → MW-057 → MW-010/MW-011 доказуемы
  MW-059 → MW-062 (retention) ; MW-059+MW-058 → MW-068 (durable jobs) ; MW-058 → MW-074 (invariants)
  MW-060 → MW-063 (installable UI) ; MW-060 → MW-071 (леджеры)
  MW-072 (каркас packages/web) → MW-042 → MW-064 → MW-047 → MW-029 → MW-048
  MW-013/MW-034 → MW-061 (бюджет) ; MW-058 → MW-070 (model availability; разворот §3.22: `MW-070` добавлена в `MW-013`/`MW-022`, значение `MW-013`/`MW-015` → `MW-070` снято как устаревшее)
  MW-030 (HumanDecision, D14) → MW-046 → MW-050
  MW-047 + MW-054 + MW-021 + MW-065 → MW-076 → MW-041 (перепрогон гейта этапа 2)
  MW-012 → MW-066 (write-intent) ; MW-022 + MW-025 → MW-067 (handoff)
  MW-012 + MW-028 + MW-031 → MW-065 (provisioning saga)
  MW-015 + MW-022 → MW-069 (worker-поверхность)
  MW-044 → MW-045 → MW-051 ; MW-046 → MW-050 ; MW-052 ← MW-049, MW-042
  MW-016…020 → MW-032 → MW-033 → MW-034 ; MW-038 → MW-039 → MW-040 → MW-041
```

Ветки выше — **эскиз параллелизма**, а не полный `dependsOn`: недостающие рёбра (`MW-059` у `MW-065`, `MW-058` и `MW-066` у `MW-067`) смотри в §3.24. Строка 135 `INDEX.md` («Не запускать зависимые карточки одним залпом…») сохраняется без изменений — она верна и после добавления 20 карточек.

---

## 4. Часть (3) — Управление леджерами

### 4.1. Сверка четырёх источников статуса: что есть сейчас

| Источник | Фактическое состояние | Команда, которой получено | Владелец факта |
|---|---|---|---|
| `.work/tasks/tasks.json` | 55 записей, `planRevision=2`, `schemaVersion=1`, `planned=53`, `superseded=2` (MW-027, MW-035) | `pwsh .tmp/plan-v03-cards/inventory.ps1` | MyWork DB (после cutover) |
| `.work/tasks/INDEX.md` | 135 строк, «Версия плана: v0.2, planRevision 2»; те же 55 строк, `planned`/`superseded` | тот же скрипт, секции расхождений пусты | **производный** (после MW-071) |
| `.work/reports/*` | 34 файла; отчёты у 22 карточек: MW-001…MW-020, MW-042, MW-043. Из них 21 отчёт содержит «Статус: **DONE**», `MW-043-idea-bank.md:3` — «**Статус: BLOCKED.**» | `Get-ChildItem .work/reports -File` + выборка последней строки `Статус` | отчёт (evidence), а не статус |
| живой леджер доски (снапшот 2026-09-16 22:22) | 41 задача, `revision=82`, `ledgerId=21d3414b-…`, все 41 в `backlog`, `executions` пуст | `pwsh .tmp/plan-v03-cards/board-cross.ps1` | MyWork DB; на момент снапшота — легаси-доска |
| `ledger-v2.json` (текущий живой леджер; файла в репозитории нет — он в живом профиле) | **Проверено 2026-10-03 (только чтение):** `revision = 341`, `schemaVersion = 4`, 55 карточек, сырые колонки `{failed: 2, backlog: 34, done: 19}`, архивных 3, `permissionConfirmedAt` у 22 из 55; статуса `blocked` в леджере нет вовсе. Схема **v4** поднята доской **0.4.4**: понижение до 0.4.3 этот файл не читает — `unsupported ledger schema` → карантин `.corrupt-*` и пустая доска (C-47/MW-073). **Снято как устаревшее:** «не проверено мной; приведено по `10-DECISIONS.md` (D02)» | `pwsh` (только чтение): `Get-Content <леджер> -Raw \| ConvertFrom-Json` → `revision`, `schemaVersion`, `tasks.Count`, разбивка `status`, `archivedAt` | MyWork DB |

**Три расхождения, которые надо устранить (а не «сгладить»):**

1. **`done` существует только в отчётах.** В `tasks.json`, `INDEX.md` и снапшоте леджера — ни одной `done`. Значит, 21 карточка «выполнена по отчёту» и «planned по леджеру» одновременно. Источник истины по принципу 2 (`01-MASTER-PLAN.md`) — MyWork DB; отчёт — evidence, а не статус.
2. **Заявления о падениях не подтверждаются снапшотом.** §7.4(2) говорит про 11 failed-исполнений и 9 на `done`-карточках; снапшот 2026-09-16 показывает 0 исполнений. Уточнение из `10-DECISIONS.md`: в текущем живом леджере `ledger-v2.json` — 55 карточек, из них `done: 19`, `failed: 2`, `backlog: 34`. То есть **статусов `failed` всего два**, а «9 падений» — это про **исполнения** (запуски) на карточках со статусом `done`, а не про статусы карточек. Оба числа измеряют разное, и в плане их нельзя смешивать. Список исполнений уже есть — `evidence/lead-15-legacy-board.md` (инвентаризация 2026-09-27), и независимый замер red-team B (2026-10-03) совпал с ней до единицы: **7** `done`-карточек с падением, **9** неархивных карточек, **10** с архивным `MW-001`, **11** записей `result: "failed"`; то есть «9» — верное измерение одной из четырёх величин, а не неподтверждённое число. **Снято как устаревшее:** «до его появления счёт „9“ этим документом не подтверждён».
3. **`Board ID` в карточках расходится с леджером** (7 карточек из 21) и заголовки разошлись у 3 карточек — правка M-1.

### 4.2. `INDEX.md` как производный артефакт с `lastSyncedRevision`

**Правило:** `INDEX.md` — не источник истины, а **проекция** `tasks.json` (+ `boardTaskId` из леджера). Ручные правки в него запрещены; расхождение проекции с источником — это дефект генератора, а не повод править проекцию.

Шапка файла (строки 1–5) приводится к виду:

```markdown
# Задачи

Версия плана: v0.3, planRevision 3. **Производный артефакт:** сгенерирован из `.work/tasks/tasks.json`.
lastSyncedRevision: 3 · lastSyncedAt: <ISO-8601> · generator: scripts/sync-index.mjs
Правки в этот файл вносятся только генератором; расхождение с tasks.json — дефект генератора.
```

**Требования к генератору (входит в MW-071):**

1. Читает `tasks.json` и `boardTaskId`-карту, пишет `INDEX.md` целиком; повторный прогон без изменений источника **не меняет файл** (идемпотентность — проверяется сравнением хеша).
2. `lastSyncedRevision` берётся из `tasks.json.planRevision`, а не из счётчика прогонов.
3. Разделы `## 00-foundation` … `## 07-migration` формируются из `phase`; порядок строк — по `id`.
4. Колонки: `ID | Задача | Зависимости | Статус` — сохраняются (совместимость с чтением человеком); `Board ID` в карточках исчезает (M-1), `boardTaskId` живёт здесь отдельной колонкой.
5. Расхождение «запись в `tasks.json` без строки в `INDEX.md`» (и наоборот) валит генератор с exit 1.

### 4.3. Правило «`done` без `failed`-исполнений или с явным обоснованием»

**Формулировка для `.work/README.md` (дословно):**

> `done` — это утверждение о прогоне, а не о колонке. Карточка может быть `done`, только если одновременно верно:
> 1. есть отчёт `.work/reports/<card>-*.md` с командой, её exit code и наблюдаемым результатом;
> 2. гейт карточки прогнан **буквально** той командой, что написана в карточке, и она зелёная;
> 3. выполнено независимое ревью (MW-024) либо явно зафиксировано, что приёмка — акт владельца;
> 4. в леджере у карточки **нет ни одного `failed`-исполнения без записи-обоснования** в поле `failedRunAccepted`.
>
> **Носитель обоснования (без него правило неисполкомо).** Схема `tasks.json` сегодня — 12 ключей
> (`id, phase, title, sections, dependsOn, status, scope, acceptance, report, baselineItems, adrs, supersededBy`);
> поля для обоснования прогона в ней **нет**, а единственное исключение — `supersededReason` у двух `superseded`-карточек.
> Поэтому в запись добавляется необязательное поле:
> `\"failedRunAccepted\": [{ `\"executionId\"`, `\"reason\"`, `\"acceptedBy\"`, `\"date\"`, `\"report\" }]` — необязательное поле записи;
> Требования: поле необязательное (отсутствие = нет принятых падений); запись добавляется **только** вместе со строкой
> `failed-run-accepted: <executionId> — <причина> — <кто принял> — <дата>` в отчёте; `executionId` обязан существовать
> в леджере, иначе запись считается дефектом сверки. До введения поля действует упрощённое правило: **`failed`-исполнение
> без строки-обоснования в отчёте означает, что карточка не может быть `done`** — её статус `todo` (перепрогон) или
> `needs-attention`.
>
> **Перепрогон обязателен и назначен.** Падения перепрогоняются на текущем дереве; поскольку часть гейтов требует
> живого backend'а (`bd`-seam, 23 `skip`), перепрогон выполняется **после `MW-056`**; до него `done`-карточки с
> `failed`-исполнением переводятся в `needs-attention` с причиной, а не остаются `done` по умолчанию.
> Владелец правила и перепрогона — `MW-071` (вместе с `MW-075`-инвентаризацией, см. §3.17-бис).
> Отсутствие ключа `autoRun*` и отсутствие расписаний — это **не** «выключено»; доказательство — вывод команды.

**Число падений — не константа.** В плане зафиксированы три разных числа («9», «7+2», «11 failed-исполнений»); они не противоречат друг другу, потому что измеряют **разные величины** одного леджера, и все подтверждены. Предусловие выполнено: список существует — `evidence/lead-15-legacy-board.md` (инвентаризация 2026-09-27), и независимый замер red-team B (2026-10-03) совпал с ним до единицы: **7** `done`-карточек с падением (`MW-003`…`MW-008`, `MW-043`), **9** неархивных карточек с падением (7 + `MW-002` + `MW-016`), **10** с архивным `MW-001`, **11** записей `result: "failed"`. Снапшот леджера 2026-09-16 показывает 0 исполнений — это измерение другого момента, а не опровержение. Поэтому правило формулируется через **N — число из списка** (`evidence/lead-15-legacy-board.md`), а не через литерал: N берётся из инвентаризации, и подставлять «9», не сказав, какая из четырёх величин имеется в виду, нельзя. Правило **исполкомо сегодня**: формулировка (`F-08`), инвентаризация (`F-09`) и перепрогон (§4.4) запускаются по закрытии `MW-056`. **Снято как устаревшее:** «ни одно не подтверждено… пока списка нет, правило к конкретным карточкам не применяется».

Почему именно так: §7.4(2) («„done“ не означает „принято“»); мастер-план §9 правило 8 («Не считать колонку „Готово“ доказательством приёмки»); §7.2(1); R-9; §16 мастер-плана (реестр дефектов, R-10).

### 4.4. Что делать с падениями на `done`-карточках

Порядок обязателен и применяется к каждой карточке из списка Lead'а (`evidence/lead-15-legacy-board.md`), а не «к падениям вообще». Владелец — `MW-071`; список получен (§4.3), поэтому шаги 2–3 запускаются по закрытии `MW-056` (**снято как устаревшее:** «до появления списка шаги 2–3 не запускаются»).

| Шаг | Действие | Критерий перехода дальше |
|---|---|---|
| 0 | **Предусловие:** список исполнений получен (`evidence/lead-15-legacy-board.md`), `MW-056` закрыт (иначе перепрогон backend-гейтов невозможен) | оба предусловия выполнены; иначе шаг 1 блокирован, а карточки с падениями идут в `needs-attention` |
| 1 | Достать из леджера `executionId`, дату, исход и карточку. Записать в отчёт сверки | список полный: для каждого падения есть запись |
| 2 | Перепрогнать **гейт карточки** той командой, что написана в карточке, на текущем дереве | команда и exit code записаны |
| 3a | Гейт зелёный → карточка остаётся `done`; в отчёт и в поле `failedRunAccepted` добавляется запись `{executionId, reason, acceptedBy, date, report}` | запись есть ровно одна на каждое падение |
| 3b | Гейт красный → карточка переводится в `todo` (или `backlog`, если работа отменена решением) с причиной и ссылкой на падение; `done` снимается | статус изменён, причина названа |
| 3c | Карточка `superseded` (MW-027/MW-035) → архивируется, падение закрывается ссылкой на карточку-наследника | карточка не в активной колонке |
| 4 | Пересобрать `INDEX.md` генератором и прогнать reconciliation-тест (MW-071) | тест зелёный; `lastSyncedRevision` обновился |
| 5 | Отчёт сверки приложить к `.work/reports/` как отдельный файл (`reconciliation-<дата>.md`) | файл существует, числа воспроизводимы |

**Первый прогон reconciliation-теста обязан пройти.** Сегодня 21 отчёт говорит `DONE`, а `tasks.json` — `planned` у всех 55. Это расхождение устраняется **до** включения теста, одной таблицей переклассификации (какие карточки признаются `done` по правилу §4.3, какие возвращаются в `todo`); иначе тест упадёт на первом запуске и остановит этап 1. Разбор — предмет `MW-075` (инвентаризация) вместе с `MW-071`.

**Что запрещено:** «обнулять» падения удалением записей; переводить карточку в `done` «потому что отчёт есть»; принимать падение записью без имени принявшего; править `INDEX.md` руками, чтобы он «сошёлся» (это маскирует дефект генератора); вводить правило в действие раньше, чем получена инвентаризация (список получен — §4.3; без инвентаризации число падений остаётся выдуманным).

**Особый случай:** падение, случившееся на карточке, которая с тех пор была переоткрыта или заменена (например при пересмотре контракта зон), закрывается ссылкой на новую карточку, а не записью `failedRunAccepted`: исполнение относилось к снятому контракту.

### 4.5. Что делать с MW-027 и MW-035 в `backlog`

Факт: обе карточки имеют статус `superseded` в `tasks.json`, но в снапшоте леджера лежат в `backlog` (`board-cross.ps1`: `e5bdbc44-…` и `d66573e0-…`, обе `status=backlog`) — то есть формально запускаемы, что противоречит и тексту карточки («НЕ ЗАПУСКАТЬ»), и `INDEX.md:5`.

**Действие (шаг этапа 0, `F-…`):**

1. Архивное перемещение обеих карточек в леджере (`task_board_manage action=archive`) — архивируется всё поддерево; у обеих подзадач нет.
2. Если архивация невозможна из-за незавершённого исполнения — сначала снять исполнение, затем архивировать (`archive` отказывает при неурегулированном исполнении; это ожидаемое поведение, а не повод оставить в `backlog`).
3. В `INDEX.md` строки переводятся из таблиц разделов в отдельный раздел `## Архив (superseded, не запускать)` со ссылками на наследников: MW-027 → MW-042, MW-047, MW-048; MW-035 → MW-048, MW-049, MW-050, MW-053.
4. После архивации гейт: `task_board_list --includeArchived=false` не содержит MW-027 и MW-035; `tasks.json` сохраняет `status: "superseded"` (исторический факт), а не `archived`.

**Почему не удалять:** `tasks.json.supersededBy` и текст карточек — след решения владельца; удаление уничтожит историю замены. Поэтому «архив», а не «delete».

### 4.6. `MW-001` и `MW-043`: два карточки-исключения

| Карточка | Состояние | Решение | Гейт закрытия |
|---|---|---|---|
| **MW-001** | В леджере помечена `failed`; при этом два отчёта на месте (`MW-001-target-capabilities.md` 48 011 Б, `MW-001-review.md` 25 739 Б), и в отчёте стоит «Статус: **DONE**» | Закрыть как `done-with-report` **или** перепрогнать — решает владелец (D19, `01-MASTER-PLAN.md`). Правка приёмки — C-01 | либо строка `failed-run-accepted`, либо перепрогон с зелёным гейтом; в обоих случаях статус в леджере совпадает со строкой в отчёте |
| **MW-043** | Отчёт есть, статус `BLOCKED`; блокер — отсутствие MW-026 (MW-011 реализован, 8 отчётов) | Блокер переоформлен на одно действие (C-36): карточка запускаема, плановая ветка отдаёт `PLANNER_UNAVAILABLE` | тест: «Создать быструю задачу» проходит, «Разработать план» отказывает типизированно; статус в леджере — `planned`/`todo`, а не `BLOCKED` |

Обе карточки — пример одной и той же болезни: **отчёт и леджер живут раздельно**. После MW-071 расхождение ловится тестом, а не глазами.

### 4.7. Регламент сверки (кто, когда, чем)

1. **Перед каждым запуском карточки** — исполнитель проверяет `dependsOn` и наличие отчёта зависимости, а не колонку доски (`01-MASTER-PLAN.md`). Гейт: `node scripts/check-deps.mjs MW-0NN` → `ready` либо список неготовых зависимостей.
2. **После каждого исполнения** — запись статуса в MyWork DB и отчёт в `.work/reports/`; `INDEX.md` не правится руками.
3. **Раз в этап** — прогон reconciliation-теста (MW-071): сверка множеств `done` между `tasks.json`, `INDEX.md` и леджером; при расхождении — отчёт, а не тихая правка.
4. **Раз в этап** — сверка `boardTaskId` (M-1): каждая карточка имеет ровно одну задачу на доске, либо явное «не создана»; обратная сверка «задача без карточки» обязательна (именно она нашла 7 расхождений).
5. **Владелец сверки** — тот, кто ведёт этап; результат прикладывается к отчёту этапа. Числа приводятся командой, которой получены.

---

## 5. Не проверено и открытые проверки

### 5.1. Не проверено этим документом

1. **«9 падений на `done`-карточках»** — не подтверждено: снапшот леджера (2026-09-16) показывает 0 исполнений, а текущий `ledger-v2.json` даёт 19 `done` и 2 `failed` **статуса** (числа приведены по `10-DECISIONS.md`, сам файл лежит в живом профиле и мной не читался). Нужен список исполнений: `executionId`, карточка, исход. Проверяет Lead; источник — `evidence/lead-15-legacy-board.md`.
2. **`§56`, `§63`, `§64` архитектуры** — номера строк не подтверждены ни одной карточкой; в правках помечены `~` (C-30, C-34). Проверить может любой участник: `Select-String '.work/architecture/DSH-My-Work-Architecture-v0.1.md' -Pattern '^#{1,3}.*§?(56|63|64)'`.
3. **`autoRun*` в живом профиле** — проверялся только легаси-JSON (`'autoRun' x0`) и упоминания в отчётах; чтение `cordis.patch.yml:20-35` в этом документе не выполнялось (это работа Lead'а, `F-01`).
4. **Фактическое исполнение MW-021…MW-041, MW-044…MW-055** — статусы взяты из `tasks.json` и отчётов; сессии и колонки доски не читались.
6. **`.work/reports/*` целиком** — читались только имена, размеры и строки со словом `Статус`; содержательная часть 34 отчётов не анализировалась.

### 5.2. Открытые вопросы к Lead'у и владельцу

| # | Вопрос | Кому | Почему важно |
|---|---|---|---|
| 1 | Прислать список падений (`executionId`, карточка, исход) — «9» в плане не подтверждено; до списка правило §4.3 действует без числа, а §4.4 не запускается | Lead | без списка регламент §4.4 не запускается, а число падений остаётся выдуманным |
| 2 | D02 решён: вариант C — девять зон остаются контрактом, семь полос — представление в UI-пакете; тексты MW-042/049/052/053 приведены к этому решению (C-35, C-42, C-45, C-46). Проверить, что формулировка MW-042:21 действительно остаётся без изменений | Lead / владелец | `10-DECISIONS.md` прямо перечисляет, какие тексты карточек меняются, а какие нет |
| 4 | Допустимо ли удаление строки `Board ID:` из всех 55 карточек (M-1) или нужен переходный период `см. INDEX.md` | Lead | массовая правка затрагивает все карточки |
| 5 | Область действия запрета «не запускай субагентов» (M-2) | владелец | без явного разрешения §6 брифа неисполним по построению |
| 6 | `§56`, `§63`, `§64` — подтвердить номера строк или оставить `~` навсегда | владелец шагов | правило §1.2 брифа требует либо номер, либо `~` |

### 5.3. Как проверить этот документ

```powershell
(Get-ChildItem H:\Repo\DSH-MyWork\.work\tasks -Filter 'MW-*.md').Count   # → 55
pwsh .tmp/plan-v03-cards/inventory.ps1      # → расхождений tasks.json ↔ INDEX.md: 0
pwsh .tmp/plan-v03-cards/verify-final.ps1   # → nodes = 75, problems = 0, cycles = 0, sinks = 0
Select-String -Path 'H:\Repo\DSH-MyWork\.work\tasks\MW-*.md' -Pattern 'строка undefined' | Measure-Object
pwsh .tmp/plan-v03-cards\board-cross.ps1 ; pwsh .tmp/plan-v03-cards\actions.ps1
```

---

## 6. Итог

1. **Просмотрены все 55 карточек; правок — 57** (55 индивидуальных `C-01`…`C-55` + 2 массовых `M-1`/`M-2`). Формат карточки установлен фактически (§0.2): приёмка — строка внутри `## Prompt агента`, отдельного заголовка `## Приёмка` нет ни в одной карточке.
2. **Новых карточек — 20** (`MW-056`…`MW-074`, `MW-076`): полный текст, запись для `tasks.json` (§3.24 — единственная копия), место в `INDEX.md` и в критическом пути. Граф 75 узлов: **0 циклов, 0 висячих ссылок, 0 sinks среди новых карточек**; ожидаемое единственное ребро к `superseded` — `MW-035 → MW-027` (обе карточки архивируются вместе). Отклонены по правилу 70 %: `MW-075` (инвентаризация → `MW-071`, упаковка → `MW-041`).
3. **Каждая правка и карточка ссылается на источник** (`D-XX`, шаг `F/E/B/Q-NN`, `§`, `файл:строка` кода, evidence кампании); адресация — только символьная (§0.6). Расхождения леджеров названы: 7 ложных `Board ID`; 3 заголовка разошлись; `done` живёт только в отчётах; число падений — `N` из списка Lead'а; `MW-038` зависела от снятой карточки. Правки по red-team B (циклы, потерянные рёбра, исполнимость D19, активация `auto-review`, скрипты) сведены в §3.22 и §4.3–§4.4.

---

## 7. Правки по red-team B: находка → где исправлено

| Находка | Что сделано | Где |
|---|---|---|
| §3.2 скрытые циклы `MW-042 ↔ MW-064`/`MW-048` | из гейта `MW-042` сняты `data-mw-*` (шаг `B-27`, живёт в `MW-048`) и носитель `NeedsAttentionReason` (создаёт `MW-064`) | C-35, §2.9, §3.22 |
| §3.3 восемь потерянных рёбер + H-13 | добавлены рёбра `MW-021/030/065 → MW-059`, `MW-022/026/028/067 → MW-058`, `MW-048 → MW-060`; заведена карточка `MW-076` (перепрогон гейта этапа 2) | §3.22, §3.24, §3.21 |
| §6 (R-10) правило D19 неисполкомо | описано поле `failedRunAccepted` и его формат; «9» заменено на `N` из списка Lead''а; `§5.4` → §4.4; `MW-071.dependsOn = []` (цепочка `F-08`→`F-09`→`F-27`); назначены владелец и предусловие перепрогона (`MW-056`); отмечена обязательная переклассификация 21 «DONE по отчёту» | §4.3, §4.4, §3.16 |
| §2.4 (R-11) скрипты не воспроизводили план; §2.6 (R-13) нерабочая адресация | заведён `graph.ps1` — единственный источник графа (читает JSON из этого документа); `check-deps.ps1` делегирует в `verify-final.ps1`; ребро к `superseded` печатается явно, а не скрывается `continue`; все ссылки на живые документы переведены на символьные ID (`D02`, `F-32`, `Q-17`, `B-01a`), §0.6 переписан без номеров строк | `.tmp/plan-v03-cards/*.ps1`, §0.6, весь файл |
| §2.6 (R-13) нерабочая адресация | все ссылки на живые документы переведены на символьные ID (`D02`, `F-32`, `Q-17`, `B-01a`); §0.6 переписан без номеров строк | §0.6, весь файл |
**Два пункта вынесены из списка выше:** субагенты не запускались по объективной причине (§0.4), а правки карточек не применены — по границам задачи `.work/tasks/**` не изменялся, всё описанное требует применения отдельным шагом.

---

## 8. Дельта платформы 0.2.0-rc.2: внесённые правки и проверенные факты (2026-10-03)

**Источник истины:** `02-PLATFORM-DELTA-0.2.0-rc.2.md`. Все правки внесены **внутрь существующих строк**, поэтому нумерация строк выше этого раздела не сдвинулась и якоря `:224`, `:378`, `:459`, `:653`, `:697`, `:863-880`, `:1036-1043`, на которые ссылается §6 дельты, остались валидны. Раздел дописан в конец файла. Нумерация карточек (`C-01`…`C-55`, `M-1`/`M-2`) и граф не менялись.

| Строка | Что изменено | Чем проверено |
|---|---|---|
| `:224` (C-08, MW-005) | к «Стало» дописано «**Проверено на 0.2.0-rc.2**»: бан по префиксу `@deepseek-ai/` + allowlist `@deepseek-ai/cordis`; расширение F-25 в дереве **уже реализовано** | `tests/boundaries.test.mjs:26-34,41,671-695,716-778` |
| `:378` (C-25, MW-031) | условие воспроизведения риска `time-context` переписано: строки уехали в бандл `@deepseek-ai/dsh-experimental-schedule-bundle`, живой профиль его включает, на 0.2.1 снимается сам | `packages/boot/app-boot/src/profile.ts:213-218`; `profiles/web/package.json:39`; дельта §2.1 G1, §5.2 |
| `:459-467` (C-34, MW-041) | CI-пин назван якорем `.github/workflows/ci.yml:131` (исправлено 2026-10-03: `:129` — строка комментария, пин стоял и стоит ниже) и значением `@deepseek-ai/dsh@0.2.0-rc.2`, которое в дереве **уже стоит** (коммит `d0b1f07`), а не «меняется»; peer-диапазон переведён на `>=0.1.7-rc.2 <0.3.0-0` | дельта §5.1, §6; `.github/workflows/ci.yml:131`; `git log -1 --format=%h -- .github/workflows/ci.yml` → `d0b1f07` |
| `:608` (C-47, MW-054) | посылка «ключей `autoRun*` нет» инвертирована: в 0.4.4 семь ключей вернулись в живой профиль, проверка — действие по их удалению | `profiles/web/cordis.patch.yml:25,27-33`; дельта §2.2 D8 |
| `:653` (C-49, MW-002) | диапазон → `>=0.1.7-rc.2 <0.3.0-0` (с обоснованием `-0`); снята ложь «engines читают издатели» | дельта §2.3 п.1, §5.1; `packages/boot/app-boot/README.md:52` |
| `:697` (C-54, MW-014) | то же условие риска `time-context`, что и `:378` | `packages/boot/app-boot/src/profile.ts:217`; `profiles/web/package.json:39` |
| `:867` (MW-060) | диапазон → `>=0.1.7-rc.2 <0.3.0-0`; названы CI-пин и эталон 0.4.4 (`peerDependencies`/`dsh.engines.dsh = >=0.2.0-rc.1`); `engines` помечено декоративным | дельта §2.2 D8, §5.1, §6 |
| `:869` (MW-060) | `engines.node` выправлен с `>=22.18.0` на платформенное `^22.19.0 \|\| >=24.0.0` | `tests/peer-gate.test.mjs:51,199`; `git show c7c4c725:package.json` и `639ed0153:package.json` → одно и то же значение |
| `:1036`, `:1038`, `:1043` (MW-073) | эталон 0.4.3 → **0.4.4** (объём, приёмка; у цитаты `FINAL-REPORT.md:435` пометка «цитата историческая») | `profiles/web/package.json:5-19`; дельта §2.2 D8 |
| `:1045-1060`, `:1154` (MW-074), `:447` (C-32/MW-039), `:433` (C-31/MW-038), `:1122` (§3.23) | **дополнение 2026-10-03 (D4):** карточка переведена на «свои runtime-проверки MyWork, без платформенного шва». **Было:** заголовок «регистрация через `ctx.invariants`», объём «companion-модули `./invariant` (`inject=['invariants']` → `ctx.invariants.register`)», приёмка «`Select-String packages -Pattern './invariant'` находит companion-модули», «`InvariantError` с кодом `INVARIANT`», «свойство реестра платформы», «отключение через конфиг платформы (`enabled`, `package_allowlist`)», «не строить собственную систему инвариантов», заголовок в `tasks.json` «…через ctx.invariants». **Стало:** свой модуль `packages/controller/src/invariant.ts` без `inject`/субпутя/вызова шва, код `INVARIANT_VIOLATED` в `MYWORK_ERROR_CODES`, приёмка из 5 пунктов (§3.19), заголовок карточки «Зарегистрировать runtime-инварианты (свой модуль MyWork)» — так цитата `Q-36` «Зарегистрировать runtime-инварианты» остаётся непрерывной подстрокой. В C-32 формулировка «runtime-регистрация» заменена на «runtime-проверки MyWork … без шва `./invariant`»; в C-31 добавлена оговорка, что `ctx.invariants` более не опора для Doctor; в §3.23 гейт «`InvariantError` код `INVARIANT`» заменён на `INVARIANT_VIOLATED` | `23-STEPS-quality.md:632,634-650` (переписанный Q-36); дельта §2.2 D4, §5.2 |
| `:608-610` (C-47, MW-054) | **новая правка — дельта доски 0.4.3 → 0.4.4:** в пункт `б)` добавлено, что читателей `autoRun*` нет ни в одной версии (0 совпадений `autoRun` в `src/**`+`lib/**` в 0.4.3 и 0.4.4; совпадение в `dsh-web-all` — чужой клиентский метод); в «Стало» добавлен пункт `г)` — живой леджер уже `schemaVersion: 4` (0.4.4: `TASK_BOARD_SCHEMA_VERSION = 4`, `LEGACY = 3`, `OLDER = 2`; 0.4.3: `3` и `2`), v4 добавляет `ScheduleRule.timeZone` (миграция штампует зону хоста в правила без зоны), а понижение до 0.4.3 леджер не читает: `unsupported ledger schema` → `recoverCorrupt()` → `.corrupt-<ts>-<pid>-<uuid>` и пустая доска; в «Почему» добавлено доказательство | живой `%USERPROFILE%\.dsh\task-board\ledger-v2.json` (только чтение) → `"schemaVersion": 4`; 0.4.4 `src/protocol.ts:11,13,15`, `src/host-ledger.ts:1181-1194`; 0.4.3 (`.tmp/board-delta/v043/package`) `src/protocol.ts:10,12`, `src/host-ledger.ts:1038,1088-1097`; `.tmp/board-delta/REPORT.md` §3-§4 |
| `:618` (C-48, MW-055) | утверждение о копии живого леджера уточнено: копия — документ **v4**, мастер импорта читает v4, копия снимается до cutover и сверяется по хешу сразу (`EXECUTION_HISTORY_LIMIT = 20`, обрезка истории на каждой загрузке) | там же (`.tmp/board-delta/REPORT.md` §3); 0.4.4 `src/core/tasks.ts:65,73-77`, `src/host-ledger.ts:1226`; red-team B N-1(б) |
| `:1036`, `:1038` (MW-073) | **дельта 0.4.4 в процедуре cutover/отката:** в объём добавлена копия леджера и перечень прочих семантических отличий 0.4.4 (per-task `goalRun` по умолчанию, Lead-вердикт `teamRun`, действие `settle`, IANA-`timeZone`); приёмка 4 больше не обещает «возврат строки возвращает прежнее поведение» при понижении версии: леджер v4 в 0.4.3 не читается (карантин + пустая доска) | `.tmp/board-delta/REPORT.md` §3-§4; 0.4.3 `src/host-ledger.ts:1038,1088-1097`; живой леджер `"schemaVersion": 4` |
| `:467`, `:867`, `:1411` и пункт 6 списка ниже (C-34/MW-041, MW-060) | **якорь CI-пина `:129` → `:131`** и снято утверждение «в дереве он пока `0.1.7-rc.2`, меняется на `0.2.0-rc.2`»: пин уже равен `0.2.0-rc.2` (коммит `d0b1f07`, 2026-10-03) | `.github/workflows/ci.yml:131`; `git log -1 --format=%h -- .github/workflows/ci.yml` → `d0b1f07` |
| пункт 1 списка «Проверено и зафиксировано» ниже (§8) | уточнены два факта 0.4.4: диапазон `maxSubtaskDepth` `1/3` при дефолте `1` (те же значения и строки, что в 0.4.3) и последствие пина подзадачи в `teamRun` — **отказ запуска** `kind: 'subtask-pin'`, а не «игнорирование»; подтверждённый пин в teammate не переносится | 0.4.4 `src/core/subtask.ts:15,17,19`, `src/host-ledger.ts:919-933`, `src/host-service.ts:316-333`; red-team B, «Дельта 0.2.0-rc.2» |

**Проверено и зафиксировано (правок не потребовало):**

1. **Дерево подзадач.** Ни одна карточка и ни одна правка этого документа не обещает поддерево глубже `maxSubtaskDepth`: проверка выполнена **до** дописывания этого раздела и дала **0 совпадений** по `maxSubtaskDepth` и **0** по `teamRun` во всём файле; единственное упоминание подзадач — `:1324` («у обеих подзадач нет»), то есть констатация отсутствия, а не обещание глубины. (После дописывания эти два термина встречаются только в настоящем пункте — самопроверка грепа по файлу теперь не нулевая.) Живой профиль держит `maxSubtaskDepth = 1` при платформенном диапазоне `SUBTASK_DEPTH_MIN/MAX = 1/3` и дефолте `1` (0.4.4 `src/core/subtask.ts:15,17,19` — те же значения и строки, что в 0.4.3; R7). Отдельно: режим `teamRun` доски **не соблюдает** пин прав подзадачи — `%USERPROFILE%\.dsh\profiles\web\node_modules\@linxin666\dsh-client-ui-task-board\lib\types\core\tasks.d.ts:216-222` («a subtask's own permission pin cannot be honored in this mode»), поэтому план не должен опираться на права, закреплённые в подзадаче, при командном прогоне (дельта §2.2 D7). Уточнение red-team B («Дельта 0.2.0-rc.2», проверка `teamRun`), подтверждённое чтением кода: последствие пина подзадачи — **отказ запуска**, а не «игнорирование» — `bindingRefusal()` возвращает `kind: 'subtask-pin'` (0.4.4 `src/host-ledger.ts:919-933`), а подтверждённый пин подзадачи в teammate не переносится: `spawnTeammate()` передаёт только `name`/`description`/`prompt` (`src/host-service.ts:316-333`).
2. **Версии платформы в брифах и леджерах.** Ни один бриф `.work/tasks/MW-*.md` и ни один леджер не содержит версий платформы: `Select-String` по всем 60 файлам `.work/tasks/**` (включая `tasks.json`, `board-export.json`, `board-actions.json`, `board-before.json`) на `0.1.7-rc.2|0.2.0-rc|0.1.7\b` → **0 совпадений**. Версии платформы живут только в документах плана — их правят владельцы по §6 дельты.
3. **Платформенные якоря, использованные в этих правках, существуют на `639ed0153`:** `packages/boot/app-boot/src/profile.ts:213-218` (`OPTIONAL_BUNDLES`), `packages/boot/app-boot/src/plugin-compatibility.ts`, `packages/boot/app-boot/src/compatibility-preflight.ts`, `packages/boot/app-boot/README.md:52`, `packages/client/tsdown.client.ts`, `packages/client/web/src/platform.ts:8-18`, `packages/bundle/sdk-minimal/`.
4. **Сверка с `23-STEPS-quality.md` (Q-36, владелец `plan-quality`).** Ссылка на эту карточку идёт **по ID**: `23-STEPS-quality.md:635` — «`30-CARD-EDITS.md` §3.19», без номера строки ✓. Обе стороны после правки говорят одно: свой модуль `packages/controller/src/invariant.ts`, новый код `INVARIANT_VIOLATED` в `MYWORK_ERROR_CODES`, тест `tests/invariants-runtime.test.mjs` → `pass 4 / fail 0`, субпуть `./invariant` в `files`/`exports` не заявляется, `ctx.invariants.register` не вызывается; таблица «инвариант §59 → носитель проверки» — у MW-074, тестовая половина — у MW-039 (`C-32`).
5. **Расхождение, которое правлю не я (чужой файл).** `23-STEPS-quality.md:637` утверждает, что правка **C-32** «добавляет runtime-регистрацию в её объём» и просит сократить её до тестовой части. Это описание устарело: `C-32` в этом файле (`:443`, `:447`) **уже** говорит обратное — runtime-регистрация/проверки принадлежат MW-074, MW-039 остаётся тестовая половина. Правок C-32 по существу не требуется; стороне `plan-quality` стоит снять эту фразу в Q-36 либо переформулировать её как «канон зафиксирован».
6. **Не сделано здесь:** код репозитория (`packages/controller/package.json`, `packages/web/package.json`, `tests/peer-gate.test.mjs`, `.github/workflows/ci.yml:131`, `README.md:353`, `pnpm-workspace.yaml`) — вне write-scope этой карточки; список правок кода — §6 дельты. Правки шагов и решений (`10-DECISIONS.md`, `20/21/22/23-STEPS-*`) — у их владельцев.
