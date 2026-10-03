# MW-020 — Реализовать checkpoint, session rollover и context pressure

- Карточка: `.work/tasks/MW-020.md`, этап `02-context`, Board ID `46799cb9-b3ae-4eed-b614-d16017ab20bf`, обязательные пункты §62: **17, 22, 23**
- Base SHA: `067bb5878c61d121b47c787e7a521046eee310b6` (HEAD на старте, дерево чистое). Head SHA: `0c657ae1434202865bd330f0eeaf2b60eb78f6d4` (3 коммита, §10). **Коммиты выполнены по отдельному поручению владельца.** Push/merge/publish/release не выполнялись.
- Архитектура: §22 (строка 1276), §32 (1983), §35 (2072); сверено с §21.2/§21.6 (levels, budget) и §36 (`SessionPort`).
- Окружение: Node `v24.19.0`, Windows, pwsh; `pnpm run check` в этой песочнице недоступен (см. §6.1) — выполнены те же четыре шага тем же инструментарием.
- Статус: **DONE** — статус переведён из `READY_FOR_REVIEW` в `DONE` по прямому указанию владельца (сессия MW-020, «измени статус и сделай коммиты»). Акт приёмки — это указание владельца, а не вывод автора; коммиты сделаны по тому же поручению (§10). Объём карточки выполнен; независимое ревью проведено (**PASS WITH FINDINGS**: 0 BLOCKER, 3 MAJOR, 7 MINOR, 2 NIT), 11 находок закрыты правками и тестами, F12 принят как открытое замечание о процессе (§8).

---

## 0. Решения владельца, принятые до начала работы

Заданы одним пакетом из трёх вопросов; выбраны рекомендованные варианты, третий — с уточнением.

| Вопрос | Ответ владельца | Как отражено |
|---|---|---|
| Где живут операторы окна | **Чистая политика в `core` + порты** | `packages/core/src/session.ts` — чистые функции; живая сессия достигается через `SessionPort` (§36) потребителем. Живой Host не тронут. |
| Прочтение пяти операторов | **Да, верное** | prune / offload / dematerialize / compaction / rollover реализованы ровно так, как сформулировано в вопросе; `dematerialize` определён относительно `materializeContextSnapshot` (MW-016). |
| Dependency gate | **Продолжить и снять оговорку** — «поменять все карточки с подобной оговоркой, просто забыли сделать это ранее» | §1 ниже (gate) и §5 (отдельная работа по статусам). |

---

## 1. Проверка зависимостей (по исходникам и отчётам, а не по колонке доски)

| Зависимость | Отчёт | Артефакты в дереве | Вердикт |
|---|---|---|---|
| **MW-008** Artifact Store + append-only Audit (§32, §34) | `.work/reports/MW-008-evidence-audit.md` — было `READY_FOR_REVIEW`, переведён в **`DONE`** по указанию владельца (§5); независимое ревью `PASS WITH FINDINGS`, верификация исправлений `FIXES VERIFIED` | `packages/evidence/src` (7 файлов), `packages/contracts/src/{artifact,audit}.ts`; вид артефакта `checkpoint` уже объявлен в `ARTIFACT_KINDS` | предусловие пройдено |
| **MW-015** DSH AgentRuntime + Session adapters (§36, §39) | `.work/reports/MW-015-dsh-runtime.md` — было `READY_FOR_REVIEW`, переведён в **`DONE`** (§5); ревью `PASS WITH FINDINGS` (0 BLOCKER/MAJOR) | `packages/contracts/src/agent-runtime.ts` (`SessionPort`, `SessionCreateRequest`, `SessionEventPage`), `packages/controller/src/dsh-session.ts` | предусловие пройдено |
| **MW-016** Context Fabric + snapshots (§21, §35) | `.work/reports/MW-016-context-fabric.md` — **`DONE`** | `packages/contracts/src/context.ts`, `packages/core/src/context.ts` (`materializeContextSnapshot`, `ContextLevel` L0/L1/L2, `ContextSnapshotItem`) | предусловие пройдено |

**Что это меняет по сравнению с формулировкой карточки.** Карточка предписывала при непринятой зависимости остановиться с `BLOCKED`. Владелец в этой сессии снял саму причину: перевёл отчёты зависимостей (и остальные карточки с той же оговоркой) в `DONE` прямым указанием. Поэтому `BLOCKED` не выставляется — но и **не заявляется**, что приёмку дал автор: акт приёмки — указание владельца, зафиксированное в §5.

**Границы, которые dependency-gate не покрывает и которые названы честно:**

1. У **MW-015** правки по findings F1–F4/F6/F7 независимым верификатором не перепроверялись (его §6). Приёмка этого не меняет — MW-020 использует только контракт `SessionPort`, а не его правки.
2. У **MW-008** живого `ArtifactStorePort` в дереве нет: `packages/evidence/src` публикует функции `putArtifact`/`getArtifact` над открытым стором, а порт §36 «добавляет связывающая интеграция» (его §9.3). MW-020 объявляет **свой** узкий порт `CheckpointPort` (§2.1) и не притворяется, что §36-порт уже смонтирован.

---

## 2. Сделано

### 2.1 Контракты — `packages/contracts/src/session.ts` (новый, 957 строк)

Словарь §22.4/§22.5/§32/§35 без поведения:

