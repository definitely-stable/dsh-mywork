# DSH My Work (`dsh-mywork`)

## Архитектурные решения v0.2 — additive к v0.1

Этот документ **не заменяет** `DSH-My-Work-Architecture-v0.1.md`. v0.1 остаётся исторической основой и нормативным текстом для всего, что здесь не переопределено. v0.2 добавляет решения ADR016–ADR028, точную проекцию девяти визуальных зон, уточнённую стратегию Beads и границы интеграции с DSH.

Правило чтения: §-номера и ADR-001…ADR-015 берутся из v0.1; ADR016…ADR-028 и таблицы этого документа — из v0.2. При расхождении v0.2 имеет приоритет только по тем вопросам, которые он явно адресует.

Дата фиксации: 2026-09-18. Основание: `EXECUTION-PLAN.md`, исследование DSH `0.1.5-rc.2`, Beads 1.3.0, установленного `dsh-task-board` 0.3.23 и выбранного визуального референса.

---

## 0. Проверенные факты, на которых стоят решения

Эти факты добыты из первоисточников, а не из документации третьих лиц. Они меняют часть исходных допущений и потому вынесены вперёд.

### 0.1 DSH 0.1.5-rc.2

| Факт | Источник |
|---|---|
| Нативный слот `main` — `kind: keyed`, `scope: root`, регистрация `{ name: 'main', key }`; зарезервирован только ключ `conversation`, `replaceRisk: shadows-shipped-ui` | `packages/extensions/cordis-client-runner/src/client/slot-catalog.ts:1360-1392` |
| Нативный слот `sidebar.panellist` — `kind: list`, `scope: root`, регистрация `{ name, id, order, label }`; «each list id addresses the matching main panel»; owner props `{ size, active }`, то есть **только иконка** | там же `:2180-2224` |
| Всего 67 ключей слотов | `slot-catalog.ts` (полный список ключей) |
| `ctx.layout.selectPanel(panelId)` бросает, если панель не зарегистрирована | `packages/client/ui-layout/src/client/service.ts:68-73` |
| Регистрация UI: `ctx.slots.register({ name, children?, store?, inject?, locale? }, Component)`; `ctx.slots.inject(name, cb)` ждёт владельца слота | `docs/subsystems/slots.md:28-42,99-102` |
| Компонент получает четыре доли props и **никогда не получает ctx**; пять standing hooks — `useSession`, `useSessions`, `useWorkspaces`, `useStore`, `renderSlot` | `packages/client/AGENTS.md` (Slot and props discipline) |
| Реактивный источник для компонента публикуется в зарезервированном `hooks`-компоненте inject-face; компонент не вызывает `useSyncExternalStore` | `docs/subsystems/slots.md:99-102` |
| Клиентская половина живёт в том же пакете: `src/client/`, `exports["./client"]`, `dsh.client = { platform: 'web', inject: [...] }` | `docs/cookbook/adding-a-settings-card.md:7,82-92` |
| Bundle — lazy-CJS фабрика: `format: 'cjs'`, `platform: 'browser'`, `entryFileNames: 'client.js'`, banner `window.__ModuleLoader__.load({ id, factory: (require) => {`, footer `return module.exports; } });` | `packages/client/tsdown.client.ts:428-571` |
| Пресет `packages/client/tsdown.client.ts` **не публикуется**; пакет вне этого репозитория обязан воспроизвести формат сам | `docs/cookbook/adding-a-settings-card.md:102` |
| Build-gate запрещает value-импорт другого плагина; cross-plugin — только cordis-сервисы и slots; `import type` стирается и до gate не доходит | `packages/client/tsdown.client.ts:482-500` |
| HTTP-каркас хоста: `ctx.webServer.register({ kind: 'exact'|'prefix', path, handler }) → disposer`; дубликат `(kind, path)` бросает | `docs/subsystems/web-server.md:51,71-84` |
| Тема — 371 CSS custom property `--dsw-*`, включая `--dsw-alias-bg-mask-photo`, `--dsw-alias-bg-layer-1..4`, `--dsw-alias-label-*`, `--dsw-alias-border-l1..4`, `--dsw-alias-state-{success,error,warn,business}-*`, `--dsw-alias-interactive-bg-*`, `--dsw-elevation-*`, `--dsw-shadow-lv1..3`, `--dsw-font-*`, `--dsw-specific-sidebar-*` | поиск по `packages/client/*/src` |
| HMR следит только за client-плагинами внутри чекаута DSH | `docs/api-gateway.md:148` |

### 0.2 Beads 1.3.0

