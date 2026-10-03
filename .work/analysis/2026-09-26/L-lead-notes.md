# Lead-заметки: платформенная дельта и карта конфликтов «документ ↔ план»

**Роль:** заметки Lead'а (судья/верификатор) кампании «DSH MyWork — глубокий анализ v2». Это не отчёт потока, а собственные проверки Lead'а, на которые опирается финальный отчёт. Все факты получены командами в сессии 2026-09-26.

---

## Часть 1. Дельта платформы DSH: от базы плана MyWork до rc.2

### 1.1. Точки отсчёта (проверено)

| Метка | Дата | Коммит | Комментарий |
|---|---|---|---|
| `dsh-v0.1.5-rc.2` | 2026-09-10 | `fb2c4b9e69` | **База фактов плана MyWork v0.2**: `.work/architecture/DSH-My-Work-Architecture-v0.2-decisions.md:9` — «Основание: EXECUTION-PLAN.md, исследование DSH `0.1.5-rc.2`, Beads 1.3.0, установленного `dsh-task-board` 0.3.23». Дата фиксации решений — 2026-09-18 (`:9`) |
| `dsh-v0.1.7-alpha.1` | 2026-09-22 | `c36a83ff6b` | |
| `dsh-v0.1.7-rc.1` | 2026-09-23 | `46a7f68b09` | |
| `dsh-v0.1.7-rc.2` | 2026-09-24 | `477b4f4205` | Версия, на которой стоит внешний документ и текущий checkout |
| текущий HEAD checkout | 2026-09-26 | `c7c4c725c7` | `+1` коммит к rc.2 (`git rev-list --count 477b4f4..HEAD` = 1) |

**Дельта:** `git -C <DSH> rev-list --count dsh-v0.1.5-rc.2..dsh-v0.1.7-rc.2` = **3 650 коммитов** за 14 календарных дней (10.09 → 24.09). Разбивка по типам: `fix` 1010, `test` 462, **`feat` 329**, `docs` 265, `refactor` 202, `perf` 29, `revert` 7. Затронутые области по числу изменённых файлов: `packages/client` 12 524, `packages/api` 1 537, `packages/experimental` 1 431, `packages/boot` 1 209, `packages/llm` 1 102, `packages/session` 866, `packages/bundle` 531, `packages/subagent` 523.

**Вывод 1.** План MyWork v0.2 (и его ADR016–ADR028) зафиксирован на базе, которая старше текущей платформы на 3 650 коммитов и на два релизных цикла (0.1.5-rc.2 → 0.1.7-rc.2). Внешний документ, наоборот, написан на rc.2, но **не знает ни одной карточки плана** (`grep 'MW-[0-9]{3}'` по документу даёт единственное совпадение — иллюстративный пример «MW-123 / Attempt A-77» в §14, строка 518) и ссылается на ADR только в §55/§65 (строки 1456, 1778–1782). Отсюда главный риск кампании: два текста описывают один проект на разных базах и не ссылаются друг на друга.

### 1.2. Что реально появилось в платформе за эту дельту (проверено `git ls-tree` по тегам + first-commit)

Проверка: наличие пути в `dsh-v0.1.5-rc.2` против `dsh-v0.1.7-rc.2`, плюс коммит первого добавления каталога.