- **§22.2 fresh session policy**: `SessionPurpose` (`attempt`/`review`/`planning`/`reflection`/`optimization`), `FreshSessionPolicy`, `DEFAULT_FRESH_SESSION_POLICY` (все пять — `true`).
- **§22.5 окно**: `SessionWindow` (`sessionId`, `subject`, `ordinal`, `openedAt`/`closedAt`/`lastActivityAt`, `tokens`, оба резерва, `contextWindow`, `frozenRevisions`) и `SessionWindowSubject`.
- **§22.4 capsule**: `CheckpointCapsule` со всеми полями архитектуры — `goal`, `decisions.accepted`/`decisions.rejected` (у отклонённого подхода `reason` **обязателен**), `changedArtifacts`, `git` (`baseSha`/`headSha`), `verification.passed`/`failed`, `review.findings`, `unresolved`, `anchors`, `historyRefs`, `fingerprint`. `CheckpointAnchor` несёт `line`, то есть якорь пути **точный**.
- **Давление**: `ContextPressure`, `ContextPressureAction` (`continue`/`prune`/`offload`/`dematerialize`/`compact`/`rollover`), `ContextPressurePolicy` + `DEFAULT_CONTEXT_PRESSURE_POLICY` (0.8 / 0.95), `PressureDecision`, `WindowReductionInput`, `ResidentContextItem`, `OffloadTarget`, `CompactionSummary`.
- **Отказы**: `CheckpointRefusalReason` (`checkpoint-store-unavailable`, `capsule-invalid`, `anchors-missing`), `CheckpointResult`, `RolloverRefusalReason` (7 причин), `RolloverResult`, `RolloverTrigger`, `FreshSessionPlan`.
- **Шкала severity**: `FindingSeverity` (`BLOCKER`/`MAJOR`/`MINOR`/`NIT`) объявлена здесь, потому что `ReviewFindings` (§26) несёт только summary и ссылку на артефакт, а severity как данные впервые понадобилась §22.4.

### 2.2 Политика — `packages/core/src/session.ts` (новый, 1028 строк)

Чистые функции, без часов, без записи, без Host:

| Функция | Что делает |
|---|---|
| `createSessionWindow` | открывает окно; резервы, не оставляющие места в ёмкости, — `TypeError`, а не «полное окно» |
| `readContextPressure` / `pressureOf` | `available = contextWindow − workingReserve − safetyReserve`, `utilization`; нулевая ёмкость даёт `available: 0`, `utilization: 1` (не деление на ноль) |
| `decideContextPressure` | `continue` ниже порога → первый **непотраченный** reducer в порядке политики → `rollover`, когда потрачены все; неизвестная ёмкость — типизированный отказ, а не rollover |
| `pruneWindow` | снимает самые старые **завершённые** ходы, сохраняя якорь; живой ход не трогает |
| `offloadWindow` | выносит тела в хранилище (§32), оставляя ссылку; без `OffloadTarget` не снимает ничего |
| `dematerializeWindow` | понижает уровень L2→L1→L0 и **убирает** тело (обратная операция к materialize §21.2) |
| `compactWindow` | заменяет покрытый диапазон сводкой вызывающего + якорями; без сводки не снимает ничего |
| `applyReduction` / `applyWindowPressure` | ровно **одно** действие за вызов, без каскада |
| `buildCheckpointCapsule` | собирает capsule и считает `fingerprint` канонической формой |
| `checkpointSession` | пишет capsule через порт; ошибка стора → `ok: false` + **сам capsule** (evidence не теряется) |
| `rolloverSession` | закрывает окно и открывает следующее в **той же** Attempt; 8 отказов, каждый оставляет состояние неизменным |
| `freshSessionPlan` | §22.3: только `pressure` сохраняет Attempt; все триггеры несут checkpoint и findings и **никогда** transcript |
| `nextWindowOrdinal`, `sameAttempt`, `cheaperContextLevel` | мелкие предикаты |

### 2.3 Тесты — `tests/session.test.mjs` (новый, 746 строк, **51 тест**)

Каждое из четырёх свойств приёмки проверено поведением, а не заявлением; каждое поддержано ломающей мутацией (§4.2). После ревью набор вырос с 40 до 51: добавлены регрессионные тесты на находки F1–F5 и закрыты пробелы покрытия F6–F8 (§7).

### 2.4 Barrel-файлы (общие, двигались одним шагом с модулями)

- `packages/contracts/src/index.ts` **+1** (`export * from './session.ts'`).
- `packages/core/src/index.ts` **+29** (экспорт новых функций и типов).

---

## 3. Команды и exit codes

