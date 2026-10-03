# MW-017 — Реализовать Skill Registry и Context Provider

- Статус: **DONE** — выставлен по прямому указанию владельца («изменить статусы, сделать коммиты»),
  а не по независимому ревью. Независимого review нет: карточка прямо запрещает запуск субагентов, поэтому
  ревьюер не запускался; отчёт описывает авторскую работу, и приёмка остаётся за владельцем.
- Base SHA: `bb3955b28c3e179959baf06878e6849e7e265fbe` (ветка `main`, дерево на старте чистое)
- Head SHA: `9163bb5923aaa0d71aff8af8f1bdedc191fc3661` — три коммита, по одному на слой:
  - `422320b` `feat(contracts): add the skill vocabulary, its lifecycle, and its registry ports`
    (`packages/contracts/src/skill.ts`, `packages/contracts/src/index.ts`);
  - `cf3a5c2` `feat(core): add the skill registry and its context provider`
    (`packages/core/src/skill.ts`, `packages/core/src/index.ts`);
  - `9163bb5` `test(skills): cover the scope, the pins, and the lazily served bodies` (`tests/skill.test.mjs`).
  Трейлер `Cards: MW-017.` во всех трёх; `git diff --name-only bb3955b..HEAD` — ровно 5 путей, чужих нет;
  `git diff --shortstat bb3955b..HEAD` — 5 files changed, 2540 insertions(+); после коммитов `git status` пуст.
- Отчёт `.work/reports/MW-017-skills.md` в коммиты не входит: `/.work/` исключён `.gitignore`, как и заявлено
  в `.work/README.md`. Коммиты и push выполнялись только по этому указанию владельца; push/merge/publish
  по-прежнему не делались.
- После первой редакции отчёта проведён критический аудит (§7): девять подтверждённых дефектов (D1…D9)
  исправлены, каждый — с тестом; §2–§5 описывают уже исправленное состояние.

## 1. Проверка зависимостей (MW-006, MW-016)

| Зависимость | Отчёт и его статус | Исходники | Коммиты | Вердикт |
|---|---|---|---|---|
| **MW-006** конфигурация/Team | `.work/reports/MW-006-team-config.md` — `READY_FOR_REVIEW`; независимое ревью **PASS WITH FINDINGS** (2 MAJOR / 3 MINOR / 2 NIT), находки исправлены и покрыты тестами | `packages/contracts/src/{config,team}.ts`, `packages/core/src/{config,team,graph}.ts` | `2bbb5d9`, `962f696`, `352e378`, `fbee7a0` | предусловие пройдено **с оговоркой** (см. §6) |
| **MW-016** Context Fabric | `.work/reports/MW-016-context-fabric.md` — **DONE** (статус выставлен прямым указанием владельца; формальной приёмки владельца нет) | `packages/contracts/src/context.ts`, `packages/core/src/context.ts`, `packages/adapter-sdk/src/testing.ts`, `tests/context.test.mjs` | `5035661`, `6b9815a`, `a3fc25f`, `9379860`, `bb3955b` | предусловие пройдено |

Проверено по исходникам, а не по статусу: на `bb3955b` присутствуют `ContextProviderPort`, `ContextCandidate`,
`ContextSnapshot.skillRevisions: Record<SkillId, Revision>` (§21.7), `materializeContextSnapshot` с параметром
`skillRevisions` и `verifyContextSnapshot`. Это и есть точка стыковки, в которую встаёт провайдер MW-017.

Оговорка: у MW-006 статус `READY_FOR_REVIEW`, и MW-016 прошёл поверх него в том же статусе, зафиксировав это
решение в своём отчёте §1. MW-017 продолжает ту же цепочку и **не** объявляет MW-006 принятым.

## 2. Сделано

### 2.1 Контракты §24 — `packages/contracts/src/skill.ts` (новый, 540 строк, 37 экспортов)

- `SkillStatus` = `candidate | active | stale | archived` + `SKILL_STATUSES`, `SERVED_SKILL_STATUSES`
  (единственное обслуживаемое состояние — `active`).
- `SkillMetadata` — список §24 (`name`, `description`, `scopes`, `version`, `trust`, `compatibility`) плюс
  `id`: **идентичность — `id`, а `name` — отображаемая метка**, которая может совпадать у двух разных скиллов
  (D4).
