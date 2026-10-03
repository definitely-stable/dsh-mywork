# Верификация claim-леджера потока C (режим falsify, только чтение)

**Вердикт верификатора:** 50 из 50 claim'ов проверены независимо; 49 — ПОДТВЕРЖДЁН, 1 — ЧАСТИЧНО (C-49, переобобщение отрицания), 0 — ОПРОВЕРГНУТ, 0 — НЕОПРЕДЕЛЁННО. Несущие утверждения потока C (Typert Remote, Slots, `dsh.client`, compat-gate, schedule, request-extension, atomic-write, toolchain) воспроизводятся кодом rc.2 дословно, включая все цитированные номера строк. Единственная содержательная ошибка — универсальное отрицание «в DSH нет ни одной строки `data-dsh-*`»: таких строк 13.

**Объект:** `H:\Repo\DSH-MyWork\.work\analysis\2026-09-26\C-platform.md` (555 строк, C-01…C-50).
**Среда:** DSH `C:\Reposit\deepseek-harness\deepseek-harness` (HEAD `c7c4c725`, 0.1.7-rc.2), MyWork `H:\Repo\DSH-MyWork` (HEAD `0c657ae1`), профиль `C:\Users\Dmitry\.dsh\profiles\web`. Все вызовы pwsh завершились без маркеров `[exit code: N]` (т.е. exit 0); для grep/glob-инструментов exit-код не экспонируется — в колонке «доказательство» приведены совпадения/счётчики.

**Ограничение методики:** проверялось, что утверждение истинно по указанному месту кода. Claim'ы о поведении браузера/рантайма (HMR-перезагрузка, фактический рендер слота, реальный boot профиля) проверены только по исходникам — живой прогон не выполнялся (только чтение).

## 1. Журнал проверок (воспроизводимость)

Все команды ниже выполнялись из pwsh без изменения файлов; ни один вызов не вернул `[exit code: N]` (exit 0). Для grep-инструментов приведён счётчик совпадений.