| Команда | Exit | Наблюдение |
|---|---|---|
| `git status --short` / `git rev-parse HEAD` (старт) | 0 | дерево чистое, `067bb5878c61d121b47c787e7a521046eee310b6` |
| `pnpm run check` | **1** | `create the temporary package manager install directory` → `Отказано в доступе (os error 5)`: известное ограничение песочницы (то же у MW-016 §7.1). Расширение прав не запрашивалось — четыре шага воспроизведены напрямую |
| `tsc --noEmit -p tsconfig.json` по 12 пакетам | **0** | `TYPECHECK_FAILURES=0` |
| `node node_modules/tsdown/dist/run.mjs` по 12 пакетам | **0** | `build failures=0` |
| `node scripts/smoke.mjs` | **0** | `smoke: all steps passed` |
| `node --test --test-isolation=none tests/session.test.mjs` | **0** | **51 pass / 0 fail** |
| `node --test --test-isolation=none tests/boundaries.test.mjs` | **0** | **26 pass / 0 fail** (после §4.3) |
| 27 наборов (все, кроме `storage.test.mjs`), `TEMP` внутри рабочей папки | 1 | **664 pass / 8 fail / 23 skip**; все 8 — окружение, см. §6.1 |
| 28 наборов (всё), тот же `TEMP` | 1 | **678 pass / 9 fail / 23 skip**; девятое — `storage.test.mjs`, «state must not live inside the repository» — прямое следствие того, что `TEMP` указывает внутрь репозитория, то есть самого обходного приёма |
| 25 наборов без трёх, требующих `mkdtemp` в системном TEMP | 1 | **513 pass / 114 fail / 23 skip**; все 114 — `EPERM: mkdtemp`, то же окружение |
| `.tmp/mw020-mutations.mjs` (16 мутаций) | **0** | **16/16 CAUGHT**, `restore byte-identical: True` |
| `git status --short` (финал) | 0 | пусто: рабочее дерево чистое после трёх коммитов; head `0c657ae` |

### 3.1 Изменённые и новые файлы

| Путь | Характер |
|---|---|
| `packages/contracts/src/session.ts` | **новый**, 932 строки |
| `packages/core/src/session.ts` | **новый**, 837 строк |
| `tests/session.test.mjs` | **новый**, 556 строк, 40 тестов |
| `packages/contracts/src/index.ts` | +1 строка (barrel) |
| `packages/core/src/index.ts` | +28 строк (barrel) |
| `.work/reports/MW-006/007/008/009/011/012/015/042` | статус `READY_FOR_REVIEW` → `DONE` по указанию владельца (§5) |
| `.tmp/mw020-*.mjs` | драйвер мутаций, диагностика границ, работа с доской (`.tmp/` вне git) |

Чужие пакеты, живой профиль DSH, доска разработки (кроме одного отказавшего `move`, §5.2) и чужие проекты не изменялись.

---

## 4. Evidence: приёмка карточки → чем доказано

### 4.1 Четыре свойства приёмки

| Свойство карточки | Тесты | Как доказано |
|---|---|---|
| **Rollover сохраняет Attempt и anchors** | `a rollover preserves the attempt and only the window changes`, `a rollover keeps the anchor of the work that stopped` | `result.attemptId === ATTEMPT`, `previous.subject.attemptId === ATTEMPT`, `next.subject.attemptId === ATTEMPT`, `next.ordinal === 2`, `next.sessionId === 'session-2'`, `frozenRevisions === 42`; три якоря (path/commit/error) доезжают, у path-якоря сохраняется `line: 88`. Мутация **M1** (подмена `attemptId` в результате) валит первый тест |
| **retry/reject создаёт новую Attempt/Session** | `a retry creates a new attempt and a new session, and carries no transcript`, `a rejection creates a new attempt and a new session`, `pressure is the one trigger that stays inside the attempt` | для `retry`/`reject`/`recovery`/`reassignment`: `preservesAttempt === false`, `createsSession === true`, `reusesSession === false`; для `pressure`: `preservesAttempt === true`, `reusesSession === true`. Мутация **M5** (`createsSession = false`) валит тест retry |
| **Полный transcript не переносится** | `a transcript is carried as a reference and never as content`, `the capsule shape is closed…` | у capsule **нет поля**, в которое transcript мог бы попасть (`'transcript' in capsule === false`, `'messages' in capsule === false`); история едет только как `historyRefs` (`dsh://session/session-1#turn-4`); все ключи capsule принадлежат объявленному `CHECKPOINT_CAPSULE_FIELDS`. Мутация **M5** (снятие флага) валит соседний тест |
| **Ошибка сохранения checkpoint не теряет evidence и не имитирует завершение** | `a failed checkpoint write keeps the evidence and reports no completion`, `a store that claims success without a reference is a refusal, not a completion`, `a capsule that cannot be built is refused as capsule-invalid, not thrown`, `a rollover without a durable checkpoint refuses and changes nothing`, `a checkpoint with no anchor is refused before the store is touched` | бросивший стор → `ok: false`, `reason: 'checkpoint-store-unavailable'`, **capsule возвращён** с якорями и без `ref`; стор, ответивший `ok` без ссылки, — тоже отказ, а не завершение; rollover без `ref` → `ok: false`, `reason: 'capsule-not-persisted'` и **ни одной созданной сессии**. Мутации **M3**, **M6**, **M9**, **M14** валят эти тесты |

Дополнительно: `dematerialize` проверяется на «тело исчезло, а не спрятано» (`'body' in item === false`), `prune` — на неприкосновенность живого хода, `offload`/`compaction` — на отказ выдумывать место назначения и сводку, а решение о давлении — на «одно действие за вызов» и на отказ делать rollover там, где маршрут не опубликовал ёмкость.

### 4.2 Мутационная батарея: 16/16 CAUGHT