- `SkillDefinition extends SkillMetadata` — неизменяемая часть: `id`, `revision`, `usage`, `constraints`, `body`,
  `mediaType`, `estimatedTokens?`, `contentHash?`, `provenance`; закрытая форма (`SKILL_DEFINITION_FIELDS`).
  `id`/`revision`/`version` не могут содержать `:` — из них собирается адрес `skill:<id>:<revision>` (D6).
- `SkillRevisionState` — `status`, `validFrom?`, `validUntil?`, `servedCount`, `lastValidatedAt?`,
  `statusChangedAt`. **Статус вынесен из definition**: смена статуса не переименовывает ревизию, которую
  заморозил running Attempt (§24 + §35). `servedCount` — usage stats §24, их пишет путь обслуживания (D5);
  `lastValidatedAt` — момент, когда ревизия стала Active.
- `SkillRevision` = `{ id, definition, state, snapshotRevision, fingerprint }` — `snapshotRevision: number`
  из §35-семейства `skill`, ровно то, что кладётся в `ContextSnapshot.skillRevisions`.
- `SkillCompatibility` + чистая `skillCompatibilityHolds(compatibility, facts)` (§37): требуется и
  `contractVersion`, и объявленные capabilities; `adapterKind` без `contractVersion` — не «наверное подойдёт»,
  а `false`; необъявленная capability не считается истинной.
- `skillAppliesTo(scopes, requested)` — чистая проверка scope: пустой scope = везде, иначе точное совпадение
  `kind`+`id`.
- `SkillRefusalReason` для диагностики: `scope-mismatch`, `status-not-served`, `outside-validity`,
  `incompatible` (не тот contract version), `dependency-unmet` (capability не выдана) — два последних различимы
  и эмитятся оба (D7).
- `SkillRuntimeFacts` — **только наблюдения рантайма** (`contractVersions`, `capabilities`); поле `actors`
  убрано, потому что авторизацию оно не выполняло (D3).
- `SkillRegistryPort`, `SkillAdmissionInput`, `SkillTransitionInput`, `SkillServeInput`, `SkillAdmission`,
  `SkillTransition`, `SkillRefusal`, `SkillView`, `SkillDiscovery`, `SkillActivation`, `SkillFrozenRevisions`,
  `SkillRevisionRegistry`. Записи несут `meta: OperationMeta` (§9) и `actors`.

### 2.2 Ядро §24 — `packages/core/src/skill.ts` (новый, 1196 строк, 19 экспортов)

- `createSkillRevisionRegistry()` — нумерация §35-семейства `skill` по fingerprint, как
  `createContextSnapshotRevisionRegistry` в §21.
- `createSkillRegistry(options)`:
  - `admit` — принимает определения как **Candidate**; цепочка ключуется по `definition.id` (D4); идемпотентен
    (тот же definition → тот же номер §35), отказывает, если под тем же `revision` приходит другое определение,
    и требует §8-владельца (`assertWriteAuthority('skills.registry', 'skill-registry', meta)` + проверка
    `actors`).
  - `transition` — единственный путь к Active; адресует ревизию (`expectedRevision`), иначе ту, что
    обслуживается сейчас; хранит по одной записи на definition-revision (переход заменяет запись, а не
    добавляет вторую копию).
  - `recordServe` — считает обслуживание (§24 usage stats): меняет только state, §35-номер и fingerprint не
    двигаются, поэтому пиннинг не сдвигается (D5).
  - `admit`/`transition`/`recordServe` отвечают `Result`-подобным `{ ok, code, message }`, коды §42:
    `SECURITY_DENIED`, `TASK_CONFLICT`, `STALE_REVISION`, `CONTRACT_MISMATCH`, `CAPABILITY_UNSUPPORTED`.
  - `facts()` / `observeFacts()` — факты рантайма, против которых решается активация (§37).
- `checkSkillActivation(input)` — чистый гейт: `to === 'active'`; архивный скилл не оживляется; **вторую
  ревизию нельзя обслуживать, пока обслуживается первая** (`TASK_CONFLICT`); совместимость должна держаться
  (`CONTRACT_MISMATCH` для contract version, `CAPABILITY_UNSUPPORTED` для capability); окно валидности должно
  покрывать момент. Любой отказ оставляет статус как был.
