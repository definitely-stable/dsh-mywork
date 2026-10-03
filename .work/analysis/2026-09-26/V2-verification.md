# V2: независимая верификация-фальсификация потоков B и G + сквозная проверка §27/§28

**Вердикт:** из 50 проверенных утверждений **подтверждено 38**, **опровергнуто 3** (G-25/RT-3 в сильной форме, RT-9 «не известен MyWork», формулировка B «scheduler/planner не сканируются вовсе»), **частично подтверждено/опровергнуто 4** (RT-2 «нет ни одного лимита шагов», доказуемость «до append», существо G-27 при неверных ссылках, §28 agentless-нюанс), **не проверено 5**. Все пять заголовочных находок потока B воспроизведены (N-01, `maxMembers: 8`, `noProgress`, устаревшая строка §42 «Install», дыра boundary-теста — последняя продемонстрирована экспериментом в отдельной worktree). Главная находка верификации: **RT-3/G-25 потока G описывает approval динамического Cordis-плагина как безусловно распространяющийся на будущие версии; в коде это opt-in решение человека, а по умолчанию каждый пакет требует нового подтверждения.** Вторая: тезис RT-9 «профиль не известен MyWork» ложен — путь `~/.dsh/profiles/web/*` явно назван в `scripts/verify-profile.mjs`, а state MyWork живёт внутри того же `$DSH_HOME`. Третья: четыре ссылки в отчётах ведут не туда, куда заявлено.

Ревизии: MyWork `0c657ae1…`, DSH `c7c4c725…` (0.1.7-rc.2). Режим: только чтение чужих деревьев; записан ровно один файл — этот.

## 1. Что и как проверялось

Живое дерево MyWork не изменялось: после всех прогонов `git -C H:\Repo\DSH-MyWork status --porcelain` пуст (exit 0). Профиль `C:\Users\Dmitry\.dsh` только читался. DSH-checkout только читался (git grep / read).

Мутирующая часть — **одна** worktree, созданная по правилу брифинга §6.3:

    git -C H:\Repo\DSH-MyWork worktree add --detach .tmp/v2-boundary-demo HEAD   → exit 0, HEAD 0c657ae

- в worktree созданы junction'ы `packages/<pkg>/lib` → живой `lib` (12 пакетов) и `node_modules` → живой `node_modules`, чтобы тесты видели собранные артефакты, не копируя их;
- baseline до правок: `node --test tests/boundaries.test.mjs tests/scheduler.test.mjs` → **53 pass / 0 fail, exit 0**;
- правка 1: в `.tmp/v2-boundary-demo/packages/scheduler/src/service.ts` первой строкой добавлен `import '@deepseek-ai/dsh-experimental-agent-team'`;
- правка 2 (контроль): то же в `.tmp/v2-boundary-demo/packages/core/src/scheduler.ts`;
- worktree **не удалялась** (рекурсивных удалений не делаю). Снять её при необходимости: `git -C H:\Repo\DSH-MyWork worktree remove --force .tmp/v2-boundary-demo`.

Прогоны тестов в живом дереве: только `node --test tests/boundaries.test.mjs` (26 pass / 0 fail, exit 0). Прогоны B (83 pass, 60 pass) я не повторял — см. §5.

## 2. Поток B: заголовочные находки

### 2.1 N-01 — companion-инвариант не смонтирован — **ПОДТВЕРЖДЁН**

| Проверка | Команда / чтение | Результат |
|---|---|---|
| Подпуть публикуется | `packages/experimental/agent-team/package.json:21-24,40` | `exports["./invariant"]` → `lib/invariant.js`, `files: ["lib/invariant.js"]` |
| Companion требует сервис | `packages/experimental/agent-team/src/invariant.ts:15,17,20-31` | `name='team-invariant'`, `inject=['invariants']`, слушатель `internal/dispatch` |
| Монтаж сервиса `invariants` | grep `/invariant\|dsh-invariants` по всем `cordis*.yml` в `packages/` | ровно 5 совпадений, все в `packages/bundle/sdk-minimal/cordis.patch.yml:107,110,113,116,119` |
| Монтаж где-либо ещё | `git grep -n -E "dsh-invariants\|/invariant'" -- '**/*.yml' '**/*.yaml' '**/package.json'` | те же 5 строк sdk-minimal; остальные — только `peerDependencies`/`devDependencies` в `package.json` (не монтаж) |
| Бандлы без инвариантов | `findstr /i "invariant"` по `bundle/{base,web-app,web-app/presets,headless,sdk-app,acp-app}/cordis.patch.yml` | exit 1 — ни одного упоминания |
| Монтаж companion'а agent-team | grep `experimental-agent-team/invariant` по `packages/experimental` | вне самого пакета — 0 совпадений |
| Профильный слой | `agent-team-profile/cordis.patch.yml:16-33` | вставляет ровно `agent-team`, `tool-agent-team`, `ui-agent-team` |

Вердикт по подпунктам B-24 и N-01: **подтверждён полностью**, включая «сервис `invariants` монтируется только бандлом `sdk-minimal`» (строка 107) и «`bundle/base`/`web-app` не упоминают `invariant` вообще».

### 2.2 Механика «отвергается до append» — **ПОДТВЕРЖДЁН по чтению, не воспроизведён прогоном**

`packages/core/session/src/index.ts`: docstring `:716-720` («A synchronous internal dispatch validation failure … also rejects before the log changes»), сбор callbacks `:759` (`collectSessionCallbacks(entry.emitCtx, [entry.carrier, 'session/event', ...])`), затем `this.log.push(event)` `:761`. То есть throw из `internal/dispatch`-слушателя действительно происходит до изменения лога; `agent-team/src/invariant.ts:28-30` вызывает `fail(...)` при `candidate.failure !== undefined`. Строки `759-761` в отчёте B указаны верно.

Оговорка: слушателей `internal/dispatch` я не поднимал (нет собранного Team-сервиса с включённым `invariants`) — это чтение, а не наблюдение `InvariantError`. У B это же ограничение заявлено честно (§5 п.3).

