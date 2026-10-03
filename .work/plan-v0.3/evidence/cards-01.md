# Evidence cards-01 (MW-001…MW-055, леджеры) — участник `card-ledger`, без субагентов

**Причина отсутствия субагентов:** `subagent` из сессии участника падает с `Error: subagent depth 2 exceeds maxDepth 1` (участник на depth 1, `maxDepth=1`). Lead подтвердил ограничение и разрешил провести инвентаризацию скриптами и выборочным чтением. Требование `00-RECON.md` §6 не выполнено по объективной причине; компенсация — воспроизводимые команды ниже.

Все скрипты: `.tmp/plan-v03-cards/`. Ни один файл `.work/tasks/**` не изменялся (проверено: `git status --porcelain -- .work/tasks` → пусто).

## 1. Инвентаризация карточек

```
pwsh .tmp/plan-v03-cards/overview.ps1
```
→ 55 файлов `MW-001.md`…`MW-055.md`; 24 строки у 47 карточек, 25 строк у 16 карточек (MW-010, 011, 025, 029, 036, 037, 041, 042…055), 34 строки у MW-027 и MW-035 (шапка `НЕ ЗАПУСКАТЬ`).
→ **Ни в одной из 55 карточек нет заголовка `## Приёмка`**: приёмка оформлена строкой `19: Приёмка:` / `20: Приёмка:` внутри `## Prompt для агента`. Проверка «карточек без `## Приёмка`» даёт ложные 55/55.
→ `Board ID:` — 34 карточки с UUID, 21 с текстом `не создана — карточка принадлежит доске MyWork, а не legacy ledger`.

```
pwsh .tmp/plan-v03-cards/dump-substantive.ps1
```
→ `wrote .tmp/plan-v03-cards/cards-substantive.txt bytes=142080`, `total chars=98284` — все содержательные строки 55 карточек с номерами; шаблонные строки («Выполни только…», «Проект:…», «Сначала прочитай…», «Ограничения исполнения:…», «Не выполняй push/merge/publish/release») исключены как идентичные во всех 55 файлах.

## 2. `tasks.json` ↔ `INDEX.md`

```
pwsh .tmp/plan-v03-cards/inventory.ps1
```
→ `count=55 planRevision=2 schemaVersion=1`; `planned = 53`, `superseded = 2`; фазы: `00-foundation=8, 01-runtime=7, 01b-board=1, 02-context=5, 03-execution=6, 04-control=5, 04b-board=5, 05-learning=3, 06-ui=9, 07-acceptance=5, 07-migration=1`.
→ Секции «INDEX.md STATUS VS tasks.json STATUS (mismatches)», «dependsOn: tasks.json vs INDEX.md (normalized)», «titles json vs index», «INDEX rows with no tasks.json entry» — **все пусты**. Расхождений 0.
→ Поля записи `tasks.json`: `id, phase, title, sections, dependsOn, status, scope, acceptance, report, baselineItems, adrs, supersededBy`. **Поля `stage` нет** (в брифе и задании запись описана как `stage`).

## 3. Якоря `(строка undefined)`

```
Select-String -Path 'H:\Repo\DSH-MyWork\.work\tasks\MW-*.md' -Pattern 'строка undefined'
```
→ 4 файла, 8 якорей: `MW-025.md:14` (§26), `MW-036.md:14` (§6, §14), `MW-037.md:14` (§25, §56), `MW-041.md:14` (§63, §64, §66).

Аттестация номеров другими карточками (тот же шаблон):
```
Select-String -Path '...\MW-*.md' -Pattern '§(26|6|14|25|66) \(строка \d+\)'
```
→ `§26 → 1812` (MW-023:14, MW-024:14); `§6 → 330`, `§14 → 735` (MW-006:14, MW-013:14, MW-014:14); `§25 → 1648` (MW-032:14, MW-033:14); `§66 → 2880` (MW-022:14, MW-026:14).
→ `§56`, `§63`, `§64` встречаются **только** в тех же битых строках — аттестации нет, в правках помечены `~`.

## 4. Зависимости: разрыв и циклы

```
$j = Get-Content '.work\tasks\tasks.json' -Raw | ConvertFrom-Json
# зависимость запускаемой карточки от superseded
```
→ **`MW-038 [planned] -> MW-027 [superseded]`** — единственный случай среди запускаемых (второй, `MW-035 [superseded] -> MW-027`, безвреден).

