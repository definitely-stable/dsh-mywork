# foundation-01 — прямые доказательства (метод и сырые выводы)

**Кто:** `plan-foundation` (teammate, глубина 1). **Когда:** 2026-09-27.
**Метод:** §6 брифа (`≥5 субагентов`) **не выполнен** — `subagent depth 2 exceeds maxDepth 1` (ограничение рантайма, подтверждено Lead'ом). Все доказательства собраны **лично**: `grep`/`read`/`pwsh` в read-only режиме. Ни один мутирующий шаг не исполнялся.

Этот файл — сырьё к `.work/plan-v0.3/20-STEPS-foundation.md`. Он не обязателен к чтению владельцем.

---

## 1. Профиль: гейт прав (дефект подтверждён дословно)

```
C:\Users\Dmitry\.dsh\profiles\web\cordis.patch.yml
:20  - {
:21      id: web-ui-task-board,
:22      config:
:23        {
:24          plugin: "@linxin666/dsh-client-ui-task-board",
:25          config: { sessionDefaultPermission: workspace-write },
:26          announceToAgent: true,
:27          autoRunTodo: true,
:28          autoRunPaused: true,
:29          autoRunMaxConcurrent: 1,
:30          autoRunMaxRetries: 1,
:31          autoRunStallMinutes: 30,
:32          autoRunMaxPerHour: 3,
:33          autoRunMaxPerDay: 0
:34        }
:35    }
```

Кто срезает `plugin`:
```
...\@linxin666\dsh-web-all\lib\shell-DWqLngib.js
:1088  /** The config the real plugin receives: every row key but the shell's own. */
:1089  function familyConfigOf(row) {
:1090      const { plugin: _spec, ...family } = row;
:1091      return Object.keys(family).length === 0 ? void 0 : family;
:1092  }
:1106  function isOverrideShape(config) {
:1109      return Object.keys(config).length === 0 || !("plugin" in config);
:1110  }
```

Кто читает:
```
...\@linxin666\dsh-client-ui-task-board\lib\index.js
:5557  function applyImpl(ctx, config) {
:5568      sessionDefaultPermission: config?.sessionDefaultPermission ?? "read-only",
:5397  sessionDefaultPermission: z.union(TASK_PERMISSIONS).default(DEFAULT_SESSION_PERMISSION),
:2444      if (refusal !== void 0) throw new Error(bindingRefusalMessage(...));
:2471      if (lead !== void 0 && requiresPermissionConfirmation(lead, this.sessionDefaultPermission)) return {...};
:2485      const unconfirmed = participants.find((participant) => requiresPermissionConfirmation(participant, this.sessionDefaultPermission));
:4281  sessionDefaultPermission: snapshot.sessionDefaultPermission ?? "read-only",
```
Клиентская половина: `lib/client.js:1413,1420,4112`.

`Select-String -Path '...\dsh-web-all\lib\shell-DWqLngib.js' -Pattern 'autoRun'` → **0 совпадений**.
`Select-String -Path '...\dsh-client-ui-task-board\lib\*.js' -Pattern 'autoRun'` → **0 совпадений**.
Версии: `@linxin666/dsh-client-ui-task-board` = **0.4.3**, `@linxin666/dsh-web-all` = **0.4.3**.

---

## 2. `pnpm` сломан: точная цепочка

```
where.exe pnpm →
  C:\Reposit\deepseek-harness\deepseek-harness\node_modules\.bin\pnpm
  C:\Reposit\deepseek-harness\deepseek-harness\node_modules\.bin\pnpm.CMD
  C:\Users\Dmitry\AppData\Roaming\npm\pnpm
  C:\Users\Dmitry\AppData\Roaming\npm\pnpm.cmd

pnpm --version → EXIT=1, stderr:
  '"H:\.pnpm-store\v11\links\@\pnpm\12.4.2\f6c04c51569ad17329595648978a95bb61c85b87174d5701d9eef91259f69e26\bin\\..\node_modules\pnpm\pnpm"' is not recognized as an internal or external command, operable program or batch file.

& 'C:\Reposit\deepseek-harness\deepseek-harness\node_modules\.bin\pnpm.CMD' --version → EXIT=1 (та же ошибка)
node 'C:\Reposit\deepseek-harness\deepseek-harness\node_modules\pnpm\bin\pnpm.mjs' --version → EXIT=1 (та же ошибка)

H:\.pnpm-store\v11\links\@\pnpm\12.4.2\<hash>\bin\pnpm.CMD (52 байта):
  @SETLOCAL
  @"%~dp0\..\node_modules\pnpm\pnpm"   %*

Цель node_modules\pnpm\pnpm — POSIX shell-скрипт (2051 б, '#!/bin/sh'); pnpm.exe рядом нет
(в каталоге: bin, dist, .pnpm-needs-build, CHANGELOG.md, install.js, native-binary.mjs,
 package.json, pn, pnpm, pnpx, pnx, README.md, THIRD-PARTY-NOTICES.md).

corepack --version → 0.35.0
corepack pnpm --version → "Downloading the pnpm 12.4.2 binary for win32-x64..." → 12.4.2, EXIT=0  ✅
```

Версии окружения: `node v24.19.0`, `npm 11.17.0`.
PATH-фрагменты с pnpm: `...\deepseek-harness\node_modules\.bin`; `%LOCALAPPDATA%\pnpm\package-manager-store\v11\links\@pnpm\exe\11.7.0\<hash>\node_modules\@pnpm\exe\dist\node-gyp-bin`; `%LOCALAPPDATA%\pnpm\bin` (пуст); `%APPDATA%\npm`.

Свидетельство падения `pack.mjs`: `.tmp/pack-logs/pnpm-pack.err.log` содержит **ту же** строку ошибки; `.tmp/pack-logs/pnpm-pack.out.log` — 205 б; `.tmp/pack/dsh-mywork-controller-0.1.0.tgz` — 9030 б (прошлый успешный прогон).

---

## 3. `bd`-seam: места вызова

```
packages/beads-adapter/src/runner.ts
:96    const binary = options.binary ?? 'bd'
:102   const child = spawn(binary, [...command.args], {
:104     // No shell: arguments are passed as an argument vector verbatim.
:105     shell: false,
:106     windowsHide: true,
:107     env: command.env === undefined ? process.env : { ...process.env, ...command.env },
:130   child.on('error', (error) => { ... reject(error) })
:85    export const DEFAULT_COMMAND_TIMEOUT_MS = 30_000
:57    — единственное место, "which touches the operating system"
:171   export interface ScriptedRunner   (переиспользовать в F-22)

tests/beads-adapter.test.mjs
:19    "The real-`bd` layer is skipped, loudly, when the binary is absent: a skipped check must never look like a pass."
:57    function bdAvailable() { const probe = spawnSync('bd', ['version'], { encoding: 'utf8', shell: false }); return probe.status === 0 }
:62    const HAS_BD = bdAvailable()
:64    if (!HAS_BD) {
:67-68 "...under the DSH file sandbox this is EPERM on piped stdio..."   ← текст неверен
:77    const result = spawnSync('bd', args, { cwd, encoding: 'utf8', shell: false, input: stdin })

packages/beads-adapter/src/adapter.ts
:96    heartbeat: true,
:87-98 BEADS_CLI_CAPABILITIES = { http:false, 'graph-apply':true, batch:true,
       'batch-dep-remove':true, 'guarded-batch':false, 'metadata-set':true,
       'events-journal':true, 'claim-lease':true, heartbeat:true, reclaim:true }
:495-500 claim → this.run([...], ..., { BEADS_ACTOR: command.claimant })   ← актор передаётся
:583-588 async heartbeat(id) { ... this.requireCapability('heartbeat','heartbeat');
                               const result = await this.run(['heartbeat', id]) }   ← актор НЕ передаётся
:228-232 requireCapability → capabilityUnsupported (типизированный отказ)
```

`bd` в этой кампании **не запускался** (не подтверждено, что установлен) — факты выше получены чтением кода.

---

## 4. Миграции: пять списков, версии, journal

```
packages/storage/src/migrations.ts
:49-82   OUTBOX_INBOX: version 1, name 'outbox-inbox'
         CREATE TABLE outbox (event_id TEXT PK, workspace_id, sequence, type, correlation_id,
           causation_id, occurred_at, payload, status CHECK IN ('pending','delivered'),
           attempts, last_error, created_at, delivered_at, UNIQUE(workspace_id, sequence)) STRICT
         CREATE TABLE inbox_dedup (consumer, event_id, processed_at, PK(consumer,event_id)) STRICT
         CREATE INDEX outbox_pending ON outbox (status, workspace_id, sequence)
:91      export const MYWORK_MIGRATIONS = Object.freeze([OUTBOX_INBOX])
:94      export const MYWORK_SCHEMA_VERSION = MYWORK_MIGRATIONS.at(-1)?.version ?? 0   → 1
:97-103  JOURNAL_DDL: CREATE TABLE IF NOT EXISTS schema_migrations (version PK, name, applied_at) STRICT
:111-129 validateMigrations (монотонность, уникальность, непустое имя, наличие up)
:142-184 runMigrations: :147 exec(JOURNAL_DDL); :150-156 отказ 'schema-version-unsupported';
         :160-173 транзакция + перечитывание версии под локом + INSERT в schema_migrations + setUserVersion
:190-198 listAppliedMigrations

Пять списков (версии):
  MYWORK_MIGRATIONS        v1  storage/src/migrations.ts:91
  EVIDENCE_MIGRATIONS      v3  evidence/src/schema.ts:26 (EVIDENCE_SCHEMA_VERSION), :138, :147
  LEASE_MIGRATIONS         v4  lease/src/schema.ts:22 (LEASE_SCHEMA_VERSION), :66, :68
  PLAN_MUTATION_MIGRATIONS v5  planner/src/schema.ts:36, :148, :150
  CLAIM_SAGA_MIGRATIONS    v6  execution/src/schema.ts:48, :153, :155
```

Склейка описана только в комментариях/JSDoc: `execution/src/schema.ts:28-34`, `execution/src/index.ts:18-24`, `planner/src/index.ts:17-23`, `planner/src/schema.ts:16-22`, `evidence/src/store.ts:8`, `lease/src/index.ts:13,18`, `lease/src/schema.ts:14`.
Отказы при неполном наборе: `lease/src/lease.ts:315-321`, `evidence/src/store.ts:85-91`, `planner/src/store.ts:126`, `execution/src/service.ts:251`.

```
packages/storage/src/store.ts
:68-69   /** Migrations to apply; defaults to MYWORK_MIGRATIONS. */ readonly migrations?: readonly Migration[]
:84      const migrations = validateMigrations(options.migrations ?? MYWORK_MIGRATIONS)   ← дефолт неверен
:27-28   DEFAULT_BUSY_TIMEOUT_MS = 5_000
:93      openSqlite({ path, busyTimeoutMs })
```

Атомарность: `Select-String -Path packages\storage\src\*.ts -Pattern 'writeFileAtomic|withFileLock|fsync|\.tmp'` → **0 совпадений**.
`journal_mode`/`auto_vacuum`/`VACUUM` в `packages/storage/src` — **не проверялось** (`Шаг 0` в F-35/F-39).

---

## 5. Boundary-тест: что сканируется сейчас

```
tests/boundaries.test.mjs
:17-25   FORBIDDEN = ['@deepseek-ai/cordis','beads','hindsight','openviking','sqlite','better-sqlite3','node:sqlite']
:111-124 sources = contracts:collect(...contracts/src), core:collect(...core/src)
         storageSources = collect(...storage/src)
         evidenceSources = collect(...evidence/src)
:340     leaseSources = collect(...lease/src)
:427     executionSources = collect(...execution/src)
:127-133 FORBIDDEN_FOR_STORAGE (тот же дефект: только @deepseek-ai/cordis)
:518-527 FORBIDDEN_IN_BOARD (тот же дефект)
```

**Сканируются 6 наборов. Не сканируются: `scheduler/src`, `planner/src`, `adapter-sdk/src`, `controller/src`, `memory-native/src`, `beads-adapter/src`.**

Фактический `Select-String -Path packages\**\src\*.ts -Pattern '@deepseek-ai'`:
```
packages\beads-adapter\src\memory-plugin.ts:22
packages\beads-adapter\src\plugin.ts:15
packages\controller\src\dsh-session.ts:31
packages\controller\src\index.ts:12
packages\controller\src\model-catalog.ts:23, :59
packages\storage\src\layout.ts:13        (в комментарии: "mirrored here instead of imported")
```
→ в `scheduler/src` и `planner/src` совпадений **0**: дыра латентная, не действующее нарушение.

---

## 6. Composition root: точка входа и layout

```
packages/controller/src/index.ts
:115  export function apply(ctx: Context, config?: Config): void {
:116    const service = new MyWorkControllerService(ctx, resolveControllerConfig(config), resolveClock(ctx))
:117    ctx.effect(() => () => service.stop(), 'mywork controller shutdown')
:118    const adapters = new MyWorkAdaptersService(ctx)
:119    ctx.effect(() => () => adapters.close(), 'mywork adapters shutdown')
:123    mountModelCatalog(ctx, adapters)
:127    mountDshRuntime(ctx, adapters)
:104-107 interface Config { diagnostics?: boolean }
:136-139 function resolveClock(ctx) { const provided = ctx.get(MYWORK_CLOCK_SERVICE) as ClockPort | undefined;
                    return provided ?? systemClock }
:26-33  MYWORK_ADAPTERS_SERVICE, MYWORK_CLOCK_SERVICE, MYWORK_CONTROLLER_SERVICE
:92-101 name = '@dsh-mywork/controller'; CONTROLLER_VERSION = '0.1.0'; BOUNDED_CONTEXTS = ['control']
→ НИ ОДИН store не открывается.

packages/storage/src/layout.ts
:24-27  MYWORK_DIR_NAME='dsh-mywork'; MYWORK_STATE_DIR_NAME='state'
:33-36  MYWORK_STATE_DATABASES = ['registry','controller']
:76-84  resolveMyWorkLayout: options.dshHome → $DSH_HOME → ~/.dsh
:91-93  stateDatabasePath(layout, db) = join(layout.stateDir, `${db}.sqlite`)
```

---

## 7. Платформа DSH 0.1.7-rc.2: peer-гейт, meter, политики, jobs

```
packages/boot/app-boot/src/plugin-compatibility.ts
:44-49  getDshRuntimeVersion(): читает свой package.json → '0.1.7-rc.2'
:61-88  evaluatePluginCompatibility(manifest, exemptions, runtimeVersion)
:68       if (!Object.hasOwn(fields,'peerDependencies')) return undefined;      ← нет peer → гейта нет
:75       if (name !== '@deepseek-ai/dsh' && !name.startsWith('@deepseek-ai/dsh-')) continue;  ← фильтр
:76       workspace:^|~|* → runtimeVersion
:77       semver.satisfies(runtimeVersion, requirement, { includePrerelease: true })
:85-87    exemptedVersions по ключу `${name}@${version}`
:96-103 pluginCompatibilityWarning(...) + 'dsh plugin allow-version'  ← exemption выдаёт человек

Версии: packages/boot/app-boot/package.json = 0.1.7-rc.2; корневой package.json DSH = 0.1.7-rc.2
engines: Select-String по packages/**/*.ts (без node_modules и tests) на 'manifest.engines|.engines' → 0 совпадений.
```

```
packages/llm/token-meter/src/index.ts
:94-96  declare module '@deepseek-ai/cordis' { interface Context { tokenMeter: TokenMeter } }
:101    export class TokenMeter extends Service
:104    static Config: z<TokenMeterConfig> = z.object({})
:106    static inject = ['sessionProjections']
:111    super(ctx, 'tokenMeter')
:146    measure(session: Session, requestHeader?: EpochHeader): TokenMeasurement
packages/llm/token-meter/src/types.ts
:13     TokenMeterConfig = Record<string, never>
:16-19  TokenMeasurementBaseline = {kind:'none',tokens:0} | {kind:'estimated',tokens} | {kind:'usage',tokens,usage}
:22-35  TokenMeasurement { logRevision, baseline, surfaceDeltaTokens, totalTokens, surfaceTokens, nodes }
```

```
packages/sandbox/sandbox-policy/src/index.ts
:42-56  renderPolicyContext — тексты для read-only / workspace-write / danger-full-access
:58-62  declare module '@deepseek-ai/cordis' { interface Context { sandboxPolicy: SandboxPolicyService } }
:71-79  Config { mode?: SandboxMode; workspaceRoot?: string }
:82-87  SandboxPolicyRequest { session?: Session; mode?: SandboxMode }
:90-94  zod.union([literal('read-only'), literal('workspace-write'), literal('danger-full-access')]).nullable()
:110    export class SandboxPolicyService extends Service
:112-117 static Config = z.object({ mode: z.union([...]).default('read-only'), workspaceRoot: z.string() })
:119    static inject = ['sessionProjections']
:164    resolve(request: SandboxPolicyRequest = {}): SandboxExecutionPolicy

packages/fs/fs-observation-policy/src/index.ts
:98     export const name = 'fs-observation-policy'
:106    export function apply(ctx: Context): void
src/types.ts:23  export interface FsObservationActor
```

```
packages/jobs/jobs-local/src/index.ts
:95-116 TrackedJob { ..., settled: Promise<void>, waitResolvers: Set<() => void>,
                    pump: PumpHandle | undefined, spillPaths: (string|undefined)[] }
:123-128 /** The in-memory `jobs` registry. ... */ export class LocalJobRegistry extends JobRegistry
:160    private store = new Map<JobId, TrackedJob>()          ← process-local, НЕ durable
Родственные: packages/jobs/jobs (@deepseek-ai/dsh-jobs — контракт), packages/jobs/tool-jobs (инструменты).
```

Версии платформенных пакетов: `dsh-token-meter`, `dsh-sandbox-policy`, `dsh-fs-observation-policy`, `dsh-jobs-local`, `dsh-experimental-auto-review` — все **0.1.7-rc.2**.

---

## 8. Бюджет: что уже есть в MyWork (второй учёт не нужен)

```
packages/core/src/budget.ts
:10-12  "The gate refuses, it does not repair: §30's three outcomes (pause, escalate, human decision)
         are workflow policy..."
:63-68  knownAmount(value) → BudgetAmount
:71-76  unknownAmount(reason)
:86-88  amountValue(amount) → number | undefined
:96-100 addAmounts(left, right)
:107-113 "A dimension the charge omits is recorded as unknown, not as zero"
:122-140 chargeConsumption(consumption, charge) → { consumption, charged }
:151-169 readCallTokens(usage) → ModelCallTokens
:181-188 modelCallCost(route, rate, tokens) → BudgetAmount
:195-200 modelRateOf(table, route)
:210-212 "A limit the request does not charge is not checked at all"
:217-239 decideBudgetAdmission({limits, ledgers, request}) → BudgetDecision
:228,231,234 отказы: scope-not-measured / limit-unverifiable / limit-exceeded
:242-254 refuse(check, reason)
:260-279 chargeOf: maxAttempts, maxReviewLoops, maxPlannerCalls, maxOptimizerCostPerDay,
                    maxTokensPerTask, maxCostPerTask, workspaceDailyBudget, providerDailyBudget
:288-306 usedOf
:327-336 закрытый набор имён лимитов (§30)

packages/core/src/scheduler.ts:70 (импорт), :82 (TICK_META), :568 — ЕДИНСТВЕННАЯ точка enforcement:
  const decision: BudgetDecision = decideBudgetAdmission({ limits: workspace.budget, ledgers, request })

packages/contracts/src/budget.ts:36 (BudgetConsumption), :50 (EMPTY_BUDGET_CONSUMPTION),
  :78 (BUDGET_LIMIT_NAMES), :180 (consumption)
packages/contracts/src/scheduler.ts:212 (ссылка на decideBudgetAdmission), :304 (consumption)
packages/core/src/index.ts:333-334 — публикация chargeConsumption / decideBudgetAdmission

Чего НЕТ: ни одного вхождения 'tokenMeter'/'dsh-token-meter' в packages/**/src MyWork;
ни одного вызова readCallTokens вне определения и реэкспорта.
```

OTel: `Select-String -Path packages\**\src\*.ts -Pattern 'opentelemetry|otel|traceId|spanId|tracer|productTelemetry'` → **0 совпадений**.
`correlationId` — **81** совпадение в `packages/**/src/*.ts` (отчёт §8.2 P7 говорит 90; набор файлов различается — см. §7.3 основного файла).

---

## 9. CI, тег, pack, леджеры, гигиена

```
.github                     → Test-Path → False
git tag | Measure-Object    → 0
git rev-parse HEAD          → 0c657ae1434202865bd330f0eeaf2b60eb78f6d4
git status --porcelain      → " M pnpm-lock.yaml"
git worktree list           → 4 записи:
   H:/Repo/DSH-MyWork          0c657ae [main]
   H:/Repo/DSH-MyWork/.tmp/f-audit           0c657ae (detached)
   H:/Repo/DSH-MyWork/.tmp/mw012-review      f22dbc3 (detached)
   H:/Repo/DSH-MyWork/.tmp/v2-boundary-demo  0c657ae (detached)

Размеры: .tmp 3947 файлов / 177,3 МБ; DSH-MyWork.rar 41,40 MiB; node_modules 109,7 МБ;
         packages 533 файла / 17,7 МБ; tests 32 файла / 0,8 МБ; .work 120 файлов / 3,6 МБ;
         .analysis 33 файла / 0,5 МБ.

package.json:8   "packageManager": "pnpm@12.4.2"
package.json:9-11 "engines": { "node": ">=22.18.0" }
package.json:16  "test": "node --test --test-isolation=none \"tests/**/*.test.mjs\""
package.json:17  "check": "pnpm run typecheck && pnpm run build && pnpm run smoke && pnpm run test"
pnpm-workspace.yaml → packages: [packages/*]

packages/controller/package.json
:4   "private": true
:17-20 "files": ["lib","cordis.patch.yml"]
:21-25 "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
:30-32 "peerDependencies": { "@deepseek-ai/cordis": "^4.0.2" }
:33-38 devDependencies: @deepseek-ai/cordis 4.0.2, @dsh-mywork/{adapter-sdk,contracts,core} workspace:*

Все 12 пакетов: private=true; engines=отсутствует; peerDependencies — только у controller.

scripts/pack.mjs:33   const before = new Set(readdirSync(controllerDir).filter(n => n.endsWith('.tgz')))
scripts/pack.mjs:44-47 produced = ... !before.has(name); if (produced.length !== 1) throw ...
scripts/lib/process.mjs:52-58 pnpmLaunch(): npm_execpath(.js|.cjs|.mjs) → { process.execPath, shell:false }
                              иначе { command:'pnpm', shell: process.platform === 'win32' }  ← путь в сломанный шим

.work/tasks/: MW-001.md … MW-055.md (55 файлов);
  INDEX.md 10533 б; tasks.json 97884 б; board-actions.json 214448 б;
  board-export.json 193386 б; board-before.json 438 б.
MW-027.md:1 / MW-035.md:1 → "> **НЕ ЗАПУСКАТЬ.** Карточка снята с исполнения как superseded."
```

---

## 10. Что НЕ проверялось (явно)

- `bd` не запускался; ENOENT/-4058 не воспроизводился.
- Полный прогон тестов, `tsdown`, smoke, `verify:profile` — не запускались (за Lead'ом, §5.4 брифа).
- `journal_mode`, `auto_vacuum`, триггеры на артефактах, DDL `audit_events` — не читались.
- `packages/controller/src/model-catalog.ts`, `dsh-session.ts` целиком — не читались.
- Инструменты worker-поверхности DSH и требования клиентского манифеста (`dsh.client.immediately`, bare-имя в client-строке) — не проверялись.
- `files`/`publishConfig` у 11 манифестов, кроме `controller` — не проверялись.
- `ControllerStores` (поля) в `packages/lease/src/lifecycle.ts` — не проверялись.