| Факт | Источник |
|---|---|
| `bd batch` — одна Dolt-транзакция с полным rollback; грамматика `close`/`update`/`create`/`dep add`/`dep remove` | `cmd/bd/batch.go` (`transact(...)`, `tx.CloseIssue/UpdateIssue/CreateIssue/AddDependency/RemoveDependency`) |
| В `bd batch` `update` знает **только** `status, priority, title, assignee, force`; metadata, labels, description, notes, external_ref, acceptance, parent, deps и любые guard-ы не выражаются | `parseUpdateKVs`, help `bd batch` |
| `bd create --graph <plan.json>` (`{commit_message?, nodes[], edges[]}`) атомарен: creates + parent-child + explicit + inline edges + `metadata_refs` + deferred assignees + финальный whole-graph cycle-check внутри одного `RunInTransaction` | `cmd/bd/graph_apply.go:948,1089,1116` |
| Условный CAS: `bd update --if-status/--if-assignee` при несовпадении не пишет ничего и завершается exit 13; требует field-update и не сочетается с `--claim`; **в `bd batch` эквивалента нет** | help `bd update` |
| HTTP `POST /v0/beads/issues:batchApply` — `create`/`update`/`close`/**`dep_add`** с `expected_version`/`expected_status`/`expected_assignee`; all-or-nothing; 409 с `item_*`. **`dep_remove` отсутствует** | `internal/httpapi/batch_apply.go:61,88-113` |
| `bd update --claim` — атомарный CAS (assignee=Actor, status=in_progress; open-or-active + unassigned/Actor/pool; идемпотентен для того же actor'а) | `issueops/claimer.go` |
| Lease: `bd heartbeat` (owner-only, без Dolt-коммита), `bd reclaim --older-than` (default 10 m, grace ≈ 2× TTL). Lease node-local и ephemeral | help `bd heartbeat`, `bd reclaim` |
| Точный конфигурационный ключ claim-TTL **не найден** ни в бинаре, ни в help (есть только `claim.pools`) | поиск по строкам бинаря |
| Metadata CAS: `POST /v0/beads/issues/{id}:casMetadata` `{key, expected?, value?}` → `{swapped, current?}`; проигранная гонка = **HTTP 200** с `swapped:false`, не 409 | `internal/httpapi/metadata_cas.go` |
| Capability discovery: `GET /v0/beads/context` → `capabilities[]` только реализованных операций + `project.enforce` | `internal/httpapi/routes.go` (`Capabilities()`) |
| Events journal: `bd events tail --since N` / `export`; HTTP `GET /v0/beads/events`, `/events:watch`. **Off by default** (`bd config set events-journal true`), per-branch (`dolt_ignored`), per-replica с собственным seq-space, raw `bd sql` не журналируется | help `bd events` |
| Статусы: `open`(active), `in_progress`(wip), `blocked`(wip), `deferred`(frozen), `closed`(done), `pinned`(frozen), `hooked`(wip); custom `name:category`; custom **wip** исключается из `bd ready` | `cmd/bd/statuses.go`, help `bd statuses` |
| Priority `0..4`, `0` — высший, integer; отсутствующий приоритет → P2 | help `bd create`, `bd schema` |
| Reserved metadata-префиксы: `bd:` и `_` | `docs/core-concepts/metadata.md` |
| Metrics ON by default; выключается `bd metrics off` | вывод `bd schema` |
| В `H:\Repo\DSH-MyWork` beads-воркспейса **нет** | `bd where` → `No active beads workspace found` |

### 0.3 Установленный `dsh-task-board` 0.3.23

| Факт | Источник |
|---|---|
| Встроен **через DOM**, не через slots; в исходнике прямо сказано, что слота для внешнего плагина нет | `src/client/sidebar-entry-core.ts:66-75,149-151`; `lib/client.js:4248,4262,4349,4378,4391` |
| Панель занимает `[class*="centerCol"]` / `[data-pane="conversation"]`, видимость через `<html data-dsh-taskboard-active>` + CSS, скрывающий контент беседы | `src/client/panel-mount-core.ts:53-60,93-97,112-141` |
| Единственное использование нативного слота — карточка настроек `web-ui.plugin.item` | `lib/client.js:5546-5549` |
| Ledger: `$DSH_HOME/task-board/ledger-v2.json`, `schemaVersion 3`, монотонная `revision`, idempotency по `{requestId, fingerprint=sha256(action)}` | script-probe ledger'а |
| Статусы ровно пять: `backlog`, `todo`, `running`, `done`, `failed` | `lib/index.js:302-325` |
| SSE несёт только `{revision, scheduler, power}` и никогда список задач | `lib/client.js:5402-5412`, `lib/index.js:5838-5842` |
| Cron — 5 полей, локальное время хоста, missed-точки не догоняются (`skipMissed`, `RESUME_GAP_MS`) | `lib/index.js:1818-1834,3148-3155` |
| **Безусловный** daily-heartbeat на `dsh-market.com` с первой строки `apply()`; выключателя нет | `lib/client.js:5431-5497,5528`; `src/client/telemetry.ts:25-27,81-103` |

### 0.4 Лицензии

| Проект | Лицензия | Следствие |
|---|---|---|
| `ttmouse/dsh-taskboard` | MIT (Copyright 2026 Reasonix contributors) | Заимствование кода допустимо с сохранением уведомления |
| `zhu1090093659/dsh-web` | Apache-2.0 | Заимствование требует NOTICE и отметки изменённых файлов |
| `gastownhall/beads` | MIT (Copyright 2025 Beads Contributors) | Заимствование допустимо |
| DSH `0.1.5-rc.2` | — | Пресет клиентской сборки не публикуется: формат воспроизводится, а не импортируется |

**Решение v0.2:** код не заимствуется ни из одного из трёх проектов. Берутся только UX-паттерны и подтверждённые факты поведения. Любое будущее заимствование — отдельный ADR с проверкой лицензионных границ.

---

## ADR016. Native MyWork board is a first-party control surface

**Context.** DSH 0.1.5-rc.2 предоставляет нативные слоты (`main`, `sidebar.panellist`, `rightbar`, `settings.*`, `conversation.*` — 67 ключей), навигацию через `ctx.layout.selectPanel` и полноценный dispose через fiber. Установленная legacy-доска этого не использует: она встраивается DOM-инъекцией и сама фиксирует в исходнике, что слота для неё нет. MyWork нужна собственная доска, максимально адаптированная под DSH.

**Decision.** Доска MyWork — first-party control surface плагина. Основной путь: нативный слот `main` с ключом `mywork` и запись в `sidebar.panellist` с `id: mywork`; переход между панелями — `ctx.layout.selectPanel('mywork')`. Ключ `conversation` в слоте `main` не занимается никогда: он зарезервирован и имеет `replaceRisk: shadows-shipped-ui`.

**Rejected alternatives.**
- Форк legacy-доски: переносит чужую runtime-модель, DOM-инъекцию и пять статусов.
- DOM-инъекция по образцу legacy: не имеет dispose, ломается при изменении структуры DSH, требует наблюдения за `document.body`.
- Внешний optional adapter: не даёт first-party UX и оставляет доску вне контроля версий MyWork.

**Consequences.**
- MyWork полностью владеет своим UI и не зависит от DOM-структуры DSH.
- Появляется второй независимый UI рядом с legacy; конфликта нет, потому что у них разные якоря.
- `sidebar.panellist` несёт только иконку, поэтому строки навигации («Доска», «Команда», «Автоматизация», «Активность») живут внутри главной панели.

**Migration impact.** Новый пакет `packages/web` (`@dsh-mywork/web`) и вторая строка монтирования в профиле. `@dsh-mywork/controller` остаётся React-free и сохраняет boundary-тест `contracts → core → adapter-sdk → controller`.

**Tests.** Панель монтируется и исчезает по unload; повторный mount/unmount не оставляет ни слотов, ни маршрутов, ни CSS, ни таймеров; занятый ключ `main` — `mywork`, ключ `conversation` свободен; иконка вызывает `selectPanel('mywork')`.

---

## ADR017. Semantic Task Graph vs visual Board Projection

**Context.** §8 v0.1 уже разделяет authority: `task.description`, `task.dependencies`, `task.readiness`, `task.priority`, `task.completion` принадлежат Task Graph; `task.board-placement` — Task Board, и эта строка помечена `projection: true`. Но v0.1 не описывает форму проекции и не запрещает UI писать состояние.

**Decision.** Три раздельных графа, у каждого свой владелец и своя ревизия:

1. **Task Graph** — семантика: title/description, зависимости, readiness, priority, role requirement, work type, acceptance criteria, completion. Владелец: Beads.
2. **Workflow Graph** — исполнение: worker step, verification, AI review, human approval, integration, retry, branch, conditions, schedule, escalation, rollback/recovery. Владелец: MyWork Registry (immutable revisions).
3. **Task Board Projection** — только представление: mapping колонок, порядок, фильтры, collapse/expand, saved views, density, тема, layout, card preview, UI-состояние выбора. Владелец: MyWork DB.

Drag-and-drop **не пишет** board state: он строит `DropIntent`, который резолвится в MyWork command и может быть отвергнут.

**Rejected alternatives.**
- Доска как источник истины: потеря доски теряла бы работу.
- Хранение зоны в Task Graph: смешивает семантику с представлением и делает Beads зависимым от UI-решений.
- Прямая запись порядка в Beads metadata: меняет authority §8 и создаёт второго писателя.

**Consequences.**
- Потеря проекции не теряет authority: проекция полностью пересобирается из Task Graph + MyWork DB.
- Порядок карточек живёт в MyWork DB и не является семантикой.
- Любое перемещение карточки либо меняет `TaskState` через команду, либо отвергается.

**Migration impact.** `TaskBoardPlacement` (v0.1) заменяется `BoardPlacement` с полями `zone`, `exactState`, `subState`, `order` (строковый ключ), `viewId`, `boardRevision`. Таблица authority расширяется строками `board.view`, `board.placement`, `task.provenance` → `mywork-db`.

**Tests.** Пересборка проекции из Task Graph даёт идентичную раскладку; перемещение карточки без сопутствующей команды не изменяет ни одного `TaskState`; удаление и повторная сборка snapshot не изменяет граф.

---

## ADR018. Nine-column projection does not collapse domain states

**Context.** Домен имеет 16 `TaskState` с формальной таблицей переходов (`packages/core/src/task.ts:50-67`). Владелец выбрал девять визуальных зон в сетке 3×3. Наивное отображение «зона = состояние» потеряло бы различие `draft`/`planned`, `assigned`/`executing`, `awaiting-review`/`reviewing`/`approved`/`integrating`, `cancelled`/`superseded`.

**Decision.** Зона — **группировка интерфейса**, а не состояние. `ZONE_BY_STATE` — frozen-таблица в `@dsh-mywork/contracts`; `projectTaskZone` — чистая тотальная функция в `@dsh-mywork/core`. Карточка всегда показывает точный `TaskState` текстовым чипом, а также attempt, review и причину блокировки.

Точное отображение:

| Зона | Точные `TaskState` | Дополнительно на карточке |
|---|---|---|
| `ideas` | — (сущность `Idea`, не Task) | `IdeaState`, автор, действия «Разработать план» / «Создать быструю задачу» |
| `backlog` | `draft`, `planned` | точный чип, у `planned` — открытые зависимости и «план не утверждён» |
| `ready` | `ready` | роль, приоритет, окно admission |
| `in-progress` | `assigned`, `executing` | `AttemptState`, attempt id, fence, lease-expiry, агент, роль, бюджет |
| `review` | `awaiting-review`, `reviewing`, `approved`, `integrating` | `ReviewState`, reviewer, привязанный артефакт (`headSha`, `diffHash`), вердикт; для `integrating` — стратегия |
| `blocked` | `blocked`, `needs-attention` | причина: id зависимости и её состояние, либо gate, либо «человек не решил» |
| `error` | `failed`, `changes-requested` | подтип, причина, счётчик попыток, остаток retry-бюджета, «Повторить» |
| `done` | `done` | `completedAt`, цепочка review → integration, финальные evidence, кто принял |
| `cancelled` | `cancelled`, `superseded` | различимый подтип: «Отменено» / «Заменено планом» + ссылка на план-ревизию |

Проверка полноты: 16/16 состояний размещены ровно по одному разу.

**Заполненный пробел.** `integrating` не входил ни в одну из девяти зон. Отнесён к `review`: это фаза проверки и применения, а не работа исполнителя, и `done` достижим только после неё. Размещение `integrating` в `in-progress` намекало бы на активного worker'а, которого уже нет.

**Инвариант единственного размещения.** Карточка рендерится **ровно в одной зоне**. Задача в `ready` с провалившейся предыдущей попыткой остаётся в `ready` и несёт бейдж ошибки; в зону `error` она попадает только если её собственный `TaskState` равен `failed` или `changes-requested`. Фильтр «показать все ошибки» — saved view, а не второе размещение.

**Rejected alternatives.**
- Показывать зону как состояние: теряет 9 из 16 различий.
- Двойное размещение: ломает счётчики и делает DnD неоднозначным.
- Отнести `integrating` к `in-progress`: семантически неверно.
- Считать `failed` успешным завершением: прямо запрещено.

**Consequences.** UI не может скрыть точное состояние и не может превратить `failed` в `done`: `done` достижим только переходом `integrating → done`, требующим привязанного approval и завершённой интеграции.

**Migration impact.** Новые модули `contracts/src/board.ts` и `core/src/board.ts`; `tests/boundaries.test.mjs` расширяется.

**Tests.** Property-тест на 16/16 и на единственность зоны; `projectTaskZone('failed') !== 'done'`; `assertSinglePlacement` отвергает дубликат; `legalDropTargets(state)` равен `allowedTaskTransitions(state)` без рёбер, доступных только через `admitAttempt`.

---

## ADR019. Ideas are separate intake entities

**Context.** Владелец требует Idea Bank как отдельную сущность с действиями «Разработать план» и «Создать быструю задачу», при этом сама идея никогда не запускается автоматически. В v0.1 нет ни строки authority для идей, ни сущности.

**Decision.** `Idea` — отдельная сущность MyWork DB. Authority-матрица расширяется строкой `idea.bank` → `mywork-db`. Идея не имеет attempt, не участвует в admission и не является `TaskState`. Быстрая задача проходит **минимальный approved-plan flow** и обычные проверки запуска (terminal check, readiness, guard-ы), то есть не является обходом дисциплины планирования.

**Rejected alternatives.**
- `draft` + label: смешивает intake с планированием, и `draft` уже участвует в state machine.
- Запись идеи в Beads: идея не работа и не должна попадать в `bd ready`.
- Автозапуск идеи при достижении какого-то условия: прямо запрещено владельцем.

**Consequences.** Idea Bank живёт вне Task Graph и вне admission. Planner вызывается только явным действием человека. Идея может быть `captured`, `refining`, `promoted`, `parked`, `dropped`.

**Migration impact.** Новая миграция `idea-bank`; новые error codes `IDEA_CONFLICT`; новые события `idea.created`, `idea.promoted`.

**Tests.** Идея не проходит admission ни через API, ни через bulk; «Разработать план» создаёт PlanMutation и не создаёт attempt; быстрая задача без утверждённого плана отвергается; устаревший `expectedIdeaRevision` даёт `STALE_REVISION`.

---

## ADR020. One resident scheduler and one workflow engine

**Context.** §16 v0.1 фиксирует resident controller; §3.2 — что scheduler не является LLM. Владелец отдельно требует не создавать второй scheduler для доски. При этом нужен workflow engine с approval gates, ветвлениями, retries и escalation.

**Decision.** Один resident controller владеет **и** admission, **и** workflow-движком. Engine **просит** admission у scheduler'а и никогда не адмитит сам. Отдельный scheduler для доски не создаётся. Пауза admission — один механизм, используемый и staged plan mutation, и ручной паузой workflow.

**Rejected alternatives.**
- Второй scheduler в UI-плагине: нарушает single-writer и создаёт два источника расписаний.
- Engine как отдельный сервис со своим таймером: дублирует lifecycle и recovery.
- Выполнять ветвления и retries в UI: UI не владеет runtime (§3.7).

**Consequences.** Single-writer сохраняется. Recovery после restart — один. `FrozenRevisions` attempt'а фиксируют `workflow` revision, поэтому изменение workflow не влияет на идущую попытку.

**Migration impact.** Workflow engine — новый bounded context контроллера; §16 не меняется.

**Tests.** Два контроллера не становятся writer одновременно; engine не адмитит в обход scheduler'а (счётчик admission-вызовов); после restart engine возобновляется в верном узле без дубля старта.

---

## ADR021. Native DSH slots first, DSH-web adapter second

**Context.** Legacy-доска встроена через DOM и не может быть перехвачена штатно. Владелец требует заменить старую доску только для проектов MyWork, оставить старые карточки доступными до явного импорта и никогда не утверждать, что старый scheduler остановлен, только потому что его UI скрыт.

**Decision.** Основной путь — нативные слоты DSH. Legacy-доска **не трогается** для не-MyWork проектов. После подтверждённого cutover для конкретного воркспейса legacy остаётся архивом, доступным read-only ссылкой. MyWork никогда не претендует на остановку legacy-scheduler'а, если не выполнена верифицированная процедура отключения. Ни один DOM-хук не используется как основной путь; совместимость — только чтение legacy-ledger и `GET /api/task-board/state`.

**Rejected alternatives.**
- Перехват `[class*="centerCol"]` или скрытие чужой панели: война за DOM, хрупкость, нарушение чужих ожиданий.
- Удаление или отключение legacy-плагина: ломает остальные проекты.
- Утверждение об остановке scheduler'а по факту скрытия UI: недопустимая подмена доказательства.

**Consequences.** Обе доски сосуществуют. Cutover — per-workspace и обратимый до момента отключения расписаний.

**Судьба legacy-плагина (решение владельца, 2026-09-18).** В леджере нет карточек ни одного другого проекта — только DSH-MyWork. После верифицированного cutover строка `web-ui-task-board` **убирается из профиля**. Это убирает три вещи, которые MyWork не может контролировать со своей стороны: безусловный daily-heartbeat на `dsh-market.com` без выключателя, DOM-наблюдатель на `document.body` и инъекцию в центральную колонку, а также риск того, что кто-то включит legacy auto-run и получит второго исполнителя на тот же проект. Решение обратимо одной строкой в `cordis.patch.yml`.

Следствие для архитектуры: **архив читается из файла `ledger-v2.json` напрямую, а не через `GET /api/task-board/state`**. Read-only ссылка на архив обязана работать при отсутствующей строке плагина, поэтому HTTP-источник допустим только как опциональное дополнение, пока плагин ещё смонтирован.

**Migration impact.** Новый `LegacyBoardPort` (adapter kind `task-board`, `adapterId: 'dsh-task-board-legacy'`), read-only.

**Tests.** MyWork-панель не удаляет `data-dsh-taskboard-active` и не трогает чужие атрибуты; legacy-карточки видны до импорта; при отсутствии безопасного hook-а отображается read-only ссылка; не-MyWork проект не изменён.

---

## ADR022. Theme/skin token bridge and wallpaper contrast

**Context.** DSH определяет 371 `--dsw-*` токен, включая семантические алиасы поверхностей, текста, границ и состояний, а также `--dsw-alias-bg-mask-photo`. Владелец требует, чтобы фон и тема могли быть любыми (тёмными, светлыми, с wallpaper, с пользовательскими skin-center темами), чтобы цвет не был единственным сигналом и чтобы выдерживался WCAG AA.

**Decision.** Мост токенов `--dsw-*` → `--mw-*` с литеральными fallback'ами; ни одного hex-литерала в компонентах. `ThemeCapability` определяется в рантайме: `mode` (dark/light), `surface` (opaque/translucent/transparent), `wallpaper` (по `--dsw-alias-bg-mask-photo`), `highContrast` (`prefers-contrast: more` плюс измеренный контраст), `reducedMotion` (`prefers-reduced-motion: reduce`). `resolveSurfacePolicy(capability, measuredContrast)` — чистая функция, повышающая alpha поверхности до 1 при wallpaper, при контрасте текст/поверхность ниже 4.5:1 и при high-contrast.

Wallpaper виден только в безопасных пространствах: фон панели и гаттеры. Внутри карточек и в sticky-заголовках фон всегда непрозрачный.

**Rejected alternatives.**
- Собственная палитра: ломается на пользовательских темах.
- Фиксированная тёмная тема: владелец явно требует светлый вариант.
- Ветвление поведения по конкретному `data-dsh-skin`: привязывает MyWork к чужому релизу.
- Цвет как основной сигнал состояния: недоступно.

**Consequences.** Доска работает на любой теме. Контраст и непрозрачность становятся вычисляемыми, а не угадываемыми.

**Migration impact.** `contracts/src/theme.ts`, `core/src/theme.ts`, CSS-слой `packages/web`.

**Tests.** Пять режимов (light, dark, wallpaper, high-contrast, reduced motion) проходят с записанным измеренным контрастом; при wallpaper alpha = 1; фоновое изображение не видно внутри карточек; focus ring ≥ 3:1 к обоим соседним цветам и никогда не снимается; в собранном бандле нет hex-литералов.

---

## ADR023. Beads capability-aware adapter

**Context.** Beads 1.3.0 предоставляет `GET /v0/beads/context` со списком реализованных операций, а CLI и HTTP покрывают разные наборы: `dep_remove` есть только в CLI-батче, guard-ы — только в HTTP batchApply и в одиночном `bd update`. Возможности зависят от сборки и от способа подключения.

**Decision.** Адаптер объявляет и **проверяет** возможности: `http`, `graph-apply`, `batch`, `batch-dep-remove`, `guarded-batch`, `metadata-set`, `events-journal`, `claim-lease`, `heartbeat`, `reclaim`. Отсутствующая возможность — типизированный отказ (`CAPABILITY_UNSUPPORTED`), а не эмуляция и не молчаливая деградация. Discovery — `GET /v0/beads/context`; при CLI-only режиме — детерминированный probe-набор.

**Rejected alternatives.**
- Предположить полный набор: обещание атомарности там, где её нет.
- Эмулировать атомарность в адаптере: скрывает реальный риск от вызывающего кода.
- Требовать только HTTP: теряет `dep remove` и работу без `bd serve`.
- Требовать только CLI: теряет guard-ы `batchApply`.

**Consequences.** Composite-операции атомарны там, где backend их даёт; остальное идёт staged (ADR024). Приоритет инвертируется явно (`myworkPriority = 4 − bdPriority`). Metadata пишется только ключевыми операциями. При отсутствии beads-воркспейса адаптер отказывает fail closed и выдаёт точную команду инициализации, **не выполняя `bd init`**.

**Транспорт (решение владельца, 2026-09-18).** Адаптер **CLI-only**. `bd serve` не поднимается: это стоило бы второго долгоживущего процесса, порта, токен-файла и надзора, а даёт только guard `expected_version` на composite и стрим `events:watch` — при том что дыру с guard'ом и так закрывает staged-мутация (ADR024). HTTP-транспорт остаётся **спроектированным, но не построенным** портом: манифест объявляет `http=false`, и по правилу «отсутствующая возможность — типизированный отказ» composite с ожидаемой ревизией всегда идёт через staged, а не эмулируется. Discovery возможностей в CLI-режиме — детерминированный probe-набор команд.

**Готовность читается из `bd ready` и `bd blocked`, а не из поля.** `bd schema` объявляет у issue поле `is_blocked`, но `bd list --json` его не отдаёт — ни у одной задачи, включая те, что `bd blocked` считает заблокированными. Опираться на это поле запрещено; проекция обязана брать готовность из готовых запросов или вычислять её из статусов зависимостей.

**Семантика статусов подтверждена экспериментом.** На изолированных задачах проверено: `wip`-статусы (`mw_planned`, `mw_failed`) не появляются в `bd ready`; единственный ready-статус — `open`; зависимый от `wip`-блокера заблокирован; **зависимый от `frozen`-блокера тоже заблокирован** — то есть `cancelled`/`superseded` в frozen-категории действительно не удовлетворяют зависимость. Некатегоризованный статус тоже исключён из `bd ready`, поэтому неполный `status.custom` не ломает готовность, но делает категории неявными; полный набор из десяти статусов — требование, проверяемое Doctor'ом.

**Расположение воркспейса и его следствия.** `bd` отказывается создавать вложенный воркспейс (нашёл `.beads` у предка и прервался), а любая команда из подкаталога репозитория попадает в воркспейс предка — включая `bd config set`. Отсюда: контрактные тесты обязаны работать на воркспейсе **вне дерева репозитория**. `bd worktree` разделяет базу с основным репозиторием через git common directory discovery, ручной redirect не нужен. Journal — per-branch, поэтому курсор инвалидируется не только после `bd dolt pull`, но и при смене Dolt-ветки.

**Migration impact.** Каталог флагов в `adapter-sdk/capabilities.ts`; `TaskGraphPort` в contracts.

**Tests.** При `guarded-batch=false` composite с guard отказывает, а не деградирует; round-trip приоритета на 0..4 и на отсутствующем значении; concurrent claim — ровно один победитель; cycle и stale revision отвергаются; повтор идемпотентен; journal читается курсором, после sync выполняется re-baseline.

---

## ADR024. Staged plan mutation with admission pause

**Context.** Сложное перепланирование требует одновременно: создать задачи, обновить поля (включая metadata и labels), добавить и **удалить** зависимости. Ни один примитив Beads этого не покрывает: HTTP `batchApply` умеет create/update/close/`dep_add` с guard-ами, но **не умеет `dep_remove`**; CLI `bd batch` умеет `dep remove`, но не умеет metadata/labels/description и не имеет ни одного guard-а; `bd create --graph` атомарен, но только для создания.

**Decision.** Формулировка ADR: **«atomic where backend supports it; staged activation otherwise»**. Для composite-мутации с `dep_remove` применяется staged operation:

1. **Admission pause** — новые admission приостанавливаются (тот же механизм, что и ручная пауза workflow).
2. **Staged-запись** — намерение сохраняется в MyWork DB до любого изменения графа.
3. **Применение** — поддерживаемые части идут штатными atomic-примитивами; неподдерживаемая часть (`dep_remove`, metadata в составе composite) применяется отдельным шагом.
4. **Integrity verification** — проверка отсутствия циклов, перечитывание графа, diff по зависимостям.
5. **Commit staged → resume** — только после успешной верификации очередь возобновляется.

При ошибке план остаётся в `PLAN_MUTATION_RECOVERY`: видно полное намерение и фактическое состояние, частично невидимого DAG не возникает, ни один зависимый не стартует.

**Rejected alternatives.**
- Обещать физическую атомарность: ложное обещание, скрывающее реальный режим отказа.
- Best-effort применение без записи намерения: при сбое непонятно, что должно было быть.
- Пересоздание DAG целиком через `bd create --graph`: новые id ломают внешние ссылки, историю и provenance.
- Игнорировать `dep_remove` и оставлять лишние рёбра: молчаливое искажение графа.

**Consequences.** Есть окно паузы — это осознанная цена за честность. Владелец выбрал именно этот режим («с паузой»).

**Migration impact.** Миграция `staged-plan-mutation`; error codes `PLAN_MUTATION_STAGED`, `PLAN_MUTATION_RECOVERY`, `ENTITY_CYCLE`; события `plan.mutation.staged/applied/recovered`, `admission.paused/resumed`.

**Tests.** Сбой на середине → recovery, ни один зависимый не стартовал; после resume очередь возобновляется; повтор staged не дублирует задачи; цикл отвергается до применения; integrity verification обнаруживает расхождение и переводит в recovery, а не в success.

---

## ADR025. Imported legacy boards preserve provenance and do not transfer authority

**Context.** Legacy-ledger — JSON-файл чужого плагина со своей authority, своим scheduler'ом и своей интерпретацией завершения. Владелец требует: доска заменяет старую только для проектов MyWork; старые карточки остаются доступны до явного импорта; импорт выполняется мастером с предварительным просмотром; после подтверждённой миграции старые запуски и расписания отключаются; работающие задачи не убиваются молча.

**Decision.** Импорт односторонний и явный: `preview → select → commit`. Переносятся source ID, история, execution links и provenance. Authority переходит к MyWork **только** после подтверждённого cutover. **`done`-карточки не импортируются** (решение владельца): они остаются в legacy как архив, доступный read-only ссылкой; колонка «Готово» в MyWork после миграции пуста и наполняется только MyWork-приёмкой.

Чужое исполнение **не** превращается в `Attempt`: оно переносится как исторический `ExternalExecutionRef`, потому что выдумывать MyWork-попытку из чужого прогона нельзя. Открытые исполнения блокируют commit и требуют выбора «дождаться» или «явно отменить»; автоотмены нет. Отключение legacy-расписаний — только после верифицированного переноса всех выбранных карточек и явного подтверждения человеком.

**Rejected alternatives.**
- Писать в legacy-ledger: превращает MyWork во второго писателя чужого файла.
- Двойная authority на время миграции: два источника истины приводят к расхождению.
- Импортировать `done` с маркером: изображает приёмку, которой не было.
- Автоотмена работающих задач: прямо запрещено владельцем.
- Утверждать остановку legacy-scheduler'а при отсутствии hook-а: подмена доказательства.

**Consequences.** История честно разделена: «Готово» в MyWork означает MyWork-review и MyWork-интеграцию. Доступ к legacy-истории сохраняется ссылкой, но не создаёт вторичной истины.

**Migration impact.** `contracts/src/import.ts`, миграция `import-ledger`, error codes `IMPORT_REFUSED`, `IMPORT_IN_PROGRESS`, `LEGACY_UNREACHABLE`.

**Tests.** Хеш legacy-ledger до и после мастера совпадает; `done`-карточки не выбираются и не появляются в `done`; открытый execution блокирует commit; повтор commit идемпотентен по `sourceId`; хеш не-MyWork проекта неизменен; отказ от импорта при запрещённых ключах (`shell`, `command`, `executable`, `args`) отклоняет весь импорт.

---

## ADR026. Independent AI review and human integration

**Context.** §18.3, §26, ADR-009 и ADR-011 уже требуют независимого review и привязки approval к immutable revision. Владелец фиксирует режим по умолчанию **L2**: автоматический worker, независимый AI-review, ручная интеграция человеком. L3 — полный автоматический цикл, включаемый отдельно для workspace/workflow.

**Decision.** L2 по умолчанию: worker → детерминированная verification → независимый AI-review → human integration gate → integrate → done. Reviewer обязан отличаться от worker'а и не иметь прав `IMPLEMENTATION_WRITE_PERMISSIONS`. Approval привязан к `headSha` и `diffHash`: изменение HEAD инвалидирует approval, а не переносится молча. `done` требует **и** review, **и** интеграции.

L3 разрешён только там, где явно включён, и авто-утверждает **только additive-план при выполненных структурных условиях**. Решение о безопасности не может опираться на суждение модели, поэтому классификация детерминирована: `PlanMutationClass` = `additive-only` (все операции — create или ребро между двумя новыми задачами), `modifying` (любое обновление существующей задачи или ребро к существующей), `destructive` (любое удаление или переход в cancelled/superseded). Каждая новая задача обязана нести `TaskClaims { paths[], labels[] }`, которые выдаёт Planner. Предикат автоутверждения — чистая функция: класс `additive-only` **и** у каждой новой задачи непустые claims **и** claims не пересекаются ни с одной существующей задачей **и** work type ∈ {code, document, research} **и** ни одного `HUMAN_GATES`. Отсутствие claims — отказ, а не разрешение. Гейты `HUMAN_GATES` (`dependency-upgrade`, `schema-migration`, `security-change`, `release`, `production-access`) не закрываются автоматически ни при каком autonomy level.

**Rejected alternatives.**
- `done` по собственной интерпретации worker'а: ровно та ошибка, которую демонстрирует legacy-доска.
- Самоприёмка: нарушает независимость.
- L3 с авто-утверждением любого валидного плана: running-задачи и scope переписывались бы без human decision, что расходится с §10.3.
- Человеческий gate на план при любом autonomy level: L3 перестаёт быть полным циклом.

**Consequences.** Нет false Done. UI не может обойти review. Импортированные legacy-`done` не участвуют в этой цепочке и не попадают в MyWork вообще (ADR025).

**Migration impact.** Policy в workflow engine; `core/src/review.ts` уже готов частично.

**Tests.** Reviewer с тем же `agentId`, что worker, отвергается; reviewer с `workspace.write`/`git.write` отвергается; approval с чужим `diffHash` недействителен; `done` без review недостижим; L3 авто-утверждает только additive и записывает классификацию в audit; не-additive план под L3 поднимает gate.

---

## ADR027. Typed/trusted gates instead of raw card shell commands

**Context.** И ttmouse/dsh-taskboard, и legacy-доска допускают gate/проверку, выражаемую командой оболочки. Для MyWork это неприемлемо: произвольная команда в карточке или в документе workflow — это escape hatch, обходящий §31 (authorization), §34 (audit) и границы workspace.

**Decision.** Все gate'ы типизированы. Узел `verify` ссылается на `VerificationId` из Verification Registry, а не на строку. Условия выражаются **закрытым** языком: `{ left: <поле из закрытого каталога>, op, right: <литерал> }` с `&&`, `||`, `!`. Каталог полей перечислим и версионирован (`attempt.result`, `review.verdict`, `evidence.<kind>.present`, `task.priority`, `task.workType`, `gate.<id>.decision`, `attempt.attemptNumber`, `metrics.tokens`, `metrics.wallClockMs`). В схеме узла и в схеме правила **нет поля**, способного выразить shell, команду, исполняемый файл или код. Визуальный редактор строит ровно такой документ и не имеет свободного поля кода.

**Rejected alternatives.**
- Shell-строка в карточке: недопустимо.
- Произвольный шаг workflow: то же, но спрятанное глубже.
- Плагин-скрипт в gate: расширяет поверхность атаки и не проверяем.
- Динамический eval выражений: не тотален и не аудируем.

**Consequences.** Документ workflow безопасен по построению. Валидатор один и тот же у engine и у редактора, поэтому редактор не может создать документ, который engine отвергнет.

**Migration impact.** `contracts/src/workflow.ts`, `contracts/src/rule.ts`, `core/src/workflow.ts`.

**Tests.** Документ с ключом `shell`/`command`/`executable`/`exec` отвергается с `WORKFLOW_INVALID`; неизвестный `VerificationId` отвергается; неизвестное поле условия отвергается; `evaluateCondition` тотальна на закрытом каталоге; ни одно правило не исполняет код.

---

## ADR028. Work-type-specific finish criteria

**Context.** Владелец требует поддержки любых типов работы: код, исследования, документы, ручные операции, анализ, задачи без Git. §18.1 даёт один путь `approved → integrating → done`, а §19/§20 описывают интеграцию через Git. Для не-Git работы это неприменимо буквально.

**Decision.** Вводится `WorkType` и `FinishCriteria`:

| WorkType | requiredEvidence | verification | integrationStrategy | human acceptance |
|---|---|---|---|---|
| `code` | `diff`, `test-report` | build, test, boundary | `git-merge` | на интеграции |
| `research` | `worker-report`, `review-verdict` | source-citation, claim-support | `artifact-publish` | да |
| `analysis` | `worker-report`, `review-verdict` | claim-support, data-provenance | `artifact-publish` | да |
| `document` | `worker-report`, `design-doc` | structure, terminology, link-check | `artifact-publish` | да |
| `manual` | `manual-receipt` (или `screenshot`) | operator-attested checklist | `manual-receipt` | всегда |
| `non-git-ops` | `worker-report` (или `build-log`) | command-receipt | `none` | да |

Состояние `integrating` сохраняется для всех типов: меняется не state machine, а поведение интегратора. Engine **отказывает** в `done`, пока обязательный evidence для work type отсутствует (`FINISH_CRITERIA_UNMET` с указанием отсутствующего `ArtifactKind`).

**Rejected alternatives.**
- Один критерий для всех: исследование и ручная операция завершались бы по критериям кода.
- `done` по отчёту worker'а: снимает независимую проверку.
- Пропуск `integrating` для не-Git типов: ломает таблицу переходов и лишает завершение проверяемого шага.

**Consequences.** Для каждого типа свой честный критерий завершения. Карточка показывает недостающий evidence прямо в зоне.

**Migration impact.** `contracts/src/worktype.ts`, `core/src/worktype.ts`; `ARTIFACT_KINDS` расширяется на `manual-receipt`, `web-citation`, `design-doc` (аддитивно; ни одно сохранённое значение не переинтерпретируется).

**Tests.** `done` без `test-report` для `code` отвергается с `FINISH_CRITERIA_UNMET`; `manual` требует receipt; `non-git-ops` не создаёт worktree; каждый тип резолвит различный набор критериев.

---

## 1. Девять визуальных зон

Раскладка по умолчанию — сетка 3×3 из девяти независимых панелей. Порядок зон фиксирован и совпадает с порядком чтения и обходом с клавиатуры. Строки несут семантику фаз.

| # | Зона | Иконка | Строка | Фаза |
|---|---|---|---|---|
| 1 | Идеи | lightbulb | 1 | intake / queue |
| 2 | Бэклог | list | 1 | intake / queue |
| 3 | К выполнению | play | 1 | intake / queue |
| 4 | В работе | circle-dashed | 2 | active |
| 5 | На проверке | eye | 2 | active |
| 6 | Заблокировано | ban | 2 | active |
| 7 | Ошибка | alert-triangle | 3 | terminal / exception |
| 8 | Готово | check-circle | 3 | terminal / exception |
| 9 | Отменено | circle-slash | 3 | terminal / exception |

Альтернативный режим — `strip-horizontal`: те же девять зон в одну строку с горизонтальным скроллом; включается вручную и автоматически при ширине панели менее 1100 px.

---

## 2. Beads: стратегия записи

**Принцип: atomic where backend supports it; staged activation otherwise.**

| Операция MyWork | Примитив | Атомарность |
|---|---|---|
| Composite create + edges | `bd create --graph` | Атомарно (одна транзакция, включая cycle-check) |
| Одиночный transition / priority / title / assignee | `bd batch` (`update <id> k=v`) | Атомарно в рамках одного вызова |
| Composite `create`/`update`/`close`/`dep_add` с ожидаемой ревизией | HTTP `issues:batchApply` + `expected_version` — **спроектировано, не построено** (транспорт CLI-only) | Недоступно; идёт через staged (ADR024) |
| Claim | `bd update --claim` / HTTP `:claim` | Атомарный CAS |
| Composite с `dep_remove` или с metadata/labels в составе | **Staged** (ADR024) | Atomic где поддержано, staged иначе |
| Metadata | `--set-metadata` / `--unset-metadata` или HTTP `metadata:{set,unset}` | Только ключевые операции; документная замена запрещена |

**Mapping статусов.** `draft`→`mw_draft`(wip), `planned`→`mw_planned`(wip), `ready`→`open`(active), `assigned`/`executing`→`in_progress`(wip), `awaiting-review`/`reviewing`→`mw_in_review`(wip), `approved`→`mw_approved`(wip), `integrating`→`mw_integrating`(wip), `done`→`closed`(done), `blocked`→`blocked`(wip), `changes-requested`→`mw_changes_requested`(wip), `failed`→`mw_failed`(wip), `needs-attention`→`mw_needs_attention`(wip), `cancelled`→`mw_cancelled`(**frozen**), `superseded`→`mw_superseded`(**frozen**).

Точный `TaskState` хранится в `mywork.state`; статус Beads несёт readiness-проекцию. При расхождении статус побеждает для readiness, а MyWork поднимает `needs-attention` и пишет audit — молчаливой правки нет.

**Cancelled и superseded не удовлетворяют зависимость.** Они попадают в frozen-категорию, выпадают из `bd ready` и из default list, поэтому зависимый остаётся заблокированным, пока MyWork не потребует явного решения: `void` (снять ребро staged-мутацией), `keep-blocking` (оставить) или `supersede-dependent`. Это прямое следствие требования владельца.

**Приоритет.** Beads `0..4`, `0` — высший; MyWork contract — higher number first. Адаптер конвертирует явно и тестирует round-trip, включая отсутствующее значение (Beads P2 → MyWork `2`).

**Metadata.** Namespaced `mywork.*`. Зарезервированные префиксы Beads `bd:` и `_` не занимаются.

**Outage.** Активные попытки наблюдаются и доводятся до конца; новые admission отклоняются fail closed; доска отдаёт `DegradedProjection` с причиной и временем. Никакой попытки мутировать граф в degraded-режиме.

**Journal.** Ускоряет инкремент, но не является единственным механизмом синхронизации: off by default, per-branch, per-replica со своим seq-space, raw `bd sql` не журналируется. После `bd dolt pull`/merge — обязательный re-baseline; checkpoint хранится per replica.

**Beads-воркспейс.** Адаптер никогда не выполняет `bd init`: инициализация — решение владельца в его репозитории. Если воркспейса нет, адаптер отказывает fail closed и выдаёт точную команду.

**Где живёт Task Graph (решение владельца, 2026-09-18).** Репозиторий-локальный `.beads/` в корне рабочего репозитория, backend dolt, режим embedded, prefix `mw`. Каталог скрыт от git через `.git/info/exclude`, а не через отслеживаемый `.gitignore`: это репозиторий-локальная настройка, не попадающая в upstream и не затрагивающая общий `.gitignore`. Права инициализации: `--skip-agents` (иначе в корне появляется `AGENTS.md` и setup-файлы AI-инструментов) и `--skip-hooks` (git-хуки ставятся отдельной командой `bd hooks install`).

Выбрано вместо `BEADS_DIR` вне репозитория, потому что git-интеграция Beads — ветки Dolt-базы, `bd worktree`, sync — load-bearing для §19 (изолированный worktree на каждую попытку). Вынос базы за пределы репозитория ломает ровно ту интеграцию, ради которой Beads выбран. Варианты `--shared-server` и `--global` отклонены: первый добавляет машине ещё один сервис с собственным жизненным циклом, второй нарушает изоляцию воркспейсов из §52.

Эксплуатационные требования, вытекающие из инициализации:

- **Связь карточки с задачей** идёт через `external_ref` вида `mw-card:MW-0XX`, а не через id: Beads id — `<prefix>-<hash>`, он не совпадает с id карточки.
- **Dolt-remote не является зависимостью.** `bd init` прописывает `origin` как Dolt remote, но недоступность origin не должна блокировать работу: sync через remote не заявляется, `bd dolt push/pull` вне scope.
- **Dolt-корень должен быть доступен на запись.** При недоступном Dolt-корне `bd init` падает паникой (nil-pointer, exit 2) вместо чистой ошибки. Адаптер обязан распознавать такой отказ по exit code и stderr и выдавать `ADAPTER_UNAVAILABLE` с Doctor-пунктом, а не повторять вызов. Обычные операции записи (`create`, `list`, `delete`) при доступном корне работают и под ограниченной песочницей агента.

---

## 3. Границы интеграции с DSH

**Занимаемые ключи.** `main`/`mywork` и `sidebar.panellist`/`mywork`. Ключ `conversation` не занимается никогда.

**Транспорт.** Браузерная половина ходит только в host-маршруты MyWork. Маршруты регистрируются через **`connection.fetch.register({ path, methods, requestBody, fetch })`** точными путями под `/api/mywork/...` и тем самым **наследуют** Host/Origin-проверки и browser-session-аутентификацию: `client-connection` держит единственный prefix-маршрут `/api`, который сперва вызывает `requestRejection(req)` и только затем передаёт запрос в общий fetch-обработчик, а тот ищет точный путь среди зарегистрированных. Собственный Host/Origin-guard не пишется — это дублирование security-логики. Регистрация возвращает disposer и висит на fiber владельца, поэтому выгрузка плагина снимает маршруты. `requestBodyMode` объявляется на каждый маршрут. Management-токен Beads в браузер не передаётся ни в каком виде; UI не обращается напрямую ни к Beads, ни к scheduler. Открытый вопрос: проходит ли `http-bridge` потоковый **ответ** — если нет, канал событий уходит на собственный prefix `webServer` и только тогда с явно описанной моделью угроз.

**Инвалидация.** SSE-кадр несёт только `{ boardRevision, projectionRevision, cursor, degraded? }` и никогда карточек. Клиент при совпадении `boardRevision` не делает ничего; при несовпадении — refetch snapshot; при reconnect — `GET /v1/events?after=<cursor>`. Дубликат кадра не меняет ничего, дубликат команды отсекается inbox по `operationId` и дополнительно проверкой состояния.

**Состояние в компонентах.** Один `createBoardController()` создаётся в `apply` (module-level handles запрещены) и раздаётся регистрациям через inject-face; реактивный источник публикуется в зарезервированном `hooks`-компоненте; в компонентах нет подписок, `useSyncExternalStore` и React-контекстов. Объявленный `store` несёт только UI-состояние (выбор, выделение, плотность, ширина detail-панели, collapse зон).

**Сборка.** Отдельный пакет `packages/web` воспроизводит lazy-CJS формат самостоятельно, потому что пресет DSH не публикуется. Признак корректности — страница загружает панель без пересборки web-приложения и без правок DSH.

**Модульные externals.** Список берётся из `packages/client/web/src/platform.ts`: `PLATFORM_MODULES` = `react`, `react/jsx-runtime`, `react-dom`, `react-dom/client`, `@deepseek-ai/cordis`, `@deepseek-ai/dsh-client-store`, `@deepseek-ai/dsh-client-ui-slots`, `@deepseek-ai/dsh-client-ui-primitives`, `@deepseek-ai/dsh-client-ui-dockkit`; `PRELOADED_CLIENT_EXTERNALS` пуст. Всё это доступно бесплатно. `dsh.client.inject` — **не** объявление externals, а ребро порядка загрузки бандлов (`immediately` — stage-one barrier); `react` в нём не значится и не должен. Всё, что не попадает в `PLATFORM_MODULES`, объявляется в `dsh.client.external`, иначе build-gate отвергает сборку.

**Связь коммита с задачей (решение владельца, 2026-09-18).** Интегратор пишет в тело коммита строку `Refs: mw-<hash>`. Это даёт git-side traceability и делает осмысленными `bd orphans` и `bd preflight`, не требуя git-хуков Beads, которые в этом воркспейсе сознательно не ставились.

**HMR.** Не обещается: `dev:web` следит только за client-плагинами внутри чекаута DSH. После сборки требуется перезагрузка страницы; bundle отдаётся с `rev`, поэтому свежие байты подхватываются.

---

## 4. Что v0.2 не меняет

- §3.1–3.8, §6, §13, §14, §16, §17, §18, §19, §21–§35, §36–§53 остаются в силе без изменений.
- §62 (обязательный scope v0.1) остаётся обязательным; board-работа его расширяет, а не заменяет.
- Таблица `TASK_TRANSITIONS` не меняется: `integrating` остаётся обязательным шагом для всех work types.
- ADR-001…ADR-015 не пересматриваются.

---

## 5. Решения v0.2.1 — разбор 17 пунктов

Этот раздел закрывает места, оставшиеся недоспецифицированными после v0.2. Он **уточняет** ADR021 (транспорт), ADR024 (операторский выход), ADR025 (формы provenance), ADR026 (предикат L3), ADR027 (виды гейтов); противоречащие формулировки в этих ADR считаются заменёнными текстом ниже.

### 5.1 Planner создаёт только новое

**Решение.** Planner выдаёт **только additive**: создание задач и рёбер между новыми задачами. Изменение существующей задачи — отдельная команда `ReplanCommand` со своим approval и своим UI-путём; смешение запрещено типом. Сессия Planner'а — fresh DSH-сессия с ролью `planner` из реестра, модель по `ModelPolicy` воркспейса, права **`read-only`**; выход — artifact `planner-dag` (такой `ArtifactKind` уже существует) плюс структурированный `PlanMutation`. Утверждение — предпросмотр структурой (задачи, рёбра, claims, work type, вычисленный класс мутации) с действиями Comment / Approve / Reject. **Правка плана в UI не входит в v0.2**: вместо редактора Planner перезапускается с комментарием.

**Почему не иначе.** Если Planner может менять и удалять, каждый разбор идеи потенциально требует staged-мутации и human gate — самая частая операция становится самой дорогой. При «только создавать» создание всегда additive, применяется без staged-машинерии, и вся сложность ADR024 остаётся для редкого явного replan.

**Тест.** Мутация с `update` существующей задачи отклоняется с `PLANNER_SCOPE_DENIED`, граф не меняется; невалидный или устаревший output не меняет граф; сессия не может писать в workspace.

### 5.2 Операторский выход из staged recovery

**Решение.** Баннер в шапке доски: «Продолжить применение» (повтор integrity verification, затем применение остатка), «Откатить staged» (только шаги, помеченные обратимыми; для необратимых — отказ с перечислением), «Открыть отчёт целостности». Admission остаётся на паузе до решения. Все три доступны через Application API и CLI, не только из UI — доска сама может быть недоступна.

**Почему не иначе.** Автоматическое «дожать» опасно при неизвестной причине сбоя; автоматический откат неполон, потому что созданную задачу с привязанной попыткой откатить нельзя.

**Тест.** Kill контроллера в середине применения → recovery и пауза сохраняются; resume доводит план с пройденной integrity verification; revert восстанавливает прежний набор зависимостей; ни один путь не оставляет частично видимого DAG.

### 5.3 Конкурентность порядка и гранулярность ревизии

**Решение.** `BoardPlacement` ключуется `(viewId, taskId)`, порядок — `(zone, orderKey)`, `orderKey` — строка. Ревизия — **на `(viewId, zone)`**; move несёт `expectedColumnRevision`, несовпадение даёт `STALE_COLUMN_REVISION` и перечитывается только эта зона. Вставка — midpoint по base-62 алфавиту в `core/board.ts`, без зависимостей. При отсутствии промежутка — `ORDER_RENUMBER_REQUIRED` и одна явная перенумерация зоны в одной транзакции с одним бампом ревизии. Порядок тотален: `(orderKey, taskId)`. `pinned` — впереди.

**Почему не иначе.** Ревизия на всю доску заставляет перечитывать всё после чужого перемещения в другой зоне; перенумерация «на лету» сделала бы обычный drag многозаписной операцией.

**Тест.** Два конкурентных move в один промежуток → ровно один выигрывает; после перенумерации порядок зоны идентичен прежнему; midpoint переписывает не более одной строки; 1000 последовательных вставок заканчиваются `ORDER_RENUMBER_REQUIRED`, а не равными ключами.

### 5.4 Остановка выполняющейся карточки — композиция, а не новое ребро

**Решение.** Таблица переходов **не меняется**. Команда `task.stop-and-cancel` композирует три существующих перехода в одной операции: attempt → `cancelled` (требует текущий fence, значит доступна только владеющему контроллеру), task `executing → ready`, task `ready → cancelled` с причиной. Перед первым шагом diff worktree сохраняется как artifact `diff`; если artifact не сохранён — команда отказывает, а не отменяет работу, которую не может учесть.

**Почему не иначе.** Ребро `executing → cancelled` обошло бы revoke-путь §17 и потеряло бы гарантию освобождения lease.

**Тест.** Ровно одна попытка в `cancelled`, задача в `cancelled`, artifact `diff` создан; устаревший fence → `STALE_FENCE`; неудачная запись artifact → задача осталась в `executing`; `cancel` без композиции отвергается с именем легальной команды.

### 5.5 Гейт «блокер отменён»

**Решение.** `BlockerResolutionGate` — отдельная сущность workflow-домена, **не** значение `HumanGate` (там пять гейтов §28). Состояние **производное**: гейт открыт ровно тогда, когда существует frozen-блокер с неудовлетворённым зависимым; персистится только решение. Действия: `void` (снятие рёбер через staged), `keep-blocking` (причина обязательна), `supersede-dependent`.

**Почему не иначе.** Гейт уровня рёбер предметной модели размыл бы смысл гейтов §28 и связал бы release-политику с отменой задач.

**Тест.** Отмена блокера с двумя зависимыми даёт гейт ровно на этих двух; `void` переводит обоих в `ready`; `keep-blocking` оставляет блокированными с причиной; `supersede-dependent` переводит в `superseded`; блокер `done` гейта не порождает.

### 5.6 Аутентификация маршрутов — наследование, а не свой guard

**Решение.** Все host-маршруты MyWork регистрируются через `connection.fetch.register` точными путями `/api/mywork/...` и наследуют Host/Origin-проверки и browser-session-аутентификацию `client-connection`. Своего guard нет. Открытый остаток: потоковый ответ для SSE — проверяется первым шагом MW-029, фолбэк описан в §3.

**Почему не иначе.** Свой guard — дублирование security-логики; legacy-плагин написал его вынужденно, а не потому что наследование недоступно.

**Тест.** Запрос с чужим `Host` или без browser-auth отвергается до попадания в обработчик MyWork; дубликат пути бросает; выгрузка плагина снимает маршруты.

### 5.7 Каталог триггеров `needs-attention`

**Решение.** Закрытый каталог `NeedsAttentionReason`, каждый с детерминированным условием и названным источником: расхождение reconciliation; недоступность адаптера при живой попытке; исчерпан бюджет без допустимого retry; истёк deadline human gate; исчерпан retry-бюджет; неразрешимая зависимость после void; потеря lease без преемника. Каждый пишет audit и Doctor-пункт; карточка показывает конкретный триггер, никогда общее «требует внимания».

**Почему не иначе.** В коде сейчас **ноль писателей** этого состояния при шести достижимых входах: без каталога оно мёртвое, и вторая половина зоны «Заблокировано» не появляется.

**Тест.** Каждый из семи триггеров достижим тестом, проверяющим и состояние, и точную причину; ни один путь не ставит `needs-attention` без причины.

### 5.8 Уровни автономии и устранение коллизии имён

**Решение.** `AutonomyLevel = 'L0'|'L1'|'L2'|'L3'` по §28 (строки 1880-1883) добавляется в контракты. Шкала §21.2 в документах переименовывается в **`D0/D1/D2`** (progressive disclosure контекста), потому что сейчас одна нотация `L0/L1/L2` означает две разные вещи. Предикат L3 — см. ADR026 (уточнён выше).

**Почему не иначе.** Оставить обе шкалы под одной нотацией — гарантированная путаница в коде, где `L2` будет означать и «уровень контекста», и «уровень автономии».

**Тест.** В кодовой базе нет типа или константы, где `L0/L1/L2` относились бы к контексту; `AutonomyLevel` используется только для политики исполнения.

### 5.9 Гранулярность audit

**Решение.** Audit фиксирует **решения и смену authority**, никогда — представление. Аудируется: переходы Task/Attempt/Review, решения человека, создание ревизий (role/blueprint/workflow/rule), plan mutation staged/applied/recovered, импорт и cutover, отбрасывание evidence. Не аудируется: порядок, placement, сохранение view, плотность, collapse, выделение, фильтры, поиск. Прямое следствие: рост `boardRevision` **не** порождает audit-строк.

**Почему не иначе.** Аудит каждого перемещения превращает журнал в шум, а на нём держатся §34 и ADR015.

**Тест.** 50 перемещений внутри зоны → ноль audit-строк и 50 бампов ревизии; утверждение плана → ровно одна строка; тип каждой строки принадлежит перечислимому списку.

### 5.10 Формы provenance

**Решение.** Три контракта: `LegacySourceRef { ledgerId, sourceId, cardId, sourceRevision, sourceStatus, importedAt, originalWorkspaceId, originalModel?, originalPermission? }`; `ExternalExecutionRef { externalId, source, startedAt?, endedAt?, result, error?, sessionId?, frozenAt?, frozenBy? }`; `TaskProvenance { origin: 'native'|'imported-legacy', legacy?, externalExecutions[] }`.

**Почему не иначе.** Превратить чужой прогон в `Attempt` значило бы выдумать lease, fence и ревизии, которых не было, и сломать §17.

**Тест.** Импортированная задача имеет `origin='imported-legacy'`, непустые `externalExecutions` и **ноль** попыток; ни один attempt id не совпадает с external id; импортированная задача не может стать `done` без MyWork-review.

### 5.11 Жизненный цикл идеи после promote

**Решение.** `IdeaPromotion { ideaId, planMutationId, taskIds[], promotedAt, promotedBy?, approvedBy }`. Одна идея → N задач разрешено. История promote'ов append-only, идея из `promoted` не выходит. Повторный promote требует нового `expectedIdeaRevision` и явного действия. `dropped` терминален, но идею не удаляет.

**Почему не иначе.** Запрет повторного promote противоречил бы §10.3: планы пересматриваются.

**Тест.** Двойной promote даёт две записи и непересекающиеся наборы задач; история append-only; dropped-идея не промоутится.

### 5.12 `needs-evidence` — запрос worker'у

**Решение.** `review.request-evidence` требует findings, переводит review в `needs-evidence`, задачу `reviewing → ready` и создаёт новую попытку с типизированным полем `evidenceRequest` в промпте. Расходует retry-бюджет; при исчерпании — `needs-attention` с причиной `retry-exhausted`. `escalated` терминален для review и переводит задачу в `needs-attention` с human gate.

**Почему не иначе.** Reviewer, дособирающий evidence сам, размывает границу review и выполнения; запрос к человеку останавливает цикл там, где он может продолжиться.

**Тест.** `request-evidence` без findings отвергается; промпт новой попытки содержит evidence request; исчерпание бюджета даёт `needs-attention` с `retry-exhausted`; `escalated` не переоткрывается и всегда порождает гейт.

### 5.13 Overview — полоса, а не страница

**Решение.** Сворачиваемая полоса над сеткой 3×3: счётчики зон, активные агенты против лимитов пулов, глубина очереди review, blocked и needs-attention, расход, слоты баннеров (degraded / recovery / paused / legacy-cutover). На узких ширинах сворачивается до счётчиков и баннеров.

**Почему не иначе.** Отдельная страница разрывает связь между здоровьем системы и работой; модальные баннеры перекрывают доску.

**Тест.** Все четыре вида баннеров рендерятся в полосе и достижимы с клавиатуры; на 1024×768 полоса не вытесняет сетку за пределы первого экрана.

### 5.14–5.15 Производительность и порог раскладки — измерять, не выдумывать

**Решение.** Числа «≤200 DOM-карточек» и «p95 < 200 ms» были догадкой и в критерии приёмки не годятся. MW-049 фиксирует в отчёте число DOM-узлов, время рендера и p50/p95 фильтрации на 100/500/1000/2000 карточках, после чего критерии становятся **относительными**: узлов на 2000 не более 1.5× от 1000, задержка фильтрации на 2000 не более 2× от 1000. Порог переключения раскладки измеряется с реальным содержимым на 900/1024/1100/1280/1440/1920; до измерения 1100 px помечен как предварительный.

**Тест.** Оба относительных утверждения, замеренные на двух размерах; на пороге минус 1 px раскладка `strip-horizontal`, на пороге — `grid-3x3`, заголовок зоны не обрезан ни в одном режиме.

### 5.16 `status.custom`

**Решение.** Механическая правка: набор из десяти статусов ADR023 дополняется и проверяется Doctor'ом. Владелец — MW-010. Неполный набор не ломает готовность (некатегоризованный статус тоже исключён из `bd ready`), но делает категории неявными.

**Тест.** При неполном наборе адаптер предупреждает и Doctor перечисляет отсутствующие статусы; при полном — предупреждения нет.

### 5.17 Состояния недоступности доски

**Решение.** Явные состояния панели `loading | ready | empty | degraded | unavailable | recovery | paused`. `unavailable` — когда `ctx.get('myworkController')` не определён или у выбранного воркспейса нет регистрации MyWork; показывает причину и действие «повторить», но никогда не пустую доску. `degraded` — замороженный снимок с его временем. `paused` — причину паузы admission. `recovery` — баннер recovery.

**Почему не иначе.** Пустая доска неотличима от «задач нет», и пользователь не понимает, что контроллер не смонтирован.

**Тест.** Выгрузка контроллера и перезагрузка дают `unavailable`, а не `empty`; пустой здоровый воркспейс даёт `empty` с действием «создать»; отказ Beads даёт `degraded` со временем снимка.

### 5.18 Сводка контрактных добавлений

| Артефакт | Что добавляется |
|---|---|
| `contracts/src/workflow.ts` | `AutonomyLevel`, `PlanMutationClass`, `TaskClaims`, `BlockerResolutionGate` |
| `contracts/src/board.ts` | `NeedsAttentionReason`, `BoardPanelState` |
| `contracts/src/import.ts` | `LegacySourceRef`, `ExternalExecutionRef`, `TaskProvenance` |
| `contracts/src/idea.ts` | `IdeaPromotion`, `ReplanCommand` |
| `contracts/src/audit.ts` | `workflow.revised`, `gate.decided`, `plan.mutation.applied\|recovered`, `import.committed`, `evidence.discarded` |
| `contracts/src/operation.ts` | `PLANNER_SCOPE_DENIED`, `ORDER_RENUMBER_REQUIRED`, `STALE_COLUMN_REVISION`, `EVIDENCE_REQUEST_REQUIRED` |
| `core/src/board.ts` | midpoint-вставка, тотальность `(orderKey, taskId)` |
| `core/src/workflow.ts` | предикат автоутверждения L3 как чистая функция |

### 5.19 Что остаётся неизвестным

- Проходит ли `http-bridge` потоковый ответ (SSE через унаследованный маршрут) — первый шаг MW-029.
- `bd update --metadata` — замена или merge: не детерминировано, обход в контракте.
- Ключ claim-TTL в Beads 1.3.0 не найден; обход — собственный lease MyWork.
- Нужен ли Dolt-корень на каждом вызове `bd` или только на init — проверяется в контексте хоста.
- Поведение journal-курсора при `git checkout` внутри worktree.
