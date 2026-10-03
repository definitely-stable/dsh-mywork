# Ground truth — сводный брифинг для исследовательских потоков

**Дата среза:** 2026-09-26 (вечер, Asia/Yekaterinburg).
**Кампания:** «DSH MyWork — глубокий анализ v2»: сверка внешнего документа `dsh-mywork-deep-analysis-2026-09-26.md` (74 раздела) с фактическим кодом MyWork, планом v0.2 и текущим DSH rc.2.
**Роль этого файла:** единый источник проверяемых фактов о среде. Не перепроверяй то, что здесь написано, если сам факт не является предметом твоего потока; всё, что здесь есть, уже проверено командами (см. «Как получены факты»).

> Никаких изменений в живом дереве, в живом профиле DSH (`C:\Users\Dmitry\.dsh`), в леджере доски (`C:\Users\Dmitry\.dsh\task-board\ledger-v2.json`) и в других проектах. Пиши **только** свой файл из списка ниже.

---

## 1. Пути и ревизии (проверено)

| Что | Значение |
|---|---|
| Рабочий каталог / репозиторий MyWork | `H:\Repo\DSH-MyWork` (origin `https://github.com/definitely-stable/dsh-mywork.git`) |
| MyWork HEAD | `0c657ae1434202865bd330f0eeaf2b60eb78f6d4` (2026-09-22 00:56 +0500, «test(session): cover the checkpoint, the rollover, and the pressure decisions») |
| MyWork ветка | `main` (единственная; `origin/main` совпадает) |
| MyWork dirty state | только ` M pnpm-lock.yaml` (незакоммиченный дрейф lockfile) |
| DSH checkout | `C:\Reposit\deepseek-harness\deepseek-harness` |
| DSH HEAD | `c7c4c725c7889abfdb46fcdd78b14940232940cf` (2026-09-26 11:45, «local: keep deepseek-v4.1-flash in the pi-ai opencode-go catalog») |
| DSH версия (root package.json) | `0.1.7-rc.2` |
| Базовая ревизия, на которой построен внешний документ | `477b4f420553e8a52c2fbccc464d7561b239c443` (merge PR #5180, release 0.1.7-rc.2) |
| Разница | DSH-код между базовой ревизией документа и текущим HEAD: **1 коммит** — `c7c4c725` (локальная правка каталога pi-ai/opencode-go) плюс незакоммиченные untracked-файлы (локали `ru.json` в experimental-пакетах, `.playwright-cli/`, мусор в корне: `1+1`, `location.href`, `.tmp-codex-recovery.ps1`) |
| Как запущен GUI на 127.0.0.1:3080 | `node --import tsx/esm apps/cli/src/bin.ts web` (PID 17984), т.е. **DSH из исходников checkout**, а не из npm-пакета |
| Установленный лаунчер | `C:\Users\Dmitry\.dsh\bin\dsh.cmd` → `pnpm --dir C:\Reposit\deepseek-harness\deepseek-harness dsh …`; `dsh --version` → `0.1.7-rc.2` |
| Профиль | `C:\Users\Dmitry\.dsh\profiles\web` + `C:\Users\Dmitry\.dsh\profiles\node_modules\@deepseek-ai\*` (установленные пакеты), overlay: `C:\Users\Dmitry\.dsh\overlay\repo` (патчи `patches/@earendil-works__pi-ai@0.85.1.patch*`, `packages/experimental/**`) |
| Toolchain | node **v24.19.0**, npm **11.17.0**, pnpm **12.4.2** (Node в системном PATH; pnpm вызывается из H:\.pnpm-store-линка) |
| Легаси-доска (сторонний плагин) | `C:\Users\Dmitry\.dsh\task-board\ledger-v2.json` (369 634 байт, mtime 2026-09-26 22:01), `ledger-v2.lock`, `scheduler-v2.json` (28 байт) |

## 2. Что физически есть в MyWork (проверено)

190 файлов исходников (`.ts/.mjs/.js`, без `node_modules`/`dist`), **125 383 строки**.

| Пакет | Файлов | Строк |
|---|---|---|
| `packages/contracts` | 33 | 17 344 |
| `packages/core` | 26 | 30 121 |
| `packages/adapter-sdk` | 15 | 8 197 |
| `packages/beads-adapter` | 20 | 9 631 |
| `packages/controller` | 6 | 5 658 |
| `packages/execution` | 8 | 7 299 |
| `packages/planner` | 8 | 9 228 |
| `packages/scheduler` | 5 | 5 064 |
| `packages/lease` | 8 | 3 838 |
| `packages/evidence` | 10 | 4 116 |
| `packages/storage` | 13 | 4 156 |
| `packages/memory-native` | 6 | 3 282 |
| `tests/*.test.mjs` | 27 | ~19 700 |

Все пакеты версии `0.1.0`, `main: ./lib/index.js`.

Прочие каталоги: `.work/` (архитектура, карточки, отчёты), `.analysis/` (майнинг сессий, retired-скиллы), `.beads/` (Beads/Dolt workspace, prefix `mw`), `.dsh/skills/` (4 проектных скилла: `context-economy`, `evidence-gated-delivery`, `isolation-and-deletion-safety`, `session-skill-forge`), `scripts/` (`pack.mjs`, `smoke.mjs`, `verify-profile.mjs`), `tests/lib/`, `.tmp/` (scratch, gitignored), `DSH-MyWork.rar` (43 МБ, лежит в корне).

## 3. План MyWork v0.2 (проверено по `.work/tasks/INDEX.md`)

- Архитектура: `.work/architecture/DSH-My-Work-Architecture-v0.1.md` (3 019 строк) + решения `.work/architecture/DSH-My-Work-Architecture-v0.2-decisions.md` (644 строки).
- `planRevision 2`; карточки MW-001…MW-055 (файлы `.work/tasks/MW-0NN.md`, INDEX.md, `tasks.json`, `board-export.json`, `board-actions.json`, `board-before.json`).
- Группы: `00-foundation` (MW-001…008), `01-runtime` (009…015), `01b-board` (042), `02-context` (016…020), `03-execution` (021…026), `04-control` (027…031), `04b-board` (043…047), `05-learning` (032…034), `06-ui` (035…037, 048…053), `07-acceptance` (038…041, 055), `07-migration` (054).
- Сняты: MW-027 → MW-042/047/048; MW-035 → MW-048/049/050/053.
- Критический путь: `MW-009 → MW-010 → MW-011 → MW-047 → MW-029 → MW-048 → MW-049 → MW-050 → MW-053 → MW-055 → MW-041`; плюс ветки 042, 054, 044→045→051, 046→050, 052.
- В `INDEX.md` у **всех** карточек статус `planned` — индекс не отражает фактические отчёты и статусы доски (это уже расхождение само по себе).

### Реально выполненные карточки (есть отчёт в `.work/reports/`)

`MW-001-review`, `MW-001-target-capabilities`, `MW-002-bootstrap`, `MW-003-domain-contracts`, `MW-004-storage`, `MW-005-adapter-sdk`, `MW-006-team-config`, `MW-007-security`, `MW-008-evidence-audit`, `MW-009-controller-lease`, `MW-010-beads-adapter`, `MW-011-*` (8 артефактов: review, adversarial-2, delta-verification ×4, fixes-verification, plan-mutations), `MW-012-attempt-saga`, `MW-012-review`, `MW-013-routing-budget`, `MW-014-scheduler`, `MW-014-review`, `MW-014-fixes-verification`, `MW-015-dsh-runtime`, `MW-016-context-fabric`, `MW-017-skills`, `MW-018-native-memory`, `MW-019-external-memory`, `MW-020-sessions`, `MW-042-board-projection`, `MW-043-idea-bank`, `setup-verification.json`.

**Нет отчётов (значит не реализовано или не задокументировано):** MW-021…MW-041 (кроме 027/035 — сняты), MW-044…MW-055.

### Живая доска (плагин `dsh-task-board`, отдельный authority)

На момент снятия среза: revision 324, зона `Asia/Yekaterinburg`, `maxSubtaskDepth 1`, session-default permission `read-only`, счётчики `backlog 32 / todo 0 / running 0 / done 19 / failed 1 / archived 3`, всего 52 карточки. Заголовки карточек совпадают с MW-планом (это фактически второй леджер того же плана). Один failed-execution: `agent-presets: preset "standard" failed to mount: 24 rows name plugins that cannot be resolved` (нерешённые пакеты `@deepseek-ai/dsh-persona`, `dsh-tool-fs`, `dsh-tool-skill`, `dsh-plan-mode`, `dsh-tool-subagent*`, `dsh-tool-workflow`, `dsh-tool-ralph`, `dsh-tool-ask-user`, `dsh-tool-todo`, `dsh-tool-web`, `dsh-tool-present` и др.). Отдельные карточки MW-044…MW-055 имеют `permissionPending: true` (гейт подтверждения прав не пройден).

## 4. Состояние DSH rc.2 (проверено выборочно; глубоко проверяет поток C)

- Платформа запускается из исходников; в профиле включены (среди прочего): `@deepseek-ai/dsh-typert-registry`, `dsh-typert-loader`, `dsh-api-gateway`, `dsh-session`, `dsh-session-projection(+cache)`, `dsh-session-persistence-jsonl`, `dsh-session-query-sqlite`, `dsh-session-telemetry-otel`, `dsh-storage`, `dsh-storage-json`, `dsh-storage-domain`, `dsh-sandbox(-policy)`, `dsh-pwsh-sandbox`, `dsh-user-approval`, `dsh-permission-presets`, `dsh-user-questions`, `dsh-plugin-manager`, `dsh-settings`, `dsh-config-editor`, `dsh-authorization`, `dsh-deepseek-account-platform`, `dsh-credentials-local`, `dsh-llm(-pi-ai, -retry)`, `dsh-jobs-local`, `dsh-hmr`, `dsh-skill`, `dsh-commands`, `dsh-goal`, `dsh-agent`, `dsh-agent-default-model`, `dsh-attachment-local`.
- Выключены (в этом профиле): `dsh-tool-bash`, `dsh-tool-pwsh`, `dsh-tool-fs`, `dsh-tool-fs-search`, `dsh-tool-jobs`, `dsh-skill-filesystem`, `dsh-tool-skill`, `dsh-agent-instructions`, `dsh-command-goal`, `dsh-plan-mode`, `dsh-bash-sandbox`. Всего в профиле 218 записей.
- Новые/актуальные подсистемы rc.2, которые проверяет документ: Typert Remote (`@Remote`, `@RemoteScope`, stream), Web Client Slots (`sidebar.panellist`, keyed `main`), `dsh.client`-метаданные клиентского бандла, `experimental/agent-team` (+ `tool-agent-team`, `client-ui-agent-team`, `agent-team-profile`), `experimental/auto-review`, `schedule`, `user-questions`, plugin-manager compat gate (peerDependencies против runtime), request-extension size limit, протекция lock takeover с PID-reuse.
- В коммитах около rc.2 есть и откаты: `bb19061473 feat(user-questions): support timed waits and late replies`, затем `32905d5ab5 Revert "feat: reconcile timed questions with legacy default"`; `cad6fef2fd feat(web): disable shipped schedule and time context plugins`.
- 2026-09-26 в этой сессии доступны Agent Teams инструменты (`spawn_teammate`, `send_message`, `wait_agent`, `team_task_*`), task board инструменты (`task_board_*`), cron-планировщик доски, `workflow`.

## 5. Внешний документ: карта разделов (проверено grep по заголовкам)

Файл: `C:\Users\Dmitry\.dsh\attachments\v1\files\bb\bb0996d771c4f70eba064a94c0486637756cdd2a3917531fca76b091f89e325a\dsh-mywork-deep-analysis-2026-09-26.md` (2 058 строк, 73 054 байта, только для чтения; чтобы править — скопируй в рабочую область).

| § | Строка | Тема |
|---|---|---|
| 1 | 18 | Итог в одном разделе |
| 2 | 39 | Текущий MyWork: что уже есть (2.1 структура, 2.2 controller) |
| 3 | 76 | MyWork Team Work богаче DSH Agent Teams |
| 4 | 99 | TaskGraph и Scheduler: почему Agent Teams не authority |
| 5 | 144 | Консолидированный предыдущий анализ Board |
| 6 | 194 | Board v0.3: рекомендуемая модель (6.1 16 states, 6.2 needs-attention, 6.3 blocked, 6.4 cancelled) |
| 7 | 267 | Drag-and-drop: архитектурная корректировка |
| 8 | 290 | DSH Agent Teams: фактическая реализация (8.1 модель, 8.2 bounds) |
| 9 | 337 | Provisioning teammate как pattern |
| 10 | 384 | Durable mailbox Agent Teams |
| 11 | 404 | Нужен ли MyWork собственный mailbox |
| 12 | 429 | Peer message и Context Fabric |
| 13 | 456 | Shared Team task board: не authority для MyWork |
| 14 | 495 | Advisory write scopes |
| 15 | 525 | waitForChange вместо polling |
| 16 | 544 | Selective teardown |
| 17 | 559 | Agent Teams invariant companion |
| 18 | 567 | Web projection Agent Teams |
| 19 | 586 | Правильный Web data path MyWork |
| 20 | 612 | DSH Typert Remote API |
| 21 | 659 | Browser mutations только через domain commands |
| 22 | 684 | Native DSH Web Surface |
| 23 | 719 | Slot discipline |
| 24 | 734 | Packaging: один bundle, несколько packages |
| 25 | 764 | Agent Teams tools: не core MyWork path |
| 26 | 794 | Fresh/fork teammate context и SessionWindow |
| 27 | 815 | Human interaction: корреция по текущему DSH |
| 28 | 836 | Delegated child не может спрашивать человека |
| 29 | 858 | HumanGate как отдельный domain |
| 30 | 881 | DSH Schedule: функции и граница |
| 31 | 906 | DSH Schedule ≠ MyWork Scheduler |
| 32 | 940 | Auto Review DSH и MyWork Review |
| 33 | 957 | Plugin compatibility gate |
| 34 | 975 | Version policy MyWork |
| 35 | 990 | Node / TypeScript / pnpm |
| 36 | 1022 | Последние Plugin Manager изменения |
| 37 | 1039 | Model Catalog требует ревизии |
| 38 | 1073 | Session adapter: conformance усилить |
| 39 | 1098 | Context Fabric сильнее prompt inheritance |
| 40 | 1121 | Memory Fabric и Team scope |
| 41 | 1141 | DSH request-extension size limit |
| 42 | 1157 | Сводная матрица Agent Teams vs MyWork |
| 43 | 1182 | Что переносим из Agent Teams |
| 44 | 1207 | Что не переносим |
| 45 | 1225 | Опциональный Agent Coordination subsystem |
| 46 | 1260 | Альтернатива mailbox: Handoff Artifact |
| 47 | 1279 | Roster/Agents UI MyWork |
| 48 | 1299 | Session navigation |
| 49 | 1314 | Board read model как агрегат |
| 50 | 1345 | Board consistency и degraded mode |
| 51 | 1364 | Раздельные revisions domain и placement |
| 52 | 1375 | MyWork client stores |
| 53 | 1412 | dsh-web/сторонний Task Board |
| 54 | 1438 | Replacement стороннего Board только composition-level |
| 55 | 1456 | Новые ADR (A…F) |
| 56 | 1484 | File-by-file изменения MyWork |
| 57 | 1563 | Предлагаемый Host target (схемы) |
| 58 | 1609 | BoardSnapshot concept |
| 59 | 1654 | Command concept |
| 60 | 1672 | Acceptance gate: Board v0.3 до UI |
| 61 | 1689 | Acceptance gate: optional Coordination |
| 62 | 1707 | Acceptance gate: Web package |
| 63 | 1722 | Acceptance gate: DSH compatibility |
| 64 | 1742 | Риски (6 групп) |
| 65 | 1774 | Приоритетный план работ (Phase 0…5) |
| 66 | 1826 | Что делать с Agent Teams сейчас |
| 67 | 1842 | Заменять ли AgentRuntimePort |
| 68 | 1867 | Переносить ли whole-snapshot events |
| 69 | 1875 | «no automatic owner release» подтверждает lease model |
| 70 | 1891 | Shared checkout и worktree policy |
| 71 | 1905 | KEEP / CHANGE / ADD / DO NOT ADOPT (таблица) |
| 72 | 1945 | Финальная архитектурная позиция |
| 73 | 1984 | Проверенные источники (список URL) |
| 74 | 2043 | Короткий operational verdict |

**Ключевые несущие утверждения документа, которые обязаны быть проверены фактами (не мнением):**

1. §2.2: controller монтирует только `MyWorkControllerService`, `MyWorkAdaptersService`, LLM-каталог и Session/AgentRuntime адаптер; нет единого application service на `scheduler → admission → claim → attempt → review → board`.
2. §5.2/§56: `BoardZone` жёстко задан девятью зонами, а layout contract знает `grid-3x3 | strip-horizontal` и порог 1100 px — presentation-знание в domain-контракте.
3. §7: `legalDropTargets()` + `applyDropIntent()` существуют, но `applyDropIntent` обязан сохранять `placement.zone == projection(exactState)` и не меняет TaskState → настоящий cross-column drag нельзя сделать только через placement.
4. §8.2: bounds Agent Teams: roster/tasks/pending messages/message bytes/disposal timeout; в опубликованном профиле `maxMembers: 8`.
5. §10: queue-before-delivery, dedup на стороне цели, `delivered` пишется только после durability целевой сессии.
6. §15: `waitForChange()` не реплеит старое событие, будит на edge.
7. §17: invariant companion — проекция кандидата на committed prefix до append.
8. §20: Typert Remote реально поддерживает `@Remote`, `@RemoteScope`, stream-режим, cancellation, uplink.
9. §22/§23: официальный путь — root `sidebar.panellist` + keyed `main`, `ctx.slots.inject/register`, `dsh.client`-метаданные; iframe/DOM-injection не нужны.
10. §24: `agent-team-profile` — единый bundle (domain + tool + client-ui).
11. §27: в текущем `master`/rc.2 `UserQuestionService.ask()` только blocking; `askTimed`, `TimedQuestionWait`, `ASK_TIMED_OUT`, late-answer API отсутствуют.
12. §28: runtime-owned child получает `DELEGATED_CALLER` и не может спрашивать человека.
13. §30: Schedule умеет cron/IANA/timezone/durable storage/cold restore/CAS/delivery receipts, но shipped Web composition его отключает.
14. §33: DSH перед импортом проверяет `peerDependencies` на `@deepseek-ai/dsh*`; несовместимый bundle → `skippedBundles`; exemption только после risk acknowledgement. MyWork controller объявляет только Cordis peer.
15. §35: MyWork engines `Node >=22.18`, TS `~5.7.2`, pnpm `12.4.2`; DSH rc.2 — Node `^22.19.0 || >=24.0.0`, TS `^6.0.3`, pnpm `11.7.0`.
16. §37: `DshModelCatalog` оборачивает `listProviders/listModels/resolveModelInfo` + contextWindow, но не различает «listed» и «routable»; в DSH есть отдельное отслеживание availability/account setup.
17. §38: session adapter использует create/list/selectModel/prompt/cancel/follow; permission pin идёт через команду `/permission` и требует conformance на все политики/resume/cold/missing command/no live agent/refusal.
18. §41: недавний фикс DSH ограничивает размер optional request extension и не даёт ему блокировать model request.
19. §53/§54: сторонний task board нельзя заменять CSS/скрытием кнопки — только composition-level (disable foreign rows + enable MyWork bundle).
20. §69: Agent Teams interrupt останавливает turn, но не освобождает owner TeamTask («no automatic owner release»).

## 6. Правила работы (обязательны для всех потоков)

1. **Утверждение без доказательства — не утверждение.** Каждый факт о коде/платформе несёт `файл:строка` (или `§` документа + цитата) и, если это проверялось командой, — команду и её exit code. Не видел — пиши «не проверял».
2. **Проверяй по исходникам, а не по README.** README-описание Agent Teams или Slots не является доказательством поведения: смотри реализацию.
3. **Только чтение чужого.** Никаких правок в живом дереве MyWork, в профиле `C:\Users\Dmitry\.dsh`, в леджере доски, в DSH-checkout. Если для проверки нужен мутирующий эксперимент — только в своей копии: `git -C C:\Reposit\deepseek-harness\deepseek-harness worktree add --detach C:\Reposit\deepseek-harness\deepseek-harness\.tmp\<имя> HEAD` (или аналог в `H:\Repo\DSH-MyWork\.tmp\`), и опиши это в отчёте.
4. **Один писатель на файл.** Ты пишешь ровно один файл — свой (см. задание). Никаких правок файлов других потоков, никаких правок `.work/tasks/*`, `INDEX.md`, `tasks.json`, `ledger-v2.json`.
5. **Не выдумывай ID карточек, путей, версий и чисел.** Если числа нет — пиши «не измерено».
6. **Язык отчётов — русский**, технические идентификаторы — как в коде.
7. **Формат отчёта потока** (Markdown, без воды):
   - `# <Поток>: <тема>`, затем `**Вердикт потока:**` одной строкой.
   - `## 1. Что проверено и как` — таблица `утверждение → как проверял (файл:строка / команда + exit code) → результат`.
   - `## 2. Разбор по разделам документа` — по каждому разделу из твоего списка: `ПОДТВЕРЖДЕНО / ЧАСТИЧНО / ОПРОВЕРГНУТО / УСТАРЕЛО / ОТСУТСТВУЕТ В ПЛАНЕ` + доказательство + что это меняет.
   - `## 3. Правки к плану MyWork` — конкретно: какая карточка/файл/контракт меняется, что именно, почему, чем проверяется.
   - `## 4. Новое, чего не было в документе и в плане` — идеи/риски/точки оптимизации с обоснованием и оценкой (S/M/L по усилию, влияние, риск).
   - `## 5. Открытые вопросы и что я НЕ проверял` — честный список.
   - `## 6. CLAIMS` — таблица атомарных проверяемых утверждений: `ID | утверждение | доказательство (файл:строка / команда / §) | статус (verified/unverified/refuted)`.
     ID — с префиксом потока: `A-01…`, `B-01…`, `C-01…`, `D-01…`, `E-01…`, `F-01…`, `G-01…`. Каждое утверждение — одно предложение, проверяемое независимо. Это вход для потока верификации: **чем точнее ID и доказательство, тем дешевле независимая проверка**.
8. **Не экономь на доказательствах, экономь на пересказе.** Разделы документа не пересказывай — сверяй.
9. **Ограничение по объёму:** 400–900 строк на отчёт. Глубже — не длиннее.
