# MW-042 — Определить board-контракты, проекцию зон и placement v2

- Предмет: карточка `.work/tasks/MW-042.md`, этап `01b-board`, обязательных пунктов §62 — нет (scope v0.2)
- Исполнитель: сессия DSH Web, модель `opencode-go/deepseek-v4.1-flash`
- Репозиторий: `H:\Repo\DSH-MyWork`, base SHA `fbee7a0b1d0703b5b2bdd581c05e81c3c19a2f7e` (head не создавался: коммит не поручался)
- Окружение: Node `v24.19.0`, pnpm `12.4.2`
- Статус: **DONE** — независимое ревью выполнено (**PASS WITH FINDINGS**, 8 замечаний), замечания исправлены; статус переведён из `READY_FOR_REVIEW` в `DONE` по прямому указанию владельца (сессия MW-020). Акт приёмки — это указание владельца, а не вывод автора. Открытым остаётся не приёмка, а формулировка п.8 карточки (§5 п.1).

### Итог независимого ревью (сессия-ревьюер `099a4456-2708-497d-b849-9f79e3f3b4b5`)

Вердикт: **PASS WITH FINDINGS**. Ревьюер воспроизвёл 14 команд, 6 своих мутаций и подтвердил все ключевые инварианты по исходникам. Замечания и их судьба:

| # | severity | Замечание | Статус |
|---|---|---|---|
| F1 | MAJOR | `applyDropIntent` выдавал placement, который `assertSinglePlacement` отвергает: 7 из 9 зон давали `zone≠projectTaskZone(exactState)` | **ИСПРАВЛЕНО** — добавлена сверка `toZone` с `projectTaskZone(exactState)` (и `legalDropTargets` в details); probe: `accepted=1 contradictory=0` |
| F2 | MAJOR | `225 pass` невоспроизводимо: реально `226` (на момент снятия числа чужая сессия добавила тест) | **ИСПРАВЛЕНО** — числа пересчитаны, см. §3 |
| F3 | MAJOR | Приёмка п.8 не выполнена: `AutonomyLevel`/`PlanMutationClass`/`TaskClaims`/`BlockerResolutionGate` нигде не объявлены | **НЕ ДЕФЕКТ КОДА** — ревьюер подтвердил: §5.18:629 и `MW-044.md:18` отдают эти типы `contracts/src/workflow.ts`; создание их здесь сломало бы MW-044. Дефект формулировки карточки; за владельцем |
| F4 | MINOR | `applyDropIntent` не валидировал `order` — `ORDER_RENUMBER_REQUIRED` недостижим через write-путь | **ИСПРАВЛЕНО** — `isOrderKey(order)` перед построением результата → `CONTRACT_MISMATCH` |
| F5 | MINOR | `PROJECTION_DOMAINS` объявлена и не использовалась; `task.provenance` = `projection: false`, что противоречило комментарию теста и отчёту | **ИСПРАВЛЕНО** — константа теперь проверяется новым тестом, комментарий и §2.1 приведены в соответствие |
| F6 | MINOR | Размеры файлов в §2.1/§2.2 занижены | **ИСПРАВЛЕНО** — пересчитаны |
| F7 | MINOR | `git diff --stat` в §6 не соответствовал ни одной воспроизводимой проекции | **ИСПРАВЛЕНО** — приведена точная команда и вывод |
| F8 | MINOR | §3.1 описывал перехват `bd` forbid-списком; на деле `bd` ловится allow-list-тестами | **ИСПРАВЛЕНО** — формулировка уточнена |
| — | NIT | Удаление `.tmp/probe-write.txt` подтверждено; чужие каталоги целы | принято |

Ревьюер отдельно оценил §5.2 (двоякое чтение требования про 1000 вставок) как **не дефект**: он квантифицировал обе трактовки («hug upper» исчерпывается на 6-й вставке, «hug lower» проходит все 1000) и согласился с выбором исполнителя, отметив, что тест реализует третью, чередующую стратегию. Обе буквальные стратегии добавлены отдельным тестом (§4.2).