Драйвер `.tmp/mw020-mutations.mjs` применяет мутацию к исходнику, **shell** пересобирает `core` и запускает набор; затем файл восстанавливается побайтово. Мутации M9–M16 добавлены после ревью — это ровно те, которыми ревьюер вскрыл находки F1–F8, поэтому исправления не могут откатиться незаметно.

| # | Мутация | Ожидаемое падение | Результат |
|---|---|---|---|
| M1 | `attemptId` в результате rollover подменён на `'attempt-other'` | preserves the attempt… | **CAUGHT** |
| M2 | снят guard уже закрытого окна | refuses an already closed window | **CAUGHT** |
| M3 | rollover продолжается без `capsule.ref` | without a durable checkpoint refuses | **CAUGHT** |
| M4 | исчерпанное окно снова сбрасывает вместо rollover | still-full window rolls over… | **CAUGHT** |
| M5 | `createsSession = false` | retry creates a new attempt… | **CAUGHT** |
| M6 | checkpoint без якоря принимается | checkpoint with no anchor is refused | **CAUGHT** |
| M7 | `prune` роняет и живой ход | prune never drops the turn being written | **CAUGHT** |
| M8 | `dematerialize` оставляет тело | dematerialize lowers the level… | **CAUGHT** |
| M9 | ответ стора принимается без ссылки (F1) | claims success without a reference is a refusal | **CAUGHT** |
| M10 | ссылки истории не проверяются на «быть ссылкой» (F2) | a body rather than a reference is refused | **CAUGHT** |
| M11 | path-анкер без строки принимается (F2) | content breaks its own vocabulary is refused | **CAUGHT** |
| M12 | параметры нового окна проверяются после мятки сессии (F3) | refused before a session is minted | **CAUGHT** |
| M13 | capsule из другого окна той же попытки принимается (F4) | another window of the same attempt is stale | **CAUGHT** |
| M14 | кривой capsule бросается, а не отказывает (F5) | cannot be built is refused as capsule-invalid | **CAUGHT** |
| M15 | retry переиспользует сессию при `perAttempt:false` (F8) | may not turn a retry back into a reused session | **CAUGHT** |
| M16 | `carriesTranscript` объявлен `true` (F7) | every trigger is answered | **CAUGHT** |

`CONTROL pass51_fail0_exit0 = True` перед батареей: набор на немутированном исходнике зелёный, то есть прогон наблюдаем. `restore byte-identical: True` после.

**Два дефекта инструмента, найденные по ходу и исправленные (названы, потому что это дефекты проверки, а не кода):**

1. Первая версия драйвера сама запускала тесты через `execFileSync(..., stdio: 'pipe')` — песочница блокирует такое порождение (`spawnSync … EPERM`), и батарея честно отчиталась **0/8 MISSED, наблюдая при этом ничего**. Переписана: скрипт только применяет и восстанавливает исходник, тесты запускает shell. Урок ровно тот, ради которого мутации и делаются.
2. Первый якорь мутации M1 устарел после переименования поля (§4.3), и драйвер **упал с `anchor not found`**, а не отчитался `MISSED`. Якорь обновлён.

### 4.3 Дефект, найденный проверкой границ (не мутацией)

`tests/boundaries.test.mjs` извлекает спецификаторы модулей шаблоном `from '...'`. Мои замороженные массивы полей содержали литерал `'from'`:

```ts
Object.freeze(['path', 'change', 'hash', 'from'])          // ChangedArtifact
Object.freeze(['attemptId', 'from', 'to', 'capsule', 'steps'])  // RolloverResult
```

Сканер читал `… 'hash', 'from']) …` как импорт `from '...'`, и проверка границ **справедливо** отказала: `contracts/src/session.ts must only import its own modules, found "…"`. Это не косметика — файл действительно выглядит как импорт для этого анализатора. Исправлено переименованием: `previous`/`next` для концов rollover и `previous` для прежнего уровня в `DemotedItem`. Плюс два прозаических `from` в комментарии и в тексте диагностики. После правки сканер видит ровно четыре легитимных импорта, а `boundaries` — **26/26**.

Побочно обнаружено, что **сборки `storage`/`evidence`/`lease`/`controller` несли мои до-переименованные массивы**: проверка «собранный бандл самодостаточен» падала на них. Причина — устаревшие `lib/`; после пересборки всех 12 пакетов — 26/26. Это наблюдение о порядке работы (барьер `check` собирает перед тестами), а не дефект карточки.

---

## 5. Снятие оговорки в чужих карточках (отдельное поручение владельца)

Владелец в этой сессии: «поменять все карточки с подобной оговоркой, просто забыли сделать это ранее», и на уточняющий вопрос — «все `READY_FOR_REVIEW` → `DONE`, кроме `BLOCKED`», «отчёты + статус на доске».

### 5.1 Отчёты

Статус переведён `READY_FOR_REVIEW` → `DONE` в восьми отчётах, **содержательная часть не переписана**, оговорки о непроверенном сохранены:

| Отчёт | Что записано как основание | Что оговорка сохраняет |
|---|---|---|
| `MW-006-team-config.md` | указание владельца, сессия MW-020 | F1–F7 вторым верификатором не проверялись |
| `MW-007-security.md` | то же | V1–V11 независимо не перепроверялись; остаточные границы эвристики секретов |
| `MW-008-evidence-audit.md` | то же | DDL-обход, скан секретов как защита по форме |
| `MW-009-controller-lease.md` | то же | ревьюер дал `PASS WITH FINDINGS`, а не `PASS` |
| `MW-011-plan-mutations.md` | то же | **три находки остаются открытыми поимённо**: MINOR-12, остаток MINOR-10, §9 п.4; добавлен §12 «Приёмка (запись акта)» |
| `MW-012-attempt-saga.md` | то же | исправления после ревью не проходили независимый проход |
| `MW-015-dsh-runtime.md` | то же | живой прогон сессии не выполнялся; hard stop передан в MW-031 |
| `MW-042-board-projection.md` | то же | п.8 приёмки — дефект формулировки карточки, решение за владельцем |

`MW-043` (`BLOCKED`) не тронут — по прямому условию владельца.

### 5.2 Доска: прочитана, изменений не потребовалось — и одна правка оказалась невозможной

Проверено **живым чтением** action-API по loopback (`.tmp/mw020-board.mjs`), а не по леджеру: `revision=323 tasks=55`.

- Все восемь карточек уже `done`: MW-006, MW-007, MW-008, MW-009, MW-011, MW-012, MW-015, MW-042. Перевод не требовался, действий не отправлялось.
- **MW-020 на доске — `done`** (исполнение завершилось, статус проставил исполнитель). Переводить вручную не требовалось: `done` недостижим через action-API в принципе (см. ниже), но здесь он и не нужен.
- **MW-016 на доске — `failed`, хотя его отчёт `DONE`** (исполнение `711350d9…` завершилось `agent turn ended with an error`). Попытка привести карточку к `done` через action-API вернула **400 `invalid manual status`**. Причина прочитана в установленном плагине: `MANUAL_STATUSES = ['backlog','todo']`, а `canMoveManually(from, to) = from !== 'running' && MANUAL_STATUSES.includes(to)`. То есть `done` — статус, который ставит **только исполнитель** (runner) при успешном завершении; ни API, ни UI не позволяют выставить его вручную. Единственный доступный перевод (`todo`) вернул бы карточку в очередь и не дал бы `done`; делать это без поручения владельца я не стал.
- Итог по доске: **приведено в соответствие 0 карточек, потому что 18 уже `done`; одна (MW-016) в `done` недостижима доступными средствами.** Это ограничение платформы, названное, а не обойдённое. Решение — за владельцем (например, перезапуск карточки либо правка статуса вручную в UI, если он это позволяет).

---

## 6. Ограничения и что осталось непроверенным

### 6.1 Окружение (не дефекты)

1. **`pnpm run check` недоступен**: `pnpm` не может создать временный каталог установки (`os error 5`). Выполнены те же четыре шага (`tsc` по 12 пакетам, `tsdown` по 12 пакетам, `smoke.mjs`, `node --test`), тем же инструментарием. Права не расширялись ради команды, которую можно воспроизвести без них.
2. **Системный TEMP песочницы недоступен для `mkdtemp`** (`EPERM`): наборы `storage`, `storage-crash`, `claim-saga`, `evidence`, `lease`, `memory-beads`, `plan-mutation`, `beads-adapter` создают БД во временных каталогах и падают до первого ассерта. Проверено отдельно: при `TEMP=C:\WINDOWS\temp` падение то же самое — `EPERM: mkdtemp 'C:\WINDOWS\temp\dsh-mywork-*'`, — то есть это ограничение песочницы, а не путь. **Уточнение по Windows (нашёл ревьюер):** `os.tmpdir()` берёт корень из `TEMP`/`TMP`, а не из `TMPDIR`, поэтому обходной приём задаёт все три переменные.
3. **Остаток из 8 падений при обходном `TEMP` внутри рабочей папки:** 7 — `memory-beads` (живой `bd init` недоступен), 1 — `beads-adapter`, и он падает **не** на утверждении о дереве, а на `EPERM: mkdtemp` в системном TEMP (проверено: та же ошибка и с `TEMP=C:\WINDOWS\temp`). Ни одно из этих падений не находится в путях, которые трогает MW-020.
4. **Девятое падение — `storage.test.mjs`**, и оно **не** окружение: «state must not live inside the repository» срабатывает именно потому, что обходной `TEMP` указывает внутрь репозитория. Это цена приёма из п. 2, а не дефект карточки; при системном TEMP набор падает раньше, на `mkdtemp`. Набор исключён из среза 27 и назван здесь, чтобы исключение не выглядело умолчанием.
5. **`node --test` без `--test-isolation=none` в этой песочнице падает** (`spawn EPERM`), поэтому все прогоны — с этим флагом, как и в предыдущих карточках.

### 6.2 Границы реализации (названы, а не спрятаны)