| Возможность | @0.1.5-rc.2 | @0.1.7-rc.2 | Первое добавление | Значение для MyWork |
|---|---|---|---|---|
| `packages/deliverables/tool-present` | НЕТ | ЕСТЬ | 2026-09-14 (`f800ea46e5`) | **Новая подсистема «что turn отдаёт пользователю»**: `present`-файлы как log-only session event + сравнение git-снимков рабочего дерева на границах turn'а + Host-сервис, пока сессия жива (`docs/subsystems/deliverables.md`). Пересекается с Evidence/Artifact MyWork (MW-008) и с finish criteria (MW-045) |
| `packages/deliverables/workspace-changes` | НЕТ | ЕСТЬ | 2026-09-15 (`a79b97ecca`) | Список изменённых файлов turn'а, сравнение по каждому файлу |
| `packages/host/product-telemetry-otel` | НЕТ | ЕСТЬ | в окне | Продуктовая телеметрия через OTLP/HTTP, только явно выбранные события, «no Session data or identifiers collected automatically» (`docs/subsystems/product-telemetry.md`) |
| `packages/experimental/auto-review` | НЕТ | ЕСТЬ | 2026-09-24 (`a3480857dd`) | Политика авто-одобрения tool-call/разрешений (не приёмка результата) — то, о чём §32 |
| `packages/boot/plugin-manager` | НЕТ (путь) | ЕСТЬ | в окне | Совместимость плагинов, bounded pnpm, takeover lock, отчёт skipped bundles |
| `packages/ssh` | НЕТ | ЕСТЬ | ~2026-09-14 (`33d89aee77`) | Новая подсистема; для MyWork — потенциальный удалённый workspace-транспорт (в плане отсутствует) |
| `packages/voice-input*` | НЕТ | (в рабочем дереве есть `packages/experimental/voice-input-bundle`) | 2026-09-22 | Не относится к ядру, но показывает темп расширения клиентской поверхности |
| `docs/subsystems/*.md` | 54 | 63 | +10 новых: `boot`, `browser-use`, `computer-use`, `deliverables`, `mcp`, `office-to-pdf`, `product-telemetry`, `ptc-runtime`, `ssh`, `voice-input` | Формальный признак «новых подсистем» |

При этом **уже существовали** на базе (то есть план мог их знать, но в §0.1 v0.2 они не упомянуты):

| Возможность | Первое добавление | Что даёт |
|---|---|---|
| `packages/typert/*` + `packages/api/gateway` | typert-путь перестроен 2026-09-20 (`ffea3c8818`), gateway — `021bd03b70` | Типизированные Remote-вызовы; **в окне дельты добавлен uplink клиент→хост для каждого Remote stream** и закрытие lifecycle-гэпов |
| `packages/llm/token-meter` | 2026-08-25 (`b565df3442`) | Снимок «давления запроса» и позиционного прайсинга поверхности: `TokenMeasurement` с `logRevision` (`docs/subsystems/token-meter.md`). Прямая замена самодельного учёта расхода в MW-013/MW-034 |
| `packages/runtime-diagnostics/invariants` | 2026-08-13 | Реестр `ctx.invariants` + конвенция `./invariant`-плагинов на пакет. Альтернатива самодельным invariant-тестам MW-039 |
| `packages/context/session-reference` + `file-reference` | ~2026-09-05 | Канонические session-URI, prepared message contexts, byte retention, стабильные ошибки, «untrusted model prompt». Готовая основа для §48 (навигация по сессиям) |
| `packages/spill/spill` | до базы | `ctx.spillStore.saveText` → модельно-адресуемый локатор; используется политикой tool-result и session-reference. Готовая механика для больших логов/диффов (§41) |
| `packages/session-query/session-query(+sqlite)` | до базы | Полнотекстовый индекс по корпусу сессий (relevant для поиска, §48, MW-050) |
| `packages/workflow/workflow` + `tool-workflow` | решение 2026-07-05 | **Один движок на контекст** (`ctx.workflowEngine`), модельно-написанный скрипт запускает субагентов, `parent` обязателен. Прямая коллизия понятий с MW-044 (свой workflow engine внутри resident controller) |
| `packages/plan/plan-mode` | до базы | Log-only состояние режима планирования |
| `packages/experimental/agent-team*` | до базы; Web-панель — `1dc518f217` (2026-09-21) | Durable roster/mailbox/task board + проекция `agentTeam` |
| `packages/schedule/*` | до базы; storage phase 1 — `7a362b263b` (2026-09-23) | Расписания; в shipped Web composition включены `e896737840` (2026-09-24) и **сразу отключены** `cad6fef2fd` (2026-09-24) |
| `packages/interaction/user-questions` | до базы | `bb19061473` timed waits + late replies (2026-09-24), затем `32905d5ab5` revert «reconcile timed questions with legacy default» (2026-09-24) |
| `packages/mcp` | 2026-09-12 | Scoped resources и server instructions |