| # | Команда (сокращённо) | Что вернула | Покрытые claim'ы |
|---|---|---|---|
| 1 | построчный дамп `typert/protocol/src/{index,types}.ts` 160–260 / 60–100 | перегрузки `Remote`, `TypeError` на `:216–219`, `RemoteResult` `:76–78` | C-01…C-03 |
| 2 | дамп `types.ts` 350–425, `client/index.ts` 145–162 | `cancellation.parameter:'signal'`, `signal: AbortSignal`, `uplink()`, `super(ctx,'remote')` | C-04…C-06 |
| 3 | дамп `client/index.ts` 200–262, 735–770; grep `remoteServiceKey` | `$mount`, `mountContribution`, ключ `remote.${namespace}` | C-06, C-07 |
| 4 | дамп `docs/api-gateway.md` 55–145 | пайплайн `:99–101`, `api-remotes` `:78,91–92`, отказ от SRC `:139` | C-07, C-08 |
| 5 | дамп `generator/src/workspace.ts` 30–50, 85–148; `tsdown-plugin.ts` 80–92 | export/files-проверки, `new WorkspaceTypertGenerator(root)` | C-09, C-10 |
| 6 | дамп `generator/package.json`, `cookbook/adding-a-remote-api.md` 45–110 | `./tsdown`, `typescript ^6.0.3`, cookbook без `files` | C-11, C-12 |
| 7 | дамп `api/gateway/src/index.ts` 225–230, 305–380; `session-controller/src/index.ts` 95–140 | `claimsEndpoint`, `collectSrcClaims`, `invoke`/`stream`, namespace `session` | C-13…C-15 |
| 8 | дамп `webserver/src/index.ts` 38–48, 140–170; `ui-renderer/.../registry.ts` 155–316 | `WebRoute`, `register`, `super(ctx,'slots')`, `inject`, `provideRoot` | C-16, C-18, C-19 |
| 9 | дамп `ui-slots/src/index.ts` 240–262, 596–632, 1348–1356, 1478–1484; `ui-sidebar/.../slots.ts` 28–40, 74–82 | `PropsRuntime`, `ComposedProps`, `entriesOfSlot`, `subscribe`, `sidebar.panellist` | C-19…C-21 |
| 10 | дамп `ui-layout/.../index.ts` 68–76, 155–170; `ui-workspace/.../index.ts` 85–95; `modules/.../manifest.ts` 158–182; `package-manifest/src/types.ts` 12–30, 50–95 | keyed `main`, `retainMainPanels`, «never apply sequencing», `parseDshClient`, схема `engines` | C-22, C-23, C-29, C-38 |
| 11 | grep `data-dsh-panel-entry\|data-dsh-taskboard\|semantic-attrs` по `packages/**/*.ts`; `git ls-files '*semantic-attrs*'`; grep `prepareRequestExtensions`; grep `engines` по `packages/boot` | 0 / пусто / 4 совпадения (1 вызов) / 0 | C-38, C-41, C-49 |
| 12 | `git show --stat cad6fef2fd` + diff `packages/bundle/web-app`; `git show --stat 193f9ce413` | 3× `disabled: true`; заголовок фикса request extensions | C-39, C-41 |
| 13 | дамп `schedule/src/index.ts` 95–130, 245–270, 365–400; `domain.ts` 40–55, 365–380; `tools.ts` 165–175; `atomic-write/src/index.ts` 105–178 | селекторы, CAS, `schedule/changed`, горизонт cron, IANA, takeover-claim | C-40, C-43 |
| 14 | чтение `llm-deepseek/src/request-extensions.ts` целиком; grep `maxBytes` в `session-log-deepseek/src` | fallback `:36–44`; `default(8 * 1024 * 1024)` `:53` | C-41, C-42 |
| 15 | дамп `plugin-manager/src/operations.ts` 198–242; `plugin-compatibility.ts` 40–105 | `run.json`, отказ, фильтр имён `:75`, `:68`, exemption `:84–86` | C-32, C-44 |
| 16 | дамп `profile-compatibility.ts` 18–140; `profile.ts` 110–125, 660–686; `compatibility-preflight.ts` 85–110; `profile-boot.ts` 158–176 | accept-risk, `0o600`, `skippedBundles`, preflight, единственный вызов `:170` | C-33…C-35 |
| 17 | дамп файлов сторонних плагинов в профиле + `(Get-Item lib/client.js).Length` + regex-счётчики; grep `@Remote\|RemoteScope\|TypertRemoteService` по их `src` | peer'ы, `dsh.client`, 2417481 байт, 6/6/3, 0 Remote-методов | C-17, C-31, C-37 |
| 18 | дамп `modules/src/index.ts` 218–255, 818–880; `client/web/src/platform.ts` 1–20; `tsdown.client.ts` 470–500, 612–625 | ошибка `./client`, `exactPackageSpecifier`, 9 модулей, banner/footer CJS | C-24…C-28 |
| 19 | дамп `agent-team-profile/{package.json,src/index.ts}`; `client-ui-agent-team/package.json`; `client/hmr/src/index.ts` 20–208; `hmr/src/events.ts` | `dsh.bundle` без `dsh.client`; `rebuilt`, граф, `/plugins/events` | C-30, C-50 |
| 20 | ConvertFrom-Json корневых манифестов DSH/MyWork, `vendor/cordis`, controller; `tsdown.config.ts`; `lib/index.js`; `verify-profile.mjs` 125–241; `args.ts` | engines/TS/pnpm, Cordis 4.0.4 vs 4.0.2, единственный import, весь путь verify | C-36, C-45…C-48 |
| 21 | grep `\bengines\b` по `packages` и `apps`; дамп `vendor/loader/src/internal.ts` 126–142 | читателей манифеста нет; loader смотрит `process.versions.node` | C-38 |

## 2. Таблица вердиктов