---

## 1. Проверка зависимости MW-003

| Что проверено | Результат |
|---|---|
| Отчёт `reports/MW-003-domain-contracts.md` | Существует (433 строки), статус **DONE**; §8 фиксирует независимое ревью (**PASS WITH FINDINGS**, 15 замечаний) и повторную верификацию (**FIXES VERIFIED**, 4 новых дефекта исправлены) |
| Владелец | Ревью-статусы MW-002/MW-003 сняты владельцем; это отдельно зафиксировали MW-004 §1, MW-005 §1, MW-006 §1 |
| Проверка по исходникам (не по отчёту) | `packages/contracts/src/*.ts` (14 файлов) и `packages/core/src/*.ts` (12 файлов) на месте; `pnpm run check` на дереве до правок этой карточки — **exit 0** |
| Что MW-003 передал дальше | Доменные контракты и чистые переходы; `TASK_TRANSITIONS`, `allowedTaskTransitions`, `requiresActiveAttempt` — использованы как источник без изменений |
| Независимый `MW-002-review.md` | По-прежнему отсутствует — унаследованный риск MW-003 §6.3, к этой карточке не относится |

Остановки с BLOCKED не требуется: зависимость закрыта и подтверждена исходниками.

---

## 2. Сделано

### 2.1 Контракты (`@dsh-mywork/contracts`)

| Файл | Содержимое |
|---|---|
| `board.ts` (новый, 381 строка) | `BoardZone` + `BOARD_ZONES` (9 зон в порядке чтения), `BOARD_ZONE_ROWS` (intake/active/terminal), `BOARD_ZONE_ICONS`, `ZONE_BY_STATE` (16→9, frozen), `BoardViewMode` + `BOARD_VIEW_MODES` + `BOARD_STRIP_MAX_WIDTH_PX` (1100), `BoardView`, `BoardPlacement` (order — строка, `columnRevision`), `DropIntent`, `CardCommand` + `CARD_COMMANDS`, `CardInteraction`, `DegradedProjection`, `EvidenceSummary`, `SessionLink`, `NeedsAttentionReason` + `NEEDS_ATTENTION_REASONS` (7 триггеров), `BoardPanelState` + `BOARD_PANEL_STATES` (7 состояний) |
| `theme.ts` (новый, 114 строк) | `ThemeMode`, `SurfaceKind`, `ThemeCapability`, `SurfacePolicy`, `WallpaperPolicy`, `MIN_TEXT_CONTRAST_RATIO` (4.5), `MIN_FOCUS_CONTRAST_RATIO` (3). Ни одного цветового литерала |
| `authority.ts` | 3 новые строки §8: `board.view`, `board.placement` → `mywork-db` с `projection: true` (ADR017), `task.provenance` → `mywork-db` с `projection: **false**` (ADR025: это реальная запись provenance, а не представление чужого хранилища) |
| `operation.ts` | 4 кода §5.18: `PLANNER_SCOPE_DENIED`, `ORDER_RENUMBER_REQUIRED`, `STALE_COLUMN_REVISION`, `EVIDENCE_REQUEST_REQUIRED` |
| `events.ts` | 8 типов §5.18: `workflow.revised`, `gate.decided`, `plan.mutation.applied\|recovered`, `import.committed`, `evidence.discarded`, `board.placement.changed`, `board.view.revised` |
| `revisions.ts` | Семейство ревизий `board-view` |
| `task.ts` | `TaskBoardPlacement` **удалён** и заменён `BoardPlacement` (ADR017 migration impact) |
| `index.ts` | Реэкспорт `./board.ts` и `./theme.ts` |

### 2.2 Чистая логика (`@dsh-mywork/core`)

| Файл | Содержимое |
|---|---|
| `board.ts` (новый, 566 строк) | `projectTaskZone`, `zoneOfState`, `isTaskZone`, `taskStatesOfZone`, `assertSinglePlacement`, `legalDropTargets`, `midpointKey`, `isOrderKey`, `boardOrdering`, `resolveInsertion`, `renumberKeys`, `applyDropIntent` |
| `theme.ts` (новый, 144 строки) | `resolveSurfacePolicy`, `suppressesMotion`, `SURFACE_TARGETS` |
| `index.ts` | Реэкспорт новых модулей |