1. **`dematerialize` действует на элементы окна, а не на `ContextSnapshot`.** Он понижает уровень резидентного элемента и убирает тело; снапшот MW-016 при этом не переписывается — снапшот неизменяем (§35). Если требование читалось как «понижать уровень в самом снапшоте», это отдельная правка: снапшот придётся версионировать, что противоречит §35 в текущем прочтении.
2. **`offload` не пишет артефакт сам.** Функция возвращает `keptAs` (ссылку), а запись в Artifact Store — за портом, которого в дереве ещё нет (§1.2). Поэтому «offload кладёт в §32» доказано на уровне решения и ссылки, а не прогоном против живого стора.
3. **`rolloverSession` не создаёт сессию сам** — она получает её через `createSession`. Живой `SessionPort` (MW-015) не вызывался: это либо платная операция, либо изменение живого состояния Host.
4. **Порог `rollover` — решение, а не цитата.** §22.5 говорит «если попытка становится слишком большой», не называя числа; 0.8/0.95 — значение по умолчанию, заменяемое политикой. Ревьюер вправе оспорить именно числа, а не структуру.
5. **`compaction` и `offload` не снимают ничего без входа вызывающего** (сводки и цели). Это осознанный fail-closed: политика не выдумывает сводку и не выбирает хранилище за вызывающего.
6. **`freshSessionPlan` читает `perAttempt` из политики** и при `perAttempt: false` создаёт сессию даже для `pressure`. Это трактовка §22.2 (политика — вход, а не константа); по умолчанию поведение ровно архитектурное.
7. **Cordis-строки нет.** Ничего не монтируется в профиль: карточка объявляет контракты и чистую политику, а связывающую интеграцию делает карточка-потребитель (§36).
8. **Не проверено:** живой прогон rollover против реальной сессии; межпроцессная гонка за один capsule; поведение при `contextWindow`, меняющемся между окнами (поддерживается параметрами, но не прогонялось сценарием); `CheckpointPort` поверх настоящего `ArtifactStore` (производителя порта в дереве нет).
9. **`goal` остаётся свободным текстом.** Проверка содержимого (§8, F2) отвергает тела транскрипта в `historyRefs` и всё, что нарушает объявленные словари, но `goal`, `unresolved`, `decision` и `summary` — проза по замыслу, и валидировать её длину значило бы запрещать законные формулировки. Это осознанная граница, а не пропуск.

### 6.3 Процесс

1. **Коммиты сделаны** по отдельному поручению владельца — три слоя, `4f04716` → `0c657ae` (§10). Push/merge/publish/release не выполнялись.
2. **Живой профиль DSH, чужие проекты и `.beads/` не изменялись.** Доска разработки: прочитана; один `move` отправлен и **отвергнут сервером** (400), состояние не изменилось (revision до и после — 323).
3. **Субагенты: один — независимое ревью** (§8), отдельным поручением; других не запускалось. Платные LLM-пробы и другие модели — не запускались.
4. **Независимое ревью проведено: PASS WITH FINDINGS** (0 BLOCKER, 3 MAJOR, 7 MINOR, 2 NIT); 11 находок закрыты правками и тестами, F12 принят как открытое замечание о процессе. Полный разбор — §8. Аудит §4 при этом остаётся авторским: ревью его дополняет, а не заменяет, и приёмкой не является.

---

## 7. Воспроизведение

```powershell
cd H:\Repo\DSH-MyWork
git rev-parse HEAD                       # 067bb5878c61d121b47c787e7a521046eee310b6

# Сборка (pnpm run check недоступен в песочнице, см. §6.1):
foreach ($p in (Get-ChildItem packages -Directory)) {
  Push-Location $p.FullName
  node H:\Repo\DSH-MyWork\node_modules\tsdown\dist\run.mjs
  Pop-Location
}
node scripts/smoke.mjs                   # exit 0

# Набор карточки:
node --test --test-isolation=none tests/session.test.mjs      # 51 pass / 0 fail
node --test --test-isolation=none tests/boundaries.test.mjs   # 26 pass / 0 fail

# Мутационная батарея (применяет мутацию, shell пересобирает core и запускает набор):
node .tmp/mw020-mutations.mjs list
node .tmp/mw020-mutations.mjs apply M3
#   … пересобрать packages/core, затем:
node --test --test-isolation=none tests/session.test.mjs      # ожидается падение целевого теста
node .tmp/mw020-mutations.mjs restore                          # BYTE-IDENTICAL

# Проверка находок ревью (печатает наблюдение по каждой F1-F8):
node .tmp/mw020-verify-findings.mjs
```

**Приёмка по коду, а не по тестам:** `packages/contracts/src/session.ts` (`CheckpointCapsule`, `RolloverResult`, `FreshSessionPlan`), `packages/core/src/session.ts` (`rolloverSession` — отказы до создания сессии, `checkpointSession` — возврат capsule при отказе стора и проверка ответа порта, `capsuleDefect` — словари и точность якорей, `freshSessionPlan` — `carriesTranscript: false`, `decideContextPressure` — `rollover` как четвёртый исход), `tests/session.test.mjs` (четыре свойства §4.1).

**Границы для следующих карточек:** связывание `CheckpointPort` с `ArtifactStorePort` (§32/§36) и `SessionPort` (MW-015) — за карточкой интеграции; hard stop и снятие очереди — MW-031; recovery застрявшей работы — MW-031/MW-012; проекция сессий на доске — MW-047.

---

## 8. Независимое ревью: вердикт, находки, исправления

Проведено отдельным субагентом со свежим контекстом, read-only, в собственной изолированной копии (`git worktree add --detach .tmp/mw020-review HEAD`, base `067bb58`), с мандатом на состязательную проверку и словарём `PASS` / `PASS WITH FINDINGS` / `FAIL`. Мои рассуждения и переписка ему не передавались — единственным проводом был этот отчёт. Рабочее дерево не менялось: hash `packages/core/src/session.ts` до и после его мутаций совпал, `git status` живого дерева — те же пять файлов. Свой worktree он удалил; чужой `.tmp/mw012-review` не тронут.