```
pwsh .tmp/plan-v03-cards/check-deps.ps1      # hardcoded-прогон
pwsh .tmp/plan-v03-cards/verify-final.ps1    # прогон из самого 30-CARD-EDITS.md
```
→ `nodes = 74 (55+19)`, `problems = 0`, `cycles = 0`, висячих ссылок 0, зависимостей от superseded 0, id `MW-056…MW-074` без дыр и дублей, у всех `status: "planned"` и заполнен `phase`.
→ Первый прогон `check-deps.ps1` находил один цикл `MW-063 -> MW-048`; ошибочное предложение (добавить `MW-063` в `dependsOn` карточки MW-048) снято, повторный прогон — 0 циклов. Этот факт зафиксирован в `30-CARD-EDITS.md` §3.0.

## 5. Живой леджер доски (снапшот)

```
pwsh .tmp/plan-v03-cards/board-cross.ps1
```
→ `revision=82 ledgerId=21d3414b-b542-4dd7-9c5a-51a6dcebb156 verifiedAt=09/16/2026 17:22:16 workspaceId=3fc33afb-… model=opencode-go/deepseek-v4.1-flash tasks=41`; распределение статусов: `backlog = 41`; `executions` пуст у всех 41.
→ 34 карточки ссылаются на UUID, который в леджере есть; **7 карточек** (`MW-010, MW-011, MW-025, MW-029, MW-036, MW-037, MW-041`) пишут `не создана`, хотя их задача в леджере есть:
`352f3912-… MW-010`, `261037d9-… MW-011`, `da617bd1-… MW-025`, `025a73a1-… MW-029`, `cccb16bb-… MW-036`, `82c39792-… MW-037`, `d61d6871-… MW-041`.
→ Расхождения заголовков: MW-011 «…staged activation и replanning» против «…replanning и WorkProposal»; MW-036 «Team Roles и Settings» против «Team Roles, Workflows и Settings».
→ **Важно:** снапшот **не подтверждает** «9 падений на done-карточках» (§7.4(2)): исполнений в снапшоте нет вовсе. Подтверждение — за живым леджером (Lead, `evidence/lead-15-legacy-board.md`).

```
pwsh .tmp/plan-v03-cards/actions.ps1
```
→ `board-actions.json` (214 448 Б): `'autoRun' x0`, `'"todo"' x0`, `'"running"' x0`, `backlog x41`, `failed x2` (оба — в прозе `description`/`prompt`); структура: ключи `schemaVersion, createdAt, apiBase, architectureSha256, workspaceId, model, tasks`, у записи — `taskId, boardId, create, move`.
→ То же для `board-export.json` (193 386 Б); `board-before.json` (438 Б) не содержит ни одного из маркеров.

## 6. Отчёты как четвёртый источник статуса

```
Get-ChildItem .work/reports -File | ForEach-Object { if ($_.Name -match '^(MW-\d{3})') { $Matches[1] } } | Group-Object
```
→ 34 файла; отчёты у 22 карточек: `MW-001=2, MW-002=1 … MW-020=1, MW-042=1, MW-043=1`; у MW-011 — 8 отчётов; **у MW-026 — 0**.
→ Выборка последней строки со словом `Статус` в каждом отчёте: 21 отчёт содержит `Статус: **DONE**`; `MW-043-idea-bank.md:3` — «**Статус: BLOCKED.**»; `MW-001-target-capabilities.md:346` — `- Статус: **DONE**`.
→ Следствие: `done` существует **только** в отчётах. В `tasks.json` (53 `planned`), в `INDEX.md` и в снапшоте леджера (41 `backlog`) — ни одной `done`.

## 7. Код: символы, на которые ссылаются правки

```
Get-ChildItem H:\Repo\DSH-MyWork\packages -Recurse -Filter *.ts -File |
  Where-Object { $_.FullName -notmatch '\\lib\\|\\node_modules\\' } |
  Select-String -Pattern '<symbol>'
```

| Символ | Найдено | Где |
|---|---|---|
| `BOARD_ZONE_ROWS` | 1 | `packages/contracts/src/board.ts:66` |
| `BOARD_STRIP_MAX_WIDTH_PX` | 1 | `packages/contracts/src/board.ts:132` |
| `projectTaskZone` | 10 | `contracts/src/board.ts:7,44,48,67,98,123`; `core/src/board.ts:7,44,48,67` |
| `applyDropIntent` | 2 | `core/src/board.ts:458`; `core/src/index.ts:301` |
| `legalDropTargets` | 3 | `contracts/src/board.ts:161,533`; `core/src/index.ts:306` |
| `NeedsAttentionReason` | 2 | `contracts/src/board.ts:356,373` (носителя-поля нет) |
| `SubState` | 1 | `contracts/src/board.ts:210` |
| `PlacementChange` | 3 | `contracts/src/board.ts:434,463`; `core/src/index.ts:316` |
| `TaskBoardPlacement` | 1 | `contracts/src/board.ts:191` |
| `LANE_BY_STATE`, `projectTaskLane` | 0 | — (планируемые имена под D02) |
| `WorkType`, `FinishCriteria`, `FINISH_CRITERIA_UNMET` | 0 | — (§9.1: «в коде 0 совпадений», подтверждено) |