**Вывод 2.** Формулировка «DSH обновился, нужно пересмотреть реализацию» подтверждается количественно: 329 feat-коммитов, 10 новых подсистем, peer-compat gate, auto-review, deliverables, product-telemetry — всё это появилось **после** фиксации плана MyWork. Но значительная часть того, что внешний документ подаёт как «новую официальную основу» (Typert Remote, slots, `dsh.client`, Schedule, Agent Teams), существовала уже на базе плана; в окне дельты она получила доработки (uplink, проекция Team, storage phase 1). Различие важно: для Typert реальная новая часть — uplink и границы отмены stream'ов, а не сам механизм.

### 1.3. Что из дельты напрямую меняет решения плана (предварительно, до верификации потоками)

1. **Peer-compat gate** (`2c67633990 feat(plugins): enforce DSH peer compatibility with exact exemptions`, `51d70c5f5c … typed refusals`) — новый обязательный контракт публикации; в плане MyWork его нет вообще (ни в MW-040/MW-041, ни в манифестах пакетов — все `@dsh-mywork/*` имеют только `main`, без `engines`/`peerDependencies`). Документ §33–§35 прав по существу и должен стать отдельной карточкой.
2. **Model availability** (`cc478ac70a feat(client,session-controller,llm): track available models and expose account settings`, 2026-09-18) — ровно то, чего требует §37; появилось в дельте.
3. **Auto Review** — новая экспериментальная политика; §32 верно требует не смешивать её с MyWork Review.
4. **Deliverables / token-meter / invariants / spill / session-reference / session-query / workflow seam** — существовали на базе, но в фактах плана (§0.1 v0.2 перечисляет только слоты, layout, web-server, тему, HMR и формат клиентской сборки — строки 21–34) не упомянуты и в карточках не отражены. Это **не «новое в платформе», а «неучтённое в плане»** — отдельная категория находок, и внешний документ её тоже не закрывает (он упоминает только лимит request extension в §41).
5. **Workflow-коллизия**: платформа допускает ровно один движок `ctx.workflowEngine` на контекст и понимает под workflow модельно-написанный скрипт с субагентами; MW-044 вводит собственный `WorkflowRevision` с типизированными узлами и запретом escape hatch. Нужно решение: разные имена/домены, либо MyWork-движок как провайдер платформенного seam. Ни документ, ни план этого не рассматривают.

---

## Часть 2. Карта конфликтов и пробелов «внешний документ ↔ план v0.2 ↔ код»

Проверки Lead'а (прямые, без делегирования):

- `packages/controller/src` содержит ровно три файла: `index.ts`, `model-catalog.ts`, `dsh-session.ts` (glob). Поиск по всем пакетам (`ApplicationService|HostService|BoardRead|CommandService|readModel|ReadModel`) находит только `readModelCatalog` в `packages/core/src/routing.ts:98` и упоминание в `packages/core/src/index.ts:323`. **Утверждение §2.2 подтверждается: единой application/Host-поверхности (read model, commands, watch) в коде нет.**
- Внешний документ не знает карточек плана (см. вывод 1); план, в свою очередь, не знает §20 (Typert Remote как транспорт) — карточки MW-029/MW-046/MW-047 описывают HTTP/SSE-маршруты через `ctx.webServer` (`/v1/tasks/{id}/discussion`, `/v1/attempts/{id}/steer`, SSE-инвалидация). Это **прямой конфликт транспортного решения**, а не дополнение.

### 2.1. Конфликты, требующие решения владельца