### 2.3 `maxMembers: 8` — профильный слой, не домен — **ПОДТВЕРЖДЁН**

- `packages/experimental/agent-team-profile/cordis.patch.yml:20` — `maxMembers: 8` (в блоке `insert` для `@deepseek-ai/dsh-experimental-agent-team`, строки 17-24);
- `packages/experimental/agent-team/src/index.ts:41` — `const DEFAULT_MAX_MEMBERS = 16`, `:60` — zod-default, `:80` — валидация `positiveLimit`;
- лимит проверяется **внутри** `journal.transact` и по `state.members.length` — `roster.ts:269-278` (`:274-276`), то есть провалившиеся участники посчитаны.

**ПОДТВЕРЖДЁН** (B-01…B-03).

### 2.4 §15 неполон: `wait_agent` коротко возвращает `noProgress` — **ПОДТВЕРЖДЁН**

`packages/experimental/tool-agent-team/src/index.ts`:
- `:39` `ACTIVE_WAIT_STATUSES = new Set(['running','provisioning'])`, `:40` текст `NO_ACTIVE_PEER_MESSAGE`;
- `:244` описание инструмента уже говорит «returns noProgress immediately»;
- `:252-274` `execute`: валидация диапазона уходит в сервис (`:257-259`), затем синхронный интервал чтения roster + регистрации waiter'а (`:260-263`), и при отсутствии активного peer — `{timedOut:false, noProgress:{reason:'no-active-peer'}}` (`:264-272`).
- Границы ожидания подтверждены отдельно: `agent-team/src/activity.ts:22-25` — 10 000…3 600 000 мс, `TEAM_INVALID_TIMEOUT`.

Буквальное «блокирует до следующего изменения» действительно неверно. **ПОДТВЕРЖДЁН** (B-06).

### 2.5 §42 «Install» устарела — **ПОДТВЕРЖДЁН**

- `packages/controller/cordis.patch.yml:12-14` — `insert: id: mywork-controller → name: '@dsh-mywork/controller'`;
- `packages/controller/package.json:21-25` — публикационная форма `dsh.bundle.patch: ./cordis.patch.yml`, `files: ["lib","cordis.patch.yml"]`;
- `scripts/verify-profile.mjs:27` (`BUNDLE = '@dsh-mywork/controller'`), `:188-191` (пакет в `dependencies` **и** в `dsh.profile.bundles`), `:210-213` (слой `# == @dsh-mywork/controller`, строка `id: mywork-controller`, разрешённое имя, дошедший overlay-config).

Строка §42 «следует повторить bundle pattern» описывает сделанное как предстоящее. **ПОДТВЕРЖДЁН** (B-56, N-17).

### 2.6 Дыра в boundary-тесте — **факт ПОДТВЕРЖДЁН, обоснование B ОПРОВЕРГНУТО частично**

Что подтвердилось (чтение `tests/boundaries.test.mjs`):

- `FORBIDDEN` (`:17-25`) — `@deepseek-ai/cordis`, `beads`, `hindsight`, `openviking`, `sqlite`, `better-sqlite3`, `node:sqlite`; ни одного шаблона `@deepseek-ai/dsh*`;
- `FORBIDDEN_FOR_STORAGE` (`:127-133`) — то же без `sqlite`/`node:sqlite`; `FORBIDDEN_IN_BOARD` (`:518-527`) — тоже без DSH;
- source-скан: `sources = {contracts, core}` (`:111-114`), плюс отдельные `storageSources` (`:117`), `evidenceSources` (`:124`); проверка «no domain source imports DSH…» (`:165-175`) идёт только по `sources`;
- built-artifact проверки: contracts/core/controller (`:186-198`), storage (`:243`), evidence (`:327`), lease (`:408`), execution (`:484`) — `scheduler`/`planner` отсутствуют;
- `grep 'scheduler|planner|memory-native|beads-adapter' tests/boundaries.test.mjs` — совпадений нет.