- `serveRefusal(revision, { scopes?, nowMs, facts })` — **одно правило обслуживания** (§21.2, §24), которое
  спрашивают и discovery, и materialize (D1). `skillRequirementUnmet` выделяет причину несовместимости.
- `createSkillContextProvider(options)` → `ContextProviderPort` (§21.5, §36 `SkillProviderPort`):
  - опция `now?: () => number` — инъецируемый клок; `discover` и нетимированный `activation` берут его, и
    `provider.now()` отдаёт то же чтение вызывающему (D2);
  - `capabilities()` — `classes: ['skill']`, все уровни, `onDemandMaterialization: true`;
  - `discover()` — **только L0/L1, только метаданные**, тела нет; уровень задаётся `defaultLevel` (по умолчанию
    L1), попытка собрать провайдер с `defaultLevel: 'L2'` падает `TypeError`; каждая выданная ревизия
    засчитывается через `recordServe` (D5);
  - `materialize()` — тело только по запросу и только на L2, со сверкой `expectedRevision` и
    `expectedContentHash` **и с той же проверкой обслуживания, что у discovery** (D1): архив, выход из окна
    валидности или потерянная совместимость → отказ с кодом §42, а не тело; uri имеет вид `skill:<id>:<revision>`;
  - `activation()` — по каждому хранённому скиллу решение (served/причина) для диагностики; обслуживание не
    считает;
  - `skillRevisions(request)` — `Record<SkillId, Revision>` для `ContextSnapshot.skillRevisions`.
- Экспорт из `packages/core/src/index.ts` (21 строка) и `packages/contracts/src/index.ts` (+1).

## 3. Приёмка карточки → чем доказано

| Требование | Чем доказано (тест в `tests/skill.test.mjs`) |
|---|---|
| scope | `discovery serves only Active skills, and says why each other one was left out` (scope `w1` против `w9`, причина `scope-mismatch`, требование другого workspace = `[]`) |
| version pinning | `a revised definition is a new revision, and the frozen one still answers`, `a transition names the revision it moves…`, `the fabric freezes one numeric skill revision per skill…`; в `materialize` — сверка `expectedRevision`/`expectedContentHash` |
| lazy loading | `discovery discloses scope, metadata, and no body` (в кандидате нет тела, L0 без `usage:`), `a body is served only by materialization, and only at L2`, `a skill the fabric asks for at L2 arrives as the body, and one it does not stays an overview` |
| неподдерживаемый skill не активируется | `an unsupported skill never activates, and one that is supported does` (`CONTRACT_MISMATCH`, статус остаётся `candidate`), `a requirement the runtime does not declare is not assumed to hold` (`CAPABILITY_UNSUPPORTED`), плюс D1-тесты ниже: тело несовместимого/архивного скилла не выдаётся |
| обновление не меняет running Attempt | `an update does not move a running attempt: its frozen revisions and body stay put` (`frozen.skillRevisions == {testing: 1}` после перехода на r2; следующий snapshot — `{testing: 2}` и другой `revision`; `verifyContextSnapshot` по r1 = `intact`) |
| memory records ≠ skills | `the memory provider cannot write the skill registry` (actor `memory-provider` → `SECURITY_DENIED`, реестр пуст), `a memory record never becomes a skill candidate` (memory-кандидат от FakeContextProvider остаётся класса `memory`, провайдер скиллов его не отдаёт, в `skillRevisions` только реестр) |
| lifecycle Candidate/Active/Stale/Archived | `the §24 lifecycle admits only the moves it declares`, `a lifecycle transition does not rename the revision a caller pinned`, `a second revision cannot be served while one already is` |
| Discover L0/L1, body по materialize | `discovery discloses…`, `a body is served only by materialization…` |
| Связь с Fabric | `the fabric freezes one numeric skill revision per skill…`, `an untrusted skill is context the fabric renders as data…`, `the §35 skill revision numbers are shared by the summary and the body` (через `discoverContext` + `materializeContextSnapshot` + `assembleContextPrompt`) |
| D1: обслуживание — одно правило | `a skill retired between discovery and the fetch hands over no body` (и снапшот Fabric отказывает), `a skill that lost its compatibility hands over no body either`, `a skill that left its validity window hands over no body` |
| D2: время воспроизводимо | `a skill outside its validity window is not served, and discovery sees the same window` (клок вне окна → `discover` и `skillRevisions` пусты; внутри → ревизия совпадает с `provider.now()`) |
| D4: идентичность — `id` | `a name is a label, not an identity: two skills may share one` |
| D5: usage stats | `a serve is counted, and counting it moves no pin` |
| D6: адресуемость | `an id or a revision that cannot be addressed in a uri is refused at admission` |
| D7: различимые причины | `an unsupported skill never activates…` (`CONTRACT_MISMATCH`), `a requirement the runtime does not declare…` (`CAPABILITY_UNSUPPORTED`) |