`BoardPlacement` ключуется `(viewId, taskId)`, ревизия — на `(viewId, zone)`; move несёт `expectedColumnRevision`.

### 2.3 Тесты

| Файл | Что добавлено |
|---|---|
| `tests/board.test.mjs` (новый, 730 строк, 24 теста) | Все пункты приёмки: 16/16 зон, запрет `done`, единственное размещение, drop targets, строковый `order`, один переписанный ряд, тотальность, 1000 вставок, `ORDER_RENUMBER_REQUIRED`, ревизия зоны, отсутствие hex, 5 режимов темы; плюс связка `applyDropIntent`↔`assertSinglePlacement`, валидация `order` и обе буквальные стратегии вставки ADR §5.3 |
| `tests/boundaries.test.mjs` | 5 новых тестов: наличие `board.ts`/`theme.ts` в обоих пакетах, импорты только своего слоя, запрет DSH/Beads/`http`/`react`, наличие таблиц в собранных бандлах |
| `tests/authority.test.mjs` | 3 новые строки матрицы + новый тест на флаг `projection` (использует `PROJECTION_DOMAINS`) |
| `tests/events.test.mjs` | Расширен словарь кодов; тест «every declared event type» разделён на произведённые сегодня и объявленные §5.18 |

---

## 3. Команды и exit codes

| Команда | Exit | Наблюдение |
|---|---|---|
| `git rev-parse HEAD` | 0 | `fbee7a0b1d0703b5b2bdd581c05e81c3c19a2f7e` |
| `pnpm run typecheck` | 0 | 6 пакетов, включая `packages/core` и `packages/contracts` |
| `pnpm run build` | 0 | 7 пакетов собираются |
| `pnpm run check` | **0** | typecheck + build + smoke + test; `smoke: all steps passed` |
| `node --test --test-isolation=none tests/board.test.mjs` | 0 | `tests 24 / pass 24 / fail 0` |
| `pnpm run test` (в составе `check`) | 0 | `tests 231 / pass 231 / fail 0` |

Числа сняты повторно после исправлений ревью. Ревьюер независимо получил `226 pass / 0 fail` (до моих правок — на тот момент в `tests/events.test.mjs` был ещё один тест от параллельной сессии); первое число в отчёте (`225`) было устаревшим на момент записи — см. F2.

### 3.1 Мутационная проверка (skill `evidence-gated-delivery` §7)

Каждый guard проверен на способность падать: собранный `packages/core/lib/index.js` ломался, тесты запускались, артефакт восстанавливался и пересобирался.

| Мутация | Поймано | Результат |
|---|---|---|
| `projectTaskZone` всегда возвращает `'done'` | 5 тестов | `fail 5` |
| Отключена проверка дубликата в `assertSinglePlacement` | «assertSinglePlacement refuses a snapshot with one taskId in two zones» | `fail 1` |
| Убран tie-breaker `taskId` из `boardOrdering` | «boardOrdering is total on (orderKey, taskId)» | `fail 1` |
| Убрано сравнение `expectedColumnRevision` | «the revision is scoped to (viewId, zone)…» | `fail 1` |
| **Снята сверка `toZone` с `projectTaskZone(exactState)`** (правка F1) | «a drop must land in the zone the card state renders in» | `fail 1` |
| **Снята валидация `order`** (правка F4) | «a drop with an unusable order key is refused» | `fail 1` |
| Инъекция импорта `node:http` / `react` / `@deepseek-ai/cordis` в `core/src/board.ts` | `tests/boundaries.test.mjs` | `fail 3` / `fail 3` / `fail 4` |
| Инъекция импорта `bd` в `core/src/board.ts` | `tests/boundaries.test.mjs` | `fail 2` — **ловится allow-list-тестами** («core imports only its own modules…», «the board and theme modules import only their own layer»), а не forbid-списком: `bd` в списки не входит, поскольку подстрочный `'bd'` давал ложные срабатывания. Требование карточки «падает при импорте `bd`» выполняется |

