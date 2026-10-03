# verify-surface-01 · сырые команды и наблюдения (верификация `22-STEPS-surface.md`)

**Роль:** независимый проверяющий (falsify), только чтение + этот файл и `93-VERIFICATION-SURFACE.md`.
**Дата:** 2026-09-27. **Ревизия кода:** `git rev-parse HEAD` = `0c657ae1434202865bd330f0eeaf2b60eb78f6d4`, `git status --short` — пусто.
**Объект:** `.work/plan-v0.3/22-STEPS-surface.md`, 1489 строк, mtime `27.09.2026 1:46:33`,
SHA-256 `3754E8C279C2DE6840485A02C5066FECEF4B0F83BBEFAB06F13797ECA603F36A`.
**Замечание о конкурентной записи:** во время проверки каталог `.work/plan-v0.3/` получил файлы
`90-VERIFICATION-A.md` (1:54:35), `92-RED-TEAM*.md` (1:54–1:56), `01-MASTER-PLAN.md` (1:56:20),
`10-DECISIONS.md` (1:52:29), `adr/ADR-029-transport-web.md` (1:52:51), `adr/ADR-034` (1:53:31) —
то есть **после** записи объекта. Вердикт относится к снимку объекта по хешу выше; содержимое
`10-DECISIONS.md` и ADR читалось в их состоянии на момент проверки.

## Скрипты/команды (все read-only; сборки и тесты, пишущие в `packages/*/lib`, не запускались)