| № | Тема | План v0.2 | Внешний документ | Тип |
|---|---|---|---|---|
| K1 | Транспорт Web | MW-029 «Application API, HTTP/SSE и CLI» через `ctx.webServer`; ADR-раздел 5.6 «аутентификация маршрутов — наследование, а не свой guard» | §19–§21: официальный Typert Remote + `watch`-stream, собственный loopback HTTP не создавать | Конфликт решения |
| K2 | Модель зон доски | ADR017/ADR018: девять визуальных зон, зона = UI-группировка, `ZONE_BY_STATE` frozen в contracts; MW-049: ровно девять панелей 3×3 + порог 1100 px; MW-050: DnD с запретом прямой записи | §5.2/§6: semantic lanes (ideas/queue/work/review/error/done/closed), `blocked` — бейдж в queue, `cancelled/superseded` — скрытый closed, layout-метрики убрать из domain-контракта | Конфликт решения (частичный: принцип «зона ≠ состояние» совпадает, спор о словаре и постоянных колонках) |
| K3 | DnD как domain-команда | ADR017 уже требует: DnD не пишет состояние, строит `DropIntent`, резолвится в MyWork command и может быть отвергнут | §7: то же требование, подано как «важная архитектурная корректировка» | Документ переоткрывает уже принятое решение (нужна проверка по коду: как реализовано в `core/board.ts`) |
| K4 | Workflow engine | MW-044: свой движок внутри resident controller, `WorkflowRevision`, запрет shell/code | Не упомянут вовсе | Пробел документа + коллизия с платформенным `ctx.workflowEngine` |
| K5 | Учёт токенов/стоимости | MW-013 (бюджетный admission) и MW-034 (метрики) — свой учёт | §41 говорит только о лимите request extension | Пробел: платформенный `dsh-token-meter` не учтён нигде |
| K6 | Evidence/артефакты | MW-008 artifact store + audit; MW-045 finish criteria | Не упоминает платформенные `deliverables`/`spill` | Пробел документа; риск дублирования подсистем |
| K7 | Миграция с легаси-доски | ADR025 + MW-054: read-only адаптер, источник — файл ledger, hash-проверка, done-карточки не импортируются, после cutover строка `web-ui-task-board` убирается из профиля | §53–§54: composition-level замена, «нельзя переносить runner/scheduler/TaskStatus» | Совместимы; документ не знает про **безусловный daily-heartbeat легаси-плагина на `dsh-market.com` без выключателя** (факт v0.2 §0.3, строка 68) — это усиливает аргумент за cutover, но в документе отсутствует |
| K8 | Human gate | MW-030 (human gates, pause/cancel/retry/reassign), §5.7 каталог `needs-attention`, §5.12 `needs-evidence` | §27–§29 durable `HumanGate` как сущность, delegated child не спрашивает человека | Уточнение, не конфликт (проверяет поток E) |
| K9 | Agent Teams | В плане отсутствует как тема | §8–§17, §42–§46, §61, §66–§69 | Чисто новое содержание документа (главный вклад) |
| K10 | Совместимость и версии | Нет политики peers/engines; MW-040 («upgrade, export/import, repair») про состояние MyWork, не про DSH-совместимость | §33–§36, §63 | Новое требование; подкреплено новым платформенным gate |

### 2.2. Пробелы внешнего документа (то, что он не покрывает)