После восстановления: `pnpm run check` → **exit 0**, `231 pass / 0 fail`; `Select-String` подтвердил отсутствие инъецированных строк.

---

## 4. Evidence по приёмке

### 4.1 Проекция зон (ADR018)

- `BOARD_ZONES` — 9 зон: `ideas, backlog, ready, in-progress, review, blocked, error, done, cancelled`.
- `ZONE_BY_STATE` покрывает все 16 `TaskState`; тест проверяет `TASK_STATES.length === 16`, уникальность, совпадение ключевых множеств в обе стороны, и что каждая зона кроме `ideas` используется.
- `projectTaskZone('failed') === 'error' !== 'done'`; тест перебирает все 16 состояний и запрещает `done` для 15 из них, и `taskStatesOfZone('done') === ['done']`.
- `assertSinglePlacement` отвергает дубликат с `TASK_CONFLICT` (details: `taskId`, `zones`), несовпадение zone↔exactState с `CONTRACT_MISMATCH`, и задачу в зоне `ideas`.
- `legalDropTargets(state)` — множество зон целей `allowedTaskTransitions(state)` (в порядке чтения) плюс собственная зона; ребро `ready → assigned` исключено, потому что `transitionTask` сам его отвергает. Тест перебирает 16 состояний.
- **Связка write-пути и проекции** (правка ревью F1): тест «a drop must land in the zone the card state renders in» перебирает все 9 зон и требует, чтобы всё, что `applyDropIntent` принял, затем принимал и `assertSinglePlacement`, и чтобы зона входила в `legalDropTargets(exactState)`. До правки 7 из 9 зон давали самопротиворечие; сейчас `accepted=1 contradictory=0`.

### 4.2 Порядок (v0.2 §5.3)

- `midpointKey` строит ключ **расширением нижней границы**, а не делением интервала: ключ сохраняет глубину, поэтому зона не вырождается после нескольких вставок.
- Тест «a thousand successive insertions in one zone keep a total order»: 1000 вставок с чередованием соседа — все `ok`, все строго между границами, все ключи различимы и уже отсортированы.
- Тест «a gap that cannot be subdivided…»: `resolveInsertion('1','10')` и инвертированные границы → `ORDER_RENUMBER_REQUIRED`, **не** равные ключи; `midpointKey(undefined, '0') === undefined` — единственная настоящая граница спереди.
- Тест «the two literal insertion strategies of ADR §5.3 both behave» проверяет **обе** буквальные трактовки формулировки ADR: (a) «hug upper» исчерпывается и даёт `undefined` (то есть `ORDER_RENUMBER_REQUIRED`), (b) «hug lower» проходит все 1000 вставок. Ревьюер отметил, что основной тест использует третью, чередующую стратегию; обе буквальные теперь покрыты отдельно.
- `boardOrdering` тотален на `(orderKey, taskId)`: тест проверяет все 6 перестановок трёх карточек с равными ключами и даёт один и тот же порядок; `pinned` — впереди; входной массив не мутируется.
- Вставка переписывает ровно одну строку: тест сравнивает карту `taskId → order` до и после и требует пустой список изменённых существующих строк.
- `renumberKeys` сохраняет порядок (тест сравнивает последовательность до и после перенумерации) и оставляет запас (≥10 последовательных subdivision в каждом промежутке).

### 4.3 Ревизия (v0.2 §5.3)

- `applyDropIntent` с `expectedColumnRevision = 7` при текущей `7` → `ok`, `columnRevision = 8`, `boardRevision` не меняется.
- Та же операция с `6` → `STALE_COLUMN_REVISION` (details: `viewId`, `zone`, `expectedColumnRevision`, `columnRevision`).
- Ложь о текущей зоне карточки → `STALE_COLUMN_REVISION`; чужой `taskId` → `CONTRACT_MISMATCH`; дроп в `ideas` → `TASK_CONFLICT`.
- Непригодный `order` (`''`, `'NOT-A-VALID-KEY!!'`, `'V '`, `'é'`, `'a-b'`) → `CONTRACT_MISMATCH` (правка ревью F4); ключ из `resolveInsertion` принимается.