## 4. Команды и exit codes

Все команды — из корня `H:\Repo\DSH-MyWork`; сборка/типизация вызывались локальными бинарями
(`node_modules/.bin/tsc.cmd`, `tsdown.cmd`), потому что `pnpm run build` в этой песочнице падает на создании
своего временного каталога (`os error 5`, отказ в доступе) — это ограничение среды, а не дефект дерева.

| Команда | Exit | Наблюдение |
|---|---|---|
| `git status --short` / `git rev-parse HEAD` (старт) | 0 | дерево чистое, `bb3955b28c3e179959baf06878e6849e7e265fbe` |
| `node --test --test-isolation=none "tests/**/*.test.mjs"` (baseline до правок) | 0 | 546 tests / 523 pass / 0 fail / 23 skipped |
| `tsc --noEmit -p tsconfig.json` × 11 пакетов | 0 ×11 | `TSC_FAILED=0` |
| `tsdown` × 11 пакетов | 0 ×11 | `BUILD_FAILED=0` |
| `node scripts/smoke.mjs` | 0 | `smoke: all steps passed` |
| `node --test --test-isolation=none tests/skill.test.mjs` | 0 | **28 tests / 28 pass / 0 fail** |
| `node --test --test-isolation=none "tests/**/*.test.mjs"` (после правок и после аудита) | 0 | **574 tests / 551 pass / 0 fail / 23 skipped** (baseline 546/523/0/23) |
| `git add <файлы слоя> && git commit -F .tmp/mw017-msg-N.txt` (3 коммита) | 0 ×3 | `422320b`, `cf3a5c2`, `9163bb5`; трейлер `Cards: MW-017.` во всех; после каждого `git status` чист |
| `git log --oneline -3 --name-only` | 0 | в каждом коммите только файлы своего слоя, чужих нет |
| `git diff --name-only bb3955b..HEAD` / `--shortstat` | 0 | ровно 5 путей; 5 files changed, 2540 insertions(+) |
| `tsc` × 11 пакетов, `smoke`, полный `node --test` на закоммиченном `9163bb5` | 0 | `TSC_FAILED=0`, `smoke: all steps passed`, **574 / 551 / 0 / 23**, `git status` пуст |
| `git diff --numstat` | 0 | `packages/contracts/src/index.ts` +1, `packages/core/src/index.ts` +21, чужих файлов нет |

### 4.1 Мутационные проверки (что тесты умеют падать)

Делались на **исходнике** `packages/core/src/skill.ts`; перед каждой мутацией файл побайтово копировался в
`.tmp/`, после — восстанавливался, хеш сверялся, пакет пересобирался. Пробники и бэкапы удалены.

| # | Мутация | Fail | Кто ловит |
|---|---|---|---|
| 1 | тело скилла примешивается к тексту кандидата | **2** | `discovery discloses … no body`, `an untrusted skill …` |
| 2 | снята сверка `expectedRevision` в `materialize` | **1** | `a body is served only by materialization, and only at L2` |
| 3 | снят гейт совместимости перед активацией | **2** | `an unsupported skill never activates…`, `a requirement the runtime does not declare…` |
| 4 (аудит) | снята serve-проверка в `materialize` (D1) | **3** | `a skill retired between discovery and the fetch…`, `a skill that lost its compatibility…`, `a skill that left its validity window…` |

Мутация 4 делалась на исправленном источнике (SHA-256 до мутации `DCF9971D…`, он же после восстановления).
После восстановления и пересборки: 574/551/0, `smoke: all steps passed`, `git status` — те же 5 путей; на
закоммиченном `9163bb5` прогон повторён с тем же результатом.

## 5. Изменённые файлы