1. **~20 карточек плана вне поля зрения.** Документ не упоминает ни одной карточки (см. вывод 1), а значит не рассматривает: конвейер исполнения (MW-021 git worktrees, MW-022 worker от admission до результата, MW-023 verification gates, MW-024 независимый review, MW-025 integrator, MW-026 Task Setter), обучение (MW-032 Fast Role Learner, MW-033 Sleep Optimizer), наблюдаемость (MW-034), эксплуатацию (MW-038 Doctor/conformance, MW-039 invariants/crash/security, MW-040 upgrade/export/import/repair, MW-041 упаковка operational v0.1), представления (MW-052 graph/calendar/timeline), а также MW-036/037 (Team Work/Roles/Settings, Role Lab/Activity/Audit).
2. **Порядок работ.** §65 предлагает Phase 0–5 (архитектура → совместимость → Host API → Web → agent UX → optional coordination). Это **переупорядочивание** относительно критического пути плана (`MW-009 → 010 → 011 → 047 → 029 → 048 → 049 → 050 → 053 → 055 → 041`), в котором до доски стоят исполнение, review, интегратор и recovery. Документ нигде не объясняет, почему Web-поверхность важнее незакрытого execution-конвейера; это надо либо принять осознанно, либо отклонить.
3. **Эксплуатация и стоимость** как тема отсутствуют, кроме §41 и §64 (риски). Нет ни одного слова про бюджет API, лимиты конкурентности, наблюдаемость, восстановление после краха (кроме §64 «Cross-process regression»), хотя MW-031/MW-034/MW-039 в плане есть.
4. **Три леджера одного плана.** Документ не знает, что план живёт одновременно в `.work/tasks/INDEX.md` (все карточки `planned`), `.work/tasks/tasks.json` и в живой доске плагина `dsh-task-board` (`ledger-v2.json`, 52 карточки, 19 done, 1 failed, часть карточек с `permissionPending`). Это расхождение — самостоятельный процессный риск, которого нет в §64.
5. **Собственная проверяемость документа.** §73 — список URL на GitHub-источники; в локальной среде есть только чекаут MyWork и чекаут DSH, поэтому часть ссылок на `packages/experimental/**` и `.agents/notes/**` проверяема локально, а `github.com/definitely-stable/dsh-mywork` — это и есть текущий репозиторий. Документ не указывает, какие утверждения проверены выполнением, а какие — чтением (в отличие от §0 v0.2 плана, где у каждого факта указан источник).

### 2.3. Состояние самого плана: четыре расходящихся источника (проверено)

Это то, чего не видит внешний документ и что придётся чинить **до** любых новых карточек.

| Источник | Что говорит | Проблема |
|---|---|---|
| `.work/EXECUTION-PLAN.md:3` | «Статус: MW-001…MW-008 реализованы, **MW-009 и далее не начаты**» | Устарел: в `.work/reports/` есть отчёты по MW-009…MW-020, MW-042, MW-043 (включая 8 артефактов MW-011 с adversarial и delta-verification) |
| `.work/tasks/INDEX.md` | у **всех** 55 карточек статус `planned` | Не отражает ни отчёты, ни состояния живой доски |
| `.work/tasks/tasks.json` | структурированные определения 55 задач и DAG | По `.work/README.md:25` — «единственный источник DAG для всего набора v0.2»; карточки MW-042…MW-055 в legacy-леджере не создавались |
| Живая доска `dsh-task-board` (revision 324) | 52 карточки: `backlog 32 / done 19 / failed 1 / archived 3` | Заголовки совпадают с MW-планом; MW-001 помечен `failed` и архивирован, хотя отчёты существуют (`EXECUTION-PLAN.md:143`) |

**Следствие.** Любое планирование следующего шага по колонке доски или по `INDEX.md` даст неверную картину. Первое действие — сверка четырёх источников и фиксация фактического статуса (сколько карточек реально закрыто кодом+отчётом+тестом).

### 2.4. Операционный блокер, которого нет ни в документе, ни в плане

На живой доске у карточек **MW-044, MW-045, MW-046, MW-047, MW-048, MW-049, MW-050, MW-051, MW-052, MW-053, MW-054, MW-055** стоит `permissionPending: true`, а `sessionDefaultPermission` доски — `read-only` при закреплённых `workspace-write`. Это значит: **эти карточки не запустятся, пока человек не подтвердит привязку прав в UI доски** (инструментальная поверхность подтверждения намеренно не даёт). Плюс `.work/README.md:29` фиксирует, что подтверждение при подготовке не выдавалось. Практический вывод: «следующий шаг» для владельца — не архитектура, а разбор этого гейта; иначе 12 карточек v0.2 остаются неисполнимыми независимо от качества плана.