```
Test-Path packages\{contracts,core,planner,execution,controller,storage,beads-adapter,adapter-sdk,lease,memory-native,scheduler,evidence}
```
→ все 12 каталогов существуют (`True`).

```
Get-ChildItem .work/reports -Filter 'MW-011*'   → 8 файлов
Get-ChildItem .work/reports -Filter 'MW-026*'   → 0 файлов
Get-ChildItem .work/reports -Filter 'MW-001*'   → MW-001-review.md (25 739 Б), MW-001-target-capabilities.md (48 011 Б)
```

## 8. Сверка с уже принятыми решениями (`10-DECISIONS.md`, появился позже первой редакции)

Прочитаны «Выбор» и «Последствия» у D02, D03, D04, D05, D07, D08, D09, D14, D15, D16, D17, D18, D19, D20 (`Select-String -Pattern 'Выбор:'` → строки 166, 264, 348, 425, 507, 594, 671, 748, 827, 903, 979, 1055, 1130, 1207, 1286, 1364, 1442, 1532, 1666, 1746).

| Решение | Выбор | Что это изменило в `30-CARD-EDITS.md` |
|---|---|---|
| D02 | вариант C: девять зон остаются контрактом, семь полос — представление в UI-пакете, layout-константы переезжают сразу | правки C-35, C-42, C-45, C-46 переписаны: `BOARD_ZONE_ROWS` и `ZONE_BY_STATE` **остаются** в `contracts` (первая редакция ошибочно выносила `BOARD_ZONE_ROWS`); переезжают только `BOARD_VIEW_MODES`/`BOARD_STRIP_MAX_WIDTH_PX` (`10-DECISIONS.md:275`); текст приёмки MW-042:21 не меняется, MW-049:21 сохраняет «ровно девять панелей» (`:278`) |
| D07 | вариант B: application service `myworkApplication` внутри `packages/controller` | MW-058 больше не «выбирает форму» — форма задана (`10-DECISIONS.md:671`) |
| D08 | вариант B: один канонический `MYWORK_DATABASE_MIGRATIONS` (версии 1…6) | уточняет объём MW-059 (`:748`) |
| D09 | вариант B: `controller.sqlite` — истина, `jobs-local` не используется вовсе | уточняет приёмку MW-068 (`:827`) |
| D14 | вариант B + организационная форма C: **не дробить MW-030** | **MW-072 как отдельная карточка снята**; правка C-24 переписана под схему D14 (4 состояния, `gate: HumanGate`, `deadlineAt`), правка C-39 переведена на `prompt(..., mode: 'queue'|'steer')` (`:1207,1211,1216`) |
| D15 | вариант B: allowlist инструментов + «`auto-review` только deny» | формулировка «только deny» неисполнима (`evidence/quality-05.md:47-51`); в C-18 и MW-069 применено «не монтировать»; расхождение вынесено в §0.6 документа |
| D19 | вариант B сегодня, C как целевое после этапа 4 | согласуется с §4.3/§4.4 документа (правило `done` + перепрогон) |

**Новое число для части (3):** `10-DECISIONS.md:282` — в текущем живом леджере `ledger-v2.json` 55 карточек `{failed: 2, backlog: 34, done: 19}`. Файла в репозитории нет (`Get-ChildItem -Recurse -Filter 'ledger-v2.json'` → пусто), поэтому число принято по ссылке и помечено как непроверенное. Следствие: «9 падений» — это про **исполнения** на `done`-карточках, а не про 9 карточек со статусом `failed` (тех всего две).

## 9. Не проверено

- «9 падений на `done`-карточках» — снапшот их не содержит; проверяет Lead.
- Состояние живого леджера после 2026-09-16 22:22 — неизвестно.
- `§56`, `§63`, `§64` архитектуры — номера строк не подтверждены.
- `autoRun*` в живом профиле (`cordis.patch.yml:20-35`) — не читался.
- Содержательная часть 34 отчётов `.work/reports/**` — читались только имена, размеры и строки со словом `Статус`.
- Ни одна команда `pnpm`/`tsdown`/`node --test`/`tsc` не запускалась: exit code есть только у read-only `pwsh`/`Select-String`/`git status`.
- Тексты ADR016…ADR028 и требования §62 архитектуры — не читались.
- Сессии и колонки живой доски — не читались (только файловый снапшот).