| Путь | Состояние | Строк | Коммит | SHA-256 |
|---|---|---|---|---|
| `packages/contracts/src/skill.ts` | новый | 540 | `422320b` | `F75C5F917EBC8068A2917B7275B79B2AD803DF1F5A71B094EE4650F14F02D533` |
| `packages/contracts/src/index.ts` | изменён (+1) | — | `422320b` | — |
| `packages/core/src/skill.ts` | новый | 1196 | `cf3a5c2` | `DCF9971DCE224E437ECE01875FA81C6388FF7103441DF15879021E70B6846960` |
| `packages/core/src/index.ts` | изменён (+21) | — | `cf3a5c2` | — |
| `tests/skill.test.mjs` | новый | 782 (28 тестов) | `9163bb5` | `DD002C2838893F2F169F62D96B73D654B64384541AF2A60AD7F41472489FD975` |
| `.work/reports/MW-017-skills.md` | отчёт | — | не коммитится (`/.work/` в `.gitignore`) | — |

`packages/*/lib/` — артефакты сборки, gitignored (`.gitignore:14`), в diff не входят. Временные пробы,
бэкапы источника и файлы сообщений коммитов (`.tmp/mw017-*`) удалены; `.tmp/` gitignored и не относится к
карточке.

## 6. Ограничения и что осталось непроверенным

1. **Независимого review нет.** Карточка запрещает субагентов, поэтому ревьюер не запускался; §62 item 20
   покрыт автором. Статус `DONE` выставлен указанием владельца, а не по результату ревью: приёмка остаётся
   за владельцем, и отчёт не заменяет независимую проверку.
2. **MW-006 остаётся `READY_FOR_REVIEW`**; MW-017 идёт поверх него, как MW-016 и MW-013 до него. Если владелец
   считает «принято» синонимом «приёмка зафиксирована», правильное действие — `BLOCKED`, и это решение
   владельца, а не вывод автора.
3. **Транзиции не персистентны и не идемпотентны по operationId.** Реестр — in-memory, как
   `createContextSnapshotRevisionRegistry`; §35-номера живут в процессе, а `fingerprint` — то, с чем
   сравнивается сохранённый скилл. Долговечное хранилище скиллов, журнал переходов и replay по `operationId`
   в объём MW-017 не входят (в других карточках тоже не заявлены — если это нужно, это отдельное решение).
4. **`SkillProviderPort` объявлен контрактом, но adapter-kind `skill-provider` пока никем не реализован** как
   адаптер: `createSkillContextProvider` — это реализация `ContextProviderPort` внутри ядра, а не внешний
   адаптер. Регистрация в §44-реестре адаптеров и conformance-набор для него не делались.
5. **Две ревизии одного скилла не могут обслуживаться одновременно** (`TASK_CONFLICT` при активации второй).
   Обратная сторона — чтобы включить новую ревизию, её предшественницу нужно сначала перевести из `active`
   (`stale`/`archived`). Это добавленное мной правило, а не цитата §24; названо здесь, чтобы ревьюер мог его
   оспорить.
6. **Не проверено живой моделью:** ни один LLM/provider-вызов не делался (карточка запрещает платные пробы);
   свойство «обновление не меняет running Attempt» доказано на снапшотах и ревизиях, а не на реальном прогоне
   агента.
7. **`stale` не выставляется автоматически.** Дрейф совместимости (`observeFacts` с новым contract version)
   делает скилл необслуживаемым и видимым в `activation()` как `incompatible`, но `state.status` остаётся
   `active`: автоперевод в `stale` — действие оптимизатора/куратора (MW-032/033, не эта карточка). Практическое
   следствие названо честно: читатель, смотрящий только на статус, не увидит, что скилл больше не подаётся.
8. **Memory→skill:** отказ обеспечивается владением домена `skills.registry` (§8) и не даёт никакого пути от
   recall к скиллу автоматически. Явный, авторизованный промоушен memory-кандидата в скилл (fast learner,
   §25.2) не реализован — это MW-032; в интерфейсе реестра намеренно нет метода «взять memory record и вернуть
   скилл».
9. **`.work/EXECUTION-PLAN.md` не менялся:** строка `MW-009…MW-055 — не начаты` уже расходится с деревом
   (MW-009…MW-016 закоммичены), но это состояние досталось карточке и правка плана — не её объём.