| ID | вердикт | доказательство (файл:строка / команда + результат) | комментарий |
|---|---|---|---|
| C-01 | ПОДТВЕРЖДЁН | `packages/typert/protocol/src/index.ts:198–225` (перегрузки Remote), `:250–257` (RemoteScope); имя пакета — `typert/protocol/package.json:2` | три формы: голый декоратор (`:224`), `@Remote('name')` (`:212–214`), `@Remote({mode:'stream'})` (`:216–221`) |
| C-02 | ПОДТВЕРЖДЁН | `index.ts:216–219`: `Reflect.ownKeys(...).length !== 1 \|\| mode !== 'stream'` → `throw new TypeError('typert-protocol: Remote options must contain exactly mode: "stream"')` | текст ошибки совпадает с заявленным смыслом |
| C-03 | ПОДТВЕРЖДЁН | `packages/typert/protocol/src/types.ts:69–78` | дословно: «only assembly faults (arity, an unmounted method, a missing Context adapter) still reject» |
| C-04 | ПОДТВЕРЖДЁН | `types.ts:93` (`RemoteStream<Out, In = never>`), `:355–358` (uplink-кодек дескриптора), `:409–420` (`uplink<In = unknown>(): AsyncIterable<In>`) | `uplink()` объявлен на `:420`, не на `:355` — цитата диапазона корректна |
| C-05 | ПОДТВЕРЖДЁН | `types.ts:359–363` (`cancellation?: { parameter: 'signal' }`), `:407–408` (`readonly signal: AbortSignal`); `docs/api-gateway.md:56` | «recorded in the descriptor instead of entering `args`» |
| C-06 | ПОДТВЕРЖДЁН | `packages/api/gateway/src/client/index.ts:154` (`super(ctx,'remote')`), `:752–754` (`remote.${namespace}`), `:640` (`super(ctx, remoteServiceKey(name))`); `docs/api-gateway.md:60` | docs: «traced Cordis child Service registered as `remote.<namespace>`» |
| C-07 | ПОДТВЕРЖДЁН | `client/index.ts:202–209` (`$mount`), `:241–256` (`mountContribution`); `docs/api-gateway.md:78,91–92` | shipped assembly = `@deepseek-ai/dsh-api-remotes/client` |
| C-08 | ПОДТВЕРЖДЁН | `docs/api-gateway.md:139` — дословно про отказ монтировать SRC-дескрипторы без строгих кодеков | — |
| C-09 | ПОДТВЕРЖДЁН | `packages/typert/generator/src/workspace.ts:104–107` (export-check), `:109–113` (files-check), оба `throw new TypertAnalysisError` | `exports['./typert']` с точными путями + оба файла в `files` |
| C-10 | ПОДТВЕРЖДЁН | `workspace.ts:115–147`; условие входа — `artifact.remote !== undefined` (`:130`) | требуется ровно для пакетов с Remote-методами, `./remote` → `lib/typert.remote-client.{d.ts,js}` |
| C-11 | ПОДТВЕРЖДЁН | `packages/typert/generator/package.json:2`, `:21–24` (`./tsdown`), `:36` (`"typescript": "^6.0.3"`) | — |
| C-12 | ПОДТВЕРЖДЁН | `docs/cookbook/adding-a-remote-api.md:94–103` (блок без `files`) против `workspace.ts:109–114,143–147` | расхождение docs↔код реально, cookbook упал бы на генерации |
| C-13 | ПОДТВЕРЖДЁН | `packages/api/gateway/src/index.ts:313–319` (`claimsEndpoint`), `:322–336` (`collectSrcClaims` через `remoteMethods()`); `stream-protocol.ts:13` | исключение `$events/result` (`:314`) само двухсегментно — правило «только двухсегментные» не нарушено |
| C-14 | ПОДТВЕРЖДЁН | `packages/api/session-controller/src/index.ts:98–99` (комментарий `ctx.remote.session`), `:136` (`super(ctx,'sessionController',{namespace:'session'})`) | serviceKey ≠ namespace |
| C-15 | ПОДТВЕРЖДЁН | `packages/api/gateway/src/index.ts:227` (`super(ctx,'typertGateway')`), `:345` (`invoke`), `:374` (`stream`) | — |
| C-16 | ПОДТВЕРЖДЁН | `packages/host/webserver/src/index.ts:42` (`WebRoute`), `:145` (`super(ctx,'webServer')`), `:166` (`register(route): () => void`) | — |
| C-17 | ПОДТВЕРЖДЁН | профиль `…\profiles\web\node_modules\@linxin666\dsh-client-ui-task-board`: `src/index.ts:35` (inject `typertGateway`,`webServer`), `:321`, `:388` (`ctx.webServer.register`); `src/host-runner.ts:259–266` (`gateway.invoke`/`gateway.stream`); `src/host-routes.ts:186–250`; `src/protocol.ts:13` (`/api/task-board`); grep `@Remote\|RemoteScope\|TypertRemoteService\|bindTypertRemote` по `src` → **0 совпадений** | собственных Remote-методов нет, API отдаётся по HTTP |
| C-18 | ПОДТВЕРЖДЁН | `packages/client/ui-renderer/src/client/registry.ts:159–161` (`super(ctx,'slots')`) | — |
| C-19 | ПОДТВЕРЖДЁН | `registry.ts:181` (`register`), `:209` (`inject(key,callback)`), `:312` (`provideRoot`); `packages/client/ui-slots/src/index.ts:1352` (`entriesOfSlot`), `:1481` (`subscribe`) | — |
| C-20 | ПОДТВЕРЖДЁН | `ui-slots/src/index.ts:242–258` (`PropsRuntime` = Owner+Key+SlotInjectFace+ScopeStandardProps), `:601–610` (`ComposedProps` = PropsRuntime & PropsRenderSlots & PropsRenderFactories & PropsStore & InjectFace & MatchedShare & PropsLocale); `docs/subsystems/slots.md:77` | гарантия композиционная (нет ctx-шары), не типовая запрёщенность — см. §4 |
| C-21 | ПОДТВЕРЖДЁН | `packages/client/ui-sidebar/src/client/contract/slots.ts:32–35` («Each list id addresses the matching main panel»), `:77–80` («List id and matching main panel key») | — |
| C-22 | ПОДТВЕРЖДЁН | `packages/client/ui-layout/src/client/index.ts:73` (keyed root `main`), `:159–162` (`retainMainPanels(ctx.slots.entries('main'))`), `:167–168` (проверка по `entries('main')`) | allow-list отсутствует |
| C-23 | ПОДТВЕРЖДЁН | `packages/client/modules/src/client/manifest.ts:161–181` (`parseDshClient`: обязательный `platform`, опциональные `inject`/`external`/`immediately` с проверкой типов); `packages/util/package-manifest/src/types.ts:80–94` | — |
| C-24 | ПОДТВЕРЖДЁН | `packages/client/modules/src/index.ts:845–848`: `throw new Error('client-modules: … declares dsh.client but exports no "./client" bundle')` | текст ошибки в claim'е дословный |
| C-25 | ПОДТВЕРЖДЁН | `modules/src/index.ts:874–875` (`exactPackageSpecifier(loaderName)` → `undefined` для субпути → `return undefined`); комментарий `:829–831` («subpath entries … permanently not a client row») | — |
| C-26 | ПОДТВЕРЖДЁН | `packages/client/web/src/platform.ts:8–14` — ровно 9 спецификаторов (react, react/jsx-runtime, react-dom, react-dom/client, cordis, client-store, ui-slots, ui-primitives, ui-dockkit) | счёт совпадает |
| C-27 | ПОДТВЕРЖДЁН | `packages/client/tsdown.client.ts:473–499` (`format:'cjs'`, `platform:'browser'`, `outDir:'lib'`, entry `{client}`, `dts:false`, `clean:false`, `neverBundle: isRequested`, `alwaysBundle: !isRequested`), `:618–624` (banner `window.__ModuleLoader__.load({id, factory: (require) => {` + footer `return module.exports; } });`) | имя `lib/client.js` закреплено `entryFileNames` (`:479–481`) |
| C-28 | ПОДТВЕРЖДЁН | `modules/src/index.ts:225` (`PLUGIN_ROUTE='/plugins'`), `:248–250` (`${PLUGIN_ROUTE}/${id}/${fileName}?rev=${rev}`) | — |
| C-29 | ПОДТВЕРЖДЁН | `packages/client/ui-workspace/src/client/index.ts:87–93` («dsh.client.inject edges are informational … never apply sequencing»); `package-manifest/src/types.ts:84` | — |
| C-30 | ПОДТВЕРЖДЁН | `packages/experimental/agent-team-profile/package.json:35–44` (только `dsh.bundle.patch` + 3 зависимости), `src/index.ts:8` (`export {}`); `packages/experimental/client-ui-agent-team/package.json:29–39` (`dsh.client`: `platform:'web'`, 5 inject) | у profile-пакета `dsh.client` нет |
| C-31 | ПОДТВЕРЖДЁН | профиль `…\@linxin666\dsh-web-all\package.json:43–46` (`dsh.client {inject:[],platform:'web'}`); `(Get-Item lib\client.js).Length` = **2417481**; counts по `lib/client.js`: `sidebar.panellist` = 6, `data-dsh-panel-entry` = 6, `dsh-client-ui-task-board` = 3 | размер и все три счётчика воспроизведены точно |
| C-32 | ПОДТВЕРЖДЁН | `packages/boot/app-boot/src/plugin-compatibility.ts:68` (`if (!Object.hasOwn(fields,'peerDependencies')) return undefined`), `:75` (фильтр `name !== '@deepseek-ai/dsh' && !name.startsWith('@deepseek-ai/dsh-')`); `:76–79` (workspace-подстановка, `semver.satisfies(..., {includePrerelease:true})`) | — |
| C-33 | ПОДТВЕРЖДЁН | `packages/boot/app-boot/src/profile.ts:674–682` (issue → `skippedBundles.push`), `:113–122` (`reportSkippedBundles`, «launchers call this once per start»); `apps/cli/src/profile-boot.ts:170` | одна строка stderr на каждый пропущенный bundle за старт |
| C-34 | ПОДТВЕРЖДЁН | `packages/boot/app-boot/src/profile-compatibility.ts:20–38` (`isExactPluginVersion`/`validatePluginVersionExemption`), `:64–65` (unreadable → `exemptions:{}`), `:108–118` (`--accept-risk` обязателен), `:121–123` (точная версия runtime), `:139` (`mode: 0o600`) | нюанс частично повреждённого файла — см. §4 |
| C-35 | ПОДТВЕРЖДЁН | `packages/boot/app-boot/src/compatibility-preflight.ts:74–79` (`prepareProfileEntries` → `preflight`), `:89–106` (denial через `evaluatePluginCompatibility`), `:65` (denied row gains `disabled`) | отказ применяется на стадии подготовки строк, т.е. до импорта модуля |
| C-36 | ПОДТВЕРЖДЁН | `H:\Repo\DSH-MyWork\packages\controller\package.json`: `peerDependencies = {"@deepseek-ai/cordis":"^4.0.2"}` (ConvertFrom-Json) | ни одного `@deepseek-ai/dsh*`-peer → по C-32 гейт молчит |
| C-37 | ПОДТВЕРЖДЁН | профиль `…\dsh-client-ui-task-board\package.json:46–49`: `{"@deepseek-ai/dsh":">=0.1.7-rc.2","react":"^18.2.0"}` | `react` гейт игнорирует (не `dsh*`-имя) |
| C-38 | ПОДТВЕРЖДЁН | `packages/util/package-manifest/src/types.ts:23–24`, `:56–66`; grep `engines` по `packages/boot/**/*.ts` → **0**; grep `\bengines\b` по `packages/**/*.ts` → только комментарии + декларация типа; по `apps/**/*.ts` → 1 нерелевантный тест; `vendor/loader/src/internal.ts:133–134` читает `process.versions.node`, а не манифест | поле декларативное; читателя нет ни в packages, ни в apps |
| C-39 | ПОДТВЕРЖДЁН | `git show --stat --oneline cad6fef2fd` (exit 0, «feat(web): disable shipped schedule and time context plugins»); diff `packages/bundle/web-app/cordis.patch.yml`: `+ disabled: true` к строкам `time-context`, `schedule` (hunk `@@ -120,9 +120,11 @@`) и `ui-schedule` (`@@ -367,6 +369,7 @@`) | ровно три строки, как заявлено |
| C-40 | ПОДТВЕРЖДЁН | `packages/schedule/schedule/src/index.ts:101` (inject), `:126` (`ctx.storageDomain.open(scheduleDomain)`), `:249–270` (шесть селекторов + «Exactly one reminder selector is required»), `:369–386` (CAS по `request.expected`), `:394–399` (`ctx.emit('schedule/changed')`); `domain.ts:43–51` (`CRON_SEARCH_HORIZON_YEARS = 400`), `:370–376` (`Intl.DateTimeFormat(...).resolvedOptions().timeZone`); `tools.ts:169–173` | — |
| C-41 | ПОДТВЕРЖДЁН | `git show --stat --oneline 193f9ce413` (exit 0, «fix(llm): keep oversized request extensions from blocking model requests (#5168)»); `packages/session/session-log-deepseek/src/index.ts:53` (`maxBytes: z.number().step(1).min(1).default(8 * 1024 * 1024)`), `:211–223` (выбор префикса событий); grep `prepareRequestExtensions` по `packages/**/*.ts` → 4 совпадения, вызов ровно один: `llm-deepseek/src/adapter.ts:106` (импорт `:12`) | лимит 8 MiB — конфиг contribution `dsh_session_log`, не транспорт |
| C-42 | ПОДТВЕРЖДЁН | `packages/llm/llm-deepseek/src/request-extensions.ts:36–44` (файл прочитан целиком, 55 строк): catch → `payload = JSON.stringify(body)`, `onOmitted(fields, error)`, `accept: () => Promise.resolve()`; комментарий `:10–11` «the payload is the base request alone and acceptance is a no-op» | отбрасываются все extension-поля |
| C-43 | ПОДТВЕРЖДЁН | `packages/util/atomic-write/src/index.ts:110–126` (`holderExited`: строгий `^\d+\n$`, только `ESRCH`, `EPERM` = жив, `pid === process.pid` не отбирается), `:149–177` (`takeOverExitedLock`), claim-файл `:152` = `${lockPath}.takeover-${sha256(record)[0:16]}`, повторная проверка записи и PID `:162` | защита от переиспользования PID — в комментарии `:139–146` |
| C-44 | ПОДТВЕРЖДЁН | `packages/boot/plugin-manager/src/operations.ts:198–207` (`recordRun` → `.plugin-manager/run.json`, `0o600`), `:217–240` (`activeRecordedRun` → `awaitTreeGone` → отказ), текст `:235–236` дословно | механизм в plugin-manager, не в atomic-write |
| C-45 | ПОДТВЕРЖДЁН | ConvertFrom-Json корневых манифестов: DSH `engines.node = "^22.19.0 \|\| >=24.0.0"`, `typescript = "^6.0.3"`, `packageManager = "pnpm@11.7.0"`, `version = 0.1.7-rc.2`; MyWork `">=22.18.0"`, `"~5.7.2"`, `"pnpm@12.4.2"` | все шесть значений совпадают |
| C-46 | ПОДТВЕРЖДЁН | `vendor/cordis/package.json` → version **4.0.4**; MyWork controller devDep `4.0.2`, peer `^4.0.2`; фильтр гейта — C-32 (`:75`) | Cordis гейтом не покрыт |
| C-47 | ПОДТВЕРЖДЁН | `H:\Repo\DSH-MyWork\packages\controller\tsdown.config.ts:13–19` (`alwaysBundle` трёх `@dsh-mywork/*`, `neverBundle: ['@deepseek-ai/cordis']`); `packages\controller\lib\index.js` — единственный ESM-import на строке 1 (`import { Service } from "@deepseek-ai/cordis";`), остальные совпадения `require(` — внутренние методы | — |
| C-48 | ПОДТВЕРЖДЁН | `scripts/verify-profile.mjs`: `:11,62` (`--dsh-bin`), `:48,156` (изолированный `DSH_HOME` под `.tmp/`), `:120,127–134` (`realProfileFingerprint` — хеши `profiles/web/package.json`, `cordis.patch.yml`, `settings.yaml`), `:170` (pack), `:176` (`--from-default-profile sdk-minimal`), `:182–184` (`dsh plugin add`), `:208` (`--dump-config`), `:228–232` (сверка отпечатков); `apps/cli/src/args.ts:34,45,168,170` | путь pack → create → add → dump-config → boot → fingerprint подтверждён по строкам |
| C-49 | **ЧАСТИЧНО** | именованный контракт: grep `data-dsh-panel-entry\|data-dsh-taskboard\|semantic-attrs` по `packages/**/*.ts` → **0**; `git ls-files '*semantic-attrs*'` → пусто (exit 0), untracked-совпадений 0; **НО** grep `data-dsh-` по `packages/**/*.ts` → **13 совпадений**: `ui-primitives/src/focus.ts:7,15,24` (`data-dsh-automatic-focus`), `ui-renderer/src/client/index.ts:66,73` (`data-dsh-boot`), `client/web/tests/boot.client.spec.ts`, `boot-page.client.spec.ts` (`data-dsh-boot`, `data-dsh-boot-spinner`) | «контракта `data-dsh-panel-entry`/`semantic-attrs-v1.md` нет» — верно; «ни одной строки `data-dsh-*`» — **ложно** (см. §3) |
| C-50 | ПОДТВЕРЖДЁН | `packages/client/hmr/src/index.ts:27` (`inject ['clientModules','webServer']`), `:77` (`ctx.clientModules.rebuilt(id)`), `:130–131` (`artifactBaseline`), `:162,176` (кадры `graph`), `:181–183` (`webServer.register`), `:196–199` (кадры `rebuilt`); `hmr/src/events.ts:44` (`EVENTS_ENDPOINT = '/plugins/events'`) | канал, граф и кадры rebuilt существуют |

## 3. Опровергнуто (детали)

**C-49 — единственное опровергнутое утверждение, и то в части переобобщения.**

Отчёт (и §1 строка 34, и §22 п.5) формулирует отрицание универсально: «ни одной строки `data-dsh-*` в исходниках пакетов». Это неверно. В `packages/**/*.ts` есть 13 строк с атрибутами `data-dsh-*`:

| Файл:строка | Строка |
|---|---|
| `packages/client/ui-primitives/src/focus.ts:7` | `* The theme suppresses outlines while data-dsh-automatic-focus is present…` |
| `packages/client/ui-primitives/src/focus.ts:15` | `element.removeAttribute('data-dsh-automatic-focus')` |
| `packages/client/ui-primitives/src/focus.ts:24` | `element.setAttribute('data-dsh-automatic-focus', '')` |
| `packages/client/ui-renderer/src/client/index.ts:66` | `'data-dsh-boot': '',` |
| `packages/client/ui-renderer/src/client/index.ts:73` | `container.querySelector<HTMLElement>(':scope > [data-dsh-boot]')` |
| `packages/client/web/tests/boot.client.spec.ts:69,94,279,280,289` | `data-dsh-boot`, `data-dsh-boot-spinner` |
| `packages/client/web/tests/boot-page.client.spec.ts:16,24,29` | `data-dsh-boot`, `data-dsh-boot-spinner` |

**Что это значит для плана.** Ядро утверждения уцелело: атрибута `data-dsh-panel-entry`, файла `contracts/semantic-attrs-v1.md` и вообще какого-либо «semantic-attrs»-контракта панелей в DSH нет (два независимых поиска: grep по `.ts` → 0; `git ls-files` + untracked → пусто). Но вывод «платформа не пользуется `data-dsh-*` вообще» неверен: платформа использует это пространство имён для собственных служебных маркеров boot/focus (`data-dsh-boot`, `data-dsh-automatic-focus`). Следствие для MyWork: пространство `data-dsh-*` — занятое платформой; сторонний контракт панелей лучше заводить в своём префиксе (`data-mywork-*`), иначе есть риск коллизии с внутренними маркерами shell'а. Ошибка не меняет архитектурного вывода §22 п.5 (нельзя рассчитывать, что платформа читает атрибут), но меняет формулировку правки.

**Остальные 49 claim'ов опровергнуть не удалось**: каждый цитированный номер строки содержит именно заявленное, включая все отрицательные утверждения (`engines` в `packages/boot` → 0; `prepareRequestExtensions` — один вызов; `@Remote` в стороннем плагине → 0; отсутствие `dsh.client` у `agent-team-profile`; `./remote`-требование именно для пакетов с Remote-методами).

## 4. Расхождения с отчётом (нюансы, не опровержения)

1. **C-38 / §33 / F6: где именно живёт `engines`.** Claim говорит «поле `package.json.engines` (включая `engines.dsh`)». Типизировано **верхнеуровневое** `engines?: DshEnginesManifest` (`types.ts:23–24`, поле `dsh?: string` — `:59`). При этом сторонний издатель пишет `package.json.dsh.engines.dsh` (task-board `package.json:25–28`), а `DshManifest` (`types.ts:29–39`) объявляет только `manifestVersion`, `bundle`, `profile`, `client` — **никакого `engines` там нет**. То есть фактическая практика третьей стороны лежит вообще вне типизированной схемы. Существо claim'а (ни один читатель DSH это не исполняет) подтверждено и для того, и для другого расположения, но формулировка «типизировано» верна лишь для top-level поля.
2. **C-34: «повреждённый файл grants nothing».** Верно для файла, который **целиком** нечитаем/невалиден (`:64–65`, `:70`, `:74`, `:76`) — такой даёт `exemptions: {}`. Но при **частичном** повреждении действует правило `:56–58`: «rejected records are skipped while the remaining valid ones still apply» (`:80–91`). Файл, где часть записей валидна, исключения всё же даёт. Рекомендуемая формулировка: «невалидные записи игнорируются, невалидный файл не авторизует ничего и блокирует перезапись (`rewritable: false`, `:128–130`)».
3. **C-20: «тип пропсов не может содержать `Context`».** Проверено ровно то, что утверждает доказательство: `ComposedProps` собирается из семи шар, среди которых `Context`-шары нет, и docs:77 говорит «Components never receive `ctx`». Но это **композиционная** гарантия, а не запрет уровня типов: если слот объявит `Context` внутри своих owner-props, он транзитивно попадёт в `ComposedProps` через `OwnerOf<K>` (`ui-slots/src/index.ts:255`). Формулировка «не может содержать» сильнее доказательства.
4. **C-13: исключение из правила.** `claimsEndpoint` возвращает `true` для `REMOTE_EVENT_RESULT_ENDPOINT` **до** проверки сегментов (`gateway/src/index.ts:314`), поэтому «только двухсегментные» — правило с коротким замыканием. Константа равна `'$events/result'` (`stream-protocol.ts:13`), т.е. тоже двухсегментная, так что фактическое следствие claim'а не нарушено; в тексте отчёта исключение не упомянуто.
5. **C-33: «одной строкой stderr за старт».** Точнее: по одной строке на каждый пропущенный bundle (`profile.ts:119–121`), а «один раз за старт» относится к вызову `reportSkippedBundles` (`profile-boot.ts:170`), потому что сама загрузка не печатает (`:114`).
6. **C-48: точность цитируемого диапазона.** Диапазон `verify-profile.mjs:170–232` подтверждён построчно; `:127–134` — это `realProfileFingerprint()` (хеширование реального профиля), а не сверка: сверка живёт на `:228–232`.
7. **C-47: «не имеет runtime-import'ов, кроме cordis».** Проверено по собранному артефакту: в `lib/index.js` ровно один ESM-import (строка 1, `@deepseek-ai/cordis`); найденные `require(` на строках 2231/3393/3394 — это внутренние методы класса, а не запросы модульной таблицы. Формулировка claim'а корректна, но её стоит читать как «один внешний import», а не «нет вызовов `require`».

## 5. Не проверено и почему

1. **Вёрстка `request-extensions` за пределами claim'ов.** `llm-deepseek/src/adapter.ts:107–112` (`dependencies.onExtensionsOmitted`) и `host.ts:26–33` (строка лога `llm-deepseek: sending route … without request extension fields …`) — это утверждения **тела** §41, а не C-41/C-42; я их не открывал. Claim C-41/C-42 (лимит 8 MiB, единственный вызов, отброс всех полей, `accept` — no-op) подтверждены полностью.
2. **Живое поведение не наблюдалось.** HMR-перезагрузка клиентского плагина, фактический монтаж слота, рендер панели и реальный boot профиля проверены только по исходникам: работа велась в режиме только чтения, сервер не перезапускался, браузер не открывался. C-50 подтверждён как «канал существует в коде», а не как «кадры реально доходят».
3. **C-48: середина диапазона.** Строки `verify-profile.mjs:200–222` (сборка overlay и boot-фаза) не распечатывались; проверены `125–140`, `168–200`, `222–241`. Пропущенный участок не несёт утверждений claim'а, но формально не открыт.
4. **C-20: сквозная проверка `SlotMap`.** Я не обошёл все объявления слотов, чтобы убедиться, что ни один owner-props тип не содержит `Context` — проверена композиция `ComposedProps`/`PropsRuntime` и документация.
5. **Product-behavior §36/§24 сверх claim'ов** (число `dependencies` у `dsh-web-all`, содержимое `cordis.patch.yml` семейных строк, `disabled: true` как opt-in) не проверялись пофайлово: в леджере это не отдельные C-ID. Видел только шапку `cordis.patch.yml` (`AUTO-GENERATED`, строки-субпути с `config.plugin`), что согласуется с описанием.
6. **Exit-коды grep/glob-инструментов** не экспонируются харнессом; отрицательные утверждения опираются на явные счётчики совпадений (0/6/13), а не на код возврата.
7. **Фоновые полные рекурсивные сканы** (`Get-ChildItem -Recurse` по всему `packages`/`apps`) были сняты как слишком медленные и заменены ripgrep-проверками через `grep`; их частичный вывод не использовался как доказательство.

## 6. Сводка

| Итог | Кол-во |
|---|---|
| Проверено claim'ов | 50 |
| ПОДТВЕРЖДЁН | 49 |
| ЧАСТИЧНО | 1 (C-49) |
| ОПРОВЕРГНУТ | 0 |
| НЕОПРЕДЕЛЁННО | 0 |

**Три важнейшие находки.**
1. **C-49 — переобобщение (единственная реальная ошибка).** «Ни одной строки `data-dsh-*`» ложно: платформа сама использует `data-dsh-boot` и `data-dsh-automatic-focus` (`ui-renderer/src/client/index.ts:66,73`; `ui-primitives/src/focus.ts:15,24`) плюс маркеры в тестах shell'а. Отсутствие именно `data-dsh-panel-entry`/`semantic-attrs-v1.md` подтверждено двумя независимыми поисками.
2. **C-38/F6 требует уточнения адреса поля.** Типизировано только верхнеуровневое `package.json.engines` (`types.ts:23–24,56–66`); реальная практика третьей стороны — `package.json.dsh.engines.dsh` — не входит в `DshManifest` (`types.ts:29–39`). Вывод «не читается никем» верен для обоих адресов (grep по `packages/boot` → 0, по `packages`/`apps` → ни одного читателя), но «типизировано» — только про top-level.
3. **Все числовые и «несущие» утверждения потока C воспроизведены точно.** 2 417 481 байт и счётчики 6/6/3 в `client.js` агрегата; 9 спецификаторов `PLATFORM_MODULES`; `disabled: true` ровно у трёх строк в коммите `cad6fef2fd`; 8 MiB только у `dsh_session_log` и единственный вызов `prepareRequestExtensions` в `adapter.ts:106`; правила гейта `:68`/`:75`; `./remote`-требование только при наличии Remote-методов (`workspace.ts:130`); отсутствие `@Remote` у стороннего task-board (0 совпадений по `src`).

## 7. Правки claim-леджера потока C (для родительского агента)

Правки касаются только формулировок; ни один архитектурный вывод потока C не отменяется.

1. **C-49 — переписать отрицание.** Заменить «ни одной строки `data-dsh-*` в исходниках пакетов» на «в DSH нет контракта `data-dsh-panel-entry` и файла `contracts/semantic-attrs-v1.md`; при этом пространство `data-dsh-*` платформа использует для собственных маркеров (`data-dsh-boot`, `data-dsh-automatic-focus`), поэтому сторонний контракт панелей следует заводить в своём префиксе». Статус: `verified` → `partially-refuted`. Ту же правку унаследовать в §22 п.5 тела отчёта.
2. **C-38 — уточнить адрес поля.** «Типизировано только верхнеуровневое `package.json.engines` (`types.ts:23–24,56–66`); используемое сторонними издателями `package.json.dsh.engines.dsh` не входит в `DshManifest` (`types.ts:29–39`) и не читается ни одним читателем DSH — как и top-level поле (grep `packages/boot` → 0). Версия-контракт обязан жить в `peerDependencies`». Статус `verified` сохраняется.
3. **C-34 — добавить оговорку о частичном повреждении.** «Целиком нечитаемый/невалидный файл исключений не даёт и блокирует перезапись; отдельные невалидные записи игнорируются, остальные продолжают действовать (`:56–58,80–91`)».
4. **C-20 — понизить модальность.** «`ComposedProps` не содержит `Context`-шары и документация запрещает передавать `ctx` компоненту; это композиционная гарантия, а не запрет уровня типов».
5. **C-13 — упомянуть исключение.** «Правило двух сегментов применяется после короткого замыкания на `$events/result` (`gateway/src/index.ts:314`), который сам двухсегментный».
6. **C-33 — формулировка про stderr.** «Одна строка на каждый пропущенный bundle; вызов ровно один за старт (`apps/cli/src/profile-boot.ts:170`)».
7. **C-48 — точность доказательства.** Диапазон `:127–134` — это построение отпечатка реального профиля; сверка неизменности — `:228–232`. Оба конца диапазона подтверждены построчно.
8. **Ничего не удалять.** Все C-ID, кроме C-49 (частично) и уточнений выше, проверены независимо и могут использоваться как вход для последующих потоков без повторной верификации; чувствительные к среде ссылки (профиль `C:\Users\Dmitry\.dsh\profiles\web`) подтверждены на текущем срезе и при обновлении профиля требуют перепроверки.