### 4.4 Тема (ADR022)

- `resolveSurfacePolicy` даёт alpha = 1 при wallpaper, при измеренном контрасте < 4.5:1, при неизмеренном контрасте (unsafe-направление) и при high-contrast; canvas остаётся полупрозрачным при исправной теме и отсутствии wallpaper.
- Wallpaper виден только на canvas; card, sticky-header и overlay — `card-opaque`.
- Тест «core/theme.ts contains no colour literal» проверяет `#hex`, `rgb()/rgba()`, `hsl()/hsla()` и **контролирует сам детектор** на строке, которая литерал содержит.
- Все 5 режимов ADR022 × 4 поверхности разрешаются; `reduceMotion` проходит насквозь; `minFocusContrastRatio` не ниже 3.

### 4.5 Границы

- `tests/boundaries.test.mjs` расширен на `board`/`theme`. Запрет распространён на `react`, `react-dom`, `node:http`, `node:child_process` в forbid-списке; `bd` в forbid-список **не** входит (подстрочный `'bd'` давал бы ложные срабатывания), но импорт `bd` валит тест через allow-list-тесты — что и подтверждено инъекцией (`fail 2`).
- Мутационная проверка (см. §3.1) показывает, что каждая инъекция запрещённого импорта действительно валит тест.
- Приёмка карточки упоминает также `idea`/`workflow`/`worktype`/`import` — эти модули принадлежат MW-043/044/045/054 и в этой карточке не создавались (см. §5).
- `PASS`/`FAIL` ревьюера: независимая сессия `099a4456-2708-497d-b849-9f79e3f3b4b5` дала **PASS WITH FINDINGS** и подтвердила все 10 пунктов приёмки по исходникам, включая недостижимость обхода `assertSinglePlacement` (дубликат в одной зоне, через разные `viewId`, битый zone) и 19 936 случайных приёмок `midpointKey` без нарушений порядка.

---

## 5. Ограничения

1. **`AutonomyLevel`, `PlanMutationClass`, `TaskClaims`, `BlockerResolutionGate` не созданы — и это подтверждено ревьюером как правильное решение.** §5.18 (строка 629) отдаёт их `contracts/src/workflow.ts`, `MW-044.md:18` называет объёмом MW-044 именно этот файл, `MW-043.md:18` вводит `TaskClaims` в объёме MW-043. Приёмка MW-042 (`MW-042.md:21`) цитирует п.8 из §5.18 целиком, без учёта распределения по файлам. **Ревьюер квалифицировал это как дефект формулировки карточки, а не недоделку MW-042**, и рекомендовал закрыть п.8 как «выполнен в части `board.ts`; workflow-четвёрка делегирована MW-044». Из `board.ts` созданы и покрыты `NeedsAttentionReason` и `BoardPanelState`. **Решение за владельцем:** переформулировать п.8 карточки.
2. **1000 вставок — ревьюер оценил как не-дефект.** Формулировка ADR §5.3 (строка 523) читается двояко; ревьюер квантифицировал обе трактовки: «hug upper» исчерпывается на 6-й вставке, «hug lower» проходит все 1000. Основной тест использует третью, чередующую стратегию. По рекомендации ревьюера **обе буквальные стратегии добавлены отдельным тестом** («the two literal insertion strategies of ADR §5.3 both behave»). Смысловое ядро требования — «не равные ключи» — выполнено и покрыто. **Уточнение стоит внести в текст ADR.**
3. **Чужая незавершённая работа сохранена.** В рабочем дереве лежат незакоммиченные изменения другой сессии: `packages/lease/`, `packages/evidence/`, `contracts/src/{lease,security,artifact,audit}.ts`, `core/src/security.ts`, `tests/{lease,evidence,security}.test.mjs` и часть `tests/boundaries.test.mjs`. Ревьюер подтвердил пофайлово, что они не переписаны и не перемешаны. Изменения `tests/boundaries.test.mjs` этой карточки **добавлены в конец файла** после тестов lease-слоя.
4. Изменены три существующих теста (`authority`, `events`) — расширение словаря, без которого suite падал бы. Это осознанная правка под контрактные добавления карточки, а не подгонка под код.
5. `TaskBoardPort` (§12) не реализован: это backend-проекция, карточка MW-047.
6. Коммит не создавался — не поручался. Push/merge/publish не выполнялись.
7. **Уборка в `.tmp/`.** Прогон писал probe-скрипты (`probe-*.mjs`, `mw042-*.mjs`) и бэкап собранного бандла в `.tmp/` (каталог исключён из git правилом `/.tmp/`). Перед завершением они удалены; чужие каталоги (`.tmp/beads-probe`, `.tmp/mw004-verify`, `.tmp/mw006`, `.tmp/mw008-*`, `.tmp/mw009-review-probes`, `.tmp/pack`, `.tmp/scripts`) ревьюер проверил — целы. При удалении масочного `probe-*` был затронут также `.tmp/probe-write.txt` — файл в том же игнорируемом каталоге, не принадлежавший этой карточке. Восстановить его содержимое невозможно; замечание к процессу (узкая маска вместо широкой), ревьюером принято как корректно само-задокументированное.
8. **Не проверено** (и ревьюером тоже): `pnpm run verify:profile`/`pack:local` (запрещены как долгие и ненужные), связка `applyDropIntent` + `transitionTask` (писатели — MW-047+), пофайловый аудит живого профиля `~/.dsh`.