## 10. Правки по red-team B (лог изменений)

Источник: `92-RED-TEAM-B.md` (36 находок, 7 блокеров). Ни один файл `.work/tasks/**` не изменялся.

| Находка | Исправление | Проверка |
|---|---|---|
| §3.1 `packages/web` без карточки-владельца; `MW-048.md:18` «Создать» | заведена `MW-072` (каркас, шаг `B-01a`); `MW-048` → «Наполнить», `dependsOn` += `MW-072`, `MW-060`; `MW-042.dependsOn` += `MW-072` | `Test-Path packages/web` → `False` (подтверждает дефект); `MW-072` в графе |
| §3.2 скрытые циклы `MW-042 ↔ MW-064` и `MW-042 ↔ MW-048` | из гейта `MW-042` сняты `data-mw-*` (шаг `B-27` в `MW-048`) и носитель `NeedsAttentionReason` (`MW-064`); в гейте остался property-тест на 16 состояний | `Select-String .work/tasks/MW-042.md -Pattern 'data-mw'` → 0 совпадений |
| §3.6 цикл `MW-055 ↔ MW-073` (`B-42 ↔ B-43`) | `MW-073` снята из `MW-055.dependsOn` | `verify-final.ps1` → `cycles = 0` |
| §3.3 восемь потерянных рёбер и H-13 | добавлены `MW-021/030/065 → MW-059`, `MW-022/026/028/067 → MW-058`, `MW-048 → MW-060`; заведена `MW-076` (перепрогон гейта этапа 2 после миграций `B-12`/`E-04`/`E-34`) | 25 записей в блоке правок `dependsOn` (JSON блок 2, `items=25`) |
| R-12 sinks и инверсия `MW-070` | добавлены 14 обратных рёбер (`MW-010/011→MW-057`, `MW-031→MW-061`, `MW-028→MW-069`, `MW-039→MW-062/067/074`, `MW-033/040→MW-068`, `MW-041→MW-073/076` и др.); `MW-070.dependsOn = [MW-058]`, `MW-070` добавлена в `MW-013` и `MW-022` | `sinks among new cards = 0` |
| §2.4 (R-11) скрипты расходились с планом | `graph.ps1` — единственный источник графа (читает JSON из `30-CARD-EDITS.md`); `check-deps.ps1` делегирует в `verify-final.ps1`; `MW-072` в скриптах нет; ребро `MW-035 → MW-027` печатается явно (оба узла `superseded`), а не скрывается `continue` | оба скрипта печатают `nodes = 75`, `problems = 1 (ожидаемое ребро)`, `cycles = 0` |
| §6 (R-10) правило D19 неисполкомо | описано поле `failedRunAccepted` (5 ключей) и его формат; «9» → `N` из списка Lead'а; `§5.4` → §4.4; `MW-071.dependsOn = []` (цепочка `F-08 → F-09 → F-27`, не CI); назначены владелец и предусловие (`MW-056`); отмечена обязательная переклассификация 21 «DONE по отчёту» | `tasks.json` 12 ключей + необязательное `failedRunAccepted` |
| §2.6 (R-13) адресация | все ссылки на живые документы переведены на символьные ID | `Select-String '(01-MASTER-PLAN\|10-DECISIONS\|2[0-3]-STEPS-[a-z]+)\.md:\d+'` → **0** |
| R-22 `auto-review` активен | `MW-069` и C-18 переписаны: «нет строки auto-review» снято; проверяется, что вердикт `allow` не даёт approval; выключение — решение владельца | `enabled: true`, `fiberPhase: active` внесено как факт |
| мелочи | C-34: строки `MW-041` → 17/20; M-1: 34 UUID сохраняются до `MW-073`; C-35: правка неисполнимого пункта (`AutonomyLevel` 0, `TaskClaims` 0 в коде) | `grep`-числа: `AutonomyLevel` 0, `TaskClaims` 0, `PlanMutationClass` 7, `BlockerResolutionGate` 11, `BoardPanelState` 2 |

**Итоговое состояние:** `30-CARD-EDITS.md` — 1398 строк; 20 новых карточек (`MW-056`…`MW-074`, `MW-076`); граф 75 узлов, `cycles = 0`, висячих ссылок 0, sinks среди новых 0. К созданию готовы `MW-056`…`MW-060`; остальные 15 помечены как «ждёт ре-верификации».