Дополнительно `.work/README.md:19`: доска не хранит DAG зависимостей («их проверяет исполнитель перед началом»), а `.work/README.md:15` — «Ничего не запускается автоматически». То есть запуск карточки вручную не проверяет её зависимости, и это второй операционный риск (в v0.2 он признан явно).

## Часть 3. Живая композиция профиля и локальный референс (проверено Lead'ом)

Источник: `plugin_manager list_bundles` (21 бандл) и файлы профиля `C:\Users\Dmitry\.dsh\profiles\web\`.

### 3.1. Что реально установлено

| Бандл / плагин | Версия | Состояние | Замечание |
|---|---|---|---|
| `@deepseek-ai/dsh-base` | 0.1.7-rc.2 | enabled | ядро; строки `token-meter`, `spill-local`, `spill-policy`, `subagent*`, `tool-workflow`, `ptc-runtime`, `tool-ralph`, `session-checkpoint-policy`, `tool-result-pruner`, `image-offload`, `mcp-resources` присутствуют |
| `@deepseek-ai/dsh-web-app` | 0.1.7-rc.2 | enabled | web-поверхность; строка `schedule` (`@deepseek-ai/dsh-schedule`) присутствует, `time-context` тоже; часть строк выключена через `overrides` (system-prompt, tools, tool-fs*, tool-bash/pwsh, plan-mode, tool-web, …) |
| `@linxin666/dsh-web-all` | **0.4.3** | enabled | агрегат из ~19 строк: task-board, git-graph, pet, remote-web-ui, settings, market, ssh, update, usage, session-archive, model-capabilities, i18n, skin-center, preset-center, community-plugins, skill-explorer, liangshen, compat, plugin-manager |
| `@linxin666/dsh-client-ui-task-board` | **0.4.3** | (строка внутри web-all), отдельный бандл `enabled: false` | **peerDependencies: `@deepseek-ai/dsh >=0.1.7-rc.2`, react ^18.2.0** |
| `@deepseek-ai/dsh-experimental-agent-team-profile` | 0.1.7-rc.2 | enabled, optional | durable roster/mailbox/task board + Web-панель |
| `@deepseek-ai/dsh-experimental-auto-review` | 0.1.7-rc.2 | enabled, optional | политика авто-одобрения |
| `dshmarket` 1.66.1, `dsh-context` 0.56.2, `dsh-client-auto-continue` 0.11.8, `dsh-locale-ru` 0.1.1, `dsh-locale-ru-plugins` 0.1.0, `misakanet` 2.35.0, `@nonamelego/dsh-catppuccin` 0.5.6, `dsh-opencode-go-usage` 0.4.0, `dsh-opencode-session` 0.1.1 | — | installed, enabled | сторонние |
| `@deepseek-ai/dsh-acp-app`, `dsh-headless`, `dsh-sdk-app`, `dsh-sdk-minimal`, `voice-input-bundle`, `@linxin666/dsh-remote-web-ui`, `@linxin666/dsh-client-ui-task-board` | 0.1.7-rc.2 / 0.4.3 | disabled | выключенные бандлы |

**Факт для §53–§54:** сторонняя доска приходит не отдельным бандлом, а **строкой внутри агрегата `@linxin666/dsh-web-all`**, вместе с 18 другими строками, которыми владелец пользуется. Поэтому рекомендация документа «disable/remove foreign task-board rows/bundle» в этой среде исполнима только как **строчный override** (`- { id: web-ui-task-board, disabled: true }`), а не как удаление бандла. Это совпадает с решением плана (ADR021: «строка `web-ui-task-board` убирается из профиля») и не совпадает с буквой §54.

### 3.2. Локальный референс, который пропустили и документ, и план

Установленная сторонняя доска **0.4.3 поставляется с исходниками TypeScript** (`src/**` в `node_modules`), и это работающий на rc.2 референс ровно того, что MyWork планирует строить:

| Что | Где | Почему важно |
|---|---|---|
| Нативные слоты: `ctx.slots.inject('sidebar.panellist', …)` + `ctx.slots.inject('main', …)`, `key = panel id`, `order` (в комментарии: «Plugins is 0, Schedule 10», доска 20), inject-фабрика `{ controller }` | `src/client/native-panel.tsx:99-124` | подтверждает §22–§23 и MW-048 **на живом коде**, включая тезис «регистрация через inject, поэтому порядок загрузки не важен» |
| Семантические атрибуты `data-dsh-panel-entry`, `data-dsh-taskboard-view`, `data-dsh-plugin`; ссылка на `contracts/semantic-attrs-v1.md` («L2 contract (skins)») | `src/client/native-panel.tsx:38-50,77` | третий механизм, которого нет ни в документе, ни в ADR022: контракт с skin-экосистемой через data-атрибуты |
| `peerDependencies: { "@deepseek-ai/dsh": ">=0.1.7-rc.2" }` | `package.json` | живое доказательство, что compat-gate §33 применяется к внешним плагинам |
| Companion-инвариант `src/invariant.ts` (пустой), инструменты через `defineTool` из `@deepseek-ai/dsh-tools` | `src/invariant.ts`, `src/host/agent-tools.ts:19` | конвенции платформы применяются внешним плагином |
| HTTP-маршруты: `inject = [..., 'typertGateway', 'webServer', ...]`, `ctx.webServer.register(route)`, префикс `/api/task-board` | `src/index.ts:35,388`, `src/protocol.ts:13` | рабочий прецедент **HTTP-транспорта**, а не Remote — прямой аргумент в споре K1 |
| Домен: `subtask.ts`, `session-reuse.ts`, `schedule.ts`, `handover.ts`, `freeze-snapshot.ts`, `use-cases/*`, `host-ledger.ts` | `src/core/**`, `src/host-ledger.ts` | «handover» и «freeze snapshot» уже реализованы у стороннего плагина — идеи §46 и frozen revisions не уникальны |
| Телеметрия: `reportDailyHeartbeat` → `https://dsh-market.com/api/telemetry/event`, раз в UTC-сутки, анонимный UUID в localStorage, skip при `navigator.webdriver`, выключателя нет | `src/client/telemetry.ts:25-105` | подтверждает и уточняет факт §0.3 v0.2 («безусловный heartbeat»): он есть и в 0.4.3 |

**Факт-коррекция к ADR021 и §53:** маркеров DOM-перехвата (`data-dsh-taskboard-active`, `centerCol`) в 0.4.3 **нет**, а `native-panel.tsx` прямо заявляет «not a DOM takeover». Значит часть обоснования ADR021 («DOM-наблюдатель на `document.body`, инъекция в центральную колонку») устарела: замена нужна не из-за DOM, а из-за второго control plane (свой ledger + runner + scheduler), телеметрии без выключателя и риска двух исполнителей. Это уточняет и документ, и план.

### 3.3. Живой риск, которого нет ни в документе, ни в отчётах плана — **с поправкой потока A**

`C:\Users\Dmitry\.dsh\profiles\web\cordis.patch.yml:20-35` — строка `web-ui-task-board` сконфигурирована так:

```yaml
config: { plugin: "@linxin666/dsh-client-ui-task-board", config: { sessionDefaultPermission: workspace-write } }
announceToAgent: true
autoRunTodo: true
autoRunPaused: true
autoRunMaxConcurrent: 1
autoRunMaxRetries: 1
autoRunStallMinutes: 30
autoRunMaxPerHour: 3
autoRunMaxPerDay: 0
```

**ПОПРАВКА (поток A, проверено по исходникам 0.4.3).** Ключи `autoRun*` — **мёртвая конфигурация**: `Config` установленной версии объявляет восемь полей (`announceToAgent`, `enabled`, `preventIdleSleep`, `trustedProxyHosts`, `proxyTokenEnv`, `sessionDefaultPermission`, `maxSubtaskDepth`, `teamProvider`) — `src/index.ts:51-112`, а подстрока `autoRun` не встречается ни в `src/**`, ни в собранном `lib/index.js` (A-board.md, CLAIMS 38-39, 42). Моя первая формулировка («при снятии паузы 34 карточки уйдут в авто-исполнение») **опровергнута**, как и утверждение `.work/EXECUTION-PLAN.md:125` («Сейчас он выключен»). Остаточный реальный путь авто-запуска в 0.4.3 — per-task `schedule` (у всех 55 карточек отсутствует) и agent-инструменты `task_board_run` / `task_board_schedule` (`src/host/agent-tools.ts:285,382`) плюс cron. То есть риск «двух исполнителей» существует, но реализуется не тумблером, а вызовом инструмента или заведённым расписанием.

Остальные части раздела 3.3 остаются в силе: доска пишет объявление в системный промпт каждой сессии (`announceToAgent: true`), а заявленный в конфиге `sessionDefaultPermission: workspace-write` расходится с тем, что доска отдаёт в read model (`read-only`), из-за чего 12 карточек MW-044…MW-055 висят с непройденным гейтом подтверждения (последнее — кандидат в проверку, а не установленный факт: см. CLAIMS A-72).

### 3.4. Что поток A опроверг в моих предварительных выводах (для честности карты)

1. **`autoRun*` — мёртвые ключи** (см. 3.3 выше).
2. **Легаси 0.4.3 — не DOM-takeover**: `src/client/native-panel.tsx:99-123` регистрирует нативные слоты; маркеров `data-dsh-taskboard-active`/`centerCol` в пакете нет. Обоснование ADR021 в части «DOM-наблюдатель и инъекция в центральную колонку» устарело; в силе остаются heartbeat и владение леджером/runner'ом.
3. **`Idea` как сущность не существует** (`idea.ts` нет ни в контрактах, ни в ядре; grep по `IdeaState|IdeaPromotion|idea.bank|IdeaId` — 0 совпадений), а `MW-043-idea-bank.md` — это **BLOCKED**-отчёт от 2026-09-18, заблокированный отсутствием MW-011 и MW-026 (проверено чтением отчёта, строки 3-40, 95-124). При этом MW-011 с тех пор реализован: `packages/contracts/src/plan.ts`, `packages/core/src/plan.ts`, `packages/planner/src/service.ts` содержат `PlanMutationIntent/StagedPlanMutation/BlockerResolutionGate` (grep, 183 совпадения). Значит блокер MW-043 частично устарел: MW-011 закрыт, MW-026 — нет. Строка документа «Idea separate | KEEP» (§71) неверна: сохранять нечего.
4. **Воркспейсы леджера**: `47b14762-c848-44e6-a7cc-62f19949566d` — это и есть воркспейс `H:\Repo\DSH-MyWork` (52 карточки: 32 backlog, 19 done, 1 failed); `3fc33afb-…` содержит 3 карточки (MW-001 failed, MW-027 и MW-035 superseded) и в реестре воркспейсов отсутствует. Числа в MW-054 («6 done в 47b14762, 35 незавершённых в 3fc33afb») и в MW-055 («41 карточка») — устаревшие (поток A, CLAIMS по §53-§54).

### 2.5. Что документ делает хорошо (для честного баланса)

- §8–§17 корректно описывают mechanics Agent Teams на уровне, который в плане отсутствует: durable intent before side effect, queue-before-delivery, dedup на цели, wait-for-change, selective teardown, invariant companion. Это готовый источник паттернов (не authority).
- §42–§44 разделяют «переносим паттерны / не переносим authority» и не предлагают заменить TaskGraph TeamTask'ом — совпадает с ADR-позицией плана.
- §49–§52 (read model как агрегат, раздельные revisions domain/placement, degraded last-valid + баннер) совпадают с ADR017/§5.17 и уточняют их в полезную сторону.
- §33/§37/§41 отмечают три реально свежие платформенные вещи (compat gate, availability моделей, лимит extension), которые план не покрывает.