| # | Команда | Наблюдение |
|---|---|---|
| 1 | `(Get-Content <файл>).Count` по 10 файлам | `contracts/src/board.ts`=381, `core/src/board.ts`=566, `contracts/src/task.ts`=107, `tests/board.test.mjs`=730, `tests/boundaries.test.mjs`=584, `storage/src/migrations.ts`=198, `controller/src/index.ts`=274 |
| 2 | `Select-String -Path tests\board.test.mjs -Pattern '^test\('` | 24 совпадения (строки 35, 59, 90, 105, 111, 146, 189, 232, 272, 299, 337, 369, 381, 452, 500, 522, 537, 569, 588, 621, 637, 642, 653, 711) |
| 3 | `node --test tests/board.test.mjs` | `ℹ tests 24 / pass 24 / fail 0 / skipped 0`, EXIT=0 |
| 4 | `node --test tests/boundaries.test.mjs` | `ℹ tests 26 / pass 26 / fail 0 / skipped 0`, EXIT=0 |
| 5 | `Select-String` по 43 парам «файл+токен» (контракты, ядро, storage, controller, adapter-sdk, tests) | все токены найдены в заявленных строках (см. §2 отчёта); исключения: `core/index.ts:301` — реэкспорт `applyDropIntent`, не вызов; `controller/index.ts:193` — докблок, регистрация на `:118` |
| 6 | `Select-String -Path packages\**\src\**\*.ts -Pattern 'boardRevision'` | только объявления: `contracts/src/board.ts:187,224`, `core/src/board.ts:90` — ни одного присваивания |
| 7 | `Select-String ... 'columnRevision'` в `core/src/board.ts` | единственная запись — `:556` (`placement.columnRevision + 1`); `:440,446,482,486,491,492,562` — чтения/типы |
| 8 | `Select-String ... 'subState'`, `'SessionLink'`, `'NeedsAttentionReason'`, `'IdeaPromotion|IdeaState|idea.bank'`, `'ZONE_LABELS|LANE_LABELS|BoardLane'` | `subState`=1 (`contracts/board.ts:210`); `SessionLink`=1 (`:336`); `NeedsAttentionReason`=2 (`:356,373`, 7 причин в `:373-381`); Idea=0; lanes-словарь=0 |
| 9 | `Select-String -Path packages\*\src\* -Pattern 'placement|board'` (storage) | 0; `CREATE TABLE` по `packages/*/src` = 16, ни одной placement/board-таблицы |
| 10 | `Select-String -Path packages\storage\src\migrations.ts` | `OUTBOX_INBOX` `version: 1` `name: 'outbox-inbox'` (`:49-51`), `MYWORK_MIGRATIONS = [OUTBOX_INBOX]` (`:91`), `MYWORK_SCHEMA_VERSION` (`:94`), журнал `version INTEGER NOT NULL PRIMARY KEY` (`:98-99`) |
| 11 | `Select-String -Path packages\*\src\*\*.ts -Pattern 'version: \d+'` | **`packages/evidence/src/schema.ts:140` — `version: 2` (EVIDENCE_MIGRATIONS)**, `execution/src/service.ts:250` — `{version:1,name:'outbox-inbox'}`, `storage/src/migrations.ts:50` — `version: 1`; композиция списков документирована как `[...MYWORK_MIGRATIONS, ...EVIDENCE_MIGRATIONS]` (`evidence/src/schema.ts:135`) |
| 12 | `rg -o "data-dsh-[a-zA-Z-]+" packages apps -g '**/src/**' ...` (DSH-checkout, без node_modules/dist/lib) | 7 совпадений в 3 файлах (`ui-primitives/src/focus.ts:7,15,24`, `ui-renderer/src/client/index.ts:66,73`, `ui-theme/src/styles/base.css:29,30`); по `packages`+`apps` — 32 совпадения / **31 уникальная строка** / **13 файлов** / 3 имени |
| 13 | `Select-String 'packages/util/package-manifest/src' -SimpleMatch 'icon'` | `types.ts:16 icon?: string` (манифест), `:51 readonly icon?: string` (`PluginLocalizedMeta`); `DshClientManifest` (`:80-94`) знает ровно 4 поля, `icon` в нём нет |
| 14 | `Get-Content packages/client/web/src/platform.ts` | `PLATFORM_MODULES` (`:8-14`) — 9 имён; `PRELOADED_CLIENT_EXTERNALS` (`:17-18`) пуст |
| 15 | `Get-Content packages/client/ui-layout/src/client/index.ts` | `'main': { kind:'keyed', scope:'root' }` (`:73`), `retainMainPanels(...entry.options.key)` (`:160`), `entries('main').some(entry => entry.options.key === id)` (`:168`) → тождество `id === key` подтверждено на источнике; throw — `service.ts:72-77` |
| 16 | `Get-Content packages/client/connection/src/index.ts` / `rpc-host.ts` | `/api`-роут вызывает `connection.admit(req)` до `bridge(...)` (`index.ts:149-155`); RPC-канал — `admit` до `bridge` (`rpc-host.ts:182-188`); `assertFetchRoute` требует путь под `API_PATH` (`:320-323`); дубликат точного пути бросает (`:163-165`) |
| 17 | `Get-Content packages/client/connection/src/http-bridge.ts` | `res.on('close')`+abort (`:42-49`), заголовки копируются дословно (`:96-97`), поток с `drain`-backpressure (`:103-120`) |
| 18 | `Get-Content packages/host/webserver/src/index.ts` | `WebRoute`/`WebRouteKind` (`:38-48`), `register` с disposer и throw на дубликат (`:166-173`), `route.handler(req,res)` вызывается на `:228`; диапазон `:319-360` — это `match()`/`applyIndexTaps`/`renderIndex`, не путь запроса |
| 19 | `Get-Content` живого профиля `@linxin666/dsh-client-ui-task-board` 0.4.3 | `package.json:5 icon`, `:9-24 exports`, `:25-49 dsh.bundle.patch + dsh.client{8 inject, platform:web} + peerDependencies`, `:88-96 files`; `src/index.ts:35 inject` (6 сервисов), `:51-89 Config` — **8 полей, `autoRun` отсутствует** (`:103-112` zod: 8 полей), `:378-402 ctx.effect + disposers.push(ctx.webServer.register(route))`; `src/host-routes.ts:150-160` fence, `:218-246` SSE; `src/protocol.ts:10-12` (schemaVersion 3 / legacy 2), `:35-60` кадр без карточек; `src/invariant.ts:1-4`; `src/client/native-panel.tsx:31-32 PANEL_ORDER=20`, `:77 data-dsh-taskboard-view`, `:99-124` две регистрации через `slots.inject`; `src/core/handover.ts:44` `read-only`, `:112-117` гейт; `src/host-ledger.ts:102 MAX_REQUEST_CACHE=256`, `:413-419` пути, `:574-585` requestId+fingerprint, `:703-714 importedSources`, `:1239` throw при живом lock |
| 20 | `Get-Content 'C:\Users\Dmitry\.dsh\task-board\ledger-v2.json' \| ConvertFrom-Json` | 369 634 байта, mtime 26.09.2026 22:01; `schemaVersion=3`, `revision=324`, 55 карточек; `backlog=34, done=19, failed=2`; `archivedAt`=3; с исполнениями 22, всего 31; `permission`=workspace-write ×55; `recentRequests`=255; `workspaceId 47b14762…` → 52 карточки (19 done, **33 eligible**), `3fc33afb…` → **3** карточки (в реестре `workspace.json` отсутствует); `sessionId` пуст у **9** из 31 исполнения |
| 21 | `Get-Content` `scheduler-v2.json` / профильного `cordis.patch.yml` | `{"lastTickAt":1790442076557}` — расписаний нет; строка `web-ui-task-board` — `:20-35`, ключи `autoRun*` — 7 штук (`:27-33`) |
| 22 | `Get-Content .work/plan-v0.3/10-DECISIONS.md` (D01, D02, D18, §0.4, §6) | D01 — выбор **вариант B (HTTP/SSE через `ctx.webServer`)** (`:166`), ADR-029 (`:181`); D02 — **вариант C** (`:264`), ADR-030 дополняет ADR018 (`:281`); D18 — **вариант C**, view-состояние — **слот-`store`** (`:1544,1549`), «ADR: без ADR» (`:1583`); §6 — `D01→ADR-029`, `D02→ADR-030`, `D18→без ADR` (`:1848-1855`) |
| 23 | `Get-Content .work/plan-v0.3/adr/ADR-029` / `ADR-030` / `ADR-032` | ADR-029 §Решение — HTTP/SSE через `webServer` + свой fence, §«Третий путь» — `connection.fetch.register` **кандидат, не выбран** (проверки (а)–(г) до R2); ADR-030 §3 — «`blocked` **и** `needs-attention` → бейдж внутри очереди; `cancelled` и `superseded` → скрытая группа `closed`», §2 — «`packages/core/src/board.ts` не меняется вовсе», §Тесты — «строки 35-57, 59-88 … остаются как есть»; ADR-032 §1 — peer **по пакету** `@deepseek-ai/dsh: >=0.1.7-rc.2 <0.2.0`, «а не по сервисам» |
| 24 | `Select-String '^#{2,4} F-\d+' .work/plan-v0.3/20-STEPS-foundation.md` | фактическая нумерация: `F-01` = «Рабочий bootstrap `pnpm`» (`:56`), `F-13` = bd-seam-резолвер (`:379`), `F-15` = «`bd`-seam в пробе и в диагностике (Doctor)» (`:426`), `F-20` = «Migration journal» (`:542`), `F-21` = «MW-057а: тест `batch`-рёбер» (`:564`), `F-25` = «Минимальный CI и тег» (`:661`), `F-41/F-42` = boundary-тесты (`:1071,1094`), `F-48` = «Peer-контракт: `peerDependencies` в `controller`» (`:1244`), `F-58/F-59` = `@dsh-mywork/web` (`:1525,1553`), `F-60` = «Гейт этапа 3» (`:1573`) |
| 25 | `Get-Content .work/plan-v0.3/01-MASTER-PLAN.md` §5 (200-215) | предварительная нумерация: `F-13` миграции, `F-15` CI+тег, `F-20` composition root, `F-21` durable state/journal, `F-25` boundary-тест, `F-10` bd-seam |
| 26 | `Select-String 'data-mw-' .work/plan-v0.3/20-STEPS-foundation.md` | F-59 (`:1553`), тест на `:1561`; **строка 1486 — это «Шаг 0» шага F-56** (allowlist инструментов worker), к `data-*` отношения не имеет |
| 27 | `Select-String '^### F-|F-15'` в `10-DECISIONS.md`/`22-STEPS-surface.md` | в объекте F-ссылки: 14, 236, 254, 264, 594, 623, 651, 652, 666, 740, 752, 754, 951, 1378, 1399, 1489 |
| 28 | `Get-ChildItem` репозитория и `packages`, `tests`, `scripts`, `docs`, `.tmp` | `packages/web` **нет**; `docs/` **нет вовсе** (значит `docs/adr/**` не существует); `tests/storage/` **нет**; `node_modules/.bin/tsdown.cmd` **есть**; `scripts/{pack.mjs,smoke.mjs,verify-profile.mjs}`; корневые devDeps: cordis 4.0.2, @types/node, tsdown 0.22.2, typescript ~5.7.2; **react, react-dom, jsdom, happy-dom — отсутствуют** |
| 29 | `pnpm --version` / `corepack pnpm --version` | `pnpm` падает («…\pnpm\12.4.2\…\bin\..\node_modules\pnpm\pnpm» is not recognized); `corepack pnpm --version` = `12.4.2` |
| 30 | `Get-Content .work/tasks/{MW-042,MW-049,MW-050,MW-052,MW-053,MW-055,MW-048,MW-035,MW-054}.md`, `INDEX.md`, `.work/reports/MW-043-idea-bank.md`, `tasks.json` | все заявленные цитаты найдены на заявленных строках (см. §2 отчёта); `tasks.json` — 55 задач, `MW-042/MW-043 = planned` |
| 31 | `Get-FileHash` объекта | `3754E8C279C2DE6840485A02C5066FECEF4B0F83BBEFAB06F13797ECA603F36A` |

## Что не запускалось (и почему)

- Сборки (`tsdown`, `tsc`) и `pnpm install/build` — запрещены брифом; они пишут в `packages/*/lib`.
- Полный прогон `pnpm run check`/`node --test "tests/**/*.test.mjs"` — запрещён брифом.
- Живой GUI, установка пакета в профиль, `plugin_manager`, мутации любых файлов кроме отчёта.
- Проверка варианта B (7 полос) «в железе» — требует реализации; арифметика падений проверена чтением строк тестов.