**Вердикт: PASS WITH FINDINGS** — 0 BLOCKER, 3 MAJOR, 7 MINOR, 2 NIT. Все четыре свойства приёмки подтверждены по исходникам; числа отчёта (сборка 12/12, `tsc` 12/12, smoke 0, 40/40, 26/26, 653/8/23, размеры файлов) воспроизведены независимо.

**Каждую находку я воспроизвёл своим пробником** (`.tmp/mw020-verify-findings.mjs`) до правки и перепроверил после — вердикт ревьюера читается как evidence, а не как приговор.

| # | Sev | Находка | Статус | Чем закрыта |
|---|---|---|---|---|
| F1 | MAJOR | `checkpointSession` возвращал ответ порта без проверки: стор, ответивший `ok:true` без `ref`, давал успех без durable адреса (а без `capsule` — падение у вызывающего) | **исправлено** | ответ порта проверяется: `ok:true` без ссылки — отказ `checkpoint-store-unavailable` с возвратом построенного capsule. Тест «a store that claims success without a reference is a refusal, not a completion»; мутация **M9** |
| F2 | MAJOR | содержимое полей capsule не проверялось: `historyRefs` принимал тело транскрипта (2189 символов), пустую строку и не-uri; `path`-анкер без `line`; `severity:'CATASTROPHIC'`, `change:'exploded'`, `passed:'yes'`, `rejected[].reason=undefined` | **исправлено** | `capsuleDefect`: словари `ANCHOR_KINDS`/`ARTIFACT_CHANGES`/`FINDING_SEVERITIES`, обязательный целый `line` у `path`-анкера, обязательная причина у отклонённого подхода, и `historyRefs` — только ссылки схемы `scheme://` длиной ≤ 512. Тесты «a capsule whose content breaks its own vocabulary is refused» и «a history entry that is a body rather than a reference is refused»; мутации **M10**, **M11** |
| F3 | MAJOR | `createSession` вызывался до валидации нового окна: при `at=-1`/`at=1.5`/переполнении резервов функция бросала `TypeError`, **уже создав сессию** | **исправлено** | параметры нового окна проверяются до обращения к владельцу сессий; отказ типизированный. Тест «an invalid clock reading or reserve is refused before a session is minted» (для трёх случаев `created.length === 0`); мутация **M12** |
| F4 | MINOR | `stale-window` объявлен, но недостижим; `RolloverInput` не умел выразить ожидаемую ревизию; capsule с `windowOrdinal:5` при закрытии окна 1 и capsule чужой задачи принимались | **исправлено** | у окна появилась агрегатная `revision`; `expectedRevision` в `RolloverInput`; сверка `windowOrdinal`/task/workspace с закрываемым окном; добавлен отказ `capsule-invalid`. Тесты «a capsule taken in another window of the same attempt is stale», «an observed revision that is not the window revision is stale», «a capsule of another task or workspace cannot seed this window» и «every declared rollover refusal is reachable» (все 8 причин с пробой на каждую); мутация **M13** |
| F5 | MINOR | `capsule-invalid` — мёртвое значение: кривой capsule бросал `TypeError`, а не отказывал типизированно | **исправлено** | построение обёрнуто: `capsule-invalid` возвращается, а не бросается. Тест «a capsule that cannot be built is refused as capsule-invalid, not thrown»; мутация **M14** |
| F6 | MINOR | тест «shape is closed» проверял подмножество: обязательный список не содержал `schema` и `createdAt`, и мутация N1 (выкинуть `createdAt`) не ловилась | **исправлено** | тест сравнивает произведённое множество с `CHECKPOINT_CAPSULE_FIELDS` минус три объявленно-опциональных поля, плюс явные проверки `schema` и `createdAt` |
| F7 | MINOR | тест «every trigger is answered» не мог упасть: перебирал ту же константу и проверял только echo + `typeof boolean` | **исправлено** | ожидаемая таблица из пяти строк задана **литерально** и сравнивается `deepEqual` по всем семи полям плана; `ROLLOVER_TRIGGERS` сверяется с литеральным списком; мутация **M16** |
| F8 | MINOR | не покрыта клетка `perAttempt:false` × не-pressure: мутация N4 давала `retry → reusesSession:true` при зелёном наборе | **исправлено** | тест «a deployment may not turn a retry back into a reused session» проверяет все четыре не-pressure триггера при `perAttempt:false`; мутация **M15** |
| F9 | MINOR | четыре из пяти флагов §22.2 (`perReview`/`perPlanning`/`perReflection`/`perOptimization`) не имели потребителя | **исправлено** | добавлен `freshSessionFor(purpose, policy)` — вопрос «получает ли review свежую сессию» отвечается политикой. Тест «the policy answers for the purposes that have no rollover trigger» |
| F10 | MINOR | расхождения в отчёте: «7 отказов» (достижимо 6), неверная атрибуция падения `beads-adapter` обходному `TMPDIR`, не названный остаток `storage.test.mjs` | **исправлено** | §2.2 и §6.1 переписаны; атрибуция проверена заново — набор падает на `EPERM: mkdtemp` и при `TEMP=C:\WINDOWS\temp`, то есть это то же ограничение песочницы, а не следствие приёма; девятое падение `storage` названо отдельно. Уточнение ревьюера про Windows (`os.tmpdir()` читает `TEMP`/`TMP`) внесено в §6.1 п.2 |
| F11 | NIT | ссылка на «§9» в шапке `tests/session.test.mjs`, которого в файле нет | **исправлено** | ссылка ведёт на §4.2 отчёта и на `.tmp/mw020-mutations.mjs` |
| F12 | NIT (процесс) | восемь чужих отчётов переведены в `DONE` по свидетельству автора об указании владельца; иного артефакта об этом указании нет | **принято как замечание** | Указание владельца существует только в этой сессии; подделать артефакт нельзя, поэтому замечание остаётся открытым и названным (§5.1). Содержательная часть и оговорки отчётов сохранены, `MW-043` не тронут — ревьюер это подтвердил |