10. **Альтернатива для D2 не реализована.** Единый источник времени обеспечен инъекцией клока в провайдер
    (`now`), но `discoverContext` по-прежнему не передаёт своё `nowMs` внутрь `ContextDiscoveryRequest`, так что
    вызывающий обязан сам согласовать время прохода и `skillRevisions` (для этого и есть `provider.now()`).
    Передача времени в запрос — изменение публичного контракта §21.5 в `packages/core/src/context.ts`, то есть
    чужая карточка (MW-016); здесь она не делалась.

## 7. Критический аудит после первой редакции

Аудит проводился на исправляемом дереве: каждый пункт подтверждён прогоном (пробники в `.tmp/`, удалены), а не
рассуждением. Ниже — что было, чем подтверждалось и что стало.

| # | Severity | Дефект и наблюдение | Что сделано |
|---|---|---|---|
| D1 | BLOCKER | `materialize` отдавал тело скилла, снятого с обслуживания: `F materialize of ARCHIVED skill = SUCCEEDED`, `N2 fabric materialization after the skill was archived = materialized` с телом в снапшоте; после `observeFacts` с другим contract version — `O3 served after the adapter contract moved = 0`, но `materialize = "BODY"`. То есть §24 «обслуживается только Active» держался для предложения и не держался для содержимого | Общий предикат `serveRefusal` для `discover` и `materialize`; отказ приходит кодом §42 и Fabric превращает его в `materialization-failed` |
| D2 | MAJOR | `discover` брал `Date.now()`, а путь admission — инъецированное `nowMs`: `B activation(nowMs=1500).served = 1` при `B discover() candidates = 0`; обратный случай давал снапшот с item без записи ревизии (`snapshot skill items = ["skill:testing:r1"]` при `snapshot.skillRevisions = {}`). Собственные тесты это не ловили: из двух тестов с окном валидности ни один не вызывал `discover` | Опция `now` и `provider.now()`; тест проверяет окно и совпадение прохода с замороженными ревизиями |
| D3 | MAJOR | `SkillRuntimeFacts.actors` объявлен «for the write gate», но не использовался: `C transition by actor not in options.actors but listed in facts.actors = false SECURITY_DENIED` — поле обещало авторизацию и не давало её | Поле удалено; документация говорит, что авторизация — это список акторов реестра, а facts — наблюдения рантайма |
| D4 | MAJOR | Идентичность скилла — `name`, цепочки сливались по имени: `K unrelated skill under the same name = true`, затем `K activate the unrelated r9 = true` — второй, чужой скилл становился ревизией первого | `SkillDefinition.id` обязателен и ключует цепочку; `name` — метка; тест на два скилла с одним именем |
| D5 | MINOR/MAJOR | `servedCount` никогда не инкрементировался: `A servedCount after 50 served passes = 0`, а отчёт называл usage stats §24 реализованными | `recordServe` + вызов с пути обслуживания; `activation()`/`skillRevisions()` не считают; тест фиксирует и счётчик, и неизменность §35-номера |
| D6 | MINOR | uri ломался на `:`: `H candidate uri = "skill:testing:v1:beta"` → `materialize failed: the registry holds no revision "beta" of skill "testing:v1"` | `:` запрещён в `id`, `revision`, `version` при приёме, с сообщением про адресацию |
| D7 | MINOR | Сообщения вводили в заблуждение: `does not declare "smuggled"` (перевёрнуто), `L … "with another body"` при одинаковом теле и другой `description`; `CAPABILITY_UNSUPPORTED` схлопывал contract mismatch и невыданную capability, а `dependency-unmet` не эмитился | Формулировки исправлены; `CONTRACT_MISMATCH` и `CAPABILITY_UNSUPPORTED` различимы, `dependency-unmet` эмитится |
| D8 | NIT | `attributes` кандидата Fabric всё равно отбрасывал: `I snapshot item keys = …` без `attributes`, `I attributes in snapshot item = undefined` | Поле убрано; тест сверяет набор полей кандидата |
| D9 | NIT | `parseSkillUri` возвращал `level`, который никто не читал | Убрано |

Что аудит проверил и оставил без изменений: порядок отказов гейта, `archived` как терминальное состояние, запрет
двух обслуживаемых ревизий, отказ при том же `revision` с другим определением, идемпотентность приёма и
нумерация §35, раздельные оценки токенов кандидата и тела, поведение L0-провайдера, отдающего L2 по запросу
(§21.2).
