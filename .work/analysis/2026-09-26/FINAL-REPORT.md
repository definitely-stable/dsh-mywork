# DSH MyWork — глубокий анализ v2: итоговый отчёт Lead'а

**Дата:** 2026-09-26 (вечер, Asia/Yekaterinburg).
**Кампания:** разбор внешнего документа `dsh-mywork-deep-analysis-2026-09-26.md` (74 раздела, 2 058 строк) против фактического кода MyWork, плана v0.2 (55 карточек, ADR016–ADR028) и текущей платформы DSH `0.1.7-rc.2`.
**Роли:** Lead — постановка, судейство, сведение, финальный отчёт. 7 исследовательских потоков (A–G) и независимая верификация: 2 фальсификатора (V1 — board/платформа/Lead-заметки, V2 — оркестрация/frontier/внешний документ) + массовая перепроверка claim-леджеров по потокам.

**Проверенные ревизии:** MyWork `main` `0c657ae1434202865bd330f0eeaf2b60eb78f6d4` (2026-09-22); DSH checkout `c7c4c725c7889abfdb46fcdd78b14940232940cf` (2026-09-26, версия `0.1.7-rc.2`, запускается из исходников); база документа — DSH `477b4f4205…` (merge релиза rc.2), база плана MyWork v0.2 — DSH `dsh-v0.1.5-rc.2` (`fb2c4b9e69`, 2026-09-10).

**Артефакты кампании** (все в `.work/analysis/2026-09-26/`): `00-ground-truth.md` (брифинг), `A-board.md`, `B-orchestration.md`, `C-platform.md`, `D-context.md`, `E-human-gates.md`, `F-gaps.md`, `G-frontier.md`, `L-lead-notes.md`, `CLAIMS.md` (381 claim), `V1-verification.md`, `V2-verification.md`, `verify/*` (массовая проверка). Этот файл — `FINAL-REPORT.md`.

---

## 0. Как читать отчёт

| Если вам нужно… | Смотрите |
|---|---|
| Понять, что делать прямо сейчас | §1 (резюме), §10 (первые шаги) |
| Увидеть вердикт по каждому разделу документа | §5 (таблица 74 строк) |
| Понять, что изменилось в DSH и что это ломает | §3 (дельта платформы), §4 (живая композиция) |
| Понять, где документ конфликтует с планом | §6 (конфликты решений) |
| Увидеть, чего не заметили ни документ, ни план | §7 (пробелы), §9 (идеи и red-team) |
| Увидеть, что не так с текущим кодом | §8 (измерения и оптимизации) |
| Увидеть, что менять в карточках плана | §9.3 (сводная таблица правок) |
| Проверить, насколько отчёту можно верить | §11 (независимая верификация, опровержения) |

**Словарь вердиктов:** `ПОДТВЕРЖДЕНО` — проверено по исходникам/командам; `ЧАСТИЧНО` — верно по сути, но с существенными оговорками или неполнотой; `ОПРОВЕРГНУТО` — противоречит фактам; `УСТАРЕЛО` — было верно для предыдущей версии/базы; `ОТСУТСТВУЕТ В ПЛАНЕ` — верное требование, которого в плане нет; `НЕ ПРОВЕРЕНО` — не удалось подтвердить.

---

## 1. Резюме для владельца

### 1.1. Десять выводов, которые меняют картину

1. **Документ написан «мимо плана».** Ни одной карточки `MW-0NN` в нём нет (единственное совпадение — иллюстративный «MW-123 / Attempt A-77» в §14, строка 518); ADR упомянуты только в §55/§65. Он не знает ни состава 55 карточек, ни ADR016–ADR028, ни того, что часть его «корректировок» уже принята (ADR017 про DropIntent, ADR018 про зону-как-группировку, ADR021 про нативные слоты, ADR025 про provenance импорта, ADR026 про независимый review).
2. **Базы разъехались на 3 650 коммитов.** План v0.2 зафиксирован 2026-09-18 на DSH `0.1.5-rc.2` (тег 2026-09-10); документ — на `0.1.7-rc.2` (2026-09-24). За это окно в платформе появились: peer-compat gate, auto-review, deliverables (workspace-changes), product-telemetry, ssh, voice-input, переработка Typert-uplink, Web-проекция Agent Teams, storage-phase-1 у Schedule. Ни одно из этих изменений в плане не отражено.
3. **Стратегия документа верна, дорожная карта — нет.** «MyWork — authoritative work orchestration layer, DSH — runtime/session/web/platform, у Agent Teams берём паттерны, а не authority» подтверждено и совпадает с ADR-позицией плана. Но §65 ставит Web/Board (Phase 2–3) впереди незакрытого конвейера исполнения (MW-021…MW-026: worktree-изоляция, worker от admission до результата, verification gates, независимый review, интегратор), который в критическом пути плана стоит **до** доски. Это надо принять осознанно или отклонить.
4. **Реальное состояние проекта лучше, чем кажется, и хуже, чем кажется — одновременно.** Лучше: 12 пакетов, 36 674 строки `src` (без build output), typecheck 12/12, **710 тестов: 687 pass / 0 fail / 23 skip**, smoke 13/13, `verify:profile: PASS` в изолированном `DSH_HOME` (tarball 225 651 байт монтируется). Хуже: **4 из 12 пакетов достижимы из runtime**, 11 619 строк `src` (31,7 %) — библиотеки без единого потребителя (Context Fabric, Memory Fabric, scheduler, execution, lease, planner, storage, evidence); **ни одной живой `*.sqlite`** под `~/.dsh`.
5. **Beads-путь на Windows не работает и это скрыто зелёным прогоном.** Проба и раннер запускают `bd` через `spawnSync(..., {shell:false})` → `ENOENT (errno -4058)`; 23 теста реального backend молча `skipped`. При включении пробы — `pass 55 / fail 15`; после починки раннера — `pass 68 / fail 2`. Плюс **две объявленные capability опровергнуты живым `bd 1.3.0`**: `batch` не оставляет ребро при dep add+remove (на этом стоит staged-план MW-011/ADR024), `bd heartbeat` → exit 1 при `heartbeat: true`.
6. **Четыре источника статуса противоречат друг другу**, и «done» на доске не означает успешный прогон: INDEX.md — 53 `planned` + 2 `superseded`; EXECUTION-PLAN.md — «MW-009 и далее не начаты»; живая доска — 19 `done` / 34 `backlog` / 2 `failed`; при этом из 31 исполнения **11 failed, и 9 из них — на карточках в `done`** (`workspace not found` ×7, `preset "standard" failed to mount` ×2).
7. **Три конфликта решений требуют явного выбора владельца:** транспорт Web (HTTP/SSE через `ctx.webServer` в MW-029/046/047 против Typert Remote в §19–§21), модель зон доски (9 зон 3×3 + порог 1100 px в контракте, ADR018 и приёмках MW-049/050 против semantic lanes §5.2/§6), и коллизия понятия workflow (свой движок MW-044/ADR020 против платформенного шва `ctx.workflowEngine`, где движок ровно один на контекст).
8. **Документ пропустил локальный работающий референс.** Установленная сторонняя доска `@linxin666/dsh-client-ui-task-board` **0.4.3 поставляется с исходниками TypeScript** в живом профиле: нативные слоты через `ctx.slots.inject`, `dsh.client`-манифест, peer `>=0.1.7-rc.2`, companion-инвариант, инструменты через `defineTool`, HTTP-API через `ctx.webServer`, домен с subtask/schedule/session-reuse/handover/freeze-snapshot. Это ровно то, что MyWork планирует строить в MW-047/048/029 — и оно уже работает на rc.2.
9. **Платформа даёт больше, чем документ предлагает взять.** Уже существуют (и не учтены ни документом, ни планом): `dsh-token-meter` (снимок расхода/давления запроса), `ctx.invariants` + конвенция `./invariant`, `ctx.spillStore`, канонические session-reference URI, `session-query-sqlite`, `deliverables` (present + workspace-changes), `product-telemetry`, durable jobs. Это не «новое в платформе», а **неучтённое в плане** — и именно поэтому часть работы из MW-008/MW-034/MW-039/MW-048 рискует стать второй реализацией.
10. **Самые дорогие пробелы — не про доску, но и не там, где их искал поток G.** В платформе нет **глобального** лимита стоимости и лимита шагов агентского цикла (узкие исключения: `maxRounds` у ralph, бюджеты subagent-провайдеров, `delegationDepth`, бюджеты времени/раундов/поиска — см. §11), а §64 документа не содержит ни одного риска про деньги, потерю данных и самомодификацию. При этом два утверждения потока G **опровергнуты верификацией**: учёт расхода в MyWork **есть** (`tokenCount`/цена вызова в `packages/core/src/budget.ts`, `BudgetConsumption {tokens, cost}`; «unknown» означает «провайдер не сообщил usage», а не отсутствие механизма), а риск самомодификации через dynamic Cordis-плагины ниже заявленного: подтверждение привязано к `packageId`, будущие версии требуют явного opt-in.

### 1.2. Что делать первым (сжатый список; подробно — §10)

1. **Разобрать гейт прав.** 12 карточек MW-044…MW-055 не запускаются, потому что `sessionDefaultPermission: workspace-write` в профиле вложен на уровень глубже (`config.config`), а плагин читает его сверху → действует дефолт `read-only`. Это дефект конфигурации с точной починкой (V1), а не загадка.
2. **Синхронизировать четыре леджера** и зафиксировать правило «`done` без `failed`-исполнений или с явным обоснованием». Иначе следующий шаг планируется по неверной карте.
3. **Починить `bd`-seam на Windows** (резолв JS-entry через `process.execPath`), сделать skip явным падением в CI-профиле, разобраться с двумя опровергнутыми capability. Без этого MW-010/MW-011 недоказуемы, а на `batch-dep-remove` стоит staged-план.
4. **Собрать composition root** (одна карточка): открыть `controller.sqlite` полным списком миграций, поднять lease/planner/execution/scheduler/evidence и зарегистрировать в `myworkAdapters`. Это закрывает 31,7 % недостижимого кода и делает `MYWORK_SCHEMA_VERSION` правдой.
5. **Принять решения K1/K2/K4** (§6) и оформить их ADR: транспорт, модель зон, имя/граница workflow-движка.
6. **Сделать installable UI-пакет + peer-манифест** (не «сначала API»): Host-часть уже готова к нативной установке, отсутствует браузерная половина и peer-контракт `@deepseek-ai/dsh` (F13/C).
7. **Добавить дешёвые платформенные примитивы**: peer-контракт по реально используемым сервисам, budget/step circuit-breaker поверх `token-meter`, OTel-экспорт существующего `correlationId`, runtime-invariants, атомарная запись состояния.

---

## 2. Метод, границы и что не проверялось

### 2.1. Как велась работа

| Этап | Что сделано |
|---|---|
| Рекогносцировка Lead'а | Прочитан весь документ (2 058 строк), снят ground truth: ревизии, версии, состав 12 пакетов, 55 карточек, живая доска (revision 324), профиль, toolchain |
| 7 потоков (Agent Team) | A board, B оркестрация, C платформа, D контекст/память/сессии, E человек/review, F измерения репозитория, G frontier+red-team. Каждый: общая задача с write-scope, один файл отчёта, формат из 6 разделов, обязательная таблица CLAIMS |
| Сведение | `CLAIMS.md` — 381 атомарное утверждение из 7 потоков (A 72, B 57, C 50, D 50, E 60, F 50, G 42) |
| Независимая верификация | V1 (board + платформа + Lead-заметки, 47 утверждений), V2 (оркестрация + frontier + §27/§28 документа, 50 утверждений), плюс массовая перепроверка claim-леджеров по шести потокам (фоновая оркестрация, 6 верификаторов) |
| Суд | Каждый вердикт потока либо подтверждён, либо скорректирован; расхождения между потоками разобраны отдельно (§11) |

### 2.2. Правила, которые соблюдались

- Только чтение чужого кода: ни один поток не правил живое дерево MyWork, живой профиль `C:\Users\Dmitry\.dsh`, леджер доски и DSH-checkout. Мутирующие эксперименты — только в отдельных `git worktree` под `.tmp/` (созданы F: `.tmp/f-audit`, V2: `.tmp/v2-boundary-demo`).
- Утверждение без доказательства не считается: `файл:строка`, `§` документа или команда + exit code.
- Отчёты писались инкрементально; каждый поток честно перечислил, что не проверял.

### 2.3. Что НЕ проверено (сводно и честно)