## 11. Остаточные дефекты верификации B — что изменено

**1) Шапка противоречила телу.** Приведено к одному значению **20 новых карточек**, диапазон `MW-056`…`MW-076`: заняты `MW-056`…`MW-074` и `MW-076`; **отклонена `MW-075`** (инвентаризация `done`-карточек → `MW-071`, упаковка v0.1 → `MW-041`); номер `MW-072` переиспользован под каркас `packages/web` вместо отклонённой карточки `HumanDecision` (её работа — в `MW-030`). Исправлены: строка 5 шапки, блок вывода скрипта (§0.3), примечание к `INDEX.md` (§3.25), сводка (§6), §3.23. Проверка: `Select-String '18 карточ|19 карточ|18 новых|19 новых'` → **0**; `verify-final.ps1` → `new cards = 20`.

**2) Владение гейтом `MW-074` раздвоено с `MW-039`, приёмка неисполнима.** Проверено фактами: `Test-Path .\scripts\verify-package-invariants.ts` в MyWork → **False**; в DSH-чек-ауте (`C:\Reposit\deepseek-harness\deepseek-harness\scripts\verify-package-invariants.ts`) → **True**; `"tsx"` встречается в **0** из 54 `package.json` MyWork; companion-модулей `invariant.ts` в MyWork — **0**; зависимости `dsh-invariants` в манифестах — **0**. Правка: `MW-074` владеет **runtime-регистрацией** (`ctx.invariants` + `./invariant`), `MW-039` — тестовой половиной (`deterministic интеграционные/fault/property checks`); build-time конформанс объявлен внешним (DSH) и **гейтом карточки не является**; приёмка переписана на исполнимые команды (`node --test --test-isolation=none tests/invariants-runtime.test.mjs` → `pass / fail 0`; нарушение → `InvariantError` код `INVARIANT`). Текст `npx tsx …` удалён полностью: `Select-String 'npx tsx'` → **0**. Половина `Q-36` согласована с `plan-quality` сообщением.

**3) Цикл `MW-023 ↔ MW-024` (верификация B) — в карточном графе отсутствует.** Прямая проверка достижимости по текущему `30-CARD-EDITS.md`: `023 -> 024 = False`, `024 -> 023 = True`; `cycles = 0`. Ребро ровно одно и направлено правильно (review зависит от гейтов). Источник — **шаги**: `21-STEPS-execution.md`, `E-17` (карточка `MW-023`) объявляет `Зависит от: E-16, E-19`, где `E-19` принадлежит `MW-024`; исправляется владельцем файла (`plan-execution`). Зафиксировано в §7 документа.

## 12. Согласование границы MW-074 / MW-039 с `plan-quality` (шаг Q-36)

`plan-quality` приняла границу и привела `Q-36` к «Runtime-инварианты через `ctx.invariants` — карточка **MW-074**, не MW-039» (сообщение `team-message-d713981d`). Мои ответные правки в `30-CARD-EDITS.md`:

- `C-32` переписана в **чистую ссылку**: механики `ctx.invariants.register` в ней больше нет (проверка: `Select-String 'invariants\.register'` → **1** вхождение, и оно в `MW-074`); заголовок — «тестовая половина инвариантов §59 и retention в приёмке».
- Флаг `--test-isolation=none` (канон `package.json:16`) добавлен во **все** три места: `C-32`, `MW-074` и гейт в сводной §2.9 — последний раньше был без флага, то есть верификация поймала бы повторно. Всего вхождений `test-isolation` — **4**.
- Число `pass 4 / fail 0` из `Q-36` в карточке не дублируется: стоит формула `pass / fail 0`, константа остаётся в шаге (один authority на факт).
- Совпадение фактов подтверждено обеими сторонами: `scripts/verify-package-invariants.ts` в MyWork нет (`Test-Path` → `False`), `tsx` — 0 из 54 манифестов, companion-модулей `invariant.ts` — 0; `npx tsx` в документе — **0**.

**Уточнение нумерации матрицы Q-47 (сообщение `team-message-23e49e3c`).** В `C-32` исправлена привязка: таблица «инвариант §59 → носитель проверки» принадлежит **`MW-074`** и соответствует в матрице `Q-47` строке **6** (`tests/invariants-runtime.test.mjs`); тестовой половине `MW-039`/`C-32` — строка **6а** (`tests/invariants.test.mjs`). Ранее в тексте таблица была ошибочно привязана к строке 6а, что переносило носителей инвариантов в тестовую приёмку. Константа `pass 4 / fail 0` остаётся только в шаге `Q-36`, в карточке — формула `pass / fail 0`.