**Что ревьюер подтвердил как корректное** (не переписывалось): свойство 1 держится — `attemptId` берётся из окна, а не из capsule (его мутация N3 роняет ровно guard-тест); свойство 2 — на всех 5 триггерах × обоих `perAttempt`, лазейки «retry переиспользует сессию» нет; свойство 3 — на уровне ключей; свойство 4 — для честно падающего стора (его N2 и N6 роняют ровно целевые тесты); обвязка, границы 26/26, smoke, размеры файлов; отчёт не выдаёт self-review за приёмку; коммитов, push и правок чужого состояния нет.

**Что осталось непроверенным и названо:** живой rollover против реального `SessionPort` (платные/живые вызовы не выполнялись); `CheckpointPort` поверх настоящего `ArtifactStore` — производителя порта в дереве нет, и именно поэтому F1 был реалистичен (`putArtifact` возвращает `{ref, created}`, адаптеру есть где потерять `ref`); гонка двух процессов за один capsule; смена `contextWindow` между окнами. Ревьюер также не проверял доску и живой профиль (сознательно не касался) и не перепрогонял пять из восьми авторских мутаций — их области покрыты его собственными N1–N6.

---

## 9. Статус

**DONE.** Статус переведён из `READY_FOR_REVIEW` по прямому указанию владельца (сессия MW-020: «измени статус и сделай коммиты»); акт приёмки — это указание, а не вывод автора. Работа закоммичена тремя слоями по тому же поручению (§10).

Объём карточки выполнен: fresh session per record как данные (§22.2), capsule со всеми полями §22.4, пять операторов давления (§22.5), rollover внутри той же Attempt, новая Attempt/Session на retry/reject, отказ вместо имитации завершения при неудачной записи checkpoint. Проверки после исправлений: `tsc` 12/12, сборка 12/12, smoke exit 0, набор карточки **51/51**, границы **26/26**, мутации **16/16 CAUGHT** с побайтовым восстановлением, полный прогон **664 pass / 8 fail / 23 skip** (все 8 падений — окружение, §6.1).

Независимое ревью: **PASS WITH FINDINGS** (0 BLOCKER), все 12 находок разобраны — 11 закрыты правками и тестами, F12 принят как открытое замечание о процессе (§8). Ревью и приёмка — разные вещи: ревью это evidence, приёмка это акт владельца, и он состоялся.

Отдельно вынесено владельцу и **не** решено: **MW-016 нельзя перевести в `done` доступными средствами доски** (§5.2) — `MANUAL_STATUSES = ['backlog','todo']`, `done` ставит только исполнитель.

---

## 10. Коммиты

Выполнены по отдельному поручению владельца («измени статус и сделай коммиты»). Один коммит на слой, `type(scope): subject`, тело отвечает на «почему», трейлер `Cards: MW-020.` — по конвенции, снятой с истории (`git log --format=%B`). Каждый коммит несёт свой barrel вместе с модулем, который он экспортирует: общий файл двигается одним шагом.

| SHA | Коммит | Содержимое |
|---|---|---|
| `4f04716` | `feat(contracts): add the session window, checkpoint capsule, and pressure vocabulary` | `packages/contracts/src/session.ts` (новый, 957 строк), `packages/contracts/src/index.ts` (+1) — 2 файла, +958 |
| `2db6201` | `feat(core): decide context pressure and roll the session window over` | `packages/core/src/session.ts` (новый, 1028 строк), `packages/core/src/index.ts` (+29) — 2 файла, +1057 |
| `0c657ae` | `test(session): cover the checkpoint, the rollover, and the pressure decisions` | `tests/session.test.mjs` (новый, 746 строк, 51 тест) — 1 файл, +746 |

Base `067bb58` → head `0c657ae1434202865bd330f0eeaf2b60eb78f6d4`; рабочее дерево после коммитов чистое.

**Закоммиченное состояние проверено отдельно** (а не только рабочее дерево): на `0c657ae` — `tsc` 12/12 exit 0, сборка 12/12 exit 0, `smoke.mjs` exit 0, `session.test.mjs` **51/51**, `boundaries.test.mjs` **26/26**.

Push, merge, publish и release не выполнялись. Отчёт (`.work/`) в git не попадает — каталог исключён правилом `/.work/`.