- **Живая эффективная композиция профиля** (собранное дерево Cordis, а не тексты yml): поэтому «invariant companion не смонтирован», «maxMembers = 8», «Schedule отключён в shipped-композиции» — утверждения о слоях, а не о рантайме.
- **Компиляция MyWork против типов DSH rc.2** (TS 5.7 против 6.0.3): нужен compile spike; C его не делал.
- **Работа Typert-генератора вне монорепозитория** (F1 у C) и поведение браузера (HMR, выдача `/plugins/<id>/client.js`, рендер панели).
- **Живой `bd`**: F гонял реальные тесты и получил 2 падения после починки раннера, но `bd init`, Dolt-remote, `bd serve` и поведение на Linux/macOS не проверялись.
- **Стоимость LLM** не измерялась ни разу (платных проб не было).
- **GUI-сценарии** и живой Plugin Manager (install/remove/enable) не запускались.
- Внешний документ проверялся по локальным источникам; ссылки на `github.com/…` отдельно не открывались (локальные чекауты MyWork и DSH — те же репозитории).

---

## 3. Дельта платформы: DSH 0.1.5-rc.2 → 0.1.7-rc.2 (и что она меняет)

### 3.1. Масштаб

| Метрика | Значение | Команда |
|---|---|---|
| Коммитов между тегами | **3 650** | `git rev-list --count dsh-v0.1.5-rc.2..dsh-v0.1.7-rc.2` |
| Из них `feat` | 329 (разбивка по типам воспроизводится с `--no-merges`) | `git log --no-merges --format='%s' …` |
| Новых подсистем в `docs/subsystems` | 54 → 63 (+10: `boot`, `browser-use`, `computer-use`, `deliverables`, `mcp`, `office-to-pdf`, `product-telemetry`, `ptc-runtime`, `ssh`, `voice-input`) | `git ls-tree` по тегам |
| Дата базы плана | 2026-09-10 (`dsh-v0.1.5-rc.2`), решения плана зафиксированы 2026-09-18 | `.work/architecture/DSH-My-Work-Architecture-v0.2-decisions.md:9` |

### 3.2. Что действительно новое в окне дельты (проверено наличием пути в тегах)

| Возможность | @0.1.5-rc.2 | @0.1.7-rc.2 | Значение для MyWork |
|---|---|---|---|
| `packages/deliverables/*` (`tool-present`, `workspace-changes`) | нет (как путь) | есть | «Что turn отдаёт пользователю»: present-файлы log-only событием + сравнение git-снимков на границах turn'а. Пересекается с Evidence/Artifact (MW-008) и finish criteria (MW-045). Оговорка V1: `tool-present` — переезд пути, документация подсистемы новая, `workspace-changes` добавлен 15.09 |
| `packages/host/product-telemetry-otel` | нет | есть | Продуктовые события OTLP, только явные, без авто-сбора данных сессии — основа для MW-034 |
| `packages/experimental/auto-review` | нет | есть | Политика per-call одобрения вызовов (не приёмка результата) — §32 |
| `packages/boot/plugin-manager` | нет (как путь) | есть | Совместимость плагинов, bounded pnpm, takeover-lock, отчёт skipped bundles |
| `packages/ssh` | нет | есть | Новая подсистема; в плане не рассматривается как транспорт/удалённый workspace |
| Peer-compat gate (`feat(plugins): enforce DSH peer compatibility with exact exemptions`, `…typed refusals`) | — | есть | Обязательный контракт публикации; MyWork его не выполняет (§6, K10) |
| Model availability (`feat(client,session-controller,llm): track available models and expose account settings`, 2026-09-21 по V1) | — | есть | Ровно то, чего требует §37 |
| Typert uplink и границы отмены stream'ов (`021bd03b70`, `ffea3c8818`, 2026-09-20) | — | есть | Уточняет §20: механизм был, uplink добавлен в окне |
| Web-проекция Agent Teams (`1dc518f217`) | — | есть | Подтверждает §18 «durable facts + live overlays» |
| Schedule: включён в shipped (`e896737840`) и сразу отключён (`cad6fef2fd`) | — | есть | §30 верен: функциональность есть, shipped-композиция её выключает |
| Timed user questions: добавлены (`bb19061473`) и откат (`32905d5ab5`) | — | есть | §27 верен; откат шире, чем описано (E) |

**Коррекции к моим первым атрибуциям (по V1):** ssh — первое добавление `4fb0fdac68` (09-12), token-meter — `f038780ff6` (07-15), auto-review — `55e53907ab` (09-09, в базовый тег не попал), `deliverables/tool-present` — переезд, а не новая подсистема; разбивка по областям (12 524/1 537/866 файлов) не воспроизвелась (12 112/1 424/731).

### 3.3. Что существовало на базе, но не учтено ни планом, ни документом

| Примитив | Что даёт | Где |
|---|---|---|
| `dsh-token-meter` | Снимок давления запроса и позиционного прайсинга (`TokenMeasurement`, `logRevision`) | `packages/llm/token-meter` |
| `ctx.invariants` + конвенция `./invariant` | Реестр runtime-инвариантов, публикуемых пакетом | `packages/runtime-diagnostics/invariants` |
| `ctx.spillStore` | Сохранение большого текста с модельно-адресуемым локатором | `packages/spill/spill` |
| Session/file references | Канонические URI, prepared message contexts, byte retention, «untrusted» промпт | `packages/context/session-reference`, `file-reference` |
| `session-query-sqlite` | Полнотекстовый индекс по корпусу сессий | `packages/session-query/*` |
| `ctx.workflowEngine` | Модельно-написанный скрипт, запускающий субагентов; **один движок на контекст** | `packages/workflow/workflow` |
| `plan-mode`, `jobs-local`, `storage-domain`, `attachment-local`, `credentials`, `approval`, `permission-presets`, `commands`, `systemPrompt.section`, `sandbox-policy`, `fs-observation-policy` | Готовые швы вместо собственных реализаций | `packages/**` |

**Вывод.** Формулировка «DSH обновился, надо пересмотреть реализацию» верна количественно, но не в том смысле, в каком её подаёт документ: главная дельта — не Agent Teams и не Board, а **peer-контракт установки, model availability, deliverables/token-meter/invariants/spill/jobs и auto-review**. Agent Teams, Typert, slots, `dsh.client`, Schedule существовали уже на базе плана; в окне дельты они получили доработки.

---

## 4. Живая композиция профиля и локальный референс

### 4.1. Что установлено (проверено `plugin_manager list_bundles`, 21 бандл)

- `@deepseek-ai/dsh-base` и `@deepseek-ai/dsh-web-app` — `0.1.7-rc.2`; в web-бандле есть строки `schedule` и `time-context`; часть строк выключена `overrides` (tool-fs*, tool-bash/pwsh, plan-mode, tool-web и др.).
- `@deepseek-ai/dsh-experimental-agent-team-profile` и `…-auto-review` — `0.1.7-rc.2`, объявлены включёнными как optional. **Важная поправка верификации:** Agent Teams реально смонтирован (в этой сессии доступны `spawn_teammate`/`team_task_*`), а `auto-review` — **нет**: пакет отсутствует в `profiles/web/node_modules` и в `dependencies`, строки `auto-review` нет ни в `cordis.patch.yml`, ни в `cordis.yml`, то есть объявление в `dsh.profile.bundles` «сиротское». Значит утверждения вида «Auto Review включён» неверны для этого профиля: слой не смонтирован.
- Стороннее: `@linxin666/dsh-web-all` **0.4.3** — агрегат из 19 строк (task-board, git-graph, pet, skin-center, ssh, usage, session-archive, model-capabilities, i18n, preset-center, market, plugin-manager, settings, update, liangshen, skill-explorer, community-plugins, remote-web-ui, compat); `dshmarket` 1.66.1; `dsh-context` 0.56.2; `dsh-client-auto-continue` 0.11.8; `dsh-locale-ru`(+plugins); `misakanet` 2.35.0; `@nonamelego/dsh-catppuccin` 0.5.6; `dsh-opencode-go-usage` 0.4.0; `dsh-opencode-session` 0.1.1.
- Выключены: standalone `@linxin666/dsh-client-ui-task-board`, `dsh-remote-web-ui`, `acp-app`, `headless`, `sdk-app`, `sdk-minimal`, `voice-input-bundle`.

**Следствие для §53–§54.** Сторонняя доска приходит **строкой внутри агрегата**, а не отдельным бандлом, вместе с 18 другими нужными строками. Поэтому «disable/remove foreign bundle» в этой среде исполним только как **строчный override** (`- { id: web-ui-task-board, disabled: true }`) — что совпадает с решением плана (ADR021) и не совпадает с буквой §54.

### 4.2. Локальный референс, пропущенный документом и планом

`@linxin666/dsh-client-ui-task-board` 0.4.3 поставляется с исходниками TypeScript (`src/**` в `node_modules` живого профиля) и работает на rc.2 ровно так, как MyWork планирует:

| Что | Где | Почему важно |
|---|---|---|
| Нативные слоты: `ctx.slots.inject('sidebar.panellist', …)` + `ctx.slots.inject('main', …)`, `key = panel id`, `order 20` («Plugins is 0, Schedule 10»), inject-фабрика `{ controller }` | `src/client/native-panel.tsx:99-124` | Подтверждает §22–§23 и MW-048 живым кодом, включая «порядок загрузки не важен» |
| `peerDependencies: { "@deepseek-ai/dsh": ">=0.1.7-rc.2", "react": "^18.2.0" }`, `dsh.client = { platform: 'web', inject: [...] }` | `package.json` | Живое доказательство §33 и образец манифеста |
| HTTP-API через `ctx.webServer.register` + `inject: [..., 'typertGateway', 'webServer', ...]`, префикс `/api/task-board` | `src/index.ts:35,388`, `src/protocol.ts:13` | Рабочий прецедент **HTTP-пути** — ключевой аргумент в споре K1 |
| Companion-инвариант (пустой) и инструменты через `defineTool` из `@deepseek-ai/dsh-tools` | `src/invariant.ts`, `src/host/agent-tools.ts:19` | Конвенции платформы применимы к внешнему плагину |
| Домен: `subtask.ts`, `session-reuse.ts`, `schedule.ts`, `handover.ts`, `freeze-snapshot.ts`, `use-cases/*` | `src/core/**` | Идеи §46 (handoff) и frozen revisions уже реализованы у стороннего плагина |
| Телеметрия: `reportDailyHeartbeat` → `https://dsh-market.com/api/telemetry/event`, раз в UTC-сутки, анонимный UUID, skip при `navigator.webdriver`, выключателя нет | `src/client/telemetry.ts:25-105` | Подтверждает и уточняет факт §0.3 v0.2 |
| 8 agent-инструментов (`task_board_create/get/list/update/set_parent/run/manage/schedule`) | `src/host/agent-tools.ts` | Живой образец tool-поверхности для MW-047/MW-029 |