**Опровергается** другое — фраза B (§66, строка 214): «`scheduler`, `planner`, `memory-native`, `beads-adapter`, `adapter-sdk` **не сканируются вовсе**». `packages/scheduler/src` сканируется другим тестом: `tests/scheduler.test.mjs:935-944` читает каталог `packages/scheduler/src` и запрещает 7 игл (`ModelPort`, `resolveModelInfo`, `listModels`, `selectModelRoute`, `routeModel(`, `AgentRuntimePort`, `adapter-sdk`). То есть «не сканируется» неверно; верно то, что список игл не содержит имён DSH-пакетов, поэтому конкретный `@deepseek-ai/dsh-experimental-agent-team` не ловится. `packages/planner/src` действительно не сканируется ничем (проверено grep'ом по tests: единственное чтение `packages/<pkg>/src` — `scheduler.test.mjs:935` и `adapters.test.mjs:452`, последний только по `contracts`/`core`).

**Эксперимент** (моя worktree, описана в §1):

| Прогон | Команда | Результат |
|---|---|---|
| baseline (нет правок) | `node --test tests/boundaries.test.mjs tests/scheduler.test.mjs` | 53 pass / 0 fail, **exit 0** |
| правка 1: DSH-импорт в `packages/scheduler/src/service.ts` | тот же | **53 pass / 0 fail, exit 0** → дыра подтверждена: ни один из двух тестов не падает |
| правка 2 (контроль): тот же импорт в `packages/core/src/scheduler.ts` | `node --test tests/boundaries.test.mjs` | 25 pass / **1 fail, exit 1**: `packages/core/src/scheduler.ts must not import "@deepseek-ai/dsh-experimental-agent-team"` |

Итог: вывод B «импорт DSH-пакета в `packages/scheduler/src` сегодня не поймает ни один тест» **подтверждён экспериментом**; утверждение «scheduler не сканируется вовсе» — **опровергнуто**; контрольный прогон показывает, что в сканируемом пакете тот же импорт падает (правда, на правиле «только свои модули», а не на списке FORBIDDEN).

### 2.7 Утверждения о MyWork — **все ПОДТВЕРЖДЕНЫ**

| Утверждение B | Доказательство | Вердикт |
|---|---|---|
| 16 `TaskState`, три терминальных | `packages/contracts/src/task.ts:11-43` (union), `:46-63` (`TASK_STATES`, 16 элементов), `:66` (`TASK_TERMINAL_STATES = done/cancelled/superseded`) | ПОДТВЕРЖДЁН (B-31) |
| authority split TaskGraph/MyWork | `packages/contracts/src/taskgraph.ts:9-14` — дословно «The task graph owns description, dependencies, **readiness**, priority, role requirement and final completion. MyWork owns the current attempt, leases and fences, reviews, git refs and audit» | ПОДТВЕРЖДЁН (B-32) |
| scheduler — чистая функция без LLM | `findstr /n /r /c:"Date\.now" /c:"Math\.random" /c:"async " /c:"await " /c:"process\." packages\core\src\scheduler.ts` → **exit 1** (совпадений нет); тест-запрет `tests/scheduler.test.mjs:921-945` | ПОДТВЕРЖДЁН (B-34) |
| attempt/lease/fence и порядок проверки | `packages/execution/src/service.ts:405-429` (`assertOwnership`: fence против токена задачи `:411-418` → обязательный `controllerEpoch` `:419-425` → сверка с копией попытки `:426-427`); `packages/contracts/src/attempt.ts:80-89` (`Lease{fence,controllerEpoch,expiresAt}`); `packages/lease/src/lease.ts:292-305` (`holdsLeadership` требует instance **и** epoch **и** `leaseUntil > at`) | ПОДТВЕРЖДЁН (B-39, B-43) |
| peer mailbox/coordination отсутствует | `findstr /s /n /i /r /c:"mailbox" /c:"PeerMessage" /c:"coordination" packages\*.ts` → **exit 1** | ПОДТВЕРЖДЁН (B-45) |
| outbox + inbox dedup | `packages/storage/src/inbox.ts:51-73` — `applyOnce(consumer, eventId, apply)`, `:56` идемпотентность, `:58-63` запрет асинхронного эффекта | ПОДТВЕРЖДЁН (B-46) |
| `HumanGate` — тип, а не домен | `packages/contracts/src/security.ts:171-181` (`HumanGate`), `:184-190` (`HUMAN_GATES`), `:193-195` (`DOMAIN_IMPLIED_GATES`); отдельного пакета/модуля HumanGate в `packages/` нет | ПОДТВЕРЖДЁН |
| pre-minted identity в provisioning | `agent-team/src/roster.ts:259` `childId = randomUUID()` **до** `journal.transact` (`:269`) и до `startContinuable` (`:282`) | ПОДТВЕРЖДЁН (B-16, N-06) |
| `dependency-result` — не mandatory/instruction, свой bucket | `packages/contracts/src/context.ts:108-112` и `:125-129` (обе таблицы: policy/role-contract/task-contract), `:452-456` (`dependencies: 'dependency-result'`), `:476-477` (целевой лимит) | ПОДТВЕРЖДЁН (B-49) |

## 3. Поток G: red-team и идеи

### 3.1 RT-2 runaway-стоимость — **узкие утверждения ПОДТВЕРЖДЕНЫ, абсолютная формулировка ЧАСТИЧНО ОПРОВЕРГНУТА**

Что подтверждено:

- `git -C <DSH> grep -n -I -E "spendLimit|costLimit|maxCost|dailyLimit|budgetUsd|budgetTokens|costBudget"` по **всем** tracked-файлам → **exit 1** (0 совпадений). Расширение на другие расширения/пути (`packages/**/src/**`, `**/*.tsx`, `apps/**`, `sdk/**`) результата не меняет;
- `… "maxTurns|maxSteps|maxIterations|maxToolCalls|stepLimit|turnLimit" -- ':(glob)packages/**/src/**'` → **exit 1**; то же для `apps/**`, `sdk/**`, `**/*.tsx` → exit 1;
- «единственный жёсткий ограничитель — пер-инструментальный deadline»: `packages/guard/timeout-policy/src/index.ts:57-59` — `ctx.tools.get(...)?.timeoutMs`, `if (timeoutMs === undefined) return next()` с комментарием «A tool that declares no budget: no deadline, delegate unchanged»; `packages/core/tools/src/index.ts:260` — «Cooperative tool-call timeout budget … Omit for no deadline»;
- «`budget` в платформе = контекст/пиксели/байты»: `compaction-basic/src/config.ts:172-196` (`messageBudgetTokens`, `pressureBudgetTokens`), `attachment-local/src/index.ts:43-77` (total-pixel бюджет и caps), `api/job-controller/src/index.ts:38-39` (`observeMaxFrameBytes`).

Что **опровергает** абсолютное «нет ни одного лимита шагов/стоимости» (и расширяет контрпримерный список):

| Механизм | Файл:строка | Что это |
|---|---|---|
| `maxRounds` (по умолчанию 256) и статус `budget-limited` | `packages/workflow/tool-ralph/src/index.ts:174`, `:187`, `:181` («returns … at the round limit») | реальный лимит раундов у инструмента ralph |
| `error_max_budget_usd` | `packages/subagent/subagent-claude-code/src/run.ts:116` | проброс бюджетной ошибки внешнего SDK Claude Code (деньги!) |
| `sessionBudgetExceeded` | `packages/subagent/subagent-codex/src/wire.ts:125` | то же для Codex |
| `max_turn_requests` (turn-request budget) | `packages/subagent/subagent-acp/src/run.ts:231` | бюджет числа turn-запросов у ACP-провайдера |
| `delegationDepth` — recursion budget | `packages/core/agent/src/index.ts:71-84`, `packages/core/session/src/types.ts:120-123` | ограничение глубины делегирования (не шагов) |
| единственное совпадение семейства `maxTurns` | `packages/subagent/subagent-claude-code/tests/real-product.spec.ts:40,49,53,126,354` | тест, а не harness-лимит |

Вывод: риск RT-2 **сохраняется** (глобального enforcement стоимости и шагов агентского цикла в rc.2 нет — это подтверждено), но формулировки «нет ни одного лимита стоимости» и «нет лимита шагов вообще» неточны: платформа умеет *делегировать* лимит провайдеру/инструменту и *распознавать* бюджетную ошибку. Для G-P1 это не меняет решения, но меняет текст карточки: breaker обязан учитывать, что часть бюджета живёт вне DSH.

### 3.2 RT-3 рекурсивное самоизменение — **ОПРОВЕРГНУТ в сильной форме**

Текст на месте: `packages/extensions/cordis-host-runner/src/index.ts:2` — «Dynamic Cordis Plugin service…», `:23` — импорт `DynamicCordisRegistry`, `:245` — дословно «An unauthorized Client Package waits for approval; Plugin-wide authorization covers later versions».

Но это описание **одной ветки**, а не безусловное свойство. Механика:

- `index.ts:283-284`: `const requiresApproval = !plan.plugin.clientVersionUpdatesApproved && !plan.plugin.approvedClientPackages.has(packageId)` — то есть по умолчанию требуется подтверждение **на каждый packageId**;
- `index.ts:326` — параметр `approveFutureVersions` документирован как «Whether this approval covers later Packages of the same Plugin»; `:355` — `if (approveFutureVersions) plan.plugin.clientVersionUpdatesApproved = true` (флаг ставится **только** по этому решению);
- `registry.ts:58-61` — два независимых поля: `approvedClientPackages` («Client-bearing Packages individually authorized by the user») и `clientVersionUpdatesApproved` («Whether one user decision authorized future Package versions of this Plugin»);
- `index.ts:179` — новое плагин-состояние создаётся с `clientVersionUpdatesApproved: false`;
- клиент передаёт это как явный выбор человека: `packages/extensions/ui-cordis/src/client/slots.ts:66` — `onApprove(requestId, approveFutureVersions: boolean)`, `cordis-client-runner/src/client/orchestrator.ts:264,273,392`.

Итог: сценарий G («публикует новую версию — и она исполняется **без нового подтверждения**») реализуем только если человек при первом approval выбрал «разрешить будущие версии». Как свойство платформы по умолчанию это **ложно**. Значит:
- G-25 — **ОПРОВЕРГНУТ** (вторая половина утверждения);
- RT-3 как риск — **ЧАСТИЧНО ПОДТВЕРЖДЁН**: путь самоизменения существует, а «эскалация через версии» требует явного человеческого opt-in, который в отчёте не назван;
- рекомендация G-S5 (убрать `cordis_*`/dynamic-инструменты из поверхности worker'а) остаётся полезной независимо.

Смежное подтверждено: `guard.ts:490-499` — маркер `DYNAMIC_TOOL` и `assertDynamicTool` с текстом «dynamic tool registration must use a tool returned by harness.defineTool(...)» (G-26; отчёт цитирует `:490-497`, фактический throw — `:495-498`).

### 3.3 RT-9 снос профиля — **ядро ПОДТВЕРЖДЕНО, подпункт «не известен MyWork» ОПРОВЕРГНУТ**

- `git -C 'C:\Users\Dmitry\.dsh' rev-parse --is-inside-work-tree` → **exit 128**, `fatal: not a git repository`; то же для `…\.dsh\profiles\web` → exit 128; `Test-Path 'C:\Users\Dmitry\.dsh\.git'` → `False`. **ПОДТВЕРЖДЕНО**: у профиля нет git-истории.
- `git grep -n -I -i -E "Dmitry|Users\\\.dsh|profiles[\\/]web|\.dsh[\\/]profiles"` по MyWork (без `.work/analysis`) → **exit 1** (0 совпадений) — но это совпадения **литералов**, а не знание пути:
  - `scripts/verify-profile.mjs:127-134` собирает `realProfileFingerprint()` из `join(homedir(), '.dsh', 'profiles', 'web', 'package.json')`, `…/cordis.patch.yml`, `…/.dsh/settings.yaml` и хэширует их до/после (только чтение);
  - `packages/storage/src/layout.ts:66-68` — `defaultDshHome() = join(homedir(), '.dsh')`;
  - `packages/storage/src/layout.ts:1-10,82-83` — state MyWork живёт **внутри того же home**: `$DSH_HOME/dsh-mywork/state/{registry,controller}.sqlite`.
- Вывод: тезис «профиль не известен MyWork (0 совпадений)» **опровергнут**: путь вычисляется (`homedir()`), а не хардкодится, поэтому грепа по литералу недостаточно; два tracked-файла адресуют профиль явно (один — только на чтение, второй — как место state). Риск RT-9 (нет git-истории; никакой защиты платформы) остаётся в силе, а формулировка митигации «MyWork не имеет права писать за пределы своего state-каталога» верна ровно в том смысле, что её state-каталог — это `~/.dsh/dsh-mywork`, то есть сосед профиля по home.

### 3.4 Идеи: названные примитивы существуют — **ПОДТВЕРЖДЕНО (с двумя неточностями ссылок)**

| Идея | Заявленный примитив | Проверка | Вердикт |
|---|---|---|---|
| G-S1 | `SandboxProvider` / `SandboxPolicyService` | `packages/sandbox/sandbox-policy/src/index.ts:110` `class SandboxPolicyService extends Service`, `:119` `static inject = ['sessionProjections']` (режимы `read-only/workspace-write/danger-full-access` — `:113`) | ПОДТВЕРЖДЁН |
| G-S1 | `fs-observation-policy`, CAS-гейт `FS_NOT_OBSERVED` | `packages/fs/fs-observation-policy/src/index.ts:73-88` (`editIntent`: unseen → throw `FS_NOT_OBSERVED`), `:98` `name = 'fs-observation-policy'` | ПОДТВЕРЖДЁН |
| G-P1 | `TokenMeter` | `packages/llm/token-meter/src/index.ts:101` `class TokenMeter extends Service`, `:106` `inject = ['sessionProjections']` | ПОДТВЕРЖДЁН |
| G-R2 | `LocalJobRegistry`, admission на архивации, remote-контроль | `packages/jobs/jobs-local/src/index.ts:128` `class LocalJobRegistry extends JobRegistry`; `packages/jobs/jobs/src/archive-admission.ts:25` (`workspace/session-activity`), `:32` (`workspace/session-stop`), `:35` (`registry.kill`); `packages/api/job-controller/src/index.ts:43-44` `class JobController extends TypertRemoteService`, `inject = ['jobs','typert']` | ПОДТВЕРЖДЁН (ссылки `:22,27` в G — на docstring/`await next()`, а не на имена событий) |
| G-S4 | `auto-review` заменяет человеческое подтверждение; `AUTO_REVIEW_DENIED_CODE` | `packages/experimental/auto-review/src/index.ts:40-61` `REVIEW_POLICY`; цитата «Your decision replaces human approval for this call» — **:41**; шейпы `{"risk":"medium","decision":"allow"}` — `:45` (значит allow возможен, deny-only — именно новое требование) | ПОДТВЕРЖДЁН по существу; **ссылки неверны**: `AUTO_REVIEW_DENIED_CODE` — `:37` (в отчёте `:26` — там импорт `dsh-subagent`), цитата не входит в заявленный диапазон `:44-58` |
| G-04/G-05/G-39 | в плане 0 упоминаний sandbox/spill/jobs-local/…; `compaction` = 6, имён движка нет | `Select-String` по `.work/architecture/*.md` + `.work/tasks/*.md` (58 файлов): 19 ключей (`sandbox`, `spill`, `jobs-local`, `attachment`, `LSP`, `storage-domain`, `token-meter`, `auto-review`, `time-context`, `checkpoint-policy`, `e2b`, `acp`, `ralph`, `inspector`, `voice`, `browser-use`, `computer-use`, `CompactionEngine`, `compaction-basic`) → 0; `compaction` → ровно 6 совпадений на заявленных строках (`architecture:47,1402,2538,2980`, `MW-020.md:17`, `MW-034.md:17`) | ПОДТВЕРЖДЁН |
| G-01/G-02/G-03 | controller монтирует 4 вещи; DSH-зависимости только `cordis`+`dsh-home-paths`; peer только cordis | `packages/controller/src/index.ts:115-128` — `MyWorkControllerService`, `MyWorkAdaptersService`, `mountModelCatalog`, `mountDshRuntime`; `git grep -o -E "@deepseek-ai/[a-z0-9._/-]+"` по `packages` → уникальные `@deepseek-ai/cordis`, `@deepseek-ai/dsh-home-paths` (+ артефакт разбора `@deepseek-ai/.../llm` внутри строки-примера); `packages/controller/package.json:30-32` — единственный peer `@deepseek-ai/cordis: ^4.0.2` | ПОДТВЕРЖДЁН |

## 4. Внешний документ §27 и §28 (независимая проверка)

### 4.1 §27 «в rc.2 только блокирующий API» — **ПОДТВЕРЖДЁН**

| Проверка | Команда | Результат |
|---|---|---|
| Только `ask()` | `packages/interaction/user-questions/src/index.ts:65,86` | `class UserQuestionService`, единственный публичный вход — `async ask(request): Promise<AskUserQuestionAnswer>` |
| `askTimed`/`TimedQuestionWait`/`ASK_TIMED_OUT` в коде | `git grep -n -I -E "askTimed\|TimedQuestionWait\|ASK_TIMED_OUT"` | совпадения есть, но **только** в `.agents/notes/proposed/architecture/2026-09-19-timed-user-question-two-settlements.md` (`:20,39,45` — proposed design); в `packages/**` — 0 |
| История | `git log --oneline --all --grep="timed waits and late replies"` | `bb19061473 feat(user-questions): support timed waits and late replies`, `fa6d9fd75b docs(user-questions): propose …`; рядом `32905d5ab5 Revert "feat: reconcile timed questions with legacy default"` |

Значит: timed API отсутствует в текущем API-исходнике, а «proposed note» §27 — это ровно тот файл, что лежит в `.agents/notes/proposed/…`. **ПОДТВЕРЖДЁН** целиком, включая вывод «нельзя считать timed questions текущей capability».

### 4.2 §28 «runtime-owned child не может спрашивать человека» — **ПОДТВЕРЖДЁН, с точным местом**

- Место: `packages/interaction/user-questions/src/index.ts:93-107`. При `request.agent`: сначала проверка точного живого инстанса (`:96-100`, код `CALLER_NOT_LIVE`), затем `if (!agents.roots().includes(agent))` → `:101-106` throw `UserQuestionError(..., 'DELEGATED_CALLER')` с текстом «human interaction is unavailable while the calling agent is owned by another live agent; include the unresolved question or decision in the child agent's final result».
- Док-комментарий там же, `:73-77`: «Runtime ownership, not durable session lineage, decides this boundary: an owned child has no human answerer and would block forever, while a lineage-bearing session resumed as a new runtime root may ask normally».
- Нюанс «durable lineage не решает эту границу» подтверждён документально: `packages/interaction/user-questions/README.md:41` («Durable lineage is not authority: … may ask after it is resumed as a new runtime root, while a live child owned by another agent is rejected even if its durable depth is zero») и `packages/interaction/tool-ask-user/README.md:142` («Durable lineage does not decide this boundary, so a lineage-bearing session resumed as a runtime root may ask normally»). Тот же код ошибки виден в снапшоте `snapshots/session/subagent-child-question-rejection/session.1.v2.jsonl` (`"name":"UserQuestionError","code":"DELEGATED_CALLER"`).

**ПОДТВЕРЖДЁН** полностью, включая пожелание §28 «не обходить это неофициальным каналом» — обход действительно невозможен через `ask()`.

## 5. КОНТР-ДОКАЗАТЕЛЬСТВА (что я пытался сломать)

1. **N-01.** Пытался найти монтаж companion'а в 236 tracked-файлах, чей путь совпадает с `cordis*.yml|yaml` (это включает композиции, снапшоты сессий и i18n-документацию), и во всех `package.json`. Не нашёл: единственный монтаж — `sdk-minimal:107-119`; в `bundle/{base,web-app,web-app/presets,headless,sdk-app,acp-app}` слово `invariant` не встречается вовсе (findstr exit 1). Дополнительно поискал в живом профиле `C:\Users\Dmitry\.dsh\profiles\web` по `cordis*.yml` — совпадений нет (но см. §6: полнота покрытия `node_modules` не гарантирована).
2. **Границы.** Пытался опровергнуть B-50 «scheduler не сканируется» — частично успешно: `tests/scheduler.test.mjs:935-944` сканирует `packages/scheduler/src`. Затем проверил, спасает ли это от DSH-импорта: **нет** — прямой эксперимент в worktree дал 53 pass / exit 0 с импортом `@deepseek-ai/dsh-experimental-agent-team` в `scheduler/src/service.ts`. Контрольный прогон (тот же импорт в `core/src`) упал с exit 1.
3. **RT-2.** Пытался найти лимиты стоимости/шагов за пределами заявленных шаблонов: расширил пути (`apps/**`, `sdk/**`), расширения (`.tsx`), регистр, и искал семейство `budget` целиком. Нашёл четыре реальных контрпримерных механизма (`error_max_budget_usd`, `sessionBudgetExceeded`, `max_turn_requests`, `maxRounds`=256) и `delegationDepth`. Глобального cap'а всё равно нет — но абсолютная формулировка не выдерживает.
4. **RT-3.** Пытался подтвердить «approval привязан к пакету, а не к версии»: нашёл docstring `:245`, но код показал два независимых поля и параметр `approveFutureVersions` с дефолтом `false`. Сильная форма утверждения сломана.
5. **RT-9.** Пытался подтвердить «0 совпадений ⇒ MyWork не знает профиль»: грепа по литералу действительно 0, но `verify-profile.mjs:127-134` и `layout.ts:66-68` адресуют тот же путь через `homedir()`. Утверждение сломано.
6. **§27.** Пытался найти `askTimed`/`ASK_TIMED_OUT` в исходниках (не только в `user-questions`): нашлись только в proposed-note; в `packages/**` — нет. §27 устоял.
7. **§28.** Пытался найти обход `DELEGATED_CALLER` (например, `ask()` без `agent` в запросе): `:93-107` — проверка выполняется только при `agent !== undefined`, то есть технически agentless-запрос её минует; но §28 говорит про runtime-owned child, который всегда идёт через инструмент с агентом (`tool-ask-user/README.md:60`), поэтому граница держится. Зафиксировано как нюанс, а не как опровержение.
8. **Ссылки.** Пытался «поймать» отчёты на несуществующих строках: нашёл 4 смещённых ссылки (см. §7: V-43, V-45, V-49, V-50) — все внутри существующих файлов, но указывают не на тот текст.

## 6. НЕОПРЕДЕЛЁННОСТЬ (что не проверено и почему)

1. **Живая композиция профиля `web`.** Проверял только тексты `cordis*.yml` внутри профиля (ripgrep: совпадений по `invariants`/`agent-team/invariant` нет); гарантии, что просмотрены `node_modules` всех сторонних бандлов (`dshmarket`, `@linxin666/dsh-web-all`, `misakanet`), нет. Эффективное значение `maxMembers` в рантайме не измерялось (как и у B). `plugin_manager` не вызывал.
2. **DSH-тесты Agent Teams не запускались** — имена тестов у B и G цитируются как заявленное покрытие; окружения сборки чужого дерева я не поднимал. Все ссылки вида `tests/team.spec.ts:NNN` — «такой тест существует», а не «зелёный».
3. **Прогоны MyWork-сюит B не повторялись.** Проверены: `tests/boundaries.test.mjs` в живом дереве (26 pass / exit 0) и `boundaries + scheduler` в worktree (53 pass / exit 0). Утверждения B «83 pass» (`scheduler/attempt/lease/authority/team`) и «60 pass» (`claim-saga/boundaries/storage-crash`) я **не проверял**.
4. **Числа и поведение, требующие запуска:** `waitForChange` на живом Team-сервисе, `InvariantError`, `TEAM_MEMBER_LIMIT`, `TEAM_MAILBOX_FULL`, split-brain двух контроллеров, стоимость steer — не воспроизводились (запрет на `spawn_teammate`, нет поднятого Team-сервиса).
5. **Семантика `SessionTelemetryMode.FEEDBACK_ONLY`** (G-19 сам помечает как непроверенную) — не читал реализацию; выводы G-P4/RT-5 по ней не подтверждаю.
6. **G-06/G-08 «0 совпадений» и untracked-файлы.** Мой `git grep` покрывает tracked-файлы; из untracked в DSH есть только локали `ru.json`, `.playwright-cli/`, мусор в корне и заметки `.agents/notes/**` (они tracked). Untracked `.ts`-кода, который мог бы спрятать лимит, в `git status --porcelain` не видно.
7. **`packages/**/src/*.ts` в формулировке G уже, чем мой прогон.** G использовал `Select-String -Path packages\*\*\src\*.ts` (два уровня вложенности, без подкаталогов `src`). Мой прогон шире (`:(glob)packages/**/src/**`) и даёт тот же ноль для заявленных семейств — расхождение в пользу G, но помечаю, что исходная команда покрывала не всё дерево.
8. **G-40/G-41/G-42 (§64 семь рисков, §71 ADD, таблица «уже в плане»)** и остальные пункты CLAIMS потоков, не входившие в задание, не проверялись.
9. **Ralph/`budget-limited`** прочитан только по строкам генератора промпта и конфига (`:174,187`); фактический прогон раунд-лимита не выполнялся.

## 7. Таблица вердиктов

| ID | Вердикт | Доказательство (файл:строка / команда + exit) | Комментарий |
|---|---|---|---|
| V-01 (B N-01) | ПОДТВЕРЖДЁН | `agent-team/package.json:21-24`; `agent-team/src/invariant.ts:15,17`; grep `/invariant\|dsh-invariants` по `packages/**/cordis*.yml` → 5 совпадений, все `bundle/sdk-minimal/cordis.patch.yml:107-119`; `git grep` по всем tracked yml/yaml/package.json → те же 5 | companion не смонтирован нигде в чекауте |
| V-02 (B N-01) | ПОДТВЕРЖДЁН | `findstr /i invariant` по 6 shipped-бандлам → exit 1 | `base`/`web-app`/`presets`/`headless`/`sdk-app`/`acp-app` не знают слова invariant |
| V-03 (B B-23) | ПОДТВЕРЖДЁН (по чтению) | `packages/core/session/src/index.ts:716-720,759,761`; `agent-team/src/invariant.ts:28-30` | throw до `log.push`; `InvariantError` не наблюдал |
| V-04 (B B-25) | НЕОПРЕДЕЛЁННО | ripgrep по `C:\Users\Dmitry\.dsh\profiles\web` (include `cordis*.yml`) → No matches | полнота покрытия `node_modules` не гарантирована; рантайм не измерялся |
| V-05 (B B-02) | ПОДТВЕРЖДЁН | `agent-team-profile/cordis.patch.yml:20`; `agent-team/src/index.ts:41,60,80` | 8 — профиль, 16 — домен |
| V-06 (B B-03) | ПОДТВЕРЖДЁН | `agent-team/src/roster.ts:269-278` (`:274-276`) | лимит считается по `state.members.length` до provisioning-append |
| V-07 (B B-06) | ПОДТВЕРЖДЁН | `tool-agent-team/src/index.ts:39-40,244,252-274` | `noProgress` без ожидания; §15 об этом молчит |
| V-08 (B B-56) | ПОДТВЕРЖДЁН | `controller/cordis.patch.yml:12-14`; `controller/package.json:21-25`; `verify-profile.mjs:27,188-191,210-213` | строка §42 «Install» устарела |
| V-09 (B B-50) | ПОДТВЕРЖДЁН | `tests/boundaries.test.mjs:17-25,127-133,518-527` | ни одного шаблона `@deepseek-ai/dsh*` |
| V-10 (B B-50) | ПОДТВЕРЖДЁН | `tests/boundaries.test.mjs:111-114,117,124,165-175` | source-скан: contracts+core (+storage/evidence отдельно) |
| V-11 (B §66) | ОПРОВЕРГНУТ | `tests/scheduler.test.mjs:935-944` | scheduler/src **сканируется**, 7 игл; «не сканируется вовсе» неверно |
| V-12 (B B-50/N) | ПОДТВЕРЖДЁН (эксперимент) | worktree `.tmp/v2-boundary-demo`, импорт DSH в `scheduler/src/service.ts`, `node --test boundaries scheduler` → 53 pass / 0 fail / **exit 0** | дыра реальна для DSH-спецификатора |
| V-13 (контроль) | ПОДТВЕРЖДЁН | тот же импорт в `core/src/scheduler.ts` → 25 pass / 1 fail / **exit 1**, «must not import» | тест ловит импорт в сканируемом пакете |
| V-14 | ПОДТВЕРЖДЁН | grep по tests: чтение `packages/<pkg>/src` только в `scheduler.test.mjs:935` и `adapters.test.mjs:452` (contracts/core) | `packages/planner/src` не сканируется ничем |
| V-15 (B B-31) | ПОДТВЕРЖДЁН | `contracts/src/task.ts:11-43,46-63,66` | 16 состояний, 3 терминальных |
| V-16 (B B-32) | ПОДТВЕРЖДЁН | `contracts/src/taskgraph.ts:9-14` | authority split дословно |
| V-17 (B B-34) | ПОДТВЕРЖДЁН | `findstr` по `core/src/scheduler.ts` → **exit 1**; `tests/scheduler.test.mjs:921-945` | чистая синхронная функция без LLM-порта |
| V-18 (B B-39,B-43) | ПОДТВЕРЖДЁН | `execution/src/service.ts:405-429`; `contracts/src/attempt.ts:80-89`; `lease/src/lease.ts:292-305` | fence → epoch → копия попытки; `holdsLeadership` = instance+epoch+срок |
| V-19 (B B-45) | ПОДТВЕРЖДЁН | `findstr /s /i mailbox\|PeerMessage\|coordination packages\*.ts` → **exit 1** | peer mailbox отсутствует |
| V-20 (B B-46) | ПОДТВЕРЖДЁН | `storage/src/inbox.ts:51-73` | `applyOnce` + запрет async-эффекта |
| V-21 | ПОДТВЕРЖДЁН | `contracts/src/security.ts:171-195` | `HumanGate` — тип + таблицы, не домен |
| V-22 (B B-16) | ПОДТВЕРЖДЁН | `agent-team/src/roster.ts:259` до `:269`/`:282` | pre-minted `childId` |
| V-23 (B B-49) | ПОДТВЕРЖДЁН | `contracts/src/context.ts:108-112,125-129,452-456,476-477` | `dependency-result` не mandatory/instruction, свой bucket+лимит |
| V-24 (B B-04) | ПОДТВЕРЖДЁН | `agent-team/src/activity.ts:22-25` | 10 000…3 600 000, `TEAM_INVALID_TIMEOUT` |
| V-25 (B тесты) | НЕ ПРОВЕРЯЛ | — | прогоны «83 pass»/«60 pass» не повторял |
| V-26 (G G-01) | ПОДТВЕРЖДЁН | `controller/src/index.ts:115-128` | ровно 4 действия монтирования |
| V-27 (G G-03) | ПОДТВЕРЖДЁН | `controller/package.json:30-32` | единственный peer — cordis |
| V-28 (G G-02) | ПОДТВЕРЖДЁН | `git grep -o "@deepseek-ai/[a-z0-9._/-]+"` по `packages` | только `cordis` и `dsh-home-paths` |
| V-29 (G G-06) | ПОДТВЕРЖДЁН | `git grep spendLimit\|costLimit\|maxCost\|dailyLimit\|budgetUsd\|budgetTokens\|costBudget` (все tracked) → **exit 1** | глобального денежного cap'а нет |
| V-30 (G G-08) | ПОДТВЕРЖДЁН | `git grep … -- ':(glob)packages/**/src/**'` → **exit 1**; `apps/**`, `sdk/**`, `**/*.tsx` → exit 1 | в src лимита шагов нет |
| V-31 (G RT-2) | ЧАСТИЧНО ОПРОВЕРГНУТ | `tool-ralph/src/index.ts:174,181,187`; `subagent-claude-code/src/run.ts:116`; `subagent-codex/src/wire.ts:125`; `subagent-acp/src/run.ts:231`; `core/agent/src/index.ts:71-84` | «нет ни одного лимита» неверно: 4 механизма + recursion budget; глобального — нет |
| V-32 (G G-07) | ПОДТВЕРЖДЁН | `compaction-basic/src/config.ts:172-196`; `attachment-local/src/index.ts:43-77`; `api/job-controller/src/index.ts:38-39` | `budget` = контекст/пиксели/байты |
| V-33 (G G-09) | ПОДТВЕРЖДЁН | `guard/timeout-policy/src/index.ts:57-59` | нет `timeoutMs` → делегирование без deadline |
| V-34 (G RT-3 текст) | ПОДТВЕРЖДЁН | `cordis-host-runner/src/index.ts:2,23,245` | docstring на месте дословно |
| V-35 (G G-25) | **ОПРОВЕРГНУТ** | `index.ts:283-284,326,355`; `registry.ts:58-61`; `index.ts:179`; `ui-cordis/src/client/slots.ts:66` | approval по умолчанию на каждый packageId; «покрывает будущие версии» — только opt-in |
| V-36 (G G-26) | ПОДТВЕРЖДЁН | `cordis-host-runner/src/guard.ts:490-499` | маркер `DYNAMIC_TOOL` + требование `harness.defineTool` |
| V-37 (G RT-9a) | ПОДТВЕРЖДЁН | `git -C C:\Users\Dmitry\.dsh rev-parse --is-inside-work-tree` → **exit 128** (и для `profiles\web`); `.dsh\.git` → False | профиль без git-истории |
| V-38 (G RT-9b) | **ОПРОВЕРГНУТ** | `verify-profile.mjs:127-134`; `storage/src/layout.ts:1-10,66-68,82-83` | путь профиля известен MyWork (через `homedir()`), state живёт в том же `$DSH_HOME` |
| V-39 (G G-S1) | ПОДТВЕРЖДЁН | `sandbox-policy/src/index.ts:110,113,119` | сервис политики существует |
| V-40 (G G-S1) | ПОДТВЕРЖДЁН | `fs-observation-policy/src/index.ts:73-88,98` | CAS-гейт `FS_NOT_OBSERVED` |
| V-41 (G G-P1) | ПОДТВЕРЖДЁН | `llm/token-meter/src/index.ts:101,106` | `TokenMeter` — сервис поверх `sessionProjections` |
| V-42 (G G-R2) | ПОДТВЕРЖДЁН | `jobs-local/src/index.ts:128`; `jobs/src/archive-admission.ts:25,32,35`; `api/job-controller/src/index.ts:43-44` | ссылки G `:22,27` смещены на docstring/`await next()` |
| V-43 (G G-27) | ПОДТВЕРЖДЁН по существу, ссылки неверны | `auto-review/src/index.ts:37` (код), `:40-61` (`REVIEW_POLICY`), цитата `:41`, allow-формы `:44-49` | в отчёте `:26` — там импорт; цитаты в `:44-58` нет |
| V-44 (G G-04/05/39) | ПОДТВЕРЖДЁН | `Select-String` по 58 файлам `.work/architecture/*.md`+`.work/tasks/*.md`: 19 ключей → 0; `compaction` → 6 на заявленных строках | «в плане 0 упоминаний» воспроизведено |
| V-45 | НЕ ПРОВЕРЯЛ | — | G-19 (`FEEDBACK_ONLY`), G-40/G-41/G-42, G-32/G-37 поведенчески |
| V-46 (док §27) | ПОДТВЕРЖДЁН | `user-questions/src/index.ts:65,86`; `git grep askTimed\|TimedQuestionWait\|ASK_TIMED_OUT` → только `.agents/notes/proposed/…two-settlements.md:20,39,45`; `git log --all --grep` → `bb19061473`, revert `32905d5ab5` | в `packages/**` timed API нет; proposed-note существует |
| V-47 (док §28) | ПОДТВЕРЖДЁН | `user-questions/src/index.ts:93-107` (throw `DELEGATED_CALLER` — `:101-106`); doc `:73-77` | точное место и код ошибки |
| V-48 (док §28 нюанс) | ПОДТВЕРЖДЁН | `user-questions/README.md:41`; `tool-ask-user/README.md:60,142`; снапшот `subagent-child-question-rejection/session.1.v2.jsonl` | durable lineage не даёт права; runtime root — даёт |
| V-49 | ПОДТВЕРЖДЁН с оговоркой | `user-questions/src/index.ts:93` (`if (agent !== undefined)`) | agentless-запрос минует проверку, но инструмент всегда передаёт агента |
| V-50 | НЕ ПРОВЕРЯЛ | — | B-51/B-52/B-53 (ссылки на `.work/reports/*`) — отчёты карточек я не открывал |

**Итог по статусам:** ПОДТВЕРЖДЁН — 38 (V-01,02,03,05…10,12…24,26…30,32,33,34,36,37,39…42,44,46,47,48,49), ОПРОВЕРГНУТ — 3 (V-11, V-35, V-38), ЧАСТИЧНО ПОДТВЕРЖДЁН/ОПРОВЕРГНУТ — 4 (V-31, V-43, V-49 и оговорка к V-03), НЕ ПРОВЕРЯЛ — 5 (V-04, V-22, V-25, V-45, V-50). Опровержения не отменяют практических выводов потоков (breaker стоимости, whitelist инструментов, запрет dynamic-tools в worker'е, правка boundary-теста), но требуют трёх текстовых правок: RT-3/G-25 (approval — opt-in, а не свойство платформы), RT-9 (профиль известен MyWork через `homedir()`), §66-B («scheduler не сканируется вовсе» → «сканируется списком игл без имён DSH-пакетов»).