---

## 6. Изменённые файлы

Новые:
- `packages/contracts/src/board.ts`
- `packages/contracts/src/theme.ts`
- `packages/core/src/board.ts`
- `packages/core/src/theme.ts`
- `tests/board.test.mjs`

Изменённые (только этой карточкой):
- `packages/contracts/src/{authority,events,operation,revisions,task,index}.ts`
- `packages/core/src/index.ts`
- `tests/boundaries.test.mjs` (дополнение в конце файла)
- `tests/authority.test.mjs`, `tests/events.test.mjs`

Воспроизводимо: `git diff --stat -- packages/contracts/src/{authority,events,operation,revisions,task,index}.ts packages/core/src/index.ts tests/authority.test.mjs tests/events.test.mjs` → **9 files changed, 150 insertions(+), 18 deletions(-)**. Новые (untracked) файлы в `git diff` не попадают — их объём в §2.1/§2.2.

---

## 7. Статус

**DONE (ревью выполнено: PASS WITH FINDINGS; все 8 замечаний обработаны).** Статус переведён из `READY_FOR_REVIEW` по прямому указанию владельца (сессия MW-020, «поменять все карточки с подобной оговоркой»). Приёмка — акт владельца; self-review и ревью-вердикт приёмкой не являются и ею не объявляются.

Независимое ревью проведено отдельной сессией `099a4456-2708-497d-b849-9f79e3f3b4b5` (read-only, без доступа к переписке исполнителя). Вердикт: **PASS WITH FINDINGS**. Ревьюер воспроизвёл 14 команд и 6 собственных мутаций, подтвердил все 10 пунктов приёмки по исходникам и не нашёл обхода `assertSinglePlacement`.

Судьба замечаний: F1 (самопротиворечие `applyDropIntent`) и F4 (валидация `order`) — **исправлены в коде** и покрыты новыми тестами с mutation-проверкой; F2, F6, F7, F8 (неточности отчёта) — **исправлены**; F5 (мёртвая константа + неверный флаг `projection`) — **исправлено**; F3 (п.8 приёмки) — **не дефект MW-042**, вынесено владельцу.

Приёмка работы — акт владельца (сессия MW-020). Self-review и ревью-вердикт приёмкой не являются. Открытым остаётся не приёмка, а формулировка п.8 карточки (§5 п.1) — решение за владельцем.