**Важно:** «семантические атрибуты» `data-dsh-panel-entry` / `contracts/semantic-attrs-v1.md`, на которые ссылается код плагина, **в DSH отсутствуют** — это собственная конвенция третьего плагина (C, проверено grep'ом; подтверждено двумя независимыми поисками верификатора). Слоты он регистрирует ровно как §22–§23. **Следствие для MW-048:** пространство `data-dsh-*` уже занято платформой (`data-dsh-boot`, `data-dsh-automatic-focus` — 13 совпадений в исходниках), поэтому якоря панели MyWork нужно заводить в собственном префиксе, а не в `data-dsh-*`.

---

## 5. Вердикт по каждому разделу документа (74 из 74)

Легенда: **П** — ПОДТВЕРЖДЕНО, **Ч** — ЧАСТИЧНО, **О** — ОПРОВЕРГНУТО, **У** — УСТАРЕЛО, **Н** — ОТСУТСТВУЕТ В ПЛАНЕ, **?** — НЕ ПРОВЕРЕНО. «Источник» — поток/верификатор, где лежит доказательство.

### 5.1. Стратегия и текущее состояние (§1–§4)

| § | Тема | Вердикт | Суть и действие | Источник |
|---|---|---|---|---|
| 1 | Итог в одном разделе | **Ч** | Направления (сохранить MyWork как authority, DSH как платформу, брать паттерны Agent Teams) верны и совпадают с ADR-позицией плана. Но список «не рассмотренного» неполон, а §65 сужает горизонт до Web/Board | G §1, A §74, Lead |
| 2.1 | Структура MyWork | **П** | 12 пакетов подтверждены; уточнение: «125 383 строки» — метрика с build output; чистых `src` — 111 файлов / 36 674 строки | F P16, V1 |
| 2.2 | Controller — foundation, не assembler | **П** | `packages/controller/src` — три файла (`index.ts`, `model-catalog.ts`, `dsh-session.ts`); единой application-поверхности нет. Усиление: 8 из 12 пакетов недостижимы из runtime (31,7 % строк) | Lead (glob/grep), F P4 |
| 3 | Team Work богаче Agent Teams | **П** | `RoleContract/RoleStrategy/AgentBlueprint/AgentIdentity/AgentInstance`, права шире, state machine instance — всё в коде | B §3, V2 |
| 4.1 | TaskGraphPort — authority split | **П** | Дословно в контракте (`taskgraph.ts:9-14`) | B §4, V2 |
| 4.2 | Scheduler: свойства | **П** | Чистая синхронная функция без LLM, сериализованные тики, fairness, бюджеты; уточнение: фазовые потолки `maxConcurrentLlm`/`maxHeavyTools` сегодня никто не исполняет (MW-014 §7 п.8) | B §4, B N-13 |

### 5.2. Board (§5–§7, §18–§23, §47–§54, §56, §58–§62, §71, §74)

| § | Тема | Вердикт | Суть и действие | Источник |
|---|---|---|---|---|
| 5.1 | Что уже правильно (KEEP-список) | **Ч** | Всё подтверждено, **кроме** «Idea как отдельной сущности»: `Idea` не существует ни в одном пакете, `MW-043-idea-bank.md` — BLOCKED-отчёт (блокер: MW-011 и MW-026). MW-011 с тех пор реализован, MW-026 — нет | A §5.1, V1 |
| 5.2 | Что нужно изменить (9 зон, layout) | **П** | Девять зон (`board.ts:26-63`), строки 3×3 (`:66-76`), `grid-3x3|strip-horizontal` (`:126,129`), порог 1100 px (`:132`) — presentation-знание в публичном контракте. Но: MW-042 закрыт как DONE, его приёмка требует «ровно одну из девяти зон» → это пересмотр принятого решения, нужен ADR | A §5.2, V1 |
| 6.1 | 16 TaskState + BoardLane из 7 | **Ч** | 16 состояний подтверждены (`contracts/src/task.ts:46-63`). Внутренние противоречия: §5.2 рисует 6 элементов, §6.1 — 7; таблица маппинга даёт `needs-attention → error/attention`, а §6.2 требует `error`; `closed` не определён для default view | A §6.1 |
| 6.2 | needs-attention → error | **Ч** | `originState`/`AttentionState` в коде нет (0 совпадений) — тезис верен. Но рекомендация противоречит коду (`ZONE_BY_STATE['needs-attention'] = 'blocked'`, `board.ts:118`) и приёмке MW-042. `NeedsAttentionReason` объявлен и **не используется нигде** — нет носителя, поэтому приёмка MW-030/MW-050 неисполнима. Предложение E: не менять `ZONE_BY_STATE`, добавить `attention?: {reason, originState, decisionId}` в `BoardPlacement` | A §6.2, E N-3 |
| 6.3 | Blocked до Attempt | **П** | `planned/ready → blocked` подтверждено (`core/src/task.ts:52-53`); вывод «постоянная колонка не нужна» логичен, но это сокращение числа зон | A §6.3 |
| 6.4 | Cancelled/superseded и Active/All/Archived | **У** | Представлений All / Needs attention / Archived в карточках плана нет (MW-049 знает grid/strip/list, MW-050 — saved views) | A §6.4 |
| 7 | Drag-and-drop | **Ч → О в сильной форме** | `applyDropIntent` действительно не меняет `TaskState` (`core/src/board.ts:521-539,552-557`), но V1 **опроверг** «чистый reorder» исполненным контрпримером: при несогласованном входном placement функция меняет зону и возвращает `fromZone` (инвариант `zone == projectTaskZone(exactState)` она сама не проверяет). Продуктовых вызовов нет → дефект латентный. `legalDropTargets('ready')` рекламирует `blocked/cancelled`, которые write-путь отвергает, и это закреплено тестом (`tests/board.test.mjs:179,497`) → приёмка MW-050 неисполнима. Нужен резолвер `DropIntent → MyWorkCommand` | A §7, V1 (A-13) |
| 18 | Web-проекция Agent Teams | **Ч** | `projection.ts` подтверждает рамку «durable facts + live overlays»; детали (refresh, mailbox-frames, failure рядом с last-valid) не проверялись | A §18 |
| 19 | Web data path MyWork | **Н** | Цепочка Host Read Model → snapshot/watch → client store → slots не имеет ни одного артефакта в дереве; пакета `web` нет | A §19, C §19 |
| 20 | Typert Remote как основа | **Ч** (главная правка C) | API есть, но клиентская половина **не выводится из рантайма**: нужны сгенерированные артефакты (`WorkspaceTypertGenerator`, `exports['./typert']`, перечисление в `files`), иначе `TypertAnalysisError`; cookbook-пример манифеста этого не показывает. Namespace монтируется явной сборкой. Равноправная альтернатива — HTTP через `ctx.webServer` + Host `typertGateway.invoke/stream` (прецедент 0.4.3) | C §20, C F1/F2 |
| 21 | Мутации только через команды | **Ч** | Запрет `setTaskState` согласуется с `transitionTask`; но три разных списка команд в документе (§21, §56, §59) и ни один не совпадает с `CARD_COMMANDS` (`board.move`, `task.stop-and-cancel`, `task.resolve-attention`); `actor` в контракте отсутствует | A §21 |
| 22 | Native DSH Web Surface | **П** с уточнениями | Путь верен и совпадает с MW-048. Уточнения: `main` ретентит ключи живых записей; id панели в `sidebar.panellist` обязан совпадать с ключом `main`; строка Loader'а обязана быть **bare-именем** пакета; платформа обязана быть `web` | A §22, C §22 |
| 23 | Slot discipline | **П** | Правила подтверждены; уточнение: `dsh.client.inject` **не** задаёт порядок применения, только информационные рёбра | C §23 |
| 24 | Один bundle, несколько packages | **П** с подводным камнем | Два разных образца: `agent-team-profile` (только `dsh.bundle.patch` + dependencies, UI отдельным пакетом) и `dsh-web-all` (один `dsh.client` + вшитый UI 2,4 МБ). Субпуть никогда не становится client-строкой; формат клиентского бандла — ручная CJS-обёртка `window.__ModuleLoader__.load({id, factory})`; externals — только PLATFORM_MODULES (9 имён). Отдельно: §42-строка «следует повторить bundle pattern» устарела — MyWork уже публикует бандл и проверяет его `verify:profile` | C §24, C F3/F5, B N-17 |
| 47 | Roster/Agents UI | **Ч** | Контракты (`AgentIdentity`, `AgentBlueprint`, `AgentInstance`, `PoolLimits`…) уже есть — не хватает UI и карточки: это пробел **планирования**, не контрактов. Дополнительно: `BoardPlacement.subState` объявлен и не производится (мёртвое поле) | A §47 |
| 48 | Session navigation | **Ч** | `SessionLink` есть, запрет копирования транскрипта обеспечен; но `SessionLink` — мёртвый контракт (1 совпадение на репозиторий), а приёмка MW-050 требует механики перехода, которой нет | A §48, D §48 |
| 49 | Read model как агрегат | **Ч** | `BoardCardRevisionSet` отсутствует; есть только `columnRevision` + `boardRevision` + `Task.revision`. §49 и §58 описывают один тип по-разному (с `attention` и без) | A §49 |
| 50 | Consistency и degraded | **Ч/О по составу** | Документ перечисляет 6 состояний; код — 7 других (`loading, ready, empty, degraded, unavailable, recovery, paused`); `reconciliation-pending` — причина деградации, а не состояние; **потерян `empty`**, ради различия которого состояния и разделены | A §50, E §50 |
| 51 | Раздельные revisions | **Ч** | Второй уровень (per-column CAS → `STALE_COLUMN_REVISION`) реализован; первый — `Task.revision`. Но кто и когда двигает `boardRevision` после move — не определено | A §51 |
| 52 | Client stores | **Н** | Ни `WorkspaceStore`, ни `BoardStore`, ни `TaskStore`, ни `AgentStore` не объявлены. Уточнение C: легальное место для view-состояния — `store` слота (`PropsStore`, `useStore`), а не собственные store-модели | A §52, C F10 |
| 53 | Сторонний Task Board | **П** с уточнениями | Состав чужого плагина подтверждён (ledger, runner, scheduler, 5 статусов, session-reuse). Уточнения: в живом леджере использованы только `backlog/done/failed` (`todo`/`running` — ни разу), то есть «второго исполнителя» фактически не было; 0.4.3 уже нативный слот-плагин; heartbeat жив | A §53, V1 |
| 54 | Замена только composition-level | **П** фактически | Строка одна (`cordis.patch.yml:20-33`); host-часть монтируется независимо от UI. Но в этой среде это **строчный override внутри агрегата** из 19 строк, а не удаление бандла. `disable` покрыт MW-054, `enable MyWork bundle` — нет (бандла нет) | A §54, Lead §4.1 |
| 55 | Новые ADR (A–F) | **Ч** | Часть уже принята (ADR017/018/019/021/025/026/028). Реально нужны: замена ADR018 при v0.3; Agent Teams relationship; DSH compatibility contract; имя `HumanDecision` вместо занятого `HumanGate`; граница workflow-движка | A, B, C, E |
| 56 | File-by-file изменения | **Ч** | Пять пунктов по `contracts/board.ts` и три по `core/board.ts` попадают в реальные строки, но не сказано, **куда** переносить layout-константы (пакета `web` нет); не упомянуты `BOARD_ZONE_ROWS`, `BOARD_ZONE_ICONS`; список acceptance-тестов не совпадает с фактическим файлом | A §56 |
| 57 | Host target (схемы) | **Ч** | Диаграмма верна как направление, но Web-путь дороже нарисованного (Typert-генератор либо HTTP-слой + авторизация + формат бандла + HMR) | C §57 |
| 58 | BoardSnapshot concept | **Н** | Не объявлен нигде; внутренние расхождения: 4 состояния против 6 (§50) и 7 (код); `revisions` без `attention`; `lane` из несуществующего v0.3 | A §58 |
| 59 | Command concept | **Ч** | Расходится по именам: `board.reorder` против `board.move`; требование «не передавать arbitrary target state» уже обеспечено закрытым union | A §59 |
| 60 | Acceptance gate Board v0.3 до UI | **Ч** | Правильный по смыслу, неисполнимый как есть: минимум 7 из 10 пунктов не выполнены, и нет карточки на `BoardReadService`/`CommandService` | A §60 |
| 62 | Acceptance gate Web package | **Ч** | 7 из 10 пунктов дословно совпадают с приёмкой MW-048; противоречие: «stream loss → degraded, а не fake empty» требует различать `degraded`/`empty`, а §50 этот набор описал неверно | A §62, C §62 |
| 71 | KEEP/CHANGE/ADD/DO NOT ADOPT | **Ч** | Board-строки подтверждены, кроме `Idea separate | KEEP` (сущности нет); compat/web-строки подтверждены; **ADD-список неполон** (deliverables, token-meter, invariants, spill, jobs, session-reference, runtime enforcement) | A §71, C §71, G §71 |
| 74 | Короткий operational verdict | **Ч** | Пункты 1, 2, 4–8 подтверждены/уточнены; пункт 3 («перевести Board на semantic lanes») требует одновременного пересмотра ADR018, правки приёмок MW-049/050, решения о `closed`/`empty` и создания `Idea`; пункт 6 недоспецифицирован | A §74, G §74 |

### 5.3. Agent Teams и оркестрация (§8–§17, §25–§26, §42–§46, §61, §66–§70)

| § | Тема | Вердикт | Суть и действие | Источник |
|---|---|---|---|---|
| 8 | Agent Teams: реализация | **П** | Durable roster/mailbox/task board, bounded, событийные семейства, публичные операции — подтверждено | B §8, V2 |
| 8.2 | Bounds, `maxMembers: 8` | **П** с уточнением | `maxMembers: 8` — **профильный слой** (`agent-team-profile/cordis.patch.yml:20`), домен даёт 16 (`agent-team/src/index.ts:41`) | B N-02, V2 |
| 9 | Provisioning saga | **П** | Шаги подтверждены; переносимый трюк — **pre-minted identity** (`roster.ts:259`): чеканить `instanceId` до вызова runtime. Готовая матрица recovery из 9 строк — в B §3.1 | B §9, B N-06 |
| 10 | Durable mailbox | **П** с неточностью | Queue-before-delivery, target-side dedup, ack после durability — подтверждено; граница сообщения считается по sender-framed доставке (лимит применяется к `JSON.stringify` полной доставки) | B §10, B N-03 |
| 11 | Нужен ли свой mailbox | **Ч** | Mailbox в MyWork отсутствует; вывод «не строить» подтверждён, durability уже есть (outbox + inbox dedup) | B §11, B N-04 |
| 12 | Peer message и Context Fabric | **П** | Класс `dependency-result` не mandatory и не instruction, имеет bucket и лимит — то есть §12 закрывается существующим механизмом, без нового класса доверия | B §12, B N-05 |
| 13 | Shared Team task board | **П** | CAS/`expectedRevision`, DAG, tombstones, writeScopes — подтверждено; переносим эргономику, не сущность | B §13 |
| 14 | Advisory write scopes | **П** (в DSH), **Н** (в плане) | Механика подтверждена; в MyWork отсутствует. Правильный уровень — `Attempt`, а не `Task` (Task — чужая authority); предупреждения не хранить, выводить на чтение | B §14, B §3.2 |
| 15 | waitForChange вместо polling | **Ч** | Механика «edge → wake → reread» верна, но `wait_agent` коротко возвращает `noProgress`, когда нет активного peer'а — буквальное «блокирует до изменения» неверно, и это меняет проектирование ожидания | B §15, B N-02 |
| 16 | Selective teardown | **П** | Закрытие admissions, drain только roster-owned детей, чужие сессии не трогаются | B §16 |
| 17 | Invariant companion | **Ч** | Механика «отказ до append» подтверждена (`Session.append` собирает callbacks до `log.push`), но **компаньон не смонтирован** ни в одном `cordis*.yml`: сервис `dsh-invariants` поднимается только бандлом sdk-minimal. В живом web-профиле §17, скорее всего, не действует | B N-01, V2 |
| 25 | Agent Teams tools | **П** | Девять инструментов, одинаковые схемы, role enforcement в домене; для MyWork — не core admission path | B §25 |
| 26 | Fresh/fork и SessionWindow | **П** | Разделение new Attempt / retry / rollover подтверждено (`carriesTranscript: false`, fork в MyWork физически отсутствует) | B §26, D §26 |
| 42 | Сводная матрица | **П**, одна строка **У** | Строка «Install: следует повторить bundle pattern» устарела: MyWork уже публикует `@dsh-mywork/controller` и проверяет форму `verify-profile.mjs` | B §42, B N-17, V2 |
| 43 | Что переносим | **П** | Список полный; обоснование неполно (durability уже есть, handoff дешевле mailbox) | B §43 |
| 44 | Что не переносим | **П** | Все запреты соответствуют authority-модели плана | B §44 |
| 45 | Опциональный Coordination subsystem | **Н** (и это правильно) | Нет потребителя; outbox+inbox dedup уже дают durability; строить не нужно | B §45 |
| 46 | Handoff Artifact | **П** | Дешевле, чем в документе: новый `ArtifactKind = 'handoff'` + рендер классом `dependency-result`; для child'а это ещё и единственный легальный канал вопроса (E) | B §46, E §46 |
| 61 | Acceptance gate Coordination | **Ч** | Гейт корректен для несуществующей подсистемы; если строить — на outbox/inbox, а не на новом журнале | B §61 |
| 66 | Что делать с Agent Teams сейчас | **П** с поправкой | Запрет «не добавлять зависимость в core» держится **на дисциплине, а не на тесте**: `tests/boundaries.test.mjs` знает только `@deepseek-ai/cordis`; V2 подтвердил дыру экспериментом (DSH-импорт в `scheduler/src` → 53 pass/exit 0; контроль в `core/src` → fail/exit 1). Уточнение: `scheduler/src` всё-таки сканируется `tests/scheduler.test.mjs:935-944`, но без имён DSH-пакетов; `planner/src` не сканируется ничем | B §66, B 3.4, V2 |
| 67 | Заменять ли AgentRuntimePort | **П** («нет») | Шов правильный; пять операций + conformance-кит | B §67 |
| 68 | Whole-snapshot events | **П** («только локально») | Переписывать TaskGraph/MyWork DB в event sourcing не нужно | B §68 |
| 69 | «no automatic owner release» | **П** и усилено | Lease/fence model подтверждена; late result после revoke отвергается (`STALE_FENCE`), но отказ не наблюдаем (нет audit-строки — осознанно) | B §69, B N-10 |
| 70 | Shared checkout | **П** | Worktree — pluggable policy, `writeScopes` не lock и не isolation | B §70 |

### 5.4. Платформа, контекст, человек (§27–§41, §63)

| § | Тема | Вердикт | Суть и действие | Источник |
|---|---|---|---|---|
| 27 | Timed user questions | **П** | API действительно только блокирующий (`ask()` — единственный метод); `askTimed`/`TimedQuestionWait`/`ASK_TIMED_OUT` отсутствуют. Откат шире описанного: сняты `askTimed`, `@Remote answer()`, `attachWait`, `projection.ts`, `timed-wait.ts`, `request.wait` и 4 кода ошибок; note остался и описывает несуществующий API | E §27, V2 |
| 28 | Delegated child не спрашивает человека | **П** | `DELEGATED_CALLER` бросается при `!agents.roots().includes(agent)` (`user-questions/src/index.ts:101-106`); нюанс: границу решает **live-владелец**, а не durable lineage — сессия, возобновлённая как runtime root, может спрашивать | E §28, V2 |
| 29 | HumanGate как домен | **Ч** + коллизия имён | Имя `HumanGate` **занято** каталогом 5 классов операций (`contracts/src/security.ts:171`), два одноимённых экспорта из одного пакета → сущность называть `HumanDecision`. Половина инфраструктуры есть (`approval.human`, `gate.decided`, `task.resolve-attention`, триггер `human-gate-deadline-exceeded`, `BlockerResolutionGate` как образец «производное состояние + сохраняемое решение»). Не хватает сохранённой сущности-запроса; встраивать в MW-030 (сущность) + MW-046 (доставка) + MW-045 (человеческая приёмка) | E §29, E §3 |
| 30 | Schedule: функции | **П** | Cron/IANA/durable/CAS/receipts/cold restore подтверждены; shipped Web-композиция выключает Schedule и time-context | C §30 |
| 31 | Schedule ≠ Scheduler | **П** | Граница верна; допустимый мост — «scheduled trigger → scheduler.kick», без права claim/смены состояния | C §31 |
| 32 | Auto Review ≠ MyWork Review | **П** с уточнениями | Auto Review — per-call политика одобрения вызовов (в default Web выключена); Auto-пресет = Full access + `ask`, то есть его включение — согласие на полный доступ; UI обязан различать три гейта (permission / доменное решение / приёмка). Находка: `ReviewState 'escalated'` терминален и не связан с решением человека — «эскалировали» = «встали навсегда» | E §32 |
| 33 | Plugin compatibility gate | **П** | Проверяются только peer-имена `@deepseek-ai/dsh` / `dsh-*`; отсутствие `peerDependencies` = «no constraint» (`plugin-compatibility.ts:68`); проверка идёт дважды (bundle-слой и каждая строка). **Для MyWork гейт молчит**: объявлен только `@deepseek-ai/cordis`, структурная зависимость от `sessionController`/`llm`/`agents`/`commands` не заявлена. `dsh.engines.dsh`, которым пользуются два сторонних издателя, в DSH **не читается никем** | C §33, C F6, F §4.2 |
| 34 | Version policy | **Ч** | Артефакта матрицы в плане нет; рекомендация C: `>=0.1.7-rc.2 <0.2.0` + матрица проверок; exemption-файл профиля — часть контракта установки (точная версия, `--accept-risk`, режим 0600) | C §34, C F7 |
| 35 | Node / TS / pnpm | **П** + три асимметрии | Требования подтверждены; добавлено: Cordis 4.0.4 (vendor) против 4.0.2 у MyWork; TS 6.0.3 приходит и как зависимость Typert-генератора; `verbatimModuleSyntax: true` у MyWork против `false` у DSH — потенциальная TS-граница (нужен spike) | C §35, C F12 |
| 36 | Plugin Manager изменения | **П** с уточнением владельцев | Takeover-lock с защитой от PID-reuse живёт в `dsh-atomic-write`, а не в plugin-manager; ожидание оставшегося pnpm — `operations.ts:203-240` | C §36 |
| 37 | Model Catalog | **П** и усилено | «listed ≠ routable» подтверждено, причём источники разные: `resolveModelInfo` на маршруте `deepseek` синтезирует окно из дефолта деплоймента (1 000 000), а `listModels` может быть пуст (`discoverModels?.(provider) ?? []`). В DSH **три** независимых состояния доступности (Host `routableProviders/failures`, preflight `modelAvailable`, аккаунт, UI `routable/pending`). Предложен расширенный `ModelAvailability` + `ModelAvailabilityPort` | D §37, D N-2/N-3 |
| 38 | Session adapter conformance | **Ч** | Шесть операций и seam `/permission <preset>` подтверждены; conformance не покрывает `read-only` и `danger-full-access` (в тестах только `workspace-write`) и ветку «нет живого агента»; четыре разных отказа схлопываются в один `unavailable` | D §38, D N-4 |
| 39 | Context Fabric | **П**, но **не подключено** | L0/L1/L2, mandatory-refusal, trust→placement, frozen snapshot, provenance — всё в коде и 142 тестах (context 57 + memory 68 + memory-beads 17), **но** `discoverContext/decideContextAdmission/materialize/assemble/verify` не вызываются ни из одной runtime-точки: сегодня эти свойства не влияют ни на один реальный промпт | D §39, D N-1 |
| 40 | Memory Fabric и Team scope | **П**, но **не подключено** | 7 scopes, отождествления TeamId нет; beads-плагин регистрирует провайдера памяти напрямую, минуя фабрику и мандат `memory.semantic` | D §40, D N-1 |
| 41 | Request-extension limit | **П**, но уже | 8 MiB — конфиг **одной** contribution (`dsh_session_log`), а fallback (payload без **всех** extensions) живёт в deepseek-адаптере; `prepareRequestExtensions` вызывается из одного места. Вывод «byte/serialization-бюджеты» остаётся верным, но это не общесистемный лимит | C §41, D §41 |
| 63 | Acceptance gate DSH compatibility | **Ч** | Восемь пунктов проверяемы сегодня (Host boot, Web boot, enable/disable, model catalog, session start/resume, prompt, follow, cancel), три — нет (HMR/recomposition, permission pin для всех политик, «incompatible runtime refusal» для MyWork, потому что peer не объявлен) | C §63 |

### 5.5. Риски и план (§64–§65, §72–§73)

| § | Тема | Вердикт | Суть и действие | Источник |
|---|---|---|---|---|
| 64 | Риски | **Ч** | Семь названных рисков верны по существу, но список **неполон в самом дорогом месте**: нет ни одного риска про деньги (в платформе нет глобального cap'а стоимости), про потерю данных (неатомарная запись состояния), про самомодификацию (dynamic Cordis-плагины), про снос профиля `~/.dsh` (нет git-истории), про необратимую миграцию | G §64, G §5 |
| 65 | Приоритетный план работ | **Ч** | Phase 0 (ADR) и Phase 1 (совместимость) полезны, но Phase 1 и Phase 4 недоиспользуют платформу (invariants, jobs, token-meter, sandbox-policy), а порядок ставит Web впереди незакрытого execution-конвейера плана (MW-021…MW-026) | G §65, Lead §1.1 |
| 72 | Финальная архитектурная позиция | **П** по духу | Разделение обязанностей DSH/MyWork верно; уточнение: платформа даёт больше, чем перечислено (deliverables, token-meter, invariants, spill, jobs, references) | Lead, G |
| 73 | Проверенные источники | **Ч** | Ссылки на GitHub указывают на те же репозитории, что лежат локально (проверяемы); список не содержит главного локального источника — исходников установленной 0.4.3 в профиле | Lead §4.2 |

---

## 6. Конфликты решений: документ ↔ план ↔ код

| № | Тема | План v0.2 | Документ | Вердикт Lead'а |
|---|---|---|---|---|
| **K1** | Транспорт Web | MW-029/046/047: Application API + HTTP/SSE через `ctx.webServer`, маршруты `/v1/…`, наследование аутентификации | §19–§21: Typert Remote + `watch`-stream, «не создавать собственный loopback HTTP service» | **Оба пути законны.** Remote даёт типизацию, `RemoteResult`, uplink, `AbortSignal`, единый trust-check — ценой сборочной зависимости от Typert-генератора (F1) и отсутствия публичного примера для внешнего репозитория. HTTP через `ctx.webServer` + Host `typertGateway` — проверенный прецедент 0.4.3. **Решение:** до выбора сделать compile spike Typert в отдельной worktree; если spike дороже 1 дня — HTTP-путь с обязательным `expectedRevision`/идемпотентностью и явной авторизацией. Не смешивать: HTTP-префикс не должен совпадать с именем Remote-namespace (F8) |
| **K2** | Модель зон доски | ADR017/ADR018: 9 зон, зона = UI-группировка, `ZONE_BY_STATE` frozen; MW-042 DONE; MW-049: ровно 9 панелей 3×3 + порог 1100 px; MW-050: DnD без прямой записи | §5.2/§6: semantic lanes (7), `blocked` → бейдж в queue, `cancelled/superseded` → скрытый closed, layout-метрики убрать из контракта | **Принцип документа совпадает с ADR018** (зона ≠ состояние, exact state chip), спор — о словаре и постоянных колонках. Переход к v0.3 — это **пересмотр принятого контракта**: падают 8 утверждений `tests/board.test.mjs`, противоречат приёмки MW-049/050, нужен новый ADR вместо ADR018, миграция placement-ключей (не описана нигде) и решение по `closed`/`empty`. **Решение:** либо явный ADR-018-bis с полным пакетом правок, либо сохранить 9 зон и ограничиться переносом layout-констант в presentation-пакет (дешёвая часть §5.2) |
| **K3** | DnD как domain-команда | ADR017 уже требует: DnD не пишет состояние, строит `DropIntent` | §7 подаёт это как «важную корректировку» | **Уже принято.** Документ переоткрывает решённое. Новое и полезное у него — требование резолвера `DropIntent → MyWorkCommand`, которого нет (A). V1 уточнил: `applyDropIntent` способен менять зону при несогласованном входе, поэтому нужен явный guard инварианта |
| **K4** | Workflow engine | ADR020 + MW-044: свой движок внутри resident controller, `WorkflowRevision`, запрет shell/code, L2 по умолчанию | Не упомянут вовсе | **Коллизия понятий.** Платформа допускает **один** движок `ctx.workflowEngine` на контекст и понимает под workflow модельно-написанный скрипт с субагентами. MyWork-движок — другое (декларативный, валидируемый, без escape hatch). **Решение:** не регистрироваться в платформенный шов, переименовать домен (например, «execution pipeline»/«procedure») и записать границу в ADR, иначе через полгода это будет два «workflow» в одном профиле |
| **K5** | Учёт стоимости | MW-013 (бюджетный admission) и MW-034 (метрики) — свой учёт | §41 — только про лимит request extension | **Пробел обеих сторон.** `dsh-token-meter` уже даёт снимок расхода; в платформе нет глобального cap'а стоимости и лимита шагов. Нужен circuit-breaker поверх `token-meter` + счётчики в MW-013/MW-034 (G-P1/P2) |
| **K6** | Evidence/артефакты | MW-008 artifact store + append-only audit; MW-045 finish criteria | Не упоминает `deliverables`/`spill` | **Риск второй реализации.** Платформенные `deliverables` (present + workspace-changes) и `ctx.spillStore` решают часть той же задачи; MyWork нужен durable evidence, но захват «что изменилось за turn» можно не изобретать |
| **K7** | Миграция с легаси-доски | ADR021/ADR025 + MW-054: read-only адаптер, источник — файл ledger, hash-проверка, done не импортируются, после cutover строка убирается | §53–§54: composition-level замена | **Совместимы.** Уточнения: (а) в этой среде disable — строчный override внутри агрегата; (б) обоснование ADR021 в части DOM устарело (0.4.3 — native slots), в силе остаются heartbeat и владение ledger/runner/scheduler; (в) числа MW-054/055 о леджере ложны (актуально: 52 карточки в воркспейсе MyWork: 32 backlog / 19 done / 1 failed; 3 карточки в осиротевшем `3fc33afb`); (г) `autoRun*` — мёртвые ключи, проверять надо per-task расписания и доступность инструментов `task_board_run/schedule` |
| **K8** | Human gate | MW-030 (human gates, pause/cancel/retry/reassign), каталог `needs-attention`, `needs-evidence` | §27–§29: durable `HumanGate`, delegated child не спрашивает | **Уточнение, не конфликт.** Имя `HumanGate` занято → `HumanDecision`; сущность+хранение+дедлайн → MW-030, доставка ответа в живую попытку → MW-046, человеческая приёмка по work type → MW-045. Блокирующий `ask()` держит tool call и шаг агента (таймаута нет) → гейт обязан освобождать worker-сессию. Вне GUI уведомлений в DSH нет вообще: SLA «ответить за N часов» неисполним без открытой вкладки |
| **K9** | Agent Teams | В плане темы нет | §8–§17, §42–§46, §61, §66–§69 | **Главный вклад документа.** Паттерны переносить (provisioning saga с pre-minted identity, handoff artifact, advisory write scopes на Attempt, wait-for-change с честным `noProgress`), authority — нет. Coordination subsystem не строить |
| **K10** | Совместимость и версии | Политики peers/engines нет; MW-040 про состояние MyWork | §33–§36, §63 | **Обязательно.** Peer-compat gate — новый контракт публикации; MyWork объявляет только `@deepseek-ai/cordis` → гейт молчит. Нужен `peerDependencies` по реально используемым сервисам + `>=0.1.7-rc.2 <0.2.0`, `engines` (даже если DSH его не читает — читают издатели), и матрица проверок |

---

## 7. Чего не рассмотрели ни документ, ни план

### 7.1. Карточки плана вне поля зрения документа

Документ не упоминает ни одной карточки (проверено grep'ом), поэтому вне его анализа остались **~20 карточек**, то есть основная масса оставшейся работы:

| Группа | Карточки | Что не рассмотрено |
|---|---|---|
| Конвейер исполнения | MW-021…MW-026 | git worktree-изоляция, worker от admission до результата, детерминированные verification gates, независимый review и reject-flow, интегратор и завершение TaskGraph, Task Setter |
| Контекст и память | MW-016…MW-020 | Context Fabric, Skill Registry, Memory Fabric, внешний memory-адаптер, checkpoint/rollover/pressure — реализованы, но не подключены к рантайму (D) |
| Управление и восстановление | MW-028, MW-031 | embedded/resident controller, recovery и обнаружение застрявшей работы |
| Обучение | MW-032…MW-034 | Fast Role Learner, Sleep Optimizer, метрики и наблюдаемость |
| UI (кроме доски) | MW-036, MW-037, MW-051, MW-052 | Team Work/Roles/Settings, Role Lab/Activity/Audit, визуальный редактор workflow, graph/calendar/timeline |
| Приёмка и эксплуатация | MW-038…MW-041, MW-055 | Doctor и conformance, invariants/crash/security, upgrade/export/import/repair, упаковка operational v0.1, приёмка доски и миграции |

### 7.2. Платформенные примитивы, не учтённые нигде

`dsh-token-meter`, `ctx.invariants` + конвенция `./invariant`, `ctx.spillStore`, канонические session/file references, `session-query-sqlite`, `deliverables` (present + workspace-changes), `product-telemetry`, durable jobs (`LocalJobRegistry` + archive-admission), `storage-domain`, `sandbox-policy`/`fs-observation-policy` как runtime-enforcement прав роли, `credentials`/`approval`, `commands`, `systemPrompt.section`. Каждое из них закрывает часть задачи, которую план собирается решать сам (MW-007, MW-008, MW-013, MW-016, MW-034, MW-039, MW-048).

### 7.3. Дорогие риски, отсутствующие в §64

| Риск | Состояние | Митигация |
|---|---|---|
| **Runaway-стоимость** | Глобального cap'а стоимости и лимита шагов агентского цикла в платформе нет (узкие исключения: `maxRounds` у ralph, бюджеты subagent-провайдеров, `delegationDepth` — V2). `repeat-tool-reminder` лишь пишет текст в промпт | Circuit-breaker поверх `token-meter` + бюджет на attempt/workspace/сутки + счётчик шагов; G-P1/P2 |
| **Потеря данных** | Состояние MyWork пишется неатомарно (нет `writeFileAtomic`/`withFileLock`-дисциплины на уровне производных данных) | Атомарная запись + WAL + журнал миграций (RT-1, G-R4) |
| **Самомодификация** | Dynamic Cordis-плагины доступны агентам (`cordis_*`); approval привязан к `packageId`, будущие версии требуют явного opt-in (V2 опроверг «автоматическое покрытие будущих версий») | Запретить `cordis_*` и dynamic-инструменты в поверхности worker'а (G-S5); `auto-review` — только deny, никогда approve (G-S4) |
| **Снос профиля `~/.dsh`** | Профиль не под git (exit 128), но MyWork его знает: `scripts/verify-profile.mjs:127-134` и `packages/storage/src/layout.ts:66-68`, а state живёт внутри `$DSH_HOME/dsh-mywork/state/*.sqlite` | Doctor-проверка mtime/хэшей, dry-run в `.tmp`, запрет `plugin_manager` у агентов, внешняя копия профиля (V2 поправил формулировку G) |
| **Необратимая миграция** | Прерывание между migrate и verify даёт silent empty-state | Migration journal + verify-шаг + запрет «открыть store без канонического списка» (F 3.5, RT-10) |
| **Расхождение времени** | Детерминированный scheduler против платформенного `time-context`/`schedule` | Явно зафиксировать: время входит в scheduler только через инъецированные часы (RT-11) |
| **Тихое расхождение двух authority** | Доска и TaskGraph уже расходятся по статусам (9 падений на `done`) | Правило «done без failed-исполнений» + сверка леджеров + дешёвый reconciliation-тест |

### 7.4. Процессные пробелы (не видны документу в принципе)

1. **Четыре источника статуса** (INDEX.md, tasks.json, EXECUTION-PLAN.md, живая доска) противоречат друг другу.
2. **«done» не означает «принято»**: 11 failed-исполнений, 9 — на `done`-карточках.
3. **`superseded`-карточки (MW-027, MW-035) лежат в backlog** и формально запускаемы.
4. **Гейт прав** на 12 карточках — дефект конфигурации профиля (V1).
5. **Нет CI, нет тегов, `private: true` у всех 12 пакетов** — публикация невозможна by construction.
6. **Документированный вход сломан**: `pnpm run build|typecheck|check` и `node scripts/pack.mjs` → EXIT=1 (битый глобальный pnpm-линк); сборка и тесты воспроизводятся только прямыми вызовами.
7. **Устаревший блокер**: MW-043 (Idea Bank) заблокирован отсутствием MW-011 и MW-026; MW-011 с тех пор реализован (`packages/{contracts,core,planner}`), MW-026 — нет. Отчёт BLOCKED формально устарел частично.
8. **`.tmp` раздут** (3 751 файл / 175 МБ, включая посторонний зарегистрированный worktree `.tmp/mw012-review`) и `.rar` 41,4 МиБ в корне.

---

## 8. Измерения текущей реализации и точки оптимизации

### 8.1. Измеренное состояние (F, все числа с командами и exit code)

| Свойство | Значение | Оценка |
|---|---|---|
| Типизация | 12/12 пакетов `tsc --noEmit` без ошибок (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) | сильно |
| Тесты | **710 тестов: 687 pass / 0 fail / 23 skip**, 87,6 с, EXIT=0 (после обязательной сборки `tsdown` 204,7 с) | сильно, кроме Beads-слоя |
| Smoke / bundle | smoke 13/13; `verify:profile: PASS` (10,5 с, изолированный `DSH_HOME`, 3 хэша реального профиля не изменились) | сильно |
| Незавершённость в коде | 0 TODO/FIXME, 0 пустых `catch` | сильно |
| Достижимость из runtime | **4 из 12 пакетов**; 11 619 / 36 674 строк `src` (31,7 %) недостижимы; ни одной живой `*.sqlite` | слабо |
| Реальный backend | 23 теста skip; при включении 15 fail → 2 fail после починки раннера; 2 capability опровергнуты живым `bd` | опровергнуто частично |
| Наблюдаемость | 0 метрик/спанов при 90 вхождениях `correlationId` | задел есть, экспорта нет |
| Стоимость | счётчиков нет; `BudgetAmount = known | unknown` by design | не измеряется |
| Секреты | 0 реальных утечек, 5 синтетических фикстур в тестах, 0 в `.work` | чисто, но без автоматического гейта |
| Публикация | `private: true` ×12, 0 тегов, 0 CI | отсутствует |
| Воспроизводимость входа | `pnpm run *` падает в чистом shell | слабо |
| Целостность плана | 55 карточек в трёх леджерах, статусы согласованы только по количеству | слабо |

**Короткий вывод F.** Это не «сырой прототип»: типизация, тесты, типизированные отказы, fail-closed storage и работающий install-gate — уровень, редкий на стадии 22/55 карточек. Но два измерения меняют картину: **почти треть исходного кода не имеет ни одной runtime-точки входа**, и **единственный внешний backend не проверяется и не работает на целевой платформе**. Оба дефекта дешёвы (S/M) и оба невидимы ни одному зелёному прогону.

### 8.2. Приоритизированные точки оптимизации (сводно, 16 от F + дополнения потоков)

| # | Точка | Доказательство | Усилие | Риск |
|---|---|---|---|---|
| P1 | **Windows-путь `bd` не работает**: `spawnSync('bd', {shell:false})` → ENOENT; тот же дефект в `runner.ts:96,102-108` | замер `bd-probe.mjs`; при включённой пробе 15 fail | S | низкий |
| P2 | 23 «зелёных» пропуска маскируют отсутствие проверки backend (текст причины про EPERM неверен) | `tests/beads-adapter.test.mjs:57-73`; `# SKIP` ×23 в зелёном прогоне | S | низкий |
| P3 | **Одна capability опровергнута, вторая — дефект адаптера (поправка верификации).** `batch-dep-remove` **не опровергнута**: тест падает из-за чтения `edge.depends_on_id`, тогда как `bd dep list --json` отдаёт `id`/`dependency_type`; независимый эксперимент с `bd 1.3.0` показал `bd batch` → «2 operations committed» (exit 0) и корректный состав рёбер. `heartbeat` — реальный дефект, но не capability: `bd heartbeat <id>` в чистом workspace даёт exit 0, а адаптер не передаёт актора (`claim` передаёт `BEADS_ACTOR`, `heartbeat` — нет, `adapter.ts:583-590`) | `beads-runnerfix.log`; независимый прогон в temp-workspace | S (тест) + S (актор) | низкий |
| P4 | **31,7 % строк недостижимы из runtime** — нужен composition root | `graph.mjs`: NOT reachable 8 пакетов; `controller/src/index.ts:115-128` | L | высокий |
| P5 | `MYWORK_SCHEMA_VERSION = 1` не описывает базу: пять списков миграций, склеиваемых вызывающим; композиция только в тестах | `storage/src/migrations.ts:91-94`; 15 совпадений в тестах, 0 исполняемых в пакетах | S | низкий |
| P6 | Нет ни одного ограничителя роста базы (`outbox`, `inbox_dedup`, `audit_events`, `artifacts.bytes` — BLOB в SQLite) | в `packages/**/src` нет `DELETE FROM outbox`/`VACUUM`; D N-5 | M | средний |
| P7 | Ноль наблюдаемости при готовом correlation ID | 0 вхождений otel/telemetry; `correlationId` 90 / `correlation_id` 24 | M | низкий |
| P8 | Три леджера одного плана | экстрактор `ledgers.mjs` | S | низкий |
| P9 | «done» не означает успешный прогон (9 падений на done) | `executions[].result` → 20 succeeded / 11 failed | S (правило) / M (preset) | низкий |
| P10 | Публикация невозможна by construction (`private: true` ×12, devDeps на непубликуемые `@dsh-mywork/*`) | разбор 12 манифестов + распакованный tarball | S | низкий |
| P11 | Нет CI и ни одного релизного тега | `.github` отсутствует; 0 тегов | S | низкий |
| P12 | Документированный вход `pnpm` и слой запуска сломаны; `packController` не идемпотентен | три EXIT=1; `node scripts/pack.mjs` → EXIT=1 | S | низкий |
| P13 | Рабочий каталог раздут в 6 раз относительно кода (`.tmp` 175 МБ, `.rar` 41,4 МиБ, посторонний worktree) | `Measure-Object`; `git worktree list` → 3 записи | S | низкий |
| P14 | 710 тестов идут в одном процессе (`--test-isolation=none`) — протёкший глобальный стейт проявится как флак | `package.json:16`; 8 файлов пишут во временные SQLite | S | низкий |
| P15 | Одно коллизионное экспортируемое имя: `TaskTransitionCommand` в `contracts` и в `core` | `dups.mjs` → shared names: 1 | S | низкий |
| P16 | Метрика «125 383 строки» включает build output; корректно: 111 файлов / 36 674 строки `src` | сравнение трёх измерений | S | нулевой |
| P17 | **Резолвер `DropIntent → MyWorkCommand`** отсутствует, а `legalDropTargets` рекламирует недостижимые цели; `applyDropIntent` не проверяет свой инвариант | A §7, V1 (A-13) | M | средний |
| P18 | **`NeedsAttentionReason` — объявленный каталог без носителя**; `subState`, `SessionLink.active`, `PlacementChange.fromZone` — мёртвые поля | A §47/§48/§6.2, E N-3 | S-M | низкий |
| P19 | **Идемпотентность placement-команд**: `operationId` объявлен и игнорируется, `columnRevision` растёт на каждом вызове | A §3.3; у легаси есть `recentRequests` с `requestId`+`fingerprint` | M | средний |
| P20 | **Model availability**: `resolveModelInfo` не проба (синтезирует окно 1 000 000), `listModels` может быть пуст; нужен `ModelAvailabilityPort` + `RouteRefusalReason: model-not-routable` | D N-2/N-3 | M | средний |
| P21 | **Session conformance**: не покрыты `read-only`, `danger-full-access`, «нет живого агента»; 4 отказа схлопнуты в `unavailable` | D N-4 (8 предложенных тестов) | S | низкий |
| P22 | **Ретенция и сканеры**: артефакты в BLOB с запретом DELETE/UPDATE триггерами; `outbox`/`inbox_dedup` не чистятся; сканер секретов только по метаданным, не по телам | D N-5 | M | средний |
| P23 | **Peer-контракт и installable UI**: Host-часть готова, нет браузерной половины и `peerDependencies` | C F13/F14, F §4.2 | M-L | средний |
| P24 | **Provisioning saga и write-intent на Attempt** — единственные два переноса из Agent Teams, которые реально нужны | B §3.1/§3.2 | M | средний |
| P25 | **Boundary-тест дырявый**: DSH-импорт в `scheduler/src` не ловится (V2 подтвердил экспериментом), `planner/src` не сканируется вовсе | B 3.4, V2 | S | низкий |

---

## 9. Правки к плану, идеи и red-team

### 9.1. Сводная таблица правок по карточкам

| Карточка | Что менять | Почему | Источник |
|---|---|---|---|
| **MW-042** (DONE) | Переоткрыть как `MW-042-bis` **только если** принимается K2 (semantic lanes): 9 зон → 7, `LANE_BY_STATE` (`blocked → queue`, `needs-attention → error`, `cancelled/superseded → closed`), убрать/переопределить `BOARD_ZONE_ROWS`, решить судьбу `BOARD_STRIP_MAX_WIDTH_PX`, развести `board.move` на reorder/rezone, `projectTaskZone → projectTaskLane`. Иначе — оставить контракт и перенести layout-константы в presentation-пакет | Пересмотр принятого решения требует ADR-018-bis и переписывания 8 тестов | A §3.1 |
| **MW-043** (BLOCKED) | Перепроверить блокер: MW-011 реализован (`packages/{contracts,core,planner}`), MW-026 — нет. Либо закрыть MW-026, либо переоформить блокер на один пункт | Отчёт от 2026-09-18 устарел частично | Lead, A, V1 |
| **MW-049** | «Ровно девять панелей» → «N панелей по числу lanes»; порог 1100 px — UI-константа в `packages/web`, не в контракте; WIP-лимит — presentation-only | Прямое противоречие §5.2/§6 и ADR018 при v0.3 | A §3.2 |
| **MW-050** | Четыре неисполнимых пункта: «подсвечивает только легальные цели» (нужен резолвер), «drop без причины отклоняется» (нет поля и хранения), «два DropIntent с разными operationId» (нет идемпотентности), «Session link открывает сессию» (нет механики) | Приёмки невыполнимы на текущих контрактах | A §3.3, P17/P18/P19 |
| **MW-047** | Согласуется; уточнить: курсор/`boardRevision` (кто двигает), `degraded` vs `empty` | Нет писателя `boardRevision`; §50 теряет `empty` | A §3.4 |
| **MW-048** | Добавить: bare-имя пакета в client-строке, `dsh.client.immediately` для панели, `icon`, ручной CJS-формат бандла, `store` слота для view-состояния, **свой префикс для data-атрибутов панели** (`data-dsh-*` занят платформой) | Иначе бандл физически не зарегистрируется, а якоря панели столкнутся с платформенными | C F3/F4/F5/F10/F11, C-verifier |
| **MW-053/052** | Мелкие правки по lanes; graph view без новых зависимостей — сохранить | — | A §3.5 |
| **MW-054** | Три фактические ошибки: числа леджера (52/3, 32-19-1), «autoRunTodo выключен» → «нет ключей `autoRun*` и нет per-task расписаний», `todo/running` не использовались. Плюс: правило eligible даёт 33, а не 35; архив читается из файла — верно | Числа не воспроизводятся | A §3.6, V1 |
| **MW-055** | «41 карточка» → актуальные числа; сценарии без evidence считать непройденными — сохранить | — | A, V1 |
| **MW-030** | Встроить `HumanDecision`: сущность, состояния `pending/answered/expired/cancelled/superseded`, `trigger`, `originState`, `answeredBy`, CAS по `expectedRevision`+`controllerEpoch`, идемпотентность по `operationId`, аудит `gate.asked/gate.decided/human.override`, 9 тестов без UI | Половина инфраструктуры есть; имя `HumanGate` занято | E §3.1-3.7 |
| **MW-046** | Доставка ответа в живую попытку через `attempt.steer`, `DiscussionMessage(kind='decision')`, идемпотентность | Блокирующий `ask()` держит шаг агента | E §3.1 |
| **MW-045** | Добавить человеческую приёмку по work type: `WorkType`/`FinishCriteria`/`FINISH_CRITERIA_UNMET` в коде 0 совпадений | ADR028 требует human acceptance для 4 из 6 типов | E §3.1 |
| **MW-013/034** | Budget/step circuit-breaker поверх `dsh-token-meter`; OTel-экспорт `correlationId`; счётчики расхода; `providerConcurrency` | Нет ни cap'а, ни наблюдаемости | G-P1/P2, F P7, B N-13 |
| **MW-022/MW-024** | Запретить `cordis_*`/dynamic-инструменты в поверхности worker'а; `auto-review` — только deny | Риск самомодификации и обхода review | G-S4/S5 |
| **MW-004/039/040** | Единый список миграций; атомарная запись (`writeFileAtomic`/`withFileLock`); runtime-invariants (`InvariantRegistry`); retention+VACUUM; migration journal | RT-1/RT-10, P5/P6, G-R1/R4 |
| **MW-007/015** | Права роли → платформенный runtime-enforcement (`sandbox-policy` + `fs-observation-policy`), а не свой слой | Платформа уже умеет | G-S1 |
| **MW-033/040** | Durable jobs (`LocalJobRegistry`) для optimizer/миграции/импорта | Есть готовый примитив | G-R2 |
| **MW-010/011** | Дополнить приёмку: «ни один тест реального backend не может быть skipped в CI-профиле»; разобраться с двумя capability | Ложное «done» уже случилось | F 3.2/3.3, P2/P3 |
| **MW-040/041** | `private: true` → решение о распространении; `engines`; CI; тег `v0.1.0-m1`; починить `pack.mjs` | Публикация невозможна | F 3.7/3.8, P10/P11/P12 |
| **MW-038** | Doctor: сверка mtime/хэшей профиля; диагностика `bd`-seam | Риск сноса профиля | RT-9, V2 |
| **Новые карточки** | (1) **MW-056** починить `bd`-seam и сделать backend проверяемым; (2) **MW-057** починить тест batch-рёбер и актора `heartbeat`; (3) **MW-058** composition root; (4) бюджет/шаги/самомодификация; (5) installable UI-пакет + peer-манифест; (6) provisioning saga; (7) write-intent на Attempt; (8) Handoff Artifact; (9) `HumanDecision` (если не в MW-030) | Каждая — из подтверждённых находок | F/B/C/E/G |

### 9.2. Шорт-лист идей, которых нет ни в документе, ни в плане (из 25 кандидатов G)

| Приоритет | Идея | На каком примитиве | Усилие |
|---|---|---|---|
| 1 | Права роли через платформенный runtime-enforcement вместо своего слоя | `sandbox-policy`, `fs-observation-policy` | L |
| 2 | Budget circuit-breaker + учёт retry-множителя провайдера | `dsh-token-meter` | M+S |
| 3 | Negative requirements: `cordis_*`/dynamic вне поверхности worker'а; `auto-review` только deny | `tools`, `auto-review` | S+S |
| 4 | Runtime invariants + атомарная запись состояния | `InvariantRegistry`, `storage-domain`, `writeFileAtomic` | M |
| 5 | **Пересмотрено верификацией:** `LocalJobRegistry` — **не durable** (in-memory, process-local: `jobs-local/src/index.ts:123-128`, `docs/subsystems/jobs.md:331,398`), поэтому как основа для миграции/repair он не годится. Полезен только для внутрипроцессной оркестрации; durable-часть придётся строить на MyWork DB | `jobs-local`, archive-admission | M (с поправкой) |
| 6 | OTel-экспорт существующего correlation ID + продуктовые события | `session-telemetry-otel`, `product-telemetry` | M |
| 7 | MyWork как провайдер платформенных швов (memory/skill/context) вместо собственных фабрик | `MemoryProvider`, `SkillProvider`, `systemPrompt.section` | M |

### 9.3. Red-team: катастрофические сценарии (с поправками верификатора)

| ID | Сценарий | Статус после верификации | Митигация |
|---|---|---|---|
| RT-1 | Неатомарная запись состояния → потеря данных | подтверждён | атомарная запись + journal |
| RT-2 | Runaway-стоимость | **подтверждён в ядре, дважды уточнён**: глобального cap'а и лимита шагов агентского цикла нет, но есть узкие бюджеты (`maxRounds` 256, `error_max_budget_usd`, `sessionBudgetExceeded`, `max_turn_requests`, `delegationDepth`, бюджеты времени/раундов/поиска), а в MyWork **уже есть** учёт (`tokenCount`/цена вызова, `BudgetConsumption {tokens, cost}`) | circuit-breaker поверх token-meter; опираться на существующий учёт MyWork, а не строить второй |
| RT-3 | Рекурсивное самоизменение | **опровергнут в сильной форме**: approval привязан к `packageId`, будущие версии — только явный opt-in (`requiresApproval`, `approveFutureVersions` по умолчанию false) | всё равно запретить `cordis_*` в worker-поверхности |
| RT-4 | Обход review через LLM-аппрувер | подтверждён как риск | `auto-review` только deny; человеческая приёмка по work type |
| RT-5 | Утечка секретов через телеметрию/индекс | подтверждён частично (heartbeat 0.4.3 жив, выключателя нет; сканер секретов не покрывает тела) | retention/сканеры; решение по heartbeat |
| RT-6 | Порча чужого репозитория через shared checkout | подтверждён | worktree-политика; `writeScopes` — диагностика, не lock |
| RT-7 | Залипание очереди | подтверждён | stall detection + `maxAttempts` + эскалация в `needs-attention` |
| RT-8 | Тихое расхождение двух authority | подтверждён (9 падений на `done`) | правило приёмки + сверка леджеров |
| RT-9 | Снос профиля `~/.dsh` | **ядро подтверждено, формулировка поправлена**: профиль не под git, но MyWork знает путь (`verify-profile.mjs`, `layout.ts`), а state живёт внутри `$DSH_HOME` | Doctor-проверки, dry-run, внешняя копия |
| RT-10 | Необратимая миграция без journal | подтверждён | migration journal + verify |
| RT-11 | Расхождение времени (scheduler vs `time-context`) | подтверждён как проектный | инъецированные часы |

---

## 10. Что делать первым: последовательность с гейтами

### Этап 0 — гигиена и разблокировка (часы, без кода)

| # | Действие | Почему именно сейчас |
|---|---|---|
| 0.1 | Поднять `sessionDefaultPermission` в `profiles/web/cordis.patch.yml` на уровень `config.sessionDefaultPermission` (сейчас вложен в `config.config`) | Без этого 12 карточек MW-044…MW-055 не запускаются; починка — одна строка (V1) |
| 0.2 | Убрать/выключить мёртвые ключи `autoRun*` из строки `web-ui-task-board` и проверить, что per-task расписаний нет | Ключи не читаются 0.4.3, но создают ложную картину защиты |
| 0.3 | Архивировать MW-027/MW-035 из backlog (они `superseded`) | Формально запускаемы |
| 0.4 | Зафиксировать правило: «карточка не переводится в `done`, если хотя бы одно исполнение `failed`, без строки-обоснования в отчёте» | 9 падений на `done`-карточках |
| 0.5 | Сделать внешнюю копию `C:\Users\Dmitry\.dsh` (профиль не под git) и записать способ восстановления | Единственный невосстановимый ресурс в контуре |

### Этап 1 — сделать проверяемым то, что уже есть (1–3 дня)

1. **MW-056** — починить `bd`-seam (резолв JS-entry через `process.execPath` на win32; тот же seam в пробе и Doctor), превратить skip в падение в CI-профиле. Гейт: `node --test tests/beads-adapter.test.mjs` → `pass 70 / fail 0 / skipped 0`.
2. **MW-057** (с поправкой верификации) — (а) починить **тест** `batch`-рёбер: читать `id`/`dependency_type` вместо `depends_on_id`; capability `batch-dep-remove` **подтверждена** живым `bd 1.3.0` (независимый эксперимент: «2 operations committed», exit 0, корректный состав рёбер); (б) починить **адаптер** `heartbeat` — передавать актора, как это делает `claim` (`adapter.ts:583-590` против `:495-500`); опускать capability `heartbeat: false` не нужно. Гейт: `node --test tests/beads-adapter.test.mjs` → `pass 70 / fail 0`.
3. **P5** — единый `MYWORK_DATABASE_MIGRATIONS`; запретить открытие store без него.
4. **P11/P12** — минимальный CI (`install --frozen-lockfile` → `tsc` ×12 → `tsdown` → `smoke` → `node --test` → `verify-profile.mjs`), тег `v0.1.0-m1`; починить `pack.mjs` и записать рабочий bootstrap `pnpm`.
5. **P8/P9** — INDEX.md как производный артефакт с `lastSyncedRevision`; сверка `done`-множеств.

### Этап 2 — соединить подсистемы (3–7 дней)

6. **MW-058 composition root** — один application service: открыть `controller.sqlite` полным списком миграций, поднять lease/planner/execution/scheduler/evidence, зарегистрировать в `myworkAdapters`. Гейт: smoke открывает store на версии 6 в изолированном `DSH_HOME`, `Test-Path $DSH_HOME\dsh-mywork\state\controller.sqlite`.
7. **Provisioning saga** (B §3.1) — pre-minted `instanceId`, 5 шагов, матрица recovery из 9 строк.
8. **Boundary-тест** — расширить `FORBIDDEN` до `@deepseek-ai/dsh*`, сканировать `scheduler`/`planner`/`adapter-sdk`; V2 подтвердил дыру экспериментом.
9. **P6/P22** — retention + VACUUM + сканеры тел артефактов/памяти; **RT-1** — атомарная запись.

### Этап 3 — решения и контракты (1–2 недели)

10. **ADR-пакет:** K1 (транспорт, с compile spike Typert), K2 (зоны доски), K4 (имя и граница workflow-движка), K10 (peer/version policy), Agent Teams relationship, `HumanDecision` вместо `HumanGate`.
11. **Installable UI-пакет + peer-манифест** (MW-048 пересмотр): bare-имя в client-строке, `dsh.client.immediately`, `icon`, ручной CJS-формат, `store` слота; peer по реально используемым сервисам + `>=0.1.7-rc.2 <0.2.0`.
12. **Бюджет/шаги/самомодификация:** circuit-breaker поверх `token-meter`, счётчик шагов, запрет `cordis_*` в worker-поверхности, `auto-review` только deny.
13. **Model availability + session conformance** (D N-2/N-4) — 8 тестов на политики прав и ветку «нет живого агента».

### Этап 4 — вернуться к критическому пути плана

14. MW-021 → MW-022 → MW-023 → MW-024 → MW-025 → MW-026 (конвейер исполнения), затем MW-031 (recovery), MW-038/039 (Doctor, invariants), и только потом Board v0.3 + Web UI (MW-047…MW-055) — если K2 решён в пользу semantic lanes.

### Что НЕ делать (защита от переусердствования)

- Не строить coordination subsystem/mailbox (нет потребителя; outbox+inbox dedup уже есть).
- Не заменять `AgentRuntimePort`, не переносить TeamTask как canonical Task, не отождествлять TeamId с SessionId.
- Не переписывать TaskGraph/MyWork DB в event sourcing.
- Не регистрировать MyWork-движок в `ctx.workflowEngine` (один движок на контекст — иначе конфликт с платформенным).
- Не удалять агрегат `@linxin666/dsh-web-all` (в нём 18 нужных строк) — выключать только строку `web-ui-task-board`.
- Не делать собственный учёт токенов с нуля: `dsh-token-meter` уже даёт снимок.
- Не полагаться на `dsh.engines.dsh` (в DSH не читается) — только `peerDependencies`.
- Не считать «колонку Готово» доказательством приёмки.

---

## 11. Независимая верификация: что подтвердилось, что опровергнуто

### 11.1. Три независимых трека

| Трек | Что проверял | Объём | Результат |
|---|---|---|---|
| **V1** (фальсификатор) | 35 утверждений потока A + 12 несущих утверждений Lead-заметок | 47 | 31 подтверждено, **12 опровергнуто**, 4 неопределённо |
| **V2** (фальсификатор) | заголовочные находки потока B, три red-team и 4 идеи потока G, §27/§28 внешнего документа | 50 | 38 подтверждено, **3 опровергнуто**, 4 частично, 5 не проверено |
| **Массовая перепроверка** (6 верификаторов, по одному на поток) | все claim-леджеры потоков A, B, D, E, F, G | **331** | 308 подтверждено, **5 опровергнуто**, 17 частично, 1 неопределённо |
| Массовая перепроверка потока C | 50 claim'ов платформы (Typert, Slots, `dsh.client`, compat-gate, Schedule, request-extension, atomic-write, toolchain) | 50 | 49 подтверждено, **1 частично** (C-49: отрицание «в DSH нет ни одной строки `data-dsh-*`» неверно — таких строк 13; вывод об отсутствии `semantic-attrs-v1.md` сохраняется), 0 опровергнуто |

Итого: **381 claim** в консолидированном леджере (`CLAIMS.md`), и **все 381 перепроверены независимо** — массово по потокам, плюс 97 углублённых проверок V1/V2 на несущих утверждениях (с пересечением). Все отчёты верификаторов лежат в `verify/*.md` и `V1-verification.md`/`V2-verification.md`.

### 11.2. Опровержения, которые меняют выводы (исправлены в этом отчёте)

| # | Что опровергнуто | Кто нашёл | Корректная формулировка | Где исправлено |
|---|---|---|---|---|
| 1 | «`applyDropIntent` — чистый reorder и не может менять зону» (A-13) | V1, исполненным контрпримером | При **согласованном** placement — reorder; при несогласованном (`zone != projectTaskZone(exactState)`) функция меняет зону и возвращает `fromZone` (инвариант сам не проверяет). Сегодня латентно: продуктовых потребителей вне модуля нет | §5.2 (строка §7) |
| 2 | «Capability `batch-dep-remove` опровергнута живым `bd`» (F-14) | массовая проверка, независимым экспериментом | Ложно: тест читает `edge.depends_on_id`, тогда как `bd dep list --json` отдаёт `id`/`dependency_type`. `bd batch` отрабатывает корректно (exit 0), ребро добавляется и удаляется как заявлено. Правится **тест**, а не манифест | §8 P3, §9.1 (MW-057), §10 этап 1 |
| 3 | «Учёта расхода токенов/денег нет» (F-50) | массовая проверка | Ложно: `tokenCount` и цена вызова считаются (`packages/core/src/budget.ts:166-172`, `BudgetConsumption {tokens, cost}`); «unknown» = провайдер не сообщил usage. Отсутствует **глобальный cap/enforcement**, а не учёт | §1.1 п.10, §9.3 (RT-2) |
| 4 | «`bd heartbeat` — опровергнутая capability» (F-15) | массовая проверка | Дефект реален, но причина — адаптер не передаёт актора (`claim` передаёт `BEADS_ACTOR`, `heartbeat` — нет, `adapter.ts:583-590`); в чистом workspace команда даёт exit 0 | §8 P3, §9.1 (MW-057) |
| 5 | «`LocalJobRegistry` годится как durable-основа для миграции/repair» (G-13) | массовая проверка | Ложно: реестр in-memory и process-local (`jobs-local/src/index.ts:123-128`, `docs/subsystems/jobs.md:331,398`) | §9.2 идея 5 |
| 6 | «Риск самомодификации: approval покрывает будущие версии» (G-25/RT-3) | V2 | Опровергнуто в сильной форме: approval привязан к `packageId`, будущие версии — только явный opt-in (`requiresApproval`, `approveFutureVersions` = false по умолчанию) | §1.1 п.10, §9.3 RT-3 |
| 7 | «MyWork не знает путь профиля `~/.dsh`» (часть RT-9) | V2 | Ядро верно (профиль не под git), но путь знают `scripts/verify-profile.mjs:127-134` и `packages/storage/src/layout.ts:66-68`, а state живёт в `$DSH_HOME/dsh-mywork/state` | §7.3 RT-9 |
| 8 | «`wait_agent` блокирует до изменения» — уже с оговоркой B, но отрицания «0 совпадений» и часть якорей | массовая проверка (G-06/G-07/G-09/G-27, A-04/A-25/A-60, D-46, B-26, E-24) | Опровержения касаются **точной формулировки доказательств**, не существа: отрицательные грепы требуют `-CaseSensitive`; часть якорей смещена на несколько строк; «все шесть лимитов» → восемь; «claim только owner/Lead» → любой member может claim свободной задачи; перечень notify неполон | §5 (соответствующие строки), §11.3 |
| 9 | Числовые ошибки в отчёте F (F-05/12/21/23/29/38/48) | массовая проверка | Размер леджера, число таблиц (16, а не 15), шаги smoke (12, а не 13), «9 падений на `done`» → фактически **7** (MW-003…MW-008, MW-043; MW-002 в backlog), часть падений без `ADAPTER_UNAVAILABLE` | §7.4 п.2, §8.1 |
| 10 | Атрибуции первых коммитов и «новая подсистема deliverables» в Lead-заметках | V1 | Исправлено: ssh `4fb0fdac68` (09-12), token-meter `f038780ff6` (07-15), auto-review `55e53907ab` (09-09), `deliverables/tool-present` — **переезд**, а не новая подсистема; разбивка по областям и число совпадений `PlanMutation` (86, не 183); INDEX.md — 53 `planned` + 2 `superseded` | §3.2, §3.3 |
| 11 | «Auto Review включён в этом профиле» | массовая проверка (E) | Объявление в `dsh.profile.bundles` есть, но пакет не установлен и строки в `cordis.patch.yml`/`cordis.yml` нет → слой **не смонтирован** | §4.1 |
| 12 | «В DSH нет ни одной строки `data-dsh-*`» (C-49) | массовая проверка (C) | Отрицание переобобщено: таких строк 13 (`data-dsh-boot` в `client/ui-renderer/src/client/index.ts:66,73`, `data-dsh-automatic-focus` в `client/ui-primitives/src/focus.ts:15,24`). Существо верно — контракта `semantic-attrs-v1.md` и именно `data-dsh-panel-entry` в DSH нет (проверено двумя независимыми поисками), но пространство `data-dsh-*` занято платформой → якоря MyWork — в своём префиксе |
| 13 | Адрес поля версии у C-38/F6 | массовая проверка (C) | Типизировано только верхнеуровневое `package.json.engines`; фактическое `dsh.engines.dsh` сторонних издателей в схему `DshManifest` **не входит вовсе**, читателей нет ни для одного адреса. Вывод «контракт версии — только `peerDependencies`» подтверждён |
| 14 | Оговорка к C-34 | массовая проверка (C) | Полностью невалидный exemption-файл не даёт исключений, но при **частичном** повреждении игнорируются только плохие записи, остальные действуют |

### 11.3. Что подтвердилось независимо (несущие выводы)

- **Платформа:** 3 650 коммитов дельты, даты тегов, состав «нового»/«существовавшего», агрегат `@linxin666/dsh-web-all` 0.4.3 с peer `>=0.1.7-rc.2`, легаси-доска 0.4.3 на нативных слотах, живой heartbeat, мёртвые ключи `autoRun*`, дефект вложенного `sessionDefaultPermission`.
- **Board:** 9 зон и layout-константы в контракте (`board.ts:26-63,66-76,126-132`), 16 `TaskState`, невозможность cross-lane drop, противоречие `legalDropTargets` ↔ write-путь, отсутствие сущности `Idea`, `MW-043` = BLOCKED, числа леджера (55 карточек, 52 в воркспейсе MyWork, 34 backlog / 19 done / 2 failed, 0 расписаний), ложность чисел MW-054/055, тесты доски 24/24.
- **Оркестрация:** механика Agent Teams (bounds, queue-before-delivery, dedup, selective teardown, provisioning saga, отсутствие авто-освобождения owner), `maxMembers: 8` — профильный слой, `wait_agent`/`noProgress`, отсутствие peer mailbox, 16 `TaskState`, authority split, чистота scheduler, `HumanGate` как тип, `DELEGATED_CALLER`, отсутствие timed-API.
- **Репозиторий:** 710 тестов / 687 pass / 0 fail / 23 skip (EXIT=0), typecheck 12/12, smoke, `verify:profile: PASS` с нетронутым живым профилем, недостижимость 8 пакетов, отсутствие живых `*.sqlite`, отсутствие TODO/FIXME и утечек секретов, отсутствие CI и тегов, `private: true` ×12, сломанный `pnpm`-вход.

### 11.4. Насколько можно доверять этому отчёту

Из 381 claim'а независимо перепроверены **все** (массово по потокам + 97 углублённых проверок V1/V2 на несущих утверждениях). Сводно по массовой проверке 381 claim: **357 подтверждено, 5 опровергнуто, 18 частично, 1 неопределённо**; плюс опровержения и уточнения V1/V2. Доля дефектов доказательств — около 6 %. Почти все дефекты — в **точности ссылок и чисел**, и три — содержательные (batch-capability, учёт стоимости, durable jobs). Все три содержательных исправлены в тексте выше. Ни одна из верхнеуровневых рекомендаций (§10) не опирается на опровергнутые пункты; наоборот, две рекомендации после верификации **подешевели**: `bd batch` не нужно переделывать (правится тест), а `heartbeat` — это передача актора, а не отказ от capability.

Что осталось непроверенным сквозным образом: эффективная собранная композиция живого профиля, компиляция MyWork против типов rc.2, поведение браузера и Plugin Manager, `bd init`/Dolt-remote, стоимость LLM, GUI-сценарии.

---

## 12. Приложения

### 12.1. Артефакты кампании

| Файл | Что внутри |
|---|---|
| `00-ground-truth.md` | Проверенные факты среды, карта 74 разделов документа, правила кампании |
| `A-board.md` | Board: контракты, проекция, DnD, Idea, legacy-cutover — 72 claim, 18 находок |
| `B-orchestration.md` | Agent Teams, TaskGraph/Scheduler/Execution, coordination, durability — 57 claim, 17 находок |
| `C-platform.md` | Typert/Slots/bundle/compat/toolchain/Schedule — 50 claim, 14 находок |
| `D-context.md` | Context/Memory/Session/Model routing/Evidence — 50 claim, 10 находок |
| `E-human-gates.md` | user-questions, `HumanDecision`, review, attention — 60 claim, 15 находок |
| `F-gaps.md` | Измерения репозитория, 16 точек оптимизации, 11 правок плана — 50 claim |
| `G-frontier.md` | 25 идей, 11 red-team, 9 отвергнутых идей — 42 claim |
| `L-lead-notes.md` | Дельта платформы, карта конфликтов K1–K10, живая композиция, локальный референс |
| `CLAIMS.md` | 381 атомарное утверждение из семи потоков |
| `V1-verification.md`, `V2-verification.md`, `verify/*.md` | Независимая проверка (фальсификация) и массовая перепроверка |
| `FINAL-REPORT.md` | Этот отчёт |

### 12.2. Как воспроизвести ключевые проверки

```powershell
# ревизии и дельта платформы
git -C H:\Repo\DSH-MyWork log -1 --format='%H %ad %s' --date=iso
git -C C:\Reposit\deepseek-harness\deepseek-harness rev-list --count dsh-v0.1.5-rc.2..dsh-v0.1.7-rc.2

# контракт доски и состояния
Select-String -Path H:\Repo\DSH-MyWork\packages\contracts\src\board.ts -Pattern 'BoardZone|grid-3x3|1100'
Select-String -Path H:\Repo\DSH-MyWork\packages\contracts\src\task.ts -Pattern "TaskState ="

# тесты (в изолированной копии, живое дерево не трогать)
git -C H:\Repo\DSH-MyWork worktree add --detach H:\Repo\DSH-MyWork\.tmp\<имя> HEAD
# внутри копии: tsdown по 12 пакетам, затем
node --test --test-isolation=none --test-reporter=spec "tests/**/*.test.mjs"

# живой леджер (только чтение, скриптом)
node -e "const j=require('C:/Users/Dmitry/.dsh/task-board/ledger-v2.json');console.log(j.revision,Object.keys(j.tasks).length)"

# установка MyWork в изолированном профиле
node H:\Repo\DSH-MyWork\scripts\verify-profile.mjs
```

### 12.3. Решения, которые нужны от владельца

1. **K1 — транспорт Web:** Typert Remote (со сборочной зависимостью от генератора) или HTTP через `ctx.webServer` (проверенный прецедент, но своя авторизация)? Рекомендация: compile spike Typert на 1 день, затем решение.
2. **K2 — модель зон доски:** пересматривать ли принятый ADR018 и приёмки MW-042/049/050 (semantic lanes v0.3) или ограничиться переносом layout-констант из контракта в presentation-пакет?
3. **K4 — имя и граница workflow-движка:** не регистрировать MyWork-движок в `ctx.workflowEngine` и переименовать домен?
4. **K10 — версии и публикация:** принимаем `peerDependencies: @deepseek-ai/dsh >=0.1.7-rc.2 <0.2.0` + `engines`; как распространяем (tarball/vendored или registry, снимая `private` у `controller`)?
5. **Бюджет:** вводим ли жёсткий cap стоимости и лимит шагов на attempt/workspace/сутки (и какие значения)?
6. **Легаси-доска:** выключаем строку `web-ui-task-board` после верифицированного cutover и когда именно (с учётом того, что она внутри агрегата из 19 строк)?
7. **MW-001:** карточка числится `failed` и архивирована при наличии двух отчётов — каков её окончательный статус?
8. **Профиль:** починить вложенный `sessionDefaultPermission` и убрать мёртвые `autoRun*`; монтировать ли `auto-review` (сейчас объявлен, но не установлен)?
9. **v0.3 vs конвейер:** принимаем ли порядок §10 (сначала execution/review/recovery, потом Board/Web) вместо порядка §65 документа?

### 12.4. Что осталось непроверенным и требует отдельного шага

- Эффективная собранная композиция живого профиля Cordis (влияет на утверждения про `invariants`, `maxMembers`, Schedule).
- Компиляция MyWork против типов DSH rc.2 (TS 5.7 против 6.0.3) и работа Typert-генератора вне монорепозитория.
- Поведение браузера: выдача `/plugins/<id>/client.js`, HMR-канал, рендер панели, темы/скины.
- Живой Plugin Manager (install/remove/enable) и живой Schedule.
- `bd init`, Dolt-remote, `bd serve`, поведение на Linux/macOS.
- Стоимость LLM и реальные размеры баз (базы ещё нет).
- GUI-сценарии и доступность (всё, что требует открытого браузера).

### 4.3. Факт-коррекция к ADR021 и §53

Маркеров DOM-перехвата (`data-dsh-taskboard-active`, `centerCol`) в 0.4.3 **нет**, а `native-panel.tsx` прямо заявляет «not a DOM takeover». Значит аргумент ADR021 «DOM-наблюдатель и инъекция в центральную колонку» устарел. В силе остаются: heartbeat без выключателя и владение леджером/runner'ом/scheduler'ом. Осторожность: сам пакет содержит устаревший комментарий `src/client/locales.ts:4` («DOM-injected entry row») — то есть ошибка воспроизводима из комментария, а не из реализации.

### 4.4. Живой дефект конфигурации (найден V1)

`C:\Users\Dmitry\.dsh\profiles\web\cordis.patch.yml:20-35` кладёт право **вложенно** (`config.config.sessionDefaultPermission: workspace-write`), оболочка агрегата отдаёт плагину все ключи строки кроме `plugin` (`web-all/lib/shell-DWqLngib.js:1088-1092`), а плагин читает право с верхнего уровня (`src/index.ts:323`) → действует дефолт `read-only` (`core/handover.ts:44`). Отсюда непройденный гейт у 12 карточек MW-044…MW-055. Починка — поднять ключ на уровень `config.sessionDefaultPermission`. Ключи `autoRun*` в той же строке — **мёртвая конфигурация**: `Config` 0.4.3 объявляет 8 полей и подстроки `autoRun` не содержит вовсе (A, подтверждено V1 в том числе по `web-all`).
